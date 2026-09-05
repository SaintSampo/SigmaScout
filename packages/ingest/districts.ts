/**
 * The districts normalize rule (quick task 260905-lic Task 1; widened by
 * revision R2a): turns TBA's `/districts/{year}`, `/district/{key}/rankings`
 * and `/event/{key}/awards` responses into per-district, per-team-ranking and
 * per-award-recipient arrays, or an honest empty array when TBA has nothing
 * to report for any of the three. Pure, no I/O and no corpus import -- mirrors
 * `alliances.ts` / `rankings.ts`'s contract exactly.
 *
 * The load-bearing rule, shared by every function below: the WHOLE response
 * can be a bare `null` body (a district-year, district or event with nothing
 * set up at all -- mirrors the null-body cases `alliances.ts`/`rankings.ts`
 * already handle) and separately the array can be genuinely empty. Both are
 * real, distinct "nothing to report" answers, never coerced into each other
 * and never thrown on -- this module returns `[]` for either.
 */
import type { TbaDistrictListElement, TbaDistrictRankingsResponse, TbaEventAwardsResponse } from "./schemas.js";

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

/**
 * The four TBA `award_type` values the award-based qualification model
 * (`packages/core/districts/qualification.ts`) reads (revision R2a,
 * RESEARCH-awards.md Q4): `0` Chairman's/FIRST Impact, `1` Winner, `9`
 * Engineering Inspiration, `10` Rookie All Star. Every other award_type
 * (Finalist, Wildcard, Dean's List, judged awards, ...) is not
 * qualification-relevant and is dropped right here, at the normalize
 * boundary -- `schema.sql`'s `event_awards` table doc comment states this
 * same rule as its own contract ("store only award types 0, 1, 9, 10").
 */
export const QUALIFICATION_RELEVANT_AWARD_TYPES: ReadonlySet<number> = new Set([0, 1, 9, 10]);

/** Every non-key field `upsertEventAward` takes, under this task's exact property names. `eventKey`/`year`/`fetchedAt` are deliberately absent: the caller supplies all three. */
export interface NormalizedEventAward {
  awardType: number;
  teamKey: string;
}

/**
 * Normalizes a (possibly null) TBA `/event/{key}/awards` response into
 * per-recipient records (revision R2a). Filters to
 * `QUALIFICATION_RELEVANT_AWARD_TYPES` only. A recipient entry whose
 * `team_key` is `null` (a person, not a team -- TBA's own `recipient_list`
 * shape) is skipped entirely: there is nothing to key an `event_awards` row
 * on. Returns `[]` for a `null` body or an empty array -- both are real,
 * distinct "nothing to report" answers, never coerced into each other and
 * never thrown on, mirroring `normalizeDistricts`/`normalizeDistrictRankings`
 * above.
 */
export function normalizeEventAwards(response: TbaEventAwardsResponse): NormalizedEventAward[] {
  if (response === null || response.length === 0) return [];
  const result: NormalizedEventAward[] = [];
  for (const award of response) {
    if (!QUALIFICATION_RELEVANT_AWARD_TYPES.has(award.award_type)) continue;
    for (const recipient of award.recipient_list) {
      if (recipient.team_key === null) continue;
      result.push({ awardType: award.award_type, teamKey: recipient.team_key });
    }
  }
  return result;
}
