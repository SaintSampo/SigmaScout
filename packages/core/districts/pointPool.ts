/**
 * How many district points ONE district-tier event still has to hand out.
 *
 * This is the arithmetic behind the pooled remaining-points lock, the second
 * proof of `"locked"` that `locks.ts` gained from "District Points Analysis:
 * Mathematical Locks for Advancement" (Liatys and Papa, 2024, frclocks.com).
 * The shipped ceiling test treats every rival's ceiling as independently
 * reachable, so a district with 40 teams still to play reads as 40 x 83 points
 * of threat. Points are CONSERVED inside an event: one team's qualification
 * points are another team's loss, and the whole event has a fixed pool
 * regardless of how many teams want it. This module computes that pool.
 *
 * ---------------------------------------------------------------------------
 * EVERY CONSTANT BELOW IS MEASURED, NOT QUOTED
 * ---------------------------------------------------------------------------
 *
 * The white paper states four pool values. Two of them are wrong for this
 * corpus, and they were checked before any of this code was written rather
 * than after it shipped. Read-only against `data/corpus.sqlite` on 2026-09-25,
 * over all 951 district-tier events of 2016 to 2026, summing each event's
 * `district_rankings.event_points_raw` components over every team:
 *
 *   category      paper   highest total ever handed out    events over the paper's value
 *   qualification sum f(r,m) - m*f(m,m)   see below        38 of 951 over sum f(r,m) ALONE
 *   selection     236     236                               0
 *   playoffs      213     212                               0
 *   awards, 0 rookies     63      78                      all but a handful
 *   awards, 1 rookie      71      86                      likewise
 *   awards, 2+ rookies    76      91                      likewise
 *
 * `pointPool.reconciliation.test.ts` re-derives that census on every run in a
 * checkout that has the corpus, so these constants cannot drift from the data
 * without a red test. `pointPool.test.ts` is the pure half CI actually runs.
 *
 * THE AWARD POOL KEEPS THE IMPACT AWARD'S POINTS. The paper excludes them
 * because the Impact winner qualifies by award and its slot is separately
 * reserved (quick task 260925-ms7). That reservation withholds a SLOT. The
 * winner's ten POINTS are still in its published total and still rank it, and
 * before the award is posted that winner is still sitting in the points pool as
 * a rival. Excluding them would understate the pool by ten at every event with
 * an award still to come, and understating the pool is the one direction this
 * module must never err in. The measured maxima above include Impact, and the
 * rookie structure they show is exactly the paper's own: a base, plus 8 when at
 * least one rookie attends (Rookie All Star), plus 5 more when at least two do
 * (Rookie Inspiration, which no single team can win alongside Rookie All Star).
 * Only the base differs, 78 rather than 63.
 *
 * ---------------------------------------------------------------------------
 * THE GUARANTEED LAST PLACE ADJUSTMENT IS DELIBERATELY NOT APPLIED
 * ---------------------------------------------------------------------------
 *
 * The paper subtracts `m * f(m, m)` from the qualification pool — the points
 * every attendee is guaranteed by finishing last — and adds the same `f(m, m)`
 * to every attendee's floor before ranking. Do both or neither. This module
 * does NEITHER, for a measured reason.
 *
 * The attendee count `m` available to a corpus-free reader is the district
 * artifact's own row count for that event. A real field can be LARGER: a team
 * from outside the district may attend a district event, take a rank, earn no
 * district points and appear in no `district_rankings` row. A district team at
 * rank `r` in a field of `M > m` earns `f(r, M) >= f(r, m)`, so the real
 * qualification total can exceed `sum_{r=1..m} f(r, m)`. Measured, it does, at
 * 38 of the 951 events, by up to 10 points (`2017vabla`, 29 rows, 382 reported
 * against 372 computed).
 *
 * `qualificationPool` therefore evaluates `f` at `m + PHANTOM_ATTENDEES` and
 * does not subtract the guaranteed baseline. Measured, a margin of 2 phantom
 * attendees already leaves zero events over; 3 is what ships. Subtracting
 * `m * f(m, m)` on top would take roughly 148 points per event back out and
 * reopen that hole fourteen times wider, so the un-subtracted baseline is kept
 * as the margin that covers the unknown field size, and no floor bonus is added
 * to any team anywhere.
 *
 * ---------------------------------------------------------------------------
 * SCOPE
 * ---------------------------------------------------------------------------
 *
 * DISTRICT TIER ONLY, unweighted. The pooled lock is asked about the DCMP slot
 * race, whose input is `maxRemainingDistrict` — regular-tier events alone. A
 * district championship's own pool belongs to the champ tier, against a
 * different slot pool, and this module deliberately models none of it.
 *
 * A browser-safe leaf module: its imports are the `./qualPoints.js`,
 * `./selectionPoints.js`, `./bracket.js` and `./reservedSlots.js` siblings, so
 * no DOM and no Node built-in enters its graph and the Worker, the Node
 * pipeline and the browser bundle can all take it.
 */
import { PLAYOFF_PLACEMENT_POINTS } from "./bracket.js";
import { qualPoints } from "./qualPoints.js";
import { selectionPoints } from "./selectionPoints.js";
import type { DistrictCategoryFinality } from "./reservedSlots.js";

/** Thrown for a field size or rookie count that cannot describe a real district event. Thrown rather than returning 0: a silent 0 here shrinks the pool, which is the direction that publishes a guarantee that is not true. */
export class InvalidPoolInputError extends Error {
  constructor(message: string) {
    super(`pointPool: ${message}`);
    this.name = "InvalidPoolInputError";
  }
}

/**
 * How many teams beyond the artifact's own row count `qualificationPool`
 * assumes the real field held — the margin that covers a non-district team
 * attending a district event and taking a rank without appearing in
 * `district_rankings`.
 *
 * Measured over 951 district-tier events: at 0 the real qualification total
 * exceeds the computed pool at 38 events (by up to 10 points), at 1 it exceeds
 * at one event (by 2), and at 2 it never does. 3 ships.
 */
export const QUAL_POOL_PHANTOM_ATTENDEES = 3;

/** This model's alliance field — the same eight-alliance scope `selectionPoints.ts` declares. */
const ALLIANCE_COUNT = 8;
/** The three pick slots that are worth points; slot 3, a backup robot, earns nothing. */
const SCORING_PICK_SLOTS = [0, 1, 2] as const;

/**
 * Every alliance selection point a district event hands out: the eight
 * captains, the eight first picks and the eight second picks.
 *
 * COMPUTED FROM `selectionPoints.ts` at module load, never typed as a literal.
 * The paper states 236 and so does this sum (100 for the captains, 100 for the
 * first picks, 36 for the second picks), but the arithmetic that matters is the
 * shipped formula's, not the paper's — that formula has already been got wrong
 * once, and `selectionPoints.ts`' own header records it.
 */
export const SELECTION_POOL: number = (() => {
  let total = 0;
  for (let allianceNumber = 1; allianceNumber <= ALLIANCE_COUNT; allianceNumber++) {
    for (const pickSlot of SCORING_PICK_SLOTS) total += selectionPoints(pickSlot, allianceNumber);
  }
  return total;
})();

/**
 * Three points of headroom over the eight-alliance placement table, for the
 * prorated value a BACKUP ROBOT can put in a fourth pick slot.
 *
 * `bracket.ts`'s own header names the three 2026 events (`2026njtab`,
 * `2026mawor`, `2026waahs`) whose backup robot broke the exact placement
 * multiset, so the effect is real rather than hypothetical. Measured, the
 * highest playoff total ever handed out at a district event is 212, which is
 * inside the 213 this constant produces.
 */
const BACKUP_ROBOT_MARGIN = 3;

/** How many robots share one alliance's placement points. */
const ROBOTS_PER_ALLIANCE = 3;

/**
 * Every playoff point a district event hands out: each of the eight
 * placements' value, paid to three robots, plus the backup robot margin.
 * Derived from `PLAYOFF_PLACEMENT_POINTS` so a change to the placement table
 * cannot leave a stale pool behind.
 */
export const PLAYOFF_POOL: number =
  PLAYOFF_PLACEMENT_POINTS.reduce((sum, points) => sum + points, 0) * ROBOTS_PER_ALLIANCE + BACKUP_ROBOT_MARGIN;

/**
 * The highest award total ever handed out at a district event where NO rookie
 * attended — measured, 78, at `2019vahay` among 188 such events.
 */
export const AWARD_POOL_BASE = 78;
/** What a first attending rookie adds: the Rookie All Star award. Measured as the 0-rookie to 1-rookie gap, 86 - 78. */
export const AWARD_POOL_FIRST_ROOKIE = 8;
/** What a second attending rookie adds: Rookie Inspiration, which the Rookie All Star winner cannot also take. Measured as the 1-rookie to 2-rookie gap, 91 - 86. */
export const AWARD_POOL_SECOND_ROOKIE = 5;

/**
 * Every district award point an event with `rookieCount` attending rookies can
 * hand out, Impact included.
 *
 * Flat above two rookies: a third rookie unlocks no further award, because the
 * two rookie-restricted awards are already both reachable. Measured, no
 * district event in the corpus ever exceeded the value this returns.
 */
export function awardPool(rookieCount: number): number {
  if (!Number.isInteger(rookieCount) || rookieCount < 0) {
    throw new InvalidPoolInputError(`rookieCount must be a non-negative integer, got ${rookieCount}`);
  }
  return AWARD_POOL_BASE + (rookieCount >= 1 ? AWARD_POOL_FIRST_ROOKIE : 0) + (rookieCount >= 2 ? AWARD_POOL_SECOND_ROOKIE : 0);
}

/**
 * Every qualification point a district event with `fieldSize` known attendees
 * can hand out: `f(1)` through `f(fieldSize)`, each evaluated at a field of
 * `fieldSize + QUAL_POOL_PHANTOM_ATTENDEES`.
 *
 * `f` is `qualPoints.ts`'s `qualPoints`, the game manual's own formula, and it
 * is monotonically non-increasing in rank, so this sum is the pool a field of
 * that size is worth. See this file's header for why the evaluation field size
 * is larger than the summed rank range and why the guaranteed last place value
 * is not subtracted back out.
 */
export function qualificationPool(fieldSize: number): number {
  if (!Number.isInteger(fieldSize)) throw new InvalidPoolInputError(`fieldSize must be an integer, got ${fieldSize}`);
  if (fieldSize < 1) throw new InvalidPoolInputError(`fieldSize must be at least 1, got ${fieldSize}`);
  const evaluationField = fieldSize + QUAL_POOL_PHANTOM_ATTENDEES;
  let total = 0;
  for (let rank = 1; rank <= fieldSize; rank++) total += qualPoints(rank, evaluationField);
  return total;
}

/** One district-tier event, as `eventRemainingPool` needs to see it at the position being evaluated. */
export interface EventPoolInput {
  /** How many teams the district artifact shows attending this event. */
  readonly fieldSize: number;
  /** How many of those attendees are in their rookie season. An unknown rookie status counts as a rookie — see `pooledLockInputs.ts`. */
  readonly rookieCount: number;
  /** Which of the four categories are already FINAL at the position. An open category contributes its whole pool. */
  readonly final: DistrictCategoryFinality;
}

/**
 * How many district points this event still has to hand out at the position:
 * the pool of every category that is not yet final there.
 *
 * A PARTLY PLAYED CATEGORY CONTRIBUTES ITS WHOLE POOL. Half the qualification
 * matches being played does not halve the qualification pool in any way this
 * module can compute without the event's own ranking, and over-counting is the
 * safe direction for a guarantee: a bigger remaining pool makes the pooled lock
 * fire LESS often, never more.
 *
 * An event with every category final returns 0, which is every event of a
 * finished season.
 */
export function eventRemainingPool(event: EventPoolInput): number {
  let total = 0;
  if (!event.final.qual) total += qualificationPool(event.fieldSize);
  if (!event.final.alliance) total += SELECTION_POOL;
  if (!event.final.elim) total += PLAYOFF_POOL;
  if (!event.final.award) total += awardPool(event.rookieCount);
  return total;
}

/** True when any of the four categories is still open — the event can still move somebody's total. */
export function eventHasOpenCategory(final: DistrictCategoryFinality): boolean {
  return !final.qual || !final.alliance || !final.elim || !final.award;
}
