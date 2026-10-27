import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHART_INDICATORS,
  ema,
  lineData,
  macd,
  macdData,
  rsi,
  sma,
} from "@/lib/chart-indicators";

describe("chart indicators", () => {
  it("computes a rolling simple moving average", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("seeds the exponential moving average with an SMA", () => {
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("returns RSI extremes for one-way and flat series", () => {
    const rising = rsi([1, 2, 3, 4, 5, 6], 3);
    expect(rising.slice(0, 3)).toEqual([null, null, null]);
    expect(rising.slice(3)).toEqual([100, 100, 100]);

    const flat = rsi([5, 5, 5, 5, 5], 3);
    expect(flat.slice(3)).toEqual([50, 50]);
  });

  it("computes MACD lines and histogram at the same indices", () => {
    const values = Array.from({ length: 60 }, (_, index) => 100 + index * 0.5);
    const result = macd(values, 12, 26, 9);
    expect(result.macd).toHaveLength(values.length);
    expect(result.signal).toHaveLength(values.length);
    expect(result.histogram).toHaveLength(values.length);
    expect(result.macd[24]).toBeNull();
    expect(result.macd[25]).toBeTypeOf("number");
    expect(result.signal[32]).toBeNull();
    expect(result.signal[33]).toBeTypeOf("number");
    expect(result.histogram[40]).toBeCloseTo(result.macd[40]! - result.signal[40]!, 10);
  });

  it("maps indicator values onto candle times and drops warm-up gaps", () => {
    const candles = [{ time: 10 }, { time: 20 }, { time: 30 }];
    expect(lineData(candles, [null, 2, 3])).toEqual([
      { time: 20, value: 2 },
      { time: 30, value: 3 },
    ]);

    const result = macdData(candles, [1, 2, 3], 2, 3, 2);
    expect(result.macd).toEqual([{ time: 30, value: 0.5 }]);
    expect(result.histogram).toEqual([]);
  });

  it("defaults to the core overlay and oscillator set", () => {
    expect(DEFAULT_CHART_INDICATORS).toEqual({ sma: true, ema: true, rsi: true, macd: false });
  });
});
