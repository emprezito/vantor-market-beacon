import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  CircleUserRound,
  History,
  ListOrdered,
  Menu,
  Search,
  Star,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
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
import {
  cancelPendingOrder,
  closeTrade,
  openTrade,
  placeLimitOrder,
} from "@/lib/trading.functions";
import { useNow } from "@/hooks/use-session";
import { useAccount } from "@/hooks/use-account";
import { useMarketCandles, useMarketQuotes } from "@/hooks/use-market-data";
import { useMarketCatalog } from "@/hooks/use-market-catalog";
import { useWatchlist } from "@/hooks/use-watchlist";
import { formatMoney } from "@/lib/account-options";
import { Button } from "@/components/ui/button";
import { MarketIdentity } from "@/components/market-identity";
import { PriceChart } from "@/components/price-chart";
import { PriceFlash } from "@/components/price-flash";
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

const TERMINAL_LINKS = [
  { to: "/accounts" as const, label: "Accounts", icon: Users },
  { to: "/trade" as const, label: "Trade", icon: TrendingUp },
  { to: "/orders" as const, label: "Orders", icon: ListOrdered },
  { to: "/history" as const, label: "History", icon: History },
  { to: "/wallet" as const, label: "Wallet", icon: Wallet },
  { to: "/profile" as const, label: "Profile", icon: CircleUserRound },
];

function Trade() {
  const now = useNow(1000);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const {
    accounts,
    data: acc,
    activeAccount,
    setActiveAccount,
    isPending,
    error,
    refetch,
  } = useAccount();
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
  const [watchTab, setWatchTab] = useState<"all" | "favourites" | "forex">("favourites");
  const [activityTab, setActivityTab] = useState<"positions" | "pending" | "history" | "journal">(
    "positions",
  );
  const feedSymbols = useMemo(
    () => [...watchSymbols, symbol, ...(acc?.open ?? []).map((position) => position.symbol)],
    [watchSymbols, symbol, acc?.open],
  );
  const { quotes: liveQuotes } = useMarketQuotes(feedSymbols, activeAccount?.id ?? null);
  const { candles, loadOlder, hasOlder, isLoadingOlder } = useMarketCandles(
    symbol,
    timeframe,
    55,
    activeAccount?.id ?? null,
  );
  const quotes = useMemo(() => mergeQuotes(acc?.quotes, liveQuotes), [acc?.quotes, liveQuotes]);
  const open = useServerFn(openTrade);
  const placeLimit = useServerFn(placeLimitOrder);
  const close = useServerFn(closeTrade);
  const cancel = useServerFn(cancelPendingOrder);

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
  const closePosition = useMutation({
    mutationFn: (id: string) => {
      if (!activeAccount) throw new Error("Open a trading account first");
      return close({ data: { accountId: activeAccount.id, id } });
    },
    onSuccess: () => {
      toast.success("Position closed");
      qc.invalidateQueries({ queryKey: ["account"] });
      qc.invalidateQueries({ queryKey: ["my-accounts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancelOrder = useMutation({
    mutationFn: (id: string) => {
      if (!activeAccount) throw new Error("Open a trading account first");
      return cancel({ data: { accountId: activeAccount.id, id } });
    },
    onSuccess: () => {
      toast.success("Pending order cancelled");
      qc.invalidateQueries({ queryKey: ["account"] });
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
    "mt-1 h-8 w-full rounded-sm border border-input bg-background px-2 font-mono text-xs text-foreground outline-none transition-colors placeholder:font-sans placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary";
  const mobileInput =
    "mt-1.5 h-12 w-full rounded-md border border-input bg-background px-3 font-mono text-base text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary";
  const limitValid =
    orderType === "market" ||
    (limitPrice.trim() !== "" && Number.isFinite(Number(limitPrice)) && Number(limitPrice) > 0);
  const watch = watchSymbols
    .map((s) => instruments.find((i) => i.symbol === s))
    .filter((i): i is (typeof instruments)[number] => i != null);
  const selectedInstrument = instruments.find((instrument) => instrument.symbol === symbol);
  const filteredInstruments = instruments.filter((instrument) => {
    const query = instrumentQuery.trim().toLowerCase();
    return (
      !query ||
      instrument.symbol.toLowerCase().includes(query) ||
      instrument.name.toLowerCase().includes(query)
    );
  });
  const terminalMarkets = (
    watchTab === "all"
      ? instruments
      : watchTab === "forex"
        ? instruments.filter((instrument) =>
            (instrument.assetClass ?? "forex").toLowerCase().startsWith("forex"),
          )
        : watch
  ).filter((instrument) => {
    const query = instrumentQuery.trim().toLowerCase();
    return (
      !query ||
      instrument.symbol.toLowerCase().includes(query) ||
      instrument.name.toLowerCase().includes(query)
    );
  });
  const freeMargin = equity - used;
  const marginLevel = used > 0 ? (equity / used) * 100 : 0;
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
    <main className="min-h-[calc(100dvh-3.5rem)] overflow-x-clip bg-background pb-20 lg:flex lg:h-screen lg:min-h-0 lg:flex-col lg:overflow-hidden lg:pb-0">
      <div className="hidden h-10 shrink-0 grid-cols-[200px_minmax(0,1fr)_240px] border-b border-border bg-[oklch(0.105_0.016_255)] text-foreground lg:grid xl:grid-cols-[246px_minmax(0,1fr)_284px]">
        <div className="flex items-center gap-2 border-r border-border px-2">
          <button
            type="button"
            aria-label="Terminal menu"
            className="grid h-7 w-7 place-items-center text-muted-foreground hover:text-foreground"
          >
            <Menu className="h-4 w-4" />
          </button>
          <Link to="/trade" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid h-5 w-5 place-items-center rounded-sm bg-primary text-[10px] font-black text-primary-foreground">
              V
            </span>
            Vantor
          </Link>
        </div>
        <div className="flex min-w-0 items-center border-r border-border">
          <button
            type="button"
            onClick={() => setInstrumentPickerOpen(true)}
            className="flex h-full min-w-44 items-center gap-2 border-r border-border bg-card px-3 text-[11px] font-semibold hover:bg-accent"
          >
            {selectedInstrument ? <MarketIdentity instrument={selectedInstrument} compact /> : null}
            {symbol}
            <span className="font-mono text-[10px] text-muted-foreground">{timeframe}</span>
            <ChevronDown className="ml-auto h-3 w-3 text-muted-foreground" />
          </button>
          <div className="flex items-center gap-2 px-3 text-[10px] text-muted-foreground">
            <span
              className={`h-1.5 w-1.5 rounded-full ${entriesBlocked ? "bg-warning" : "bg-positive"}`}
            />
            {marketClosed ? "Market closed" : feedBlocked ? "Feed stale" : "Live market"}
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-2">
          <span className="hidden font-mono text-[9px] text-muted-foreground xl:inline">
            {new Date(now).toLocaleString([], {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
          <select
            aria-label="Trading account"
            value={activeAccount.id}
            onChange={(event) => setActiveAccount(event.target.value)}
            className="h-7 min-w-36 max-w-44 rounded-sm border border-border bg-card px-2 text-[10px] text-foreground outline-none focus:border-primary"
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.nickname} · {account.login}
              </option>
            ))}
          </select>
        </div>
      </div>

      <header className="border-b border-border bg-card lg:hidden">
        <div className="flex min-h-14 items-center justify-between gap-3 px-3 py-2 sm:px-4">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              aria-label={
                isFavourite(symbol)
                  ? `Remove ${symbol} from watchlist`
                  : `Add ${symbol} to watchlist`
              }
              aria-pressed={isFavourite(symbol)}
              onClick={() => toggle(symbol)}
              className={`grid h-11 w-9 shrink-0 place-items-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                isFavourite(symbol)
                  ? "border-primary/45 bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <Star className="h-4 w-4" fill={isFavourite(symbol) ? "currentColor" : "none"} />
            </button>
            <button
              type="button"
              aria-label="Choose market"
              onClick={() => setInstrumentPickerOpen(true)}
              className="flex h-11 min-w-0 max-w-[168px] flex-col items-start justify-center rounded-md border border-border bg-background px-2 text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="flex w-full items-center gap-1.5 text-xs font-semibold">
                <span className="truncate">{symbol}</span>
                <PriceFlash value={q.mid} className="ml-auto font-mono text-[10px]">
                  {fmt(symbol, q.mid)}
                </PriceFlash>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </span>
              <span className="mt-0.5 flex gap-1.5 whitespace-nowrap font-mono text-[8px] text-muted-foreground">
                <span>
                  B <PriceFlash value={q.bid}>{fmt(symbol, q.bid)}</PriceFlash>
                </span>
                <span>
                  A <PriceFlash value={q.ask}>{fmt(symbol, q.ask)}</PriceFlash>
                </span>
              </span>
            </button>
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
        <p className="border-b border-border bg-warning/10 px-4 py-2 text-xs text-warning lg:hidden">
          Investor access is read-only. Market data and account activity remain available.
        </p>
      ) : null}

      <div className="grid bg-border lg:min-h-0 lg:flex-1 lg:grid-cols-[200px_minmax(0,1fr)_240px] lg:gap-px xl:grid-cols-[246px_minmax(0,1fr)_284px]">
        <aside className="order-3 hidden min-h-0 border-t border-border bg-card lg:order-1 lg:block lg:border-t-0">
          <div className="grid h-full min-h-0 grid-cols-[36px_minmax(0,1fr)]">
            <nav className="flex flex-col items-center gap-1 border-r border-border bg-[oklch(0.12_0.017_255)] py-2">
              {TERMINAL_LINKS.map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  title={label}
                  aria-label={label}
                  className="grid h-8 w-8 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                  activeProps={{ className: "bg-accent text-primary" }}
                >
                  <Icon className="h-3.5 w-3.5" />
                </Link>
              ))}
            </nav>
            <div className="flex min-h-0 flex-col">
              <div className="grid grid-cols-3 border-b border-border text-[9px] text-muted-foreground">
                {(["all", "favourites", "forex"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    aria-pressed={watchTab === tab}
                    onClick={() => setWatchTab(tab)}
                    className={`h-8 capitalize ${watchTab === tab ? "border-b border-primary bg-accent text-foreground" : "hover:bg-accent/50"}`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <label className="relative m-2 block">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={instrumentQuery}
                  onChange={(event) => setInstrumentQuery(event.target.value)}
                  placeholder="Search markets"
                  className="h-7 w-full rounded-sm border border-input bg-background pl-7 pr-2 text-[10px] outline-none focus:border-primary"
                />
              </label>
              <div className="grid grid-cols-[minmax(68px,1fr)_42px_42px] border-y border-border px-1 py-1.5 text-[8px] text-muted-foreground">
                <span>Symbol</span>
                <span className="text-right">Bid</span>
                <span className="text-right">Ask</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {terminalMarkets.length === 0 ? (
                  <p className="px-3 py-5 text-[10px] leading-relaxed text-muted-foreground">
                    No markets match this view.
                  </p>
                ) : null}
                {terminalMarkets.map((instrument) => {
                  const marketQuote = quoteFor(quotes, instrument.symbol, now);
                  const selected = symbol === instrument.symbol;
                  return (
                    <div
                      key={instrument.symbol}
                      className={`group grid h-8 grid-cols-[minmax(68px,1fr)_42px_42px] items-center border-b border-border/60 px-1 text-[8px] ${selected ? "bg-primary/10 shadow-[inset_2px_0_0_var(--color-primary)]" : "hover:bg-accent/50"}`}
                    >
                      <button
                        type="button"
                        onClick={() => selectSymbol(instrument.symbol)}
                        className="flex min-w-0 items-center gap-1 text-left font-semibold focus-visible:outline-none"
                      >
                        <MarketIdentity instrument={instrument} compact />
                        <span className="truncate">{instrument.symbol}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => selectSymbol(instrument.symbol)}
                        className="text-right font-mono text-foreground focus-visible:outline-none"
                      >
                        <PriceFlash value={marketQuote.bid}>
                          {fmt(instrument.symbol, marketQuote.bid)}
                        </PriceFlash>
                      </button>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => selectSymbol(instrument.symbol)}
                          className="font-mono text-foreground focus-visible:outline-none"
                        >
                          <PriceFlash value={marketQuote.ask}>
                            {fmt(instrument.symbol, marketQuote.ask)}
                          </PriceFlash>
                        </button>
                        <button
                          type="button"
                          onClick={() => toggle(instrument.symbol)}
                          aria-label={`${isFavourite(instrument.symbol) ? "Remove" : "Add"} ${instrument.symbol} ${isFavourite(instrument.symbol) ? "from" : "to"} favourites`}
                          className="hidden text-primary group-hover:block focus-visible:block"
                        >
                          <Star
                            className="h-2.5 w-2.5"
                            fill={isFavourite(instrument.symbol) ? "currentColor" : "none"}
                          />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>

        <section className="order-1 min-w-0 bg-background lg:order-2 lg:min-h-0">
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
                          <span className="flex min-w-0 items-center gap-2">
                            <MarketIdentity instrument={instrument} compact />
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold text-foreground">
                                {instrument.symbol}
                              </span>
                              <span className="block truncate text-[10px] text-muted-foreground">
                                {instrument.name}
                              </span>
                            </span>
                          </span>
                          <span className="shrink-0 text-right font-mono text-xs">
                            <span className="block text-foreground">
                              <PriceFlash value={marketQuote.bid}>
                                {fmt(instrument.symbol, marketQuote.bid)}
                              </PriceFlash>
                            </span>
                            <span className="block text-[9px] text-muted-foreground">
                              <PriceFlash value={marketQuote.ask}>
                                {fmt(instrument.symbol, marketQuote.ask)}
                              </PriceFlash>
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
            onIntervalChange={setTimeframe}
            onLoadOlder={loadOlder}
            hasOlder={hasOlder}
            isLoadingOlder={isLoadingOlder}
            terminal
          />
        </section>

        <section className="order-2 hidden min-h-0 overflow-y-auto border-y border-border bg-card lg:order-3 lg:block lg:border-y-0">
          <div className="grid h-9 grid-cols-2 border-b border-border text-[9px] font-semibold">
            <button type="button" className="border-b border-primary bg-accent text-foreground">
              New order
            </button>
            <Link
              to="/orders"
              className="grid place-items-center text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Advanced order
            </Link>
          </div>
          <div className="border-b border-border p-3">
            <button
              type="button"
              onClick={() => setInstrumentPickerOpen(true)}
              className="flex w-full items-center gap-2 rounded-sm border border-border bg-background p-2 text-left hover:bg-accent"
            >
              {selectedInstrument ? <MarketIdentity instrument={selectedInstrument} /> : null}
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold">{symbol}</span>
                <span className="block truncate text-[8px] text-muted-foreground">
                  {instruments.find((instrument) => instrument.symbol === symbol)?.name ?? symbol}
                </span>
              </span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[9px] text-muted-foreground">Type</span>
              <div className="grid grid-cols-2 gap-0.5 rounded-sm border border-border bg-background p-0.5 text-[9px]">
                {(["market", "limit"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={orderType === type}
                    onClick={() => chooseType(type)}
                    className={`h-6 rounded-sm px-2.5 capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${orderType === type ? "bg-accent font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 border-b border-border">
            <div className="border-r border-border px-3 py-2">
              <div className="text-[9px] font-medium text-negative">Sell</div>
              <div className="font-mono text-sm font-semibold text-foreground">
                <PriceFlash value={q.bid}>{fmt(symbol, q.bid)}</PriceFlash>
              </div>
            </div>
            <div className="px-3 py-2 text-right">
              <div className="text-[9px] font-medium text-positive">Buy</div>
              <div className="font-mono text-sm font-semibold text-foreground">
                <PriceFlash value={q.ask}>{fmt(symbol, q.ask)}</PriceFlash>
              </div>
            </div>
          </div>

          <div className="space-y-2.5 p-3">
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
                className="h-12 flex-col gap-0.5 rounded-sm"
              >
                <span>{orderType === "limit" ? "Sell limit" : "Sell"}</span>
                <span className="font-mono text-[10px] font-medium opacity-85">
                  <PriceFlash value={q.bid}>
                    {fmt(symbol, orderType === "limit" ? Number(limitPrice) || q.bid : q.bid)}
                  </PriceFlash>
                </span>
              </Button>
              <Button
                variant="positive"
                disabled={place.isPending || readOnly || !limitValid || entriesBlocked}
                onClick={() => place.mutate("buy")}
                className="h-12 flex-col gap-0.5 rounded-sm"
              >
                <span>{orderType === "limit" ? "Buy limit" : "Buy"}</span>
                <span className="font-mono text-[10px] font-medium opacity-85">
                  <PriceFlash value={q.ask}>
                    {fmt(symbol, orderType === "limit" ? Number(limitPrice) || q.ask : q.ask)}
                  </PriceFlash>
                </span>
              </Button>
            </div>
          </div>
        </section>
      </div>

      <section className="hidden h-[clamp(132px,24dvh,190px)] shrink-0 border-t border-border bg-card lg:block">
        <div className="flex h-8 items-end gap-1 border-b border-border px-2 text-[9px]">
          {(
            [
              ["positions", "Open orders", positions.length],
              ["pending", "Pending orders", acc?.pending?.length ?? 0],
              ["history", "Orders history", acc?.closed?.length ?? 0],
              ["journal", "Journal", 0],
            ] as const
          ).map(([tab, label, count]) => (
            <button
              key={tab}
              type="button"
              aria-pressed={activityTab === tab}
              onClick={() => setActivityTab(tab)}
              className={`h-8 border-x border-t px-3 ${activityTab === tab ? "border-border bg-background text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {label}
              {count > 0 ? (
                <span className="ml-1.5 rounded-full bg-accent px-1.5 font-mono text-[8px]">
                  {count}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="h-[calc(100%-2rem)] overflow-auto">
          {activityTab === "positions" ? (
            <table className="w-full min-w-[980px] text-[9px]">
              <thead className="sticky top-0 bg-muted text-left text-[8px] text-muted-foreground">
                <tr>
                  {[
                    "Order",
                    "Time",
                    "Side",
                    "Volume",
                    "Symbol",
                    "Open price",
                    "Stop loss",
                    "Take profit",
                    "Current price",
                    "Profit",
                    "",
                  ].map((heading) => (
                    <th key={heading} className="whitespace-nowrap px-3 py-1.5 font-medium">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-8 text-center text-muted-foreground">
                      No open positions
                    </td>
                  </tr>
                ) : null}
                {positions.map((position) => {
                  const positionQuote = quoteFor(quotes, position.symbol, now);
                  const current = closePriceFromQuote(position.side as Side, positionQuote);
                  const pnl =
                    isFallbackQuote(positionQuote) || isStaleFeedQuote(positionQuote)
                      ? 0
                      : calcPnl(
                          position.symbol,
                          position.side as Side,
                          Number(position.lots),
                          Number(position.open_price),
                          current,
                        ) * fxRate;
                  return (
                    <tr key={position.id} className="border-t border-border/60 hover:bg-accent/40">
                      <td className="px-3 py-1.5 font-mono text-muted-foreground">
                        {position.id.slice(0, 8)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                        {new Date(position.opened_at).toLocaleString()}
                      </td>
                      <td
                        className={`px-3 py-1.5 font-semibold ${position.side === "buy" ? "text-positive" : "text-negative"}`}
                      >
                        {position.side.toUpperCase()}
                      </td>
                      <td className="px-3 py-1.5 font-mono">{Number(position.lots).toFixed(2)}</td>
                      <td className="px-3 py-1.5 font-semibold">{position.symbol}</td>
                      <td className="px-3 py-1.5 font-mono">
                        {fmt(position.symbol, Number(position.open_price))}
                      </td>
                      <td className="px-3 py-1.5 font-mono">
                        {position.stop_loss
                          ? fmt(position.symbol, Number(position.stop_loss))
                          : "0"}
                      </td>
                      <td className="px-3 py-1.5 font-mono">
                        {position.take_profit
                          ? fmt(position.symbol, Number(position.take_profit))
                          : "0"}
                      </td>
                      <td className="px-3 py-1.5 font-mono">{fmt(position.symbol, current)}</td>
                      <td
                        className={`px-3 py-1.5 font-mono font-semibold ${pnl >= 0 ? "text-positive" : "text-negative"}`}
                      >
                        {money(pnl)}
                      </td>
                      <td className="px-2 py-1">
                        <button
                          type="button"
                          disabled={readOnly || closePosition.isPending}
                          onClick={() => closePosition.mutate(position.id)}
                          className="rounded-sm border border-negative/40 px-2 py-1 text-[8px] text-negative hover:bg-negative/10 disabled:opacity-40"
                        >
                          Close
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}

          {activityTab === "pending" ? (
            <table className="w-full min-w-[900px] text-[9px]">
              <thead className="sticky top-0 bg-muted text-left text-[8px] text-muted-foreground">
                <tr>
                  {["Order", "Placed", "Side", "Volume", "Symbol", "Limit", "SL", "TP", ""].map(
                    (heading) => (
                      <th key={heading} className="whitespace-nowrap px-3 py-1.5 font-medium">
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {(acc?.pending ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                      No pending orders
                    </td>
                  </tr>
                ) : null}
                {(acc?.pending ?? []).map((order) => (
                  <tr key={order.id} className="border-t border-border/60 hover:bg-accent/40">
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">
                      {order.id.slice(0, 8)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                      {new Date(order.created_at).toLocaleString()}
                    </td>
                    <td
                      className={`px-3 py-1.5 font-semibold ${order.side === "buy" ? "text-positive" : "text-negative"}`}
                    >
                      {order.side.toUpperCase()} LIMIT
                    </td>
                    <td className="px-3 py-1.5 font-mono">{Number(order.lots).toFixed(2)}</td>
                    <td className="px-3 py-1.5 font-semibold">{order.symbol}</td>
                    <td className="px-3 py-1.5 font-mono">
                      {fmt(order.symbol, Number(order.limit_price))}
                    </td>
                    <td className="px-3 py-1.5 font-mono">
                      {order.stop_loss ? fmt(order.symbol, Number(order.stop_loss)) : "0"}
                    </td>
                    <td className="px-3 py-1.5 font-mono">
                      {order.take_profit ? fmt(order.symbol, Number(order.take_profit)) : "0"}
                    </td>
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        disabled={readOnly || cancelOrder.isPending}
                        onClick={() => cancelOrder.mutate(order.id)}
                        className="rounded-sm border border-border px-2 py-1 text-[8px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {activityTab === "history" ? (
            <table className="w-full min-w-[900px] text-[9px]">
              <thead className="sticky top-0 bg-muted text-left text-[8px] text-muted-foreground">
                <tr>
                  {["Closed", "Side", "Volume", "Symbol", "Open", "Close", "Reason", "Profit"].map(
                    (heading) => (
                      <th key={heading} className="whitespace-nowrap px-3 py-1.5 font-medium">
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {(acc?.closed ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                      No closed trades
                    </td>
                  </tr>
                ) : null}
                {(acc?.closed ?? []).map((position) => (
                  <tr key={position.id} className="border-t border-border/60 hover:bg-accent/40">
                    <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                      {position.closed_at ? new Date(position.closed_at).toLocaleString() : "—"}
                    </td>
                    <td
                      className={`px-3 py-1.5 font-semibold ${position.side === "buy" ? "text-positive" : "text-negative"}`}
                    >
                      {position.side.toUpperCase()}
                    </td>
                    <td className="px-3 py-1.5 font-mono">{Number(position.lots).toFixed(2)}</td>
                    <td className="px-3 py-1.5 font-semibold">{position.symbol}</td>
                    <td className="px-3 py-1.5 font-mono">
                      {fmt(position.symbol, Number(position.open_price))}
                    </td>
                    <td className="px-3 py-1.5 font-mono">
                      {fmt(position.symbol, Number(position.close_price))}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{position.close_reason}</td>
                    <td
                      className={`px-3 py-1.5 font-mono font-semibold ${Number(position.pnl) >= 0 ? "text-positive" : "text-negative"}`}
                    >
                      {money(Number(position.pnl))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {activityTab === "journal" ? (
            <div className="p-8 text-center text-[9px] text-muted-foreground">
              Session journal events are not persisted yet.
            </div>
          ) : null}
        </div>
      </section>

      <footer className="hidden h-6 shrink-0 items-center gap-6 overflow-x-auto whitespace-nowrap border-t border-border bg-[oklch(0.105_0.016_255)] px-3 font-mono text-[8px] text-muted-foreground lg:flex">
        <span>
          Balance: <strong className="text-foreground">{money(balance)}</strong>
        </span>
        <span>
          Credit: <strong className="text-foreground">{money(0)}</strong>
        </span>
        <span>
          Equity: <strong className="text-foreground">{money(equity)}</strong>
        </span>
        <span>
          Margin: <strong className="text-foreground">{money(used)}</strong>
        </span>
        <span>
          Free margin: <strong className="text-foreground">{money(freeMargin)}</strong>
        </span>
        <span>
          Level:{" "}
          <strong className="text-foreground">
            {marginLevel ? `${marginLevel.toFixed(2)}%` : "—"}
          </strong>
        </span>
        <span className="ml-auto">
          Profit:{" "}
          <strong className={floating >= 0 ? "text-positive" : "text-negative"}>
            {money(floating)}
          </strong>
        </span>
      </footer>

      <Sheet open={mobileOrderOpen} onOpenChange={setMobileOrderOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[88dvh] overflow-y-auto overscroll-contain rounded-t-xl border-border bg-card px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 lg:hidden"
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
                  <PriceFlash value={side === "buy" ? q.ask : q.bid}>
                    {fmt(symbol, side === "buy" ? q.ask : q.bid)}
                  </PriceFlash>
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

      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 grid grid-cols-[1fr_88px_1fr] gap-px border-y border-border bg-border p-px shadow-[0_-8px_24px_rgba(0,0,0,0.28)] lg:hidden">
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
            <PriceFlash value={q.bid}>{fmt(symbol, q.bid)}</PriceFlash>
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
            <PriceFlash value={q.ask}>{fmt(symbol, q.ask)}</PriceFlash>
          </span>
        </button>
      </div>
    </main>
  );
}
