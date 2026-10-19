import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { calcMargin, calcPnl, closePrice, openPrice, stopHit, type Side } from "./trading";
import { validateOrder, validateFunds } from "./trading-validation";

const r2 = (n: number) => Math.round(n * 100) / 100;
async function snapshot(db: SupabaseClient<Database>, userId: string) {
  const [wallet, positions] = await Promise.all([
    db.from("wallets").select("balance").eq("user_id", userId).single(),
    db.from("positions").select("*").eq("user_id", userId).is("closed_at", null).order("id"),
  ]);
  if (wallet.error || positions.error || !wallet.data) throw new Error("Could not load your demo account. Please try again.");
  return { balance: Number(wallet.data.balance), positions: positions.data ?? [] };
}
function exposure(state: Awaited<ReturnType<typeof snapshot>>, now: number) {
  return state.positions.reduce((result, p) => ({
    used: result.used + calcMargin(p.symbol, Number(p.lots), Number(p.open_price)),
    floating: result.floating + calcPnl(p.symbol, p.side as Side, Number(p.lots), Number(p.open_price), closePrice(p.symbol, p.side as Side, now)),
  }), { used: 0, floating: 0 });
}
// Called only after requireSupabaseAuth and owner-scoped reads; the RPC commits
// wallet and position changes together and rejects stale concurrent snapshots.
async function apply(userId: string, state: Awaited<ReturnType<typeof snapshot>>, action: string, payload: Json) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.rpc("apply_demo_operation", {
    p_user: userId, p_action: action, p_expected_balance: state.balance,
    p_expected_positions: state.positions.map((p) => p.id), p_payload: payload,
  });
  if (error) throw new Error(error.message);
}
async function closeOne(db: SupabaseClient<Database>, userId: string, id: string, reason: string) {
  const state = await snapshot(db, userId);
  const pos = state.positions.find((p) => p.id === id);
  if (!pos) throw new Error("Position not found");
  const price = closePrice(pos.symbol, pos.side as Side, Date.now());
  const pnl = r2(calcPnl(pos.symbol, pos.side as Side, Number(pos.lots), Number(pos.open_price), price));
  await apply(userId, state, "close", { id, price, pnl, reason });
}

export const getAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const initial = await snapshot(supabase, userId);
    const now = Date.now();
    for (const p of initial.positions) {
      const hit = stopHit(p.side as Side, closePrice(p.symbol, p.side as Side, now), p.stop_loss == null ? null : Number(p.stop_loss), p.take_profit == null ? null : Number(p.take_profit));
      if (hit) await closeOne(supabase, userId, p.id, hit === "sl" ? "Stop loss" : "Take profit");
    }
    const [state, closed, tx] = await Promise.all([
      snapshot(supabase, userId),
      supabase.from("positions").select("*").eq("user_id", userId).not("closed_at", "is", null).order("closed_at", { ascending: false }).limit(100),
      supabase.from("transactions").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(100),
    ]);
    if (closed.error || tx.error) throw new Error("Could not load account activity. Please try again.");
    return { balance: state.balance, open: state.positions, closed: closed.data ?? [], transactions: tx.data ?? [] };
  });

export const openTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validateOrder)
  .handler(async ({ data, context }) => {
    const now = Date.now();
    const price = openPrice(data.symbol, data.side, now);
    const exitPrice = closePrice(data.symbol, data.side, now);
    if (data.stopLoss != null && stopHit(data.side, exitPrice, data.stopLoss, null)) throw new Error("Stop loss is on the wrong side of the price");
    if (data.takeProfit != null && stopHit(data.side, exitPrice, null, data.takeProfit)) throw new Error("Take profit is on the wrong side of the price");
    const state = await snapshot(context.supabase, context.userId);
    const { used, floating } = exposure(state, now);
    const margin = calcMargin(data.symbol, data.lots, price);
    if (margin > state.balance + floating - used) throw new Error("Not enough free margin");
    await apply(context.userId, state, "open", { ...data, price, margin, used, floating });
    return { price };
  });

export const closeTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => {
    if (typeof i.id !== "string" || !/^[0-9a-f-]{36}$/i.test(i.id)) throw new Error("Invalid position");
    return i;
  })
  .handler(async ({ data, context }) => {
    await closeOne(context.supabase, context.userId, data.id, "Manual");
    return { ok: true };
  });

export const moveFunds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validateFunds)
  .handler(async ({ data, context }) => {
    const state = await snapshot(context.supabase, context.userId);
    const { used, floating } = exposure(state, Date.now());
    if (data.kind === "withdraw" && data.amount > Math.min(state.balance, state.balance + floating - used)) throw new Error("You can't withdraw money used as margin or more than your available funds");
    await apply(context.userId, state, data.kind, { amount: data.amount, used, floating });
    return { balance: r2(state.balance + (data.kind === "deposit" ? data.amount : -data.amount)) };
  });
