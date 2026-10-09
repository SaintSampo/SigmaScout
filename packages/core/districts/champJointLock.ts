/**
 * THE JOINT WORST CASE LOCK PROOF at the Championship tier (quick task
 * 261009-2tr). Pure, no I/O, no zod, no React; its only import is the
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

/** One points pool team: its floor at the position and the open ceiling the proof does not model itself. */
export interface JointLockRival {
  readonly teamKey: string;
  readonly floor: number;
  readonly extra: number;
}

/** One DCMP alliance and its members at the position: the picks whose DCMP alliance selection points are above 0 (the caller applies the rule). */
export interface JointLockAlliance {
  readonly allianceNumber: number;
  readonly members: readonly string[];
}

export interface JointLockInput {
  /** Every points pool team, T included. */
  readonly pool: readonly JointLockRival[];
  /** Prequalified teams not yet award qualified: they take a slot only by winning or by a consuming award (reading 3). */
  readonly slotOnlyRivals: readonly string[];
  /** S': `cmpSlots` minus the posted award qualifiers (`pointsRaceSlots(...).pointsSlots`). */
  readonly pointsSlots: number;
  /** All eight alliances. */
  readonly alliances: readonly JointLockAlliance[];
  /** The alliances alive for the proof (reading 6). */
  readonly aliveAlliances: readonly number[];
  /** Every alliance that can still win, or `[null]` once the winner award is posted (reading 8). */
  readonly candidateWinners: readonly (number | null)[];
  /** The placement MAXIMA for second, third and fourth: `maxPlayoffPointsByPlacement(year, "dcmp", 2..4)`, never `playoffPoints`. */
  readonly placementPoints: readonly number[];
  /** C: the consuming awards still to be given out. */
  readonly consumingAwards: number;
  /** K: the judged award ceiling (`dcmpJudgedAwardCeiling()`). */
  readonly judgedAwards: number;
  /** What one judged award pays at the DCMP (15 at 2026). */
  readonly judgedAwardPoints: number;
  /** TBA's largest alliance: a captain and three picks. */
  readonly maxAllianceSize: number;
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
 * per seat value, judged awards spent).
 */
function unpickedCover(deficits: readonly number[], seatValues: readonly number[], seatCounts: readonly number[], budget: number, judgedAwardPoints: number): number[] {
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
 * The joint bound for one team: the most rivals that can take a slot from it,
 * maximized over every candidate winner and every placement assignment.
 * `Infinity` for a team outside the pool or with no candidate winner; 0 when T
 * is a member of every candidate winner. `stopAt` returns the first scenario
 * value at or above it; below it the exact maximum is returned.
 */
export function jointLockBound(input: JointLockInput, teamKey: string, stopAt = Infinity): number {
  const self = input.pool.find((rival) => rival.teamKey === teamKey);
  if (self === undefined || input.candidateWinners.length === 0) return Infinity;
  const m = self.floor;

  const membersByAlliance = new Map<number, readonly string[]>();
  const allianceOfTeam = new Map<string, number>();
  for (const alliance of input.alliances) {
    membersByAlliance.set(alliance.allianceNumber, alliance.members);
    for (const member of alliance.members) if (!allianceOfTeam.has(member)) allianceOfTeam.set(member, alliance.allianceNumber);
  }
  const membersOf = (allianceNumber: number): readonly string[] => membersByAlliance.get(allianceNumber) ?? [];

  const rivals = input.pool.filter((rival) => rival.teamKey !== teamKey);
  const rivalKeys = new Set(rivals.map((rival) => rival.teamKey));
  const slotOnly = [...new Set(input.slotOnlyRivals)].filter((key) => key !== teamKey && !rivalKeys.has(key));
  const slotOnlySet = new Set(slotOnly);

  const winners = input.candidateWinners.filter((winner) => winner === null || !membersOf(winner).includes(teamKey));
  if (winners.length === 0) return 0;

  // Every scenario covers a rival whose floor plus extra already reaches T.
  let alwaysCovered = 0;
  for (const rival of rivals) if (rival.floor + rival.extra >= m) alwaysCovered += 1;
  if (alwaysCovered >= stopAt) return alwaysCovered;

  // The unpicked pool rivals still short of T: fixed for this T, because an
  // unpicked rival is on no alliance and so is never assigned a placement.
  const unpickedDeficits: number[] = [];
  for (const rival of rivals) {
    if (allianceOfTeam.has(rival.teamKey)) continue;
    const deficit = m - (rival.floor + rival.extra);
    if (deficit > 0) unpickedDeficits.push(deficit);
  }
  const unpickedSlotOnly = slotOnly.filter((key) => !allianceOfTeam.has(key)).length;
  const maxSeatValue = Math.max(0, ...input.placementPoints);
  const unpickedReachable = unpickedDeficits.filter(
    (deficit) => judgedCost(deficit, input.judgedAwardPoints) !== Infinity || judgedCost(deficit - maxSeatValue, input.judgedAwardPoints) !== Infinity
  );

  const placementValues = [...input.placementPoints].sort((a, b) => b - a);
  const budget = Math.max(0, input.judgedAwards);
  const coverCache = new Map<string, number[]>();

  let best = -Infinity;
  for (const winner of winners) {
    const others = input.aliveAlliances.filter((allianceNumber) => allianceNumber !== winner);
    const k = Math.min(placementValues.length, others.length);
    const winnerMembers = winner === null ? [] : membersOf(winner);
    const winnerSet = new Set(winnerMembers);
    let stepOne = 0;
    for (const member of winnerMembers) if (member !== teamKey && (rivalKeys.has(member) || slotOnlySet.has(member))) stepOne += 1;
    const fillIns = winner === null ? 0 : Math.max(0, input.maxAllianceSize - winnerMembers.length);

    for (const selection of orderedSelections(others, k)) {
      const assigned = new Map<number, number>();
      selection.forEach((allianceNumber, index) => assigned.set(allianceNumber, placementValues[index]!));

      let covered = stepOne;
      let uncovered = 0;
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
        if (allianceNumber === undefined) continue; // an unpicked rival: the cached dynamic program below
        const cost = judgedCost(m - points, input.judgedAwardPoints);
        if (cost !== Infinity) pickedCosts.push(cost);
      }
      for (const key of slotOnly) if (!winnerSet.has(key)) uncovered += 1;
      const uncoveredUnpicked = unpickedDeficits.length + unpickedSlotOnly;

      // The seats a backup robot can still take on the losing alive alliances.
      const seatByValue = new Map<number, number>();
      for (const [allianceNumber, value] of assigned) {
        if (value <= 0) continue;
        const spare = Math.max(0, input.maxAllianceSize - membersOf(allianceNumber).length);
        if (spare > 0) seatByValue.set(value, (seatByValue.get(value) ?? 0) + spare);
      }
      const seatValues = [...seatByValue.keys()].sort((a, b) => b - a);
      const seatCounts = seatValues.map((value) => seatByValue.get(value)!);
      const totalSeats = seatCounts.reduce((sum, count) => sum + count, 0);

      const others3 = input.consumingAwards + Math.min(fillIns, uncoveredUnpicked);
      // A cheap ceiling on this scenario: skip it when it cannot beat the best.
      const liftCeiling = Math.min(pickedCosts.length + unpickedReachable.length, budget + totalSeats);
      const ceiling = covered + Math.min(uncovered, liftCeiling + others3);
      if (ceiling <= best) continue;

      const cacheKey = seatValues.map((value, index) => `${value}x${seatCounts[index]}`).join(",");
      let unpickedBest = coverCache.get(cacheKey);
      if (unpickedBest === undefined) {
        unpickedBest = unpickedCover(unpickedReachable, seatValues, seatCounts, budget, input.judgedAwardPoints);
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

/** Every pool team the joint proof locks: its bound is below `pointsSlots`. Empty when no alliance can win. */
export function jointLockedTeams(input: JointLockInput): ReadonlySet<string> {
  const locked = new Set<string>();
  if (input.candidateWinners.length === 0) return locked;
  for (const rival of input.pool) {
    if (jointLockBound(input, rival.teamKey, input.pointsSlots) < input.pointsSlots) locked.add(rival.teamKey);
  }
  return locked;
}
