export const REALTIME_SYMBOLS = {
  XAUUSD: "XAU/USD",
  BTCUSD: "BTC/USD",
} as const;

export type RealtimeSymbol = keyof typeof REALTIME_SYMBOLS;

export function isRealtimeSymbol(value: string): value is RealtimeSymbol {
  return Object.prototype.hasOwnProperty.call(REALTIME_SYMBOLS, value);
}
