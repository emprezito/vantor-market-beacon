<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

- Trading accounts belong to a `trading_servers` row; logins are unique per server (`server_id, login`), not globally. New accounts require an active server: public servers for traders, or a private server where the caller is both a partner and a member. `server_id` is immutable after creation, and `server` is a display-name snapshot.
- Private partner servers are hidden from traders at both the server-function and RLS layers. `listTradingServers` returns active public servers only, `loadServerForUser` requires partner access plus membership for private servers, and the `trading_servers` SELECT policy exposes only active public rows. Paused servers reject new accounts while existing accounts keep trading.
- Partner administration lives in `src/lib/partner.functions.ts` + `/partner` and `/partner/accounts`: owners and admins manage settings and members on `/partner` (owners cannot be removed), and create/manage accounts on the sidebar Accounts page. The Accounts page creates normal accounts owned by the partner through `openDemoAccount`, lists server accounts in the same card layout as the trader accounts page, expands each card to show account details, and can reset the trading password. There is no unowned provisioning or claim flow; never expose credentials through client RLS.
- There is no trader-facing claim, join or access-code flow. `server_access_codes` and `redeem_server_access_code` are legacy and unused; do not reintroduce them without an explicit requirement.
- Partner portal access is an app-level `app_roles` row (`partner`), separate from server roles. Only approved partners see the Partner and Accounts navigation and may call partner management functions; partner-role users are kept on `/partner` routes, and other users cannot open them.
- Mount trading notifications and the identity-transition cache listener once in the root shell so all pages share consistent feedback and session refresh.
- Keep public navigation session-aware and route registration mode through validated auth search parameters so account buttons open the intended form.
- Account pages share a browser-safe account hook outside route modules to avoid route code-splitting dependencies.
- The Orders nav dot is derived from the account's open/pending lists, so it stays visible while any position or pending order exists and clears once they are all closed or cancelled.
- Account balance and position mutations use a service-role-only atomic RPC after authenticated owner-scoped reads; expected balances and open-position IDs reject stale concurrent actions.
- Limit orders live in `pending_orders` and go through the same atomic RPC (`place_limit`, `cancel_limit`, `fill_limit`); due orders are evaluated alongside SL/TP during the `getAccount` poll and fill at their limit price.
- Market quotes and candles come from Meridian through the server-only client in `src/lib/meridian.server.ts` and `src/lib/market-data.server.ts`. Keep `MERIDIAN_API_KEY` server-only, configure `MERIDIAN_API_BASE_URL` / `MERIDIAN_WS_URL`, honor `Retry-After`, and preserve cached/display-only synthetic fallbacks. `getAccount` returns a `quotes` map for open and pending symbols.
- Meridian's `/symbols` and `/instruments` responses are authoritative. Preserve canonical provider symbols and broker suffixes for API calls; the catalogue layer may map an existing Vantor symbol such as `XAUUSD` to a provider symbol such as `XAUUSDm`. Do not add hard-coded ambiguous aliases.
- Authenticated realtime uses direct browser-to-Meridian WebSockets. `getMeridianWsToken` validates the Vantor account and exchanges the server-only API key for a short-lived provider token; `useMeridianQuotes` waits for `connected`, subscribes to `tick`, sends heartbeats, reconnects with a fresh token and merges ticks over the REST snapshot. Never persist or log the token or API key.
- External Pocket terminals use Vantor's broker-neutral `pocket.broker.v1` contract, discovered at `/.well-known/pocket-broker.json`. Pocket must receive only Vantor URLs, symbols, account credentials and normalized broker frames; never expose Meridian URLs, tokens, provider symbols or identity through this contract.
- The Pocket-facing `/api/v1/terminal/instruments` catalogue is public, cacheable and derived from Meridian's authoritative entitled catalogue. Keep provider symbols private and publish only canonical Vantor symbols and broker contract specifications.
- The anonymous homepage uses the public Vantor server function `getHomepageQuotes`, which proxies and caches Meridian REST prices without requiring a Vantor session or exposing the API key.
- Meridian quote freshness for trading is five seconds. New orders, pending fills and stop changes reject stale or fallback prices; manual closes remain allowed. Stream disconnects keep the last values visibly stale rather than manufacturing prices.
- Market P/L and margin are calculated in USD, then converted to the account currency with `loadFxRate` (`src/lib/fx.server.ts`) at operation boundaries. `AccountView.fxRate` is account-currency units per USD; USD stays 1, EUR/GBP use inverse EURUSD/GBPUSD, and NGN tries Meridian `USDNGN` with `USD_NGN_RATE` plus a cached fallback. Keep the 15-minute FX cache.
- Original prices remain deterministic in `src/lib/market.ts` for fallback. When touching pricing, margin or P/L, verify both live-quote (`quoteFor`) and synthetic paths with `bunx vitest run --pool=forks --maxWorkers=1`.
- Authenticated routes render in the shared app shell (`src/components/app-nav.tsx`): desktop sidebar, mobile hamburger header and four-tab bottom nav. Register new pages in both navigation lists.
- Fallback quotes (`feedFallback`) are display-only: new orders, pending fills, SL/TP and fund movements reject with `409 fallback_market_data` unless `ALLOW_FALLBACK_TRADING=true` (development only); manual closes remain allowed. Keep equity/margin guards server-side and exclude fallback floating P/L from account equity.
- Twelve Data, the Exness development bridge, the direct MarketDatafeed VPS integration and the `MarketStream` Durable Object are retired. Do not reintroduce those paths or their environment variables without an explicit requirement.
