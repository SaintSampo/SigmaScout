/**
 * The districts normalize rule (quick task 260905-lic Task 1): turns TBA's
 * `/districts/{year}` and `/district/{key}/rankings` responses into
 * per-district and per-team-ranking arrays, or an honest empty array when
 * TBA has nothing to report for either. Pure, no I/O and no corpus import --
 * mirrors `alliances.ts` / `rankings.ts`'s contract exactly.
 *
 * The load-bearing rule, shared by both functions below: the WHOLE response
 * can be a bare `null` body (a district-year or district with nothing set up
 * at all -- mirrors the null-body cases `alliances.ts`/`rankings.ts` already
 * handle) and separately the array can be genuinely empty. Both are real,
 * distinct "nothing to report" answers, never coerced into each other and
 * never thrown on -- this module returns `[]` for either.
 */
import type { TbaDistrictListElement, TbaDistrictRankingsResponse } from "./schemas.js";

/** Every non-key field `upsertDistrict` takes, under this task's exact property names. `fetchedAt` is deliberately absent: the caller supplies it, exactly as `NormalizedEventAlliance` omits `eventKey`/`fetchedAt`. */
export interface NormalizedDistrict {
  districtKey: string;
  year: number;
  abbreviation: string;
  displayName: string;
  dcmpSlots: number | null;
  cmpSlots: number | null;
}

/**
 * Normalizes a (possibly null) TBA `/districts/{year}` response into
 * per-district records. Returns `[]` for a `null` or empty body rather than
 * throwing.
 *
 * `districtKey` is TBA's own year-prefixed `key` field (e.g. "2026fnc") --
 * distinct from `abbreviation` (e.g. "fnc"), which is the same abbreviation
 * `events.district_key` separately stores on a different table for a
 * different purpose (schema.sql's `districts` table doc comment explains the
 * distinction in full). A district-year missing
 * `official_advancement_counts` normalizes to `{ dcmpSlots: null, cmpSlots:
 * null }`, never `0` -- a null slot count is a real, honest "capacity not
 * published" answer, not a parse gap, and this function must never invent
 * one.
 */
export function normalizeDistricts(response: TbaDistrictListElement[] | null): NormalizedDistrict[] {
  if (response === null || response.length === 0) return [];
  return response.map((d) => ({
    districtKey: d.key,
    year: d.year,
    abbreviation: d.abbreviation,
    displayName: d.display_name,
    dcmpSlots: d.official_advancement_counts?.dcmp ?? null,
    cmpSlots: d.official_advancement_counts?.cmp ?? null,
  }));
}

/** Every non-key field `upsertDistrictRanking` takes, under this task's exact property names. `districtKey` and `fetchedAt` are deliberately absent: the caller supplies both. */
export interface NormalizedDistrictRanking {
  teamKey: string;
  rank: number;
  pointTotal: number;
  rookieBonus: number;
  adjustments: number;
  /**
   * TBA's `event_points` array, `JSON.stringify`'d verbatim -- the exact
   * provenance discipline `matches.score_breakdown_raw` / `event_alliances.
   * status_raw` already carry. `rookie_bonus`/`adjustments` pass through as
   * TBA sent them; nothing here re-derives or bounds any of these values --
   * that is Task 2's job.
   */
  eventPointsRaw: string;
}

/**
 * Normalizes a (possibly null) TBA `/district/{key}/rankings` response into
 * per-team records. Returns `[]` for a `null` body or an empty array -- both
 * are real, distinct "nothing to report" answers (a district with no
 * rankings computed yet vs. one whose rankings array is genuinely empty),
 * never coerced into each other and never thrown on.
 */
export function normalizeDistrictRankings(response: TbaDistrictRankingsResponse): NormalizedDistrictRanking[] {
  if (response === null || response.length === 0) return [];
  return response.map((r) => ({
    teamKey: r.team_key,
    rank: r.rank,
    pointTotal: r.point_total,
    rookieBonus: r.rookie_bonus,
    adjustments: r.adjustments,
    eventPointsRaw: JSON.stringify(r.event_points),
  }));
}
