/**
 * The Districts page's Breakdown tab (quick task 260905-lic revision R3,
 * user correction: "the district insights and breakdown tables are now for
 * district points. they are for VPR/opr/epa"). Mirrors
 * `event/BreakdownTab.tsx`'s grouped/expandable metric-columns construction
 * FAITHFULLY — pinned team-number/nickname columns, phase-group toggle
 * columns, sortable headers, the OPR flat case, and the collapse-resets-sort
 * rule — re-declared HERE rather than imported across that module's
 * boundary (this task's own instruction, matching `event/BreakdownTab.tsx`'s
 * own precedent of never importing `teams-table`'s row-typed helpers across
 * ITS module boundary either).
 *
 * The roster is the district's own team list (`DistrictArtifact.teams`,
 * algorithm-independent), joined client-side against the currently-selected
 * algorithm's teams-table artifact via `districtMetricsJoin.tsx` — see that
 * module's own header for the tier-derivation and missing-team em-dash
 * contract this tab and `DistrictInsightsTab.tsx` both share.
 *
 * The old per-team expandable-dropdown-row district-points breakdown this
 * component used to render is GONE (this task's own Decision 3) — that
 * content now lives as columns behind `DistrictLocksTab.tsx`'s own single
 * expand toggle, on BOTH Locks tabs.
 */
import { columnPinningFeature, columnSizingFeature, createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { EmptyState } from "@/components/StateViews";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TierKeyRow } from "@/components/team/TierKeyRow";
import { useIsMobile } from "@/lib/breakpoints";
import { METRIC_GROUPS, type ComponentGroupId } from "@/lib/metricGroups";
import { hasGroupedTeamsView, metricKeysFor, TOTAL_KEY } from "@/lib/metricKeys";
import { metricDisplayLabel } from "@/lib/metricLabels";
import { teamNumberFromKey } from "@/lib/teamKey";
import { componentsInGroup } from "../../../../../packages/core/algorithms/breakdown/index.js";
import type { DistrictArtifact, TeamsArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import { buildDistrictMetricsMap, DistrictMetricCell, type DistrictMetricEntry, type DistrictMetricsMap } from "./districtMetricsJoin.js";

/** The two leading, frozen columns — no rank column, matching `event/BreakdownTab.tsx`'s own D-11 (district Breakdown carries none either). */
export const DISTRICT_BREAKDOWN_PINNED_COLUMN_IDS = ["teamNumber", "nickname"] as const;

/** The narrow-viewport pinned set — `DISTRICT_BREAKDOWN_PINNED_COLUMN_IDS` minus `"nickname"`, mirroring `event/BreakdownTab.tsx`'s own `BREAKDOWN_MOBILE_PINNED_COLUMN_IDS` derivation. */
export const DISTRICT_BREAKDOWN_MOBILE_PINNED_COLUMN_IDS = DISTRICT_BREAKDOWN_PINNED_COLUMN_IDS.filter((id) => id !== "nickname");

/** One district team's Breakdown row — no `rank` field (matching event Breakdown's D-11). `found` is whether the join against the teams artifact located this team key at all. */
export interface DistrictBreakdownRow {
  teamKey: string;
  teamNumber: number;
  nickname: string;
  found: boolean;
  metrics: Readonly<Record<string, DistrictMetricEntry>>;
}

function byTeamNumberAscending(a: { teamNumber: number }, b: { teamNumber: number }): number {
  return a.teamNumber - b.teamNumber;
}

export type DistrictBreakdownSortDir = "asc" | "desc";
export interface DistrictBreakdownSort {
  readonly key: string;
  readonly dir: DistrictBreakdownSortDir;
}
/** The tab's landing sort — Total descending, matching `event/BreakdownTab.tsx`'s own `DEFAULT_BREAKDOWN_SORT`. */
export const DEFAULT_DISTRICT_BREAKDOWN_SORT: DistrictBreakdownSort = { key: TOTAL_KEY, dir: "desc" };

/** Which phase groups are expanded into their component columns — transient reading posture, never a URL param, matching event Breakdown's own `ExpandedGroups`. */
export type DistrictExpandedGroups = Readonly<Record<ComponentGroupId, boolean>>;
export const NO_DISTRICT_GROUPS_EXPANDED: DistrictExpandedGroups = { auto: false, teleop: false, endgame: false };

/** The three `teams-table/rowModel.ts` sort rules, generalized to any metric key — a row missing the sorted key sorts LAST regardless of direction, exact ties break by ascending team number. Pure; never mutates `rows`. */
export function sortDistrictBreakdownRows(rows: readonly DistrictBreakdownRow[], sort: DistrictBreakdownSort): DistrictBreakdownRow[] {
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

const EMPTY_METRICS: Readonly<Record<string, DistrictMetricEntry>> = {};

/** Maps every district roster team to a `DistrictBreakdownRow` in `DEFAULT_DISTRICT_BREAKDOWN_SORT` order. Never computes a rank (D-11's own rule, mirrored here). */
export function buildDistrictBreakdownRows(artifact: DistrictArtifact, metricsMap: DistrictMetricsMap): DistrictBreakdownRow[] {
  const unsorted: DistrictBreakdownRow[] = artifact.teams.map((team) => {
    const teamNumber = team.teamNumber ?? teamNumberFromKey(team.teamKey);
    const metrics = metricsMap.get(team.teamKey);
    return {
      teamKey: team.teamKey,
      teamNumber,
      nickname: team.nickname ?? `Team ${teamNumber}`,
      found: metrics !== undefined,
      metrics: metrics ?? EMPTY_METRICS,
    };
  });
  return sortDistrictBreakdownRows(unsorted, DEFAULT_DISTRICT_BREAKDOWN_SORT);
}

/**
 * The visible metric-column keys for one expansion state — mirrors
 * `event/BreakdownTab.tsx`'s own `visibleMetricKeys` exactly (non-grouped
 * algorithms return `metricKeysFor` unchanged; grouped algorithms return
 * `TOTAL_KEY`, then per phase either its published group key or its
 * component keys, then every ungrouped component trailing).
 */
export function visibleDistrictMetricKeys(algorithmId: string, season: number, expanded: DistrictExpandedGroups): readonly string[] {
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

/** Registered once, module-level — the same `columnSizingFeature`-alongside-`columnPinningFeature` requirement `event/BreakdownTab.tsx`'s own header comment cites. */
const features = tableFeatures({ columnPinningFeature, columnSizingFeature });
const columnHelper = createColumnHelper<typeof features, DistrictBreakdownRow>();

/** Humanized labels via the sitewide `metricDisplayLabel` derivation — one implementation, so this tab and the Teams table/event Breakdown can never disagree about what a key is called. */
export function districtMetricLabel(key: string): string {
  return metricDisplayLabel(key);
}

function cellClassName(columnId: string): string {
  return columnId === "nickname" ? "truncate text-role-body" : "numeric-cell text-role-body";
}

/** Mirrors `event/BreakdownTab.tsx`'s own `WRAPPING_HEADER_CLASS_NAME` (07-UAT.md G-7): lets a wrapped, multi-word humanized header grow the row instead of truncating. */
const WRAPPING_HEADER_CLASS_NAME = "h-auto min-h-10 py-2 align-top whitespace-normal break-words text-role-label";

/** Mirrors `event/BreakdownTab.tsx`'s own `BREAKDOWN_METRIC_COLUMN_WIDTH_PX`/`BREAKDOWN_TOTAL_COLUMN_WIDTH_PX` — the same measured per-metric-column widths, restated locally per this file's own mirror-not-import convention. */
export const DISTRICT_BREAKDOWN_METRIC_COLUMN_WIDTH_PX = 110;
export const DISTRICT_BREAKDOWN_TOTAL_COLUMN_WIDTH_PX = 118;

function metricColumnWidth(key: string): number {
  return key === TOTAL_KEY ? DISTRICT_BREAKDOWN_TOTAL_COLUMN_WIDTH_PX : DISTRICT_BREAKDOWN_METRIC_COLUMN_WIDTH_PX;
}

const TEAM_NUMBER_COLUMN_WIDTH = 88;
const NICKNAME_COLUMN_WIDTH = 220;
const TEAM_NUMBER_COLUMN_WIDTH_NARROW = 72;
const NICKNAME_COLUMN_WIDTH_NARROW = 90;

/** The Breakdown tab's column set is EXACTLY `visibleDistrictMetricKeys(algorithmId, season, expanded)` in that function's own order — never derived from a fetched row's own key order. */
function buildDistrictBreakdownColumns(algorithmId: string, season: number, isNarrow: boolean, expanded: DistrictExpandedGroups) {
  const algorithm = algorithmId as PublishedAlgorithmId;
  const metricKeys = visibleDistrictMetricKeys(algorithmId, season, expanded);

  return columnHelper.columns([
    columnHelper.accessor("teamNumber", {
      header: "Team #",
      size: isNarrow ? TEAM_NUMBER_COLUMN_WIDTH_NARROW : TEAM_NUMBER_COLUMN_WIDTH,
      cell: (info) => (
        <Link to="/team/$teamNumber" params={{ teamNumber: String(info.getValue()) }} search={{ year: season, algorithm, tab: "overview" }}>
          {info.getValue()}
        </Link>
      ),
    }),
    columnHelper.accessor("nickname", {
      header: "Team Name",
      size: isNarrow ? NICKNAME_COLUMN_WIDTH_NARROW : NICKNAME_COLUMN_WIDTH,
      cell: (info) => (
        <Link
          to="/team/$teamNumber"
          params={{ teamNumber: String(info.row.original.teamNumber) }}
          search={{ year: season, algorithm, tab: "overview" }}
          title={info.getValue()}
          className="block max-w-full truncate"
        >
          {info.getValue()}
        </Link>
      ),
    }),
    ...metricKeys.map((key) =>
      columnHelper.accessor((row) => row.metrics[key], {
        id: key,
        header: districtMetricLabel(key),
        size: metricColumnWidth(key),
        cell: (info) => <DistrictMetricCell entry={info.getValue()} found={info.row.original.found} />,
      }),
    ),
  ]);
}

export interface DistrictBreakdownTabProps {
  artifact: DistrictArtifact;
  /** The currently-selected algorithm's teams-table artifact, or `undefined` while its query is pending/disabled — see `districtMetricsJoin.tsx`'s own header. */
  teamsArtifact: TeamsArtifact | undefined;
  algorithm: PublishedAlgorithmId;
  season: number;
}

export function DistrictBreakdownTab({ artifact, teamsArtifact, algorithm, season }: DistrictBreakdownTabProps) {
  const isNarrow = useIsMobile();
  const isGrouped = hasGroupedTeamsView(algorithm);
  const [expanded, setExpanded] = useState<DistrictExpandedGroups>(NO_DISTRICT_GROUPS_EXPANDED);
  const [sort, setSort] = useState<DistrictBreakdownSort>(DEFAULT_DISTRICT_BREAKDOWN_SORT);

  const metricsMap = useMemo(() => buildDistrictMetricsMap(teamsArtifact, season), [teamsArtifact, season]);
  const rows = useMemo(() => buildDistrictBreakdownRows(artifact, metricsMap), [artifact, metricsMap]);
  const sortedRows = useMemo(() => sortDistrictBreakdownRows(rows, sort), [rows, sort]);
  const columns = useMemo(() => buildDistrictBreakdownColumns(algorithm, season, isNarrow, expanded), [algorithm, season, isNarrow, expanded]);
  const columnPinning = useMemo(
    () => ({ start: isNarrow ? [...DISTRICT_BREAKDOWN_MOBILE_PINNED_COLUMN_IDS] : [...DISTRICT_BREAKDOWN_PINNED_COLUMN_IDS], end: [] }),
    [isNarrow],
  );

  const table = useTable({ features, columns, data: sortedRows, state: { columnPinning } });

  /** Ungrouped trailing key count for the group-band row's trailing spacer — derived from the same `visibleDistrictMetricKeys` call the columns use, so the two can never disagree. */
  const ungroupedCount = useMemo(() => {
    if (!isGrouped) return 0;
    const grouped = new Set<string>(METRIC_GROUPS.flatMap((group) => [...componentsInGroup(season, group.id)]));
    return metricKeysFor(algorithm, season).filter((key) => key !== TOTAL_KEY && !grouped.has(key)).length;
  }, [isGrouped, algorithm, season]);

  function toggleGroup(groupId: ComponentGroupId) {
    const collapsing = expanded[groupId];
    // Never leave the table sorted by a column that just disappeared —
    // reset to the landing sort, mirroring event Breakdown's own rule.
    if (collapsing && componentsInGroup(season, groupId).includes(sort.key)) {
      setSort(DEFAULT_DISTRICT_BREAKDOWN_SORT);
    }
    setExpanded({ ...expanded, [groupId]: !collapsing });
  }

  function handleSortClick(key: string) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  }

  if (artifact.teams.length === 0) {
    return (
      <EmptyState
        heading={`No teams for ${artifact.displayName}`}
        body={`No district ranking data found for ${artifact.displayName}. Check back later.`}
      />
    );
  }

  const teamNumberWidth = isNarrow ? TEAM_NUMBER_COLUMN_WIDTH_NARROW : TEAM_NUMBER_COLUMN_WIDTH;
  const nicknameWidth = isNarrow ? NICKNAME_COLUMN_WIDTH_NARROW : NICKNAME_COLUMN_WIDTH;

  return (
    <div className="flex flex-col gap-[var(--spacing-md)]">
      <TierKeyRow />
      <div data-testid="district-breakdown-table-scroll" className="data-card w-fit max-w-full min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
        <table
          style={{
            tableLayout: "fixed",
            width: table.getTotalSize(),
            borderCollapse: "separate",
            borderSpacing: 0,
          }}
        >
          <TableHeader>
            {isGrouped && (
              <TableRow data-testid="district-breakdown-group-row">
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
                <TableHead
                  aria-hidden="true"
                  className="h-auto py-1"
                  style={{ width: DISTRICT_BREAKDOWN_TOTAL_COLUMN_WIDTH_PX, background: "var(--color-bg-surface)" }}
                />
                {METRIC_GROUPS.map((group) => {
                  const isExpanded = expanded[group.id];
                  const span = isExpanded ? componentsInGroup(season, group.id).length : 1;
                  return (
                    <TableHead
                      key={group.id}
                      colSpan={span}
                      className="h-auto py-1 text-center"
                      style={{ width: span * DISTRICT_BREAKDOWN_METRIC_COLUMN_WIDTH_PX, background: "var(--color-bg-surface)", zIndex: 3 }}
                    >
                      <button
                        type="button"
                        data-testid={`district-breakdown-group-toggle-${group.id}`}
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
                    style={{ width: ungroupedCount * DISTRICT_BREAKDOWN_METRIC_COLUMN_WIDTH_PX, background: "var(--color-bg-surface)" }}
                  />
                )}
              </TableRow>
            )}
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const pinned = header.column.getIsPinned();
                  const isSortable =
                    isGrouped && !DISTRICT_BREAKDOWN_PINNED_COLUMN_IDS.includes(header.column.id as (typeof DISTRICT_BREAKDOWN_PINNED_COLUMN_IDS)[number]);
                  const isActive = isSortable && header.column.id === sort.key;
                  const ariaSort = !isSortable ? undefined : isActive ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
                  return (
                    <TableHead
                      key={header.id}
                      data-testid={`district-breakdown-header-${header.column.id}`}
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
              <TableRow key={row.id} data-testid="district-breakdown-row" data-team-number={row.original.teamNumber}>
                {row.getAllCells().map((cell) => {
                  const pinned = cell.column.getIsPinned();
                  return (
                    <TableCell
                      key={cell.id}
                      data-testid={`district-breakdown-cell-${cell.column.id}`}
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
    </div>
  );
}
