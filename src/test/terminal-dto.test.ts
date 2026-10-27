import { describe, expect, it } from "vitest";
import { accountViewDto } from "@/lib/terminal-api/dto";
import type { AccountView } from "@/lib/trading-service.server";

const position = {
  id: "00000000-0000-0000-0000-000000000001",
  account_id: "00000000-0000-0000-0000-000000000002",
  user_id: "00000000-0000-0000-0000-000000000003",
  symbol: "EURUSD",
  side: "buy",
  lots: 0.01,
  open_price: 1.1,
  stop_loss: null,
  take_profit: null,
  close_price: null,
  close_reason: null,
  pnl: null,
  opened_at: "2026-10-27T00:00:00.000Z",
  closed_at: null,
} as AccountView["open"][number];

const quotes = {
  EURUSD: {
    symbol: "EURUSD",
    bid: 1.101,
    ask: 1.1012,
    mid: 1.1011,
    ts: 1,
    source: "live" as const,
  },
};

function view(fxRate: number): AccountView {
  return {
    account: {
      id: "00000000-0000-0000-0000-000000000002",
      login: 82763576,
      nickname: "FNG Testing Account",
      label: "FNG Testing Account",
      server: "FundedNG",
      currency: "NGN",
      leverage: 100,
      access_role: "trader",
      status: "active",
    },
    balance: 100_000,
    fxRate,
    open: [position],
    pending: [],
    closed: [],
    transactions: [],
    quotes,
  };
}

describe("terminal account view FX conversion", () => {
  it("reports USD values unchanged for USD accounts", () => {
    const dto = accountViewDto(view(1));

    expect(dto.fxRate).toBe(1);
    expect(dto.openPositions[0]?.pnl).toBe(1);
    expect(dto.marginUsed).toBe(11);
    expect(dto.equity).toBe(100_001);
    expect(dto.freeMargin).toBe(99_990);
  });

  it("converts floating P/L and margin into the account currency", () => {
    const dto = accountViewDto(view(1_500));

    expect(dto.fxRate).toBe(1_500);
    expect(dto.openPositions[0]?.pnl).toBe(1_500);
    expect(dto.marginUsed).toBe(16_500);
    expect(dto.equity).toBe(101_500);
    expect(dto.freeMargin).toBe(85_000);
  });

  it("falls back to a one-to-one rate when the view is invalid", () => {
    expect(accountViewDto(view(Number.NaN)).fxRate).toBe(1);
    expect(accountViewDto(view(-5)).fxRate).toBe(1);
  });
});
