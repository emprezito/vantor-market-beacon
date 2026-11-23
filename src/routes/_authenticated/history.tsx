import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { fmt } from "@/lib/market";
import { useAccount } from "@/hooks/use-account";
import { formatMoney } from "@/lib/account-options";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({
    meta: [
      { title: "Trade history — Vantor" },
      { name: "description", content: "Your closed Vantor trades and realised profit or loss." },
      { property: "og:title", content: "Trade history — Vantor" },
      { property: "og:description", content: "Review your trading activity." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: History,
});

function History() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data, activeAccount, isPending, error, refetch } = useAccount();
  const navigate = useNavigate();
  const rows = data?.closed ?? [];
  const total = rows.reduce((s, r) => s + Number(r.pnl ?? 0), 0);
  if (isPending)
    return (
      <main className="px-4 py-6 sm:px-6" role="status">
        Loading trade history…
      </main>
    );
  if (error)
    return (
      <main className="space-y-4 px-4 py-6 sm:px-6">
        <p role="alert">{error.message}</p>
        <Button onClick={() => refetch()}>Retry</Button>
      </main>
    );
  if (!activeAccount) {
    return (
      <main className="space-y-4 px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-bold">Trade history</h1>
        <p>Open a trading account to review its trade history.</p>
        <Button onClick={() => navigate({ to: "/accounts" })}>Open an account</Button>
      </main>
    );
  }
  const currency = activeAccount.currency;
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-bold">
        Trade history{" "}
        <span className="block text-sm font-normal text-muted-foreground sm:inline">
          · {activeAccount.nickname} · #{activeAccount.login}
        </span>
      </h1>
      <p className="text-sm text-muted-foreground">
        Total realised P/L:{" "}
        <span className={total >= 0 ? "text-positive" : "text-negative"}>
          {formatMoney(total, currency)}
        </span>
      </p>
      <div className="mt-4 overflow-hidden rounded-md border border-border bg-card sm:hidden">
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No closed trades yet
          </p>
        ) : null}
        <div className="divide-y divide-border">
          {rows.map((row) => (
            <article key={row.id}>
              <button
                type="button"
                aria-expanded={expandedId === row.id}
                onClick={() => setExpandedId((currentId) => (currentId === row.id ? null : row.id))}
                className="flex min-h-20 w-full items-center justify-between gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                <span className="min-w-0">
                  <span className="block font-semibold text-foreground">{row.symbol}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    Opened {new Date(row.opened_at).toLocaleString()}
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    Closed {row.closed_at ? new Date(row.closed_at).toLocaleString() : "—"}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span
                    className={`font-mono text-sm font-semibold ${Number(row.pnl) >= 0 ? "text-positive" : "text-negative"}`}
                  >
                    {formatMoney(Number(row.pnl), currency)}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform ${expandedId === row.id ? "rotate-180" : ""}`}
                  />
                </span>
              </button>
              {expandedId === row.id ? (
                <div className="border-t border-border/70 px-4 pb-4 pt-3">
                  <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/40 p-3 text-[10px]">
                    <div>
                      <span className="text-muted-foreground">Direction / lots</span>
                      <span
                        className={`block font-semibold ${row.side === "buy" ? "text-positive" : "text-negative"}`}
                      >
                        {row.side.toUpperCase()} {Number(row.lots).toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Reason</span>
                      <span className="block text-foreground">{row.close_reason}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Open price</span>
                      <span className="block font-mono text-foreground">
                        {fmt(row.symbol, Number(row.open_price))}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Close price</span>
                      <span className="block font-mono text-foreground">
                        {fmt(row.symbol, Number(row.close_price))}
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </div>
      <div className="mt-4 hidden overflow-x-auto rounded-xl border sm:block">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              {["Closed", "Symbol", "Type", "Lots", "Open", "Close", "Reason", "P/L"].map((h) => (
                <th key={h} className="px-4 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">
                  No closed trades yet
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-4 py-2">
                  {r.closed_at ? new Date(r.closed_at).toLocaleString() : "—"}
                </td>
                <td className="px-4 py-2 font-semibold">{r.symbol}</td>
                <td className="px-4 py-2">{r.side.toUpperCase()}</td>
                <td className="px-4 py-2">{Number(r.lots).toFixed(2)}</td>
                <td className="px-4 py-2 font-mono">{fmt(r.symbol, Number(r.open_price))}</td>
                <td className="px-4 py-2 font-mono">{fmt(r.symbol, Number(r.close_price))}</td>
                <td className="px-4 py-2">{r.close_reason}</td>
                <td
                  className={`px-4 py-2 font-semibold ${Number(r.pnl) >= 0 ? "text-positive" : "text-negative"}`}
                >
                  {formatMoney(Number(r.pnl), currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
