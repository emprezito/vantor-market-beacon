import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMeridianQuotes } from "@/hooks/use-meridian-quotes";

const mocks = vi.hoisted(() => ({ tokenFn: vi.fn() }));

vi.mock("@/lib/realtime.functions", () => ({ getMeridianWsToken: mocks.tokenFn }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));

type Listener = (event: Event & { data?: string; code?: number }) => void;

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  readyState = FakeWebSocket.OPEN;
  sent: string[] = [];
  listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(name: string, listener: Listener) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }

  send(value: string) {
    this.sent.push(value);
  }

  close(code = 1000) {
    this.readyState = 3;
    this.emit("close", { code });
  }

  emit(name: string, values: { data?: string; code?: number } = {}) {
    const event = { type: name, ...values } as Event & { data?: string; code?: number };
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }

  message(value: unknown) {
    this.emit("message", { data: JSON.stringify(value) });
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  mocks.tokenFn.mockReset();
  mocks.tokenFn.mockResolvedValue({
    token: "short-lived-token",
    expiresAt: Date.now() + 120_000,
    wsUrl: "wss://meridian.example/ws/v1/market",
    subscriptions: { EURUSD: "EURUSD" },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useMeridianQuotes", () => {
  it("connects with a short-lived token, subscribes, and maps ticks", async () => {
    const { result } = renderHook(() => useMeridianQuotes(["EURUSD"], "account-1"));
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;
    expect(socket.url).toContain("token=short-lived-token");

    act(() => {
      socket.emit("open");
      socket.message({ event: "connected", data: { protocol: "market-data-v1" } });
    });
    expect(JSON.parse(socket.sent[0]!)).toEqual({
      action: "subscribe",
      symbols: ["EURUSD"],
      channels: ["tick"],
    });

    act(() => {
      socket.message({ event: "subscribed", data: { symbols: ["EURUSD"], channels: ["tick"] } });
      socket.message({
        event: "tick",
        data: {
          provider: "MT5",
          symbol: "EURUSD",
          bid: 1.1,
          ask: 1.1002,
          timestamp_ms: Date.now(),
        },
      });
    });

    expect(result.current.status).toBe("live");
    expect(result.current.quotes["EURUSD"]).toMatchObject({
      bid: 1.1,
      ask: 1.1002,
      mid: 1.1001,
      feed: "meridian",
    });
  });

  it("stays idle without an account", () => {
    const { result } = renderHook(() => useMeridianQuotes(["EURUSD"], null));
    expect(result.current).toEqual({ quotes: {}, status: "idle", error: null });
    expect(mocks.tokenFn).not.toHaveBeenCalled();
  });
});
