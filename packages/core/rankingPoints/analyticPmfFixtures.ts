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
