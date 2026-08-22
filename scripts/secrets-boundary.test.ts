/**
 * Secrets boundary validation for T-01-02 (Information Disclosure, HIGH severity).
 *
 * WHY THIS TEST EXISTS:
 * =====================
 * Threat T-01-02 warns that the TBA API key in `.env` could accidentally become committable
 * through three mechanisms:
 *   1. Removing `.env` from `.gitignore`
 *   2. Pasting a real key into `.env.example` (which *is* tracked)
 *   3. A developer manually staging `.env` before noticing the pattern
 *
 * 01-01-PLAN.md's Task 2 "verified" the boundary with a one-time manual run of
 * `git check-ignore .env`, but that single run cannot catch regressions. This automated
 * test re-checks it on every test run and will fail loudly if:
 *   - The gitignore entry is removed
 *   - `.env` is tracked despite the gitignore
 *   - `.env.example` accidentally contains the real TBA key (by comparing hashes)
 *
 * The test runs on Windows and Unix, uses node APIs instead of shell pipelines,
 * and never prints or exposes the actual key value in any assertion message.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";

// Resolve repo root from the test file location: scripts/secrets-boundary.test.ts -> repo root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

// Helper to hash a string without exposing it.
function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// Helper to parse a simple KEY=VALUE .env-like file for a specific key.
function getEnvValue(filePath: string, key: string): string | null {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    // Skip comments and empty lines.
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [k, ...rest] = trimmed.split("=");
    if (k?.trim() === key) {
      return rest.join("=").trim().replace(/^["']|["']$/g, ""); // Remove quotes
    }
  }
  return null;
}

describe("secrets boundary (T-01-02)", () => {
  it("should have .env git-ignored so the TBA key cannot be committed", () => {
    // This is assertion (a) from the gap spec.
    // On Windows and Unix, git check-ignore outputs the path if it is ignored,
    // and exits 0. We run it from the repo root.
    try {
      const result = execSync("git check-ignore -v .env", {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"], // Capture stderr to avoid polluting test output
      });
      expect(result).toContain(".env");
    } catch (error) {
      // If git command fails, that means .env is NOT ignored (which would be a failure).
      throw new Error(`git check-ignore failed for .env: ${error}`);
    }
  });

  it("should NOT have .env tracked by git despite what gitignore says", () => {
    // This is assertion (b) from the gap spec: defensive check that .env is not
    // already in the git index. If it were, gitignore would not remove it.
    // git ls-files --error-unmatch exits non-zero if the file is NOT tracked.
    let isTracked = false;
    try {
      execSync("git ls-files --error-unmatch .env", {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      isTracked = true;
    } catch {
      // Exit code 1: file is NOT tracked. This is what we want.
    }
    expect(isTracked).toBe(false);
  });

  it("should have .env.example with a placeholder TBA_API_KEY that differs from the real key", () => {
    // This is assertion (c) from the gap spec.
    // If .env exists, verify that .env.example's value does NOT match .env's value.
    // Compare hashes, never the raw keys.

    const envPath = resolve(REPO_ROOT, ".env");
    const envExamplePath = resolve(REPO_ROOT, ".env.example");

    // .env.example must exist and contain a TBA_API_KEY value.
    expect(existsSync(envExamplePath)).toBe(true);
    const exampleValue = getEnvValue(envExamplePath, "TBA_API_KEY");
    expect(exampleValue).not.toBeNull();
    expect(exampleValue).toBeTruthy(); // Non-empty placeholder

    // If .env exists, its value must differ from .env.example's value.
    if (existsSync(envPath)) {
      const realValue = getEnvValue(envPath, "TBA_API_KEY");
      expect(realValue).not.toBeNull();

      // Compare hashes to avoid exposing the keys in a test failure.
      const exampleHash = sha256(exampleValue!);
      const realHash = sha256(realValue!);

      expect(exampleHash).not.toBe(realHash);
    }
    // If .env is absent (e.g., on a CI machine), the test still passes because
    // we verified .env.example exists and has a placeholder.
  });
});

/**
 * D-24: the Cloudflare credentials (`CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
 * `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE_URL`) enter `.env` alongside
 * `TBA_API_KEY` for `packages/harness/r2Client.ts`. This block mirrors the
 * "secrets boundary (T-01-02)" suite above exactly, using the same `sha256`/
 * `getEnvValue` helpers, so the Cloudflare token carries the identical
 * never-print, hash-compare protection the TBA key has had since Phase 1.
 */
describe("cloudflare credentials boundary (D-24)", () => {
  const CLOUDFLARE_ENV_KEYS = ["CLOUDFLARE_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_PUBLIC_BASE_URL"] as const;
  /** Only these two are bearer-token-shaped secrets; `CLOUDFLARE_ACCOUNT_ID` and `R2_PUBLIC_BASE_URL` are not secret (an account ID and a public bucket URL are meant to be visible). */
  const CLOUDFLARE_SECRET_KEYS = ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] as const;

  it("should have .env.example with non-empty placeholder values for all four Cloudflare keys", () => {
    const envExamplePath = resolve(REPO_ROOT, ".env.example");
    expect(existsSync(envExamplePath)).toBe(true);

    for (const key of CLOUDFLARE_ENV_KEYS) {
      const exampleValue = getEnvValue(envExamplePath, key);
      expect(exampleValue, `.env.example is missing a placeholder for ${key}`).not.toBeNull();
      expect(exampleValue, `.env.example's ${key} placeholder must be non-empty`).toBeTruthy();
    }
  });

  it("should have each Cloudflare secret's .env value differ from its .env.example placeholder (hash-compared only)", () => {
    const envPath = resolve(REPO_ROOT, ".env");
    const envExamplePath = resolve(REPO_ROOT, ".env.example");

    if (!existsSync(envPath)) {
      // CI machine with no .env — nothing to compare, matches the TBA key test's own skip behavior.
      return;
    }

    for (const key of CLOUDFLARE_SECRET_KEYS) {
      const exampleValue = getEnvValue(envExamplePath, key);
      const realValue = getEnvValue(envPath, key);
      expect(exampleValue, `.env.example is missing a placeholder for ${key}`).not.toBeNull();
      expect(realValue, `.env is missing a value for ${key}`).not.toBeNull();

      // Compare hashes only — never assert on, interpolate, or message with a raw value.
      const exampleHash = sha256(exampleValue!);
      const realHash = sha256(realValue!);
      expect(exampleHash).not.toBe(realHash);
    }
  });

  it("should NOT have any tracked file containing an R2 secret — .env stays out of the git index", () => {
    // The mechanism is the same one the pre-existing untracked-file assertion
    // above already proves (.gitignore lines 5-7); this test names the
    // Cloudflare token as an in-scope secret so a future contributor reading
    // this file knows the boundary applies to it too, not only the TBA key.
    let isTracked = false;
    try {
      execSync("git ls-files --error-unmatch .env", {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      isTracked = true;
    } catch {
      // Exit code 1: file is NOT tracked. This is what we want.
    }
    expect(isTracked).toBe(false);
  });
});
