import { describe, expect, it } from "vitest";
import { calcMargin, calcPnl, limitHit, stopHit } from "@/lib/trading";

describe("trading rules", () => {
  it("buy 1 lot EURUSD +10 pips = $100", () => {
    expect(calcPnl("EURUSD", "buy", 1, 1.1, 1.101)).toBeCloseTo(100);
  });
  it("sell profits when price falls", () => {
    expect(calcPnl("XAUUSD", "sell", 1, 2400, 2390)).toBeCloseTo(1000);
  });
  it("margin uses 1:100 leverage by default", () => {
    expect(calcMargin("EURUSD", 1, 1.1)).toBeCloseTo(1100);
  });
  it("margin scales with the account leverage", () => {
    expect(calcMargin("EURUSD", 1, 1.1, 50)).toBeCloseTo(2200);
    expect(calcMargin("EURUSD", 1, 1.1, 2000)).toBeCloseTo(55);
  });
  it("converts cross-pair P/L to USD", () => {
    expect(calcPnl("EURGBP", "buy", 1, 0.85, 0.851)).toBeCloseTo(127);
  });
  it("converts USD-base P/L using the closing price", () => {
    expect(calcPnl("USDJPY", "buy", 1, 151.2, 151.3)).toBeCloseTo(10000 / 151.3);
  });
  it("uses USD notional for cross-pair and non-USD index margin", () => {
    expect(calcMargin("EURGBP", 1, 0.85, 100)).toBeCloseTo(1080);
    expect(calcMargin("GER40", 1, 18150, 100)).toBeCloseTo(196.02);
  });
  it("fills buy limits at or below the ask and sell limits at or above the bid", () => {
    expect(limitHit("buy", { bid: 1.099, ask: 1.1 }, 1.1)).toBe(true);
    expect(limitHit("buy", { bid: 1.101, ask: 1.102 }, 1.1)).toBe(false);
    expect(limitHit("sell", { bid: 1.1, ask: 1.101 }, 1.1)).toBe(true);
    expect(limitHit("sell", { bid: 1.099, ask: 1.1 }, 1.1)).toBe(false);
  });
  it("stop loss triggers for buy", () => {
    expect(stopHit("buy", 1.09, 1.095, null)).toBe("sl");
    expect(stopHit("sell", 1.09, null, 1.095)).toBe("tp");
    expect(stopHit("buy", 1.1, 1.09, 1.2)).toBeNull();
  });
});
