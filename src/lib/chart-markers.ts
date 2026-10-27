import type { SeriesMarker, UTCTimestamp } from "lightweight-charts";
import { intervalMs, type ChartInterval } from "./market-data";

export type MarkerPosition = {
  side: string;
  lots: number;
  opened_at: string;
};

export type MarkerPendingOrder = {
  side: string;
  lots: number;
  limit_price: number;
  created_at: string;
  status?: string;
};

export type MarkerClosedPosition = {
  side: string;
  lots: number;
  close_price: number | null;
  closed_at: string | null;
  close_reason: string | null;
  pnl?: number | null;
};

const BUY_COLOR = "#16a34a";
const SELL_COLOR = "#dc2626";
const PENDING_COLOR = "#d97706";
const CLOSE_COLOR = "#64748b";

function markerTime(
  value: string | null | undefined,
  interval: ChartInterval,
  from: number,
  to: number,
): UTCTimestamp | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const step = intervalMs(interval);
  const time = (Math.floor(ms / step) * step) / 1000;
  if (time < from) return null;
  return Math.min(time, to) as UTCTimestamp;
}

function closeLabel(reason: string | null): string {
  const normalized = (reason ?? "").toLowerCase();
  if (normalized.includes("stop")) return "SL";
  if (normalized.includes("take") || normalized.includes("profit")) return "TP";
  return "CLOSE";
}

export function buildChartMarkers({
  positions,
  pendingOrders,
  closedPositions,
  interval,
  from,
  to,
}: {
  positions: MarkerPosition[];
  pendingOrders: MarkerPendingOrder[];
  closedPositions: MarkerClosedPosition[];
  interval: ChartInterval;
  from: number;
  to: number;
}): SeriesMarker<UTCTimestamp>[] {
  if (to < from) return [];
  const markers: SeriesMarker<UTCTimestamp>[] = [];

  for (const position of positions) {
    const time = markerTime(position.opened_at, interval, from, to);
    if (!time) continue;
    const buy = position.side === "buy";
    markers.push({
      time,
      position: buy ? "belowBar" : "aboveBar",
      shape: buy ? "arrowUp" : "arrowDown",
      color: buy ? BUY_COLOR : SELL_COLOR,
      text: `${buy ? "BUY" : "SELL"} ${Number(position.lots).toFixed(2)}`,
    });
  }

  for (const order of pendingOrders) {
    if (order.status && order.status !== "pending") continue;
    const time = markerTime(order.created_at, interval, from, to);
    if (!time) continue;
    const buy = order.side === "buy";
    markers.push({
      time,
      position: "atPriceMiddle",
      price: Number(order.limit_price),
      shape: "square",
      color: PENDING_COLOR,
      text: `${buy ? "BUY" : "SELL"} LIMIT ${Number(order.lots).toFixed(2)}`,
    });
  }

  for (const position of closedPositions) {
    const time = markerTime(position.closed_at, interval, from, to);
    if (!time || position.close_price == null) continue;
    const label = closeLabel(position.close_reason);
    markers.push({
      time,
      position: "atPriceMiddle",
      price: Number(position.close_price),
      shape: "circle",
      color: label === "TP" ? BUY_COLOR : label === "SL" ? SELL_COLOR : CLOSE_COLOR,
      text: `${label} ${Number(position.lots).toFixed(2)}`,
    });
  }

  return markers.sort((left, right) => Number(left.time) - Number(right.time));
}
