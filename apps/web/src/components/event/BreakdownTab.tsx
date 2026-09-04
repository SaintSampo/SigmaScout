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
import { NICKNAME_COLUMN_WIDTH_NARROW_PX, TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX } from "@/components/teams-table/columns";
import { useIsMobile } from "@/lib/breakpoints";
import { metricKeysFor, TOTAL_KEY } from "@/lib/metricKeys";
import { metricDisplayLabel } from "@/lib/metricLabels";
import { teamNumberFromKey } from "@/lib/teamKey";
import { tierForPercentile } from "@/lib/tiers";
import type { EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";

type EventTeam = EventArtifact["teams"][number];
type EventTeamMetrics = EventTeam["metrics"];

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
 * Exported (not module-private) so `BreakdownTab.test.tsx` computes its own
 * expected header strings through this exact function rather than a second,
 * independently-drifting regex.
 */
export function metricLabel(key: string): string {
  // Delegates to the sitewide friendly-label derivation (2026-09-01
  // redesign, lib/metricLabels.ts) — one implementation, so this tab and
  // the Teams table can never disagree about what a key is called. The
  // export survives because `BreakdownTab.test.tsx` computes its expected
  // header strings through this exact function.
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
 * Desktop-only (`!isNarrow`, applied at the call site below) — this task's
 * own objective and every measurement in it are scoped to desktop
 * viewports; mobile keeps the EXACT pre-existing single-line `truncate`
 * treatment (07-UAT.md G-1/G-2/G-4's own 390px measurements never assumed a
 * taller header row, and nothing about G-7's desktop overflow fix needs one
 * there — mobile already accepts horizontal scrolling for this tab).
 */
const WRAPPING_HEADER_CLASS_NAME = "h-auto min-h-10 py-2 align-top whitespace-normal break-words text-role-label";

/**
 * 07-UAT.md G-10: the per-metric column width, post metric-cell redesign
 * (`MetricValue.tsx`'s `.metric-spread-superscript` — the ± glyph and spread
 * number now render smaller/grey/raised beside the value, per the
 * developer's own design direction). Two sizes, not one: the redesign only
 * meaningfully narrows a column's REAL content when the VALUE itself is a
 * small number. `TOTAL_KEY`'s own value can run to six digits ("284.89",
 * the real worst case measured live against the deployed 2026alhu VPR
 * artifact, 48 teams), so it keeps its own, slightly wider size rather than
 * forcing every other column to carry Total's width — the same
 * "differently-worst-case columns get differently-sized floors" pattern
 * `teams-table/columns.tsx`'s `RANK_COLUMN_WIDTH_NARROW_PX`/
 * `TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX`/`NICKNAME_COLUMN_WIDTH_NARROW_PX`
 * already establish.
 *
 * `BREAKDOWN_METRIC_COLUMN_WIDTH_PX` (110): the real worst-case NON-Total
 * cell measured live against the deployed 2026alhu VPR artifact —
 * `"69.80 ± 3.64"` etc. at 86.7px rendered content — plus the existing 16px
 * `TableCell` `p-2` padding (`ui/table.tsx`) and a 6px cross-browser
 * font-hinting buffer (the same small numeric-column margin
 * `RANK_COLUMN_WIDTH_NARROW_PX` uses, not the larger truncation-driven
 * margin `NICKNAME_COLUMN_WIDTH_NARROW_PX` uses — nothing rendered through
 * `MetricValue` ever truncates, so only hinting variance needs a buffer).
 *
 * `BREAKDOWN_TOTAL_COLUMN_WIDTH_PX` (118): the real worst-case Total cell,
 * same measurement and method — `"284.89 ± 8.75"` at 95.8px rendered
 * content.
 *
 * Both are DOWN from the prior uniform 120px (07-UAT.md G-7's own baseline)
 * — a real, measured width recovery from the metric-cell redesign, not a
 * cosmetic relabeling of the same number. See this table's own
 * `07-UAT.md G-10` entry for the resulting overflow reduction at 1440/1280.
 */
export const BREAKDOWN_METRIC_COLUMN_WIDTH_PX = 110;
export const BREAKDOWN_TOTAL_COLUMN_WIDTH_PX = 118;

/**
 * The Breakdown tab's column set is EXACTLY `metricKeysFor(algorithmId,
 * season)` in that function's own order — never a Breakdown-specific list
 * and never derived from a fetched row's own key order.
 */
function buildBreakdownColumns(algorithmId: string, season: number, isNarrow: boolean) {
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
      // derived constant `TeamsTable`/`InsightsTab` share (`teams-table/columns.tsx`'s
      // own doc comment has the derivation; this table clears its binding
      // constraint, TeamsTable's layout, with the most margin of the three).
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
          // so the cell never sees an overflow. The anchor's own text was
          // the thing overflowing and getting hard-clipped mid-character.
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
        size: key === TOTAL_KEY ? BREAKDOWN_TOTAL_COLUMN_WIDTH_PX : BREAKDOWN_METRIC_COLUMN_WIDTH_PX,
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
 * above `SkeletonRows`, sized by `metricKeysFor(algorithmId, season).length`
 * plus the two pinned columns — the pending state has the shape of the
 * table that is loading, never a spinner.
 */
export function BreakdownTabSkeleton({ algorithmId, season }: { algorithmId: string; season: number }) {
  const headers = ["Team #", "Team Name", ...metricKeysFor(algorithmId, season).map(metricLabel)];

  return (
    <div className="flex flex-col gap-[var(--spacing-md)]">
      <TierKeyRow />
      <div className="data-card w-fit max-w-full min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
          <TableHeader>
            <TableRow>
              {/*
                07-UAT.md G-7: the skeleton keeps the ORIGINAL single-line
                `truncate` treatment at every viewport (only the label TEXT
                is humanized, via `metricLabel` above) — it has no `isNarrow`
                input of its own (its column set is static, sized only by
                `metricKeysFor(algorithmId, season).length`, never
                viewport-aware), so it cannot reproduce the real table's
                desktop-only wrap below without inventing a second signal
                this placeholder was never built to carry. A skeleton row
                that is briefly a different height than the real table it
                precedes is the smaller, pre-existing risk class; this keeps
                it unchanged rather than adding a new geometry surface (and a
                new pinned-vs-scrolled-viewport branch) to a component no
                G-1/G-2/G-3 measurement ever covered.
              */}
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
  const rows = useMemo(() => buildBreakdownRows(artifact, algorithmId), [artifact, algorithmId]);
  const columns = useMemo(() => buildBreakdownColumns(algorithmId, season, isNarrow), [algorithmId, season, isNarrow]);
  const columnPinning = useMemo(
    () => ({ start: isNarrow ? [...BREAKDOWN_MOBILE_PINNED_COLUMN_IDS] : [...BREAKDOWN_PINNED_COLUMN_IDS], end: [] }),
    [isNarrow],
  );

  const table = useTable({
    features,
    columns,
    data: rows,
    state: { columnPinning },
  });

  if (artifact.teams.length === 0) {
    return <EmptyState heading={`No teams for ${artifact.eventKey}`} body={`No teams found for ${artifact.eventKey}. Check back later.`} />;
  }

  return (
    <div className="flex flex-col gap-[var(--spacing-md)]">
      <TierKeyRow />
      <div data-testid="breakdown-table-scroll" className="data-card w-fit max-w-full min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
        <table
          style={{
            // 07-UAT.md G-1: see `TeamsTable.tsx`'s identical style-object
            // comment for the full mechanism.
            //
            // 07-UAT.md G-7: `width` is now the EXACT declared total
            // (`table.getTotalSize()`), not `"100%"` with a `minWidth`
            // floor. G-7 widens this tab's own container (`event.$eventKey.tsx`)
            // beyond the shared `max-w-[1200px]`, which the OLD `width:
            // "100%"` would have read literally: once the container's
            // available width exceeds the declared column total, `100%`
            // stretches the table wider than that total, and `table-layout:
            // fixed` then distributes the SURPLUS across the fixed-width
            // columns — inflating every actual column width past its
            // declared `size` and silently breaking G-1's declared==actual
            // invariant on any monitor wide enough to trigger it. A literal
            // pixel `width` can never stretch past itself, so the table
            // simply left-aligns inside a wider scroller with blank space to
            // its right — cosmetically inert, and correct at every viewport
            // width, not just the two this gap was measured at.
            tableLayout: "fixed",
            width: table.getTotalSize(),
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
                      className={isNarrow ? "text-role-label truncate" : WRAPPING_HEADER_CLASS_NAME}
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
