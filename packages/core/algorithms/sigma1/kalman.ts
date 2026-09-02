/**
 * Sigma1 Kalman core (D-01/D-03/D-06/D-07, ALGO-03) — the alliance-sum
 * update over independent per-team priors that gives every Sigma1 team
 * metric its own, data-derived mean and variance instead of a fixed
 * constant (the honest-uncertainty requirement PROJECT.md names as
 * SigmaScout's core value).
 *
 * RESEARCH.md Pattern 2's derivation is implemented largely as given: each
 * team's belief about ONE component is a Gaussian N(mean, variance),
 * treated as a priori INDEPENDENT of every teammate's belief — the direct
 * extension of D-06's no-cross-team-latent discipline to the covariance
 * structure, not just the mean structure (grounded reasoning, not merely
 * asserted: it is also what makes the per-match cost trivial, see below).
 * An alliance-level observation is the SUM of 3 teammates' latent means,
 * the same "one row of a 0/1 design matrix" shape `opr.ts`'s
 * `solveRidgeOpr` already uses — Sigma1 differs from OPR only in solving it
 * incrementally per-alliance with priors instead of a global regression; it
 * reuses `opr.ts`'s `ratingEligibleTeams`/surrogate-and-disqualification
 * policy unchanged rather than re-deriving it (RESEARCH.md Pattern 2,
 * 02-PATTERNS.md).
 *
 * Performance note (`opr.ts`'s incremental-update-with-measured-
 * justification comment culture, lines 219-243 there): one alliance-
 * component update below is O(1) in team count — three scalar reads, one
 * 3-term sum, one scalar division, three scalar writes — independent of
 * how many teams the season has accumulated (unlike OPR's
 * `IncrementalInverse`, which grows with every team ever seen). Scaled to a
 * full match (2 alliances x ~10-15 per-season components, see
 * `breakdown/*.ts`), that is on the order of 100-150 scalar Kalman updates
 * per match — RESEARCH.md's own estimate, several orders of magnitude
 * under the Phase 4 Worker's 10ms CPU budget, and cheaper per-match than
 * OPR's own already-fast incremental update (which must touch every team
 * seen so far this season, not just the 6 in this match). This is an
 * ESTIMATE to be MEASURED once wired end to end through a real replay, not
 * an asserted budget — plan 02-06 records the measurement.
 */

/** One team's belief about one component: a Gaussian N(mean, variance). */
export interface TeamComponentBelief {
  readonly mean: number;
  /** Posterior uncertainty about `mean` (P) — shrinks with more observations, re-inflated by process noise (Q) at every step. */
  readonly variance: number;
}

/**
 * D-07's event-boundary process-noise bump, applied to a belief BEFORE an
 * alliance-sum update: `P += q`. Represents drift in a team's true ability
 * since its last observation — small within an event, larger across an
 * event boundary (see the two exported magnitudes below).
 */
export function applyProcessNoise(belief: TeamComponentBelief, q: number): TeamComponentBelief {
  return { mean: belief.mean, variance: belief.variance + q };
}

/**
 * D-07 process-noise magnitude for two matches within the SAME event
 * (points^2 per match). Small, because a robot does not change materially
 * between two matches an hour apart at the same competition.
 * Phase 3 hyperparameter, default unverified.
 *
 * Since `SIGMA1_CODE_VERSION` 4.0.0 (D-T1) this is NO LONGER the value the
 * score-side filter applies. It has exactly two live roles, and keeping it is
 * what makes both possible:
 *
 *   1. It is the ABSOLUTE value `DEFAULT_SIGMA1_PARAMS.processNoiseWithinEventRel`
 *      is DERIVED from, at `SIGMA1_REFERENCE_SCORE_VARIANCE` — the score side
 *      now injects `processNoiseWithinEventRel * sigma^2` per match, resolved
 *      by `sigma1/scale.ts`.
 *   2. It is the default for `DEFAULT_SIGMA1_PARAMS.rpProcessNoiseWithinEvent`,
 *      which the RP threshold variables read ABSOLUTELY and unchanged (F3:
 *      those variables are counts, not points).
 *
 * A live-looking constant that nothing reads is the next reader's trap; this
 * one is read, just not where it used to be.
 */
export const SIGMA1_PROCESS_NOISE_WITHIN_EVENT = 0.5;

/**
 * D-07 process-noise magnitude injected at an EVENT BOUNDARY (points^2).
 * Larger than the within-event bump, because robots get rebuilt, re-tuned,
 * or repaired between events — a bigger regime change than a match-to-match
 * step within the same competition.
 * Phase 3 hyperparameter, default unverified.
 *
 * Same two live roles as `SIGMA1_PROCESS_NOISE_WITHIN_EVENT` above since
 * 4.0.0 (D-T1/F3): the derivation source for
 * `processNoiseEventBoundaryRel`'s default, and RP's own absolute
 * `rpProcessNoiseEventBoundary` default. Not the value the score-side filter
 * applies.
 */
export const SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY = 8;

/**
 * Joint Kalman update for teammates observed only through their SUM (one
 * alliance-component's total). Kalman gain per team is proportional to that
 * team's own uncertainty relative to the pooled uncertainty — a team we're
 * more unsure about absorbs more of the innovation, mirroring OPR's own
 * regression intuition but computed per-alliance instead of via a global
 * solve: `K_j = P_j / (Sum P_i + R)`, `mean_j += K_j * innovation`,
 * `P_j -= K_j * P_j`.
 *
 * Two degenerate branches, both documented rather than left to throw or
 * silently emit NaN (this project's failure log names an unidentifiable
 * model that shipped without this kind of numerical-stability discipline):
 *
 *   - Empty `teammates` (every team on this alliance was a surrogate,
 *     `ratingEligibleTeams` already excluded them all): returns an empty
 *     array without throwing — a genuine no-op, matching `opr.ts`'s
 *     `applyObservation` for the identical case.
 *   - `pooledVariance === 0` (every teammate's variance AND the
 *     measurement noise are exactly 0): there is no uncertainty anywhere
 *     for an observation to correct. A zero gain is the mathematically
 *     correct limit here, not an error condition — returning every belief
 *     unchanged avoids a 0/0 division that would otherwise poison every
 *     downstream mean and spread with NaN.
 */
export function updateAllianceSum(
  teammates: readonly TeamComponentBelief[],
  observedSum: number,
  measurementNoise: number
): TeamComponentBelief[] {
  if (teammates.length === 0) {
    return [];
  }

  const predictedSum = teammates.reduce((sum, t) => sum + t.mean, 0);
  const pooledVariance = teammates.reduce((sum, t) => sum + t.variance, 0) + measurementNoise;
  const innovation = observedSum - predictedSum;

  if (pooledVariance === 0) {
    return teammates.map((t) => ({ mean: t.mean, variance: t.variance }));
  }

  return teammates.map((t) => {
    const gain = t.variance / pooledVariance;
    return {
      mean: t.mean + gain * innovation,
      variance: t.variance * (1 - gain),
    };
  });
}
