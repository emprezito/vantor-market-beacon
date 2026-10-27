import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { snapshot, type TradingAccount } from "@/lib/trading-service.server";

const account: TradingAccount = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "44444444-4444-4444-8444-444444444444",
  server_id: "22222222-2222-4222-8222-222222222222",
  login: 12345678,
  nickname: "Test",
  label: "Standard",
  server: "Demo",
  currency: "USD",
  leverage: 100,
  access_role: "trader",
  status: "active",
  balance: 100,
  session_epoch: 0,
};

function fakeDb(
  accountRow: Record<string, unknown> | null,
  positions: Record<string, unknown>[] = [],
) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: async () => ({ data: positions, error: null }),
    maybeSingle: async () => ({ data: accountRow, error: null }),
  };
  return { from: () => chain } as unknown as SupabaseClient<Database>;
}

describe("trading service snapshot", () => {
  it("re-reads the account balance so mutations see fresh funds", async () => {
    const state = await snapshot(
      fakeDb({ balance: 150, status: "active", access_role: "trader", leverage: 200 }),
      account,
    );
    expect(state.balance).toBe(150);
    expect(state.account.balance).toBe(150);
    expect(state.account.leverage).toBe(200);
  });

  it("rejects an account that no longer exists", async () => {
    await expect(snapshot(fakeDb(null), account)).rejects.toThrow("Trading account not found");
  });
});
