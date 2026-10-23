import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { calcMargin, calcPnl, closePrice, limitHit, openPrice, stopHit, type Side } from "./trading";
import { validateOrder, validateFunds, validateLimitOrder, type LimitOrderInput } from "./trading-validation";
import { quote } from "./market";

const r2 = (n: number) => Math.round(n * 100) / 100;

function validateAccountId(i: { accountId: string }) {
  if (typeof i.accountId !== "string" || !/^[0-9a-f-]{36}$/i.test(i.accountId)) throw new Error("Invalid trading account");
  return { accountId: i.accountId };
}

async function snapshot(db: SupabaseClient<Database>, userId: string, accountId: string) {
  const [account, positions] = await Promise.all([
    db
      .from("trading_accounts")
      .select("id, login, nickname, label, server, currency, leverage, access_role, balance")
      .eq("id", accountId)
      .eq("user_id", userId)
      .maybeSingle(),
    db.from("positions").select("*").eq("account_id", accountId).is("closed_at", null).order("id"),
  ]);
  if (account.error || positions.error) throw new Error("Could not load your trading account. Please try again.");
  if (!account.data) throw new Error("Trading account not found");
  return { account: account.data, balance: Number(account.data.balance), positions: positions.data ?? [] };
}

function exposure(state: Awaited<ReturnType<typeof snapshot>>, now: number, leverage: number) {
  return state.positions.reduce((result, p) => ({
    used: result.used + calcMargin(p.symbol, Number(p.lots), Number(p.open_price), leverage),
    floating: result.floating + calcPnl(p.symbol, p.side as Side, Number(p.lots), Number(p.open_price), closePrice(p.symbol, p.side as Side, now)),
  }), { used: 0, floating: 0 });
}

async function apply(userId: string, state: Awaited<ReturnType<typeof snapshot>>, action: string, payload: Json) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.rpc("apply_demo_operation", {
    p_user: userId,
    p_account: state.account.id,
    p_action: action,
    p_expected_balance: state.balance,
    p_expected_positions: state.positions.map((p) => p.id),
    p_payload: payload,
  });
  if (error) throw new Error(error.message);
}

async function closeOne(db: SupabaseClient<Database>, userId: string, accountId: string, id: string, reason: string) {
  const state = await snapshot(db, userId, accountId);
  const pos = state.positions.find((p) => p.id === id);
  if (!pos) throw new Error("Position not found");
  const price = closePrice(pos.symbol, pos.side as Side, Date.now());
  const pnl = r2(calcPnl(pos.symbol, pos.side as Side, Number(pos.lots), Number(pos.open_price), price));
  await apply(userId, state, "close", { id, price, pnl, reason });
}

async function fillDueLimitOrders(db: SupabaseClient<Database>, userId: string, accountId: string) {
  const { data: orders, error } = await db
    .from("pending_orders")
    .select("*")
    .eq("account_id", accountId)
    .eq("status", "pending")
    .order("created_at");
  if (error) throw new Error("Could not load pending orders. Please try again.");

  for (const order of orders ?? []) {
    const now = Date.now();
    const price = Number(order.limit_price);
    if (!limitHit(order.side as Side, quote(order.symbol, now), price)) continue;

    const state = await snapshot(db, userId, accountId);
    const leverage = Number(state.account.leverage) || 100;
    const { used, floating } = exposure(state, now, leverage);
    const margin = calcMargin(order.symbol, Number(order.lots), price, leverage);
    if (margin > state.balance + floating - used) continue;

    await apply(userId, state, "fill_limit", { id: order.id, price, margin, used, floating });
  }
}

async function requireTradable(db: SupabaseClient<Database>, userId: string, accountId: string) {
  const state = await snapshot(db, userId, accountId);
  if (state.account.access_role === "investor") throw new Error("This is an investor (read-only) account");
  return state;
}

export const getAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validateAccountId)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const initial = await snapshot(supabase, userId, data.accountId);
    const now = Date.now();
    for (const p of initial.positions) {
      const hit = stopHit(p.side as Side, closePrice(p.symbol, p.side as Side, now), p.stop_loss == null ? null : Number(p.stop_loss), p.take_profit == null ? null : Number(p.take_profit));
      if (hit) await closeOne(supabase, userId, data.accountId, p.id, hit === "sl" ? "Stop loss" : "Take profit");
    }
    await fillDueLimitOrders(supabase, userId, data.accountId);
    const [state, closed, tx, pending] = await Promise.all([
      snapshot(supabase, userId, data.accountId),
      supabase.from("positions").select("*").eq("account_id", data.accountId).not("closed_at", "is", null).order("closed_at", { ascending: false }).limit(100),
      supabase.from("transactions").select("*").eq("account_id", data.accountId).order("created_at", { ascending: false }).limit(100),
      supabase.from("pending_orders").select("*").eq("account_id", data.accountId).eq("status", "pending").order("created_at"),
    ]);
    if (closed.error || tx.error || pending.error) throw new Error("Could not load account activity. Please try again.");
    return {
      account: {
        id: state.account.id,
        login: state.account.login,
        nickname: state.account.nickname,
        label: state.account.label,
        server: state.account.server,
        currency: state.account.currency,
        leverage: Number(state.account.leverage),
        access_role: state.account.access_role,
      },
      balance: state.balance,
      open: state.positions,
      pending: pending.data ?? [],
      closed: closed.data ?? [],
      transactions: tx.data ?? [],
    };
  });

export const openTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { accountId: string; symbol: string; side: Side; lots: number; stopLoss: number | null; takeProfit: number | null }) => ({ ...validateOrder(i), ...validateAccountId(i) }))
  .handler(async ({ data, context }) => {
    const { accountId, ...order } = data;
    const now = Date.now();
    const price = openPrice(order.symbol, order.side, now);
    const exitPrice = closePrice(order.symbol, order.side, now);
    if (order.stopLoss != null && stopHit(order.side, exitPrice, order.stopLoss, null)) throw new Error("Stop loss is on the wrong side of the price");
    if (order.takeProfit != null && stopHit(order.side, exitPrice, null, order.takeProfit)) throw new Error("Take profit is on the wrong side of the price");
    const state = await requireTradable(context.supabase, context.userId, accountId);
    const leverage = Number(state.account.leverage) || 100;
    const { used, floating } = exposure(state, now, leverage);
    const margin = calcMargin(order.symbol, order.lots, price, leverage);
    if (margin > state.balance + floating - used) throw new Error("Not enough free margin");
    await apply(context.userId, state, "open", { ...order, price, margin, used, floating });
    return { price };
  });

export const placeLimitOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: LimitOrderInput & { accountId: string }) => ({ ...validateLimitOrder(i), ...validateAccountId(i) }))
  .handler(async ({ data, context }) => {
    const { accountId, ...order } = data;
    const state = await requireTradable(context.supabase, context.userId, accountId);
    const q = quote(order.symbol, Date.now());
    if (order.side === "buy" && order.limitPrice >= q.ask) throw new Error("Buy limit price must be below the current ask");
    if (order.side === "sell" && order.limitPrice <= q.bid) throw new Error("Sell limit price must be above the current bid");
    if (order.stopLoss != null && stopHit(order.side, order.limitPrice, order.stopLoss, null)) throw new Error("Stop loss is on the wrong side of the limit price");
    if (order.takeProfit != null && stopHit(order.side, order.limitPrice, null, order.takeProfit)) throw new Error("Take profit is on the wrong side of the limit price");
    await apply(context.userId, state, "place_limit", { ...order });
    return { ok: true };
  });

export const cancelPendingOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { accountId: string; id: string }) => {
    if (typeof i.id !== "string" || !/^[0-9a-f-]{36}$/i.test(i.id)) throw new Error("Invalid pending order");
    return { id: i.id, ...validateAccountId(i) };
  })
  .handler(async ({ data, context }) => {
    const state = await requireTradable(context.supabase, context.userId, data.accountId);
    await apply(context.userId, state, "cancel_limit", { id: data.id });
    return { ok: true };
  });

export const closeTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; accountId: string }) => {
    if (typeof i.id !== "string" || !/^[0-9a-f-]{36}$/i.test(i.id)) throw new Error("Invalid position");
    return { id: i.id, ...validateAccountId(i) };
  })
  .handler(async ({ data, context }) => {
    await requireTradable(context.supabase, context.userId, data.accountId);
    await closeOne(context.supabase, context.userId, data.accountId, data.id, "Manual");
    return { ok: true };
  });

export const moveFunds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { accountId: string; kind: "deposit" | "withdraw"; amount: number }) => ({ ...validateFunds(i), ...validateAccountId(i) }))
  .handler(async ({ data, context }) => {
    const state = await requireTradable(context.supabase, context.userId, data.accountId);
    const { used, floating } = exposure(state, Date.now(), Number(state.account.leverage) || 100);
    if (data.kind === "withdraw" && data.amount > Math.min(state.balance, state.balance + floating - used)) throw new Error("You can't withdraw money used as margin or more than your available funds");
    await apply(context.userId, state, data.kind, { amount: data.amount, used, floating });
    return { balance: r2(state.balance + (data.kind === "deposit" ? data.amount : -data.amount)) };
  });
