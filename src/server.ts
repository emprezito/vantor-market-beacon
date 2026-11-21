import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleBrokerDiscovery } from "./lib/terminal-api/discovery";
import { handleTerminalApi } from "./lib/terminal-api/router";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

type WorkerEnv = {
  MERIDIAN_API_KEY?: string;
  MERIDIAN_API_BASE_URL?: string;
  MERIDIAN_WS_URL?: string;
  MARKET_WS_URL?: string;
  TERMINAL_TOKEN_SECRET?: string;
  PUBLIC_BROKER_BASE_URL?: string;
  ALLOWED_ORIGINS?: string;
  ALLOW_DEV_ORIGINS?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  ALLOW_FALLBACK_TRADING?: string;
};

type RealtimeGlobals = typeof globalThis & {
  __env__?: WorkerEnv;
};

let serverEntry: ServerEntry | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (serverEntry) return serverEntry;
  const module = await import("@tanstack/react-start/server-entry");
  serverEntry = (module.default ?? module) as ServerEntry;
  return serverEntry;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const runtimeEnv = (env ?? {}) as WorkerEnv;
      (globalThis as RealtimeGlobals).__env__ = runtimeEnv;

      const discovery = handleBrokerDiscovery(request, runtimeEnv);
      if (discovery) return discovery;

      const terminal = await handleTerminalApi(request, runtimeEnv);
      if (terminal) return terminal;

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
