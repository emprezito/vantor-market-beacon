import {
  FEED_INTERNAL_HEADER,
  FEED_INTERNAL_VALUE,
  computeFeedQuoteStats,
  feedIsStale,
  feedRetentionBars,
  feedStaleMs,
  maxFeedJumpPct,
  quoteIsStale,
  quoteJumpExceeded,
  type FeedCandleInput,
  type FeedCandlesResponse,
  type FeedDailyBar,
  type FeedPayload,
  type FeedQuoteInput,
  type FeedQuoteRecord,
  type FeedQuotesResponse,
  type FeedStatus,
} from "./market-feed";
import { isChartInterval, type ChartInterval, type MarketCandle } from "./market-data";
import { REALTIME_SYMBOLS, type RealtimeSymbol } from "./realtime-symbols";

const UPSTREAM_URL = "wss://ws.twelvedata.com/v1/quotes/price";
const SUBSCRIPTION_SYMBOLS = Object.values(REALTIME_SYMBOLS).join(",");
const MAX_CLIENTS = 100;
const HEARTBEAT_MS = 10_000;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

const CLIENT_BY_PROVIDER = new Map<string, RealtimeSymbol>(
  Object.entries(REALTIME_SYMBOLS).map(([client, provider]) => [
    provider,
    client as RealtimeSymbol,
  ]),
);

type StreamEnv = {
  TWELVE_DATA_API_KEYS?: string;
  TWELVE_DATA_API_KEY?: string;
  DEV_FEED_STALE_MS?: string;
  DEV_FEED_RETENTION_BARS?: string;
};

type SqlCursor = {
  toArray: () => Record<string, unknown>[];
};

type SqlStorage = {
  exec: (query: string, ...bindings: unknown[]) => SqlCursor;
};

type StreamStorage = {
  setAlarm: (scheduledTime: number) => Promise<void>;
  deleteAlarm: () => Promise<void>;
  sql: SqlStorage;
  transactionSync?: <T>(callback: () => T) => T;
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
    this.initSchema();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/internal/")) {
      return this.handleInternal(request, url);
    }
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

  private sql(): SqlStorage {
    return this.state.storage.sql;
  }

  private initSchema(): void {
    const sql = this.sql();
    sql.exec(`CREATE TABLE IF NOT EXISTS feed_quotes (
      symbol TEXT PRIMARY KEY,
      bid REAL NOT NULL,
      ask REAL NOT NULL,
      mid REAL NOT NULL,
      ts INTEGER NOT NULL,
      market_open INTEGER NOT NULL DEFAULT 1,
      provider_symbol TEXT,
      received_at INTEGER NOT NULL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS feed_candles (
      symbol TEXT NOT NULL,
      interval TEXT NOT NULL,
      time INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL,
      PRIMARY KEY (symbol, interval, time)
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS feed_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
  }

  private transaction<T>(callback: () => T): T {
    const storage = this.state.storage;
    return storage.transactionSync ? storage.transactionSync(callback) : callback();
  }

  private meta(key: string): string | null {
    const rows = this.sql().exec("SELECT value FROM feed_meta WHERE key = ?", key).toArray();
    const value = rows[0]?.["value"];
    return typeof value === "string" ? value : null;
  }

  private metaNumber(key: string): number | null {
    const raw = this.meta(key);
    if (raw == null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  private setMeta(key: string, value: string): void {
    this.sql().exec(
      "INSERT INTO feed_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      value,
    );
  }

  private staleMs(): number {
    return feedStaleMs(this.env.DEV_FEED_STALE_MS);
  }

  private async handleInternal(request: Request, url: URL): Promise<Response> {
    if (request.headers.get(FEED_INTERNAL_HEADER) !== FEED_INTERNAL_VALUE) {
      return jsonResponse({ error: "not_found" }, 404);
    }
    if (url.pathname === "/internal/ingest" && request.method === "POST") {
      return this.ingest(request);
    }
    if (url.pathname === "/internal/quotes" && request.method === "GET") {
      return this.feedQuotes(url);
    }
    if (url.pathname === "/internal/candles" && request.method === "GET") {
      return this.feedCandles(url);
    }
    if (url.pathname === "/internal/status" && request.method === "GET") {
      return this.feedStatus();
    }
    return jsonResponse({ error: "not_found" }, 404);
  }

  private async ingest(request: Request): Promise<Response> {
    let payload: FeedPayload;
    try {
      payload = (await request.json()) as FeedPayload;
    } catch {
      return jsonResponse({ error: "invalid_payload" }, 400);
    }

    const now = Date.now();
    const quotes = Array.isArray(payload.quotes) ? payload.quotes : [];
    const series = Array.isArray(payload.candles) ? payload.candles : [];
    let acceptedQuotes = 0;
    let ignoredQuotes = 0;
    let acceptedBars = 0;

    this.transaction(() => {
      for (const quote of quotes) {
        if (this.upsertQuote(quote, now)) acceptedQuotes += 1;
        else ignoredQuotes += 1;
      }
      for (const item of series) acceptedBars += this.upsertSeries(item);
      this.setMeta("feed_id", String(payload.feedId ?? "unknown"));
      if (acceptedQuotes > 0 || acceptedBars > 0) {
        this.setMeta("last_ingest_at", String(now));
      }
      this.setMeta("last_sent_at", String(Number.isFinite(payload.sentAt) ? payload.sentAt : now));
      if (Number.isFinite(payload.serverOffsetMs)) {
        this.setMeta("server_offset_ms", String(payload.serverOffsetMs));
      }
    });

    return jsonResponse({ ok: true, acceptedQuotes, ignoredQuotes, acceptedBars });
  }

  private upsertQuote(input: FeedQuoteInput, now: number): boolean {
    if (
      !Number.isFinite(input.bid) ||
      !Number.isFinite(input.ask) ||
      !Number.isFinite(input.ts) ||
      input.bid <= 0 ||
      input.ask <= 0 ||
      input.ask < input.bid
    ) {
      return false;
    }

    const mid = (input.bid + input.ask) / 2;
    const existing = this.sql()
      .exec("SELECT mid, ts FROM feed_quotes WHERE symbol = ?", input.symbol)
      .toArray()[0];
    if (existing && Number(existing["ts"]) >= input.ts) {
      this.sql().exec(
        "UPDATE feed_quotes SET market_open = ?, received_at = ? WHERE symbol = ?",
        input.marketOpen === false ? 0 : 1,
        now,
        input.symbol,
      );
      return false;
    }
    if (
      existing &&
      quoteJumpExceeded(
        { mid, ts: input.ts },
        { mid: Number(existing["mid"]), ts: Number(existing["ts"]) },
        now,
        maxFeedJumpPct(input.symbol),
      )
    ) {
      return false;
    }

    this.sql().exec(
      `INSERT INTO feed_quotes (symbol, bid, ask, mid, ts, market_open, provider_symbol, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(symbol) DO UPDATE SET
         bid = excluded.bid,
         ask = excluded.ask,
         mid = excluded.mid,
         ts = excluded.ts,
         market_open = excluded.market_open,
         provider_symbol = excluded.provider_symbol,
         received_at = excluded.received_at`,
      input.symbol,
      input.bid,
      input.ask,
      mid,
      input.ts,
      input.marketOpen === false ? 0 : 1,
      input.providerSymbol ?? null,
      now,
    );
    return true;
  }

  private upsertSeries(input: FeedCandleInput): number {
    if (typeof input.symbol !== "string" || !isChartInterval(input.interval)) return 0;
    if (!Array.isArray(input.bars) || input.bars.length === 0) return 0;
    if (input.snapshot) {
      this.sql().exec(
        "DELETE FROM feed_candles WHERE symbol = ? AND interval = ?",
        input.symbol,
        input.interval,
      );
    }

    let accepted = 0;
    for (const bar of input.bars) {
      if (!validCandle(bar)) continue;
      this.sql().exec(
        `INSERT INTO feed_candles (symbol, interval, time, open, high, low, close, volume)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(symbol, interval, time) DO UPDATE SET
           open = excluded.open,
           high = excluded.high,
           low = excluded.low,
           close = excluded.close,
           volume = excluded.volume`,
        input.symbol,
        input.interval,
        bar.time,
        bar.open,
        bar.high,
        bar.low,
        bar.close,
        bar.volume ?? null,
      );
      accepted += 1;
    }
    this.pruneSeries(input.symbol, input.interval);
    return accepted;
  }

  private pruneSeries(symbol: string, interval: ChartInterval): void {
    const retention = feedRetentionBars(this.env.DEV_FEED_RETENTION_BARS);
    this.sql().exec(
      `DELETE FROM feed_candles
       WHERE symbol = ? AND interval = ?
         AND time NOT IN (
           SELECT time FROM feed_candles
           WHERE symbol = ? AND interval = ?
           ORDER BY time DESC
           LIMIT ?
         )`,
      symbol,
      interval,
      symbol,
      interval,
      retention,
    );
  }

  private feedQuotes(url: URL): Response {
    const symbols = Array.from(
      new Set(
        (url.searchParams.get("symbols") ?? "")
          .split(",")
          .map((symbol) => symbol.trim())
          .filter(Boolean),
      ),
    );
    const now = Date.now();
    const lastIngestAt = this.metaNumber("last_ingest_at");
    const stale = feedIsStale(lastIngestAt, now, this.staleMs());
    if (symbols.length === 0) {
      const empty: FeedQuotesResponse = { quotes: [], stale };
      return jsonResponse(empty);
    }

    const placeholders = symbols.map(() => "?").join(",");
    const rows = this.sql()
      .exec(
        `SELECT symbol, bid, ask, mid, ts, market_open FROM feed_quotes WHERE symbol IN (${placeholders})`,
        ...symbols,
      )
      .toArray();
    const daily = this.dailyBars(symbols);
    const quotes: FeedQuoteRecord[] = [];
    for (const row of rows) {
      const symbol = typeof row["symbol"] === "string" ? row["symbol"] : "";
      const record = this.quoteRecord(row, daily.get(symbol), lastIngestAt, now);
      if (record) quotes.push(record);
    }
    const payload: FeedQuotesResponse = { quotes, stale };
    return jsonResponse(payload);
  }

  private quoteRecord(
    row: Record<string, unknown>,
    daily: FeedDailyBar | undefined,
    lastIngestAt: number | null,
    now: number,
  ): FeedQuoteRecord | null {
    const symbol = typeof row["symbol"] === "string" ? row["symbol"] : "";
    const bid = Number(row["bid"]);
    const ask = Number(row["ask"]);
    const ts = Number(row["ts"]);
    if (!symbol || !Number.isFinite(bid) || !Number.isFinite(ask) || !Number.isFinite(ts)) {
      return null;
    }
    if (bid <= 0 || ask <= 0 || ask < bid) return null;
    const storedMid = Number(row["mid"]);
    const mid = Number.isFinite(storedMid) && storedMid > 0 ? storedMid : (bid + ask) / 2;
    const marketOpen = Number(row["market_open"]) !== 0;
    const stale = quoteIsStale(ts, marketOpen, lastIngestAt, now, this.staleMs());
    const stats = computeFeedQuoteStats(mid, daily);
    return {
      symbol,
      bid,
      ask,
      mid,
      ts,
      marketOpen,
      stale,
      ...(stats.change == null ? {} : { change: stats.change }),
      ...(stats.high == null ? {} : { high: stats.high }),
      ...(stats.low == null ? {} : { low: stats.low }),
    };
  }

  private dailyBars(symbols: string[]): Map<string, FeedDailyBar> {
    const result = new Map<string, FeedDailyBar>();
    if (symbols.length === 0) return result;
    const placeholders = symbols.map(() => "?").join(",");
    const rows = this.sql()
      .exec(
        `SELECT symbol, open, high, low FROM feed_candles
         WHERE interval = '1day' AND symbol IN (${placeholders})
         ORDER BY time DESC`,
        ...symbols,
      )
      .toArray();
    for (const row of rows) {
      const symbol = typeof row["symbol"] === "string" ? row["symbol"] : "";
      if (!symbol || result.has(symbol)) continue;
      const open = Number(row["open"]);
      const high = Number(row["high"]);
      const low = Number(row["low"]);
      if (![open, high, low].every(Number.isFinite)) continue;
      result.set(symbol, { open, high, low });
    }
    return result;
  }

  private feedCandles(url: URL): Response {
    const symbol = url.searchParams.get("symbol") ?? "";
    const interval = url.searchParams.get("interval") ?? "";
    if (!symbol || !isChartInterval(interval)) {
      return jsonResponse({ error: "invalid_request" }, 400);
    }
    const rawPoints = Number(url.searchParams.get("points") ?? "180");
    const points = Number.isFinite(rawPoints)
      ? Math.min(500, Math.max(20, Math.round(rawPoints)))
      : 180;
    const rows = this.sql()
      .exec(
        `SELECT time, open, high, low, close, volume FROM feed_candles
         WHERE symbol = ? AND interval = ?
         ORDER BY time DESC LIMIT ?`,
        symbol,
        interval,
        points,
      )
      .toArray();
    const candles: MarketCandle[] = [];
    for (const row of rows) {
      const candle = candleFromRow(row);
      if (candle) candles.push(candle);
    }
    candles.reverse();
    const payload: FeedCandlesResponse = {
      symbol,
      interval,
      candles,
      stale: feedIsStale(this.metaNumber("last_ingest_at"), Date.now(), this.staleMs()),
    };
    return jsonResponse(payload);
  }

  private feedStatus(): Response {
    const lastIngestAt = this.metaNumber("last_ingest_at");
    const quoteRow = this.sql().exec("SELECT COUNT(*) AS count FROM feed_quotes").toArray()[0];
    const seriesRow = this.sql()
      .exec(
        "SELECT COUNT(*) AS count FROM (SELECT symbol, interval FROM feed_candles GROUP BY symbol, interval)",
      )
      .toArray()[0];
    const status: FeedStatus = {
      feedId: this.meta("feed_id"),
      lastIngestAt,
      lastSentAt: this.metaNumber("last_sent_at"),
      quoteCount: Number(quoteRow?.["count"] ?? 0),
      seriesCount: Number(seriesRow?.["count"] ?? 0),
      stale: feedIsStale(lastIngestAt, Date.now(), this.staleMs()),
    };
    return jsonResponse(status);
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function validCandle(value: unknown): value is MarketCandle {
  if (!isRecord(value)) return false;
  const { time, open, high, low, close, volume } = value;
  if (typeof time !== "number" || !Number.isInteger(time) || time <= 0) return false;
  if (typeof open !== "number" || !Number.isFinite(open) || open <= 0) return false;
  if (typeof high !== "number" || !Number.isFinite(high) || high <= 0) return false;
  if (typeof low !== "number" || !Number.isFinite(low) || low <= 0) return false;
  if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) return false;
  if (high < low || high < open || high < close || low > open || low > close) return false;
  if (volume != null && (typeof volume !== "number" || !Number.isFinite(volume) || volume < 0)) {
    return false;
  }
  return true;
}

function candleFromRow(row: Record<string, unknown>): MarketCandle | null {
  const time = Number(row["time"]);
  const open = Number(row["open"]);
  const high = Number(row["high"]);
  const low = Number(row["low"]);
  const close = Number(row["close"]);
  if (![time, open, high, low, close].every(Number.isFinite)) return null;
  if (time <= 0 || open <= 0 || high <= 0 || low <= 0 || close <= 0) return null;
  if (high < low || high < open || high < close || low > open || low > close) return null;
  const volume = row["volume"] == null ? null : Number(row["volume"]);
  return {
    time: Math.round(time),
    open,
    high,
    low,
    close,
    ...(volume != null && Number.isFinite(volume) && volume >= 0 ? { volume } : {}),
  };
}
