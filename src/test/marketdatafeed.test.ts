import { describe, expect, it } from "vitest";
import {
  MARKETDATA_STALE_MS,
  MARKETDATA_SYMBOLS,
  MARKETDATA_WS_URL,
  isMarketDatafeedSymbol,
  marketDatafeedQuote,
  marketDatafeedTerminalSymbol,
  marketDatafeedVpsSymbol,
  parseMarketDatafeedTick,
} from "@/lib/marketdatafeed";

const NOW = 1_800_000_000_000;

function tick(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "XAUUSDM",
    bid: 2400.1,
    ask: 2400.4,
    timestamp_ms: NOW - 500,
    ...overrides,
  };
}

describe("MarketDatafeed symbols", () => {
  it("maps only the supported VPS symbol", () => {
    expect(MARKETDATA_WS_URL).toBe("wss://data.fundedng.fun/ws/v1/market");
    expect(MARKETDATA_STALE_MS).toBe(15_000);
    expect(MARKETDATA_SYMBOLS).toEqual({ XAUUSD: "XAUUSDM" });
    expect(isMarketDatafeedSymbol("XAUUSD")).toBe(true);
    expect(isMarketDatafeedSymbol("BTCUSD")).toBe(false);
    expect(marketDatafeedVpsSymbol("XAUUSD")).toBe("XAUUSDM");
    expect(marketDatafeedVpsSymbol("BTCUSD")).toBeNull();
    expect(marketDatafeedTerminalSymbol("XAUUSDM")).toBe("XAUUSD");
    expect(marketDatafeedTerminalSymbol("BTCUSDM")).toBeNull();
  });

  it("accepts a valid XAUUSDM tick", () => {
    const parsed = parseMarketDatafeedTick(tick(), NOW);

    expect(parsed).toEqual({
      terminalSymbol: "XAUUSD",
      vpsSymbol: "XAUUSDM",
      bid: 2400.1,
      ask: 2400.4,
      ts: NOW - 500,
    });
  });

  it("builds a live quote with the real bid, ask, and timestamp", () => {
    const parsed = parseMarketDatafeedTick(tick(), NOW);
    expect(parsed).not.toBeNull();

    const quote = marketDatafeedQuote(parsed!);
    expect(quote.symbol).toBe("XAUUSD");
    expect(quote.bid).toBe(2400.1);
    expect(quote.ask).toBe(2400.4);
    expect(quote.mid).toBeCloseTo(2400.25);
    expect(quote.ts).toBe(NOW - 500);
    expect(quote.source).toBe("live");
    expect(quote.feed).toBe("marketdatafeed");
    expect(quote.feedFallback).toBeUndefined();
  });

  it("rejects unsupported symbols, invalid prices, and invalid timestamps", () => {
    expect(parseMarketDatafeedTick(tick({ symbol: "BTCUSDM" }), NOW)).toBeNull();
    expect(parseMarketDatafeedTick(tick({ symbol: "XAUUSD" }), NOW)).toBeNull();
    expect(parseMarketDatafeedTick(tick({ bid: 0 }), NOW)).toBeNull();
    expect(parseMarketDatafeedTick(tick({ ask: 0 }), NOW)).toBeNull();
    expect(parseMarketDatafeedTick(tick({ bid: "2400" }), NOW)).toBeNull();
    expect(parseMarketDatafeedTick(tick({ bid: 2400.5, ask: 2400.1 }), NOW)).toBeNull();
    expect(parseMarketDatafeedTick(tick({ timestamp_ms: 0 }), NOW)).toBeNull();
    expect(parseMarketDatafeedTick(tick({ timestamp_ms: 1.5 }), NOW)).toBeNull();
    expect(parseMarketDatafeedTick(tick({ timestamp_ms: NOW + 60_001 }), NOW)).toBeNull();
    expect(parseMarketDatafeedTick(tick({ timestamp_ms: NOW - 15_001 }), NOW)).toBeNull();
    expect(parseMarketDatafeedTick(tick({ timestamp_ms: "1800000000000" }), NOW)).toBeNull();
    expect(parseMarketDatafeedTick(null, NOW)).toBeNull();
    expect(parseMarketDatafeedTick("tick", NOW)).toBeNull();
  });
});
