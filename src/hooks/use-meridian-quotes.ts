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

function permanentTokenError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /not configured|invalid api key|unauthorized|not active/i.test(message);
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
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let pongTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let connecting = false;
    let offline = typeof navigator !== "undefined" && navigator.onLine === false;

    const clearTimer = (timer: ReturnType<typeof setTimeout> | null) => {
      if (timer) clearTimeout(timer);
    };

    const clearConnectionTimers = () => {
      clearTimer(idleTimer);
      clearTimer(pongTimer);
      clearTimer(expiryTimer);
      idleTimer = null;
      pongTimer = null;
      expiryTimer = null;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
    };

    const sendPing = (current: WebSocket) => {
      if (current.readyState !== WebSocket.OPEN) return;
      try {
        current.send(JSON.stringify({ action: "ping" }));
      } catch {
        current.close();
        return;
      }
      clearTimer(pongTimer);
      pongTimer = setTimeout(() => {
        if (cancelled || socket !== current) return;
        current.close();
      }, PONG_TIMEOUT_MS);
    };

    const scheduleIdle = (current: WebSocket) => {
      clearTimer(idleTimer);
      idleTimer = setTimeout(() => {
        if (cancelled || socket !== current) return;
        setStatus("stale");
        sendPing(current);
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

    async function connect(): Promise<void> {
      if (cancelled || offline || connecting) return;
      connecting = true;
      setStatus((current) => (current === "idle" ? "connecting" : "reconnecting"));
      setError(null);

      try {
        const ticket = await tokenFnRef.current({
          data: { accountId: accountId!, symbols: requestedKey.split(",") },
        });
        if (cancelled || offline) return;

        const internalToProvider = ticket.subscriptions;
        const providerToInternal = new Map(
          Object.entries(internalToProvider).map(([internal, provider]) => [provider, internal]),
        );
        const providerSymbols = Array.from(new Set(Object.values(internalToProvider)));
        const endpoint = new URL(ticket.wsUrl);
        endpoint.searchParams.set("token", ticket.token);
        const next = new WebSocket(endpoint.toString());
        socket = next;

        next.addEventListener("open", () => {
          if (cancelled || socket !== next) return;
          setStatus("connecting");
          const closeAt = Math.max(0, ticket.expiresAt - Date.now() - 1_000);
          expiryTimer = setTimeout(() => {
            if (!cancelled && socket === next) next.close(1000, "token refresh");
          }, closeAt);
          heartbeat = setInterval(() => sendPing(next), HEARTBEAT_MS);
          scheduleIdle(next);
        });

        next.addEventListener("message", (event) => {
          if (cancelled || socket !== next || typeof event.data !== "string") return;
          let parsed: unknown;
          try {
            parsed = JSON.parse(event.data);
          } catch {
            return;
          }
          const message = parseMeridianStreamMessage(parsed);
          if (!message) return;
          clearTimer(pongTimer);
          pongTimer = null;
          scheduleIdle(next);

          if (message.event === "connected") {
            next.send(
              JSON.stringify({ action: "subscribe", symbols: providerSymbols, channels: ["tick"] }),
            );
            return;
          }
          if (message.event === "subscribed") {
            attempt = 0;
            setStatus("live");
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
            setStatus(data["code"] === "symbol_not_entitled" ? "error" : "reconnecting");
            return;
          }
          if (message.event !== "tick") return;

          const tick = parseMeridianQuote(message.data);
          if (!tick) return;
          const internal = providerToInternal.get(tick.symbol);
          if (!internal) return;
          setQuotes((current) => ({
            ...current,
            [internal]: marketQuoteFromMeridian(tick, internal),
          }));
          setStatus("live");
          setError(null);
        });

        next.addEventListener("close", (event) => {
          if (socket !== next) return;
          socket = null;
          clearConnectionTimers();
          if (cancelled) return;
          setStatus(event.code === 1008 ? "unauthorized" : "reconnecting");
          if (event.code === 1008) setError("Meridian stream authorization expired");
          scheduleRetry();
        });

        next.addEventListener("error", () => {
          try {
            next.close();
          } catch {
            return;
          }
        });
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
      clearConnectionTimers();
      if (socket) {
        const current = socket;
        socket = null;
        current.close();
      }
      setStatus("disconnected");
    };

    const goOnline = () => {
      if (cancelled) return;
      offline = false;
      attempt = 0;
      void connect();
    };

    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    void connect();

    return () => {
      cancelled = true;
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      clearTimer(retryTimer);
      clearConnectionTimers();
      if (socket) socket.close();
    };
  }, [enabled, accountId, requestedKey]);

  return { quotes: visibleQuotes, status, error };
}
