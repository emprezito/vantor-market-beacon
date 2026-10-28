import { describe, expect, it } from "vitest";
import {
  computeFeedQuoteStats,
  feedIsStale,
  maxFeedJumpPct,
  quoteIsStale,
  quoteJumpExceeded,
  validateFeedPayload,
  type FeedPayload,
} from "@/lib/market-feed";

const NOW = 1_700_000_000_000;
const BAR_TIME = Math.floor(NOW / 1000) - 60;

function bar(time = BAR_TIME) {
  return { time, open: 1, high: 1.1, low: 0.9, close: 1.05 };
}

function payload(overrides: Partial<FeedPayload> = {}): Record<string, unknown> {
  return {
    feedId: "bridge-1",
    sentAt: NOW,
    serverOffsetMs: 1_800_000,
    quotes: [{ symbol: "EURUSD", bid: 1.1, ask: 1.1002, ts: NOW }],
    candles: [{ symbol: "EURUSD", interval: "1min", snapshot: true, bars: [bar()] }],
    ...overrides,
  };
}

describe("dev feed validation", () => {
  it("accepts a valid quote and candle batch", () => {
    const result = validateFeedPayload(payload(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.quotes[0]?.symbol).toBe("EURUSD");
    expect(result.payload.candles[0]?.snapshot).toBe(true);
    expect(result.payload.serverOffsetMs).toBe(1_800_000);
  });

  it("rejects unknown symbols", () => {
    const result = validateFeedPayload(
      payload({ quotes: [{ symbol: "NOPE", bid: 1, ask: 1.1, ts: NOW }] }),
      NOW,
    );
    expect(result).toEqual({ ok: false, message: "quotes.0.symbol: Unknown market symbol" });
  });

  it("rejects inverted and excessively wide spreads", () => {
    const inverted = validateFeedPayload(
      payload({ quotes: [{ symbol: "EURUSD", bid: 1.2, ask: 1.1, ts: NOW }] }),
      NOW,
    );
    expect(inverted.ok).toBe(false);

    const wide = validateFeedPayload(
      payload({ quotes: [{ symbol: "EURUSD", bid: 1, ask: 1.2, ts: NOW }] }),
      NOW,
    );
    expect(wide).toEqual({ ok: false, message: "EURUSD: spread is too wide" });
  });

  it("rejects future quotes and candles", () => {
    const futureQuote = validateFeedPayload(
      payload({ quotes: [{ symbol: "EURUSD", bid: 1.1, ask: 1.1002, ts: NOW + 10_000 }] }),
      NOW,
    );
    expect(futureQuote).toEqual({ ok: false, message: "EURUSD: timestamp is in the future" });

    const futureBar = validateFeedPayload(
      payload({
        candles: [
          {
            symbol: "EURUSD",
            interval: "1min",
            snapshot: false,
            bars: [bar(Math.floor(NOW / 1000) + 10)],
          },
        ],
      }),
      NOW,
    );
    expect(futureBar.ok).toBe(false);
  });

  it("rejects duplicate quotes and candle series", () => {
    const duplicateQuotes = validateFeedPayload(
      payload({
        quotes: [
          { symbol: "EURUSD", bid: 1.1, ask: 1.1002, ts: NOW },
          { symbol: "EURUSD", bid: 1.1, ask: 1.1002, ts: NOW },
        ],
      }),
      NOW,
    );
    expect(duplicateQuotes).toEqual({ ok: false, message: "Duplicate quote for EURUSD" });

    const duplicateSeries = validateFeedPayload(
      payload({
        candles: [
          { symbol: "EURUSD", interval: "1min", snapshot: false, bars: [bar()] },
          { symbol: "EURUSD", interval: "1min", snapshot: false, bars: [bar(BAR_TIME - 60)] },
        ],
      }),
      NOW,
    );
    expect(duplicateSeries).toEqual({
      ok: false,
      message: "Duplicate candle series for EURUSD:1min",
    });
  });

  it("rejects invalid OHLC and too many bars", () => {
    const invalid = validateFeedPayload(
      payload({
        candles: [
          {
            symbol: "EURUSD",
            interval: "1min",
            snapshot: false,
            bars: [{ time: BAR_TIME, open: 1, high: 0.8, low: 0.9, close: 1.05 }],
          },
        ],
      }),
      NOW,
    );
    expect(invalid.ok).toBe(false);

    const symbols = ["EURUSD", "GBPUSD", "USDJPY", "USDCAD"];
    const tooMany = validateFeedPayload(
      payload({
        candles: symbols.map((symbol) => ({
          symbol,
          interval: "1min",
          snapshot: false,
          bars: Array.from({ length: 1_300 }, (_, index) => bar(BAR_TIME - index * 60)),
        })),
      }),
      NOW,
    );
    expect(tooMany).toEqual({ ok: false, message: "Too many candles in one request" });
  });
});

describe("dev feed helpers", () => {
  it("guards against sudden jumps unless the gap is old", () => {
    const last = { mid: 1, ts: NOW - 1_000 };
    expect(quoteJumpExceeded({ mid: 1.1, ts: NOW }, last, NOW, 0.05)).toBe(true);
    expect(quoteJumpExceeded({ mid: 1.1, ts: NOW }, last, NOW, 0.2)).toBe(false);
    expect(quoteJumpExceeded({ mid: 1.1, ts: NOW }, { mid: 1, ts: NOW - 61_000 }, NOW, 0.05)).toBe(
      false,
    );
  });

  it("uses wider jump limits for volatile instruments", () => {
    expect(maxFeedJumpPct("BTCUSD")).toBeGreaterThan(maxFeedJumpPct("EURUSD"));
    expect(maxFeedJumpPct("XAUUSD")).toBeGreaterThan(maxFeedJumpPct("EURUSD"));
    expect(maxFeedJumpPct("NAS100")).toBeGreaterThan(maxFeedJumpPct("EURUSD"));
  });

  it("derives daily change, high and low from the daily bar", () => {
    const first = computeFeedQuoteStats(1.1, { open: 1, high: 1.2, low: 0.9 });
    expect(first.change).toBeCloseTo(0.1);
    expect(first.high).toBe(1.2);
    expect(first.low).toBe(0.9);

    const second = computeFeedQuoteStats(1.3, { open: 1, high: 1.2, low: 0.9 });
    expect(second.change).toBeCloseTo(0.3);
    expect(second.high).toBe(1.3);
    expect(second.low).toBe(0.9);

    expect(computeFeedQuoteStats(1.1, undefined)).toEqual({});
  });

  it("marks missing, old and closed quotes as stale", () => {
    expect(feedIsStale(null, NOW)).toBe(true);
    expect(feedIsStale(NOW - 11_000, NOW)).toBe(true);
    expect(feedIsStale(NOW - 1_000, NOW)).toBe(false);
    expect(quoteIsStale(NOW, false, NOW, NOW)).toBe(true);
    expect(quoteIsStale(NOW - 11_000, true, NOW, NOW)).toBe(true);
    expect(quoteIsStale(NOW, true, NOW, NOW)).toBe(false);
  });
});
