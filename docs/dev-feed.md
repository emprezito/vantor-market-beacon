# Development Market Feed

The development feed lets a local bridge publish Exness quotes and candles to
the `MarketStream` Durable Object. It is for private development and controlled
testing only. Do not treat Exness data as production broker data, and do not
enable the ingest endpoint for untrusted clients.

## Data flow

```
MT5 bridge -> POST /api/dev/feed/ingest -> MarketStream Durable Object
                                              |
                     /api/v1/terminal/{quotes,candles,stream}
                     web getMarketQuotes / getMarketCandles / realtime
                                              |
                         app account's trading_servers.id must be allowlisted
```

The feed is read first only for accounts whose `server_id` is in
`DEV_FEED_SERVER_IDS`. Every other account keeps using Twelve Data, cached data,
or the deterministic simulated feed. The allowlist is enforced in both the app
server and the Durable Object.

## Configuration

| Variable                   | Required | Purpose                                                                 |
| -------------------------- | -------- | ----------------------------------------------------------------------- |
| `ALLOW_DEV_FEED`           | yes      | Must be exactly `true`. Otherwise ingest and status return `404`.       |
| `DEV_FEED_SECRET`          | yes      | HMAC secret used to verify ingest requests. Server-only.                |
| `DEV_FEED_SERVER_IDS`      | yes      | Comma-separated `trading_servers.id` allowlist. Empty/unset fails closed. |
| `DEV_FEED_ALLOWED_IPS`     | no       | Comma-separated IP allowlist for ingest. Empty allows any source IP.    |
| `DEV_FEED_STALE_MS`        | no       | Feed staleness threshold. Default `10000`, minimum `1000`.              |
| `DEV_FEED_RETENTION_BARS`  | no       | Bars retained per series. Default `2000`, minimum `500`.                |

`DEV_FEED_SERVER_IDS` is an authorization boundary, not an optional filter. A
missing or empty value disables Exness reads for everyone, even when
`ALLOW_DEV_FEED=true`.

Set the variables in the Worker dashboard and deploy with
`wrangler deploy --keep-vars`; a normal Wrangler deploy can remove dashboard-only
variables that are not in `wrangler.jsonc`.

## Ingest endpoint

`POST /api/dev/feed/ingest`

Required headers:

| Header             | Value                                                        |
| ------------------ | ------------------------------------------------------------ |
| `content-type`     | `application/json`                                           |
| `x-feed-timestamp` | Current time in milliseconds, as a decimal integer.          |
| `x-feed-signature` | Base64url HMAC-SHA256 of `` `${timestamp}.${rawBody}` ``.    |

The signature input uses the raw request body bytes as text, so compute the HMAC
before any JSON reformatting. The timestamp must be within 60 seconds of server
time. The body limit is 2 MiB.

Responses:

- `200` with `{ "ok": true, "quotes": n, "series": n, "bars": n }`
- `400` invalid JSON or validation failure (`invalid_payload` includes a message)
- `401` bad timestamp or signature
- `403` source IP is not in `DEV_FEED_ALLOWED_IPS`
- `404` when `ALLOW_DEV_FEED` is not `true`
- `405` non-POST request
- `413` body larger than 2 MiB
- `503` `DEV_FEED_SECRET` is missing or the Durable Object is unavailable

The endpoint is hidden when disabled. Do not log or return the secret.

## Payload

Quote timestamps are Unix milliseconds. Candle `time` values are Unix seconds.

```json
{
  "feedId": "mt5-vantor-1",
  "sentAt": 1790000000000,
  "serverOffsetMs": 120,
  "quotes": [
    {
      "symbol": "XAUUSD",
      "bid": 4000.1,
      "ask": 4000.35,
      "ts": 1790000000000,
      "marketOpen": true,
      "providerSymbol": "XAUUSDm"
    }
  ],
  "candles": [
    {
      "symbol": "XAUUSD",
      "interval": "1h",
      "snapshot": false,
      "bars": [
        {
          "time": 1789996800,
          "open": 3990.2,
          "high": 4001.5,
          "low": 3988.4,
          "close": 4000.1,
          "volume": 1200
        }
      ]
    }
  ]
}
```

`quotes` and `candles` are optional arrays. `snapshot` is a bridge hint; bars
whose interval has not closed are kept in memory as the live bar and are served
until replaced by a closed bar.

Validation rules:

- Symbols must be canonical instruments from the app catalog.
- `sentAt` must be within 60 seconds of server time.
- Quote `ts` may be at most 5 seconds in the future.
- `ask >= bid`; spread must be at most 5% of the mid price.
- Bar timestamps may be at most 5 seconds in the future.
- Bars must have valid OHLC values (`high >= low/open/close`, `low <= open/close`)
  and non-negative volume when supplied.
- At most 21 quote records and 21 candle series per request.
- At most 1,500 bars per series and 5,000 bars per request.
- Duplicate quote symbols and duplicate `symbol:interval` series are rejected.
- Supported intervals: `1min`, `5min`, `15min`, `30min`, `1h`, `4h`, `1day`,
  `1week`, `1month`.

The Durable Object also ignores out-of-order quote timestamps and extreme price
jumps (per-instrument limits from 3% for forex to 25% for crypto). Re-sending the
same closed bar is ignored when all OHLC values match.

## Status endpoint

`GET /feed-status`

Hidden with `404` when `ALLOW_DEV_FEED` is not `true`. Returns `503` when the
Durable Object is unavailable.

```json
{
  "feedId": "mt5-vantor-1",
  "lastIngestAt": 1790000000000,
  "lastSentAt": 1790000000000,
  "quoteCount": 20,
  "seriesCount": 40,
  "stale": false,
  "quoteSnapshotAt": 1790000000000,
  "rowsWrittenToday": 120,
  "rowsWrittenPerDayEstimate": 1200,
  "missing": [],
  "series": [
    { "symbol": "XAUUSD", "interval": "1h", "latest": 1789996800 }
  ],
  "fallbackActive": false,
  "checkedAt": 1790000001000
}
```

- `stale` is true when the last accepted ingest is older than
  `DEV_FEED_STALE_MS`.
- `missing` lists empty or stale `symbol:interval` series for symbols the feed
  has seen; `count` is capped at 300.
- `fallbackActive` is true when the feed is stale or has no quotes.
- `rowsWrittenToday` / `rowsWrittenPerDayEstimate` track Durable Object SQLite
  writes and are useful for free-tier capacity checks.

## Read behavior

- When the feed has a fresh quote for a symbol, the app returns it as
  `feed: "exness"` and `source: "live"`.
- A stale Exness quote remains `feed: "exness"` / `source: "cached"`. It is never
  replaced by synthetic data.
- If an allowlisted account has no usable feed quote for a symbol, the quote
  falls back to Twelve Data or the synthetic engine and is marked
  `feedFallback: true`. Quotes for non-allowlisted accounts are not marked as
  fallback and never use Exness data.
- Candles from the feed are `feed: "exness"` and `source: "live"` or `"cached"`;
  synthetic candles are `source: "simulated"`.
- Fallback quotes are display-only. New market/limit orders, stop updates,
  pending-order fills, SL/TP triggers, and fund movements are refused while they
  are present; `closePosition` remains available so a trader can exit. The
  terminal API returns `409 fallback_market_data` with message
  `Live prices are unavailable`.
- `ALLOW_FALLBACK_TRADING=true` bypasses the fallback trading guard for
  development only. It does not bypass the stale-feed guard.

## Storage and capacity

`MarketStream` keeps the latest quote for each symbol in memory and stores a
quote snapshot at most every 30 seconds. Only closed candles are written to
SQLite, identical rows are skipped, and each series is pruned to
`DEV_FEED_RETENTION_BARS` once per hour. This keeps steady-state row writes low,
but Durable Object SQLite still requires a Workers plan that allows the row
volume.

The bridge must seed history in chunks: one request accepts at most 5,000 bars
total even though a series can hold 1,500 bars in a batch. Bump
`MARKET_FEED_INSTANCE` in `src/lib/market-feed.ts` when changing feed or relay
behavior so WebSocket clients leave old Durable Objects.
