import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { validateNewAccount } from "@/lib/account-options";

const SERVER = "Vantor-server 1";

function genPassword(len = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

async function insertAccount(admin: any, fields: Record<string, unknown>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const login = 10000000 + Math.floor(Math.random() * 90000000);
    const { data, error } = await admin
      .from("trading_accounts")
      .insert({
        login,
        label: "Standard",
        kind: "demo",
        server: SERVER,
        trader_password: genPassword(),
        investor_password: genPassword(),
        ...fields,
      })
      .select("id, login, nickname, label, server, trader_password, investor_password, balance, currency, leverage")
      .single();
    if (!error && data) return data;
    if (error && error.code !== "23505") throw new Error(error.message);
  }
  throw new Error("Could not allocate an account number. Please try again.");
}

export const listMyAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("trading_accounts")
      .select("id, login, nickname, label, kind, server, access_role, balance, currency, leverage, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error("Could not load your accounts");
    return data ?? [];
  });

export const openDemoAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validateNewAccount)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const acc = await insertAccount(supabaseAdmin, {
      user_id: context.userId,
      access_role: "trader",
      nickname: data.nickname,
      label: data.accountType,
      balance: data.balance,
      currency: data.currency,
      leverage: data.leverage,
      trader_password: data.password,
    });
    const { error } = await supabaseAdmin.from("transactions").insert({
      user_id: context.userId,
      account_id: acc.id,
      kind: "initial",
      amount: data.balance,
    });
    if (error) {
      await supabaseAdmin.from("trading_accounts").delete().eq("id", acc.id);
      throw new Error("Could not open the account. Please try again.");
    }
    return acc;
  });

export const claimTradingAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { login: string; password: string; server: string }) => {
    if (!/^\d{6,12}$/.test(String(i.login ?? ""))) throw new Error("Enter the numeric login you were given");
    if (typeof i.password !== "string" || i.password.length < 4) throw new Error("Enter the password you were given");
    if (typeof i.server !== "string" || i.server.trim().length < 2) throw new Error("Enter the server name you were given");
    return { login: Number(i.login), password: i.password, server: i.server.trim() };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: acc, error } = await supabaseAdmin
      .from("trading_accounts")
      .select("id, user_id, trader_password, investor_password, server")
      .eq("login", data.login)
      .maybeSingle();
    if (error) throw new Error("Could not look up that account");
    if (!acc || acc.server !== data.server) throw new Error("No account found for that login and server");
    const role = acc.trader_password === data.password ? "trader" : acc.investor_password === data.password ? "investor" : null;
    if (!role) throw new Error("Wrong password for this account");
    if (acc.user_id && acc.user_id !== context.userId) throw new Error("This account is already linked to another user");
    if (!acc.user_id) {
      const { error: upError } = await supabaseAdmin
        .from("trading_accounts")
        .update({ user_id: context.userId, access_role: role })
        .eq("id", acc.id)
        .is("user_id", null);
      if (upError) throw new Error("Could not link the account. Please try again.");
    }
    return { ok: true, role };
  });
