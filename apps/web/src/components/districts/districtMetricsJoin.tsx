/**
 * Shared client-side join between a district roster (`DistrictArtifact.teams`,
 * algorithm-independent) and the currently-selected algorithm's teams-table
 * artifact (`apps/web/src/lib/api/teams.ts`'s `fetchTeamsArtifact`) — quick
 * task 260905-lic revision R3 ("the district insights and breakdown tables
 * are now for VPR/opr/epa"). Both `DistrictInsightsTab.tsx` and
 * `DistrictBreakdownTab.tsx` read through this ONE module so a team's tier
 * derivation and "missing from the algorithm's roster" treatment can never
 * disagree between the two tabs — the same single-source-of-truth discipline
 * `event/InsightsTab.tsx`'s own header comment argues for `buildInsightsRows`.
 *
 * The teams-table row's own `metrics` field carries a per-metric `tier`
 * (never a `percentile` — `packages/harness/pageArtifacts.ts`'s own doc
 * comment on `TeamMetricSchema.tier`/`encodeTeamMetricEntry` states the
 * teams-table row has never published `percentile`, for payload-size
 * reasons), so the tier derivation here is `teams-table/columns.tsx`'s own
 * `tier ?? "common"` — deliberately NOT `tierForPercentile(entry?.percentile)`,
 * which the EVENT tabs use because an event artifact's per-team metric DOES
 * carry a percentile. Reading the event tabs' derivation here would silently
 * box nothing, ever, since a teams-table row's `percentile` field is always
 * absent.
 *
 * A team present in the district roster but ABSENT from the teams artifact
 * (a genuine data-join miss — the two artifacts are fetched independently,
 * and the teams artifact can still be pending, or resolve to a season whose
 * roster genuinely does not include this team key) renders every metric cell
 * as a plain em-dash, never a blank `MetricValue` box and never dropped from
 * the table — a distinguishable "this join has nothing for this row at all"
 * signal, deliberately different from `MetricValue`'s own "this ONE metric is
 * absent for an otherwise-known team" blank-cell convention.
 */
import { MetricValue } from "@/components/MetricValue";
import { withDerivedGroupMetrics, type DerivedGroupMetric } from "@/lib/metricGroups";
import type { TeamsArtifact } from "../../../../../packages/harness/pageArtifacts.js";

type TeamsRowMetricEntry = TeamsArtifact["teams"][number]["metrics"][string];

/** One district-joined team's one metric: a published teams-table entry (carries `tier`, never `percentile`), or the value-only client-derived phase entry `withDerivedGroupMetrics` produces for a stale cached artifact predating published groups. */
export type DistrictMetricEntry = TeamsRowMetricEntry | DerivedGroupMetric;

export type DistrictMetricsMap = ReadonlyMap<string, Readonly<Record<string, DistrictMetricEntry>>>;

/**
 * Builds the teamKey -> metrics lookup this module's two consumers share.
 * `undefined` (the algorithm/version manifest hasn't resolved yet, or the
 * teams-artifact query is still pending) returns an empty map — every row
 * renders as "missing from the teams artifact" until real data lands, which
 * resolves itself the moment the query settles (no fabricated interim data).
 */
export function buildDistrictMetricsMap(teamsArtifact: TeamsArtifact | undefined, season: number): DistrictMetricsMap {
  const map = new Map<string, Readonly<Record<string, DistrictMetricEntry>>>();
  if (teamsArtifact === undefined) return map;
  for (const row of teamsArtifact.teams) {
    map.set(row.teamKey, withDerivedGroupMetrics(row.metrics, season));
  }
  return map;
}

/**
 * One metric cell, joined: a plain em-dash when `found` is false (this row's
 * team has no entry anywhere in the teams artifact at all), or the ordinary
 * tiered `MetricValue` otherwise — `entry?.tier ?? "common"`, see this
 * module's own header comment for why not `tierForPercentile`.
 */
export function DistrictMetricCell({ entry, found }: { entry: DistrictMetricEntry | undefined; found: boolean }) {
  if (!found) return <span className="numeric-cell whitespace-nowrap">—</span>;
  return <MetricValue metric={entry} tier={entry?.tier ?? "common"} />;
}
