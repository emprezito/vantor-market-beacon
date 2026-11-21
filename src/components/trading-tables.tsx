import type { Tables } from "@/integrations/supabase/types";
import { fmt } from "@/lib/market";
import { isFallbackQuote, isStaleFeedQuote, quoteFor, type QuoteMap } from "@/lib/market-data";
import { calcPnl, closePriceFromQuote, type Side } from "@/lib/trading";
import { formatMoney } from "@/lib/account-options";
import { Button } from "@/components/ui/button";

type Position = Tables<"positions">;
type PendingOrder = Tables<"pending_orders">;

export function PendingOrdersSection({
  orders,
  readOnly,
  busy,
  onCancel,
}: {
  orders: PendingOrder[];
  readOnly: boolean;
  busy: boolean;
  onCancel: (id: string) => void;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Pending orders</h3>
        <span className="rounded bg-warning/10 px-2 py-0.5 font-mono text-[10px] text-warning">
          {orders.length}
        </span>
      </div>
      <div className="overflow-x-auto" aria-label="Pending orders table">
        <table className="w-full min-w-[760px] text-xs">
          <thead className="bg-muted/40 text-left text-[10px] font-medium text-muted-foreground">
            <tr>
              {["Symbol", "Type", "Lots", "Limit", "SL", "TP", "Placed", ""].map((h) => (
                <th key={h} className="whitespace-nowrap px-4 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">
                  No pending orders
                </td>
              </tr>
            )}
            {orders.map((o) => (
              <tr
                key={o.id}
                className="border-t border-border/70 transition-colors hover:bg-accent/40"
              >
                <td className="px-4 py-2 font-semibold">{o.symbol}</td>
                <td
                  className={`px-4 py-2 font-semibold ${o.side === "buy" ? "text-positive" : "text-negative"}`}
                >
                  {o.side.toUpperCase()} LIMIT
                </td>
                <td className="px-4 py-2">{Number(o.lots).toFixed(2)}</td>
                <td className="px-4 py-2 font-mono">{fmt(o.symbol, Number(o.limit_price))}</td>
                <td className="px-4 py-2 font-mono">
                  {o.stop_loss ? fmt(o.symbol, Number(o.stop_loss)) : "—"}
                </td>
                <td className="px-4 py-2 font-mono">
                  {o.take_profit ? fmt(o.symbol, Number(o.take_profit)) : "—"}
                </td>
                <td className="px-4 py-2 text-xs">{new Date(o.created_at).toLocaleString()}</td>
                <td className="px-4 py-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || readOnly}
                    onClick={() => onCancel(o.id)}
                  >
                    Cancel
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function OpenPositionsSection({
  positions,
  currency,
  fxRate,
  now,
  quotes,
  readOnly,
  busy,
  onClose,
}: {
  positions: Position[];
  currency: string;
  fxRate: number;
  now: number;
  quotes?: QuoteMap;
  readOnly: boolean;
  busy: boolean;
  onClose: (id: string) => void;
}) {
  const floating = positions.reduce((sum, p) => {
    const quote = quoteFor(quotes, p.symbol, now);
    if (isFallbackQuote(quote) || isStaleFeedQuote(quote)) return sum;
    const price = closePriceFromQuote(p.side as Side, quote);
    return (
      sum + calcPnl(p.symbol, p.side as Side, Number(p.lots), Number(p.open_price), price) * fxRate
    );
  }, 0);
  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Open positions</h3>
          <span className="rounded bg-accent px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            {positions.length}
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground">
          Floating P/L{" "}
          <span
            className={`font-mono text-xs font-semibold ${floating >= 0 ? "text-positive" : "text-negative"}`}
          >
            {formatMoney(floating, currency)}
          </span>
        </div>
      </div>
      <div className="overflow-x-auto" aria-label="Open positions table">
        <table className="w-full min-w-[900px] text-xs">
          <thead className="bg-muted/40 text-left text-[10px] text-muted-foreground">
            <tr>
              {["Symbol", "Type", "Lots", "Open", "Current", "SL", "TP", "P/L", ""].map((h) => (
                <th key={h} className="whitespace-nowrap px-4 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">
                  No open positions
                </td>
              </tr>
            )}
            {positions.map((p) => {
              const quote = quoteFor(quotes, p.symbol, now);
              const cur = closePriceFromQuote(p.side as Side, quote);
              const pnl =
                isFallbackQuote(quote) || isStaleFeedQuote(quote)
                  ? 0
                  : calcPnl(p.symbol, p.side as Side, Number(p.lots), Number(p.open_price), cur) *
                    fxRate;
              return (
                <tr
                  key={p.id}
                  className="border-t border-border/70 transition-colors hover:bg-accent/40"
                >
                  <td className="px-4 py-2 font-semibold">{p.symbol}</td>
                  <td
                    className={`px-4 py-2 font-semibold ${p.side === "buy" ? "text-positive" : "text-negative"}`}
                  >
                    {p.side.toUpperCase()}
                  </td>
                  <td className="px-4 py-2">{Number(p.lots).toFixed(2)}</td>
                  <td className="px-4 py-2 font-mono">{fmt(p.symbol, Number(p.open_price))}</td>
                  <td className="px-4 py-2 font-mono">{fmt(p.symbol, cur)}</td>
                  <td className="px-4 py-2 font-mono">
                    {p.stop_loss ? fmt(p.symbol, Number(p.stop_loss)) : "—"}
                  </td>
                  <td className="px-4 py-2 font-mono">
                    {p.take_profit ? fmt(p.symbol, Number(p.take_profit)) : "—"}
                  </td>
                  <td
                    className={`px-4 py-2 font-mono font-semibold ${pnl >= 0 ? "text-positive" : "text-negative"}`}
                  >
                    {formatMoney(pnl, currency)}
                  </td>
                  <td className="px-4 py-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || readOnly}
                      onClick={() => onClose(p.id)}
                    >
                      Close
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
