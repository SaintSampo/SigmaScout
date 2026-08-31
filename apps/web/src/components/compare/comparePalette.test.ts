/**
 * The shipped-token guard this plan's own outline named as an obligation
 * that must not be hand-waved (08-10-PLAN.md Task 1). Two independent
 * measurements, run live during planning against these exact shipped
 * `theme.css` values with the dataviz skill's `validate_palette.js
 * --pairs all` (light mode, both `--surface #F8FAFC` and `#F1F5F9`):
 *
 *  - The trio ALONE (`--compare-algo-opr` #EA580C, `-epa` #7C3AED, `-vpr`
 *    #0D9488) passes every check on both surfaces: worst all-pairs ΔE 13.8
 *    protan / 13.6 tritan / 28.8 normal vision.
 *  - The trio PLUS the three `--tier-*-fg` tokens (`--tier-rare-fg` #0369A1,
 *    `--tier-epic-fg` #7E22CE, `--tier-legendary-fg` #B45309) FAILS: the pair
 *    `--compare-algo-epa` #7C3AED / `--tier-epic-fg` #7E22CE measures ΔE 5.4
 *    deutan / 6.9 tritan / 6.0 normal vision — indistinguishable for every
 *    reader, not only colour-blind ones.
 *
 * Neither value may move to resolve that collision (sketch 006 locks the
 * trio; `colour-and-tiers.md` locks the tier palette with its own "do not
 * fix this" warning; 08-CONTEXT.md forbids any `--tier-*` VALUE change this
 * phase outright). The disposition is SEPARATION: the Compare page renders
 * no tier box and no metric-tier concept at all, so the six are never asked
 * to be told apart in practice — but that must be an ENFORCED fact, not a
 * remembered one, which is this file's whole job.
 *
 * This file necessarily contains the pinned hex values and names the
 * colliding tier token above — a check that scanned itself for either would
 * fail by construction. The `.test.ts`/`.test.tsx` exclusion in the second
 * describe block below is therefore load-bearing: the rule is about SHIPPED
 * RENDERING CODE under `apps/web/src/components/compare/`, never about this
 * guard's own fixture-like prose.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME_CSS_PATH = resolve(HERE, "..", "..", "styles", "theme.css");
const COMPARE_ROUTE_PATH = resolve(HERE, "..", "..", "routes", "compare.tsx");
const THIS_FILE_PATH = resolve(HERE, "comparePalette.test.ts");

/** The three declared hex values (08-UI-SPEC.md Color section, sketch 006). Compared case-insensitively against theme.css's own declarations below. */
const EXPECTED_TOKENS: Readonly<Record<string, string>> = {
  "--compare-algo-opr": "#EA580C",
  "--compare-algo-epa": "#7C3AED",
  "--compare-algo-vpr": "#0D9488",
};

function readThemeCss(): string {
  return readFileSync(THEME_CSS_PATH, "utf8");
}

/** Extracts a custom property's own declared value from a `--name: value;` line, case-insensitively on the property name. */
function declaredValue(css: string, propertyName: string): string | undefined {
  const re = new RegExp(`${propertyName}\\s*:\\s*([^;]+);`, "i");
  return re.exec(css)?.[1]?.trim();
}

describe("comparePalette — theme.css token pinning (Task 1 acceptance)", () => {
  it("declares all three --compare-algo-* tokens at their sketch-006-validated hex values", () => {
    const css = readThemeCss();
    for (const [propertyName, expectedHex] of Object.entries(EXPECTED_TOKENS)) {
      const actual = declaredValue(css, propertyName);
      expect(actual, `expected ${propertyName} to be declared in theme.css`).toBeDefined();
      expect(actual!.toLowerCase()).toBe(expectedHex.toLowerCase());
    }
  });
});

/**
 * Enumerates the compare surface's source files at TEST TIME (never a
 * hand-listed filename array) — everything under
 * `apps/web/src/components/compare/` whose name does not end in `.test.ts`
 * or `.test.tsx`, plus `apps/web/src/routes/compare.tsx`. Files 08-06 and
 * 08-12 add are covered automatically, without editing this test.
 */
function compareSurfaceFiles(): string[] {
  const entries = readdirSync(HERE, { withFileTypes: true });
  const componentFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(HERE, entry.name))
    .filter((path) => [".ts", ".tsx"].includes(extname(path)))
    .filter((path) => !path.endsWith(".test.ts") && !path.endsWith(".test.tsx"));
  return [...componentFiles, COMPARE_ROUTE_PATH];
}

const HEX_LITERAL_RE = /#[0-9A-Fa-f]{6}\b/;
const TIER_TOKEN_RE = /--tier-/;
const METRIC_TIER_CLASS_RE = /metric-tier/;

describe("comparePalette — no --tier-* / metric-tier / raw-hex leakage onto the compare surface", () => {
  it("enumerates a non-empty, test-file-free set that includes the route and the accuracy table", () => {
    const files = compareSurfaceFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain(COMPARE_ROUTE_PATH);
    expect(files.some((path) => path.endsWith("AccuracyTable.tsx"))).toBe(true);
    expect(files).not.toContain(THIS_FILE_PATH);
    for (const path of files) {
      expect(path.endsWith(".test.ts") || path.endsWith(".test.tsx"), `${path} should not be a test file`).toBe(false);
    }
  });

  it("no compare-surface source file references --tier-* or the metric-tier class", () => {
    const offenders: string[] = [];
    for (const path of compareSurfaceFiles()) {
      const content = readFileSync(path, "utf8");
      if (TIER_TOKEN_RE.test(content) || METRIC_TIER_CLASS_RE.test(content)) offenders.push(path);
    }
    expect(offenders, `--tier-* or metric-tier found in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("no compare-surface source file contains a raw hex colour literal", () => {
    const offenders: string[] = [];
    for (const path of compareSurfaceFiles()) {
      const content = readFileSync(path, "utf8");
      if (HEX_LITERAL_RE.test(content)) offenders.push(path);
    }
    expect(offenders, `raw hex literal found in: ${offenders.join(", ")}`).toEqual([]);
  });
});
