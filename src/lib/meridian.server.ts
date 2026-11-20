import { INSTRUMENTS, registerMarketInstruments, type Instrument } from "./market";
import {
  MERIDIAN_DEFAULT_API_BASE_URL,
  MERIDIAN_DEFAULT_WS_URL,
  displayMeridianSymbol,
  parseMeridianQuote,
  type MeridianCandleResponse,
  type MeridianInstrument,
  type MeridianQuote,
  type MeridianWsToken,
} from "./meridian";

type MeridianEnv = {
  MERIDIAN_API_KEY?: string;
  MERIDIAN_API_BASE_URL?: string;
  MERIDIAN_WS_URL?: string;
  MARKET_WS_URL?: string;
};

type MeridianGlobals = typeof globalThis & { __env__?: MeridianEnv };

type CatalogSnapshot = {
  instruments: Instrument[];
  providerByInternal: Map<string, string>;
  internalByProvider: Map<string, string>;
  fetchedAt: number;
};

const CATALOG_TTL_MS = 5 * 60_000;
const CATALOG_FAILURE_COOLDOWN_MS = 15_000;
const REQUEST_TIMEOUT_MS = 8_000;

const USD_PER_CURRENCY: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  JPY: 0.0066,
  AUD: 0.664,
  NZD: 0.611,
  CAD: 0.74,
  CHF: 1.13,
};

let catalogCache: CatalogSnapshot | null = null;
let catalogPending: Promise<CatalogSnapshot> | null = null;
let catalogRetryAfter = 0;
let catalogFailure: MeridianError | null = null;

export class MeridianError extends Error {
  status: number;
  retryAfterMs: number | null;

  constructor(message: string, status: number, retryAfterMs: number | null = null) {
    super(message);
    this.name = "MeridianError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function envValue(name: keyof MeridianEnv): string | undefined {
  const runtime = (globalThis as MeridianGlobals).__env__?.[name];
  return runtime ?? process.env[name];
}

export function meridianApiBaseUrl(): string {
  return (envValue("MERIDIAN_API_BASE_URL") ?? MERIDIAN_DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

export function meridianWsUrl(): string {
  return (
    envValue("MERIDIAN_WS_URL") ??
    envValue("MARKET_WS_URL") ??
    MERIDIAN_DEFAULT_WS_URL
  ).replace(/\/+$/, "");
}

function meridianApiKey(): string {
  const key = envValue("MERIDIAN_API_KEY")?.trim();
  if (!key) throw new MeridianError("Meridian API key is not configured", 503);
  return key;
}

function detailMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null) {
    const detail = (payload as Record<string, unknown>)["detail"];
    if (typeof detail === "string") return detail;
    if (typeof detail === "object" && detail !== null) {
      const message = (detail as Record<string, unknown>)["message"];
      if (typeof message === "string") return message;
    }
  }
  return fallback;
}

async function meridianRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("X-API-Key", meridianApiKey());

  try {
    const response = await fetch(`${meridianApiBaseUrl()}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as T | null;
    if (!response.ok) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      throw new MeridianError(
        detailMessage(payload, `Meridian request failed (${response.status})`),
        response.status,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : null,
      );
    }
    if (payload == null) throw new MeridianError("Meridian returned an empty response", 502);
    return payload;
  } catch (error) {
    if (error instanceof MeridianError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new MeridianError("Meridian request timed out", 504);
    }
    throw new MeridianError("Meridian is unavailable", 503);
  } finally {
    clearTimeout(timeout);
  }
}

function symbolFrom(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value !== "object" || value === null) return null;
  const symbol = (value as Record<string, unknown>)["symbol"];
  return typeof symbol === "string" && symbol.trim() ? symbol.trim() : null;
}

function parseInstrument(value: unknown): MeridianInstrument | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const symbol = symbolFrom(record);
  if (!symbol) return null;
  const number = (key: string) => {
    const result = record[key];
    return typeof result === "number" && Number.isFinite(result) ? result : null;
  };
  const text = (key: string) => {
    const result = record[key];
    return typeof result === "string" && result.trim() ? result.trim() : null;
  };
  return {
    symbol,
    source_symbol: text("source_symbol"),
    asset_class: text("asset_class"),
    base_currency: text("base_currency"),
    quote_currency: text("quote_currency"),
    digits: number("digits"),
    point: number("point"),
    tick_size: number("tick_size"),
    contract_size: number("contract_size"),
    enabled: typeof record["enabled"] === "boolean" ? record["enabled"] : null,
    metadata:
      typeof record["metadata"] === "object" && record["metadata"] !== null
        ? (record["metadata"] as Record<string, unknown>)
        : null,
  };
}

function withoutBrokerSuffix(symbol: string): string {
  const compact = symbol.replace(/[^a-zA-Z0-9]/g, "");
  const lowerSuffix = /^([A-Z0-9]+?)([a-z]{1,5})$/.exec(compact);
  return (lowerSuffix?.[1] ?? compact).toUpperCase();
}

function staticSymbolFor(providerSymbol: string): string | null {
  const exact = providerSymbol.toUpperCase();
  if (INSTRUMENTS.some((instrument) => instrument.symbol === exact)) return exact;
  const normalized = withoutBrokerSuffix(providerSymbol);
  if (INSTRUMENTS.some((instrument) => instrument.symbol === normalized)) return normalized;
  const uppercaseSuffix = exact.endsWith("M") ? exact.slice(0, -1) : exact;
  return INSTRUMENTS.some((instrument) => instrument.symbol === uppercaseSuffix)
    ? uppercaseSuffix
    : null;
}

function metadataName(instrument: MeridianInstrument): string | null {
  const description = instrument.metadata?.["description"];
  return typeof description === "string" && description.trim() ? description.trim() : null;
}

function buildCatalog(allowedValues: unknown, instrumentValues: unknown): CatalogSnapshot {
  const instruments = Array.isArray(instrumentValues)
    ? instrumentValues
        .map(parseInstrument)
        .filter((value): value is MeridianInstrument => value != null)
    : [];
  const byProvider = new Map(instruments.map((instrument) => [instrument.symbol, instrument]));
  const allowedSymbols = Array.isArray(allowedValues)
    ? allowedValues.map(symbolFrom).filter((value): value is string => value != null)
    : [];
  const symbols = allowedSymbols.length
    ? allowedSymbols
    : instruments
        .filter((instrument) => instrument.enabled !== false)
        .map((instrument) => instrument.symbol);

  const providerByInternal = new Map<string, string>();
  const internalByProvider = new Map<string, string>();
  const entries: Instrument[] = [];

  const orderedSymbols = Array.from(new Set(symbols)).sort((left, right) => {
    const leftStatic = staticSymbolFor(left);
    const rightStatic = staticSymbolFor(right);
    const leftExact = leftStatic != null && left.toUpperCase() === leftStatic ? 0 : 1;
    const rightExact = rightStatic != null && right.toUpperCase() === rightStatic ? 0 : 1;
    return leftExact - rightExact || left.localeCompare(right);
  });

  for (const providerSymbol of orderedSymbols) {
    const provider = byProvider.get(providerSymbol) ?? { symbol: providerSymbol };
    const staticSymbol = staticSymbolFor(providerSymbol);
    let internalSymbol = staticSymbol ?? providerSymbol;
    if (providerByInternal.has(internalSymbol)) internalSymbol = providerSymbol;

    const existing = INSTRUMENTS.find((instrument) => instrument.symbol === internalSymbol);
    const baseCurrency = provider.base_currency?.toUpperCase() ?? existing?.baseCurrency ?? null;
    const quoteCurrency = provider.quote_currency?.toUpperCase() ?? existing?.quoteCurrency ?? null;
    const point = provider.point && provider.point > 0 ? provider.point : null;
    const digits =
      provider.digits != null && Number.isInteger(provider.digits) && provider.digits >= 0
        ? Math.min(10, provider.digits)
        : (existing?.digits ?? 5);
    const contract =
      provider.contract_size != null && provider.contract_size > 0
        ? provider.contract_size
        : (existing?.contract ?? 100_000);
    const name =
      metadataName(provider) ??
      existing?.name ??
      displayMeridianSymbol(providerSymbol, baseCurrency, quoteCurrency);
    const quoteIsUsd = quoteCurrency ? quoteCurrency === "USD" : (existing?.quoteIsUsd ?? true);
    const usdPerQuote = quoteCurrency ? USD_PER_CURRENCY[quoteCurrency] : undefined;
    const usdPerBase = baseCurrency ? USD_PER_CURRENCY[baseCurrency] : undefined;

    entries.push({
      symbol: internalSymbol,
      providerSymbol,
      name,
      base: existing?.base ?? 1,
      vol: existing?.vol ?? 0,
      digits,
      point: point ?? 10 ** -digits,
      tickSize:
        provider.tick_size != null && provider.tick_size > 0
          ? provider.tick_size
          : (point ?? 10 ** -digits),
      spread: existing?.spread ?? Math.max(point ? point * 2 : 0, 0),
      contract,
      quoteIsUsd,
      ...(existing?.usdPerQuote != null
        ? { usdPerQuote: existing.usdPerQuote }
        : usdPerQuote != null
          ? { usdPerQuote }
          : {}),
      ...(existing?.usdPerBase != null
        ? { usdPerBase: existing.usdPerBase }
        : usdPerBase != null
          ? { usdPerBase }
          : {}),
      ...(provider.asset_class ? { assetClass: provider.asset_class } : {}),
      baseCurrency,
      quoteCurrency,
      synthetic: existing?.synthetic ?? false,
    });
    providerByInternal.set(internalSymbol, providerSymbol);
    internalByProvider.set(providerSymbol, internalSymbol);
  }

  return { instruments: entries, providerByInternal, internalByProvider, fetchedAt: Date.now() };
}

async function fetchCatalog(): Promise<CatalogSnapshot> {
  const [symbols, instruments] = await Promise.all([
    meridianRequest<unknown>("/symbols"),
    meridianRequest<unknown>("/instruments"),
  ]);
  const snapshot = buildCatalog(symbols, instruments);
  registerMarketInstruments(snapshot.instruments);
  return snapshot;
}

export async function loadMeridianCatalog(): Promise<CatalogSnapshot> {
  const now = Date.now();
  if (catalogCache && now - catalogCache.fetchedAt < CATALOG_TTL_MS) {
    registerMarketInstruments(catalogCache.instruments);
    return catalogCache;
  }
  if (catalogFailure && now < catalogRetryAfter) throw catalogFailure;
  if (catalogPending) return catalogPending;
  catalogPending = fetchCatalog()
    .then((snapshot) => {
      catalogCache = snapshot;
      catalogFailure = null;
      catalogRetryAfter = 0;
      return snapshot;
    })
    .catch((error) => {
      catalogFailure =
        error instanceof MeridianError ? error : new MeridianError("Meridian is unavailable", 503);
      catalogRetryAfter = Date.now() + (catalogFailure.retryAfterMs ?? CATALOG_FAILURE_COOLDOWN_MS);
      if (catalogCache) {
        registerMarketInstruments(catalogCache.instruments);
        return catalogCache;
      }
      throw catalogFailure;
    })
    .finally(() => {
      catalogPending = null;
    });
  return catalogPending;
}

export async function meridianProviderSymbols(symbols: string[]): Promise<Map<string, string>> {
  const catalog = await loadMeridianCatalog();
  return new Map(
    symbols
      .map((symbol) => [symbol, catalog.providerByInternal.get(symbol)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
  );
}

export async function meridianInternalSymbols(symbols: string[]): Promise<Map<string, string>> {
  const catalog = await loadMeridianCatalog();
  return new Map(
    symbols
      .map((symbol) => [symbol, catalog.internalByProvider.get(symbol)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
  );
}

export async function fetchMeridianQuotes(providerSymbols: string[]): Promise<MeridianQuote[]> {
  const params = new URLSearchParams();
  for (const symbol of Array.from(new Set(providerSymbols))) params.append("symbol", symbol);
  const suffix = params.size ? `?${params}` : "";
  const payload = await meridianRequest<unknown>(`/quotes${suffix}`);
  if (!Array.isArray(payload)) throw new MeridianError("Invalid Meridian quote response", 502);
  return payload.map(parseMeridianQuote).filter((quote): quote is MeridianQuote => quote != null);
}

export async function fetchMeridianCandles(
  providerSymbol: string,
  timeframe: string,
  limit: number,
): Promise<MeridianCandleResponse> {
  const params = new URLSearchParams({
    symbol: providerSymbol,
    timeframe,
    price_type: "bid",
    limit: String(limit),
  });
  return meridianRequest<MeridianCandleResponse>(`/candles?${params}`);
}

export async function requestMeridianWsToken(): Promise<MeridianWsToken> {
  const token = await meridianRequest<MeridianWsToken>("/auth/ws-token", { method: "POST" });
  if (!token.token || !Number.isFinite(token.expires_at) || token.expires_at <= 0) {
    throw new MeridianError("Invalid Meridian WebSocket token response", 502);
  }
  return token;
}

export function resetMeridianCache(): void {
  catalogCache = null;
  catalogPending = null;
  catalogFailure = null;
  catalogRetryAfter = 0;
  registerMarketInstruments([]);
}
