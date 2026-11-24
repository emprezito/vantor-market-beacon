import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarketIdentity } from "@/components/market-identity";
import type { Instrument } from "@/lib/market";

function instrument(symbol: string, assetClass?: string): Instrument {
  return {
    symbol,
    name: symbol,
    base: 1,
    vol: 0,
    digits: 5,
    spread: 0,
    contract: 100_000,
    quoteIsUsd: true,
    ...(assetClass ? { assetClass } : {}),
  };
}

describe("MarketIdentity", () => {
  it("renders an accessible two-currency identity", () => {
    render(<MarketIdentity instrument={instrument("EURUSD", "forex")} />);
    expect(screen.getByLabelText("EUR / USD")).toBeInTheDocument();
  });

  it("renders a crypto mark with its quote currency", () => {
    const { container } = render(<MarketIdentity instrument={instrument("BTCUSD", "crypto")} />);
    expect(screen.getByLabelText("BTC / USD")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
