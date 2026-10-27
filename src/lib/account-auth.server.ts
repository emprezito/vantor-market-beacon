import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "@/lib/password.server";

export const INVALID_LOGIN_MESSAGE = "Invalid server, login or password";
export const SESSION_INVALID_MESSAGE = "Your session is no longer valid. Please sign in again.";

export type AccountAuthRow = Pick<
  Database["public"]["Tables"]["trading_accounts"]["Row"],
  "id" | "server_id" | "login" | "trader_hash" | "investor_hash" | "session_epoch" | "status"
>;

export type AccountRole = "trader" | "investor";

export async function loadAccountForLogin(
  admin: SupabaseClient<Database>,
  serverId: string,
  login: number,
): Promise<AccountAuthRow | null> {
  const { data, error } = await admin
    .from("trading_accounts")
    .select("id, server_id, login, trader_hash, investor_hash, session_epoch, status")
    .eq("server_id", serverId)
    .eq("login", login)
    .maybeSingle();
  if (error) throw new Error(INVALID_LOGIN_MESSAGE);
  return data;
}

export async function authenticateAccountRow(
  account: AccountAuthRow | null,
  password: string,
): Promise<{ account: AccountAuthRow; role: AccountRole } | null> {
  const traderHash = account?.trader_hash ?? DUMMY_PASSWORD_HASH;
  const investorHash = account?.investor_hash ?? DUMMY_PASSWORD_HASH;
  const [traderMatches, investorMatches] = await Promise.all([
    verifyPassword(password, traderHash),
    verifyPassword(password, investorHash),
  ]);

  if (!account || account.status !== "active" || (!traderMatches && !investorMatches)) {
    return null;
  }

  return { account, role: traderMatches ? "trader" : "investor" };
}

export async function authenticateTradingAccount(
  admin: SupabaseClient<Database>,
  serverId: string,
  login: number,
  password: string,
) {
  const account = await loadAccountForLogin(admin, serverId, login);
  return authenticateAccountRow(account, password);
}

export function accountSessionIsValid(
  account: Pick<AccountAuthRow, "status" | "session_epoch">,
  epoch: number,
) {
  return account.status === "active" && account.session_epoch === epoch;
}

export async function recordLoginFailure(
  admin: SupabaseClient<Database>,
  ip: string,
  login: number,
) {
  const { data, error } = await admin.rpc("record_login_failure", {
    p_ip: ip,
    p_login: String(login),
  });
  if (error) throw new Error("Could not verify sign-in. Please try again.");

  const result = data as { blocked?: boolean; retry_after_seconds?: number } | null;
  return {
    blocked: result?.blocked === true,
    retryAfterSeconds: Math.max(0, Math.ceil(Number(result?.retry_after_seconds ?? 0))),
  };
}
