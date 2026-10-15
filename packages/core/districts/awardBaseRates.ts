/**
 * DISTRICT AWARD VOCABULARY: the shared words every award reader uses, the
 * decoration buckets, the rookie state, the class key, the district point
 * award values and the award point support.
 *
 * WHAT THIS FILE NO LONGER HOLDS. Until quick task 261014-qje it carried the
 * per team award BASE RATE tables (per season, the chance a team earned any
 * award points at a district event, by decoration bucket and rookie state) and
 * their lookup, the `{1, 2, 14}` exclusion set and the decoration window
 * helpers. Those were replaced by the one award slate (`awardSlate.ts`), which
 * prices district events and District Championships alike; the tables, the
 * lookup and `scripts/measureDistrictAwardBaseRates.ts` were deleted then.
 *
 * Zero runtime imports and no I/O. No award prediction anywhere near
 * `locks.ts`: a Locked verdict stays a guarantee.
 */

/** How decorated a team already was, by its count of prior judged awards. */
export type DecorationBucket = "none" | "one-or-two" | "three-or-more";

/** The three buckets in print order. */
export const DECORATION_BUCKETS: readonly DecorationBucket[] = ["none", "one-or-two", "three-or-more"];

/**
 * A team's rookie status in the scored season. `"unknown"` is its OWN state,
 * never folded into `"veteran"`: TBA reports a null `rookie_year` for real
 * teams, and folding an absence into a value is a guess.
 */
export type RookieState = "rookie" | "veteran" | "unknown";

/** The three rookie states in print order. */
export const ROOKIE_STATES: readonly RookieState[] = ["rookie", "veteran", "unknown"];

/**
 * THE DISTRICT POINT AWARDS (quick task 261014-mii, decision M-01): every TEAM
 * award that pays district points at a district event, mapped to the points it
 * pays there before the tier weight. A decoration is one of these and nothing
 * else. Asserted by equality on its sorted entries in the test.
 *
 *   10 points:  0 Impact (Chairman's before 2022).
 *    8 points:  9 Engineering Inspiration, 10 Rookie All Star.
 *    5 points: 11 Gracious Professionalism, 13 Judges', 15 Rookie Inspiration,
 *              16 Industrial Design, 17 Quality, 18 Safety (paid at district
 *              events 2016 to 2020), 20 Creativity, 21 Excellence in
 *              Engineering, 22 Entrepreneurship, 27 Imagery, 29 Innovation in
 *              Control, 30 Team Spirit, 71 Autonomous, 82 Team Sustainability,
 *              83 Rising All Star.
 *
 * NOT a decoration, seen at district tier events and paying 0 there: 1 Winner,
 * 2 Finalist, 4 Dean's List Finalist and Semi Finalist, 5 Volunteer of the
 * Year, 14 Highest Rookie Seed.
 *
 * NOT a decoration, never seen at a district tier event (no district points):
 * 3 Woodie Flowers Finalist, 6 Volunteer Award, 8 Appreciation, 23 Design
 * Excellence, 28 Pitch Perfect, 31 and 51 Community Catalyst, 39 Number 1
 * Seed, 40 Best Scoring, 49 Against All Odds, 54 Forte Teleop, 60 Community
 * Member, 63 Play of the Day, 64 Programming, 65 Professionalism, 67 Most
 * Improved Team, 68 Wildcard, 69 Impact Finalist, 70 Community Engagement, 74
 * and 75 Human Match Winner and Finalist, 77 Engineering Design, 79 Fathom
 * Award for End Game.
 *
 * THE CENSUS BEHIND IT: `districtPointAwardCensus` in
 * `scripts/measureAwardSlate.ts` sums these values over each
 * district tier team event's distinct award types and compares the sum with
 * the `award_points` TBA recorded, 2016 to 2026; its corpus guarded test
 * asserts 0 mismatches, every listed type paying exactly its value as a team's
 * only award, and every unlisted type paying 0 as a team's only award.
 *
 * WHY A POSITIVE LIST: an award type FIRST adds later is excluded until someone
 * shows it pays points, instead of counting silently because nobody added it
 * to an exclusion set.
 */
export const DISTRICT_POINT_AWARD_VALUES: ReadonlyMap<number, number> = new Map([
  [0, 10],
  [9, 8],
  [10, 8],
  [11, 5],
  [13, 5],
  [15, 5],
  [16, 5],
  [17, 5],
  [18, 5],
  [20, 5],
  [21, 5],
  [22, 5],
  [27, 5],
  [29, 5],
  [30, 5],
  [71, 5],
  [82, 5],
  [83, 5],
]);

/**
 * The award-point values a district-tier team-event can take, in order. Index 5
 * means "15 OR MORE": 15 is `pointModel.ts`'s declared district-tier award
 * ceiling and the highest stack ever observed, but the bin is open on the right
 * so a future stack cannot silently fall outside the support.
 */
export const AWARD_POINT_SUPPORT: readonly number[] = [0, 5, 8, 10, 13, 15];

/**
 * The fewest observations a class needs before a measured number is stated
 * for it: the award slate's class lift bar (Q-06). Below it the class prints
 * CANNOT BE SCORED and the lookup falls back up the stated hierarchy.
 */
export const MIN_CELL_OBSERVATIONS = 100;

/**
 * Which rung of a class fallback a lookup landed on: the exact class
 * (`"cell"`), its primary key pooled (`"bucket-pooled"`), or the whole slot at
 * lift 1 (`"season-pooled"`). The award slate's lift lookup reports it, so the
 * drawer can say which rung a cell rests on.
 */
export type AwardBaseRateSource = "cell" | "bucket-pooled" | "season-pooled";

/** The cell key, in one place so the script and the module cannot disagree about it. */
export function cellKey(bucket: DecorationBucket, rookieState: RookieState): string {
  return `${bucket}|${rookieState}`;
}

/**
 * A decoration count to its bucket. The two boundaries (0 to 1 and 2 to 3) are
 * asserted explicitly in the test, because an off-by-one there silently
 * relabels a third of the population.
 */
export function decorationBucket(priorJudgedAwardCount: number): DecorationBucket {
  if (priorJudgedAwardCount <= 0) return "none";
  if (priorJudgedAwardCount <= 2) return "one-or-two";
  return "three-or-more";
}

/**
 * A team's rookie state in `season`. `null`/`undefined` is `"unknown"` and is
 * reported separately — never folded into `"veteran"`.
 */
export function rookieStateFor(rookieYear: number | null | undefined, season: number): RookieState {
  if (rookieYear === null || rookieYear === undefined || !Number.isFinite(rookieYear)) return "unknown";
  return rookieYear >= season ? "rookie" : "veteran";
}

/**
 * An observed `award_points` value to its support index, or `undefined` for a
 * value the support does not model. `undefined` is the honest signal: silently
 * rounding an unmodelled value into a neighbouring bucket is how a real data
 * shape disappears, so the script reports every one in an UNMODELLED VALUES
 * census instead.
 *
 * Anything at or above 15 is index 5, the open-on-the-right top bin.
 */
export function awardPointsBucketIndex(points: number): number | undefined {
  if (!Number.isFinite(points)) return undefined;
  if (points >= 15) return AWARD_POINT_SUPPORT.length - 1;
  const index = AWARD_POINT_SUPPORT.indexOf(points);
  return index === -1 ? undefined : index;
}
