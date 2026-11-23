import { useState } from "react";
import { ChevronDown } from "lucide-react";
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
      <div className="divide-y divide-border sm:hidden">
        {orders.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">No pending orders</p>
        ) : null}
        {orders.map((order) => (
          <article key={order.id} className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">{order.symbol}</span>
                  <span
                    className={`text-[10px] font-semibold ${order.side === "buy" ? "text-positive" : "text-negative"}`}
                  >
                    {order.side.toUpperCase()} LIMIT
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {new Date(order.created_at).toLocaleString()}
                </p>
              </div>
              <span className="font-mono text-sm font-semibold">
                {fmt(order.symbol, Number(order.limit_price))}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-md bg-muted/40 p-2 text-[10px]">
              <div>
                <span className="text-muted-foreground">Lots</span>
                <span className="block font-mono text-foreground">
                  {Number(order.lots).toFixed(2)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Stop loss</span>
                <span className="block font-mono text-foreground">
                  {order.stop_loss ? fmt(order.symbol, Number(order.stop_loss)) : "—"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Take profit</span>
                <span className="block font-mono text-foreground">
                  {order.take_profit ? fmt(order.symbol, Number(order.take_profit)) : "—"}
                </span>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-10 w-full"
              disabled={busy || readOnly}
              onClick={() => onCancel(order.id)}
            >
              Cancel order
            </Button>
          </article>
        ))}
      </div>
      <div className="hidden overflow-x-auto sm:block" aria-label="Pending orders table">
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
      <div className="divide-y divide-border sm:hidden">
        {positions.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">No open positions</p>
        ) : null}
        {positions.map((position) => {
          const quote = quoteFor(quotes, position.symbol, now);
          const current = closePriceFromQuote(position.side as Side, quote);
          const pnl =
            isFallbackQuote(quote) || isStaleFeedQuote(quote)
              ? 0
              : calcPnl(
                  position.symbol,
                  position.side as Side,
                  Number(position.lots),
                  Number(position.open_price),
                  current,
                ) * fxRate;
          return (
            <article key={position.id}>
              <button
                type="button"
                aria-expanded={expandedId === position.id}
                onClick={() =>
                  setExpandedId((currentId) => (currentId === position.id ? null : position.id))
                }
                className="flex min-h-16 w-full items-center justify-between gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                <span className="min-w-0">
                  <span className="block font-semibold text-foreground">{position.symbol}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    Opened {new Date(position.opened_at).toLocaleString()}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span
                    className={`font-mono text-sm font-semibold ${pnl >= 0 ? "text-positive" : "text-negative"}`}
                  >
                    {formatMoney(pnl, currency)}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform ${expandedId === position.id ? "rotate-180" : ""}`}
                  />
                </span>
              </button>
              {expandedId === position.id ? (
                <div className="space-y-3 border-t border-border/70 px-4 pb-4 pt-3">
                  <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/40 p-3 text-[10px]">
                    <div>
                      <span className="text-muted-foreground">Direction / lots</span>
                      <span
                        className={`block font-semibold ${position.side === "buy" ? "text-positive" : "text-negative"}`}
                      >
                        {position.side.toUpperCase()} {Number(position.lots).toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Entry / current</span>
                      <span className="block font-mono text-foreground">
                        {fmt(position.symbol, Number(position.open_price))} →{" "}
                        {fmt(position.symbol, current)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Stop loss</span>
                      <span className="block font-mono text-foreground">
                        {position.stop_loss
                          ? fmt(position.symbol, Number(position.stop_loss))
                          : "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Take profit</span>
                      <span className="block font-mono text-foreground">
                        {position.take_profit
                          ? fmt(position.symbol, Number(position.take_profit))
                          : "—"}
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-10 w-full"
                    disabled={busy || readOnly}
                    onClick={() => onClose(position.id)}
                  >
                    Close position
                  </Button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      <div className="hidden overflow-x-auto sm:block" aria-label="Open positions table">
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
