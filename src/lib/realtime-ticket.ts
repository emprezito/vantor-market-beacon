const encoder = new TextEncoder();
const TICKET_TTL_MS = 120_000;

export type RealtimeTicket = {
  ticket: string;
  expiresAt: number;
};

export type RealtimeTicketClaims = {
  userId: string;
  expiresAt: number;
};

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeBase64Url(value: string): string {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

export async function signHmacPayload(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return encodeBase64Url(new Uint8Array(signature));
}

export function signaturesMatch(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function createRealtimeTicket(
  userId: string,
  secret: string,
): Promise<RealtimeTicket> {
  if (!userId) throw new Error("Missing user ID");
  if (!secret) throw new Error("Missing realtime ticket secret");

  const expiresAt = Date.now() + TICKET_TTL_MS;
  const payload = `${userId}.${expiresAt}`;
  return { ticket: `${payload}.${await signHmacPayload(payload, secret)}`, expiresAt };
}

export async function verifyRealtimeTicket(
  ticket: string,
  secret: string,
): Promise<RealtimeTicketClaims | null> {
  if (!ticket || !secret) return null;

  const parts = ticket.split(".");
  if (parts.length !== 3) return null;

  const [userId, expiresRaw, signature] = parts;
  if (!userId || !expiresRaw || !signature) return null;

  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

  const expected = await signHmacPayload(`${userId}.${expiresRaw}`, secret);
  if (!signaturesMatch(signature, expected)) return null;

  return { userId, expiresAt };
}
