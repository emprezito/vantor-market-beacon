import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChartNoAxesCombined, Check, ChevronDown, Search, Star } from "lucide-react";
import { fmt } from "@/lib/market";
import {
  CHART_INDICATOR_KEYS,
  CHART_INDICATOR_LABELS,
  DEFAULT_CHART_INDICATORS,
  type ChartIndicators,
} from "@/lib/chart-indicators";
import {
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
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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
  const [instrumentQuery, setInstrumentQuery] = useState("");
  const [instrumentPickerOpen, setInstrumentPickerOpen] = useState(false);
  const [mobileOrderOpen, setMobileOrderOpen] = useState(false);
  const [mobileOrderSide, setMobileOrderSide] = useState<Side>("buy");
  const feedSymbols = useMemo(
    () => [...watchSymbols, symbol, ...(acc?.open ?? []).map((position) => position.symbol)],
    [watchSymbols, symbol, acc?.open],
  );
  const { quotes: liveQuotes } = useMarketQuotes(feedSymbols, activeAccount?.id ?? null);
  const { candles, loadOlder, hasOlder, isLoadingOlder } = useMarketCandles(
    symbol,
    timeframe,
    500,
    activeAccount?.id ?? null,
  );
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
      setMobileOrderOpen(false);
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
  const money = (n: number) => formatMoney(n, currency);
  const input =
    "mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm text-foreground outline-none transition-colors placeholder:font-sans placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary";
  const mobileInput =
    "mt-1.5 h-12 w-full rounded-md border border-input bg-background px-3 font-mono text-base text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary";
  const limitValid =
    orderType === "market" ||
    (limitPrice.trim() !== "" && Number.isFinite(Number(limitPrice)) && Number(limitPrice) > 0);
  const watch = watchSymbols
    .map((s) => instruments.find((i) => i.symbol === s))
    .filter((i): i is (typeof instruments)[number] => i != null);
  const filteredInstruments = instruments.filter((instrument) => {
    const query = instrumentQuery.trim().toLowerCase();
    return (
      !query ||
      instrument.symbol.toLowerCase().includes(query) ||
      instrument.name.toLowerCase().includes(query)
    );
  });
  const activeIndicatorCount = Object.values(indicators).filter(Boolean).length;
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
    <main className="min-h-[calc(100dvh-3.5rem)] overflow-x-clip bg-background pb-20 xl:min-h-screen xl:pb-0">
      <header className="border-b border-border bg-card">
        <div className="flex min-h-14 items-center justify-between gap-3 px-3 py-2 sm:px-4">
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="shrink-0 text-sm font-bold tracking-tight text-foreground sm:text-base">
              {symbol}
            </h1>
            <span className="truncate font-mono text-base font-semibold text-foreground sm:text-lg">
              {fmt(symbol, q.mid)}
            </span>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Show account metrics"
                className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-right transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span>
                  <span className="block text-[9px] font-medium text-muted-foreground">Equity</span>
                  <span className="block font-mono text-xs font-semibold text-foreground sm:text-sm">
                    {money(equity)}
                  </span>
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-60 border-border bg-popover p-2">
              <div className="space-y-1">
                {[
                  ["Balance", balance],
                  ["Margin", used],
                  ["Free margin", equity - used],
                ].map(([label, value]) => (
                  <div
                    key={label as string}
                    className="flex items-center justify-between rounded-md px-2 py-2 text-xs hover:bg-accent"
                  >
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-mono font-semibold text-foreground">
                      {money(value as number)}
                    </span>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </header>

      {readOnly ? (
        <p className="border-b border-border bg-warning/10 px-4 py-2 text-xs text-warning">
          Investor access is read-only. Market data and account activity remain available.
        </p>
      ) : null}

      <div className="grid bg-border xl:min-h-[calc(100dvh-3.5rem)] xl:grid-cols-[220px_minmax(0,1fr)_280px] xl:gap-px">
        <aside className="order-3 hidden border-t border-border bg-card xl:order-1 xl:block xl:border-t-0">
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
          <Sheet open={instrumentPickerOpen} onOpenChange={setInstrumentPickerOpen}>
            <SheetContent
              side="bottom"
              className="max-h-[82dvh] overflow-hidden rounded-t-xl border-border bg-card p-0 pb-[env(safe-area-inset-bottom)] sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-1/2 sm:w-[480px] sm:max-w-[90vw] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border"
            >
              <div className="border-b border-border px-4 pb-3 pt-4">
                <SheetTitle className="text-base">Choose market</SheetTitle>
                <SheetDescription className="text-xs">
                  Search instruments or select from your watchlist.
                </SheetDescription>
                <label className="relative mt-3 block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="search"
                    value={instrumentQuery}
                    onChange={(event) => setInstrumentQuery(event.target.value)}
                    placeholder="Search symbols"
                    className="h-11 w-full rounded-md border border-input bg-background pl-10 pr-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </label>
              </div>
              <div className="max-h-[62dvh] overflow-y-auto overscroll-contain">
                {filteredInstruments.map((instrument) => {
                  const marketQuote = quoteFor(quotes, instrument.symbol, now);
                  return (
                    <div
                      key={instrument.symbol}
                      className="flex min-h-14 items-center border-b border-border/70 px-4"
                    >
                      <SheetClose asChild>
                        <button
                          type="button"
                          onClick={() => selectSymbol(instrument.symbol)}
                          className="flex min-w-0 flex-1 items-center justify-between gap-3 py-2 text-left"
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-foreground">
                              {instrument.symbol}
                            </span>
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {instrument.name}
                            </span>
                          </span>
                          <span className="shrink-0 text-right font-mono text-xs">
                            <span className="block text-foreground">
                              {fmt(instrument.symbol, marketQuote.bid)}
                            </span>
                            <span className="block text-[9px] text-muted-foreground">
                              {fmt(instrument.symbol, marketQuote.ask)}
                            </span>
                          </span>
                        </button>
                      </SheetClose>
                      <button
                        type="button"
                        onClick={() => toggle(instrument.symbol)}
                        aria-label={
                          isFavourite(instrument.symbol)
                            ? `Remove ${instrument.symbol} from watchlist`
                            : `Add ${instrument.symbol} to watchlist`
                        }
                        className="ml-3 grid h-10 w-10 shrink-0 place-items-center rounded-md text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <Star
                          className="h-4 w-4"
                          fill={isFavourite(instrument.symbol) ? "currentColor" : "none"}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            </SheetContent>
          </Sheet>
          <PriceChart
            symbol={symbol}
            quote={q}
            candles={candles}
            interval={timeframe}
            positions={chartPositions}
            pendingOrders={chartPendingOrders}
            closedPositions={chartClosedPositions}
            indicators={indicators}
            indicatorControl={
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Select chart indicators"
                    className={`relative grid h-9 w-9 place-items-center rounded-md border backdrop-blur transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      activeIndicatorCount > 0
                        ? "border-primary/45 bg-primary/15 text-primary"
                        : "border-border bg-card/90 text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    <ChartNoAxesCombined className="h-4 w-4" />
                    {activeIndicatorCount > 0 ? (
                      <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 font-mono text-[9px] text-primary-foreground">
                        {activeIndicatorCount}
                      </span>
                    ) : null}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 border-border bg-popover p-2">
                  <div className="border-b border-border px-2 pb-2 pt-1">
                    <div className="text-sm font-semibold text-foreground">Chart indicators</div>
                    <p className="text-[10px] text-muted-foreground">
                      Add only the studies you need for this chart.
                    </p>
                  </div>
                  <div className="py-1">
                    {CHART_INDICATOR_KEYS.map((key) => (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={indicators[key]}
                        onClick={() =>
                          setIndicators((current) => ({ ...current, [key]: !current[key] }))
                        }
                        className="flex h-11 w-full items-center justify-between rounded-md px-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <span>{CHART_INDICATOR_LABELS[key]}</span>
                        <span
                          className={`grid h-5 w-5 place-items-center rounded border ${
                            indicators[key]
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input text-transparent"
                          }`}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </span>
                      </button>
                    ))}
                  </div>
                  {activeIndicatorCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => setIndicators(DEFAULT_CHART_INDICATORS)}
                      className="h-9 w-full rounded-md border border-border text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      Remove all indicators
                    </button>
                  ) : null}
                </PopoverContent>
              </Popover>
            }
            onOpenMarketPicker={() => setInstrumentPickerOpen(true)}
            onIntervalChange={setTimeframe}
            onLoadOlder={loadOlder}
            hasOlder={hasOlder}
            isLoadingOlder={isLoadingOlder}
          />
        </section>

        <section className="order-2 hidden border-y border-border bg-card xl:order-3 xl:block xl:border-y-0">
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

      <Sheet open={mobileOrderOpen} onOpenChange={setMobileOrderOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[88dvh] overflow-y-auto overscroll-contain rounded-t-xl border-border bg-card px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 xl:hidden"
        >
          <SheetTitle className="text-base">Place {symbol} order</SheetTitle>
          <SheetDescription className="text-xs">
            Review direction, risk controls and margin before submitting.
          </SheetDescription>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {(["sell", "buy"] as Side[]).map((side) => (
              <button
                key={side}
                type="button"
                aria-pressed={mobileOrderSide === side}
                onClick={() => setMobileOrderSide(side)}
                className={`h-12 rounded-md border font-semibold capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  mobileOrderSide === side
                    ? side === "buy"
                      ? "border-positive bg-positive/15 text-positive"
                      : "border-negative bg-negative/15 text-negative"
                    : "border-border bg-background text-muted-foreground"
                }`}
              >
                {side}
                <span className="ml-2 font-mono text-xs">
                  {fmt(symbol, side === "buy" ? q.ask : q.bid)}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-1 rounded-md border border-border bg-background p-1">
            {(["market", "limit"] as const).map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={orderType === type}
                onClick={() => chooseType(type)}
                className={`h-10 rounded capitalize transition-colors ${orderType === type ? "bg-accent font-semibold text-foreground" : "text-muted-foreground"}`}
              >
                {type}
              </button>
            ))}
          </div>

          <div className="mt-4 space-y-3">
            <label className="block text-xs font-medium text-muted-foreground">
              Volume (lots)
              <input
                className={mobileInput}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                value={lots}
                onChange={(event) => setLots(event.target.value)}
              />
            </label>
            {orderType === "limit" ? (
              <label className="block text-xs font-medium text-muted-foreground">
                Entry price
                <input
                  className={mobileInput}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={limitPrice}
                  onChange={(event) => setLimitPrice(event.target.value)}
                  placeholder={fmt(symbol, q.mid)}
                />
              </label>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs font-medium text-muted-foreground">
                Stop loss
                <input
                  className={mobileInput}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={sl}
                  onChange={(event) => setSl(event.target.value)}
                  placeholder="Optional"
                />
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                Take profit
                <input
                  className={mobileInput}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={tp}
                  onChange={(event) => setTp(event.target.value)}
                  placeholder="Optional"
                />
              </label>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-y border-border py-3 text-xs">
            <span className="text-muted-foreground">Required margin · 1:{leverage}</span>
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

          {marketClosed || feedBlocked || fallbackBlocked ? (
            <p className="mt-3 rounded-md border border-warning/25 bg-warning/10 p-2 text-xs leading-relaxed text-warning">
              {marketClosed
                ? "This market is closed. Trading resumes when the next session opens."
                : feedBlocked
                  ? "Meridian pricing is stale. New orders are paused."
                  : "Live pricing is unavailable. New orders are paused."}
            </p>
          ) : null}

          <Button
            variant={mobileOrderSide === "buy" ? "positive" : "negative"}
            disabled={place.isPending || readOnly || !limitValid || entriesBlocked}
            onClick={() => place.mutate(mobileOrderSide)}
            className="mt-4 h-12 w-full"
          >
            {place.isPending
              ? "Submitting…"
              : `${mobileOrderSide === "buy" ? "Buy" : "Sell"} ${symbol}`}
            <span className="font-mono text-xs">
              {fmt(
                symbol,
                orderType === "limit"
                  ? Number(limitPrice) || (mobileOrderSide === "buy" ? q.ask : q.bid)
                  : mobileOrderSide === "buy"
                    ? q.ask
                    : q.bid,
              )}
            </span>
          </Button>
        </SheetContent>
      </Sheet>

      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 grid grid-cols-[1fr_88px_1fr] gap-px border-y border-border bg-border p-px shadow-[0_-8px_24px_rgba(0,0,0,0.28)] xl:hidden">
        <button
          type="button"
          disabled={readOnly}
          onClick={() => {
            setMobileOrderSide("sell");
            setMobileOrderOpen(true);
          }}
          className="flex min-h-14 flex-col items-start justify-center bg-card px-3 text-left disabled:opacity-50"
        >
          <span className="text-xs font-semibold text-negative">Sell</span>
          <span className="font-mono text-sm font-semibold text-foreground">
            {fmt(symbol, q.bid)}
          </span>
        </button>
        <label className="flex min-h-14 flex-col items-center justify-center bg-card px-1 text-[9px] font-medium text-muted-foreground">
          Lots
          <input
            aria-label="Quick lot size"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            value={lots}
            onChange={(event) => setLots(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            className="mt-0.5 h-7 w-16 rounded border border-input bg-background px-1 text-center font-mono text-xs font-semibold text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </label>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => {
            setMobileOrderSide("buy");
            setMobileOrderOpen(true);
          }}
          className="flex min-h-14 flex-col items-end justify-center bg-card px-3 text-right disabled:opacity-50"
        >
          <span className="text-xs font-semibold text-positive">Buy</span>
          <span className="font-mono text-sm font-semibold text-foreground">
            {fmt(symbol, q.ask)}
          </span>
        </button>
      </div>
    </main>
  );
}
