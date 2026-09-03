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
 * `sigma1Carryover` reproduces `epaCarryover`'s reversion math exactly and its
 * blend up to a reparameterization, substituting
 * `params.carryPriorYearShare`/`params.carryMeanReversion` for the three
 * frozen constants. Per RESEARCH.md Open Question 3 (resolved by CONTEXT.md
 * D-04): the carry constants that become tunable for Sigma1's copy are
 * exactly the three explicitly tagged "Phase 3 hyperparameter, default
 * unverified" in `carryover.ts` — since D-T2 (quick task 260901-trz) two of
 * them are represented by ONE Sigma1 parameter rather than two.
 *
 * D-T2, the blend's shape. EPA's frozen pair is applied UNNORMALIZED:
 * `EPA_CARRY_LAST_YEAR_WEIGHT * lastYear + EPA_CARRY_PRIOR_YEAR_WEIGHT *
 * yearBefore`. As a SEARCH SPACE that is two parameters carrying one new
 * degree of freedom plus a duplicate: their SUM controls overall shrinkage —
 * already `carryMeanReversion`'s job — while only their RATIO asks a distinct
 * question. Sigma1's copy therefore takes a single share:
 * `(1 - share) * lastYear + share * yearBefore`. The weights now always sum
 * to 1, the carried magnitude is preserved, and `carryMeanReversion` is the
 * sole shrinkage control. At `share = 0.3` — `DEFAULT_SIGMA1_PARAMS`'s own
 * default, itself derived from EPA's frozen pair rather than re-typed — this
 * reproduces the retired `0.7 / 0.3` blend to the last bit, which
 * `carryover.test.ts` asserts against hand-computed values rather than
 * against a re-implementation of the same formula.
 *
 * `EPA_NORM_MEAN`/`EPA_NORM_SD`/`EPA_INIT_PENALTY` stay
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
 *
 * Quick task 260903-3bv: Sigma1's copy now diverges from `epaCarryover` in a
 * SECOND way beyond the D-T2 reparameterization above — it applies its
 * reversion (and, in `sigma1/index.ts`'s `carrySeason`, its consistency
 * decay) once per YEAR ELAPSED across a boundary, not once per boundary.
 * `epaCarryover` has and will always have no concept of a gap — D-1 freezes
 * EPA at literal Statbotics parity, gap included, so this divergence is
 * deliberate and asymmetric with EPA on purpose (accepted consequence: VPR
 * gains an advantage on the seasons after a multi-year gap that comes from
 * the frozen baseline being handicapped there, not from VPR being better).
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
import type { Sigma1ResolvedParams } from "./scale.js";

// Re-exported so a caller of this module never needs to reach back into
// ../carryover.js just to name the structural constants this file's own
// header explains are deliberately NOT tunable.
export { EPA_INIT_PENALTY, EPA_NORM_MEAN, EPA_NORM_SD, EPA_ROOKIE_BASELINE };

/**
 * Quick task 260903-3bv: generalizes a single-boundary reversion fraction to
 * `gap` years elapsed — apply the reversion once per year rather than once
 * per boundary, so a two-year gap (e.g. the permanently-excluded 2021 season
 * spanning 2020 -> 2022) reverts strictly further toward the baseline than a
 * one-year gap on the same inputs (D-2 item 1).
 *
 * `gap === 1` returns `reversion` UNCHANGED via an explicit fast path rather
 * than evaluating the general expression at `gap = 1`. This is load-bearing,
 * not stylistic: `1 - (1 - reversion) ** 1` does NOT reproduce `reversion`
 * bitwise in IEEE-754 for every input — e.g. at `reversion = 0.37` the
 * general expression yields `0.37000000000000005`, not `0.37`. D-3's bar is
 * an exact, `toBe`-provable no-op on today's contiguous (all-one-year-gap)
 * corpus, which only the fast path guarantees. Do not "simplify away" this
 * branch by relying on exponent round-tripping.
 */
export function reversionOverGap(reversion: number, gap: number): number {
  if (gap === 1) return reversion;
  return 1 - (1 - reversion) ** gap;
}

/**
 * Sigma1's parameterized equivalent of `carryover.ts`'s
 * `carryNormalizedRating` — identical reversion shape, and a NORMALIZED
 * two-season blend controlled by the single `params.carryPriorYearShare`
 * (D-T2) in place of EPA's frozen unnormalized weight pair.
 * `params.carryMeanReversion` replaces the third frozen constant, now
 * generalized over `gap` years elapsed via `reversionOverGap` (quick task
 * 260903-3bv, D-2 item 1).
 * `EPA_ROOKIE_BASELINE` (derived, frozen) is used unchanged in both the
 * "no history at all" branch and the reversion target — the rookie
 * baseline itself is not a Sigma1-tunable degree of freedom, only how
 * FAR a carried rating reverts toward it is. The "no history at all" branch
 * is gap-independent BY CONSTRUCTION, not by oversight: a team already AT
 * the baseline cannot revert further toward it regardless of how many years
 * elapsed, so `gap` is accepted but unused on that path.
 */
function sigma1CarryNormalizedRating(
  lastYear: number | null,
  yearBefore: number | null,
  params: Sigma1ResolvedParams,
  gap: number
): number {
  if (lastYear === null && yearBefore === null) {
    return EPA_ROOKIE_BASELINE;
  }

  const blended =
    lastYear !== null && yearBefore !== null
      ? (1 - params.carryPriorYearShare) * lastYear + params.carryPriorYearShare * yearBefore
      : (lastYear ?? yearBefore)!;

  return blended + reversionOverGap(params.carryMeanReversion, gap) * (EPA_ROOKIE_BASELINE - blended);
}

/**
 * Sigma1's own tunable season-boundary carry, structurally identical to
 * `epaCarryover` (same input/result shapes, imported not redeclared) but
 * reading its tunable constants from `params` instead of the frozen `EPA_*`
 * module constants. At `params === DEFAULT_SIGMA1_PARAMS` this is provably
 * behaviour-preserving — `DEFAULT_SIGMA1_PARAMS.carryMeanReversion` is itself
 * imported from `EPA_MEAN_REVERSION`, and its `carryPriorYearShare` is
 * DERIVED from `EPA_CARRY_PRIOR_YEAR_WEIGHT / (EPA_CARRY_LAST_YEAR_WEIGHT +
 * EPA_CARRY_PRIOR_YEAR_WEIGHT)` (`params.ts`), so a default-params call and an
 * `epaCarryover` call produce the identical blend (`carryover.test.ts`
 * asserts this as a test, not just by inspection).
 *
 * Takes `Sigma1ResolvedParams` (D-T1): `carrySeason` resolves once at its top
 * and threads the result here, so this function — like every other Sigma1
 * internal — structurally cannot read a scale-relative field.
 *
 * `gap` (quick task 260903-3bv, D-2) is REQUIRED, not defaulted: there is
 * exactly one production call site (`sigma1/index.ts`'s `carrySeason`, which
 * computes it from a real `SeasonBoundary`), and a silent default of one
 * year is precisely the gap-blindness this task exists to remove. `gap` is
 * NOT added to `EpaCarryoverInput` — that interface lives in the frozen
 * shared `../carryover.js`, and constraint D-1 freezes EPA's path through
 * it, so a separate positional argument here is the smallest change that
 * reaches `sigma1CarryNormalizedRating` without widening that shared surface.
 */
export function sigma1Carryover(input: EpaCarryoverInput, params: Sigma1ResolvedParams, gap: number): EpaCarryoverResult {
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
    const carried = sigma1CarryNormalizedRating(lastYear, yearBefore, params, gap);
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
