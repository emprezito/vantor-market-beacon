import type { Database } from "@/integrations/supabase/types";
import { quoteFor, type QuoteMap } from "@/lib/market-data";
import { calcMargin, calcPnl, closePriceFromQuote, type Side } from "@/lib/trading";
import type { AccountView, AccountSummary, TradingAccount } from "@/lib/trading-service.server";

type PositionRow = Database["public"]["Tables"]["positions"]["Row"];
type PendingOrderRow = Database["public"]["Tables"]["pending_orders"]["Row"];
type TransactionRow = Database["public"]["Tables"]["transactions"]["Row"];

type Role = "trader" | "investor";

const r2 = (value: number) => Math.round(value * 100) / 100;

export function accountDto(account: AccountSummary | TradingAccount, role?: Role) {
  return {
    id: account.id,
    login: account.login,
    nickname: account.nickname,
    label: account.label,
    server: account.server,
    currency: account.currency,
    leverage: Number(account.leverage),
    role: role ?? (account.access_role === "investor" ? "investor" : "trader"),
    status: account.status,
  };
}

export function positionDto(position: PositionRow, quotes: QuoteMap) {
  const price = closePriceFromQuote(
    position.side as Side,
    quoteFor(quotes, position.symbol, Date.now()),
  );
  return {
    id: position.id,
    symbol: position.symbol,
    side: position.side,
    lots: Number(position.lots),
    openPrice: Number(position.open_price),
    currentPrice: price,
    stopLoss: position.stop_loss == null ? null : Number(position.stop_loss),
    takeProfit: position.take_profit == null ? null : Number(position.take_profit),
    pnl: r2(
      calcPnl(
        position.symbol,
        position.side as Side,
        Number(position.lots),
        Number(position.open_price),
        price,
      ),
    ),
    openedAt: position.opened_at,
  };
}

export function pendingOrderDto(order: PendingOrderRow) {
  return {
    id: order.id,
    symbol: order.symbol,
    side: order.side,
    lots: Number(order.lots),
    limitPrice: Number(order.limit_price),
    stopLoss: order.stop_loss == null ? null : Number(order.stop_loss),
    takeProfit: order.take_profit == null ? null : Number(order.take_profit),
    status: order.status,
    createdAt: order.created_at,
  };
}

export function closedPositionDto(position: PositionRow) {
  return {
    id: position.id,
    symbol: position.symbol,
    side: position.side,
    lots: Number(position.lots),
    openPrice: Number(position.open_price),
    closePrice: position.close_price == null ? null : Number(position.close_price),
    stopLoss: position.stop_loss == null ? null : Number(position.stop_loss),
    takeProfit: position.take_profit == null ? null : Number(position.take_profit),
    pnl: position.pnl == null ? null : Number(position.pnl),
    closeReason: position.close_reason,
    openedAt: position.opened_at,
    closedAt: position.closed_at,
  };
}

export function transactionDto(transaction: TransactionRow) {
  return {
    id: transaction.id,
    kind: transaction.kind,
    amount: Number(transaction.amount),
    createdAt: transaction.created_at,
  };
}

function history(view: AccountView) {
  const events = [
    ...view.transactions.map((transaction) => ({
      type: "transaction" as const,
      ...transactionDto(transaction),
    })),
    ...view.closed.map((position) => ({
      type: "position" as const,
      ...closedPositionDto(position),
    })),
  ];
  return events
    .sort((left, right) => {
      const leftAt = "closedAt" in left ? left.closedAt : left.createdAt;
      const rightAt = "closedAt" in right ? right.closedAt : right.createdAt;
      return Date.parse(rightAt ?? "") - Date.parse(leftAt ?? "");
    })
    .slice(0, 100);
}

export function accountViewDto(view: AccountView, role?: Role) {
  const leverage = Number(view.account.leverage) || 100;
  let marginUsed = 0;
  let floating = 0;
  for (const position of view.open) {
    const price = closePriceFromQuote(
      position.side as Side,
      quoteFor(view.quotes, position.symbol, Date.now()),
    );
    marginUsed += calcMargin(
      position.symbol,
      Number(position.lots),
      Number(position.open_price),
      leverage,
    );
    floating += calcPnl(
      position.symbol,
      position.side as Side,
      Number(position.lots),
      Number(position.open_price),
      price,
    );
  }
  const equity = r2(view.balance + floating);
  return {
    account: accountDto(view.account, role),
    balance: r2(view.balance),
    equity,
    marginUsed: r2(marginUsed),
    freeMargin: r2(equity - marginUsed),
    openPositions: view.open.map((position) => positionDto(position, view.quotes)),
    pendingOrders: view.pending.map(pendingOrderDto),
    recentHistory: history(view),
  };
}
