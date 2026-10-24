import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  TRADING_SERVER_SELECT,
  normalizeServer,
  validateNewAccount,
  validateNewAccountForServer,
  validateServerId,
  type TradingServer,
} from "@/lib/account-options";

export const listTradingServers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("trading_servers")
      .select(TRADING_SERVER_SELECT)
      .eq("status", "active")
      .order("sort_order")
      .order("name");
    if (error) throw new Error("Could not load trading servers");
    return (data ?? []).map((server) => normalizeServer(server as TradingServer));
  });

export const listMyAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("trading_accounts")
      .select("id, login, nickname, label, kind, server, server_id, access_role, balance, currency, leverage, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error("Could not load your accounts");
    return data ?? [];
  });

export const openDemoAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: Parameters<typeof validateNewAccount>[0] & { serverId: string }) => ({
    ...validateNewAccount(i),
    serverId: validateServerId(i.serverId),
  }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadServerForUser, insertAccount } = await import("@/lib/server-accounts.server");
    const server = await loadServerForUser(supabaseAdmin, data.serverId, context.userId);
    const account = validateNewAccountForServer(data, server);
    const acc = await insertAccount(supabaseAdmin, {
      user_id: context.userId,
      access_role: "trader",
      nickname: account.nickname,
      label: account.accountType,
      balance: account.balance,
      currency: account.currency,
      leverage: account.leverage,
      trader_password: account.password,
      server: server.name,
      server_id: server.id,
    });
    const { error } = await supabaseAdmin.from("transactions").insert({
      user_id: context.userId,
      account_id: acc.id,
      kind: "initial",
      amount: account.balance,
    });
    if (error) {
      await supabaseAdmin.from("trading_accounts").delete().eq("id", acc.id);
      throw new Error("Could not open the account. Please try again.");
    }
    return acc;
  });

export const claimTradingAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { login: string; password: string; serverId: string }) => {
    if (!/^\d{6,12}$/.test(String(i.login ?? ""))) throw new Error("Enter the numeric login you were given");
    if (typeof i.password !== "string" || i.password.length < 4) throw new Error("Enter the password you were given");
    return { login: Number(i.login), password: i.password, serverId: validateServerId(i.serverId) };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadServerForUser } = await import("@/lib/server-accounts.server");
    const server = await loadServerForUser(supabaseAdmin, data.serverId, context.userId);
    const { data: acc, error } = await supabaseAdmin
      .from("trading_accounts")
      .select("id, user_id, trader_password, investor_password, access_role")
      .eq("login", data.login)
      .eq("server_id", server.id)
      .maybeSingle();
    if (error) throw new Error("Could not look up that account");
    if (!acc) throw new Error(`No account found for that login on ${server.name}`);
    const role = acc.trader_password === data.password ? "trader" : acc.investor_password === data.password ? "investor" : null;
    if (!role) throw new Error("Wrong password for this account");
    if (acc.user_id && acc.user_id !== context.userId) throw new Error("This account is already linked to another user");
    if (!acc.user_id) {
      const { data: claimed, error: upError } = await supabaseAdmin
        .from("trading_accounts")
        .update({ user_id: context.userId, access_role: role })
        .eq("id", acc.id)
        .is("user_id", null)
        .select("id")
        .maybeSingle();
      if (upError) throw new Error("Could not link the account. Please try again.");
      if (!claimed) throw new Error("This account was just linked to another user");
    } else if (acc.access_role !== role) {
      const { error: upError } = await supabaseAdmin
        .from("trading_accounts")
        .update({ access_role: role })
        .eq("id", acc.id)
        .eq("user_id", context.userId);
      if (upError) throw new Error("Could not update the account access role. Please try again.");
    }
    return { ok: true, role };
  });
