import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isChartInterval, isInstrument, type ChartInterval } from "./market-data";

function validateSymbols(input: { symbols: string[] }) {
  if (!Array.isArray(input.symbols)) throw new Error("Symbols are required");
  const symbols = Array.from(new Set(input.symbols.filter((symbol) => typeof symbol === "string" && isInstrument(symbol))));
  if (symbols.length === 0) throw new Error("No supported market symbols requested");
  if (symbols.length > 21) throw new Error("Too many market symbols requested");
  return { symbols };
}

export const getMarketQuotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validateSymbols)
  .handler(async ({ data }) => {
    const { loadQuotes } = await import("./market-data.server");
    return { quotes: await loadQuotes(data.symbols), fetchedAt: Date.now() };
  });

export const getMarketCandles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { symbol: string; interval: ChartInterval; points?: number }) => {
    if (typeof input.symbol !== "string" || !isInstrument(input.symbol)) throw new Error("Unknown instrument");
    if (!isChartInterval(input.interval)) throw new Error("Invalid chart interval");
    const points = input.points == null ? 180 : Math.round(input.points);
    if (!Number.isFinite(points) || points < 20 || points > 500) throw new Error("Invalid candle count");
    return { symbol: input.symbol, interval: input.interval, points };
  })
  .handler(async ({ data }) => {
    const { loadCandles } = await import("./market-data.server");
    return loadCandles(data.symbol, data.interval, data.points);
  });
