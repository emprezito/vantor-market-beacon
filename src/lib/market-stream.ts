import {
  BAR_PRUNE_MS,
  FEED_INTERNAL_HEADER,
  FEED_INTERNAL_VALUE,
  MAX_MISSING_HISTORY_BARS,
  QUOTE_SNAPSHOT_MS,
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
  type FeedMissingSeries,
  type FeedPayload,
  type FeedQuoteInput,
  type FeedQuoteRecord,
  type FeedQuotesResponse,
  type FeedSeriesStatus,
  type FeedStatus,
} from "./market-feed";
import {
  CHART_INTERVALS,
  intervalMs,
  isChartInterval,
  type ChartInterval,
  type MarketCandle,
} from "./market-data";
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
  rowsWritten?: number;
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

type MemoryQuote = {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  ts: number;
  marketOpen: boolean;
  providerSymbol: string | null;
  receivedAt: number;
};

type QuoteSnapshot = {
  savedAt: number;
  lastIngestAt: number | null;
  lastSentAt: number | null;
  serverOffsetMs: number | null;
  feedId: string | null;
  symbols: string[];
  quotes: MemoryQuote[];
  seriesLatest?: [string, number][];
  rowsWrittenDay: string;
  rowsWrittenToday: number;
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
  private readonly quotes = new Map<string, MemoryQuote>();
  private readonly feedSymbols = new Set<string>();
  private readonly liveBars = new Map<string, MarketCandle>();
  private readonly seriesLatest = new Map<string, number>();
  private seriesLatestLoaded = false;
  private upstream: WebSocket | null = null;
  private keyIndex = 0;
  private attempts = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private feedId: string | null = null;
  private lastIngestAt: number | null = null;
  private lastSentAt: number | null = null;
  private serverOffsetMs: number | null = null;
  private quoteSnapshotAt = 0;
  private lastPruneAt = 0;
  private rowsWrittenDay = utcDayKey(Date.now());
  private rowsWrittenToday = 0;

  constructor(state: StreamState, env: StreamEnv) {
    this.state = state;
    this.env = env;
    this.initSchema();
    this.restoreSnapshot();
    this.lastPruneAt = this.metaTimestamp("last_prune_at") ?? Date.now();
    if (this.quoteSnapshotAt === 0) this.quoteSnapshotAt = Date.now();
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
    for (const quote of this.quotes.values()) {
      this.sendTo(server, {
        type: "price",
        symbol: quote.symbol,
        price: quote.mid,
        bid: quote.bid,
        ask: quote.ask,
        ts: quote.ts,
        feed: "exness",
        marketOpen: quote.marketOpen,
      });
    }
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

  private setMeta(key: string, value: string): void {
    this.sql().exec(
      "INSERT INTO feed_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      value,
    );
  }

  private metaTimestamp(key: string): number | null {
    const raw = this.meta(key);
    if (raw == null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  private restoreSnapshot(): void {
    const raw = this.meta("quote_snapshot");
    if (!raw) return;
    let snapshot: QuoteSnapshot;
    try {
      snapshot = JSON.parse(raw) as QuoteSnapshot;
    } catch {
      return;
    }
    if (!snapshot || !Array.isArray(snapshot.quotes)) return;
    for (const quote of snapshot.quotes) {
      if (!validMemoryQuote(quote)) continue;
      this.quotes.set(quote.symbol, quote);
      this.feedSymbols.add(quote.symbol);
    }
    for (const symbol of snapshot.symbols ?? []) {
      if (typeof symbol === "string") this.feedSymbols.add(symbol);
    }
    if (Array.isArray(snapshot.seriesLatest) && snapshot.seriesLatest.length > 0) {
      for (const entry of snapshot.seriesLatest) {
        if (
          Array.isArray(entry) &&
          typeof entry[0] === "string" &&
          typeof entry[1] === "number" &&
          Number.isFinite(entry[1])
        ) {
          this.seriesLatest.set(entry[0], entry[1]);
        }
      }
    }
    this.feedId = typeof snapshot.feedId === "string" ? snapshot.feedId : null;
    this.lastIngestAt = finiteOrNull(snapshot.lastIngestAt);
    this.lastSentAt = finiteOrNull(snapshot.lastSentAt);
    this.serverOffsetMs = finiteOrNull(snapshot.serverOffsetMs);
    this.quoteSnapshotAt = finiteOrNull(snapshot.savedAt) ?? 0;
    this.rowsWrittenDay =
      typeof snapshot.rowsWrittenDay === "string" ? snapshot.rowsWrittenDay : this.rowsWrittenDay;
    this.rowsWrittenToday = Math.max(0, Math.round(finiteOrNull(snapshot.rowsWrittenToday) ?? 0));
  }

  private ensureRowsDay(now: number): void {
    const day = utcDayKey(now);
    if (day === this.rowsWrittenDay) return;
    this.rowsWrittenDay = day;
    this.rowsWrittenToday = 0;
  }

  private recordRowsWritten(count: number, now = Date.now()): void {
    if (count <= 0) return;
    this.ensureRowsDay(now);
    this.rowsWrittenToday += count;
  }

  private snapshotQuotes(now: number): void {
    if (this.quotes.size === 0) return;
    if (now - this.quoteSnapshotAt < QUOTE_SNAPSHOT_MS) return;
    const snapshot: QuoteSnapshot = {
      savedAt: now,
      lastIngestAt: this.lastIngestAt,
      lastSentAt: this.lastSentAt,
      serverOffsetMs: this.serverOffsetMs,
      feedId: this.feedId,
      symbols: Array.from(this.feedSymbols).sort(),
      quotes: Array.from(this.quotes.values()),
      seriesLatest: Array.from(this.seriesLatest.entries()),
      rowsWrittenDay: this.rowsWrittenDay,
      rowsWrittenToday: this.rowsWrittenToday,
    };
    this.setMeta("quote_snapshot", JSON.stringify(snapshot));
    this.quoteSnapshotAt = now;
    this.recordRowsWritten(1, now);
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
    const broadcast: MemoryQuote[] = [];

    for (const quote of quotes) {
      const result = this.upsertQuote(quote, now);
      if (result) {
        acceptedQuotes += 1;
        broadcast.push(result);
      } else {
        ignoredQuotes += 1;
      }
    }

    for (const item of series) acceptedBars += this.upsertSeries(item, now);

    this.feedId = String(payload.feedId ?? "unknown");
    this.lastSentAt = Number.isFinite(payload.sentAt) ? payload.sentAt : now;
    if (typeof payload.serverOffsetMs === "number" && Number.isFinite(payload.serverOffsetMs)) {
      this.serverOffsetMs = payload.serverOffsetMs;
    }
    if (acceptedQuotes > 0 || acceptedBars > 0) this.lastIngestAt = now;

    for (const quote of broadcast) {
      this.broadcast({
        type: "price",
        symbol: quote.symbol,
        price: quote.mid,
        bid: quote.bid,
        ask: quote.ask,
        ts: quote.ts,
        feed: "exness",
        marketOpen: quote.marketOpen,
      });
    }

    this.snapshotQuotes(now);
    this.pruneBars(now);

    return jsonResponse({ ok: true, acceptedQuotes, ignoredQuotes, acceptedBars });
  }

  private upsertQuote(input: FeedQuoteInput, now: number): MemoryQuote | null {
    if (
      !Number.isFinite(input.bid) ||
      !Number.isFinite(input.ask) ||
      !Number.isFinite(input.ts) ||
      input.bid <= 0 ||
      input.ask <= 0 ||
      input.ask < input.bid
    ) {
      return null;
    }

    this.feedSymbols.add(input.symbol);
    const mid = (input.bid + input.ask) / 2;
    const existing = this.quotes.get(input.symbol);
    if (existing && existing.ts >= input.ts) {
      existing.marketOpen = input.marketOpen !== false;
      existing.receivedAt = now;
      return null;
    }
    if (
      existing &&
      quoteJumpExceeded(
        { mid, ts: input.ts },
        { mid: existing.mid, ts: existing.ts },
        now,
        maxFeedJumpPct(input.symbol),
      )
    ) {
      return null;
    }

    const quote: MemoryQuote = {
      symbol: input.symbol,
      bid: input.bid,
      ask: input.ask,
      mid,
      ts: input.ts,
      marketOpen: input.marketOpen !== false,
      providerSymbol: input.providerSymbol ?? null,
      receivedAt: now,
    };
    this.quotes.set(input.symbol, quote);
    return quote;
  }

  private upsertSeries(input: FeedCandleInput, now: number): number {
    if (typeof input.symbol !== "string" || !isChartInterval(input.interval)) return 0;
    if (!Array.isArray(input.bars) || input.bars.length === 0) return 0;

    const intervalSec = Math.max(60, Math.round(intervalMs(input.interval) / 1000));
    let accepted = 0;
    for (const bar of input.bars) {
      if (!validCandle(bar)) continue;
      const closed = (bar.time + intervalSec) * 1000 <= now + 1_000;
      const key = `${input.symbol}:${input.interval}`;
      if (!closed) {
        const live = this.liveBars.get(key);
        if (!live || bar.time >= live.time) this.liveBars.set(key, bar);
        accepted += 1;
        continue;
      }
      const live = this.liveBars.get(key);
      if (live && live.time <= bar.time) this.liveBars.delete(key);
      const latest = this.seriesLatest.get(key);

      const existing = this.sql()
        .exec(
          `SELECT open, high, low, close, volume FROM feed_candles
           WHERE symbol = ? AND interval = ? AND time = ?`,
          input.symbol,
          input.interval,
          bar.time,
        )
        .toArray()[0];
      if (existing && sameCandle(existing, bar)) {
        if (latest == null || bar.time > latest) this.seriesLatest.set(key, bar.time);
        continue;
      }

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
      if (latest == null || bar.time > latest) this.seriesLatest.set(key, bar.time);
      this.recordRowsWritten(1, now);
      accepted += 1;
    }
    return accepted;
  }

  private pruneBars(now: number): void {
    if (now - this.lastPruneAt < BAR_PRUNE_MS) return;
    this.loadSeriesLatest();
    const retention = feedRetentionBars(this.env.DEV_FEED_RETENTION_BARS);
    const clauses: string[] = [];
    const bindings: (string | number)[] = [];
    for (const [key, latest] of this.seriesLatest) {
      const separator = key.lastIndexOf(":");
      if (separator <= 0) continue;
      const symbol = key.slice(0, separator);
      const interval = key.slice(separator + 1);
      if (!isChartInterval(interval)) continue;
      const stepSec = Math.max(60, Math.round(intervalMs(interval) / 1000));
      const cutoff = latest - retention * stepSec;
      clauses.push("(symbol = ? AND interval = ? AND time < ?)");
      bindings.push(symbol, interval, cutoff);
    }
    if (clauses.length > 0) {
      const cursor = this.sql().exec(
        `DELETE FROM feed_candles WHERE ${clauses.join(" OR ")}`,
        ...bindings,
      );
      this.recordRowsWritten(cursor.rowsWritten ?? 0, now);
    }
    this.lastPruneAt = now;
    this.setMeta("last_prune_at", String(now));
    this.recordRowsWritten(1, now);
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
    const lastIngestAt = this.lastIngestAt;
    const stale = feedIsStale(lastIngestAt, now, this.staleMs());
    if (symbols.length === 0) {
      const empty: FeedQuotesResponse = { quotes: [], stale };
      return jsonResponse(empty);
    }

    const daily = this.dailyBars(symbols);
    const quotes: FeedQuoteRecord[] = [];
    for (const symbol of symbols) {
      const quote = this.quotes.get(symbol);
      const record = this.quoteRecord(quote, daily.get(symbol), lastIngestAt, now);
      if (record) quotes.push(record);
    }
    const payload: FeedQuotesResponse = { quotes, stale };
    return jsonResponse(payload);
  }

  private quoteRecord(
    quote: MemoryQuote | undefined,
    daily: FeedDailyBar | undefined,
    lastIngestAt: number | null,
    now: number,
  ): FeedQuoteRecord | null {
    if (!quote) return null;
    const stale = quoteIsStale(quote.ts, quote.marketOpen, lastIngestAt, now, this.staleMs());
    const stats = computeFeedQuoteStats(quote.mid, daily);
    return {
      symbol: quote.symbol,
      bid: quote.bid,
      ask: quote.ask,
      mid: quote.mid,
      ts: quote.ts,
      marketOpen: quote.marketOpen,
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
    const live = this.liveBars.get(`${symbol}:${interval}`);
    if (live) {
      const last = candles[candles.length - 1];
      if (!last || live.time > last.time) candles.push(live);
      else if (live.time === last.time) candles[candles.length - 1] = live;
    }
    const payload: FeedCandlesResponse = {
      symbol,
      interval,
      candles: candles.slice(-points),
      stale: feedIsStale(this.lastIngestAt, Date.now(), this.staleMs()),
    };
    return jsonResponse(payload);
  }

  private feedStatus(): Response {
    const now = Date.now();
    this.ensureRowsDay(now);
    const lastIngestAt = this.lastIngestAt;
    const series = this.seriesStatus();
    const latest = new Map(
      series
        .filter((item) => item.latest != null)
        .map((item) => [`${item.symbol}:${item.interval}`, item.latest as number]),
    );
    const dayStart = utcDayStart(now);
    const elapsed = Math.max(1, now - dayStart);
    const rowsWrittenPerDayEstimate =
      elapsed >= 60 * 60_000
        ? Math.round((this.rowsWrittenToday * 86_400_000) / elapsed)
        : this.rowsWrittenToday;
    const status: FeedStatus = {
      feedId: this.feedId,
      lastIngestAt,
      lastSentAt: this.lastSentAt,
      quoteCount: this.quotes.size,
      seriesCount: series.length,
      stale: feedIsStale(lastIngestAt, now, this.staleMs()),
      quoteSnapshotAt: this.quoteSnapshotAt || null,
      rowsWrittenToday: this.rowsWrittenToday,
      rowsWrittenPerDayEstimate,
      missing: this.missingSeries(now, latest),
      series,
    };
    return jsonResponse(status);
  }

  private loadSeriesLatest(): void {
    if (this.seriesLatestLoaded) return;
    const rows = this.sql()
      .exec(
        `SELECT symbol, interval, MAX(time) AS latest FROM feed_candles
         GROUP BY symbol, interval`,
      )
      .toArray();
    for (const row of rows) {
      const symbol = typeof row["symbol"] === "string" ? row["symbol"] : "";
      const interval = row["interval"];
      const latest = Number(row["latest"]);
      if (!symbol || !isChartInterval(interval)) continue;
      if (!Number.isFinite(latest) || latest <= 0) continue;
      this.seriesLatest.set(`${symbol}:${interval}`, latest);
    }
    this.seriesLatestLoaded = true;
  }

  private seriesStatus(): FeedSeriesStatus[] {
    this.loadSeriesLatest();
    const result: FeedSeriesStatus[] = [];
    for (const [key, latest] of Array.from(this.seriesLatest.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const separator = key.lastIndexOf(":");
      if (separator <= 0) continue;
      const symbol = key.slice(0, separator);
      const interval = key.slice(separator + 1);
      if (!isChartInterval(interval)) continue;
      result.push({ symbol, interval, latest });
    }
    return result;
  }

  private missingSeries(now: number, latest: Map<string, number>): FeedMissingSeries[] {
    const result: FeedMissingSeries[] = [];
    const symbols = Array.from(this.feedSymbols).sort();
    for (const symbol of symbols) {
      for (const interval of CHART_INTERVALS) {
        const key = `${symbol}:${interval.value}`;
        const last = latest.get(key);
        const stepMs = intervalMs(interval.value);
        if (last == null) {
          result.push({
            symbol,
            interval: interval.value,
            count: MAX_MISSING_HISTORY_BARS,
            reason: "empty",
          });
          continue;
        }
        const grace = interval.value === "1min" ? 2 * 60_000 : Math.max(stepMs * 3, 3 * 60_000);
        const age = now - last * 1000;
        if (age <= grace) continue;
        const count = Math.min(MAX_MISSING_HISTORY_BARS, Math.max(1, Math.ceil(age / stepMs)));
        result.push({ symbol, interval: interval.value, count, reason: "stale" });
      }
    }
    return result;
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

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function utcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function utcDayStart(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function validMemoryQuote(value: unknown): value is MemoryQuote {
  if (!isRecord(value)) return false;
  return (
    typeof value["symbol"] === "string" &&
    value["symbol"].length > 0 &&
    typeof value["bid"] === "number" &&
    Number.isFinite(value["bid"]) &&
    value["bid"] > 0 &&
    typeof value["ask"] === "number" &&
    Number.isFinite(value["ask"]) &&
    value["ask"] >= value["bid"] &&
    typeof value["mid"] === "number" &&
    Number.isFinite(value["mid"]) &&
    value["mid"] > 0 &&
    typeof value["ts"] === "number" &&
    Number.isFinite(value["ts"]) &&
    value["ts"] > 0
  );
}

function sameCandle(row: Record<string, unknown>, bar: MarketCandle): boolean {
  const volume = row["volume"] == null ? null : Number(row["volume"]);
  const barVolume = bar.volume == null ? null : bar.volume;
  return (
    Number(row["open"]) === bar.open &&
    Number(row["high"]) === bar.high &&
    Number(row["low"]) === bar.low &&
    Number(row["close"]) === bar.close &&
    volume === barVolume
  );
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
