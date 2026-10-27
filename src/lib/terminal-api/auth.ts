import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { TRADING_ACCOUNT_SELECT, type TradingAccount } from "@/lib/trading-service.server";
import { ApiError } from "./errors";
import { bearerToken } from "./http";
import { tokenSecret, verifyStreamTicket, verifyTerminalToken } from "./token";
import type { StreamTicketClaims, TerminalEnv, TerminalTokenClaims } from "./types";

const UNAUTHORIZED = "Your session is no longer valid. Please sign in again.";

function invalidSession() {
  return new ApiError(401, "unauthorized", UNAUTHORIZED);
}

async function loadActiveAccount(
  admin: SupabaseClient<Database>,
  accountId: string,
  serverId: string,
  epoch: number,
): Promise<TradingAccount> {
  const { data, error } = await admin
    .from("trading_accounts")
    .select(TRADING_ACCOUNT_SELECT)
    .eq("id", accountId)
    .eq("server_id", serverId)
    .maybeSingle();
  if (error)
    throw new ApiError(
      503,
      "service_unavailable",
      "Could not load your trading account. Please try again.",
    );
  if (!data) throw invalidSession();
  const account = data as unknown as TradingAccount;
  if (account.status !== "active") throw invalidSession();
  if (Number(account.session_epoch) !== epoch) throw invalidSession();
  return account;
}

export async function authenticateTerminalRequest(
  request: Request,
  env: TerminalEnv,
  admin: SupabaseClient<Database>,
) {
  const token = bearerToken(request);
  if (!token) throw invalidSession();
  const claims = await verifyTerminalToken(token, tokenSecret(env));
  if (!claims) throw invalidSession();
  const account = await loadActiveAccount(admin, claims.accountId, claims.serverId, claims.epoch);
  return { account, claims: claims as TerminalTokenClaims };
}

export async function authenticateStreamTicket(
  ticket: string,
  env: TerminalEnv,
  admin: SupabaseClient<Database>,
) {
  const claims = await verifyStreamTicket(ticket, tokenSecret(env));
  if (!claims) throw new ApiError(401, "unauthorized", "Invalid stream ticket");
  const account = await loadActiveAccount(admin, claims.accountId, claims.serverId, claims.epoch);
  return { account, claims: claims as StreamTicketClaims };
}

export function assertTrader(
  claims: TerminalTokenClaims,
  account?: { access_role: string | null },
) {
  if (claims.role === "investor" || account?.access_role === "investor") {
    throw new ApiError(403, "read_only_account", "This is an investor (read-only) account");
  }
}
