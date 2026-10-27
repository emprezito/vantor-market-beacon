# Vantor Terminal API

Versioned REST/WebSocket API for the Pocket Markets terminal. The terminal never receives a Supabase URL, anon key, service-role key, password hash, or another account's data.

Base path: `/api/v1/terminal`

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
- Send `Authorization: Bearer <token>` on every request except `/login`, `/servers`, and `/stream`.

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

### `GET /quotes?symbols=EURUSD,BTCUSD`

```json
{
  "quotes": [
    { "symbol": "EURUSD", "bid": 1.1, "ask": 1.1002, "ts": 1790000000000, "stale": false },
    { "symbol": "BTCUSD", "bid": 60000, "ask": 60010, "ts": 1790000000000, "stale": true }
  ]
}
```

`stale` is `true` for cached or simulated quotes.

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

Returns a 60-second, account-bound WebSocket ticket. Limited to 10 requests per minute per account.

```json
{ "ticket": "<opaque stream ticket>", "expiresAt": 1790000060000 }
```

Open `wss://<host>/api/v1/terminal/stream?ticket=<ticket>` with a WebSocket upgrade. The server forwards the connection to the existing `MarketStream` Durable Object. Tickets are type-bound; terminal tokens cannot be used as stream tickets, and stream tickets cannot be used as terminal tokens.

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
- `409` idempotency conflict or request in progress
- `413` body larger than 16 KB
- `426` WebSocket upgrade required
- `429` rate limited (`Retry-After`)
- `503` configuration or upstream failure

## CORS

Allowed origins come from `ALLOWED_ORIGINS` (comma-separated). Defaults:

- `https://emprezito-pocket-markets.fundedng.workers.dev`
- `https://localhost`
- `capacitor://localhost`

`http://localhost:8080` is added only when `ALLOW_DEV_ORIGINS=true`. Requests with no `Origin` are allowed. `*` is never used. Preflight allows `Authorization`, `Content-Type`, and `Idempotency-Key`.

## Configuration

- `TERMINAL_TOKEN_SECRET` — new random secret, at least 32 bytes. Do not reuse `REALTIME_TICKET_SECRET` or an old broker secret.
- `ALLOWED_ORIGINS` — comma-separated allowlist.
- `ALLOW_DEV_ORIGINS` — optional, `true` to allow `http://localhost:8080`.
- Existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MARKET_STREAM`, and `TWELVE_DATA_*` bindings remain server-side.

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
