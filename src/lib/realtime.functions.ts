import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAccountForUser } from "./trading-service.server";
import { meridianProviderSymbols, meridianWsUrl, requestMeridianWsToken } from "./meridian.server";

const tokenBuckets = new Map<string, number[]>();

function checkTokenRate(accountId: string): void {
  const now = Date.now();
  const recent = (tokenBuckets.get(accountId) ?? []).filter((at) => now - at < 60_000);
  if (recent.length >= 20) throw new Error("Too many market stream reconnects. Please wait.");
  recent.push(now);
  tokenBuckets.set(accountId, recent);
}

export const getMeridianWsToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { accountId: string; symbols: string[] }) => {
    if (typeof input.accountId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.accountId)) {
      throw new Error("Invalid trading account");
    }
    if (!Array.isArray(input.symbols)) throw new Error("Market symbols are required");
    const symbols = Array.from(
      new Set(
        input.symbols
          .filter((symbol): symbol is string => typeof symbol === "string")
          .map((symbol) => symbol.trim())
          .filter(Boolean),
      ),
    );
    if (symbols.length === 0 || symbols.length > 100) {
      throw new Error("Invalid market symbol selection");
    }
    return { accountId: input.accountId, symbols };
  })
  .handler(async ({ data, context }) => {
    const account = await loadAccountForUser(context.supabase, context.userId, data.accountId);
    if (account.status !== "active") throw new Error("Trading account is not active");
    checkTokenRate(account.id);

    const subscriptions = await meridianProviderSymbols(data.symbols);
    if (subscriptions.size === 0) throw new Error("No supported Meridian symbols requested");
    const token = await requestMeridianWsToken();
    const expiresAt =
      token.expires_at > 10_000_000_000 ? token.expires_at : token.expires_at * 1_000;

    return {
      token: token.token,
      expiresAt,
      wsUrl: meridianWsUrl(),
      subscriptions: Object.fromEntries(subscriptions),
    };
  });
