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
      .eq("visibility", "public")
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
      .select(
        "id, login, nickname, label, kind, server, server_id, access_role, balance, currency, leverage, created_at",
      )
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
    const { loadServerForUser, insertAccountWithInitialTransaction } =
      await import("@/lib/server-accounts.server");
    const server = await loadServerForUser(supabaseAdmin, data.serverId, context.userId);
    const account = validateNewAccountForServer(data, server);
    return insertAccountWithInitialTransaction(
      supabaseAdmin,
      {
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
      },
      context.userId,
    );
  });
