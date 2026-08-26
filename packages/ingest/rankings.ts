/**
 * The event-rankings normalize rule (TEAM-04, F-06-3, plan 06.1-01): turns
 * TBA's `/event/{key}/rankings` response into a per-team array, or an honest
 * empty array when TBA has no rankings for this event.
 *
 * The load-bearing rule: the WHOLE response can be `null` (TBA returns HTTP
 * 200 with a bare `null` body for an event with no ranking structure set up
 * at all — confirmed live against `2026scsc`, 06.1-RESEARCH.md Pitfall 2),
 * and separately `rankings` can be a genuine empty array (a scheduled event
 * whose quals have not yet run — confirmed live against `2026azscor`). Both
 * are real, distinct answers, not parse failures — this function treats both
 * as "nothing to report" and returns `[]` for either, never coercing one into
 * the other and never throwing. Distinguishing a null body from an empty
 * array for logging purposes is `packages/ingest/cli.ts`'s
 * `ingestSeasonRankingsOnly`'s job (PD-02), not this pure function's — this
 * module has no I/O and no corpus import, mirroring `media.ts`'s shape.
 */
import type { TbaEventRankingsResponse } from "./schemas.js";

export interface NormalizedEventRanking {
  teamKey: string;
  rank: number;
  totalTeams: number;
}

/**
 * Normalizes a (possibly null) TBA rankings response into per-team records.
 * `totalTeams` is always `response.rankings.length` for every entry — the
 * size of the pool a rank is drawn from, read once per response, never
 * re-derived per team.
 */
export function normalizeEventRankings(response: TbaEventRankingsResponse | null): NormalizedEventRanking[] {
  if (response === null || response.rankings.length === 0) return [];
  const totalTeams = response.rankings.length;
  return response.rankings.map((r) => ({ teamKey: r.team_key, rank: r.rank, totalTeams }));
}
