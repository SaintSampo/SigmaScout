/**
 * D-09/D-11's consistency (R) estimator: a team's own match-to-match
 * performance spread, shrunk toward the league average when its history is
 * thin.
 *
 * Three distinct "variance" quantities live in this phase — conflating
 * them is the single most likely way Sigma1 ships a number that reads
 * plausibly and means nothing (PROJECT.md's core value is HONEST
 * uncertainty). Named once here, mapped explicitly (RESEARCH.md Pattern 3;
 * updated by plan 07-06, D-01/D-02/D-03 — see that plan's own doc comment
 * on `sigma1/index.ts`'s `teamMetrics` for the full redefinition):
 *
 *   - consistency (D-09, THIS module) — the measurement noise `R`: the
 *     per-team, per-component variance of one match's REALIZED contribution
 *     around that team's CURRENT mean. `foldConsistency` estimates it
 *     online via an EWMA of squared residuals; `shrinkConsistency` blends
 *     it toward the league average for thin histories (D-11). D-03: this
 *     module's output is still computed and still folded into the Kalman
 *     update, but it is now only ONE OF THE TWO TERMS behind what the site
 *     displays — never published or displayed on its own.
 *   - estimate uncertainty — the posterior covariance `P` from
 *     `kalman.ts`'s `TeamComponentBelief.variance`. The OTHER term: since
 *     plan 07-06 (D-01), `P` is summed with this module's `R` at every
 *     `sigma1/index.ts` `teamMetrics` assembly site, and is therefore part
 *     of every `TeamMetric.spread` the site displays — no longer an
 *     internal-only filter quantity.
 *   - full predictive variance (D-10) — `P + Q + R`, combined per D-03
 *     across an alliance in `sigma1/index.ts`'s `predict`, and — since plan
 *     07-06 — the SAME two-term construction (`P` here plus `R` from this
 *     module, over one team rather than an alliance) that `teamMetrics`
 *     publishes as `TeamMetric.spread` at every aggregation level: team,
 *     phase group, and alliance total. One quantity, displayed everywhere.
 *
 * Boundary contracts this module makes explicit (matching `brier.ts`'s
 * header-block convention):
 *
 *   - `foldConsistency`'s `prior` argument is a VARIANCE (squared units),
 *     never a standard deviation — callers take `Math.sqrt` only at the
 *     point of display (`sigma1/index.ts`'s `teamMetrics`, which sums this
 *     term with `P` first — plan 07-06).
 *   - A team with zero prior matches gets its shrunk R entirely from
 *     the league-average prior (`shrinkConsistency`'s weight is exactly 0
 *     at `matchCount === 0`) — never a bare 0 (a false claim of perfect
 *     consistency) and never the raw per-team EWMA alone (which would be
 *     one match's noise dressed up as a stable estimate).
 *   - Every shrunk result is floored at `SIGMA1_MIN_CONSISTENCY_VARIANCE`
 *     so a thin-history team can never report an implausibly tiny spread,
 *     even if the league-average prior itself happens to be small early in
 *     a season.
 */

/**
 * EWMA rate for `foldConsistency`'s squared-residual fold. Phase 3
 * hyperparameter, default unverified — chosen small (relative to, e.g.,
 * `covariance.ts`'s own `SIGMA1_COV_EWMA_ALPHA`) so a single off match does
 * not swing a team's reported consistency drastically.
 */
export const SIGMA1_CONSISTENCY_EWMA_ALPHA = 0.2;

/**
 * D-11's empirical-Bayes prior-match count: at `matchCount ===
 * SIGMA1_SHRINKAGE_PRIOR_MATCHES`, a team's own observed consistency and
 * the league average are weighted equally; well below it the league
 * average dominates, well above it the team's own observed history
 * dominates. Phase 3 hyperparameter, default unverified.
 */
export const SIGMA1_SHRINKAGE_PRIOR_MATCHES = 8;

/**
 * Floor applied to every shrunk consistency VARIANCE (points^2), so a
 * thin-history team blended heavily toward a small or still-cold-start
 * league average never reports an implausibly tiny spread — the honest-
 * uncertainty failure mode PROJECT.md's core value explicitly forbids ("no
 * spread is a fixed constant... or any value not derived from that
 * specific team's own observed data" still permits a documented FLOOR,
 * which this is, as opposed to a substituted constant VALUE). Phase 3
 * hyperparameter, default unverified.
 */
export const SIGMA1_MIN_CONSISTENCY_VARIANCE = 1;

/**
 * Folds one new squared residual into `prior` (a running consistency
 * VARIANCE estimate) via an EWMA: `(1 - alpha) * prior + alpha *
 * residual^2`. `residual` is `observed - predicted` for one team, one
 * component, one match — `sigma1/index.ts`'s `update` supplies the
 * Kalman-gain-weighted attribution documented in `covariance.ts`'s header.
 */
export function foldConsistency(prior: number, residual: number, alpha: number = SIGMA1_CONSISTENCY_EWMA_ALPHA): number {
  const squared = residual * residual;
  return (1 - alpha) * prior + alpha * squared;
}

/**
 * D-11's empirical-Bayes blend: `w = matchCount / (matchCount +
 * priorMatches)`, `spread = w * observed + (1 - w) * leagueMean`, floored at
 * `minVariance`. Both trailing arguments default to this module's own
 * `SIGMA1_SHRINKAGE_PRIOR_MATCHES`/`SIGMA1_MIN_CONSISTENCY_VARIANCE` so
 * every pre-Phase-3 call site keeps compiling and behaving identically;
 * `sigma1/index.ts`'s `teamMetrics` (Phase 3) passes
 * `params.shrinkagePriorMatches`/`params.minConsistencyVariance` explicitly
 * instead. All arguments and the return value are VARIANCES (squared
 * units) — `sigma1/index.ts`'s `teamMetrics` (plan 07-06, D-01/D-02) sums
 * this R term with the matching P term from `kalman.ts`'s
 * `TeamComponentBelief.variance` FIRST, and takes the square root of that
 * sum only when populating a displayed `TeamMetric.spread` — never the
 * square root of this function's return value alone.
 */
export function shrinkConsistency(
  observed: number,
  matchCount: number,
  leagueMean: number,
  priorMatches: number = SIGMA1_SHRINKAGE_PRIOR_MATCHES,
  minVariance: number = SIGMA1_MIN_CONSISTENCY_VARIANCE
): number {
  const weight = matchCount / (matchCount + priorMatches);
  const blended = weight * observed + (1 - weight) * leagueMean;
  return Math.max(minVariance, blended);
}
