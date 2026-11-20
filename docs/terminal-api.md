# Vantor Pocket Broker API

Vantor's implementation of the broker-neutral `pocket.broker.v1` REST/WebSocket protocol. Pocket communicates only with Vantor and never receives an upstream provider URL, provider token, API key, Supabase credential, password hash, or another account's data.

Base path: `/api/v1/terminal`

## Discovery

`GET /.well-known/pocket-broker.json` publishes Vantor's public protocol descriptor. Pocket uses this document during broker onboarding and connection setup; no Vantor-specific client adapter is required.

```json
{
  "manifestVersion": 1,
  "protocol": "pocket.broker.v1",
  "protocolVersions": ["pocket.broker.v1"],
  "broker": { "id": "vantor", "name": "Vantor" },
  "api": {
    "baseUrl": "https://vantor.example/api/v1/terminal",
    "servers": "https://vantor.example/api/v1/terminal/servers",
    "login": "https://vantor.example/api/v1/terminal/login",
    "account": "https://vantor.example/api/v1/terminal/account",
    "instruments": "https://vantor.example/api/v1/terminal/instruments",
    "quotes": "https://vantor.example/api/v1/terminal/quotes",
    "candles": "https://vantor.example/api/v1/terminal/candles",
    "streamTicket": "https://vantor.example/api/v1/terminal/stream-ticket"
  },
  "authentication": {
    "type": "broker-account",
    "tokenType": "bearer",
    "roles": ["trader", "investor"]
  },
  "streaming": {
    "transport": "websocket",
    "staleAfterMs": 5000
  },
  "capabilities": [
    "market-orders",
    "limit-orders",
    "stop-loss",
    "take-profit",
    "position-close",
    "investor-access",
    "candles",
    "live-quotes"
  ]
}
```

The manifest is public, cacheable for five minutes, and contains only Vantor broker URLs. `PUBLIC_BROKER_BASE_URL` sets the advertised production origin; local development falls back to the request origin.

## Authentication

`POST /login`

```json
{
  "serverId": "2f6f0d3e-4a8e-4f0b-9b1a-7c2d3e4f5a6b",
  "login": 12345678,
  "password": "trader-or-investor-password"
}
```

Success:

```json
{
  "token": "<opaque bearer token>",
  "expiresAt": 1790000000000,
  "role": "trader",
  "account": {
    "id": "7b7e3c2a-...",
    "login": 12345678,
    "nickname": "My account",
    "label": "Standard",
    "server": "Vantor Demo",
    "currency": "USD",
    "leverage": 100,
    "role": "trader",
    "status": "active"
  }
}
```

- Tokens are HMAC-SHA256 signed, expire after 7 days, and are bound to the account, server, role, and `session_epoch`.
- Every authenticated request re-loads the account by id **and** server id. A missing, disabled, or epoch-mismatched account returns `401`.
- Missing account, wrong password, and disabled account return the same `401` body and status.
- Failed logins are rate limited by the existing `record_login_failure` RPC. A blocked login returns `429` with `Retry-After`.
- Send `Authorization: Bearer <token>` on every request except `/login`, `/servers`, `/instruments`, and `/quotes`.
- `/quotes` accepts an optional bearer token and returns broker-tick, cached, or display-only simulated quotes. An invalid bearer returns `401`; it never silently downgrades.

## Endpoints

### `GET /servers`

Public active servers only. Private partner servers are never listed.

```json
{
  "servers": [
    {
      "id": "2f6f0d3e-...",
      "name": "Vantor Demo",
      "currencies": ["USD", "EUR"],
      "leverages": [100, 200, 500]
    }
  ]
}
```

### `POST /servers/resolve`

Authenticated. Resolves a server ID entered by the trader without exposing a private-server directory. Public servers resolve for any authenticated account. A private server resolves only when the caller has an account on that server; otherwise it returns `404 server_not_found` just like an unknown ID. Limited to 10 requests per minute per user.

```json
{ "serverId": "2f6f0d3e-4a8e-4f0b-9b1a-7c2d3e4f5a6b" }
```

```json
{
  "server": {
    "id": "2f6f0d3e-...",
    "name": "Partner Server",
    "currencies": ["USD"],
    "leverages": [100, 200],
    "visibility": "private",
    "status": "active"
  }
}
```

There is no access-code or join flow; the partner supplies the server ID.

### `GET /instruments`

Returns the active Vantor broker catalogue. Symbols are canonical Vantor symbols; provider symbols and provider metadata are never returned.

```json
{
  "protocol": "pocket.broker.v1",
  "fetchedAt": 1790000000000,
  "instruments": [
    {
      "symbol": "XAUUSD",
      "name": "Gold vs US Dollar",
      "assetClass": "metals",
      "digits": 2,
      "point": 0.01,
      "tickSize": 0.01,
      "contractSize": 100,
      "minimumLots": 0.01,
      "maximumLots": 100,
      "lotStep": 0.01,
      "baseCurrency": "XAU",
      "quoteCurrency": "USD",
      "orderTypes": ["market", "limit"],
      "status": "enabled"
    }
  ]
}
```

### `GET /account`

Returns balance, equity, margin, free margin, open positions, pending orders, and recent history. The request runs the same SL/TP and due-limit-order processing as the web `getAccount` function.

```json
{
  "account": { "id": "...", "login": 12345678, "role": "trader", "...": "..." },
  "balance": 10000,
  "equity": 10012.5,
  "marginUsed": 110,
  "freeMargin": 9902.5,
  "openPositions": [
    {
      "id": "...",
      "symbol": "EURUSD",
      "side": "buy",
      "lots": 0.01,
      "openPrice": 1.1,
      "currentPrice": 1.1002,
      "stopLoss": 1.09,
      "takeProfit": 1.12,
      "pnl": 0.02,
      "openedAt": "2026-10-26T00:00:00.000Z"
    }
  ],
  "pendingOrders": [],
  "recentHistory": []
}
```

During fallback, `equity`, `freeMargin`, and floating P/L exclude positions whose quotes are fallback. `marginUsed` remains based on each position's open price. `openPositions[].pnl` and `currentPrice` are still display values and may use a fallback quote.

### `GET /quotes?symbols=EURUSD,BTCUSD`

```json
{
  "quotes": [
    {
      "symbol": "XAUUSD",
      "bid": 4000.1,
      "ask": 4000.35,
      "ts": 1790000000000,
      "stale": false
    },
    {
      "symbol": "EURUSD",
      "bid": 1.1,
      "ask": 1.1002,
      "ts": 1790000000000,
      "stale": true,
      "feedFallback": true
    }
  ]
}
```

`stale` is `true` for cached, simulated, fallback, or broker quotes older than five seconds. `feedFallback: true` marks display-only fallback data when the broker feed is unavailable.

### Market data guards

While fallback quotes are present, new market and limit orders, stop updates, pending-order fills, SL/TP triggers, and fund movements are refused. Closing an existing position remains available. The API returns `409 fallback_market_data` with message `Live prices are unavailable`; stale broker quotes return `409 stale_market_data`.

`ALLOW_FALLBACK_TRADING=true` bypasses the fallback guard for private development only. It does not bypass the stale-feed guard.

### `GET /candles?symbol=EURUSD&interval=1h&points=180`

Requires a terminal bearer token. Intervals: `1min`, `5min`, `15min`, `30min`, `1h`, `4h`,
`1day`, `1week`, `1month`. `points` is optional (20-500, default 180). Requests are limited
to 60 per minute per account.

```json
{
  "symbol": "EURUSD",
  "interval": "1h",
  "candles": [{ "time": 1790000000, "open": 1.1, "high": 1.101, "low": 1.099, "close": 1.1005 }],
  "source": "live",
  "stale": false,
  "fetchedAt": 1790000000000
}
```

`source` is `live`, `cached` or `simulated`; `stale` is `true` for cached or simulated candles.

### `POST /stream-ticket`

Pocket must use the broker stream, not a market-data provider. Request a short-lived stream ticket with the terminal bearer token:

```json
{}
```

```json
{
  "ticket": "<short-lived opaque ticket>",
  "expiresAt": 1790000000000,
  "broker": { "id": "vantor", "name": "Vantor" },
  "protocol": "pocket.broker.v1",
  "stream": {
    "transport": "websocket",
    "url": "wss://vantor.example/api/v1/terminal/stream?ticket=...",
    "staleAfterMs": 5000
  }
}
```

Tickets expire after 60 seconds. They never contain a provider API key, provider URL, or provider symbol. A native client may instead connect with `Authorization: Bearer <terminal-token>`; browser clients should use the ticket because browsers cannot set an Authorization header on WebSocket upgrades.

### `GET /stream`

WebSocket broker stream. Authenticate with `?ticket=...` or a bearer token. Optional `?symbols=EURUSD,BTCUSD`; otherwise subscribe after the welcome frame.

Server-to-client frames:

```json
{ "type": "welcome", "broker": "vantor", "protocol": "pocket.broker.v1", "accountId": "00000000-0000-0000-0000-000000000000", "serverTime": 1790000000000, "staleAfterMs": 5000, "symbols": [] }
{ "type": "status", "state": "connecting", "at": 1790000000000 }
{ "type": "snapshot", "at": 1790000000000, "quotes": [{ "symbol": "EURUSD", "bid": 1.1, "ask": 1.1002, "ts": 1790000000000, "stale": false, "seq": 1 }] }
{ "type": "status", "state": "live", "at": 1790000000000 }
{ "type": "tick", "symbol": "EURUSD", "bid": 1.1001, "ask": 1.1003, "ts": 1790000000000, "stale": false, "seq": 2 }
```

Client-to-server frames:

```json
{ "action": "subscribe", "symbols": ["EURUSD", "BTCUSD"] }
{ "action": "unsubscribe", "symbols": ["EURUSD"] }
{ "action": "ping" }
```

The server replies with `subscribed` / `unsubscribed` acknowledgements, `pong`, `error`, or `status`. `status.state` is `connecting`, `live`, `stale`, `reconnecting`, or `error`; `stale` is sent when no tick arrives within `staleAfterMs`. Symbols are Vantor broker symbols, never provider symbols. Ticks are forwarded one-for-one as the broker receives them; the server does not batch or synthesize ticks. On upstream disconnect the server sends `status: "reconnecting"`, reconnects with backoff, and restores subscriptions. `stale` means the quote is older than `staleAfterMs` or is a fallback snapshot. Fallback snapshots are marked `unavailable: true`; no synthetic ticks are emitted.

## Pocket Protocol Boundary

Pocket implements one `pocket.broker.v1` client. Every licensed broker publishes the same discovery, authentication, instrument, account, trading, and streaming contracts from its own infrastructure. `broker.id` selects branding and broker registration; it does not select broker-specific application code.

Vantor alone owns its upstream market-data and execution integrations. Pocket uses only Vantor symbols, Vantor account credentials, Vantor URLs, and the standardized broker frames documented here.

### `POST /orders`

Market order.

```json
{
  "symbol": "EURUSD",
  "side": "buy",
  "lots": 0.01,
  "stopLoss": 1.09,
  "takeProfit": 1.12
}
```

Response:

```json
{
  "order": {
    "positionId": "...",
    "symbol": "EURUSD",
    "side": "buy",
    "lots": 0.01,
    "stopLoss": 1.09,
    "takeProfit": 1.12,
    "price": 1.1001,
    "status": "open"
  },
  "balance": 10000
}
```

### `POST /orders/pending`

Limit order. `limitPrice` is required. Buy limits must be below the current ask; sell limits must be above the current bid.

```json
{
  "symbol": "EURUSD",
  "side": "buy",
  "lots": 0.01,
  "limitPrice": 1.095,
  "stopLoss": 1.09,
  "takeProfit": 1.12
}
```

### `DELETE /orders/pending/:id`

Cancels a pending order owned by the authenticated account.

```json
{ "ok": true, "balance": 10000 }
```

### `POST /positions/:id/close`

Closes an open position owned by the authenticated account.

```json
{ "ok": true, "price": 1.1002, "pnl": 0.02, "balance": 10000.02 }
```

### `PATCH /positions/:id`

Updates `stopLoss` and/or `takeProfit`. Omitted fields keep their current value. Send `null` to remove a stop. Values must be positive and on the correct side of the current price.

```json
{ "stopLoss": 1.095, "takeProfit": null }
```

## Idempotency

Send `Idempotency-Key: <uuid>` on any mutating request. The key is stored for 24 hours per account. A replay returns the original response. Reusing a key with a different request body returns `409`. A request already in progress returns `409`.

## Errors

```json
{ "error": "invalid_request", "message": "Not enough free margin" }
```

- `400` validation or trading error
- `401` invalid credentials or invalid session
- `403` investor mutation (`read_only_account`) or disallowed origin
- `404` unknown route or account
- `409` idempotency conflict, request in progress, stale feed (`stale_market_data`), or fallback quotes (`fallback_market_data`)
- `413` body larger than 16 KB
- `426` WebSocket upgrade required
- `429` rate limited (`Retry-After`)
- `503` configuration or upstream failure

## CORS

Allowed origins come from `ALLOWED_ORIGINS` (comma-separated). Defaults:

- `https://emprezito-pocket-markets.fundedng.workers.dev`
- `https://localhost`
- `capacitor://localhost`

`http://localhost:8080` is added only when `ALLOW_DEV_ORIGINS=true`. Requests with no `Origin` are allowed. `*` is never used for account or trading APIs; the public well-known discovery document permits every origin. Preflight allows `Authorization`, `Content-Type`, and `Idempotency-Key`.

## Configuration

- `TERMINAL_TOKEN_SECRET` — random secret, at least 32 bytes. Do not reuse another application secret.
- `PUBLIC_BROKER_BASE_URL` — public HTTPS origin advertised by discovery and stream tickets. Local development falls back to the request origin.
- `ALLOWED_ORIGINS` — comma-separated allowlist.
- `ALLOW_DEV_ORIGINS` — optional, `true` to allow `http://localhost:8080`.
- `ALLOW_FALLBACK_TRADING` — optional, `true` to allow trading on fallback quotes during private development. Defaults to false.
- `MERIDIAN_API_KEY` — server-only key for REST and WebSocket-token exchange.
- `MERIDIAN_API_BASE_URL` — Meridian REST root.
- `MERIDIAN_WS_URL` — Meridian browser WebSocket endpoint.
- Existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` bindings remain server-side.

Apply `supabase/migrations/20261026000000_terminal_api.sql` before deploying. It adds `terminal_idempotency` and the additive `modify` operation/return IDs to `apply_demo_operation`. `20261026010000_relax_plaintext_passwords.sql` makes the legacy plaintext columns nullable so the API can stop writing them. `20261026020000_drop_plaintext_passwords.sql` is intentionally newer and must not be applied until the terminal cutover gates pass.

## Smoke test

```powershell
$env:BASE_URL="https://your-deployment.example"
$env:SERVER_ID="2f6f0d3e-..."
$env:LOGIN="12345678"
$env:PASSWORD="..."
bun scripts/smoke-terminal-api.mjs
```

The script logs in, reads the account and quotes, opens a minimum-lot market position, and closes it. Use a dedicated test account.
