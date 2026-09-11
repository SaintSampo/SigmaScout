/**
 * THE INERTNESS INSTRUMENT (plan 09-05, D-05). Captures a golden of
 * `analyticRpPmf`'s output under 09-04's exported production-default
 * `RpLayerConfig`, run ONCE against 09-04's code BEFORE this plan's first
 * edit to `analyticPmf.ts`. 09-05 adds three new selectable `RpLayerConfig`
 * branches beside the legacy ones; the only way to PROVE the legacy path is
 * unmoved after all three land (and after all 34 `marginalFamily`
 * declarations flip) is to compare against an answer captured before any of
 * that happened. A golden regenerated to make a failing
 * `rpLayerInertness.test.ts` green is the exact failure this instrument
 * exists to catch — the project's own "the README described a model that
 * had been deleted" failure mode, one level down at a JSON fixture instead
 * of prose. See `docs/models/rp-layer-config-arms.md`'s "Reproducing the
 * inertness golden" section for the standing rule.
 *
 * Regeneration is refused by default once the golden file exists: pass
 * `--regenerate` to overwrite it, which prints a loud warning naming this
 * plan and the reason before writing. No plan before 09-06's collapse of
 * `RpLayerConfig` (D-06) has a legitimate reason to pass that flag.
 *
 * Follows `scripts/rpPredictThresholdsGolden.ts`'s own shape (09-02's
 * in-phase precedent for "capture a golden from the pre-change code, prove
 * the post-change code reproduces it"): a pure, exported builder + an
 * `isEntryPoint`-guarded `main()` that writes the committed JSON, so
 * importing this module (as `rpLayerInertness.test.ts` does, to rebuild the
 * SAME inputs rather than a second copy of them) never has the side effect
 * of writing the golden file.
 *
 * Inputs are hand-built and fully deterministic: no corpus, no
 * `Math.random`, no wall-clock date read inside `buildGoldenCases` (only
 * `main()`'s own `capturedAt` timestamp touches the clock, and that value is
 * never compared by the replay test — only `cases` and `defaultConfig` are).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { analyticRpPmf, RP_LAYER_CONFIG_DEFAULT, type RpLayerConfig } from "../packages/core/rankingPoints/analyticPmf.js";
import { RP_REGISTERED_SEASONS, rpRuleModuleForSeason } from "../packages/core/rankingPoints/rules.js";
import type { RpRuleModule, RpThresholdVariable } from "../packages/core/rankingPoints/constants.js";
import type { AllianceRpMoments } from "../packages/core/rankingPoints/moments.js";
import type { CompLevel } from "../packages/core/algorithms/types.js";

const GOLDEN_JSON_PATH = join("packages", "core", "rankingPoints", "rpLayerInertness.json");

/**
 * The three real TBA `event_type` values exercising `EVENT_TYPE_TIERS`'s
 * base (`0`) / districtChampionship (`2`) / championship (`3`) mapping —
 * cited from `constants.ts` rather than re-declared as a magic literal
 * anywhere else in this file.
 */
export const GOLDEN_EVENT_TYPES = [0, 2, 3] as const;

/**
 * Three nominal `pRedWin` values per (season, eventType) case. At capture
 * time `analyticRpPmf`'s input has NO `pRedWin` field at all (09-04's
 * shape, pre-edit) — these three cases are therefore IDENTICAL in their
 * computed `redPmf`/`bluePmf` at capture time, which is exactly what proves,
 * once Task 1 makes `pRedWin` a required-but-under-the-legacy-config-unread
 * input, that supplying different `pRedWin` values still produces the same
 * pmf under the default config (T-09-05-01's tripwire, restated at the
 * fixture level).
 */
export const GOLDEN_PRED_WIN_VALUES = [0.05, 0.5, 0.82] as const;

/**
 * Best-effort base-tier threshold for `variableName` within `ruleModule`,
 * read from whichever `BonusPredicate` clause first references it (scaled
 * back to this variable's own raw units by the clause's `divisor`, when one
 * applies). Returns `undefined` when no predicate references the variable
 * directly (e.g. a D-03 raw term consumed only as part of a season's
 * derived linear combination, where the combined threshold does not map
 * cleanly back to one term alone) — callers fall back to a fixed value.
 * This is a coverage heuristic for a synthetic fixture, not a claim about
 * FRC scoring; it exists so `meanAndVarianceFor` below can straddle real
 * thresholds instead of guessing blind.
 */
function approxBaseThreshold(ruleModule: RpRuleModule, variableName: string): number | undefined {
  for (const predicate of ruleModule.bonusPredicates) {
    switch (predicate.kind) {
      case "singleThreshold":
      case "nestedSameVariable":
        if (predicate.variable === variableName) {
          const t = predicate.threshold;
          return typeof t === "number" ? t : t.base;
        }
        break;
      case "linearCombination": {
        const term = predicate.terms.find((tm) => tm.variable === variableName);
        if (term !== undefined) {
          const t = predicate.threshold;
          const raw = typeof t === "number" ? t : t.base;
          return raw * (term.divisor ?? 1);
        }
        break;
      }
      case "conjunctionDistinct": {
        for (const clause of predicate.clauses) {
          const term = clause.terms.find((tm) => tm.variable === variableName);
          if (term !== undefined) {
            const t = clause.threshold;
            const raw = typeof t === "number" ? t : t.base;
            return raw * (term.divisor ?? 1);
          }
        }
        break;
      }
      case "countOfIndicators": {
        for (const clause of predicate.indicators) {
          const term = clause.terms.find((tm) => tm.variable === variableName);
          if (term !== undefined) {
            const t = clause.threshold;
            const raw = typeof t === "number" ? t : t.base;
            return raw * (term.divisor ?? 1);
          }
        }
        break;
      }
      case "dataDependentMixture": {
        for (const clause of [predicate.selector, predicate.whenSelectorTrue, predicate.whenSelectorFalse]) {
          const term = clause.terms.find((tm) => tm.variable === variableName);
          if (term !== undefined) {
            const t = clause.threshold;
            const raw = typeof t === "number" ? t : t.base;
            return raw * (term.divisor ?? 1);
          }
        }
        break;
      }
      case "constant":
        break;
    }
  }
  return undefined;
}

/**
 * Deterministic per-(variable, side) mean/variance: alternates each
 * variable's mean above and below its approximate base-tier threshold
 * (0.6x for an even `(index + sideOffset)`, 1.6x for odd), falling back to
 * a fixed `20` when no threshold could be located, so bonus probabilities
 * across the golden are never all 0 or all 1. Variance is a fixed 30% of
 * mean-squared (floored at 4) — a deliberately simple, reproducible choice;
 * this golden exists to prove non-vacuous coverage of every branch, not to
 * model realistic FRC score variance.
 */
function meanAndVarianceFor(
  ruleModule: RpRuleModule,
  variable: RpThresholdVariable,
  index: number,
  side: "red" | "blue"
): { mean: number; variance: number } {
  const approxThreshold = approxBaseThreshold(ruleModule, variable.name);
  const base = approxThreshold ?? 20;
  const sideOffset = side === "red" ? 0 : 1;
  const straddleFactor = (index + sideOffset) % 2 === 0 ? 0.6 : 1.6;
  const mean = Math.max(1, base * straddleFactor);
  const variance = Math.max(4, mean * mean * 0.3);
  return { mean, variance };
}

/** Deterministic per-(season, side) score moments — distinct means/variances per side, per season. */
function scoreMomentsFor(season: number, side: "red" | "blue"): { scoreMean: number; scoreVariance: number } {
  const seasonOffset = (season % 10) * 3;
  const base = 80 + seasonOffset;
  return side === "red" ? { scoreMean: base + 15, scoreVariance: 45 } : { scoreMean: base, scoreVariance: 40 };
}

/**
 * Builds one alliance's diagonal `AllianceRpMoments` for `ruleModule` — the
 * exact shape `empiricalMoments.ts`'s `momentsFor` produces (diagonal
 * `varianceBlock`, all-zero `scoreCrossCovariance`).
 */
export function buildAllianceMoments(ruleModule: RpRuleModule, season: number, side: "red" | "blue"): AllianceRpMoments {
  const variableNames = ruleModule.thresholdVariables.map((v) => v.name);
  const meanVector: number[] = [];
  const varianceDiag: number[] = [];
  ruleModule.thresholdVariables.forEach((variable, index) => {
    const { mean, variance } = meanAndVarianceFor(ruleModule, variable, index, side);
    meanVector.push(mean);
    varianceDiag.push(variance);
  });
  const varianceBlock = variableNames.map((_, i) => variableNames.map((_, j) => (i === j ? varianceDiag[i]! : 0)));
  const { scoreMean, scoreVariance } = scoreMomentsFor(season, side);
  return {
    variableNames,
    meanVector,
    varianceBlock,
    scoreMean,
    scoreVariance,
    scoreCrossCovariance: variableNames.map(() => 0),
  };
}

export interface GoldenCase {
  readonly season: number;
  readonly eventType: number;
  readonly compLevel: CompLevel;
  readonly pRedWin: number;
  readonly redPmf: readonly number[];
  readonly bluePmf: readonly number[];
  readonly redBonusProbabilities: readonly number[] | null;
  readonly blueBonusProbabilities: readonly number[] | null;
}

/**
 * Evaluates one case through `analyticRpPmf` under 09-04's exported
 * production-default `RpLayerConfig` — imported, never re-declared
 * literally, so a later default change breaks this test loudly instead of
 * silently comparing against a stale copy. The call-site input is built as
 * a plain (non-annotated) object rather than a typed literal specifically
 * so this file continues to compile unchanged once Task 1's Commit 2 adds a
 * REQUIRED `pRedWin` field to `AnalyticRpPmfInput` — TypeScript's excess
 * property check only fires for a literal checked directly against a type
 * at its point of use, not for an already-bound identifier passed through a
 * call, so an extra `pRedWin` property here is legal both before and after
 * that field exists on the interface (see `rpLayerInertness.test.ts`'s own
 * header for why this matters: it must pass UNTOUCHED after Commit 2).
 */
function buildCase(
  season: number,
  ruleModule: RpRuleModule,
  red: AllianceRpMoments,
  blue: AllianceRpMoments,
  eventType: number,
  compLevel: CompLevel,
  pRedWin: number,
  config: RpLayerConfig
): GoldenCase {
  const input = { red, blue, ruleModule, eventType, compLevel, config, pRedWin };
  const result = analyticRpPmf(input);
  return {
    season,
    eventType,
    compLevel,
    pRedWin,
    redPmf: result.redPmf,
    bluePmf: result.bluePmf,
    redBonusProbabilities: result.redBonusProbabilities ?? null,
    blueBonusProbabilities: result.blueBonusProbabilities ?? null,
  };
}

/**
 * The full grid: every registered season x `GOLDEN_EVENT_TYPES` x
 * `GOLDEN_PRED_WIN_VALUES`, `compLevel: "qm"` throughout, PLUS one extra
 * case at a non-bonus comp level (`"qf"`, on the first registered season)
 * so the degenerate short-circuit is exercised too. `config` defaults to
 * 09-04's exported production default — the ONLY config this golden is
 * ever captured under.
 */
export function buildGoldenCases(config: RpLayerConfig = RP_LAYER_CONFIG_DEFAULT): GoldenCase[] {
  const cases: GoldenCase[] = [];
  for (const season of RP_REGISTERED_SEASONS) {
    const ruleModule = rpRuleModuleForSeason(season);
    const red = buildAllianceMoments(ruleModule, season, "red");
    const blue = buildAllianceMoments(ruleModule, season, "blue");
    for (const eventType of GOLDEN_EVENT_TYPES) {
      for (const pRedWin of GOLDEN_PRED_WIN_VALUES) {
        cases.push(buildCase(season, ruleModule, red, blue, eventType, "qm", pRedWin, config));
      }
    }
  }

  const firstSeason = RP_REGISTERED_SEASONS[0]!;
  const firstModule = rpRuleModuleForSeason(firstSeason);
  const redFirst = buildAllianceMoments(firstModule, firstSeason, "red");
  const blueFirst = buildAllianceMoments(firstModule, firstSeason, "blue");
  cases.push(buildCase(firstSeason, firstModule, redFirst, blueFirst, 0, "qf", 0.5, config));

  return cases;
}

interface GoldenFile {
  readonly capturedAt: string;
  readonly capturedFrom: string;
  readonly defaultConfig: RpLayerConfig;
  readonly cases: readonly GoldenCase[];
}

async function main(): Promise<void> {
  const regenerate = process.argv.includes("--regenerate");
  if (existsSync(GOLDEN_JSON_PATH) && !regenerate) {
    console.error(
      `rp:inertness-golden: ${GOLDEN_JSON_PATH} already exists. Refusing to overwrite without --regenerate.\n` +
        `This golden is the ONLY evidence plan 09-05 shipped nothing (D-05) — see this script's own header\n` +
        `and docs/models/rp-layer-config-arms.md's "Reproducing the inertness golden" section before regenerating.`
    );
    process.exit(1);
  }
  if (regenerate) {
    console.warn(
      "rp:inertness-golden: --regenerate passed. This OVERWRITES packages/core/rankingPoints/rpLayerInertness.json,\n" +
        "the sole committed proof that plan 09-05's production default is unmoved (D-05/D-06). No plan before\n" +
        "09-06's collapse of RpLayerConfig has a legitimate reason to do this. If a test failed and this looked\n" +
        "like the fix, STOP — the golden is what is supposed to be failing the test, not the other way around."
    );
    const previous = existsSync(GOLDEN_JSON_PATH) ? (JSON.parse(readFileSync(GOLDEN_JSON_PATH, "utf8")) as GoldenFile) : undefined;
    if (previous !== undefined) {
      console.warn(`rp:inertness-golden: previous capturedFrom was ${previous.capturedFrom}`);
    }
  }

  const capturedFrom = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const cases = buildGoldenCases();

  const golden: GoldenFile = {
    capturedAt: new Date().toISOString(),
    capturedFrom,
    defaultConfig: RP_LAYER_CONFIG_DEFAULT,
    cases,
  };

  mkdirSync(dirname(GOLDEN_JSON_PATH), { recursive: true });
  writeFileSync(GOLDEN_JSON_PATH, `${JSON.stringify(golden, null, 2)}\n`, "utf8");
  console.log(`Wrote ${GOLDEN_JSON_PATH}: ${cases.length} cases, from commit ${capturedFrom}`);
}

// Guard: only auto-run `main()` when this file is the process entry point —
// importing this module (as `rpLayerInertness.test.ts` does, to reuse the
// SAME builders rather than a second copy of them) must never have the side
// effect of writing the golden file.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("rp:inertness-golden failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
