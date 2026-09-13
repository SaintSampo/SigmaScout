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
 * ONE POOL, ONE HELPER (quick task 260912-tnk). A rarity tier is a function
 * of (metric value, the one season ranking pool) on every surface of the
 * site. `packages/harness/publish.ts` builds that pool exactly once per
 * (algorithm, season) with `sortedPoolsByMetric`, from every team's metrics
 * as of its LAST OFFICIAL match (`lastOfficialMetricsByTeam`), and every
 * published percentile is ranked against it: the teams/{year} row's tier,
 * the team-season artifact's `seasonStats.metrics` (including an
 * offseason-only team's season-final fallback), every `metricHistory` row,
 * and every event artifact standing, on both the seasons and `--event`
 * paths. Each of those percentiles goes through
 * `goodnessPercentileAgainstPools`, which applies metric direction and ranks
 * at display precision, so a number cannot change tier between pages. The
 * live Worker's global rebuild re-derives Teams-row tiers through the same
 * helper (`apps/worker/src/scheduled.ts` `rederiveTeamsRowTiers`).
 */
import { COMPONENT_GROUP_METRIC_KEYS } from "../core/algorithms/breakdown/index.js";
import { TOTAL_METRIC_KEY, type TeamMetric, type TeamMetrics } from "../core/algorithms/types.js";
import { goodnessPercentile, metricDirectionOrDefault } from "./metricDirection.js";
import { roundMetric, roundTo, ROUNDING_RULE } from "./rounding.js";

/**
 * A `TeamMetric` widened with the percentile rank this pass computes.
 * `percentile` is never present on `packages/core/algorithms/types.ts`'s
 * `TeamMetric` itself — it is a publish-time-only derived quantity, not
 * something any `AlgorithmModule` computes.
 *
 * Since quick task 260909-tgf (D2), the published `percentile` means
 * GOODNESS rank, not value rank: `metricDirectionOrDefault` looks up each
 * metric name's declared direction and `goodnessPercentile` inverts it for a
 * declared lower-is-better name. This is identical to the raw value-rank
 * percentile for every higher-is-better metric — which was every metric
 * that flowed through this function before this task, and still is every
 * metric except `SWING_METRIC_KEY` — and reversed for a declared
 * lower-is-better one. This is what lets `publishedTierForPercentile` and
 * `apps/web/src/lib/tiers.ts` stay completely direction-unaware: they only
 * ever see a goodness percentile, never a raw one, so their single-source
 * tier-cut property survives this change untouched.
 */
/**
 * `tier` rides along here because `roundTeamMetricRecord` rebuilds each
 * metric field-by-field and must be able to name it — the teams artifact
 * carries the compact `tier` instead of `percentile` (see
 * `pageArtifacts.ts`'s `tier` doc for the measured size reason). Both are
 * optional and no record carries both.
 */
export type TeamMetricWithPercentile = TeamMetric & { percentile?: number; tier?: "rare" | "epic" | "legendary" };

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
 *
 * The published `percentile` is a GOODNESS rank (D2, quick task
 * 260909-tgf): the raw value-rank percentile is passed through
 * `goodnessPercentile` with that metric name's `metricDirectionOrDefault` —
 * the LENIENT accessor, never the strict one (see `metricDirection.ts`'s
 * file header for why a throw here would turn a multi-hour manual
 * `pnpm publish:seasons` run into a hard crash on an unrecognized name).
 *
 * Quick task 260912-tnk: every percentile is produced by
 * `goodnessPercentileAgainstPools` against `sortedPools` — the one pool the
 * caller already built, or `sortedPoolsByMetric(metricsByTeam, teamKeys)`
 * when omitted — so a teams row, a history row and an event standing
 * carrying the same value always carry the same percentile. For a pool
 * member this is exactly `percentileRanks`'s mid-rank percentile at display
 * precision (see `sortedPoolsByMetric`).
 */
export function withPercentiles(
  metricsByTeam: TeamMetrics,
  teamKeys: readonly string[],
  sortedPools: ReadonlyMap<string, readonly number[]> = sortedPoolsByMetric(metricsByTeam, teamKeys)
): TeamMetricsWithPercentile {
  const inPool = new Set(teamKeys);
  const result: TeamMetricsWithPercentile = {};
  for (const [teamKey, metrics] of Object.entries(metricsByTeam)) {
    const newMetrics: Record<string, TeamMetricWithPercentile> = {};
    const ranked = inPool.has(teamKey);
    for (const [name, metric] of Object.entries(metrics)) {
      const pct = ranked && metric.value !== undefined ? goodnessPercentileAgainstPools(sortedPools, name, metric.value) : undefined;
      newMetrics[name] = pct !== undefined ? { ...metric, percentile: pct } : { ...metric };
    }
    result[teamKey] = newMetrics;
  }
  return result;
}

/**
 * Quick task 260912-tnk: THE single function every pool-ranked published
 * percentile goes through — the teams row's tier, `seasonStats`, every
 * `metricHistory` row, every event standing, and the live Worker's Teams-row
 * tier re-derivation. Keeping it single is what makes the tier a function of
 * (value, pool) and nothing else.
 *
 * Ranks `roundMetric(value)` against `sortedPools.get(metricName)` with
 * `percentileAgainstSortedPool`'s mid-rank formula, then applies the metric's
 * declared direction through `goodnessPercentile` with the LENIENT
 * `metricDirectionOrDefault`, so a lower-is-better metric can never tier
 * inverted on one surface and upright on another. The query is rounded to
 * display precision because the pool is (see `sortedPoolsByMetric`), and two
 * teams that print the same number must share a percentile.
 *
 * Returns `undefined` when the map has no pool for `metricName` — never a
 * coerced 0, which would read as bottom-of-field (PD-07's absence contract).
 */
export function goodnessPercentileAgainstPools(
  sortedPools: ReadonlyMap<string, readonly number[]>,
  metricName: string,
  value: number
): number | undefined {
  const pool = sortedPools.get(metricName);
  if (pool === undefined) return undefined;
  return goodnessPercentile(percentileAgainstSortedPool(pool, roundMetric(value)), metricDirectionOrDefault(metricName));
}

/**
 * Quick task 260912-tnk: one team's metric record, each metric widened with
 * its percentile against `sortedPools` through
 * `goodnessPercentileAgainstPools`. A metric receives a percentile only when
 * (no `allowlist` is given, or its name is in it) AND a pool exists for that
 * name; otherwise it is copied with no `percentile` key at all.
 *
 * Returns a NEW record of NEW metric objects — `metrics` and its nested
 * objects are never mutated, since callers reuse history rows across loops.
 */
export function withPoolPercentiles(
  metrics: Readonly<Record<string, TeamMetric>>,
  sortedPools: ReadonlyMap<string, readonly number[]>,
  allowlist?: readonly string[]
): Record<string, TeamMetricWithPercentile> {
  const result: Record<string, TeamMetricWithPercentile> = {};
  for (const [name, metric] of Object.entries(metrics)) {
    const pct = allowlist === undefined || allowlist.includes(name) ? goodnessPercentileAgainstPools(sortedPools, name, metric.value) : undefined;
    result[name] = pct !== undefined ? { ...metric, percentile: pct } : { ...metric };
  }
  return result;
}

/**
 * Thrown by `percentileAgainstSortedPool` for an empty pool. An empty pool
 * has no defensible percentile — a zero here would read downstream as
 * bottom-of-field, which is a positive false claim about a team the
 * pipeline actually knows nothing about (T-06.1-12). `sortedPoolsByMetric`
 * omits a metric name entirely when no team has a value for it (PD-07), so
 * this throw path is unreachable in normal operation and is a defect
 * signal when it fires.
 */
export class EmptyPoolError extends Error {
  constructor() {
    super("percentileAgainstSortedPool: an empty pool has no defensible percentile");
    this.name = "EmptyPoolError";
  }
}

/**
 * D-06.1-A: ranks an arbitrary query `value` — typically a team's metric
 * value at some EARLIER point in the season — against `sortedValues`. Since
 * quick task 260912-tnk that pool is the season's last-official-match field
 * (every team's metrics as of its last official match), so this reads as
 * "an earlier value ranked against the season's last-official-match field".
 * It is deliberately NOT "the field as of that match index" (the rejected
 * alternative from 06-UAT.md F-06-3, not planned, not sketched, and not
 * left as a TODO anywhere in this codebase).
 *
 * Direction-unaware and unrounded on purpose: published percentiles never
 * call this directly — they go through `goodnessPercentileAgainstPools`,
 * which rounds the query and applies direction.
 *
 * Reuses `percentileRanks`'s exact mid-rank formula —
 * `(countStrictlyBelow + 0.5 * countEqual) / n * 100` — and its
 * `roundTo(..., ROUNDING_RULE.percentile)` call verbatim, rather than
 * re-deriving them, so a query value equal to a pool member agrees EXACTLY
 * (not approximately) with `percentileRanks(pool)` at that member's index.
 * `countStrictlyBelow` is found via a lower-bound binary search (O(log n));
 * `countEqual` via a forward scan from that point, since ties are expected
 * to be a small, localized run in a sorted array, never a second full scan.
 *
 * Throws `EmptyPoolError` for an empty `sortedValues` — see that class's
 * doc comment for why this is never a silent zero.
 */
export function percentileAgainstSortedPool(sortedValues: readonly number[], value: number): number {
  const n = sortedValues.length;
  if (n === 0) {
    throw new EmptyPoolError();
  }

  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedValues[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  const countStrictlyBelow = lo;

  let equalEnd = countStrictlyBelow;
  while (equalEnd < n && sortedValues[equalEnd] === value) equalEnd++;
  const countEqual = equalEnd - countStrictlyBelow;

  return roundTo(((countStrictlyBelow + 0.5 * countEqual) / n) * 100, ROUNDING_RULE.percentile);
}

/**
 * Builds, once per `(algorithm, season)`, an ascending sorted-values array
 * per metric name — THE season ranking pool (quick task 260912-tnk) that
 * `goodnessPercentileAgainstPools` queries for every published percentile
 * (teams rows, `seasonStats`, every `metricHistory` row, every event
 * standing) rather than re-sorting per row.
 *
 * The pool for each metric name is exactly the teams in `teamKeys` that have
 * a value for it — never `Object.keys(metricsByTeam)` alone — matching
 * `withPercentiles`'s own pool-scoping rule: a `metricsByTeam` record
 * containing a team outside `teamKeys` must not widen the pool.
 *
 * Values are pooled at DISPLAY precision (`roundMetric`), for two reasons.
 * Two teams that print the same number must share a percentile. And the live
 * Worker only ever sees rounded published values, so its tier re-derivation
 * can reproduce the offline tiers exactly only if the offline pool is rounded
 * too — otherwise a rounding-created tie near a tier cut would resolve
 * differently on the two sides. `publish.ts`'s `rankableTeamRows` comment
 * (quick task 260905-ttv) already ranks ROUNDED metrics for the same reason.
 * Published values themselves are not rounded here; `buildTeamsArtifact` and
 * `buildTeamSeasonArtifact` still own that boundary.
 *
 * A metric name no team in `teamKeys` has a value for is OMITTED entirely
 * from the returned map (PD-07) — never mapped to an empty array. An empty
 * array is a value a caller could mistake for "checked, pool is empty";
 * absence is the honest representation, and it is what makes
 * `percentileAgainstSortedPool`'s `EmptyPoolError` unreachable in normal
 * operation (a caller that only ever looks up names the map actually has
 * never passes it an empty pool).
 *
 * Never mutates `metricsByTeam` or any nested metric object.
 */
export function sortedPoolsByMetric(metricsByTeam: TeamMetrics, teamKeys: readonly string[]): Map<string, number[]> {
  const valuesByMetric = new Map<string, number[]>();
  for (const teamKey of teamKeys) {
    const metrics = metricsByTeam[teamKey];
    if (!metrics) continue;
    for (const [name, metric] of Object.entries(metrics)) {
      if (metric.value === undefined) continue;
      const value = roundMetric(metric.value);
      const values = valuesByMetric.get(name);
      if (values) values.push(value);
      else valuesByMetric.set(name, [value]);
    }
  }
  for (const values of valuesByMetric.values()) values.sort((a, b) => a - b);
  return valuesByMetric;
}

/**
 * PD-06: the publishable metric-name allowlist for per-history-row
 * percentiles — the three `COMPONENT_GROUP_METRIC_KEYS` values
 * (`phaseAuto`/`phaseTeleop`/`phaseEndgame`) plus `TOTAL_METRIC_KEY`,
 * imported from core rather than re-declared as string literals, so the
 * pipeline learns nothing about the UI and this list can never drift from
 * the names `breakdown/groups.ts` actually assigns.
 *
 * NOT every metric — this is a measured payload-budget decision, not an
 * oversight. `docs/publish-budget.md` records the budget-critical artifact
 * (`v1/team/frc118/2024/sigma1@2.0.0+tuned-2026-08.json`) [pre-rename] at 304,862 bytes
 * under a 375,000-byte ceiling: 70,138 bytes of headroom. That team-season
 * carries 292 `metricHistory` rows; a 2024 row's `metrics` record holds 17
 * names (13 season components, `total`, and the three phase groups). A
 * published `percentile` key costs roughly 18 bytes. All 17 names on all
 * 292 rows is roughly 89,000 bytes — more than the entire remaining
 * headroom, before this phase's per-bonus fields spend any of it. This
 * four-name set costs roughly 21,000 bytes, which fits alongside them.
 * Reversibility: costly — widening this set later needs another full
 * republish, but nothing breaks and no migration is needed. Plan 06.1-07
 * Task 1 re-measures this projection against the real corpus before the
 * republish is spent, and carries a pre-approved mitigation ladder if the
 * projection lands over.
 */
export const HISTORY_PERCENTILE_METRIC_KEYS: readonly string[] = [...Object.values(COMPONENT_GROUP_METRIC_KEYS), TOTAL_METRIC_KEY];

