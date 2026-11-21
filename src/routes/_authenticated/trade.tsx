import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Radio, Star } from "lucide-react";
import { fmt, getInstrument } from "@/lib/market";
import {
  CHART_INDICATOR_KEYS,
  CHART_INDICATOR_LABELS,
  DEFAULT_CHART_INDICATORS,
  type ChartIndicators,
} from "@/lib/chart-indicators";
import {
  CHART_INTERVALS,
  isFallbackQuote,
  isMarketClosedQuote,
  isStaleFeedQuote,
  mergeQuotes,
  quoteFor,
  type ChartInterval,
} from "@/lib/market-data";
import { calcMargin, calcPnl, closePriceFromQuote, type Side } from "@/lib/trading";
import { openTrade, placeLimitOrder } from "@/lib/trading.functions";
import { useNow } from "@/hooks/use-session";
import { useAccount } from "@/hooks/use-account";
import { useMarketCandles, useMarketQuotes } from "@/hooks/use-market-data";
import { useMarketCatalog } from "@/hooks/use-market-catalog";
import { useWatchlist } from "@/hooks/use-watchlist";
import { formatMoney } from "@/lib/account-options";
import { Button } from "@/components/ui/button";
import { PriceChart } from "@/components/price-chart";

export const Route = createFileRoute("/_authenticated/trade")({
  head: () => ({
    meta: [
      { title: "Trade — Vantor" },
      { name: "description", content: "Vantor trading terminal with live quotes and positions." },
      { property: "og:title", content: "Trade — Vantor" },
      { property: "og:description", content: "Trade global markets with fast execution." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Trade,
});

function Trade() {
  const now = useNow(1000);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: acc, activeAccount, isPending, error, refetch } = useAccount();
  const { instruments } = useMarketCatalog();
  const { symbols: watchSymbols, isFavourite, toggle } = useWatchlist();
  const [symbol, setSymbol] = useState("EURUSD");
  const [timeframe, setTimeframe] = useState<ChartInterval>("5min");
  const [indicators, setIndicators] = useState<ChartIndicators>(DEFAULT_CHART_INDICATORS);
  const [lots, setLots] = useState("0.10");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState("");
  const feedSymbols = useMemo(
    () => [...watchSymbols, symbol, ...(acc?.open ?? []).map((position) => position.symbol)],
    [watchSymbols, symbol, acc?.open],
  );
  const {
    quotes: liveQuotes,
    isLoading: quotesLoading,
    realtime: realtimeStatus,
    realtimeError,
  } = useMarketQuotes(feedSymbols, activeAccount?.id ?? null);
  const {
    candles,
    source: candleSource,
    feed: candleFeed,
    loadOlder,
    hasOlder,
    isLoadingOlder,
  } = useMarketCandles(symbol, timeframe, 500, activeAccount?.id ?? null);
  const quotes = useMemo(() => mergeQuotes(acc?.quotes, liveQuotes), [acc?.quotes, liveQuotes]);
  const open = useServerFn(openTrade);
  const placeLimit = useServerFn(placeLimitOrder);

  const place = useMutation({
    mutationFn: async (side: Side) => {
      if (!activeAccount) throw new Error("Open a trading account first");
      const base = {
        accountId: activeAccount.id,
        symbol,
        side,
        lots: Number(lots),
        stopLoss: sl ? Number(sl) : null,
        takeProfit: tp ? Number(tp) : null,
      };
      if (orderType === "limit") {
        const r = await placeLimit({ data: { ...base, limitPrice: Number(limitPrice) } });
        return { kind: "limit" as const, ...r };
      }
      const r = await open({ data: base });
      return { kind: "market" as const, ...r };
    },
    onSuccess: (r, side) => {
      if (r.kind === "limit") {
        toast.success(
          `${side === "buy" ? "Buy" : "Sell"} limit order placed for ${lots} ${symbol} at ${fmt(symbol, Number(limitPrice))}`,
        );
      } else {
        toast.success(
          `${side === "buy" ? "Bought" : "Sold"} ${lots} ${symbol} at ${fmt(symbol, r.price)}`,
        );
      }
      qc.invalidateQueries({ queryKey: ["account"] });
      qc.invalidateQueries({ queryKey: ["my-accounts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const positions = useMemo(() => acc?.open ?? [], [acc?.open]);
  const chartPositions = useMemo(
    () => positions.filter((position) => position.symbol === symbol),
    [positions, symbol],
  );
  const chartPendingOrders = useMemo(
    () => (acc?.pending ?? []).filter((order) => order.symbol === symbol),
    [acc?.pending, symbol],
  );
  const chartClosedPositions = useMemo(
    () => (acc?.closed ?? []).filter((position) => position.symbol === symbol),
    [acc?.closed, symbol],
  );
  const currency = acc?.account.currency ?? activeAccount?.currency ?? "USD";
  const leverage = Number(acc?.account.leverage ?? activeAccount?.leverage ?? 100);
  const fxRate = Number(acc?.fxRate ?? 1);
  const readOnly = activeAccount?.access_role === "investor";
  const floating = positions.reduce((s, p) => {
    const quote = quoteFor(quotes, p.symbol, now);
    if (isFallbackQuote(quote) || isStaleFeedQuote(quote)) return s;
    const price = closePriceFromQuote(p.side as Side, quote);
    return (
      s + calcPnl(p.symbol, p.side as Side, Number(p.lots), Number(p.open_price), price) * fxRate
    );
  }, 0);
  const used = positions.reduce(
    (s, p) => s + calcMargin(p.symbol, Number(p.lots), Number(p.open_price), leverage) * fxRate,
    0,
  );
  const balance = acc?.balance ?? 0;
  const equity = balance + floating;
  const q = quoteFor(quotes, symbol, now);
  const marketClosed = isMarketClosedQuote(q);
  const feedBlocked = !marketClosed && isStaleFeedQuote(q);
  const fallbackBlocked = isFallbackQuote(q);
  const entriesBlocked = marketClosed || feedBlocked || fallbackBlocked;
  const streaming = q.feed === "meridian" && realtimeStatus === "live";
  const feedLabel = marketClosed
    ? "Market closed"
    : q.feedFallback
      ? "Market data unavailable"
      : feedBlocked || realtimeStatus === "stale"
        ? "Meridian stale"
        : streaming
          ? "Streaming"
          : realtimeStatus === "unauthorized" || realtimeStatus === "error"
            ? "Meridian error"
            : quotesLoading && q.source === "simulated"
              ? "Connecting"
              : q.source === "live"
                ? "Meridian REST"
                : q.source === "cached"
                  ? "Cached feed"
                  : "Simulated feed";
  const feedTone = marketClosed
    ? "bg-muted text-muted-foreground"
    : q.feedFallback || realtimeStatus === "unauthorized" || realtimeStatus === "error"
      ? "bg-destructive/15 text-destructive"
      : feedBlocked || realtimeStatus === "stale" || realtimeStatus === "reconnecting"
        ? "bg-warning/15 text-warning"
        : q.source === "live"
          ? "bg-positive/15 text-positive"
          : q.source === "cached"
            ? "bg-muted text-muted-foreground"
            : "bg-warning/15 text-warning";
  const money = (n: number) => formatMoney(n, currency);
  const input =
    "mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm text-foreground outline-none transition-colors placeholder:font-sans placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary";
  const limitValid =
    orderType === "market" ||
    (limitPrice.trim() !== "" && Number.isFinite(Number(limitPrice)) && Number(limitPrice) > 0);
  const watch = watchSymbols
    .map((s) => instruments.find((i) => i.symbol === s))
    .filter((i): i is (typeof instruments)[number] => i != null);
  const chooseType = (next: "market" | "limit") => {
    setOrderType(next);
    if (next === "limit" && limitPrice.trim() === "") setLimitPrice(fmt(symbol, q.mid));
  };
  const selectSymbol = (next: string) => {
    setSymbol(next);
    setSl("");
    setTp("");
    setLimitPrice(orderType === "limit" ? fmt(next, quoteFor(quotes, next, Date.now()).mid) : "");
  };

  useEffect(() => {
    if (instruments.length > 0 && !instruments.some((instrument) => instrument.symbol === symbol)) {
      setSymbol(instruments[0]!.symbol);
    }
  }, [instruments, symbol]);

  if (isPending)
    return (
      <main className="p-6" role="status">
        Loading your account…
      </main>
    );
  if (error)
    return (
      <main className="space-y-4 p-6">
        <p role="alert">{error.message}</p>
        <Button onClick={() => refetch()}>Retry</Button>
      </main>
    );
  if (!activeAccount) {
    return (
      <main className="space-y-4 p-6">
        <h1 className="text-2xl font-bold">Trading terminal</h1>
        <p>You need a trading account to start trading.</p>
        <Button onClick={() => navigate({ to: "/accounts" })}>Open an account</Button>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100dvh-3.5rem)] bg-background xl:min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="flex min-h-14 flex-wrap items-center gap-x-6 gap-y-2 px-3 py-2 sm:px-4">
          <div className="mr-auto min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-tight text-foreground">Market workspace</h1>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${feedTone}`}
                title={
                  q.feedFallback
                    ? "Meridian is unavailable for this symbol. Trading is paused."
                    : (realtimeError ?? undefined)
                }
              >
                <Radio className="h-2.5 w-2.5" />
                {feedLabel}
              </span>
            </div>
            <p className="truncate text-[11px] text-muted-foreground">
              {activeAccount.nickname} · #{activeAccount.login} · {activeAccount.server}
            </p>
          </div>
          <div className="flex max-w-full gap-5 overflow-x-auto pb-0.5 sm:gap-7">
            {[
              ["Balance", balance],
              ["Equity", equity],
              ["Margin", used],
              ["Free margin", equity - used],
            ].map(([label, value]) => (
              <div key={label as string} className="min-w-max">
                <div className="text-[10px] font-medium text-muted-foreground">{label}</div>
                <div className="font-mono text-xs font-semibold text-foreground sm:text-sm">
                  {money(value as number)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </header>

      {readOnly ? (
        <p className="border-b border-border bg-warning/10 px-4 py-2 text-xs text-warning">
          Investor access is read-only. Market data and account activity remain available.
        </p>
      ) : null}

      <div className="grid bg-border xl:min-h-[calc(100dvh-3.5rem)] xl:grid-cols-[220px_minmax(0,1fr)_280px] xl:gap-px">
        <aside className="order-3 border-t border-border bg-card xl:order-1 xl:border-t-0">
          <div className="border-b border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold text-foreground">Instruments</h2>
              <span className="font-mono text-[10px] text-muted-foreground">
                {watchSymbols.length}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <select
                id="instrument-picker"
                aria-label="Choose instrument"
                value={symbol}
                onChange={(event) => selectSymbol(event.target.value)}
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
              >
                {instruments.map((instrument) => (
                  <option key={instrument.symbol} value={instrument.symbol}>
                    {instrument.symbol} · {instrument.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => toggle(symbol)}
                aria-label={
                  isFavourite(symbol)
                    ? `Remove ${symbol} from watchlist`
                    : `Add ${symbol} to watchlist`
                }
                title={isFavourite(symbol) ? "Remove from watchlist" : "Add to watchlist"}
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-md border border-input transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${isFavourite(symbol) ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
              >
                <Star
                  className="h-3.5 w-3.5"
                  fill={isFavourite(symbol) ? "currentColor" : "none"}
                />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-b border-border px-3 py-2 text-[9px] font-medium text-muted-foreground">
            <span>Market</span>
            <span>Bid</span>
            <span>Ask</span>
          </div>
          <div className="max-h-72 overflow-y-auto xl:max-h-[calc(100dvh-10.5rem)]">
            {watch.length === 0 ? (
              <p className="px-3 py-5 text-xs leading-relaxed text-muted-foreground">
                Select a market above and add it to your watchlist.
              </p>
            ) : null}
            {watch.map((instrument) => {
              const quote = quoteFor(quotes, instrument.symbol, now);
              const selected = symbol === instrument.symbol;
              return (
                <div
                  key={instrument.symbol}
                  className={`group grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-border/70 px-3 py-2.5 transition-colors ${selected ? "bg-primary/8 shadow-[inset_2px_0_0_var(--color-primary)]" : "hover:bg-accent/60"}`}
                >
                  <button
                    type="button"
                    onClick={() => selectSymbol(instrument.symbol)}
                    className="min-w-0 text-left focus-visible:outline-none"
                  >
                    <span className="block text-xs font-semibold text-foreground">
                      {instrument.symbol}
                    </span>
                    <span className="block truncate text-[9px] text-muted-foreground">
                      {instrument.name}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => selectSymbol(instrument.symbol)}
                    className="font-mono text-[10px] text-foreground focus-visible:outline-none"
                  >
                    {fmt(instrument.symbol, quote.bid)}
                  </button>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => selectSymbol(instrument.symbol)}
                      className="font-mono text-[10px] text-foreground focus-visible:outline-none"
                    >
                      {fmt(instrument.symbol, quote.ask)}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggle(instrument.symbol)}
                      aria-label={`Remove ${instrument.symbol} from watchlist`}
                      className="hidden text-primary/65 hover:text-primary focus-visible:block group-hover:block"
                    >
                      <Star className="h-3 w-3" fill="currentColor" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        <section className="order-1 min-w-0 bg-background xl:order-2">
          <div className="flex min-h-[68px] flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-3 py-2.5 sm:px-4">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => toggle(symbol)}
                aria-label={
                  isFavourite(symbol)
                    ? `Remove ${symbol} from watchlist`
                    : `Add ${symbol} to watchlist`
                }
                className="text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Star className="h-4 w-4" fill={isFavourite(symbol) ? "currentColor" : "none"} />
              </button>
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-base font-bold tracking-tight text-foreground">{symbol}</h2>
                  <span className="truncate text-[10px] text-muted-foreground">
                    {getInstrument(symbol).name}
                  </span>
                </div>
                <div className="flex items-baseline gap-2 font-mono">
                  <span className="text-lg font-semibold text-foreground">
                    {fmt(symbol, q.mid)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    B {fmt(symbol, q.bid)} / A {fmt(symbol, q.ask)}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-md border border-border bg-background p-1">
              {CHART_INTERVALS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={timeframe === item.value}
                  onClick={() => setTimeframe(item.value)}
                  className={`h-7 min-w-8 rounded px-2 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${timeframe === item.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1 overflow-x-auto border-b border-border bg-card px-3 py-1.5 sm:px-4">
            <span className="mr-1 text-[10px] font-medium text-muted-foreground">Indicators</span>
            {CHART_INDICATOR_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={indicators[key]}
                onClick={() => setIndicators((current) => ({ ...current, [key]: !current[key] }))}
                className={`h-7 rounded border px-2 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  indicators[key]
                    ? "border-primary/45 bg-primary/10 text-primary"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                }`}
              >
                {CHART_INDICATOR_LABELS[key]}
              </button>
            ))}
            <span className="ml-auto whitespace-nowrap text-[9px] text-muted-foreground">
              {candleFeed === "meridian" ? "Meridian MT5" : (candleSource ?? "Loading")}
            </span>
          </div>
          <PriceChart
            symbol={symbol}
            quote={q}
            candles={candles}
            interval={timeframe}
            positions={chartPositions}
            pendingOrders={chartPendingOrders}
            closedPositions={chartClosedPositions}
            indicators={indicators}
            onLoadOlder={loadOlder}
            hasOlder={hasOlder}
            isLoadingOlder={isLoadingOlder}
          />
        </section>

        <section className="order-2 border-y border-border bg-card xl:order-3 xl:border-y-0">
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-foreground">New order</h3>
                <p className="text-[10px] text-muted-foreground">
                  {symbol} · 1:{leverage}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-background p-1 text-[10px]">
                {(["market", "limit"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={orderType === type}
                    onClick={() => chooseType(type)}
                    className={`h-7 rounded px-2.5 capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${orderType === type ? "bg-accent font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 border-b border-border">
            <div className="border-r border-border px-4 py-3">
              <div className="text-[9px] font-medium text-negative">Sell</div>
              <div className="font-mono text-sm font-semibold text-foreground">
                {fmt(symbol, q.bid)}
              </div>
            </div>
            <div className="px-4 py-3 text-right">
              <div className="text-[9px] font-medium text-positive">Buy</div>
              <div className="font-mono text-sm font-semibold text-foreground">
                {fmt(symbol, q.ask)}
              </div>
            </div>
          </div>

          <div className="space-y-3 p-4">
            <label className="block text-[11px] font-medium text-muted-foreground">
              Volume (lots)
              <input
                className={input}
                type="number"
                step="0.01"
                min="0.01"
                value={lots}
                onChange={(event) => setLots(event.target.value)}
              />
            </label>
            {orderType === "limit" ? (
              <label className="block text-[11px] font-medium text-muted-foreground">
                Limit price
                <input
                  className={input}
                  type="number"
                  step="any"
                  min="0"
                  value={limitPrice}
                  onChange={(event) => setLimitPrice(event.target.value)}
                  placeholder={fmt(symbol, q.mid)}
                />
              </label>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[11px] font-medium text-muted-foreground">
                Stop loss
                <input
                  className={input}
                  type="number"
                  step="any"
                  value={sl}
                  onChange={(event) => setSl(event.target.value)}
                  placeholder="Price"
                />
              </label>
              <label className="block text-[11px] font-medium text-muted-foreground">
                Take profit
                <input
                  className={input}
                  type="number"
                  step="any"
                  value={tp}
                  onChange={(event) => setTp(event.target.value)}
                  placeholder="Price"
                />
              </label>
            </div>
            {orderType === "limit" ? (
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Buy limits fill at or below ask; sell limits fill at or above bid.
              </p>
            ) : null}
            <div className="flex items-center justify-between border-y border-border py-2.5 text-[11px]">
              <span className="text-muted-foreground">Required margin</span>
              <span className="font-mono font-semibold text-foreground">
                {money(
                  calcMargin(
                    symbol,
                    Number(lots) || 0,
                    orderType === "limit" ? Number(limitPrice) || q.mid : q.mid,
                    leverage,
                  ) * fxRate,
                )}
              </span>
            </div>
            {feedBlocked ? (
              <p className="rounded-md border border-warning/25 bg-warning/10 p-2 text-[10px] leading-relaxed text-warning">
                Meridian pricing is stale. New orders are paused.
              </p>
            ) : null}
            {marketClosed ? (
              <p className="rounded-md border border-border bg-muted/60 p-2 text-[10px] leading-relaxed text-muted-foreground">
                This market is closed. Trading resumes when the next session opens.
              </p>
            ) : null}
            {fallbackBlocked ? (
              <p className="rounded-md border border-warning/25 bg-warning/10 p-2 text-[10px] leading-relaxed text-warning">
                Live pricing is unavailable. New orders are paused.
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button
                variant="negative"
                disabled={place.isPending || readOnly || !limitValid || entriesBlocked}
                onClick={() => place.mutate("sell")}
                className="h-14 flex-col gap-0.5"
              >
                <span>{orderType === "limit" ? "Sell limit" : "Sell"}</span>
                <span className="font-mono text-[10px] font-medium opacity-85">
                  {fmt(symbol, orderType === "limit" ? Number(limitPrice) || q.bid : q.bid)}
                </span>
              </Button>
              <Button
                variant="positive"
                disabled={place.isPending || readOnly || !limitValid || entriesBlocked}
                onClick={() => place.mutate("buy")}
                className="h-14 flex-col gap-0.5"
              >
                <span>{orderType === "limit" ? "Buy limit" : "Buy"}</span>
                <span className="font-mono text-[10px] font-medium opacity-85">
                  {fmt(symbol, orderType === "limit" ? Number(limitPrice) || q.ask : q.ask)}
                </span>
              </Button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
