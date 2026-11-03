import { z } from "zod";
import {
  CHART_INTERVALS,
  isInstrument,
  type ChartInterval,
  type MarketCandle,
} from "./market-data";

export const DEV_FEED_PATH = "/api/dev/feed/ingest";
export const FEED_STATUS_PATH = "/feed-status";
export const MARKET_FEED_INSTANCE = "markets-v4";
export const FEED_INTERNAL_HEADER = "x-vantor-feed";
export const FEED_INTERNAL_VALUE = "internal";
export const FEED_INTERNAL_BASE_URL = "https://market-feed.internal";

export const MAX_FEED_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_FEED_QUOTES = 21;
export const MAX_FEED_BARS_PER_SERIES = 1_500;
export const MAX_FEED_BARS_PER_REQUEST = 5_000;
export const MAX_FEED_SPREAD_PCT = 0.05;
export const MAX_FEED_FUTURE_MS = 5_000;
export const MAX_FEED_SKEW_MS = 60_000;
export const MAX_FEED_JUMP_GAP_MS = 60_000;
export const DEFAULT_FEED_STALE_MS = 10_000;
export const DEFAULT_FEED_MAX_JUMP_PCT = 0.05;
export const DEFAULT_FEED_RETENTION_BARS = 2_000;
export const QUOTE_SNAPSHOT_MS = 30_000;
export const BAR_PRUNE_MS = 60 * 60_000;
export const MAX_MISSING_HISTORY_BARS = 300;

const FEED_INTERVALS = CHART_INTERVALS.map((item) => item.value) as [
  ChartInterval,
  ...ChartInterval[],
];

export type FeedQuoteInput = {
  symbol: string;
  bid: number;
  ask: number;
  ts: number;
  marketOpen?: boolean;
  providerSymbol?: string;
};

export type FeedCandleInput = {
  symbol: string;
  interval: ChartInterval;
  snapshot: boolean;
  bars: MarketCandle[];
};

export type FeedPayload = {
  feedId: string;
  sentAt: number;
  serverOffsetMs?: number;
  quotes: FeedQuoteInput[];
  candles: FeedCandleInput[];
};

export type FeedQuoteRecord = {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  ts: number;
  marketOpen: boolean;
  stale: boolean;
  change?: number;
  high?: number;
  low?: number;
};

export type FeedCandlesResponse = {
  symbol: string;
  interval: ChartInterval;
  candles: MarketCandle[];
  stale: boolean;
};

export type FeedQuotesResponse = {
  quotes: FeedQuoteRecord[];
  stale: boolean;
};

export type FeedMissingSeries = {
  symbol: string;
  interval: ChartInterval;
  count: number;
  reason: "empty" | "stale";
};

export type FeedSeriesStatus = {
  symbol: string;
  interval: ChartInterval;
  latest: number | null;
};

export type FeedStatus = {
  feedId: string | null;
  lastIngestAt: number | null;
  lastSentAt: number | null;
  quoteCount: number;
  seriesCount: number;
  stale: boolean;
  quoteSnapshotAt: number | null;
  rowsWrittenToday: number;
  rowsWrittenPerDayEstimate: number;
  missing: FeedMissingSeries[];
  series: FeedSeriesStatus[];
};

export type FeedDailyBar = {
  open: number;
  high: number;
  low: number;
};

export type FeedValidationResult =
  { ok: true; payload: FeedPayload } | { ok: false; message: string };

const quoteSchema = z.object({
  symbol: z.string().refine(isInstrument, "Unknown market symbol"),
  bid: z.number().finite().positive(),
  ask: z.number().finite().positive(),
  ts: z.number().int().positive(),
  marketOpen: z.boolean().optional(),
  providerSymbol: z.string().trim().min(1).max(64).optional(),
});

const barSchema = z
  .object({
    time: z.number().int().positive(),
    open: z.number().finite().positive(),
    high: z.number().finite().positive(),
    low: z.number().finite().positive(),
    close: z.number().finite().positive(),
    volume: z.number().finite().nonnegative().optional(),
  })
  .superRefine((bar, context) => {
    if (bar.high < bar.low) {
      context.addIssue({ code: "custom", message: "high must be at least low" });
    }
    if (bar.high < bar.open || bar.high < bar.close) {
      context.addIssue({ code: "custom", message: "high must be at least open and close" });
    }
    if (bar.low > bar.open || bar.low > bar.close) {
      context.addIssue({ code: "custom", message: "low must be at most open and close" });
    }
  });

const seriesSchema = z.object({
  symbol: z.string().refine(isInstrument, "Unknown market symbol"),
  interval: z.enum(FEED_INTERVALS),
  snapshot: z.boolean().optional().default(false),
  bars: z.array(barSchema).min(1).max(MAX_FEED_BARS_PER_SERIES),
});

const payloadSchema = z.object({
  feedId: z.string().trim().min(1).max(64),
  sentAt: z.number().int().positive(),
  serverOffsetMs: z.number().int().optional(),
  quotes: z.array(quoteSchema).max(MAX_FEED_QUOTES).optional().default([]),
  candles: z.array(seriesSchema).max(MAX_FEED_QUOTES).optional().default([]),
});

function issueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid payload";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

function normalizeQuote(input: z.infer<typeof quoteSchema>): FeedQuoteInput {
  return {
    symbol: input.symbol,
    bid: input.bid,
    ask: input.ask,
    ts: input.ts,
    ...(input.marketOpen == null ? {} : { marketOpen: input.marketOpen }),
    ...(input.providerSymbol == null ? {} : { providerSymbol: input.providerSymbol }),
  };
}

function normalizeBar(input: z.infer<typeof barSchema>): MarketCandle {
  return {
    time: input.time,
    open: input.open,
    high: input.high,
    low: input.low,
    close: input.close,
    ...(input.volume == null ? {} : { volume: input.volume }),
  };
}

function normalizeSeries(input: z.infer<typeof seriesSchema>): FeedCandleInput {
  return {
    symbol: input.symbol,
    interval: input.interval,
    snapshot: input.snapshot,
    bars: input.bars.map(normalizeBar),
  };
}

export function validateFeedPayload(value: unknown, now = Date.now()): FeedValidationResult {
  const parsed = payloadSchema.safeParse(value);
  if (!parsed.success) return { ok: false, message: issueMessage(parsed.error) };
  if (Math.abs(parsed.data.sentAt - now) > MAX_FEED_SKEW_MS) {
    return { ok: false, message: "sentAt is outside the allowed clock skew" };
  }

  const quotes = parsed.data.quotes.map(normalizeQuote);
  const seenQuotes = new Set<string>();
  for (const quote of quotes) {
    if (seenQuotes.has(quote.symbol)) {
      return { ok: false, message: `Duplicate quote for ${quote.symbol}` };
    }
    seenQuotes.add(quote.symbol);
    if (quote.ask < quote.bid) {
      return { ok: false, message: `${quote.symbol}: ask must be at least bid` };
    }
    const mid = (quote.bid + quote.ask) / 2;
    if (quote.ask - quote.bid > mid * MAX_FEED_SPREAD_PCT) {
      return { ok: false, message: `${quote.symbol}: spread is too wide` };
    }
    if (quote.ts > now + MAX_FEED_FUTURE_MS) {
      return { ok: false, message: `${quote.symbol}: timestamp is in the future` };
    }
  }

  const candles = parsed.data.candles.map(normalizeSeries);
  const seenSeries = new Set<string>();
  let totalBars = 0;
  for (const series of candles) {
    const key = `${series.symbol}:${series.interval}`;
    if (seenSeries.has(key)) {
      return { ok: false, message: `Duplicate candle series for ${key}` };
    }
    seenSeries.add(key);
    totalBars += series.bars.length;
    if (series.bars.some((bar) => bar.time * 1000 > now + MAX_FEED_FUTURE_MS)) {
      return { ok: false, message: `${key}: candle timestamp is in the future` };
    }
  }
  if (totalBars > MAX_FEED_BARS_PER_REQUEST) {
    return { ok: false, message: "Too many candles in one request" };
  }

  return {
    ok: true,
    payload: {
      feedId: parsed.data.feedId,
      sentAt: parsed.data.sentAt,
      ...(parsed.data.serverOffsetMs == null ? {} : { serverOffsetMs: parsed.data.serverOffsetMs }),
      quotes,
      candles,
    },
  };
}

export function quoteJumpExceeded(
  next: { mid: number; ts: number },
  last: { mid: number; ts: number } | undefined,
  now = Date.now(),
  maxPct = DEFAULT_FEED_MAX_JUMP_PCT,
): boolean {
  if (!last || last.mid <= 0) return false;
  if (next.ts <= last.ts) return false;
  if (now - last.ts > MAX_FEED_JUMP_GAP_MS) return false;
  return Math.abs(next.mid / last.mid - 1) > maxPct;
}

export function maxFeedJumpPct(symbol: string): number {
  if (symbol === "BTCUSD" || symbol === "ETHUSD") return 0.25;
  if (symbol === "XAUUSD" || symbol === "XAGUSD" || symbol === "USOIL") return 0.1;
  if (symbol === "US30" || symbol === "NAS100" || symbol === "SPX500" || symbol === "UK100") {
    return 0.08;
  }
  if (symbol === "GER40") return 0.08;
  return 0.03;
}

export function computeFeedQuoteStats(
  mid: number,
  daily: FeedDailyBar | undefined,
): { change?: number; high?: number; low?: number } {
  if (!daily) return {};
  return {
    change: mid - daily.open,
    high: Math.max(daily.high, mid),
    low: Math.min(daily.low, mid),
  };
}

export function feedStaleMs(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 1_000 ? value : DEFAULT_FEED_STALE_MS;
}

export function feedRetentionBars(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 500 ? Math.round(value) : DEFAULT_FEED_RETENTION_BARS;
}

export function feedIsStale(
  lastIngestAt: number | null,
  now = Date.now(),
  staleMs = DEFAULT_FEED_STALE_MS,
): boolean {
  return lastIngestAt == null || now - lastIngestAt > staleMs;
}

export function quoteIsStale(
  ts: number,
  marketOpen: boolean,
  lastIngestAt: number | null,
  now = Date.now(),
  staleMs = DEFAULT_FEED_STALE_MS,
): boolean {
  return !marketOpen || feedIsStale(lastIngestAt, now, staleMs) || now - ts > staleMs;
}
