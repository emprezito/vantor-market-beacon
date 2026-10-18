// Simulated market: prices are a deterministic function of time, so the
// browser and server always agree on the price at a given moment.

export type Instrument = {
  symbol: string;
  name: string;
  base: number;
  vol: number; // relative swing size
  digits: number;
  spread: number; // absolute
  contract: number; // units per 1 lot
  quoteIsUsd: boolean; // false => P/L must be divided by price (e.g. USD/JPY)
};

export const INSTRUMENTS: Instrument[] = [
  { symbol: "EURUSD", name: "Euro / US Dollar", base: 1.085, vol: 0.004, digits: 5, spread: 0.00008, contract: 100000, quoteIsUsd: true },
  { symbol: "GBPUSD", name: "British Pound / US Dollar", base: 1.273, vol: 0.005, digits: 5, spread: 0.0001, contract: 100000, quoteIsUsd: true },
  { symbol: "USDJPY", name: "US Dollar / Japanese Yen", base: 151.2, vol: 0.004, digits: 3, spread: 0.012, contract: 100000, quoteIsUsd: false },
  { symbol: "XAUUSD", name: "Gold / US Dollar", base: 2384, vol: 0.006, digits: 2, spread: 0.25, contract: 100, quoteIsUsd: true },
  { symbol: "US30", name: "Dow Jones 30", base: 39100, vol: 0.005, digits: 1, spread: 2, contract: 1, quoteIsUsd: true },
  { symbol: "BTCUSD", name: "Bitcoin / US Dollar", base: 67400, vol: 0.015, digits: 1, spread: 15, contract: 1, quoteIsUsd: true },
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
