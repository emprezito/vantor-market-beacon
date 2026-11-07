import { describe, expect, it } from "vitest";
import {
  MARKETDATA_TICKET_AUDIENCE,
  MARKETDATA_TICKET_ISSUER,
  MARKETDATA_TICKET_TTL_SECONDS,
  createMarketDatafeedTicket,
  marketDatafeedServerIds,
  marketDatafeedServerIsAllowed,
  verifyMarketDatafeedTicket,
} from "@/lib/marketdatafeed-ticket";

const SECRET = "marketdatafeed-test-secret";
const NOW = 1_800_000_000_000;
const INPUT = {
  userId: "11111111-1111-4111-8111-111111111111",
  accountId: "22222222-2222-4222-8222-222222222222",
  serverId: "33333333-3333-4333-8333-333333333333",
};

describe("MarketDatafeed tickets", () => {
  it("issues and verifies a scoped ticket", async () => {
    const ticket = await createMarketDatafeedTicket(INPUT, SECRET, NOW);
    const claims = await verifyMarketDatafeedTicket(ticket.ticket, SECRET, NOW + 1_000);

    expect(ticket.ticket.startsWith("v1.")).toBe(true);
    expect(ticket.expiresAt).toBe((Math.floor(NOW / 1000) + MARKETDATA_TICKET_TTL_SECONDS) * 1000);
    expect(claims).toMatchObject({
      userId: INPUT.userId,
      accountId: INPUT.accountId,
      serverId: INPUT.serverId,
      symbols: ["XAUUSDM"],
      iat: Math.floor(NOW / 1000),
      exp: Math.floor(NOW / 1000) + MARKETDATA_TICKET_TTL_SECONDS,
      iss: MARKETDATA_TICKET_ISSUER,
      aud: MARKETDATA_TICKET_AUDIENCE,
    });
    expect(claims?.jti).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("rejects tampered, wrongly signed, malformed, and expired tickets", async () => {
    const ticket = await createMarketDatafeedTicket(INPUT, SECRET, NOW);
    const parts = ticket.ticket.split(".");
    const tamperedPayload = `${parts[1]!.slice(0, -1)}A`;
    const tampered = `v1.${tamperedPayload}.${parts[2]}`;

    await expect(verifyMarketDatafeedTicket(tampered, SECRET, NOW)).resolves.toBeNull();
    await expect(
      verifyMarketDatafeedTicket(ticket.ticket, "wrong-secret", NOW),
    ).resolves.toBeNull();
    await expect(verifyMarketDatafeedTicket("not-a-ticket", SECRET, NOW)).resolves.toBeNull();
    await expect(verifyMarketDatafeedTicket("v1..", SECRET, NOW)).resolves.toBeNull();
    await expect(
      verifyMarketDatafeedTicket(ticket.ticket, SECRET, NOW + 121_000),
    ).resolves.toBeNull();
  });

  it("rejects tickets issued too far in the future", async () => {
    const future = await createMarketDatafeedTicket(INPUT, SECRET, NOW + 60_000);
    await expect(verifyMarketDatafeedTicket(future.ticket, SECRET, NOW)).resolves.toBeNull();
  });

  it("rejects unsupported symbols and malformed identifiers", async () => {
    await expect(
      createMarketDatafeedTicket({ ...INPUT, symbols: ["EURUSDM"] }, SECRET, NOW),
    ).rejects.toThrow("Invalid MarketDatafeed symbols");
    await expect(
      createMarketDatafeedTicket({ ...INPUT, userId: "user-123" }, SECRET, NOW),
    ).rejects.toThrow("Missing user ID");
    await expect(createMarketDatafeedTicket(INPUT, "", NOW)).rejects.toThrow(
      "Missing MarketDatafeed ticket secret",
    );
  });

  it("normalizes the fail-closed server allowlist", () => {
    const raw = " 33333333-3333-4333-8333-333333333333, AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA ";
    expect(marketDatafeedServerIds(raw).size).toBe(2);
    expect(marketDatafeedServerIsAllowed("33333333-3333-4333-8333-333333333333", raw)).toBe(true);
    expect(marketDatafeedServerIsAllowed("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", raw)).toBe(true);
    expect(marketDatafeedServerIsAllowed(INPUT.serverId, undefined)).toBe(false);
    expect(marketDatafeedServerIsAllowed(INPUT.serverId, "")).toBe(false);
    expect(marketDatafeedServerIsAllowed(INPUT.serverId, "other-server")).toBe(false);
    expect(marketDatafeedServerIsAllowed(null, raw)).toBe(false);
  });
});
