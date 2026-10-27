import { loadQuotes } from "./market-data.server";

const DEFAULT_FX_RATE_TTL_MS = 15 * 60_000;

const FALLBACK_UNITS_PER_USD: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  NGN: 1_345,
};

type CachedRate = {
  rate: number;
  fetchedAt: number;
};

const rateCache = new Map<string, CachedRate>();
const inFlightRates = new Map<string, Promise<number>>();

function normalizeCurrency(currency: string): string {
  return currency.trim().toUpperCase();
}

function fxRateTtlMs(): number {
  const raw = Number(process.env["MARKET_FX_RATE_TTL_MS"]);
  return Number.isFinite(raw) && raw >= 1_000 ? raw : DEFAULT_FX_RATE_TTL_MS;
}

function configuredFallback(currency: string): number | null {
  if (currency === "NGN") {
    const raw = Number(process.env["USD_NGN_RATE"]);
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  if (currency === "EUR") {
    const raw = Number(process.env["EUR_USD_RATE"]);
    return Number.isFinite(raw) && raw > 0 ? 1 / raw : null;
  }
  if (currency === "GBP") {
    const raw = Number(process.env["GBP_USD_RATE"]);
    return Number.isFinite(raw) && raw > 0 ? 1 / raw : null;
  }
  return null;
}

export function fallbackFxRate(currency: string): number {
  const code = normalizeCurrency(currency);
  return configuredFallback(code) ?? FALLBACK_UNITS_PER_USD[code] ?? 1;
}

async function fetchFxRate(currency: string): Promise<number> {
  if (currency === "USD") return 1;

  if (currency === "EUR" || currency === "GBP") {
    const pair = currency === "EUR" ? "EURUSD" : "GBPUSD";
    const quotes = await loadQuotes([pair]);
    const quote = quotes[pair];
    if (!quote || !Number.isFinite(quote.mid) || quote.mid <= 0) {
      throw new Error(`Could not load ${pair}`);
    }
    return 1 / quote.mid;
  }

  if (currency === "NGN") {
    const { loadProviderRate } = await import("./market-data.server");
    return loadProviderRate("USD/NGN");
  }

  throw new Error(`Unsupported account currency: ${currency}`);
}

export async function loadFxRate(currency: string): Promise<number> {
  const code = normalizeCurrency(currency);
  if (code === "USD") return 1;

  const now = Date.now();
  const cached = rateCache.get(code);
  if (cached && now - cached.fetchedAt < fxRateTtlMs()) return cached.rate;

  const pending = inFlightRates.get(code);
  if (pending) return pending;

  const fallback = fallbackFxRate(code);
  const request = fetchFxRate(code)
    .then((rate) => {
      const safe = Number.isFinite(rate) && rate > 0 ? rate : fallback;
      rateCache.set(code, { rate: safe, fetchedAt: Date.now() });
      return safe;
    })
    .catch(() => {
      rateCache.set(code, { rate: fallback, fetchedAt: Date.now() });
      return fallback;
    })
    .finally(() => inFlightRates.delete(code));

  inFlightRates.set(code, request);
  return request;
}

export function resetFxRateCache() {
  rateCache.clear();
  inFlightRates.clear();
}
