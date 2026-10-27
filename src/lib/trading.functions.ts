import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Side } from "./trading";
import {
  validateOrder,
  validateFunds,
  validateLimitOrder,
  type LimitOrderInput,
} from "./trading-validation";
import {
  cancelPendingOrder as cancelPendingOrderService,
  closePosition as closePositionService,
  getAccountView,
  loadAccountForUser,
  moveFunds as moveFundsService,
  openMarketOrder,
  placeLimitOrder as placeLimitOrderService,
} from "./trading-service.server";

function validateAccountId(i: { accountId: string }) {
  if (typeof i.accountId !== "string" || !/^[0-9a-f-]{36}$/i.test(i.accountId))
    throw new Error("Invalid trading account");
  return { accountId: i.accountId };
}

export const getAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validateAccountId)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const account = await loadAccountForUser(context.supabase, context.userId, data.accountId);
    return getAccountView(context.supabase, supabaseAdmin, account);
  });

export const openTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (i: {
      accountId: string;
      symbol: string;
      side: Side;
      lots: number;
      stopLoss: number | null;
      takeProfit: number | null;
    }) => ({ ...validateOrder(i), ...validateAccountId(i) }),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { accountId, ...order } = data;
    const account = await loadAccountForUser(context.supabase, context.userId, accountId);
    const result = await openMarketOrder(context.supabase, supabaseAdmin, account, order);
    return { price: result.price };
  });

export const placeLimitOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: LimitOrderInput & { accountId: string }) => ({
    ...validateLimitOrder(i),
    ...validateAccountId(i),
  }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { accountId, ...order } = data;
    const account = await loadAccountForUser(context.supabase, context.userId, accountId);
    await placeLimitOrderService(context.supabase, supabaseAdmin, account, order);
    return { ok: true };
  });

export const cancelPendingOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { accountId: string; id: string }) => {
    if (typeof i.id !== "string" || !/^[0-9a-f-]{36}$/i.test(i.id))
      throw new Error("Invalid pending order");
    return { id: i.id, ...validateAccountId(i) };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const account = await loadAccountForUser(context.supabase, context.userId, data.accountId);
    await cancelPendingOrderService(context.supabase, supabaseAdmin, account, data.id);
    return { ok: true };
  });

export const closeTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; accountId: string }) => {
    if (typeof i.id !== "string" || !/^[0-9a-f-]{36}$/i.test(i.id))
      throw new Error("Invalid position");
    return { id: i.id, ...validateAccountId(i) };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const account = await loadAccountForUser(context.supabase, context.userId, data.accountId);
    await closePositionService(context.supabase, supabaseAdmin, account, data.id);
    return { ok: true };
  });

export const moveFunds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { accountId: string; kind: "deposit" | "withdraw"; amount: number }) => ({
    ...validateFunds(i),
    ...validateAccountId(i),
  }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const account = await loadAccountForUser(context.supabase, context.userId, data.accountId);
    return moveFundsService(context.supabase, supabaseAdmin, account, data.kind, data.amount);
  });
