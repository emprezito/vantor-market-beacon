import { MERIDIAN_QUOTE_STALE_MS } from "@/lib/meridian";
import { ApiError } from "./errors";
import type { TerminalEnv } from "./types";

export const TERMINAL_PREFIX = "/api/v1/terminal";
export const POCKET_BROKER_PROTOCOL = "pocket.broker.v1";
export const BROKER_ID = "vantor";
export const BROKER_NAME = "Vantor";
export const BROKER_MANIFEST_PATH = "/.well-known/pocket-broker.json";
export const BROKER_QUOTE_STALE_MS = MERIDIAN_QUOTE_STALE_MS;

export const BROKER_CAPABILITIES = [
  "market-orders",
  "limit-orders",
  "stop-loss",
  "take-profit",
  "position-close",
  "investor-access",
  "candles",
  "live-quotes",
] as const;

export function publicBrokerOrigin(request: Request, env: TerminalEnv): string {
  const configured = env.PUBLIC_BROKER_BASE_URL?.trim();
  if (!configured) return new URL(request.url).origin;

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new ApiError(503, "not_configured", "Broker public URL is invalid");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new ApiError(503, "not_configured", "Broker public URL must use HTTPS");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new ApiError(503, "not_configured", "Broker public URL must be an origin");
  }
  return url.origin;
}

export function terminalBaseUrl(request: Request, env: TerminalEnv): string {
  return `${publicBrokerOrigin(request, env)}${TERMINAL_PREFIX}`;
}

export function streamUrl(request: Request, env: TerminalEnv, ticket: string): string {
  const url = new URL(`${terminalBaseUrl(request, env)}/stream`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("ticket", ticket);
  return url.toString();
}
