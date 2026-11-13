import { MERIDIAN_TIMEFRAMES, marketQuoteFromMeridian, type MeridianCandle } from "./meridian";
import {
  fetchMeridianCandles,
  fetchMeridianQuotes,
  loadMeridianCatalog,
  meridianProviderSymbols,
  resetMeridianCache,
  type MeridianError,
} from "./meridian.server";
import { findInstrument } from "./market";
import {
  isChartInterval,
  isInstrument,
  syntheticCandles,
  syntheticQuote,
  type ChartInterval,
  type FeedSource,
  type MarketCandle,
  type MarketCandles,
  type MarketQuote,
  type QuoteMap,
} from "./market-data";

const DEFAULT_QUOTE_TTL_MS = 5_000;
const DEFAULT_FX_RATE_TTL_MS = 15 * 60_000;
const DEFAULT_RETRY_MS = 15_000;

const quoteCache = new Map<string, { quote: MarketQuote; fetchedAt: number }>();
const candleCache = new Map<string, { series: MarketCandles; fetchedAt: number }>();
const fxRateCache = new Map<string, { rate: number; fetchedAt: number }>();
const quoteRetryAfter = new Map<string, number>();
const candleRetryAfter = new Map<string, number>();
const fxRateRetryAfter = new Map<string, number>();
const inFlightQuoteBatches = new Map<string, Promise<QuoteMap>>();
const inFlightCandles = new Map<string, Promise<MarketCandles>>();
const inFlightFxRates = new Map<string, Promise<number>>();

function quoteTtlMs(): number {
  const raw = Number(process.env["MERIDIAN_QUOTE_TTL_MS"] ?? process.env["MARKET_QUOTE_TTL_MS"]);
  return Number.isFinite(raw) && raw >= 1_000 ? raw : DEFAULT_QUOTE_TTL_MS;
}

function candleTtlMs(interval: ChartInterval): number {
  const raw = Number(process.env["MERIDIAN_CANDLE_TTL_MS"] ?? process.env["MARKET_CANDLE_TTL_MS"]);
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

function fxRateTtlMs(): number {
  const raw = Number(process.env["MARKET_FX_RATE_TTL_MS"]);
  return Number.isFinite(raw) && raw >= 1_000 ? raw : DEFAULT_FX_RATE_TTL_MS;
}

function retryMs(error: unknown): number {
  const value = (error as MeridianError | undefined)?.retryAfterMs;
  return typeof value === "number" && value > 0 ? value : DEFAULT_RETRY_MS;
}

function fallbackQuote(symbol: string, now: number): MarketQuote {
  if (findInstrument(symbol)?.synthetic === false) {
    return {
      symbol,
      bid: 0,
      ask: 0,
      mid: 0,
      ts: now,
      source: "simulated",
      feed: "meridian",
      feedFallback: true,
    };
  }
  return { ...syntheticQuote(symbol, now), feedFallback: true };
}

function cachedQuote(symbol: string): MarketQuote | null {
  const cached = quoteCache.get(symbol);
  return cached ? { ...cached.quote, source: "cached" } : null;
}

async function fetchQuoteBatch(symbols: string[]): Promise<QuoteMap> {
  const providerSymbols = await meridianProviderSymbols(symbols);
  const canonical = Array.from(new Set(providerSymbols.values())).sort();
  if (canonical.length === 0) return {};

  const quotes = await fetchMeridianQuotes(canonical);
  const byProvider = new Map(quotes.map((quote) => [quote.symbol, quote]));
  const now = Date.now();
  const result: QuoteMap = {};
  for (const [internal, provider] of providerSymbols) {
    const raw = byProvider.get(provider);
    if (!raw) continue;
    const quote = marketQuoteFromMeridian(raw, internal);
    quoteCache.set(internal, { quote, fetchedAt: now });
    quoteRetryAfter.delete(internal);
    result[internal] = quote;
  }
  return result;
}

export async function loadQuotes(
  symbols: string[],
  _options: { serverId?: string | null } = {},
): Promise<QuoteMap> {
  await loadMeridianCatalog().catch(() => null);
  const unique = Array.from(new Set(symbols)).filter(isInstrument);
  if (unique.length === 0) return {};

  const now = Date.now();
  const result: QuoteMap = {};
  const missing: string[] = [];
  for (const symbol of unique) {
    const cached = quoteCache.get(symbol);
    if (cached && now - cached.fetchedAt < quoteTtlMs()) {
      result[symbol] = { ...cached.quote, source: "live" };
      continue;
    }
    if ((quoteRetryAfter.get(symbol) ?? 0) > now) {
      result[symbol] = cachedQuote(symbol) ?? fallbackQuote(symbol, now);
      continue;
    }
    missing.push(symbol);
  }

  if (missing.length > 0) {
    const key = [...missing].sort().join(",");
    let pending = inFlightQuoteBatches.get(key);
    if (!pending) {
      pending = fetchQuoteBatch(missing).finally(() => inFlightQuoteBatches.delete(key));
      inFlightQuoteBatches.set(key, pending);
    }
    try {
      Object.assign(result, await pending);
    } catch (error) {
      const nextRetry = Date.now() + retryMs(error);
      for (const symbol of missing) quoteRetryAfter.set(symbol, nextRetry);
    }
  }

  for (const symbol of unique) {
    if (result[symbol]) continue;
    result[symbol] = cachedQuote(symbol) ?? fallbackQuote(symbol, Date.now());
  }
  return result;
}

function parseCandle(value: MeridianCandle): MarketCandle | null {
  const time = Math.floor(Date.parse(value.time) / 1000);
  const open = Number(value.open);
  const high = Number(value.high);
  const low = Number(value.low);
  const close = Number(value.close);
  if (![time, open, high, low, close].every(Number.isFinite)) return null;
  const tickCount = Number(value.tick_count);
  return {
    time,
    open,
    high,
    low,
    close,
    ...(Number.isFinite(tickCount) && tickCount >= 0 ? { volume: tickCount } : {}),
  };
}

async function fetchLiveCandles(
  symbol: string,
  interval: ChartInterval,
  points: number,
): Promise<MarketCandles> {
  const provider = (await meridianProviderSymbols([symbol])).get(symbol);
  if (!provider) throw new Error(`No Meridian symbol mapping for ${symbol}`);
  const payload = await fetchMeridianCandles(provider, MERIDIAN_TIMEFRAMES[interval], points);
  const candles = (payload.candles ?? [])
    .map(parseCandle)
    .filter((candle): candle is MarketCandle => candle != null)
    .sort((left, right) => left.time - right.time);
  if (candles.length === 0) throw new Error(`No candles returned for ${symbol}`);
  return {
    symbol,
    interval,
    candles,
    source: "live",
    feed: "meridian",
    fetchedAt: Date.now(),
  };
}

function fallbackCandles(
  symbol: string,
  interval: ChartInterval,
  points: number,
  now = Date.now(),
): MarketCandles {
  const instrument = findInstrument(symbol);
  return {
    symbol,
    interval,
    candles: instrument?.synthetic === false ? [] : syntheticCandles(symbol, interval, points, now),
    source: "simulated" as FeedSource,
    feed: "meridian",
    fetchedAt: now,
  };
}

export async function loadCandles(
  symbol: string,
  interval: ChartInterval,
  points = 180,
  _options: { serverId?: string | null } = {},
): Promise<MarketCandles> {
  await loadMeridianCatalog().catch(() => null);
  const safeInterval = isChartInterval(interval) ? interval : "1min";
  const safePoints = Math.min(500, Math.max(20, Math.round(points)));
  if (!isInstrument(symbol)) return fallbackCandles(symbol, safeInterval, safePoints);

  const cacheKey = `${symbol}:${safeInterval}:${safePoints}`;
  const cached = candleCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < candleTtlMs(safeInterval)) {
    return { ...cached.series, source: "live" };
  }
  if ((candleRetryAfter.get(cacheKey) ?? 0) > now) {
    return cached
      ? { ...cached.series, source: "cached" as FeedSource }
      : fallbackCandles(symbol, safeInterval, safePoints, now);
  }

  const existing = inFlightCandles.get(cacheKey);
  if (existing) return existing;
  const request = fetchLiveCandles(symbol, safeInterval, safePoints)
    .then((series) => {
      candleRetryAfter.delete(cacheKey);
      candleCache.set(cacheKey, { series, fetchedAt: Date.now() });
      return series;
    })
    .catch((error) => {
      candleRetryAfter.set(cacheKey, Date.now() + retryMs(error));
      return cached
        ? { ...cached.series, source: "cached" as FeedSource }
        : fallbackCandles(symbol, safeInterval, safePoints);
    })
    .finally(() => inFlightCandles.delete(cacheKey));
  inFlightCandles.set(cacheKey, request);
  return request;
}

export async function loadProviderRate(pair: string): Promise<number> {
  const symbol = pair.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (!symbol) throw new Error("Market rate pair is required");
  const now = Date.now();
  const cached = fxRateCache.get(symbol);
  if (cached && now - cached.fetchedAt < fxRateTtlMs()) return cached.rate;
  if ((fxRateRetryAfter.get(symbol) ?? 0) > now) {
    if (cached) return cached.rate;
    throw new Error(`Market rate unavailable for ${pair}`);
  }

  const existing = inFlightFxRates.get(symbol);
  if (existing) return existing;
  const request = (async () => {
    await loadMeridianCatalog().catch(() => null);
    const provider =
      (await meridianProviderSymbols([symbol]).catch(() => new Map())).get(symbol) ?? symbol;
    const quote = (await fetchMeridianQuotes([provider]))[0];
    if (!quote) throw new Error(`Market rate unavailable for ${pair}`);
    const rate = (quote.bid + quote.ask) / 2;
    if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Invalid market rate for ${pair}`);
    fxRateRetryAfter.delete(symbol);
    fxRateCache.set(symbol, { rate, fetchedAt: Date.now() });
    return rate;
  })()
    .catch((error) => {
      fxRateRetryAfter.set(symbol, Date.now() + retryMs(error));
      if (cached) return cached.rate;
      throw error;
    })
    .finally(() => inFlightFxRates.delete(symbol));
  inFlightFxRates.set(symbol, request);
  return request;
}

export function resetMarketDataCache(): void {
  quoteCache.clear();
  candleCache.clear();
  fxRateCache.clear();
  quoteRetryAfter.clear();
  candleRetryAfter.clear();
  fxRateRetryAfter.clear();
  inFlightQuoteBatches.clear();
  inFlightCandles.clear();
  inFlightFxRates.clear();
  resetMeridianCache();
}
