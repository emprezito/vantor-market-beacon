import { describe, expect, it } from "vitest";
import { buildChartMarkers } from "@/lib/chart-markers";

const FROM = 1_700_000_000;
const TO = 1_700_003_600;

describe("chart markers", () => {
  it("maps open, pending and closed trades onto bucketed candle times", () => {
    const markers = buildChartMarkers({
      positions: [
        {
          side: "buy",
          lots: 0.1,
          opened_at: new Date(1_700_000_100_000).toISOString(),
        },
      ],
      pendingOrders: [
        {
          side: "sell",
          lots: 0.2,
          limit_price: 1.2,
          created_at: new Date(1_700_001_200_000).toISOString(),
          status: "pending",
        },
      ],
      closedPositions: [
        {
          side: "buy",
          lots: 0.3,
          close_price: 1.25,
          closed_at: new Date(1_700_002_500_000).toISOString(),
          close_reason: "take_profit",
          pnl: 10,
        },
      ],
      interval: "5min",
      from: FROM,
      to: TO,
    });

    expect(markers).toHaveLength(3);
    expect(markers.map((marker) => marker.time)).toEqual([
      1_700_000_100, 1_700_001_000, 1_700_002_500,
    ]);
    expect(markers[0]).toMatchObject({
      position: "belowBar",
      shape: "arrowUp",
      text: "BUY 0.10",
    });
    expect(markers[1]).toMatchObject({
      position: "atPriceMiddle",
      shape: "square",
      price: 1.2,
      text: "SELL LIMIT 0.20",
    });
    expect(markers[2]).toMatchObject({
      position: "atPriceMiddle",
      shape: "circle",
      price: 1.25,
      text: "TP 0.30",
    });
  });

  it("skips stale or filled orders and clamps future markers", () => {
    const markers = buildChartMarkers({
      positions: [
        {
          side: "sell",
          lots: 0.1,
          opened_at: new Date(1_699_999_000_000).toISOString(),
        },
      ],
      pendingOrders: [
        {
          side: "buy",
          lots: 0.1,
          limit_price: 1.1,
          created_at: new Date(1_700_001_000_000).toISOString(),
          status: "filled",
        },
        {
          side: "buy",
          lots: 0.1,
          limit_price: 1.1,
          created_at: new Date(1_700_010_000_000).toISOString(),
          status: "pending",
        },
      ],
      closedPositions: [],
      interval: "5min",
      from: FROM,
      to: TO,
    });

    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      time: TO,
      position: "atPriceMiddle",
      text: "BUY LIMIT 0.10",
    });
  });
});
