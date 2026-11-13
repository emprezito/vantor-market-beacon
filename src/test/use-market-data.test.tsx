import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMarketQuotes } from "@/hooks/use-market-data";
import type { MarketQuote, QuoteMap } from "@/lib/market-data";

const mocks = vi.hoisted(() => ({
  quotesFn: vi.fn(),
  meridianFn: vi.fn(),
}));

vi.mock("@/lib/market.functions", () => ({
  getMarketQuotes: mocks.quotesFn,
  getMarketCandles: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/hooks/use-meridian-quotes", () => ({
  useMeridianQuotes: mocks.meridianFn,
}));

type LiveState = { quotes: QuoteMap; status: string; error: string | null };
let live: LiveState;

function quote(symbol: string, mid: number, source: "live" | "cached" = "live"): MarketQuote {
  return {
    symbol,
    bid: mid - 0.1,
    ask: mid + 0.1,
    mid,
    ts: 1_800_000_000_000,
    source,
    feed: "meridian",
  };
}

function setup(symbols: string[], quotes: QuoteMap, accountId: string | null = "account-1") {
  mocks.quotesFn.mockResolvedValue({ quotes, fetchedAt: 1_800_000_000_000 });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useMarketQuotes(symbols, accountId), { wrapper });
}

beforeEach(() => {
  mocks.quotesFn.mockReset();
  mocks.meridianFn.mockReset();
  live = { quotes: {}, status: "connecting", error: null };
  mocks.meridianFn.mockImplementation(() => live);
});

afterEach(cleanup);

describe("useMarketQuotes Meridian routing", () => {
  it("overlays realtime Meridian ticks over the REST snapshot", async () => {
    live = { quotes: { EURUSD: quote("EURUSD", 1.2) }, status: "live", error: null };
    const { result } = setup(["EURUSD"], { EURUSD: quote("EURUSD", 1.1) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.quotes["EURUSD"]?.mid).toBe(1.2);
    expect(result.current.realtime).toBe("live");
    expect(mocks.meridianFn).toHaveBeenLastCalledWith(["EURUSD"], "account-1");
  });

  it("falls back to the REST snapshot when the stream has no quote", async () => {
    const { result, rerender } = setup(["XAUUSD"], { XAUUSD: quote("XAUUSD", 2400) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.quotes["XAUUSD"]?.mid).toBe(2400);

    live = { quotes: { XAUUSD: quote("XAUUSD", 2500) }, status: "live", error: null };
    rerender();
    expect(result.current.quotes["XAUUSD"]?.mid).toBe(2500);

    live = { quotes: {}, status: "reconnecting", error: null };
    rerender();
    expect(result.current.quotes["XAUUSD"]?.mid).toBe(2400);
  });

  it("does not require an account for the REST snapshot", async () => {
    const { result } = setup(["BTCUSD"], { BTCUSD: quote("BTCUSD", 30_000) }, null);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.quotes["BTCUSD"]?.mid).toBe(30_000);
    expect(mocks.meridianFn).toHaveBeenLastCalledWith(["BTCUSD"], null);
  });
});
