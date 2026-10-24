import { describe, expect, it } from "vitest";
import { REALTIME_SYMBOLS, isRealtimeSymbol } from "@/lib/realtime-symbols";

describe("realtime symbols", () => {
  it("maps the supported client symbols to provider symbols", () => {
    expect(REALTIME_SYMBOLS).toEqual({
      XAUUSD: "XAU/USD",
      BTCUSD: "BTC/USD",
    });
  });

  it("accepts supported symbols and rejects the rest", () => {
    expect(isRealtimeSymbol("XAUUSD")).toBe(true);
    expect(isRealtimeSymbol("BTCUSD")).toBe(true);
    expect(isRealtimeSymbol("EURUSD")).toBe(false);
    expect(isRealtimeSymbol("XAGUSD")).toBe(false);
  });
});
