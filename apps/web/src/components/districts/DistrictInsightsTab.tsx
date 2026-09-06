/**
 * The Districts page's Insights tab (quick task 260905-lic revision R3, user
 * correction: "the district insights and breakdown tables are now for
 * district points. they are for VPR/opr/epa"). District teams in
 * DISTRICT-POINTS rank order — Rank, Team #, Team Name, District Points,
 * then the selected algorithm's Total / Auto / Teleop / Endgame, tier-boxed —
 * mirroring `event/InsightsTab.tsx`'s pinned-column/tier-box construction,
 * adapted to a district-points rank (never official/fallback ambiguous —
 * every district team carries a real `rank`) and to the client-side
 * `districtMetricsJoin.tsx` join against the currently-selected algorithm's
 * teams-table artifact rather than an event's own already-scoped roster.
 *
 * The old lean district-points summary (capacity/cut-line tiles, top-N
 * table) this tab used to render is GONE — that content is superseded by
 * this algorithm-scoped table per the user's own correction; the capacity
 * and cut-line figures still live on `DistrictLocksTab.tsx`'s own headers.
 */
import { columnPinningFeature, columnSizingFeature, createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { EmptyState } from "@/components/StateViews";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TierKeyRow } from "@/components/team/TierKeyRow";
import {
  MOBILE_PINNED_COLUMN_IDS,
  NICKNAME_COLUMN_WIDTH_NARROW_PX,
  PINNED_COLUMN_IDS,
  RANK_COLUMN_WIDTH_NARROW_PX,
  TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX,
} from "@/components/teams-table/columns";
import { useIsMobile } from "@/lib/breakpoints";
import { METRIC_GROUPS } from "@/lib/metricGroups";
import { TOTAL_KEY } from "@/lib/metricKeys";
import { teamNumberFromKey } from "@/lib/teamKey";
import type { DistrictArtifact, TeamsArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import { buildDistrictMetricsMap, DistrictMetricCell, type DistrictMetricEntry, type DistrictMetricsMap } from "./districtMetricsJoin.js";

const EMPTY_METRICS: Readonly<Record<string, DistrictMetricEntry>> = {};

function formatPoints(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** One district team's Insights row — `found` is whether the join against the teams artifact located this team key at all (see `districtMetricsJoin.tsx`'s own header for the em-dash contract that drives). */
export interface DistrictInsightsRow {
  teamKey: string;
  teamNumber: number;
  nickname: string;
  rank: number;
  pointTotal: number;
  found: boolean;
  metrics: Readonly<Record<string, DistrictMetricEntry>>;
}

/**
 * Rows in district-points rank order (`team.rank`, always defined —
 * `DistrictTeamSchema.rank` is a required positive int, unlike an event's
 * own possibly-absent official rank) — never re-derived from the joined
 * algorithm metrics, which own no rank of their own on this tab.
 */
export function buildDistrictInsightsRows(artifact: DistrictArtifact, metricsMap: DistrictMetricsMap): DistrictInsightsRow[] {
  return [...artifact.teams]
    .sort((a, b) => a.rank - b.rank)
    .map((team) => {
      const teamNumber = team.teamNumber ?? teamNumberFromKey(team.teamKey);
      const metrics = metricsMap.get(team.teamKey);
      return {
        teamKey: team.teamKey,
        teamNumber,
        nickname: team.nickname ?? `Team ${teamNumber}`,
        rank: team.rank,
        pointTotal: team.pointTotal,
        found: metrics !== undefined,
        metrics: metrics ?? EMPTY_METRICS,
      };
    });
}

/**
 * Registered once, module-level — the same `columnSizingFeature`-alongside-
 * `columnPinningFeature` requirement `event/InsightsTab.tsx`'s own header
 * comment cites (05-04-SUMMARY.md's v9 API note).
 */
const features = tableFeatures({ columnPinningFeature, columnSizingFeature });
const columnHelper = createColumnHelper<typeof features, DistrictInsightsRow>();

function cellClassName(columnId: string): string {
  return columnId === "nickname" ? "truncate text-role-body" : "numeric-cell text-role-body";
}

/**
 * The fixed five identity/points columns (Rank, Team #, Team Name, District
 * Points) plus one per `METRIC_GROUPS` entry led by Total — never derived
 * from a fetched row's own `metrics` key order, matching
 * `event/InsightsTab.tsx`'s own column-set discipline.
 */
function buildDistrictInsightsColumns(algorithmId: string, season: number, isNarrow: boolean) {
  const algorithm = algorithmId as PublishedAlgorithmId;

  const pointsColumn = columnHelper.accessor("pointTotal", {
    id: "districtPoints",
    header: "District Points",
    size: isNarrow ? 100 : 130,
    cell: (info) => <span className="numeric-cell">{formatPoints(info.getValue())}</span>,
  });

  const totalColumn = columnHelper.accessor((row) => row.metrics[TOTAL_KEY], {
    id: "total",
    header: "Total",
    size: 120,
    cell: (info) => <DistrictMetricCell entry={info.getValue()} found={info.row.original.found} />,
  });

  const metricGroupColumns = METRIC_GROUPS.map((group) =>
    columnHelper.accessor((row) => row.metrics[group.metricKey], {
      id: group.metricKey,
      header: group.label,
      size: 120,
      cell: (info) => <DistrictMetricCell entry={info.getValue()} found={info.row.original.found} />,
    }),
  );

  return columnHelper.columns([
    // "District Rank" always — this tab has no official/fallback ambiguity
    // (every district team carries a real `rank`), but the label still
    // names its provenance so a reader never mistakes it for a metric rank
    // (this task's own Decision 1: "labeled so a reader knows it is the
    // district standings rank, not a metric rank").
    columnHelper.accessor("rank", {
      id: "rank",
      header: "District Rank",
      size: isNarrow ? RANK_COLUMN_WIDTH_NARROW_PX : 96,
      cell: (info) => <span className="numeric-cell">{info.getValue()}</span>,
    }),
    columnHelper.accessor("teamNumber", {
      header: "Team #",
      size: isNarrow ? TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX : 88,
      cell: (info) => (
        <Link to="/team/$teamNumber" params={{ teamNumber: String(info.getValue()) }} search={{ year: season, algorithm, tab: "overview" }}>
          {info.getValue()}
        </Link>
      ),
    }),
    columnHelper.accessor("nickname", {
      header: "Team Name",
      size: isNarrow ? NICKNAME_COLUMN_WIDTH_NARROW_PX : 220,
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
    pointsColumn,
    totalColumn,
    ...metricGroupColumns,
  ]);
}

export interface DistrictInsightsTabProps {
  artifact: DistrictArtifact;
  /** The currently-selected algorithm's teams-table artifact, or `undefined` while its query is pending/disabled — see `districtMetricsJoin.tsx`'s own header for what `undefined` means for every row's `found` flag. */
  teamsArtifact: TeamsArtifact | undefined;
  algorithm: PublishedAlgorithmId;
  season: number;
}

export function DistrictInsightsTab({ artifact, teamsArtifact, algorithm, season }: DistrictInsightsTabProps) {
  const isNarrow = useIsMobile();

  const metricsMap = useMemo(() => buildDistrictMetricsMap(teamsArtifact, season), [teamsArtifact, season]);
  const rows = useMemo(() => buildDistrictInsightsRows(artifact, metricsMap), [artifact, metricsMap]);
  const columns = useMemo(() => buildDistrictInsightsColumns(algorithm, season, isNarrow), [algorithm, season, isNarrow]);
  const columnPinning = useMemo(
    () => ({ start: isNarrow ? [...MOBILE_PINNED_COLUMN_IDS] : [...PINNED_COLUMN_IDS], end: [] }),
    [isNarrow],
  );

  const table = useTable({ features, columns, data: rows, state: { columnPinning } });

  if (artifact.teams.length === 0) {
    return (
      <EmptyState
        heading={`No teams for ${artifact.displayName}`}
        body={`No district ranking data found for ${artifact.displayName}. Check back later.`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-[var(--spacing-md)]">
      <TierKeyRow />
      <div data-testid="district-insights-table-scroll" className="data-card w-fit max-w-full min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
        <table
          style={{
            tableLayout: "fixed",
            width: "100%",
            minWidth: table.getTotalSize(),
            borderCollapse: "separate",
            borderSpacing: 0,
          }}
        >
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const pinned = header.column.getIsPinned();
                  return (
                    <TableHead
                      key={header.id}
                      data-testid={`district-insights-header-${header.column.id}`}
                      data-pinned={pinned ? "true" : "false"}
                      className="text-role-label truncate"
                      style={{
                        width: header.getSize(),
                        position: pinned ? "sticky" : undefined,
                        left: pinned ? header.getStart("start") : undefined,
                        zIndex: pinned ? 4 : 3,
                        background: "var(--color-bg-surface)",
                      }}
                    >
                      <table.FlexRender header={header} />
                    </TableHead>
                  );
                })}
                <TableHead aria-hidden="true" style={{ padding: 0, background: "var(--color-bg-surface)" }} />
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} data-testid="district-insights-row" data-team-number={row.original.teamNumber}>
                {row.getAllCells().map((cell) => {
                  const pinned = cell.column.getIsPinned();
                  return (
                    <TableCell
                      key={cell.id}
                      data-testid={`district-insights-cell-${cell.column.id}`}
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
                <TableCell aria-hidden="true" style={{ padding: 0 }} />
              </TableRow>
            ))}
          </TableBody>
        </table>
      </div>
    </div>
  );
}
