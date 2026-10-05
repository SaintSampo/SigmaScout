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
import { z } from "zod";
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
 *   intact, with no de-duplication or length branching. `picks[0]` is the
 *   captain; a 4th team, where one exists, is `picks[3]`. TBA's response
 *   has no separate field for it (D-16), so neither does this interface.
 *   The single exception: an entry with ZERO picks is dropped entirely —
 *   observed live at `2018mvrc` (8 declared slots, the last two unfilled)
 *   during the 2016–2020 backfill. An unfilled slot is not an alliance,
 *   and `event_alliances` forbids an empty-picks row; this filter is what
 *   keeps that contract true now that the schema admits the shape. It runs
 *   AFTER `allianceNumber` assignment, so real alliances keep TBA's seed
 *   order even if an unfilled slot ever appeared mid-array.
 * - `statusRaw` is `JSON.stringify` of `status` when present and `null`
 *   when absent — the verbatim provenance 07-02's `status_raw` column
 *   stores. Nothing in Phase 7 reads it; it is kept so a later consumer of
 *   alliance status does not need another full-corpus live pass to get it.
 */
export function normalizeEventAlliances(response: TbaAllianceResponse | null): NormalizedEventAlliance[] {
  if (response === null || response.length === 0) return [];
  return response
    .map((entry, i) => ({
      allianceNumber: i + 1,
      name: entry.name === undefined || entry.name === null || entry.name === "" ? null : entry.name,
      picks: entry.picks,
      declines: entry.declines,
      statusRaw: entry.status === undefined ? null : JSON.stringify(entry.status),
    }))
    .filter((alliance) => alliance.picks.length > 0);
}

// ---------------------------------------------------------------------------
// Moved here from `packages/corpus/db.ts` (quick task 261004-uyc) so the live
// Worker can read an alliance's playoff record without importing the corpus
// module, which reaches `better-sqlite3`. `db.ts` re-exports it unchanged.
// ---------------------------------------------------------------------------

/**
 * TBA's `status` object shape this pipeline recognises (07-UAT.md G-8):
 * `{ record: { wins, losses, ties }, ... }`, with any other keys (`status`,
 * `level`, `double_elim_round`, all observed live) ignored — Zod's default
 * object parsing strips unknown keys rather than rejecting them, so this
 * schema stays valid across every `playoff_type` shape RESEARCH.md Q2
 * measured (values 0, 4, 8 and 10) as long as the `record` triple itself is
 * well-formed. All three counts are required TOGETHER — there is no
 * half-present alliance record the way `EventTeamSchema.record` allows for
 * TBA's per-team rankings; a `status` object missing any one of the three
 * fails this schema entirely and `parseAllianceRecord` returns `null`.
 */
const AllianceStatusSchema = z.object({
  record: z.object({
    wins: z.number().int().nonnegative(),
    losses: z.number().int().nonnegative(),
    ties: z.number().int().nonnegative(),
  }),
});

/**
 * Recovers an alliance's playoff win-loss-tie record from
 * `event_alliances.status_raw` — the verbatim `JSON.stringify` of TBA's
 * `status` object that `packages/ingest/alliances.ts`'s
 * `normalizeEventAlliances` stores (`statusRaw`), or `null` when TBA sent
 * none. Three independent absence paths all collapse to `null`, through the
 * SAME rule, with no special case for any of them (07-14's own "same rule,
 * no special case" precedent for `combineAlliancePicks`): `statusRaw` itself
 * is `null` (no status ever recorded), `statusRaw` is present but is not
 * valid JSON (defensive — `JSON.stringify` always produces valid JSON, so
 * this branch should be unreachable against real ingested data, but a
 * `JSON.parse` is never trusted to succeed without a `try`/`catch` here),
 * and `statusRaw` parses as JSON but does not satisfy `AllianceStatusSchema`
 * (a `playoff_type` shape this pipeline has not modelled — RESEARCH.md Q2's
 * observed values 0/4/8/10 vary in shape). No default of `{wins: 0, losses:
 * 0, ties: 0}` is ever substituted for any of these — that would fabricate
 * a real-looking playoff result for an alliance whose record is genuinely
 * unknown to this pipeline.
 */
export function parseAllianceRecord(statusRaw: string | null): { wins: number; losses: number; ties: number } | null {
  if (statusRaw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(statusRaw);
  } catch {
    return null;
  }
  const result = AllianceStatusSchema.safeParse(parsed);
  return result.success ? result.data.record : null;
}
