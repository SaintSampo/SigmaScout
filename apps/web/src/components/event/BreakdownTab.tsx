/**
 * The Breakdown tab: the selected algorithm's per-team metric components,
 * tier-boxed, with NO rank column of any kind.
 *
 * Three shapes, by algorithm (`lib/metricKeys.ts`'s `hasGroupedTeamsView`/
 * `publishesComponentMetrics`): OPR renders flat — Total only, no band row,
 * no sort buttons. SPR renders Total plus the three PUBLISHED
 * `phaseAuto`/`phaseTeleop`/`phaseEndgame` metrics (value, spread AND
 * season-wide percentile), sortable, but with no group-band row and no
 * expansion — SPR's event artifacts publish no per-team components to
 * expand a phase into (`publishesComponentMetrics` false). EPA renders
 * those same three phase columns plus any trailing ungrouped components
 * (e.g. `foulsCommitted`), with a group-band header row above the column
 * labels carrying one toggle per phase; expanding swaps that phase's single
 * column for its component columns in place. Expansion is plain component
 * state — deliberately NOT a URL search param: it is a transient reading
 * posture, not a shareable view.
 *
 * Sorting: every metric column header is a sort button using the Teams
 * table's exact affordance (button-in-th, `aria-sort`, accent ▲/▼ —
 * `TeamsTable.tsx`). Local state, default Total-descending; a row missing
 * the sorted key sorts last regardless of direction; exact ties break by
 * ascending team number — the same three rules `teams-table/rowModel.ts`
 * encodes. Collapsing the group that owns the active sort key resets the
 * sort to Total-descending rather than silently sorting by an invisible
 * column. A sort key no longer visible at all (after an in-place algorithm
 * switch, e.g. EPA to SPR) also falls back to Total-descending, the same way.
 *
 * OPR is deliberately untouched: `hasGroupedTeamsView` is false for it, and
 * it renders a flat single-header-row table — no group row, no sort
 * buttons, Total only.
 *
 * Columns are sized via `@tanstack/react-table`'s `columnSizingFeature`,
 * registered LOCALLY here (not imported across the `teams-table` module
 * boundary) because the column helper must be typed against this module's
 * own `BreakdownRow` type. The `teamNumber`/`nickname` identity columns
 * lead the column set in definition order; no column is frozen during
 * horizontal scroll.
 *
 * Deliberately does NOT reuse `TeamsTable.tsx`'s row virtualizer or its
 * `useLayoutEffect` viewport-height measurement: an event roster is 20-60
 * rows, and a viewport-filling scroller inside a tab panel would fight the
 * page's own vertical scroll.
 */
import { columnSizingFeature, createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { MetricValue } from "@/components/MetricValue";
import { TotalSigmaValue, totalColumnHeader, totalColumnWidth } from "@/components/TotalSigmaValue";
import { EmptyState } from "@/components/StateViews";
import { SkeletonRows } from "@/components/Skeletons";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TierKeyRow } from "@/components/team/TierKeyRow";
import { algorithmDisplayLabel } from "@/components/ribbon/AlgorithmSelect";
import { NICKNAME_COLUMN_WIDTH_NARROW_PX, TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX } from "@/components/teams-table/columns";
import { useIsMobile } from "@/lib/breakpoints";
import { METRIC_GROUPS, withDerivedGroupMetrics, type ComponentGroupId, type DerivedGroupMetric } from "@/lib/metricGroups";
import { hasGroupedTeamsView, metricKeysFor, publishesComponentMetrics, TOTAL_KEY } from "@/lib/metricKeys";
import { metricDisplayLabel } from "@/lib/metricLabels";
import { teamNumberFromKey } from "@/lib/teamKey";
import { resolveMetricTier, tierForPercentile } from "@/lib/tiers";
import { componentsInGroup } from "../../../../../packages/core/algorithms/breakdown/index.js";
import type { EventPageArtifact } from "../../lib/eventPricing.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import { SIGMA_METRIC_KEY } from "../../../../../packages/harness/sigmaScore.js";
import type { EventTierCuts } from "../../../../../packages/harness/pageArtifacts.js";

type EventTeam = EventPageArtifact["teams"][number];
type EventTeamMetrics = EventTeam["metrics"];

/**
 * One Breakdown cell's metric entry: a published event-team metric, or the
 * value-only client-derived phase entry `withDerivedGroupMetrics` produces
 * for a stale cached EPA artifact that predates published groups.
 */
export type BreakdownMetricEntry = EventTeamMetrics[string] | DerivedGroupMetric;

/** The Breakdown tab's two leading identity columns, in definition order — never sortable (see `isSortable` below). Two ids, not the Teams table's three, because Breakdown carries no rank column at all. */
export const BREAKDOWN_IDENTITY_COLUMN_IDS = ["teamNumber", "nickname"] as const;

/** One team's Breakdown row — no `rank` field exists here at all. */
export interface BreakdownRow {
  teamKey: string;
  teamNumber: number;
  nickname: string;
  metrics: Readonly<Record<string, BreakdownMetricEntry>>;
}

/** Ascending team-number comparator — the same deterministic total-order tie-break `teams-table/rowModel.ts`'s `byTeamNumberAscending` already uses, copied rather than imported across the module boundary. */
function byTeamNumberAscending(a: { teamNumber: number }, b: { teamNumber: number }): number {
  return a.teamNumber - b.teamNumber;
}

export type BreakdownSortDir = "asc" | "desc";
export interface BreakdownSort {
  readonly key: string;
  readonly dir: BreakdownSortDir;
}
/** The tab's landing sort — Total descending. */
export const DEFAULT_BREAKDOWN_SORT: BreakdownSort = { key: TOTAL_KEY, dir: "desc" };

/** True when expanding `groupId` would show more than the group's own column: it has at least two member components this season. */
export function groupCanExpand(season: number, groupId: ComponentGroupId): boolean {
  return componentsInGroup(season, groupId).length > 1;
}

/** Which phase groups are expanded into their component columns. Transient reading posture — never a URL param. */
export type ExpandedGroups = Readonly<Record<ComponentGroupId, boolean>>;
export const NO_GROUPS_EXPANDED: ExpandedGroups = { auto: false, teleop: false, endgame: false };

/**
 * `sortBreakdownRows(rows, sort)`: the three `teams-table/rowModel.ts` rules
 * generalized to any metric key — sort by `sort.key`'s value in `sort.dir`,
 * a row missing that key sorts LAST regardless of direction, and an exact
 * tie breaks by ascending team number. Pure; never mutates `rows`.
 */
export function sortBreakdownRows(rows: readonly BreakdownRow[], sort: BreakdownSort): BreakdownRow[] {
  return [...rows].sort((a, b) => {
    const valueA = a.metrics[sort.key]?.value;
    const valueB = b.metrics[sort.key]?.value;
    if (valueA === undefined && valueB === undefined) return byTeamNumberAscending(a, b);
    if (valueA === undefined) return 1;
    if (valueB === undefined) return -1;
    if (valueA !== valueB) return sort.dir === "desc" ? valueB - valueA : valueA - valueB;
    return byTeamNumberAscending(a, b);
  });
}

/**
 * `buildBreakdownRows(artifact, algorithmId)`: maps each published team to a
 * `BreakdownRow` in `DEFAULT_BREAKDOWN_SORT` order. Never computes or
 * attaches a rank number.
 *
 * Each row's metrics pass through `withDerivedGroupMetrics` (its published-
 * entry-always-wins merge): on current artifacts this is a no-op — SPR and
 * EPA both publish `phaseAuto`/`phaseTeleop`/`phaseEndgame` — but a browser
 * holding a cached EPA artifact that predates published groups gets an
 * honest value-only derived phase entry (no spread, no tier) instead of a
 * blank phase column.
 *
 * `teamNumber`/`nickname` are optional on `EventTeamSchema` — falls back to
 * the team key's own digits for the number and to a `Team {number}` string
 * for the nickname, never to an empty cell that would lose the row's
 * identity.
 */
export function buildBreakdownRows(artifact: EventPageArtifact, algorithmId: string): BreakdownRow[] {
  void algorithmId; // reserved for signature symmetry with the column builder
  const unranked: BreakdownRow[] = artifact.teams.map((team) => {
    const teamNumber = team.teamNumber ?? teamNumberFromKey(team.teamKey);
    return {
      teamKey: team.teamKey,
      teamNumber,
      nickname: team.nickname ?? `Team ${teamNumber}`,
      metrics: withDerivedGroupMetrics(team.metrics, artifact.season),
    };
  });
  return sortBreakdownRows(unranked, DEFAULT_BREAKDOWN_SORT);
}

/**
 * The visible metric-column keys for one expansion state — checked in this
 * order:
 *
 * 1. Non-grouped algorithms (OPR) return `metricKeysFor` unchanged — the
 *    pre-redesign flat set, per the "OPR gets no changes" decision.
 * 2. Grouped algorithms that do not publish per-team component metrics
 *    (SPR, `publishesComponentMetrics` false) return `TOTAL_KEY` followed by
 *    each group's own published metric key — always collapsed, `expanded`
 *    is never read, because there is nothing to expand into.
 * 3. Grouped algorithms that DO publish components (EPA) return `TOTAL_KEY`,
 *    then per phase either its published group metric key (collapsed) or
 *    its component keys in their group-declared order (expanded), then
 *    every declared component belonging to no group (e.g. `foulsCommitted`)
 *    trailing — the same order the sketch validated.
 */
export function visibleMetricKeys(algorithmId: string, season: number, expanded: ExpandedGroups): readonly string[] {
  const declared = metricKeysFor(algorithmId, season);
  if (!hasGroupedTeamsView(algorithmId)) return declared;
  if (!publishesComponentMetrics(algorithmId)) {
    return [TOTAL_KEY, ...METRIC_GROUPS.map((group) => group.metricKey)];
  }
  const grouped = new Set<string>(METRIC_GROUPS.flatMap((group) => [...componentsInGroup(season, group.id)]));
  const ungrouped = declared.filter((key) => key !== TOTAL_KEY && !grouped.has(key));
  return [
    TOTAL_KEY,
    ...METRIC_GROUPS.flatMap((group) => (expanded[group.id] ? [...componentsInGroup(season, group.id)] : [group.metricKey])),
    ...ungrouped,
  ];
}

/**
 * Registered once, module-level: only column sizing is registered (no
 * pinning feature — no column in this table is frozen).
 */
const features = tableFeatures({ columnSizingFeature });
const columnHelper = createColumnHelper<typeof features, BreakdownRow>();

/**
 * Humanizes a declared component key (raw camelCase, e.g.
 * `teleopSpeakerNoteAmplified`, `hubShift1`) into space-separated Title Case
 * words (`"Teleop Speaker Note Amplified"`, `"Hub Shift 1"`). This is not
 * cosmetic — the header-wrapping fix depends on it: a bare camelCase string
 * carries NO whitespace, so `whitespace-normal` has no break opportunity
 * except mid-character (`overflow-wrap: anywhere`'s ugly fallback).
 * Inserting real spaces at camelCase/digit boundaries gives the wrapped
 * header real word-break points, at the same word boundaries a reader
 * would mentally parse the key at anyway.
 *
 * Delegates to the sitewide friendly-label derivation (lib/metricLabels.ts)
 * — one implementation, so this tab and the Teams table can never disagree
 * about what a key is called (`phaseAuto` renders as "Auto" through the
 * same map). Exported (not module-private) so `BreakdownTab.test.tsx`
 * computes its own expected header strings through this exact function
 * rather than a second, independently-drifting regex.
 */
export function metricLabel(key: string): string {
  return metricDisplayLabel(key);
}

function cellClassName(columnId: string): string {
  return columnId === "nickname" ? "truncate text-role-body" : "numeric-cell text-role-body";
}

/**
 * Overrides `TableHead`'s own fixed `h-10`/`whitespace-nowrap`
 * (`ui/table.tsx`) so a wrapped, multi-word humanized label (above) can grow
 * the header row instead of truncating to an ellipsis. `twMerge` (via `cn()`
 * inside `TableHead`) resolves the conflicting height/whitespace/alignment
 * utility groups in favour of whichever class appears LAST, so this string
 * — passed as this component's own `className` prop, always after
 * `TableHead`'s base classes — wins outright, no `!important` needed.
 * Applied to every header cell in the row (not just the metric columns) so
 * "Team #"/"Nickname" sit at the same baseline as a taller wrapped
 * neighbour rather than looking vertically mismatched.
 *
 * Desktop-only (`!isNarrow`, applied at the call site below) — mobile keeps
 * the single-line `truncate` treatment.
 */
const WRAPPING_HEADER_CLASS_NAME = "h-auto min-h-10 py-2 align-top whitespace-normal break-words text-role-label";

/**
 * The per-metric column width. Two sizes, not one: `TOTAL_KEY`'s own value
 * can run to six digits ("284.89", the real worst case measured live), so
 * it keeps its own, slightly wider size rather than forcing every other
 * column to carry Total's width — the same "differently-worst-case columns
 * get differently-sized floors" pattern `teams-table/columns.tsx`
 * establishes. The three phase columns share
 * `BREAKDOWN_METRIC_COLUMN_WIDTH_PX`: a phase value is a partial sum of the
 * same alliance contribution Total sums fully, so its worst case is the
 * component class's, not Total's.
 */
export const BREAKDOWN_METRIC_COLUMN_WIDTH_PX = 110;
export const BREAKDOWN_TOTAL_COLUMN_WIDTH_PX = 118;

/**
 * Total's own width also depends on whether it renders the split pill.
 * `totalColumnWidth` (from `TotalSigmaValue.tsx`) widens Total to
 * `TOTAL_SIGMA_COLUMN_WIDTH_PX` under a Sigma-enabled algorithm and leaves
 * `BREAKDOWN_TOTAL_COLUMN_WIDTH_PX` unchanged otherwise; every other
 * component column keeps `BREAKDOWN_METRIC_COLUMN_WIDTH_PX`. Used by the
 * column definitions below AND by the group-header spacer cell and the
 * skeleton, so all three can never disagree about Total's width.
 */
function metricColumnWidth(key: string, algorithmId: string): number {
  return key === TOTAL_KEY ? totalColumnWidth(algorithmId, BREAKDOWN_TOTAL_COLUMN_WIDTH_PX) : BREAKDOWN_METRIC_COLUMN_WIDTH_PX;
}

/** Total's header reads "Total ± Sigma" under a Sigma-enabled algorithm (`TotalSigmaValue.tsx`'s `totalColumnHeader`); every other component column keeps its ordinary friendly label. */
function breakdownColumnHeader(key: string, algorithmId: string): string {
  return key === TOTAL_KEY ? totalColumnHeader(algorithmId) : metricLabel(key);
}

/**
 * The Breakdown tab's column set is EXACTLY `visibleMetricKeys(algorithmId,
 * season, expanded)` in that function's own order — never a
 * Breakdown-specific list and never derived from a fetched row's own key
 * order.
 */
function buildBreakdownColumns(algorithmId: string, season: number, isNarrow: boolean, expanded: ExpandedGroups, tierCuts: EventTierCuts | undefined) {
  // `algorithmId` reaching this function was already validated upstream
  // through `RootSearchSchema.algorithm` before this table ever rendered —
  // the same loose-cast escape hatch `teams-table/columns.tsx` already uses
  // for a value the type system widened to plain `string` crossing a
  // component-prop boundary.
  const algorithm = algorithmId as PublishedAlgorithmId;
  const metricKeys = visibleMetricKeys(algorithmId, season, expanded);

  return columnHelper.columns([
    columnHelper.accessor("teamNumber", {
      header: "Team #",
      // 88 at/above the breakpoint (unchanged), `TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX`
      // below it — the same real-geometry-derived constant `TeamsTable`/`InsightsTab`
      // share (`teams-table/columns.tsx`'s own doc comment has the derivation).
      size: isNarrow ? TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX : 88,
      cell: (info) => (
        <Link to="/team/$teamNumber" params={{ teamNumber: String(info.getValue()) }} search={{ year: season, algorithm, tab: "overview" }}>
          {info.getValue()}
        </Link>
      ),
    }),
    columnHelper.accessor("nickname", {
      // Visible label only — the column id stays "nickname"
      // (pinning/data-testid/e2e selectors key off it).
      header: "Team Name",
      // 220 at/above the breakpoint (unchanged), `NICKNAME_COLUMN_WIDTH_NARROW_PX`
      // below it — the same real-geometry-derived constant `TeamsTable`/`InsightsTab` share.
      size: isNarrow ? NICKNAME_COLUMN_WIDTH_NARROW_PX : 220,
      cell: (info) => (
        <Link
          to="/team/$teamNumber"
          params={{ teamNumber: String(info.row.original.teamNumber) }}
          search={{ year: season, algorithm, tab: "overview" }}
          title={info.getValue()}
          // `truncate`, not just `block max-w-full` — see
          // `InsightsTab.tsx`'s identical anchor for the full mechanism:
          // the cell's own ellipsis only fires on ITS OWN overflowing
          // content, and this anchor's box already fills the cell exactly,
          // so the cell never sees an overflow.
          className="block max-w-full truncate"
        >
          {info.getValue()}
        </Link>
      ),
    }),
    ...metricKeys.map((key) => {
      const isTotal = key === TOTAL_KEY;
      return columnHelper.accessor((row) => row.metrics[key], {
        id: key,
        header: breakdownColumnHeader(key, algorithmId),
        size: metricColumnWidth(key, algorithmId),
        // Only the TOTAL column renders the split pill — component columns
        // (including an expanded phase's own components) stay single
        // tier-boxed values, unchanged.
        cell: (info) => {
          const entry = info.getValue();
          if (!isTotal) {
            return <MetricValue metric={entry} tier={resolveMetricTier(entry, key, tierCuts)} />;
          }
          const sigmaEntry = info.row.original.metrics[SIGMA_METRIC_KEY];
          return (
            <TotalSigmaValue
              total={entry}
              totalTier={resolveMetricTier(entry, key, tierCuts)}
              // sigma keeps tierForPercentile alone: the merge carries its
              // percentile forward through a live tick, and no sigma cut is
              // ever published (`EventTierCutsSchema`'s own doc comment) —
              // routing it through the resolver would be a no-op at best.
              sigma={sigmaEntry !== undefined ? { value: sigmaEntry.value, tier: tierForPercentile(sigmaEntry.percentile) } : undefined}
            />
          );
        },
      });
    }),
  ]);
}

export interface BreakdownTabProps {
  artifact: EventPageArtifact;
  algorithmId: string;
  season: number;
}

/**
 * The model-estimates caption — a function (not a static string) because
 * its text is built from `algorithmDisplayLabel(algorithmId)`.
 */
export function BREAKDOWN_MODEL_ESTIMATES_CAPTION(algorithmId: PublishedAlgorithmId): string {
  return `Estimated per-team components. TBA publishes score breakdowns per alliance, not per team; these are ${algorithmDisplayLabel(algorithmId)}'s modeled per-team contributions.`;
}

/** The pending state's skeleton row count — a fixed placeholder guess, matching `SKELETON_ROW_COUNT`'s role in `TeamsTable.tsx`. */
const BREAKDOWN_SKELETON_ROW_COUNT = 8;

/**
 * `BreakdownTabSkeleton({ algorithmId, season })`: the real column headers
 * above `SkeletonRows`, sized by the COLLAPSED-default visible key set
 * (`visibleMetricKeys` with `NO_GROUPS_EXPANDED` — the state the populated
 * table always lands in) plus the two identity columns — the pending state
 * has the shape of the table that is loading, never a spinner. The group
 * toggle row is deliberately absent here: a placeholder must not offer an
 * interaction that does nothing. Under SPR this renders the same six
 * headers the populated SPR table shows, because both read
 * `visibleMetricKeys` — nothing shifts once real data lands.
 */
export function BreakdownTabSkeleton({ algorithmId, season }: { algorithmId: string; season: number }) {
  // Total's header varies by algorithm too (the same `breakdownColumnHeader`
  // the live table uses), so nothing shifts once real data lands under a
  // Sigma-enabled algorithm.
  const headers = [
    "Team #",
    "Team Name",
    ...visibleMetricKeys(algorithmId, season, NO_GROUPS_EXPANDED).map((key) => breakdownColumnHeader(key, algorithmId)),
  ];

  return (
    <div className="flex flex-col gap-[var(--spacing-md)]">
      <TierKeyRow />
      <div className="data-card w-fit max-w-full min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
          <TableHeader>
            <TableRow>
              {headers.map((label) => (
                <TableHead key={label} className="text-role-label truncate">
                  {label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            <SkeletonRows rows={BREAKDOWN_SKELETON_ROW_COUNT} columns={headers.length} />
          </TableBody>
        </table>
      </div>
    </div>
  );
}

/**
 * The Breakdown tab: `TierKeyRow` once above the table, the wide
 * table itself in its own native `overflow-x-auto` scroll region, and the
 * model-estimates caption once beneath it. Renders `EmptyState` (no table
 * at all) when `artifact.teams` is empty.
 */
export function BreakdownTab({ artifact, algorithmId, season }: BreakdownTabProps) {
  // Same sitewide breakpoint hook `TeamsTable.tsx`/`InsightsTab.tsx` reuse.
  const isNarrow = useIsMobile();
  const isGrouped = hasGroupedTeamsView(algorithmId);
  // A group with ONE member expands into a single column carrying the
  // identical number (every 2024 group, since 260910-5ym collapsed that
  // season's component map to phase granularity: `phaseAuto` 16 and `auto` 16
  // on the live artifact). Such a group gets no toggle, and a season where no
  // group can expand gets no band row at all.
  const isExpandable = publishesComponentMetrics(algorithmId) && METRIC_GROUPS.some((group) => groupCanExpand(season, group.id));
  const [expanded, setExpanded] = useState<ExpandedGroups>(NO_GROUPS_EXPANDED);
  const [sort, setSort] = useState<BreakdownSort>(DEFAULT_BREAKDOWN_SORT);

  const rows = useMemo(() => buildBreakdownRows(artifact, algorithmId), [artifact, algorithmId]);
  const visibleKeys = useMemo(() => visibleMetricKeys(algorithmId, season, expanded), [algorithmId, season, expanded]);
  // A sort key no longer visible (after an in-place algorithm switch or a
  // collapse) falls back to Total descending rather than silently sorting
  // by a column the table no longer renders.
  const activeSort = useMemo(() => (visibleKeys.includes(sort.key) ? sort : DEFAULT_BREAKDOWN_SORT), [visibleKeys, sort]);
  const sortedRows = useMemo(() => sortBreakdownRows(rows, activeSort), [rows, activeSort]);
  const columns = useMemo(
    () => buildBreakdownColumns(algorithmId, season, isNarrow, expanded, artifact.tierCuts),
    [algorithmId, season, isNarrow, expanded, artifact.tierCuts],
  );

  const table = useTable({
    features,
    columns,
    data: sortedRows,
  });

  /**
   * Ungrouped trailing key count for the group-band row's trailing spacer —
   * derived from the same `visibleMetricKeys` call the columns use, so the
   * two can never disagree about how many columns follow the last group.
   * EPA-only (`isExpandable`): 0 whenever `publishesComponentMetrics` is
   * false, since the band row itself does not render then and nothing else
   * reads this count.
   */
  const ungroupedCount = useMemo(() => {
    if (!isExpandable) return 0;
    const grouped = new Set<string>(METRIC_GROUPS.flatMap((group) => [...componentsInGroup(season, group.id)]));
    return metricKeysFor(algorithmId, season).filter((key) => key !== TOTAL_KEY && !grouped.has(key)).length;
  }, [isExpandable, algorithmId, season]);

  function toggleGroup(groupId: ComponentGroupId) {
    const collapsing = expanded[groupId];
    // Never leave the table sorted by a column that just disappeared —
    // reset to the landing sort rather than sorting by an invisible key.
    if (collapsing && componentsInGroup(season, groupId).includes(activeSort.key)) {
      setSort(DEFAULT_BREAKDOWN_SORT);
    }
    setExpanded({ ...expanded, [groupId]: !collapsing });
  }

  function handleSortClick(key: string) {
    // Computed from `activeSort`, never the raw `sort` state: after an
    // in-place algorithm switch, `sort` may still hold a key the current
    // algorithm no longer shows, and a click must read the EFFECTIVE sort
    // the table is actually displaying, not that stale value.
    setSort(activeSort.key === key ? { key, dir: activeSort.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" });
  }

  if (artifact.teams.length === 0) {
    return <EmptyState heading={`No teams for ${artifact.eventKey}`} body={`No teams found for ${artifact.eventKey}. Check back later.`} />;
  }

  const teamNumberWidth = isNarrow ? TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX : 88;
  const nicknameWidth = isNarrow ? NICKNAME_COLUMN_WIDTH_NARROW_PX : 220;

  return (
    <div className="flex flex-col gap-[var(--spacing-md)]">
      <TierKeyRow />
      <div data-testid="breakdown-table-scroll" className="data-card w-fit max-w-full min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
        <table
          style={{
            // `tableLayout: fixed` with `width` at the EXACT declared total
            // (`table.getTotalSize()`), never `"100%"` — see
            // `TeamsTable.tsx`'s identical style-object comment for the
            // declared==actual invariant this protects. The group band is
            // the FIRST rendered row (fixed layout reads column widths from
            // the first row's cells) only under EPA (`isExpandable`); under
            // OPR and SPR the column-label row is first, and its cells
            // already carry `header.getSize()` widths (below), so fixed
            // layout reads the same geometry either way. When the band DOES
            // render, every band cell carries an explicit width summed from
            // the same `metricColumnWidth` its member columns declare, so
            // the two header rows cannot disagree about geometry.
            tableLayout: "fixed",
            width: table.getTotalSize(),
            borderCollapse: "separate",
            borderSpacing: 0,
          }}
        >
          <TableHeader>
            {isExpandable && (
              <TableRow data-testid="breakdown-group-row">
                <TableHead
                  aria-hidden="true"
                  className="h-auto py-1"
                  style={{ width: teamNumberWidth, background: "var(--color-bg-surface)" }}
                />
                <TableHead
                  aria-hidden="true"
                  className="h-auto py-1"
                  style={{ width: nicknameWidth, background: "var(--color-bg-surface)" }}
                />
                <TableHead
                  aria-hidden="true"
                  className="h-auto py-1"
                  style={{ width: metricColumnWidth(TOTAL_KEY, algorithmId), background: "var(--color-bg-surface)" }}
                />
                {METRIC_GROUPS.map((group) => {
                  const isExpanded = expanded[group.id];
                  const span = isExpanded ? componentsInGroup(season, group.id).length : 1;
                  return (
                    <TableHead
                      key={group.id}
                      colSpan={span}
                      className="h-auto py-1 text-center"
                      style={{ width: span * BREAKDOWN_METRIC_COLUMN_WIDTH_PX, background: "var(--color-bg-surface)", zIndex: 3 }}
                    >
                      {groupCanExpand(season, group.id) ? (
                        <button
                          type="button"
                          data-testid={`breakdown-group-toggle-${group.id}`}
                          aria-expanded={isExpanded}
                          onClick={() => toggleGroup(group.id)}
                          className="tap-target inline-flex items-center gap-[var(--spacing-xs)] text-role-label font-semibold text-[var(--color-accent)]"
                        >
                          {group.label}
                          <span aria-hidden="true">{isExpanded ? "▾" : "▸"}</span>
                        </button>
                      ) : (
                        <span data-testid={`breakdown-group-label-${group.id}`} className="text-role-label font-semibold text-[var(--color-text-muted)]">
                          {group.label}
                        </span>
                      )}
                    </TableHead>
                  );
                })}
                {ungroupedCount > 0 && (
                  <TableHead
                    aria-hidden="true"
                    colSpan={ungroupedCount}
                    className="h-auto py-1"
                    style={{ width: ungroupedCount * BREAKDOWN_METRIC_COLUMN_WIDTH_PX, background: "var(--color-bg-surface)" }}
                  />
                )}
              </TableRow>
            )}
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const isSortable = isGrouped && !BREAKDOWN_IDENTITY_COLUMN_IDS.includes(header.column.id as (typeof BREAKDOWN_IDENTITY_COLUMN_IDS)[number]);
                  const isActive = isSortable && header.column.id === activeSort.key;
                  const ariaSort = !isSortable ? undefined : isActive ? (activeSort.dir === "asc" ? "ascending" : "descending") : "none";
                  return (
                    <TableHead
                      key={header.id}
                      data-testid={`breakdown-header-${header.column.id}`}
                      aria-sort={ariaSort}
                      className={isNarrow ? "text-role-label truncate" : WRAPPING_HEADER_CLASS_NAME}
                      style={{
                        width: header.getSize(),
                        background: "var(--color-bg-surface)",
                      }}
                    >
                      {isSortable ? (
                        // The Teams table's exact sort affordance
                        // (`TeamsTable.tsx`): button-in-th, accent ▲/▼ on
                        // the active column only.
                        <button
                          type="button"
                          className="tap-target inline-flex items-center gap-[var(--spacing-xs)] text-left"
                          onClick={() => handleSortClick(header.column.id)}
                        >
                          <table.FlexRender header={header} />
                          {isActive && (
                            <span aria-hidden="true" className="text-[var(--color-accent)]">
                              {activeSort.dir === "asc" ? "▲" : "▼"}
                            </span>
                          )}
                        </button>
                      ) : isGrouped && !isNarrow ? (
                        // Team # and Team Name get the sort button's own box
                        // (44px tall, text centered) without being a button.
                        // Bare, they sit at the top of the align-top cell
                        // while every sort label is centered in its box,
                        // about 14px lower; under SPR the label row is the
                        // table's top edge, so the offset shows. Narrow
                        // cells keep bare labels: their `truncate` needs a
                        // plain text child to ellipsize.
                        <span className="tap-target inline-flex items-center text-left">
                          <table.FlexRender header={header} />
                        </span>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} data-testid="breakdown-row" data-team-number={row.original.teamNumber}>
                {row.getAllCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    data-testid={`breakdown-cell-${cell.column.id}`}
                    className={cellClassName(cell.column.id)}
                    style={{ width: cell.column.getSize() }}
                  >
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </table>
      </div>
      <p className="text-role-body text-[var(--color-text-muted)]">{BREAKDOWN_MODEL_ESTIMATES_CAPTION(algorithmId as PublishedAlgorithmId)}</p>
    </div>
  );
}
