import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./errors";
import type { TerminalEnv } from "./types";

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }
    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

let cached: { key: string; client: SupabaseClient<Database> } | undefined;

export function terminalAdmin(env: TerminalEnv): SupabaseClient<Database> {
  const url = env.SUPABASE_URL ?? process.env["SUPABASE_URL"];
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) {
    throw new ApiError(503, "not_configured", "Trading API is not configured");
  }
  const cacheKey = `${url}:${key}`;
  if (cached?.key === cacheKey) return cached.client;
  const client = createClient<Database>(url, key, {
    global: { fetch: createSupabaseFetch(key) },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  cached = { key: cacheKey, client };
  return client;
}
