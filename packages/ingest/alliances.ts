/**
 * The alliances normalize rule (D-18.7, EVNT-05, plan 07-03): turns TBA's
 * `/event/{key}/alliances` response into a per-alliance array, or an honest
 * empty array when TBA has no alliance data for this event.
 *
 * The load-bearing rule, mirroring `rankings.ts`'s own contract: the WHOLE
 * response can be a bare `null` body (an event with no alliance structure
 * at all — confirmed live at `2022ispr`) and separately the array can be
 * genuinely empty (an event that ran quals but never held an alliance
 * selection — confirmed live at `2025bc` and `2026wvrox`). Both are real,
 * distinct answers, not parse failures — this function returns `[]` for
 * either, never coercing one into the other and never throwing.
 * Distinguishing them for logging is `packages/ingest/cli.ts`'s job, not
 * this pure function's — this module has no I/O and no corpus import.
 *
 * Two live-probe findings from RESEARCH.md Open Question 2 this normalize
 * rule exists to respect: `name` is sometimes ABSENT entirely (not `""`),
 * and a 4th pick is `picks[3]` with no separately-named field for it.
 */
import type { TbaAllianceResponse } from "./schemas.js";

/** Every non-key field `upsertEventAlliance` takes, under 07-02's exact property names. `eventKey` and `fetchedAt` are deliberately absent: the caller supplies both, exactly as `NormalizedEventRanking` omits them. */
export interface NormalizedEventAlliance {
  allianceNumber: number;
  name: string | null;
  picks: string[];
  declines: string[];
  statusRaw: string | null;
}

/**
 * Normalizes a (possibly null) TBA alliances response into per-alliance
 * records. Returns `[]` when the response is `null` or has length 0.
 *
 * Four rules a reader cannot recover from the code alone:
 * - `allianceNumber` is TBA's own seed order, taken from the response
 *   array position (1-based). It is never parsed out of `name`, because
 *   `name` is absent entirely at some events.
 * - `name` collapses `undefined`, `null` and `""` to a single `null`. All
 *   three are the same fact and 07-02's storage contract admits exactly
 *   one representation of it. Any other string passes through verbatim.
 *   Fabricating an `Alliance {n}` label is 07-14's decision to make from
 *   an honest NULL, and is forbidden here.
 * - `picks` and `declines` pass through as the arrays TBA sent, order
 *   intact, with no filtering, de-duplication or length branching.
 *   `picks[0]` is the captain; a 4th team, where one exists, is
 *   `picks[3]`. TBA's response has no separate field for it (D-16), so
 *   neither does this interface.
 * - `statusRaw` is `JSON.stringify` of `status` when present and `null`
 *   when absent — the verbatim provenance 07-02's `status_raw` column
 *   stores. Nothing in Phase 7 reads it; it is kept so a later consumer of
 *   alliance status does not need another full-corpus live pass to get it.
 */
export function normalizeEventAlliances(response: TbaAllianceResponse | null): NormalizedEventAlliance[] {
  if (response === null || response.length === 0) return [];
  return response.map((entry, i) => ({
    allianceNumber: i + 1,
    name: entry.name === undefined || entry.name === null || entry.name === "" ? null : entry.name,
    picks: entry.picks,
    declines: entry.declines,
    statusRaw: entry.status === undefined ? null : JSON.stringify(entry.status),
  }));
}
