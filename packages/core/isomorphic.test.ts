/**
 * Architectural fitness test (ARCHITECTURE.md Pattern 1, Anti-Pattern 2):
 * `packages/core` must stay importable unchanged by the Phase 4 Cloudflare
 * Worker. This test enumerates every non-test source file under
 * packages/core and fails if any of them imports a Node built-in module or
 * `better-sqlite3` — the constraint is invisible until Phase 4, at which
 * point a violation is a rewrite rather than a fix. Assert it now, while
 * compliance is free.
 *
 * This test file itself uses `node:fs`/`node:path`/`node:url` — that's
 * fine, it never ships to the Worker (test files are excluded from the
 * scanned set below, including this one).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CORE_DIR = dirname(fileURLToPath(import.meta.url));

/** Import specifiers that would break a Cloudflare Worker (or a browser) build. */
const FORBIDDEN_SPECIFIERS: readonly RegExp[] = [
  /^node:/,
  /^fs$/,
  /^path$/,
  /^crypto$/,
  /^os$/,
  /^child_process$/,
  /^better-sqlite3$/,
];

/** Matches `from "specifier"` (import/export) and `import("specifier")`. */
const IMPORT_SPECIFIER_RE =
  /(?:import|export)(?:[^'";]*?)\bfrom\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

function isTestFile(fileName: string): boolean {
  return fileName.endsWith(".test.ts") || fileName.endsWith(".spec.ts");
}

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const info = statSync(fullPath);
    if (info.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (entry.endsWith(".ts") && !isTestFile(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}

function findForbiddenImports(filePath: string): string[] {
  const content = readFileSync(filePath, "utf-8");
  const violations: string[] = [];
  IMPORT_SPECIFIER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMPORT_SPECIFIER_RE.exec(content))) {
    const specifier = match[1] ?? match[2];
    if (specifier && FORBIDDEN_SPECIFIERS.some((pattern) => pattern.test(specifier))) {
      violations.push(specifier);
    }
  }
  return violations;
}

describe("packages/core isomorphic boundary", () => {
  const sourceFiles = listSourceFiles(CORE_DIR);

  it("enumerates a non-empty set of source files, so this test cannot pass vacuously", () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  it("imports no Node built-in modules and no better-sqlite3 anywhere under packages/core", () => {
    const violations = sourceFiles.flatMap((file) =>
      findForbiddenImports(file).map((specifier) => `${file}: "${specifier}"`)
    );
    expect(violations).toEqual([]);
  });
});
