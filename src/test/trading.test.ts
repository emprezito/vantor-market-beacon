import { describe, expect, it } from "vitest";
import { calcMargin, calcPnl, stopHit } from "@/lib/trading";

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
  it("stop loss triggers for buy", () => {
    expect(stopHit("buy", 1.09, 1.095, null)).toBe("sl");
    expect(stopHit("sell", 1.09, null, 1.095)).toBe("tp");
    expect(stopHit("buy", 1.1, 1.09, 1.2)).toBeNull();
  });
});
