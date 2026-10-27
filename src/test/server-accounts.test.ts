import { describe, expect, it } from "vitest";
import { genLogin, genPassword } from "@/lib/server-accounts.server";

describe("server account generation", () => {
  it("generates eight-digit logins in the allocated range", () => {
    for (let index = 0; index < 1_000; index += 1) {
      const login = genLogin();
      expect(Number.isInteger(login)).toBe(true);
      expect(login).toBeGreaterThanOrEqual(10_000_000);
      expect(login).toBeLessThanOrEqual(99_999_999);
    }
  });

  it("generates passwords with the requested length", () => {
    const password = genPassword(12);
    expect(password).toHaveLength(12);
    expect(password).toMatch(/^[A-Za-z2-9]+$/);
  });
});
