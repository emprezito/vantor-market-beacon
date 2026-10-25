import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { TRADING_SERVER_SELECT, normalizeServer, type TradingServer } from "@/lib/account-options";
import { isPartnerRole } from "@/lib/partner";

type AccountInsert = Database["public"]["Tables"]["trading_accounts"]["Insert"];

export type AccountFields = Omit<AccountInsert, "login" | "investor_password">;

export function genPassword(len = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

export async function getServer(
  admin: SupabaseClient<Database>,
  serverId: string,
): Promise<TradingServer> {
  const { data, error } = await admin
    .from("trading_servers")
    .select(TRADING_SERVER_SELECT)
    .eq("id", serverId)
    .maybeSingle();
  if (error) throw new Error("Could not load the selected server. Please try again.");
  if (!data) throw new Error("That trading server is not available");
  return normalizeServer(data as TradingServer);
}

export async function loadServerForUser(
  admin: SupabaseClient<Database>,
  serverId: string,
  userId: string,
): Promise<TradingServer> {
  const server = await getServer(admin, serverId);
  if (server.status !== "active") {
    throw new Error("That trading server is not accepting new accounts");
  }
  if (server.visibility !== "public") {
    const [{ data: appRole, error: roleError }, { data: member, error: memberError }] =
      await Promise.all([
        admin
          .from("app_roles")
          .select("role")
          .eq("user_id", userId)
          .eq("role", "partner")
          .maybeSingle(),
        admin
          .from("server_members")
          .select("role")
          .eq("server_id", serverId)
          .eq("user_id", userId)
          .maybeSingle(),
      ]);
    if (roleError || memberError) {
      throw new Error("Could not check access to the selected server. Please try again.");
    }
    if (!isPartnerRole(appRole?.role) || !member) {
      throw new Error("That trading server is not available");
    }
  }
  return server;
}

export async function insertAccount(admin: SupabaseClient<Database>, fields: AccountFields) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const login = 10000000 + Math.floor(Math.random() * 90000000);
    const { data, error } = await admin
      .from("trading_accounts")
      .insert({
        login,
        label: "Standard",
        kind: "demo",
        investor_password: genPassword(),
        ...fields,
      })
      .select(
        "id, login, nickname, label, server, server_id, trader_password, investor_password, balance, currency, leverage",
      )
      .single();
    if (!error && data) return data;
    if (error && error.code !== "23505") throw new Error(error.message);
  }
  throw new Error("Could not allocate an account number. Please try again.");
}

export async function insertAccountWithInitialTransaction(
  admin: SupabaseClient<Database>,
  fields: AccountFields,
  actorUserId: string,
) {
  const account = await insertAccount(admin, fields);
  const { error } = await admin.from("transactions").insert({
    user_id: actorUserId,
    account_id: account.id,
    kind: "initial",
    amount: Number(fields.balance),
  });
  if (error) {
    await admin.from("trading_accounts").delete().eq("id", account.id);
    throw new Error("Could not open the account. Please try again.");
  }
  return account;
}
