/**
 * THE JOINT WORST CASE LOCK PROOF at the Championship tier (quick task
 * 261009-2tr), generalized to divisioned and multiple championships by quick
 * task 261009-kt3. Pure, no I/O, no zod, no React; its only import is the
 * `./bracket.js` sibling.
 *
 * ---------------------------------------------------------------------------
 * THE CLAIM
 * ---------------------------------------------------------------------------
 *
 * For a team T in the points pool at a District Championship whose alliances
 * are picked, `jointLockBound(input, T)` is an upper bound on the number of
 * rivals that can take a Championship slot from T in ANY future the bracket,
 * the backup robots and the award budget still allow. A rival takes a slot from
 * T by finishing at or above T's points (ties count against T) or by
 * qualifying regardless of points (a member of the winning alliance, or a
 * consuming award winner). When the bound is below `pointsSlots` (the open
 * slots once the posted award qualifiers are removed), at most
 * `pointsSlots - 1` rivals can take a slot from T, so T qualifies.
 * `jointLockedTeams` is exactly that test. It is OR-ed with the ceiling test in
 * `locks.ts` and supersedes nothing.
 *
 * ---------------------------------------------------------------------------
 * THE FACTS ABOUT EVERY FEASIBLE FUTURE IT RESTS ON
 * ---------------------------------------------------------------------------
 *
 *   - The real winning alliance is one of `candidateWinners` (`null` is the
 *     posted winner case: its members already left the pool and the slots).
 *   - The real placements of the alive alliances other than the winner are one
 *     enumerated assignment, or are dominated by one (the monotonicity argument
 *     below).
 *   - TBA never pays a team MORE than the placement maxima 30, 25, 13 and 7
 *     times the tier weight (the 2026 manual, section 11.1.3: base points plus
 *     5 per Finals match won, up to 10). `placementPoints` carries those maxima
 *     (`maxPlayoffPointsByPlacement`), and so does a decided placement whose
 *     settled value is not exact, through the caller's `extra`. Since 2023 no
 *     TBA row sits above them; proration only lowers a value.
 *   - A rival's real points are at most `floor + extra`, plus its alliance's
 *     assigned placement value (or the value of the one seat it takes as a
 *     backup), plus the points of the one award it can receive.
 *   - At most `consumingAwards` consuming awards and `judgedAwards` judged
 *     awards are given out, and each rival receives at most
 *     `MAX_POINT_PAYING_AWARDS_PER_TEAM` point paying award: one consuming
 *     award or one judged award, never both and never two.
 *   - A winning alliance has at most `maxAllianceSize` members, and every
 *     member beyond the picked ones is a backup robot from the unpicked teams.
 *   - Each rival takes at most one slot.
 *
 * ---------------------------------------------------------------------------
 * WHY THE COUNT IS AN UPPER BOUND
 * ---------------------------------------------------------------------------
 *
 * Fix the real future. Its winner is some candidate W and its placements are
 * dominated by some enumerated assignment, so the scenario (W, assignment) is
 * one the loop visits. Every rival that takes a slot from T in that future is
 *
 *   1. a member of W (counted by step 1 of the scenario), or
 *   2. a rival whose `floor + extra + assigned value` already reaches T's floor
 *      (step 3), or otherwise one of the rivals still uncovered, X, and then
 *   3. a consuming award winner (at most C of them), or
 *   4. a backup robot on W (at most f, and only from X's unpicked part), or
 *   5. a pool rival lifted to T's floor by a seat on a losing alliance and at
 *      most one judged award, and those are at most SJ, because the real
 *      allocation of seats and judged awards is one the dynamic program below
 *      considered.
 *
 * So the real takers are at most `|covered| + min(|X|, SJ + C + min(f, |X_U|))`,
 * and the bound is the maximum of that over the scenarios.
 *
 * WHY NOT THE LITERAL GREEDY ORDER OF CONTEXT D2. A fixed order undercounts in
 * three constructed cases, which would break the argument above: a consuming
 * award spent on an unpicked rival leaves the fill in nothing (R1); the largest
 * seat given to the largest need covers one rival where the swap covers two
 * (R2); a judged award spent on an unpicked rival leaves a picked one uncovered
 * when the fill in could have taken the unpicked one (R3). The count above is
 * at least the greedy count in every case, which `champJointLock.test.ts`
 * checks against a reference greedy on 500 seeded instances.
 *
 * ---------------------------------------------------------------------------
 * THE CALLER'S READINGS (261009-2tr planner readings, locked in CONTEXT D5)
 * ---------------------------------------------------------------------------
 *
 *   - Reading 3: a prequalified team not yet award qualified takes a slot only
 *     by winning or by a consuming award, so it is a `slotOnlyRivals` entry and
 *     never passes T on points.
 *   - Reading 5: `extra` is the shipped open ceiling minus exactly the two DCMP
 *     pieces this proof models itself (the Awards ceiling while Awards are open,
 *     the Playoffs ceiling while Playoffs are open for a team with no settled
 *     value).
 *   - Reading 6: an alliance is alive for the proof when the routing has not
 *     placed it OR any member has no settled value while Playoffs are open.
 *   - Reading 8: the no alive alliance case (`candidateWinners` of `[null]`)
 *     runs only once the winner award is posted.
 *   - Reading 12: a decided placement whose settled value is not exact enters
 *     `extra` at its MAXIMUM, so a placed team needs no top up here.
 *
 * ---------------------------------------------------------------------------
 * READING 9: WHY THE REDUCED PLACEMENT ASSIGNMENTS ARE ENOUGH
 * ---------------------------------------------------------------------------
 *
 * Assigning fewer or smaller placement values never covers more rivals: any
 * cover the seats, awards and fill ins achieve at lower points or smaller seat
 * values stays achievable at higher ones, so the maximum cover is monotone in
 * every rival's points and every seat's value. The decided placements are a
 * suffix of the table (fifth to eighth fall in Rounds 2 and 3, fourth in
 * Round 4, third in Round 5, first and second in the final), so the alive
 * alliances other than W share placements 2 and below. Every real assignment is
 * therefore dominated by an enumerated assignment of the top
 * `min(placementPoints.length, |others|)` maxima to distinct alliances, and the
 * bound for that enumerated assignment is at least its maximum cover, hence at
 * least the real takers. The exhaustive tests E1 and E2 in
 * `champJointLock.test.ts` guard this.
 *
 * ---------------------------------------------------------------------------
 * FRAMES: ONE CODE PATH FOR ALL THREE CHAMPIONSHIP SHAPES (quick task 261009-kt3)
 * ---------------------------------------------------------------------------
 *
 * The loop runs over FRAMES (`JointLockFrame`): one candidate winner W, the
 * alliances whose placements are enumerated (every ordered assignment of the
 * placement maxima, as reading 9 above), the alliances whose value is fixed,
 * extra backup seats, and W's fill ins. A single championship is the
 * degenerate case: `singleChampionshipFrames` builds, per candidate W, the
 * alive alliances other than W enumerated, nothing fixed, no extra seat, and
 * W's spare seats as fill ins against the uncovered unpicked rivals, which is
 * exactly the shipped loop, and the single sweep reproduces its numbers.
 *
 * A DIVISIONED championship (FIM: four divisions; NE, ON, TX: two) plays each
 * division as an eight alliance event and then the FINALS among the division
 * winners (`finalsBracket.ts`). `divisionedJointFrames` builds one frame per
 * candidate overall champion W:
 *
 *   1. W's members are covered; W's fill ins are its finals seats (the
 *      maximum alliance size minus its CONFIRMED picks), counted against EVERY
 *      uncovered rival, picked or not, because a finals backup can come from
 *      the whole field, an eliminated alliance's pick included.
 *   2. In W's division the other alive alliances are enumerated at 75, 39 and
 *      21 (W wins its division), decided ones carry their settled values.
 *   3. In every other division every alive alliance is FIXED at 90 plus F_nw,
 *      F_nw the most a finals non champion can be paid (30 at four divisions,
 *      the finalist; 0 at two). No role in that division pays more: its
 *      champion is paid 90 and, since the overall champion is W, at most the
 *      finalist's 30 in the finals. A decided winner of another division is
 *      fixed at F_nw while the finals have not placed it, at its finals
 *      placement maximum once placed, and at 0 once the finals' Playoffs are
 *      final (TBA's finals points are then in the floor).
 *   4. A DIVISION SEAT IN W'S DIVISION ALSO PAYS F_nw (CONTEXT D9). Whether a
 *      team may sit on a division roster and then a finals roster is not
 *      verified, so the proof does not rely on it: every backup seat on an
 *      alive alliance in W's division pays its assigned value plus F_nw
 *      (`enumeratedSeatBonus`), and W's own division seats, while W is still
 *      alive in its division, pay 90 plus F_nw. Seats in other divisions
 *      already pay 90 plus F_nw.
 *   5. A division backup and a finals backup may be different teams (reading
 *      R5): an alive alliance of another division adds its finals seats at
 *      F_nw beside its division seats at 90 plus F_nw.
 *   6. FINALS SEATS ARE OPEN TO ANY RIVAL (`anyRivalSeats`, quick task
 *      261009-kt3 executor addendum, the same "two rosters" reading as step
 *      4): a pick of an eliminated alliance may be called as a backup on a
 *      losing finals alliance and be paid F_nw on top of its division points.
 *      So every finals seat that pays above 0 may also lift one uncovered
 *      PICKED rival whose alliance carries no fixed value; the count adds
 *      `min(finals seats, such rivals)` beside the consuming awards and the
 *      fill ins. It double counts against the unpicked cover, which only
 *      raises the bound.
 *
 * The facts this rests on beyond the single case: no finals row pays above 60
 * at four divisions or 30 at two (manual 11.1.3, `maxFinalsPointsByPlacement`);
 * the finals awards are consuming awards (24 and 30 points 2023 to 2026); no
 * team has award points at both its division and the finals, and one judged
 * award per team per event; the judged awards of every division share one
 * budget, the sum over the divisions of what each can still give (the caller
 * builds it, quick task 261009-pgq: the whole ceiling K for a division whose
 * Awards are open, and K minus the teams already carrying award points there,
 * never below 0, for a division whose Awards read final, because that flag
 * flips on the first award listed and the posted points are already in the
 * floors; a rival can win only its own division's, so sharing is a
 * relaxation). The real champion is some candidate W; in W's
 * division the real placements are dominated by an enumerated assignment; in
 * every other division no alliance is paid more than its fixed value; decided
 * values are maxima; awards, seats, fill ins and the one slot per rival as in
 * the single case. So the real takers are at most the frame's count.
 *
 * SEATS COUNT FROM CONFIRMED PICKS on every shape (CONTEXT D10): an alliance's
 * backup seats are the maximum alliance size minus its picks whose alliance
 * selection points are posted and above 0 (`JointLockAlliance.spareSeats`),
 * never minus its listed picks. A listed fourth pick at 0 points may be
 * dropped and a rival called in its place.
 *
 * MULTIPLE CHAMPIONSHIPS (2026 California, CONTEXT D5): slot takers partition
 * by championship, and one championship's alliances, seats and awards cannot
 * reach a rival of the other, so `jointLockBoundMultiple` sums one bound per
 * championship, an OBSERVER bound (T absent, every candidate winner counted)
 * for each championship T does not play. A rival with no championship row is
 * entered in EVERY championship's input (reading R9): it takes at most one
 * slot, so counting it in each is an over count, and counting it in one only
 * could miss the slot it takes in the other.
 *
 * ---------------------------------------------------------------------------
 * THE COVER UPPER BOUND (reading R10)
 * ---------------------------------------------------------------------------
 *
 * The seat and judged award cover of the unpicked rivals is the exact dynamic
 * program `unpickedCover` wherever its table (seat states times budget plus 1
 * times reachable rivals) is at most `EXACT_COVER_STATE_CAP`; every single
 * event case of 2023 to 2026 is. Above it (FIM's other division seats) the
 * program is unusable and `coverUpperBound` is used. With the reachable
 * deficits sorted ascending, for each prefix of k: `Mfree(k)` is the greedy
 * matching of the prefix to seats worth at least the deficit, and `Mpv(k)` is
 * the prefix's deficits of at most one judged award's points plus the greedy
 * matching of the rest to seats worth at least the deficit minus that award.
 * `bound[j]` is the largest k with `k - Mfree(k) <= j` and `Mpv(k) = k`. Proof:
 * an optimal cover may be taken to be a prefix (every resource covering a
 * deficit covers a smaller one); every covered rival not matched free spends
 * exactly one award, and the free matches are at most `Mfree`; every covered
 * set is a matching in the paid or award alone structure, so it is at most
 * `Mpv`. Three conditions are binding:
 *
 *   (a) both greedy matchings take the deficits LARGEST FIRST and give each
 *       the SMALLEST seat value that suffices, which makes them maximum on
 *       these nested eligibility sets;
 *   (b) the bound hardcodes at most ONE judged award's points per rival, so
 *       `assertOneAwardPerRival(MAX_POINT_PAYING_AWARDS_PER_TEAM)` runs at
 *       module load and throws unless the constant is 1;
 *   (c) the bound models the judged awards and the seats only, exactly as
 *       `unpickedCover`; the consuming awards, the fill ins and the finals
 *       seats open to any rival enter separately, as the shipped `others3`.
 *
 * READING R11: the reachable by seat filter uses the largest seat value over
 * EVERY frame (placement values plus the seat bonus, fixed values, extra seat
 * values), never the placement values alone.
 */
import { bracketDecisionsFromPlayedMatches, InvalidBracketDecisionError, routePlayedBracket, type PlayedBracketMatch } from "./bracket.js";

/**
 * At most ONE point paying award per rival in any future: a consuming award or
 * one judged award, never both and never two (Jacob, 2026-10-09). FIRST's
 * judging rule is one judged award per team per event, and TBA's district
 * point rows agree: since 2023 none of about 8,800 team event rows carries two
 * awards' points (69 did in 2016 to 2020, 1 in 2022). A rule change is what the
 * corpus sweep (`scripts/measureChampJointLocks.ts`) would catch.
 */
export const MAX_POINT_PAYING_AWARDS_PER_TEAM = 1;

/**
 * Reading R10 (b): the cover upper bound hardcodes one judged award's points
 * per rival, so it is sound only while `MAX_POINT_PAYING_AWARDS_PER_TEAM` is 1.
 * Throws an Error naming the constant otherwise. Called at module load.
 */
export function assertOneAwardPerRival(value: number): void {
  if (value !== 1) {
    throw new Error(
      `champJointLock: MAX_POINT_PAYING_AWARDS_PER_TEAM is ${String(value)}, but the cover upper bound counts at most one judged award per rival; rework coverUpperBound before changing it`
    );
  }
}
assertOneAwardPerRival(MAX_POINT_PAYING_AWARDS_PER_TEAM);

/**
 * The exact cover program's largest table, in cells (seat states times budget
 * plus 1 times reachable unpicked rivals). Every single event case of 2023 to
 * 2026 is at most about 11,400; above the cap the cover upper bound is used.
 */
export const EXACT_COVER_STATE_CAP = 250_000;

/** One points pool team: its floor at the position and the open ceiling the proof does not model itself. */
export interface JointLockRival {
  readonly teamKey: string;
  readonly floor: number;
  readonly extra: number;
}

/**
 * One DCMP alliance at the position. `members` are its LISTED picks (quick
 * task 261009-kt3, reading R8; the caller applies the rule). `spareSeats` is
 * how many backup seats it still has: the maximum alliance size minus its
 * CONFIRMED picks (alliance selection points posted and above 0, CONTEXT D10);
 * absent, the maximum alliance size minus `members`.
 */
export interface JointLockAlliance {
  readonly allianceNumber: number;
  readonly members: readonly string[];
  readonly spareSeats?: number;
}

/**
 * One scenario family of the proof: a candidate winner and what every other
 * alliance can be paid (this module's header, "Frames").
 */
export interface JointLockFrame {
  /** The candidate winner, or `null` once the winner is posted. */
  readonly winner: number | null;
  /** The alliances that receive every ordered assignment of `placementPoints`. */
  readonly enumerated: readonly number[];
  /** Alliance -> the fixed value its members and its spare seats are paid. */
  readonly fixed: ReadonlyMap<number, number>;
  /** Seat value -> count: backup seats beyond the alliances' own spare seats. */
  readonly extraSeats: ReadonlyMap<number, number>;
  /** Backup robots on the winner (each takes a slot). */
  readonly fillIns: number;
  /** False: fill ins count against the uncovered unpicked rivals (single); true: against every uncovered rival (divisioned, reading R8 G3). */
  readonly fillInsFromAnyRival: boolean;
  /** Added to the SEAT value of every enumerated alliance, never to its members' (CONTEXT D9); 0 for a single championship. */
  readonly enumeratedSeatBonus: number;
  /** Seat value -> count: finals seats any uncovered picked rival on an unfixed alliance may also take (header step 6); empty for a single championship. */
  readonly anyRivalSeats: ReadonlyMap<number, number>;
}

export interface JointLockInput {
  /** Every points pool team, T included. */
  readonly pool: readonly JointLockRival[];
  /** Prequalified teams not yet award qualified: they take a slot only by winning or by a consuming award (reading 3). */
  readonly slotOnlyRivals: readonly string[];
  /** S': `cmpSlots` minus the posted award qualifiers (`pointsRaceSlots(...).pointsSlots`). */
  readonly pointsSlots: number;
  /** Every alliance (eight at a single championship; every division's, with `divisionAllianceId` ids, at a divisioned one). */
  readonly alliances: readonly JointLockAlliance[];
  /** The alliances alive for the proof (reading 6). */
  readonly aliveAlliances: readonly number[];
  /** Every alliance that can still win, or `[null]` once the winner award is posted (reading 8). */
  readonly candidateWinners: readonly (number | null)[];
  /** The placement MAXIMA for second, third and fourth: `maxPlayoffPointsByPlacement(year, "dcmp", 2..4)`, never `playoffPoints`. */
  readonly placementPoints: readonly number[];
  /** C: the consuming awards still to be given out. */
  readonly consumingAwards: number;
  /** K: the judged awards still to be given out. `dcmpJudgedAwardCeiling()` at a single championship; at a divisioned one the caller sums it over the divisions, the whole ceiling for a division whose Awards are open and the ceiling minus the teams already carrying award points there (never below 0) for one whose Awards read final. */
  readonly judgedAwards: number;
  /** What one judged award pays at the DCMP (15 at 2026). */
  readonly judgedAwardPoints: number;
  /** TBA's largest alliance: a captain and three picks. */
  readonly maxAllianceSize: number;
  /** The scenario frames. Omitted for a single championship, where `singleChampionshipFrames` builds them. */
  readonly frames?: readonly JointLockFrame[];
}

/** What the played playoff rows alone say about the DCMP bracket. */
export interface DcmpBracketState {
  /** Alliance numbers the routing has not placed. */
  readonly alive: readonly number[];
  /** The placement 1 alliance, once the final is decided. */
  readonly decidedWinner: number | undefined;
  readonly placementByAlliance: ReadonlyMap<number, number>;
}

/**
 * Routes the played rows. `undefined` when a row names an alliance that is not
 * one of its set's two participants (a mis-mapped row); the proof then does not
 * run. Any other error is rethrown.
 */
export function dcmpBracketState(playedMatches: readonly PlayedBracketMatch[], allianceNumbers: readonly number[]): DcmpBracketState | undefined {
  let placementByAlliance: ReadonlyMap<number, number>;
  try {
    placementByAlliance = routePlayedBracket(bracketDecisionsFromPlayedMatches(playedMatches)).placementByAlliance;
  } catch (error) {
    if (error instanceof InvalidBracketDecisionError) return undefined;
    throw error;
  }
  let decidedWinner: number | undefined;
  for (const [allianceNumber, placement] of placementByAlliance) if (placement === 1) decidedWinner = allianceNumber;
  return {
    alive: allianceNumbers.filter((allianceNumber) => !placementByAlliance.has(allianceNumber)),
    decidedWinner,
    placementByAlliance,
  };
}

/** Every ordered choice of `k` distinct items from `items`. */
function orderedSelections<T>(items: readonly T[], k: number): T[][] {
  const out: T[][] = [];
  const current: T[] = [];
  const used = new Array<boolean>(items.length).fill(false);
  const visit = (): void => {
    if (current.length === k) {
      out.push([...current]);
      return;
    }
    for (let index = 0; index < items.length; index++) {
      if (used[index]) continue;
      used[index] = true;
      current.push(items[index]!);
      visit();
      current.pop();
      used[index] = false;
    }
  };
  visit();
  return out;
}

/**
 * The judged awards a rival `deficit` points short of T's floor needs to reach
 * it, or `Infinity` when one award per rival cannot do it.
 */
function judgedCost(deficit: number, judgedAwardPoints: number): number {
  if (deficit <= 0) return 0;
  if (judgedAwardPoints <= 0) return Infinity;
  const cost = Math.ceil(deficit / judgedAwardPoints);
  return cost <= MAX_POINT_PAYING_AWARDS_PER_TEAM ? cost : Infinity;
}

/**
 * For the unpicked uncovered pool rivals (their deficits are fixed for one T),
 * the most of them the seats can cover together with at most `j` judged awards,
 * for every `j` from 0 to `budget`. An exact dynamic program over (seats used
 * per seat value, judged awards spent). Exported for the cover upper bound's
 * dominance test.
 */
export function unpickedCover(deficits: readonly number[], seatValues: readonly number[], seatCounts: readonly number[], budget: number, judgedAwardPoints: number): number[] {
  const radix: number[] = [];
  let stateCount = 1;
  for (const count of seatCounts) {
    radix.push(stateCount);
    stateCount *= count + 1;
  }
  const width = budget + 1;
  let dp = new Int16Array(stateCount * width).fill(-1);
  dp[0] = 0;
  const usage = (state: number, type: number): number => Math.floor(state / radix[type]!) % (seatCounts[type]! + 1);

  for (const deficit of deficits) {
    const next = dp.slice();
    const alone = judgedCost(deficit, judgedAwardPoints);
    const withSeat = seatValues.map((value) => judgedCost(deficit - value, judgedAwardPoints));
    for (let state = 0; state < stateCount; state++) {
      for (let j = 0; j <= budget; j++) {
        const value = dp[state * width + j]!;
        if (value < 0) continue;
        if (alone !== Infinity && j + alone <= budget) {
          const at = state * width + j + alone;
          if (next[at]! < value + 1) next[at] = value + 1;
        }
        for (let type = 0; type < seatValues.length; type++) {
          const cost = withSeat[type]!;
          if (cost === Infinity || j + cost > budget) continue;
          if (usage(state, type) >= seatCounts[type]!) continue;
          const at = (state + radix[type]!) * width + j + cost;
          if (next[at]! < value + 1) next[at] = value + 1;
        }
      }
    }
    dp = next;
  }

  const best = new Array<number>(width).fill(0);
  for (let state = 0; state < stateCount; state++) {
    for (let j = 0; j <= budget; j++) {
      const value = dp[state * width + j]!;
      if (value > best[j]!) best[j] = value;
    }
  }
  for (let j = 1; j <= budget; j++) if (best[j - 1]! > best[j]!) best[j] = best[j - 1]!;
  return best;
}

/**
 * Reading R10 condition (a): the most deficits of `deficits` (any order) that
 * can each take a distinct seat worth at least `threshold(deficit)`. Deficits
 * are taken LARGEST threshold first and each is given the SMALLEST seat value
 * that suffices, which is a maximum matching on nested eligibility sets.
 * `seatValues` is sorted descending, `seatCounts` aligned with it.
 */
function greedySeatMatching(deficits: readonly number[], threshold: (deficit: number) => number, seatValues: readonly number[], seatCounts: readonly number[]): number {
  const remaining = [...seatCounts];
  const thresholds = deficits.map(threshold).sort((a, b) => b - a);
  let matched = 0;
  for (const need of thresholds) {
    for (let type = seatValues.length - 1; type >= 0; type--) {
      if (seatValues[type]! >= need && remaining[type]! > 0) {
        remaining[type]! -= 1;
        matched += 1;
        break;
      }
    }
  }
  return matched;
}

/**
 * The cover UPPER BOUND of reading R10, for every `j` from 0 to `budget`: never
 * below `unpickedCover`'s exact value (this module's header for the proof and
 * its three binding conditions).
 */
export function coverUpperBound(deficits: readonly number[], seatValues: readonly number[], seatCounts: readonly number[], budget: number, judgedAwardPoints: number): number[] {
  const sorted = [...deficits].sort((a, b) => a - b);
  const award = judgedAwardPoints > 0 ? judgedAwardPoints * MAX_POINT_PAYING_AWARDS_PER_TEAM : 0;
  const width = budget + 1;
  const best = new Array<number>(width).fill(0);
  for (let k = 1; k <= sorted.length; k++) {
    const prefix = sorted.slice(0, k);
    const free = greedySeatMatching(prefix, (deficit) => deficit, seatValues, seatCounts);
    const alone = award > 0 ? prefix.filter((deficit) => deficit <= award).length : 0;
    const rest = award > 0 ? prefix.filter((deficit) => deficit > award) : prefix;
    const paidOrAlone = alone + greedySeatMatching(rest, (deficit) => deficit - award, seatValues, seatCounts);
    if (paidOrAlone !== k) continue;
    const awardsNeeded = k - free;
    for (let j = awardsNeeded; j <= budget; j++) if (k > best[j]!) best[j] = k;
  }
  for (let j = 1; j <= budget; j++) if (best[j - 1]! > best[j]!) best[j] = best[j - 1]!;
  return best;
}

/** The cover for one seat configuration: the exact program within `EXACT_COVER_STATE_CAP`, the upper bound above it. */
function seatAndJudgedCover(deficits: readonly number[], seatValues: readonly number[], seatCounts: readonly number[], budget: number, judgedAwardPoints: number): number[] {
  let cells = (budget + 1) * Math.max(1, deficits.length);
  for (const count of seatCounts) cells *= count + 1;
  if (cells <= EXACT_COVER_STATE_CAP) return unpickedCover(deficits, seatValues, seatCounts, budget, judgedAwardPoints);
  return coverUpperBound(deficits, seatValues, seatCounts, budget, judgedAwardPoints);
}

/** The backup seats an alliance still has (CONTEXT D10): `spareSeats`, else the maximum size minus its members. */
function spareSeatsOf(alliance: JointLockAlliance | undefined, maxAllianceSize: number): number {
  if (alliance === undefined) return maxAllianceSize;
  return Math.max(0, alliance.spareSeats ?? maxAllianceSize - alliance.members.length);
}

/**
 * The single championship's frames: per candidate winner W, the alive
 * alliances other than W enumerated, nothing fixed, no extra seat, and W's
 * spare seats as fill ins against the uncovered unpicked rivals. Exactly the
 * shipped 261009-2tr loop.
 */
export function singleChampionshipFrames(input: JointLockInput): JointLockFrame[] {
  const byNumber = new Map(input.alliances.map((alliance) => [alliance.allianceNumber, alliance] as const));
  return input.candidateWinners.map((winner) => ({
    winner,
    enumerated: input.aliveAlliances.filter((allianceNumber) => allianceNumber !== winner),
    fixed: new Map(),
    extraSeats: new Map(),
    fillIns: winner === null ? 0 : spareSeatsOf(byNumber.get(winner), input.maxAllianceSize),
    fillInsFromAnyRival: false,
    enumeratedSeatBonus: 0,
    anyRivalSeats: new Map(),
  }));
}

/**
 * The joint bound for team T at floor `floor`: the most rivals that can take a
 * slot from it, maximized over every frame and every placement assignment. T
 * may be absent from the pool (the OBSERVER variant of a championship T does
 * not play, CONTEXT D5). `Infinity` with no frame; 0 when T is a member of
 * every frame's winner. `stopAt` returns the first scenario value at or above
 * it; below it the exact maximum is returned.
 */
export function jointLockBoundAt(input: JointLockInput, teamKey: string, floor: number, stopAt = Infinity): number {
  const frames = input.frames ?? singleChampionshipFrames(input);
  if (frames.length === 0) return Infinity;
  const m = floor;

  const allianceByNumber = new Map<number, JointLockAlliance>();
  const allianceOfTeam = new Map<string, number>();
  for (const alliance of input.alliances) {
    allianceByNumber.set(alliance.allianceNumber, alliance);
    for (const member of alliance.members) if (!allianceOfTeam.has(member)) allianceOfTeam.set(member, alliance.allianceNumber);
  }
  const membersOf = (allianceNumber: number): readonly string[] => allianceByNumber.get(allianceNumber)?.members ?? [];
  const spareOf = (allianceNumber: number): number => spareSeatsOf(allianceByNumber.get(allianceNumber), input.maxAllianceSize);

  const rivals = input.pool.filter((rival) => rival.teamKey !== teamKey);
  const rivalKeys = new Set(rivals.map((rival) => rival.teamKey));
  const slotOnly = [...new Set(input.slotOnlyRivals)].filter((key) => key !== teamKey && !rivalKeys.has(key));
  const slotOnlySet = new Set(slotOnly);

  const usable = frames.filter((frame) => frame.winner === null || !membersOf(frame.winner).includes(teamKey));
  if (usable.length === 0) return 0;

  // Every scenario covers a rival whose floor plus extra already reaches T.
  let alwaysCovered = 0;
  for (const rival of rivals) if (rival.floor + rival.extra >= m) alwaysCovered += 1;
  if (alwaysCovered >= stopAt) return alwaysCovered;

  // The unpicked pool rivals still short of T: fixed for this T, because an
  // unpicked rival is on no alliance and so is never assigned a value.
  const unpickedDeficits: number[] = [];
  for (const rival of rivals) {
    if (allianceOfTeam.has(rival.teamKey)) continue;
    const deficit = m - (rival.floor + rival.extra);
    if (deficit > 0) unpickedDeficits.push(deficit);
  }
  const unpickedSlotOnly = slotOnly.filter((key) => !allianceOfTeam.has(key)).length;
  // Reading R11: the largest seat value over EVERY frame.
  let maxSeatValue = Math.max(0, ...input.placementPoints);
  for (const frame of usable) {
    maxSeatValue = Math.max(maxSeatValue, Math.max(0, ...input.placementPoints) + frame.enumeratedSeatBonus, frame.enumeratedSeatBonus);
    for (const value of frame.fixed.values()) maxSeatValue = Math.max(maxSeatValue, value);
    for (const value of frame.extraSeats.keys()) maxSeatValue = Math.max(maxSeatValue, value);
  }
  const unpickedReachable = unpickedDeficits.filter(
    (deficit) => judgedCost(deficit, input.judgedAwardPoints) !== Infinity || judgedCost(deficit - maxSeatValue, input.judgedAwardPoints) !== Infinity
  );

  const placementValues = [...input.placementPoints].sort((a, b) => b - a);
  const budget = Math.max(0, input.judgedAwards);
  const coverCache = new Map<string, number[]>();

  let best = -Infinity;
  for (const frame of usable) {
    const { winner } = frame;
    const others = frame.enumerated.filter((allianceNumber) => allianceNumber !== winner && !frame.fixed.has(allianceNumber));
    const othersSet = new Set(others);
    const k = Math.min(placementValues.length, others.length);
    const winnerMembers = winner === null ? [] : membersOf(winner);
    const winnerSet = new Set(winnerMembers);
    let stepOne = 0;
    for (const member of winnerMembers) if (member !== teamKey && (rivalKeys.has(member) || slotOnlySet.has(member))) stepOne += 1;
    const fillIns = winner === null ? 0 : Math.max(0, frame.fillIns);
    let anyRivalSeatCount = 0;
    let anyRivalSeatMax = 0;
    for (const [value, count] of frame.anyRivalSeats) {
      if (value <= 0 || count <= 0) continue;
      anyRivalSeatCount += count;
      anyRivalSeatMax = Math.max(anyRivalSeatMax, value);
    }

    for (const selection of orderedSelections(others, k)) {
      const assigned = new Map<number, number>(frame.fixed);
      selection.forEach((allianceNumber, index) => assigned.set(allianceNumber, placementValues[index]!));

      let covered = stepOne;
      let uncovered = 0;
      let anyRivalCandidates = 0;
      const pickedCosts: number[] = [];
      for (const rival of rivals) {
        if (winnerSet.has(rival.teamKey)) continue;
        const allianceNumber = allianceOfTeam.get(rival.teamKey);
        const points = rival.floor + rival.extra + (allianceNumber === undefined ? 0 : (assigned.get(allianceNumber) ?? 0));
        if (points >= m) {
          covered += 1;
          continue;
        }
        uncovered += 1;
        if (allianceNumber === undefined) continue; // an unpicked rival: the cached cover below
        const cost = judgedCost(m - points, input.judgedAwardPoints);
        if (cost !== Infinity) pickedCosts.push(cost);
        if (anyRivalSeatCount > 0 && !frame.fixed.has(allianceNumber) && judgedCost(m - points - anyRivalSeatMax, input.judgedAwardPoints) !== Infinity) {
          anyRivalCandidates += 1;
        }
      }
      for (const key of slotOnly) if (!winnerSet.has(key)) uncovered += 1;
      const uncoveredUnpicked = unpickedDeficits.length + unpickedSlotOnly;

      // The seats a backup robot can still take: every alliance with a value,
      // each enumerated one at its value plus the frame's seat bonus (D9), an
      // enumerated one left without a placement at the bonus alone, and the
      // frame's extra seats.
      const seatByValue = new Map<number, number>();
      const addSeats = (value: number, count: number): void => {
        if (value <= 0 || count <= 0) return;
        seatByValue.set(value, (seatByValue.get(value) ?? 0) + count);
      };
      for (const [allianceNumber, value] of assigned) addSeats(value + (othersSet.has(allianceNumber) ? frame.enumeratedSeatBonus : 0), spareOf(allianceNumber));
      if (frame.enumeratedSeatBonus > 0) {
        for (const allianceNumber of others) if (!assigned.has(allianceNumber)) addSeats(frame.enumeratedSeatBonus, spareOf(allianceNumber));
      }
      for (const [value, count] of frame.extraSeats) addSeats(value, count);
      const seatValues = [...seatByValue.keys()].sort((a, b) => b - a);
      const seatCounts = seatValues.map((value) => seatByValue.get(value)!);
      const totalSeats = seatCounts.reduce((sum, count) => sum + count, 0);

      const fillInPool = frame.fillInsFromAnyRival ? uncovered : uncoveredUnpicked;
      const others3 = input.consumingAwards + Math.min(fillIns, fillInPool) + Math.min(anyRivalSeatCount, anyRivalCandidates);
      // A cheap ceiling on this scenario: skip it when it cannot beat the best.
      const liftCeiling = Math.min(pickedCosts.length + unpickedReachable.length, budget + totalSeats);
      const ceiling = covered + Math.min(uncovered, liftCeiling + others3);
      if (ceiling <= best) continue;

      const cacheKey = seatValues.map((value, index) => `${value}x${seatCounts[index]}`).join(",");
      let unpickedBest = coverCache.get(cacheKey);
      if (unpickedBest === undefined) {
        unpickedBest = seatAndJudgedCover(unpickedReachable, seatValues, seatCounts, budget, input.judgedAwardPoints);
        coverCache.set(cacheKey, unpickedBest);
      }
      pickedCosts.sort((a, b) => a - b);
      const pickedPrefix = [0];
      for (const cost of pickedCosts) pickedPrefix.push(pickedPrefix[pickedPrefix.length - 1]! + cost);
      const pickedBest = (remaining: number): number => {
        let count = 0;
        while (count < pickedCosts.length && pickedPrefix[count + 1]! <= remaining) count += 1;
        return count;
      };
      let lifted = 0;
      for (let j = 0; j <= budget; j++) lifted = Math.max(lifted, unpickedBest[j]! + pickedBest(budget - j));

      const total = covered + Math.min(uncovered, lifted + others3);
      if (total >= stopAt) return total;
      if (total > best) best = total;
    }
  }
  return best;
}

/**
 * The joint bound for one pool team: `jointLockBoundAt` at its own floor.
 * `Infinity` for a team outside the pool or with no candidate winner.
 */
export function jointLockBound(input: JointLockInput, teamKey: string, stopAt = Infinity): number {
  const self = input.pool.find((rival) => rival.teamKey === teamKey);
  if (self === undefined || input.candidateWinners.length === 0) return Infinity;
  return jointLockBoundAt(input, teamKey, self.floor, stopAt);
}

/** Every pool team the joint proof locks: its bound is below `pointsSlots`. Empty when no alliance can win. */
export function jointLockedTeams(input: JointLockInput): ReadonlySet<string> {
  const locked = new Set<string>();
  if (input.candidateWinners.length === 0) return locked;
  for (const rival of input.pool) {
    if (jointLockBound(input, rival.teamKey, input.pointsSlots) < input.pointsSlots) locked.add(rival.teamKey);
  }
  return locked;
}

// ---------------------------------------------------------------------------
// Divisioned championships (CONTEXT D4, readings R5 to R8)
// ---------------------------------------------------------------------------

/** A division alliance's id, unique across divisions: `d * 10 + n`, d the 1 based division index in sorted key order. */
export function divisionAllianceId(divisionIndex: number, allianceNumber: number): number {
  return divisionIndex * 10 + allianceNumber;
}

/** One division at the position, in `divisionAllianceId` ids. */
export interface DivisionJointState {
  /** Every alliance of the division. */
  readonly alliances: readonly number[];
  /** The alliances alive for the proof (reading 6); empty once the division's Playoffs are final. */
  readonly alive: readonly number[];
  /** The division's routed winner, once its final is decided. */
  readonly decidedWinner: number | undefined;
}

/** What `divisionedJointFrames` reads: the divisions, the finals routing, and the seat counts. */
export interface DivisionedJointStructure {
  readonly divisions: readonly DivisionJointState[];
  /** Division winner id -> its finals placement, for the winners the finals routing places. */
  readonly finalsPlacementByAlliance: ReadonlyMap<number, number>;
  /** The finals' Playoffs are final at the position. */
  readonly finalsElimFinal: boolean;
  /** The winner award (at the finals key) is posted at the position. */
  readonly winnerPosted: boolean;
  /** What a division champion is paid at most: `maxPlayoffPointsByPlacement(year, "dcmp", 1)`. */
  readonly divisionChampionMax: number;
  /** The finals maxima by placement: `maxFinalsPointsByPlacement(year, D, 1..D)`. */
  readonly finalsMaxByPlacement: readonly number[];
  readonly membersByAlliance: ReadonlyMap<number, readonly string[]>;
  /** Reading R8 G1 and CONTEXT D10: the maximum alliance size minus the alliance's CONFIRMED picks. */
  readonly finalsSpareByAlliance: ReadonlyMap<number, number>;
  readonly maxAllianceSize: number;
}

export type DivisionedJointFrames =
  | { readonly frames: JointLockFrame[]; readonly candidateWinners: (number | null)[]; readonly aliveAlliances: number[] }
  | { readonly refused: "winnerNotPosted" | "noCandidateWinner" };

/**
 * The divisioned championship's frames (this module's header, "Frames", steps
 * 1 to 6). Candidates: `[null]` once the winner award is posted; the routed
 * finals champion alone once the finals name one; with the finals' Playoffs
 * final and neither, `winnerNotPosted`; otherwise each division's decided
 * winner not yet placed below first in the finals, or every alive alliance of
 * a division with no decided winner.
 */
export function divisionedJointFrames(structure: DivisionedJointStructure): DivisionedJointFrames {
  const { divisions, finalsPlacementByAlliance, finalsElimFinal } = structure;
  const finalsSpare = (id: number): number =>
    Math.max(0, structure.finalsSpareByAlliance.get(id) ?? structure.maxAllianceSize - (structure.membersByAlliance.get(id)?.length ?? 0));
  const aliveAlliances = divisions.flatMap((division) => [...division.alive]).sort((a, b) => a - b);
  let champion: number | undefined;
  for (const [id, placement] of finalsPlacementByAlliance) if (placement === 1) champion = id;

  let candidateWinners: (number | null)[];
  if (structure.winnerPosted) candidateWinners = [null];
  else if (champion !== undefined) candidateWinners = [champion];
  else if (finalsElimFinal) return { refused: "winnerNotPosted" };
  else {
    candidateWinners = [];
    for (const division of divisions) {
      if (division.decidedWinner !== undefined) {
        if (!finalsPlacementByAlliance.has(division.decidedWinner)) candidateWinners.push(division.decidedWinner);
      } else candidateWinners.push(...division.alive);
    }
  }
  if (candidateWinners.length === 0) return { refused: "noCandidateWinner" };

  // F_nw: the most a finals non champion is paid, while the finals' Playoffs are open.
  const finalsNonChampionMax = finalsElimFinal ? 0 : Math.max(0, ...structure.finalsMaxByPlacement.slice(1));
  const frames: JointLockFrame[] = candidateWinners.map((winner) => {
    const winnerDivision = winner === null ? -1 : divisions.findIndex((division) => division.alliances.includes(winner));
    const fixed = new Map<number, number>();
    const extraSeats = new Map<number, number>();
    const anyRivalSeats = new Map<number, number>();
    const add = (map: Map<number, number>, value: number, count: number): void => {
      if (value <= 0 || count <= 0) return;
      map.set(value, (map.get(value) ?? 0) + count);
    };
    let enumerated: number[] = [];
    divisions.forEach((division, index) => {
      if (index === winnerDivision) {
        enumerated = division.alive.filter((id) => id !== winner);
        // R5 (a) with D9: W's division seats while W is still alive there.
        if (division.decidedWinner === undefined && winner !== null) add(extraSeats, structure.divisionChampionMax + finalsNonChampionMax, finalsSpare(winner));
        return;
      }
      for (const id of division.alive) {
        fixed.set(id, structure.divisionChampionMax + finalsNonChampionMax);
        // R5 (b): its finals seats at F_nw beside its division seats; open to any rival (step 6).
        add(extraSeats, finalsNonChampionMax, finalsSpare(id));
        add(anyRivalSeats, finalsNonChampionMax, finalsSpare(id));
      }
      const decided = division.decidedWinner;
      if (decided !== undefined && !division.alive.includes(decided)) {
        const placement = finalsPlacementByAlliance.get(decided);
        const value = finalsElimFinal ? 0 : placement === undefined ? finalsNonChampionMax : (structure.finalsMaxByPlacement[placement - 1] ?? 0);
        if (value > 0) {
          fixed.set(decided, value);
          add(anyRivalSeats, value, finalsSpare(decided));
        }
      }
    });
    return {
      winner,
      enumerated,
      fixed,
      extraSeats,
      fillIns: winner === null ? 0 : finalsSpare(winner),
      fillInsFromAnyRival: true,
      enumeratedSeatBonus: finalsNonChampionMax,
      anyRivalSeats,
    };
  });
  return { frames, candidateWinners, aliveAlliances };
}

// ---------------------------------------------------------------------------
// Multiple championships (CONTEXT D5, reading R9)
// ---------------------------------------------------------------------------

/**
 * The bound for T across independent championships: the sum of one bound per
 * championship, T's floor read from the first pool holding it (a rival with no
 * championship row is in every pool at the same floor), the observer bound for
 * every championship T does not play. `Infinity` when no pool holds T.
 */
export function jointLockBoundMultiple(championships: readonly JointLockInput[], teamKey: string, stopAt = Infinity): number {
  const holder = championships.find((input) => input.pool.some((rival) => rival.teamKey === teamKey));
  if (holder === undefined) return Infinity;
  const floor = holder.pool.find((rival) => rival.teamKey === teamKey)!.floor;
  let sum = 0;
  for (const input of championships) {
    if (input.candidateWinners.length === 0) return Infinity;
    sum += jointLockBoundAt(input, teamKey, floor, stopAt - sum);
    if (sum >= stopAt) return sum;
  }
  return sum;
}

/** Every team in any championship's pool whose summed bound is below `pointsSlots`. */
export function jointLockedTeamsMultiple(championships: readonly JointLockInput[], pointsSlots: number): ReadonlySet<string> {
  const locked = new Set<string>();
  const keys = new Set(championships.flatMap((input) => input.pool.map((rival) => rival.teamKey)));
  for (const teamKey of keys) if (jointLockBoundMultiple(championships, teamKey, pointsSlots) < pointsSlots) locked.add(teamKey);
  return locked;
}
