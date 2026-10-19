import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type CreateTraderInput = { label: string; email: string; password: string };

function validateTrader(i: CreateTraderInput) {
  if (typeof i.label !== "string" || i.label.trim().length < 1 || i.label.trim().length > 60)
    throw new Error("Give the account a name (1–60 characters)");
  if (typeof i.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email))
    throw new Error("Enter a valid email address for the trader");
  if (typeof i.password !== "string" || i.password.length < 8 || i.password.length > 72)
    throw new Error("Password must be 8–72 characters");
  return { label: i.label.trim(), email: i.email.trim().toLowerCase(), password: i.password };
}

export const createTraderAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validateTrader)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });
    if (error || !created.user) throw new Error(error?.message ?? "Could not create the account");
    const { error: linkError } = await context.supabase.from("trader_accounts").insert({
      owner_user_id: context.userId,
      trader_user_id: created.user.id,
      label: data.label,
    });
    if (linkError) {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      throw new Error("Could not link the account. Please try again.");
    }
    return { id: created.user.id, email: data.email };
  });

export const listTraderAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: links, error } = await context.supabase
      .from("trader_accounts")
      .select("id, trader_user_id, label, created_at")
      .eq("owner_user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error("Could not load trader accounts");
    if (!links?.length) return [];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ids = links.map((l) => l.trader_user_id);
    const [wallets, positions] = await Promise.all([
      supabaseAdmin.from("wallets").select("user_id, balance").in("user_id", ids),
      supabaseAdmin.from("positions").select("user_id").in("user_id", ids).is("closed_at", null),
    ]);
    const balanceOf = new Map((wallets.data ?? []).map((w) => [w.user_id, Number(w.balance)]));
    const openCount = new Map<string, number>();
    for (const p of positions.data ?? []) openCount.set(p.user_id, (openCount.get(p.user_id) ?? 0) + 1);
    return links.map((l) => ({
      id: l.id,
      label: l.label,
      createdAt: l.created_at,
      balance: balanceOf.get(l.trader_user_id) ?? null,
      openPositions: openCount.get(l.trader_user_id) ?? 0,
    }));
  });

export const deleteTraderAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => {
    if (typeof i.id !== "string" || !/^[0-9a-f-]{36}$/i.test(i.id)) throw new Error("Invalid account");
    return i;
  })
  .handler(async ({ data, context }) => {
    const { data: link, error } = await context.supabase
      .from("trader_accounts")
      .select("trader_user_id")
      .eq("id", data.id)
      .eq("owner_user_id", context.userId)
      .single();
    if (error || !link) throw new Error("Account not found");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: delError } = await supabaseAdmin.auth.admin.deleteUser(link.trader_user_id);
    if (delError) throw new Error("Could not remove the account");
    await context.supabase.from("trader_accounts").delete().eq("id", data.id);
    return { ok: true };
  });
