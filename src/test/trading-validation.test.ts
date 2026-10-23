import { describe, expect, it } from "vitest";
import { validateOrder, validateFunds, validateLimitOrder } from "@/lib/trading-validation";

const order = { symbol: "EURUSD", side: "buy" as const, lots: 0.1, stopLoss: null, takeProfit: null };
describe("input safeguards", () => {
  it("accepts the existing lot limits, rejects invalid quantities", () => {
    expect(validateOrder({ ...order, lots: 0.01 }).lots).toBe(0.01);
    expect(validateOrder({ ...order, lots: 100 }).lots).toBe(100);
    for (const lots of [0, 100.01, 0.015, NaN, Infinity]) expect(() => validateOrder({ ...order, lots })).toThrow();
  });
  it("rejects non-finite and nonpositive stop prices", () => {
    for (const price of [NaN, Infinity, -1, 0]) {
      expect(() => validateOrder({ ...order, stopLoss: price })).toThrow();
      expect(() => validateOrder({ ...order, takeProfit: price })).toThrow();
    }
  });
  it("requires a positive, finite limit price and keeps order checks", () => {
    expect(validateLimitOrder({ ...order, limitPrice: 1.05 }).limitPrice).toBe(1.05);
    for (const limitPrice of [NaN, Infinity, -1, 0]) expect(() => validateLimitOrder({ ...order, limitPrice })).toThrow();
    expect(() => validateLimitOrder({ ...order, limitPrice: 1.05, lots: 0 })).toThrow();
  });
  it("enforces the displayed $1 to $1,000,000 range and cent precision", () => {
    expect(validateFunds({ kind: "deposit", amount: 1 }).amount).toBe(1);
    expect(validateFunds({ kind: "withdraw", amount: 1000000 }).amount).toBe(1000000);
    for (const amount of [0.5, 1000001, 1.001, NaN, Infinity]) expect(() => validateFunds({ kind: "deposit", amount })).toThrow();
  });
});