import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

vi.mock("@/lib/market-data.server", () => ({
  loadQuotes: vi.fn(async (symbols: string[]) =>
    Object.fromEntries(
      symbols.map((symbol) => [
        symbol,
        { symbol, bid: 1.101, ask: 1.1012, mid: 1.1011, ts: 1, source: "live" },
      ]),
    ),
  ),
}));

vi.mock("@/lib/fx.server", () => ({
  loadFxRate: vi.fn(async () => 1_500),
}));

import { closePosition, snapshot, type TradingAccount } from "@/lib/trading-service.server";

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

describe("trading service FX conversion", () => {
  it("stores realized P/L in the account currency", async () => {
    const position = {
      id: "55555555-5555-4555-8555-555555555555",
      symbol: "EURUSD",
      side: "buy",
      lots: 0.01,
      open_price: 1.1,
      stop_loss: null,
      take_profit: null,
      opened_at: "2026-10-27T00:00:00.000Z",
      closed_at: null,
    };
    let payload: Record<string, unknown> | undefined;
    const admin = {
      rpc: async (_name: string, args: { p_payload: Record<string, unknown> }) => {
        payload = args.p_payload;
        return { data: { balance: 101_500 }, error: null };
      },
    } as unknown as SupabaseClient<Database>;

    const result = await closePosition(
      fakeDb({ balance: 100, status: "active", access_role: "trader", leverage: 100 }, [position]),
      admin,
      { ...account, currency: "NGN" },
      position.id,
    );

    expect(payload?.["pnl"]).toBe(1_500);
    expect(result.pnl).toBe(1_500);
    expect(result.balance).toBe(101_500);
  });
});

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
