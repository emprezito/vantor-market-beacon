import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCandles, loadQuotes, resetMarketDataCache } from "@/lib/market-data.server";
import { isStaleFeedQuote } from "@/lib/market-data";
import type { FeedCandlesResponse, FeedQuotesResponse } from "@/lib/market-feed";

const NOW = Date.now();
const ALLOWED_SERVER = "22222222-2222-4222-8222-222222222222";
const OTHER_SERVER = "33333333-3333-4333-8333-333333333333";

function feedStub(handler: (request: Request) => Promise<Response>) {
  return {
    idFromName: () => "feed-id",
    get: () => ({ fetch: handler }),
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function quote(overrides: Partial<FeedQuotesResponse["quotes"][number]> = {}) {
  return {
    symbol: "XAUUSD",
    bid: 2_400,
    ask: 2_400.4,
    mid: 2_400.2,
    ts: NOW,
    marketOpen: true,
    stale: false,
    change: 12.5,
    high: 2_410,
    low: 2_390,
    ...overrides,
  };
}

function candles(overrides: Partial<FeedCandlesResponse> = {}): FeedCandlesResponse {
  return {
    symbol: "GER40",
    interval: "1h",
    stale: false,
    candles: [
      { time: 1_700_000_000, open: 18_000, high: 18_100, low: 17_950, close: 18_050 },
      { time: 1_700_003_600, open: 18_050, high: 18_200, low: 18_000, close: 18_150 },
    ],
    ...overrides,
  };
}

describe("market feed read-through", () => {
  beforeEach(() => {
    resetMarketDataCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetMarketDataCache();
  });

  it("prefers Exness quotes and keeps their metadata", async () => {
    vi.stubGlobal("__env__", {
      ALLOW_DEV_FEED: "true",
      DEV_FEED_SERVER_IDS: ALLOWED_SERVER,
      MARKET_STREAM: feedStub(async (request) => {
        expect(new URL(request.url).pathname).toBe("/internal/quotes");
        return json({
          quotes: [quote(), quote({ symbol: "EURUSD", bid: 1.1, ask: 1.1002, mid: 1.1001 })],
          stale: false,
        });
      }),
    });

    const quotes = await loadQuotes(["XAUUSD", "EURUSD"], { serverId: ALLOWED_SERVER });

    expect(quotes["XAUUSD"]).toMatchObject({
      feed: "exness",
      source: "live",
      change: 12.5,
      high: 2_410,
      low: 2_390,
      marketOpen: true,
    });
    expect(quotes["EURUSD"]?.feed).toBe("exness");
    expect(isStaleFeedQuote(quotes["XAUUSD"]!)).toBe(false);
  });

  it("keeps stale Exness quotes instead of falling back", async () => {
    vi.stubGlobal("__env__", {
      ALLOW_DEV_FEED: "true",
      DEV_FEED_SERVER_IDS: ALLOWED_SERVER,
      MARKET_STREAM: feedStub(async () =>
        json({ quotes: [quote({ stale: true })], stale: true } satisfies FeedQuotesResponse),
      ),
    });

    const quotes = await loadQuotes(["XAUUSD"], { serverId: ALLOWED_SERVER });

    expect(quotes["XAUUSD"]).toMatchObject({ feed: "exness", source: "cached" });
    expect(isStaleFeedQuote(quotes["XAUUSD"]!)).toBe(true);
  });

  it("marks a closed market as stale even when the last ingest is fresh", async () => {
    vi.stubGlobal("__env__", {
      ALLOW_DEV_FEED: "true",
      DEV_FEED_SERVER_IDS: ALLOWED_SERVER,
      MARKET_STREAM: feedStub(async () =>
        json({ quotes: [quote({ marketOpen: false })], stale: false } satisfies FeedQuotesResponse),
      ),
    });

    const quotes = await loadQuotes(["XAUUSD"], { serverId: ALLOWED_SERVER });

    expect(quotes["XAUUSD"]?.source).toBe("cached");
    expect(isStaleFeedQuote(quotes["XAUUSD"]!)).toBe(true);
  });

  it("does not treat an individually stale record as live when the feed heartbeat is fresh", async () => {
    vi.stubGlobal("__env__", {
      ALLOW_DEV_FEED: "true",
      DEV_FEED_SERVER_IDS: ALLOWED_SERVER,
      MARKET_STREAM: feedStub(async () =>
        json({
          quotes: [quote({ ts: NOW - 20_000, stale: true })],
          stale: false,
        } satisfies FeedQuotesResponse),
      ),
    });

    const quotes = await loadQuotes(["XAUUSD"], { serverId: ALLOWED_SERVER });

    expect(quotes["XAUUSD"]?.source).toBe("cached");
    expect(isStaleFeedQuote(quotes["XAUUSD"]!)).toBe(true);
  });

  it("falls back when the feed is disabled or unavailable", async () => {
    vi.stubGlobal("__env__", { ALLOW_DEV_FEED: "false" });
    const disabled = await loadQuotes(["EURUSD"], { serverId: ALLOWED_SERVER });
    expect(disabled["EURUSD"]?.source).toBe("simulated");
    expect(disabled["EURUSD"]?.feed).toBeUndefined();

    resetMarketDataCache();
    vi.stubGlobal("__env__", {
      ALLOW_DEV_FEED: "true",
      DEV_FEED_SERVER_IDS: ALLOWED_SERVER,
      MARKET_STREAM: feedStub(async () => {
        throw new Error("feed down");
      }),
    });
    const failed = await loadQuotes(["EURUSD"], { serverId: ALLOWED_SERVER });
    expect(failed["EURUSD"]).toMatchObject({
      source: "simulated",
      feedFallback: true,
    });
  });

  it("labels fallback quotes when the Exness feed is stale", async () => {
    vi.stubGlobal("__env__", {
      ALLOW_DEV_FEED: "true",
      DEV_FEED_SERVER_IDS: ALLOWED_SERVER,
      MARKET_STREAM: feedStub(async () =>
        json({ quotes: [], stale: true } satisfies FeedQuotesResponse),
      ),
    });

    const quotes = await loadQuotes(["EURUSD"], { serverId: ALLOWED_SERVER });

    expect(quotes["EURUSD"]).toMatchObject({
      feedFallback: true,
    });
  });

  it("labels Twelve quotes when the Exness response is incomplete", async () => {
    vi.stubGlobal("__env__", {
      ALLOW_DEV_FEED: "true",
      DEV_FEED_SERVER_IDS: ALLOWED_SERVER,
      MARKET_STREAM: feedStub(async () =>
        json({ quotes: [quote()], stale: false } satisfies FeedQuotesResponse),
      ),
    });

    const quotes = await loadQuotes(["XAUUSD", "EURUSD"], { serverId: ALLOWED_SERVER });

    expect(quotes["XAUUSD"]?.feedFallback).toBeUndefined();
    expect(quotes["EURUSD"]).toMatchObject({
      feedFallback: true,
    });
  });

  it("prefers Exness candles for symbols without a Twelve Data mapping", async () => {
    vi.stubGlobal("__env__", {
      ALLOW_DEV_FEED: "true",
      DEV_FEED_SERVER_IDS: ALLOWED_SERVER,
      MARKET_STREAM: feedStub(async (request) => {
        expect(new URL(request.url).pathname).toBe("/internal/candles");
        return json(candles());
      }),
    });

    const series = await loadCandles("GER40", "1h", 20, { serverId: ALLOWED_SERVER });

    expect(series.feed).toBe("exness");
    expect(series.source).toBe("live");
    expect(series.candles.map((item) => item.time)).toEqual([1_700_000_000, 1_700_003_600]);
  });

  it("keeps stale candles and falls back when no feed series exists", async () => {
    vi.stubGlobal("__env__", {
      ALLOW_DEV_FEED: "true",
      DEV_FEED_SERVER_IDS: ALLOWED_SERVER,
      MARKET_STREAM: feedStub(async () => json(candles({ stale: true }))),
    });
    const stale = await loadCandles("GER40", "1h", 20, { serverId: ALLOWED_SERVER });
    expect(stale.feed).toBe("exness");
    expect(stale.source).toBe("cached");

    resetMarketDataCache();
    vi.stubGlobal("__env__", {
      ALLOW_DEV_FEED: "true",
      DEV_FEED_SERVER_IDS: ALLOWED_SERVER,
      MARKET_STREAM: feedStub(async () => json(candles({ candles: [] }))),
    });
    const fallback = await loadCandles("GER40", "1h", 20, { serverId: ALLOWED_SERVER });
    expect(fallback.feed).toBeUndefined();
    expect(fallback.source).toBe("simulated");
  });

  it("does not request the dev feed for a server that is not allowlisted", async () => {
    const fetch = vi.fn(async () => json({ quotes: [quote({ symbol: "EURUSD" })], stale: false }));
    vi.stubGlobal("__env__", {
      ALLOW_DEV_FEED: "true",
      DEV_FEED_SERVER_IDS: ALLOWED_SERVER,
      MARKET_STREAM: feedStub(fetch),
    });

    const quotes = await loadQuotes(["EURUSD"], { serverId: OTHER_SERVER });
    const series = await loadCandles("GER40", "1h", 20, { serverId: OTHER_SERVER });

    expect(fetch).not.toHaveBeenCalled();
    expect(quotes["EURUSD"]?.feed).toBeUndefined();
    expect(quotes["EURUSD"]?.feedFallback).toBeUndefined();
    expect(series.feed).toBeUndefined();
  });

  it("fails closed when DEV_FEED_SERVER_IDS is empty or unset", async () => {
    const fetch = vi.fn(async () => json({ quotes: [quote({ symbol: "EURUSD" })], stale: false }));

    for (const serverIds of ["", undefined]) {
      resetMarketDataCache();
      fetch.mockClear();
      vi.stubGlobal("__env__", {
        ALLOW_DEV_FEED: "true",
        ...(serverIds === undefined ? {} : { DEV_FEED_SERVER_IDS: serverIds }),
        MARKET_STREAM: feedStub(fetch),
      });

      const quotes = await loadQuotes(["EURUSD"], { serverId: ALLOWED_SERVER });
      expect(fetch).not.toHaveBeenCalled();
      expect(quotes["EURUSD"]?.feed).toBeUndefined();
      expect(quotes["EURUSD"]?.feedFallback).toBeUndefined();
    }
  });

  it("serves Exness data only when the account server matches", async () => {
    const fetch = vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname;
      return path === "/internal/candles"
        ? json(candles())
        : json({ quotes: [quote({ symbol: "XAUUSD" })], stale: false });
    });
    vi.stubGlobal("__env__", {
      ALLOW_DEV_FEED: "true",
      DEV_FEED_SERVER_IDS: `${OTHER_SERVER}, ${ALLOWED_SERVER}`,
      MARKET_STREAM: feedStub(fetch),
    });

    const quotes = await loadQuotes(["XAUUSD"], { serverId: ALLOWED_SERVER });
    const series = await loadCandles("GER40", "1h", 20, { serverId: ALLOWED_SERVER });

    expect(quotes["XAUUSD"]?.feed).toBe("exness");
    expect(series.feed).toBe("exness");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
