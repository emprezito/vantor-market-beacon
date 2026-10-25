import { describe, expect, it } from "vitest";
import {
  asServerRole,
  canManageServer,
  canRemoveServerMember,
  isPartnerRole,
  slugifyServerName,
} from "@/lib/partner";

describe("partner portal access", () => {
  it("only grants the partner role access to the partner portal", () => {
    expect(isPartnerRole("partner")).toBe(true);
    expect(isPartnerRole("platform_admin")).toBe(false);
    expect(isPartnerRole("member")).toBe(false);
    expect(isPartnerRole(null)).toBe(false);
    expect(isPartnerRole(undefined)).toBe(false);
  });
});

describe("partner server roles", () => {
  it("normalizes stored roles", () => {
    expect(asServerRole("owner")).toBe("owner");
    expect(asServerRole("admin")).toBe("admin");
    expect(asServerRole("member")).toBe("member");
    expect(asServerRole("something-else")).toBe("member");
  });

  it("only lets owners and admins manage a server", () => {
    expect(canManageServer("owner")).toBe(true);
    expect(canManageServer("admin")).toBe(true);
    expect(canManageServer("member")).toBe(false);
    expect(canManageServer(null)).toBe(false);
  });

  it("protects owners and keeps admins from removing admins", () => {
    expect(canRemoveServerMember("owner", "owner")).toBe(false);
    expect(canRemoveServerMember("admin", "owner")).toBe(false);
    expect(canRemoveServerMember("owner", "admin")).toBe(true);
    expect(canRemoveServerMember("admin", "admin")).toBe(false);
    expect(canRemoveServerMember("owner", "member")).toBe(true);
    expect(canRemoveServerMember("admin", "member")).toBe(true);
    expect(canRemoveServerMember("member", "member")).toBe(false);
  });
});

describe("partner server slugs", () => {
  it("slugifies names and trims separators", () => {
    expect(slugifyServerName("  Acme Prop!!  ")).toBe("acme-prop");
    expect(slugifyServerName("Gold & Silver")).toBe("gold-silver");
    expect(slugifyServerName("---")).toBe("");
  });

  it("caps slugs at 48 characters without a trailing hyphen", () => {
    const slug = slugifyServerName(`${"a".repeat(47)} trailing`);
    expect(slug).toHaveLength(47);
    expect(slug.endsWith("-")).toBe(false);
  });
});
