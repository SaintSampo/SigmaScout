/**
 * D-04 (Phase 6, plan 06-04 Task 2): the mid-rank percentile pass over a
 * season's full team pool for a given (algorithm, season) pair.
 *
 * A team's percentile on a metric is
 * `(countStrictlyBelow + 0.5 * countEqual) / n * 100`, computed over EVERY
 * team in the pool that has a value for that metric — never a convenient
 * subset (a visible page, a top-N slice, an event's roster). Equal values
 * receive an equal percentile, which is what makes the tier boundary
 * (`colour-and-tiers.md`'s 50/75/95 cuts) well-defined. A team with no value
 * for a metric receives no `percentile` key at all on that metric — never a
 * coerced `0`, which would read as bottom-of-field.
 *
 * `packages/harness/publish.ts` calls `withPercentiles(metricsByTeam,
 * teamsThisSeason)` exactly once, immediately after `metricsByTeam` is
 * assembled and before either downstream consumer (the teams/{year}
 * artifact's `teamsRows`, the per-team loop's `seasonStats.metrics`) reads
 * it — this is what makes the ranking pass run once per (algorithm, season)
 * rather than being duplicated. This phase wires only the per-team
 * artifact's CONSUMPTION of the result (RESEARCH.md Open Question 2): the
 * teams-table artifact's own tier boxes are a later phase's decision, and
 * widening that artifact's published surface here is beyond what D-04
 * authorizes — this module's shape supports both, `publish.ts` uses one.
 */
import type { TeamMetric, TeamMetrics } from "../core/algorithms/types.js";
import { roundTo, ROUNDING_RULE } from "./rounding.js";

/**
 * A `TeamMetric` widened with the percentile rank this pass computes.
 * `percentile` is never present on `packages/core/algorithms/types.ts`'s
 * `TeamMetric` itself — it is a publish-time-only derived quantity, not
 * something any `AlgorithmModule` computes.
 */
export type TeamMetricWithPercentile = TeamMetric & { percentile?: number };

/** The `TeamMetrics`-shaped record `withPercentiles` returns — every team's metric record, each metric optionally carrying `percentile`. */
export type TeamMetricsWithPercentile = Record<string, Record<string, TeamMetricWithPercentile>>;

/**
 * Mid-rank percentile over `values`, returned in the SAME order as
 * `values` (index `i` of the result corresponds to `values[i]`). A tied
 * group of values all receives the identical percentile — the mid-rank
 * convention, not a plain `rank / (n-1)` scheme — rounded to
 * `ROUNDING_RULE.percentile` decimals (1), matching
 * `colour-and-tiers.md`'s own worked precision (p50=39.2, not
 * p50=39.20000001).
 *
 * O(n log n): one sort plus one linear rank sweep over the sorted order,
 * never an O(n^2) pairwise comparison — the real pool is ~3,700 teams per
 * season.
 */
export function percentileRanks(values: readonly number[]): number[] {
  const n = values.length;
  if (n === 0) return [];

  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => a.value - b.value);

  const result = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && indexed[j + 1]!.value === indexed[i]!.value) j++;
    // Entries at sorted positions i..j (inclusive) are tied.
    // countStrictlyBelow = i (the 0-based count of entries sorted strictly
    // before this tie group); countEqual = the tie group's own size.
    const countStrictlyBelow = i;
    const countEqual = j - i + 1;
    const pct = roundTo(((countStrictlyBelow + 0.5 * countEqual) / n) * 100, ROUNDING_RULE.percentile);
    for (let k = i; k <= j; k++) {
      result[indexed[k]!.index] = pct;
    }
    i = j + 1;
  }
  return result;
}

/**
 * Returns a NEW metrics record with `percentile` merged onto each
 * `TeamMetric` — never mutates `metricsByTeam` or any nested `TeamMetric`
 * object, since `metricsByTeam` is shared, unwidened, by the teams/{year}
 * artifact's own consumer.
 *
 * The percentile pool for each metric name is exactly `teamKeys` — the
 * full season team pool the caller passes — never inferred from
 * `Object.keys(metricsByTeam)` alone (a caller could pass a metrics record
 * that includes teams outside the intended pool; `teamKeys` is the single
 * source of truth for pool membership, matching this phase's prohibition
 * against ranking over a convenient subset).
 */
export function withPercentiles(metricsByTeam: TeamMetrics, teamKeys: readonly string[]): TeamMetricsWithPercentile {
  const metricNames = new Set<string>();
  for (const teamKey of teamKeys) {
    const metrics = metricsByTeam[teamKey];
    if (!metrics) continue;
    for (const name of Object.keys(metrics)) metricNames.add(name);
  }

  // percentileByMetric[metricName] -> Map<teamKey, percentile>
  const percentileByMetric = new Map<string, Map<string, number>>();
  for (const name of metricNames) {
    const entries: { teamKey: string; value: number }[] = [];
    for (const teamKey of teamKeys) {
      const value = metricsByTeam[teamKey]?.[name]?.value;
      if (value !== undefined) entries.push({ teamKey, value });
    }
    const percentiles = percentileRanks(entries.map((e) => e.value));
    const byTeam = new Map<string, number>();
    entries.forEach((entry, i) => byTeam.set(entry.teamKey, percentiles[i]!));
    percentileByMetric.set(name, byTeam);
  }

  const result: TeamMetricsWithPercentile = {};
  for (const [teamKey, metrics] of Object.entries(metricsByTeam)) {
    const newMetrics: Record<string, TeamMetricWithPercentile> = {};
    for (const [name, metric] of Object.entries(metrics)) {
      const pct = percentileByMetric.get(name)?.get(teamKey);
      newMetrics[name] = pct !== undefined ? { ...metric, percentile: pct } : { ...metric };
    }
    result[teamKey] = newMetrics;
  }
  return result;
}
