import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  CHART_INDICATOR_LABELS,
  ema,
  lineData,
  macdData,
  rsi,
  sma,
  type ChartIndicators,
} from "@/lib/chart-indicators";
import { getInstrument } from "@/lib/market";
import {
  intervalMs,
  type ChartInterval,
  type MarketCandle,
  type MarketQuote,
} from "@/lib/market-data";
import type { Side } from "@/lib/trading";

type ChartPosition = {
  id: string;
  side: string;
  lots: number;
  open_price: number;
};

function bucketTime(ts: number, interval: ChartInterval): number {
  const ms = intervalMs(interval);
  return (Math.floor(ts / ms) * ms) / 1000;
}

function mergeLiveBar(
  candles: MarketCandle[],
  quote: MarketQuote,
  interval: ChartInterval,
): MarketCandle[] {
  const live = candles[candles.length - 1];
  if (!live) return candles;
  const bucket = bucketTime(quote.ts, interval);
  if (bucket < live.time) return candles;
  if (bucket === live.time) {
    return [
      ...candles.slice(0, -1),
      {
        ...live,
        high: Math.max(live.high, quote.mid),
        low: Math.min(live.low, quote.mid),
        close: quote.mid,
      },
    ];
  }
  return [
    ...candles,
    {
      time: bucket,
      open: live.close,
      high: Math.max(live.close, quote.mid),
      low: Math.min(live.close, quote.mid),
      close: quote.mid,
    },
  ];
}

export function PriceChart({
  symbol,
  quote,
  candles,
  interval,
  positions,
  indicators,
}: {
  symbol: string;
  quote: MarketQuote;
  candles: MarketCandle[];
  interval: ChartInterval;
  positions: ChartPosition[];
  indicators: ChartIndicators;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const smaRef = useRef<ISeriesApi<"Line"> | null>(null);
  const emaRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdSignalRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdHistogramRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const barsRef = useRef<MarketCandle[]>([]);
  const fittedRef = useRef(false);
  const lastIntervalRef = useRef<ChartInterval | null>(null);

  const chartKey = `${symbol}:${indicators.sma}:${indicators.ema}:${indicators.rsi}:${indicators.macd}`;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const digits = getInstrument(symbol).digits;
    const chart = createChart(container, {
      autoSize: true,
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
      timeScale: {
        borderColor: "#e2e8f0",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a",
      downColor: "#dc2626",
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
      borderVisible: false,
      priceFormat: { type: "price", precision: digits, minMove: 1 / 10 ** digits },
    });

    smaRef.current = indicators.sma
      ? chart.addSeries(LineSeries, {
          color: "#d97706",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          title: CHART_INDICATOR_LABELS.sma,
        })
      : null;

    emaRef.current = indicators.ema
      ? chart.addSeries(LineSeries, {
          color: "#7c3aed",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          title: CHART_INDICATOR_LABELS.ema,
        })
      : null;

    let paneIndex = 1;
    if (indicators.rsi) {
      const rsiSeries = chart.addSeries(
        LineSeries,
        {
          color: "#0891b2",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          priceFormat: { type: "price", precision: 2, minMove: 0.01 },
          autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
          title: CHART_INDICATOR_LABELS.rsi,
        },
        paneIndex,
      );
      rsiSeries.createPriceLine({
        price: 70,
        color: "#94a3b8",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: "",
      });
      rsiSeries.createPriceLine({
        price: 30,
        color: "#94a3b8",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: "",
      });
      rsiRef.current = rsiSeries;
      paneIndex += 1;
    } else {
      rsiRef.current = null;
    }

    if (indicators.macd) {
      macdHistogramRef.current = chart.addSeries(
        HistogramSeries,
        {
          priceLineVisible: false,
          lastValueVisible: false,
          priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
          title: CHART_INDICATOR_LABELS.macd,
        },
        paneIndex,
      );
      macdRef.current = chart.addSeries(
        LineSeries,
        {
          color: "#2563eb",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          title: "MACD",
        },
        paneIndex,
      );
      macdSignalRef.current = chart.addSeries(
        LineSeries,
        {
          color: "#f59e0b",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          title: "Signal",
        },
        paneIndex,
      );
    } else {
      macdRef.current = null;
      macdSignalRef.current = null;
      macdHistogramRef.current = null;
    }

    const panes = chart.panes();
    panes[0]?.setStretchFactor(3);
    let stretchIndex = 1;
    if (indicators.rsi) {
      panes[stretchIndex]?.setStretchFactor(1);
      stretchIndex += 1;
    }
    if (indicators.macd) panes[stretchIndex]?.setStretchFactor(1);

    chartRef.current = chart;
    seriesRef.current = series;
    priceLinesRef.current = [];
    barsRef.current = [];
    fittedRef.current = false;
    lastIntervalRef.current = null;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      smaRef.current = null;
      emaRef.current = null;
      rsiRef.current = null;
      macdRef.current = null;
      macdSignalRef.current = null;
      macdHistogramRef.current = null;
      priceLinesRef.current = [];
      barsRef.current = [];
      fittedRef.current = false;
      lastIntervalRef.current = null;
    };
  }, [chartKey, symbol, indicators.sma, indicators.ema, indicators.rsi, indicators.macd]);

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
    barsRef.current = candles;

    const closes = candles.map((candle) => candle.close);
    if (smaRef.current) {
      smaRef.current.setData(
        lineData(candles, sma(closes, 20)).map((point) => ({
          time: point.time as UTCTimestamp,
          value: point.value,
        })),
      );
    }
    if (emaRef.current) {
      emaRef.current.setData(
        lineData(candles, ema(closes, 50)).map((point) => ({
          time: point.time as UTCTimestamp,
          value: point.value,
        })),
      );
    }
    if (rsiRef.current) {
      rsiRef.current.setData(
        lineData(candles, rsi(closes, 14)).map((point) => ({
          time: point.time as UTCTimestamp,
          value: point.value,
        })),
      );
    }
    if (macdRef.current && macdSignalRef.current && macdHistogramRef.current) {
      const values = macdData(candles, closes);
      macdRef.current.setData(
        values.macd.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })),
      );
      macdSignalRef.current.setData(
        values.signal.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })),
      );
      macdHistogramRef.current.setData(
        values.histogram.map((point) => ({
          time: point.time as UTCTimestamp,
          value: point.value,
          color: point.value >= 0 ? "#16a34a" : "#dc2626",
        })),
      );
    }

    const intervalChanged = lastIntervalRef.current !== interval;
    lastIntervalRef.current = interval;
    if (candles.length > 0 && (!fittedRef.current || intervalChanged)) {
      chart.timeScale().fitContent();
      fittedRef.current = true;
    }
  }, [chartKey, candles, interval]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    const next = mergeLiveBar(barsRef.current, quote, interval);
    if (next === barsRef.current || next.length === 0) return;
    const last = next[next.length - 1]!;
    series.update({
      time: last.time as UTCTimestamp,
      open: last.open,
      high: last.high,
      low: last.low,
      close: last.close,
    });
    barsRef.current = next;

    const closes = next.map((candle) => candle.close);
    if (smaRef.current) {
      smaRef.current.setData(
        lineData(next, sma(closes, 20)).map((point) => ({
          time: point.time as UTCTimestamp,
          value: point.value,
        })),
      );
    }
    if (emaRef.current) {
      emaRef.current.setData(
        lineData(next, ema(closes, 50)).map((point) => ({
          time: point.time as UTCTimestamp,
          value: point.value,
        })),
      );
    }
    if (rsiRef.current) {
      rsiRef.current.setData(
        lineData(next, rsi(closes, 14)).map((point) => ({
          time: point.time as UTCTimestamp,
          value: point.value,
        })),
      );
    }
    if (macdRef.current && macdSignalRef.current && macdHistogramRef.current) {
      const values = macdData(next, closes);
      macdRef.current.setData(
        values.macd.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })),
      );
      macdSignalRef.current.setData(
        values.signal.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })),
      );
      macdHistogramRef.current.setData(
        values.histogram.map((point) => ({
          time: point.time as UTCTimestamp,
          value: point.value,
          color: point.value >= 0 ? "#16a34a" : "#dc2626",
        })),
      );
    }
  }, [chartKey, interval, quote]);

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
  }, [chartKey, positions]);

  return (
    <div>
      <div ref={containerRef} className="h-[420px] w-full sm:h-[480px]" />
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
