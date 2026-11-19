import { loadQuotes, resetMarketDataCache } from "../src/lib/market-data.server";

const symbol = process.env.MERIDIAN_TEST_SYMBOL ?? "BTCUSD";
resetMarketDataCache();
const quotes = await loadQuotes([symbol]);
const quote = quotes[symbol];

console.log(
  JSON.stringify(
    quote
      ? {
          symbol: quote.symbol,
          bid: quote.bid,
          ask: quote.ask,
          mid: quote.mid,
          ageMs: Date.now() - quote.ts,
          source: quote.source,
          feed: quote.feed ?? null,
          feedFallback: quote.feedFallback ?? false,
        }
      : null,
  ),
);
