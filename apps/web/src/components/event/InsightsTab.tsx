/**
 * The Insights tab (EVNT-02, D-07…D-10, 07-11-PLAN.md): the event's teams in
 * TBA's official event-rank order — or, per D-08, the selected algorithm's
 * own Total order with a stated notice when no official ranking exists.
 * Eight columns: Rank, Team #, Nickname, Record, RP, Auto, Teleop, Endgame.
 *
 * This first section (Task 1) is the pure data layer only — no React, no
 * TanStack anything. `buildInsightsRows` is the ONE function that returns
 * both the ordered rows and the `orderSource` discriminant driving the D-08
 * banner, deliberately NOT split into a separate `hasOfficialRanking`
 * predicate a caller could consult independently: 06.1-08's own recorded
 * lesson is that one rule expressed as two independent literals drifts apart
 * and ships a false claim. Here there is exactly one fact ("does this event
 * have an official ranking") and exactly one function that knows it.
 */
import { TOTAL_KEY } from "@/lib/metricKeys";
import { teamNumberFromKey } from "@/lib/teamKey";
import type { EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";

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
      metrics: team.metrics,
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
  if (record === undefined) return "—";
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
