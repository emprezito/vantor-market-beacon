import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera } from "lucide-react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  TickMarkType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPaneApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type Time,
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
import { buildChartMarkers } from "@/lib/chart-markers";
import { fmt, getInstrument } from "@/lib/market";
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
  opened_at: string;
};

type ChartPendingOrder = {
  id: string;
  side: string;
  lots: number;
  limit_price: number;
  created_at: string;
  status?: string;
};

type ChartClosedPosition = {
  id: string;
  side: string;
  lots: number;
  close_price: number | null;
  closed_at: string | null;
  close_reason: string | null;
};

type HoveredBar = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | undefined;
  sma?: number | undefined;
  ema?: number | undefined;
  rsi?: number | undefined;
  macd?: number | undefined;
  signal?: number | undefined;
  histogram?: number | undefined;
};

type TimeZoneMode = "utc" | "local";

const compactVolume = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

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
      ...(live.volume == null ? {} : { volume: live.volume }),
    },
  ];
}

function timeToMs(time: Time): number | null {
  if (typeof time === "number") return time * 1000;
  if (typeof time === "string") {
    const parsed = Date.parse(time);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (time && typeof time === "object" && "year" in time) {
    return Date.UTC(time.year, time.month - 1, time.day);
  }
  return null;
}

function formatTime(time: Time, timeZone: TimeZoneMode): string {
  const ms = timeToMs(time);
  if (ms == null) return String(time);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timeZone === "utc" ? "UTC" : undefined,
  }).format(ms);
}

function formatTick(time: Time, tickMarkType: TickMarkType, timeZone: TimeZoneMode): string {
  const ms = timeToMs(time);
  if (ms == null) return String(time);
  const zone = timeZone === "utc" ? "UTC" : undefined;
  if (tickMarkType === TickMarkType.Year) {
    return new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: zone }).format(ms);
  }
  if (tickMarkType === TickMarkType.Month) {
    return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: zone }).format(ms);
  }
  if (tickMarkType === TickMarkType.DayOfMonth) {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "2-digit",
      timeZone: zone,
    }).format(ms);
  }
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    ...(tickMarkType === TickMarkType.TimeWithSeconds ? { second: "2-digit" } : {}),
    hourCycle: "h23",
    timeZone: zone,
  }).format(ms);
}

export function PriceChart({
  symbol,
  quote,
  candles,
  interval,
  positions,
  pendingOrders,
  closedPositions,
  indicators,
}: {
  symbol: string;
  quote: MarketQuote;
  candles: MarketCandle[];
  interval: ChartInterval;
  positions: ChartPosition[];
  pendingOrders: ChartPendingOrder[];
  closedPositions: ChartClosedPosition[];
  indicators: ChartIndicators;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const smaRef = useRef<ISeriesApi<"Line"> | null>(null);
  const emaRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiPaneRef = useRef<IPaneApi<Time> | null>(null);
  const macdRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdSignalRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdHistogramRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const macdPaneRef = useRef<IPaneApi<Time> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const volumePaneRef = useRef<IPaneApi<Time> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const barsRef = useRef<MarketCandle[]>([]);
  const fittedRef = useRef(false);
  const lastIntervalRef = useRef<ChartInterval | null>(null);
  const [hovered, setHovered] = useState<HoveredBar | null>(null);
  const [scaleMode, setScaleMode] = useState<PriceScaleMode>(PriceScaleMode.Normal);
  const [invertScale, setInvertScale] = useState(false);
  const [timeZone, setTimeZone] = useState<TimeZoneMode>("utc");
  const [magnet, setMagnet] = useState(false);

  const hasVolume = useMemo(
    () => candles.some((candle) => typeof candle.volume === "number" && candle.volume > 0),
    [candles],
  );

  const lastIndicatorValues = useMemo(() => {
    const closes = candles.map((candle) => candle.close);
    const lastValue = (points: { value: number }[]) => points[points.length - 1]?.value;
    const macdValues = macdData(candles, closes);
    return {
      sma: indicators.sma ? lastValue(lineData(candles, sma(closes, 20))) : undefined,
      ema: indicators.ema ? lastValue(lineData(candles, ema(closes, 50))) : undefined,
      rsi: indicators.rsi ? lastValue(lineData(candles, rsi(closes, 14))) : undefined,
      macd: indicators.macd ? lastValue(macdValues.macd) : undefined,
      signal: indicators.macd ? lastValue(macdValues.signal) : undefined,
      histogram: indicators.macd ? lastValue(macdValues.histogram) : undefined,
    };
  }, [candles, indicators.ema, indicators.macd, indicators.rsi, indicators.sma]);

  const reorderPanes = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const ordered = [rsiPaneRef.current, macdPaneRef.current, volumePaneRef.current].filter(
      (pane): pane is IPaneApi<Time> => pane != null,
    );
    ordered.forEach((pane, index) => {
      if (pane.paneIndex() !== index + 1) pane.moveTo(index + 1);
    });
    const panes = chart.panes();
    panes[0]?.setStretchFactor(3);
    rsiPaneRef.current?.setStretchFactor(1);
    macdPaneRef.current?.setStretchFactor(1);
    volumePaneRef.current?.setStretchFactor(0.8);
  }, []);

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
        panes: {
          enableResize: true,
          separatorColor: "#e2e8f0",
          separatorHoverColor: "rgba(148, 163, 184, 0.25)",
        },
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
    const markers = createSeriesMarkers(series, []);

    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = markers;
    smaRef.current = null;
    emaRef.current = null;
    rsiRef.current = null;
    rsiPaneRef.current = null;
    macdRef.current = null;
    macdSignalRef.current = null;
    macdHistogramRef.current = null;
    macdPaneRef.current = null;
    volumeRef.current = null;
    volumePaneRef.current = null;
    priceLinesRef.current = [];
    barsRef.current = [];
    fittedRef.current = false;
    lastIntervalRef.current = null;
    setHovered(null);

    const handleCrosshair = (param: MouseEventParams<Time>) => {
      const candle = param.seriesData.get(series);
      if (!param.time || !candle || !("open" in candle)) {
        setHovered(null);
        return;
      }
      const value = (seriesRef: ISeriesApi<"Line"> | ISeriesApi<"Histogram"> | null) => {
        if (!seriesRef) return undefined;
        const data = param.seriesData.get(seriesRef);
        return data && "value" in data && typeof data.value === "number" ? data.value : undefined;
      };
      setHovered({
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: value(volumeRef.current),
        sma: value(smaRef.current),
        ema: value(emaRef.current),
        rsi: value(rsiRef.current),
        macd: value(macdRef.current),
        signal: value(macdSignalRef.current),
        histogram: value(macdHistogramRef.current),
      });
    };
    chart.subscribeCrosshairMove(handleCrosshair);

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshair);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      smaRef.current = null;
      emaRef.current = null;
      rsiRef.current = null;
      rsiPaneRef.current = null;
      macdRef.current = null;
      macdSignalRef.current = null;
      macdHistogramRef.current = null;
      macdPaneRef.current = null;
      volumeRef.current = null;
      volumePaneRef.current = null;
      markersRef.current = null;
      priceLinesRef.current = [];
      barsRef.current = [];
      fittedRef.current = false;
      lastIntervalRef.current = null;
    };
  }, [symbol]);

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

    const intervalChanged = lastIntervalRef.current !== interval;
    lastIntervalRef.current = interval;
    if (candles.length > 0 && (!fittedRef.current || intervalChanged)) {
      chart.timeScale().fitContent();
      fittedRef.current = true;
    }
  }, [candles, interval, symbol]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const data = barsRef.current.length > 0 ? barsRef.current : candles;
    const closes = data.map((candle) => candle.close);

    if (indicators.sma) {
      if (!smaRef.current) {
        smaRef.current = chart.addSeries(LineSeries, {
          color: "#d97706",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          title: CHART_INDICATOR_LABELS.sma,
        });
      }
      smaRef.current.setData(
        lineData(data, sma(closes, 20)).map((point) => ({
          time: point.time as UTCTimestamp,
          value: point.value,
        })),
      );
    } else if (smaRef.current) {
      chart.removeSeries(smaRef.current);
      smaRef.current = null;
    }

    if (indicators.ema) {
      if (!emaRef.current) {
        emaRef.current = chart.addSeries(LineSeries, {
          color: "#7c3aed",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          title: CHART_INDICATOR_LABELS.ema,
        });
      }
      emaRef.current.setData(
        lineData(data, ema(closes, 50)).map((point) => ({
          time: point.time as UTCTimestamp,
          value: point.value,
        })),
      );
    } else if (emaRef.current) {
      chart.removeSeries(emaRef.current);
      emaRef.current = null;
    }

    if (indicators.rsi) {
      if (!rsiPaneRef.current || !rsiRef.current) {
        const pane = chart.addPane();
        pane.setStretchFactor(1);
        const rsiSeries = pane.addSeries(LineSeries, {
          color: "#0891b2",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          priceFormat: { type: "price", precision: 2, minMove: 0.01 },
          autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
          title: CHART_INDICATOR_LABELS.rsi,
        });
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
        rsiPaneRef.current = pane;
        rsiRef.current = rsiSeries;
      }
      rsiRef.current.setData(
        lineData(data, rsi(closes, 14)).map((point) => ({
          time: point.time as UTCTimestamp,
          value: point.value,
        })),
      );
    } else {
      if (rsiPaneRef.current) {
        chart.removePane(rsiPaneRef.current.paneIndex());
        rsiPaneRef.current = null;
      }
      rsiRef.current = null;
    }

    if (indicators.macd) {
      if (
        !macdPaneRef.current ||
        !macdRef.current ||
        !macdSignalRef.current ||
        !macdHistogramRef.current
      ) {
        const pane = chart.addPane();
        pane.setStretchFactor(1);
        macdHistogramRef.current = pane.addSeries(HistogramSeries, {
          priceLineVisible: false,
          lastValueVisible: false,
          priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
          title: CHART_INDICATOR_LABELS.macd,
        });
        macdRef.current = pane.addSeries(LineSeries, {
          color: "#2563eb",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          title: "MACD",
        });
        macdSignalRef.current = pane.addSeries(LineSeries, {
          color: "#f59e0b",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          title: "Signal",
        });
        macdPaneRef.current = pane;
      }
      const values = macdData(data, closes);
      const macdSeries = macdRef.current;
      const signalSeries = macdSignalRef.current;
      const histogramSeries = macdHistogramRef.current;
      if (macdSeries && signalSeries && histogramSeries) {
        macdSeries.setData(
          values.macd.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })),
        );
        signalSeries.setData(
          values.signal.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })),
        );
        histogramSeries.setData(
          values.histogram.map((point) => ({
            time: point.time as UTCTimestamp,
            value: point.value,
            color: point.value >= 0 ? "#16a34a" : "#dc2626",
          })),
        );
      }
    } else {
      if (macdPaneRef.current) {
        chart.removePane(macdPaneRef.current.paneIndex());
        macdPaneRef.current = null;
      }
      macdRef.current = null;
      macdSignalRef.current = null;
      macdHistogramRef.current = null;
    }

    reorderPanes();
  }, [
    candles,
    indicators.ema,
    indicators.macd,
    indicators.rsi,
    indicators.sma,
    reorderPanes,
    symbol,
  ]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (hasVolume) {
      if (!volumePaneRef.current || !volumeRef.current) {
        const pane = chart.addPane();
        pane.setStretchFactor(0.8);
        const volumeSeries = pane.addSeries(HistogramSeries, {
          priceLineVisible: false,
          lastValueVisible: false,
          priceFormat: { type: "volume" },
          color: "#94a3b8",
        });
        volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.2, bottom: 0 } });
        volumePaneRef.current = pane;
        volumeRef.current = volumeSeries;
      }
      const data = barsRef.current.length > 0 ? barsRef.current : candles;
      volumeRef.current.setData(
        data
          .filter(
            (candle): candle is MarketCandle & { volume: number } =>
              typeof candle.volume === "number" && candle.volume > 0,
          )
          .map((candle) => ({
            time: candle.time as UTCTimestamp,
            value: candle.volume,
            color:
              candle.close >= candle.open ? "rgba(22, 163, 74, 0.55)" : "rgba(220, 38, 38, 0.55)",
          })),
      );
    } else if (volumePaneRef.current) {
      chart.removePane(volumePaneRef.current.paneIndex());
      volumePaneRef.current = null;
      volumeRef.current = null;
    }

    reorderPanes();
  }, [candles, hasVolume, reorderPanes, symbol]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    const next = mergeLiveBar(barsRef.current, quote, interval);
    if (next === barsRef.current || next.length === 0) return;
    const last = next[next.length - 1]!;
    const time = last.time as UTCTimestamp;
    series.update({
      time,
      open: last.open,
      high: last.high,
      low: last.low,
      close: last.close,
    });
    barsRef.current = next;

    const closes = next.map((candle) => candle.close);
    if (smaRef.current) {
      const point = lineData(next, sma(closes, 20)).at(-1);
      if (point) smaRef.current.update({ time: point.time as UTCTimestamp, value: point.value });
    }
    if (emaRef.current) {
      const point = lineData(next, ema(closes, 50)).at(-1);
      if (point) emaRef.current.update({ time: point.time as UTCTimestamp, value: point.value });
    }
    if (rsiRef.current) {
      const point = lineData(next, rsi(closes, 14)).at(-1);
      if (point) rsiRef.current.update({ time: point.time as UTCTimestamp, value: point.value });
    }
    if (macdRef.current && macdSignalRef.current && macdHistogramRef.current) {
      const values = macdData(next, closes);
      const macdPoint = values.macd.at(-1);
      const signalPoint = values.signal.at(-1);
      const histogramPoint = values.histogram.at(-1);
      if (macdPoint) {
        macdRef.current.update({ time: macdPoint.time as UTCTimestamp, value: macdPoint.value });
      }
      if (signalPoint) {
        macdSignalRef.current.update({
          time: signalPoint.time as UTCTimestamp,
          value: signalPoint.value,
        });
      }
      if (histogramPoint) {
        macdHistogramRef.current.update({
          time: histogramPoint.time as UTCTimestamp,
          value: histogramPoint.value,
          color: histogramPoint.value >= 0 ? "#16a34a" : "#dc2626",
        });
      }
    }
    if (volumeRef.current && last.volume != null) {
      volumeRef.current.update({
        time,
        value: last.volume,
        color: last.close >= last.open ? "rgba(22, 163, 74, 0.55)" : "rgba(220, 38, 38, 0.55)",
      });
    }
  }, [interval, quote, symbol]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    const data = barsRef.current.length > 0 ? barsRef.current : candles;
    if (data.length === 0) {
      markersRef.current?.setMarkers([]);
      return;
    }
    markersRef.current?.setMarkers(
      buildChartMarkers({
        positions,
        pendingOrders,
        closedPositions,
        interval,
        from: data[0]!.time,
        to: data[data.length - 1]!.time,
      }),
    );
  }, [candles, closedPositions, interval, pendingOrders, positions, symbol]);

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

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({
      localization: {
        timeFormatter: (time: Time) => formatTime(time, timeZone),
      },
      timeScale: {
        tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) =>
          formatTick(time, tickMarkType, timeZone),
      },
      crosshair: {
        mode: magnet ? CrosshairMode.MagnetOHLC : CrosshairMode.Normal,
      },
    });
    chart.priceScale("right").applyOptions({ mode: scaleMode, invertScale });
  }, [invertScale, magnet, scaleMode, symbol, timeZone]);

  const lastCandle = candles[candles.length - 1];
  const display: HoveredBar | null =
    hovered ?? (lastCandle ? { ...lastCandle, ...lastIndicatorValues } : null);
  const scaleLabel =
    scaleMode === PriceScaleMode.Logarithmic
      ? "LOG"
      : scaleMode === PriceScaleMode.Percentage
        ? "%"
        : "LIN";
  const cycleScale = () =>
    setScaleMode((current) =>
      current === PriceScaleMode.Normal
        ? PriceScaleMode.Logarithmic
        : current === PriceScaleMode.Logarithmic
          ? PriceScaleMode.Percentage
          : PriceScaleMode.Normal,
    );
  const downloadChart = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const link = document.createElement("a");
    link.href = chart.takeScreenshot(true, false).toDataURL("image/png");
    link.download = `${symbol}-${interval}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
    link.click();
  };
  const change = display ? display.close - display.open : 0;
  const changePct = display && display.open !== 0 ? (change / display.open) * 100 : 0;
  const control = (active: boolean) =>
    `rounded px-1.5 py-1 text-[9px] font-semibold shadow-sm ring-1 transition-colors ${
      active
        ? "bg-slate-800 text-white ring-slate-800"
        : "bg-white/85 text-slate-600 ring-slate-200 hover:bg-white"
    }`;

  return (
    <div>
      <div className="relative">
        <div ref={containerRef} className="h-[420px] w-full sm:h-[480px]" />
        <div className="pointer-events-none absolute left-2 top-2 z-10 max-w-[calc(100%-7.5rem)] rounded bg-white/80 px-2 py-1 text-[10px] leading-tight shadow-sm ring-1 ring-slate-200 backdrop-blur">
          {display ? (
            <>
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-slate-600">
                <span>O {fmt(symbol, display.open)}</span>
                <span>H {fmt(symbol, display.high)}</span>
                <span>L {fmt(symbol, display.low)}</span>
                <span>C {fmt(symbol, display.close)}</span>
                <span className={change >= 0 ? "text-emerald-600" : "text-red-600"}>
                  {change >= 0 ? "+" : ""}
                  {changePct.toFixed(2)}%
                </span>
                {display.volume != null ? (
                  <span>Vol {compactVolume.format(display.volume)}</span>
                ) : null}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[9px] text-slate-500">
                {display.sma != null ? <span>SMA {fmt(symbol, display.sma)}</span> : null}
                {display.ema != null ? <span>EMA {fmt(symbol, display.ema)}</span> : null}
                {display.rsi != null ? <span>RSI {display.rsi.toFixed(1)}</span> : null}
                {display.macd != null ? <span>MACD {display.macd.toFixed(5)}</span> : null}
                {display.signal != null ? <span>S {display.signal.toFixed(5)}</span> : null}
                {display.histogram != null ? <span>H {display.histogram.toFixed(5)}</span> : null}
              </div>
            </>
          ) : (
            <span className="text-slate-500">Loading candles…</span>
          )}
        </div>
        <div className="absolute right-2 top-2 z-10 flex gap-1">
          <button
            type="button"
            aria-label="Cycle price scale mode"
            className={control(scaleMode !== PriceScaleMode.Normal)}
            onClick={cycleScale}
          >
            {scaleLabel}
          </button>
          <button
            type="button"
            aria-label="Invert price scale"
            aria-pressed={invertScale}
            className={control(invertScale)}
            onClick={() => setInvertScale((value) => !value)}
          >
            INV
          </button>
          <button
            type="button"
            aria-label="Toggle chart timezone"
            className={control(timeZone === "local")}
            onClick={() => setTimeZone((value) => (value === "utc" ? "local" : "utc"))}
          >
            {timeZone === "utc" ? "UTC" : "LOCAL"}
          </button>
          <button
            type="button"
            aria-label="Toggle magnet crosshair"
            aria-pressed={magnet}
            className={control(magnet)}
            onClick={() => setMagnet((value) => !value)}
          >
            MAG
          </button>
          <button
            type="button"
            aria-label="Save chart image"
            className={control(false)}
            onClick={downloadChart}
          >
            <Camera className="h-3 w-3" />
          </button>
        </div>
      </div>
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
