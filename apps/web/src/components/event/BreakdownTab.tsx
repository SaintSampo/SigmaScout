/**
 * The Breakdown tab (EVNT-03, D-11, 07-01-PLAN.md Task 2): every declared
 * metric component per team, tier-boxed, ordered by the selected
 * algorithm's total, carrying no rank column of any kind. Pins the
 * `teamNumber`/`nickname` leading columns via
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
 * The prop contract `{ artifact, algorithmId, season }` is FROZEN by this
 * task — plans 07-11/07-12/07-13/07-14 build their own tabs against the
 * identical shape.
 */
import { columnPinningFeature, columnSizingFeature, createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { MetricValue } from "@/components/MetricValue";
import { EmptyState } from "@/components/StateViews";
import { SkeletonRows } from "@/components/Skeletons";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TierKeyRow } from "@/components/team/TierKeyRow";
import { algorithmDisplayLabel } from "@/components/ribbon/AlgorithmSelect";
import { metricKeysFor, TOTAL_KEY } from "@/lib/metricKeys";
import { teamNumberFromKey } from "@/lib/teamKey";
import { tierForPercentile } from "@/lib/tiers";
import type { EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";

type EventTeam = EventArtifact["teams"][number];
type EventTeamMetrics = EventTeam["metrics"];

/** The Breakdown tab's leading, frozen columns — two ids, not the Teams table's three, because D-11 carries no rank column to pin. */
export const BREAKDOWN_PINNED_COLUMN_IDS = ["teamNumber", "nickname"] as const;

/** One team's Breakdown row — no `rank` field exists here at all (D-11). */
export interface BreakdownRow {
  teamKey: string;
  teamNumber: number;
  nickname: string;
  metrics: EventTeamMetrics;
}

/** Ascending team-number comparator — the same deterministic total-order tie-break `teams-table/rowModel.ts`'s `byTeamNumberAscending` already uses, copied rather than imported across the module boundary. */
function byTeamNumberAscending(a: { teamNumber: number }, b: { teamNumber: number }): number {
  return a.teamNumber - b.teamNumber;
}

/**
 * `buildBreakdownRows(artifact, algorithmId)`: maps each published team to a
 * `BreakdownRow`, ordered by `TOTAL_KEY`'s value descending, with an exact
 * tie broken by ascending team number and a row missing `TOTAL_KEY`
 * sorting last regardless of direction — the same three rules
 * `teams-table/rowModel.ts`'s `buildTeamRows` already encodes. Never
 * computes or attaches a rank number (D-11).
 *
 * `teamNumber`/`nickname` are optional on `EventTeamSchema` — falls back to
 * the team key's own digits for the number and to a `Team {number}` string
 * for the nickname, never to an empty cell that would lose the row's
 * identity.
 */
export function buildBreakdownRows(artifact: EventArtifact, algorithmId: string): BreakdownRow[] {
  void algorithmId; // reserved for signature symmetry with the column builder; ordering itself is algorithm-agnostic once TOTAL_KEY is read
  const unranked: BreakdownRow[] = artifact.teams.map((team) => {
    const teamNumber = team.teamNumber ?? teamNumberFromKey(team.teamKey);
    return {
      teamKey: team.teamKey,
      teamNumber,
      nickname: team.nickname ?? `Team ${teamNumber}`,
      metrics: team.metrics,
    };
  });

  return [...unranked].sort((a, b) => {
    const totalA = a.metrics[TOTAL_KEY]?.value;
    const totalB = b.metrics[TOTAL_KEY]?.value;
    if (totalA === undefined && totalB === undefined) return byTeamNumberAscending(a, b);
    if (totalA === undefined) return 1;
    if (totalB === undefined) return -1;
    if (totalA !== totalB) return totalB - totalA;
    return byTeamNumberAscending(a, b);
  });
}

/**
 * Registered once, module-level (05-04-SUMMARY.md's v9 API note: pinning
 * offsets require `columnSizingFeature` registered alongside
 * `columnPinningFeature`, or `getStart`/`getSize` do not exist at all).
 */
const features = tableFeatures({ columnPinningFeature, columnSizingFeature });
const columnHelper = createColumnHelper<typeof features, BreakdownRow>();

function metricLabel(key: string): string {
  return key === TOTAL_KEY ? "Total" : key;
}

function cellClassName(columnId: string): string {
  return columnId === "nickname" ? "truncate text-role-body" : "numeric-cell text-role-body";
}

/**
 * The Breakdown tab's column set is EXACTLY `metricKeysFor(algorithmId,
 * season)` in that function's own order — never a Breakdown-specific list
 * and never derived from a fetched row's own key order.
 */
function buildBreakdownColumns(algorithmId: string, season: number) {
  // `algorithmId` reaching this function was already validated upstream
  // through `RootSearchSchema.algorithm` (T-05-02) before this table ever
  // rendered — the same loose-cast escape hatch `teams-table/columns.tsx`
  // already uses for a value the type system widened to plain `string`
  // crossing a component-prop boundary.
  const algorithm = algorithmId as PublishedAlgorithmId;
  const metricKeys = metricKeysFor(algorithmId, season);

  return columnHelper.columns([
    columnHelper.accessor("teamNumber", {
      header: "Team #",
      size: 88,
      cell: (info) => (
        <Link to="/team/$teamNumber" params={{ teamNumber: String(info.getValue()) }} search={{ year: season, algorithm, tab: "overview" }}>
          {info.getValue()}
        </Link>
      ),
    }),
    columnHelper.accessor("nickname", {
      header: "Nickname",
      size: 220,
      cell: (info) => (
        <Link
          to="/team/$teamNumber"
          params={{ teamNumber: String(info.row.original.teamNumber) }}
          search={{ year: season, algorithm, tab: "overview" }}
          title={info.getValue()}
          className="block max-w-full"
        >
          {info.getValue()}
        </Link>
      ),
    }),
    ...metricKeys.map((key) =>
      columnHelper.accessor((row) => row.metrics[key], {
        id: key,
        header: metricLabel(key),
        size: 120,
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
  return `Estimated per-team components — TBA publishes score breakdowns per alliance, not per team. These are ${algorithmDisplayLabel(algorithmId)}'s modeled per-team contributions.`;
}

/** The pending state's skeleton row count — a fixed placeholder guess, matching `SKELETON_ROW_COUNT`'s role in `TeamsTable.tsx`. */
const BREAKDOWN_SKELETON_ROW_COUNT = 8;

/**
 * `BreakdownTabSkeleton({ algorithmId, season })`: the real column headers
 * above `SkeletonRows`, sized by `metricKeysFor(algorithmId, season).length`
 * plus the two pinned columns — the pending state has the shape of the
 * table that is loading, never a spinner.
 */
export function BreakdownTabSkeleton({ algorithmId, season }: { algorithmId: string; season: number }) {
  const headers = ["Team #", "Nickname", ...metricKeysFor(algorithmId, season).map(metricLabel)];

  return (
    <div className="flex flex-col gap-[var(--spacing-md)]">
      <TierKeyRow />
      <div className="min-w-0 touch-pan-x overflow-x-auto overscroll-x-contain">
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
  const rows = useMemo(() => buildBreakdownRows(artifact, algorithmId), [artifact, algorithmId]);
  const columns = useMemo(() => buildBreakdownColumns(algorithmId, season), [algorithmId, season]);

  const table = useTable({
    features,
    columns,
    data: rows,
    initialState: { columnPinning: { start: [...BREAKDOWN_PINNED_COLUMN_IDS], end: [] } },
  });

  if (artifact.teams.length === 0) {
    return <EmptyState heading={`No teams for ${artifact.eventKey}`} body={`No teams found for ${artifact.eventKey}. Check back later.`} />;
  }

  return (
    <div className="flex flex-col gap-[var(--spacing-md)]">
      <TierKeyRow />
      <div data-testid="breakdown-table-scroll" className="min-w-0 touch-pan-x overflow-x-auto overscroll-x-contain">
        <table
          style={{
            // 07-UAT.md G-1: see `TeamsTable.tsx`'s identical style-object
            // comment for the full mechanism.
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
                      data-testid={`breakdown-header-${header.column.id}`}
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
                        background: pinned ? "var(--color-bg-page)" : undefined,
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
