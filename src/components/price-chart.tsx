import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Camera, ChartCandlestick, Maximize2, Minimize2, SlidersHorizontal } from "lucide-react";
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
  type LogicalRange,
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
import { mergeLiveBar } from "@/lib/chart-candles";
import { fmt, getInstrument } from "@/lib/market";
import {
  CHART_INTERVALS,
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
  indicatorControl,
  onIntervalChange,
  onLoadOlder,
  hasOlder = false,
  isLoadingOlder = false,
  terminal = false,
}: {
  symbol: string;
  quote: MarketQuote;
  candles: MarketCandle[];
  interval: ChartInterval;
  positions: ChartPosition[];
  pendingOrders: ChartPendingOrder[];
  closedPositions: ChartClosedPosition[];
  indicators: ChartIndicators;
  indicatorControl?: ReactNode;
  onIntervalChange?: (interval: ChartInterval) => void;
  onLoadOlder?: () => void;
  hasOlder?: boolean;
  isLoadingOlder?: boolean;
  terminal?: boolean;
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
  const historyLoadPendingRef = useRef(false);
  const historyStateRef = useRef({ onLoadOlder, hasOlder, isLoadingOlder });
  const [hovered, setHovered] = useState<HoveredBar | null>(null);
  const [scaleMode, setScaleMode] = useState<PriceScaleMode>(PriceScaleMode.Normal);
  const [invertScale, setInvertScale] = useState(false);
  const [timeZone, setTimeZone] = useState<TimeZoneMode>("utc");
  const [magnet, setMagnet] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [showOhlc, setShowOhlc] = useState(false);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const mobileExpandButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    historyStateRef.current = { onLoadOlder, hasOlder, isLoadingOlder };
    if (!isLoadingOlder) historyLoadPendingRef.current = false;
  }, [hasOlder, isLoadingOlder, onLoadOlder]);

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    const visibleExpandButton = [expandButtonRef.current, mobileExpandButtonRef.current].find(
      (button) => button && button.getClientRects().length > 0,
    );
    (visibleExpandButton ?? expandButtonRef.current ?? mobileExpandButtonRef.current)?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [expanded]);

  const hasVolume = useMemo(
    () => candles.some((candle) => typeof candle.volume === "number" && candle.volume > 0),
    [candles],
  );

  const lastIndicatorValues = useMemo(() => {
    const closes = candles.map((candle) => candle.close);
    const lastValue = (points: { value: number }[]) => points[points.length - 1]?.value;
    const macdValues = indicators.macd ? macdData(candles, closes) : null;
    return {
      sma: indicators.sma ? lastValue(lineData(candles, sma(closes, 20))) : undefined,
      ema: indicators.ema ? lastValue(lineData(candles, ema(closes, 50))) : undefined,
      rsi: indicators.rsi ? lastValue(lineData(candles, rsi(closes, 14))) : undefined,
      macd: macdValues ? lastValue(macdValues.macd) : undefined,
      signal: macdValues ? lastValue(macdValues.signal) : undefined,
      histogram: macdValues ? lastValue(macdValues.histogram) : undefined,
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
        background: { type: ColorType.Solid, color: "#080b10" },
        textColor: "#7f8a9b",
        fontFamily: "IBM Plex Mono, monospace",
        panes: {
          enableResize: true,
          separatorColor: "#273140",
          separatorHoverColor: "rgba(201, 167, 92, 0.28)",
        },
      },
      grid: {
        vertLines: { color: "#151b24" },
        horzLines: { color: "#151b24" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#5d6877", labelBackgroundColor: "#202936" },
        horzLine: { color: "#5d6877", labelBackgroundColor: "#202936" },
      },
      rightPriceScale: { borderColor: "#273140", scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: {
        borderColor: "#273140",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#35c98b",
      downColor: "#f05d67",
      wickUpColor: "#35c98b",
      wickDownColor: "#f05d67",
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
    const handleVisibleRange = (range: LogicalRange | null) => {
      if (!range || range.from > 100 || historyLoadPendingRef.current) return;
      const history = historyStateRef.current;
      if (!history.hasOlder || history.isLoadingOlder || !history.onLoadOlder) return;
      historyLoadPendingRef.current = true;
      history.onLoadOlder();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRange);

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshair);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRange);
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

    const previous = barsRef.current;
    const visibleRange = chart.timeScale().getVisibleLogicalRange();
    const previousFirst = previous[0]?.time;
    const prepended =
      previousFirst == null ? 0 : candles.findIndex((candle) => candle.time === previousFirst);
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
    if (intervalChanged) fittedRef.current = false;
    if (candles.length > 0 && !fittedRef.current) {
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, candles.length - 150),
        to: candles.length + 3,
      });
      fittedRef.current = true;
    } else if (prepended > 0 && visibleRange) {
      chart.timeScale().setVisibleLogicalRange({
        from: visibleRange.from + prepended,
        to: visibleRange.to + prepended,
      });
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
          color: "#c9a75c",
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
          color: "#9e7bff",
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
          color: "#4fb7d8",
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
          color: "#5d6877",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
          title: "",
        });
        rsiSeries.createPriceLine({
          price: 30,
          color: "#5d6877",
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
          color: "#5b8def",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          title: "MACD",
        });
        macdSignalRef.current = pane.addSeries(LineSeries, {
          color: "#c9a75c",
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
            color: point.value >= 0 ? "#35c98b" : "#f05d67",
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
          color: "#5d6877",
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
              candle.close >= candle.open ? "rgba(53, 201, 139, 0.46)" : "rgba(240, 93, 103, 0.46)",
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
          color: histogramPoint.value >= 0 ? "#35c98b" : "#f05d67",
        });
      }
    }
    if (volumeRef.current && last.volume != null) {
      volumeRef.current.update({
        time,
        value: last.volume,
        color: last.close >= last.open ? "rgba(53, 201, 139, 0.46)" : "rgba(240, 93, 103, 0.46)",
      });
    }
  }, [candles, interval, quote, symbol]);

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
        color: side === "buy" ? "#35c98b" : "#f05d67",
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
    `grid h-7 min-w-7 place-items-center rounded border px-1.5 text-[9px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
      active
        ? "border-primary/45 bg-primary/15 text-primary"
        : "border-border bg-card/90 text-muted-foreground hover:bg-accent hover:text-foreground"
    }`;

  return (
    <div
      className={
        expanded
          ? "fixed inset-0 z-[60] flex h-[100dvh] flex-col bg-background p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:p-4"
          : terminal
            ? "lg:relative lg:h-full lg:min-h-0"
            : undefined
      }
    >
      <div
        className={
          expanded
            ? "relative min-h-0 flex-1"
            : terminal
              ? "relative lg:h-full lg:min-h-0"
              : "relative"
        }
      >
        <div
          ref={containerRef}
          className={
            expanded
              ? "h-full w-full"
              : terminal
                ? "h-[max(360px,calc(100dvh-15rem))] w-full lg:h-full lg:min-h-0"
                : "h-[max(360px,calc(100dvh-15rem))] w-full xl:h-[calc(100dvh-5rem)] xl:min-h-[640px]"
          }
        />
        <div className="absolute left-2 top-2 z-20 flex items-center gap-1">
          <button
            type="button"
            aria-label={showOhlc ? "Hide OHLC details" : "Show OHLC details"}
            aria-expanded={showOhlc}
            onClick={() => setShowOhlc((value) => !value)}
            className={`grid h-9 w-9 place-items-center rounded-md border backdrop-blur focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              showOhlc
                ? "border-primary/45 bg-primary/15 text-primary"
                : "border-border bg-card/90 text-muted-foreground"
            }`}
          >
            <ChartCandlestick className="h-4 w-4" />
          </button>
          <select
            aria-label="Chart timeframe"
            value={interval}
            onChange={(event) => onIntervalChange?.(event.target.value as ChartInterval)}
            className="h-9 rounded-md border border-border bg-card/90 px-2 font-mono text-[10px] font-semibold text-foreground outline-none backdrop-blur focus:border-primary"
          >
            {CHART_INTERVALS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          {indicatorControl}
        </div>
        {showOhlc ? (
          <div className="pointer-events-none absolute left-2 top-12 z-10 max-w-[calc(100%-1rem)] rounded border border-border bg-card/90 px-2.5 py-2 text-[10px] leading-tight backdrop-blur sm:max-w-[calc(100%-14rem)]">
            {display ? (
              <>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-foreground/80">
                  <span>O {fmt(symbol, display.open)}</span>
                  <span>H {fmt(symbol, display.high)}</span>
                  <span>L {fmt(symbol, display.low)}</span>
                  <span>C {fmt(symbol, display.close)}</span>
                  <span className={change >= 0 ? "text-positive" : "text-negative"}>
                    {change >= 0 ? "+" : ""}
                    {changePct.toFixed(2)}%
                  </span>
                  {display.volume != null ? (
                    <span>Vol {compactVolume.format(display.volume)}</span>
                  ) : null}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[9px] text-muted-foreground">
                  {display.sma != null ? <span>SMA {fmt(symbol, display.sma)}</span> : null}
                  {display.ema != null ? <span>EMA {fmt(symbol, display.ema)}</span> : null}
                  {display.rsi != null ? <span>RSI {display.rsi.toFixed(1)}</span> : null}
                  {display.macd != null ? <span>MACD {display.macd.toFixed(5)}</span> : null}
                  {display.signal != null ? <span>S {display.signal.toFixed(5)}</span> : null}
                  {display.histogram != null ? <span>H {display.histogram.toFixed(5)}</span> : null}
                </div>
              </>
            ) : (
              <span className="text-muted-foreground">Loading candles…</span>
            )}
          </div>
        ) : null}
        <div className="absolute right-2 top-2 z-10 hidden gap-1 sm:flex">
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
          <button
            ref={expandButtonRef}
            type="button"
            aria-label={expanded ? "Exit fullscreen chart" : "Expand chart to fullscreen"}
            className={control(expanded)}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </button>
        </div>
        <div className="absolute bottom-2 right-2 z-20 flex gap-1 sm:hidden">
          <button
            ref={mobileExpandButtonRef}
            type="button"
            aria-label={
              expanded ? "Exit fullscreen chart on mobile" : "Expand chart to fullscreen on mobile"
            }
            className="grid h-9 w-9 place-items-center rounded-md border border-border bg-card/90 text-muted-foreground backdrop-blur focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            aria-label="Open chart tools"
            aria-expanded={mobileToolsOpen}
            className="grid h-9 w-9 place-items-center rounded-md border border-border bg-card/90 text-muted-foreground backdrop-blur focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => setMobileToolsOpen((value) => !value)}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>
          {mobileToolsOpen ? (
            <div className="absolute bottom-11 right-0 w-44 overflow-hidden rounded-md border border-border bg-popover text-xs shadow-xl">
              <button
                type="button"
                onClick={cycleScale}
                className="flex h-10 w-full items-center justify-between px-3 text-left hover:bg-accent"
              >
                Price scale <span className="font-mono text-primary">{scaleLabel}</span>
              </button>
              <button
                type="button"
                onClick={() => setInvertScale((value) => !value)}
                className="flex h-10 w-full items-center justify-between border-t border-border px-3 text-left hover:bg-accent"
              >
                Invert scale <span>{invertScale ? "On" : "Off"}</span>
              </button>
              <button
                type="button"
                onClick={() => setTimeZone((value) => (value === "utc" ? "local" : "utc"))}
                className="flex h-10 w-full items-center justify-between border-t border-border px-3 text-left hover:bg-accent"
              >
                Timezone <span>{timeZone === "utc" ? "UTC" : "Local"}</span>
              </button>
              <button
                type="button"
                onClick={() => setMagnet((value) => !value)}
                className="flex h-10 w-full items-center justify-between border-t border-border px-3 text-left hover:bg-accent"
              >
                Magnet <span>{magnet ? "On" : "Off"}</span>
              </button>
              <button
                type="button"
                onClick={downloadChart}
                className="flex h-10 w-full items-center gap-2 border-t border-border px-3 text-left hover:bg-accent"
              >
                <Camera className="h-3.5 w-3.5" /> Save image
              </button>
            </div>
          ) : null}
        </div>
        {hasOlder && onLoadOlder ? (
          <button
            type="button"
            className="absolute bottom-2 left-2 z-10 rounded border border-border bg-card/90 px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground backdrop-blur hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-60"
            disabled={isLoadingOlder}
            onClick={onLoadOlder}
          >
            {isLoadingOlder ? "Loading history..." : "Load older candles"}
          </button>
        ) : null}
      </div>
      <div
        className={
          terminal
            ? "mt-1 text-right text-[10px] text-muted-foreground lg:absolute lg:bottom-1 lg:right-2 lg:z-20 lg:mt-0"
            : "mt-1 text-right text-[10px] text-muted-foreground"
        }
      >
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
