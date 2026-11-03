import { describe, expect, it, vi } from "vitest";
import { handleFeedStatusRequest } from "@/lib/feed-status.server";
import type { FeedStatus } from "@/lib/market-feed";
import type { FeedRuntimeEnv } from "@/lib/market-feed.server";

const STATUS: FeedStatus = {
  feedId: "exness-vps-01",
  lastIngestAt: 1_700_000_000_000,
  lastSentAt: 1_700_000_000_000,
  quoteCount: 20,
  seriesCount: 180,
  stale: false,
  quoteSnapshotAt: 1_700_000_000_000,
  rowsWrittenToday: 42_000,
  rowsWrittenPerDayEstimate: 38_000,
  missing: [],
  series: [{ symbol: "EURUSD", interval: "1min", latest: 1_700_000_000 }],
};

function feedEnv(status: FeedStatus = STATUS): {
  env: FeedRuntimeEnv;
  fetch: ReturnType<typeof vi.fn>;
} {
  const fetch = vi.fn(
    async (_request: Request) =>
      new Response(JSON.stringify(status), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  return {
    fetch,
    env: {
      ALLOW_DEV_FEED: "true",
      MARKET_STREAM: {
        idFromName: () => "feed-id",
        get: () => ({ fetch }),
      },
    },
  };
}

describe("feed status route", () => {
  it("returns rows-written telemetry and fallback state", async () => {
    const { env } = feedEnv();
    const response = await handleFeedStatusRequest(
      new Request("https://vantor.example.com/feed-status"),
      env,
    );

    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({
      quoteCount: 20,
      rowsWrittenToday: 42_000,
      rowsWrittenPerDayEstimate: 38_000,
      fallbackActive: false,
    });
  });

  it("reports fallback when the feed is stale or has no quotes", async () => {
    const { env } = feedEnv({ ...STATUS, stale: true });
    const stale = await handleFeedStatusRequest(
      new Request("https://vantor.example.com/feed-status"),
      env,
    );
    expect(await stale?.json()).toMatchObject({ fallbackActive: true });
  });

  it("hides the route when disabled and rejects other methods", async () => {
    const { env } = feedEnv();
    const disabled = await handleFeedStatusRequest(
      new Request("https://vantor.example.com/feed-status"),
      { ...env, ALLOW_DEV_FEED: "false" },
    );
    expect(disabled?.status).toBe(404);

    const wrongMethod = await handleFeedStatusRequest(
      new Request("https://vantor.example.com/feed-status", { method: "POST" }),
      env,
    );
    expect(wrongMethod?.status).toBe(405);
    expect(wrongMethod?.headers.get("allow")).toBe("GET");
  });

  it("returns 503 when the feed storage is unavailable", async () => {
    const env: FeedRuntimeEnv = {
      ALLOW_DEV_FEED: "true",
      MARKET_STREAM: {
        idFromName: () => "feed-id",
        get: () => ({
          fetch: async () => new Response(JSON.stringify({ error: "down" }), { status: 500 }),
        }),
      },
    };
    const response = await handleFeedStatusRequest(
      new Request("https://vantor.example.com/feed-status"),
      env,
    );
    expect(response?.status).toBe(503);
  });

  it("ignores unrelated paths", async () => {
    const { env } = feedEnv();
    const response = await handleFeedStatusRequest(
      new Request("https://vantor.example.com/health"),
      env,
    );
    expect(response).toBeNull();
  });
});
