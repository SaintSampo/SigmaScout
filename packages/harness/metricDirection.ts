/**
 * Quick task 260909-tgf, Task 1: a DECLARED per-metric direction table.
 *
 * D2 makes Swing Factor the first lower-is-better metric this project has
 * ever published. `percentileAgainstSortedPool`/`percentileRanks`
 * (`percentiles.ts`) are strictly monotone — higher value, higher percentile
 * — and there was no inversion concept anywhere in the pipeline or in
 * `apps/web/src/lib/tiers.ts` before this task. Direction is a declared FACT
 * about a metric name, not a swing special case, so the next lower-is-better
 * metric reuses this table rather than needing a second mechanism.
 *
 * ---------------------------------------------------------------------------
 * WHY TWO ACCESSORS, AND DO NOT COLLAPSE THEM INTO ONE
 * ---------------------------------------------------------------------------
 *
 * `percentiles.ts` builds its metric-name set from `Object.keys(metrics)`
 * (`withPercentiles`) and `Object.entries(metrics)` (`sortedPoolsByMetric`)
 * — an OPEN set sourced from whatever the algorithm actually emitted, not a
 * closed list derived from `componentMapForSeason`. `percentiles.ts`'s own
 * `sortedPoolsByMetric` doc comment documents that tolerance as deliberate
 * (PD-07): a metric name no team has a value for is OMITTED, never thrown
 * on, and `EmptyPoolError` exists precisely so the unreachable case is a
 * named defect signal instead of a silent zero. Today an algorithm emitting
 * a name the pipeline has never heard of degrades gracefully. A throwing
 * accessor in that pass would convert that into a hard crash during
 * `pnpm publish:seasons` — a multi-hour job the developer runs by hand,
 * which is the worst possible place to fail. So: strictness lives in CI,
 * tolerance lives in production.
 *
 * D2's "impossible for a future metric to silently default to the wrong
 * direction" is still satisfied: every name in the derived component map is
 * covered by `metricDirection.test.ts`'s coverage test, which calls the
 * STRICT accessor, so an undeclared component fails CI loudly. A genuinely
 * unknown name ranking higher-is-better in production is precisely the
 * behaviour that already ships today, not a new silent wrong this change
 * introduces.
 */
import {
  BREAKDOWN_REGISTERED_SEASONS,
  componentMapForSeason,
  COMPONENT_GROUP_METRIC_KEYS,
} from "../core/algorithms/breakdown/index.js";
import { TOTAL_METRIC_KEY } from "../core/algorithms/types.js";
import { SWING_METRIC_KEY } from "./swingFactor.js";
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
 * Built once at module load. Every registered season's component names
 * (DERIVED from `BREAKDOWN_REGISTERED_SEASONS` x `componentMapForSeason`,
 * never a hardcoded season list — a newly registered season is covered
 * automatically, the iteration-list-trap antidote this project's history
 * records) plus `TOTAL_METRIC_KEY` and `COMPONENT_GROUP_METRIC_KEYS`' three
 * values are `"higher-is-better"`. `SWING_METRIC_KEY` is the lone
 * `"lower-is-better"` entry.
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
 * THE D2 OVERRIDE. `packages/core/algorithms/sigma1/swing.ts` documents the
 * OPPOSITE framing — its user stories 1 and 2 say Alliance 1 wants the LOWER
 * swing and Alliance 8 deliberately WANTS the higher swing, making the
 * underlying quantity two-sided (a strong, wildly-swingy robot can still be
 * a good pick for an alliance chasing upside). That two-sided framing is
 * OVERRIDDEN here, for TIER purposes only, by developer decision
 * (2026-09-09): "more consistent is always always better." The tier is a
 * one-sided judgement even though the underlying quantity is arguably
 * two-sided. Do not "fix" this back to two-sided; it is a decision, not an
 * oversight.
 */
DIRECTION_BY_METRIC_NAME.set(SWING_METRIC_KEY, "lower-is-better");

/**
 * Sigma Score inherits that same D2 override, for the same reason and by the
 * same decision: the tier is one-sided ("more consistent is always better")
 * even though the underlying quantity is arguably two-sided. Registered
 * separately rather than aliased, because the two keys are independently
 * publishable — `SIGMA_SCORE_ALGORITHM_IDS` decides which appears — and a
 * future change to one direction must not silently move the other.
 */
DIRECTION_BY_METRIC_NAME.set(SIGMA_METRIC_KEY, "lower-is-better");

/**
 * STRICT accessor. Throws `UndeclaredMetricDirectionError` on an undeclared
 * name rather than defaulting. Called by the test suite's coverage
 * assertions and by `swingMetric.ts` for `SWING_METRIC_KEY` itself — that
 * name is declared by THIS module, so a throw there would mean the registry
 * lost its own entry, a defect worth crashing on rather than degrading past.
 */
export function metricDirection(metricName: string): MetricDirection {
  const direction = DIRECTION_BY_METRIC_NAME.get(metricName);
  if (direction === undefined) throw new UndeclaredMetricDirectionError(metricName);
  return direction;
}

/**
 * LENIENT accessor over the SAME table. Returns `"higher-is-better"` for an
 * undeclared name — the status-quo behaviour every unknown metric name
 * already gets today, preserved for the publish hot path
 * (`percentiles.ts`'s `withPercentiles`).
 */
export function metricDirectionOrDefault(metricName: string): MetricDirection {
  return DIRECTION_BY_METRIC_NAME.get(metricName) ?? "higher-is-better";
}

/**
 * `rawPercentile` for higher-is-better, `100 - rawPercentile` for
 * lower-is-better.
 *
 * This exact identity holds for the mid-rank convention `percentileRanks`
 * uses: reversing the sort order gives
 * `(countStrictlyAbove + 0.5*countEqual)/n*100`, which is precisely
 * `100 - p`. So an inverted percentile is a real mid-rank percentile of the
 * reversed order, not an approximation.
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
