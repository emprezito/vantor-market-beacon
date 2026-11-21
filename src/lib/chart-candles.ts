import {
  intervalMs,
  isStaleFeedQuote,
  type ChartInterval,
  type MarketCandle,
  type MarketQuote,
} from "./market-data";

function nextLiveBucket(quoteTs: number, interval: ChartInterval, lastTime: number): number | null {
  if (!Number.isFinite(quoteTs) || quoteTs <= 0) return null;

  const quoteSeconds = Math.floor(quoteTs / 1000);
  if (quoteSeconds < lastTime) return null;

  if (interval === "1month") {
    const last = new Date(lastTime * 1000);
    const current = new Date(quoteSeconds * 1000);
    const months =
      (current.getUTCFullYear() - last.getUTCFullYear()) * 12 +
      (current.getUTCMonth() - last.getUTCMonth());
    if (months <= 0) return lastTime;
    return (
      Date.UTC(
        last.getUTCFullYear(),
        last.getUTCMonth() + months,
        last.getUTCDate(),
        last.getUTCHours(),
        last.getUTCMinutes(),
        last.getUTCSeconds(),
      ) / 1000
    );
  }

  const stepSeconds = Math.floor(intervalMs(interval) / 1000);
  const periods = Math.floor((quoteSeconds - lastTime) / stepSeconds);
  return lastTime + periods * stepSeconds;
}

export function mergeLiveBar(
  candles: MarketCandle[],
  quote: MarketQuote,
  interval: ChartInterval,
  now = Date.now(),
): MarketCandle[] {
  if (!(quote.bid > 0) || quote.feedFallback || isStaleFeedQuote(quote, now)) return candles;

  const live = candles[candles.length - 1];
  if (!live) return candles;

  const bucket = nextLiveBucket(quote.ts, interval, live.time);
  if (bucket == null) return candles;

  if (bucket === live.time) {
    return [
      ...candles.slice(0, -1),
      {
        ...live,
        high: Math.max(live.high, quote.bid),
        low: Math.min(live.low, quote.bid),
        close: quote.bid,
      },
    ];
  }

  return [
    ...candles,
    {
      time: bucket,
      open: live.close,
      high: Math.max(live.close, quote.bid),
      low: Math.min(live.close, quote.bid),
      close: quote.bid,
      ...(live.volume == null ? {} : { volume: 0 }),
    },
  ];
}
