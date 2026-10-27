import { describe, expect, it } from "vitest";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "@/lib/password.server";

describe("password hashing", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^pbkdf2\$100000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("uses a fresh salt for every hash", async () => {
    const first = await hashPassword("same password");
    const second = await hashPassword("same password");
    expect(first).not.toBe(second);
    expect(await verifyPassword("same password", first)).toBe(true);
    expect(await verifyPassword("same password", second)).toBe(true);
  });

  it("rejects malformed or unsupported hashes", async () => {
    for (const stored of [
      "",
      "plain-text",
      "pbkdf2$100000$only-three-parts",
      "pbkdf2$0$c2FsdA$aGFzaA",
      "pbkdf2$1000000$c2FsdA$aGFzaA",
      "pbkdf2$100000$***$***",
    ]) {
      expect(await verifyPassword("anything", stored)).toBe(false);
    }
  });

  it("verifies the dummy hash for missing-account timing", async () => {
    expect(await verifyPassword("vantor-dummy-password", DUMMY_PASSWORD_HASH)).toBe(true);
    expect(await verifyPassword("not-the-dummy-password", DUMMY_PASSWORD_HASH)).toBe(false);
  });
});
