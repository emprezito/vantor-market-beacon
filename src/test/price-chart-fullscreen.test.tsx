import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const makeSeries = () => ({
    setData: vi.fn(),
    update: vi.fn(),
    createPriceLine: vi.fn(() => ({})),
    removePriceLine: vi.fn(),
    priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
  });
  const makePane = () => ({
    setStretchFactor: vi.fn(),
    paneIndex: vi.fn(() => 1),
    moveTo: vi.fn(),
    addSeries: vi.fn(makeSeries),
  });
  return {
    chart: {
      addSeries: vi.fn(makeSeries),
      removeSeries: vi.fn(),
      addPane: vi.fn(makePane),
      removePane: vi.fn(),
      panes: vi.fn(() => []),
      subscribeCrosshairMove: vi.fn(),
      unsubscribeCrosshairMove: vi.fn(),
      remove: vi.fn(),
      timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
      applyOptions: vi.fn(),
      priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
    },
    markers: { setMarkers: vi.fn() },
  };
});

vi.mock("lightweight-charts", () => ({
  CandlestickSeries: "CandlestickSeries",
  ColorType: { Solid: "solid" },
  CrosshairMode: { Normal: 0, MagnetOHLC: 1 },
  HistogramSeries: "HistogramSeries",
  LineSeries: "LineSeries",
  LineStyle: { Dashed: 2 },
  PriceScaleMode: { Normal: 0, Logarithmic: 1, Percentage: 2 },
  TickMarkType: { Year: 0, Month: 1, DayOfMonth: 2, TimeWithSeconds: 3 },
  createChart: vi.fn(() => mocks.chart),
  createSeriesMarkers: vi.fn(() => mocks.markers),
}));

import { PriceChart } from "@/components/price-chart";
import type { MarketQuote } from "@/lib/market-data";

const quote: MarketQuote = {
  symbol: "EURUSD",
  bid: 1.0999,
  ask: 1.1001,
  mid: 1.1,
  ts: 1_800_000_000_000,
  source: "live",
  feed: "meridian",
};

function renderChart() {
  return render(
    <PriceChart
      symbol="EURUSD"
      quote={quote}
      candles={[]}
      interval="5min"
      positions={[]}
      pendingOrders={[]}
      closedPositions={[]}
      indicators={{ sma: false, ema: false, rsi: false, macd: false }}
    />,
  );
}

afterEach(cleanup);

describe("price chart fullscreen", () => {
  it("expands to a fullscreen overlay and locks page scrolling", () => {
    renderChart();
    fireEvent.click(screen.getByRole("button", { name: "Expand chart to fullscreen" }));

    const exit = screen.getByRole("button", { name: "Exit fullscreen chart" });
    expect(document.activeElement).toBe(exit);
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("exits fullscreen with Escape and restores scrolling", () => {
    renderChart();
    fireEvent.click(screen.getByRole("button", { name: "Expand chart to fullscreen" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByRole("button", { name: "Expand chart to fullscreen" })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });
});
