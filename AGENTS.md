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

- Mount trading notifications and the identity-transition cache listener once in the root shell so all pages share consistent feedback and session refresh.
- Keep public navigation session-aware and route registration mode through validated auth search parameters so account buttons open the intended form.
- Account pages share a browser-safe account hook outside route modules to avoid route code-splitting dependencies.
- Account balance and position mutations use a service-role-only atomic RPC after authenticated owner-scoped reads; expected balances and open-position IDs reject stale concurrent actions.
- Limit orders live in `pending_orders` and go through the same atomic RPC (`place_limit`, `cancel_limit`, `fill_limit`); due orders are evaluated alongside SL/TP during the `getAccount` poll and fill at their limit price.
- Market quotes and candles are loaded only on the server (`src/lib/market-data.server.ts`) via `getMarketQuotes` / `getMarketCandles`; keep the Twelve Data key server-only and preserve the cached/simulated fallback so trading and charting never go blank. `getAccount` returns a `quotes` map for open and pending symbols.
- `PROVIDER_SYMBOLS` is optional per instrument; unmapped symbols stay simulated. Never map an ambiguous ticker blindly: Twelve Data's `DAX` resolves to an ETF, not the index, so verify instrument identity and price magnitude before adding mappings.
- `TWELVE_DATA_API_KEYS` is a comma-separated Basic-key pool (8 credits/minute and 800/day per key), used round-robin with per-key 429 cooldowns. Keep quote/candle caching conservative: at the 60s TTL the default feed plus chart uses about 6 credits/minute, while 12 keys supply 9,600/day.
- `XAU/USD` and `BTC/USD` realtime ticks flow through `/api/realtime/markets` → `MarketStream` Durable Object → one Twelve Data WebSocket. Browsers must never connect to Twelve Data directly; the authenticated server function issues a 120s HMAC ticket signed with `REALTIME_TICKET_SECRET`, and the DO fans one upstream stream out to all clients.
- Keep the `MARKET_STREAM` binding in `wrangler.jsonc` and the `MarketStream` export in `exports.cloudflare.ts`; Nitro detects the custom entry and must keep exporting the class in `.output/server/index.mjs`. The DO closes upstream when the last browser leaves and reconnects with alarms.
- Realtime is merged in `useMarketQuotes` via `useRealtimeQuotes`; REST/cached/simulated quotes remain the fallback when streaming is unavailable. The trial WS only covers `XAU/USD` and `BTC/USD` in this app (plus EUR/USD and AAPL outside it); more symbols need a paid Twelve Data plan.
- Original prices remain deterministic in `src/lib/market.ts` for fallback. When touching pricing, margin or P/L, verify both live-quote (`quoteFor`) and synthetic paths with `bunx vitest run --pool=forks --maxWorkers=1`.
- Authenticated routes render in the shared app shell (`src/components/app-nav.tsx`): desktop sidebar, mobile hamburger header and four-tab bottom nav. Register new pages in both navigation lists.
