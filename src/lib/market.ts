// Deterministic market: prices are a function of time, so the browser
// and server always agree on the price at a given moment.

export type Instrument = {
  symbol: string;
  name: string;
  base: number;
  vol: number; // relative swing size
  digits: number;
  spread: number; // absolute
  contract: number; // units per 1 lot
  quoteIsUsd: boolean; // false => P/L is in the quote currency
  usdPerQuote?: number; // fixed USD value of one quote unit for non-USD quotes
  usdPerBase?: number; // fixed USD value of one base unit for cross pairs
};

export const INSTRUMENTS: Instrument[] = [
  { symbol: "EURUSD", name: "Euro / US Dollar", base: 1.085, vol: 0.004, digits: 5, spread: 0.00008, contract: 100000, quoteIsUsd: true },
  { symbol: "GBPUSD", name: "British Pound / US Dollar", base: 1.273, vol: 0.005, digits: 5, spread: 0.0001, contract: 100000, quoteIsUsd: true },
  { symbol: "USDJPY", name: "US Dollar / Japanese Yen", base: 151.2, vol: 0.004, digits: 3, spread: 0.012, contract: 100000, quoteIsUsd: false },
  { symbol: "USDCAD", name: "US Dollar / Canadian Dollar", base: 1.352, vol: 0.004, digits: 5, spread: 0.00012, contract: 100000, quoteIsUsd: false },
  { symbol: "USDCHF", name: "US Dollar / Swiss Franc", base: 0.884, vol: 0.004, digits: 5, spread: 0.0001, contract: 100000, quoteIsUsd: false },
  { symbol: "AUDUSD", name: "Australian Dollar / US Dollar", base: 0.6642, vol: 0.005, digits: 5, spread: 0.00009, contract: 100000, quoteIsUsd: true },
  { symbol: "NZDUSD", name: "New Zealand Dollar / US Dollar", base: 0.6113, vol: 0.005, digits: 5, spread: 0.00012, contract: 100000, quoteIsUsd: true },
  { symbol: "EURGBP", name: "Euro / British Pound", base: 0.8524, vol: 0.003, digits: 5, spread: 0.0001, contract: 100000, quoteIsUsd: false, usdPerQuote: 1.27, usdPerBase: 1.08 },
  { symbol: "EURJPY", name: "Euro / Japanese Yen", base: 164.2, vol: 0.004, digits: 3, spread: 0.014, contract: 100000, quoteIsUsd: false, usdPerQuote: 0.0066, usdPerBase: 1.08 },
  { symbol: "GBPJPY", name: "British Pound / Japanese Yen", base: 192.6, vol: 0.005, digits: 3, spread: 0.018, contract: 100000, quoteIsUsd: false, usdPerQuote: 0.0066, usdPerBase: 1.27 },
  { symbol: "AUDJPY", name: "Australian Dollar / Japanese Yen", base: 100.3, vol: 0.005, digits: 3, spread: 0.012, contract: 100000, quoteIsUsd: false, usdPerQuote: 0.0066, usdPerBase: 0.664 },
  { symbol: "XAUUSD", name: "Gold / US Dollar", base: 2384, vol: 0.006, digits: 2, spread: 0.25, contract: 100, quoteIsUsd: true },
  { symbol: "XAGUSD", name: "Silver / US Dollar", base: 28.5, vol: 0.008, digits: 3, spread: 0.02, contract: 5000, quoteIsUsd: true },
  { symbol: "USOIL", name: "WTI Crude Oil", base: 78.4, vol: 0.012, digits: 2, spread: 0.03, contract: 1000, quoteIsUsd: true },
  { symbol: "US30", name: "Dow Jones 30", base: 39100, vol: 0.005, digits: 1, spread: 2, contract: 1, quoteIsUsd: true },
  { symbol: "NAS100", name: "Nasdaq 100", base: 17850, vol: 0.007, digits: 1, spread: 2, contract: 1, quoteIsUsd: true },
  { symbol: "SPX500", name: "S&P 500", base: 5230, vol: 0.005, digits: 1, spread: 0.5, contract: 1, quoteIsUsd: true },
  { symbol: "GER40", name: "DAX 40", base: 18150, vol: 0.006, digits: 1, spread: 2, contract: 1, quoteIsUsd: false, usdPerQuote: 1.08 },
  { symbol: "UK100", name: "FTSE 100", base: 8020, vol: 0.005, digits: 1, spread: 1.5, contract: 1, quoteIsUsd: false, usdPerQuote: 1.27 },
  { symbol: "BTCUSD", name: "Bitcoin / US Dollar", base: 67400, vol: 0.015, digits: 1, spread: 15, contract: 1, quoteIsUsd: true },
  { symbol: "ETHUSD", name: "Ethereum / US Dollar", base: 3120, vol: 0.018, digits: 2, spread: 1.5, contract: 1, quoteIsUsd: true },
];

export const LEVERAGE = 100;

export function getInstrument(symbol: string): Instrument {
  const i = INSTRUMENTS.find((x) => x.symbol === symbol);
  if (!i) throw new Error("Unknown instrument");
  return i;
}

function seed(symbol: string, k: number) {
  let h = k * 9301;
  for (const c of symbol) h = (h * 31 + c.charCodeAt(0)) % 100000;
  return (h / 100000) * Math.PI * 2;
}

/** Mid price at time t (ms). */
export function midPrice(symbol: string, t: number): number {
  const i = getInstrument(symbol);
  const s = t / 1000;
  const wave =
    Math.sin(s / 6 + seed(symbol, 1)) * 0.08 +
    Math.sin(s / 41 + seed(symbol, 2)) * 0.3 +
    Math.sin(s / 613 + seed(symbol, 3)) * 0.7 +
    Math.sin(s / 7919 + seed(symbol, 4)) * 1.2;
  return i.base * (1 + i.vol * wave);
}

export function quote(symbol: string, t: number) {
  const i = getInstrument(symbol);
  const mid = midPrice(symbol, t);
  return { bid: mid - i.spread / 2, ask: mid + i.spread / 2, mid };
}

export function history(symbol: string, t: number, points = 120, stepMs = 5000) {
  const out: { t: number; p: number }[] = [];
  for (let k = points - 1; k >= 0; k--) {
    const tt = t - k * stepMs;
    out.push({ t: tt, p: midPrice(symbol, tt) });
  }
  return out;
}

export const fmt = (symbol: string, p: number) => p.toFixed(getInstrument(symbol).digits);
