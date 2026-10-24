import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { fmt } from "@/lib/market";
import { intervalMs, type ChartInterval, type MarketCandle, type MarketQuote } from "@/lib/market-data";
import type { Side } from "@/lib/trading";

type ChartPosition = {
  id: string;
  side: string;
  lots: number;
  open_price: number;
};

export function PriceChart({
  symbol,
  quote,
  candles,
  interval,
  positions,
}: {
  symbol: string;
  quote: MarketQuote;
  candles: MarketCandle[];
  interval: ChartInterval;
  positions: ChartPosition[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const liveBarRef = useRef<MarketCandle | null>(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      height: 320,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#64748b",
        fontFamily: "Manrope, sans-serif",
      },
      grid: {
        vertLines: { color: "#f1f5f9" },
        horzLines: { color: "#f1f5f9" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#94a3b8", labelBackgroundColor: "#334155" },
        horzLine: { color: "#94a3b8", labelBackgroundColor: "#334155" },
      },
      rightPriceScale: { borderColor: "#e2e8f0", scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderColor: "#e2e8f0", timeVisible: true, secondsVisible: false, rightOffset: 4 },
      localization: { priceFormatter: (price: number) => fmt(symbol, price) },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a",
      downColor: "#dc2626",
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
      borderVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = series;
    priceLinesRef.current = [];
    liveBarRef.current = null;
    fittedRef.current = false;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceLinesRef.current = [];
      liveBarRef.current = null;
      fittedRef.current = false;
    };
  }, [symbol]);

  useEffect(() => {
    fittedRef.current = false;
  }, [interval]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    series.setData(
      candles.map((candle) => ({
        time: candle.time as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    );

    const last = candles[candles.length - 1];
    liveBarRef.current = last ? { ...last } : null;

    if (candles.length > 0 && !fittedRef.current) {
      chart.timeScale().fitContent();
      fittedRef.current = true;
    }
  }, [candles]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    const price = quote.mid;
    const ms = intervalMs(interval);
    const bucketTime = Math.floor(quote.ts / ms) * ms;
    const live = liveBarRef.current;
    const current = live && live.time === bucketTime / 1000 ? live : null;

    const next = current
      ? {
          time: current.time,
          open: current.open,
          high: Math.max(current.high, price),
          low: Math.min(current.low, price),
          close: price,
        }
      : live && live.time < bucketTime / 1000
        ? {
            time: bucketTime / 1000,
            open: live.close,
            high: Math.max(live.close, price),
            low: Math.min(live.close, price),
            close: price,
          }
        : null;

    if (!next) return;

    series.update({
      time: next.time as UTCTimestamp,
      open: next.open,
      high: next.high,
      low: next.low,
      close: next.close,
    });
    liveBarRef.current = next;
  }, [candles, interval, quote]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    for (const line of priceLinesRef.current) series.removePriceLine(line);
    priceLinesRef.current = positions.map((position) => {
      const side = position.side as Side;
      return series.createPriceLine({
        price: Number(position.open_price),
        color: side === "buy" ? "#16a34a" : "#dc2626",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${side.toUpperCase()} ${Number(position.lots).toFixed(2)}`,
      });
    });
  }, [positions, symbol]);

  return (
    <div>
      <div ref={containerRef} className="h-64 w-full sm:h-80" />
      <div className="mt-1 text-right text-[10px] text-muted-foreground">
        Charts by{" "}
        <a
          href="https://www.tradingview.com"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          TradingView
        </a>
      </div>
    </div>
  );
}
