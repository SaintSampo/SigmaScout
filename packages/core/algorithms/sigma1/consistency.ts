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
 * SINCE 4.0.0 (D-T1) THERE IS A FOURTH QUANTITY TO KEEP APART, and it is a
 * different KIND of thing from the other three rather than a fourth member of
 * the same list: the SCALE those three are now expressed relative to — the
 * season's own realized alliance-score variance, `sigma^2`, read from the
 * leak-free expanding `state.allianceScoreStats`. The three below are all
 * per-team, per-component quantities in points^2. `sigma^2` is a LEAGUE-WIDE,
 * per-season quantity, and it is the divisor that turns a tuned constant into
 * a dimensionless fraction. `minConsistencyVariance` and
 * `coldStartConsistencyVariance` as this module's constants are still
 * points^2; the PARAMETERS of the same name on `Sigma1ResolvedParams` are
 * `rel * sigma^2` for the season being replayed, and only the resolved ones
 * are ever applied. Reading a `*Rel` field as though it were points^2 (or
 * this module's constants as though they were what the filter applies) is the
 * 4.0.0-era version of exactly the conflation this header exists to prevent.
 *
 *   - consistency (D-09, THIS module) — the measurement noise `R`: the
 *     per-team, per-component variance of one match's REALIZED contribution
 *     around that team's CURRENT mean. Estimated online by an EWMA
 *     (`foldConsistencyVariance`) of an INNOVATION-BASED variance sample;
 *     `shrinkConsistency` blends it toward the league average for thin
 *     histories (D-11). D-03: this module's output is still computed and
 *     still folded into the Kalman update, but it is now only ONE OF THE
 *     TWO TERMS behind what the site displays — never published or
 *     displayed on its own.
 *
 *     ESTIMATOR CHANGE (D-Q2, quick task 260901-is2). Until
 *     `SIGMA1_CODE_VERSION` 3.0.0 this term was an EWMA of SQUARED
 *     GAIN-WEIGHTED RESIDUALS `(K_j * innovation)^2`, with
 *     `K_j = P_j / (sum P + R)`. That estimator is biased toward its own
 *     floor by construction: as the filter converges, `K` shrinks, so the
 *     quantity being folded shrinks with it no matter how much the team
 *     actually varies. It measured how much the filter was still adjusting,
 *     not the team's match-to-match spread — a plausible-looking number that
 *     meant something other than what the site claimed it meant, which is
 *     exactly the failure PROJECT.md's core value forbids.
 *
 *     The replacement uses the fact that INNOVATIONS are observable and, for
 *     one alliance-component,
 *
 *         E[innovation^2] = sum of teammates' prior variances (sum P) + R
 *
 *     so an unbiased per-team variance sample is
 *
 *         max(0, innovation^2 - sum P) / n
 *
 *     which is what `sigma1/index.ts`'s `applyAllianceUpdate` computes and
 *     folds here. The `max(0, ...)` is a floor on a noisy unbiased sample
 *     (a single match can land inside the prior's own spread), not a
 *     substituted constant.
 *
 *     MEASURED CONSEQUENCE (all reproduced before the change shipped;
 *     `innovationVariance.test.ts` is the durable form of the first):
 *       - Synthetic league, truth known by construction (60 teams, true
 *         per-team per-match sigma = 12): published total spread 2.29 under
 *         the retired estimator, 12.35 under this one. 5.3x understated
 *         becomes 0.97x.
 *       - Real corpus, SD of `(actual margin - predicted margin)/sqrt(variance)`,
 *         which an honest filter puts at ~1.0: 2022-2026 quals fell from
 *         1.62-4.12 to 0.94-1.25, elims from 2.14-4.99 to 0.89-1.19.
 *       - Holdout playoff calibration: mean absolute gap 0.072 -> 0.041.
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
 *   - `foldConsistency` takes a RESIDUAL and squares it internally;
 *     `foldConsistencyVariance` takes a VARIANCE and folds it as given.
 *     They are SIBLING entry points, deliberately not one function with a
 *     flag: passing `Math.sqrt(varianceSample)` through the residual door
 *     to reach the variance behaviour would be precisely the conflation
 *     this header block names as the module's top failure mode. Sigma1's
 *     own update path uses `foldConsistencyVariance`; `foldConsistency`
 *     remains exported and tested because its residual contract is still
 *     the correct shape for any caller that genuinely holds a residual.
 *   - Every teammate on an alliance receives the SAME per-component
 *     variance sample. An alliance-sum observation carries one innovation
 *     for the whole alliance, and there is no way to recover a
 *     team-differentiated innovation from a summed observation (the
 *     identical limitation `sigma1/index.ts`'s `componentGains` and its
 *     normalized-innovation block already document). Per-team R
 *     differentiation therefore comes from WHICH ALLIANCES a team played
 *     on, not from within-alliance gain differences — an honest property of
 *     the observation model, named here so two teammates' equal spreads
 *     after a single shared match are not later read as a bug.
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
 * EWMA rate shared by `foldConsistency`'s squared-residual fold and
 * `foldConsistencyVariance`'s variance fold. Phase 3 hyperparameter, default
 * unverified — chosen small (relative to, e.g., `covariance.ts`'s own
 * `SIGMA1_COV_EWMA_ALPHA`) so a single off match does not swing a team's
 * reported consistency drastically. That reasoning matters MORE under the
 * innovation-based estimator (D-Q2), whose per-match sample is a genuinely
 * noisy unbiased draw rather than a heavily gain-damped one.
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
 *
 * NOT the floor the filter applies since `SIGMA1_CODE_VERSION` 4.0.0 (D-T1).
 * `shrinkConsistency` still takes an ABSOLUTE floor as its argument — this
 * module's own signature is unchanged — but the value passed in is now
 * `params.minConsistencyVarianceRel * sigma^2`, resolved per call from the
 * season's own realized alliance-score variance by `sigma1/scale.ts`. This
 * constant survives as the ABSOLUTE value that relative default is DERIVED
 * from, at `SIGMA1_REFERENCE_SCORE_VARIANCE`, which is exactly why it must
 * not be deleted — but a reader looking for "the floor the filter applies"
 * should look at the resolved parameter, not here.
 */
export const SIGMA1_MIN_CONSISTENCY_VARIANCE = 1;

/**
 * Folds one new squared residual into `prior` (a running consistency
 * VARIANCE estimate) via an EWMA: `(1 - alpha) * prior + alpha *
 * residual^2`. `residual` is `observed - predicted` for one team, one
 * component, one match.
 *
 * NOT on Sigma1's update path since `SIGMA1_CODE_VERSION` 3.0.0 (D-Q2) —
 * `sigma1/index.ts` folds an innovation-based variance sample through
 * `foldConsistencyVariance` below instead. Kept exported and tested because
 * the residual contract itself is still correct and is still the right door
 * for a caller that genuinely holds a residual; see the header block's
 * boundary contracts for why the two are siblings rather than one function.
 */
export function foldConsistency(prior: number, residual: number, alpha: number = SIGMA1_CONSISTENCY_EWMA_ALPHA): number {
  const squared = residual * residual;
  return (1 - alpha) * prior + alpha * squared;
}

/**
 * Folds one new variance SAMPLE into `prior` (a running consistency VARIANCE
 * estimate) via the same EWMA, with no squaring: `(1 - alpha) * prior +
 * alpha * varianceSample`. Both arguments and the return value are variances
 * (squared units).
 *
 * This is the door Sigma1's update path uses (D-Q2, quick task 260901-is2).
 * `sigma1/index.ts`'s `applyAllianceUpdate` supplies
 * `max(0, innovation^2 - sum P) / n` for one alliance-component — already a
 * variance, because `E[innovation^2] = sum P + R` makes it one directly.
 * Squaring it again (which is what routing it through `foldConsistency`
 * would do) would fold a points^4 quantity into a points^2 estimate.
 */
export function foldConsistencyVariance(
  prior: number,
  varianceSample: number,
  alpha: number = SIGMA1_CONSISTENCY_EWMA_ALPHA
): number {
  return (1 - alpha) * prior + alpha * varianceSample;
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
