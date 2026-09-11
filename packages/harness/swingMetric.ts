/**
 * Quick task 260909-tgf, Task 1: the expected-swing curve and the residual
 * pass that feeds the published `swing` metric (D1's residual framing is
 * locked; the functional form below is this task's discretion).
 *
 * ---------------------------------------------------------------------------
 * THE FIT: A RUNNING MEDIAN OVER RATING-RANK NEIGHBOURS
 * ---------------------------------------------------------------------------
 *
 * Sort the eligible teams ascending by their `total` metric value (the
 * rating axis). Each team's expected swing is the MEDIAN Swing Factor of the
 * `k` teams nearest it in that rating ordering, its own window centred on
 * itself. `k = max(25, round(n / 20))`, clamped to `n`. Residual = actual
 * swing minus that local median.
 *
 * Two alternatives were considered and REJECTED (recorded here so nobody
 * re-proposes them — see `.planning/quick/260909-tgf-.../260909-tgf-
 * CONTEXT.md` D1):
 *   - Coefficient of variation (`swing / rating`) — unstable at low ratings;
 *     a team rated 2.0 with swing 3.0 produces a wild ratio, so weak teams
 *     dominate both tails.
 *   - Rating-decile strata — creates visible discontinuities at bucket
 *     edges; two near-identical teams can land in different tiers.
 *
 * Why a running median over neighbours instead:
 *   - It assumes NO functional form. Swing-vs-rating is not known to be
 *     linear, and a mis-specified curve would push its own shape into every
 *     residual.
 *   - The MEDIAN makes it robust to outliers by construction — an
 *     Einstein-bias team or a two-match team with a wild figure moves its
 *     window's median by essentially nothing.
 *   - Every team gets its OWN window, centred on itself, so there are no
 *     bucket edges: two near-identical teams see near-identical windows and
 *     near-identical expected values. This is exactly what disqualified
 *     rating-decile strata.
 *   - It is O(n log n) to sort plus O(n*k) to sweep — roughly 685k
 *     operations for a real 3,700-team season, computed once per
 *     (algorithm, season).
 *   - It has no low-rating instability, which is what disqualified the
 *     coefficient-of-variation ratio.
 */
import { TOTAL_METRIC_KEY, type TeamMetrics } from "../core/algorithms/types.js";
import { goodnessPercentile, metricDirection } from "./metricDirection.js";
import { percentileRanks } from "./percentiles.js";
import { SWING_METRIC_KEY } from "./swingFactor.js";

/** Median of a value list, ascending-sort-independent (sorts a copy). */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Each eligible team's expected swing: the median Swing Factor of the `k`
 * rating-rank-nearest teams, its own window centred on itself (clamped at
 * the pool's edges). The eligible pool is `teamKeys` filtered to teams
 * present in BOTH `swingByTeam` and `ratingByTeam` — a team missing either
 * cannot be placed on the curve.
 */
export function expectedSwingByTeam(
  swingByTeam: ReadonlyMap<string, number>,
  ratingByTeam: ReadonlyMap<string, number>,
  teamKeys: readonly string[]
): Map<string, number> {
  const eligible = teamKeys.filter((teamKey) => swingByTeam.has(teamKey) && ratingByTeam.has(teamKey));
  const sortedByRating = [...eligible].sort((a, b) => ratingByTeam.get(a)! - ratingByTeam.get(b)!);
  const n = sortedByRating.length;
  const result = new Map<string, number>();
  if (n === 0) return result;

  const windowSize = Math.min(n, Math.max(25, Math.round(n / 20)));
  const halfWindow = Math.floor(windowSize / 2);

  for (let i = 0; i < n; i++) {
    let start = i - halfWindow;
    let end = start + windowSize; // exclusive
    if (start < 0) {
      end -= start;
      start = 0;
    }
    if (end > n) {
      start -= end - n;
      end = n;
    }
    start = Math.max(0, start);
    const windowSwings = sortedByRating.slice(start, end).map((teamKey) => swingByTeam.get(teamKey)!);
    result.set(sortedByRating[i]!, median(windowSwings));
  }
  return result;
}

/** One team's published swing entry — the RAW Swing Factor and the inverted residual percentile. No other keys. */
export interface SwingMetricEntry {
  value: number;
  percentile: number;
}

/**
 * Computes the published `swing` metric for every eligible team in
 * `teamKeys`, ONCE per `(algorithm, season)`. Callers (`publish.ts`) feed
 * this result to BOTH the teams row and the team-season artifact, so the
 * two cannot structurally disagree about a team's swing tier.
 *
 * The eligible pool is teams in `teamKeys` that have BOTH a swing value (in
 * `swingByTeam`) and a `total` metric value (in `metricsByTeam`, the rating
 * axis) — a team missing either gets NO entry, never a coerced zero
 * (honest absence, matching `percentiles.ts`'s own "no value, no
 * percentile" rule). The pool is exactly `teamKeys`, never
 * `Object.keys(metricsByTeam)` — the same pool-scoping rule `withPercentiles`
 * and `sortedPoolsByMetric` both state.
 *
 * The residual (actual swing minus expected swing) is never published —
 * it is an intermediate nothing renders, and the teams artifact is this
 * project's largest payload. Nothing is rounded here: `buildTeamsArtifact` /
 * `buildTeamSeasonArtifact` own the single rounding boundary
 * (`rounding.ts`'s header), and a second rounding pass here would make the
 * site's number disagree with the harness's.
 */
export function swingMetricByTeam(params: {
  swingByTeam: ReadonlyMap<string, number>;
  metricsByTeam: TeamMetrics;
  teamKeys: readonly string[];
  /**
   * Which metric key's declared direction to apply. Defaults to
   * `SWING_METRIC_KEY`, so every existing caller is unchanged.
   *
   * Parameterised (quick task 260910-x) so SIGMA SCORE reuses this exact
   * expected-curve-and-residual construction rather than getting a second
   * copy of it. The two metrics are different estimators but the same
   * QUESTION — "is this robot more or less consistent than others at its
   * rating" — and a second implementation would be free to drift from this
   * one in the rating-local window size, the median, or the inversion.
   */
  metricKey?: string;
}): Record<string, SwingMetricEntry> {
  const { swingByTeam, metricsByTeam, teamKeys } = params;
  const metricKey = params.metricKey ?? SWING_METRIC_KEY;

  const ratingByTeam = new Map<string, number>();
  for (const teamKey of teamKeys) {
    const total = metricsByTeam[teamKey]?.[TOTAL_METRIC_KEY]?.value;
    if (total !== undefined) ratingByTeam.set(teamKey, total);
  }

  const eligible = teamKeys.filter((teamKey) => swingByTeam.has(teamKey) && ratingByTeam.has(teamKey));
  const result: Record<string, SwingMetricEntry> = {};
  if (eligible.length === 0) return result;

  const expected = expectedSwingByTeam(swingByTeam, ratingByTeam, eligible);
  const residuals = eligible.map((teamKey) => swingByTeam.get(teamKey)! - expected.get(teamKey)!);
  const rawPercentiles = percentileRanks(residuals);

  // The STRICT accessor is correct here, deliberately: SWING_METRIC_KEY is a
  // name THIS SAME MODULE's sibling (metricDirection.ts) declares, so a
  // throw would mean the registry lost its own entry -- a defect worth
  // crashing on rather than degrading past. It is the SAME declared-
  // direction mechanism the percentile pass uses, so swing is an instance
  // of it rather than a second one.
  const direction = metricDirection(metricKey);

  eligible.forEach((teamKey, i) => {
    result[teamKey] = {
      value: swingByTeam.get(teamKey)!,
      percentile: goodnessPercentile(rawPercentiles[i]!, direction),
    };
  });
  return result;
}
