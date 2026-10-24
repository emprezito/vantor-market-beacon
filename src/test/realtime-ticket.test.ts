import { afterEach, describe, expect, it, vi } from "vitest";
import { createRealtimeTicket, verifyRealtimeTicket } from "@/lib/realtime-ticket";

const SECRET = "realtime-test-secret";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("realtime tickets", () => {
  it("verifies a freshly signed ticket", async () => {
    const ticket = await createRealtimeTicket("user-123", SECRET);
    const claims = await verifyRealtimeTicket(ticket.ticket, SECRET);

    expect(claims?.userId).toBe("user-123");
    expect(claims?.expiresAt).toBe(ticket.expiresAt);
  });

  it("rejects a tampered ticket", async () => {
    const ticket = await createRealtimeTicket("user-123", SECRET);
    const tampered = `${ticket.ticket.slice(0, -1)}x`;

    await expect(verifyRealtimeTicket(tampered, SECRET)).resolves.toBeNull();
  });

  it("rejects a ticket signed with another secret", async () => {
    const ticket = await createRealtimeTicket("user-123", SECRET);

    await expect(verifyRealtimeTicket(ticket.ticket, "other-secret")).resolves.toBeNull();
  });

  it("rejects an expired ticket", async () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const ticket = await createRealtimeTicket("user-123", SECRET);

    vi.spyOn(Date, "now").mockReturnValue(now + 121_000);
    await expect(verifyRealtimeTicket(ticket.ticket, SECRET)).resolves.toBeNull();
  });

  it("rejects malformed tickets", async () => {
    await expect(verifyRealtimeTicket("not-a-ticket", SECRET)).resolves.toBeNull();
    await expect(verifyRealtimeTicket("user-123.9999999999999", SECRET)).resolves.toBeNull();
  });
});
