import { FEED_STATUS_PATH, type FeedStatus } from "./market-feed";
import { feedEnabled, loadFeedStatus, type FeedRuntimeEnv } from "./market-feed.server";

type FeedStatusPayload = FeedStatus & {
  fallbackActive: boolean;
  checkedAt: number;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function handleFeedStatusRequest(
  request: Request,
  env: FeedRuntimeEnv,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== FEED_STATUS_PATH) return null;
  if (!feedEnabled(env)) return json({ error: "not_found" }, 404);
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: {
        "content-type": "application/json; charset=utf-8",
        allow: "GET",
        "cache-control": "no-store",
      },
    });
  }

  const status = await loadFeedStatus(env).catch(() => null);
  if (!status) return json({ error: "feed_unavailable" }, 503);
  const payload: FeedStatusPayload = {
    ...status,
    fallbackActive: status.stale || status.quoteCount === 0,
    checkedAt: Date.now(),
  };
  return json(payload);
}
