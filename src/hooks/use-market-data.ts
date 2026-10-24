import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMarketCandles, getMarketQuotes } from "@/lib/market.functions";
import { mergeQuotes, type ChartInterval } from "@/lib/market-data";
import { useRealtimeQuotes } from "./use-realtime-quotes";

export function useMarketQuotes(symbols: string[], refetchInterval = 5_000) {
  const quotesFn = useServerFn(getMarketQuotes);
  const unique = useMemo(() => Array.from(new Set(symbols)).sort(), [symbols]);
  const key = unique.join(",");
  const realtime = useRealtimeQuotes(unique);

  const query = useQuery({
    queryKey: ["market-quotes", key],
    queryFn: () => quotesFn({ data: { symbols: unique } }),
    enabled: unique.length > 0,
    refetchInterval,
    refetchIntervalInBackground: false,
    staleTime: 1_000,
    placeholderData: (previous) => previous,
  });

  const quotes = useMemo(
    () => mergeQuotes(query.data?.quotes, realtime.quotes),
    [query.data?.quotes, realtime.quotes],
  );

  return {
    quotes,
    fetchedAt: query.data?.fetchedAt ?? 0,
    isLoading: query.isPending,
    error: query.error,
    realtime: realtime.status,
  };
}

export function useMarketCandles(symbol: string, interval: ChartInterval, points = 180, refetchInterval = 60_000) {
  const candlesFn = useServerFn(getMarketCandles);
  const query = useQuery({
    queryKey: ["market-candles", symbol, interval, points],
    queryFn: () => candlesFn({ data: { symbol, interval, points } }),
    refetchInterval,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  });

  return {
    candles: query.data?.candles ?? [],
    source: query.data?.source,
    fetchedAt: query.data?.fetchedAt ?? 0,
    isLoading: query.isPending,
    error: query.error,
  };
}
