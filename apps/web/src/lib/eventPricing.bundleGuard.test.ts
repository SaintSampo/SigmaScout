/**
 * BUNDLE GUARD for browser pricing (260915-m4j).
 *
 * The pricer, the RP moment, mean-shift and analytic pmf code and the
 * per-season rule modules must ship only in lazily loaded chunks: a visitor
 * on a finished event, or on any non-event page, must never download them.
 * The one door is `eventPricing.ts`'s dynamic `import("./eventPricing.lazy.js")`.
 *
 * This is a source scan, the fast early warning. The real proof is the
 * built bundle (the 260915-m4j SUMMARY records marker literals and chunk
 * sizes from `vite build`), because a scan of `apps/web/src` cannot see a
 * transitive static import from a package file.
 *
 * Positive control: the detector is run on synthetic import lines first, so
 * a regex that silently matches nothing cannot make this test pass.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Module basenames only the lazy chunk may import statically. */
const LAZY_ONLY_MODULES = ["eventPricing.lazy", "eventStatePricing", "rulesLoader", "analyticPmf", "empiricalMoments", "meanShift"] as const;

/**
 * Every static `import ... from "x"`, `export ... from "x"` (including
 * statements wrapped over several lines) and side-effect `import "x"`.
 * `[^;]*?` lets a wrapped `import {\n a,\n b\n} from "x"` match; a dynamic
 * `import("x")` has no `from` and is not matched.
 */
const STATIC_FROM_RE = /(?:^|\n)[ \t]*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g;
const SIDE_EFFECT_RE = /(?:^|\n)[ \t]*import\s*["']([^"']+)["']/g;

function staticSpecifiers(source: string): string[] {
  const out: string[] = [];
  for (const re of [STATIC_FROM_RE, SIDE_EFFECT_RE]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) out.push(match[1]!);
  }
  return out;
}

function lazyOnlyViolations(source: string): string[] {
  return staticSpecifiers(source).filter((specifier) => {
    const base = specifier.split("/").pop()!.replace(/\.(js|ts|tsx)$/, "");
    return (LAZY_ONLY_MODULES as readonly string[]).includes(base);
  });
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && name !== "routeTree.gen.ts") {
      out.push(full);
    }
  }
  return out;
}

describe("eventPricing bundle guard", () => {
  it("positive control: the detector catches synthetic static imports of every lazy-only module", () => {
    expect(lazyOnlyViolations(`import { priceArtifactUpcoming } from "./eventPricing.lazy.js";`)).toEqual(["./eventPricing.lazy.js"]);
    expect(lazyOnlyViolations(`import type { ScheduledMatchInput } from "../../../../packages/harness/eventStatePricing.js";`)).toHaveLength(1);
    expect(lazyOnlyViolations(`import {\n  loadRpRuleModule,\n  RP_LOADABLE_SEASONS,\n} from "../../../../packages/core/rankingPoints/rulesLoader.js";`)).toHaveLength(1);
    expect(lazyOnlyViolations(`export { analyticRpPmf } from "../core/rankingPoints/analyticPmf.js";`)).toHaveLength(1);
    expect(lazyOnlyViolations(`import "../core/rankingPoints/empiricalMoments.js";`)).toHaveLength(1);
    expect(lazyOnlyViolations(`const x = 1;\nimport { RpMeanShiftAccumulator } from "../core/rankingPoints/meanShift.js";`)).toHaveLength(1);
    // Negative controls: a dynamic import and a type-position `typeof import()` are not static edges.
    expect(lazyOnlyViolations(`const m = await import("./eventPricing.lazy.js");`)).toEqual([]);
    expect(lazyOnlyViolations(`type M = typeof import("./eventPricing.lazy.js");`)).toEqual([]);
    expect(lazyOnlyViolations(`import { bonusRpForSeason } from "../../lib/bonusRp.js";`)).toEqual([]);
  });

  it("no non-test file under apps/web/src statically imports a lazy-only module, except the lazy module itself", () => {
    const files = listSourceFiles(SRC_ROOT);
    expect(files.length).toBeGreaterThan(50);
    const violations: string[] = [];
    for (const file of files) {
      const rel = relative(SRC_ROOT, file).replace(/\\/g, "/");
      if (rel === "lib/eventPricing.lazy.ts") continue;
      for (const specifier of lazyOnlyViolations(readFileSync(file, "utf8"))) violations.push(`${rel} -> ${specifier}`);
    }
    expect(violations).toEqual([]);
  });

  it("eventPricing.ts reaches the lazy module through a dynamic import, and the lazy module really holds the pricer", () => {
    const main = readFileSync(join(SRC_ROOT, "lib", "eventPricing.ts"), "utf8");
    expect(main).toMatch(/import\(\s*["']\.\/eventPricing\.lazy\.js["']\s*\)/);
    expect(lazyOnlyViolations(main)).toEqual([]);

    const lazy = readFileSync(join(SRC_ROOT, "lib", "eventPricing.lazy.ts"), "utf8");
    const lazySpecifiers = staticSpecifiers(lazy);
    expect(lazySpecifiers.some((s) => s.endsWith("/eventStatePricing.js"))).toBe(true);
    expect(lazySpecifiers.some((s) => s.endsWith("/rulesLoader.js"))).toBe(true);
  });
});
