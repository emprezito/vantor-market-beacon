import { isStaleFeedQuote, type MarketQuote } from "@/lib/market-data";
import { loadQuotes } from "@/lib/market-data.server";
import { parseMeridianQuote, parseMeridianStreamMessage } from "@/lib/meridian";
import {
  meridianProviderSymbols,
  meridianWsUrl,
  requestMeridianWsToken,
} from "@/lib/meridian.server";
import { authenticateTerminalRequest, authenticateTerminalStreamRequest } from "./auth";
import {
  BROKER_ID,
  BROKER_NAME,
  BROKER_QUOTE_STALE_MS,
  POCKET_BROKER_PROTOCOL,
  streamUrl,
} from "./broker";
import { ApiError } from "./errors";
import { json } from "./http";
import { terminalAdmin } from "./supabase";
import { createTerminalStreamTicket, tokenSecret } from "./token";
import type { CorsContext, TerminalEnv } from "./types";

const HEARTBEAT_MS = 15_000;
const PONG_TIMEOUT_MS = 5_000;
const RECONNECT_MAX_MS = 30_000;
const TICKET_RATE_LIMIT = 30;
const STREAM_RATE_LIMIT = 30;

type RuntimeWebSocket = WebSocket & {
  accept?: (options?: { allowHalfOpen?: boolean }) => void;
};

type SocketPair = { 0: RuntimeWebSocket; 1: RuntimeWebSocket };
type SocketPairConstructor = new () => SocketPair;
type UpgradeResponseInit = ResponseInit & { webSocket?: RuntimeWebSocket };

type SymbolMapping = {
  symbols: string[];
  providerByInternal: Map<string, string>;
};

const ticketBuckets = new Map<string, number[]>();
const streamBuckets = new Map<string, number[]>();

function checkRateLimit(
  buckets: Map<string, number[]>,
  accountId: string,
  limit: number,
  message: string,
) {
  const now = Date.now();
  const recent = (buckets.get(accountId) ?? []).filter((at) => now - at < 60_000);
  if (recent.length >= limit) {
    throw new ApiError(429, "rate_limited", message, { "retry-after": "60" });
  }
  recent.push(now);
  buckets.set(accountId, recent);
}

function normalizeSymbols(values: string[]): string[] {
  return Array.from(new Set(values.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)));
}

function parseStreamSymbols(url: URL): string[] {
  const raw = url.searchParams.get("symbols");
  if (!raw) return [];
  const symbols = normalizeSymbols(raw.split(","));
  if (symbols.length === 0) throw new ApiError(400, "validation_error", "No symbols requested");
  if (symbols.length > 500)
    throw new ApiError(400, "validation_error", "Too many symbols requested");
  if (symbols.some((symbol) => !/^[A-Z0-9._-]{3,32}$/.test(symbol))) {
    throw new ApiError(400, "unknown_symbol", "Unknown market symbol");
  }
  return symbols;
}

async function resolveSymbols(symbols: string[]): Promise<SymbolMapping> {
  if (symbols.length === 0) return { symbols: [], providerByInternal: new Map() };
  let subscriptions: Map<string, string>;
  try {
    subscriptions = await meridianProviderSymbols(symbols);
  } catch {
    throw new ApiError(503, "stream_unavailable", "Broker market data is unavailable");
  }
  const supported = symbols.filter((symbol) => subscriptions.has(symbol));
  if (supported.length !== symbols.length) {
    throw new ApiError(400, "unknown_symbol", "Unknown market symbol");
  }
  return {
    symbols: supported,
    providerByInternal: new Map(
      supported.map((symbol) => [symbol, subscriptions.get(symbol)!] as const),
    ),
  };
}

function isStaleQuote(quote: MarketQuote): boolean {
  return quote.source !== "live" || isStaleFeedQuote(quote) || quote.feedFallback === true;
}

function quoteFrame(symbol: string, quote: MarketQuote, seq: number) {
  return {
    symbol,
    bid: quote.bid,
    ask: quote.ask,
    ts: quote.ts,
    stale: isStaleQuote(quote),
    seq,
    ...(quote.feedFallback ? { unavailable: true } : {}),
  };
}

function send(socket: RuntimeWebSocket, frame: unknown): boolean {
  if (socket.readyState !== 1) return false;
  try {
    socket.send(JSON.stringify(frame));
    return true;
  } catch {
    return false;
  }
}

function pairConstructor(): SocketPairConstructor | null {
  const value = (globalThis as unknown as { WebSocketPair?: SocketPairConstructor }).WebSocketPair;
  return typeof value === "function" ? value : null;
}

class BrokerStreamSession {
  private readonly server: RuntimeWebSocket;
  private readonly accountId: string;
  private readonly serverId: string;
  private desired: Set<string>;
  private providerByInternal: Map<string, string>;
  private lastQuoteTs = new Map<string, number>();
  private upstream: RuntimeWebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private tokenTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private staleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTickAt = 0;
  private attempt = 0;
  private seq = 0;
  private status = "idle";
  private closed = false;
  private connecting = false;

  constructor(
    server: RuntimeWebSocket,
    accountId: string,
    serverId: string,
    mapping: SymbolMapping,
  ) {
    this.server = server;
    this.accountId = accountId;
    this.serverId = serverId;
    this.desired = new Set(mapping.symbols);
    this.providerByInternal = mapping.providerByInternal;
  }

  start() {
    this.server.addEventListener("message", (event) => {
      void this.handleClientMessage(event);
    });
    this.server.addEventListener("close", () => this.close());
    this.server.addEventListener("error", () => this.close());

    this.sendFrame({
      type: "welcome",
      broker: BROKER_ID,
      protocol: POCKET_BROKER_PROTOCOL,
      accountId: this.accountId,
      serverTime: Date.now(),
      staleAfterMs: BROKER_QUOTE_STALE_MS,
      symbols: [...this.desired],
    });
    void this.sendSnapshot();
    void this.connectUpstream();
  }

  private sendFrame(frame: unknown) {
    send(this.server, frame);
  }

  private setStatus(state: string) {
    if (this.status === state) return;
    this.status = state;
    this.sendFrame({ type: "status", state, at: Date.now() });
  }

  private markTick() {
    this.lastTickAt = Date.now();
    this.setStatus("live");
    this.armStaleTimer();
  }

  private armStaleTimer() {
    if (this.staleTimer) return;
    const delay = Math.max(0, this.lastTickAt + BROKER_QUOTE_STALE_MS + 50 - Date.now());
    this.staleTimer = setTimeout(() => {
      this.staleTimer = null;
      if (this.closed || this.status !== "live") return;
      if (Date.now() - this.lastTickAt < BROKER_QUOTE_STALE_MS) {
        this.armStaleTimer();
        return;
      }
      this.setStatus("stale");
    }, delay);
  }

  private snapshotFrames(quotes: Record<string, MarketQuote | undefined>, symbols: string[]) {
    return symbols.flatMap((symbol) => {
      const quote = quotes[symbol];
      if (!quote) return [];
      if (quote.ts <= (this.lastQuoteTs.get(symbol) ?? 0)) return [];
      this.lastQuoteTs.set(symbol, quote.ts);
      return [quoteFrame(symbol, quote, ++this.seq)];
    });
  }

  private async sendSnapshot() {
    if (this.desired.size === 0) return;
    try {
      const quotes = await loadQuotes([...this.desired], { serverId: this.serverId });
      if (this.closed) return;
      const snapshot = this.snapshotFrames(quotes, [...this.desired]);
      this.sendFrame({ type: "snapshot", at: Date.now(), quotes: snapshot });
    } catch {
      if (!this.closed) this.setStatus("stale");
    }
  }

  private async connectUpstream() {
    if (this.closed || this.connecting) return;
    this.connecting = true;
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");

    try {
      const token = await requestMeridianWsToken();
      if (this.closed) return;
      const endpoint = new URL(meridianWsUrl());
      endpoint.searchParams.set("token", token.token);
      const socket = new WebSocket(endpoint.toString()) as RuntimeWebSocket;
      this.upstream = socket;
      this.bindUpstream(socket);

      const expiresAt =
        token.expires_at > 10_000_000_000 ? token.expires_at : token.expires_at * 1_000;
      const refreshIn = Math.max(1_000, expiresAt - Date.now() - 5_000);
      this.tokenTimer = setTimeout(() => {
        if (this.upstream === socket) {
          try {
            socket.close(1000, "stream token refresh");
          } catch {
            return;
          }
        }
      }, refreshIn);
    } catch {
      if (this.closed) return;
      this.setStatus("reconnecting");
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  private bindUpstream(socket: RuntimeWebSocket) {
    socket.addEventListener("message", (event) => {
      this.handleUpstreamMessage(socket, event);
    });
    socket.addEventListener("close", () => {
      this.handleUpstreamClose(socket);
    });
    socket.addEventListener("error", () => {
      this.handleUpstreamClose(socket);
      try {
        socket.close();
      } catch {
        return;
      }
    });
  }

  private startHeartbeat(socket: RuntimeWebSocket) {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      if (this.closed || this.upstream !== socket) return;
      if (!send(socket, { action: "ping" })) {
        this.handleUpstreamClose(socket);
        return;
      }
      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = setTimeout(() => {
        if (this.closed || this.upstream !== socket) return;
        try {
          socket.close();
        } catch {
          return;
        }
      }, PONG_TIMEOUT_MS);
    }, HEARTBEAT_MS);
  }

  private clearUpstreamTimers() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    if (this.tokenTimer) clearTimeout(this.tokenTimer);
    if (this.staleTimer) clearTimeout(this.staleTimer);
    this.heartbeat = null;
    this.pongTimer = null;
    this.tokenTimer = null;
    this.staleTimer = null;
  }

  private handleUpstreamMessage(socket: RuntimeWebSocket, event: MessageEvent) {
    if (this.closed || this.upstream !== socket || typeof event.data !== "string") return;
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return;
    }
    const message = parseMeridianStreamMessage(parsed);
    if (!message) return;

    if (message.event === "connected") {
      this.startHeartbeat(socket);
      if (this.providerByInternal.size === 0) {
        this.attempt = 0;
        this.setStatus("live");
      } else {
        this.sendUpstreamSubscription(socket, "subscribe", [...this.providerByInternal.values()]);
      }
      return;
    }
    if (message.event === "subscribed") {
      this.attempt = 0;
      this.markTick();
      return;
    }
    if (message.event === "pong") {
      return;
    }
    if (message.event === "error") {
      const data =
        typeof message.data === "object" && message.data !== null
          ? (message.data as Record<string, unknown>)
          : {};
      const denied = data["code"] === "symbol_not_entitled";
      this.sendFrame({
        type: "error",
        code: denied ? "symbol_not_available" : "stream_error",
        message: denied
          ? "One or more symbols are not available from this broker"
          : "Broker stream error",
      });
      this.setStatus(denied ? "error" : "reconnecting");
      return;
    }
    if (message.event !== "tick") return;

    const tick = parseMeridianQuote(message.data);
    if (!tick) return;
    const internal = this.providerByInternal.get(tick.symbol);
    if (!internal) return;
    const timestamp = tick.timestamp_ms ?? Date.now();
    if (timestamp > (this.lastQuoteTs.get(internal) ?? 0)) {
      this.lastQuoteTs.set(internal, timestamp);
    }
    this.sendFrame({
      type: "tick",
      ...quoteFrame(
        internal,
        {
          symbol: internal,
          bid: tick.bid,
          ask: tick.ask,
          mid: (tick.bid + tick.ask) / 2,
          ts: timestamp,
          source: "live",
          feed: "meridian",
        },
        ++this.seq,
      ),
    });
    this.markTick();
  }

  private sendUpstreamSubscription(
    socket: RuntimeWebSocket,
    action: "subscribe" | "unsubscribe",
    symbols: string[],
  ) {
    if (symbols.length === 0) return;
    send(socket, { action, symbols, channels: ["tick"] });
  }

  private handleUpstreamClose(socket: RuntimeWebSocket) {
    if (this.upstream !== socket) return;
    this.upstream = null;
    this.clearUpstreamTimers();
    if (this.closed) return;
    this.setStatus("reconnecting");
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.closed || this.retryTimer) return;
    const base = Math.min(RECONNECT_MAX_MS, 1_000 * 2 ** this.attempt);
    const delay = base + Math.random() * base * 0.35;
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connectUpstream();
    }, delay);
  }

  private async handleClientMessage(event: MessageEvent) {
    if (this.closed || typeof event.data !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      this.sendFrame({ type: "error", code: "invalid_message", message: "Invalid JSON message" });
      return;
    }
    if (typeof parsed !== "object" || parsed === null) {
      this.sendFrame({ type: "error", code: "invalid_message", message: "Invalid message" });
      return;
    }
    const frame = parsed as Record<string, unknown>;
    const action = frame["action"];
    if (action === "ping") {
      this.sendFrame({ type: "pong", ts: Date.now() });
      return;
    }
    if (action === "subscribe") {
      await this.updateSubscription(frame["symbols"], "subscribe");
      return;
    }
    if (action === "unsubscribe") {
      await this.updateSubscription(frame["symbols"], "unsubscribe");
      return;
    }
    this.sendFrame({ type: "error", code: "unsupported_action", message: "Unsupported action" });
  }

  private async updateSubscription(value: unknown, action: "subscribe" | "unsubscribe") {
    if (!Array.isArray(value)) {
      this.sendFrame({ type: "error", code: "invalid_symbols", message: "symbols is required" });
      return;
    }
    const symbols = normalizeSymbols(
      value.filter((symbol): symbol is string => typeof symbol === "string"),
    );
    if (symbols.length === 0) {
      this.sendFrame({ type: "error", code: "invalid_symbols", message: "No symbols requested" });
      return;
    }
    if (symbols.length > 500) {
      this.sendFrame({
        type: "error",
        code: "invalid_symbols",
        message: "Too many symbols requested",
      });
      return;
    }

    try {
      if (action === "subscribe") {
        const next = Array.from(new Set([...this.desired, ...symbols]));
        if (next.length > 500) {
          this.sendFrame({
            type: "error",
            code: "invalid_symbols",
            message: "Too many symbols requested",
          });
          return;
        }
        const mapping = await resolveSymbols(next);
        this.desired = new Set(mapping.symbols);
        this.providerByInternal = mapping.providerByInternal;
        if (this.upstream) {
          this.sendUpstreamSubscription(this.upstream, "subscribe", [
            ...mapping.providerByInternal.values(),
          ]);
        }
        this.sendFrame({ type: "subscribed", symbols: [...this.desired] });
        void this.sendSnapshotFor(symbols);
        return;
      }

      const removed = symbols.filter((symbol) => this.desired.has(symbol));
      const next = [...this.desired].filter((symbol) => !symbols.includes(symbol));
      if (next.length === 0) {
        this.sendFrame({ type: "error", code: "invalid_symbols", message: "Keep one symbol" });
        return;
      }
      const mapping = await resolveSymbols(next);
      const providerSymbols = removed
        .map((symbol) => this.providerByInternal.get(symbol))
        .filter((symbol): symbol is string => Boolean(symbol));
      this.desired = new Set(mapping.symbols);
      this.providerByInternal = mapping.providerByInternal;
      for (const symbol of removed) this.lastQuoteTs.delete(symbol);
      if (this.upstream) {
        this.sendUpstreamSubscription(this.upstream, "unsubscribe", providerSymbols);
      }
      this.sendFrame({ type: "unsubscribed", symbols: [...this.desired] });
    } catch (error) {
      const api = error instanceof ApiError ? error : null;
      this.sendFrame({
        type: "error",
        code: api?.code ?? "invalid_symbols",
        message: api?.message ?? "Could not update subscriptions",
      });
    }
  }

  private async sendSnapshotFor(symbols: string[]) {
    try {
      const quotes = await loadQuotes(symbols, { serverId: this.serverId });
      if (this.closed) return;
      const snapshot = this.snapshotFrames(quotes, symbols);
      this.sendFrame({ type: "snapshot", at: Date.now(), quotes: snapshot });
    } catch {
      return;
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.clearUpstreamTimers();
    const upstream = this.upstream;
    this.upstream = null;
    if (upstream) {
      try {
        upstream.close(1000, "client closed");
      } catch {
        // already closed
      }
    }
    try {
      this.server.close(1000, "stream closed");
    } catch {
      // already closed
    }
  }
}

export async function createStreamTicket(
  request: Request,
  env: TerminalEnv,
  cors: CorsContext,
): Promise<Response> {
  const admin = terminalAdmin(env);
  const { account, claims } = await authenticateTerminalRequest(request, env, admin);
  checkRateLimit(ticketBuckets, account.id, TICKET_RATE_LIMIT, "Too many stream tickets");

  const { ticket, expiresAt } = await createTerminalStreamTicket(
    account,
    claims.role,
    tokenSecret(env),
  );
  return json(cors, {
    ticket,
    expiresAt,
    broker: { id: BROKER_ID, name: BROKER_NAME },
    protocol: POCKET_BROKER_PROTOCOL,
    stream: {
      transport: "websocket",
      url: streamUrl(request, env, ticket),
      staleAfterMs: BROKER_QUOTE_STALE_MS,
    },
  });
}

export async function brokerStream(request: Request, env: TerminalEnv): Promise<Response> {
  if ((request.headers.get("upgrade") ?? "").toLowerCase() !== "websocket") {
    throw new ApiError(426, "upgrade_required", "WebSocket upgrade required");
  }
  const Pair = pairConstructor();
  if (!Pair) {
    throw new ApiError(503, "stream_unavailable", "Broker streaming is unavailable");
  }

  const admin = terminalAdmin(env);
  const { account } = await authenticateTerminalStreamRequest(request, env, admin);
  checkRateLimit(streamBuckets, account.id, STREAM_RATE_LIMIT, "Too many stream connections");

  const url = new URL(request.url);
  const symbols = parseStreamSymbols(url);
  const mapping = await resolveSymbols(symbols);

  const pair = new Pair();
  const client = pair[0];
  const server = pair[1];
  server.accept?.();

  const session = new BrokerStreamSession(server, account.id, account.server_id, mapping);
  session.start();

  return new Response(null, {
    status: 101,
    webSocket: client,
  } as UpgradeResponseInit as ResponseInit);
}
