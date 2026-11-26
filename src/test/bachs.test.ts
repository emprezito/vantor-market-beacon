import { afterEach, describe, expect, it, vi } from "vitest";
import { bachsApiBaseUrl, createBachsCheckout, verifyBachsSignature } from "@/lib/bachs.server";

async function sign(secret: string, message: string) {
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

async function v2Headers(secret: string, timestamp: number, body: string) {
  const signature = await sign(secret, `${timestamp}.${body}`);
  return new Headers({
    "X-Bachs-Signature-V2": `t=${timestamp},v1=${signature}`,
  });
}

async function legacyHeaders(secret: string, timestamp: number, body: string) {
  const signature = await sign(secret, `${timestamp}.${body}`);
  return new Headers({
    "X-Bachs-Timestamp": String(timestamp),
    "X-Bachs-Signature": signature,
  });
}

const secret = "whsec_test";
const now = 1_700_000_000;
const body = JSON.stringify({ id: "evt_1", type: "collection.succeeded" });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Bachs webhook signatures", () => {
  it("accepts a valid V2 signature", async () => {
    await expect(
      verifyBachsSignature(body, await v2Headers(secret, now, body), secret, now),
    ).resolves.toBe(true);
  });

  it("rejects tampered payloads and stale timestamps", async () => {
    const headers = await v2Headers(secret, now, body);
    await expect(verifyBachsSignature(`${body} `, headers, secret, now)).resolves.toBe(false);
    await expect(verifyBachsSignature(body, headers, secret, now + 301)).resolves.toBe(false);
  });

  it("accepts any matching V2 signature in the header", async () => {
    const signature = await sign(secret, `${now}.${body}`);
    const headers = new Headers({
      "X-Bachs-Signature-V2": `t=${now},v1=wrong,v1=${signature}`,
    });
    await expect(verifyBachsSignature(body, headers, secret, now)).resolves.toBe(true);
  });

  it("does not fall back to legacy headers when V2 is malformed", async () => {
    const legacy = await legacyHeaders(secret, now, body);
    legacy.set("X-Bachs-Signature-V2", "malformed");
    await expect(verifyBachsSignature(body, legacy, secret, now)).resolves.toBe(false);
  });

  it("accepts a valid legacy signature", async () => {
    await expect(
      verifyBachsSignature(body, await legacyHeaders(secret, now, body), secret, now),
    ).resolves.toBe(true);
  });

  it("rejects missing headers and empty secrets", async () => {
    await expect(verifyBachsSignature(body, new Headers(), secret, now)).resolves.toBe(false);
    await expect(
      verifyBachsSignature(body, await v2Headers(secret, now, body), "", now),
    ).resolves.toBe(false);
  });
});

describe("Bachs checkout", () => {
  it("creates a sandbox checkout in the account currency", async () => {
    vi.stubEnv("BACHS_API_KEY", "sk_sandbox_test");
    vi.stubEnv("BACHS_API_BASE_URL", "");
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        checkout_id: "ch_123",
        checkout_url: "https://checkout.bachs.io/ch_123",
        expires_at: "2026-11-25T12:00:00Z",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createBachsCheckout({
      amount: 250.5,
      currency: "NGN",
      reference: "VD-abc",
      metadata: { deposit_id: "dep_1", account_id: "acc_1" },
      successUrl: "https://vantor.test/accounts",
      cancelUrl: "https://vantor.test/accounts",
      email: "trader@example.com",
    });

    expect(result).toEqual({
      checkoutId: "ch_123",
      checkoutUrl: "https://checkout.bachs.io/ch_123",
      expiresAt: "2026-11-25T12:00:00Z",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://sandbox-api.bachs.io/v1/checkout-sessions");
    const headers = new Headers(init!.headers);
    expect(headers.get("Authorization")).toBe("Bearer sk_sandbox_test");
    expect(headers.get("Idempotency-Key")).toBe("VD-abc");
    expect(JSON.parse(String(init!.body))).toMatchObject({
      pricing: { currency: "NGN", amount: "250.50" },
      billing_currency: "NGN",
      payment_method_types: ["NGN_CARD", "NGN_BANK_TRANSFER"],
      success_url: "https://vantor.test/accounts",
      cancel_url: "https://vantor.test/accounts",
      reference: "VD-abc",
      metadata: { deposit_id: "dep_1", account_id: "acc_1" },
      customer: { email: "trader@example.com" },
      expires_in_minutes: 60,
    });
  });

  it("uses USD card payments and defaults to production for live keys", async () => {
    vi.stubEnv("BACHS_API_KEY", "sk_live_test");
    vi.stubEnv("BACHS_API_BASE_URL", "");
    expect(bachsApiBaseUrl()).toBe("https://api.bachs.io");
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        checkout_id: "ch_usd",
        checkout_url: "https://checkout.bachs.io/ch_usd",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createBachsCheckout({
      amount: 10,
      currency: "USD",
      reference: "VD-usd",
      metadata: {},
      successUrl: "https://vantor.test/accounts",
      cancelUrl: "https://vantor.test/accounts",
    });

    expect(result.expiresAt).toBeNull();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init!.body))).toMatchObject({
      pricing: { currency: "USD", amount: "10.00" },
      payment_method_types: ["USD_CARD"],
    });
    expect(JSON.parse(String(init!.body))).not.toHaveProperty("customer");
  });

  it("surfaces provider errors and invalid responses", async () => {
    vi.stubEnv("BACHS_API_KEY", "sk_sandbox_test");
    const errorFetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({ detail: "Amount is too small" }),
    }));
    vi.stubGlobal("fetch", errorFetch);
    await expect(
      createBachsCheckout({
        amount: 1,
        currency: "USD",
        reference: "VD-fail",
        metadata: {},
        successUrl: "https://vantor.test/accounts",
        cancelUrl: "https://vantor.test/accounts",
      }),
    ).rejects.toThrow("Amount is too small");

    const invalidFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ checkout_id: "ch_only" }),
    }));
    vi.stubGlobal("fetch", invalidFetch);
    await expect(
      createBachsCheckout({
        amount: 1,
        currency: "USD",
        reference: "VD-invalid",
        metadata: {},
        successUrl: "https://vantor.test/accounts",
        cancelUrl: "https://vantor.test/accounts",
      }),
    ).rejects.toThrow(/invalid response/);
  });
});
