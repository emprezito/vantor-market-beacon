import { describe, expect, it } from "vitest";
import {
  defaultsForServer,
  validateNewAccountForServer,
  type TradingServer,
} from "@/lib/account-options";

const server: TradingServer = {
  id: "00000000-0000-0000-0000-000000000001",
  slug: "vantor-1",
  name: "Vantor Server 1",
  description: "",
  kind: "vantor",
  status: "active",
  visibility: "public",
  account_types: ["Standard", "Pro"],
  currencies: ["USD", "EUR"],
  leverages: [10, 100, 500],
  min_balance: 500,
  max_balance: 50000,
  default_account_type: "Pro",
  default_currency: "EUR",
  default_leverage: 500,
  sort_order: 0,
};

const input = {
  nickname: "Main account",
  accountType: "Standard",
  currency: "USD",
  leverage: 100,
  balance: 10000,
  traderPassword: "TraderPass123",
  investorPassword: "InvestorPass123",
};

describe("trading server options", () => {
  it("uses the server defaults", () => {
    expect(defaultsForServer(server)).toEqual({
      accountType: "Pro",
      currency: "EUR",
      leverage: 500,
      balance: 10000,
    });
  });

  it("clamps the default balance into the server range", () => {
    expect(defaultsForServer({ ...server, min_balance: 20000, max_balance: 30000 }).balance).toBe(
      20000,
    );
    expect(defaultsForServer({ ...server, min_balance: 100, max_balance: 5000 }).balance).toBe(
      5000,
    );
  });

  it("falls back to supported defaults when the configured default is unavailable", () => {
    expect(
      defaultsForServer({
        ...server,
        default_account_type: "Raw Spread",
        default_currency: "GBP",
        default_leverage: 2000,
      }),
    ).toEqual({ accountType: "Standard", currency: "USD", leverage: 100, balance: 10000 });
  });

  it("accepts options supported by the server", () => {
    expect(validateNewAccountForServer(input, server)).toEqual(input);
    expect(
      validateNewAccountForServer(
        { ...input, accountType: "Pro", currency: "EUR", leverage: 500, balance: 50000 },
        server,
      ),
    ).toBeTruthy();
  });

  it("rejects options the server does not offer", () => {
    expect(() =>
      validateNewAccountForServer({ ...input, accountType: "Raw Spread" }, server),
    ).toThrow(/does not offer Raw Spread/);
    expect(() => validateNewAccountForServer({ ...input, currency: "GBP" }, server)).toThrow(
      /does not support GBP/,
    );
    expect(() => validateNewAccountForServer({ ...input, leverage: 50 }, server)).toThrow(
      /does not support 1:50/,
    );
    expect(() => validateNewAccountForServer({ ...input, balance: 100 }, server)).toThrow(
      /Starting balance/,
    );
    expect(() => validateNewAccountForServer({ ...input, balance: 60000 }, server)).toThrow(
      /Starting balance/,
    );
  });
});
