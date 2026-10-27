import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["src/lib", "src/routes"];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("plaintext credential cutover", () => {
  it("keeps application code off the plaintext password columns", () => {
    const offenders = ROOTS.flatMap(sourceFiles).filter((path) =>
      /trader_password|investor_password/.test(readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
