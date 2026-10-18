import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { INSTRUMENTS } from "./market";
import { calcMargin, calcPnl, closePrice, openPrice, stopHit, type Side } from "./trading";

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

async function closeOne(userId: string, pos: any, reason: string) {
  const db = await admin();
  const price = closePrice(pos.symbol, pos.side, Date.now());
  const pnl = r2(calcPnl(pos.symbol, pos.side, Number(pos.lots), Number(pos.open_price), price));
  const { data: updated } = await db
    .from("positions")
    .update({ closed_at: new Date().toISOString(), close_price: price, pnl, close_reason: reason })
    .eq("id", pos.id)
    .eq("user_id", userId)
    .is("closed_at", null)
    .select("id");
  if (!updated?.length) return;
  const { data: w } = await db.from("wallets").select("balance").eq("user_id", userId).single();
  await db.from("wallets").update({ balance: r2(Number(w!.balance) + pnl) }).eq("user_id", userId);
}

async function ensureWallet(userId: string) {
  const db = await admin();
  const { data } = await db.from("wallets").select("balance").eq("user_id", userId).maybeSingle();
  if (!data) {
    await db.from("wallets").insert({ user_id: userId, balance: 10000 });
    await db.from("transactions").insert({ user_id: userId, kind: "bonus", amount: 10000 });
  }
}

export const getAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureWallet(userId);
    // Auto-close positions whose stop loss / take profit was hit.
    const { data: open } = await supabase.from("positions").select("*").is("closed_at", null);
    const now = Date.now();
    for (const p of open ?? []) {
      const hit = stopHit(
        p.side as Side,
        closePrice(p.symbol, p.side as Side, now),
        p.stop_loss == null ? null : Number(p.stop_loss),
        p.take_profit == null ? null : Number(p.take_profit),
      );
      if (hit) await closeOne(userId, p, hit === "sl" ? "Stop loss" : "Take profit");
    }
    const [w, pos, closed, tx] = await Promise.all([
      supabase.from("wallets").select("balance").single(),
      supabase.from("positions").select("*").is("closed_at", null).order("opened_at", { ascending: false }),
      supabase.from("positions").select("*").not("closed_at", "is", null).order("closed_at", { ascending: false }).limit(100),
      supabase.from("transactions").select("*").order("created_at", { ascending: false }).limit(100),
    ]);
    return {
      balance: Number(w.data?.balance ?? 0),
      open: pos.data ?? [],
      closed: closed.data ?? [],
      transactions: tx.data ?? [],
    };
  });

export const openTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { symbol: string; side: Side; lots: number; stopLoss: number | null; takeProfit: number | null }) => {
    if (!INSTRUMENTS.some((x) => x.symbol === i.symbol)) throw new Error("Unknown instrument");
    if (i.side !== "buy" && i.side !== "sell") throw new Error("Invalid side");
    if (!(i.lots >= 0.01 && i.lots <= 100)) throw new Error("Lots must be between 0.01 and 100");
    return i;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const now = Date.now();
    const price = openPrice(data.symbol, data.side, now);
    if (data.stopLoss != null && stopHit(data.side, price, data.stopLoss, null)) throw new Error("Stop loss is on the wrong side of the price");
    if (data.takeProfit != null && stopHit(data.side, price, null, data.takeProfit)) throw new Error("Take profit is on the wrong side of the price");

    const [{ data: w }, { data: open }] = await Promise.all([
      supabase.from("wallets").select("balance").single(),
      supabase.from("positions").select("*").is("closed_at", null),
    ]);
    let used = 0;
    let floating = 0;
    for (const p of open ?? []) {
      used += calcMargin(p.symbol, Number(p.lots), Number(p.open_price));
      floating += calcPnl(p.symbol, p.side as Side, Number(p.lots), Number(p.open_price), closePrice(p.symbol, p.side as Side, now));
    }
    const free = Number(w?.balance ?? 0) + floating - used;
    const need = calcMargin(data.symbol, data.lots, price);
    if (need > free) throw new Error(`Not enough free margin (need $${need.toFixed(2)}, have $${free.toFixed(2)})`);

    const db = await admin();
    const { error } = await db.from("positions").insert({
      user_id: userId, symbol: data.symbol, side: data.side, lots: data.lots,
      open_price: price, stop_loss: data.stopLoss, take_profit: data.takeProfit,
    });
    if (error) throw new Error(error.message);
    return { price };
  });

export const closeTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => i)
  .handler(async ({ data, context }) => {
    const { data: pos } = await context.supabase.from("positions").select("*").eq("id", data.id).is("closed_at", null).maybeSingle();
    if (!pos) throw new Error("Position not found");
    await closeOne(context.userId, pos, "Manual");
    return { ok: true };
  });

export const moveFunds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { kind: "deposit" | "withdraw"; amount: number }) => {
    if (i.kind !== "deposit" && i.kind !== "withdraw") throw new Error("Invalid");
    if (!(i.amount > 0 && i.amount <= 1000000)) throw new Error("Amount must be between $1 and $1,000,000");
    return i;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const db = await admin();
    const { data: w } = await supabase.from("wallets").select("balance").single();
    const bal = Number(w?.balance ?? 0);
    if (data.kind === "withdraw") {
      const { data: open } = await supabase.from("positions").select("symbol,lots,open_price").is("closed_at", null);
      const used = (open ?? []).reduce((s, p) => s + calcMargin(p.symbol, Number(p.lots), Number(p.open_price)), 0);
      if (data.amount > bal - used) throw new Error("You can't withdraw money that's used as margin or more than your balance");
    }
    const next = r2(bal + (data.kind === "deposit" ? data.amount : -data.amount));
    await db.from("wallets").update({ balance: next }).eq("user_id", userId);
    await db.from("transactions").insert({ user_id: userId, kind: data.kind, amount: data.amount });
    return { balance: next };
  });
