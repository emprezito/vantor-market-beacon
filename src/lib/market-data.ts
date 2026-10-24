import { INSTRUMENTS, getInstrument, midPrice, quote } from "./market";

export type FeedSource = "live" | "cached" | "simulated";

export type MarketQuote = {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  ts: number;
  source: FeedSource;
};

export type QuoteMap = Record<string, MarketQuote>;

export type ChartInterval = "1min" | "5min" | "15min" | "30min" | "1h";

export type MarketCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type MarketCandles = {
  symbol: string;
  interval: ChartInterval;
  candles: MarketCandle[];
  source: FeedSource;
  fetchedAt: number;
};

export const CHART_INTERVALS: { value: ChartInterval; label: string; ms: number }[] = [
  { value: "1min", label: "1m", ms: 60_000 },
  { value: "5min", label: "5m", ms: 5 * 60_000 },
  { value: "15min", label: "15m", ms: 15 * 60_000 },
  { value: "30min", label: "30m", ms: 30 * 60_000 },
  { value: "1h", label: "1H", ms: 60 * 60_000 },
];

export const PROVIDER_SYMBOLS: Record<string, string> = {
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  USDCAD: "USD/CAD",
  USDCHF: "USD/CHF",
  AUDUSD: "AUD/USD",
  NZDUSD: "NZD/USD",
  EURGBP: "EUR/GBP",
  EURJPY: "EUR/JPY",
  GBPJPY: "GBP/JPY",
  AUDJPY: "AUD/JPY",
  XAUUSD: "XAU/USD",
  XAGUSD: "XAG/USD",
  USOIL: "WTI/USD",
  US30: "DJI",
  NAS100: "NDX",
  SPX500: "SPX",
  UK100: "FTSE",
  BTCUSD: "BTC/USD",
  ETHUSD: "ETH/USD",
};

export function isInstrument(symbol: string): boolean {
  return INSTRUMENTS.some((instrument) => instrument.symbol === symbol);
}

export function intervalMs(interval: ChartInterval): number {
  return CHART_INTERVALS.find((item) => item.value === interval)?.ms ?? 60_000;
}

export function isChartInterval(value: unknown): value is ChartInterval {
  return typeof value === "string" && CHART_INTERVALS.some((item) => item.value === value);
}

export function withSpread(symbol: string, mid: number, ts: number, source: FeedSource): MarketQuote {
  const instrument = getInstrument(symbol);
  return {
    symbol,
    bid: mid - instrument.spread / 2,
    ask: mid + instrument.spread / 2,
    mid,
    ts,
    source,
  };
}

export function syntheticQuote(symbol: string, ts: number): MarketQuote {
  const q = quote(symbol, ts);
  return { symbol, bid: q.bid, ask: q.ask, mid: q.mid, ts, source: "simulated" };
}

export function quoteFor(quotes: QuoteMap | undefined, symbol: string, ts: number): MarketQuote {
  const provided = quotes?.[symbol];
  if (provided && provided.source !== "simulated") return provided;
  return syntheticQuote(symbol, ts);
}

export function syntheticCandles(symbol: string, interval: ChartInterval, points = 180, now = Date.now()): MarketCandle[] {
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
    candles.push({
      time: Math.floor(start / 1000),
      open,
      high: Math.max(...samples),
      low: Math.min(...samples),
      close,
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
