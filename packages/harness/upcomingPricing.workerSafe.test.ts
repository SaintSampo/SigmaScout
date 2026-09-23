/**
 * The live tick's pricing path is provably Node-free: a static scan of the import
 * graph from `upcomingPricing.ts`, `rulesLoader.ts` and `pageArtifacts.ts`.
 *
 * The entry was `eventStatePricing.ts` and the claim was called BROWSER-safety
 * until quick task 260923-3w7 deleted the browser pricer. The forbidden set is
 * identical either way — a Node built-in, `better-sqlite3`, `rules.ts`, a
 * per-season RP file, `publish.ts`, `seedSql.ts`, `replay.ts`, `packages/corpus`
 * or `sigmaScoutLayer.ts` — because what it really guards is "this module is
 * bundled into a runtime that has none of that", and the Workers runtime is now
 * the runtime in question. `pageArtifacts.ts` is still browser-loaded (the web
 * parses artifacts with it), so its own describe below keeps that name.
 *
 * The scanner strips comments, then reads specifiers from static
 * `import`/`export ... from` statements (multi-line included), side-effect
 * imports and literal dynamic `import("...")` calls. Whole-statement type-only
 * statements are skipped, since `verbatimModuleSyntax` erases them; a mixed
 * statement is followed, since it survives as an import. Relative `.js`
 * specifiers resolve to their `.ts` siblings; package specifiers are recorded
 * and never followed.
 *
 * Positive controls keep every negative assertion honest: the extractor is run
 * on an inline fixture, `seedSql.ts` must report its Node imports, and
 * `publish.ts` must reach `rules.ts`, `packages/corpus/db.ts` and Node.
 */
import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGES = resolve(HERE, "..");
const RANKING_POINTS = resolve(PACKAGES, "core", "rankingPoints");

/** Removes block and line comments, leaving string and template literal contents alone (so `"**\/*.ts"` opens no comment). */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const comment = end === -1 ? source.slice(i) : source.slice(i, end + 2);
      // Keep line breaks so line-anchored patterns still see statement starts.
      out += comment.replace(/[^\n]/g, "");
      i += comment.length;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length) {
        const c = source[j]!;
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === ch) break;
        // A quote string cannot span lines; stopping here bounds any mis-tokenized regex literal to one line.
        if (c === "\n" && ch !== "`") break;
        j++;
      }
      out += source.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

const STATIC_RE = /^[ \t]*(import|export)\b([^;]*?)\bfrom\s*["']([^"']+)["']/gm;
const SIDE_EFFECT_RE = /^[ \t]*import\s*["']([^"']+)["']/gm;
const DYNAMIC_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

function isWholeStatementTypeOnly(clause: string): boolean {
  const rest = clause.trim();
  return /^type\s*[{*]/.test(rest) || /^type\s+(?!from\b)[A-Za-z_$]/.test(rest);
}

/** Every runtime import specifier in `source`, in order of kind (static, side-effect, dynamic). */
function extractImportSpecifiers(source: string): string[] {
  const code = stripComments(source);
  const specifiers: string[] = [];
  for (const match of code.matchAll(STATIC_RE)) {
    if (isWholeStatementTypeOnly(match[2]!)) continue;
    specifiers.push(match[3]!);
  }
  for (const match of code.matchAll(SIDE_EFFECT_RE)) specifiers.push(match[1]!);
  for (const match of code.matchAll(DYNAMIC_RE)) specifiers.push(match[1]!);
  return specifiers;
}

function resolveLocal(fromFile: string, specifier: string): string {
  const resolved = resolve(dirname(fromFile), specifier);
  if (resolved.endsWith(".js")) {
    const asTs = `${resolved.slice(0, -3)}.ts`;
    if (existsSync(asTs)) return asTs;
  }
  if (!existsSync(resolved) && existsSync(`${resolved}.ts`)) return `${resolved}.ts`;
  return resolved;
}

interface GraphScan {
  readonly visited: Set<string>;
  readonly packageImports: Array<{ file: string; specifier: string }>;
}

function scanImportGraph(entry: string): GraphScan {
  const visited = new Set<string>();
  const packageImports: Array<{ file: string; specifier: string }> = [];
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    if (!existsSync(file)) continue;
    for (const specifier of extractImportSpecifiers(readFileSync(file, "utf8"))) {
      if (specifier.startsWith(".")) {
        const target = resolveLocal(file, specifier);
        if (!visited.has(target)) stack.push(target);
      } else {
        packageImports.push({ file, specifier });
      }
    }
  }
  return { visited, packageImports };
}

const BUILTINS = new Set(builtinModules);

function nodeOrSqliteImports(scan: GraphScan): string[] {
  return scan.packageImports
    .filter(({ specifier }) => specifier.startsWith("node:") || BUILTINS.has(specifier.split("/")[0]!) || specifier === "better-sqlite3")
    .map(({ file, specifier }) => `${file}: "${specifier}"`);
}

const SEASON_FILE_RE = /[\\/]rankingPoints[\\/]\d{4}\.ts$/;

describe("import extractor: positive control", () => {
  it("returns exactly the runtime specifiers of an inline fixture", () => {
    const fixture = [
      "import {",
      "  alpha,",
      "  beta,",
      '} from "./multiLine.js";',
      'import "./sideEffect.js";',
      'const lazy = () => import("./dynamic.js");',
      'import { type OnlyAType, realValue } from "./mixed.js";',
      'import type { Erased } from "./typeOnly.js";',
      'export type { AlsoErased } from "./typeReexport.js";',
      '/* import { hidden } from "./blockComment.js"; */',
      '// import { hidden } from "./lineComment.js";',
      'const glob = "packages/**/*.ts";',
      'export { gamma } from "./reexport.js";',
      'import { readFileSync } from "node:fs";',
    ].join("\n");
    expect(extractImportSpecifiers(fixture)).toEqual([
      "./multiLine.js",
      "./mixed.js",
      "./reexport.js",
      "node:fs",
      "./sideEffect.js",
      "./dynamic.js",
    ]);
  });
});

describe("import graph: positive controls", () => {
  it("seedSql.ts reports node:fs and node:path", () => {
    const scan = scanImportGraph(resolve(HERE, "seedSql.ts"));
    const specifiers = scan.packageImports.map((p) => p.specifier);
    expect(specifiers).toContain("node:fs");
    expect(specifiers).toContain("node:path");
  });

  it("publish.ts reaches rules.ts, packages/corpus/db.ts and Node imports", () => {
    const scan = scanImportGraph(resolve(HERE, "publish.ts"));
    expect(scan.visited.has(resolve(RANKING_POINTS, "rules.ts"))).toBe(true);
    expect(scan.visited.has(resolve(PACKAGES, "corpus", "db.ts"))).toBe(true);
    expect(nodeOrSqliteImports(scan).length).toBeGreaterThan(0);
  });
});

describe("upcomingPricing.ts is Worker-safe", () => {
  const scan = scanImportGraph(resolve(HERE, "upcomingPricing.ts"));

  it("reaches no Node built-in and no better-sqlite3", () => {
    expect(nodeOrSqliteImports(scan)).toEqual([]);
  });

  it("reaches no rules.ts, season RP file, publish.ts, seedSql.ts, replay.ts, corpus db or sigmaScoutLayer.ts", () => {
    const forbidden = [
      resolve(RANKING_POINTS, "rules.ts"),
      resolve(HERE, "publish.ts"),
      resolve(HERE, "seedSql.ts"),
      resolve(HERE, "replay.ts"),
      resolve(PACKAGES, "corpus", "db.ts"),
      resolve(HERE, "sigmaScoutLayer.ts"),
    ];
    expect(forbidden.filter((file) => scan.visited.has(file))).toEqual([]);
    expect([...scan.visited].filter((file) => SEASON_FILE_RE.test(file))).toEqual([]);
  });

  it("non-vacuity: visits the modules pricing actually runs", () => {
    // No `spr.ts` and no `stateSnapshot.ts`: the algorithm module and the
    // deserialized state are INJECTED through `UpcomingPricingModel`, which is
    // what lets one pricer serve three algorithms. `stateSnapshot.ts` gets its
    // own describe below, because the tick bundles it under the same constraint.
    // No `empiricalMoments.ts` either, and for a third reason: this module needs
    // only `RpMomentsAccumulator`'s TYPE, so the statement is type-only and
    // `verbatimModuleSyntax` erases it. The scanner is right not to follow it.
    for (const file of [
      resolve(RANKING_POINTS, "analyticPmf.ts"),
      resolve(RANKING_POINTS, "meanShift.ts"),
      resolve(HERE, "sigmaScore.ts"),
      resolve(HERE, "rounding.ts"),
      resolve(HERE, "publishedRows.ts"),
      resolve(HERE, "pageArtifacts.ts"),
    ]) {
      expect(scan.visited.has(file), file).toBe(true);
    }
  });
});

/**
 * The other half of the tick's pricing path: `scheduled.ts` reads its D1 rows
 * through this module and hands the deserialized state to `priceUpcomingRows`,
 * so the same constraint binds it. Its own header names this test.
 */
describe("stateSnapshot.ts is Worker-safe", () => {
  const scan = scanImportGraph(resolve(HERE, "stateSnapshot.ts"));

  it("reaches no Node built-in, no better-sqlite3, and no seedSql.ts (the one Node-bound part of the handoff)", () => {
    expect(nodeOrSqliteImports(scan)).toEqual([]);
    expect(scan.visited.has(resolve(HERE, "seedSql.ts"))).toBe(false);
    expect(scan.visited.has(resolve(PACKAGES, "corpus", "db.ts"))).toBe(false);
  });

  it("non-vacuity: visits the modules it deserializes through", () => {
    for (const file of [resolve(PACKAGES, "core", "algorithms", "breakdown", "index.ts"), resolve(PACKAGES, "core", "algorithms", "demoTeams.ts")]) {
      expect(scan.visited.has(file), file).toBe(true);
    }
  });
});

/**
 * `rulesLoader.ts` has no production caller since the browser pricer was deleted
 * (quick task 260923-3w7) — the tick indexes `RP_RULE_MODULES` directly. It is
 * kept, and kept under this guard, because `upcomingPricing.test.ts` still uses
 * it to prove the per-season loader hands back the very object the publisher
 * holds, and because a lazily-loaded season module is the shape any future
 * runtime-bounded caller would want.
 */
describe("rulesLoader.ts is browser-safe", () => {
  const scan = scanImportGraph(resolve(RANKING_POINTS, "rulesLoader.ts"));

  it("reaches no Node built-in, no better-sqlite3 and no rules.ts", () => {
    expect(nodeOrSqliteImports(scan)).toEqual([]);
    expect(scan.visited.has(resolve(RANKING_POINTS, "rules.ts"))).toBe(false);
  });

  it("non-vacuity: its dynamic imports visit 2016.ts and 2026.ts", () => {
    expect(scan.visited.has(resolve(RANKING_POINTS, "2016.ts"))).toBe(true);
    expect(scan.visited.has(resolve(RANKING_POINTS, "2026.ts"))).toBe(true);
  });
});

describe("pageArtifacts.ts (the schemas both the Worker and the browser parse with) is browser-safe", () => {
  it("reaches no Node built-in and no better-sqlite3", () => {
    const scan = scanImportGraph(resolve(HERE, "pageArtifacts.ts"));
    expect(scan.visited.size).toBeGreaterThan(1);
    expect(nodeOrSqliteImports(scan)).toEqual([]);
  });
});
