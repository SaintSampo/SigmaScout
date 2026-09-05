/**
 * The Breakdown tab (EVNT-03, D-11, 07-01-PLAN.md Task 2; redesigned by
 * quick 260905-3rq to sketch 009 winner A): the selected algorithm's
 * per-team metric components, tier-boxed, with NO rank column of any kind.
 *
 * Post-009-A shape (grouped algorithms — VPR and EPA): the default view is
 * `Total + Auto + Teleop + Endgame + <ungrouped components>` — the three
 * phase columns are the PUBLISHED `phaseAuto`/`phaseTeleop`/`phaseEndgame`
 * metrics (value, spread AND season-wide percentile verified live on
 * `2026alhu` 2026-09-05), so the collapsed table fits desktop widths with
 * no horizontal scroll while every cell keeps a real tier. A group-band
 * header row above the column labels carries one toggle per phase;
 * expanding swaps that phase's single column for its component columns in
 * place. Expansion is plain component state — deliberately NOT a URL search
 * param (user decision, 2026-09-05): it is a transient reading posture, not
 * a shareable view.
 *
 * Sorting (sketch 009-B's idea, folded in by the same user decision): every
 * metric column header is a sort button using the Teams table's exact
 * affordance (button-in-th, `aria-sort`, accent ▲/▼ — `TeamsTable.tsx`).
 * Local state, default Total-descending; a row missing the sorted key sorts
 * last regardless of direction; exact ties break by ascending team number —
 * the same three rules `teams-table/rowModel.ts` encodes. Collapsing the
 * group that owns the active sort key resets the sort to Total-descending
 * rather than silently sorting by an invisible column.
 *
 * OPR is deliberately untouched (user decision): `hasGroupedTeamsView` is
 * false for it, and it renders the same flat single-header-row table it did
 * before this redesign — no group row, no sort buttons, Total only.
 *
 * Pins the `teamNumber`/`nickname` leading columns via
 * `@tanstack/react-table@9.1.2`'s `columnPinningFeature`+`columnSizingFeature`
 * — the same construction `teams-table/columns.tsx`/`TeamsTable.tsx` already
 * ship, registered LOCALLY here (not imported across the `teams-table`
 * module boundary) because the column helper must be typed against this
 * module's own `BreakdownRow` type.
 *
 * Deliberately does NOT reuse `TeamsTable.tsx`'s row virtualizer or its
 * `useLayoutEffect` viewport-height measurement: an event roster is 20-60
 * rows, and a viewport-filling scroller inside a tab panel would fight the
 * page's own vertical scroll (07-01-PLAN.md Decision 5).
 *
 * The prop contract `{ artifact, algorithmId, season }` is FROZEN by
 * 07-01 — plans 07-11/07-12/07-13/07-14 built their own tabs against the
 * identical shape.
 */
import { columnPinningFeature, columnSizingFeature, createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { MetricValue } from "@/components/MetricValue";
import { EmptyState } from "@/components/StateViews";
import { SkeletonRows } from "@/components/Skeletons";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TierKeyRow } from "@/components/team/TierKeyRow";
import { algorithmDisplayLabel } from "@/components/ribbon/AlgorithmSelect";
import { NICKNAME_COLUMN_WIDTH_NARROW_PX, TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX } from "@/components/teams-table/columns";
import { useIsMobile } from "@/lib/breakpoints";
import { METRIC_GROUPS, withDerivedGroupMetrics, type ComponentGroupId, type DerivedGroupMetric } from "@/lib/metricGroups";
import { hasGroupedTeamsView, metricKeysFor, TOTAL_KEY } from "@/lib/metricKeys";
import { metricDisplayLabel } from "@/lib/metricLabels";
import { teamNumberFromKey } from "@/lib/teamKey";
import { tierForPercentile } from "@/lib/tiers";
import { componentsInGroup } from "../../../../../packages/core/algorithms/breakdown/index.js";
import type { EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";

type EventTeam = EventArtifact["teams"][number];
type EventTeamMetrics = EventTeam["metrics"];

/**
 * One Breakdown cell's metric entry: a published event-team metric, or the
 * value-only client-derived phase entry `withDerivedGroupMetrics` produces
 * for a stale cached EPA artifact that predates published groups (260904-7id).
 */
export type BreakdownMetricEntry = EventTeamMetrics[string] | DerivedGroupMetric;

/** The Breakdown tab's leading, frozen columns — two ids, not the Teams table's three, because D-11 carries no rank column to pin. */
export const BREAKDOWN_PINNED_COLUMN_IDS = ["teamNumber", "nickname"] as const;

/**
 * The narrow-viewport pinned set (07-UAT.md G-2) — `BREAKDOWN_PINNED_COLUMN_IDS`
 * minus `"nickname"`, the same derivation `teams-table/columns.tsx`'s own
 * `MOBILE_PINNED_COLUMN_IDS` uses for its three-column sibling, restated
 * locally (not imported) because this module's pinned set has no `rank`
 * member to begin with — there is no shared three-element list to filter
 * from across the module boundary. Below `MOBILE_BREAKPOINT_PX`, team
 * number (FRC's canonical row identity) is the one identity column that
 * stays pinned; nickname scrolls with the data.
 */
export const BREAKDOWN_MOBILE_PINNED_COLUMN_IDS = BREAKDOWN_PINNED_COLUMN_IDS.filter((id) => id !== "nickname");

/** One team's Breakdown row — no `rank` field exists here at all (D-11). */
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
/** The tab's landing sort — Total descending, the pre-260905-3rq fixed order. */
export const DEFAULT_BREAKDOWN_SORT: BreakdownSort = { key: TOTAL_KEY, dir: "desc" };

/** Which phase groups are expanded into their component columns. Transient reading posture — never a URL param (user decision, 2026-09-05). */
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
 * attaches a rank number (D-11).
 *
 * Each row's metrics pass through `withDerivedGroupMetrics` (its published-
 * entry-always-wins merge): on current artifacts this is a no-op — VPR and
 * EPA both publish `phaseAuto`/`phaseTeleop`/`phaseEndgame` — but a browser
 * holding a cached pre-260904-7id EPA artifact gets an honest value-only
 * derived phase entry (no spread, no tier) instead of a blank phase column.
 *
 * `teamNumber`/`nickname` are optional on `EventTeamSchema` — falls back to
 * the team key's own digits for the number and to a `Team {number}` string
 * for the nickname, never to an empty cell that would lose the row's
 * identity.
 */
export function buildBreakdownRows(artifact: EventArtifact, algorithmId: string): BreakdownRow[] {
  void algorithmId; // reserved for signature symmetry with the column builder; row shape itself is algorithm-agnostic
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
 * The visible metric-column keys for one expansion state (sketch 009-A).
 *
 * Non-grouped algorithms (OPR) return `metricKeysFor` unchanged — the
 * pre-redesign flat set, per the "OPR gets no changes" decision. Grouped
 * algorithms return `TOTAL_KEY`, then per phase either its published group
 * metric key (collapsed) or its component keys in their group-declared
 * order (expanded), then every declared component belonging to no group
 * (e.g. `foulsCommitted`) trailing — the same order the sketch validated.
 */
export function visibleMetricKeys(algorithmId: string, season: number, expanded: ExpandedGroups): readonly string[] {
  const declared = metricKeysFor(algorithmId, season);
  if (!hasGroupedTeamsView(algorithmId)) return declared;
  const grouped = new Set<string>(METRIC_GROUPS.flatMap((group) => [...componentsInGroup(season, group.id)]));
  const ungrouped = declared.filter((key) => key !== TOTAL_KEY && !grouped.has(key));
  return [
    TOTAL_KEY,
    ...METRIC_GROUPS.flatMap((group) => (expanded[group.id] ? [...componentsInGroup(season, group.id)] : [group.metricKey])),
    ...ungrouped,
  ];
}

/**
 * Registered once, module-level (05-04-SUMMARY.md's v9 API note: pinning
 * offsets require `columnSizingFeature` registered alongside
 * `columnPinningFeature`, or `getStart`/`getSize` do not exist at all).
 */
const features = tableFeatures({ columnPinningFeature, columnSizingFeature });
const columnHelper = createColumnHelper<typeof features, BreakdownRow>();

/**
 * 07-UAT.md G-7: humanizes a declared component key (raw camelCase, e.g.
 * `teleopSpeakerNoteAmplified`, `hubShift1`) into space-separated Title Case
 * words (`"Teleop Speaker Note Amplified"`, `"Hub Shift 1"`). This is not
 * cosmetic — G-7's own header-wrapping fix depends on it: a bare camelCase
 * string carries NO whitespace, so `whitespace-normal` has no break
 * opportunity except mid-character (`overflow-wrap: anywhere`'s ugly
 * fallback). Inserting real spaces at camelCase/digit boundaries gives the
 * wrapped header real word-break points, at the same word boundaries a
 * reader would mentally parse the key at anyway.
 *
 * Delegates to the sitewide friendly-label derivation (2026-09-01 redesign,
 * lib/metricLabels.ts) — one implementation, so this tab and the Teams
 * table can never disagree about what a key is called (`phaseAuto` renders
 * as "Auto" through the same map). Exported (not module-private) so
 * `BreakdownTab.test.tsx` computes its own expected header strings through
 * this exact function rather than a second, independently-drifting regex.
 */
export function metricLabel(key: string): string {
  return metricDisplayLabel(key);
}

function cellClassName(columnId: string): string {
  return columnId === "nickname" ? "truncate text-role-body" : "numeric-cell text-role-body";
}

/**
 * 07-UAT.md G-7: overrides `TableHead`'s own fixed `h-10`/`whitespace-nowrap`
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
 * the single-line `truncate` treatment (07-UAT.md G-1/G-2/G-4's own 390px
 * measurements never assumed a taller header row).
 */
const WRAPPING_HEADER_CLASS_NAME = "h-auto min-h-10 py-2 align-top whitespace-normal break-words text-role-label";

/**
 * 07-UAT.md G-10: the per-metric column width, post metric-cell redesign
 * (`MetricValue.tsx`'s `.metric-spread-superscript`). Two sizes, not one:
 * `TOTAL_KEY`'s own value can run to six digits ("284.89", the real worst
 * case measured live against the deployed 2026alhu VPR artifact, 48 teams),
 * so it keeps its own, slightly wider size rather than forcing every other
 * column to carry Total's width — the same "differently-worst-case columns
 * get differently-sized floors" pattern `teams-table/columns.tsx`
 * establishes. The three phase columns (260905-3rq) share
 * `BREAKDOWN_METRIC_COLUMN_WIDTH_PX`: a phase value is a partial sum of the
 * same alliance contribution Total sums fully, so its worst case is the
 * component class's, not Total's.
 */
export const BREAKDOWN_METRIC_COLUMN_WIDTH_PX = 110;
export const BREAKDOWN_TOTAL_COLUMN_WIDTH_PX = 118;

function metricColumnWidth(key: string): number {
  return key === TOTAL_KEY ? BREAKDOWN_TOTAL_COLUMN_WIDTH_PX : BREAKDOWN_METRIC_COLUMN_WIDTH_PX;
}

/**
 * The Breakdown tab's column set is EXACTLY `visibleMetricKeys(algorithmId,
 * season, expanded)` in that function's own order — never a
 * Breakdown-specific list and never derived from a fetched row's own key
 * order.
 */
function buildBreakdownColumns(algorithmId: string, season: number, isNarrow: boolean, expanded: ExpandedGroups) {
  // `algorithmId` reaching this function was already validated upstream
  // through `RootSearchSchema.algorithm` (T-05-02) before this table ever
  // rendered — the same loose-cast escape hatch `teams-table/columns.tsx`
  // already uses for a value the type system widened to plain `string`
  // crossing a component-prop boundary.
  const algorithm = algorithmId as PublishedAlgorithmId;
  const metricKeys = visibleMetricKeys(algorithmId, season, expanded);

  return columnHelper.columns([
    columnHelper.accessor("teamNumber", {
      header: "Team #",
      // `size` (07-UAT.md G-2): 88 at/above the breakpoint (unchanged),
      // `TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX` below it — the same
      // real-geometry-derived constant `TeamsTable`/`InsightsTab` share
      // (`teams-table/columns.tsx`'s own doc comment has the derivation).
      size: isNarrow ? TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX : 88,
      cell: (info) => (
        <Link to="/team/$teamNumber" params={{ teamNumber: String(info.getValue()) }} search={{ year: season, algorithm, tab: "overview" }}>
          {info.getValue()}
        </Link>
      ),
    }),
    columnHelper.accessor("nickname", {
      // D-6 (2026-09-04, 260904-5zg): visible label only — the column id
      // stays "nickname" (pinning/data-testid/e2e selectors key off it).
      header: "Team Name",
      // 07-UAT.md G-2 part 2: 220 at/above the breakpoint (unchanged),
      // `NICKNAME_COLUMN_WIDTH_NARROW_PX` below it — the same real-geometry-
      // derived constant `TeamsTable`/`InsightsTab` share.
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
    ...metricKeys.map((key) =>
      columnHelper.accessor((row) => row.metrics[key], {
        id: key,
        header: metricLabel(key),
        size: metricColumnWidth(key),
        cell: (info) => {
          const entry = info.getValue();
          return <MetricValue metric={entry} tier={tierForPercentile(entry?.percentile)} />;
        },
      }),
    ),
  ]);
}

export interface BreakdownTabProps {
  artifact: EventArtifact;
  algorithmId: string;
  season: number;
}

/**
 * D-11's model-estimates caption — a function (not a static string) because
 * its text is built from `algorithmDisplayLabel(algorithmId)`. Wording
 * matches 07-UI-SPEC.md's Copywriting Contract row exactly.
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
 * table always lands in) plus the two pinned columns — the pending state
 * has the shape of the table that is loading, never a spinner. The group
 * toggle row is deliberately absent here: a placeholder must not offer an
 * interaction that does nothing.
 */
export function BreakdownTabSkeleton({ algorithmId, season }: { algorithmId: string; season: number }) {
  const headers = ["Team #", "Team Name", ...visibleMetricKeys(algorithmId, season, NO_GROUPS_EXPANDED).map(metricLabel)];

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
 * The Breakdown tab: `TierKeyRow` once above the table, the pinned wide
 * table itself in its own native `overflow-x-auto` scroll region, and the
 * D-11 caption once beneath it. Renders `EmptyState` (no table at all) when
 * `artifact.teams` is empty.
 */
export function BreakdownTab({ artifact, algorithmId, season }: BreakdownTabProps) {
  // 07-UAT.md G-2: same sitewide breakpoint hook `TeamsTable.tsx`/`InsightsTab.tsx` reuse.
  const isNarrow = useIsMobile();
  const isGrouped = hasGroupedTeamsView(algorithmId);
  const [expanded, setExpanded] = useState<ExpandedGroups>(NO_GROUPS_EXPANDED);
  const [sort, setSort] = useState<BreakdownSort>(DEFAULT_BREAKDOWN_SORT);

  const rows = useMemo(() => buildBreakdownRows(artifact, algorithmId), [artifact, algorithmId]);
  const sortedRows = useMemo(() => sortBreakdownRows(rows, sort), [rows, sort]);
  const columns = useMemo(() => buildBreakdownColumns(algorithmId, season, isNarrow, expanded), [algorithmId, season, isNarrow, expanded]);
  const columnPinning = useMemo(
    () => ({ start: isNarrow ? [...BREAKDOWN_MOBILE_PINNED_COLUMN_IDS] : [...BREAKDOWN_PINNED_COLUMN_IDS], end: [] }),
    [isNarrow],
  );

  const table = useTable({
    features,
    columns,
    data: sortedRows,
    state: { columnPinning },
  });

  /**
   * Ungrouped trailing key count for the group-band row's trailing spacer —
   * derived from the same `visibleMetricKeys` call the columns use, so the
   * two can never disagree about how many columns follow the last group.
   */
  const ungroupedCount = useMemo(() => {
    if (!isGrouped) return 0;
    const grouped = new Set<string>(METRIC_GROUPS.flatMap((group) => [...componentsInGroup(season, group.id)]));
    return metricKeysFor(algorithmId, season).filter((key) => key !== TOTAL_KEY && !grouped.has(key)).length;
  }, [isGrouped, algorithmId, season]);

  function toggleGroup(groupId: ComponentGroupId) {
    const collapsing = expanded[groupId];
    // Never leave the table sorted by a column that just disappeared —
    // reset to the landing sort rather than sorting by an invisible key.
    if (collapsing && componentsInGroup(season, groupId).includes(sort.key)) {
      setSort(DEFAULT_BREAKDOWN_SORT);
    }
    setExpanded({ ...expanded, [groupId]: !collapsing });
  }

  function handleSortClick(key: string) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
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
            // 07-UAT.md G-1/G-7: `tableLayout: fixed` with `width` at the
            // EXACT declared total (`table.getTotalSize()`), never `"100%"`
            // — see `TeamsTable.tsx`'s identical style-object comment for
            // the declared==actual invariant this protects. With the group
            // band as the FIRST rendered row (fixed layout reads column
            // widths from the first row's cells), every band cell below
            // carries an explicit width summed from the same
            // `metricColumnWidth` its member columns declare, so the two
            // header rows cannot disagree about geometry.
            tableLayout: "fixed",
            width: table.getTotalSize(),
            borderCollapse: "separate",
            borderSpacing: 0,
          }}
        >
          <TableHeader>
            {isGrouped && (
              <TableRow data-testid="breakdown-group-row">
                <TableHead
                  aria-hidden="true"
                  data-pinned="true"
                  className="h-auto py-1"
                  style={{ width: teamNumberWidth, position: "sticky", left: 0, zIndex: 4, background: "var(--color-bg-surface)" }}
                />
                <TableHead
                  aria-hidden="true"
                  data-pinned={isNarrow ? "false" : "true"}
                  className="h-auto py-1"
                  style={{
                    width: nicknameWidth,
                    position: isNarrow ? undefined : "sticky",
                    left: isNarrow ? undefined : teamNumberWidth,
                    zIndex: isNarrow ? 3 : 4,
                    background: "var(--color-bg-surface)",
                  }}
                />
                <TableHead aria-hidden="true" className="h-auto py-1" style={{ width: BREAKDOWN_TOTAL_COLUMN_WIDTH_PX, background: "var(--color-bg-surface)" }} />
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
                  const pinned = header.column.getIsPinned();
                  const isSortable = isGrouped && !BREAKDOWN_PINNED_COLUMN_IDS.includes(header.column.id as (typeof BREAKDOWN_PINNED_COLUMN_IDS)[number]);
                  const isActive = isSortable && header.column.id === sort.key;
                  const ariaSort = !isSortable ? undefined : isActive ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
                  return (
                    <TableHead
                      key={header.id}
                      data-testid={`breakdown-header-${header.column.id}`}
                      data-pinned={pinned ? "true" : "false"}
                      aria-sort={ariaSort}
                      className={isNarrow ? "text-role-label truncate" : WRAPPING_HEADER_CLASS_NAME}
                      style={{
                        width: header.getSize(),
                        position: pinned ? "sticky" : undefined,
                        left: pinned ? header.getStart("start") : undefined,
                        zIndex: pinned ? 4 : 3,
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
                              {sort.dir === "asc" ? "▲" : "▼"}
                            </span>
                          )}
                        </button>
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
                {row.getAllCells().map((cell) => {
                  const pinned = cell.column.getIsPinned();
                  return (
                    <TableCell
                      key={cell.id}
                      data-testid={`breakdown-cell-${cell.column.id}`}
                      data-pinned={pinned ? "true" : "false"}
                      className={cellClassName(cell.column.id)}
                      style={{
                        width: cell.column.getSize(),
                        position: pinned ? "sticky" : undefined,
                        left: pinned ? cell.column.getStart("start") : undefined,
                        zIndex: pinned ? 1 : undefined,
                        background: pinned ? "var(--color-bg-surface)" : undefined,
                      }}
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </table>
      </div>
      <p className="text-role-body text-[var(--color-text-muted)]">{BREAKDOWN_MODEL_ESTIMATES_CAPTION(algorithmId as PublishedAlgorithmId)}</p>
    </div>
  );
}
