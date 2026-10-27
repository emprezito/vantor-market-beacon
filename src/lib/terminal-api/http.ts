import type { z } from "zod";
import { ApiError } from "./errors";
import type { CorsContext, TerminalEnv } from "./types";

const MAX_BODY_BYTES = 16 * 1024;
const DEFAULT_ORIGINS = [
  "https://emprezito-pocket-markets.fundedng.workers.dev",
  "https://localhost",
  "capacitor://localhost",
];

function allowedOrigins(env: TerminalEnv): string[] {
  const configured = (env.ALLOWED_ORIGINS ?? process.env["ALLOWED_ORIGINS"] ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origins = configured.length > 0 ? configured : DEFAULT_ORIGINS;
  const dev = (env.ALLOW_DEV_ORIGINS ?? process.env["ALLOW_DEV_ORIGINS"]) === "true";
  return dev ? [...origins, "http://localhost:8080"] : origins;
}

export function corsFor(request: Request, env: TerminalEnv): CorsContext {
  const origin = request.headers.get("origin");
  if (!origin) return { origin: null, headers: {} };
  if (!allowedOrigins(env).includes(origin)) {
    throw new ApiError(403, "origin_not_allowed", "This origin is not allowed");
  }
  return {
    origin,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "access-control-allow-headers": "Authorization, Content-Type, Idempotency-Key",
      "access-control-max-age": "600",
      vary: "Origin",
    },
  };
}

export function json(
  cors: CorsContext,
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...cors.headers,
      ...headers,
    },
  });
}

export function preflight(cors: CorsContext) {
  return new Response(null, { status: 204, headers: cors.headers });
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new ApiError(413, "payload_too_large", "Request body is too large");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    throw new ApiError(413, "payload_too_large", "Request body is too large");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON");
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(
      400,
      "validation_error",
      parsed.error.issues[0]?.message ?? "Invalid request",
    );
  }
  return parsed.data;
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}
