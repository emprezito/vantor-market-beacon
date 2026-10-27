import { z } from "zod";
import {
  authenticateTradingAccount,
  INVALID_LOGIN_MESSAGE,
  recordLoginFailure,
} from "@/lib/account-auth.server";
import { TRADING_SERVER_SELECT } from "@/lib/account-options";
import { loadCandles, loadQuotes } from "@/lib/market-data.server";
import { isChartInterval, isInstrument } from "@/lib/market-data";
import {
  cancelPendingOrder,
  closePosition,
  getAccountView,
  modifyPosition,
  openMarketOrder,
  placeLimitOrder,
  TRADING_ACCOUNT_SELECT,
  type TradingAccount,
} from "@/lib/trading-service.server";
import { authenticateStreamTicket, authenticateTerminalRequest, assertTrader } from "./auth";
import { accountDto, accountViewDto } from "./dto";
import { ApiError, mapError } from "./errors";
import { corsFor, json, preflight, readJson } from "./http";
import { withIdempotency } from "./idempotency";
import { terminalAdmin } from "./supabase";
import { createStreamTicket, createTerminalToken, roleFor, tokenSecret } from "./token";
import type { CorsContext, TerminalEnv } from "./types";

const PREFIX = "/api/v1/terminal";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const loginSchema = z.object({
  serverId: z.string().uuid(),
  login: z.coerce.number().int().positive(),
  password: z.string().min(1).max(256),
});

const stopPrice = z
  .number()
  .finite()
  .nullable()
  .optional()
  .transform((value) => value ?? null);

const orderSchema = z.object({
  symbol: z.string().min(1).max(32),
  side: z.enum(["buy", "sell"]),
  lots: z.number().finite().positive(),
  stopLoss: stopPrice,
  takeProfit: stopPrice,
});

const limitOrderSchema = orderSchema.extend({
  limitPrice: z.number().finite().positive(),
});

const resolveServerSchema = z.object({
  serverId: z.string().uuid(),
});

const modifySchema = z
  .object({
    stopLoss: z.number().finite().nullable().optional(),
    takeProfit: z.number().finite().nullable().optional(),
  })
  .refine((value) => value.stopLoss !== undefined || value.takeProfit !== undefined, {
    message: "Provide stopLoss or takeProfit",
  });

const streamTicketBuckets = new Map<string, number[]>();
const resolveServerBuckets = new Map<string, number[]>();
const candleBuckets = new Map<string, number[]>();

function clientIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function idParam(value: string) {
  if (!UUID_RE.test(value)) throw new ApiError(400, "invalid_id", "Invalid identifier");
  return value;
}

function parseSymbols(url: URL) {
  const raw = url.searchParams.get("symbols");
  if (!raw) throw new ApiError(400, "validation_error", "symbols is required");
  const symbols = Array.from(
    new Set(
      raw
        .split(",")
        .map((symbol) => symbol.trim())
        .filter(Boolean),
    ),
  );
  if (symbols.length === 0) throw new ApiError(400, "validation_error", "No symbols requested");
  if (symbols.length > 21)
    throw new ApiError(400, "validation_error", "Too many symbols requested");
  if (symbols.some((symbol) => !isInstrument(symbol))) {
    throw new ApiError(400, "unknown_symbol", "Unknown market symbol");
  }
  return symbols;
}

function parseCandles(url: URL) {
  const symbol = url.searchParams.get("symbol") ?? "";
  const interval = url.searchParams.get("interval") ?? "";
  if (!isInstrument(symbol)) throw new ApiError(400, "unknown_symbol", "Unknown market symbol");
  if (!isChartInterval(interval))
    throw new ApiError(400, "invalid_interval", "Invalid chart interval");
  const rawPoints = url.searchParams.get("points");
  const points = rawPoints == null ? 180 : Math.round(Number(rawPoints));
  if (!Number.isFinite(points) || points < 20 || points > 500) {
    throw new ApiError(400, "invalid_points", "points must be between 20 and 500");
  }
  return { symbol, interval, points };
}

async function loadAccount(admin: ReturnType<typeof terminalAdmin>, id: string, serverId: string) {
  const { data, error } = await admin
    .from("trading_accounts")
    .select(TRADING_ACCOUNT_SELECT)
    .eq("id", id)
    .eq("server_id", serverId)
    .maybeSingle();
  if (error)
    throw new ApiError(
      503,
      "service_unavailable",
      "Could not load your trading account. Please try again.",
    );
  if (!data)
    throw new ApiError(
      401,
      "unauthorized",
      "Your session is no longer valid. Please sign in again.",
    );
  return data as unknown as TradingAccount;
}

async function login(request: Request, env: TerminalEnv, cors: CorsContext) {
  const admin = terminalAdmin(env);
  const body = await readJson(request, loginSchema);
  let auth: Awaited<ReturnType<typeof authenticateTradingAccount>>;
  try {
    auth = await authenticateTradingAccount(admin, body.serverId, body.login, body.password);
  } catch {
    throw new ApiError(503, "service_unavailable", "Could not verify sign-in. Please try again.");
  }
  if (!auth) {
    let failure: Awaited<ReturnType<typeof recordLoginFailure>>;
    try {
      failure = await recordLoginFailure(admin, clientIp(request), body.login);
    } catch {
      throw new ApiError(503, "service_unavailable", "Could not verify sign-in. Please try again.");
    }
    if (failure.blocked) {
      throw new ApiError(
        429,
        "rate_limited",
        `Too many attempts. Try again in ${failure.retryAfterSeconds} seconds.`,
        { "retry-after": String(failure.retryAfterSeconds) },
      );
    }
    throw new ApiError(401, "invalid_credentials", INVALID_LOGIN_MESSAGE);
  }

  const account = await loadAccount(admin, auth.account.id, body.serverId);
  const role = account.access_role === "investor" ? "investor" : auth.role;
  const { token, expiresAt } = await createTerminalToken(account, role, tokenSecret(env));
  return json(cors, {
    token,
    expiresAt,
    role,
    account: accountDto(account, role),
  });
}

async function servers(env: TerminalEnv, cors: CorsContext) {
  const admin = terminalAdmin(env);
  const { data, error } = await admin
    .from("trading_servers")
    .select(TRADING_SERVER_SELECT)
    .eq("status", "active")
    .eq("visibility", "public")
    .order("sort_order")
    .order("name");
  if (error) throw new ApiError(503, "service_unavailable", "Could not load trading servers");
  return json(cors, {
    servers: (data ?? []).map((server) => ({
      id: server.id,
      name: server.name,
      currencies: (server.currencies ?? []).map(String),
      leverages: (server.leverages ?? []).map(Number).sort((left, right) => left - right),
    })),
  });
}

async function resolveServer(request: Request, env: TerminalEnv, cors: CorsContext) {
  const admin = terminalAdmin(env);
  const { account: tradingAccount } = await authenticateTerminalRequest(request, env, admin);
  checkResolveServerRate(tradingAccount.user_id ?? tradingAccount.id);
  const body = await readJson(request, resolveServerSchema);
  const { data: server, error } = await admin
    .from("trading_servers")
    .select(TRADING_SERVER_SELECT)
    .eq("id", body.serverId)
    .maybeSingle();
  if (error) throw new ApiError(503, "service_unavailable", "Could not load trading server");
  if (!server) throw new ApiError(404, "server_not_found", "Trading server not found");

  if (server.visibility !== "public") {
    if (!tradingAccount.user_id) {
      throw new ApiError(404, "server_not_found", "Trading server not found");
    }
    const { data: membership, error: membershipError } = await admin
      .from("trading_accounts")
      .select("id")
      .eq("server_id", server.id)
      .eq("user_id", tradingAccount.user_id)
      .maybeSingle();
    if (membershipError) {
      throw new ApiError(503, "service_unavailable", "Could not load trading server");
    }
    if (!membership) throw new ApiError(404, "server_not_found", "Trading server not found");
  }

  return json(cors, {
    server: {
      id: server.id,
      name: server.name,
      currencies: (server.currencies ?? []).map(String),
      leverages: (server.leverages ?? []).map(Number).sort((left, right) => left - right),
      visibility: server.visibility,
      status: server.status,
    },
  });
}

async function account(request: Request, env: TerminalEnv, cors: CorsContext) {
  const admin = terminalAdmin(env);
  const { account: tradingAccount, claims } = await authenticateTerminalRequest(
    request,
    env,
    admin,
  );
  const view = await getAccountView(admin, admin, tradingAccount);
  const role = tradingAccount.access_role === "investor" ? "investor" : claims.role;
  return json(cors, accountViewDto(view, role));
}

async function quotes(request: Request, env: TerminalEnv, cors: CorsContext) {
  const symbols = parseSymbols(new URL(request.url));
  let result;
  try {
    result = await loadQuotes(symbols);
  } catch {
    throw new ApiError(503, "service_unavailable", "Could not load market quotes");
  }
  return json(cors, {
    quotes: symbols.map((symbol) => {
      const quote = result[symbol]!;
      return {
        symbol,
        bid: quote.bid,
        ask: quote.ask,
        ts: quote.ts,
        stale: quote.source !== "live",
      };
    }),
  });
}

async function candles(request: Request, env: TerminalEnv, cors: CorsContext) {
  const admin = terminalAdmin(env);
  const { account: tradingAccount } = await authenticateTerminalRequest(request, env, admin);
  checkCandlesRate(tradingAccount.id);
  const { symbol, interval, points } = parseCandles(new URL(request.url));
  let result;
  try {
    result = await loadCandles(symbol, interval, points);
  } catch {
    throw new ApiError(503, "service_unavailable", "Could not load market candles");
  }
  return json(cors, {
    symbol: result.symbol,
    interval: result.interval,
    candles: result.candles,
    source: result.source,
    stale: result.source !== "live",
    fetchedAt: result.fetchedAt,
  });
}

function checkCandlesRate(accountId: string) {
  const now = Date.now();
  const recent = (candleBuckets.get(accountId) ?? []).filter((at) => now - at < 60_000);
  if (recent.length >= 60) {
    throw new ApiError(429, "rate_limited", "Too many candle requests", { "retry-after": "60" });
  }
  recent.push(now);
  candleBuckets.set(accountId, recent);
}

function checkStreamTicketRate(accountId: string) {
  const now = Date.now();
  const recent = (streamTicketBuckets.get(accountId) ?? []).filter((at) => now - at < 60_000);
  if (recent.length >= 10) {
    throw new ApiError(429, "rate_limited", "Too many stream ticket requests", {
      "retry-after": "60",
    });
  }
  recent.push(now);
  streamTicketBuckets.set(accountId, recent);
}

function checkResolveServerRate(accountId: string) {
  const now = Date.now();
  const recent = (resolveServerBuckets.get(accountId) ?? []).filter((at) => now - at < 60_000);
  if (recent.length >= 10) {
    throw new ApiError(429, "rate_limited", "Too many server lookup requests", {
      "retry-after": "60",
    });
  }
  recent.push(now);
  resolveServerBuckets.set(accountId, recent);
}

async function streamTicket(request: Request, env: TerminalEnv, cors: CorsContext) {
  const admin = terminalAdmin(env);
  const { account: tradingAccount } = await authenticateTerminalRequest(request, env, admin);
  checkStreamTicketRate(tradingAccount.id);
  const result = await createStreamTicket(
    tradingAccount,
    roleFor(tradingAccount),
    tokenSecret(env),
  );
  return json(cors, result);
}

async function createOrder(request: Request, env: TerminalEnv, cors: CorsContext) {
  const admin = terminalAdmin(env);
  const { account: tradingAccount, claims } = await authenticateTerminalRequest(
    request,
    env,
    admin,
  );
  assertTrader(claims, tradingAccount);
  const body = await readJson(request, orderSchema);
  const order = { ...body, stopLoss: body.stopLoss ?? null, takeProfit: body.takeProfit ?? null };
  const result = await withIdempotency(admin, tradingAccount.id, request, order, () =>
    openMarketOrder(admin, admin, tradingAccount, order),
  );
  return json(cors, {
    order: {
      positionId: result.positionId ?? null,
      ...order,
      price: result.price,
      status: "open",
    },
    balance: result.balance,
  });
}

async function createLimitOrder(request: Request, env: TerminalEnv, cors: CorsContext) {
  const admin = terminalAdmin(env);
  const { account: tradingAccount, claims } = await authenticateTerminalRequest(
    request,
    env,
    admin,
  );
  assertTrader(claims, tradingAccount);
  const body = await readJson(request, limitOrderSchema);
  const order = { ...body, stopLoss: body.stopLoss ?? null, takeProfit: body.takeProfit ?? null };
  const result = await withIdempotency(admin, tradingAccount.id, request, order, () =>
    placeLimitOrder(admin, admin, tradingAccount, order),
  );
  return json(cors, {
    order: {
      pendingOrderId: result.pendingOrderId ?? null,
      ...order,
      status: "pending",
    },
    balance: result.balance,
  });
}

async function cancelOrder(request: Request, env: TerminalEnv, cors: CorsContext, id: string) {
  const admin = terminalAdmin(env);
  const { account: tradingAccount, claims } = await authenticateTerminalRequest(
    request,
    env,
    admin,
  );
  assertTrader(claims, tradingAccount);
  const result = await withIdempotency(admin, tradingAccount.id, request, null, () =>
    cancelPendingOrder(admin, admin, tradingAccount, idParam(id)),
  );
  return json(cors, { ok: true, balance: result.balance });
}

async function close(request: Request, env: TerminalEnv, cors: CorsContext, id: string) {
  const admin = terminalAdmin(env);
  const { account: tradingAccount, claims } = await authenticateTerminalRequest(
    request,
    env,
    admin,
  );
  assertTrader(claims, tradingAccount);
  const result = await withIdempotency(admin, tradingAccount.id, request, null, () =>
    closePosition(admin, admin, tradingAccount, idParam(id)),
  );
  return json(cors, { ok: true, price: result.price, pnl: result.pnl, balance: result.balance });
}

async function modify(request: Request, env: TerminalEnv, cors: CorsContext, id: string) {
  const admin = terminalAdmin(env);
  const { account: tradingAccount, claims } = await authenticateTerminalRequest(
    request,
    env,
    admin,
  );
  assertTrader(claims, tradingAccount);
  const body = await readJson(request, modifySchema);
  const result = await withIdempotency(admin, tradingAccount.id, request, body, () =>
    modifyPosition(admin, admin, tradingAccount, idParam(id), body),
  );
  return json(cors, {
    position: {
      id: result.position.id,
      symbol: result.position.symbol,
      side: result.position.side,
      lots: Number(result.position.lots),
      openPrice: Number(result.position.open_price),
      stopLoss: result.position.stop_loss,
      takeProfit: result.position.take_profit,
    },
    balance: result.balance,
  });
}

async function stream(request: Request, env: TerminalEnv, cors: CorsContext, instance: string) {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    throw new ApiError(426, "upgrade_required", "Expected WebSocket upgrade");
  }
  const ticket = new URL(request.url).searchParams.get("ticket");
  if (!ticket) throw new ApiError(401, "unauthorized", "Missing stream ticket");
  const admin = terminalAdmin(env);
  await authenticateStreamTicket(ticket, env, admin);
  const namespace = env.MARKET_STREAM;
  if (!namespace)
    throw new ApiError(503, "service_unavailable", "Realtime streaming is not available");
  const stub = namespace.get(namespace.idFromName(instance));
  return stub.fetch(request);
}

export async function handleTerminalApi(
  request: Request,
  env: TerminalEnv,
  instance = "markets-v2",
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return null;

  let cors: CorsContext;
  try {
    cors = corsFor(request, env);
  } catch (error) {
    const api = mapError(error);
    return json(
      { origin: null, headers: {} },
      { error: api.code, message: api.message },
      api.status,
    );
  }
  if (request.method === "OPTIONS") return preflight(cors);

  try {
    const path = url.pathname.slice(PREFIX.length) || "/";
    const method = request.method;

    if (path === "/login" && method === "POST") return await login(request, env, cors);
    if (path === "/servers" && method === "GET") return await servers(env, cors);
    if (path === "/servers/resolve" && method === "POST")
      return await resolveServer(request, env, cors);
    if (path === "/stream" && method === "GET") return await stream(request, env, cors, instance);
    if (path === "/account" && method === "GET") return await account(request, env, cors);
    if (path === "/quotes" && method === "GET") return await quotes(request, env, cors);
    if (path === "/candles" && method === "GET") return await candles(request, env, cors);
    if (path === "/stream-ticket" && method === "POST")
      return await streamTicket(request, env, cors);
    if (path === "/orders" && method === "POST") return await createOrder(request, env, cors);
    if (path === "/orders/pending" && method === "POST")
      return await createLimitOrder(request, env, cors);

    const cancelMatch = /^\/orders\/pending\/([^/]+)$/.exec(path);
    if (cancelMatch && method === "DELETE")
      return await cancelOrder(request, env, cors, cancelMatch[1]!);

    const closeMatch = /^\/positions\/([^/]+)\/close$/.exec(path);
    if (closeMatch && method === "POST") return await close(request, env, cors, closeMatch[1]!);

    const positionMatch = /^\/positions\/([^/]+)$/.exec(path);
    if (positionMatch && method === "PATCH")
      return await modify(request, env, cors, positionMatch[1]!);

    return json(cors, { error: "not_found", message: "Not found" }, 404);
  } catch (error) {
    const api = mapError(error);
    return json(cors, { error: api.code, message: api.message }, api.status, api.headers);
  }
}
