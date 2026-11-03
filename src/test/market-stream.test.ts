import { afterEach, describe, expect, it, vi } from "vitest";
import { FEED_INTERNAL_HEADER, FEED_INTERNAL_VALUE, type FeedPayload } from "@/lib/market-feed";
import { MarketStream } from "@/lib/market-stream";

const NOW = Date.parse("2026-10-29T12:00:30.000Z");
const BAR_TIME = Math.floor(NOW / 1000) - (Math.floor(NOW / 1000) % 60);

type Row = Record<string, unknown>;

class FakeSql {
  readonly writes: { query: string; bindings: unknown[] }[] = [];
  readonly candles = new Map<string, Row>();
  readonly meta = new Map<string, string>();

  exec(query: string, ...bindings: unknown[]) {
    const text = query.replace(/\s+/g, " ").trim();
    if (/^(INSERT|UPDATE|DELETE)/i.test(text)) {
      this.writes.push({ query: text, bindings });
    }

    if (text.startsWith("SELECT value FROM feed_meta")) {
      const value = this.meta.get(String(bindings[0]));
      return cursor(value == null ? [] : [{ value }]);
    }
    if (text.startsWith("INSERT INTO feed_meta")) {
      this.meta.set(String(bindings[0]), String(bindings[1]));
      return cursor();
    }
    if (text.startsWith("SELECT open, high, low, close, volume FROM feed_candles")) {
      const row = this.candles.get(candleKey(bindings));
      return cursor(row ? [row] : []);
    }
    if (text.startsWith("INSERT INTO feed_candles")) {
      const [symbol, interval, time, open, high, low, close, volume] = bindings;
      this.candles.set(candleKey(bindings), {
        open,
        high,
        low,
        close,
        volume: volume ?? null,
      });
      void symbol;
      void interval;
      void time;
      return cursor();
    }
    return cursor();
  }
}

function cursor(rows: Row[] = []) {
  return { toArray: () => rows };
}

function candleKey(bindings: unknown[]): string {
  return `${String(bindings[0])}:${String(bindings[1])}:${String(bindings[2])}`;
}

function makeStream() {
  const sql = new FakeSql();
  const state = {
    storage: {
      sql,
      setAlarm: async () => undefined,
      deleteAlarm: async () => undefined,
    },
  };
  const stream = new MarketStream(state as never, {
    DEV_FEED_STALE_MS: "10000",
    DEV_FEED_RETENTION_BARS: "2000",
  });
  return { stream, sql };
}

function payload(overrides: Partial<FeedPayload> = {}): FeedPayload {
  return {
    feedId: "test-feed",
    sentAt: NOW,
    quotes: [],
    candles: [],
    ...overrides,
  };
}

async function ingest(stream: MarketStream, body: FeedPayload): Promise<Response> {
  return stream.fetch(
    new Request("https://market-feed.internal/internal/ingest", {
      method: "POST",
      headers: {
        [FEED_INTERNAL_HEADER]: FEED_INTERNAL_VALUE,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
}

function storageWrites(sql: FakeSql) {
  return sql.writes.filter((item) => /^(INSERT|UPDATE|DELETE)/i.test(item.query));
}

describe("market stream storage behavior", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not write storage when a quote tick arrives", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { stream, sql } = makeStream();
    sql.writes.length = 0;

    const response = await ingest(
      stream,
      payload({
        quotes: [
          {
            symbol: "XAUUSD",
            bid: 2400,
            ask: 2400.4,
            ts: NOW,
            marketOpen: true,
            providerSymbol: "XAUUSDm",
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ acceptedQuotes: 1 });
    expect(storageWrites(sql)).toEqual([]);
  });

  it("writes a bar only after its interval closes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { stream, sql } = makeStream();
    sql.writes.length = 0;

    const openBar = {
      time: BAR_TIME,
      open: 2400,
      high: 2401,
      low: 2399,
      close: 2400.5,
    };
    await ingest(
      stream,
      payload({
        candles: [{ symbol: "XAUUSD", interval: "1min", snapshot: false, bars: [openBar] }],
      }),
    );
    expect(storageWrites(sql)).toEqual([]);

    const closedBar = {
      time: BAR_TIME - 60,
      open: 2399,
      high: 2400,
      low: 2398,
      close: 2399.5,
    };
    await ingest(
      stream,
      payload({
        candles: [{ symbol: "XAUUSD", interval: "1min", snapshot: false, bars: [closedBar] }],
      }),
    );

    const inserts = sql.writes.filter((item) => item.query.startsWith("INSERT INTO feed_candles"));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.bindings[2]).toBe(closedBar.time);
  });

  it("skips the write when the closed bar is identical to the stored row", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { stream, sql } = makeStream();
    const closedBar = {
      time: BAR_TIME - 60,
      open: 2399,
      high: 2400,
      low: 2398,
      close: 2399.5,
    };
    sql.candles.set(`XAUUSD:1min:${closedBar.time}`, {
      open: closedBar.open,
      high: closedBar.high,
      low: closedBar.low,
      close: closedBar.close,
      volume: null,
    });
    sql.writes.length = 0;

    await ingest(
      stream,
      payload({
        candles: [{ symbol: "XAUUSD", interval: "1min", snapshot: false, bars: [closedBar] }],
      }),
    );

    expect(sql.writes.filter((item) => item.query.startsWith("INSERT INTO feed_candles"))).toEqual(
      [],
    );
  });
});
