#!/usr/bin/env node
import { writeFile } from "node:fs/promises";

const WS_URL = "wss://realtime.insightsentry.com/live";
const DEFAULT_SYMBOLS = "FX_IDC:XAU/USD,BINANCE:BTCUSDT";
const MAX_SAMPLES = 100_000;
const MAX_RECONNECTS = 5;
const MAX_ERRORS = 50;

function usage() {
  return [
    "Usage: node scripts/probe-insightsentry.mjs [options]",
    "",
    "Options:",
    "  --duration <seconds>    Probe length (default: 60)",
    "  --symbols <codes>       Comma-separated codes (default: " + DEFAULT_SYMBOLS + ")",
    "  --bar-type <type>       tick, second, or minute (default: tick)",
    "  --bar-interval <n>      Bar interval (default: 1)",
    "  --out <file>            Write raw messages as NDJSON",
    "  --help                  Show this help",
    "",
    "Environment:",
    "  INSIGHTSENTRY_API_KEY   Dashboard WebSocket API key",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    duration: 60,
    symbols: DEFAULT_SYMBOLS,
    barType: "tick",
    barInterval: 1,
    out: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [name, inlineValue] = arg.split("=", 2);
    const readValue = () => {
      if (inlineValue !== undefined) return inlineValue;
      index += 1;
      return argv[index];
    };

    if (name === "--help" || name === "-h") {
      options.help = true;
      continue;
    }
    if (name === "--duration") {
      options.duration = Number(readValue());
      continue;
    }
    if (name === "--symbols") {
      options.symbols = readValue();
      continue;
    }
    if (name === "--bar-type") {
      options.barType = readValue();
      continue;
    }
    if (name === "--bar-interval") {
      options.barInterval = Number(readValue());
      continue;
    }
    if (name === "--out") {
      options.out = readValue();
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!Number.isFinite(options.duration) || options.duration <= 0) {
    throw new Error("--duration must be a positive number");
  }
  if (!Number.isInteger(options.barInterval) || options.barInterval <= 0) {
    throw new Error("--bar-interval must be a positive integer");
  }
  if (!["tick", "second", "minute"].includes(options.barType)) {
    throw new Error("--bar-type must be tick, second, or minute");
  }

  options.symbols = options.symbols
    .split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean);

  if (options.symbols.length === 0) {
    throw new Error("--symbols must contain at least one code");
  }

  return options;
}

function createSamples() {
  return { values: [], seen: 0 };
}

function addSample(samples, value) {
  samples.seen += 1;
  if (samples.values.length < MAX_SAMPLES) {
    samples.values.push(value);
    return;
  }
  const index = Math.floor(Math.random() * samples.seen);
  if (index < MAX_SAMPLES) samples.values[index] = value;
}

function quantile(samples, q) {
  if (samples.values.length === 0) return null;
  const values = [...samples.values].sort((a, b) => a - b);
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(q * values.length) - 1));
  return Math.round(values[index]);
}

function createSymbolStats(code) {
  return {
    code,
    ticks: 0,
    firstAt: null,
    lastAt: null,
    gaps: createSamples(),
    latencies: createSamples(),
    minPrice: null,
    maxPrice: null,
    lastPrice: null,
  };
}

function summarizeSymbol(stats) {
  const durationMs = stats.firstAt === null ? 0 : stats.lastAt - stats.firstAt;
  let maxGap = null;
  for (const gap of stats.gaps.values) {
    if (maxGap === null || gap > maxGap) maxGap = gap;
  }

  return {
    code: stats.code,
    ticks: stats.ticks,
    durationSec: Number((durationMs / 1000).toFixed(1)),
    ticksPerMin: durationMs > 0 ? Number(((stats.ticks / durationMs) * 60_000).toFixed(1)) : null,
    maxGapMs: maxGap,
    p50GapMs: quantile(stats.gaps, 0.5),
    p95GapMs: quantile(stats.gaps, 0.95),
    avgLatencyMs:
      stats.latencies.values.length === 0
        ? null
        : Math.round(
            stats.latencies.values.reduce((total, value) => total + value, 0) /
              stats.latencies.values.length,
          ),
    p95LatencyMs: quantile(stats.latencies, 0.95),
    minPrice: stats.minPrice,
    maxPrice: stats.maxPrice,
    lastPrice: stats.lastPrice,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const apiKey = process.env.INSIGHTSENTRY_API_KEY;
  if (!apiKey) {
    console.error("INSIGHTSENTRY_API_KEY is required");
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const startedAt = Date.now();
  const deadline = startedAt + options.duration * 1000;
  const statsByCode = new Map(options.symbols.map((code) => [code, createSymbolStats(code)]));
  const rawMessages = [];
  const state = {
    active: false,
    subscriptionCount: null,
    serverOffsetMs: null,
    reconnects: 0,
    close: null,
    errors: [],
    errorCount: 0,
    messageCount: 0,
    fatal: false,
  };

  let socket = null;
  let done = false;
  let timer = null;

  const logStatus = (message) => {
    process.stderr.write(`[probe] ${message}\n`);
  };

  const addError = (error) => {
    state.errorCount += 1;
    if (state.errors.length < MAX_ERRORS) state.errors.push(error);
  };

  const finish = async () => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    try {
      socket?.close(1000, "probe complete");
    } catch {
      socket = null;
    }

    const summary = {
      provider: "insightsentry",
      url: WS_URL,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date().toISOString(),
      requestedDurationSec: options.duration,
      barType: options.barType,
      barInterval: options.barInterval,
      symbols: options.symbols,
      active: state.active,
      subscriptionCount: state.subscriptionCount,
      serverOffsetMs: state.serverOffsetMs,
      reconnects: state.reconnects,
      messageCount: state.messageCount,
      errorCount: state.errorCount,
      errors: state.errors,
      close: state.close,
      stats: options.symbols.map((code) => summarizeSymbol(statsByCode.get(code))),
    };

    console.log(JSON.stringify(summary, null, 2));
    if (options.out) {
      await writeFile(options.out, rawMessages.join("\n") + (rawMessages.length > 0 ? "\n" : ""), "utf8");
    }
  };

  const handleSeries = (message) => {
    const stats = statsByCode.get(message.code);
    if (!stats) return;
    if (!Array.isArray(message.series)) return;

    for (const bar of message.series) {
      if (!bar || typeof bar !== "object") continue;
      const price = Number(bar.close);
      if (!Number.isFinite(price)) continue;

      const receivedAt = Date.now();
      if (stats.lastAt !== null) addSample(stats.gaps, receivedAt - stats.lastAt);
      stats.firstAt ??= receivedAt;
      stats.lastAt = receivedAt;
      stats.ticks += 1;
      stats.lastPrice = price;
      stats.minPrice = stats.minPrice === null ? price : Math.min(stats.minPrice, price);
      stats.maxPrice = stats.maxPrice === null ? price : Math.max(stats.maxPrice, price);

      const rawLastUpdate = Number(bar.last_update);
      if (Number.isFinite(rawLastUpdate) && rawLastUpdate > 0) {
        const lastUpdate = rawLastUpdate < 1e12 ? rawLastUpdate * 1000 : rawLastUpdate;
        addSample(stats.latencies, receivedAt - lastUpdate);
      }
    }
  };

  const handleMessage = (message) => {
    if (message.server_time !== undefined) {
      const serverTime = Number(message.server_time);
      if (Number.isFinite(serverTime)) state.serverOffsetMs = serverTime - Date.now();
      return;
    }

    if (message.event === "subscription_status") {
      state.active = message.status === "active";
      state.subscriptionCount =
        typeof message.subscription_count === "number" ? message.subscription_count : null;
      logStatus(
        `subscription ${message.status ?? "unknown"} (${message.subscription_count ?? "?"} legs)`,
      );
      return;
    }

    if (message.event === "delivery_status") {
      logStatus(
        `delivery ${message.mode ?? "unknown"} dropped=${message.dropped_updates ?? 0} rate=${message.max_rate_hz ?? "?"}Hz`,
      );
      return;
    }

    if (message.event === "series_update" || (message.code && Array.isArray(message.series))) {
      handleSeries(message);
      return;
    }

    if (message.error) {
      const error = {
        error: message.error,
        message: message.message,
        action: message.action,
        retryable: message.retryable,
        referenceId: message.reference_id,
      };
      addError(error);
      logStatus(`error ${message.error}: ${message.message ?? ""}`);
      if (
        ["invalid_apikey", "websocket_access_required", "subscription_expired", "no_valid_symbols"].includes(
          message.error,
        )
      ) {
        state.fatal = true;
      }
    }
  };

  const connect = () => {
    if (done) return;
    logStatus(`connecting (${options.symbols.join(", ")})`);
    socket = new WebSocket(WS_URL);

    socket.addEventListener("open", () => {
      logStatus("connected");
      socket.send(
        JSON.stringify({
          api_key: apiKey,
          slow_consumer_policy: "adaptive",
          subscriptions: options.symbols.map((code) => ({
            code,
            type: "series",
            bar_type: options.barType,
            bar_interval: options.barInterval,
            dp: 1,
          })),
        }),
      );
    });

    socket.addEventListener("message", (event) => {
      state.messageCount += 1;
      const raw = typeof event.data === "string" ? event.data : String(event.data);
      if (options.out) rawMessages.push(raw);

      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        addError({ error: "invalid_json", sample: raw.slice(0, 200) });
        return;
      }

      handleMessage(message);
    });

    socket.addEventListener("error", (event) => {
      addError({ error: "websocket_error", message: String(event.message ?? "unknown") });
      logStatus("websocket error");
    });

    socket.addEventListener("close", (event) => {
      state.close = { code: event.code, reason: event.reason };
      logStatus(`closed code=${event.code} reason=${event.reason || "none"}`);
      if (done) return;
      state.active = false;

      if (state.fatal || state.reconnects >= MAX_RECONNECTS || Date.now() >= deadline) {
        void finish();
        return;
      }

      state.reconnects += 1;
      const delay = Math.min(30_000, 1_000 * 2 ** (state.reconnects - 1));
      logStatus(`reconnecting in ${delay}ms`);
      setTimeout(connect, delay);
    });
  };

  timer = setTimeout(() => {
    void finish();
  }, options.duration * 1000);

  connect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
