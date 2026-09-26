/**
 * A static import-graph scan proving every browser-facing entry point
 * never transitively reaches a Node built-in import (which would break the
 * web build) or, for the two strictest entry points, any file under
 * `packages/core/algorithms/` (which would drag the whole algorithm
 * implementation into a browser bundle). This is a REAL guard, not a
 * vacuous one: temporarily re-pointing an entry point's import at a
 * Node-importing module makes the relevant test fail, naming that file.
 *
 * Two check strengths, by where an entry point LIVES:
 * - `pageArtifacts.ts` and `publishedAlgorithms.ts` live in
 *   `packages/harness/` and are held to the FULL assertion: no Node
 *   built-in, and no file under `packages/core/algorithms/` at all.
 * - Every other entry point below legitimately LIVES under
 *   `packages/core/algorithms/` or its sibling `packages/core/
 *   rankingPoints/` (the client bundles it on purpose, importing a specific
 *   function from it), so the stricter "never reaches algorithms/"
 *   assertion would trivially fail on the entry point itself. These are
 *   checked ONLY for Node built-in imports, so a future Node-only import
 *   added anywhere in their reachable graph still breaks the web build with
 *   a clear, named failure here rather than a confusing bundler error far
 *   from its cause.
 *
 * Scope: static `import`/`export ... from` specifiers only — this repo has
 * no dynamic imports in the modules under scan.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
// `eventSchedule.ts` (260915-m4j): the publisher's schedule-currency rule, reused by the web for polling and team-page fetches.
// `districtRankingsMerge.ts` (10-03): the one shared producer of the merged
// district shape. The live Worker bundles it, so it is held to the FULL
// assertion — no Node built-in AND nothing under `packages/core/algorithms/`.
const ENTRY_POINTS = [resolve(HERE, "pageArtifacts.ts"), resolve(HERE, "publishedAlgorithms.ts"), resolve(HERE, "eventSchedule.ts"), resolve(HERE, "districtRankingsMerge.ts")];
const BREAKDOWN_ENTRY_POINT = resolve(HERE, "..", "core", "algorithms", "breakdown", "index.ts");
const RP_CONSTANTS_ENTRY_POINT = resolve(HERE, "..", "core", "rankingPoints", "constants.ts");
const RANK_SIMULATION_ENTRY_POINT = resolve(HERE, "..", "core", "algorithms", "simulation", "rankSimulation.ts");
const TEAM_RANKS_ENTRY_POINT = resolve(HERE, "teamRanks.ts");
const MARGINALS_ENTRY_POINT = resolve(HERE, "..", "core", "rankingPoints", "marginals.ts");
const ANALYTIC_PMF_ENTRY_POINT = resolve(HERE, "..", "core", "rankingPoints", "analyticPmf.ts");
const FIELD_AVERAGED_ENTRY_POINT = resolve(HERE, "..", "core", "rankingPoints", "fieldAveraged.ts");
// `allianceWinProbability.ts` (10-02): the browser's alliance pricer. 10-04 draws
// the district-points bracket with it and 10-07 runs it inside a Web Worker.
const ALLIANCE_WIN_PROBABILITY_ENTRY_POINT = resolve(HERE, "..", "core", "algorithms", "simulation", "allianceWinProbability.ts");
// `ledgerSimulation.ts` (10-04): the joint district ledger run. Its two
// callers are a browser Web Worker (10-07) and the offline publisher (10-06),
// so a Node built-in anywhere in its reachable graph would break the web build.
const LEDGER_SIMULATION_ENTRY_POINT = resolve(HERE, "..", "core", "districts", "ledgerSimulation.ts");
const FORBIDDEN_DIR = resolve(HERE, "..", "core", "algorithms");

/**
 * Matches one `import ... from "spec"` or `export ... from "spec"` STATEMENT,
 * whether it sits on one line or spans several.
 *
 * SPANNING SEVERAL IS THE WHOLE POINT, and this regex is a correction. The
 * shipped version was anchored per LINE and required `from "spec"` on the same
 * line as the `import` keyword, on the stated basis that "this repo's
 * convention keeps every such statement on one line". That convention is not
 * enforced anywhere and this repo does not follow it: a named import list long
 * enough for Prettier to break is formatted across lines, and every one of
 * those was invisible to this scan. The hole was found on 2026-09-25 when
 * `ledgerSimulation.ts`'s `./bracket.js` import grew a sixth name and the
 * not-vacuous assertion below went red — the assertion caught it, which is
 * exactly why that assertion is there. A `node:` import inside a broken-up list
 * would have been missed in silence.
 *
 * `[^;]*?` is what spans the newlines: it cannot run past the statement's own
 * semicolon, so one statement can never swallow the next.
 */
const IMPORT_STATEMENT_RE = /(?:^|\n)[ \t]*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g;

interface ScanResult {
  visited: Set<string>;
  nodeBuiltinViolations: Array<{ file: string; specifier: string }>;
  algorithmDirViolations: string[];
}

export function extractImportSpecifiers(filePath: string): string[] {
  const content = readFileSync(filePath, "utf8");
  return extractImportSpecifiersFromSource(content);
}

/** The source-level half, exported so a test can hand it a multi-line statement directly rather than writing a fixture file. */
export function extractImportSpecifiersFromSource(source: string): string[] {
  const specifiers: string[] = [];
  // A fresh regex per call: a `g` flag carries `lastIndex` between calls.
  const pattern = new RegExp(IMPORT_STATEMENT_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (match[1]) specifiers.push(match[1]);
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

describe("the import extractor itself", () => {
  it("sees a specifier whose statement spans several lines, which is what the per-line version missed", () => {
    const source = [
      'import { a } from "./one.js";',
      "import {",
      "  b,",
      "  type C,",
      '} from "./two.js";',
      "import {",
      "  readFileSync,",
      '} from "node:fs";',
      'export * from "./three.js";',
      'export { d } from "./four.js";',
    ].join("\n");
    expect(extractImportSpecifiersFromSource(source)).toEqual([
      "./one.js",
      "./two.js",
      "node:fs",
      "./three.js",
      "./four.js",
    ]);
  });

  it("does not read a statement's specifier past its own semicolon, and is not fooled by the word from inside a string", () => {
    const source = ['import "./side-effect.js";', 'export function label(): string {', '  return "from ./nowhere.js";', "}"].join("\n");
    // `import "./side-effect.js"` carries no `from` at all and is not a graph
    // edge this scan needs; what matters is that nothing invents `./nowhere.js`.
    expect(extractImportSpecifiersFromSource(source)).toEqual([]);
  });
});

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
    expect(visited.has(resolve(HERE, "eventSchedule.ts"))).toBe(true);
    expect(visited.has(resolve(HERE, "districtRankingsMerge.ts"))).toBe(true);
    // The merge's own district-math leaves, so the scan provably follows it
    // rather than stopping at the entry point itself.
    expect(visited.has(resolve(HERE, "..", "core", "districts", "locks.ts"))).toBe(true);
    expect(visited.has(resolve(HERE, "..", "core", "districts", "pointModel.ts"))).toBe(true);
  });

  it("eventSchedule.ts imports nothing, and publish.ts re-exports the very same function and constant (one rule, not a copy)", async () => {
    expect(extractImportSpecifiers(resolve(HERE, "eventSchedule.ts"))).toEqual([]);
    const schedule = await import("./eventSchedule.js");
    const publish = await import("./publish.js");
    expect(publish.eventScheduleIsCurrent).toBe(schedule.eventScheduleIsCurrent);
    expect(publish.SCHEDULE_STALE_AFTER_MS).toBe(schedule.SCHEDULE_STALE_AFTER_MS);
  });

  it("metricHistorySchema.ts specifically carries zero Node-only imports — a future Node import there is caught by this named assertion, not a broken production build", () => {
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

  it("never reaches a Node built-in import from packages/core/rankingPoints/constants.ts (checked for Node built-ins only — this entry point lives in packages/core/rankingPoints/, outside algorithms/ entirely)", () => {
    const { nodeBuiltinViolations, visited } = scan([RP_CONSTANTS_ENTRY_POINT]);
    expect(visited.has(RP_CONSTANTS_ENTRY_POINT)).toBe(true);
    if (nodeBuiltinViolations.length > 0) {
      const detail = nodeBuiltinViolations.map((v) => `${v.file} imports "${v.specifier}"`).join("; ");
      expect.fail(`Node built-in import(s) reachable from packages/core/rankingPoints/constants.ts: ${detail}`);
    }
  });

  it("never reaches a Node built-in import from packages/core/algorithms/simulation/rankSimulation.ts (checked for Node built-ins only — this entry point legitimately lives under packages/core/algorithms/)", () => {
    const { nodeBuiltinViolations, visited } = scan([RANK_SIMULATION_ENTRY_POINT]);
    expect(visited.has(RANK_SIMULATION_ENTRY_POINT)).toBe(true);
    if (nodeBuiltinViolations.length > 0) {
      const detail = nodeBuiltinViolations.map((v) => `${v.file} imports "${v.specifier}"`).join("; ");
      expect.fail(`Node built-in import(s) reachable from packages/core/algorithms/simulation/rankSimulation.ts: ${detail}`);
    }
  });

  it("never reaches a Node built-in import from packages/harness/teamRanks.ts (checked for Node built-ins only — this module intentionally imports from packages/core/algorithms/eventTypes.ts and types.ts)", () => {
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

  it("never reaches a Node built-in import from packages/core/rankingPoints/marginals.ts (checked for Node built-ins only — this entry point legitimately lives under packages/core/rankingPoints/, outside packages/core/algorithms/ entirely)", () => {
    const { nodeBuiltinViolations, visited } = scan([MARGINALS_ENTRY_POINT]);
    expect(visited.has(MARGINALS_ENTRY_POINT)).toBe(true);
    if (nodeBuiltinViolations.length > 0) {
      const detail = nodeBuiltinViolations.map((v) => `${v.file} imports "${v.specifier}"`).join("; ");
      expect.fail(`Node built-in import(s) reachable from packages/core/rankingPoints/marginals.ts: ${detail}`);
    }
  });

  it("never reaches a Node built-in import from packages/core/rankingPoints/analyticPmf.ts (checked for Node built-ins only — this entry point legitimately lives under packages/core/rankingPoints/, outside packages/core/algorithms/ entirely)", () => {
    const { nodeBuiltinViolations, visited } = scan([ANALYTIC_PMF_ENTRY_POINT]);
    expect(visited.has(ANALYTIC_PMF_ENTRY_POINT)).toBe(true);
    // Sanity check the scan is not vacuous: it must actually visit the
    // sibling leaves this module imports from.
    expect(visited.has(resolve(HERE, "..", "core", "rankingPoints", "constants.ts"))).toBe(true);
    expect(visited.has(resolve(HERE, "..", "core", "rankingPoints", "marginals.ts"))).toBe(true);
    if (nodeBuiltinViolations.length > 0) {
      const detail = nodeBuiltinViolations.map((v) => `${v.file} imports "${v.specifier}"`).join("; ");
      expect.fail(`Node built-in import(s) reachable from packages/core/rankingPoints/analyticPmf.ts: ${detail}`);
    }
  });
  it("never reaches a Node built-in import from packages/core/rankingPoints/fieldAveraged.ts (checked for Node built-ins only — this entry point legitimately lives under packages/core/rankingPoints/, outside packages/core/algorithms/ entirely)", () => {
    const { nodeBuiltinViolations, visited } = scan([FIELD_AVERAGED_ENTRY_POINT]);
    expect(visited.has(FIELD_AVERAGED_ENTRY_POINT)).toBe(true);
    // Sanity check the scan is not vacuous: it must actually visit the
    // sibling leaf this module's whole runtime graph consists of. The
    // `rankSimulation.ts` edge is TYPE-ONLY by design, so it is deliberately
    // NOT asserted here — asserting it would force a runtime import that the
    // module does not need and does not have.
    expect(visited.has(ANALYTIC_PMF_ENTRY_POINT)).toBe(true);
    if (nodeBuiltinViolations.length > 0) {
      const detail = nodeBuiltinViolations.map((v) => `${v.file} imports "${v.specifier}"`).join("; ");
      expect.fail(`Node built-in import(s) reachable from packages/core/rankingPoints/fieldAveraged.ts: ${detail}`);
    }
  });

  it("never reaches a Node built-in import from packages/core/algorithms/simulation/allianceWinProbability.ts (checked for Node built-ins only — this entry point legitimately lives under packages/core/algorithms/)", () => {
    const { nodeBuiltinViolations, visited } = scan([ALLIANCE_WIN_PROBABILITY_ENTRY_POINT]);
    expect(visited.has(ALLIANCE_WIN_PROBABILITY_ENTRY_POINT)).toBe(true);
    // Sanity check the scan is not vacuous: it must actually visit this
    // module's one runtime import, the shared browser-safe erf/normal CDF.
    expect(visited.has(MARGINALS_ENTRY_POINT)).toBe(true);
    if (nodeBuiltinViolations.length > 0) {
      const detail = nodeBuiltinViolations.map((v) => `${v.file} imports "${v.specifier}"`).join("; ");
      expect.fail(`Node built-in import(s) reachable from packages/core/algorithms/simulation/allianceWinProbability.ts: ${detail}`);
    }
  });

  it("never reaches a Node built-in import from packages/core/districts/ledgerSimulation.ts (checked for Node built-ins only — this entry point reaches packages/core/algorithms/ on purpose, for the rank simulation and the alliance pricer)", () => {
    const { nodeBuiltinViolations, visited } = scan([LEDGER_SIMULATION_ENTRY_POINT]);
    expect(visited.has(LEDGER_SIMULATION_ENTRY_POINT)).toBe(true);
    // Sanity check the scan is not vacuous: it must actually visit the 10-01
    // formula leaves this module composes. The promoted quantile module is
    // deliberately NOT asserted here — `ledgerSimulation.ts` does not import
    // it; `pointSummary.ts` does.
    expect(visited.has(resolve(HERE, "..", "core", "districts", "qualPoints.ts"))).toBe(true);
    expect(visited.has(resolve(HERE, "..", "core", "districts", "bracket.ts"))).toBe(true);
    if (nodeBuiltinViolations.length > 0) {
      const detail = nodeBuiltinViolations.map((v) => `${v.file} imports "${v.specifier}"`).join("; ");
      expect.fail(`Node built-in import(s) reachable from packages/core/districts/ledgerSimulation.ts: ${detail}`);
    }
  });
});
