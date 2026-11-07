import type { MarketQuote } from "./market-data";

export const MARKETDATA_WS_URL = "wss://data.fundedng.fun/ws/v1/market";
export const MARKETDATA_STALE_MS = 15_000;
export const MARKETDATA_MAX_FUTURE_MS = 60_000;
export const MARKETDATA_MAX_AGE_MS = MARKETDATA_STALE_MS;

export const MARKETDATA_SYMBOLS = {
  XAUUSD: "XAUUSDM",
} as const;

export type MarketDatafeedTerminalSymbol = keyof typeof MARKETDATA_SYMBOLS;

const VPS_TO_TERMINAL = new Map<string, MarketDatafeedTerminalSymbol>(
  Object.entries(MARKETDATA_SYMBOLS).map(([terminal, vps]) => [
    vps,
    terminal as MarketDatafeedTerminalSymbol,
  ]),
);

export type MarketDatafeedTick = {
  terminalSymbol: MarketDatafeedTerminalSymbol;
  vpsSymbol: string;
  bid: number;
  ask: number;
  ts: number;
};

export function isMarketDatafeedSymbol(value: string): value is MarketDatafeedTerminalSymbol {
  return Object.prototype.hasOwnProperty.call(MARKETDATA_SYMBOLS, value);
}

export function marketDatafeedVpsSymbol(value: string): string | null {
  if (!isMarketDatafeedSymbol(value)) return null;
  return MARKETDATA_SYMBOLS[value];
}

export function marketDatafeedTerminalSymbol(value: string): MarketDatafeedTerminalSymbol | null {
  return VPS_TO_TERMINAL.get(value) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseMarketDatafeedTick(
  value: unknown,
  now = Date.now(),
): MarketDatafeedTick | null {
  if (!isRecord(value)) return null;

  const symbol = value["symbol"];
  if (typeof symbol !== "string") return null;
  const terminalSymbol = marketDatafeedTerminalSymbol(symbol);
  if (!terminalSymbol) return null;

  const bid = value["bid"];
  const ask = value["ask"];
  const timestamp = value["timestamp_ms"];
  if (typeof bid !== "number" || !Number.isFinite(bid) || bid <= 0) return null;
  if (typeof ask !== "number" || !Number.isFinite(ask) || ask <= 0) return null;
  if (ask < bid) return null;
  if (
    typeof timestamp !== "number" ||
    !Number.isSafeInteger(timestamp) ||
    timestamp <= 0 ||
    timestamp > now + MARKETDATA_MAX_FUTURE_MS ||
    timestamp < now - MARKETDATA_MAX_AGE_MS
  ) {
    return null;
  }

  return {
    terminalSymbol,
    vpsSymbol: symbol,
    bid,
    ask,
    ts: timestamp,
  };
}

export function marketDatafeedQuote(tick: MarketDatafeedTick): MarketQuote {
  return {
    symbol: tick.terminalSymbol,
    bid: tick.bid,
    ask: tick.ask,
    mid: (tick.bid + tick.ask) / 2,
    ts: tick.ts,
    source: "live",
    feed: "marketdatafeed",
  };
}
