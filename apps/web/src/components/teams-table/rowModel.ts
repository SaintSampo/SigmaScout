/**
 * Pure row construction, ranking, win-rate derivation and the deterministic
 * sort for the Teams table (Task 1, 05-06-PLAN.md). Imports no React and no
 * TanStack anything — this file is a plain data transform over the published
 * `TeamsArtifact` (`packages/harness/pageArtifacts.ts`'s teams-table row),
 * consumed by `columns.tsx`/`TeamsTable.tsx` (Task 2) and `routes/teams.tsx`
 * (Task 3).
 *
 * 260902-pbe: on the WIRE, a row's `metrics` may be encoded positionally (an
 * array aligned to the artifact's top-level `metricKeys` list) rather than
 * the keyed record shown below — this file never sees that shape. Decoding
 * both the positional form and the pre-existing (pre-republish) object form
 * back to the one canonical `Record<string, TeamMetric>` happens once, in
 * `pageArtifacts.ts`'s `TeamsArtifactSchema` itself (a `.transform()` on the
 * wire schema), before `fetchTeamsArtifact` ever returns. `TeamMetrics`
 * below is that decoded shape — nothing in this file changed for the
 * positional encoding to exist.
 *
 * Nothing here derives a statistic the artifact does not carry beyond
 * NAV-06's own permitted class of presentation arithmetic. `winRate` is
 * arithmetic over three published integers; as of 2026-09-04 (quick task
 * 260904-5zg, D-2/D-3/D-4), `row.metrics` is ALSO no longer purely "exactly
 * as published" — `withDerivedGroupMetrics` (lib/metricGroups.ts) adds a
 * value-only `phaseAuto`/`phaseTeleop`/`phaseEndgame` entry, summed from
 * PUBLISHED component values, for any algorithm that has components but no
 * published group metric (EPA today). It is the same class of arithmetic
 * `winRate` already performs here — exact, never defaulting, rounding or
 * rescaling an input — and it NEVER overwrites a published group entry
 * (VPR's honest, covariance-derived spread/percentile survive untouched).
 * Ranking still keys off `TOTAL_KEY`, which no derivation ever touches, so
 * ranking itself is unaffected.
 */
import type { TeamsArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { compareTeamsByTotal } from "../../../../../packages/harness/teamRanks.js";
import { withDerivedGroupMetrics } from "../../lib/metricGroups.js";
import { isRealTeamKey } from "../../lib/teamKey.js";

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
 *
 * Quick task 260905-ldu: the ranking rule itself now lives in
 * `packages/harness/teamRanks.ts`'s `compareTeamsByTotal` — the SAME
 * comparator the offline pipeline uses to publish each team's World rank
 * card. A single shared implementation is what makes this table's rank and
 * the published per-team World rank incapable of disagreeing.
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
 * Reserved sort key for the win-rate column (Task 2, 05-06-PLAN.md — "sortable
 * for every metric column plus win rate"). Not a metric key: win rate lives on
 * `TeamRow.winRate`, never inside the published `metrics` record, so
 * `sortTeamRows` special-cases this one string sentinel to read that field
 * instead of indexing `metrics`. `columns.tsx`'s win-rate column id and any
 * caller's "valid sort keys" set both reference this same constant, never a
 * re-typed literal.
 */
export const WIN_RATE_SORT_KEY = "winRate";

/** The numeric value `sortTeamRows` compares for a given row and key — `TeamRow.winRate` for the reserved sentinel, otherwise the published metric's value. A `null` win rate (zero-match team) is treated as absent for sorting purposes, same as a missing metric key. */
function sortValueFor(row: TeamRow, key: string): number | undefined {
  if (key === WIN_RATE_SORT_KEY) {
    return row.winRate ?? undefined;
  }
  return row.metrics[key]?.value;
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
  // Non-real team keys are dropped BEFORE ranking (2026-09-01) — see
  // `lib/teamKey.ts`'s `isRealTeamKey` for what they are and why. Filtering
  // here rather than at render is what keeps `rank` honest: an offseason
  // B-team held rank 3 of all 2024, pushing every real team below it down
  // one place.
  const unranked = artifact.teams.filter((team) => isRealTeamKey(team.teamKey)).map((team) => ({
    teamKey: team.teamKey,
    teamNumber: team.teamNumber,
    nickname: team.nickname,
    record: team.record,
    winRate: winRate(team.record),
    // Published metrics widened with any derivable group entries this
    // algorithm/season combination supports (D-2/D-3/D-4) — see this
    // module's own header comment. `sortValueFor` reads `row.metrics[key]`
    // directly, so a derived `phaseAuto` is sortable exactly like a
    // published one.
    metrics: withDerivedGroupMetrics(team.metrics, artifact.season),
  }));

  // Quick task 260905-ldu: `compareTeamsByTotal` (shared with
  // `packages/harness/publish.ts`'s published World rank) replaces the
  // total-descending sort body that used to live here inline.
  const ranked = [...unranked].sort(compareTeamsByTotal);

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
    const valueA = sortValueFor(a, key);
    const valueB = sortValueFor(b, key);
    if (valueA === undefined && valueB === undefined) return byTeamNumberAscending(a, b);
    if (valueA === undefined) return 1;
    if (valueB === undefined) return -1;
    if (valueA !== valueB) return sign * (valueA - valueB);
    return byTeamNumberAscending(a, b);
  });
}
