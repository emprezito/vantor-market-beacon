import {
  decodeBase64Url,
  encodeBase64Url,
  signHmacPayload,
  signaturesMatch,
} from "@/lib/realtime-ticket";
import { ApiError } from "./errors";
import type { TerminalEnv, TerminalRole, TerminalTokenClaims } from "./types";

const TERMINAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ClaimSource = {
  id: string;
  server_id: string;
  access_role: string | null;
  session_epoch: number;
};

export function tokenSecret(env: TerminalEnv): string {
  const secret = env.TERMINAL_TOKEN_SECRET ?? process.env["TERMINAL_TOKEN_SECRET"];
  if (!secret) throw new ApiError(503, "not_configured", "Trading API is not configured");
  return secret;
}

export function roleFor(account: { access_role: string | null }): TerminalRole {
  return account.access_role === "investor" ? "investor" : "trader";
}

async function createToken(claims: TerminalTokenClaims, secret: string) {
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  return `${payload}.${await signHmacPayload(payload, secret)}`;
}

export async function createTerminalToken(
  account: ClaimSource,
  role: TerminalRole,
  secret: string,
) {
  const now = Date.now();
  const expiresAt = now + TERMINAL_TTL_MS;
  const token = await createToken(
    {
      typ: "terminal",
      accountId: account.id,
      serverId: account.server_id,
      role,
      epoch: Number(account.session_epoch),
      iat: now,
      exp: expiresAt,
    },
    secret,
  );
  return { token, expiresAt };
}

function parseClaims(value: unknown) {
  if (typeof value !== "object" || value === null) return null;
  const claims = value as Record<string, unknown>;
  if (claims["typ"] !== "terminal") return null;
  if (typeof claims["accountId"] !== "string" || !UUID_RE.test(claims["accountId"])) return null;
  if (typeof claims["serverId"] !== "string" || !UUID_RE.test(claims["serverId"])) return null;
  if (claims["role"] !== "trader" && claims["role"] !== "investor") return null;
  if (
    typeof claims["epoch"] !== "number" ||
    !Number.isInteger(claims["epoch"]) ||
    claims["epoch"] < 0
  )
    return null;
  if (typeof claims["iat"] !== "number" || typeof claims["exp"] !== "number") return null;
  if (!Number.isFinite(claims["iat"]) || !Number.isFinite(claims["exp"])) return null;
  if (claims["exp"] <= Date.now() || claims["iat"] > Date.now() + 60_000) return null;
  return claims as unknown as TerminalTokenClaims;
}

async function verifyToken(token: string, secret: string): Promise<TerminalTokenClaims | null> {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeBase64Url(payload));
  } catch {
    return null;
  }
  const claims = parseClaims(parsed);
  if (!claims) return null;
  const expected = await signHmacPayload(payload, secret);
  if (!signaturesMatch(signature, expected)) return null;
  return claims;
}

export function verifyTerminalToken(token: string, secret: string) {
  return verifyToken(token, secret);
}
