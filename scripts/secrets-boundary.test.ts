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
