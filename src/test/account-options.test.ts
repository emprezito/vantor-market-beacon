import { describe, expect, it } from "vitest";
import { validateNewAccount } from "@/lib/account-options";

const input = { accountType: "Standard", currency: "USD", leverage: 100, balance: 10000, password: "sufficient-pass" };

describe("new demo account parameters", () => {
  it("accepts the supported choices", () => {
    expect(validateNewAccount(input)).toEqual(input);
    expect(validateNewAccount({ ...input, accountType: "Raw Spread", currency: "NGN", leverage: 2000, balance: 250 }).balance).toBe(250);
  });
  it("rejects unknown options and out-of-range balances", () => {
    for (const accountType of ["", "Cent", "standard"]) expect(() => validateNewAccount({ ...input, accountType })).toThrow();
    for (const currency of ["", "XYZ", "usd"]) expect(() => validateNewAccount({ ...input, currency })).toThrow();
    for (const leverage of [0, 3, 3000, NaN]) expect(() => validateNewAccount({ ...input, leverage })).toThrow();
    for (const balance of [0, 99.99, 1000001, 100.005, NaN, Infinity]) expect(() => validateNewAccount({ ...input, balance })).toThrow();
  });
  it("requires a real password", () => {
    for (const password of ["", "short", "x".repeat(65), 12345678]) expect(() => validateNewAccount({ ...input, password: password as string })).toThrow();
  });
});
