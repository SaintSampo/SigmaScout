/**
 * THE JOINT DRAW'S CALLER GUARD (quick task 261014-qv2).
 *
 * Every District Locks advancement run draws each event that carries per run
 * data ONCE, shared by all its teams, and it gets there because two things
 * hold: the input builders ask the simulation for the per run record, and every
 * `buildAdvancementChanceRun(` call hands over the SAME distributions map its
 * rows were built from. A new chance call that forgets the map would quietly
 * fall back to independent draws. This source guard pins both, and pins that
 * the publisher never records (its output must stay byte identical).
 *
 * The two measurement scripts pass the map conditionally, under their
 * `--independent-draws` arm (the shipped independent draw, kept for the
 * before and after comparison); their argument text still names
 * `distributions`, which is what this guard reads.
 *
 * Source text, not types, in `pickDraftCallers.test.ts`'s style: CRLF is
 * normalised and comment lines are ignored.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_ROOTS = ["apps/web/src", "apps/worker/src", "packages", "scripts"];
const SKIPPED_DIRS = new Set(["node_modules", "dist", ".wrangler"]);

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

/** Every `buildAdvancementChanceRun(` call's argument text, parentheses balanced, over the file's code lines. */
function callArguments(file: string): string[] {
  const code = codeLines(file).join("\n");
  const out: string[] = [];
  const pattern = /\bbuildAdvancementChanceRun\s*\(/g;
  for (let match = pattern.exec(code); match !== null; match = pattern.exec(code)) {
    const before = code.slice(Math.max(0, match.index - 9), match.index);
    if (/function\s$/.test(before)) continue;
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (i < code.length && depth > 0) {
      if (code[i] === "(") depth += 1;
      else if (code[i] === ")") depth -= 1;
      i += 1;
    }
    out.push(code.slice(start, i - 1));
  }
  return out;
}

const FILES = sourceFiles();

/** The reviewed `buildAdvancementChanceRun(` call sites. */
const REVIEWED_CHANCE_CALLERS = [
  "apps/web/src/components/districts/ChampLocksLedger.tsx",
  "apps/web/src/components/districts/DistrictLedger.tsx",
  "scripts/measureChampCutoff.ts",
  "scripts/measureDistrictCutoff.ts",
  "scripts/measureLocksInRange.ts",
];

describe("the joint draw's callers are a reviewed set (quick task 261014-qv2)", () => {
  it("scans a real tree", () => {
    expect(FILES).toContain("apps/web/src/components/districts/districtLedgerChances.ts");
    expect(FILES).toContain("scripts/publishDistricts.ts");
  });

  it("calls buildAdvancementChanceRun only from the reviewed files", () => {
    const callers = FILES.filter((file) => callArguments(file).length > 0);
    expect(callers, "buildAdvancementChanceRun call sites changed: pass the rows' own distributions map, then add the file here").toEqual(
      [...REVIEWED_CHANCE_CALLERS].sort()
    );
  });

  it("every call passes the distributions map", () => {
    for (const file of REVIEWED_CHANCE_CALLERS) {
      const calls = callArguments(file);
      expect(calls.length, `${file} has no buildAdvancementChanceRun call`).toBeGreaterThan(0);
      for (const argument of calls) {
        expect(argument.includes("distributions"), `${file}: a buildAdvancementChanceRun call does not pass distributions: ${argument}`).toBe(true);
      }
    }
  });

  it("both input builders ask for the per run record", () => {
    for (const builder of ["apps/web/src/components/districts/districtLedgerRows.ts", "apps/web/src/components/districts/districtRunAssembly.ts"]) {
      expect(
        codeLines(builder).some((line) => line.includes("recordEventTotalByRun: true")),
        `${builder} no longer sets recordEventTotalByRun: true`
      ).toBe(true);
    }
  });

  it("the as of runner forwards the flag to the bake", () => {
    expect(codeLines("apps/web/src/workers/districtAsOfJob.ts").some((line) => line.includes("recordEventTotalByRun"))).toBe(true);
  });

  it("the publisher never records, so its bake stays byte identical", () => {
    expect(codeLines("scripts/publishDistricts.ts").some((line) => line.includes("recordEventTotalByRun"))).toBe(false);
  });
});
