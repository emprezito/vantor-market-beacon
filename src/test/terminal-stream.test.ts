import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadQuotes } from "@/lib/market-data.server";
import {
  meridianProviderSymbols,
  meridianWsUrl,
  requestMeridianWsToken,
} from "@/lib/meridian.server";
import { authenticateTerminalStreamRequest } from "@/lib/terminal-api/auth";
import { brokerStream } from "@/lib/terminal-api/stream";
import { terminalAdmin } from "@/lib/terminal-api/supabase";
import type { TerminalEnv } from "@/lib/terminal-api/types";

vi.mock("@/lib/market-data.server", () => ({ loadQuotes: vi.fn() }));
vi.mock("@/lib/meridian.server", () => ({
  meridianProviderSymbols: vi.fn(),
  meridianWsUrl: vi.fn(),
  requestMeridianWsToken: vi.fn(),
}));
vi.mock("@/lib/terminal-api/auth", () => ({
  authenticateTerminalStreamRequest: vi.fn(),
}));
vi.mock("@/lib/terminal-api/supabase", () => ({ terminalAdmin: vi.fn() }));

type Listener = (event: { data?: string }) => void;

class FakeSocket {
  readyState = 1;
  sent: string[] = [];
  closedWith: { code: number | undefined; reason: string | undefined } | null = null;
  private listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(data: unknown) {
    this.sent.push(String(data));
  }

  close(code?: number, reason?: string) {
    if (this.closedWith) return;
    this.readyState = 3;
    this.closedWith = { code, reason };
    this.emit("close", {});
  }

  emitMessage(frame: unknown) {
    this.emit("message", { data: JSON.stringify(frame) });
  }

  private emit(type: string, event: { data?: string }) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("Pocket broker stream renewal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    vi.mocked(loadQuotes).mockResolvedValue({});
    vi.mocked(meridianProviderSymbols).mockResolvedValue(new Map([["EURUSD", "EURUSDm"]]));
    vi.mocked(meridianWsUrl).mockReturnValue("wss://meridian.test/ws");
    vi.mocked(terminalAdmin).mockReturnValue({} as never);
    vi.mocked(authenticateTerminalStreamRequest).mockResolvedValue({
      account: {
        id: "11111111-1111-4111-8111-111111111111",
        server_id: "22222222-2222-4222-8222-222222222222",
      },
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("subscribes a replacement before closing the active Meridian socket", async () => {
    const upstreams: FakeSocket[] = [];
    let server: FakeSocket | null = null;
    let tokenNumber = 0;

    class FakeUpstreamSocket extends FakeSocket {
      static readonly OPEN = 1;

      constructor(_url: string) {
        super();
        upstreams.push(this);
      }
    }

    function FakeWebSocketPair() {
      server = new FakeSocket();
      return { 0: new FakeSocket(), 1: server };
    }

    class FakeResponse {
      readonly status: number;
      readonly webSocket: unknown;

      constructor(_body: unknown, init?: ResponseInit & { webSocket?: unknown }) {
        this.status = init?.status ?? 200;
        this.webSocket = init?.webSocket;
      }
    }

    vi.stubGlobal("WebSocket", FakeUpstreamSocket);
    vi.stubGlobal("WebSocketPair", FakeWebSocketPair);
    vi.stubGlobal("Response", FakeResponse);
    vi.mocked(requestMeridianWsToken).mockImplementation(async () => ({
      token: `token-${++tokenNumber}`,
      expires_at: Date.now() + 20_000,
    }));

    const response = await brokerStream(
      new Request("https://vantor.test/api/v1/terminal/stream?symbols=EURUSD", {
        headers: { upgrade: "websocket" },
      }),
      {} as TerminalEnv,
    );
    await Promise.resolve();

    expect(response.status).toBe(101);
    expect(upstreams).toHaveLength(1);
    expect(server).not.toBeNull();
    const active = upstreams[0]!;

    active.emitMessage({ event: "connected" });
    expect(JSON.parse(active.sent.at(-1)!)).toMatchObject({
      action: "subscribe",
      symbols: ["EURUSDm"],
    });
    active.emitMessage({ event: "subscribed" });

    for (let tick = 1; tick <= 4; tick += 1) {
      await vi.advanceTimersByTimeAsync(4_000);
      active.emitMessage({
        event: "tick",
        data: {
          symbol: "EURUSDm",
          bid: 1.08 + tick / 10_000,
          ask: 1.081 + tick / 10_000,
          timestamp_ms: Date.now(),
        },
      });
    }

    expect(upstreams).toHaveLength(2);
    const replacement = upstreams[1]!;
    expect(active.closedWith).toBeNull();

    replacement.emitMessage({ event: "connected" });
    expect(JSON.parse(replacement.sent.at(-1)!)).toMatchObject({
      action: "subscribe",
      symbols: ["EURUSDm"],
    });
    expect(active.closedWith).toBeNull();

    replacement.emitMessage({ event: "subscribed" });
    expect(active.closedWith).toEqual({ code: 1000, reason: "replaced" });
    expect(replacement.closedWith).toBeNull();

    const states = server!.sent
      .map((frame) => JSON.parse(frame) as { type?: string; state?: string })
      .filter((frame) => frame.type === "status")
      .map((frame) => frame.state);
    expect(states).toContain("live");
    expect(states).not.toContain("stale");
    expect(states).not.toContain("reconnecting");

    server!.close(1000, "test complete");
  });
});
