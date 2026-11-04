import { afterEach, describe, expect, it, vi } from "vitest";
import { createRealtimeTicket, verifyRealtimeTicket } from "@/lib/realtime-ticket";

const SECRET = "realtime-test-secret";
const ACCOUNT = {
  userId: "user-123",
  accountId: "11111111-1111-4111-8111-111111111111",
  serverId: "22222222-2222-4222-8222-222222222222",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("realtime tickets", () => {
  it("verifies a freshly signed ticket", async () => {
    const ticket = await createRealtimeTicket(ACCOUNT, SECRET);
    const claims = await verifyRealtimeTicket(ticket.ticket, SECRET);

    expect(claims?.userId).toBe(ACCOUNT.userId);
    expect(claims?.accountId).toBe(ACCOUNT.accountId);
    expect(claims?.serverId).toBe(ACCOUNT.serverId);
    expect(claims?.expiresAt).toBe(ticket.expiresAt);
  });

  it("rejects a tampered ticket", async () => {
    const ticket = await createRealtimeTicket(ACCOUNT, SECRET);
    const tampered = `${ticket.ticket.slice(0, -1)}x`;

    await expect(verifyRealtimeTicket(tampered, SECRET)).resolves.toBeNull();
  });

  it("rejects a ticket signed with another secret", async () => {
    const ticket = await createRealtimeTicket(ACCOUNT, SECRET);

    await expect(verifyRealtimeTicket(ticket.ticket, "other-secret")).resolves.toBeNull();
  });

  it("rejects an expired ticket", async () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const ticket = await createRealtimeTicket(ACCOUNT, SECRET);

    vi.spyOn(Date, "now").mockReturnValue(now + 121_000);
    await expect(verifyRealtimeTicket(ticket.ticket, SECRET)).resolves.toBeNull();
  });

  it("rejects malformed tickets", async () => {
    await expect(verifyRealtimeTicket("not-a-ticket", SECRET)).resolves.toBeNull();
    await expect(verifyRealtimeTicket("user-123.9999999999999", SECRET)).resolves.toBeNull();
  });
});
