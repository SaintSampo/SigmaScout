/**
 * `scripts/rebaseline.ts`'s seed command. Importing the module must not start a
 * rebaseline (the entry-point guard), and the wrangler call must run from
 * `apps/worker`, the one package that installs wrangler: from the repo root
 * `npx wrangler` finds no binary and hangs on an install prompt.
 */
import { isAbsolute, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { seedCommand } from "./rebaseline.js";

describe("seedCommand — the D1 seed runs where wrangler is installed", () => {
  const root = resolve("C:/checkout with space/SigmaScout");

  it("runs from apps/worker with --env-file and --file as absolute paths into the repo root", () => {
    const { command, cwd } = seedCommand("seed-spr.sql", root);
    expect(cwd).toBe(join(root, "apps", "worker"));
    const envFile = join(root, ".env");
    const seedFile = join(root, "reports", "publish", "seed-spr.sql");
    expect(isAbsolute(envFile) && isAbsolute(seedFile)).toBe(true);
    expect(command).toBe(`npx wrangler d1 execute sigmascout-state --remote --env-file "${envFile}" --file "${seedFile}"`);
    // Never the old relative form, which resolves against the cwd.
    expect(command).not.toMatch(/--env-file \.env\b/);
    expect(command).not.toMatch(/--file reports\//);
  });

  it("defaults to this checkout's own root", () => {
    const { cwd } = seedCommand("seed-cursors.sql");
    expect(cwd).toBe(resolve(import.meta.dirname, "..", "apps", "worker"));
  });
});
