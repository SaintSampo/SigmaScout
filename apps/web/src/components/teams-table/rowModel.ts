/**
 * Pure row construction, ranking, win-rate derivation and the deterministic
 * sort for the Teams table (Task 1, 05-06-PLAN.md). Imports no React and no
 * TanStack anything — this file is a plain data transform over the published
 * `TeamsArtifact` (`packages/harness/pageArtifacts.ts`'s `TeamsTableRowSchema`),
 * consumed by `columns.tsx`/`TeamsTable.tsx` (Task 2) and `routes/teams.tsx`
 * (Task 3).
 *
 * Nothing here derives a statistic the artifact does not carry (NAV-06).
 * `winRate` is arithmetic over three published integers, which NAV-06 permits
 * as presentation; the metrics record is rendered exactly as published, never
 * recomputed or defaulted.
 */
import type { TeamsArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { TOTAL_KEY } from "../../lib/metricKeys.js";

export type TeamRecord = TeamsArtifact["teams"][number]["record"];
export type TeamMetrics = TeamsArtifact["teams"][number]["metrics"];
export type SortDirection = "asc" | "desc";

/**
 * One Teams-table row, derived once per artifact load. `rank` is computed
 * here — the team's position ordered by the total metric descending with
 * ascending team number as the tie-break — and is NEVER recomputed by
 * `sortTeamRows`. That choice makes rank a stable property of the
 * algorithm-and-year pair: sorting by a component column changes the row
 * ORDER without renumbering anyone, matching the behaviour this table's
 * users already expect from comparable FRC tools.
 */
export interface TeamRow {
  teamKey: string;
  teamNumber: number;
  nickname: string;
  record: TeamRecord;
  /** Zero-to-one fraction, or `null` when the record's three counts sum to zero — a rate over zero matches is undefined, never a coerced zero. */
  winRate: number | null;
  /** The published metrics record, exactly as fetched — a key the declared set contains but this row lacks is simply absent here, never defaulted. */
  metrics: TeamMetrics;
  rank: number;
}

/**
 * `winRate(record)`: the fraction of matches won, or `null` when the three
 * counts sum to zero. Returns the raw fraction — percentage formatting is
 * the column's business, not this model's. The null case is the one this
 * project would otherwise ship as a not-a-number, because a zero-match team
 * is not a hypothetical in a real season.
 */
export function winRate(record: TeamRecord): number | null {
  const totalMatches = record.wins + record.losses + record.ties;
  if (totalMatches === 0) return null;
  return record.wins / totalMatches;
}

/** Ascending team-number comparator — the one deterministic tie-break both `buildTeamRows`'s ranking and `sortTeamRows` share, so re-sorts, reloads and algorithm switches always land on the same row order. */
function byTeamNumberAscending(a: { teamNumber: number }, b: { teamNumber: number }): number {
  return a.teamNumber - b.teamNumber;
}

/**
 * `buildTeamRows(artifact, algorithmId)`: maps each published row to a
 * `TeamRow`, computing `winRate` and `rank` once. `algorithmId` is part of
 * this function's contract (mirroring `columns.tsx`'s `buildColumns`) even
 * though ranking itself is algorithm-agnostic — every algorithm guarantees
 * `TOTAL_KEY` (D-27), so the total metric is always the correct ranking
 * axis regardless of which algorithm produced the artifact.
 */
export function buildTeamRows(artifact: TeamsArtifact, algorithmId: string): TeamRow[] {
  void algorithmId; // reserved for signature symmetry with buildColumns; ranking itself is algorithm-agnostic (see doc comment above)
  const unranked = artifact.teams.map((team) => ({
    teamKey: team.teamKey,
    teamNumber: team.teamNumber,
    nickname: team.nickname,
    record: team.record,
    winRate: winRate(team.record),
    metrics: team.metrics,
  }));

  const ranked = [...unranked].sort((a, b) => {
    const totalA = a.metrics[TOTAL_KEY]?.value;
    const totalB = b.metrics[TOTAL_KEY]?.value;
    // A row missing the total key sorts last rather than throwing — the
    // ranking axis is descending total, so "missing" is the worst position.
    if (totalA === undefined && totalB === undefined) return byTeamNumberAscending(a, b);
    if (totalA === undefined) return 1;
    if (totalB === undefined) return -1;
    if (totalA !== totalB) return totalB - totalA;
    return byTeamNumberAscending(a, b);
  });

  return ranked.map((row, index) => ({ ...row, rank: index + 1 }));
}

/**
 * `sortTeamRows(rows, key, direction)`: sorts by the metric value at `key`,
 * placing rows missing that key last REGARDLESS of direction, with ascending
 * team number as the final tie-break so the result is a total order — the
 * same order every time, without relying on the engine's sort-stability
 * guarantee. Never touches `rank`: rank is a property of the artifact, not
 * of the current sort.
 */
export function sortTeamRows(rows: readonly TeamRow[], key: string, direction: SortDirection): TeamRow[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const valueA = a.metrics[key]?.value;
    const valueB = b.metrics[key]?.value;
    if (valueA === undefined && valueB === undefined) return byTeamNumberAscending(a, b);
    if (valueA === undefined) return 1;
    if (valueB === undefined) return -1;
    if (valueA !== valueB) return sign * (valueA - valueB);
    return byTeamNumberAscending(a, b);
  });
}
