import {
  FEED_INTERNAL_BASE_URL,
  FEED_INTERNAL_HEADER,
  FEED_INTERNAL_VALUE,
  MARKET_FEED_INSTANCE,
  type FeedPayload,
  type FeedStatus,
} from "./market-feed";
import {
  isChartInterval,
  isInstrument,
  type ChartInterval,
  type MarketCandle,
  type MarketCandles,
  type MarketQuote,
  type QuoteMap,
} from "./market-data";

type FeedStub = {
  fetch: (request: Request) => Promise<Response>;
};

type FeedNamespace = {
  idFromName: (name: string) => unknown;
  get: (id: unknown) => FeedStub;
};

export type FeedRuntimeEnv = {
  ALLOW_DEV_FEED?: string;
  DEV_FEED_SECRET?: string;
  DEV_FEED_ALLOWED_IPS?: string;
  DEV_FEED_SERVER_IDS?: string;
  DEV_FEED_STALE_MS?: string;
  MARKET_STREAM?: FeedNamespace;
};

export type FeedAccessOptions = {
  serverId?: string | null | undefined;
  env?: FeedRuntimeEnv;
};

type FeedGlobals = typeof globalThis & {
  __env__?: FeedRuntimeEnv;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

function marketCandle(value: unknown): MarketCandle | null {
  if (!isRecord(value)) return null;
  const { time, open, high, low, close, volume } = value;
  if (!positive(time) || !positive(open) || !positive(high) || !positive(low) || !positive(close)) {
    return null;
  }
  if (high < low || high < open || high < close || low > open || low > close) return null;
  return {
    time: Math.round(time),
    open,
    high,
    low,
    close,
    ...(finite(volume) && volume >= 0 ? { volume } : {}),
  };
}

export function feedEnv(): FeedRuntimeEnv | undefined {
  return (globalThis as FeedGlobals).__env__;
}

export function feedEnabled(env: FeedRuntimeEnv | undefined = feedEnv()): boolean {
  const flag = env?.ALLOW_DEV_FEED ?? process.env["ALLOW_DEV_FEED"];
  return flag === "true";
}

export function feedServerIds(
  env: FeedRuntimeEnv | undefined = feedEnv(),
): Set<string> {
  const raw = env?.DEV_FEED_SERVER_IDS ?? process.env["DEV_FEED_SERVER_IDS"];
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function feedServerIsAllowed(
  serverId: string | null | undefined,
  env: FeedRuntimeEnv | undefined = feedEnv(),
): boolean {
  if (!serverId) return false;
  return feedServerIds(env).has(serverId.trim().toLowerCase());
}

function feedStub(env: FeedRuntimeEnv | undefined = feedEnv()): FeedStub | null {
  const namespace = env?.MARKET_STREAM;
  if (!namespace) return null;
  return namespace.get(namespace.idFromName(MARKET_FEED_INSTANCE));
}

function internalRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set(FEED_INTERNAL_HEADER, FEED_INTERNAL_VALUE);
  return new Request(new URL(path, FEED_INTERNAL_BASE_URL), { ...init, headers });
}

export async function ingestFeedPayload(
  payload: FeedPayload,
  env: FeedRuntimeEnv | undefined = feedEnv(),
): Promise<void> {
  const stub = feedStub(env);
  if (!stub) throw new Error("Feed storage is not available");
  const response = await stub.fetch(
    internalRequest("/internal/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  if (!response.ok) throw new Error(`Feed storage rejected the batch (${response.status})`);
}

export type FeedQuotesResult = {
  quotes: QuoteMap;
  enabled: boolean;
  allowed: boolean;
  available: boolean;
  stale: boolean;
};

export async function loadFeedQuotesResult(
  symbols: string[],
  options: FeedAccessOptions = {},
): Promise<FeedQuotesResult> {
  const env = options.env ?? feedEnv();
  if (!feedEnabled(env)) {
    return { quotes: {}, enabled: false, allowed: false, available: false, stale: true };
  }
  if (!feedServerIsAllowed(options.serverId, env)) {
    return { quotes: {}, enabled: true, allowed: false, available: false, stale: true };
  }
  const stub = feedStub(env);
  if (!stub) return { quotes: {}, enabled: true, allowed: true, available: false, stale: true };

  const unique = Array.from(new Set(symbols)).filter(isInstrument);
  if (unique.length === 0) {
    return { quotes: {}, enabled: true, allowed: true, available: true, stale: false };
  }

  const url = new URL("/internal/quotes", FEED_INTERNAL_BASE_URL);
  url.searchParams.set("symbols", unique.join(","));
  const response = await stub.fetch(internalRequest(url.pathname + url.search));
  if (!response.ok)
    return { quotes: {}, enabled: true, allowed: true, available: false, stale: true };

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!isRecord(payload) || !Array.isArray(payload["quotes"])) {
    return { quotes: {}, enabled: true, allowed: true, available: false, stale: true };
  }

  const result: QuoteMap = {};
  let anyStale = false;
  for (const record of payload["quotes"]) {
    if (!isRecord(record) || typeof record["symbol"] !== "string") continue;
    if (!isInstrument(record["symbol"])) continue;
    if (
      !positive(record["bid"]) ||
      !positive(record["ask"]) ||
      !positive(record["mid"]) ||
      !finite(record["ts"])
    ) {
      continue;
    }
    const stale =
      payload["stale"] === true || record["stale"] === true || record["marketOpen"] === false;
    anyStale ||= stale;
    const quote: MarketQuote = {
      symbol: record["symbol"],
      bid: record["bid"],
      ask: record["ask"],
      mid: record["mid"],
      ts: record["ts"],
      source: stale ? "cached" : "live",
      feed: "exness",
      marketOpen: record["marketOpen"] !== false,
      ...(finite(record["change"]) ? { change: record["change"] } : {}),
      ...(finite(record["high"]) ? { high: record["high"] } : {}),
      ...(finite(record["low"]) ? { low: record["low"] } : {}),
    };
    result[quote.symbol] = quote;
  }
  return {
    quotes: result,
    enabled: true,
    allowed: true,
    available: unique.every((symbol) => result[symbol] != null),
    stale: payload["stale"] === true || anyStale,
  };
}

export async function loadFeedQuotes(
  symbols: string[],
  options: FeedAccessOptions = {},
): Promise<QuoteMap> {
  return (await loadFeedQuotesResult(symbols, options)).quotes;
}

export async function loadFeedCandles(
  symbol: string,
  interval: ChartInterval,
  points: number,
  options: FeedAccessOptions = {},
): Promise<MarketCandles | null> {
  const env = options.env ?? feedEnv();
  if (!feedEnabled(env)) return null;
  if (!feedServerIsAllowed(options.serverId, env)) return null;
  if (!isInstrument(symbol) || !isChartInterval(interval)) return null;
  const stub = feedStub(env);
  if (!stub) return null;

  const url = new URL("/internal/candles", FEED_INTERNAL_BASE_URL);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("points", String(points));
  const response = await stub.fetch(internalRequest(url.pathname + url.search));
  if (!response.ok) return null;

  const payload = (await response.json().catch(() => null)) as unknown;
  if (
    !isRecord(payload) ||
    payload["symbol"] !== symbol ||
    payload["interval"] !== interval ||
    !Array.isArray(payload["candles"])
  ) {
    return null;
  }

  const candles = payload["candles"]
    .map(marketCandle)
    .filter((candle): candle is MarketCandle => candle != null)
    .sort((left, right) => left.time - right.time);
  if (candles.length === 0) return null;

  return {
    symbol,
    interval,
    candles,
    source: payload["stale"] === true ? "cached" : "live",
    feed: "exness",
    fetchedAt: Date.now(),
  };
}

export async function loadFeedStatus(
  env: FeedRuntimeEnv | undefined = feedEnv(),
): Promise<FeedStatus | null> {
  if (!feedEnabled(env)) return null;
  const stub = feedStub(env);
  if (!stub) return null;
  const response = await stub.fetch(internalRequest("/internal/status"));
  if (!response.ok) return null;
  return (await response.json().catch(() => null)) as FeedStatus | null;
}
