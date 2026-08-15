/**
 * D-04's structural consequence: Sigma1's OWN tunable copy of the
 * season-boundary carry math, so tuning any carry parameter can move
 * Sigma1's predictions without moving EPA's. `packages/core/algorithms/carryover.ts`
 * freezes `EPA_MEAN_REVERSION`/`EPA_CARRY_LAST_YEAR_WEIGHT`/
 * `EPA_CARRY_PRIOR_YEAR_WEIGHT` at Statbotics' own published values — "beats
 * EPA" has to mean "beats what Statbotics actually ships," which only holds
 * if EPA's carry never reads a Sigma1 parameter (that module's own header
 * now states this explicitly).
 *
 * `sigma1Carryover` reproduces `epaCarryover`'s blend/reversion math exactly,
 * substituting `params.carryLastYearWeight`/`params.carryPriorYearWeight`/
 * `params.carryMeanReversion` for the three frozen constants. Per
 * RESEARCH.md Open Question 3 (resolved by CONTEXT.md D-04): these three are
 * the ONLY carry constants that become tunable for Sigma1's copy — they are
 * the three explicitly tagged "Phase 3 hyperparameter, default unverified"
 * in `carryover.ts`. `EPA_NORM_MEAN`/`EPA_NORM_SD`/`EPA_INIT_PENALTY` stay
 * STRUCTURAL: they define an arbitrary-but-self-consistent intermediate
 * scale whose round trip (`normalizedFromPoints` then `normalizedToSeasonUnits`)
 * must cancel, not a degree of freedom a search could meaningfully move — so
 * this module imports and uses them UNCHANGED from `../carryover.js` rather
 * than adding matching `Sigma1Params` fields for them. Do not "finish the
 * job" by making them tunable too; that reasoning is deliberate, not an
 * oversight.
 *
 * `populationMeanSd`/`normalizedFromPoints`/`normalizedToSeasonUnits` are
 * imported from `../carryover.js` rather than re-derived — two copies of a
 * scale conversion is exactly the kind of drift this project's failure log
 * (REBUILD_SPEC.md) warns about.
 */
import {
  EPA_INIT_PENALTY,
  EPA_NORM_MEAN,
  EPA_NORM_SD,
  EPA_ROOKIE_BASELINE,
  normalizedFromPoints,
  normalizedToSeasonUnits,
  populationMeanSd,
  type EpaCarryoverInput,
  type EpaCarryoverResult,
} from "../carryover.js";
import type { Sigma1Params } from "./params.js";

// Re-exported so a caller of this module never needs to reach back into
// ../carryover.js just to name the structural constants this file's own
// header explains are deliberately NOT tunable.
export { EPA_INIT_PENALTY, EPA_NORM_MEAN, EPA_NORM_SD, EPA_ROOKIE_BASELINE };

/**
 * Sigma1's parameterized equivalent of `carryover.ts`'s
 * `carryNormalizedRating` — identical blend/reversion shape, reading
 * `params.carryLastYearWeight`/`params.carryPriorYearWeight`/
 * `params.carryMeanReversion` in place of the three frozen EPA constants.
 * `EPA_ROOKIE_BASELINE` (derived, frozen) is used unchanged in both the
 * "no history at all" branch and the reversion target — the rookie
 * baseline itself is not a Sigma1-tunable degree of freedom, only how
 * FAR a carried rating reverts toward it is.
 */
function sigma1CarryNormalizedRating(lastYear: number | null, yearBefore: number | null, params: Sigma1Params): number {
  if (lastYear === null && yearBefore === null) {
    return EPA_ROOKIE_BASELINE;
  }

  const blended =
    lastYear !== null && yearBefore !== null
      ? params.carryLastYearWeight * lastYear + params.carryPriorYearWeight * yearBefore
      : (lastYear ?? yearBefore)!;

  return blended + params.carryMeanReversion * (EPA_ROOKIE_BASELINE - blended);
}

/**
 * Sigma1's own tunable season-boundary carry, structurally identical to
 * `epaCarryover` (same input/result shapes, imported not redeclared) but
 * reading its three tunable constants from `params` instead of the frozen
 * `EPA_*` module constants. At `params === DEFAULT_SIGMA1_PARAMS` this is
 * provably behaviour-preserving — `DEFAULT_SIGMA1_PARAMS`'s
 * `carryMeanReversion`/`carryLastYearWeight`/`carryPriorYearWeight` are
 * themselves imported from `EPA_MEAN_REVERSION`/`EPA_CARRY_LAST_YEAR_WEIGHT`/
 * `EPA_CARRY_PRIOR_YEAR_WEIGHT` (`params.ts`), so a default-params call and
 * an `epaCarryover` call read the identical numbers (`carryover.test.ts`
 * asserts this as a test, not just by inspection).
 */
export function sigma1Carryover(input: EpaCarryoverInput, params: Sigma1Params): EpaCarryoverResult {
  const { mean, sd } = populationMeanSd([...input.teamTotals.values()]);

  const nextLastSeason = new Map<string, number>();
  for (const [team, points] of input.teamTotals) {
    nextLastSeason.set(team, normalizedFromPoints(points, mean, sd));
  }

  const carryWorthyTeams = new Set<string>([...nextLastSeason.keys(), ...input.priorSeasonRatings.lastSeason.keys()]);

  const teamPointTotals = new Map<string, number>();
  for (const team of carryWorthyTeams) {
    const lastYear = nextLastSeason.get(team) ?? null;
    const yearBefore = input.priorSeasonRatings.lastSeason.get(team) ?? null;
    const carried = sigma1CarryNormalizedRating(lastYear, yearBefore, params);
    teamPointTotals.set(team, normalizedToSeasonUnits(carried, mean, sd));
  }

  return {
    teamPointTotals,
    priorSeasonRatings: {
      lastSeason: nextLastSeason,
      yearBefore: input.priorSeasonRatings.lastSeason,
    },
  };
}
