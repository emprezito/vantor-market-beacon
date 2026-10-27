import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { TRADING_SERVER_SELECT, normalizeServer, type TradingServer } from "@/lib/account-options";
import { isPartnerRole } from "@/lib/partner";
import { hashPassword } from "@/lib/password.server";

type AccountInsert = Database["public"]["Tables"]["trading_accounts"]["Insert"];
type AccountUpdate = Database["public"]["Tables"]["trading_accounts"]["Update"];

export type AccountFields = Pick<
  AccountInsert,
  | "user_id"
  | "issued_by"
  | "nickname"
  | "label"
  | "kind"
  | "balance"
  | "currency"
  | "leverage"
  | "server"
  | "server_id"
  | "access_role"
>;

export type AccountCredentialPatch = Pick<
  AccountUpdate,
  "trader_hash" | "investor_hash" | "status"
>;

export function genPassword(len = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

export function genLogin() {
  const span = 90_000_000;
  const limit = Math.floor(0x1_0000_0000 / span) * span;
  let value = 0;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0]!;
  } while (value >= limit);
  return 10_000_000 + (value % span);
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
    const login = genLogin();
    const traderPassword = genPassword(12);
    const investorPassword = genPassword(12);
    const [traderHash, investorHash] = await Promise.all([
      hashPassword(traderPassword),
      hashPassword(investorPassword),
    ]);
    const { data, error } = await admin
      .from("trading_accounts")
      .insert({
        login,
        label: "Standard",
        kind: "demo",
        trader_hash: traderHash,
        investor_hash: investorHash,
        session_epoch: 0,
        status: "active",
        ...fields,
      })
      .select("id, login, nickname, label, server, server_id, balance, currency, leverage")
      .single();
    if (!error && data) return { ...data, traderPassword, investorPassword };
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

export async function updateAccountWithEpoch(
  admin: SupabaseClient<Database>,
  accountId: string,
  serverId: string,
  patch: AccountCredentialPatch,
  options: { incrementEpoch?: boolean } = {},
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: current, error } = await admin
      .from("trading_accounts")
      .select("session_epoch")
      .eq("id", accountId)
      .eq("server_id", serverId)
      .maybeSingle();
    if (error) throw new Error("Could not update the account. Please try again.");
    if (!current) throw new Error("That account is not on this server");

    const { data: updated, error: updateError } = await admin
      .from("trading_accounts")
      .update({
        ...patch,
        session_epoch: current.session_epoch + (options.incrementEpoch ? 1 : 0),
      })
      .eq("id", accountId)
      .eq("server_id", serverId)
      .eq("session_epoch", current.session_epoch)
      .select("id, login")
      .maybeSingle();
    if (updateError) throw new Error("Could not update the account. Please try again.");
    if (updated) return updated;
  }
  throw new Error("Could not update the account. Please try again.");
}
