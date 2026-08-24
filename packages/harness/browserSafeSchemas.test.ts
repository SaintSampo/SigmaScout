/**
 * Plan 05-01 Task 3, Step 1: a static import-graph scan proving the two
 * browser-facing entry points — `pageArtifacts.ts` (the published-artifact
 * schemas `apps/web` parses) and `publishedAlgorithms.ts` (the published
 * algorithm id list) — never transitively reach a Node built-in import or
 * any file under `packages/core/algorithms/` (which would drag the whole
 * algorithm implementation into a browser bundle). This is a REAL guard,
 * not a vacuous one: temporarily re-pointing `pageArtifacts.ts`'s import
 * back at `./metricHistory.js` (which imports `node:fs`/`node:path`) makes
 * this test fail, naming that file — see 05-01-PLAN.md's acceptance
 * criteria, which requires this to be verified by hand once and reverted.
 *
 * Scope: static `import`/`export ... from` specifiers only — this repo has
 * no dynamic imports in the modules under scan.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY_POINTS = [resolve(HERE, "pageArtifacts.ts"), resolve(HERE, "publishedAlgorithms.ts")];
const FORBIDDEN_DIR = resolve(HERE, "..", "core", "algorithms");

/** Matches one `import ... from "spec"` or `export ... from "spec"` line — this repo's convention keeps every such statement on one line. */
const IMPORT_LINE_RE = /^\s*(?:import|export)\b.*\bfrom\s*["']([^"']+)["']/;

interface ScanResult {
  visited: Set<string>;
  nodeBuiltinViolations: Array<{ file: string; specifier: string }>;
  algorithmDirViolations: string[];
}

function extractImportSpecifiers(filePath: string): string[] {
  const content = readFileSync(filePath, "utf8");
  const specifiers: string[] = [];
  for (const line of content.split("\n")) {
    const match = IMPORT_LINE_RE.exec(line);
    if (match?.[1]) specifiers.push(match[1]);
  }
  return specifiers;
}

/** Resolves a relative `./x.js` / `../x.js` specifier to its `.ts` sibling on disk. Non-relative specifiers (npm packages) return `undefined` — they are checked for the Node-builtin prefix but never followed. */
function resolveRelativeToTs(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
  const withoutExt = specifier.replace(/\.js$/, "");
  return resolve(dirname(fromFile), `${withoutExt}.ts`);
}

function scan(entryPoints: readonly string[]): ScanResult {
  const visited = new Set<string>();
  const nodeBuiltinViolations: Array<{ file: string; specifier: string }> = [];
  const algorithmDirViolations: string[] = [];
  const queue = [...entryPoints];

  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);

    if (file.startsWith(FORBIDDEN_DIR + "\\") || file.startsWith(FORBIDDEN_DIR + "/") || file === FORBIDDEN_DIR) {
      algorithmDirViolations.push(file);
    }

    for (const specifier of extractImportSpecifiers(file)) {
      if (specifier.startsWith("node:")) {
        nodeBuiltinViolations.push({ file, specifier });
        continue;
      }
      const resolved = resolveRelativeToTs(file, specifier);
      if (resolved !== undefined && !visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return { visited, nodeBuiltinViolations, algorithmDirViolations };
}

describe("browser-safe schema import graph", () => {
  it("never reaches a Node built-in import from pageArtifacts.ts or publishedAlgorithms.ts", () => {
    const { nodeBuiltinViolations } = scan(ENTRY_POINTS);
    if (nodeBuiltinViolations.length > 0) {
      const detail = nodeBuiltinViolations.map((v) => `${v.file} imports "${v.specifier}"`).join("; ");
      expect.fail(`Node built-in import(s) reachable from a browser-facing entry point: ${detail}`);
    }
  });

  it("never reaches a file under packages/core/algorithms/", () => {
    const { algorithmDirViolations } = scan(ENTRY_POINTS);
    if (algorithmDirViolations.length > 0) {
      expect.fail(`packages/core/algorithms/ file(s) reachable from a browser-facing entry point: ${algorithmDirViolations.join("; ")}`);
    }
  });

  it("visits at least the expected leaf modules (sanity check the scan itself is not vacuous)", () => {
    const { visited } = scan(ENTRY_POINTS);
    expect(visited.has(resolve(HERE, "pageArtifacts.ts"))).toBe(true);
    expect(visited.has(resolve(HERE, "publishedAlgorithms.ts"))).toBe(true);
    expect(visited.has(resolve(HERE, "metricHistorySchema.ts"))).toBe(true);
  });
});
