import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { verifyRealtimeTicket } from "./lib/realtime-ticket";
import { handleTerminalApi } from "./lib/terminal-api/router";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

type DurableObjectStub = {
  fetch: (request: Request) => Promise<Response>;
};

type DurableObjectNamespace = {
  idFromName: (name: string) => unknown;
  get: (id: unknown) => DurableObjectStub;
};

type WorkerEnv = {
  MARKET_STREAM?: DurableObjectNamespace;
  REALTIME_TICKET_SECRET?: string;
  TERMINAL_TOKEN_SECRET?: string;
  ALLOWED_ORIGINS?: string;
  ALLOW_DEV_ORIGINS?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

type RealtimeGlobals = typeof globalThis & {
  __env__?: WorkerEnv;
};

const REALTIME_PATH = "/api/realtime/markets";
const REALTIME_INSTANCE = "markets-v2";

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

async function handleRealtimeRequest(request: Request, env: WorkerEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== REALTIME_PATH) return null;

  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }

  const secret = env.REALTIME_TICKET_SECRET;
  if (!secret) return new Response("Realtime streaming is not configured", { status: 503 });

  const ticket = url.searchParams.get("ticket");
  if (!ticket) return new Response("Missing realtime ticket", { status: 401 });

  try {
    const claims = await verifyRealtimeTicket(ticket, secret);
    if (!claims) return new Response("Invalid realtime ticket", { status: 401 });
  } catch {
    return new Response("Invalid realtime ticket", { status: 401 });
  }

  const namespace = env.MARKET_STREAM;
  if (!namespace) return new Response("Realtime streaming is not available", { status: 503 });

  const stub = namespace.get(namespace.idFromName(REALTIME_INSTANCE));
  return stub.fetch(request);
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
      const runtimeEnv = (globalThis as RealtimeGlobals).__env__ ?? ((env ?? {}) as WorkerEnv);
      const terminal = await handleTerminalApi(request, runtimeEnv, REALTIME_INSTANCE);
      if (terminal) return terminal;

      const realtime = await handleRealtimeRequest(request, runtimeEnv);
      if (realtime) return realtime;

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
