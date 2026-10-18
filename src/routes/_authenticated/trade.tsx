import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { INSTRUMENTS, fmt, history, quote, getInstrument } from "@/lib/market";
import { calcMargin, calcPnl, closePrice, type Side } from "@/lib/trading";
import { getAccount, openTrade, closeTrade } from "@/lib/trading.functions";
import { useNow } from "@/hooks/use-session";

export const Route = createFileRoute("/_authenticated/trade")({
  head: () => ({ meta: [{ title: "Trade — Vantor" }, { name: "description", content: "Vantor trading terminal." }] }),
  component: Trade,
});

export function useAccount() {
  const fn = useServerFn(getAccount);
  return useQuery({ queryKey: ["account"], queryFn: () => fn(), refetchInterval: 5000 });
}

function Chart({ symbol, now }: { symbol: string; now: number }) {
  const pts = useMemo(() => history(symbol, now), [symbol, now]);
  const ps = pts.map((x) => x.p);
  const min = Math.min(...ps), max = Math.max(...ps);
  const W = 800, H = 300;
  const d = pts.map((x, i) => `${i ? "L" : "M"}${(i / (pts.length - 1)) * W},${H - ((x.p - min) / (max - min || 1)) * (H - 20) - 10}`).join(" ");
  const up = ps[ps.length - 1]! >= ps[0]!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-72 w-full" preserveAspectRatio="none">
      <path d={`${d} L${W},${H} L0,${H} Z`} className={up ? "fill-accent/10" : "fill-destructive/10"} />
      <path d={d} fill="none" strokeWidth={2} className={up ? "stroke-accent" : "stroke-destructive"} />
    </svg>
  );
}

function Trade() {
  const now = useNow(1000);
  const qc = useQueryClient();
  const { data: acc } = useAccount();
  const [symbol, setSymbol] = useState("EURUSD");
  const [lots, setLots] = useState("0.10");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const open = useServerFn(openTrade);
  const close = useServerFn(closeTrade);

  const place = useMutation({
    mutationFn: (side: Side) =>
      open({ data: { symbol, side, lots: Number(lots), stopLoss: sl ? Number(sl) : null, takeProfit: tp ? Number(tp) : null } }),
    onSuccess: (r, side) => { toast.success(`${side === "buy" ? "Bought" : "Sold"} ${lots} ${symbol} at ${fmt(symbol, r.price)}`); qc.invalidateQueries({ queryKey: ["account"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const shut = useMutation({
    mutationFn: (id: string) => close({ data: { id } }),
    onSuccess: () => { toast.success("Position closed"); qc.invalidateQueries({ queryKey: ["account"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const positions = acc?.open ?? [];
  const floating = positions.reduce((s, p) => s + calcPnl(p.symbol, p.side as Side, Number(p.lots), Number(p.open_price), closePrice(p.symbol, p.side as Side, now)), 0);
  const used = positions.reduce((s, p) => s + calcMargin(p.symbol, Number(p.lots), Number(p.open_price)), 0);
  const balance = acc?.balance ?? 0;
  const equity = balance + floating;
  const q = quote(symbol, now);
  const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const input = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
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
              <button key={i.symbol} onClick={() => setSymbol(i.symbol)} className={`flex w-full justify-between border-b px-4 py-3 text-left text-sm last:border-0 ${symbol === i.symbol ? "bg-primary/15" : "hover:bg-muted"}`}>
                <span className="font-semibold">{i.symbol}</span>
                <span className="font-mono">{fmt(i.symbol, qq.bid)}</span>
              </button>
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
          <Chart symbol={symbol} now={now} />
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
          <p className="text-xs text-muted-foreground">Margin needed: {money(calcMargin(symbol, Number(lots) || 0, q.mid))} (1:100)</p>
          <div className="grid grid-cols-2 gap-2">
            <button disabled={place.isPending} onClick={() => place.mutate("sell")} className="rounded-md bg-destructive py-3 font-semibold text-destructive-foreground disabled:opacity-50">
              Sell<div className="font-mono text-xs">{fmt(symbol, q.bid)}</div>
            </button>
            <button disabled={place.isPending} onClick={() => place.mutate("buy")} className="rounded-md bg-accent py-3 font-semibold text-accent-foreground disabled:opacity-50">
              Buy<div className="font-mono text-xs">{fmt(symbol, q.ask)}</div>
            </button>
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
                    <td className="px-4 py-2"><button onClick={() => shut.mutate(p.id)} className="rounded border px-3 py-1 text-xs">Close</button></td>
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
