import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/market-data.server", () => ({
  loadQuotes: vi.fn(),
  loadProviderRate: vi.fn(),
}));

import { loadQuotes, loadProviderRate } from "@/lib/market-data.server";
import { fallbackFxRate, loadFxRate, resetFxRateCache } from "@/lib/fx.server";

describe("account currency FX rates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    resetFxRateCache();
  });

  it("keeps USD accounts at one unit per USD", async () => {
    await expect(loadFxRate("USD")).resolves.toBe(1);
    expect(loadQuotes).not.toHaveBeenCalled();
    expect(loadProviderRate).not.toHaveBeenCalled();
  });

  it("derives EUR and GBP rates from their USD quotes", async () => {
    vi.mocked(loadQuotes).mockImplementation(async (symbols) =>
      Object.fromEntries(
        symbols.map((symbol) => [
          symbol,
          {
            symbol,
            bid: symbol === "EURUSD" ? 1.2499 : 1.2499,
            ask: symbol === "EURUSD" ? 1.2501 : 1.2501,
            mid: 1.25,
            ts: 1,
            source: "live" as const,
          },
        ]),
      ),
    );

    await expect(loadFxRate("EUR")).resolves.toBeCloseTo(0.8);
    await expect(loadFxRate("GBP")).resolves.toBeCloseTo(0.8);
    expect(loadQuotes).toHaveBeenCalledWith(["EURUSD"]);
    expect(loadQuotes).toHaveBeenCalledWith(["GBPUSD"]);
  });

  it("loads USD/NGN from the provider and caches the rate", async () => {
    vi.mocked(loadProviderRate).mockResolvedValue(1_500);

    await expect(loadFxRate("NGN")).resolves.toBe(1_500);
    await expect(loadFxRate("NGN")).resolves.toBe(1_500);
    expect(loadProviderRate).toHaveBeenCalledTimes(1);
    expect(loadProviderRate).toHaveBeenCalledWith("USD/NGN");
  });

  it("falls back to the configured rate when the provider fails", async () => {
    vi.stubEnv("USD_NGN_RATE", "1420");
    vi.mocked(loadProviderRate).mockRejectedValue(new Error("provider unavailable"));

    await expect(loadFxRate("NGN")).resolves.toBe(1_420);
    expect(fallbackFxRate("NGN")).toBe(1_420);
  });

  it("falls back to a static rate without configuration", () => {
    expect(fallbackFxRate("USD")).toBe(1);
    expect(fallbackFxRate("EUR")).toBeCloseTo(0.92);
    expect(fallbackFxRate("GBP")).toBeCloseTo(0.79);
    expect(fallbackFxRate("NGN")).toBe(1_345);
  });
});
