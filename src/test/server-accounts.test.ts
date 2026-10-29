import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import { verifyPassword } from "@/lib/password.server";
import { genLogin, genPassword, insertAccount } from "@/lib/server-accounts.server";

const fields = {
  user_id: "00000000-0000-0000-0000-000000000001",
  access_role: "trader" as const,
  nickname: "Main account",
  label: "Standard",
  balance: 10000,
  currency: "USD",
  leverage: 100,
  server: "Vantor Server 1",
  server_id: "00000000-0000-0000-0000-000000000002",
};

function fakeAdmin(inserted: Record<string, unknown>[]) {
  return {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return {
          select: () => ({
            single: async () => ({
              data: {
                id: "00000000-0000-0000-0000-000000000003",
                login: 12345678,
                nickname: fields.nickname,
                label: fields.label,
                server: fields.server,
                server_id: fields.server_id,
                balance: fields.balance,
                currency: fields.currency,
                leverage: fields.leverage,
              },
              error: null,
            }),
          }),
        };
      },
    }),
  } as unknown as SupabaseClient<Database>;
}

describe("server account generation", () => {
  it("generates eight-digit logins in the allocated range", () => {
    for (let index = 0; index < 1_000; index += 1) {
      const login = genLogin();
      expect(Number.isInteger(login)).toBe(true);
      expect(login).toBeGreaterThanOrEqual(10_000_000);
      expect(login).toBeLessThanOrEqual(99_999_999);
    }
  });

  it("generates passwords with the requested length", () => {
    const password = genPassword(12);
    expect(password).toHaveLength(12);
    expect(password).toMatch(/^[A-Za-z2-9]+$/);
  });

  it("hashes user supplied passwords and never returns them", async () => {
    const inserted: Record<string, unknown>[] = [];
    const account = await insertAccount(fakeAdmin(inserted), fields, {
      traderPassword: "TraderPass123",
      investorPassword: "InvestorPass123",
    });
    const row = inserted[0]!;

    expect(await verifyPassword("TraderPass123", row["trader_hash"] as string)).toBe(true);
    expect(await verifyPassword("InvestorPass123", row["investor_hash"] as string)).toBe(true);
    expect(row).not.toHaveProperty("traderPassword");
    expect(row).not.toHaveProperty("investorPassword");
    expect(account).not.toHaveProperty("traderPassword");
    expect(account).not.toHaveProperty("investorPassword");
  });

  it("rejects identical user supplied passwords", async () => {
    const inserted: Record<string, unknown>[] = [];
    await expect(
      insertAccount(fakeAdmin(inserted), fields, {
        traderPassword: "SamePass123",
        investorPassword: "SamePass123",
      }),
    ).rejects.toThrow(/different/);
    expect(inserted).toHaveLength(0);
  });
});
