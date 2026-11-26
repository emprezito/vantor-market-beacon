type BachsEnv = {
  BACHS_API_KEY?: string;
  BACHS_API_BASE_URL?: string;
  BACHS_WEBHOOK_SECRET?: string;
};

type BachsGlobals = typeof globalThis & { __env__?: BachsEnv };

const SANDBOX_BASE_URL = "https://sandbox-api.bachs.io";
const PRODUCTION_BASE_URL = "https://api.bachs.io";
const REQUEST_TIMEOUT_MS = 10_000;
const SIGNATURE_TOLERANCE_SECONDS = 300;

export type BachsCheckout = {
  checkoutId: string;
  checkoutUrl: string;
  expiresAt: string | null;
};

function envValue(name: keyof BachsEnv): string | undefined {
  const runtime = (globalThis as BachsGlobals).__env__?.[name];
  return runtime ?? process.env[name];
}

export function bachsApiKey(): string {
  const key = envValue("BACHS_API_KEY")?.trim();
  if (!key) throw new Error("Payments are not configured");
  return key;
}

export function bachsWebhookSecret(): string {
  const secret = envValue("BACHS_WEBHOOK_SECRET")?.trim();
  if (!secret) throw new Error("Payments are not configured");
  return secret;
}

export function bachsApiBaseUrl(): string {
  const configured = envValue("BACHS_API_BASE_URL")?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return bachsApiKey().startsWith("sk_sandbox_") ? SANDBOX_BASE_URL : PRODUCTION_BASE_URL;
}

function detailMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null) {
    const detail = (payload as Record<string, unknown>)["detail"];
    if (typeof detail === "string" && detail.trim()) return detail.trim();
  }
  return fallback;
}

async function bachsRequest<T>(path: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${bachsApiKey()}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  try {
    const response = await fetch(`${bachsApiBaseUrl()}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      throw new Error(detailMessage(payload, "Could not start the payment. Please try again."));
    }
    if (payload == null) throw new Error("The payment provider returned an empty response");
    return payload as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("The payment provider timed out. Please try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function createBachsCheckout(input: {
  amount: number;
  currency: string;
  reference: string;
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
  email?: string;
}): Promise<BachsCheckout> {
  const payload = await bachsRequest<{
    checkout_id?: unknown;
    checkout_url?: unknown;
    expires_at?: unknown;
  }>("/v1/checkout-sessions", {
    method: "POST",
    headers: { "Idempotency-Key": input.reference },
    body: JSON.stringify({
      pricing: { currency: input.currency, amount: input.amount.toFixed(2) },
      billing_currency: input.currency,
      payment_method_types:
        input.currency === "USD" ? ["USD_CARD"] : ["NGN_CARD", "NGN_BANK_TRANSFER"],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      reference: input.reference,
      metadata: input.metadata,
      customer: input.email ? { email: input.email } : undefined,
      expires_in_minutes: 60,
    }),
  });
  if (typeof payload.checkout_id !== "string" || typeof payload.checkout_url !== "string") {
    throw new Error("The payment provider returned an invalid response");
  }
  return {
    checkoutId: payload.checkout_id,
    checkoutUrl: payload.checkout_url,
    expiresAt: typeof payload.expires_at === "string" ? payload.expires_at : null,
  };
}

function timingSafeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function parseV2Signature(header: string): { timestamp: number; signatures: string[] } | null {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name === "t") {
      const parsed = Number(value);
      if (!Number.isInteger(parsed)) return null;
      timestamp = parsed;
    } else if (name === "v1" && value) {
      signatures.push(value);
    }
  }
  if (timestamp == null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

export async function verifyBachsSignature(
  rawBody: string,
  headers: Headers,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!secret) return false;

  const v2 = headers.get("X-Bachs-Signature-V2");
  if (v2) {
    const parsed = parseV2Signature(v2);
    if (!parsed) return false;
    if (Math.abs(nowSeconds - parsed.timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
    const expected = await hmacHex(secret, `${parsed.timestamp}.${rawBody}`);
    return parsed.signatures.some((signature) => timingSafeHexEqual(expected, signature));
  }

  const timestampHeader = headers.get("X-Bachs-Timestamp");
  const signatureHeader = headers.get("X-Bachs-Signature");
  if (!timestampHeader || !signatureHeader) return false;
  const timestamp = Number(timestampHeader);
  if (!Number.isInteger(timestamp)) return false;
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = await hmacHex(secret, `${timestamp}.${rawBody}`);
  return timingSafeHexEqual(expected, signatureHeader.trim());
}
