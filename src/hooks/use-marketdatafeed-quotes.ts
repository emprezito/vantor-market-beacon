import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getMarketDatafeedTicket } from "@/lib/realtime.functions";
import {
  MARKETDATA_STALE_MS,
  MARKETDATA_WS_URL,
  isMarketDatafeedSymbol,
  marketDatafeedQuote,
  marketDatafeedVpsSymbol,
  parseMarketDatafeedTick,
  type MarketDatafeedTerminalSymbol,
} from "@/lib/marketdatafeed";
import type { QuoteMap } from "@/lib/market-data";

export type MarketDatafeedStatus =
  "idle" | "connecting" | "live" | "stale" | "reconnecting" | "disconnected" | "error";

const RETRY_BASE_MS = 3_000;
const RETRY_MAX_MS = 30_000;
const PONG_TIMEOUT_MS = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPermanentTicketError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /not enabled|not configured|unauthorized|not authorized|invalid trading account/i.test(
    message,
  );
}

export function useMarketDatafeedQuotes(
  symbols: string[],
  accountId: string | null,
): {
  quotes: QuoteMap;
  status: MarketDatafeedStatus;
  error: string | null;
} {
  const ticketFn = useServerFn(getMarketDatafeedTicket);
  const ticketFnRef = useRef(ticketFn);
  ticketFnRef.current = ticketFn;
  const requested = useMemo(
    () => Array.from(new Set(symbols.filter(isMarketDatafeedSymbol))),
    [symbols],
  );
  const requestedKey = requested.join(",");
  const enabled = requested.length > 0 && !!accountId;
  const [quotes, setQuotes] = useState<QuoteMap>({});
  const [status, setStatus] = useState<MarketDatafeedStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const visibleQuotes = useMemo(() => {
    if (!enabled) return {};
    const active = new Set(requestedKey.split(",").filter(Boolean));
    return Object.fromEntries(
      Object.entries(quotes).filter(([symbol]) => active.has(symbol)),
    ) as QuoteMap;
  }, [enabled, quotes, requestedKey]);

  useEffect(() => {
    if (!enabled) {
      setQuotes({});
      setStatus("idle");
      setError(null);
      return;
    }

    setQuotes({});
    let cancelled = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stale: ReturnType<typeof setTimeout> | null = null;
    let pong: ReturnType<typeof setTimeout> | null = null;
    let retryMs = RETRY_BASE_MS;
    let lastTs = 0;
    let connecting = false;
    let terminalError = false;
    let offline = typeof navigator !== "undefined" && navigator.onLine === false;
    const effectSymbols = requestedKey.split(",").filter(Boolean) as MarketDatafeedTerminalSymbol[];
    const terminalSymbols = new Set<MarketDatafeedTerminalSymbol>(effectSymbols);
    const vpsSymbols = effectSymbols
      .map((symbol) => marketDatafeedVpsSymbol(symbol))
      .filter((value): value is string => Boolean(value));

    const clearStale = () => {
      if (!stale) return;
      clearTimeout(stale);
      stale = null;
    };

    const clearRetry = () => {
      if (!retry) return;
      clearTimeout(retry);
      retry = null;
    };

    const clearPong = () => {
      if (!pong) return;
      clearTimeout(pong);
      pong = null;
    };

    const dropQuotes = () => {
      setQuotes((current) => {
        const next = { ...current };
        for (const symbol of terminalSymbols) delete next[symbol];
        return next;
      });
    };

    const scheduleStale = () => {
      clearStale();
      stale = setTimeout(() => {
        stale = null;
        if (cancelled) return;
        dropQuotes();
        setStatus("stale");
        const current = socket;
        if (!current) return;
        try {
          current.send(JSON.stringify({ action: "ping" }));
        } catch {
          try {
            current.close();
          } catch {
            return;
          }
          return;
        }
        clearPong();
        pong = setTimeout(() => {
          pong = null;
          if (cancelled || socket !== current) return;
          try {
            current.close();
          } catch {
            return;
          }
        }, PONG_TIMEOUT_MS);
      }, MARKETDATA_STALE_MS);
    };

    const scheduleRetry = () => {
      if (cancelled || offline || retry) return;
      retry = setTimeout(() => {
        retry = null;
        retryMs = Math.min(RETRY_MAX_MS, retryMs * 2);
        void connect();
      }, retryMs);
    };

    async function connect(): Promise<void> {
      if (cancelled || offline || connecting) return;
      connecting = true;
      setStatus((current) =>
        current === "idle" || current === "error" ? "connecting" : "reconnecting",
      );
      setError(null);

      try {
        const ticket = await ticketFnRef.current({ data: { accountId: accountId! } });
        if (cancelled || offline) return;

        const endpoint = `${MARKETDATA_WS_URL}?token=${encodeURIComponent(ticket.ticket)}`;
        const next = new WebSocket(endpoint);
        socket = next;
        lastTs = 0;

        next.addEventListener("open", () => {
          if (cancelled || socket !== next) return;
          setStatus("connecting");
        });

        next.addEventListener("message", (event) => {
          if (cancelled || socket !== next || typeof event.data !== "string") return;

          let payload: unknown;
          try {
            payload = JSON.parse(event.data);
          } catch {
            return;
          }
          if (!isRecord(payload)) return;

          const eventName = payload["event"];
          if (eventName === "connected") {
            const data = payload["data"];
            if (isRecord(data) && data["protocol"] !== "market-data-v1") return;
            lastTs = 0;
            retryMs = RETRY_BASE_MS;
            clearPong();
            next.send(
              JSON.stringify({
                action: "subscribe",
                symbols: vpsSymbols,
                channels: ["tick"],
              }),
            );
            scheduleStale();
            return;
          }

          if (eventName === "error") {
            const data = payload["data"];
            const message =
              isRecord(data) && typeof data["message"] === "string"
                ? data["message"]
                : "MarketDatafeed error";
            dropQuotes();
            setError(message);
            setStatus("error");
            terminalError = true;
            clearPong();
            try {
              next.close();
            } catch {
              return;
            }
            return;
          }

          if (eventName === "pong") {
            clearPong();
            scheduleStale();
            return;
          }

          if (eventName !== "tick") return;

          const tick = parseMarketDatafeedTick(payload["data"]);
          if (!tick || !terminalSymbols.has(tick.terminalSymbol)) return;
          if (tick.ts <= lastTs) return;

          lastTs = tick.ts;
          clearPong();
          setQuotes((current) => ({
            ...current,
            [tick.terminalSymbol]: marketDatafeedQuote(tick),
          }));
          setStatus("live");
          setError(null);
          scheduleStale();
        });

        next.addEventListener("close", (event) => {
          if (socket !== next) return;
          socket = null;
          clearStale();
          clearPong();
          dropQuotes();
          if (cancelled) return;
          if (terminalError) {
            setStatus("error");
            return;
          }
          if (event.code === 1008) {
            setError("MarketDatafeed authorization failed");
            setStatus("error");
            return;
          }
          setStatus("reconnecting");
          scheduleRetry();
        });

        next.addEventListener("error", () => {
          try {
            next.close();
          } catch {
            return;
          }
        });
      } catch (ticketError) {
        if (cancelled || offline) return;
        setError(ticketError instanceof Error ? ticketError.message : "MarketDatafeed unavailable");
        setStatus("error");
        if (!isPermanentTicketError(ticketError)) scheduleRetry();
      } finally {
        connecting = false;
      }
    }

    const goOffline = () => {
      offline = true;
      clearRetry();
      clearStale();
      clearPong();
      if (socket) {
        const current = socket;
        socket = null;
        try {
          current.close();
        } catch {
          return;
        }
      }
      dropQuotes();
      setStatus("disconnected");
    };

    const goOnline = () => {
      if (cancelled) return;
      offline = false;
      retryMs = RETRY_BASE_MS;
      clearRetry();
      if (!socket) void connect();
    };

    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    void connect();

    return () => {
      cancelled = true;
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      clearRetry();
      clearStale();
      clearPong();
      if (socket) {
        const current = socket;
        socket = null;
        try {
          current.close();
        } catch {
          return;
        }
      }
    };
  }, [enabled, accountId, requestedKey]);

  return { quotes: visibleQuotes, status, error };
}
