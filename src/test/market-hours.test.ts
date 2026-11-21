import { afterEach, describe, expect, it } from "vitest";
import { registerMarketInstruments } from "@/lib/market";
import { forexMarketIsOpen, marketOpenForInstrument } from "@/lib/market-hours";

afterEach(() => registerMarketInstruments([]));

describe("market trading hours", () => {
  it("tracks the DST-aware Forex weekend in New York time", () => {
    expect(forexMarketIsOpen(Date.parse("2026-11-20T21:59:00Z"))).toBe(true);
    expect(forexMarketIsOpen(Date.parse("2026-11-20T22:01:00Z"))).toBe(false);
    expect(forexMarketIsOpen(Date.parse("2026-11-21T12:00:00Z"))).toBe(false);
    expect(forexMarketIsOpen(Date.parse("2026-11-22T21:59:00Z"))).toBe(false);
    expect(forexMarketIsOpen(Date.parse("2026-11-22T22:01:00Z"))).toBe(true);
  });

  it("classifies catalogued Forex and crypto instruments", () => {
    registerMarketInstruments([
      {
        symbol: "EURUSD",
        name: "Euro / US Dollar",
        base: 1,
        vol: 0,
        digits: 5,
        spread: 0.0001,
        contract: 100_000,
        quoteIsUsd: true,
        assetClass: "forex",
      },
      {
        symbol: "BTCUSD",
        name: "Bitcoin / US Dollar",
        base: 1,
        vol: 0,
        digits: 2,
        spread: 1,
        contract: 1,
        quoteIsUsd: true,
        assetClass: "crypto",
      },
    ]);

    const saturday = Date.parse("2026-11-21T12:00:00Z");
    expect(marketOpenForInstrument("EURUSD", saturday)).toBe(false);
    expect(marketOpenForInstrument("BTCUSD", saturday)).toBe(true);
  });
});
