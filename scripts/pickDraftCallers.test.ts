/**
 * THE WEIGHTED PICK DRAFT'S CALLER GUARD (quick task 261014-ol6).
 *
 * Every simulated draft behind a displayed or published Locks number draws its
 * picks from `pickPositionPmfForSeason(season)`, and it gets there because the
 * pmf is set inside the two input builders every shipped caller shares:
 * `buildDistrictEventSimulationInput` (web) and `bakeDistrictEvent` (harness).
 * A new `simulateDistrictEvent` call site, or a new hand written
 * `DistrictLedgerEventInput` literal, could quietly skip both and price a
 * fixed SPR draft again. This source guard pins both sets to a reviewed
 * allowlist, so such a change fails here and gets a second look.
 *
 * Source text, not types: CRLF is normalised and comment lines are ignored, so
 * a doc comment that names the function is never counted as a call.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_ROOTS = ["apps/web/src", "apps/worker/src", "packages", "scripts"];
const SKIPPED_DIRS = new Set(["node_modules", "dist", ".wrangler"]);

/** Every non test `.ts`/`.tsx` source under the scan roots, repo relative with forward slashes. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(join(dir, entry.name));
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name) || entry.name.endsWith(".d.ts")) continue;
      out.push(relative(REPO_ROOT, join(dir, entry.name)).split("\\").join("/"));
    }
  };
  for (const root of SCAN_ROOTS) walk(join(REPO_ROOT, root));
  return out.sort();
}

/** The file's code lines: CRLF normalised, and every line that is only a comment dropped. */
function codeLines(file: string): string[] {
  return readFileSync(join(REPO_ROOT, file), "utf8")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line));
}

const FILES = sourceFiles();
const ROUTE_HINT =
  "Route a new caller through buildDistrictEventSimulationInput (apps/web/src/components/districts/districtLedgerRows.ts) " +
  "or bakeDistrictEvent (packages/harness/districtBake.ts), which set pickPositionPmfForSeason(season), " +
  "then add it to this reviewed list.";

/** The reviewed `simulateDistrictEvent(` call sites. */
const REVIEWED_CALL_SITES = [
  "apps/web/src/workers/districtAsOfJob.ts",
  "apps/web/src/workers/districtSimulationProtocol.ts",
  "packages/harness/districtBake.ts",
  "scripts/measureChampCutoff.ts",
  // The measurement keeps its fixed draft arm on purpose (quick task 261014-mji).
  "scripts/measureRandomPickDraft.ts",
];

/** The reviewed files that write a `DistrictLedgerEventInput` object literal. */
const REVIEWED_INPUT_LITERALS = [
  // The web builder: sets the pmf.
  "apps/web/src/components/districts/districtLedgerRows.ts",
  // The GENERATED as-of request: never simulated directly; the bake sets the pmf.
  "apps/web/src/components/districts/districtRunAssembly.ts",
  // The bake: sets the pmf.
  "packages/harness/districtBake.ts",
  "scripts/measureRandomPickDraft.ts",
];

const CALL = /\bsimulateDistrictEvent\s*\(/;
const DEFINITION = /\bfunction\s+simulateDistrictEvent\s*\(/;
const INPUT_LITERAL =
  /:\s*DistrictLedgerEventInput\s*=\s*\{|\)\s*:\s*DistrictLedgerEventInput\s*\{|\bas\s+DistrictLedgerEventInput\b|\bsatisfies\s+DistrictLedgerEventInput\b/;

describe("the weighted pick draft's callers are a reviewed set (quick task 261014-ol6)", () => {
  it("scans a real tree", () => {
    expect(FILES).toContain("packages/core/districts/ledgerSimulation.ts");
    expect(FILES).toContain("apps/web/src/components/districts/districtLedgerRows.ts");
  });

  it("calls simulateDistrictEvent only from the reviewed files", () => {
    const callers = FILES.filter((file) => codeLines(file).some((line) => CALL.test(line) && !DEFINITION.test(line)));
    expect(callers, `simulateDistrictEvent call sites changed. ${ROUTE_HINT}`).toEqual([...REVIEWED_CALL_SITES].sort());
  });

  it("writes a DistrictLedgerEventInput object literal only in the reviewed files", () => {
    const writers = FILES.filter((file) => codeLines(file).some((line) => INPUT_LITERAL.test(line)));
    expect(writers, `DistrictLedgerEventInput literals changed. ${ROUTE_HINT}`).toEqual([...REVIEWED_INPUT_LITERALS].sort());
  });

  it("each of the two builders sets the season's pmf", () => {
    for (const builder of ["apps/web/src/components/districts/districtLedgerRows.ts", "packages/harness/districtBake.ts"]) {
      expect(
        codeLines(builder).some((line) => line.includes("pickPositionPmfForSeason(")),
        `${builder} no longer calls pickPositionPmfForSeason(`
      ).toBe(true);
    }
  });

  it("the Cloudflare Worker imports no simulation, so a draft change never needs a Worker deploy", () => {
    const importsSimulation = /(from\s+|import\s*\(\s*)["'][^"']*\/(ledgerSimulation|districtBake)(\.js|\.ts)?["']/;
    const offenders = FILES.filter((file) => file.startsWith("apps/worker/src/")).filter((file) =>
      codeLines(file).some((line) => importsSimulation.test(line))
    );
    expect(FILES.some((file) => file.startsWith("apps/worker/src/"))).toBe(true);
    expect(offenders).toEqual([]);
  });
});
