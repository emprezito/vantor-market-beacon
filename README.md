# Vantor Market Beacon

A full-stack trading platform modelled on Exness. Users register, open one or
more MT5-style trading accounts with their own balance, currency, leverage and
nickname, then trade forex, metals, energy, index and crypto instruments with
market data, live P/L, margin, stop loss and take profit.

**Live app:** https://vantor-market-beacon.fundedng.workers.dev

- Frontend: React 19 + TanStack Start/Router on Cloudflare Workers
- Backend: Supabase (Postgres, Auth) with server-only service-role mutations
- Tooling: Vite, TypeScript, Tailwind CSS v4, Vitest
- Original project scaffolded with [Lovable](https://lovable.dev); this repo is
  still connected to Lovable (see [Lovable workflow](#lovable-workflow))

---

## Table of contents

1. [Features](#features)
2. [Tech stack](#tech-stack)
3. [Architecture](#architecture)
4. [Routes](#routes)
5. [Server functions and API](#server-functions-and-api)
6. [Database](#database)
7. [Trading engine](#trading-engine)
8. [Authentication and security](#authentication-and-security)
9. [Project structure](#project-structure)
10. [Getting started](#getting-started)
11. [Environment variables](#environment-variables)
12. [Database migrations](#database-migrations)
13. [Commands](#commands)
14. [Testing](#testing)
15. [Deployment](#deployment)
16. [Lovable workflow](#lovable-workflow)
17. [Known limitations and notes](#known-limitations-and-notes)

---

## Features

### Accounts

- Email/password registration and sign-in via Supabase Auth.
- Any number of trading accounts per user.
- Account creation form with:
  - **Nickname** (1–24 characters, required, shown everywhere)
  - **Account type**: Standard, Pro, Raw Spread
  - **Currency**: USD, EUR, GBP, NGN
  - **Leverage**: 1:1, 1:10, 1:50, 1:100, 1:200, 1:500, 1:1000, 1:2000
  - **Starting balance**: 100 – 1,000,000 (2 decimals)
  - **Trader password**: 8–64 characters
- The server generates a random 8-digit MT5-style login and a separate investor
  password; the trader gets both in the success toast.
- Each account owns its balance, positions and transaction history.
- Link an existing account by login + password + server (trader or read-only
  investor role).
- Account cards show nickname, type, login, per-account balance, leverage,
  free margin and equity. "Set Balance" adjusts funds via deposit/withdraw.

### Trading

- Market with 21 instruments across forex, metals, energy, indices and crypto.
- Instrument picker at the top of the terminal lists the full catalog, including
  pairs outside the default watchlist.
- Personal watchlist (stored in the browser) with star toggles; only watchlisted
  instruments appear in the left-hand quote list, and the six default pairs are
  seeded on first visit.
- Buy/sell market orders and buy/sell limit orders with lot size, stop loss and
  take profit.
- Pending limit orders are listed in the terminal with their own SL/TP and a
  Cancel action; they fill at the limit price when the quote crosses and free
  margin is sufficient.
- Per-account currency and leverage; margin, equity, free margin and floating
  P/L update every second in the UI.
- Lightweight Charts candlestick chart with 1m/5m/15m/30m/1H timeframes, live
  last-bar updates and dashed entry price lines for open positions.
- Server-side market feed (Twelve Data) with quote/candle caching and an
  automatic deterministic simulated fallback when no API key or credits are
  available. The terminal shows whether quotes are live, cached or simulated.
- Realtime `XAU/USD` and `BTC/USD` ticks via a server-side Twelve Data WebSocket
  relay; the browser connects through an authenticated, short-lived ticket and
  all clients share one upstream stream.
- Stop loss / take profit are validated when the order is placed and evaluated
  server-side on every account poll (every 5 seconds). Due limit orders are
  evaluated in the same poll.
- Investor accounts are read-only: trade and fund mutations are rejected.
- Responsive layout across phone, tablet and desktop: a fixed sidebar on
  desktop, a hamburger drawer and bottom tab bar on mobile, stacked panels and
  horizontally scrolling tables.

### Navigation and profile

- Desktop uses a fixed left sidebar with the account switcher, all app links and
  sign out.
- Mobile uses a top bar with a hamburger menu (all links + sign out) and the
  account switcher in the top-right corner, plus a four-tab bottom bar:
  Accounts, Trade, Orders and Profile.
- `/orders` collects the active account's open positions and pending limit
  orders with close/cancel actions.
- `/profile` shows the active account summary, switches the active account and
  opens a deposit dialog. Deposit offers a Demo top-up through the internal
  wallet; Real accounts are shown as coming soon.

### Wallet and history

- Wallet deposits and withdrawals per account, with the same margin guard as
  trading.
- History page lists closed trades with open/close price, reason and realised
  P/L, plus total realised P/L.
- Transaction log records "Starting balance", deposits and withdrawals.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| UI | React 19, Tailwind CSS v4, Radix UI / shadcn-style components, lucide-react |
| Routing / SSR | TanStack Router + TanStack Start |
| Data fetching | TanStack Query (5-second account/quote poll, 60-second candle poll) |
| Forms / feedback | Plain React forms, Sonner toasts |
| Charts | Lightweight Charts 5 (TradingView) |
| Market data | Twelve Data REST API, server-side proxy with caching and simulated fallback |
| Auth | Supabase Auth (`@supabase/supabase-js`) |
| Database | Supabase Postgres with RLS |
| Validation | Custom validators in `src/lib/*` (no zod on the hot path) |
| Tests | Vitest + Testing Library (jsdom) |
| Build / hosting | Vite + Nitro Cloudflare target, Wrangler |
| Language | TypeScript (strict, path alias `@/` → `src/`) |

---

## Architecture

```
Browser
  ├─ TanStack Router (public + authenticated routes)
  ├─ supabase-js (publishable key): auth + RLS-protected reads
  └─ server functions (RPC, bearer JWT attached by attachSupabaseAuth)
        │
Cloudflare Worker (Vite/Nitro SSR + server functions)
  ├─ requireSupabaseAuth middleware: verifies JWT via getClaims()
  ├─ market feed proxy: Twelve Data quotes/candles + in-memory cache
  │     └─→ Twelve Data REST API (optional, server-only key)
  ├─ /api/realtime/markets: signed-ticket WebSocket upgrade
  │     └─→ MarketStream Durable Object → Twelve Data WebSocket
  ├─ user-scoped Supabase client (publishable key + user token, RLS)
  └─ supabaseAdmin (service role, server only): all writes + atomic RPC
        │
Supabase Postgres
  ├─ RLS: authenticated users can only SELECT their own rows
  ├─ apply_demo_operation(uuid, uuid, text, numeric, uuid[], jsonb)
  └─ handle_new_user trigger (legacy wallet seeding)
```

Key properties:

- **Single source of truth for money** is `public.trading_accounts.balance`.
- All mutations run through server functions using the **service-role** client;
  the browser never mutates tables directly.
- Reads from the browser use the publishable key + user JWT and are constrained
  by RLS policies.
- Server functions are protected by a bearer-token middleware and TanStack's
  CSRF middleware.
- Quotes are loaded server-side (`src/lib/market-data.server.ts`) so the provider
  key never reaches the browser. When the provider is unavailable the deterministic
  engine in `src/lib/market.ts` supplies simulated quotes and candles, so the app
  and trading logic keep working without an external feed.
- `XAU/USD` and `BTC/USD` also have a realtime path: an authenticated server
  function issues a 120-second HMAC ticket, the Worker verifies it and forwards
  the WebSocket upgrade to a single `MarketStream` Durable Object, which owns one
  upstream Twelve Data connection and fans ticks out to every connected browser.
  The provider key stays inside the Worker/DO.
- Bid/ask are derived from the provider mid price plus the instrument spread; they
  are not exchange-native broker quotes.

### Request flow for a trade

1. User submits a buy/sell on `/trade`.
2. `openTrade` server fn validates input (instrument, side, lots, stops).
3. `snapshot()` loads the account (ownership-checked) and open positions.
4. The server loads quotes for the new instrument and any open positions from
   the cached market feed (simulated fallback if needed).
5. Margin is calculated with the account's leverage; free margin is checked.
6. `apply_demo_operation` runs under a row lock with optimistic concurrency:
   the expected balance and open-position ID set must match.
7. Position row is inserted (or balance updated), and the UI invalidates the
   `account` and `my-accounts` queries.

---

## Routes

| Path | SSR | Description |
| --- | --- | --- |
| `/` | yes | Public marketing landing page (quotes, features, account types) |
| `/auth?mode=in\|up` | yes | Sign in / register; mode is validated from the query string |
| `/accounts` | no | Account list, creation form, account linking |
| `/trade` | no | Trading terminal (chart, order panel, positions, pending orders) |
| `/orders` | no | Open positions and pending limit orders |
| `/profile` | no | Account summary, active-account switcher and deposit dialog |
| `/history` | no | Closed trades and realised P/L for the active account |
| `/wallet` | no | Per-account deposits, withdrawals and transactions |

The `_authenticated` layout route disables SSR (`ssr: false`) and redirects to
`/auth` when there is no Supabase user. It renders the signed-in app shell:
desktop sidebar, mobile hamburger header and bottom navigation.

The root route (`src/routes/__root.tsx`) owns the `QueryClientProvider`,
toasts, error boundary, 404 page and a Supabase auth-state listener that
invalidates the router and query cache on sign-in/out.

---

## Server functions and API

All are TanStack Start server functions (`createServerFn`, POST) protected by
`requireSupabaseAuth`. Types are inferred end-to-end; there is no separate REST
API layer.

| Function | Module | Input | Behavior |
| --- | --- | --- | --- |
| `listMyAccounts` | `src/lib/accounts.functions.ts` | – | Lists owned accounts with `nickname`, type, login, server, role, balance, currency, leverage |
| `openDemoAccount` | `src/lib/accounts.functions.ts` | nickname, accountType, currency, leverage, balance, password | Creates a trading account with generated login/investor password and an `initial` transaction |
| `claimTradingAccount` | `src/lib/accounts.functions.ts` | login, password, server | Links an unowned account, or returns the role if already owned |
| `getMarketQuotes` | `src/lib/market.functions.ts` | symbols[] (max 21) | Server-side quote feed; per-symbol cache, 60s TTL, simulated fallback |
| `getMarketCandles` | `src/lib/market.functions.ts` | symbol, interval, points (20–500) | OHLC candles for the chart; provider cache and simulated fallback |
| `getAccount` | `src/lib/trading.functions.ts` | accountId | Snapshot: account, balance, open/closed positions (100), pending orders, transactions (100), quotes for open/pending symbols; auto-closes triggered SL/TP and fills due limits |
| `openTrade` | `src/lib/trading.functions.ts` | accountId, symbol, side, lots, stopLoss, takeProfit | Validates, checks free margin, inserts position atomically |
| `placeLimitOrder` | `src/lib/trading.functions.ts` | accountId, symbol, side, lots, limitPrice, stopLoss, takeProfit | Validates pending price/stop sides and inserts a pending order |
| `cancelPendingOrder` | `src/lib/trading.functions.ts` | accountId, id | Cancels one pending order atomically |
| `closeTrade` | `src/lib/trading.functions.ts` | accountId, id | Closes one position at the current price, credits P/L |
| `moveFunds` | `src/lib/trading.functions.ts` | accountId, kind (`deposit`/`withdraw`), amount | Applies funds and writes a transaction; withdraws respect used margin |

Shared helpers live in `src/lib/trading.ts` (pricing math),
`src/lib/trading-validation.ts` (order/fund limits),
`src/lib/account-options.ts` (account choices, validation, currency formatting),
`src/lib/market.ts` (instrument catalog and deterministic fallback prices),
`src/lib/market-data.ts` (feed types, provider symbol map, synthetic candles) and
`src/lib/market-data.server.ts` (Twelve Data client, caches, fallback).

### Atomic database RPC

```sql
public.apply_demo_operation(
  p_user uuid,
  p_account uuid,
  p_action text,              -- open | close | deposit | withdraw | place_limit | cancel_limit | fill_limit
  p_expected_balance numeric,
  p_expected_positions uuid[],
  p_payload jsonb
) returns jsonb
```

Properties:

- Locks the account row (`FOR UPDATE`) and verifies the owner.
- Rejects stale snapshots (`p_expected_balance` / `p_expected_positions`) so two
  tabs cannot double-spend or close a position twice.
- Enforces free-margin rules for opens, limit fills and withdrawals.
- Handles pending limit orders in the same transaction: place, cancel and fill
  (insert position, mark the order filled, link `position_id`, stamp
  `triggered_at`).
- Inserts transactions only for deposits/withdrawals (plus the initial balance
  row written by `openDemoAccount`).
- Execute is revoked from `public`, `anon` and `authenticated`; granted only to
  `service_role`.

---

## Database

SQL lives in `supabase/migrations/`:

| Migration | Purpose |
| --- | --- |
| `20261019000000_init.sql` | Initial schema, RLS, grants, signup trigger, wallet-based RPC (superseded) |
| `20261020000000_per_account_funds.sql` | Per-account balances/currency/leverage, `account_id` on positions and transactions, account-scoped RPC |
| `20261020010000_account_nickname.sql` | `nickname` column (NOT NULL, default `Demo account`, 1–24 check), backfills existing rows |
| `20261020020000_server_name.sql` | Renames the server default to `Vantor-server 1` and updates existing rows |
| `20261023000000_limit_orders.sql` | `pending_orders` table + RLS, and RPC actions for placing, cancelling and filling limit orders |

### Tables

**`trading_accounts`** — one row per trading account.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK |
| `user_id` | uuid | Owner (nullable until claimed) |
| `issued_by` | uuid | Legacy issuer reference |
| `login` | bigint | Unique MT5-style login |
| `nickname` | text | NOT NULL, 1–24 chars, default `Demo account` |
| `label` | text | Account type (Standard / Pro / Raw Spread) |
| `kind` | text | `demo` / `real` |
| `server` | text | Default `Vantor-server 1` |
| `trader_password` / `investor_password` | text | Plain platform credentials |
| `access_role` | text | `trader` or `investor` |
| `balance` | numeric(14,2) | Per-account balance |
| `currency` | text | USD / EUR / GBP / NGN |
| `leverage` | integer | 1–2000 |
| `created_at` | timestamptz | |

**`positions`** — open and closed trades.

`id`, `user_id`, `account_id` (cascade), `symbol`, `side`, `lots`,
`open_price`, `stop_loss`, `take_profit`, `opened_at`, `closed_at`,
`close_price`, `close_reason`, `pnl`.

**`transactions`** — deposit/withdraw/initial entries.

`id`, `user_id`, `account_id` (cascade), `kind`, `amount`, `created_at`.

**`pending_orders`** — unfilled/cancelled/filled limit orders.

`id`, `user_id`, `account_id` (cascade), `symbol`, `side`, `lots`,
`limit_price`, `stop_loss`, `take_profit`, `status` (`pending` / `filled` /
`cancelled`), `created_at`, `triggered_at`, `cancelled_at`, `position_id`.
A partial index covers pending orders by account. Clients can select only their
own rows; all writes go through the service role.

**`wallets`** — legacy single-wallet balance from the first schema. It is still
created for new users by `handle_new_user` (with a `bonus` transaction), but the
UI no longer reads or writes it. Kept for backwards compatibility.

**`trader_accounts`** — legacy owner/trader link table from the removed Traders
feature. Unused by the current UI.

### RLS model

RLS is enabled on all tables. Policies allow authenticated users to `SELECT`:

- their own wallets, positions, transactions, pending orders and trading
  accounts,
- trading accounts where they are the issuer (legacy),
- trader links where they are the owner (legacy).

There are no client INSERT/UPDATE/DELETE policies on the financial tables —
writes go through server functions using the service role.

### Indexes

- Partial index on open positions by user and by account.
- Partial index on pending orders by account.
- Transactions by user and by account (created_at desc).
- Trading accounts by owner and issuer.

---

## Trading engine

### Instruments

| Symbol | Name | Digits | Spread | Contract | Quote is USD |
| --- | --- | --- | --- | --- | --- |
| EURUSD | Euro / US Dollar | 5 | 0.00008 | 100,000 | yes |
| GBPUSD | British Pound / US Dollar | 5 | 0.0001 | 100,000 | yes |
| USDJPY | US Dollar / Japanese Yen | 3 | 0.012 | 100,000 | no |
| USDCAD | US Dollar / Canadian Dollar | 5 | 0.00012 | 100,000 | no |
| USDCHF | US Dollar / Swiss Franc | 5 | 0.0001 | 100,000 | no |
| AUDUSD | Australian Dollar / US Dollar | 5 | 0.00009 | 100,000 | yes |
| NZDUSD | New Zealand Dollar / US Dollar | 5 | 0.00012 | 100,000 | yes |
| EURGBP | Euro / British Pound | 5 | 0.0001 | 100,000 | no |
| EURJPY | Euro / Japanese Yen | 3 | 0.014 | 100,000 | no |
| GBPJPY | British Pound / Japanese Yen | 3 | 0.018 | 100,000 | no |
| AUDJPY | Australian Dollar / Japanese Yen | 3 | 0.012 | 100,000 | no |
| XAUUSD | Gold / US Dollar | 2 | 0.25 | 100 | yes |
| XAGUSD | Silver / US Dollar | 3 | 0.02 | 5,000 | yes |
| USOIL | WTI Crude Oil | 2 | 0.03 | 1,000 | yes |
| US30 | Dow Jones 30 | 1 | 2 | 1 | yes |
| NAS100 | Nasdaq 100 | 1 | 2 | 1 | yes |
| SPX500 | S&P 500 | 1 | 0.5 | 1 | yes |
| GER40 | DAX 40 | 1 | 2 | 1 | no |
| UK100 | FTSE 100 | 1 | 1.5 | 1 | no |
| BTCUSD | Bitcoin / US Dollar | 1 | 15 | 1 | yes |
| ETHUSD | Ethereum / US Dollar | 2 | 1.5 | 1 | yes |

Prices come from Twelve Data for mapped instruments when `TWELVE_DATA_API_KEYS`
is configured; unmapped instruments and any provider failure use the deterministic
multi-sine engine (same per-symbol phase seed). Bid/ask
are the provider mid price ± half the spread. Chart candles come from the
provider time-series endpoint, and synthetic OHLC candles are generated from the
fallback engine when the feed is unavailable.

Provider symbol mapping lives in `PROVIDER_SYMBOLS` (`src/lib/market-data.ts`).
Forex pairs use the slash form (`EUR/USD`); metals are `XAU/USD`, `XAG/USD`;
energy is `WTI/USD`; indices are `DJI`, `NDX`, `SPX`, `FTSE`; crypto is
`BTC/USD`, `ETH/USD`. Instruments without a mapping stay on the deterministic
synthetic feed. `GER40` is intentionally unmapped because Twelve Data's `DAX`
resolves to an ETF rather than the index; verify both the instrument and price
magnitude before adding a mapping. On Basic, 14 instruments are live (11 forex,
`XAU/USD`, `BTC/USD`, `ETH/USD`); `XAG/USD`, `WTI/USD` and index quotes need
Grow or higher, and US indices are not part of the standard reference catalog.

Realtime streaming currently covers `XAU/USD` and `BTC/USD` over one upstream
connection (two of the trial's eight subscription slots). The Twelve Data trial
WebSocket accepts only a small symbol set (verified: `EUR/USD`, `XAU/USD`,
`BTC/USD`, `AAPL`) and is evaluation-only; production realtime for other symbols
requires a paid WebSocket plan. Trial credits are concurrent subscription slots,
not minutes: one connection per account can hold eight subscribed symbols
indefinitely while connected. The relay keeps one upstream connection open while
at least one browser is subscribed and closes it when the last client leaves.

### Formulas

- **Open price:** ask for buys, bid for sells.
- **Close price:** bid for buys, ask for sells.
- **P/L (USD):**
  `(close - open) × direction × lots × contract`, then converted to USD:
  - USD-quoted instruments: no conversion (the result is already USD).
  - USD-base pairs (USDJPY, USDCAD, USDCHF): divide by the close price.
  - Cross pairs (EURGBP, EURJPY, GBPJPY, AUDJPY) and EUR/GBP-quoted indices
    (GER40, UK100): multiply by a fixed approximate USD rate per quote unit.
- **Margin:** `notional / leverage`, where notional is:
  - `lots × contract × price` for USD-quoted instruments,
  - `lots × contract × USD/base` for cross pairs,
  - `lots × contract × price × USD/quote` for non-USD index CFDs,
  - `lots × contract` for USD-base pairs.
- **Free margin:** `balance + floating - used`.
- **Stops:** long stops trigger when price ≤ SL or ≥ TP; short stops use the
  mirrored comparison. Placement is validated on open (must be on the correct
  side of the market); triggers are checked on each `getAccount` poll.

### Order execution

- **Market orders** open immediately at the current ask (buy) or bid (sell).
- **Buy limits** must be placed below the current ask; **sell limits** above the
  current bid. SL/TP are validated against the limit price, not the live quote.
- A limit fills when the quote crosses it (`ask ≤ limit` for buys, `bid ≥ limit`
  for sells) and is opened at the limit price, not the current quote.
- Limits are evaluated in the same 5-second `getAccount` poll as SL/TP. If free
  margin is insufficient at that moment, the order stays pending and is retried
  on the next poll; it can also be cancelled manually.
- Pending orders do not reserve margin, expire or support partial fills/OCO.

### Validation limits

- Lots: 0.01 – 100, step 0.01.
- Limit, stop and take-profit prices: finite and positive.
- Limit price: buys below ask, sells above bid.
- Funds: 1 – 1,000,000, at most two decimals.
- Starting balance: 100 – 1,000,000, at most two decimals.
- Trader password: 8 – 64 characters.

---

## Authentication and security

- **Sign-up / sign-in:** Supabase email + password. The register form sends a
  confirmation email when "Confirm email" is enabled in Supabase Auth.
- **Session:** persisted in the browser by supabase-js; `attachSupabaseAuth`
  adds `Authorization: Bearer <access token>` to every server-function call.
- **Server auth:** `requireSupabaseAuth` validates the JWT with
  `supabase.auth.getClaims()`, then exposes `{ supabase, userId, claims }`.
- **Service role:** `supabaseAdmin` is server-only and bypasses RLS. It is
  imported lazily inside handlers so it never reaches the client bundle.
  Configured through the `SUPABASE_SERVICE_ROLE_KEY` secret, never committed.
- **CSRF:** TanStack's `createCsrfMiddleware` is registered in `src/start.ts`
  and filters server-function requests.
- **Ownership checks:** every account query filters on `user_id`; the RPC also
  re-checks ownership under a row lock.
- **Read-only role:** investor accounts are rejected by `requireTradable()` for
  orders and fund movements.
- **Third-party sign-in:** Google/Lovable buttons use the Lovable auth broker;
  they only work when running under Lovable. Native Supabase Google OAuth is
  not configured.

Passwords, logins and balances are platform-generated data; do not reuse real
credentials.

---

## Project structure

```
.
├─ src/
│  ├─ routes/
│  │  ├─ __root.tsx              # Root shell, providers, auth listener, 404/error
│  │  ├─ index.tsx               # Marketing landing page
│  │  ├─ auth.tsx                # Sign in / register
│  │  ├─ _authenticated/
│  │  │  ├─ route.tsx            # Client-side guard + app shell (sidebar/bottom nav)
│  │  │  ├─ accounts.tsx         # Account creation/list/linking
│  │  │  ├─ trade.tsx            # Terminal, chart, order panel, positions
│  │  │  ├─ orders.tsx           # Open positions and pending orders
│  │  │  ├─ profile.tsx          # Account summary, switcher and deposit dialog
│  │  │  ├─ history.tsx          # Closed trades
│  │  │  └─ wallet.tsx           # Deposits/withdrawals/transactions
│  │  └─ routeTree.gen.ts        # Generated by TanStack Router
│  ├─ components/
│  │  ├─ app-nav.tsx             # Desktop sidebar, mobile header/drawer, bottom nav
│  │  ├─ price-chart.tsx         # Lightweight Charts candlestick terminal chart
│  │  └─ trading-tables.tsx      # Shared positions/pending-order tables
│  ├─ lib/
│  │  ├─ account-options.ts      # Types/currencies/leverage, validation, money fmt
│  │  ├─ accounts.functions.ts   # Account server functions
│  │  ├─ trading.functions.ts    # Trading/wallet server functions
│  │  ├─ trading.ts              # Pricing, P/L, margin, stops
│  │  ├─ trading-validation.ts   # Order/fund validation
│  │  ├─ market.ts               # Instruments and deterministic fallback pricing
│  │  ├─ market-data.ts          # Feed types, provider symbols, synthetic candles
│  │  ├─ market-data.server.ts   # Twelve Data client, caches, fallback
│  │  ├─ market.functions.ts     # Quote/candle server functions
│  │  ├─ realtime-ticket.ts      # HMAC realtime ticket signing/verification
│  │  ├─ realtime.functions.ts   # Authenticated realtime ticket server function
│  │  ├─ realtime-symbols.ts     # Realtime client/provider symbol map
│  │  ├─ market-stream.ts        # MarketStream Durable Object WebSocket relay
│  │  └─ error-*.ts              # SSR error capture/rendering helpers
│  ├─ integrations/
│  │  ├─ supabase/               # Browser client, admin client, auth middleware
│  │  └─ lovable/                # Lovable OAuth broker
│  ├─ hooks/
│  │  ├─ use-account.ts          # Active account + snapshot queries
│  │  ├─ use-active-account.ts   # localStorage account selection
│  │  ├─ use-market-data.ts      # Quote/candle polling hooks
│  │  ├─ use-realtime-quotes.ts  # Authenticated multi-symbol WebSocket quote hook
│  │  ├─ use-watchlist.ts        # localStorage instrument watchlist
│  │  └─ use-session.ts          # Session and clock hooks
│  ├─ components/ui/             # shadcn-style component library
│  ├─ test/                      # Vitest suites and setup
│  ├─ start.ts                   # Middleware: CSRF, errors, auth attacher
│  ├─ server.ts                  # Nitro/SSR entry wrapper
│  ├─ router.tsx                 # Router creation
│  └─ styles.css                 # Tailwind v4 theme (oklch tokens)
├─ supabase/migrations/          # SQL schema and RPC migrations
├─ scripts/apply-schema.mjs      # Migration runner (SUPABASE_DB_URL)
├─ wrangler.jsonc                # Cloudflare Worker config, public vars, DO binding
├─ exports.cloudflare.ts         # Custom Worker export (MarketStream Durable Object)
├─ vite.config.ts                # Lovable TanStack/Vite preset
├─ roadmap.md                    # Short project checklist (partly stale)
└─ AGENTS.md                     # Repo/Lovable workflow notes
```

---

## Getting started

Prerequisites: Node.js 20+ (or Bun), a Supabase project, and a Postgres
connection string for migrations.

```sh
bun install        # or npm install
cp .env .env.local # then fill SUPABASE_SERVICE_ROLE_KEY
bun run dev        # http://localhost:5173
```

Apply the database migrations once (see below), then register a user in the app
and open a trading account. Add `TWELVE_DATA_API_KEY` to `.dev.vars` (or
`.env.local`) to use live market data locally; otherwise the terminal runs on the
simulated feed.

---

## Environment variables

Public values are committed in `.env` and mirrored to Worker vars in
`wrangler.jsonc`. Secrets belong in `.env.local` / `.dev.vars` (gitignored) and
in Cloudflare secrets.

| Variable | Scope | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | server + public | Project URL |
| `SUPABASE_PUBLISHABLE_KEY` | server + public | Publishable API key (safe for browser) |
| `SUPABASE_PROJECT_ID` | public | Project reference |
| `VITE_SUPABASE_URL` | browser | Vite-exposed project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | browser | Vite-exposed publishable key |
| `VITE_SUPABASE_PROJECT_ID` | browser | Vite-exposed project reference |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Bypasses RLS; required by all mutations |
| `SUPABASE_DB_URL` | local tooling only | Direct/session-pooler Postgres URL for migrations |
| `TWELVE_DATA_API_KEYS` | server only | Comma-separated market data key pool; rotated round-robin and on 429 |
| `TWELVE_DATA_API_KEY` | server only | Single-key fallback; merged with the pool and de-duplicated |
| `REALTIME_TICKET_SECRET` | server only | HMAC secret for short-lived realtime WebSocket tickets; required for realtime streaming |
| `MARKET_QUOTE_TTL_MS` | server only, optional | Quote cache TTL (default 60000, minimum 1000; use 15000–30000 only on paid plans) |
| `MARKET_CANDLE_TTL_MS` | server only, optional | Candle cache TTL override (default 1m–15m by timeframe) |

Notes:

- `.gitignore` excludes `*.local` and `.dev.vars`; never commit the service-role
  key or the database URL.
- The worker needs `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and the
  `SUPABASE_SERVICE_ROLE_KEY` secret.
- Add `TWELVE_DATA_API_KEYS` as a Worker secret to enable live quotes. Each free
  Basic key allows 8 credits/minute and 800/day; a 12-key pool gives 96/minute
  and 9,600/day, with round-robin rotation and a per-key cooldown on 429
  (until the next minute, or UTC midnight for a daily limit).
- At the 60s quote TTL, the default watchlist has five provider-backed symbols
  plus one chart candle: about 6 credits/minute, or 8,640/day, so 12 keys cover
  24/7 use with roughly 10% headroom. The 14 symbols that are live on Basic
  (11 forex, gold, BTC and ETH) plus one candle need 15/minute, or 21,600/day,
  so the pool covers about 10.7 hours per day. If all 21 instruments were live
  (requires Grow+), 31,680/day would need about 40 keys for 24/7. Indices plus
  silver and WTI are plan-restricted on Basic and are retried only every 15
  minutes, so they do not consume the default budget.
- `TWELVE_DATA_API_KEY=demo` works locally for EUR/USD and BTC/USD only.
- Set `REALTIME_TICKET_SECRET` to a random 32-byte value (for example
  `openssl rand -hex 32`) to enable the realtime WebSocket relay. Without it, the
  endpoint returns 503 and the terminal falls back to REST quotes.
- If the database password contains `?`, URL-encode it as `%3F` (and as `%%3F`
  inside Windows `.cmd` files).

---

## Database migrations

Migrations are plain SQL, applied in filename order:

```sh
# Bash / macOS / Linux
SUPABASE_DB_URL="postgresql://postgres.<ref>:<password>@<host>:5432/postgres" \
  bun run db:apply supabase/migrations/20261020010000_account_nickname.sql

# PowerShell
$env:SUPABASE_DB_URL = "postgresql://postgres.<ref>:<password>@<host>:5432/postgres"
bun run db:apply supabase/migrations/20261020010000_account_nickname.sql
```

`scripts/apply-schema.mjs` executes the file as a single SQL batch. The
nickname and per-account migrations are written to be re-runnable; the initial
migration uses `if not exists` / `drop ... if exists` guards.

After changing tables or RPC signatures, update
`src/integrations/supabase/types.ts` manually (or regenerate with the Supabase
CLI) and redeploy, because PostgREST caches function signatures briefly.

---

## Commands

| Command | Description |
| --- | --- |
| `bun run dev` | Vite dev server with HMR |
| `bun run build` | Production build (Nitro → Cloudflare) |
| `bun run preview` | Preview the built app locally |
| `bun run test` | Run Vitest once |
| `bun run test:watch` | Watch mode |
| `bun run lint` | ESLint |
| `bun run format` | Prettier write |
| `bun run db:apply <file>` | Apply a SQL migration using `SUPABASE_DB_URL` |
| `bun run deploy` | Build + `wrangler deploy` |
| `bun run preview:cloudflare` | Build + `wrangler dev` |

> On some Windows setups the Vitest forks pool stalls when files run in
> parallel; use `bunx vitest run --pool=forks --maxWorkers=1`. Likewise, the
> shell can hang on Bun commands when run through certain terminal wrappers.

---

## Testing

Vitest with jsdom covers the pure logic and routing:

| Suite | Coverage |
| --- | --- |
| `src/test/trading.test.ts` | P/L, leverage-aware margin, limit fills, stop-loss/take-profit logic |
| `src/test/market-data.test.ts` | Provider symbol coverage, spread derivation, simulated fallback, synthetic OHLC candles, quote merging |
| `src/test/market-data-rotation.test.ts` | Key-pool rotation, 429 cooldown, all-keys-limited fallback |
| `src/test/realtime-ticket.test.ts` | Realtime ticket signing, tamper/wrong-secret/expiry rejection |
| `src/test/realtime-symbols.test.ts` | Realtime client/provider symbol coverage |
| `src/test/trading-validation.test.ts` | Lot limits, limit/stop-price validation, fund limits |
| `src/test/account-options.test.ts` | Account types/currencies/leverage, balance precision, nickname rules, password length |
| `src/test/app-routing.test.tsx` | Route matching for `/`, `/orders` and `/profile` |

Run:

```sh
bun run test
# or, on Windows:
bunx vitest run --pool=forks --maxWorkers=1
```

Database-level isolation is not part of the automated suite; it was validated
manually (deposit scoping, position scoping, close P/L, cross-user rejection,
per-account transactions) against the live project.

---

## Deployment

The app deploys as a Cloudflare Worker via Wrangler:

```sh
bun run deploy
```

- Public configuration is embedded in `wrangler.jsonc` (`vars`).
- Put the service-role key in a Worker secret:

  ```sh
  bunx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
  bunx wrangler secret put TWELVE_DATA_API_KEY   # optional: enables live quotes
  bunx wrangler secret put REALTIME_TICKET_SECRET # required for realtime streaming
  ```

- `wrangler.jsonc` declares the `MARKET_STREAM` Durable Object binding and its
  `v2` SQLite migration. `exports.cloudflare.ts` re-exports `MarketStream` so Nitro
  includes the class in the Worker bundle. Confirm both the generated
  `.output/server/wrangler.json` binding and the `MarketStream` export after builds.
- Active WebSocket clients can keep an existing Durable Object on the previous
  code after a deploy. Bump `REALTIME_INSTANCE` in `src/server.ts` when changing
  relay behavior, then hard-refresh clients so they join the new instance.

- Local Cloudflare preview uses `.dev.vars` for the same values.
- `vite.config.ts` redirects TanStack Start's server entry to `src/server.ts`
  (SSR error wrapper); Nitro builds for the Cloudflare target.

Production checks after deploying:

```sh
curl -I https://vantor-market-beacon.fundedng.workers.dev/        # 200
curl -I https://vantor-market-beacon.fundedng.workers.dev/auth    # 307 → /auth?mode=in
```

### Supabase Auth settings

For the hosted app, set the Supabase Auth **Site URL** to the Worker URL and add
`https://<worker-domain>/**` plus `http://localhost:5173/**` to the redirect
allow-list. For frictionless local testing, disable "Confirm email"; otherwise
new users must confirm before signing in.

---

## Lovable workflow

This repository is connected to Lovable. Commits pushed to the connected branch
sync back into the Lovable editor, so:

- Avoid force-pushing, rebasing or amending published history.
- Keep the connected branch in a working state.
- `AGENTS.md` records project conventions (root-shell listeners, session-aware
  navigation, browser-safe account hook, atomic RPC usage).

The original Lovable app is at https://vantor-market-beacon.lovable.app; the
Cloudflare Worker above is the current production deployment.

---

## Known limitations and notes

- **Limit fills:** pending orders are evaluated only when the account is polled
  (`getAccount`, every 5 seconds while the terminal is open). There is no
  background scheduler, so fills can be delayed while the app is closed.
- **Market feed:** quotes come from Twelve Data when configured, otherwise from a
  deterministic synthetic engine. `XAU/USD` and `BTC/USD` can use realtime
  WebSocket ticks; other symbols are REST/cached/simulated. There is no true
  tick-level bid/ask, depth, swap, commission or spread-widening model; bid/ask is
  provider mid ± the fixed instrument spread.
- **Realtime scope:** the trial WebSocket only covers `XAU/USD` and `BTC/USD` in
  this app; additional realtime symbols require a paid Twelve Data plan. If the
  relay is unavailable, the terminal keeps the REST/cached/simulated quote path.
- **Feed limits:** caches are per Worker isolate and reset on deploy. Many symbols
  polled frequently need a paid Twelve Data plan; when the plan, key or symbol
  coverage fails, the UI falls back to cached or simulated data (shown in the
  terminal badge). Index provider symbols are configured but not verified against
  a paid plan.
- **Chart library:** Lightweight Charts is the standalone TradingView library. Full
  TradingView Advanced Charts (licensed) would require replacing the chart
  component and adding a UDF-compatible datafeed endpoint.
- **Funding:** balances are credited through the internal wallet; no live payment
  provider or card/bank deposit rail is connected yet.
- **No self-service account deletion or password reset UI.**
- **Legacy schema:** `wallets`, the signup bonus trigger and `trader_accounts`
  remain in the database but are unused by the current UI. The Traders page and
  its server functions were removed when per-account funds were introduced.
- **OAuth buttons:** Google/Lovable sign-in depends on the Lovable auth broker
  and is not usable on the standalone Worker; Supabase's Google provider is
  disabled.
- **Roadmap:** `roadmap.md` predates the per-account and nickname work and is
  partly stale.
- **Lint on Windows:** the repo currently stores CRLF line endings, so
  `bun run lint` can report Prettier `Delete ␍` errors unrelated to logic.
- **Plain credentials:** trader/investor passwords are stored in plain text
  because they are platform-generated MT5-style credentials, not user login
  credentials.
- **Watchlist scope:** the instrument watchlist is stored per browser in
  `localStorage`, so it does not sync across devices or user accounts.
