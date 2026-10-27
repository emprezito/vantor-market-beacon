export type ChartIndicatorKey = "sma" | "ema" | "rsi" | "macd";

export type ChartIndicators = Record<ChartIndicatorKey, boolean>;

export const CHART_INDICATOR_KEYS: ChartIndicatorKey[] = ["sma", "ema", "rsi", "macd"];

export const CHART_INDICATOR_LABELS: Record<ChartIndicatorKey, string> = {
  sma: "SMA 20",
  ema: "EMA 50",
  rsi: "RSI 14",
  macd: "MACD",
};

export const DEFAULT_CHART_INDICATORS: ChartIndicators = {
  sma: true,
  ema: true,
  rsi: true,
  macd: false,
};

export type IndicatorPoint = {
  time: number;
  value: number;
};

type Timed = { time: number };

function emptySeries(length: number): Array<number | null> {
  return Array.from({ length }, () => null);
}

export function sma(values: readonly number[], period: number): Array<number | null> {
  if (!Number.isInteger(period) || period <= 0) throw new Error("SMA period must be positive");
  const result = emptySeries(values.length);
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index]!;
    if (index >= period) sum -= values[index - period]!;
    if (index >= period - 1) result[index] = sum / period;
  }
  return result;
}

export function ema(values: readonly number[], period: number): Array<number | null> {
  if (!Number.isInteger(period) || period <= 0) throw new Error("EMA period must be positive");
  const result = emptySeries(values.length);
  if (values.length < period) return result;

  let seed = 0;
  for (let index = 0; index < period; index += 1) seed += values[index]!;
  result[period - 1] = seed / period;

  const weight = 2 / (period + 1);
  for (let index = period; index < values.length; index += 1) {
    result[index] = values[index]! * weight + result[index - 1]! * (1 - weight);
  }
  return result;
}

export function rsi(values: readonly number[], period = 14): Array<number | null> {
  if (!Number.isInteger(period) || period <= 0) throw new Error("RSI period must be positive");
  const result = emptySeries(values.length);
  if (values.length <= period) return result;

  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index]! - values[index - 1]!;
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;
  result[period] =
    averageLoss === 0
      ? averageGain === 0
        ? 50
        : 100
      : 100 - 100 / (1 + averageGain / averageLoss);

  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index]! - values[index - 1]!;
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    result[index] =
      averageLoss === 0
        ? averageGain === 0
          ? 50
          : 100
        : 100 - 100 / (1 + averageGain / averageLoss);
  }
  return result;
}

export function macd(
  values: readonly number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): {
  macd: Array<number | null>;
  signal: Array<number | null>;
  histogram: Array<number | null>;
} {
  const fastSeries = ema(values, fast);
  const slowSeries = ema(values, slow);
  const macdSeries = emptySeries(values.length);
  const indices: number[] = [];
  const compact: number[] = [];

  for (let index = 0; index < values.length; index += 1) {
    const fastValue = fastSeries[index];
    const slowValue = slowSeries[index];
    if (fastValue == null || slowValue == null) continue;
    macdSeries[index] = fastValue - slowValue;
    indices.push(index);
    compact.push(macdSeries[index]!);
  }

  const signalCompact = ema(compact, signalPeriod);
  const signal = emptySeries(values.length);
  const histogram = emptySeries(values.length);
  for (let offset = 0; offset < indices.length; offset += 1) {
    const index = indices[offset]!;
    const signalValue = signalCompact[offset];
    if (signalValue == null) continue;
    signal[index] = signalValue;
    histogram[index] = macdSeries[index]! - signalValue;
  }

  return { macd: macdSeries, signal, histogram };
}

export function lineData(
  candles: readonly Timed[],
  values: readonly (number | null)[],
): IndicatorPoint[] {
  const points: IndicatorPoint[] = [];
  const length = Math.min(candles.length, values.length);
  for (let index = 0; index < length; index += 1) {
    const value = values[index];
    if (value == null) continue;
    points.push({ time: candles[index]!.time, value });
  }
  return points;
}

export function macdData(
  candles: readonly Timed[],
  values: readonly number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): {
  macd: IndicatorPoint[];
  signal: IndicatorPoint[];
  histogram: IndicatorPoint[];
} {
  const result = macd(values, fast, slow, signalPeriod);
  return {
    macd: lineData(candles, result.macd),
    signal: lineData(candles, result.signal),
    histogram: lineData(candles, result.histogram),
  };
}
