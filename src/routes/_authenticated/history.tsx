import { createFileRoute } from "@tanstack/react-router";
import { fmt } from "@/lib/market";
import { useAccount } from "@/hooks/use-account";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({ meta: [{ title: "Trade history — Vantor" }, { name: "description", content: "Your closed Vantor demo trades and realised profit or loss." }, { property: "og:title", content: "Trade history — Vantor" }, { property: "og:description", content: "Review your demo trading activity." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: History,
});

function History() {
  const { data, isPending, error, refetch } = useAccount();
  const rows = data?.closed ?? [];
  const total = rows.reduce((s, r) => s + Number(r.pnl ?? 0), 0);
  if (isPending) return <main className="p-6" role="status">Loading trade history…</main>;
  if (error) return <main className="space-y-4 p-6"><p role="alert">{error.message}</p><Button onClick={() => refetch()}>Retry</Button></main>;
  return (
    <main className="mx-auto max-w-7xl px-6 py-6">
      <h1 className="text-2xl font-bold">Trade history</h1>
      <p className="text-sm text-muted-foreground">Total realised P/L: <span className={total >= 0 ? "text-accent" : "text-destructive"}>${total.toFixed(2)}</span></p>
      <div className="mt-4 overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>{["Closed", "Symbol", "Type", "Lots", "Open", "Close", "Reason", "P/L"].map((h) => <th key={h} className="px-4 py-2">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">No closed trades yet</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-4 py-2">{r.closed_at ? new Date(r.closed_at).toLocaleString() : "—"}</td>
                <td className="px-4 py-2 font-semibold">{r.symbol}</td>
                <td className="px-4 py-2">{r.side.toUpperCase()}</td>
                <td className="px-4 py-2">{Number(r.lots).toFixed(2)}</td>
                <td className="px-4 py-2 font-mono">{fmt(r.symbol, Number(r.open_price))}</td>
                <td className="px-4 py-2 font-mono">{fmt(r.symbol, Number(r.close_price))}</td>
                <td className="px-4 py-2">{r.close_reason}</td>
                <td className={`px-4 py-2 font-semibold ${Number(r.pnl) >= 0 ? "text-accent" : "text-destructive"}`}>${Number(r.pnl).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
