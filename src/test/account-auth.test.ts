import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  INVALID_LOGIN_MESSAGE,
  accountSessionIsValid,
  authenticateAccountRow,
  recordLoginFailure,
  type AccountAuthRow,
} from "@/lib/account-auth.server";
import { hashPassword } from "@/lib/password.server";

let account: AccountAuthRow;
const traderPassword = "trader-password-123";
const investorPassword = "investor-password-123";

beforeAll(async () => {
  account = {
    id: "account-id",
    server_id: "server-id",
    login: 12345678,
    trader_hash: await hashPassword(traderPassword),
    investor_hash: await hashPassword(investorPassword),
    session_epoch: 4,
    status: "active",
  };
});

describe("trading account authentication", () => {
  it("returns the trader role for the trader password", async () => {
    await expect(authenticateAccountRow(account, traderPassword)).resolves.toEqual({
      account,
      role: "trader",
    });
  });

  it("returns the investor role for the investor password", async () => {
    await expect(authenticateAccountRow(account, investorPassword)).resolves.toEqual({
      account,
      role: "investor",
    });
  });

  it("rejects a wrong password", async () => {
    await expect(authenticateAccountRow(account, "wrong-password")).resolves.toBeNull();
  });

  it("rejects a missing account", async () => {
    await expect(authenticateAccountRow(null, "anything")).resolves.toBeNull();
  });

  it("rejects a disabled account even with the correct password", async () => {
    await expect(
      authenticateAccountRow({ ...account, status: "disabled" }, traderPassword),
    ).resolves.toBeNull();
  });

  it("rejects an account with no stored hashes", async () => {
    const legacy = { ...account, trader_hash: null, investor_hash: null };
    await expect(authenticateAccountRow(legacy, traderPassword)).resolves.toBeNull();
    await expect(authenticateAccountRow(legacy, investorPassword)).resolves.toBeNull();
  });

  it("rejects the password when the stored hash does not match", async () => {
    const stale = { ...account, trader_hash: await hashPassword("different-password") };
    await expect(authenticateAccountRow(stale, traderPassword)).resolves.toBeNull();
  });

  it("invalidates sessions when the epoch changes or the account is disabled", () => {
    expect(accountSessionIsValid(account, 4)).toBe(true);
    expect(accountSessionIsValid(account, 3)).toBe(false);
    expect(accountSessionIsValid({ ...account, status: "disabled" }, 4)).toBe(false);
  });
});

describe("login rate limiting", () => {
  it("maps the atomic RPC result to a blocked response", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { blocked: true, retry_after_seconds: 42.4 },
      error: null,
    });
    const admin = { rpc } as unknown as SupabaseClient<Database>;

    await expect(recordLoginFailure(admin, "203.0.113.10", 12345678)).resolves.toEqual({
      blocked: true,
      retryAfterSeconds: 43,
    });
    expect(rpc).toHaveBeenCalledWith("record_login_failure", {
      p_ip: "203.0.113.10",
      p_login: "12345678",
    });
  });

  it("fails closed when the RPC fails", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "database error" } });
    const admin = { rpc } as unknown as SupabaseClient<Database>;

    await expect(recordLoginFailure(admin, "203.0.113.10", 12345678)).rejects.toThrow(
      "Could not verify sign-in. Please try again.",
    );
  });
});

describe("invalid login message", () => {
  it("does not reveal whether the account exists", () => {
    expect(INVALID_LOGIN_MESSAGE).toBe("Invalid server, login or password");
  });
});
