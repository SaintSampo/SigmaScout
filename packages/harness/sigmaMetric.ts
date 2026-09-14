/**
 * The rating-local residual percentile behind a published per-robot
 * consistency metric — today SPR's `sigma` entry (value, percentile, tier).
 *
 * Relocated verbatim by quick task 260913-it4 from the module that built the
 * retired per-robot consistency accumulator's published metric (quick task
 * 260909-tgf, Task 1, whose D1 locked the residual framing; the functional form
 * below was that task's discretion). Quick task 260910-x parameterised it by
 * metric key so Sigma Score reused this exact construction rather than getting a
 * second copy; with the retired accumulator gone, Sigma Score is its only
 * consumer and the key is now REQUIRED.
 *
 * ---------------------------------------------------------------------------
 * THE FIT: A RUNNING MEDIAN OVER RATING-RANK NEIGHBOURS
 * ---------------------------------------------------------------------------
 *
 * Sort the eligible teams ascending by their `total` metric value (the
 * rating axis). Each team's expected consistency figure is the MEDIAN figure
 * of the `k` teams nearest it in that rating ordering, its own window centred
 * on itself. `k = max(25, round(n / 20))`, clamped to `n`. Residual = actual
 * figure minus that local median.
 *
 * Two alternatives were considered and REJECTED (recorded here so nobody
 * re-proposes them — see `.planning/quick/260909-tgf-.../260909-tgf-
 * CONTEXT.md` D1):
 *   - Coefficient of variation (`figure / rating`) — unstable at low ratings;
 *     a team rated 2.0 with a figure of 3.0 produces a wild ratio, so weak
 *     teams dominate both tails.
 *   - Rating-decile strata — creates visible discontinuities at bucket
 *     edges; two near-identical teams can land in different tiers.
 *
 * Why a running median over neighbours instead:
 *   - It assumes NO functional form. Consistency-vs-rating is not known to be
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

/** Median of a value list, ascending-sort-independent (sorts a copy). */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Each eligible team's expected consistency figure: the median figure of the
 * `k` rating-rank-nearest teams, its own window centred on itself (clamped at
 * the pool's edges). The eligible pool is `teamKeys` filtered to teams present
 * in BOTH `valueByTeam` and `ratingByTeam` — a team missing either cannot be
 * placed on the curve.
 */
export function expectedSigmaByTeam(
  valueByTeam: ReadonlyMap<string, number>,
  ratingByTeam: ReadonlyMap<string, number>,
  teamKeys: readonly string[]
): Map<string, number> {
  const eligible = teamKeys.filter((teamKey) => valueByTeam.has(teamKey) && ratingByTeam.has(teamKey));
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
    const windowValues = sortedByRating.slice(start, end).map((teamKey) => valueByTeam.get(teamKey)!);
    result.set(sortedByRating[i]!, median(windowValues));
  }
  return result;
}

/** One team's published consistency entry — the RAW figure and the inverted residual percentile. No other keys. */
export interface SigmaMetricEntry {
  value: number;
  percentile: number;
}

/**
 * Computes a published consistency metric for every eligible team in
 * `teamKeys`, ONCE per `(algorithm, season)`. Callers (`publish.ts`) feed
 * this result to BOTH the teams row and the team-season artifact, so the
 * two cannot structurally disagree about a team's tier.
 *
 * The eligible pool is teams in `teamKeys` that have BOTH a figure (in
 * `valueByTeam`) and a `total` metric value (in `metricsByTeam`, the rating
 * axis) — a team missing either gets NO entry, never a coerced zero
 * (honest absence, matching `percentiles.ts`'s own "no value, no
 * percentile" rule). The pool is exactly `teamKeys`, never
 * `Object.keys(metricsByTeam)` — the same pool-scoping rule `withPercentiles`
 * and `sortedPoolsByMetric` both state.
 *
 * The residual (actual figure minus expected figure) is never published —
 * it is an intermediate nothing renders, and the teams artifact is this
 * project's largest payload. Nothing is rounded here: `buildTeamsArtifact` /
 * `buildTeamSeasonArtifact` own the single rounding boundary
 * (`rounding.ts`'s header), and a second rounding pass here would make the
 * site's number disagree with the harness's.
 */
export function sigmaMetricByTeam(params: {
  valueByTeam: ReadonlyMap<string, number>;
  metricsByTeam: TeamMetrics;
  teamKeys: readonly string[];
  /**
   * Which metric key's declared direction to apply. REQUIRED — there is no
   * default key. The question this construction answers is "is this robot
   * more or less consistent than others at its rating", and the metric key
   * says which published entry the answer is for.
   */
  metricKey: string;
}): Record<string, SigmaMetricEntry> {
  const { valueByTeam, metricsByTeam, teamKeys, metricKey } = params;

  const ratingByTeam = new Map<string, number>();
  for (const teamKey of teamKeys) {
    const total = metricsByTeam[teamKey]?.[TOTAL_METRIC_KEY]?.value;
    if (total !== undefined) ratingByTeam.set(teamKey, total);
  }

  const eligible = teamKeys.filter((teamKey) => valueByTeam.has(teamKey) && ratingByTeam.has(teamKey));
  const result: Record<string, SigmaMetricEntry> = {};
  if (eligible.length === 0) return result;

  const expected = expectedSigmaByTeam(valueByTeam, ratingByTeam, eligible);
  const residuals = eligible.map((teamKey) => valueByTeam.get(teamKey)! - expected.get(teamKey)!);
  const rawPercentiles = percentileRanks(residuals);

  // The STRICT accessor is correct here, deliberately: every caller passes a
  // name `metricDirection.ts` declares, so a throw would mean the registry lost
  // its own entry -- a defect worth crashing on rather than degrading past. It
  // is the SAME declared-direction mechanism the percentile pass uses, so this
  // metric is an instance of it rather than a second one.
  const direction = metricDirection(metricKey);

  eligible.forEach((teamKey, i) => {
    result[teamKey] = {
      value: valueByTeam.get(teamKey)!,
      percentile: goodnessPercentile(rawPercentiles[i]!, direction),
    };
  });
  return result;
}
