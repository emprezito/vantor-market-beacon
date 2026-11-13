import { describe, expect, it } from "vitest";
import { INSTRUMENTS, marketInstruments, registerMarketInstruments } from "@/lib/market";
import {
  CHART_INTERVALS,
  intervalMs,
  isStaleFeedQuote,
  isChartInterval,
  isInstrument,
  mergeQuotes,
  quoteFor,
  syntheticCandles,
  syntheticQuote,
  type MarketQuote,
} from "@/lib/market-data";
import { closePriceFromQuote, openPriceFromQuote } from "@/lib/trading";

describe("market data feed", () => {
  it("registers the Meridian catalogue alongside built-in fallback instruments", () => {
    expect(INSTRUMENTS).toHaveLength(21);
    registerMarketInstruments([
      {
        symbol: "EURUSD",
        providerSymbol: "EURUSDm",
        name: "Euro vs US Dollar",
        base: 1,
        vol: 0,
        digits: 5,
        spread: 0,
        contract: 100_000,
        quoteIsUsd: true,
        synthetic: false,
      },
      {
        symbol: "USDZAR",
        providerSymbol: "USDZAR",
        name: "US Dollar vs Rand",
        base: 1,
        vol: 0,
        digits: 5,
        spread: 0,
        contract: 100_000,
        quoteIsUsd: false,
        synthetic: false,
      },
    ]);
    expect(marketInstruments().some((instrument) => instrument.symbol === "USDZAR")).toBe(true);
    expect(isInstrument("USDZAR")).toBe(true);
    expect(isInstrument("GER40")).toBe(true);
    expect(isInstrument("UNKNOWN")).toBe(false);
    registerMarketInstruments([]);
  });

  it("marks old Meridian quotes stale after five seconds", () => {
    const now = Date.now();
    expect(
      isStaleFeedQuote({
        symbol: "EURUSD",
        bid: 1.1,
        ask: 1.2,
        mid: 1.15,
        ts: now - 5_001,
        source: "live",
        feed: "meridian",
      }),
    ).toBe(true);
  });

  it("falls back to a simulated quote when a symbol is missing", () => {
    const fallback = quoteFor({}, "EURUSD", 1_700_000_000_000);
    expect(fallback.source).toBe("simulated");
    expect(fallback.mid).toBe(syntheticQuote("EURUSD", 1_700_000_000_000).mid);
  });

  it("merges account and live quote maps with the live map winning", () => {
    const base: MarketQuote = {
      symbol: "EURUSD",
      bid: 1.1,
      ask: 1.1002,
      mid: 1.1001,
      ts: 1,
      source: "cached",
    };
    const live: MarketQuote = {
      symbol: "EURUSD",
      bid: 1.2,
      ask: 1.2002,
      mid: 1.2001,
      ts: 2,
      source: "live",
    };
    const merged = mergeQuotes({ EURUSD: base }, { EURUSD: live });
    expect(merged["EURUSD"]).toEqual(live);
  });

  it("builds aligned ascending synthetic candles", () => {
    const now = 1_700_000_123_000;
    const candles = syntheticCandles("EURUSD", "5min", 20, now);
    expect(candles).toHaveLength(20);
    expect(candles[19]!.time * 1000).toBeLessThanOrEqual(now);
    for (let index = 0; index < candles.length; index++) {
      const candle = candles[index]!;
      expect(candle.time % (intervalMs("5min") / 1000)).toBe(0);
      expect(candle.high).toBeGreaterThanOrEqual(candle.open);
      expect(candle.high).toBeGreaterThanOrEqual(candle.close);
      expect(candle.low).toBeLessThanOrEqual(candle.open);
      expect(candle.low).toBeLessThanOrEqual(candle.close);
      expect(candle.volume).toBeGreaterThan(0);
      if (index > 0) expect(candle.time).toBeGreaterThan(candles[index - 1]!.time);
    }
  });

  it("validates chart intervals and exposes all supported intervals", () => {
    expect(CHART_INTERVALS.map((item) => item.value)).toEqual([
      "1min",
      "5min",
      "15min",
      "30min",
      "1h",
      "4h",
      "1day",
      "1week",
      "1month",
    ]);
    expect(isChartInterval("5min")).toBe(true);
    expect(isChartInterval("4h")).toBe(true);
    expect(isChartInterval("1day")).toBe(true);
    expect(isChartInterval("2h")).toBe(false);
    expect(intervalMs("1h")).toBe(3_600_000);
    expect(intervalMs("1day")).toBe(86_400_000);
  });

  it("prices entries at the ask for buys and closes at the bid", () => {
    const quote = { bid: 1.1, ask: 1.2 };
    expect(openPriceFromQuote("buy", quote)).toBe(1.2);
    expect(closePriceFromQuote("buy", quote)).toBe(1.1);
    expect(openPriceFromQuote("sell", quote)).toBe(1.1);
    expect(closePriceFromQuote("sell", quote)).toBe(1.2);
  });
});
