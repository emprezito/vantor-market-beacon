import { REALTIME_SYMBOLS, type RealtimeSymbol } from "./realtime-symbols";

const UPSTREAM_URL = "wss://ws.twelvedata.com/v1/quotes/price";
const SUBSCRIPTION_SYMBOLS = Object.values(REALTIME_SYMBOLS).join(",");
const MAX_CLIENTS = 100;
const HEARTBEAT_MS = 15_000;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

const CLIENT_BY_PROVIDER = new Map<string, RealtimeSymbol>(
  Object.entries(REALTIME_SYMBOLS).map(([client, provider]) => [provider, client as RealtimeSymbol]),
);

type StreamEnv = {
  TWELVE_DATA_API_KEYS?: string;
  TWELVE_DATA_API_KEY?: string;
};

type StreamStorage = {
  setAlarm: (scheduledTime: number) => Promise<void>;
  deleteAlarm: () => Promise<void>;
};

type StreamState = {
  storage: StreamStorage;
};

type AcceptedSocket = WebSocket & { accept: () => void };

type SocketPair = {
  0: AcceptedSocket;
  1: AcceptedSocket;
};

type SocketPairConstructor = new () => SocketPair;

type UpstreamPrice = {
  event?: unknown;
  symbol?: unknown;
  price?: unknown;
  timestamp?: unknown;
};

type PriceTick = {
  symbol: RealtimeSymbol;
  price: number;
  ts: number;
};

function createSocketPair(): SocketPair {
  const Pair = (globalThis as unknown as { WebSocketPair: SocketPairConstructor }).WebSocketPair;
  return new Pair();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class MarketStream {
  private readonly state: StreamState;
  private readonly env: StreamEnv;
  private readonly clients = new Set<WebSocket>();
  private readonly latest = new Map<RealtimeSymbol, PriceTick>();
  private upstream: WebSocket | null = null;
  private keyIndex = 0;
  private attempts = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(state: StreamState, env: StreamEnv) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    if (this.clients.size >= MAX_CLIENTS) {
      return new Response("Too many realtime clients", { status: 503 });
    }

    const pair = createSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    this.clients.add(server);
    server.addEventListener("close", () => {
      this.clients.delete(server);
      this.stopIfIdle();
    });
    server.addEventListener("error", () => {
      this.clients.delete(server);
      this.stopIfIdle();
    });

    for (const tick of this.latest.values()) this.sendTo(server, { type: "price", ...tick });
    await this.ensureUpstream();

    return new Response(null, {
      status: 101,
      webSocket: client,
    } as ResponseInit & { webSocket: WebSocket });
  }

  async alarm(): Promise<void> {
    await this.ensureUpstream();
  }

  private keys(): string[] {
    const pooled = this.env.TWELVE_DATA_API_KEYS?.split(",") ?? [];
    const single = this.env.TWELVE_DATA_API_KEY ? [this.env.TWELVE_DATA_API_KEY] : [];
    return Array.from(new Set([...pooled, ...single].map((key) => key.trim()).filter(Boolean)));
  }

  private async ensureUpstream(): Promise<void> {
    if (this.clients.size === 0) return;
    if (this.upstream && this.upstream.readyState <= WebSocket.OPEN) return;

    const keys = this.keys();
    if (keys.length === 0) {
      this.broadcast({ type: "status", status: "unconfigured" });
      return;
    }

    const key = keys[this.keyIndex % keys.length];
    this.keyIndex += 1;
    if (!key) return;

    let upstream: WebSocket;
    try {
      upstream = new WebSocket(`${UPSTREAM_URL}?apikey=${encodeURIComponent(key)}`);
    } catch {
      await this.scheduleReconnect();
      return;
    }
    this.upstream = upstream;

    upstream.addEventListener("open", () => {
      if (this.upstream !== upstream) return;
      this.attempts = 0;
      this.startHeartbeat();
      this.broadcast({ type: "status", status: "live" });
      try {
        upstream.send(
          JSON.stringify({
            action: "subscribe",
            params: { symbols: SUBSCRIPTION_SYMBOLS },
          }),
        );
      } catch {
        return;
      }
    });

    upstream.addEventListener("message", (event) => {
      if (this.upstream !== upstream) return;
      this.onUpstreamMessage(event.data);
    });

    upstream.addEventListener("close", () => {
      if (this.upstream !== upstream) return;
      this.upstream = null;
      this.stopHeartbeat();
      if (this.clients.size === 0) return;
      this.broadcast({ type: "status", status: "reconnecting" });
      void this.scheduleReconnect();
    });

    upstream.addEventListener("error", () => {
      try {
        upstream.close();
      } catch {
        return;
      }
    });
  }

  private onUpstreamMessage(data: unknown): void {
    if (typeof data !== "string") return;

    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (!isRecord(message)) return;

    const payload = message as UpstreamPrice;
    if (payload.event !== "price" || typeof payload.symbol !== "string") return;

    const clientSymbol = CLIENT_BY_PROVIDER.get(payload.symbol);
    if (!clientSymbol) return;

    const price = Number(payload.price);
    if (!Number.isFinite(price) || price <= 0) return;

    const providerTs = Number(payload.timestamp);
    const ts = Number.isFinite(providerTs) && providerTs > 0 ? providerTs * 1000 : Date.now();
    const previous = this.latest.get(clientSymbol);
    if (previous?.price === price && previous.ts === ts) return;

    const tick: PriceTick = { symbol: clientSymbol, price, ts };
    this.latest.set(clientSymbol, tick);
    this.broadcast({ type: "price", ...tick });
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.clients.size === 0) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.attempts);
    this.attempts += 1;
    try {
      await this.state.storage.setAlarm(Date.now() + delay);
    } catch {
      setTimeout(() => {
        void this.ensureUpstream();
      }, delay);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      const upstream = this.upstream;
      if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
      try {
        upstream.send(JSON.stringify({ action: "heartbeat" }));
      } catch {
        return;
      }
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (!this.heartbeat) return;
    clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private stopIfIdle(): void {
    if (this.clients.size > 0) return;
    this.stopHeartbeat();
    const upstream = this.upstream;
    this.upstream = null;
    if (upstream) {
      try {
        upstream.close(1000, "idle");
      } catch {
        return;
      }
    }
    void this.state.storage.deleteAlarm().catch(() => undefined);
  }

  private sendTo(socket: WebSocket, message: unknown): void {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      this.clients.delete(socket);
    }
  }

  private broadcast(message: unknown): void {
    const payload = JSON.stringify(message);
    for (const client of Array.from(this.clients)) {
      try {
        client.send(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }
}
