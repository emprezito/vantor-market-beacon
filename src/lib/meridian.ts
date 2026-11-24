import type { ChartInterval, MarketQuote } from "./market-data";
import { marketOpenForInstrument } from "./market-hours";

export const MERIDIAN_DEFAULT_API_BASE_URL = "http://localhost:8000/api/v1";
export const MERIDIAN_DEFAULT_WS_URL = "ws://localhost:8000/ws/v1/market";
export const MERIDIAN_QUOTE_STALE_MS = 5_000;
export const MERIDIAN_STREAM_IDLE_MS = 20_000;
export const MERIDIAN_TOKEN_REFRESH_LEAD_MS = 60_000;

export function meridianTokenRefreshDelayMs(expiresAt: number, now = Date.now()): number {
  const ttl = Math.max(1_000, expiresAt - now);
  if (ttl > MERIDIAN_TOKEN_REFRESH_LEAD_MS + 10_000) return ttl - MERIDIAN_TOKEN_REFRESH_LEAD_MS;
  return Math.max(1_000, Math.round(ttl * 0.8));
}

export const MERIDIAN_TIMEFRAMES: Record<ChartInterval, string> = {
  "1min": "M1",
  "5min": "M5",
  "15min": "M15",
  "30min": "M30",
  "1h": "H1",
  "4h": "H4",
  "1day": "D1",
  "1week": "W1",
  "1month": "MN1",
};

export type MeridianInstrument = {
  symbol: string;
  source_symbol?: string | null;
  asset_class?: string | null;
  base_currency?: string | null;
  quote_currency?: string | null;
  digits?: number | null;
  point?: number | null;
  tick_size?: number | null;
  contract_size?: number | null;
  enabled?: boolean | null;
  metadata?: Record<string, unknown> | null;
};

export type MeridianQuote = {
  provider?: string;
  symbol: string;
  source_symbol?: string | null;
  bid: number;
  ask: number;
  last?: number | null;
  volume?: number | null;
  flags?: number | null;
  timestamp?: string | null;
  timestamp_ms?: number | null;
  received_at?: string | null;
};

export type MeridianCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  tick_count?: number | null;
  complete?: boolean | null;
};

export type MeridianCandleResponse = {
  symbol: string;
  timeframe: string;
  price_type: string;
  count: number;
  candles: MeridianCandle[];
};

export type MeridianWsToken = {
  token: string;
  expires_at: number;
};

export type MeridianStreamMessage = {
  event: string;
  data?: unknown;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function parseMeridianQuote(value: unknown): MeridianQuote | null {
  if (!isRecord(value)) return null;
  const symbol = value["symbol"];
  const bid = value["bid"];
  const ask = value["ask"];
  if (typeof symbol !== "string" || !symbol.trim()) return null;
  if (!finitePositive(bid) || !finitePositive(ask) || ask < bid) return null;

  const timestampMs = value["timestamp_ms"];
  const timestamp = value["timestamp"];
  const parsedTimestamp =
    typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp))
      ? Date.parse(timestamp)
      : null;
  const safeTimestamp =
    typeof timestampMs === "number" && Number.isSafeInteger(timestampMs) && timestampMs > 0
      ? timestampMs
      : parsedTimestamp;
  if (safeTimestamp == null) return null;

  const last = value["last"];
  const volume = value["volume"];
  const flags = value["flags"];
  const sourceSymbol = value["source_symbol"];
  const receivedAt = value["received_at"];
  const provider = value["provider"];

  return {
    symbol: symbol.trim(),
    bid,
    ask,
    timestamp_ms: safeTimestamp,
    ...(typeof provider === "string" ? { provider } : {}),
    ...(typeof sourceSymbol === "string" ? { source_symbol: sourceSymbol } : {}),
    ...(finitePositive(last) ? { last } : {}),
    ...(typeof volume === "number" && Number.isFinite(volume) ? { volume } : {}),
    ...(typeof flags === "number" && Number.isFinite(flags) ? { flags } : {}),
    ...(typeof timestamp === "string" ? { timestamp } : {}),
    ...(typeof receivedAt === "string" ? { received_at: receivedAt } : {}),
  };
}

export function marketQuoteFromMeridian(
  quote: MeridianQuote,
  symbol: string,
  source: "live" | "cached" = "live",
): MarketQuote {
  const receivedAt = quote.received_at ? Date.parse(quote.received_at) : NaN;
  const marketOpen = marketOpenForInstrument(symbol);
  return {
    symbol,
    bid: quote.bid,
    ask: quote.ask,
    mid: (quote.bid + quote.ask) / 2,
    ts: quote.timestamp_ms ?? Date.now(),
    source,
    feed: "meridian",
    ...(marketOpen == null ? {} : { marketOpen }),
    ...(Number.isFinite(receivedAt) ? { receivedAt } : {}),
  };
}

export function parseMeridianStreamMessage(value: unknown): MeridianStreamMessage | null {
  if (!isRecord(value) || typeof value["event"] !== "string") return null;
  return { event: value["event"], ...(value["data"] === undefined ? {} : { data: value["data"] }) };
}

export function displayMeridianSymbol(
  symbol: string,
  baseCurrency?: string | null,
  quoteCurrency?: string | null,
): string {
  if (baseCurrency && quoteCurrency) return `${baseCurrency}/${quoteCurrency}`;
  return symbol;
}
