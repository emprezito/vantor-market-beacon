import {
  decodeBase64Url,
  encodeBase64Url,
  signHmacPayload,
  signaturesMatch,
} from "./realtime-ticket";
import { MARKETDATA_SYMBOLS } from "./marketdatafeed";

const encoder = new TextEncoder();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MARKETDATA_TICKET_ISSUER = "vantor-market-beacon";
export const MARKETDATA_TICKET_AUDIENCE = "marketdatafeed-v1";
export const MARKETDATA_TICKET_TTL_SECONDS = 120;
export const MARKETDATA_TICKET_SYMBOLS = [MARKETDATA_SYMBOLS.XAUUSD] as const;

export type MarketDatafeedTicket = {
  ticket: string;
  expiresAt: number;
};

export type MarketDatafeedTicketClaims = {
  userId: string;
  accountId: string;
  serverId: string;
  symbols: string[];
  iat: number;
  exp: number;
  jti: string;
  iss: string;
  aud: string;
};

export type MarketDatafeedTicketInput = {
  userId: string;
  accountId: string;
  serverId: string;
  symbols?: readonly string[];
};

function allowedSymbolSet(): Set<string> {
  return new Set(MARKETDATA_TICKET_SYMBOLS);
}

function ticketSecret(secret: string): string {
  if (!secret) throw new Error("Missing MarketDatafeed ticket secret");
  return secret;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function validSymbols(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (!value.every((symbol) => typeof symbol === "string" && symbol.length > 0)) return false;
  if (new Set(value).size !== value.length) return false;
  const allowed = allowedSymbolSet();
  return value.every((symbol) => allowed.has(symbol));
}

function validateClaims(value: unknown, nowSeconds: number): MarketDatafeedTicketClaims | null {
  if (typeof value !== "object" || value === null) return null;
  const claims = value as Record<string, unknown>;

  const userId = claims["userId"];
  const accountId = claims["accountId"];
  const serverId = claims["serverId"];
  const symbols = claims["symbols"];
  const jti = claims["jti"];
  const iss = claims["iss"];
  const aud = claims["aud"];
  const iat = claims["iat"];
  const exp = claims["exp"];

  if (!validId(userId)) return null;
  if (!validId(accountId)) return null;
  if (!validId(serverId)) return null;
  if (!validSymbols(symbols)) return null;
  if (typeof jti !== "string" || !UUID_RE.test(jti)) return null;
  if (iss !== MARKETDATA_TICKET_ISSUER) return null;
  if (aud !== MARKETDATA_TICKET_AUDIENCE) return null;
  if (typeof iat !== "number" || !Number.isInteger(iat) || iat <= 0) return null;
  if (typeof exp !== "number" || !Number.isInteger(exp) || exp <= nowSeconds) return null;
  if (iat > nowSeconds + 30) return null;
  if (exp - iat > 5 * 60) return null;
  if (exp <= iat) return null;

  return {
    userId,
    accountId,
    serverId,
    symbols: [...symbols],
    iat,
    exp,
    jti,
    iss,
    aud,
  };
}

export async function createMarketDatafeedTicket(
  input: MarketDatafeedTicketInput,
  secret: string,
  now = Date.now(),
): Promise<MarketDatafeedTicket> {
  const key = ticketSecret(secret);
  if (!validId(input.userId)) throw new Error("Missing user ID");
  if (!validId(input.accountId)) throw new Error("Missing account ID");
  if (!validId(input.serverId)) throw new Error("Missing server ID");

  const symbols = [...(input.symbols ?? MARKETDATA_TICKET_SYMBOLS)].sort();
  if (!validSymbols(symbols)) throw new Error("Invalid MarketDatafeed symbols");

  const iat = Math.floor(now / 1000);
  const exp = iat + MARKETDATA_TICKET_TTL_SECONDS;
  const payload = JSON.stringify({
    accountId: input.accountId,
    aud: MARKETDATA_TICKET_AUDIENCE,
    exp,
    iat,
    iss: MARKETDATA_TICKET_ISSUER,
    jti: crypto.randomUUID(),
    serverId: input.serverId,
    symbols,
    userId: input.userId,
  });
  const encoded = encodeBase64Url(encoder.encode(payload));
  const signature = await signHmacPayload(encoded, key);

  return {
    ticket: `v1.${encoded}.${signature}`,
    expiresAt: exp * 1000,
  };
}

export async function verifyMarketDatafeedTicket(
  ticket: string,
  secret: string,
  now = Date.now(),
): Promise<MarketDatafeedTicketClaims | null> {
  if (!ticket || !secret) return null;

  const parts = ticket.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const encoded = parts[1];
  const signature = parts[2];
  if (!encoded || !signature) return null;

  const expected = await signHmacPayload(encoded, secret);
  if (!signaturesMatch(signature, expected)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(decodeBase64Url(encoded));
  } catch {
    return null;
  }

  return validateClaims(payload, Math.floor(now / 1000));
}

export function marketDatafeedServerIds(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function marketDatafeedServerIsAllowed(
  serverId: string | null | undefined,
  raw: string | undefined,
): boolean {
  if (!serverId) return false;
  return marketDatafeedServerIds(raw).has(serverId.trim().toLowerCase());
}
