/**
 * The rating-local residual percentile behind a published per-robot
 * consistency metric (SPR's `sigma` entry: value, percentile, tier).
 *
 * Each eligible team's expected consistency figure is the MEDIAN figure of
 * the `k` teams nearest it in rating rank, its own window centred on itself
 * (`k = max(25, round(n / 20))`, clamped to `n`). Residual = actual figure
 * minus that local median. A running median over rating-rank neighbours
 * assumes no functional form and is robust to outliers by construction, and
 * every team's own centred window avoids the bucket-edge discontinuities a
 * rating-decile stratification would create; coefficient-of-variation
 * (figure / rating) is rejected because it is unstable at low ratings.
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
 * `k` rating-rank-nearest teams (clamped at the pool's edges). Eligible means
 * present in both `valueByTeam` and `ratingByTeam`.
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
 * `teamKeys`, ONCE per `(algorithm, season)` — callers feed this same result
 * to both the teams row and the team-season artifact so the two cannot
 * disagree. A team missing either a figure or a rating gets no entry, never
 * a coerced zero. The pool is exactly `teamKeys`, never
 * `Object.keys(metricsByTeam)`. Nothing is rounded here: `buildTeamsArtifact`
 * / `buildTeamSeasonArtifact` own the single rounding boundary.
 */
export function sigmaMetricByTeam(params: {
  valueByTeam: ReadonlyMap<string, number>;
  metricsByTeam: TeamMetrics;
  teamKeys: readonly string[];
  /** Which metric key's declared direction to apply. Required, no default. */
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

  // Strict accessor: an unknown key means the registry lost its own entry,
  // a defect worth crashing on rather than degrading past.
  const direction = metricDirection(metricKey);

  eligible.forEach((teamKey, i) => {
    result[teamKey] = {
      value: valueByTeam.get(teamKey)!,
      percentile: goodnessPercentile(rawPercentiles[i]!, direction),
    };
  });
  return result;
}
