import { findInstrument, getInstrument, midPrice, quote } from "./market";
import { MERIDIAN_QUOTE_STALE_MS } from "./meridian";

export type FeedSource = "live" | "cached" | "simulated";
export type MarketFeed = "meridian";

export type MarketQuote = {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  ts: number;
  receivedAt?: number;
  source: FeedSource;
  feed?: MarketFeed;
  feedFallback?: boolean;
  change?: number;
  high?: number;
  low?: number;
  marketOpen?: boolean;
};

export type QuoteMap = Record<string, MarketQuote>;

export const FALLBACK_MARKET_MESSAGE = "Live prices are unavailable";

export type ChartInterval =
  "1min" | "5min" | "15min" | "30min" | "1h" | "4h" | "1day" | "1week" | "1month";

export type MarketCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type MarketCandles = {
  symbol: string;
  interval: ChartInterval;
  candles: MarketCandle[];
  source: FeedSource;
  feed?: MarketFeed;
  fetchedAt: number;
};

export const CHART_INTERVALS: { value: ChartInterval; label: string; ms: number }[] = [
  { value: "1min", label: "1m", ms: 60_000 },
  { value: "5min", label: "5m", ms: 5 * 60_000 },
  { value: "15min", label: "15m", ms: 15 * 60_000 },
  { value: "30min", label: "30m", ms: 30 * 60_000 },
  { value: "1h", label: "1H", ms: 60 * 60_000 },
  { value: "4h", label: "4H", ms: 4 * 60 * 60_000 },
  { value: "1day", label: "1D", ms: 24 * 60 * 60_000 },
  { value: "1week", label: "1W", ms: 7 * 24 * 60 * 60_000 },
  { value: "1month", label: "1M", ms: 30 * 24 * 60 * 60_000 },
];

export function isInstrument(symbol: string): boolean {
  return findInstrument(symbol) != null;
}

export function intervalMs(interval: ChartInterval): number {
  return CHART_INTERVALS.find((item) => item.value === interval)?.ms ?? 60_000;
}

export function isChartInterval(value: unknown): value is ChartInterval {
  return typeof value === "string" && CHART_INTERVALS.some((item) => item.value === value);
}

export function syntheticQuote(symbol: string, ts: number): MarketQuote {
  const q = quote(symbol, ts);
  return { symbol, bid: q.bid, ask: q.ask, mid: q.mid, ts, source: "simulated" };
}

export function quoteFor(quotes: QuoteMap | undefined, symbol: string, ts: number): MarketQuote {
  const provided = quotes?.[symbol];
  if (provided && (provided.source !== "simulated" || provided.feedFallback)) return provided;
  if (findInstrument(symbol)?.synthetic === false) {
    return {
      symbol,
      bid: 0,
      ask: 0,
      mid: 0,
      ts,
      source: "simulated",
      feed: "meridian",
      feedFallback: true,
    };
  }
  return syntheticQuote(symbol, ts);
}

export function isStaleFeedQuote(quote: MarketQuote, now = Date.now()): boolean {
  if (quote.marketOpen === false) return true;
  if (quote.source === "simulated") return false;
  if (quote.source !== "live") return true;
  return now - quote.ts > MERIDIAN_QUOTE_STALE_MS;
}

export function isMarketClosedQuote(quote: MarketQuote): boolean {
  return quote.marketOpen === false;
}

export function isFallbackQuote(quote: MarketQuote): boolean {
  return quote.feedFallback === true;
}

export function syntheticCandles(
  symbol: string,
  interval: ChartInterval,
  points = 180,
  now = Date.now(),
): MarketCandle[] {
  const ms = intervalMs(interval);
  const lastBucket = Math.floor(now / ms) * ms;
  const candles: MarketCandle[] = [];
  for (let index = points - 1; index >= 0; index--) {
    const start = lastBucket - index * ms;
    const end = start + ms;
    const open = midPrice(symbol, start);
    const close = midPrice(symbol, end - 1);
    const samples = [
      open,
      close,
      midPrice(symbol, start + ms * 0.25),
      midPrice(symbol, start + ms * 0.5),
      midPrice(symbol, start + ms * 0.75),
    ];
    const high = Math.max(...samples);
    const low = Math.min(...samples);
    const spread = Math.max(getInstrument(symbol).spread, 1e-9);
    candles.push({
      time: Math.floor(start / 1000),
      open,
      high,
      low,
      close,
      volume: Math.max(1, Math.round(100 + ((high - low) / spread) * 25 + (start % 11) * 7)),
    });
  }
  return candles;
}

export function mergeQuotes(...maps: (QuoteMap | undefined)[]): QuoteMap {
  const result: QuoteMap = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [symbol, value] of Object.entries(map)) result[symbol] = value;
  }
  return result;
}
