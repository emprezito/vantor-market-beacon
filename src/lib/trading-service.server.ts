import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  calcMargin,
  calcPnl,
  closePriceFromQuote,
  limitHit,
  openPriceFromQuote,
  stopHit,
  type Side,
} from "./trading";
import {
  validateLimitOrder,
  validateOrder,
  type LimitOrderInput,
  type OrderInput,
} from "./trading-validation";
import { quoteFor, type QuoteMap } from "./market-data";

type AccountRow = Database["public"]["Tables"]["trading_accounts"]["Row"];
type PositionRow = Database["public"]["Tables"]["positions"]["Row"];
type PendingOrderRow = Database["public"]["Tables"]["pending_orders"]["Row"];
type TransactionRow = Database["public"]["Tables"]["transactions"]["Row"];

export type TradingAccount = Pick<
  AccountRow,
  | "id"
  | "user_id"
  | "server_id"
  | "login"
  | "nickname"
  | "label"
  | "server"
  | "currency"
  | "leverage"
  | "access_role"
  | "status"
  | "balance"
  | "session_epoch"
>;

export type TradingState = {
  account: TradingAccount;
  balance: number;
  positions: PositionRow[];
};

export type AccountSummary = {
  id: string;
  login: number;
  nickname: string;
  label: string;
  server: string;
  currency: string;
  leverage: number;
  access_role: string | null;
  status: string;
};

export type AccountView = {
  account: AccountSummary;
  balance: number;
  open: PositionRow[];
  pending: PendingOrderRow[];
  closed: PositionRow[];
  transactions: TransactionRow[];
  quotes: QuoteMap;
};

export type ModifyPositionInput = {
  stopLoss?: number | null | undefined;
  takeProfit?: number | null | undefined;
};

export const TRADING_ACCOUNT_SELECT =
  "id, user_id, server_id, login, nickname, label, server, currency, leverage, access_role, status, balance, session_epoch";

const r2 = (n: number) => Math.round(n * 100) / 100;

async function loadQuoteMap(symbols: string[]): Promise<QuoteMap> {
  const { loadQuotes } = await import("./market-data.server");
  return loadQuotes(symbols);
}

function accountSummary(account: TradingAccount): AccountSummary {
  return {
    id: account.id,
    login: account.login,
    nickname: account.nickname,
    label: account.label,
    server: account.server,
    currency: account.currency,
    leverage: Number(account.leverage),
    access_role: account.access_role,
    status: account.status,
  };
}

export async function loadAccountForUser(
  db: SupabaseClient<Database>,
  userId: string,
  accountId: string,
): Promise<TradingAccount> {
  const { data, error } = await db
    .from("trading_accounts")
    .select(TRADING_ACCOUNT_SELECT)
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Could not load your trading account. Please try again.");
  if (!data) throw new Error("Trading account not found");
  return data;
}

export async function loadAccountForServer(
  admin: SupabaseClient<Database>,
  accountId: string,
  serverId: string,
): Promise<TradingAccount> {
  const { data, error } = await admin
    .from("trading_accounts")
    .select(TRADING_ACCOUNT_SELECT)
    .eq("id", accountId)
    .eq("server_id", serverId)
    .maybeSingle();
  if (error) throw new Error("Could not load your trading account. Please try again.");
  if (!data) throw new Error("Trading account not found");
  return data;
}

export async function snapshot(
  db: SupabaseClient<Database>,
  account: TradingAccount,
): Promise<TradingState> {
  if (!account.user_id) throw new Error("Trading account not found");
  const [accountResult, positionsResult] = await Promise.all([
    db
      .from("trading_accounts")
      .select("balance, status, access_role, leverage")
      .eq("id", account.id)
      .eq("user_id", account.user_id)
      .maybeSingle(),
    db.from("positions").select("*").eq("account_id", account.id).is("closed_at", null).order("id"),
  ]);
  if (accountResult.error || positionsResult.error) {
    throw new Error("Could not load your trading account. Please try again.");
  }
  if (!accountResult.data) throw new Error("Trading account not found");
  return {
    account: { ...account, ...accountResult.data },
    balance: Number(accountResult.data.balance),
    positions: positionsResult.data ?? [],
  };
}

function exposure(state: TradingState, quotes: QuoteMap, now: number, leverage: number) {
  return state.positions.reduce(
    (result, position) => {
      const price = closePriceFromQuote(
        position.side as Side,
        quoteFor(quotes, position.symbol, now),
      );
      return {
        used:
          result.used +
          calcMargin(position.symbol, Number(position.lots), Number(position.open_price), leverage),
        floating:
          result.floating +
          calcPnl(
            position.symbol,
            position.side as Side,
            Number(position.lots),
            Number(position.open_price),
            price,
          ),
      };
    },
    { used: 0, floating: 0 },
  );
}

type ApplyResult = {
  balance?: number;
  position_id?: string;
  pending_order_id?: string;
};

async function apply(
  admin: SupabaseClient<Database>,
  account: TradingAccount,
  state: TradingState,
  action: string,
  payload: Json,
): Promise<ApplyResult> {
  if (!account.user_id) throw new Error("Trading account not found");
  const { data, error } = await admin.rpc("apply_demo_operation", {
    p_user: account.user_id,
    p_account: account.id,
    p_action: action,
    p_expected_balance: state.balance,
    p_expected_positions: state.positions.map((position) => position.id),
    p_payload: payload,
  });
  if (error) throw new Error(error.message);
  return (data ?? {}) as ApplyResult;
}

async function closeOne(
  db: SupabaseClient<Database>,
  admin: SupabaseClient<Database>,
  account: TradingAccount,
  id: string,
  reason: string,
  quotes?: QuoteMap,
) {
  const state = await snapshot(db, account);
  const position = state.positions.find((item) => item.id === id);
  if (!position) throw new Error("Position not found");
  const prices = quotes ?? (await loadQuoteMap([position.symbol]));
  const price = closePriceFromQuote(
    position.side as Side,
    quoteFor(prices, position.symbol, Date.now()),
  );
  const pnl = r2(
    calcPnl(
      position.symbol,
      position.side as Side,
      Number(position.lots),
      Number(position.open_price),
      price,
    ),
  );
  const result = await apply(admin, account, state, "close", { id, price, pnl, reason });
  return { price, pnl, balance: Number(result.balance ?? state.balance + pnl) };
}

async function fillDueLimitOrders(
  db: SupabaseClient<Database>,
  admin: SupabaseClient<Database>,
  account: TradingAccount,
) {
  const { data: orders, error } = await db
    .from("pending_orders")
    .select("*")
    .eq("account_id", account.id)
    .eq("status", "pending")
    .order("created_at");
  if (error) throw new Error("Could not load pending orders. Please try again.");
  if (!orders?.length) return;

  const initial = await snapshot(db, account);
  const quotes = await loadQuoteMap([
    ...orders.map((order) => order.symbol),
    ...initial.positions.map((position) => position.symbol),
  ]);

  for (const order of orders) {
    const now = Date.now();
    const price = Number(order.limit_price);
    if (!limitHit(order.side as Side, quoteFor(quotes, order.symbol, now), price)) continue;

    const state = await snapshot(db, account);
    const leverage = Number(state.account.leverage) || 100;
    const { used, floating } = exposure(state, quotes, now, leverage);
    const margin = calcMargin(order.symbol, Number(order.lots), price, leverage);
    if (margin > state.balance + floating - used) continue;

    await apply(admin, account, state, "fill_limit", {
      id: order.id,
      price,
      margin,
      used,
      floating,
    });
  }
}

export async function processAccount(
  db: SupabaseClient<Database>,
  admin: SupabaseClient<Database>,
  account: TradingAccount,
) {
  const initial = await snapshot(db, account);
  const now = Date.now();
  const initialQuotes = await loadQuoteMap(initial.positions.map((position) => position.symbol));
  for (const position of initial.positions) {
    const price = closePriceFromQuote(
      position.side as Side,
      quoteFor(initialQuotes, position.symbol, now),
    );
    const hit = stopHit(
      position.side as Side,
      price,
      position.stop_loss == null ? null : Number(position.stop_loss),
      position.take_profit == null ? null : Number(position.take_profit),
    );
    if (hit) {
      await closeOne(
        db,
        admin,
        account,
        position.id,
        hit === "sl" ? "Stop loss" : "Take profit",
        initialQuotes,
      );
    }
  }
  await fillDueLimitOrders(db, admin, account);
}

export async function getAccountView(
  db: SupabaseClient<Database>,
  admin: SupabaseClient<Database>,
  account: TradingAccount,
): Promise<AccountView> {
  await processAccount(db, admin, account);
  const [state, closed, transactions, pending] = await Promise.all([
    snapshot(db, account),
    db
      .from("positions")
      .select("*")
      .eq("account_id", account.id)
      .not("closed_at", "is", null)
      .order("closed_at", { ascending: false })
      .limit(100),
    db
      .from("transactions")
      .select("*")
      .eq("account_id", account.id)
      .order("created_at", { ascending: false })
      .limit(100),
    db
      .from("pending_orders")
      .select("*")
      .eq("account_id", account.id)
      .eq("status", "pending")
      .order("created_at"),
  ]);
  if (closed.error || transactions.error || pending.error) {
    throw new Error("Could not load account activity. Please try again.");
  }
  const quotes = await loadQuoteMap([
    ...state.positions.map((position) => position.symbol),
    ...(pending.data ?? []).map((order) => order.symbol),
  ]);
  return {
    account: accountSummary(state.account),
    balance: state.balance,
    open: state.positions,
    pending: pending.data ?? [],
    closed: closed.data ?? [],
    transactions: transactions.data ?? [],
    quotes,
  };
}

async function requireTradable(
  db: SupabaseClient<Database>,
  account: TradingAccount,
): Promise<TradingState> {
  const state = await snapshot(db, account);
  if (state.account.status !== "active") throw new Error("This trading account is disabled");
  if (state.account.access_role === "investor") {
    throw new Error("This is an investor (read-only) account");
  }
  return state;
}

export async function openMarketOrder(
  db: SupabaseClient<Database>,
  admin: SupabaseClient<Database>,
  account: TradingAccount,
  input: OrderInput,
) {
  const order = validateOrder(input);
  const state = await requireTradable(db, account);
  const now = Date.now();
  const quotes = await loadQuoteMap([
    order.symbol,
    ...state.positions.map((position) => position.symbol),
  ]);
  const quote = quoteFor(quotes, order.symbol, now);
  const price = openPriceFromQuote(order.side, quote);
  const exitPrice = closePriceFromQuote(order.side, quote);
  if (order.stopLoss != null && stopHit(order.side, exitPrice, order.stopLoss, null)) {
    throw new Error("Stop loss is on the wrong side of the price");
  }
  if (order.takeProfit != null && stopHit(order.side, exitPrice, null, order.takeProfit)) {
    throw new Error("Take profit is on the wrong side of the price");
  }
  const leverage = Number(state.account.leverage) || 100;
  const { used, floating } = exposure(state, quotes, now, leverage);
  const margin = calcMargin(order.symbol, order.lots, price, leverage);
  if (margin > state.balance + floating - used) throw new Error("Not enough free margin");
  const result = await apply(admin, account, state, "open", {
    ...order,
    price,
    margin,
    used,
    floating,
  });
  return {
    price,
    positionId: result.position_id,
    balance: Number(result.balance ?? state.balance),
  };
}

export async function placeLimitOrder(
  db: SupabaseClient<Database>,
  admin: SupabaseClient<Database>,
  account: TradingAccount,
  input: LimitOrderInput,
) {
  const order = validateLimitOrder(input);
  const state = await requireTradable(db, account);
  const now = Date.now();
  const quote = quoteFor(await loadQuoteMap([order.symbol]), order.symbol, now);
  if (order.side === "buy" && order.limitPrice >= quote.ask) {
    throw new Error("Buy limit price must be below the current ask");
  }
  if (order.side === "sell" && order.limitPrice <= quote.bid) {
    throw new Error("Sell limit price must be above the current bid");
  }
  if (order.stopLoss != null && stopHit(order.side, order.limitPrice, order.stopLoss, null)) {
    throw new Error("Stop loss is on the wrong side of the limit price");
  }
  if (order.takeProfit != null && stopHit(order.side, order.limitPrice, null, order.takeProfit)) {
    throw new Error("Take profit is on the wrong side of the limit price");
  }
  const result = await apply(admin, account, state, "place_limit", { ...order });
  return {
    pendingOrderId: result.pending_order_id,
    balance: Number(result.balance ?? state.balance),
  };
}

export async function cancelPendingOrder(
  db: SupabaseClient<Database>,
  admin: SupabaseClient<Database>,
  account: TradingAccount,
  id: string,
) {
  const state = await requireTradable(db, account);
  const result = await apply(admin, account, state, "cancel_limit", { id });
  return { balance: Number(result.balance ?? state.balance) };
}

export async function closePosition(
  db: SupabaseClient<Database>,
  admin: SupabaseClient<Database>,
  account: TradingAccount,
  id: string,
) {
  await requireTradable(db, account);
  return closeOne(db, admin, account, id, "Manual");
}

export async function modifyPosition(
  db: SupabaseClient<Database>,
  admin: SupabaseClient<Database>,
  account: TradingAccount,
  id: string,
  input: ModifyPositionInput,
) {
  const state = await requireTradable(db, account);
  const position = state.positions.find((item) => item.id === id);
  if (!position) throw new Error("Position not found");

  const stopLoss =
    input.stopLoss === undefined
      ? position.stop_loss == null
        ? null
        : Number(position.stop_loss)
      : input.stopLoss;
  const takeProfit =
    input.takeProfit === undefined
      ? position.take_profit == null
        ? null
        : Number(position.take_profit)
      : input.takeProfit;

  for (const value of [stopLoss, takeProfit]) {
    if (value != null && (!Number.isFinite(value) || value <= 0)) {
      throw new Error("Stop prices must be positive, finite numbers");
    }
  }

  const quote = quoteFor(await loadQuoteMap([position.symbol]), position.symbol, Date.now());
  const exitPrice = closePriceFromQuote(position.side as Side, quote);
  if (stopLoss != null && stopHit(position.side as Side, exitPrice, stopLoss, null)) {
    throw new Error("Stop loss is on the wrong side of the price");
  }
  if (takeProfit != null && stopHit(position.side as Side, exitPrice, null, takeProfit)) {
    throw new Error("Take profit is on the wrong side of the price");
  }

  const result = await apply(admin, account, state, "modify", {
    id,
    stopLoss,
    takeProfit,
  });
  return {
    position: {
      ...position,
      stop_loss: stopLoss,
      take_profit: takeProfit,
    },
    balance: Number(result.balance ?? state.balance),
  };
}

export async function moveFunds(
  db: SupabaseClient<Database>,
  admin: SupabaseClient<Database>,
  account: TradingAccount,
  kind: "deposit" | "withdraw",
  amount: number,
) {
  const state = await requireTradable(db, account);
  const now = Date.now();
  const quotes = await loadQuoteMap(state.positions.map((position) => position.symbol));
  const { used, floating } = exposure(state, quotes, now, Number(state.account.leverage) || 100);
  if (kind === "withdraw" && amount > Math.min(state.balance, state.balance + floating - used)) {
    throw new Error("You can't withdraw money used as margin or more than your available funds");
  }
  await apply(admin, account, state, kind, { amount, used, floating });
  return {
    balance: r2(state.balance + (kind === "deposit" ? amount : -amount)),
  };
}
