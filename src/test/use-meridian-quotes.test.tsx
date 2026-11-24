import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useEffect } from "react";
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
  closedWith: { code: number; reason: string | undefined } | null = null;
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

  close(code = 1000, reason?: string) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closedWith = { code, reason };
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

describe("useMeridianQuotes token renewal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    mocks.tokenFn.mockImplementation(async () => ({
      token: `token-${FakeWebSocket.instances.length + 1}`,
      expiresAt: Date.now() + 20_000,
      wsUrl: "wss://meridian.example/ws/v1/market",
      subscriptions: { EURUSD: "EURUSDm" },
    }));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  async function flush() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it("opens and subscribes a replacement before closing the live socket", async () => {
    const statuses: string[] = [];
    const { result } = renderHook(() => {
      const value = useMeridianQuotes(["EURUSD"], "account-1");
      useEffect(() => {
        statuses.push(value.status);
      }, [value.status]);
      return value;
    });
    await flush();

    expect(FakeWebSocket.instances).toHaveLength(1);
    const first = FakeWebSocket.instances[0]!;
    act(() => {
      first.emit("open");
      first.message({ event: "connected", data: { protocol: "market-data-v1" } });
      first.message({ event: "subscribed", data: { symbols: ["EURUSDm"], channels: ["tick"] } });
    });
    expect(result.current.status).toBe("live");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_100);
    });
    expect(mocks.tokenFn).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(2);
    const second = FakeWebSocket.instances[1]!;
    expect(first.closedWith).toBeNull();
    expect(result.current.status).toBe("live");

    act(() => {
      second.emit("open");
      second.message({ event: "connected", data: { protocol: "market-data-v1" } });
      second.message({
        event: "tick",
        data: {
          provider: "MT5",
          symbol: "EURUSDm",
          bid: 1.2,
          ask: 1.2002,
          timestamp_ms: Date.now(),
        },
      });
    });
    expect(result.current.quotes["EURUSD"]?.bid).toBe(1.2);

    act(() => {
      second.message({ event: "subscribed", data: { symbols: ["EURUSDm"], channels: ["tick"] } });
    });
    expect(first.closedWith?.code).toBe(1000);
    expect(result.current.status).toBe("live");
    expect(statuses).not.toContain("reconnecting");
    expect(statuses).not.toContain("stale");
  });

  it("reconnects after an unexpected socket close", async () => {
    const { result } = renderHook(() => useMeridianQuotes(["EURUSD"], "account-1"));
    await flush();

    const first = FakeWebSocket.instances[0]!;
    act(() => {
      first.emit("open");
      first.message({ event: "connected", data: { protocol: "market-data-v1" } });
      first.message({ event: "subscribed", data: { symbols: ["EURUSDm"], channels: ["tick"] } });
    });
    expect(result.current.status).toBe("live");

    act(() => first.close(1006));
    expect(result.current.status).toBe("reconnecting");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(mocks.tokenFn).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("keeps the live socket open when a renewal fails and retries", async () => {
    let calls = 0;
    mocks.tokenFn.mockImplementation(async () => {
      calls += 1;
      if (calls === 2) throw new Error("Meridian unavailable");
      return {
        token: `token-${calls}`,
        expiresAt: Date.now() + 20_000,
        wsUrl: "wss://meridian.example/ws/v1/market",
        subscriptions: { EURUSD: "EURUSDm" },
      };
    });
    const { result } = renderHook(() => useMeridianQuotes(["EURUSD"], "account-1"));
    await flush();

    const first = FakeWebSocket.instances[0]!;
    act(() => {
      first.emit("open");
      first.message({ event: "connected", data: { protocol: "market-data-v1" } });
      first.message({ event: "subscribed", data: { symbols: ["EURUSDm"], channels: ["tick"] } });
    });
    expect(result.current.status).toBe("live");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_100);
    });
    expect(mocks.tokenFn).toHaveBeenCalledTimes(2);
    expect(first.closedWith).toBeNull();
    expect(result.current.status).toBe("live");

    act(() => first.message({ event: "pong" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_000);
    });
    expect(mocks.tokenFn).toHaveBeenCalledTimes(3);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(first.closedWith).toBeNull();
  });
});
