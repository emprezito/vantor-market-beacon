import { describe, expect, it } from "vitest";
import {
  validateNewRealAccount,
  validateNewRealAccountForServer,
  type NewRealAccountInput,
  type TradingServer,
} from "@/lib/account-options";

const input: NewRealAccountInput = {
  nickname: "Live account",
  accountType: "Standard",
  currency: "USD",
  leverage: 100,
  traderPassword: "TraderPass123",
  investorPassword: "InvestorPass123",
};

const server: TradingServer = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  slug: "vantor-live",
  name: "Vantor Live",
  description: "",
  kind: "live",
  status: "active",
  visibility: "public",
  account_types: ["Standard", "Pro"],
  currencies: ["USD", "EUR", "NGN"],
  leverages: [100, 200],
  min_balance: 100,
  max_balance: 1_000_000,
  default_account_type: "Standard",
  default_currency: "USD",
  default_leverage: 100,
  sort_order: 0,
};

describe("real account validation", () => {
  it("validates account fields without a starting balance", () => {
    const account = validateNewRealAccount(input);
    expect(account).toEqual(input);
    expect(account).not.toHaveProperty("balance");
  });

  it("requires the server to offer the selected options", () => {
    expect(validateNewRealAccountForServer(input, server)).toEqual(input);
    expect(() =>
      validateNewRealAccountForServer({ ...input, accountType: "Raw Spread" }, server),
    ).toThrow(/does not offer/);
    expect(() => validateNewRealAccountForServer({ ...input, currency: "GBP" }, server)).toThrow(
      /does not support/,
    );
    expect(() => validateNewRealAccountForServer({ ...input, leverage: 500 }, server)).toThrow(
      /leverage/,
    );
  });

  it("only allows currencies funded by Bachs", () => {
    expect(() => validateNewRealAccountForServer({ ...input, currency: "EUR" }, server)).toThrow(
      /USD and NGN/,
    );
    expect(validateNewRealAccountForServer({ ...input, currency: "NGN" }, server)).toMatchObject({
      currency: "NGN",
    });
  });

  it("rejects invalid account options and passwords", () => {
    expect(() => validateNewRealAccount({ ...input, nickname: "" })).toThrow();
    expect(() => validateNewRealAccount({ ...input, leverage: 3 })).toThrow();
    expect(() =>
      validateNewRealAccount({ ...input, investorPassword: input.traderPassword }),
    ).toThrow(/different/);
  });
});
