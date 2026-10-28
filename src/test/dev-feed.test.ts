import { describe, expect, it, vi } from "vitest";
import { handleDevFeedRequest } from "@/lib/dev-feed.server";
import { DEV_FEED_PATH, MAX_FEED_BODY_BYTES, MAX_FEED_SKEW_MS } from "@/lib/market-feed";
import { signHmacPayload } from "@/lib/realtime-ticket";

const SECRET = "test-dev-feed-secret-1234567890";
const URL = `https://vantor.example.com${DEV_FEED_PATH}`;

function payload(now = Date.now()) {
  return {
    feedId: "bridge-1",
    sentAt: now,
    quotes: [{ symbol: "EURUSD", bid: 1.1, ask: 1.1002, ts: now, marketOpen: true }],
    candles: [
      {
        symbol: "EURUSD",
        interval: "1min",
        snapshot: true,
        bars: [
          {
            time: Math.floor(now / 1000) - 60,
            open: 1.1,
            high: 1.1002,
            low: 1.0998,
            close: 1.1001,
          },
        ],
      },
    ],
  };
}

function feedEnv(overrides: Record<string, unknown> = {}) {
  const fetch = vi.fn(
    async (_request: Request) =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  return {
    fetch,
    env: {
      ALLOW_DEV_FEED: "true",
      DEV_FEED_SECRET: SECRET,
      MARKET_STREAM: {
        idFromName: () => "feed-id",
        get: () => ({ fetch }),
      },
      ...overrides,
    },
  };
}

async function signedRequest(
  body: unknown,
  options: { timestamp?: number; signature?: string; ip?: string } = {},
): Promise<Request> {
  const raw = JSON.stringify(body);
  const timestamp = options.timestamp ?? Date.now();
  const signature = options.signature ?? (await signHmacPayload(`${timestamp}.${raw}`, SECRET));
  return new Request(URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-feed-timestamp": String(timestamp),
      "x-feed-signature": signature,
      "cf-connecting-ip": options.ip ?? "203.0.113.10",
    },
    body: raw,
  });
}

describe("dev feed ingest route", () => {
  it("accepts a signed batch and forwards it to the durable object", async () => {
    const { env, fetch } = feedEnv();
    const body = payload();
    const response = await handleDevFeedRequest(await signedRequest(body), env);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, quotes: 1, series: 1, bars: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const forwarded = fetch.mock.calls[0]?.[0] as Request;
    expect(forwarded.url).toBe("https://market-feed.internal/internal/ingest");
    expect(forwarded.headers.get("x-vantor-feed")).toBe("internal");
    expect(await forwarded.json()).toMatchObject({ feedId: "bridge-1" });
  });

  it("hides the route when the feed is disabled", async () => {
    const { env, fetch } = feedEnv({ ALLOW_DEV_FEED: "false" });
    const response = await handleDevFeedRequest(await signedRequest(payload()), env);
    expect(response?.status).toBe(404);
    const probe = await handleDevFeedRequest(new Request(URL, { method: "GET" }), env);
    expect(probe?.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a missing secret, bad signature and old timestamp", async () => {
    const missing = feedEnv({ DEV_FEED_SECRET: "" });
    expect((await handleDevFeedRequest(await signedRequest(payload()), missing.env))?.status).toBe(
      503,
    );

    const bad = feedEnv();
    const badResponse = await handleDevFeedRequest(
      await signedRequest(payload(), { signature: "not-a-signature" }),
      bad.env,
    );
    expect(badResponse?.status).toBe(401);

    const old = feedEnv();
    const oldResponse = await handleDevFeedRequest(
      await signedRequest(payload(), { timestamp: Date.now() - MAX_FEED_SKEW_MS - 1_000 }),
      old.env,
    );
    expect(oldResponse?.status).toBe(401);
  });

  it("enforces the optional IP allowlist", async () => {
    const { env, fetch } = feedEnv({ DEV_FEED_ALLOWED_IPS: "203.0.113.10" });
    const blocked = await handleDevFeedRequest(
      await signedRequest(payload(), { ip: "198.51.100.1" }),
      env,
    );
    expect(blocked?.status).toBe(403);

    const allowed = await handleDevFeedRequest(
      await signedRequest(payload(), { ip: "203.0.113.10" }),
      env,
    );
    expect(allowed?.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid payloads, large bodies and wrong methods", async () => {
    const { env } = feedEnv();
    const invalid = await handleDevFeedRequest(
      await signedRequest({
        ...payload(),
        quotes: [{ symbol: "NOPE", bid: 1, ask: 1.1, ts: Date.now() }],
      }),
      env,
    );
    expect(invalid?.status).toBe(400);

    const large = await handleDevFeedRequest(
      new Request(URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-feed-timestamp": String(Date.now()),
          "x-feed-signature": "ignored",
        },
        body: "x".repeat(MAX_FEED_BODY_BYTES + 1),
      }),
      env,
    );
    expect(large?.status).toBe(413);

    const wrongMethod = await handleDevFeedRequest(new Request(URL, { method: "GET" }), env);
    expect(wrongMethod?.status).toBe(405);
  });

  it("ignores unrelated paths", async () => {
    const { env } = feedEnv();
    const response = await handleDevFeedRequest(
      new Request("https://vantor.example.com/health"),
      env,
    );
    expect(response).toBeNull();
  });
});
