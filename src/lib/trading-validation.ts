import { INSTRUMENTS } from "./market";
import type { Side } from "./trading";

export type OrderInput = { symbol: string; side: Side; lots: number; stopLoss: number | null; takeProfit: number | null };
export type LimitOrderInput = OrderInput & { limitPrice: number };
export function validateOrder(i: OrderInput) {
  if (!INSTRUMENTS.some((x) => x.symbol === i.symbol)) throw new Error("Unknown instrument");
  if (i.side !== "buy" && i.side !== "sell") throw new Error("Invalid side");
  if (!Number.isFinite(i.lots) || i.lots < 0.01 || i.lots > 100 || Math.abs(i.lots * 100 - Math.round(i.lots * 100)) > 1e-8) throw new Error("Lots must be between 0.01 and 100 in steps of 0.01");
  for (const price of [i.stopLoss, i.takeProfit]) {
    if (price != null && (!Number.isFinite(price) || price <= 0)) throw new Error("Stop prices must be positive, finite numbers");
  }
  return i;
}
export function validateLimitOrder(i: LimitOrderInput) {
  const order = validateOrder(i);
  if (!Number.isFinite(i.limitPrice) || i.limitPrice <= 0) throw new Error("Limit price must be a positive, finite number");
  return { ...order, limitPrice: i.limitPrice };
}
export function validateFunds(i: { kind: "deposit" | "withdraw"; amount: number }) {
  if (i.kind !== "deposit" && i.kind !== "withdraw") throw new Error("Invalid transaction");
  if (!Number.isFinite(i.amount) || i.amount < 1 || i.amount > 1000000 || Math.abs(i.amount * 100 - Math.round(i.amount * 100)) > 1e-8) throw new Error("Amount must be between $1 and $1,000,000 with at most two decimals");
  return i;
}