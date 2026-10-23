import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Star } from "lucide-react";
import { INSTRUMENTS, fmt, history, quote, getInstrument } from "@/lib/market";
import { calcMargin, calcPnl, closePrice, type Side } from "@/lib/trading";
import { openTrade, closeTrade, placeLimitOrder, cancelPendingOrder } from "@/lib/trading.functions";
import { useNow } from "@/hooks/use-session";
import { useAccount } from "@/hooks/use-account";
import { useWatchlist } from "@/hooks/use-watchlist";
import { formatMoney } from "@/lib/account-options";
import { Button } from "@/components/ui/button";
import { OpenPositionsSection, PendingOrdersSection } from "@/components/trading-tables";

export const Route = createFileRoute("/_authenticated/trade")({
  head: () => ({ meta: [{ title: "Trade — Vantor" }, { name: "description", content: "Vantor trading terminal with live quotes and positions." }, { property: "og:title", content: "Trade — Vantor" }, { property: "og:description", content: "Trade global markets with fast execution." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Trade,
});

function Chart({ symbol, now, positions }: { symbol: string; now: number; positions: { id: string; symbol: string; side: string; lots: number; open_price: number }[] }) {
  const pts = useMemo(() => history(symbol, now), [symbol, now]);
  const ps = pts.map((x) => x.p);
  const W = 800, H = 300;
  const entries = positions.map((p) => Number(p.open_price));
  const min = Math.min(...ps, ...entries), max = Math.max(...ps, ...entries);
  const yOf = (p: number) => H - ((p - min) / (max - min || 1)) * (H - 20) - 10;
  const d = pts.map((x, i) => `${i ? "L" : "M"}${(i / (pts.length - 1)) * W},${yOf(x.p)}`).join(" ");
  const up = (ps.at(-1) ?? 0) >= (ps[0] ?? 0);
  const marks = positions.map((p) => {
    const side = p.side as Side;
    const entry = Number(p.open_price);
    const pnl = calcPnl(p.symbol, side, Number(p.lots), entry, closePrice(p.symbol, side, now));
    return { id: p.id, side, lots: Number(p.lots), entry, pnl, y: yOf(entry) };
  });
  return (
    <div className="relative overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full sm:h-72" preserveAspectRatio="none">
        <path d={`${d} L${W},${H} L0,${H} Z`} className={up ? "fill-accent/10" : "fill-destructive/10"} />
        <path d={d} fill="none" strokeWidth={2} className={up ? "stroke-accent" : "stroke-destructive"} />
        {marks.map((m) => (
          <line key={m.id} x1={0} x2={W} y1={m.y} y2={m.y} strokeWidth={1.5} strokeDasharray="8 6" className={m.pnl >= 0 ? "stroke-accent" : "stroke-destructive"} />
        ))}
      </svg>
      {marks.map((m) => (
        <div
          key={m.id}
          style={{ top: `${(m.y / H) * 100}%` }}
          className={`absolute right-1 flex -translate-y-1/2 items-center gap-1.5 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${m.pnl >= 0 ? "bg-accent/15 text-accent" : "bg-destructive/15 text-destructive"}`}
        >
          <span>{m.side.toUpperCase()} {m.lots.toFixed(2)} @ {fmt(symbol, m.entry)}</span>
          <span>{m.pnl >= 0 ? "+" : "-"}${Math.abs(m.pnl).toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

function Trade() {
  const now = useNow(1000);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: acc, activeAccount, isPending, error, refetch } = useAccount();
  const { symbols: watchSymbols, isFavourite, toggle } = useWatchlist();
  const [symbol, setSymbol] = useState("EURUSD");
  const [lots, setLots] = useState("0.10");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState("");
  const open = useServerFn(openTrade);
  const close = useServerFn(closeTrade);
  const placeLimit = useServerFn(placeLimitOrder);
  const cancelPending = useServerFn(cancelPendingOrder);

  const place = useMutation({
    mutationFn: async (side: Side) => {
      if (!activeAccount) throw new Error("Open a trading account first");
      const base = { accountId: activeAccount.id, symbol, side, lots: Number(lots), stopLoss: sl ? Number(sl) : null, takeProfit: tp ? Number(tp) : null };
      if (orderType === "limit") {
        const r = await placeLimit({ data: { ...base, limitPrice: Number(limitPrice) } });
        return { kind: "limit" as const, ...r };
      }
      const r = await open({ data: base });
      return { kind: "market" as const, ...r };
    },
    onSuccess: (r, side) => {
      if (r.kind === "limit") {
        toast.success(`${side === "buy" ? "Buy" : "Sell"} limit order placed for ${lots} ${symbol} at ${fmt(symbol, Number(limitPrice))}`);
      } else {
        toast.success(`${side === "buy" ? "Bought" : "Sold"} ${lots} ${symbol} at ${fmt(symbol, r.price)}`);
      }
      qc.invalidateQueries({ queryKey: ["account"] });
      qc.invalidateQueries({ queryKey: ["my-accounts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancelMut = useMutation({
    mutationFn: (id: string) => {
      if (!activeAccount) throw new Error("Open a trading account first");
      return cancelPending({ data: { accountId: activeAccount.id, id } });
    },
    onSuccess: () => {
      toast.success("Pending order cancelled");
      qc.invalidateQueries({ queryKey: ["account"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const shut = useMutation({
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

  const positions = acc?.open ?? [];
  const pending = acc?.pending ?? [];
  const currency = acc?.account.currency ?? activeAccount?.currency ?? "USD";
  const leverage = Number(acc?.account.leverage ?? activeAccount?.leverage ?? 100);
  const readOnly = activeAccount?.access_role === "investor";
  const floating = positions.reduce((s, p) => s + calcPnl(p.symbol, p.side as Side, Number(p.lots), Number(p.open_price), closePrice(p.symbol, p.side as Side, now)), 0);
  const used = positions.reduce((s, p) => s + calcMargin(p.symbol, Number(p.lots), Number(p.open_price), leverage), 0);
  const balance = acc?.balance ?? 0;
  const equity = balance + floating;
  const q = quote(symbol, now);
  const money = (n: number) => formatMoney(n, currency);
  const input = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  const limitValid = orderType === "market" || (limitPrice.trim() !== "" && Number.isFinite(Number(limitPrice)) && Number(limitPrice) > 0);
  const watch = watchSymbols
    .map((s) => INSTRUMENTS.find((i) => i.symbol === s))
    .filter((i): i is (typeof INSTRUMENTS)[number] => i != null);
  const chooseType = (next: "market" | "limit") => {
    setOrderType(next);
    if (next === "limit" && limitPrice.trim() === "") setLimitPrice(fmt(symbol, q.mid));
  };
  const selectSymbol = (next: string) => {
    setSymbol(next);
    setSl("");
    setTp("");
    setLimitPrice(orderType === "limit" ? fmt(next, quote(next, Date.now()).mid) : "");
  };

  if (isPending) return <main className="p-6" role="status">Loading your account…</main>;
  if (error) return <main className="space-y-4 p-6"><p role="alert">{error.message}</p><Button onClick={() => refetch()}>Retry</Button></main>;
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
    <main className="mx-auto max-w-7xl space-y-3 px-3 pb-6 pt-3 sm:space-y-6 sm:px-6 sm:py-6">
      <div className="hidden flex-wrap items-center justify-between gap-2 sm:flex">
        <h1 className="text-lg font-bold sm:text-2xl">Trading terminal</h1>
      </div>
      {readOnly && <p className="rounded-md bg-muted px-4 py-2 text-sm text-muted-foreground">Investor access — this account is read-only.</p>}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        {[["Balance", balance], ["Equity", equity], ["Margin used", used], ["Free margin", equity - used]].map(([l, v]) => (
          <div key={l as string} className="min-w-0 rounded-xl bg-muted p-3 sm:p-4">
            <div className="text-[11px] text-muted-foreground sm:text-xs">{l}</div>
            <div className="break-words text-base font-bold sm:text-xl">{money(v as number)}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[240px_1fr_280px]">
        <aside className="rounded-xl border p-3">
          <label htmlFor="instrument-picker" className="text-xs font-medium text-muted-foreground">
            Choose instrument
          </label>
          <div className="mt-1 flex items-center gap-1.5">
            <select
              id="instrument-picker"
              value={symbol}
              onChange={(e) => selectSymbol(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            >
              {INSTRUMENTS.map((i) => (
                <option key={i.symbol} value={i.symbol}>{i.symbol} · {i.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => toggle(symbol)}
              aria-label={isFavourite(symbol) ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
              title={isFavourite(symbol) ? "Remove from watchlist" : "Add to watchlist"}
              className={`rounded-md border border-input p-1.5 ${isFavourite(symbol) ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Star className="h-4 w-4" fill={isFavourite(symbol) ? "currentColor" : "none"} />
            </button>
          </div>

          <div className="mt-4 flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>Watchlist</span>
            <span>{watchSymbols.length}</span>
          </div>
          <div className="mt-1 max-h-80 overflow-y-auto">
            {watch.length === 0 && (
              <p className="px-1 py-3 text-xs text-muted-foreground">
                No instruments yet. Pick one above and tap the star to add it.
              </p>
            )}
            {watch.map((i) => {
              const qq = quote(i.symbol, now);
              return (
                <div key={i.symbol} className={`flex items-center border-b last:border-0 ${symbol === i.symbol ? "bg-primary/15" : ""}`}>
                  <button
                    type="button"
                    onClick={() => selectSymbol(i.symbol)}
                    className="flex h-11 min-w-0 flex-1 items-center justify-between gap-2 px-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="font-semibold">{i.symbol}</span>
                    <span className="font-mono text-xs">{fmt(i.symbol, qq.bid)}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggle(i.symbol)}
                    aria-label={`Remove ${i.symbol} from watchlist`}
                    title="Remove from watchlist"
                    className="px-2 py-2 text-primary hover:opacity-70"
                  >
                    <Star className="h-3.5 w-3.5" fill="currentColor" />
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        <section className="rounded-xl border p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold sm:text-xl">{symbol}</h2>
              <p className="text-xs text-muted-foreground">{getInstrument(symbol).name} · last 10 min</p>
            </div>
            <span className="font-mono text-xl sm:text-2xl">{fmt(symbol, q.mid)}</span>
          </div>
          <Chart symbol={symbol} now={now} positions={positions.filter((p) => p.symbol === symbol)} />
        </section>

        <section className="space-y-3 rounded-xl border p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold">New order</h3>
            <div className="grid grid-cols-2 gap-0.5 rounded-md bg-muted p-0.5 text-xs">
              {(["market", "limit"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => chooseType(t)}
                  className={`rounded px-2.5 py-1 capitalize ${orderType === t ? "bg-background font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <label className="block text-xs text-muted-foreground">Volume (lots)
            <input className={input} type="number" step="0.01" min="0.01" value={lots} onChange={(e) => setLots(e.target.value)} />
          </label>
          {orderType === "limit" && (
            <label className="block text-xs text-muted-foreground">Limit price
              <input className={input} type="number" step="any" min="0" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} placeholder={fmt(symbol, q.mid)} />
            </label>
          )}
          <label className="block text-xs text-muted-foreground">Stop loss (optional)
            <input className={input} type="number" step="any" value={sl} onChange={(e) => setSl(e.target.value)} placeholder="Price" />
          </label>
          <label className="block text-xs text-muted-foreground">Take profit (optional)
            <input className={input} type="number" step="any" value={tp} onChange={(e) => setTp(e.target.value)} placeholder="Price" />
          </label>
          {orderType === "limit" && (
            <p className="text-[11px] leading-snug text-muted-foreground">
              Buy limits fill at or below the ask ({fmt(symbol, q.ask)}); sell limits fill at or above the bid ({fmt(symbol, q.bid)}). Stop levels are checked against the limit price.
            </p>
          )}
          <p className="text-xs text-muted-foreground">Margin needed: {money(calcMargin(symbol, Number(lots) || 0, orderType === "limit" ? Number(limitPrice) || q.mid : q.mid, leverage))} (1:{leverage})</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="destructive" disabled={place.isPending || readOnly || !limitValid} onClick={() => place.mutate("sell")} className="h-16 flex-col py-3 font-semibold">
              {orderType === "limit" ? "Sell limit" : "Sell"}<div className="font-mono text-xs">{fmt(symbol, orderType === "limit" ? Number(limitPrice) || q.bid : q.bid)}</div>
            </Button>
            <Button disabled={place.isPending || readOnly || !limitValid} onClick={() => place.mutate("buy")} className="h-16 flex-col bg-accent py-3 font-semibold text-accent-foreground hover:bg-accent/90">
              {orderType === "limit" ? "Buy limit" : "Buy"}<div className="font-mono text-xs">{fmt(symbol, orderType === "limit" ? Number(limitPrice) || q.ask : q.ask)}</div>
            </Button>
          </div>
        </section>
      </div>

      <OpenPositionsSection
        positions={positions}
        currency={currency}
        now={now}
        readOnly={!!readOnly}
        busy={shut.isPending}
        onClose={(id) => shut.mutate(id)}
      />

      <PendingOrdersSection
        orders={pending}
        readOnly={!!readOnly}
        busy={cancelMut.isPending}
        onCancel={(id) => cancelMut.mutate(id)}
      />
    </main>
  );
}
