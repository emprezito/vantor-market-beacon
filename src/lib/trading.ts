import { getInstrument, LEVERAGE, quote } from "./market";

export type Side = "buy" | "sell";

export function openPrice(symbol: string, side: Side, t: number) {
  const q = quote(symbol, t);
  return side === "buy" ? q.ask : q.bid;
}

export function closePrice(symbol: string, side: Side, t: number) {
  const q = quote(symbol, t);
  return side === "buy" ? q.bid : q.ask;
}

/** Profit/loss in USD. */
export function calcPnl(symbol: string, side: Side, lots: number, open: number, close: number) {
  const i = getInstrument(symbol);
  const diff = (close - open) * (side === "buy" ? 1 : -1) * lots * i.contract;
  if (i.quoteIsUsd) return diff;
  if (i.usdPerQuote != null) return diff * i.usdPerQuote;
  return diff / close;
}

/** Margin in USD required to hold a position. */
export function calcMargin(symbol: string, lots: number, price: number, leverage: number = LEVERAGE) {
  const i = getInstrument(symbol);
  const notional = i.quoteIsUsd
    ? lots * i.contract * price
    : i.usdPerBase != null
      ? lots * i.contract * i.usdPerBase
      : i.usdPerQuote != null
        ? lots * i.contract * price * i.usdPerQuote
        : lots * i.contract;
  return notional / leverage;
}

/** True when a limit order should fill at the current quote. */
export function limitHit(side: Side, q: { bid: number; ask: number }, limit: number) {
  return side === "buy" ? q.ask <= limit : q.bid >= limit;
}

/** Returns "sl" | "tp" | null if the current close price triggers a stop. */
export function stopHit(side: Side, price: number, sl: number | null, tp: number | null) {
  if (side === "buy") {
    if (sl != null && price <= sl) return "sl";
    if (tp != null && price >= tp) return "tp";
  } else {
    if (sl != null && price >= sl) return "sl";
    if (tp != null && price <= tp) return "tp";
  }
  return null;
}
