import { describe, expect, it } from "vitest";
import { mergeLiveBar } from "@/lib/chart-candles";
import type { MarketCandle, MarketQuote } from "@/lib/market-data";

const now = Date.UTC(2026, 0, 5, 12, 9, 30);

function candle(overrides: Partial<MarketCandle> = {}): MarketCandle {
  return {
    time: Date.UTC(2026, 0, 5, 12, 5) / 1000,
    open: 1.1,
    high: 1.105,
    low: 1.099,
    close: 1.101,
    volume: 42,
    ...overrides,
  };
}

function quote(overrides: Partial<MarketQuote> = {}): MarketQuote {
  return {
    symbol: "EURUSD",
    bid: 1.103,
    ask: 1.104,
    mid: 1.1035,
    ts: now,
    source: "live",
    feed: "meridian",
    ...overrides,
  };
}

describe("mergeLiveBar", () => {
  it("updates the forming bar from bid prices to match bid candles", () => {
    const candles = [candle()];
    const next = mergeLiveBar(candles, quote(), "5min", now);

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      open: 1.1,
      high: 1.105,
      low: 1.099,
      close: 1.103,
      volume: 42,
    });
  });

  it("opens a new bucket at the provider alignment and resets volume", () => {
    const candles = [candle()];
    const next = mergeLiveBar(candles, quote({ ts: Date.UTC(2026, 0, 5, 12, 11) }), "5min", now);

    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({
      time: Date.UTC(2026, 0, 5, 12, 10) / 1000,
      open: 1.101,
      high: 1.103,
      low: 1.101,
      close: 1.103,
      volume: 0,
    });
  });

  it("keeps daily candles aligned to the provider session open", () => {
    const candles = [
      candle({
        time: Date.UTC(2026, 0, 2, 21) / 1000,
        close: 1.101,
        volume: 100,
      }),
    ];
    const next = mergeLiveBar(
      candles,
      quote({ ts: Date.UTC(2026, 0, 3, 22), bid: 1.104 }),
      "1day",
      Date.UTC(2026, 0, 3, 22),
    );

    expect(next[1]?.time).toBe(Date.UTC(2026, 0, 3, 21) / 1000);
  });

  it("keeps four-hour candles aligned to the provider offset", () => {
    const candles = [
      candle({
        time: Date.UTC(2026, 0, 5, 1) / 1000,
        close: 1.101,
      }),
    ];
    const next = mergeLiveBar(
      candles,
      quote({ ts: Date.UTC(2026, 0, 5, 5, 30), bid: 1.104 }),
      "4h",
      Date.UTC(2026, 0, 5, 5, 30),
    );

    expect(next[1]?.time).toBe(Date.UTC(2026, 0, 5, 5) / 1000);
  });

  it("moves to the next calendar month for monthly candles", () => {
    const candles = [
      candle({
        time: Date.UTC(2026, 1, 1) / 1000,
        close: 1.101,
      }),
    ];
    const next = mergeLiveBar(
      candles,
      quote({ ts: Date.UTC(2026, 2, 20, 12), bid: 1.104 }),
      "1month",
      Date.UTC(2026, 2, 20, 12),
    );

    expect(next[1]?.time).toBe(Date.UTC(2026, 2, 1) / 1000);
  });

  it("ignores stale, fallback, and older quotes", () => {
    const candles = [candle()];

    expect(mergeLiveBar(candles, quote({ ts: now - 6_000 }), "5min", now)).toBe(candles);
    expect(mergeLiveBar(candles, quote({ feedFallback: true }), "5min", now)).toBe(candles);
    expect(mergeLiveBar(candles, quote({ ts: Date.UTC(2026, 0, 5, 12, 4) }), "5min", now)).toBe(
      candles,
    );
  });

  it("leaves synthetic candles without volume unmodified", () => {
    const candles: MarketCandle[] = [
      {
        time: Date.UTC(2026, 0, 5, 12, 5) / 1000,
        open: 1.1,
        high: 1.105,
        low: 1.099,
        close: 1.101,
      },
    ];
    const next = mergeLiveBar(candles, quote({ ts: Date.UTC(2026, 0, 5, 12, 11) }), "5min", now);

    expect(next[1]).not.toHaveProperty("volume");
  });

  it("ignores quotes with no bid", () => {
    const candles = [candle()];
    expect(mergeLiveBar(candles, quote({ bid: 0 }), "5min", now)).toBe(candles);
  });
});
