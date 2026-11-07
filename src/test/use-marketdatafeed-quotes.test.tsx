import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MARKETDATA_STALE_MS } from "@/lib/marketdatafeed";
import { useMarketDatafeedQuotes } from "@/hooks/use-marketdatafeed-quotes";

const { ticketFn } = vi.hoisted(() => ({ ticketFn: vi.fn() }));

vi.mock("@/lib/realtime.functions", () => ({
  getMarketDatafeedTicket: ticketFn,
}));
vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
}));

type Listener = (event: { data?: unknown }) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.emit("close");
  }

  emit(type: string, event: { data?: unknown } = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function connectedMessage() {
  return {
    data: JSON.stringify({ event: "connected", data: { protocol: "market-data-v1" } }),
  };
}

function tickMessage(ts: number, bid = 2400.1, ask = 2400.4) {
  return {
    data: JSON.stringify({
      event: "tick",
      data: { symbol: "XAUUSDM", bid, ask, timestamp_ms: ts },
    }),
  };
}

beforeEach(() => {
  ticketFn.mockReset();
  ticketFn.mockResolvedValue({ ticket: "v1.payload.signature", expiresAt: Date.now() + 120_000 });
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useMarketDatafeedQuotes", () => {
  it("requests a ticket, subscribes to XAUUSDM, and consumes only fresh valid ticks", async () => {
    const { result } = renderHook(() => useMarketDatafeedQuotes(["XAUUSD"], "account-1"));

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;
    expect(socket.url).toBe("wss://data.fundedng.fun/ws/v1/market?token=v1.payload.signature");
    expect(ticketFn).toHaveBeenCalledWith({ data: { accountId: "account-1" } });

    act(() => {
      socket.emit("open");
      socket.emit("message", connectedMessage());
    });

    expect(JSON.parse(socket.sent[0]!)).toEqual({
      action: "subscribe",
      symbols: ["XAUUSDM"],
      channels: ["tick"],
    });

    const now = Date.now();
    act(() => socket.emit("message", tickMessage(now)));
    await waitFor(() => expect(result.current.status).toBe("live"));
    expect(result.current.quotes["XAUUSD"]?.ask).toBe(2400.4);

    act(() => socket.emit("message", tickMessage(now - 1_000, 2300, 2300.4)));
    expect(result.current.quotes["XAUUSD"]?.bid).toBe(2400.1);

    act(() => socket.emit("message", tickMessage(now, 2500, 2400)));
    expect(result.current.quotes["XAUUSD"]?.bid).toBe(2400.1);

    act(() => socket.emit("message", { data: "not-json" }));
    expect(result.current.quotes["XAUUSD"]?.bid).toBe(2400.1);
  });

  it("drops stale quotes and reconnects with a fresh ticket", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const { result } = renderHook(() => useMarketDatafeedQuotes(["XAUUSD"], "account-1"));

    await act(async () => {
      await Promise.resolve();
    });
    const first = FakeWebSocket.instances[0]!;
    act(() => {
      first.emit("open");
      first.emit("message", connectedMessage());
      first.emit("message", tickMessage(now));
    });
    expect(result.current.status).toBe("live");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MARKETDATA_STALE_MS);
    });
    expect(result.current.status).toBe("stale");
    expect(first.closed).toBe(false);
    expect(result.current.quotes["XAUUSD"]).toBeUndefined();

    act(() => first.emit("message", { data: JSON.stringify({ event: "pong" }) }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(first.closed).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MARKETDATA_STALE_MS - 5_000);
    });
    expect(first.closed).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(first.closed).toBe(true);
    expect(result.current.status).toBe("reconnecting");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(ticketFn).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("does not retry when the account is not enabled for the feed", async () => {
    vi.useFakeTimers();
    ticketFn.mockRejectedValue(new Error("Market datafeed is not enabled for this account"));
    const { result } = renderHook(() => useMarketDatafeedQuotes(["XAUUSD"], "account-1"));

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Market datafeed is not enabled for this account");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(ticketFn).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("disconnects when the account changes or the component unmounts", async () => {
    const { rerender, unmount } = renderHook(
      ({ accountId }) => useMarketDatafeedQuotes(["XAUUSD"], accountId),
      { initialProps: { accountId: "account-1" } },
    );

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const first = FakeWebSocket.instances[0]!;

    rerender({ accountId: "account-2" });
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
    expect(first.closed).toBe(true);

    const second = FakeWebSocket.instances[1]!;
    unmount();
    expect(second.closed).toBe(true);
  });
});
