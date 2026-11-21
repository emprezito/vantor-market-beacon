import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isInstrument } from "@/lib/market-data";
import { loadCandles, loadQuotes, resetMarketDataCache } from "@/lib/market-data.server";
import { loadMeridianCatalog, requestMeridianWsToken } from "@/lib/meridian.server";

const now = 1_800_000_000_000;

function json(value: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

beforeEach(() => {
  vi.stubEnv("MERIDIAN_API_KEY", "md_test_secret");
  vi.stubEnv("MERIDIAN_API_BASE_URL", "https://meridian.example/api/v1");
  resetMarketDataCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetMarketDataCache();
});

describe("Meridian server client", () => {
  it("loads the entitled catalogue and preserves provider suffixes", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/symbols")) {
        return json([{ symbol: "XAUUSDm" }, { symbol: "BTCUSDM" }, { symbol: "USDZAR" }]);
      }
      if (url.endsWith("/instruments")) {
        return json([
          {
            symbol: "XAUUSDm",
            asset_class: "metals",
            base_currency: "XAU",
            quote_currency: "USD",
            digits: 2,
            point: 0.01,
            contract_size: 100,
            enabled: true,
            metadata: { description: "Gold vs US Dollar" },
          },
          {
            symbol: "USDZAR",
            asset_class: "forex",
            base_currency: "USD",
            quote_currency: "ZAR",
            digits: 5,
            point: 0.00001,
            contract_size: 100_000,
            enabled: true,
          },
          {
            symbol: "BTCUSDM",
            asset_class: "crypto",
            base_currency: "BTC",
            quote_currency: "USD",
            digits: 2,
            point: 0.01,
            contract_size: 1,
            enabled: true,
          },
        ]);
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetch);

    const catalog = await loadMeridianCatalog();
    expect(catalog.providerByInternal.get("XAUUSD")).toBe("XAUUSDm");
    expect(catalog.providerByInternal.get("BTCUSD")).toBe("BTCUSDM");
    expect(catalog.providerByInternal.get("USDZAR")).toBe("USDZAR");
    expect(isInstrument("USDZAR")).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/symbols"),
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it("normalizes REST quotes and requests timeframe-aware candle history", async () => {
    const candleRequests: URL[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(new Headers(init?.headers).get("X-API-Key")).toBe("md_test_secret");
      if (url.endsWith("/symbols")) return json([{ symbol: "EURUSD" }]);
      if (url.endsWith("/instruments")) {
        return json([
          {
            symbol: "EURUSD",
            asset_class: "forex",
            base_currency: "EUR",
            quote_currency: "USD",
            digits: 5,
            point: 0.00001,
            contract_size: 100_000,
            enabled: true,
          },
        ]);
      }
      if (url.includes("/quotes?")) {
        return json([
          {
            provider: "MT5",
            symbol: "EURUSD",
            bid: 1.1,
            ask: 1.1002,
            timestamp_ms: now,
            received_at: new Date(now + 5).toISOString(),
          },
        ]);
      }
      if (url.includes("/candles?")) {
        candleRequests.push(new URL(url));
        return json({
          symbol: "EURUSD",
          timeframe: new URL(url).searchParams.get("timeframe"),
          price_type: "bid",
          count: 4,
          candles: [
            {
              time: new Date(now).toISOString(),
              open: 1.1,
              high: 1.2,
              low: 1,
              close: 1.15,
              tick_count: 42,
              complete: true,
            },
            {
              time: new Date(now).toISOString(),
              open: 1.1,
              high: 1.2,
              low: 1,
              close: 1.16,
              tick_count: 43,
              complete: true,
            },
            {
              time: new Date(now - 300_000).toISOString(),
              open: 1.1,
              high: 1.2,
              low: 1,
              close: 1.15,
              tick_count: 40,
              complete: false,
            },
            {
              time: new Date(now - 600_000).toISOString(),
              open: 1.1,
              high: 1.12,
              low: 1,
              close: 1.15,
              tick_count: 41,
              complete: true,
            },
          ],
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetch);

    const quotes = await loadQuotes(["EURUSD"]);
    expect(quotes["EURUSD"]).toMatchObject({
      bid: 1.1,
      ask: 1.1002,
      mid: 1.1001,
      feed: "meridian",
      source: "live",
    });
    const candles = await loadCandles("EURUSD", "5min", 20);
    expect(candles).toMatchObject({
      symbol: "EURUSD",
      interval: "5min",
      source: "live",
      feed: "meridian",
    });
    expect(candles.candles).toHaveLength(1);
    expect(candles.candles[0]).toMatchObject({ close: 1.16, volume: 43 });

    await loadCandles("EURUSD", "1day", 500);
    const intradayRequest = candleRequests.find(
      (request) => request.searchParams.get("timeframe") === "M5",
    );
    const dailyRequest = candleRequests.find(
      (request) => request.searchParams.get("timeframe") === "D1",
    );
    expect(intradayRequest?.searchParams.get("limit")).toBe("20");
    expect(dailyRequest?.searchParams.get("limit")).toBe("500");
    expect(
      Date.parse(intradayRequest!.searchParams.get("end")!) -
        Date.parse(intradayRequest!.searchParams.get("start")!),
    ).toBe(7 * 24 * 60 * 60_000);
    expect(
      Date.parse(dailyRequest!.searchParams.get("end")!) -
        Date.parse(dailyRequest!.searchParams.get("start")!),
    ).toBe(1_000 * 24 * 60 * 60_000);
  });

  it("requests a short-lived WebSocket token server-side", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://meridian.example/api/v1/auth/ws-token");
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("X-API-Key")).toBe("md_test_secret");
        return json({ token: "short-lived-token", expires_at: 1_800_000_120 });
      }),
    );

    await expect(requestMeridianWsToken()).resolves.toEqual({
      token: "short-lived-token",
      expires_at: 1_800_000_120,
    });
  });
});
