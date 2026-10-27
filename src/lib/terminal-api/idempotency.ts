import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { ApiError } from "./errors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requestHash(request: Request, body: unknown) {
  const url = new URL(request.url);
  const input = new TextEncoder().encode(
    `${request.method} ${url.pathname} ${JSON.stringify(body ?? null)}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function withIdempotency<T>(
  admin: SupabaseClient<Database>,
  accountId: string,
  request: Request,
  body: unknown,
  run: () => Promise<T>,
): Promise<T> {
  const key = request.headers.get("idempotency-key");
  if (!key) return run();
  if (!UUID_RE.test(key)) {
    throw new ApiError(400, "invalid_idempotency_key", "Idempotency-Key must be a UUID");
  }

  const hash = await requestHash(request, body);
  let reserved = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { error: insertError } = await admin.from("terminal_idempotency").insert({
      account_id: accountId,
      idempotency_key: key,
      request_hash: hash,
    });
    if (!insertError) {
      reserved = true;
      break;
    }

    if (insertError.code !== "23505") {
      throw new ApiError(
        503,
        "service_unavailable",
        "Could not reserve this request. Please try again.",
      );
    }

    const { data, error } = await admin
      .from("terminal_idempotency")
      .select("request_hash, status, response, expires_at")
      .eq("account_id", accountId)
      .eq("idempotency_key", key)
      .maybeSingle();
    if (error || !data) {
      throw new ApiError(
        503,
        "service_unavailable",
        "Could not load this request. Please try again.",
      );
    }
    if (data.request_hash !== hash) {
      throw new ApiError(
        409,
        "idempotency_conflict",
        "This idempotency key was used for a different request",
      );
    }
    if (data.status === "completed" && data.response != null) {
      return data.response as T;
    }
    if (new Date(data.expires_at).getTime() <= Date.now()) {
      await admin
        .from("terminal_idempotency")
        .delete()
        .eq("account_id", accountId)
        .eq("idempotency_key", key);
      continue;
    }
    throw new ApiError(409, "request_in_progress", "This request is already being processed");
  }
  if (!reserved) {
    throw new ApiError(
      503,
      "service_unavailable",
      "Could not reserve this request. Please try again.",
    );
  }

  try {
    const result = await run();
    await admin
      .from("terminal_idempotency")
      .update({ status: "completed", response: result as Json })
      .eq("account_id", accountId)
      .eq("idempotency_key", key);
    return result;
  } catch (error) {
    await admin
      .from("terminal_idempotency")
      .delete()
      .eq("account_id", accountId)
      .eq("idempotency_key", key);
    throw error;
  }
}
