import { createHmac, randomUUID } from "node:crypto";

const baseUrl = (
  process.env["VANTOR_BASE_URL"] ??
  process.env["BASE_URL"] ??
  "https://vantor-market-beacon.fundedng.workers.dev"
).replace(/\/+$/, "");
const secret = process.env["DEV_FEED_SECRET"] ?? process.env["FEED_INGEST_SECRET"] ?? "";
const symbol = process.env["TEST_SYMBOL"] ?? "XAUUSD";

if (!secret) {
  console.error("Set DEV_FEED_SECRET (or FEED_INGEST_SECRET) before running this script.");
  process.exit(1);
}

const now = Date.now();
const payload = {
  feedId: `smoke-${randomUUID()}`,
  sentAt: now,
  quotes: [{ symbol, bid: 2400, ask: 2400.4, ts: now, marketOpen: true }],
  candles: [
    {
      symbol,
      interval: "1min",
      snapshot: true,
      bars: [
        {
          time: Math.floor(now / 1000) - 60,
          open: 2399.8,
          high: 2400.6,
          low: 2399.5,
          close: 2400.2,
          volume: 10,
        },
      ],
    },
  ],
};

const raw = JSON.stringify(payload);
const timestamp = String(Date.now());
const signature = createHmac("sha256", secret)
  .update(`${timestamp}.${raw}`)
  .digest("base64url");

const response = await fetch(`${baseUrl}/api/dev/feed/ingest`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-feed-timestamp": timestamp,
    "x-feed-signature": signature,
  },
  body: raw,
});

const text = await response.text();
console.log(`ingest ${response.status}: ${text}`);
if (!response.ok) process.exit(1);

const quoteResponse = await fetch(
  `${baseUrl}/api/v1/terminal/quotes?symbols=${encodeURIComponent(symbol)}`,
);
const quoteText = await quoteResponse.text();
console.log(`quotes ${quoteResponse.status}: ${quoteText}`);
if (!quoteResponse.ok) process.exit(1);
