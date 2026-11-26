import { describe, expect, it } from "vitest";
import {
  DEPOSIT_MAX,
  depositMinimum,
  depositStatusLabel,
  supportsRealDeposits,
  validateDepositAmount,
} from "@/lib/real-deposits";

describe("real deposit amounts", () => {
  it("supports only USD and NGN", () => {
    expect(supportsRealDeposits("USD")).toBe(true);
    expect(supportsRealDeposits("NGN")).toBe(true);
    for (const currency of ["EUR", "GBP", "", "usd", "XYZ"]) {
      expect(supportsRealDeposits(currency)).toBe(false);
    }
  });

  it("uses currency-specific minimums", () => {
    expect(depositMinimum("USD")).toBe(1);
    expect(depositMinimum("NGN")).toBe(100);
    expect(depositMinimum("EUR")).toBe(1);
  });

  it("accepts amounts with at most two decimals", () => {
    expect(validateDepositAmount(1, "USD")).toBe(1);
    expect(validateDepositAmount(250.5, "USD")).toBe(250.5);
    expect(validateDepositAmount(100, "NGN")).toBe(100);
    expect(validateDepositAmount(DEPOSIT_MAX, "NGN")).toBe(DEPOSIT_MAX);
  });

  it("rejects unsupported currencies and invalid amounts", () => {
    expect(() => validateDepositAmount(10, "EUR")).toThrow(/USD and NGN/);
    for (const amount of [0, 0.99, 99.99, 100.001, DEPOSIT_MAX + 1, NaN, Infinity]) {
      expect(() => validateDepositAmount(amount, "NGN")).toThrow();
    }
    for (const amount of [0, 0.5, 0.001, DEPOSIT_MAX + 1, NaN, Infinity]) {
      expect(() => validateDepositAmount(amount, "USD")).toThrow();
    }
  });

  it("labels deposit statuses", () => {
    expect(depositStatusLabel("pending")).toBe("Pending");
    expect(depositStatusLabel("succeeded")).toBe("Paid");
    expect(depositStatusLabel("failed")).toBe("Failed");
    expect(depositStatusLabel("expired")).toBe("Expired");
  });
});
