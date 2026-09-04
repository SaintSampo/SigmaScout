/**
 * The Insights tab (EVNT-02, D-07…D-10, 07-11-PLAN.md): the event's teams in
 * TBA's official event-rank order — or, per D-08, the selected algorithm's
 * own Total order with a stated notice when no official ranking exists.
 * Nine columns: Rank, Team #, Team Name, Record, RP, Total, Auto, Teleop,
 * Endgame — Total leads the metric block (D-5, 2026-09-04).
 *
 * The first section below (Task 1) is the pure data layer — no React, no
 * TanStack anything. `buildInsightsRows` is the ONE function that returns
 * both the ordered rows and the `orderSource` discriminant driving the D-08
 * banner, deliberately NOT split into a separate `hasOfficialRanking`
 * predicate a caller could consult independently: 06.1-08's own recorded
 * lesson is that one rule expressed as two independent literals drifts apart
 * and ships a false claim. Here there is exactly one fact ("does this event
 * have an official ranking") and exactly one function that knows it.
 *
 * The second section (Task 2) is the rendered table: pinned columns via
 * `PINNED_COLUMN_IDS` imported VERBATIM from `teams-table/columns.tsx`
 * (07-RESEARCH.md Pattern 2, 07-PATTERNS.md) — never a locally re-typed
 * `["rank", "teamNumber", "nickname"]` literal — tier-boxed Auto/Teleop/
 * Endgame cells via the identical `tierForPercentile` derivation
 * `BreakdownTab.tsx` uses, a plain bare RP cell that can never wear a tier
 * (Decision 1), and the D-08 fallback banner.
 */
import { columnPinningFeature, columnSizingFeature, createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { InfoIcon } from "lucide-react";
import { MetricValue } from "@/components/MetricValue";
import { EmptyState } from "@/components/StateViews";
import { SkeletonRows } from "@/components/Skeletons";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TierKeyRow } from "@/components/team/TierKeyRow";
import { algorithmDisplayLabel } from "@/components/ribbon/AlgorithmSelect";
import {
  MOBILE_PINNED_COLUMN_IDS,
  NICKNAME_COLUMN_WIDTH_NARROW_PX,
  PINNED_COLUMN_IDS,
  RANK_COLUMN_WIDTH_NARROW_PX,
  RECORD_COLUMN_WIDTH_NARROW_PX,
  TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX,
} from "@/components/teams-table/columns";
import { useIsMobile, useIsF3MetricFirstWidth } from "@/lib/breakpoints";
import { METRIC_GROUPS, withDerivedGroupMetrics } from "@/lib/metricGroups";
import { TOTAL_KEY } from "@/lib/metricKeys";
import { teamNumberFromKey } from "@/lib/teamKey";
import { tierForPercentile } from "@/lib/tiers";
import type { EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";

type EventTeam = EventArtifact["teams"][number];
type EventTeamMetrics = EventTeam["metrics"];
type EventTeamRecord = NonNullable<EventTeam["record"]>;

export type InsightsOrderSource = "official" | "fallback";

/** One team's Insights row. `displayRank` is `undefined` for an unranked team inside an otherwise-ranked event; `record`/`rp` pass through the published artifact verbatim, never defaulted. */
export interface InsightsRow {
  teamKey: string;
  teamNumber: number;
  nickname: string;
  displayRank: number | undefined;
  record: EventTeamRecord | undefined;
  rp: number | undefined;
  metrics: EventTeamMetrics;
}

export interface InsightsRowModel {
  rows: InsightsRow[];
  orderSource: InsightsOrderSource;
}

/** Ascending team-number comparator — the same deterministic total-order tie-break `teams-table/rowModel.ts`'s `byTeamNumberAscending` and `BreakdownTab.tsx`'s own copy already use. Copied rather than imported across the module boundary, matching `BreakdownTab.tsx`'s own established precedent for this exact rule. */
function byTeamNumberAscending(a: { teamNumber: number }, b: { teamNumber: number }): number {
  return a.teamNumber - b.teamNumber;
}

interface InsightsRowBase {
  teamKey: string;
  teamNumber: number;
  nickname: string;
  rank: number | undefined;
  record: EventTeamRecord | undefined;
  rp: number | undefined;
  metrics: EventTeamMetrics;
}

/** Ascending `rank`, exact ties broken by ascending team number, an unranked row sorting last regardless of direction — a total order that never relies on the sort engine's stability. */
function byOfficialRank(a: InsightsRowBase, b: InsightsRowBase): number {
  if (a.rank === undefined && b.rank === undefined) return byTeamNumberAscending(a, b);
  if (a.rank === undefined) return 1;
  if (b.rank === undefined) return -1;
  if (a.rank !== b.rank) return a.rank - b.rank;
  return byTeamNumberAscending(a, b);
}

/** Descending `TOTAL_KEY` value, exact ties broken by ascending team number, a row missing `TOTAL_KEY` sorting last regardless of direction — the same three rules `teams-table/rowModel.ts`'s `buildTeamRows` and `BreakdownTab.tsx`'s `buildBreakdownRows` both already encode, copied here rather than imported across either module boundary. */
function byFallbackTotal(a: InsightsRowBase, b: InsightsRowBase): number {
  const totalA = a.metrics[TOTAL_KEY]?.value;
  const totalB = b.metrics[TOTAL_KEY]?.value;
  if (totalA === undefined && totalB === undefined) return byTeamNumberAscending(a, b);
  if (totalA === undefined) return 1;
  if (totalB === undefined) return -1;
  if (totalA !== totalB) return totalB - totalA;
  return byTeamNumberAscending(a, b);
}

/**
 * `buildInsightsRows(artifact, algorithmId)`: the ONE function returning
 * both the ordered rows and the `orderSource` discriminant the D-08 banner
 * and the row order both read — see this module's header doc comment for
 * why that must never be two independently-consulted facts.
 *
 * `orderSource` resolves to `"official"` when AT LEAST ONE entry in
 * `artifact.teams` carries a defined `rank` — not "every team has one": a
 * team that registered and withdrew has no ranking row inside an otherwise
 * fully-ranked event, and relabelling the whole table for that one row would
 * be wrong (this plan's Decision 3).
 */
export function buildInsightsRows(artifact: EventArtifact, algorithmId: string): InsightsRowModel {
  void algorithmId; // reserved for signature symmetry with the column builder; the fallback ordering axis (TOTAL_KEY) is algorithm-agnostic once published (D-27 guarantee)

  const orderSource: InsightsOrderSource = artifact.teams.some((team) => team.rank !== undefined) ? "official" : "fallback";

  const base: InsightsRowBase[] = artifact.teams.map((team) => {
    const teamNumber = team.teamNumber ?? teamNumberFromKey(team.teamKey);
    return {
      teamKey: team.teamKey,
      teamNumber,
      nickname: team.nickname ?? `Team ${teamNumber}`,
      rank: team.rank,
      record: team.record,
      rp: team.rp,
      // Widened with any derivable group entries this algorithm/season
      // supports (D-4, 260904-5zg) — `EventArtifactSchema` carries its own
      // `season`, so no new parameter is needed here. See
      // lib/metricGroups.ts's header for the full honesty argument.
      metrics: withDerivedGroupMetrics(team.metrics, artifact.season),
    };
  });

  const ordered = [...base].sort(orderSource === "official" ? byOfficialRank : byFallbackTotal);

  const rows: InsightsRow[] = ordered.map((row, index) => ({
    teamKey: row.teamKey,
    teamNumber: row.teamNumber,
    nickname: row.nickname,
    // Official mode: the team's own published rank (undefined for an
    // unranked team inside a ranked event). Fallback mode: the 1-based
    // position in the returned order, computed after the sort — the same
    // "compute once, never recomputed by a re-sort" discipline
    // `teams-table/rowModel.ts`'s `buildTeamRows` applies to its own `rank`.
    displayRank: orderSource === "official" ? row.rank : index + 1,
    record: row.record,
    rp: row.rp,
    metrics: row.metrics,
  }));

  return { rows, orderSource };
}

/**
 * `formatEventRecord(record)`: the three counts joined by hyphens in
 * wins-losses-ties order, or a single em-dash for an absent record. The same
 * construction `teams-table/columns.tsx`'s module-private `formatRecord`
 * uses, restated here (not imported) because that one takes a required
 * record and this one must handle absence.
 */
export function formatEventRecord(record: EventTeamRecord | undefined): string {
  if (record === undefined) return "";
  return `${record.wins}-${record.losses}-${record.ties}`;
}

/**
 * `insightsFallbackNotice(algorithmLabel)`: 07-UI-SPEC.md's Copywriting
 * Contract sentence for the D-08 row, verbatim, with the selected
 * algorithm's display label substituted in. This is the ONLY place that
 * sentence appears in source.
 */
export function insightsFallbackNotice(algorithmLabel: string): string {
  return `This event has no official TBA ranking. Teams below are ordered by ${algorithmLabel}'s rank instead.`;
}

/**
 * The decimal count the RP cell formats to (Task 2). Mirrors
 * `packages/harness/rounding.ts`'s `ROUNDING_RULE.rankingPoints` —
 * mirrored rather than imported, following `MetricValue.tsx`'s own
 * established precedent of hardcoding its two decimals with a doc comment
 * naming the authority, because `rounding.ts`'s own header states the
 * module is for building published page artifacts, not for the client.
 * This restores trailing zeros JSON serialization dropped and is never a
 * second rounding pass. A future change to `ROUNDING_RULE.rankingPoints`
 * must be mirrored here.
 */
export const INSIGHTS_RP_DECIMALS = 2;

// ---------------------------------------------------------------------------
// Task 2 — the rendered table
// ---------------------------------------------------------------------------

/**
 * Registered once, module-level (05-04-SUMMARY.md's v9 API note, restated by
 * `teams-table/columns.tsx`'s own header comment): pinning offsets require
 * `columnSizingFeature` registered alongside `columnPinningFeature`, or
 * `getStart`/`getSize` do not exist at all. The column helper below is typed
 * against THIS module's own `InsightsRow`, so it is declared locally rather
 * than imported across the `teams-table` module boundary — only
 * `PINNED_COLUMN_IDS` itself is imported from there, verbatim.
 */
const features = tableFeatures({ columnPinningFeature, columnSizingFeature });
const columnHelper = createColumnHelper<typeof features, InsightsRow>();

function cellClassName(columnId: string): string {
  return columnId === "nickname" ? "truncate text-role-body" : "numeric-cell text-role-body";
}

/**
 * The Insights tab's column set is the fixed five identity/competition
 * columns plus one per `METRIC_GROUPS` entry, in that constant's own order —
 * never derived from a fetched row's own `metrics` key order (EVNT-02
 * ordering). Column ids are chosen to match `PINNED_COLUMN_IDS` verbatim
 * (`rank`, `teamNumber`, `nickname`) rather than the constant being adapted
 * to them.
 */
function buildInsightsColumns(algorithmId: string, season: number, orderSource: InsightsOrderSource, isNarrow: boolean, metricFirst: boolean = isNarrow) {
  // `algorithmId` reaching this function was already validated upstream
  // through `RootSearchSchema.algorithm` (T-05-02) before this table ever
  // rendered — the same loose-cast escape hatch `teams-table/columns.tsx`
  // already uses for a value the type system widened to plain `string`
  // crossing a component-prop boundary.
  const algorithm = algorithmId as PublishedAlgorithmId;
  const rankHeader = orderSource === "official" ? "Rank" : `${algorithmDisplayLabel(algorithm)} Rank`;

  const recordColumn = columnHelper.accessor("record", {
    header: "Record",
    // 07-UAT.md G-11: 100 at/above the breakpoint (unchanged),
    // `RECORD_COLUMN_WIDTH_NARROW_PX` below it — see that constant's own
    // doc comment in `teams-table/columns.tsx` for the real-geometry
    // derivation. Narrow-mode POSITION is decided at the assembly below
    // (ui-polish F3), width alone is decided here.
    size: isNarrow ? RECORD_COLUMN_WIDTH_NARROW_PX : 100,
    cell: (info) => <span className="numeric-cell">{formatEventRecord(info.getValue())}</span>,
  });

  // RP: a plain numeric-cell span, NEVER MetricValue and NEVER a tier
  // class under any input (this plan's Decision 1). `rp` is TBA's own raw
  // competition statistic — no percentile exists for it, and none could
  // honestly be derived from an event's own visible roster
  // (`TeamMetricSchema.percentile`'s own season-pool-only definition).
  // An explicit `undefined` comparison distinguishes a real `0` from
  // absence, the same discipline the Rank cell applies.
  const rpColumn = columnHelper.accessor("rp", {
    id: "rp",
    header: "RP",
    size: 84,
    cell: (info) => {
      const value = info.getValue();
      return <span className="numeric-cell">{value === undefined ? "" : value.toFixed(INSIGHTS_RP_DECIMALS)}</span>;
    },
  });

  // Total (2026-09-01, user request; reordered 2026-09-04 D-5, 260904-5zg):
  // the selected algorithm's own headline value, tiered exactly like the
  // group columns, placed FIRST among the metric columns — which under
  // F3's narrow ordering makes Total the value that clears the 390px fold.
  // `metricGroupColumns` below now actually leads with this column (it used
  // to append it last while this comment claimed otherwise — D-5 resolves
  // that disagreement in the direction this comment and Task 1's
  // `metricKeysFor`/Teams-table ordering already established).
  const totalColumn = columnHelper.accessor((row) => row.metrics[TOTAL_KEY], {
    id: "total",
    header: "Total",
    size: 120,
    cell: (info) => {
      const entry = info.getValue();
      return <MetricValue metric={entry} tier={tierForPercentile(entry?.percentile)} />;
    },
  });

  const metricGroupColumns = [totalColumn, ...METRIC_GROUPS.map((group) =>
    columnHelper.accessor((row) => row.metrics[group.metricKey], {
      id: group.metricKey,
      header: group.label,
      size: 120,
      // The identical `tierForPercentile(metric?.percentile)` derivation
      // `BreakdownTab.tsx` uses — one derivation path, so an Insights tier
      // and a Breakdown tier for the same team/metric/season can never
      // disagree (D-09). Tiered unconditionally, including this sorted
      // column: D-09 knowingly accepts the redundancy of adjacent rows
      // sharing a tier in exchange for one rule and more colour.
      cell: (info) => {
        const entry = info.getValue();
        return <MetricValue metric={entry} tier={tierForPercentile(entry?.percentile)} />;
      },
    }),
  )];

  return columnHelper.columns([
    // D-08/T-07-11-02: in fallback mode the header itself names the
    // algorithm whose ordering it is showing — a model-derived ordinal must
    // never sit under a bare "Rank" header a reader parses as official.
    // `size` (07-UAT.md G-2, revised by 07-UI-REVIEW priority fix 1): the
    // plain "Rank" label keeps 72 at/above the breakpoint and
    // `RANK_COLUMN_WIDTH_NARROW_PX` below it, but the longer fallback
    // header ("VPR Rank") was MEASURED clipping live inside 72px on D-08
    // fallback events (259/1,581 of the corpus) — rendering `VPR Ra…` on
    // the one state whose whole point is naming the ranking source. In
    // fallback mode this column budgets 96px at every width, matching what
    // the Teams page's own Rank column already budgets for the same label
    // shape. A readable source-naming header outranks the narrow-width
    // budget on exactly these events.
    columnHelper.accessor((row) => row.displayRank, {
      id: "rank",
      header: rankHeader,
      size: orderSource === "official" ? (isNarrow ? RANK_COLUMN_WIDTH_NARROW_PX : 72) : 96,
      cell: (info) => {
        const value = info.getValue();
        return <span className="numeric-cell">{value === undefined ? "" : value}</span>;
      },
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
      // D-6 (2026-09-04, 260904-5zg): visible label only — the column id
      // stays "nickname" (pinning/data-testid/e2e selectors key off it).
      header: "Team Name",
      // 07-UAT.md G-2 part 2 ("first-paint half"): 220 at/above the
      // breakpoint (unchanged), `NICKNAME_COLUMN_WIDTH_NARROW_PX` below it —
      // see that constant's own doc comment in `teams-table/columns.tsx` for
      // the real-geometry derivation shared with `TeamsTable`/`BreakdownTab`.
      size: isNarrow ? NICKNAME_COLUMN_WIDTH_NARROW_PX : 220,
      cell: (info) => (
        <Link
          to="/team/$teamNumber"
          params={{ teamNumber: String(info.row.original.teamNumber) }}
          search={{ year: season, algorithm, tab: "overview" }}
          title={info.getValue()}
          // `truncate` (not just `block max-w-full`): the CELL's own
          // `overflow:hidden`/`text-overflow:ellipsis` (`cellClassName`
          // below) only ever applies to content that overflows the CELL
          // itself. This anchor's box already fills the cell's content
          // width exactly (block, auto width) — nothing overflows the
          // anchor's OWN box at the box-model level, so the cell never sees
          // an overflow to ellipsize. What actually overflows is the
          // anchor's inline text content spilling past its own border box
          // (`white-space:nowrap` + no `overflow`/`text-overflow` of its
          // own), which the cell then hard-clips at the pixel level with no
          // ellipsis glyph at all — measured live at 390px on real
          // nicknames ("The Bucks' Wrath" rendered as "The Bucks' \"", cut
          // mid-character). `truncate` must sit on the element that is
          // itself the overflowing box, not merely its ancestor.
          className="block max-w-full truncate"
        >
          {info.getValue()}
        </Link>
      ),
    }),
    // ui-polish F3 (2026-08-31, 07-UI-REVIEW priority fix 3): below the
    // breakpoint the FIRST metric column leads this trailing block, so a
    // tiered, percentile-carrying value is on the first screenful — the
    // product's differentiator, not just TBA's Record/RP facts. Record and
    // RP sit directly behind it, then the remaining metric columns. At/above
    // the breakpoint the order is unchanged (record, rp, metrics). Since
    // D-5 (260904-5zg) `metricGroupColumns` now leads with `totalColumn`,
    // this slice leads with Total — matching the Teams table's own narrow
    // lead (`columns.tsx`'s `leadMetricIndex`, always Total since D-5).
    ...(metricFirst ? metricGroupColumns.slice(0, 1) : []),
    recordColumn,
    rpColumn,
    ...(metricFirst ? metricGroupColumns.slice(1) : metricGroupColumns),
  ]);
}

export interface InsightsTabProps {
  artifact: EventArtifact;
  algorithmId: string;
  season: number;
}

/** The pending state's skeleton row count — matching `BREAKDOWN_SKELETON_ROW_COUNT`'s role in `BreakdownTab.tsx`. */
export const INSIGHTS_SKELETON_ROW_COUNT = 8;

/**
 * `InsightsTabSkeleton({ algorithmId, season })`: the eight real column
 * headers above `SkeletonRows` — always with the BARE `Rank` header, never
 * the fallback-labelled one. Before the artifact resolves there is no way to
 * know whether D-08's fallback applies, and flashing the algorithm-labelled
 * header only to replace it a moment later would assert a provenance claim
 * the page cannot yet support.
 */
export function InsightsTabSkeleton({ algorithmId, season }: { algorithmId: string; season: number }) {
  void algorithmId; // the skeleton's header set does not vary by algorithm — see the doc comment above for why orderSource is fixed to "official" here
  void season;
  // D-5 (260904-5zg): Total leads the metric block, matching the live
  // table's own `metricGroupColumns` order — never a re-typed literal that
  // could drift from it.
  const headers = ["Rank", "Team #", "Team Name", "Record", "RP", "Total", ...METRIC_GROUPS.map((group) => group.label)];

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
            <SkeletonRows rows={INSIGHTS_SKELETON_ROW_COUNT} columns={headers.length} />
          </TableBody>
        </table>
      </div>
    </div>
  );
}

/**
 * The Insights tab: `TierKeyRow` once, the D-08 banner when (and only when)
 * `orderSource` is `"fallback"`, then the pinned wide table in its own
 * native `overflow-x-auto` scroll region — a DOM SIBLING of the tab strip's
 * own scroll region, never its ancestor or descendant. Renders `EmptyState`
 * (no table at all) when `artifact.teams` is empty.
 *
 * Every string that originates in the published artifact — nickname, event
 * name, event key — renders as a plain JSX text node or a `title` attribute
 * value, never through a raw-markup sink (T-07-11-01).
 */
export function InsightsTab({ artifact, algorithmId, season }: InsightsTabProps) {
  // 07-UAT.md G-2: same sitewide breakpoint hook `TeamsTable.tsx` reuses —
  // see that component's own doc comment for why (one "mobile" definition
  // for the whole page, live on resize/rotation via `matchMedia`'s `change`
  // event).
  const isNarrow = useIsMobile();
  const isF3Width = useIsF3MetricFirstWidth();
  const { rows, orderSource } = useMemo(() => buildInsightsRows(artifact, algorithmId), [artifact, algorithmId]);
  const columns = useMemo(
    () => buildInsightsColumns(algorithmId, season, orderSource, isNarrow),
    [algorithmId, season, orderSource, isNarrow],
  );
  const columnPinning = useMemo(
    () => ({ start: isNarrow ? [...MOBILE_PINNED_COLUMN_IDS] : [...PINNED_COLUMN_IDS], end: [] }),
    [isNarrow],
  );

  const table = useTable({
    features,
    columns,
    data: rows,
    state: { columnPinning },
  });

  if (artifact.teams.length === 0) {
    const eventName = artifact.name ?? artifact.eventKey;
    return <EmptyState heading={`No teams for ${eventName}`} body={`No teams found for ${eventName}. Check back later.`} />;
  }

  return (
    <div className="flex flex-col gap-[var(--spacing-md)]">
      <TierKeyRow />
      {orderSource === "fallback" && (
        <div
          data-testid="insights-fallback-banner"
          className="flex items-center gap-[var(--spacing-sm)] rounded-[var(--radius)] bg-[var(--color-bg-inset)] px-[var(--spacing-md)] py-[var(--spacing-sm)] text-role-body text-[var(--color-text-muted)]"
        >
          <InfoIcon aria-hidden="true" className="size-4 shrink-0" />
          <span>{insightsFallbackNotice(algorithmDisplayLabel(algorithmId as PublishedAlgorithmId))}</span>
        </div>
      )}
      <div data-testid="insights-table-scroll" className="data-card w-fit max-w-full min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
        <table
          style={{
            // 07-UAT.md G-1: see `TeamsTable.tsx`'s identical style-object
            // comment for the full mechanism — `auto` let the browser
            // resize columns past their declared `size`, desyncing every
            // pinned column's sticky `left` from where its neighbour
            // actually rendered (measured live: nickname 220→348px).
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
                      data-testid={`insights-header-${header.column.id}`}
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
                {/*
                  Trailing sizeless filler, matching `TeamsTable.tsx`'s own
                  reasoning: slack absorbed here rather than redistributed
                  across real columns, which would desync the pinned
                  offsets (`getStart("start")` is derived from column
                  sizes). Hidden from assistive tech — it carries no data.
                */}
                <TableHead aria-hidden="true" style={{ padding: 0, background: "var(--color-bg-surface)" }} />
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} data-testid="insights-row" data-team-number={row.original.teamNumber}>
                {row.getAllCells().map((cell) => {
                  const pinned = cell.column.getIsPinned();
                  return (
                    <TableCell
                      key={cell.id}
                      data-testid={`insights-cell-${cell.column.id}`}
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
                {/* Matches the header's trailing filler — see the note there. */}
                <TableCell aria-hidden="true" style={{ padding: 0 }} />
              </TableRow>
            ))}
          </TableBody>
        </table>
      </div>
    </div>
  );
}
