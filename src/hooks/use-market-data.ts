import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMarketCandles, getMarketQuotes } from "@/lib/market.functions";
import { isMarketDatafeedSymbol } from "@/lib/marketdatafeed";
import { mergeQuotes, type ChartInterval } from "@/lib/market-data";
import { useMarketDatafeedQuotes } from "./use-marketdatafeed-quotes";
import { useRealtimeQuotes } from "./use-realtime-quotes";

export function useMarketQuotes(
  symbols: string[],
  accountId: string | null,
  refetchInterval = 5_000,
) {
  const quotesFn = useServerFn(getMarketQuotes);
  const unique = useMemo(() => Array.from(new Set(symbols)).sort(), [symbols]);
  const key = unique.join(",");

  const query = useQuery({
    queryKey: ["market-quotes", key, accountId],
    queryFn: () => quotesFn({ data: { symbols: unique, accountId } }),
    enabled: unique.length > 0,
    refetchInterval,
    refetchIntervalInBackground: false,
    staleTime: 1_000,
    placeholderData: (previous) => previous,
  });

  const marketDatafeedSymbols = useMemo(() => {
    if (!query.data?.quotes || query.isPlaceholderData) return [];
    return unique.filter(
      (symbol) => isMarketDatafeedSymbol(symbol) && query.data?.quotes[symbol]?.feed !== "exness",
    );
  }, [unique, query.data?.quotes, query.isPlaceholderData]);
  const realtimeSymbols = useMemo(
    () =>
      unique.filter(
        (symbol) =>
          !isMarketDatafeedSymbol(symbol) && query.data?.quotes[symbol]?.feed !== "exness",
      ),
    [unique, query.data?.quotes],
  );
  const realtime = useRealtimeQuotes(realtimeSymbols, accountId);
  const marketDatafeed = useMarketDatafeedQuotes(marketDatafeedSymbols, accountId);

  const quotes = useMemo(() => {
    const live = Object.fromEntries(
      Object.entries(realtime.quotes).filter(
        ([symbol]) =>
          !isMarketDatafeedSymbol(symbol) && query.data?.quotes[symbol]?.feed !== "exness",
      ),
    );
    return mergeQuotes(query.data?.quotes, live, marketDatafeed.quotes);
  }, [query.data?.quotes, realtime.quotes, marketDatafeed.quotes]);

  return {
    quotes,
    fetchedAt: query.data?.fetchedAt ?? 0,
    isLoading: query.isPending,
    error: query.error,
    realtime: realtime.status,
    marketDatafeed: marketDatafeed.status,
    marketDatafeedError: marketDatafeed.error,
  };
}

export function useMarketCandles(
  symbol: string,
  interval: ChartInterval,
  points = 180,
  accountId: string | null = null,
  refetchInterval = 60_000,
) {
  const candlesFn = useServerFn(getMarketCandles);
  const query = useQuery({
    queryKey: ["market-candles", symbol, interval, points, accountId],
    queryFn: () => candlesFn({ data: { symbol, interval, points, accountId } }),
    refetchInterval,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  });

  return {
    candles: query.data?.candles ?? [],
    source: query.data?.source,
    feed: query.data?.feed,
    fetchedAt: query.data?.fetchedAt ?? 0,
    isLoading: query.isPending,
    error: query.error,
  };
}
