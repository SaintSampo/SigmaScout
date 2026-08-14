/**
 * Cross-season carry (D-16/D-17/D-18/D-19) — Statbotics' reference shape
 * for carrying a team's rating across a season boundary, verified verbatim
 * against `backend/src/models/epa/init.py`/`constants.py` this phase's
 * RESEARCH.md session: `0.7 * last year's normalized rating + 0.3 * the
 * year before`, then reverted 40% toward a rookie baseline of
 * `NORM_MEAN - 0.2 * NORM_SD`, converted into the new season's point units,
 * floored at non-negative.
 *
 * D-13 divergence, stated once here rather than per-function: this module
 * does NOT port Statbotics' per-season post-processing (the 2018
 * switch/scale sigmoid, the per-year clamps) — `epa.ts`'s file header
 * documents the same exclusion for the rest of the algorithm.
 *
 * Discretionary modelling choice (Claude's Discretion per RESEARCH.md —
 * "how the total-only fallback distributes residual" is explicitly called
 * out there as discretionary; sourcing the season point-unit scale for a
 * carry is the same class of decision, unaddressed by D-16's reference
 * shape): `normalizedToSeasonUnits` needs a `seasonScoreMean`/
 * `seasonScoreSd` to convert a normalized rating into point units, but at
 * the moment a boundary is carried, `toSeason` has not been observed yet —
 * there is no live point-unit scale for it, the same gap `epa.ts`'s
 * `EPA_INIT_COMPONENT_TOTAL` comment already names for pure intra-season
 * cold start. `epaCarryover` below resolves it the same way: use the
 * OUTGOING season's own per-team point-total distribution (mean/sd across
 * every team with a rating in `fromSeason`) as the best-available proxy
 * for the scale, in both directions of the normalized<->points conversion.
 * This keeps the round trip self-consistent (a team's `fromSeason` points
 * convert to normalized and back using the same mean/sd), and is a
 * documented placeholder Phase 3 may replace with a better anchor once
 * tune-season data exists to calibrate against.
 *
 * Module ownership note: `EPA_NORM_MEAN`/`EPA_NORM_SD`/`EPA_INIT_PENALTY`/
 * `EPA_MEAN_REVERSION` are defined HERE (not in `epa.ts`, where plan 02-01
 * originally parked them "for a later plan") and re-exported by `epa.ts`
 * for its own unrelated intra-season cold-start seed
 * (`EPA_INIT_COMPONENT_TOTAL`). This module owning them and `epa.ts`
 * importing back is the only acyclic direction: `epa.carrySeason` needs
 * this module's `epaCarryover`, so the reverse (`carryover.ts` importing
 * from `epa.ts`) would be a circular import that breaks at module-init
 * time (`EPA_ROOKIE_BASELINE` below dereferences `EPA_NORM_MEAN` at the
 * top level, before a circularly-imported `epa.ts` would have finished
 * initializing its own top-level constants).
 */

/**
 * Statbotics' normalized-rating-scale mean (`NORM_MEAN` in
 * `constants.py`). Not a point value — a team's rating on this scale is
 * meaningless outside a specific season's conversion (see
 * `normalizedToSeasonUnits`).
 */
export const EPA_NORM_MEAN = 1500;

/** Statbotics' normalized-rating-scale standard deviation (`NORM_SD`). Same caveat as `EPA_NORM_MEAN`. */
export const EPA_NORM_SD = 250;

/**
 * How far below `EPA_NORM_MEAN`, in units of `EPA_NORM_SD`, a rookie team
 * starts (Statbotics' `INIT_PENALTY`). A positive penalty reflects that an
 * unobserved team should start slightly below the league mean rather than
 * exactly at it — an unobserved team is not evidence of average ability,
 * it is an absence of evidence.
 */
export const EPA_INIT_PENALTY = 0.2;

/**
 * How far a carried-over rating reverts toward the rookie baseline at a
 * season boundary (Statbotics' `MEAN_REVERSION`). Phase 3 hyperparameter,
 * default unverified.
 */
export const EPA_MEAN_REVERSION = 0.4;

/**
 * Weight given to a team's immediately-prior season's normalized rating
 * when carrying across a season boundary (Statbotics' `YEAR_ONE_WEIGHT`).
 * Phase 3 hyperparameter, default unverified.
 */
export const EPA_CARRY_LAST_YEAR_WEIGHT = 0.7;

/**
 * Complement of `EPA_CARRY_LAST_YEAR_WEIGHT` — weight given to the season
 * before that. Phase 3 hyperparameter, default unverified.
 */
export const EPA_CARRY_PRIOR_YEAR_WEIGHT = 0.3;

/**
 * The normalized-scale rating a team with no rating history starts a
 * season at (Statbotics' `get_init_epa` rookie baseline): `NORM_MEAN -
 * INIT_PENALTY * NORM_SD`, expressed as a derived expression (not the bare
 * literal 1450) so a change to either input constant propagates here
 * automatically. Evaluates to 1500 - 0.2 * 250 = 1450.
 */
export const EPA_ROOKIE_BASELINE = EPA_NORM_MEAN - EPA_INIT_PENALTY * EPA_NORM_SD;

/**
 * Blends a team's normalized ratings from the two seasons before a
 * boundary into its carried-in normalized rating, per D-16's reference
 * shape:
 *
 *   - Both inputs present: `0.7 * lastYear + 0.3 * yearBefore`, then
 *     reverted 40% toward `EPA_ROOKIE_BASELINE`.
 *   - Exactly one input present: that rating alone (the missing season
 *     contributes nothing — never read as 0, since a 0-weighted blend
 *     would drag the result toward zero rather than leaving it as "no
 *     opinion from that season"), then the same 40% reversion.
 *   - Neither input present (a team with no rating history at all):
 *     `EPA_ROOKIE_BASELINE` — an unobserved team is an absence of
 *     evidence, not evidence of average ability.
 *
 * Operates entirely in normalized (`EPA_NORM_MEAN`/`EPA_NORM_SD`-scale)
 * units — converting to/from a season's point units is
 * `normalizedToSeasonUnits`'s job, not this function's.
 */
export function carryNormalizedRating(lastYear: number | null, yearBefore: number | null): number {
  if (lastYear === null && yearBefore === null) {
    return EPA_ROOKIE_BASELINE;
  }

  const blended =
    lastYear !== null && yearBefore !== null
      ? EPA_CARRY_LAST_YEAR_WEIGHT * lastYear + EPA_CARRY_PRIOR_YEAR_WEIGHT * yearBefore
      : (lastYear ?? yearBefore)!;

  // Revert 40% toward the rookie baseline: new = (1 - reversion) * blended
  // + reversion * baseline, i.e. move `EPA_MEAN_REVERSION` of the distance
  // from `blended` to `EPA_ROOKIE_BASELINE`.
  return blended + EPA_MEAN_REVERSION * (EPA_ROOKIE_BASELINE - blended);
}

/**
 * Converts a normalized-scale rating into point units for a season whose
 * per-team point-total distribution is `seasonScoreMean`/`seasonScoreSd`
 * (see file header for what supplies these at a real season boundary): a
 * z-score conversion, `seasonScoreMean + ((normalized - EPA_NORM_MEAN) /
 * EPA_NORM_SD) * seasonScoreSd`, floored at 0.
 *
 * The floor exists because a starting rating below zero would predict a
 * team actively SUBTRACTING from its alliance's score before it has played
 * a single match this season — no observation supports that; zero (a team
 * expected to contribute nothing yet) is the correct floor, not a
 * negative number.
 *
 * `seasonScoreSd <= 0` (a degenerate scale — e.g. a single team, or every
 * team's total happened to be identical) falls back to treating every
 * normalized rating as exactly at the mean, rather than dividing by zero.
 */
export function normalizedToSeasonUnits(normalized: number, seasonScoreMean: number, seasonScoreSd: number): number {
  const zScore = seasonScoreSd > 0 ? (normalized - EPA_NORM_MEAN) / EPA_NORM_SD : 0;
  const points = seasonScoreMean + zScore * seasonScoreSd;
  return Math.max(0, points);
}

/** Population mean/sd (matches `expandingStats.ts`'s population convention, not sample). */
function populationMeanSd(values: readonly number[]): { mean: number; sd: number } {
  if (values.length === 0) return { mean: 0, sd: 0 };
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  if (values.length < 2) return { mean, sd: 0 };
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return { mean, sd: Math.sqrt(variance) };
}

/** The inverse of `normalizedToSeasonUnits`: converts a season's own observed point total into a normalized rating, using that same season's team-total mean/sd. */
function normalizedFromPoints(points: number, seasonScoreMean: number, seasonScoreSd: number): number {
  const zScore = seasonScoreSd > 0 ? (points - seasonScoreMean) / seasonScoreSd : 0;
  return EPA_NORM_MEAN + zScore * EPA_NORM_SD;
}

/** Normalized per-team ratings carried across the two seasons preceding a boundary. */
export interface EpaCarryoverPriorRatings {
  /** Normalized rating from the season immediately before the one being carried out of. */
  readonly lastSeason: ReadonlyMap<string, number>;
  /** Normalized rating from two seasons before the one being carried out of. */
  readonly yearBefore: ReadonlyMap<string, number>;
}

export interface EpaCarryoverInput {
  /** `fromSeason`'s final per-team point totals (summed across every learned component). */
  readonly teamTotals: ReadonlyMap<string, number>;
  /** Normalized ratings carried INTO `fromSeason` at its own boundary. */
  readonly priorSeasonRatings: EpaCarryoverPriorRatings;
}

export interface EpaCarryoverResult {
  /** `toSeason`'s carried-in per-team point totals — the starting point-unit rating for every team with carry-worthy history. */
  readonly teamPointTotals: ReadonlyMap<string, number>;
  /** Normalized ratings carried INTO `toSeason`, ready to feed the next boundary. */
  readonly priorSeasonRatings: EpaCarryoverPriorRatings;
}

/**
 * The season-boundary math, independent of `EpaState`'s shape (D-16):
 * converts `fromSeason`'s final point totals into normalized ratings,
 * blends them against the two preceding seasons' normalized ratings per
 * `carryNormalizedRating`, and converts the result back into point units
 * per `normalizedToSeasonUnits`. Only teams with SOME carry-worthy history
 * (a rating in `teamTotals` or `priorSeasonRatings.lastSeason`) appear in
 * the result — a team with no history at all is a genuine first-timer for
 * `toSeason` and stays on the ordinary intra-season cold-start path
 * `epa.ts`'s `applyComponentUpdate` already implements, untouched by this
 * function.
 */
export function epaCarryover(input: EpaCarryoverInput): EpaCarryoverResult {
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
    const carried = carryNormalizedRating(lastYear, yearBefore);
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
