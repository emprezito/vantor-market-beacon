import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMarketCandles, getMarketQuotes } from "@/lib/market.functions";
import { mergeQuotes, type ChartInterval, type MarketCandle } from "@/lib/market-data";
import { useMeridianQuotes } from "./use-meridian-quotes";

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

  const realtime = useMeridianQuotes(unique, accountId);
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
    realtimeError: realtime.error,
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
  const historyKey = `${symbol}:${interval}:${points}:${accountId ?? "anonymous"}`;
  const [history, setHistory] = useState<{
    key: string;
    pages: MarketCandle[][];
    hasOlder: boolean;
  }>({ key: historyKey, pages: [], hasOlder: true });
  const query = useQuery({
    queryKey: ["market-candles", symbol, interval, points, accountId],
    queryFn: () => candlesFn({ data: { symbol, interval, points, accountId } }),
    refetchInterval,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  });
  const activeHistory = history.key === historyKey ? history : null;
  const candles = useMemo(() => {
    const byTime = new Map<number, MarketCandle>();
    for (const page of activeHistory?.pages ?? []) {
      for (const candle of page) byTime.set(candle.time, candle);
    }
    for (const candle of query.data?.candles ?? []) byTime.set(candle.time, candle);
    return Array.from(byTime.values()).sort((left, right) => left.time - right.time);
  }, [activeHistory?.pages, query.data?.candles]);
  const older = useMutation({
    mutationFn: (request: {
      key: string;
      symbol: string;
      interval: ChartInterval;
      points: number;
      accountId: string | null;
      before: number;
    }) =>
      candlesFn({
        data: {
          symbol: request.symbol,
          interval: request.interval,
          points: request.points,
          accountId: request.accountId,
          before: request.before,
        },
      }),
    onSuccess: (page, request) => {
      const boundary = (request.before + 1) / 1000;
      const olderCandles = page.candles.filter((candle) => candle.time < boundary);
      setHistory((current) => {
        const pages = current.key === request.key ? current.pages : [];
        const known = new Set(pages.flat().map((candle) => candle.time));
        const unique = olderCandles.filter((candle) => !known.has(candle.time));
        return {
          key: request.key,
          pages: unique.length > 0 ? [...pages, unique] : pages,
          hasOlder: page.source !== "simulated" && unique.length > 0,
        };
      });
    },
  });
  const oldest = candles[0]?.time;
  const hasOlder =
    oldest != null && query.data?.source !== "simulated" && (activeHistory?.hasOlder ?? true);
  const loadOlder = () => {
    if (!hasOlder || older.isPending || oldest == null) return;
    older.mutate({
      key: historyKey,
      symbol,
      interval,
      points,
      accountId,
      before: oldest * 1000 - 1,
    });
  };

  return {
    candles,
    source: query.data?.source,
    feed: query.data?.feed,
    fetchedAt: query.data?.fetchedAt ?? 0,
    isLoading: query.isPending,
    error: query.error,
    loadOlder,
    hasOlder,
    isLoadingOlder: older.isPending,
  };
}
