import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadQuotes, resetMarketDataCache } from "@/lib/market-data.server";

const FIRST_KEY = "test-key-one";
const SECOND_KEY = "test-key-two";

function priceResponse(price: string) {
  return { status: 200, ok: true, json: async () => ({ price }) } as Response;
}

function rateLimitResponse() {
  return {
    status: 429,
    ok: false,
    json: async () => ({ code: 429, message: "You have run out of API credits for the current minute." }),
  } as Response;
}

function authHeaders() {
  return vi.mocked(fetch).mock.calls.map(([, init]) => {
    const headers = init?.headers as Record<string, string>;
    return headers["Authorization"];
  });
}

describe("market data key rotation", () => {
  beforeEach(() => {
    vi.stubEnv("TWELVE_DATA_API_KEYS", `${FIRST_KEY},${SECOND_KEY}`);
    vi.stubEnv("TWELVE_DATA_API_KEY", "");
    resetMarketDataCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetMarketDataCache();
  });

  it("rotates to the next key after a rate limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: URL, init?: RequestInit) => {
        const authorization = (init?.headers as Record<string, string>)["Authorization"];
        return authorization === `apikey ${FIRST_KEY}` ? rateLimitResponse() : priceResponse("1.12345");
      }),
    );

    const quotes = await loadQuotes(["EURUSD"]);

    expect(quotes["EURUSD"]?.source).toBe("live");
    expect(authHeaders()).toEqual([`apikey ${FIRST_KEY}`, `apikey ${SECOND_KEY}`]);
  });

  it("skips a limited key on later requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: URL, init?: RequestInit) => {
        const authorization = (init?.headers as Record<string, string>)["Authorization"];
        return authorization === `apikey ${FIRST_KEY}` ? rateLimitResponse() : priceResponse("1.12345");
      }),
    );

    await loadQuotes(["EURUSD"]);
    await loadQuotes(["GBPUSD"]);

    expect(authHeaders()).toEqual([`apikey ${FIRST_KEY}`, `apikey ${SECOND_KEY}`, `apikey ${SECOND_KEY}`]);
  });

  it("falls back to a simulated quote when every key is limited", async () => {
    vi.stubEnv("TWELVE_DATA_API_KEYS", FIRST_KEY);
    resetMarketDataCache();
    vi.stubGlobal("fetch", vi.fn(async () => rateLimitResponse()));

    const quotes = await loadQuotes(["EURUSD"]);

    expect(quotes["EURUSD"]?.source).toBe("simulated");
    expect(authHeaders()).toEqual([`apikey ${FIRST_KEY}`]);
  });
});
