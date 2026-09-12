/**
 * The ONE `AllianceRpMoments` fixture builder shared by `analyticPmf.test.ts`
 * (D-07's six remaining hand-computed mechanism-class tests) and
 * `analyticPmf.seasons.test.ts` (the all-season structural sweep) — plan
 * 09-04 Task 2.
 *
 * Deliberately NOT named `*.test.ts` (vitest's own test-file glob in
 * `vitest.config.ts` is `packages/**\/*.test.ts`): importing a `.test.ts`
 * module re-executes its top-level `describe()` registrations as a side
 * effect of module evaluation, which would silently DUPLICATE every test in
 * whichever file supplied the fixture builder. This file carries no test
 * assertions of its own — it exists purely so there is one fixture builder
 * in the tree, not two that can drift about what "diagonal" means.
 */
import { allianceBonusRpPmf, emptyMarginalResolutionTally } from "./analyticPmf.js";
import type { AllianceRpMoments } from "./moments.js";
import type { RpRuleModule } from "./constants.js";

/**
 * Builds a diagonal `AllianceRpMoments` for `ruleModule` — the exact shape
 * `empiricalMoments.ts`'s `momentsFor` produces. `values` supplies
 * `{mean, variance}` for whichever threshold variables a test cares about;
 * every other tracked variable defaults to `{mean: 0, variance: 0}`.
 */
export function buildRuleModuleMoments(
  ruleModule: RpRuleModule,
  values: Readonly<Record<string, { mean: number; variance: number }>>,
  scoreMean = 100,
  scoreVariance = 50
): AllianceRpMoments {
  const variableNames = ruleModule.thresholdVariables.map((v) => v.name);
  const meanVector = variableNames.map((name) => values[name]?.mean ?? 0);
  const varianceBlock = variableNames.map((_, i) => variableNames.map((_, j) => (i === j ? values[variableNames[i]!]?.variance ?? 0 : 0)));
  return {
    variableNames,
    meanVector,
    varianceBlock,
    scoreMean,
    scoreVariance,
    scoreCrossCovariance: variableNames.map(() => 0),
  };
}

// ---------------------------------------------------------------------------
// The `analyticPmfGolden.json` grid builder (quick task 260911-w7k Task 1).
//
// Lives here, in the designated NON-test fixture module, for the same reason
// `buildRuleModuleMoments` does: `analyticPmfGolden.test.ts` imports it, and
// importing a `.test.ts` module would re-execute that file's top-level
// `describe()` registrations and silently duplicate every test in it.
//
// This builder is the ONLY definition of the golden grid's shape. The
// committed oracle and the live replay both go through it, so a grid change
// is a visible edit here rather than a drift between generator and test.
// ---------------------------------------------------------------------------

/**
 * Bumped ONLY when the grid's own shape changes (the pattern set, the scale
 * ladder, the event types) — never in response to a red test. Mirrors
 * `scripts/rpPredictThresholdsGolden.ts`'s `GRID_VERSION` convention.
 */
export const GOLDEN_GRID_VERSION = 1;

/**
 * The three real TBA `event_type` values exercising `eventTierFor`'s
 * base / districtChampionship / championship mapping — never an `EventTier`
 * named directly, so the mapping itself stays on the path this grid
 * exercises. Same convention as `GRID_EVENT_TYPES`.
 */
export const GOLDEN_EVENT_TYPES = [0, 2, 3] as const;

/**
 * Five orders of magnitude. Season thresholds range from single-digit counts
 * (2016 `breach`'s 4) to hundreds of points (2026 `supercharged`'s 360), so a
 * single scale would leave some seasons' grids uniformly saturated at 0 or 1
 * and blind to any change in a Gaussian fit. The golden test asserts that
 * non-saturation rather than trusting this comment.
 */
export const GOLDEN_SCALES = [3, 10, 30, 100, 300] as const;

/** One (season, eventType, pattern) cell of the golden grid. */
export interface BonusPmfGoldenRow {
  readonly pattern: string;
  readonly bonusProbabilities: readonly number[];
  readonly pmf: readonly number[];
  readonly tally: { readonly gaussian: number; readonly degenerate: number; readonly fallbacks: number };
}

/**
 * The rows whose numbers move continuously with their inputs — the scale
 * ladder plus the asymmetric pattern. The three structural patterns
 * (`zero-variance`, `non-finite`) are deliberately EXCLUDED: they drive
 * `fitMarginal`'s degenerate rungs, where the output is an exact 0 or 1 by
 * construction and a small perturbation of the mean is expected to move
 * nothing. Asserting non-vacuity or non-saturation over them would be
 * asserting the wrong thing about the right rows.
 */
export function isNumericLadderPattern(pattern: string): boolean {
  return pattern.startsWith("scale-") || pattern === "asym-30";
}

/** The eight moment patterns, before `meanScale` is applied. Pure data — no `allianceBonusRpPmf` call happens here. */
function goldenPatterns(ruleModule: RpRuleModule): readonly { pattern: string; values: Record<string, { mean: number; variance: number }> }[] {
  const names = ruleModule.thresholdVariables.map((v) => v.name);
  const patterns: { pattern: string; values: Record<string, { mean: number; variance: number }> }[] = [];

  for (const s of GOLDEN_SCALES) {
    const values: Record<string, { mean: number; variance: number }> = {};
    for (const name of names) values[name] = { mean: s, variance: (s / 4) ** 2 + 1 };
    patterns.push({ pattern: `scale-${s}`, values });
  }

  // Every pattern above gives all variables the SAME mean, under which a
  // swapped divisor or a reordered term sum can cancel and leave the grid
  // blind to it. Asymmetry across variables is what makes the multi-term
  // path in `clauseProbability` observable at all.
  {
    const values: Record<string, { mean: number; variance: number }> = {};
    names.forEach((name, i) => {
      values[name] = { mean: (30 * (i + 1)) / (i + 2), variance: (i + 2) * 3 };
    });
    patterns.push({ pattern: "asym-30", values });
  }

  // `fitMarginal` rung 2 — `variance <= 0` resolves degenerate at `mean`,
  // reason "zero-variance".
  {
    const values: Record<string, { mean: number; variance: number }> = {};
    for (const name of names) values[name] = { mean: 30, variance: 0 };
    patterns.push({ pattern: "zero-variance", values });
  }

  // `fitMarginal` rung 1 — a non-finite input resolves degenerate AT 0,
  // reason "non-finite". Only variable 0 is poisoned, so the remaining
  // variables still fit normally and a multi-term clause mixes a degenerate
  // term with a Gaussian one.
  {
    const values: Record<string, { mean: number; variance: number }> = {};
    names.forEach((name, i) => {
      values[name] = i === 0 ? { mean: Number.NaN, variance: 1 } : { mean: 30, variance: 9 };
    });
    patterns.push({ pattern: "non-finite", values });
  }

  return patterns;
}

/**
 * Runs `allianceBonusRpPmf` over the eight moment patterns for one
 * (season, eventType), with a FRESH `emptyMarginalResolutionTally()` per row
 * so the recorded counts are that row's own rather than a running total.
 *
 * `meanScale` multiplies every pattern's `mean` and leaves every `variance`
 * alone — the golden test's non-vacuity assertion rebuilds at 1.01 and
 * requires the numbers to move.
 *
 * Deliberately does NOT catch: a throw from any (season, tier, pattern) is a
 * real finding about that triple and must surface, not be swallowed into a
 * silently-shorter grid.
 */
export function buildBonusPmfGoldenRows(ruleModule: RpRuleModule, eventType: number, meanScale = 1): BonusPmfGoldenRow[] {
  return goldenPatterns(ruleModule).map(({ pattern, values }) => {
    const scaled: Record<string, { mean: number; variance: number }> = {};
    for (const [name, v] of Object.entries(values)) scaled[name] = { mean: v.mean * meanScale, variance: v.variance };
    const moments = buildRuleModuleMoments(ruleModule, scaled);
    const tally = emptyMarginalResolutionTally();
    const result = allianceBonusRpPmf(moments, ruleModule, eventType, tally);
    return {
      pattern,
      bonusProbabilities: [...result.bonusProbabilities],
      pmf: [...result.pmf],
      tally: { gaussian: tally.gaussian, degenerate: tally.degenerate, fallbacks: tally.fallbacks },
    };
  });
}
