import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AccountView, TradingAccount } from "@/lib/trading-service.server";
import type { TerminalTokenClaims } from "@/lib/terminal-api/types";

vi.mock("@/lib/terminal-api/supabase", () => ({ terminalAdmin: vi.fn() }));
vi.mock("@/lib/account-auth.server", () => ({
  authenticateTradingAccount: vi.fn(),
  recordLoginFailure: vi.fn(),
  INVALID_LOGIN_MESSAGE: "Invalid server, login or password",
}));
vi.mock("@/lib/market-data.server", () => ({ loadQuotes: vi.fn(), loadCandles: vi.fn() }));
vi.mock("@/lib/trading-service.server", () => ({
  TRADING_ACCOUNT_SELECT:
    "id, user_id, server_id, login, nickname, label, server, currency, leverage, access_role, status, balance, session_epoch",
  getAccountView: vi.fn(),
  openMarketOrder: vi.fn(),
  placeLimitOrder: vi.fn(),
  cancelPendingOrder: vi.fn(),
  closePosition: vi.fn(),
  modifyPosition: vi.fn(),
}));
vi.mock("@/lib/terminal-api/auth", async () => {
  const { ApiError } = await import("@/lib/terminal-api/errors");
  return {
    authenticateTerminalRequest: vi.fn(),
    authenticateStreamTicket: vi.fn(),
    assertTrader: (claims: { role: string }, account?: { access_role: string | null }) => {
      if (claims.role === "investor" || account?.access_role === "investor") {
        throw new ApiError(403, "read_only_account", "This is an investor (read-only) account");
      }
    },
  };
});

import { authenticateTradingAccount, recordLoginFailure } from "@/lib/account-auth.server";
import { loadCandles, loadQuotes } from "@/lib/market-data.server";
import { authenticateStreamTicket, authenticateTerminalRequest } from "@/lib/terminal-api/auth";
import { handleTerminalApi } from "@/lib/terminal-api/router";
import { terminalAdmin } from "@/lib/terminal-api/supabase";
import {
  cancelPendingOrder,
  closePosition,
  getAccountView,
  modifyPosition,
  openMarketOrder,
  placeLimitOrder,
} from "@/lib/trading-service.server";

const serverId = "22222222-2222-4222-8222-222222222222";
const accountId = "11111111-1111-4111-8111-111111111111";
const userId = "44444444-4444-4444-8444-444444444444";
const positionId = "33333333-3333-4333-8333-333333333333";
const orderId = "55555555-5555-4555-8555-555555555555";
const secret = "test-terminal-secret-with-at-least-32-bytes";

const account: TradingAccount = {
  id: accountId,
  user_id: userId,
  server_id: serverId,
  login: 12345678,
  nickname: "Test",
  label: "Standard",
  server: "Demo",
  currency: "USD",
  leverage: 100,
  access_role: "trader",
  status: "active",
  balance: 10000,
  session_epoch: 0,
};

const claims: TerminalTokenClaims = {
  typ: "terminal",
  accountId,
  serverId,
  role: "trader",
  epoch: 0,
  iat: Date.now(),
  exp: Date.now() + 60_000,
};

const publicServer = {
  id: serverId,
  name: "Demo",
  currencies: ["USD"],
  leverages: [100],
  visibility: "public",
  status: "active",
};

const privateServer = {
  ...publicServer,
  id: "66666666-6666-4666-8666-666666666666",
  name: "Partner",
  visibility: "private",
};

const view: AccountView = {
  account: {
    id: accountId,
    login: 12345678,
    nickname: "Test",
    label: "Standard",
    server: "Demo",
    currency: "USD",
    leverage: 100,
    access_role: "trader",
    status: "active",
  },
  balance: 10000,
  open: [],
  pending: [],
  closed: [],
  transactions: [],
  quotes: {},
};

const env = {
  TERMINAL_TOKEN_SECRET: secret,
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

type Chain = {
  select: () => Chain;
  eq: () => Chain;
  order: () => Chain;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  insert: () => Promise<{ error: null }>;
  update: () => Chain;
  delete: () => Chain;
  lt: () => Chain;
  then: (resolve: (value: { data: unknown; error: null }) => void) => void;
};

function fakeAdmin(
  accountRow: TradingAccount | null = account,
  serverRow: Record<string, unknown> | null = null,
) {
  const servers = [{ id: serverId, name: "Demo", currencies: ["USD"], leverages: [100] }];
  return {
    from(table: string) {
      const chain: Chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        maybeSingle: async () => {
          if (table === "trading_accounts") return { data: accountRow, error: null };
          if (table === "trading_servers") return { data: serverRow, error: null };
          return { data: null, error: null };
        },
        insert: async () => ({ error: null }),
        update: () => chain,
        delete: () => chain,
        lt: () => chain,
        then: (resolve) =>
          resolve({ data: table === "trading_servers" ? servers : [], error: null }),
      };
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`https://vantor.test/api/v1/terminal${path}`, init);
}

function jsonRequest(
  path: string,
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return request(path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function body(response: Response | null) {
  return (await response?.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(terminalAdmin).mockReturnValue(fakeAdmin());
  vi.mocked(authenticateTerminalRequest).mockResolvedValue({ account, claims });
  vi.mocked(authenticateTradingAccount).mockResolvedValue({
    account: {
      id: accountId,
      server_id: serverId,
      login: 12345678,
      trader_hash: null,
      investor_hash: null,
      session_epoch: 0,
      status: "active",
    },
    role: "trader",
  });
  vi.mocked(recordLoginFailure).mockResolvedValue({ blocked: false, retryAfterSeconds: 0 });
  vi.mocked(getAccountView).mockResolvedValue(view);
  vi.mocked(loadQuotes).mockResolvedValue({
    EURUSD: { symbol: "EURUSD", bid: 1.1, ask: 1.1002, mid: 1.1001, ts: 123, source: "live" },
    BTCUSD: { symbol: "BTCUSD", bid: 60000, ask: 60010, mid: 60005, ts: 123, source: "simulated" },
  });
  vi.mocked(loadCandles).mockResolvedValue({
    symbol: "EURUSD",
    interval: "1h",
    candles: [],
    source: "simulated",
    fetchedAt: 123,
  });
  vi.mocked(openMarketOrder).mockResolvedValue({ price: 1.1, positionId, balance: 10000 });
  vi.mocked(placeLimitOrder).mockResolvedValue({ pendingOrderId: orderId, balance: 10000 });
  vi.mocked(cancelPendingOrder).mockResolvedValue({ balance: 10000 });
  vi.mocked(closePosition).mockResolvedValue({ price: 1.1, pnl: 10, balance: 10010 });
  vi.mocked(modifyPosition).mockResolvedValue({
    position: {
      id: positionId,
      symbol: "EURUSD",
      side: "buy",
      lots: 0.01,
      open_price: 1.1,
      stop_loss: 1,
      take_profit: 1.2,
    } as never,
    balance: 10000,
  });
});

describe("terminal API", () => {
  it("lists public servers without authentication", async () => {
    const response = await handleTerminalApi(request("/servers"), env);
    expect(response?.status).toBe(200);
    expect(await body(response)).toEqual({
      servers: [{ id: serverId, name: "Demo", currencies: ["USD"], leverages: [100] }],
    });
  });

  it("resolves a public server for an authenticated account", async () => {
    vi.mocked(terminalAdmin).mockReturnValue(fakeAdmin(account, publicServer));
    const response = await handleTerminalApi(
      jsonRequest("/servers/resolve", "POST", { serverId }),
      env,
    );
    expect(response?.status).toBe(200);
    expect(await body(response)).toEqual({
      server: {
        id: serverId,
        name: "Demo",
        currencies: ["USD"],
        leverages: [100],
        visibility: "public",
        status: "active",
      },
    });
  });

  it("resolves a private server for a member", async () => {
    vi.mocked(terminalAdmin).mockReturnValue(fakeAdmin(account, privateServer));
    const response = await handleTerminalApi(
      jsonRequest("/servers/resolve", "POST", { serverId: privateServer.id }),
      env,
    );
    expect(response?.status).toBe(200);
    expect((await body(response))["server"]).toMatchObject({
      id: privateServer.id,
      visibility: "private",
    });
  });

  it("hides a private server from non-members", async () => {
    vi.mocked(terminalAdmin).mockReturnValue(fakeAdmin(null, privateServer));
    const response = await handleTerminalApi(
      jsonRequest("/servers/resolve", "POST", { serverId: privateServer.id }),
      env,
    );
    expect(response?.status).toBe(404);
    expect((await body(response))["error"]).toBe("server_not_found");
  });

  it("rate limits server lookups per user", async () => {
    const rateAccount = {
      ...account,
      id: "77777777-7777-4777-8777-777777777777",
      user_id: "88888888-8888-4888-8888-888888888888",
    };
    vi.mocked(authenticateTerminalRequest).mockResolvedValue({
      account: rateAccount,
      claims: { ...claims, accountId: rateAccount.id },
    });
    vi.mocked(terminalAdmin).mockReturnValue(fakeAdmin(rateAccount, publicServer));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await handleTerminalApi(
        jsonRequest("/servers/resolve", "POST", { serverId }),
        env,
      );
      expect(response?.status).toBe(200);
    }
    const limited = await handleTerminalApi(
      jsonRequest("/servers/resolve", "POST", { serverId }),
      env,
    );
    expect(limited?.status).toBe(429);
    expect(limited?.headers.get("retry-after")).toBe("60");
  });

  it("logs in and returns a token and account without secrets", async () => {
    const response = await handleTerminalApi(
      jsonRequest("/login", "POST", { serverId, login: 12345678, password: "password" }),
      env,
    );
    expect(response?.status).toBe(200);
    const payload = await body(response);
    expect(payload["token"]).toBeTypeOf("string");
    expect(payload["role"]).toBe("trader");
    expect(payload["account"]).not.toHaveProperty("session_epoch");
    expect(payload["account"]).not.toHaveProperty("user_id");
  });

  it("issues an investor token for an investor account even with the trader password", async () => {
    vi.mocked(terminalAdmin).mockReturnValue(fakeAdmin({ ...account, access_role: "investor" }));
    const response = await handleTerminalApi(
      jsonRequest("/login", "POST", { serverId, login: 12345678, password: "password" }),
      env,
    );
    expect(response?.status).toBe(200);
    const payload = await body(response);
    expect(payload["role"]).toBe("investor");
    expect((payload["account"] as Record<string, unknown>)["role"]).toBe("investor");
  });

  it("returns the same failure for a bad login", async () => {
    vi.mocked(authenticateTradingAccount).mockResolvedValue(null);
    const response = await handleTerminalApi(
      jsonRequest("/login", "POST", { serverId, login: 12345678, password: "wrong" }),
      env,
    );
    expect(response?.status).toBe(401);
    expect(await body(response)).toEqual({
      error: "invalid_credentials",
      message: "Invalid server, login or password",
    });
  });

  it("returns 429 with Retry-After when login is rate limited", async () => {
    vi.mocked(authenticateTradingAccount).mockResolvedValue(null);
    vi.mocked(recordLoginFailure).mockResolvedValue({ blocked: true, retryAfterSeconds: 43 });
    const response = await handleTerminalApi(
      jsonRequest("/login", "POST", { serverId, login: 12345678, password: "wrong" }),
      env,
    );
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("43");
  });

  it("allows the configured CORS origin", async () => {
    const response = await handleTerminalApi(
      request("/servers", {
        method: "OPTIONS",
        headers: { origin: "https://emprezito-pocket-markets.fundedng.workers.dev" },
      }),
      env,
    );
    expect(response?.status).toBe(204);
    expect(response?.headers.get("access-control-allow-origin")).toBe(
      "https://emprezito-pocket-markets.fundedng.workers.dev",
    );
    expect(response?.headers.get("vary")).toBe("Origin");
  });

  it("rejects an unknown CORS origin", async () => {
    const response = await handleTerminalApi(
      request("/servers", { headers: { origin: "https://evil.example" } }),
      env,
    );
    expect(response?.status).toBe(403);
    expect(response?.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("only allows the dev origin when enabled", async () => {
    const blocked = await handleTerminalApi(
      request("/servers", { headers: { origin: "http://localhost:8080" } }),
      env,
    );
    expect(blocked?.status).toBe(403);
    const allowed = await handleTerminalApi(
      request("/servers", { headers: { origin: "http://localhost:8080" } }),
      { ...env, ALLOW_DEV_ORIGINS: "true" },
    );
    expect(allowed?.status).toBe(200);
  });

  it("returns account details without secret fields", async () => {
    const response = await handleTerminalApi(request("/account"), env);
    expect(response?.status).toBe(200);
    const payload = await body(response);
    expect(payload["balance"]).toBe(10000);
    expect(payload["equity"]).toBe(10000);
    expect(payload["marginUsed"]).toBe(0);
    expect(payload["freeMargin"]).toBe(10000);
    expect(payload["account"]).not.toHaveProperty("session_epoch");
    expect(payload["account"]).not.toHaveProperty("server_id");
  });

  it("returns quotes with a stale flag", async () => {
    const response = await handleTerminalApi(request("/quotes?symbols=EURUSD,BTCUSD"), env);
    expect(response?.status).toBe(200);
    expect(await body(response)).toEqual({
      quotes: [
        { symbol: "EURUSD", bid: 1.1, ask: 1.1002, ts: 123, stale: false },
        { symbol: "BTCUSD", bid: 60000, ask: 60010, ts: 123, stale: true },
      ],
    });
  });

  it("returns authenticated candles with a source and stale flag", async () => {
    const response = await handleTerminalApi(request("/candles?symbol=EURUSD&interval=1h"), env);
    expect(response?.status).toBe(200);
    expect(authenticateTerminalRequest).toHaveBeenCalled();
    expect(await body(response)).toEqual({
      symbol: "EURUSD",
      interval: "1h",
      candles: [],
      source: "simulated",
      stale: true,
      fetchedAt: 123,
    });
  });

  it("issues a short-lived stream ticket", async () => {
    const response = await handleTerminalApi(request("/stream-ticket", { method: "POST" }), env);
    expect(response?.status).toBe(200);
    const payload = await body(response);
    expect(payload["ticket"]).toBeTypeOf("string");
    expect(payload["expiresAt"]).toBeTypeOf("number");
  });

  it("requires a websocket upgrade for the stream", async () => {
    const response = await handleTerminalApi(request("/stream"), env);
    expect(response?.status).toBe(426);
  });

  it("forwards an authenticated stream to the market stream durable object", async () => {
    vi.mocked(authenticateStreamTicket).mockResolvedValue({
      account,
      claims: { ...claims, typ: "stream" },
    });
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));
    const response = await handleTerminalApi(
      request("/stream?ticket=test", { headers: { upgrade: "websocket" } }),
      {
        ...env,
        MARKET_STREAM: {
          idFromName: () => "stream-id",
          get: () => ({ fetch }),
        },
      },
    );
    expect(response?.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects every mutation for an investor", async () => {
    vi.mocked(authenticateTerminalRequest).mockResolvedValue({
      account,
      claims: { ...claims, role: "investor" },
    });
    const response = await handleTerminalApi(
      jsonRequest("/orders", "POST", {
        symbol: "EURUSD",
        side: "buy",
        lots: 0.01,
        stopLoss: null,
        takeProfit: null,
      }),
      env,
    );
    expect(response?.status).toBe(403);
    expect((await body(response))["error"]).toBe("read_only_account");
    expect(openMarketOrder).not.toHaveBeenCalled();
  });

  it("rejects mutations when the account is an investor even with a trader token", async () => {
    vi.mocked(authenticateTerminalRequest).mockResolvedValue({
      account: { ...account, access_role: "investor" },
      claims,
    });
    const response = await handleTerminalApi(
      jsonRequest("/orders", "POST", {
        symbol: "EURUSD",
        side: "buy",
        lots: 0.01,
        stopLoss: null,
        takeProfit: null,
      }),
      env,
    );
    expect(response?.status).toBe(403);
    expect((await body(response))["error"]).toBe("read_only_account");
    expect(openMarketOrder).not.toHaveBeenCalled();
  });

  it("opens a market order", async () => {
    const response = await handleTerminalApi(
      jsonRequest("/orders", "POST", {
        symbol: "EURUSD",
        side: "buy",
        lots: 0.01,
        stopLoss: null,
        takeProfit: null,
      }),
      env,
    );
    expect(response?.status).toBe(200);
    expect((await body(response))["order"]).toMatchObject({
      positionId,
      symbol: "EURUSD",
      side: "buy",
      lots: 0.01,
      price: 1.1,
      status: "open",
    });
    expect(openMarketOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      account,
      expect.objectContaining({ symbol: "EURUSD", lots: 0.01 }),
    );
  });

  it("places a limit order", async () => {
    const response = await handleTerminalApi(
      jsonRequest("/orders/pending", "POST", {
        symbol: "EURUSD",
        side: "buy",
        lots: 0.01,
        limitPrice: 1.05,
        stopLoss: 1,
        takeProfit: 1.2,
      }),
      env,
    );
    expect(response?.status).toBe(200);
    expect((await body(response))["order"]).toMatchObject({
      pendingOrderId: orderId,
      limitPrice: 1.05,
      status: "pending",
    });
  });

  it("cancels a pending order", async () => {
    const response = await handleTerminalApi(
      request(`/orders/pending/${orderId}`, { method: "DELETE" }),
      env,
    );
    expect(response?.status).toBe(200);
    expect(cancelPendingOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      account,
      orderId,
    );
  });

  it("closes a position", async () => {
    const response = await handleTerminalApi(
      request(`/positions/${positionId}/close`, { method: "POST" }),
      env,
    );
    expect(response?.status).toBe(200);
    expect(await body(response)).toEqual({ ok: true, price: 1.1, pnl: 10, balance: 10010 });
  });

  it("modifies position stops", async () => {
    const response = await handleTerminalApi(
      jsonRequest(`/positions/${positionId}`, "PATCH", { stopLoss: 1 }),
      env,
    );
    expect(response?.status).toBe(200);
    expect((await body(response))["position"]).toMatchObject({
      id: positionId,
      stopLoss: 1,
      takeProfit: 1.2,
    });
  });

  it("returns 404 for unknown endpoints", async () => {
    const response = await handleTerminalApi(request("/unknown"), env);
    expect(response?.status).toBe(404);
  });

  it("returns 400 for invalid JSON", async () => {
    const response = await handleTerminalApi(
      request("/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
      env,
    );
    expect(response?.status).toBe(400);
  });

  it("returns 413 for oversized bodies", async () => {
    const response = await handleTerminalApi(
      request("/orders", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "20000" },
        body: "{}",
      }),
      env,
    );
    expect(response?.status).toBe(413);
  });
});
