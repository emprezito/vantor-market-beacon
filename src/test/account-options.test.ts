import { describe, expect, it } from "vitest";
import { validateNewAccount } from "@/lib/account-options";

const input = { nickname: "Main account", accountType: "Standard", currency: "USD", leverage: 100, balance: 10000 };

describe("new account parameters", () => {
  it("accepts the supported choices", () => {
    expect(validateNewAccount(input)).toEqual(input);
    expect(validateNewAccount({ ...input, accountType: "Raw Spread", currency: "NGN", leverage: 2000, balance: 250 }).balance).toBe(250);
  });
  it("requires a 1–24 character nickname and trims it", () => {
    for (const nickname of ["", "   ", "x".repeat(25), null, 42]) expect(() => validateNewAccount({ ...input, nickname: nickname as string })).toThrow();
    expect(validateNewAccount({ ...input, nickname: "  Scalping account  " }).nickname).toBe("Scalping account");
  });
  it("rejects unknown options and out-of-range balances", () => {
    for (const accountType of ["", "Cent", "standard"]) expect(() => validateNewAccount({ ...input, accountType })).toThrow();
    for (const currency of ["", "XYZ", "usd"]) expect(() => validateNewAccount({ ...input, currency })).toThrow();
    for (const leverage of [0, 3, 3000, NaN]) expect(() => validateNewAccount({ ...input, leverage })).toThrow();
    for (const balance of [0, 99.99, 1000001, 100.005, NaN, Infinity]) expect(() => validateNewAccount({ ...input, balance })).toThrow();
  });
});
