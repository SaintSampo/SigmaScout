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
 * Plan 05-05 Task 1 extends this with a THIRD entry point:
 * `packages/core/algorithms/breakdown/index.ts` — `apps/web/src/lib/metricKeys.ts`
 * now imports `componentMapForSeason` from it directly, so the client bundles
 * this module (and every season file under `breakdown/`) on purpose. Unlike
 * the first two entry points, this one legitimately LIVES inside
 * `packages/core/algorithms/` — the existing "never reaches a file under
 * packages/core/algorithms/" assertion does not apply to it (it would
 * trivially fail on the entry point itself). It is checked ONLY for Node
 * built-in imports, so a future Node import added to a season module still
 * breaks the web build with a clear, named failure here rather than a
 * confusing bundler error far from its cause.
 *
 * Plan 06.1-08 Task 3 (G-06.1-26) extends this with a FOURTH entry point:
 * `packages/core/algorithms/sigma1/rp/constants.ts` —
 * `apps/web/src/components/team/MatchTable.tsx` now imports
 * `isBonusRpCompLevel` from it directly (PD-19), so the client bundles this
 * module too. Like the breakdown entry point, this one legitimately LIVES
 * under `packages/core/algorithms/` and is checked ONLY for Node built-in
 * imports — at the time of writing it has zero runtime imports of its own
 * (only a type-only `CompLevel` import), so this guard is what catches a
 * future Node-only import added there before it reaches the web build.
 *
 * Plan 08-03 Task 1 extends this with a SIXTH entry point:
 * `packages/core/algorithms/simulation/rankSimulation.ts` — `apps/web`'s
 * first Web Worker (08-07's simulation Worker) imports `simulateRanks` from
 * it directly, so the client bundles this module too. Like the breakdown
 * and rp/constants entry points, this one legitimately LIVES under
 * `packages/core/algorithms/` and is checked ONLY for Node built-in
 * imports; at the time of writing it has zero import statements of any
 * kind, so this guard is what catches a future Node-only import added
 * there before it reaches the web build.
 *
 * Quick task 260905-ldu extends this with a SEVENTH entry point:
 * `packages/harness/teamRanks.ts` — a different case from the previous
 * three. This module does NOT live under `packages/core/algorithms/`; it
 * lives here in `packages/harness/`, alongside `pageArtifacts.ts`. But its
 * design deliberately imports `isOfficialEventType`/`TOTAL_METRIC_KEY` FROM
 * `packages/core/algorithms/eventTypes.ts` and `types.ts` (both of which are
 * themselves import-nothing leaves, per their own header comments), so
 * checking it against the stricter "never reaches a file under
 * packages/core/algorithms/" assertion (the one `pageArtifacts.ts` and
 * `publishedAlgorithms.ts` are held to) would trivially fail on its own
 * intended design. It is checked ONLY for Node built-in imports, exactly
 * like the breakdown/rp-constants/rank-simulation entry points above.
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
const BREAKDOWN_ENTRY_POINT = resolve(HERE, "..", "core", "algorithms", "breakdown", "index.ts");
const RP_CONSTANTS_ENTRY_POINT = resolve(HERE, "..", "core", "algorithms", "sigma1", "rp", "constants.ts");
const RANK_SIMULATION_ENTRY_POINT = resolve(HERE, "..", "core", "algorithms", "simulation", "rankSimulation.ts");
const TEAM_RANKS_ENTRY_POINT = resolve(HERE, "teamRanks.ts");
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

  it("metricHistorySchema.ts specifically carries zero Node-only imports (plan 06.1-03 Task 2) — a future Node import there is caught by this named assertion, not a broken production build", () => {
    const METRIC_HISTORY_SCHEMA = resolve(HERE, "metricHistorySchema.ts");
    const { nodeBuiltinViolations, visited } = scan([METRIC_HISTORY_SCHEMA]);
    expect(visited.has(METRIC_HISTORY_SCHEMA)).toBe(true);
    if (nodeBuiltinViolations.length > 0) {
      const detail = nodeBuiltinViolations.map((v) => `${v.file} imports "${v.specifier}"`).join("; ");
      expect.fail(`Node built-in import(s) reachable from metricHistorySchema.ts: ${detail}`);
    }
  });

  it("never reaches a Node built-in import from packages/core/algorithms/breakdown/index.ts (checked for Node built-ins only — this entry point legitimately lives under packages/core/algorithms/)", () => {
    const { nodeBuiltinViolations, visited } = scan([BREAKDOWN_ENTRY_POINT]);
    // Sanity check the scan is not vacuous: it must actually visit the
    // per-season modules `componentMapForSeason` dispatches to.
    expect(visited.has(BREAKDOWN_ENTRY_POINT)).toBe(true);
    expect(visited.has(resolve(HERE, "..", "core", "algorithms", "breakdown", "2026.ts"))).toBe(true);
    if (nodeBuiltinViolations.length > 0) {
      const detail = nodeBuiltinViolations.map((v) => `${v.file} imports "${v.specifier}"`).join("; ");
      expect.fail(`Node built-in import(s) reachable from packages/core/algorithms/breakdown/index.ts: ${detail}`);
    }
  });

  it("never reaches a Node built-in import from packages/core/algorithms/sigma1/rp/constants.ts (checked for Node built-ins only — this entry point legitimately lives under packages/core/algorithms/, plan 06.1-08 Task 3, G-06.1-26)", () => {
    const { nodeBuiltinViolations, visited } = scan([RP_CONSTANTS_ENTRY_POINT]);
    expect(visited.has(RP_CONSTANTS_ENTRY_POINT)).toBe(true);
    if (nodeBuiltinViolations.length > 0) {
      const detail = nodeBuiltinViolations.map((v) => `${v.file} imports "${v.specifier}"`).join("; ");
      expect.fail(`Node built-in import(s) reachable from packages/core/algorithms/sigma1/rp/constants.ts: ${detail}`);
    }
  });

  it("never reaches a Node built-in import from packages/core/algorithms/simulation/rankSimulation.ts (checked for Node built-ins only — this entry point legitimately lives under packages/core/algorithms/, plan 08-03 Task 1)", () => {
    const { nodeBuiltinViolations, visited } = scan([RANK_SIMULATION_ENTRY_POINT]);
    expect(visited.has(RANK_SIMULATION_ENTRY_POINT)).toBe(true);
    if (nodeBuiltinViolations.length > 0) {
      const detail = nodeBuiltinViolations.map((v) => `${v.file} imports "${v.specifier}"`).join("; ");
      expect.fail(`Node built-in import(s) reachable from packages/core/algorithms/simulation/rankSimulation.ts: ${detail}`);
    }
  });

  it("never reaches a Node built-in import from packages/harness/teamRanks.ts (checked for Node built-ins only — this module intentionally imports from packages/core/algorithms/eventTypes.ts and types.ts, quick task 260905-ldu)", () => {
    const { nodeBuiltinViolations, visited } = scan([TEAM_RANKS_ENTRY_POINT]);
    // Sanity check the scan is not vacuous: it must actually visit the two
    // packages/core/algorithms/ leaf modules this module imports from.
    expect(visited.has(TEAM_RANKS_ENTRY_POINT)).toBe(true);
    expect(visited.has(resolve(HERE, "..", "core", "algorithms", "eventTypes.ts"))).toBe(true);
    expect(visited.has(resolve(HERE, "..", "core", "algorithms", "types.ts"))).toBe(true);
    if (nodeBuiltinViolations.length > 0) {
      const detail = nodeBuiltinViolations.map((v) => `${v.file} imports "${v.specifier}"`).join("; ");
      expect.fail(`Node built-in import(s) reachable from packages/harness/teamRanks.ts: ${detail}`);
    }
  });
});
