import {
  isChartInterval,
  isInstrument,
  PROVIDER_SYMBOLS,
  syntheticCandles,
  syntheticQuote,
  withSpread,
  type ChartInterval,
  type FeedSource,
  type MarketCandle,
  type MarketCandles,
  type MarketQuote,
  type QuoteMap,
} from "./market-data";
import {
  feedEnabled,
  loadFeedCandles,
  loadFeedQuotesResult,
  type FeedQuotesResult,
} from "./market-feed.server";

const API_URL = "https://api.twelvedata.com";
const DEFAULT_QUOTE_TTL_MS = 60_000;
const DEFAULT_FX_RATE_TTL_MS = 15 * 60_000;
const PROVIDER_FAILURE_COOLDOWN_MS = 60_000;
const PROVIDER_PLAN_COOLDOWN_MS = 15 * 60_000;

type TwelveError = {
  status?: string;
  code?: number;
  message?: string;
};

type PriceResponse = TwelveError & {
  price?: string;
};

type TimeSeriesValue = {
  datetime?: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
};

type TimeSeriesResponse = TwelveError & {
  values?: TimeSeriesValue[];
};

type KeyState = {
  value: string;
  limitedUntil: number;
};

class ProviderError extends Error {
  retryAfterMs: number;

  constructor(message: string, retryAfterMs = PROVIDER_FAILURE_COOLDOWN_MS) {
    super(message);
    this.name = "ProviderError";
    this.retryAfterMs = retryAfterMs;
  }
}

function providerRetryMs(payload: TwelveError): number {
  if (payload.code === 404 || /available starting with|upgrade|plan/i.test(payload.message ?? "")) {
    return PROVIDER_PLAN_COOLDOWN_MS;
  }
  return PROVIDER_FAILURE_COOLDOWN_MS;
}

function failureRetryMs(error: unknown): number {
  return error instanceof ProviderError ? error.retryAfterMs : PROVIDER_FAILURE_COOLDOWN_MS;
}

const quoteCache = new Map<string, { quote: MarketQuote; fetchedAt: number }>();
const candleCache = new Map<string, { series: MarketCandles; fetchedAt: number }>();
const fxRateCache = new Map<string, { rate: number; fetchedAt: number }>();
const inFlightQuotes = new Map<string, Promise<MarketQuote>>();
const inFlightCandles = new Map<string, Promise<MarketCandles>>();
const inFlightFxRates = new Map<string, Promise<number>>();
const quoteRetryAfter = new Map<string, number>();
const candleRetryAfter = new Map<string, number>();
const fxRateRetryAfter = new Map<string, number>();
let keys: KeyState[] | null = null;
let keyCursor = 0;

function configuredKeys(): string[] {
  const raw = [process.env["TWELVE_DATA_API_KEYS"], process.env["TWELVE_DATA_API_KEY"]]
    .filter((value): value is string => Boolean(value))
    .join(",");
  return Array.from(
    new Set(
      raw
        .split(/[\s,;]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function keyStates(): KeyState[] {
  if (!keys) keys = configuredKeys().map((value) => ({ value, limitedUntil: 0 }));
  return keys;
}

function takeKey(now = Date.now()): KeyState | null {
  const states = keyStates();
  if (states.length === 0) return null;
  for (let offset = 0; offset < states.length; offset++) {
    const index = (keyCursor + offset) % states.length;
    const state = states[index]!;
    if (state.limitedUntil > now) continue;
    keyCursor = (index + 1) % states.length;
    return state;
  }
  return null;
}

function rateLimitResetAt(message: string | undefined): number {
  const now = Date.now();
  if (message && /daily|current day|per day/i.test(message)) {
    const nextDay = new Date(now);
    nextDay.setUTCHours(24, 0, 0, 0);
    return nextDay.getTime() + 1_000;
  }
  return now + (60_000 - (now % 60_000)) + 1_000;
}

function quoteTtlMs(): number {
  const raw = Number(process.env["MARKET_QUOTE_TTL_MS"]);
  return Number.isFinite(raw) && raw >= 1_000 ? raw : DEFAULT_QUOTE_TTL_MS;
}

function candleTtlMs(interval: ChartInterval): number {
  const raw = Number(process.env["MARKET_CANDLE_TTL_MS"]);
  if (Number.isFinite(raw) && raw >= 1_000) return raw;
  if (interval === "1min") return 60_000;
  if (interval === "5min") return 120_000;
  if (interval === "15min") return 300_000;
  if (interval === "30min") return 600_000;
  if (interval === "1h") return 900_000;
  if (interval === "4h") return 15 * 60_000;
  if (interval === "1day") return 30 * 60_000;
  if (interval === "1week") return 2 * 60 * 60_000;
  return 6 * 60 * 60_000;
}

function providerMessage(payload: TwelveError): string {
  return payload.message || `Twelve Data request failed${payload.code ? ` (${payload.code})` : ""}`;
}

async function fetchTwelve<T extends TwelveError>(
  path: string,
  params: Record<string, string>,
): Promise<T | null> {
  const states = keyStates();
  if (states.length === 0) return null;

  const url = new URL(`${API_URL}${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);

  for (let attempt = 0; attempt < states.length; attempt++) {
    const state = takeKey();
    if (!state) throw new Error("Market data rate limit reached");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", Authorization: `apikey ${state.value}` },
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as T;

      if (response.status === 429 || payload.code === 429) {
        state.limitedUntil = rateLimitResetAt(payload.message);
        continue;
      }
      if (!response.ok || payload.status === "error") {
        throw new ProviderError(providerMessage(payload), providerRetryMs(payload));
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Market data rate limit reached");
}

async function fetchLiveQuote(symbol: string): Promise<MarketQuote> {
  const providerSymbol = PROVIDER_SYMBOLS[symbol];
  if (!providerSymbol) throw new Error(`No market data mapping for ${symbol}`);

  const payload = await fetchTwelve<PriceResponse>("/price", { symbol: providerSymbol });
  if (!payload) throw new Error("Market data key is not configured");

  const mid = Number(payload.price);
  if (!Number.isFinite(mid) || mid <= 0) throw new Error(`Invalid market price for ${symbol}`);

  return withSpread(symbol, mid, Date.now(), "live");
}

async function loadQuote(symbol: string): Promise<MarketQuote> {
  if (!PROVIDER_SYMBOLS[symbol]) return syntheticQuote(symbol, Date.now());

  const cached = quoteCache.get(symbol);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < quoteTtlMs()) {
    return { ...cached.quote, source: "live" };
  }

  const retryAfter = quoteRetryAfter.get(symbol);
  if (retryAfter && now < retryAfter) {
    if (cached) return { ...cached.quote, source: "cached" as FeedSource };
    return syntheticQuote(symbol, now);
  }

  const pending = inFlightQuotes.get(symbol);
  if (pending) return pending;

  const request = fetchLiveQuote(symbol)
    .then((quote) => {
      quoteRetryAfter.delete(symbol);
      quoteCache.set(symbol, { quote, fetchedAt: Date.now() });
      return quote;
    })
    .catch((error) => {
      quoteRetryAfter.set(symbol, Date.now() + failureRetryMs(error));
      if (cached) return { ...cached.quote, source: "cached" as FeedSource };
      return syntheticQuote(symbol, Date.now());
    })
    .finally(() => inFlightQuotes.delete(symbol));

  inFlightQuotes.set(symbol, request);
  return request;
}

export async function loadQuotes(symbols: string[]): Promise<QuoteMap> {
  const unique = Array.from(new Set(symbols)).filter(isInstrument);
  const configured = feedEnabled();
  const feed: FeedQuotesResult = await loadFeedQuotesResult(unique).catch(() => ({
    quotes: {},
    enabled: configured,
    available: false,
    stale: true,
  }));
  const fallback = feed.enabled && (!feed.available || feed.stale);
  const missing = unique.filter((symbol) => !feed.quotes[symbol]);
  const quotes = await Promise.all(missing.map(loadQuote));
  return {
    ...feed.quotes,
    ...Object.fromEntries(
      quotes.map((quote) => [quote.symbol, fallback ? { ...quote, feedFallback: true } : quote]),
    ),
  };
}

function fxRateTtlMs(): number {
  const raw = Number(process.env["MARKET_FX_RATE_TTL_MS"]);
  return Number.isFinite(raw) && raw >= 1_000 ? raw : DEFAULT_FX_RATE_TTL_MS;
}

async function fetchProviderRate(pair: string): Promise<number> {
  const payload = await fetchTwelve<PriceResponse>("/price", { symbol: pair });
  if (!payload) throw new Error("Market data key is not configured");
  const rate = Number(payload.price);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Invalid market rate for ${pair}`);
  return rate;
}

export async function loadProviderRate(pair: string): Promise<number> {
  const key = pair.trim().toUpperCase();
  if (!key) throw new Error("Market rate pair is required");

  const cached = fxRateCache.get(key);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < fxRateTtlMs()) return cached.rate;

  const retryAfter = fxRateRetryAfter.get(key);
  if (retryAfter && now < retryAfter) {
    if (cached) return cached.rate;
    throw new Error(`Market rate unavailable for ${pair}`);
  }

  const pending = inFlightFxRates.get(key);
  if (pending) return pending;

  const request = fetchProviderRate(key)
    .then((rate) => {
      fxRateRetryAfter.delete(key);
      fxRateCache.set(key, { rate, fetchedAt: Date.now() });
      return rate;
    })
    .catch((error) => {
      fxRateRetryAfter.set(key, Date.now() + failureRetryMs(error));
      throw error;
    })
    .finally(() => inFlightFxRates.delete(key));

  inFlightFxRates.set(key, request);
  return request;
}

function parseCandle(value: TimeSeriesValue): MarketCandle | null {
  if (!value.datetime || !value.open || !value.high || !value.low || !value.close) return null;
  const time = Math.floor(Date.parse(`${value.datetime.replace(" ", "T")}Z`) / 1000);
  const open = Number(value.open);
  const high = Number(value.high);
  const low = Number(value.low);
  const close = Number(value.close);
  if (![time, open, high, low, close].every(Number.isFinite)) return null;
  const volume = value.volume == null ? null : Number(value.volume);
  return {
    time,
    open,
    high,
    low,
    close,
    ...(volume != null && Number.isFinite(volume) ? { volume } : {}),
  };
}

async function fetchLiveCandles(
  symbol: string,
  interval: ChartInterval,
  points: number,
): Promise<MarketCandles> {
  const providerSymbol = PROVIDER_SYMBOLS[symbol];
  if (!providerSymbol) throw new Error(`No market data mapping for ${symbol}`);

  const payload = await fetchTwelve<TimeSeriesResponse>("/time_series", {
    symbol: providerSymbol,
    interval,
    outputsize: String(points),
    order: "asc",
    timezone: "UTC",
  });
  if (!payload) throw new Error("Market data key is not configured");

  const candles = (payload.values ?? [])
    .map(parseCandle)
    .filter((candle): candle is MarketCandle => candle != null)
    .sort((a, b) => a.time - b.time);
  if (candles.length === 0) throw new Error(`No candles returned for ${symbol}`);

  return { symbol, interval, candles, source: "live", feed: "twelve", fetchedAt: Date.now() };
}

export async function loadCandles(
  symbol: string,
  interval: ChartInterval,
  points = 180,
): Promise<MarketCandles> {
  const safeInterval = isChartInterval(interval) ? interval : "1min";
  const safePoints = Math.min(500, Math.max(20, Math.round(points)));
  const feed = await loadFeedCandles(symbol, safeInterval, safePoints).catch(() => null);
  if (feed) return feed;
  if (!PROVIDER_SYMBOLS[symbol]) {
    return {
      symbol,
      interval: safeInterval,
      candles: syntheticCandles(symbol, safeInterval, safePoints),
      source: "simulated" as FeedSource,
      fetchedAt: Date.now(),
    };
  }
  const cacheKey = `${symbol}:${safeInterval}:${safePoints}`;
  const cached = candleCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < candleTtlMs(safeInterval)) {
    return { ...cached.series, source: "live" };
  }

  const retryAfter = candleRetryAfter.get(cacheKey);
  if (retryAfter && now < retryAfter) {
    if (cached) return { ...cached.series, source: "cached" as FeedSource };
    return {
      symbol,
      interval: safeInterval,
      candles: syntheticCandles(symbol, safeInterval, safePoints),
      source: "simulated" as FeedSource,
      fetchedAt: now,
    };
  }

  const pending = inFlightCandles.get(cacheKey);
  if (pending) return pending;

  const request = fetchLiveCandles(symbol, safeInterval, safePoints)
    .then((series) => {
      candleRetryAfter.delete(cacheKey);
      candleCache.set(cacheKey, { series, fetchedAt: Date.now() });
      return series;
    })
    .catch((error) => {
      candleRetryAfter.set(cacheKey, Date.now() + failureRetryMs(error));
      if (cached) return { ...cached.series, source: "cached" as FeedSource };
      return {
        symbol,
        interval: safeInterval,
        candles: syntheticCandles(symbol, safeInterval, safePoints),
        source: "simulated" as FeedSource,
        fetchedAt: Date.now(),
      };
    })
    .finally(() => inFlightCandles.delete(cacheKey));

  inFlightCandles.set(cacheKey, request);
  return request;
}

export function resetMarketDataCache() {
  quoteCache.clear();
  candleCache.clear();
  fxRateCache.clear();
  inFlightQuotes.clear();
  inFlightCandles.clear();
  inFlightFxRates.clear();
  quoteRetryAfter.clear();
  candleRetryAfter.clear();
  fxRateRetryAfter.clear();
  keys = null;
  keyCursor = 0;
}
