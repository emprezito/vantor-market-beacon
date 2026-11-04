import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { isChartInterval, isInstrument, type ChartInterval } from "./market-data";

type AuthContext = { supabase: SupabaseClient<Database>; userId: string };

function validateAccountId(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new Error("Invalid trading account");
  }
  return value;
}

function validateSymbols(input: { symbols: string[]; accountId?: string | null }) {
  if (!Array.isArray(input.symbols)) throw new Error("Symbols are required");
  const symbols = Array.from(new Set(input.symbols.filter((symbol) => typeof symbol === "string" && isInstrument(symbol))));
  if (symbols.length === 0) throw new Error("No supported market symbols requested");
  if (symbols.length > 21) throw new Error("Too many market symbols requested");
  return { symbols, accountId: validateAccountId(input.accountId) };
}

async function accountServerId(
  context: AuthContext,
  accountId: string | null,
): Promise<string | null> {
  if (!accountId) return null;
  const { loadAccountForUser } = await import("./trading-service.server");
  const account = await loadAccountForUser(context.supabase, context.userId, accountId);
  return account.server_id;
}

export const getMarketQuotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validateSymbols)
  .handler(async ({ data, context }) => {
    const { loadQuotes } = await import("./market-data.server");
    const serverId = await accountServerId(context, data.accountId);
    return {
      quotes: await loadQuotes(data.symbols, { serverId }),
      fetchedAt: Date.now(),
    };
  });

export const getMarketCandles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      symbol: string;
      interval: ChartInterval;
      points?: number;
      accountId?: string | null;
    }) => {
      if (typeof input.symbol !== "string" || !isInstrument(input.symbol)) throw new Error("Unknown instrument");
      if (!isChartInterval(input.interval)) throw new Error("Invalid chart interval");
      const points = input.points == null ? 180 : Math.round(input.points);
      if (!Number.isFinite(points) || points < 20 || points > 500) throw new Error("Invalid candle count");
      return {
        symbol: input.symbol,
        interval: input.interval,
        points,
        accountId: validateAccountId(input.accountId),
      };
    },
  )
  .handler(async ({ data, context }) => {
    const { loadCandles } = await import("./market-data.server");
    const serverId = await accountServerId(context, data.accountId);
    return loadCandles(data.symbol, data.interval, data.points, { serverId });
  });
