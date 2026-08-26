import { COMPONENT_GROUP_IDS, COMPONENT_GROUP_METRIC_KEYS, type ComponentGroupId } from "../../../../packages/core/algorithms/breakdown/index.js";

/**
 * The team page's phase tiles — Auto, Teleop, Endgame — plus their display
 * labels.
 *
 * This module is deliberately thin. It does NOT compute anything: the group
 * metrics are published by the pipeline as first-class metrics
 * (`phaseAuto`/`phaseTeleop`/`phaseEndgame`), each carrying its own `value`,
 * `spread` and `percentile` exactly like `total` does.
 *
 * An earlier version summed the components in the client. That gets the
 * value right — expectation is linear — but cannot produce an honest
 * spread: a group's variance is the quadratic form of Sigma1's per-team
 * component covariance restricted to the group's indices, and the
 * off-diagonal Cov(auto_i, auto_j) terms are not published. Nor can a
 * percentile be derived, since a sum's rank is not a function of its parts'
 * ranks. Both are now computed where the covariance actually lives
 * (`sigma1/index.ts`'s `teamMetrics`, via `covariance.ts`'s
 * `subsetVariance`), and this file just names them.
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
