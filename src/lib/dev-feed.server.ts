import {
  DEV_FEED_PATH,
  MAX_FEED_BODY_BYTES,
  MAX_FEED_SKEW_MS,
  validateFeedPayload,
} from "./market-feed";
import { feedEnabled, ingestFeedPayload, type FeedRuntimeEnv } from "./market-feed.server";
import { signaturesMatch, signHmacPayload } from "./realtime-ticket";

type DevFeedEnv = FeedRuntimeEnv & {
  DEV_FEED_SECRET?: string;
  DEV_FEED_ALLOWED_IPS?: string;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    ""
  );
}

function ipAllowed(ip: string, raw: string | undefined): boolean {
  if (!raw) return true;
  const allowed = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (allowed.length === 0) return true;
  return ip !== "" && allowed.includes(ip);
}

async function readLimitedBody(request: Request, limit: number): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared) {
    const size = Number(declared);
    if (Number.isFinite(size) && size > limit) return null;
  }

  const body = request.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export async function handleDevFeedRequest(
  request: Request,
  env: DevFeedEnv,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== DEV_FEED_PATH) return null;
  if (!feedEnabled(env)) return json({ error: "not_found" }, 404);
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: {
        "content-type": "application/json; charset=utf-8",
        allow: "POST",
        "cache-control": "no-store",
      },
    });
  }

  const secret = env.DEV_FEED_SECRET;
  if (!secret) return json({ error: "feed_not_configured" }, 503);

  if (!ipAllowed(clientIp(request), env.DEV_FEED_ALLOWED_IPS)) {
    return json({ error: "forbidden" }, 403);
  }

  const timestampHeader = request.headers.get("x-feed-timestamp") ?? "";
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > MAX_FEED_SKEW_MS) {
    return json({ error: "invalid_timestamp" }, 401);
  }

  const raw = await readLimitedBody(request, MAX_FEED_BODY_BYTES);
  if (raw == null) return json({ error: "payload_too_large" }, 413);

  const signature = request.headers.get("x-feed-signature") ?? "";
  const expected = await signHmacPayload(`${timestampHeader}.${raw}`, secret);
  if (!signaturesMatch(signature, expected)) return json({ error: "invalid_signature" }, 401);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const validation = validateFeedPayload(parsed, Date.now());
  if (!validation.ok) {
    return json({ error: "invalid_payload", message: validation.message }, 400);
  }

  try {
    await ingestFeedPayload(validation.payload, env);
  } catch {
    return json({ error: "feed_unavailable" }, 503);
  }

  return json({
    ok: true,
    quotes: validation.payload.quotes.length,
    series: validation.payload.candles.length,
    bars: validation.payload.candles.reduce((total, item) => total + item.bars.length, 0),
  });
}
