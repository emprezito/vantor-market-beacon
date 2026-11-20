import {
  BROKER_CAPABILITIES,
  BROKER_ID,
  BROKER_MANIFEST_PATH,
  BROKER_NAME,
  BROKER_QUOTE_STALE_MS,
  POCKET_BROKER_PROTOCOL,
  terminalBaseUrl,
} from "./broker";
import { ApiError } from "./errors";
import type { TerminalEnv } from "./types";

function response(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": status >= 400 ? "no-store" : "public, max-age=300",
      "access-control-allow-origin": "*",
      ...headers,
    },
  });
}

export function brokerManifest(request: Request, env: TerminalEnv) {
  const baseUrl = terminalBaseUrl(request, env);
  return {
    manifestVersion: 1,
    protocol: POCKET_BROKER_PROTOCOL,
    protocolVersions: [POCKET_BROKER_PROTOCOL],
    broker: {
      id: BROKER_ID,
      name: BROKER_NAME,
    },
    api: {
      baseUrl,
      servers: `${baseUrl}/servers`,
      login: `${baseUrl}/login`,
      account: `${baseUrl}/account`,
      instruments: `${baseUrl}/instruments`,
      quotes: `${baseUrl}/quotes`,
      candles: `${baseUrl}/candles`,
      streamTicket: `${baseUrl}/stream-ticket`,
    },
    authentication: {
      type: "broker-account",
      tokenType: "bearer",
      roles: ["trader", "investor"],
    },
    streaming: {
      transport: "websocket",
      staleAfterMs: BROKER_QUOTE_STALE_MS,
    },
    capabilities: BROKER_CAPABILITIES,
  };
}

export function handleBrokerDiscovery(request: Request, env: TerminalEnv): Response | null {
  const url = new URL(request.url);
  if (url.pathname !== BROKER_MANIFEST_PATH) return null;

  if (request.method !== "GET" && request.method !== "HEAD") {
    return response({ error: "method_not_allowed", message: "Method not allowed" }, 405, {
      allow: "GET, HEAD",
    });
  }

  try {
    const manifest = brokerManifest(request, env);
    if (request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=300",
          "access-control-allow-origin": "*",
        },
      });
    }
    return response(manifest);
  } catch (error) {
    const api =
      error instanceof ApiError
        ? error
        : new ApiError(500, "service_unavailable", "Broker discovery failed");
    return response({ error: api.code, message: api.message }, api.status, api.headers);
  }
}
