import {
  COMPONENT_GROUP_IDS,
  COMPONENT_GROUP_METRIC_KEYS,
  componentGroupsForSeason,
  componentsInGroup,
  type ComponentGroupId,
} from "../../../../packages/core/algorithms/breakdown/index.js";

/**
 * The team page's phase tiles — Auto, Teleop, Endgame — plus their display
 * labels.
 *
 * VPR publishes the three groups as first-class metrics
 * (`phaseAuto`/`phaseTeleop`/`phaseEndgame`), each carrying its own `value`,
 * `spread` and `percentile` exactly like `total` does. That publication
 * exists because a group's honest SPREAD is the quadratic form of VPR's
 * per-team component covariance restricted to the group's indices — the
 * off-diagonal Cov(auto_i, auto_j) terms are not published, so a client sum
 * cannot reproduce it — and an honest PERCENTILE cannot be derived either,
 * since a sum's rank is not a function of its parts' ranks. Both are
 * computed where the covariance actually lives (`sigma1/index.ts`'s
 * `teamMetrics`, via `covariance.ts`'s `subsetVariance`).
 *
 * EPA publishes no spread at all, for any metric (`packages/core/algorithms
 * /epa.ts`'s `teamMetrics`: "EPA carries a mean only, exactly as Statbotics'
 * `EPARating`"). The covariance argument above is about spread and
 * percentile specifically — it says nothing about the VALUE, which is
 * exact linear arithmetic over published component values regardless of
 * algorithm. So for an algorithm that has no spread to get wrong,
 * `withDerivedGroupMetrics` below sums the group's PRESENT component
 * values client-side and returns a value-only entry: no spread, no
 * percentile, no tier, fabricating nothing beyond exact addition of numbers
 * the artifact already published. It NEVER overwrites a published group
 * entry (VPR's honest, covariance-derived spread/percentile/tier survive
 * untouched) — published entries always win.
 *
 * The three groups do NOT sum to `total`: `UNGROUPED_COMPONENTS` (`adjust`,
 * `foulsCommitted`) sit outside all three groups by design (see
 * `groups.ts`) but still contribute to `total`. VPR's own PUBLISHED phase
 * metrics have this identical property — it is not an artifact of the
 * derivation here. No surface may present Auto+Teleop+Endgame as a
 * reconciliation against Total.
 *
 * The grouping itself is single-sourced in
 * `packages/core/algorithms/breakdown/groups.ts` — never duplicated here,
 * so the client cannot disagree with what the pipeline published.
 */
export type { ComponentGroupId };

export interface MetricGroup {
  readonly id: ComponentGroupId;
  /** The published metric key carrying this group's value/spread/percentile. */
  readonly metricKey: string;
  readonly label: string;
}

const LABELS: Readonly<Record<ComponentGroupId, string>> = {
  auto: "Auto",
  teleop: "Teleop",
  endgame: "Endgame",
};

export const METRIC_GROUPS: readonly MetricGroup[] = COMPONENT_GROUP_IDS.map((id) => ({
  id,
  metricKey: COMPONENT_GROUP_METRIC_KEYS[id],
  label: LABELS[id],
}));

/** The published metric key for one group — e.g. `"phaseAuto"`. */
export function groupMetricKey(group: ComponentGroupId): string {
  return COMPONENT_GROUP_METRIC_KEYS[group];
}

/**
 * A derived group entry — value only, deliberately not the full published
 * metric shape. See this module's header for why: EPA publishes no spread
 * anywhere, so there is nothing honest to attach beyond the exact summed
 * value. `spread`/`percentile`/`tier` are typed here (never present at
 * runtime — a real `withDerivedGroupMetrics` return value never sets them)
 * purely so a caller reading `entry.percentile` / `entry.spread` / `entry.tier`
 * off a `M | DerivedGroupMetric` union type-checks to `undefined` rather
 * than a compile error, matching every published metric shape's own optional
 * fields.
 */
export interface DerivedGroupMetric {
  readonly value: number;
  readonly spread?: undefined;
  readonly percentile?: undefined;
  readonly tier?: undefined;
}

/**
 * `withDerivedGroupMetrics(metrics, season)`: returns a new metrics record
 * carrying a value-only `phaseAuto`/`phaseTeleop`/`phaseEndgame` entry for
 * each group whose components are present in `metrics`, merged UNDER the
 * input — a published entry (VPR) always wins over a derived one, spread
 * last in the returned object.
 *
 * For each group, sums the `value` of every `componentsInGroup(season,
 * group)` key that is PRESENT in `metrics` — plain arithmetic, no rounding,
 * no rescaling. A group with ZERO present components yields NO entry at
 * all (honest absence, renders blank) — never a fabricated `{value: 0}`.
 *
 * A season with no registered grouping (`componentGroupsForSeason` returns
 * `undefined`) returns `metrics` UNCHANGED rather than throwing — this
 * function is presentation arithmetic, not a season-registry validator;
 * `metricKeysFor`'s own throw is where an unmapped season is caught.
 */
export function withDerivedGroupMetrics<M extends { readonly value: number }>(
  metrics: Readonly<Record<string, M>>,
  season: number,
): Record<string, M | DerivedGroupMetric> {
  if (componentGroupsForSeason(season) === undefined) return metrics;

  const derived: Record<string, DerivedGroupMetric> = {};
  for (const groupId of COMPONENT_GROUP_IDS) {
    const presentValues: number[] = [];
    for (const componentKey of componentsInGroup(season, groupId)) {
      const entry = metrics[componentKey];
      if (entry !== undefined) presentValues.push(entry.value);
    }
    if (presentValues.length === 0) continue;
    derived[COMPONENT_GROUP_METRIC_KEYS[groupId]] = {
      value: presentValues.reduce((sum, value) => sum + value, 0),
    };
  }
  // Published entries take precedence — spread `metrics` LAST so a real
  // `phaseAuto` (VPR) overwrites the derived placeholder, never the reverse.
  return { ...derived, ...metrics };
}
