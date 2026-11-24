import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getMeridianWsToken } from "@/lib/realtime.functions";
import {
  MERIDIAN_STREAM_IDLE_MS,
  marketQuoteFromMeridian,
  parseMeridianQuote,
  parseMeridianStreamMessage,
} from "@/lib/meridian";
import type { QuoteMap } from "@/lib/market-data";

export type MeridianStreamStatus =
  | "idle"
  | "connecting"
  | "live"
  | "stale"
  | "reconnecting"
  | "disconnected"
  | "unauthorized"
  | "error";

const RETRY_MAX_MS = 30_000;
const HEARTBEAT_MS = 15_000;
const PONG_TIMEOUT_MS = 5_000;
const TOKEN_REFRESH_LEAD_MS = 60_000;
const REFRESH_RETRY_MIN_MS = 5_000;
const REFRESH_RETRY_MAX_MS = 30_000;

type StreamTicket = Awaited<ReturnType<typeof getMeridianWsToken>>;

type StreamConnection = {
  socket: WebSocket;
  providerSymbols: string[];
  providerToInternal: Map<string, string>;
  expiresAt: number;
  closed: boolean;
  promoted: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
  pongTimer: ReturnType<typeof setTimeout> | null;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  heartbeat: ReturnType<typeof setInterval> | null;
};

function permanentTokenError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /not configured|invalid api key|unauthorized|not active/i.test(message);
}

function refreshDelayMs(expiresAt: number, now: number): number {
  const ttl = Math.max(1_000, expiresAt - now);
  if (ttl > TOKEN_REFRESH_LEAD_MS + 10_000) return ttl - TOKEN_REFRESH_LEAD_MS;
  return Math.max(1_000, Math.round(ttl * 0.8));
}

export function useMeridianQuotes(
  symbols: string[],
  accountId: string | null,
): { quotes: QuoteMap; status: MeridianStreamStatus; error: string | null } {
  const tokenFn = useServerFn(getMeridianWsToken);
  const tokenFnRef = useRef(tokenFn);
  tokenFnRef.current = tokenFn;
  const requested = useMemo(() => Array.from(new Set(symbols)).sort(), [symbols]);
  const requestedKey = requested.join(",");
  const enabled = requested.length > 0 && Boolean(accountId);
  const [quotes, setQuotes] = useState<QuoteMap>({});
  const [status, setStatus] = useState<MeridianStreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const visibleQuotes = useMemo(() => {
    const active = new Set(requested);
    return Object.fromEntries(
      Object.entries(quotes).filter(([symbol]) => active.has(symbol)),
    ) as QuoteMap;
  }, [quotes, requested]);

  useEffect(() => {
    if (!enabled) {
      setQuotes({});
      setStatus("idle");
      setError(null);
      return;
    }

    let cancelled = false;
    let active: StreamConnection | null = null;
    let pending: StreamConnection | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let refreshAttempt = 0;
    let connecting = false;
    let renewing = false;
    let offline = typeof navigator !== "undefined" && navigator.onLine === false;

    const clearTimer = (timer: ReturnType<typeof setTimeout> | null) => {
      if (timer) clearTimeout(timer);
    };

    const clearConnectionTimers = (connection: StreamConnection | null) => {
      if (!connection) return;
      clearTimer(connection.idleTimer);
      clearTimer(connection.pongTimer);
      clearTimer(connection.expiryTimer);
      if (connection.heartbeat) clearInterval(connection.heartbeat);
      connection.idleTimer = null;
      connection.pongTimer = null;
      connection.expiryTimer = null;
      connection.heartbeat = null;
    };

    const closeConnection = (
      connection: StreamConnection | null,
      code = 1000,
      reason = "replaced",
    ) => {
      if (!connection) return;
      clearConnectionTimers(connection);
      connection.closed = true;
      try {
        connection.socket.close(code, reason);
      } catch {
        return;
      }
    };

    const sendPing = (connection: StreamConnection) => {
      if (connection.closed || connection.socket.readyState !== WebSocket.OPEN) return;
      try {
        connection.socket.send(JSON.stringify({ action: "ping" }));
      } catch {
        connection.socket.close();
        return;
      }
      clearTimer(connection.pongTimer);
      connection.pongTimer = setTimeout(() => {
        if (connection.closed) return;
        connection.socket.close();
      }, PONG_TIMEOUT_MS);
    };

    const scheduleIdle = (connection: StreamConnection) => {
      clearTimer(connection.idleTimer);
      connection.idleTimer = setTimeout(() => {
        if (connection.closed) return;
        if (active === connection) setStatus("stale");
        sendPing(connection);
      }, MERIDIAN_STREAM_IDLE_MS);
    };

    const scheduleRetry = () => {
      if (cancelled || offline || retryTimer) return;
      const base = Math.min(RETRY_MAX_MS, 1_000 * 2 ** attempt);
      const delay = base + Math.random() * base * 0.35;
      attempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void connect();
      }, delay);
    };

    const scheduleRefreshRetry = () => {
      if (cancelled || offline || refreshTimer) return;
      const base = Math.min(REFRESH_RETRY_MAX_MS, REFRESH_RETRY_MIN_MS * 2 ** refreshAttempt);
      const delay = base + Math.random() * base * 0.35;
      refreshAttempt += 1;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void renew();
      }, delay);
    };

    async function requestTicket(): Promise<StreamTicket> {
      return tokenFnRef.current({
        data: { accountId: accountId!, symbols: requestedKey.split(",") },
      });
    }

    function promote(connection: StreamConnection): void {
      if (cancelled || connection.closed) return;
      const previous = active;
      active = connection;
      pending = null;
      connection.promoted = true;
      attempt = 0;
      refreshAttempt = 0;
      clearTimer(refreshTimer);
      refreshTimer = null;
      setStatus("live");
      setError(null);
      if (previous && previous !== connection) closeConnection(previous);
    }

    async function renew(): Promise<void> {
      if (cancelled || offline || renewing || !active || pending || active.closed) return;
      const current = active;
      renewing = true;
      try {
        const ticket = await requestTicket();
        if (cancelled || offline || active !== current || current.closed || pending) return;
        openConnection(ticket, true);
      } catch (tokenError) {
        if (cancelled || offline || active !== current || current.closed) return;
        const message = tokenError instanceof Error ? tokenError.message : "Meridian unavailable";
        setError(message);
        scheduleRefreshRetry();
      } finally {
        renewing = false;
      }
    }

    function openConnection(ticket: StreamTicket, replacement: boolean): void {
      const endpoint = new URL(ticket.wsUrl);
      endpoint.searchParams.set("token", ticket.token);
      const socket = new WebSocket(endpoint.toString());
      const connection: StreamConnection = {
        socket,
        providerSymbols: Array.from(new Set(Object.values(ticket.subscriptions))),
        providerToInternal: new Map(
          Object.entries(ticket.subscriptions).map(([internal, provider]) => [provider, internal]),
        ),
        expiresAt: ticket.expiresAt,
        closed: false,
        promoted: false,
        idleTimer: null,
        pongTimer: null,
        expiryTimer: null,
        heartbeat: null,
      };
      if (replacement) pending = connection;
      else active = connection;

      socket.addEventListener("open", () => {
        if (cancelled || connection.closed) return;
        if (active === connection && !connection.promoted) setStatus("connecting");
        connection.expiryTimer = setTimeout(
          () => {
            if (connection.closed) return;
            if (active === connection) void renew();
            else socket.close(1000, "renewal superseded");
          },
          refreshDelayMs(connection.expiresAt, Date.now()),
        );
        connection.heartbeat = setInterval(() => sendPing(connection), HEARTBEAT_MS);
        scheduleIdle(connection);
      });

      socket.addEventListener("message", (event) => {
        if (cancelled || connection.closed || typeof event.data !== "string") return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return;
        }
        const message = parseMeridianStreamMessage(parsed);
        if (!message) return;
        clearTimer(connection.pongTimer);
        connection.pongTimer = null;
        scheduleIdle(connection);

        if (message.event === "connected") {
          socket.send(
            JSON.stringify({
              action: "subscribe",
              symbols: connection.providerSymbols,
              channels: ["tick"],
            }),
          );
          return;
        }
        if (message.event === "subscribed") {
          if (pending === connection) promote(connection);
          if (active === connection) {
            attempt = 0;
            refreshAttempt = 0;
            setStatus("live");
          }
          return;
        }
        if (message.event === "pong") return;
        if (message.event === "error") {
          const data =
            typeof message.data === "object" && message.data !== null
              ? (message.data as Record<string, unknown>)
              : {};
          const text =
            typeof data["message"] === "string" ? data["message"] : "Meridian stream error";
          setError(text);
          if (active === connection) {
            setStatus(data["code"] === "symbol_not_entitled" ? "error" : "reconnecting");
          } else if (pending === connection) {
            closeConnection(connection, 1000, "renewal failed");
            scheduleRefreshRetry();
          }
          return;
        }
        if (message.event !== "tick") return;
        if (active !== connection && pending !== connection) return;

        const tick = parseMeridianQuote(message.data);
        if (!tick) return;
        const internal = connection.providerToInternal.get(tick.symbol);
        if (!internal) return;
        setQuotes((current) => {
          const next = marketQuoteFromMeridian(tick, internal);
          const previous = current[internal];
          if (previous && next.ts < previous.ts) return current;
          return { ...current, [internal]: next };
        });
        setStatus("live");
        setError(null);
      });

      socket.addEventListener("close", (event) => {
        if (connection.closed) return;
        connection.closed = true;
        clearConnectionTimers(connection);
        if (pending === connection) {
          pending = null;
          if (!cancelled && !offline && active && !active.closed) scheduleRefreshRetry();
          return;
        }
        if (active !== connection) return;
        active = null;
        clearTimer(refreshTimer);
        refreshTimer = null;
        refreshAttempt = 0;
        if (cancelled) return;
        if (pending) {
          active = pending;
          active.promoted = true;
          pending = null;
          setStatus("reconnecting");
          return;
        }
        setStatus(event.code === 1008 ? "unauthorized" : "reconnecting");
        if (event.code === 1008) setError("Meridian stream authorization expired");
        scheduleRetry();
      });

      socket.addEventListener("error", () => {
        try {
          socket.close();
        } catch {
          return;
        }
      });
    }

    async function connect(): Promise<void> {
      if (cancelled || offline || connecting || active || pending) return;
      connecting = true;
      setStatus((current) => (current === "idle" ? "connecting" : "reconnecting"));
      setError(null);

      try {
        const ticket = await requestTicket();
        if (cancelled || offline) return;
        openConnection(ticket, false);
      } catch (tokenError) {
        if (cancelled || offline) return;
        const message = tokenError instanceof Error ? tokenError.message : "Meridian unavailable";
        setError(message);
        if (permanentTokenError(tokenError)) {
          setStatus("unauthorized");
        } else {
          setStatus("reconnecting");
          scheduleRetry();
        }
      } finally {
        connecting = false;
      }
    }

    const goOffline = () => {
      offline = true;
      clearTimer(retryTimer);
      retryTimer = null;
      clearTimer(refreshTimer);
      refreshTimer = null;
      const connections = [active, pending];
      active = null;
      pending = null;
      for (const connection of connections) closeConnection(connection);
      setStatus("disconnected");
    };

    const goOnline = () => {
      if (cancelled) return;
      offline = false;
      attempt = 0;
      refreshAttempt = 0;
      if (!active && !pending) void connect();
    };

    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    void connect();

    return () => {
      cancelled = true;
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      clearTimer(retryTimer);
      clearTimer(refreshTimer);
      closeConnection(active);
      closeConnection(pending);
      active = null;
      pending = null;
    };
  }, [enabled, accountId, requestedKey]);

  return { quotes: visibleQuotes, status, error };
}
