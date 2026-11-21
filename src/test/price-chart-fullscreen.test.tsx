import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  let visibleRangeHandler: ((range: { from: number; to: number } | null) => void) | null = null;
  const timeScale = {
    getVisibleLogicalRange: vi.fn(() => ({ from: 20, to: 120 })),
    setVisibleLogicalRange: vi.fn(),
    subscribeVisibleLogicalRangeChange: vi.fn(
      (handler: (range: { from: number; to: number } | null) => void) => {
        visibleRangeHandler = handler;
      },
    ),
    unsubscribeVisibleLogicalRangeChange: vi.fn(),
  };
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
      timeScale: vi.fn(() => timeScale),
      applyOptions: vi.fn(),
      priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
    },
    markers: { setMarkers: vi.fn() },
    timeScale,
    emitVisibleRange: (range: { from: number; to: number } | null) =>
      visibleRangeHandler?.(range),
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

beforeEach(() => vi.clearAllMocks());
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

  it("loads older candles when the user scrolls near the left edge", () => {
    const onLoadOlder = vi.fn();
    render(
      <PriceChart
        symbol="EURUSD"
        quote={quote}
        candles={[]}
        interval="1min"
        positions={[]}
        pendingOrders={[]}
        closedPositions={[]}
        indicators={{ sma: false, ema: false, rsi: false, macd: false }}
        onLoadOlder={onLoadOlder}
        hasOlder
      />,
    );

    act(() => mocks.emitVisibleRange({ from: 150, to: 250 }));
    expect(onLoadOlder).not.toHaveBeenCalled();

    act(() => mocks.emitVisibleRange({ from: 80, to: 180 }));
    expect(onLoadOlder).toHaveBeenCalledTimes(1);

    act(() => mocks.emitVisibleRange({ from: 70, to: 170 }));
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it("keeps the same candles visible when older history is prepended", () => {
    const recent = [
      { time: 300, open: 1.1, high: 1.2, low: 1, close: 1.15 },
      { time: 400, open: 1.15, high: 1.25, low: 1.1, close: 1.2 },
    ];
    const props = {
      symbol: "EURUSD",
      quote,
      interval: "1min" as const,
      positions: [],
      pendingOrders: [],
      closedPositions: [],
      indicators: { sma: false, ema: false, rsi: false, macd: false },
    };
    const { rerender } = render(<PriceChart {...props} candles={recent} />);
    mocks.timeScale.setVisibleLogicalRange.mockClear();
    mocks.timeScale.getVisibleLogicalRange.mockReturnValue({ from: 20, to: 120 });

    rerender(
      <PriceChart
        {...props}
        candles={[
          { time: 100, open: 1, high: 1.1, low: 0.9, close: 1.05 },
          { time: 200, open: 1.05, high: 1.15, low: 1, close: 1.1 },
          ...recent,
        ]}
      />,
    );

    expect(mocks.timeScale.setVisibleLogicalRange).toHaveBeenLastCalledWith({
      from: 22,
      to: 122,
    });
  });
});
