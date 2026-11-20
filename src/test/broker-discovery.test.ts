import { describe, expect, it } from "vitest";
import { handleBrokerDiscovery } from "@/lib/terminal-api/discovery";

const productionEnv = {
  PUBLIC_BROKER_BASE_URL: "https://api.vantor.example",
};

describe("Pocket broker discovery", () => {
  it("publishes Vantor as a pocket.broker.v1 implementation", async () => {
    const response = handleBrokerDiscovery(
      new Request("https://worker.example/.well-known/pocket-broker.json"),
      productionEnv,
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("access-control-allow-origin")).toBe("*");
    const payload = (await response?.json()) as Record<string, unknown>;
    expect(payload).toMatchObject({
      manifestVersion: 1,
      protocol: "pocket.broker.v1",
      protocolVersions: ["pocket.broker.v1"],
      broker: { id: "vantor", name: "Vantor" },
      api: {
        baseUrl: "https://api.vantor.example/api/v1/terminal",
        instruments: "https://api.vantor.example/api/v1/terminal/instruments",
        streamTicket: "https://api.vantor.example/api/v1/terminal/stream-ticket",
      },
      authentication: {
        type: "broker-account",
        tokenType: "bearer",
        roles: ["trader", "investor"],
      },
      streaming: { transport: "websocket", staleAfterMs: 5_000 },
    });
    expect(JSON.stringify(payload)).not.toMatch(/meridian/i);
  });

  it("falls back to the request origin for unconfigured environments", async () => {
    const response = handleBrokerDiscovery(
      new Request("http://localhost:5173/.well-known/pocket-broker.json"),
      {},
    );
    const payload = (await response?.json()) as { api: { baseUrl: string } };
    expect(payload.api.baseUrl).toBe("http://localhost:5173/api/v1/terminal");
  });

  it("supports manifest probes and rejects unsupported methods", async () => {
    const head = handleBrokerDiscovery(
      new Request("https://worker.example/.well-known/pocket-broker.json", { method: "HEAD" }),
      productionEnv,
    );
    expect(head?.status).toBe(200);
    expect(await head?.text()).toBe("");

    const post = handleBrokerDiscovery(
      new Request("https://worker.example/.well-known/pocket-broker.json", { method: "POST" }),
      productionEnv,
    );
    expect(post?.status).toBe(405);
    expect(post?.headers.get("allow")).toBe("GET, HEAD");
  });

  it("rejects an invalid configured public broker URL", async () => {
    const response = handleBrokerDiscovery(
      new Request("https://worker.example/.well-known/pocket-broker.json"),
      { PUBLIC_BROKER_BASE_URL: "https://api.vantor.example/unexpected-path" },
    );
    expect(response?.status).toBe(503);
    expect(await response?.json()).toEqual({
      error: "not_configured",
      message: "Broker public URL must be an origin",
    });
  });

  it("requires HTTPS outside local development", async () => {
    const response = handleBrokerDiscovery(
      new Request("https://worker.example/.well-known/pocket-broker.json"),
      { PUBLIC_BROKER_BASE_URL: "http://api.vantor.example" },
    );
    expect(response?.status).toBe(503);
    expect(await response?.json()).toEqual({
      error: "not_configured",
      message: "Broker public URL must use HTTPS",
    });
  });

  it("ignores unrelated paths", () => {
    expect(
      handleBrokerDiscovery(new Request("https://worker.example/api/v1/terminal/servers"), {}),
    ).toBeNull();
  });
});
