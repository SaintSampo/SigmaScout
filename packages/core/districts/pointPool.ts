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
 * ---------------------------------------------------------------------------
 * THE MOST THE PAY RULE CAN PAY (quick task 261013-lve)
 * ---------------------------------------------------------------------------
 *
 * The playoff pool below is the placement table times three robots plus a
 * measured margin of 3, so 213: one above the highest total ever handed out.
 * The pooled lock treats the pool as an UPPER BOUND, and a measured maximum
 * is not one. TBA's pay rule is known exactly since quick task 261012-mw2
 * (`securedPlayoffPoints.ts`, fitted to 11,991 paid values), and under it an
 * event CAN pay more than 213. `mostPlayoffPointsPaid` below is the most it
 * can pay. AT THIS COMMIT `PLAYOFF_POOL` IS STILL THE MEASURED 213: the next
 * commit of the same quick task sets the pool from this bound.
 *
 * THE DERIVATION, in a few lines. An alliance's table points are shared among
 * its robots by the wins each was on the field for, and each robot's share is
 * rounded UP. Three robots are credited per win, so the shares before
 * rounding sum to exactly three times the alliance's points; every point
 * above that is rounding, and rounding needs a robot with a part share, which
 * needs a FOURTH robot. With at most four robots on an alliance:
 *
 *   finalist or champion, 20 over 3 semifinal wins: 20 + 14 + 14 + 14 = 62
 *     (one robot on the field for all three wins, three for two each); over 4
 *     wins every share is a multiple of 5 and the alliance is paid 60
 *   third place, 13 over 2 or 3 wins:               13 + 13 + 9 + 5   = 40
 *   fourth place, 7 over 2 wins:                    7 + 7 + 4 + 4     = 22
 *   the champion's two Finals wins, 5 a robot a win, since 2024:        30
 *
 *   since 2024:  (62 + 30) + 62 + 40 + 22 = 216
 *   in 2023:     90 + 62 + 40 + 22        = 214   (the title's 10 joined the
 *     shared points, and 30 over 5 or 6 wins never leaves a part share)
 *
 * Both finalists can hold their 20 over three wins at once (the upper final's
 * winner, and its loser back through the lower final), so the sum is reached:
 * it is the exact maximum and not only a bound. `mostPlayoffPointsPaid`
 * computes it from the bracket table and the pay tables rather than from the
 * lines above: every alliance leaves the bracket at exactly one of eight
 * places (the loser of one of six lower bracket sets, the finalist, the
 * champion), each place takes exactly one alliance, and the event's total is
 * therefore at most the sum over the places of the most an alliance leaving
 * there can be paid.
 *
 * WHAT THE PROOF RESTS ON, each held by a test:
 *   1. TBA's pay rule as declared per season. It is TBA's and not this code's
 *      (`securedPlayoffPoints.ts` says what that means). The corpus gate
 *      holds the rule equal to every paid value.
 *   2. The eight alliance bracket (`bracket.ts`).
 *   3. At most THREE robots are credited for one decisive row. Measured:
 *      7,540 of 7,540 decisive rows of 2023 to 2026.
 *   4. At most FOUR robots are paid on one alliance: its three picks and one
 *      backup. It is FIRST's rule (an alliance has one opportunity to bring
 *      in a backup; `champJointLock.ts`, THE BACKUP ROBOT RULE, quotes the
 *      manual and the alliance selection script, and the Champ Locks joint
 *      proof already rests on it). Measured over the 3,968 alliances of the
 *      507 events of 2023 to 2026: 132 hold a win at four robots and none at
 *      five, and no alliance list names more than four (351 name four). THIS
 *      ONE MATTERS, and these are the numbers that are NOT taken: with five
 *      robots an alliance the same pay rule could pay 217 under the 2023
 *      rule and 220 since 2024, and with no limit on the roster 222 and 225.
 *      `scripts/securedPlayoffCorpus.test.ts` fails if an alliance is ever
 *      paid at five robots or a row credits four.
 *   5. A losing finalist is paid nothing for a Finals match it won. That is
 *      the pay rule (329 of 329 such robots), and it is NOT the per team
 *      ceiling `bracket.ts` keeps for second place (25, the manual's
 *      wording). The two are different bounds and neither feeds the other.
 *
 * THE SEARCH THAT SHARES NO CODE WITH THE DERIVATION (`pointPool.test.ts`):
 * every one of the 32,768 ways a bracket can end, every lineup of a roster of
 * four for each alliance, asked only of `playoffPointsPaid`. It never reads
 * above `mostPlayoffPointsPaid` and it reaches it, for every registered
 * season. A registered season with no declared rule, or a declared rule the
 * search does not reach the bound for, fails that test.
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
 * `./selectionPoints.js`, `./bracket.js`, `./reservedSlots.js` and
 * `./securedPlayoffPoints.js` siblings, so no DOM and no Node built-in enters
 * its graph and the Worker, the Node pipeline and the browser bundle can all
 * take it. Through the last of them the Worker bundles the pay rule's tables
 * since quick task 261013-lve; it still credits nothing from that module.
 */
import { BRACKET_SETS, PLAYOFF_PLACEMENT_POINTS } from "./bracket.js";
import { qualPoints } from "./qualPoints.js";
import { selectionPoints } from "./selectionPoints.js";
import type { DistrictCategoryFinality } from "./reservedSlots.js";
import { FINALS_WIN_POINTS, SEMIFINAL_WIN_POINTS, proratedPlayoffPoints, type PlayoffPayRule } from "./securedPlayoffPoints.js";

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
 * The most robots TBA pays on one alliance: its three picks and one backup
 * robot. Premise 4 of this file's header, measured and held by
 * `scripts/securedPlayoffCorpus.test.ts`. The bound is proven for this many
 * and for no more.
 */
export const MOST_ROBOTS_PAID_PER_ALLIANCE = 4;

/** How many robots one decisive playoff row is credited to: the three on the field for the winner. Premise 3 of this file's header. */
export const ROBOTS_CREDITED_PER_WIN = 3;

/**
 * The most the robots of ONE alliance can be paid together where `points` are
 * shared by wins over `wins` wins: each robot is paid `points` times its own
 * wins over `wins`, rounded up (`proratedPlayoffPoints`, TBA's rounding),
 * `ROBOTS_CREDITED_PER_WIN` robots are credited per win, and the alliance has
 * at most `robots` robots.
 *
 * Every split of the credited wins among the robots is tried (a robot holds
 * from none to all of the alliance's wins), so the result is the exact
 * maximum over lineups and not an estimate. Any such split is a real lineup:
 * with four robots, pick who sits each win.
 */
export function mostSharedByWins(points: number, wins: number, robots: number = MOST_ROBOTS_PAID_PER_ALLIANCE): number {
  if (points <= 0 || wins <= 0 || robots <= 0) return 0;
  const credited = ROBOTS_CREDITED_PER_WIN * wins;
  // best[c] = the most the robots dealt with so far can be paid while holding c credited wins between them.
  let best: number[] = new Array<number>(credited + 1).fill(-Infinity);
  best[0] = 0;
  for (let robot = 0; robot < robots; robot++) {
    const next: number[] = new Array<number>(credited + 1).fill(-Infinity);
    for (let held = 0; held <= credited; held++) {
      const soFar = best[held]!;
      if (soFar === -Infinity) continue;
      for (let own = 0; own <= wins && held + own <= credited; own++) {
        const total = soFar + proratedPlayoffPoints(points, own, wins);
        if (total > next[held + own]!) next[held + own] = total;
      }
    }
    best = next;
  }
  // A robot paid for more wins is never paid less, so the most sits where every credited win is held. The largest
  // entry is read so that fewer robots than a full field, which cannot hold every credited win, still read their most.
  let most = 0;
  for (const total of best) if (total > most) most = total;
  return most;
}

/** One way an alliance's playoffs can end: where it left the bracket, and the table points and semifinal wins it left with. */
interface AllianceExit {
  /** The set whose loss put the alliance out, `"finalist"` or `"champion"`. Each takes exactly one alliance. */
  readonly place: string;
  readonly points: number;
  readonly semifinalWins: number;
}

const FINAL_SET_ID = "f";

/** Every way one alliance can leave the eight alliance bracket, walked from each seed down `BRACKET_SETS`' own feeds. */
function allianceExits(): readonly AllianceExit[] {
  const nextSet = (kind: "winner" | "loser", setId: string): string | undefined =>
    BRACKET_SETS.find((set) => (set.feedA.kind === kind && set.feedA.setId === setId) || (set.feedB.kind === kind && set.feedB.setId === setId))?.id;
  const exits: AllianceExit[] = [];
  const walk = (setId: string, points: number, semifinalWins: number): void => {
    if (setId === FINAL_SET_ID) {
      exits.push({ place: "finalist", points, semifinalWins }, { place: "champion", points, semifinalWins });
      return;
    }
    const afterLoss = nextSet("loser", setId);
    if (afterLoss === undefined) exits.push({ place: setId, points, semifinalWins });
    else walk(afterLoss, points, semifinalWins);
    const afterWin = nextSet("winner", setId);
    // Every semifinal set's winner plays on. A dropped path would SHRINK the bound: the unit test holds the bound at
    // three robots equal to the placement table times three, which a dropped path breaks.
    if (afterWin !== undefined) walk(afterWin, points + (SEMIFINAL_WIN_POINTS[setId] ?? 0), semifinalWins + 1);
  };
  for (const set of BRACKET_SETS) {
    if (set.feedA.kind === "seed") walk(set.id, 0, 0);
    if (set.feedB.kind === "seed") walk(set.id, 0, 0);
  }
  return exits;
}

/** How many wins take the Finals: two of the best of three. */
const FINALS_WINS_NEEDED = Math.floor((BRACKET_SETS.find((set) => set.id === FINAL_SET_ID)?.bestOf ?? 3) / 2) + 1;

/** The most the robots of an alliance that left the bracket this way can be paid together under `rule`. */
function mostPaidAtExit(rule: PlayoffPayRule, exit: AllianceExit, robots: number): number {
  const champion = exit.place === "champion";
  if (rule === "allWins") {
    // 2023: the title's points join the shared points, and every win, Finals wins included, shares them.
    if (champion) return mostSharedByWins(exit.points + FINALS_WINS_NEEDED * FINALS_WIN_POINTS, exit.semifinalWins + FINALS_WINS_NEEDED, robots);
    if (exit.place !== "finalist") return mostSharedByWins(exit.points, exit.semifinalWins, robots);
    // A finalist lost the Finals with any number of wins short of the title, each of which dilutes or not: the most over them.
    let most = 0;
    for (let finalsWins = 0; finalsWins < FINALS_WINS_NEEDED; finalsWins++) most = Math.max(most, mostSharedByWins(exit.points, exit.semifinalWins + finalsWins, robots));
    return most;
  }
  // Since 2024: the semifinal points are shared by semifinal wins, and each Finals win pays the champion's robots on the field for it.
  const shared = mostSharedByWins(exit.points, exit.semifinalWins, robots);
  return champion ? shared + FINALS_WINS_NEEDED * Math.min(robots, ROBOTS_CREDITED_PER_WIN) * FINALS_WIN_POINTS : shared;
}

/**
 * THE MOST PLAYOFF POINTS ONE EIGHT ALLIANCE EVENT CAN PAY ALL ITS ROBOTS
 * TOGETHER under `rule` (base points, unweighted), over every way the
 * bracket can end and every lineup of alliances of at most `robots` robots.
 * This file's header carries the derivation and what it rests on.
 *
 * Every alliance leaves at exactly one place and each place takes exactly
 * one alliance, so the total is at most the sum over the places of the most
 * an alliance leaving there can be paid. `pointPool.test.ts` shows by a
 * search that shares no code with this function that the sum is reached.
 *
 * With `robots` at 3 no share is ever rounded and the result is the
 * placement table times three, 210.
 */
export function mostPlayoffPointsPaid(rule: PlayoffPayRule, robots: number = MOST_ROBOTS_PAID_PER_ALLIANCE): number {
  const mostByPlace = new Map<string, number>();
  for (const exit of allianceExits()) {
    mostByPlace.set(exit.place, Math.max(mostByPlace.get(exit.place) ?? 0, mostPaidAtExit(rule, exit, robots)));
  }
  let total = 0;
  for (const most of mostByPlace.values()) total += most;
  return total;
}

/**
 * `mostPlayoffPointsPaid` for every pay rule a season can declare. A `Record`
 * over the rule type, so a new rule cannot be added to
 * `securedPlayoffPoints.ts` without the typecheck asking for its line here.
 */
export const MOST_PLAYOFF_POINTS_PAID_BY_RULE: Readonly<Record<PlayoffPayRule, number>> = {
  allWins: mostPlayoffPointsPaid("allWins"),
  semifinalWins: mostPlayoffPointsPaid("semifinalWins"),
};

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
