/**
 * The event Teams tab: the event's teams in TBA's official event-rank order —
 * or, when no official ranking exists, the selected algorithm's own Total
 * order with a stated notice. Nine columns: Rank, Team #, Team Name,
 * Record, RP, Total, Auto, Teleop, Endgame — Total leads the metric block.
 *
 * The first section below is the pure data layer — no React, no TanStack
 * anything. `buildTeamsRows` is the ONE function that returns both the
 * ordered rows and the `orderSource` discriminant driving the fallback
 * banner, deliberately NOT split into a separate `hasOfficialRanking`
 * predicate a caller could consult independently: one rule expressed as
 * two independent literals drifts apart and ships a false claim. Here
 * there is exactly one fact ("does this event have an official ranking")
 * and exactly one function that knows it.
 *
 * The second section is the rendered table: the identity columns (rank,
 * teamNumber, nickname) simply lead the column set in definition order —
 * tier-boxed Auto/Teleop/Endgame cells via the identical
 * `tierForPercentile` derivation the Teams list table uses, a plain bare RP
 * cell that can never wear a tier, and the fallback banner. No column in
 * this table is frozen during horizontal scroll.
 *
 * Sorting (quick task 261024-jvv): the Rank, RP, Total, Auto, Teleop and
 * Endgame headers are buttons that re-sort the rows; Team #, Team Name and
 * Record do not sort. The sort is local component state by decision, never a
 * URL search param, because it is a transient reading posture and not a
 * shareable view. `null` means the `buildTeamsRows` order, so the default
 * order, whether official rank or the fallback Total order, is untouched.
 * The first click on a column applies its natural direction (Rank ascending,
 * RP and every metric descending) and a click on the active column toggles
 * it. A row missing the sorted value sorts last in both directions, and an
 * exact tie breaks by ascending team number. A sort whose column is not
 * among the visible sortable ids falls back to the default order in place. A
 * re-sort never recomputes `displayRank`, so every Rank cell keeps its
 * official or fallback number under any sort.
 */
import { columnSizingFeature, createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { InfoIcon } from "lucide-react";
import { MetricValue } from "@/components/MetricValue";
import { TotalSigmaValue, totalColumnHeader, totalColumnWidth } from "@/components/TotalSigmaValue";
import { EmptyState } from "@/components/StateViews";
import { SkeletonRows } from "@/components/Skeletons";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TierKeyRow } from "@/components/team/TierKeyRow";
import { algorithmDisplayLabel } from "@/components/ribbon/AlgorithmSelect";
import {
  NICKNAME_COLUMN_WIDTH_NARROW_PX,
  RANK_COLUMN_WIDTH_NARROW_PX,
  RECORD_COLUMN_WIDTH_NARROW_PX,
  TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX,
} from "@/components/teams-table/columns";
import { useIsMobile, useIsF3MetricFirstWidth } from "@/lib/breakpoints";
import { METRIC_GROUPS, withDerivedGroupMetrics } from "@/lib/metricGroups";
import { TOTAL_KEY } from "@/lib/metricKeys";
import { teamNumberFromKey } from "@/lib/teamKey";
import { resolveMetricTier, tierForPercentile } from "@/lib/tiers";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import { SIGMA_METRIC_KEY } from "../../../../../packages/harness/sigmaScore.js";
import type { EventArtifact, SeasonTierCuts } from "../../../../../packages/harness/pageArtifacts.js";

type EventTeam = EventArtifact["teams"][number];
type EventTeamMetrics = EventTeam["metrics"];
type EventTeamRecord = NonNullable<EventTeam["record"]>;

export type TeamsOrderSource = "official" | "fallback" | "live";

/** One team's Teams row. `displayRank` is `undefined` for an unranked team inside an otherwise-ranked event; `record`/`rp` pass through the published artifact verbatim, never defaulted. */
export interface TeamsRow {
  teamKey: string;
  teamNumber: number;
  nickname: string;
  displayRank: number | undefined;
  record: EventTeamRecord | undefined;
  rp: number | undefined;
  metrics: EventTeamMetrics;
}

export interface TeamsRowModel {
  rows: TeamsRow[];
  orderSource: TeamsOrderSource;
}

/** Ascending team-number comparator — the same deterministic total-order tie-break `teams-table/rowModel.ts`'s `byTeamNumberAscending` already uses. Copied rather than imported across the module boundary. */
function byTeamNumberAscending(a: { teamNumber: number }, b: { teamNumber: number }): number {
  return a.teamNumber - b.teamNumber;
}

interface TeamsRowBase {
  teamKey: string;
  teamNumber: number;
  nickname: string;
  rank: number | undefined;
  record: EventTeamRecord | undefined;
  rp: number | undefined;
  metrics: EventTeamMetrics;
}

/** Ascending `rank`, exact ties broken by ascending team number, an unranked row sorting last regardless of direction — a total order that never relies on the sort engine's stability. */
function byOfficialRank(a: TeamsRowBase, b: TeamsRowBase): number {
  if (a.rank === undefined && b.rank === undefined) return byTeamNumberAscending(a, b);
  if (a.rank === undefined) return 1;
  if (b.rank === undefined) return -1;
  if (a.rank !== b.rank) return a.rank - b.rank;
  return byTeamNumberAscending(a, b);
}

/** Descending `TOTAL_KEY` value, exact ties broken by ascending team number, a row missing `TOTAL_KEY` sorting last regardless of direction — the same three rules `teams-table/rowModel.ts`'s `buildTeamRows` already encodes, copied here rather than imported across the module boundary. */
function byFallbackTotal(a: TeamsRowBase, b: TeamsRowBase): number {
  const totalA = a.metrics[TOTAL_KEY]?.value;
  const totalB = b.metrics[TOTAL_KEY]?.value;
  if (totalA === undefined && totalB === undefined) return byTeamNumberAscending(a, b);
  if (totalA === undefined) return 1;
  if (totalB === undefined) return -1;
  if (totalA !== totalB) return totalB - totalA;
  return byTeamNumberAscending(a, b);
}

/**
 * `buildTeamsRows(artifact, algorithmId)`: the ONE function returning
 * both the ordered rows and the `orderSource` discriminant the fallback
 * banner and the row order both read — see this module's header doc
 * comment for why that must never be two independently-consulted facts.
 *
 * `orderSource` resolves to `"live"` when the artifact's published
 * `standings` marker (`EventArtifactSchema.standings`) is present and
 * ranked — a ranked marker means every row's rank/rp/record was COUNTED by
 * the live tick from played qualification rows rather than taken from TBA's
 * published rank, and "live" behaves exactly like `"official"` for both the
 * row comparator and `displayRank` below. Until quick task 260923-3w7 that
 * same marker was attached in the browser by a derivation that ran on every
 * poll (260921-q2s); it is now written once, by the tick that folds the
 * rows (`apps/worker/src/liveStandings.ts`). An UNRANKED marker deliberately
 * does NOT produce `"live"`: in that case only the Record column was
 * counted, and the row order is still the published or fallback one — see
 * the Worker module's own doc comment for why an unranked result must never
 * carry an invented order. Otherwise `orderSource` resolves to `"official"` when AT LEAST ONE
 * entry in `artifact.teams` carries a defined `rank` — not "every team has
 * one": a team that registered and withdrew has no ranking row inside an
 * otherwise fully-ranked event, and relabelling the whole table for that
 * one row would be wrong.
 */
export function buildTeamsRows(artifact: EventArtifact, algorithmId: string): TeamsRowModel {
  void algorithmId; // reserved for signature symmetry with the column builder; the fallback ordering axis (TOTAL_KEY) is algorithm-agnostic once published

  const orderSource: TeamsOrderSource =
    artifact.standings?.ranked === true ? "live" : artifact.teams.some((team) => team.rank !== undefined) ? "official" : "fallback";

  const base: TeamsRowBase[] = artifact.teams.map((team) => {
    const teamNumber = team.teamNumber ?? teamNumberFromKey(team.teamKey);
    return {
      teamKey: team.teamKey,
      teamNumber,
      nickname: team.nickname ?? `Team ${teamNumber}`,
      rank: team.rank,
      record: team.record,
      rp: team.rp,
      // Widened with any derivable group entries this algorithm/season
      // supports — `EventArtifactSchema` carries its own `season`, so no
      // new parameter is needed here. See lib/metricGroups.ts's header for
      // the full honesty argument.
      metrics: withDerivedGroupMetrics(team.metrics, artifact.season),
    };
  });

  // Fallback is the one mode with its own comparator and its own rank rule;
  // "live" branches with "official" on both, per this function's own doc
  // comment.
  const ordered = [...base].sort(orderSource === "fallback" ? byFallbackTotal : byOfficialRank);

  const rows: TeamsRow[] = ordered.map((row, index) => ({
    teamKey: row.teamKey,
    teamNumber: row.teamNumber,
    nickname: row.nickname,
    // Official/live mode: the team's own published (or tick-counted) rank
    // (undefined for an unranked team inside a ranked event). Fallback
    // mode: the 1-based position in the returned order, computed after the
    // sort — the same "compute once, never recomputed by a re-sort"
    // discipline `teams-table/rowModel.ts`'s `buildTeamRows` applies to its
    // own `rank`.
    displayRank: orderSource === "fallback" ? index + 1 : row.rank,
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
 * `teamsFallbackNotice(algorithmLabel)`: the fallback-mode sentence,
 * with the selected algorithm's display label substituted in. This is the
 * ONLY place that sentence appears in source.
 */
export function teamsFallbackNotice(algorithmLabel: string): string {
  return `This event has no official TBA ranking. Teams below are ordered by ${algorithmLabel}'s rank instead.`;
}

/**
 * `teamsLiveNotice()`: the ONLY place the counted-order sentence
 * appears in source. Flat third person, zero hyphen or zero dash
 * characters of any kind — this site's methodology copy voice. States the
 * one honest claim this order owes the reader: it is counted from results
 * posted so far, and it can diverge from TBA's own published order on an
 * exact tie, a surrogate appearance or a disqualification (see
 * `apps/worker/src/liveStandings.ts`'s tiebreak doc comment for the full statement of
 * those two divergences).
 */
export function teamsLiveNotice(): string {
  return "These standings are counted from the results posted so far and can differ from the official order.";
}

/**
 * `teamsPreEventNotice(algorithmLabel)`: the sentence for an event with no
 * played qualification row yet, where no official ranking can exist and the
 * fallback order is simply how the page reads before the event starts. Flat
 * third person, zero hyphen or dash characters of any kind. The ONLY place this
 * sentence appears in source.
 */
export function teamsPreEventNotice(algorithmLabel: string): string {
  return `Official rankings appear once qualification results post. Until then teams are ordered by ${algorithmLabel}'s rank.`;
}

/**
 * `teamsAwaitingOfficialNotice(algorithmLabel)`: the sentence while counted
 * records (a `standings` marker with no counted rank) stand in for TBA's
 * rankings that have not arrived yet. Same copy rules as the pre event sentence.
 * The ONLY place this sentence appears in source.
 */
export function teamsAwaitingOfficialNotice(algorithmLabel: string): string {
  return `Official rankings have not arrived yet. Teams are ordered by ${algorithmLabel}'s rank for now.`;
}

/** Which notice the event Teams tab shows above the table, derived from `orderSource` and the artifact and deciding the sentence only. */
export type TeamsNotice = "none" | "counted" | "pre-event" | "awaiting-official" | "no-official";

/**
 * `teamsNoticeFor(artifact, orderSource)`: the one place the notice is
 * chosen. `buildTeamsRows` stays the one function that knows the ORDER; this
 * reads its `orderSource` and decides the sentence, so the notice and the order
 * can never be two independently consulted facts. The "no official TBA ranking"
 * sentence is reachable only for an event with a played qualification row, no
 * ranks and no counted marker: an event that has not started, or whose counted
 * records are standing in for rankings still on their way, is not an event TBA
 * declined to rank.
 */
export function teamsNoticeFor(artifact: EventArtifact, orderSource: TeamsOrderSource): TeamsNotice {
  if (orderSource === "official") return "none";
  if (orderSource === "live") return "counted";
  if (!artifact.matches.some((match) => match.compLevel === "qm")) return "pre-event";
  return artifact.standings !== undefined ? "awaiting-official" : "no-official";
}

/**
 * The decimal count the RP cell formats to. Mirrors
 * `packages/harness/rounding.ts`'s `ROUNDING_RULE.rankingPoints` —
 * mirrored rather than imported, following `MetricValue.tsx`'s own
 * established precedent of hardcoding its two decimals with a doc comment
 * naming the authority, because `rounding.ts`'s own header states the
 * module is for building published page artifacts, not for the client.
 * This restores trailing zeros JSON serialization dropped and is never a
 * second rounding pass. A future change to `ROUNDING_RULE.rankingPoints`
 * must be mirrored here.
 */
export const TEAMS_RP_DECIMALS = 2;

/** The direction a sorted column runs. */
export type TeamsSortDir = "asc" | "desc";

/** The active column sort: the column id and its direction. Component state is `null` for the default order `buildTeamsRows` returns. */
export interface TeamsSort {
  readonly key: string;
  readonly dir: TeamsSortDir;
}

/**
 * The column ids whose headers sort: Rank, RP, Total, then every
 * `METRIC_GROUPS` entry's `metricKey` in that constant's own order — never
 * retyped as literals. Team #, Team Name and Record are deliberately absent.
 */
export const TEAMS_SORTABLE_COLUMN_IDS: readonly string[] = ["rank", "rp", "total", ...METRIC_GROUPS.map((group) => group.metricKey)];

/** The value a column sorts on, or `undefined` when this row has none. `rank` reads `displayRank` (never recomputed), `total` reads `TOTAL_KEY`, any other id reads that metric key. */
export function teamsSortValue(row: TeamsRow, columnId: string): number | undefined {
  if (columnId === "rank") return row.displayRank;
  if (columnId === "rp") return row.rp;
  if (columnId === "total") return row.metrics[TOTAL_KEY]?.value;
  return row.metrics[columnId]?.value;
}

/**
 * `sortTeamsRows(rows, sort)`: a pure copy of `rows` ordered by the sort. A
 * row missing the value sorts last whatever the direction, otherwise the
 * comparison follows the direction, and an exact tie breaks on ascending
 * team number — a total order that never relies on the sort engine's
 * stability. Never recomputes `displayRank`.
 */
export function sortTeamsRows(rows: readonly TeamsRow[], sort: TeamsSort): TeamsRow[] {
  const direction = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const valueA = teamsSortValue(a, sort.key);
    const valueB = teamsSortValue(b, sort.key);
    if (valueA === undefined && valueB === undefined) return byTeamNumberAscending(a, b);
    if (valueA === undefined) return 1;
    if (valueB === undefined) return -1;
    if (valueA !== valueB) return (valueA - valueB) * direction;
    return byTeamNumberAscending(a, b);
  });
}

/** The sort a header click moves to: the active column toggles its direction, any other column starts at its natural direction (ascending for Rank, descending for every other column). Computed from the EFFECTIVE sort, never from raw state. */
export function nextTeamsSort(current: TeamsSort | null, columnId: string): TeamsSort {
  if (current !== null && current.key === columnId) {
    return { key: columnId, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key: columnId, dir: columnId === "rank" ? "asc" : "desc" };
}

/** The sort actually applied: `null` when there is none or its column is not among the visible sortable ids (the in-place column-set-change rule), otherwise the sort unchanged. */
export function effectiveTeamsSort(sort: TeamsSort | null, visibleIds: ReadonlySet<string>): TeamsSort | null {
  if (sort === null || !visibleIds.has(sort.key)) return null;
  return sort;
}

/**
 * Registered once, module-level: only column sizing is registered (no
 * pinning feature — no column in this table is frozen). The column helper
 * below is typed against THIS module's own `TeamsRow`, so it is
 * declared locally rather than imported across the `teams-table` module
 * boundary.
 */
const features = tableFeatures({ columnSizingFeature });
const columnHelper = createColumnHelper<typeof features, TeamsRow>();

function cellClassName(columnId: string): string {
  return columnId === "nickname" ? "truncate text-role-body" : "numeric-cell text-role-body";
}

/**
 * The event Teams tab's column set is the fixed five identity/competition
 * columns plus one per `METRIC_GROUPS` entry, in that constant's own
 * order — never derived from a fetched row's own `metrics` key order.
 * Column ids match the Teams table's own identity ids (`rank`,
 * `teamNumber`, `nickname`).
 */
function buildTeamsColumns(
  algorithmId: string,
  season: number,
  orderSource: TeamsOrderSource,
  isNarrow: boolean,
  tierCuts: SeasonTierCuts | undefined,
  metricFirst: boolean = isNarrow
) {
  // `algorithmId` reaching this function was already validated upstream
  // through `RootSearchSchema.algorithm` before this table ever
  // rendered — the same loose-cast escape hatch `teams-table/columns.tsx`
  // already uses for a value the type system widened to plain `string`
  // crossing a component-prop boundary.
  const algorithm = algorithmId as PublishedAlgorithmId;
  // Only fallback renames the header and widens the column below — "live"
  // keeps the plain "Rank" label and the official width, matching
  // `buildTeamsRows`'s own official/live symmetry.
  const rankHeader = orderSource === "fallback" ? `${algorithmDisplayLabel(algorithm)} Rank` : "Rank";

  const recordColumn = columnHelper.accessor("record", {
    header: "Record",
    // 100 at/above the breakpoint (unchanged), `RECORD_COLUMN_WIDTH_NARROW_PX`
    // below it — see that constant's own doc comment in
    // `teams-table/columns.tsx` for the real-geometry derivation.
    // Narrow-mode POSITION is decided at the assembly below, width alone
    // is decided here.
    size: isNarrow ? RECORD_COLUMN_WIDTH_NARROW_PX : 100,
    cell: (info) => <span className="numeric-cell">{formatEventRecord(info.getValue())}</span>,
  });

  // RP: a plain numeric-cell span, NEVER MetricValue and NEVER a tier
  // class under any input. `rp` is TBA's own raw competition statistic —
  // no percentile exists for it, and none could honestly be derived from
  // an event's own visible roster (`TeamMetricSchema.percentile`'s own
  // season-pool-only definition). An explicit `undefined` comparison
  // distinguishes a real `0` from absence, the same discipline the Rank
  // cell applies.
  const rpColumn = columnHelper.accessor("rp", {
    id: "rp",
    header: "RP",
    size: 84,
    cell: (info) => {
      const value = info.getValue();
      return <span className="numeric-cell">{value === undefined ? "" : value.toFixed(TEAMS_RP_DECIMALS)}</span>;
    },
  });

  // Total: the selected algorithm's own headline value, tiered exactly
  // like the group columns, placed FIRST among the metric columns — which
  // under the narrow ordering makes Total the value that clears the 390px
  // fold. The Total cell renders the split pill when this row's metrics
  // carry a SIGMA_METRIC_KEY entry — published inside the event standings
  // themselves (`publish.ts`'s `buildEventTeamsStanding`), never fetched
  // from the ~200KB Teams artifact. Header and size both come from the
  // shared `TotalSigmaValue` helpers so the header text, the pill and the
  // column width can never drift apart from what OPR/EPA (no Sigma) or
  // SPR (Sigma) actually publish.
  const totalColumn = columnHelper.accessor((row) => row.metrics[TOTAL_KEY], {
    id: "total",
    header: totalColumnHeader(algorithmId),
    size: totalColumnWidth(algorithmId, 120),
    cell: (info) => {
      const entry = info.getValue();
      const sigmaEntry = info.row.original.metrics[SIGMA_METRIC_KEY];
      return (
        <TotalSigmaValue
          total={entry}
          totalTier={resolveMetricTier(entry, TOTAL_KEY, tierCuts)}
          // sigma keeps tierForPercentile alone: the merge carries its
          // percentile forward and no sigma cut is ever published.
          sigma={sigmaEntry !== undefined ? { value: sigmaEntry.value, tier: tierForPercentile(sigmaEntry.percentile) } : undefined}
        />
      );
    },
  });

  const metricGroupColumns = [totalColumn, ...METRIC_GROUPS.map((group) =>
    columnHelper.accessor((row) => row.metrics[group.metricKey], {
      id: group.metricKey,
      header: group.label,
      size: 120,
      // The `resolveMetricTier` derivation, one derivation path for every
      // tier on this table. Tiered
      // unconditionally, including this sorted column: this knowingly
      // accepts the redundancy of adjacent rows sharing a tier in exchange
      // for one rule and more colour.
      cell: (info) => {
        const entry = info.getValue();
        return <MetricValue metric={entry} tier={resolveMetricTier(entry, group.metricKey, tierCuts)} />;
      },
    }),
  )];

  return columnHelper.columns([
    // In fallback mode the header itself names the algorithm whose
    // ordering it is showing — a model-derived ordinal must never sit
    // under a bare "Rank" header a reader parses as official. The plain
    // "Rank" label keeps 72 at/above the breakpoint and
    // `RANK_COLUMN_WIDTH_NARROW_PX` below it, but a longer algorithm-qualified
    // fallback header was MEASURED clipping live inside 72px on fallback
    // events — rendering a truncated label on the one state whose whole
    // point is naming the ranking source. In fallback mode this column
    // budgets 96px at every width, matching what the Teams page's own Rank
    // column already budgets for the same label shape. A readable
    // source-naming header outranks the narrow-width budget on exactly
    // these events.
    columnHelper.accessor((row) => row.displayRank, {
      id: "rank",
      header: rankHeader,
      size: orderSource === "fallback" ? 96 : isNarrow ? RANK_COLUMN_WIDTH_NARROW_PX : 72,
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
      // Visible label only — the column id stays "nickname"
      // (pinning/data-testid/e2e selectors key off it).
      header: "Team Name",
      // 220 at/above the breakpoint (unchanged), `NICKNAME_COLUMN_WIDTH_NARROW_PX`
      // below it — see that constant's own doc comment in
      // `teams-table/columns.tsx` for the real-geometry derivation shared
      // with `TeamsTable`.
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
          // width exactly, so nothing overflows the anchor's OWN box at
          // the box-model level. What actually overflows is the anchor's
          // inline text content spilling past its own border box, which
          // the cell then hard-clips at the pixel level with no ellipsis
          // glyph at all. `truncate` must sit on the element that is
          // itself the overflowing box, not merely its ancestor.
          className="block max-w-full truncate"
        >
          {info.getValue()}
        </Link>
      ),
    }),
    // Below the breakpoint the FIRST metric column leads this trailing
    // block, so a tiered, percentile-carrying value is on the first
    // screenful — the product's differentiator, not just TBA's Record/RP
    // facts. Record and RP sit directly behind it, then the remaining
    // metric columns. At/above the breakpoint the order is unchanged
    // (record, rp, metrics). `metricGroupColumns` leads with `totalColumn`,
    // so this slice leads with Total — matching the Teams table's own
    // narrow lead (`columns.tsx`'s `leadMetricIndex`, always Total).
    ...(metricFirst ? metricGroupColumns.slice(0, 1) : []),
    recordColumn,
    rpColumn,
    ...(metricFirst ? metricGroupColumns.slice(1) : metricGroupColumns),
  ]);
}

export interface TeamsTabProps {
  artifact: EventArtifact;
  algorithmId: string;
  season: number;
}

/** The pending state's skeleton row count. */
export const TEAMS_SKELETON_ROW_COUNT = 8;

/**
 * `TeamsTabSkeleton({ algorithmId, season })`: the eight real column
 * headers above `SkeletonRows` — always with the BARE `Rank` header, never
 * the fallback-labelled one. Before the artifact resolves there is no way
 * to know whether the fallback applies, and flashing the
 * algorithm-labelled header only to replace it a moment later would
 * assert a provenance claim the page cannot yet support.
 *
 * The Total header DOES vary by algorithm — the same
 * `totalColumnHeader(algorithmId)` the live table uses — so nothing shifts
 * when the real data lands under a Sigma-enabled algorithm.
 */
export function TeamsTabSkeleton({ algorithmId, season }: { algorithmId: string; season: number }) {
  void season;
  // Total leads the metric block, matching the live table's own
  // `metricGroupColumns` order — never a re-typed literal that could
  // drift from it.
  const headers = ["Rank", "Team #", "Team Name", "Record", "RP", totalColumnHeader(algorithmId), ...METRIC_GROUPS.map((group) => group.label)];

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
            <SkeletonRows rows={TEAMS_SKELETON_ROW_COUNT} columns={headers.length} />
          </TableBody>
        </table>
      </div>
    </div>
  );
}

/**
 * The event Teams tab: `TierKeyRow` once, the fallback banner when (and only
 * when) `orderSource` is `"fallback"`, then the wide table in its own
 * native `overflow-x-auto` scroll region — a DOM SIBLING of the tab strip's
 * own scroll region, never its ancestor or descendant. Renders `EmptyState`
 * (no table at all) when `artifact.teams` is empty.
 *
 * Every string that originates in the published artifact — nickname, event
 * name, event key — renders as a plain JSX text node or a `title` attribute
 * value, never through a raw-markup sink.
 */
export function TeamsTab({ artifact, algorithmId, season }: TeamsTabProps) {
  // Same sitewide breakpoint hook `TeamsTable.tsx` reuses — see that
  // component's own doc comment for why (one "mobile" definition for the
  // whole page, live on resize/rotation via `matchMedia`'s `change` event).
  const isNarrow = useIsMobile();
  const isF3Width = useIsF3MetricFirstWidth();
  const { rows, orderSource } = useMemo(() => buildTeamsRows(artifact, algorithmId), [artifact, algorithmId]);
  const notice = teamsNoticeFor(artifact, orderSource);
  const algorithmLabel = algorithmDisplayLabel(algorithmId as PublishedAlgorithmId);
  const columns = useMemo(
    () => buildTeamsColumns(algorithmId, season, orderSource, isNarrow, artifact.tierCuts),
    [algorithmId, season, orderSource, isNarrow, artifact.tierCuts],
  );

  // Local component state by decision (quick task 261024-jvv): `null` is the
  // default order `buildTeamsRows` returned. The click handler and the
  // rendered headers both read the EFFECTIVE sort, so a sort on a column
  // that is no longer visible falls back to the default order in place.
  const [sort, setSort] = useState<TeamsSort | null>(null);
  const visibleSortableIds = useMemo(() => {
    const ids = (columns as unknown as ReadonlyArray<{ id?: string; accessorKey?: string }>).map((column) => column.id ?? column.accessorKey);
    return new Set(ids.filter((id): id is string => id !== undefined && TEAMS_SORTABLE_COLUMN_IDS.includes(id)));
  }, [columns]);
  const activeSort = effectiveTeamsSort(sort, visibleSortableIds);
  const sortedRows = useMemo(() => (activeSort === null ? rows : sortTeamsRows(rows, activeSort)), [rows, activeSort]);

  const table = useTable({
    features,
    columns,
    data: sortedRows,
  });

  if (artifact.teams.length === 0) {
    const eventName = artifact.name ?? artifact.eventKey;
    return <EmptyState heading={`No teams for ${eventName}`} body={`No teams found for ${eventName}. Check back later.`} />;
  }

  return (
    <div className="flex flex-col gap-[var(--spacing-md)]">
      <TierKeyRow />
      {notice === "no-official" && (
        <div
          data-testid="teams-fallback-banner"
          className="flex items-center gap-[var(--spacing-sm)] rounded-[var(--radius)] bg-[var(--color-bg-inset)] px-[var(--spacing-md)] py-[var(--spacing-sm)] text-role-body text-[var(--color-text-muted)]"
        >
          <InfoIcon aria-hidden="true" className="size-4 shrink-0" />
          <span>{teamsFallbackNotice(algorithmLabel)}</span>
        </div>
      )}
      {(notice === "pre-event" || notice === "awaiting-official") && (
        <div
          data-testid="teams-pending-banner"
          className="flex items-center gap-[var(--spacing-sm)] rounded-[var(--radius)] bg-[var(--color-bg-inset)] px-[var(--spacing-md)] py-[var(--spacing-sm)] text-role-body text-[var(--color-text-muted)]"
        >
          <InfoIcon aria-hidden="true" className="size-4 shrink-0" />
          <span>{notice === "pre-event" ? teamsPreEventNotice(algorithmLabel) : teamsAwaitingOfficialNotice(algorithmLabel)}</span>
        </div>
      )}
      {notice === "counted" && (
        <div
          data-testid="teams-live-banner"
          className="flex items-center gap-[var(--spacing-sm)] rounded-[var(--radius)] bg-[var(--color-bg-inset)] px-[var(--spacing-md)] py-[var(--spacing-sm)] text-role-body text-[var(--color-text-muted)]"
        >
          <InfoIcon aria-hidden="true" className="size-4 shrink-0" />
          <span>{teamsLiveNotice()}</span>
        </div>
      )}
      <div data-testid="teams-table-scroll" className="data-card w-fit max-w-full min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
        <table
          style={{
            // See `TeamsTable.tsx`'s identical style-object comment for
            // the full mechanism — `auto` let the browser resize columns
            // past their declared `size`, so a column no longer rendered
            // at the width its neighbours' layout assumed (measured live:
            // nickname 220→348px). `fixed` keeps every column at its
            // declared size.
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
                  const isSortable = visibleSortableIds.has(header.column.id);
                  const isActive = isSortable && activeSort?.key === header.column.id;
                  const ariaSort = !isSortable ? undefined : isActive ? (activeSort?.dir === "asc" ? "ascending" : "descending") : "none";
                  return (
                    <TableHead
                      key={header.id}
                      data-testid={`teams-header-${header.column.id}`}
                      aria-sort={ariaSort}
                      className="text-role-label truncate"
                      style={{
                        width: header.getSize(),
                        background: "var(--color-bg-surface)",
                      }}
                    >
                      {isSortable ? (
                        <button
                          type="button"
                          className="tap-target inline-flex items-center gap-[var(--spacing-xs)]"
                          onClick={() => setSort(nextTeamsSort(activeSort, header.column.id))}
                        >
                          <table.FlexRender header={header} />
                          {isActive && (
                            <span aria-hidden="true" className="text-[var(--color-accent)]">
                              {activeSort?.dir === "asc" ? "▲" : "▼"}
                            </span>
                          )}
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  );
                })}
                {/*
                  Trailing sizeless filler, matching `TeamsTable.tsx`'s own
                  reasoning: slack absorbed here rather than redistributed
                  across real columns, so every real column renders at its
                  declared size. Hidden from assistive tech — it carries no
                  data.
                */}
                <TableHead aria-hidden="true" style={{ padding: 0, background: "var(--color-bg-surface)" }} />
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} data-testid="teams-row" data-team-number={row.original.teamNumber}>
                {row.getAllCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    data-testid={`teams-cell-${cell.column.id}`}
                    className={cellClassName(cell.column.id)}
                    style={{ width: cell.column.getSize() }}
                  >
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
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
