/**
 * THE SEAL's gate. Three groups of assertions, by design:
 *
 * 1. Everything that must hold with NO corpus present — the year-set pins,
 *    the comment-stripped source scan of `evaluate.ts`/`tune.ts`, and the
 *    forbidden-import scan — sits OUTSIDE any `existsSync` guard (hazard 8:
 *    a machine without `data/corpus.sqlite` must not silently disable the
 *    only thing protecting the holdout).
 * 2. A self-test proving the source scan itself bites, against inline
 *    fixture strings (never against real files, so no red state is ever
 *    committed) — hazard 9: a header comment naming either token would
 *    fail the scan if it weren't comment-stripped first, so the scan MUST
 *    strip `//`-to-EOL and `/* ... *\/` before searching.
 * 3. Everything that needs the real corpus (the loadSeason throw/no-throw
 *    behavior and its two equality-pinned row counts) sits BEHIND the
 *    established `existsSync` + `it.skip` guard
 *    (`breakdown/reconciliation.test.ts:170`'s pattern).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DESIGN_YEARS, HOLDOUT_YEARS } from "./cli.js";
import { loadSeason } from "./data.js";

const CORPUS_PATH = "data/corpus.sqlite";
const GBR_DIR = fileURLToPath(new URL(".", import.meta.url));

const SEAL_BREAK_TOKEN = "breakSeal";
const HOLDOUT_TOKEN = "HOLDOUT_YEARS";

/** Strips `/* ... *\/` and `//`-to-EOL regions before searching — hazard 9. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function tokensPresent(src: string): string[] {
  const stripped = stripComments(src);
  const found: string[] = [];
  if (stripped.includes(SEAL_BREAK_TOKEN)) found.push(SEAL_BREAK_TOKEN);
  if (stripped.includes(HOLDOUT_TOKEN)) found.push(HOLDOUT_TOKEN);
  return found;
}

// --- 1. year-set pins (no corpus needed) ------------------------------------

describe("THE SEAL — year sets", () => {
  it("DESIGN_YEARS matches the literal design-year list exactly", () => {
    expect(DESIGN_YEARS).toEqual([2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025]);
  });

  it("HOLDOUT_YEARS matches the literal holdout-year list exactly", () => {
    expect(HOLDOUT_YEARS).toEqual([2026]);
  });

  it("DESIGN_YEARS and HOLDOUT_YEARS are disjoint", () => {
    const holdoutSet = new Set(HOLDOUT_YEARS);
    const overlap = DESIGN_YEARS.filter((y) => holdoutSet.has(y));
    expect(overlap).toEqual([]);
  });

  it("2021 is in neither list — a permanent exclusion (no comparable FRC season), not a gap", () => {
    expect(DESIGN_YEARS.includes(2021)).toBe(false);
    expect(HOLDOUT_YEARS.includes(2021)).toBe(false);
  });
});

// --- 2. the comment-stripped source scan, against the REAL files (no corpus needed) --

describe("THE SEAL — evaluate.ts/tune.ts must never name the seal-break token or the holdout year set", () => {
  for (const file of ["evaluate.ts", "tune.ts"]) {
    it(`${file} contains neither token in executable source`, () => {
      const path = `${GBR_DIR}${file}`;
      if (!existsSync(path)) {
        // Task 1: these files do not exist yet (built in Task 3). Task 3's
        // own Verify step re-runs this exact suite once they do, at which
        // point this branch stops firing for both files.
        return;
      }
      const src = readFileSync(path, "utf8");
      expect(tokensPresent(src)).toEqual([]);
    });
  }
});

// --- proof the scan itself bites, against inline fixtures — never real files --

describe("THE SEAL — the source scan is proven to bite (hazard 9)", () => {
  it("does NOT fire on a token that only appears inside a comment", () => {
    const fixture = [
      "// this module never touches breakSeal or the HOLDOUT_YEARS set",
      "/* also not here: breakSeal, HOLDOUT_YEARS */",
      "export const x = 1;",
    ].join("\n");
    expect(tokensPresent(fixture)).toEqual([]);
  });

  it("DOES fire on the seal-break token in executable source", () => {
    const fixture = "export function f(x) { return x.breakSeal === true; }";
    expect(tokensPresent(fixture)).toEqual([SEAL_BREAK_TOKEN]);
  });

  it("DOES fire on the holdout-year-set identifier in executable source", () => {
    const fixture = 'import { HOLDOUT_YEARS } from "./cli.js";';
    expect(tokensPresent(fixture)).toEqual([HOLDOUT_TOKEN]);
  });
});

// --- forbidden-import scan (no corpus needed) -------------------------------

describe("THE SEAL — import firewall", () => {
  const FORBIDDEN = [/harness/, /algorithms\/opr/, /algorithms\/epa/, /algorithms\/bpr/, /algorithms\/sigma1/];

  it("no packages/gbr/*.ts file imports harness or opr/epa/bpr/sigma1 model internals", () => {
    const files = readdirSync(GBR_DIR).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    const importRe = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
    for (const file of files) {
      const src = readFileSync(`${GBR_DIR}${file}`, "utf8");
      let m: RegExpExecArray | null;
      importRe.lastIndex = 0;
      while ((m = importRe.exec(src)) !== null) {
        const spec = m[1]!;
        for (const pattern of FORBIDDEN) {
          if (pattern.test(spec)) {
            violations.push(`${file}: "${spec}" matches ${pattern}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

// --- 3. corpus-backed behavior, behind the established existsSync guard ----

describe("THE SEAL — loadSeason throws for the holdout year, and only for it", () => {
  const corpusPresent = existsSync(CORPUS_PATH);

  it.skipIf(!corpusPresent)("loadSeason(2026) throws, naming 2026", () => {
    expect(() => loadSeason(2026)).toThrow(/2026/);
  });

  // 2026-09-10: the exact-count pin (20,297) went stale — the corpus is LIVE
  // and offseason ingest grows the 2026 season continuously (20,408 at the
  // time of this edit). The seal-time count becomes a FLOOR: the assertion's
  // job is proving breakSeal actually loads the full season, not freezing the
  // corpus. GBR itself is shelved (2026-09-08); this keeps its seal test
  // honest without weekly maintenance.
  it.skipIf(!corpusPresent)("loadSeason(2026, { breakSeal: true }) does not throw, and returns at least the seal-time 20,297 rows", () => {
    const rows = loadSeason(2026, { breakSeal: true });
    expect(rows.length).toBeGreaterThanOrEqual(20297);
  });

  it.skipIf(!corpusPresent)("loadSeason(2016) returns 15,572 rows", () => {
    const rows = loadSeason(2016);
    expect(rows.length).toBe(15572);
  });

  if (!corpusPresent) {
    it.skip("corpus-backed seal assertions skipped: data/corpus.sqlite is absent", () => {});
  }
});
