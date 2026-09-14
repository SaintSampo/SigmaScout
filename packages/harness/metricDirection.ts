/**
 * Declared per-metric direction table. Direction is a fact about a metric
 * name, not a per-metric special case: `percentileRanks` is strictly
 * monotone (higher value, higher percentile), so a lower-is-better metric
 * needs an explicit inversion recorded here.
 *
 * Two accessors exist deliberately and must not collapse into one:
 * `percentiles.ts` derives its metric-name set from whatever an algorithm
 * actually emits (an open set) and tolerates an unrecognised name by
 * omitting it rather than throwing — a throw there would crash
 * `pnpm publish:seasons` mid-run, the worst place to fail. The strict
 * accessor below instead lives in test coverage, where an undeclared name
 * should fail loudly.
 */
import {
  BREAKDOWN_REGISTERED_SEASONS,
  componentMapForSeason,
  COMPONENT_GROUP_METRIC_KEYS,
} from "../core/algorithms/breakdown/index.js";
import { TOTAL_METRIC_KEY } from "../core/algorithms/types.js";
import { SIGMA_METRIC_KEY } from "./sigmaScore.js";

export type MetricDirection = "higher-is-better" | "lower-is-better";

/** Thrown by the STRICT accessor (`metricDirection`) for a name nobody declared. Never thrown by the lenient `metricDirectionOrDefault`. */
export class UndeclaredMetricDirectionError extends Error {
  constructor(metricName: string) {
    super(
      `metricDirection: "${metricName}" has no declared direction -- every published metric must declare "higher-is-better" or "lower-is-better"`
    );
    this.name = "UndeclaredMetricDirectionError";
  }
}

/**
 * Built once at module load, derived from `BREAKDOWN_REGISTERED_SEASONS` x
 * `componentMapForSeason` (never a hardcoded season list, so a newly
 * registered season is covered automatically) plus `TOTAL_METRIC_KEY` and
 * `COMPONENT_GROUP_METRIC_KEYS`; all `"higher-is-better"`.
 * `SIGMA_METRIC_KEY` is the lone `"lower-is-better"` entry, set below.
 */
const DIRECTION_BY_METRIC_NAME = new Map<string, MetricDirection>();
for (const season of BREAKDOWN_REGISTERED_SEASONS) {
  for (const name of componentMapForSeason(season).components) {
    DIRECTION_BY_METRIC_NAME.set(name, "higher-is-better");
  }
}
DIRECTION_BY_METRIC_NAME.set(TOTAL_METRIC_KEY, "higher-is-better");
for (const key of Object.values(COMPONENT_GROUP_METRIC_KEYS)) {
  DIRECTION_BY_METRIC_NAME.set(key, "higher-is-better");
}
/**
 * Deliberate override, not an oversight: the underlying quantity is
 * arguably two-sided (a wildly inconsistent robot can still suit an
 * alliance chasing upside), but for TIER purposes "more consistent is
 * always better" is the developer decision. Do not change this back to
 * two-sided.
 */
DIRECTION_BY_METRIC_NAME.set(SIGMA_METRIC_KEY, "lower-is-better");

/**
 * Strict accessor: throws `UndeclaredMetricDirectionError` on an undeclared
 * name rather than defaulting. Used by the test suite's coverage assertions
 * and by `sigmaMetric.ts`.
 */
export function metricDirection(metricName: string): MetricDirection {
  const direction = DIRECTION_BY_METRIC_NAME.get(metricName);
  if (direction === undefined) throw new UndeclaredMetricDirectionError(metricName);
  return direction;
}

/**
 * Lenient accessor over the same table: an undeclared name defaults to
 * `"higher-is-better"`, preserved for the publish hot path
 * (`percentiles.ts`'s `withPercentiles`).
 */
export function metricDirectionOrDefault(metricName: string): MetricDirection {
  return DIRECTION_BY_METRIC_NAME.get(metricName) ?? "higher-is-better";
}

/**
 * `rawPercentile` for higher-is-better, `100 - rawPercentile` for
 * lower-is-better — exact under the mid-rank convention `percentileRanks`
 * uses (reversing the sort order gives
 * `(countStrictlyAbove + 0.5*countEqual)/n*100`, which is precisely
 * `100 - p`), not an approximation.
 */
export function goodnessPercentile(rawPercentile: number, direction: MetricDirection): number {
  return direction === "higher-is-better" ? rawPercentile : 100 - rawPercentile;
}

/** The set of metric names declared lower-is-better -- the small, deliberate test seam the equality-pin test reads. */
export function lowerIsBetterMetricKeys(): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const [name, direction] of DIRECTION_BY_METRIC_NAME) {
    if (direction === "lower-is-better") keys.add(name);
  }
  return keys;
}
