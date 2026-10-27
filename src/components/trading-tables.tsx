import type { Tables } from "@/integrations/supabase/types";
import { fmt } from "@/lib/market";
import { quoteFor, type QuoteMap } from "@/lib/market-data";
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
    <section className="rounded-xl border">
      <h3 className="border-b px-4 py-3 font-bold">Pending orders ({orders.length})</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              {["Symbol", "Type", "Lots", "Limit", "SL", "TP", "Placed", ""].map((h) => (
                <th key={h} className="px-4 py-2">
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
              <tr key={o.id} className="border-t">
                <td className="px-4 py-2 font-semibold">{o.symbol}</td>
                <td
                  className={`px-4 py-2 ${o.side === "buy" ? "text-accent" : "text-destructive"}`}
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
    const price = closePriceFromQuote(p.side as Side, quoteFor(quotes, p.symbol, now));
    return (
      sum + calcPnl(p.symbol, p.side as Side, Number(p.lots), Number(p.open_price), price) * fxRate
    );
  }, 0);
  return (
    <section className="rounded-xl border">
      <h3 className="border-b px-4 py-3 font-bold">
        Open positions ({positions.length}) · P/L{" "}
        <span className={floating >= 0 ? "text-accent" : "text-destructive"}>
          {formatMoney(floating, currency)}
        </span>
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              {["Symbol", "Type", "Lots", "Open", "Current", "SL", "TP", "P/L", ""].map((h) => (
                <th key={h} className="px-4 py-2">
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
              const cur = closePriceFromQuote(p.side as Side, quoteFor(quotes, p.symbol, now));
              const pnl =
                calcPnl(p.symbol, p.side as Side, Number(p.lots), Number(p.open_price), cur) *
                fxRate;
              return (
                <tr key={p.id} className="border-t">
                  <td className="px-4 py-2 font-semibold">{p.symbol}</td>
                  <td
                    className={`px-4 py-2 ${p.side === "buy" ? "text-accent" : "text-destructive"}`}
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
                    className={`px-4 py-2 font-semibold ${pnl >= 0 ? "text-accent" : "text-destructive"}`}
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
