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
 * cannot reproduce it. Both are computed where the covariance actually
 * lives (`sigma1/index.ts`'s `teamMetrics`, via `covariance.ts`'s
 * `subsetVariance`).
 *
 * As of quick task 260904-7id (D-1/D-3), EPA's pipeline ALSO publishes the
 * three groups as first-class metrics — value-only (EPA carries no spread
 * anywhere), but WITH a season-wide `percentile`/`tier` from the same
 * publish-time percentile pass every other published metric goes through
 * (`packages/harness/percentiles.ts`, generic over metric names). That tier
 * MEANS the same thing on an EPA group cell as it does anywhere else on the
 * site — a season-wide, pipeline-computed rank over the full team pool —
 * because it comes from the same place every other tier does.
 *
 * `withDerivedGroupMetrics` below still exists, but its job narrowed: it is
 * now the STALE-ARTIFACT fallback, not EPA's steady-state path. A browser
 * holding a cached pre-260904-7id EPA artifact has published components but
 * no published group entry yet — for exactly that case, this function sums
 * the group's PRESENT component values client-side and returns a value-only
 * entry: no spread, no percentile, no tier. A CLIENT-DERIVED tier is
 * deliberately never invented here, even though the arithmetic is exact:
 * the client has no season-wide pool of every OTHER team's value to rank
 * against, so any tier it assigned would be a guess rendered in the exact
 * same box a real, pipeline-computed tier uses — indistinguishable to a
 * reader, and therefore dishonest. It NEVER overwrites a published group
 * entry (a published entry — VPR's covariance-derived one, or a
 * post-260904-7id EPA one — always wins over a derived one).
 *
 * Whether the three groups sum to `total` is now ALGORITHM-DEPENDENT
 * (`breakdown/groups.ts`'s own header, D-01/D-1): VPR's `total` still spans
 * every component including `UNGROUPED_COMPONENTS` (`adjust`,
 * `foulsCommitted`), so its three groups do NOT sum to `total` there. EPA's
 * groups DO now reconcile with `total` exactly (`total` already excludes
 * `foulsCommitted`, and `adjust` is pinned at exactly 0) — but that is an
 * EPA-specific fact about EPA's OWN published numbers, not a property this
 * module's derivation creates or any surface may rely on generally. No
 * surface may present Auto+Teleop+Endgame as a reconciliation against Total
 * for every algorithm — only note it where it is actually true.
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
 * input — a published entry (VPR's own, or EPA's as of 260904-7id) always
 * wins over a derived one, spread last in the returned object. For EPA this
 * is now the stale-artifact fallback (see this module's header) rather than
 * the steady-state path.
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
