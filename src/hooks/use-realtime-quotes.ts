import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getRealtimeTicket } from "@/lib/realtime.functions";
import { isRealtimeSymbol, type RealtimeSymbol } from "@/lib/realtime-symbols";
import { withSpread, type QuoteMap } from "@/lib/market-data";

export type RealtimeStatus = "idle" | "connecting" | "live" | "reconnecting";

const REALTIME_PATH = "/api/realtime/markets";
const RETRY_BASE_MS = 3_000;
const RETRY_MAX_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function useRealtimeQuotes(symbols: string[]): {
  quotes: QuoteMap;
  status: RealtimeStatus;
} {
  const ticketFn = useServerFn(getRealtimeTicket);
  const ticketFnRef = useRef(ticketFn);
  ticketFnRef.current = ticketFn;
  const requested = useMemo(() => Array.from(new Set(symbols.filter(isRealtimeSymbol))), [symbols]);
  const requestedRef = useRef(new Set<RealtimeSymbol>(requested));
  requestedRef.current = new Set(requested);
  const enabled = requested.length > 0;
  const [quotes, setQuotes] = useState<QuoteMap>({});
  const [status, setStatus] = useState<RealtimeStatus>("idle");

  useEffect(() => {
    if (!enabled) {
      setQuotes({});
      setStatus("idle");
      return;
    }

    let cancelled = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let retryMs = RETRY_BASE_MS;

    const scheduleRetry = () => {
      if (cancelled) return;
      retry = setTimeout(() => {
        retryMs = Math.min(RETRY_MAX_MS, retryMs * 2);
        void connect();
      }, retryMs);
    };

    const connect = async (): Promise<void> => {
      if (cancelled) return;
      setStatus((current) => (current === "idle" ? "connecting" : "reconnecting"));

      try {
        const ticket = await ticketFnRef.current();
        if (cancelled) return;

        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const endpoint = `${protocol}//${window.location.host}${REALTIME_PATH}?ticket=${encodeURIComponent(ticket.ticket)}`;
        const next = new WebSocket(endpoint);
        socket = next;

        next.addEventListener("open", () => {
          retryMs = RETRY_BASE_MS;
          setStatus("connecting");
        });

        next.addEventListener("message", (event) => {
          if (cancelled || typeof event.data !== "string") return;

          let payload: unknown;
          try {
            payload = JSON.parse(event.data);
          } catch {
            return;
          }
          if (!isRecord(payload)) return;

          const type = payload["type"];
          if (type === "status") {
            if (payload["status"] === "live") {
              setStatus("live");
            } else {
              setQuotes({});
              setStatus("reconnecting");
            }
            return;
          }
          if (type !== "price") return;

          const symbol = payload["symbol"];
          if (typeof symbol !== "string" || !isRealtimeSymbol(symbol)) return;
          if (!requestedRef.current.has(symbol)) return;

          const price = Number(payload["price"]);
          if (!Number.isFinite(price) || price <= 0) return;

          const providerTs = Number(payload["ts"]);
          const ts = Number.isFinite(providerTs) && providerTs > 0 ? providerTs : Date.now();
          setQuotes((current) => ({ ...current, [symbol]: withSpread(symbol, price, ts, "live") }));
          setStatus("live");
        });

        next.addEventListener("close", () => {
          if (socket !== next) return;
          socket = null;
          if (cancelled) return;
          setQuotes({});
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
      } catch {
        if (cancelled) return;
        setStatus("reconnecting");
        scheduleRetry();
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      if (socket) socket.close();
    };
  }, [enabled]);

  return { quotes, status };
}
