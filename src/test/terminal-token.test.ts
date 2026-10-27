import { afterEach, describe, expect, it, vi } from "vitest";
import { assertTrader } from "@/lib/terminal-api/auth";
import {
  createStreamTicket,
  createTerminalToken,
  verifyStreamTicket,
  verifyTerminalToken,
} from "@/lib/terminal-api/token";

const secret = "test-terminal-secret-with-at-least-32-bytes";
const account = {
  id: "11111111-1111-4111-8111-111111111111",
  server_id: "22222222-2222-4222-8222-222222222222",
  access_role: "trader",
  session_epoch: 3,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("terminal tokens", () => {
  it("signs and verifies a terminal token", async () => {
    const { token, expiresAt } = await createTerminalToken(account, "trader", secret);
    const claims = await verifyTerminalToken(token, secret);
    expect(claims).toMatchObject({
      typ: "terminal",
      accountId: account.id,
      serverId: account.server_id,
      role: "trader",
      epoch: 3,
    });
    expect(claims?.exp).toBe(expiresAt);
  });

  it("rejects a token signed with a different secret", async () => {
    const { token } = await createTerminalToken(account, "trader", secret);
    await expect(verifyTerminalToken(token, `${secret}-other`)).resolves.toBeNull();
  });

  it("rejects a tampered token", async () => {
    const { token } = await createTerminalToken(account, "trader", secret);
    const [payload, signature] = token.split(".");
    await expect(verifyTerminalToken(`${payload}x.${signature}`, secret)).resolves.toBeNull();
  });

  it("rejects a stream ticket as a terminal token", async () => {
    const { ticket } = await createStreamTicket(account, "investor", secret);
    await expect(verifyTerminalToken(ticket, secret)).resolves.toBeNull();
  });

  it("signs and verifies a stream ticket", async () => {
    const { ticket, expiresAt } = await createStreamTicket(account, "investor", secret);
    const claims = await verifyStreamTicket(ticket, secret);
    expect(claims).toMatchObject({
      typ: "stream",
      accountId: account.id,
      serverId: account.server_id,
      role: "investor",
      epoch: 3,
    });
    expect(claims?.exp).toBe(expiresAt);
  });

  it("expires terminal tokens after seven days", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T00:00:00Z"));
    const { token } = await createTerminalToken(account, "trader", secret);
    vi.setSystemTime(new Date("2026-11-02T00:00:01Z"));
    await expect(verifyTerminalToken(token, secret)).resolves.toBeNull();
  });

  it("expires stream tickets after sixty seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T00:00:00Z"));
    const { ticket } = await createStreamTicket(account, "trader", secret);
    vi.setSystemTime(new Date("2026-10-26T00:01:01Z"));
    await expect(verifyStreamTicket(ticket, secret)).resolves.toBeNull();
  });

  it("rejects malformed tokens", async () => {
    await expect(verifyTerminalToken("not-a-token", secret)).resolves.toBeNull();
    await expect(verifyTerminalToken("", secret)).resolves.toBeNull();
  });

  it("treats investor accounts as read-only regardless of token role", () => {
    const claims = {
      typ: "terminal" as const,
      accountId: account.id,
      serverId: account.server_id,
      role: "trader" as const,
      epoch: 3,
      iat: Date.now(),
      exp: Date.now() + 60_000,
    };
    expect(() => assertTrader(claims, { access_role: "investor" })).toThrowError(
      "investor (read-only)",
    );
    expect(() => assertTrader(claims, { access_role: "trader" })).not.toThrow();
  });
});
