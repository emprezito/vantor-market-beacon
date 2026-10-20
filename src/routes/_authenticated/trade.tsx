import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { INSTRUMENTS, fmt, history, quote, getInstrument } from "@/lib/market";
import { calcMargin, calcPnl, closePrice, type Side } from "@/lib/trading";
import { openTrade, closeTrade } from "@/lib/trading.functions";
import { useNow } from "@/hooks/use-session";
import { useAccount } from "@/hooks/use-account";
import { formatMoney } from "@/lib/account-options";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/trade")({
  head: () => ({ meta: [{ title: "Trade — Vantor" }, { name: "description", content: "Vantor demo trading terminal with simulated market quotes and positions." }, { property: "og:title", content: "Trade — Vantor" }, { property: "og:description", content: "Practice trading with virtual funds." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
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
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-72 w-full" preserveAspectRatio="none">
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
  const { data: acc, accounts, activeAccount, setActiveAccount, isPending, error, refetch } = useAccount();
  const [symbol, setSymbol] = useState("EURUSD");
  const [lots, setLots] = useState("0.10");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const open = useServerFn(openTrade);
  const close = useServerFn(closeTrade);

  const place = useMutation({
    mutationFn: (side: Side) => {
      if (!activeAccount) throw new Error("Open a demo account first");
      return open({ data: { accountId: activeAccount.id, symbol, side, lots: Number(lots), stopLoss: sl ? Number(sl) : null, takeProfit: tp ? Number(tp) : null } });
    },
    onSuccess: (r, side) => {
      toast.success(`${side === "buy" ? "Bought" : "Sold"} ${lots} ${symbol} at ${fmt(symbol, r.price)}`);
      qc.invalidateQueries({ queryKey: ["account"] });
      qc.invalidateQueries({ queryKey: ["my-accounts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const shut = useMutation({
    mutationFn: (id: string) => {
      if (!activeAccount) throw new Error("Open a demo account first");
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

  if (isPending) return <main className="p-6" role="status">Loading your demo account…</main>;
  if (error) return <main className="space-y-4 p-6"><p role="alert">{error.message}</p><Button onClick={() => refetch()}>Retry</Button></main>;
  if (!activeAccount) {
    return (
      <main className="space-y-4 p-6">
        <h1 className="text-2xl font-bold">Trading terminal</h1>
        <p>You need a demo account to start trading.</p>
        <Button onClick={() => navigate({ to: "/accounts" })}>Open an account</Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Trading terminal <span className="text-sm font-normal text-muted-foreground">· Simulated markets</span></h1>
        <select
          aria-label="Trading account"
          value={activeAccount.id}
          onChange={(e) => setActiveAccount(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>#{a.login} · {a.label} · {a.currency} · 1:{a.leverage}</option>
          ))}
        </select>
      </div>
      {readOnly && <p className="rounded-md bg-muted px-4 py-2 text-sm text-muted-foreground">Investor access — this account is read-only.</p>}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[["Balance", balance], ["Equity", equity], ["Margin used", used], ["Free margin", equity - used]].map(([l, v]) => (
          <div key={l as string} className="rounded-xl bg-muted p-4">
            <div className="text-xs text-muted-foreground">{l}</div>
            <div className="text-xl font-bold">{money(v as number)}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[240px_1fr_280px]">
        <aside className="rounded-xl border">
          {INSTRUMENTS.map((i) => {
            const qq = quote(i.symbol, now);
            return (
              <Button variant="ghost" key={i.symbol} onClick={() => { setSymbol(i.symbol); setSl(""); setTp(""); }} className={`flex h-12 w-full justify-between rounded-none border-b px-4 py-3 text-left text-sm last:border-0 ${symbol === i.symbol ? "bg-primary/15" : "hover:bg-muted"}`}>
                <span className="font-semibold">{i.symbol}</span>
                <span className="font-mono">{fmt(i.symbol, qq.bid)}</span>
              </Button>
            );
          })}
        </aside>

        <section className="rounded-xl border p-4">
          <div className="flex items-baseline justify-between">
            <div>
              <h2 className="text-xl font-bold">{symbol}</h2>
              <p className="text-xs text-muted-foreground">{getInstrument(symbol).name} · last 10 min</p>
            </div>
            <span className="font-mono text-2xl">{fmt(symbol, q.mid)}</span>
          </div>
          <Chart symbol={symbol} now={now} positions={positions.filter((p) => p.symbol === symbol)} />
        </section>

        <section className="space-y-3 rounded-xl border p-4">
          <h3 className="font-bold">New order</h3>
          <label className="block text-xs text-muted-foreground">Volume (lots)
            <input className={input} type="number" step="0.01" min="0.01" value={lots} onChange={(e) => setLots(e.target.value)} />
          </label>
          <label className="block text-xs text-muted-foreground">Stop loss (optional)
            <input className={input} type="number" step="any" value={sl} onChange={(e) => setSl(e.target.value)} placeholder="Price" />
          </label>
          <label className="block text-xs text-muted-foreground">Take profit (optional)
            <input className={input} type="number" step="any" value={tp} onChange={(e) => setTp(e.target.value)} placeholder="Price" />
          </label>
          <p className="text-xs text-muted-foreground">Margin needed: {money(calcMargin(symbol, Number(lots) || 0, q.mid, leverage))} (1:{leverage})</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="destructive" disabled={place.isPending || readOnly} onClick={() => place.mutate("sell")} className="h-16 flex-col py-3 font-semibold">
              Sell<div className="font-mono text-xs">{fmt(symbol, q.bid)}</div>
            </Button>
            <Button disabled={place.isPending || readOnly} onClick={() => place.mutate("buy")} className="h-16 flex-col bg-accent py-3 font-semibold text-accent-foreground hover:bg-accent/90">
              Buy<div className="font-mono text-xs">{fmt(symbol, q.ask)}</div>
            </Button>
          </div>
        </section>
      </div>

      <section className="rounded-xl border">
        <h3 className="border-b px-4 py-3 font-bold">Open positions ({positions.length}) · P/L <span className={floating >= 0 ? "text-accent" : "text-destructive"}>{money(floating)}</span></h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>{["Symbol", "Type", "Lots", "Open", "Current", "SL", "TP", "P/L", ""].map((h) => <th key={h} className="px-4 py-2">{h}</th>)}</tr>
            </thead>
            <tbody>
              {positions.length === 0 && <tr><td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">No open positions</td></tr>}
              {positions.map((p) => {
                const cur = closePrice(p.symbol, p.side as Side, now);
                const pnl = calcPnl(p.symbol, p.side as Side, Number(p.lots), Number(p.open_price), cur);
                return (
                  <tr key={p.id} className="border-t">
                    <td className="px-4 py-2 font-semibold">{p.symbol}</td>
                    <td className={`px-4 py-2 ${p.side === "buy" ? "text-accent" : "text-destructive"}`}>{p.side.toUpperCase()}</td>
                    <td className="px-4 py-2">{Number(p.lots).toFixed(2)}</td>
                    <td className="px-4 py-2 font-mono">{fmt(p.symbol, Number(p.open_price))}</td>
                    <td className="px-4 py-2 font-mono">{fmt(p.symbol, cur)}</td>
                    <td className="px-4 py-2 font-mono">{p.stop_loss ? fmt(p.symbol, Number(p.stop_loss)) : "—"}</td>
                    <td className="px-4 py-2 font-mono">{p.take_profit ? fmt(p.symbol, Number(p.take_profit)) : "—"}</td>
                    <td className={`px-4 py-2 font-semibold ${pnl >= 0 ? "text-accent" : "text-destructive"}`}>{money(pnl)}</td>
                    <td className="px-4 py-2"><Button size="sm" variant="outline" disabled={shut.isPending || readOnly} onClick={() => shut.mutate(p.id)}>Close</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
