import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/realtime.functions";

type HandlerArgs = {
  data: { accountId: string; symbols: string[] };
  context: { supabase: unknown; userId: string };
};

const mocks = vi.hoisted(() => ({
  handler: null as null | ((args: HandlerArgs) => Promise<unknown>),
  validator: null as null | ((input: unknown) => unknown),
  loadAccountForUser: vi.fn(),
  providerSymbols: vi.fn(),
  requestToken: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => {
  const chain = {
    middleware: () => chain,
    inputValidator: (fn: (input: unknown) => unknown) => {
      mocks.validator = fn;
      return chain;
    },
    handler: (fn: (args: HandlerArgs) => Promise<unknown>) => {
      mocks.handler = fn;
      return chain;
    },
  };
  return { createServerFn: () => chain };
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/trading-service.server", () => ({
  loadAccountForUser: mocks.loadAccountForUser,
}));
vi.mock("@/lib/meridian.server", () => ({
  meridianProviderSymbols: mocks.providerSymbols,
  meridianWsUrl: () => "wss://meridian.example/ws/v1/market",
  requestMeridianWsToken: mocks.requestToken,
}));

const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  mocks.loadAccountForUser.mockReset();
  mocks.providerSymbols.mockReset();
  mocks.requestToken.mockReset();
  mocks.providerSymbols.mockResolvedValue(new Map([["XAUUSD", "XAUUSDm"]]));
  mocks.requestToken.mockResolvedValue({ token: "provider-token", expires_at: 1_800_000_120 });
});

afterEach(() => vi.clearAllMocks());

describe("Meridian WebSocket token authorization", () => {
  it("validates the Vantor account before exchanging the provider key", async () => {
    mocks.loadAccountForUser.mockResolvedValue({ id: ACCOUNT_ID, status: "active" });
    const data = mocks.validator!({
      accountId: ACCOUNT_ID,
      symbols: ["XAUUSD", "XAUUSD"],
      token: "client-supplied-token",
    }) as HandlerArgs["data"];

    const result = (await mocks.handler!({
      data,
      context: { supabase: {}, userId: USER_ID },
    })) as Record<string, unknown>;

    expect(data).toEqual({ accountId: ACCOUNT_ID, symbols: ["XAUUSD"] });
    expect(mocks.loadAccountForUser).toHaveBeenCalledWith({}, USER_ID, ACCOUNT_ID);
    expect(result).toMatchObject({
      token: "provider-token",
      wsUrl: "wss://meridian.example/ws/v1/market",
      subscriptions: { XAUUSD: "XAUUSDm" },
    });
  });

  it("does not issue a token for an inactive account", async () => {
    mocks.loadAccountForUser.mockResolvedValue({ id: ACCOUNT_ID, status: "disabled" });
    const data = mocks.validator!({
      accountId: ACCOUNT_ID,
      symbols: ["EURUSD"],
    }) as HandlerArgs["data"];

    await expect(
      mocks.handler!({ data, context: { supabase: {}, userId: USER_ID } }),
    ).rejects.toThrow("Trading account is not active");
    expect(mocks.requestToken).not.toHaveBeenCalled();
  });
});
