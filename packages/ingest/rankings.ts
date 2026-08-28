/**
 * The event-rankings normalize rule (TEAM-04, F-06-3, plan 06.1-01; widened
 * D-18.6, plan 07-04): turns TBA's `/event/{key}/rankings` response into a
 * per-team array, or an honest empty array when TBA has no rankings for this
 * event.
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
 *
 * D-18.6 (plan 07-04): TBA's `sort_orders` array is a positional list whose
 * VOCABULARY genuinely varies by season (`sort_order_info` names — 2022
 * carries "Avg Hangar", 2024 "Avg Coop", 2026 "Avg Tower"), but
 * `RANKING_SCORE_SORT_ORDER_INDEX` (position 0) was confirmed live to carry
 * `RANKING_SCORE_SORT_ORDER_NAME` ("Ranking Score") in all 40 sampled events
 * across 2022-2026 and all 8 TBA event types (RESEARCH.md Question 1). That
 * finding licenses reading position 0 — it does not license reading it
 * silently. Every populated response is asserted against that name before
 * `rankingScore` is read from that position; a mismatch throws
 * `RankingScoreSortOrderError` rather than storing a value read from an
 * unasserted position. The guard and the read it protects live in this one
 * function so no future caller can perform one without the other (06.1-08's
 * lesson: a rule expressed as two independent literals can drift apart).
 */
import type { TbaEventRankingsResponse } from "./schemas.js";

/**
 * TBA's own display name for the metric FRC calls "RP" on event ranking
 * pages, confirmed live at `sort_order_info[0].name` in every one of 40
 * sampled events spanning 2022-2026 and all 8 TBA event types (RESEARCH.md
 * Question 1). This is the ONLY place in this module this string appears as
 * a literal — every other reference goes through this constant.
 */
export const RANKING_SCORE_SORT_ORDER_NAME = "Ranking Score";

/**
 * The asserted position of the ranking-score value within a populated
 * response's `sort_order_info`/`sort_orders` arrays. Naming it is the point:
 * D-18.6 forbids a silent hardcoded index-0 read, and a named constant makes
 * "which position, and who decided" answerable from the code rather than
 * from a commit message.
 */
export const RANKING_SCORE_SORT_ORDER_INDEX = 0;

/**
 * Thrown when a populated response's `sort_order_info` at
 * `RANKING_SCORE_SORT_ORDER_INDEX` does not carry
 * `RANKING_SCORE_SORT_ORDER_NAME` — TBA's ranking-score vocabulary has
 * moved. A dedicated class (rather than a bare `Error`) so a test can assert
 * the exact failure mode, and so a future caller that legitimately needs to
 * distinguish TBA-vocabulary drift from a network or parse failure can,
 * without string-matching a message.
 */
export class RankingScoreSortOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RankingScoreSortOrderError";
  }
}

export interface NormalizedEventRanking {
  teamKey: string;
  rank: number;
  totalTeams: number;
  /**
   * TBA's own `record.wins`/`record.losses`/`record.ties`, passed through
   * verbatim — never a match-derived tally. TBA's record accounts for DQs
   * and surrogate appearances that a self-counted substitute would
   * misreport (D-18.6). Required and non-nullable: `tbaEventRankingSchema`'s
   * `record` object is required and non-nullable, so any entry that reaches
   * this function always has all three.
   */
  recordWins: number;
  recordLosses: number;
  recordTies: number;
  /**
   * TBA's `sort_orders[RANKING_SCORE_SORT_ORDER_INDEX]`, asserted against
   * `RANKING_SCORE_SORT_ORDER_NAME` before being read (D-18.6). `null` when
   * `sort_orders` itself is `null` OR has no element at the asserted index —
   * both resolve to SQL NULL, never `0` and never `undefined` (a real `0`
   * ranking score is a positive claim TBA made; `undefined` is rejected
   * outright by better-sqlite3's named-parameter binding).
   */
  rankingScore: number | null;
}

/**
 * Normalizes a (possibly null) TBA rankings response into per-team records.
 * `totalTeams` is always `response.rankings.length` for every entry — the
 * size of the pool a rank is drawn from, read once per response, never
 * re-derived per team.
 *
 * `eventKey` exists solely to name the offending event in the drift error
 * message below — it is not used for filtering or lookup.
 */
export function normalizeEventRankings(
  response: TbaEventRankingsResponse | null,
  eventKey: string
): NormalizedEventRanking[] {
  // Both a null body and an empty rankings array are real, distinct answers
  // ("nothing to report"), not parse failures — this early return stays
  // FIRST and strictly before the guard below, so an event with nothing to
  // store is never failed for a vocabulary it was never going to use.
  if (response === null || response.rankings.length === 0) return [];

  // The guard: a populated response's ranking-score vocabulary must match
  // what this pipeline asserts before any value is read from that position.
  const observedName = response.sort_order_info[RANKING_SCORE_SORT_ORDER_INDEX]?.name;
  if (observedName !== RANKING_SCORE_SORT_ORDER_NAME) {
    const observedDescription = observedName === undefined ? "<absent — sort_order_info has no entry at this index>" : observedName;
    throw new RankingScoreSortOrderError(
      `Event ${eventKey}: TBA's ranking-score sort-order vocabulary has moved. ` +
        `Expected sort_order_info[${RANKING_SCORE_SORT_ORDER_INDEX}].name === "${RANKING_SCORE_SORT_ORDER_NAME}", ` +
        `observed ${observedDescription}. Refusing to store a ranking-score value read from an unasserted ` +
        `position (D-18.6) — a human must confirm TBA's new vocabulary before this pipeline reads it again.`
    );
  }

  const totalTeams = response.rankings.length;
  return response.rankings.map((r) => ({
    teamKey: r.team_key,
    rank: r.rank,
    totalTeams,
    recordWins: r.record.wins,
    recordLosses: r.record.losses,
    recordTies: r.record.ties,
    // `?? null` is load-bearing twice over: it converts both the null-array
    // case and the absent-element case into SQL NULL, and it prevents an
    // `undefined` from ever reaching better-sqlite3's named-parameter
    // binding, which rejects `undefined` outright. `sort_order_info[...].
    // precision` is deliberately NOT applied here — rounding in this
    // project happens only at the publish boundary
    // (`packages/harness/rounding.ts`); storing a pre-rounded source value
    // would lose fidelity the corpus is supposed to preserve.
    rankingScore: r.sort_orders?.[RANKING_SCORE_SORT_ORDER_INDEX] ?? null,
  }));
}
