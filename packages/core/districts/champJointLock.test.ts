/**
 * The joint worst case lock proof's soundness, TESTED rather than asserted
 * (quick task 261009-2tr, CONTEXT D5). Every test here builds futures the
 * bracket, the backup robots and the award budget allow, counts the rivals
 * that really take a Championship slot from a team T in each, and checks that
 * count never exceeds `jointLockBound`.
 *
 * A future's slot takers against T, the oracle `realTakers` below: every rival
 * that newly qualifies regardless of points (a member or backup of the winning
 * alliance, or a consuming award winner), plus every other pool rival whose
 * points reach T's points (ties count against T). T is paid no playoff points
 * and receives no award in the exhaustive tests, which is its worst case.
 */
import { describe, expect, it } from "vitest";
import {
  assertOneAwardPerRival,
  coverUpperBound,
  dcmpBracketState,
  divisionAllianceId,
  divisionedJointFrames,
  EXACT_COVER_STATE_CAP,
  jointLockBound,
  jointLockBoundAt,
  jointLockBoundMultiple,
  jointLockedTeams,
  jointLockedTeamsMultiple,
  MAX_POINT_PAYING_AWARDS_PER_TEAM,
  singleChampionshipFrames,
  unpickedCover,
  type DivisionedJointStructure,
  type JointLockAlliance,
  type JointLockInput,
  type JointLockRival,
} from "./champJointLock.js";
import { routeFinals } from "./finalsBracket.js";
import {
  bracketDecisionKey,
  bracketDecisionsFromPlayedMatches,
  maxPlayoffPointsByPlacement,
  routeBracket,
  type PlayedBracketMatch,
} from "./bracket.js";
import { mulberry32 } from "../algorithms/simulation/rankSimulation.js";

const JUDGED = 15;

/** One future, as far as the slot takers against T are concerned. */
interface Future {
  /** The real winning alliance, or `null` when the winner is already posted (its members left the pool). */
  readonly winner: number | null;
  /** Backup robots on the winning alliance. */
  readonly winnerBackups: readonly string[];
  /** Playoff points still to be paid to each team in this future (members and backups). */
  readonly paid: ReadonlyMap<string, number>;
  /** Of each team's `extra`, how much this future pays. Absent pays the whole `extra`. */
  readonly extraPaid?: ReadonlyMap<string, number>;
  readonly consuming: ReadonlySet<string>;
  readonly judged: ReadonlySet<string>;
}

/** The oracle: the rivals that really take a slot from T in `future`, with T on `tPoints`. */
function realTakers(input: JointLockInput, teamKey: string, tPoints: number, future: Future): number {
  const rivals = input.pool.filter((rival) => rival.teamKey !== teamKey);
  const slotOnly = input.slotOnlyRivals.filter((key) => key !== teamKey);
  const members = future.winner === null ? [] : (input.alliances.find((a) => a.allianceNumber === future.winner)?.members ?? []);
  const qualifying = new Set<string>([...members, ...future.winnerBackups, ...future.consuming]);
  let takers = 0;
  for (const key of slotOnly) if (qualifying.has(key)) takers += 1;
  for (const rival of rivals) {
    if (qualifying.has(rival.teamKey)) {
      takers += 1;
      continue;
    }
    const points =
      rival.floor +
      (future.extraPaid?.get(rival.teamKey) ?? rival.extra) +
      (future.paid.get(rival.teamKey) ?? 0) +
      (future.judged.has(rival.teamKey) ? JUDGED : 0);
    if (points >= tPoints) takers += 1;
  }
  return takers;
}

/** The played rows for a list of (set id, winning alliance) decisions, in TBA's coordinates. */
function playedRows(decisions: readonly (readonly [string, number])[]): PlayedBracketMatch[] {
  return decisions.map(([setId, winner]) =>
    setId === "f"
      ? { compLevel: "f", setNumber: 1, matchNumber: 1, winningAllianceNumber: winner }
      : { compLevel: "sf", setNumber: Number(setId.slice(2)), matchNumber: 1, winningAllianceNumber: winner }
  );
}

/** Routes a bracket with the played decisions fixed and every other set decided by `decideOpen`. */
function completeBracket(played: ReadonlyMap<string, number>, decideOpen: (a: number, b: number, setId: string, matchNumber: number) => number): ReadonlyMap<number, number> {
  return routeBracket((a, b, setId, matchNumber) => played.get(bracketDecisionKey(setId, matchNumber)) ?? decideOpen(a, b, setId, matchNumber)).placementByAlliance;
}

/** What each placement pays in a future: the maxima for 1, 3 and 4, and 60 or 75 for a losing finalist. */
function placementPay(placement: number, loserWonAFinal: boolean): number {
  if (placement === 2) return loserWonAFinal ? 75 : 60;
  return maxPlayoffPointsByPlacement(2026, "dcmp", placement);
}

// ---------------------------------------------------------------------------
// Fixtures for the exhaustive tests
// ---------------------------------------------------------------------------

/** Eight alliances of three members and two unpicked teams, floors close enough that seats, placements and awards all matter. */
function exhaustiveField(): { pool: JointLockRival[]; alliances: JointLockAlliance[]; unpicked: string[] } {
  const pool: JointLockRival[] = [];
  const alliances: JointLockAlliance[] = [];
  let index = 0;
  for (let allianceNumber = 1; allianceNumber <= 8; allianceNumber++) {
    const members: string[] = [];
    for (let pick = 1; pick <= 3; pick++) {
      const teamKey = `a${allianceNumber}${pick}`;
      pool.push({ teamKey, floor: 60 + ((index * 37) % 97), extra: 0 });
      members.push(teamKey);
      index++;
    }
    alliances.push({ allianceNumber, members });
  }
  const unpicked = ["u1", "u2"];
  for (const teamKey of unpicked) pool.push({ teamKey, floor: 60 + ((index++ * 37) % 97), extra: 0 });
  return { pool, alliances, unpicked };
}

/** Rounds 1 and 2: 1, 4, 2 and 3 win Round 1; 5 and 6 survive the lower bracket; 1 and 3 win the upper sets. Alliances 8 and 7 are placed seventh and eighth. */
const ROUND_TWO_DECISIONS = [
  ["sf1", 1],
  ["sf2", 4],
  ["sf3", 2],
  ["sf4", 3],
  ["sf5", 5],
  ["sf6", 6],
  ["sf7", 1],
  ["sf8", 3],
] as const;

/** Rounds 3 and 4 on top of Round 2: 6 and 2 survive the lower bracket, 1 wins the upper final, 2 beats 6. Alive: 1, 2, 3. */
const ROUND_FOUR_DECISIONS = [...ROUND_TWO_DECISIONS, ["sf9", 6], ["sf10", 2], ["sf11", 1], ["sf12", 2]] as const;

function playedMap(decisions: readonly (readonly [string, number])[]): ReadonlyMap<string, number> {
  return bracketDecisionsFromPlayedMatches(playedRows(decisions));
}

/** Every completion of the open sets: each open sf set either way, then the final's winner and whether its loser won one Finals match. */
function everyCompletion(played: ReadonlyMap<string, number>): { placementByAlliance: ReadonlyMap<number, number>; loserWonAFinal: boolean }[] {
  const openSets = ["sf9", "sf10", "sf11", "sf12", "sf13"].filter((setId) => !played.has(bracketDecisionKey(setId, 1)));
  const out: { placementByAlliance: ReadonlyMap<number, number>; loserWonAFinal: boolean }[] = [];
  for (let bits = 0; bits < 1 << openSets.length; bits++) {
    for (const finalPick of [0, 1]) {
      const placementByAlliance = completeBracket(played, (a, b, setId) => {
        if (setId === "f") return finalPick === 0 ? a : b;
        const bit = (bits >> openSets.indexOf(setId)) & 1;
        return bit === 0 ? a : b;
      });
      for (const loserWonAFinal of [false, true]) out.push({ placementByAlliance, loserWonAFinal });
    }
  }
  return out;
}

/**
 * The exhaustive check for one T: every completion, every backup placement,
 * every consuming recipient and every judged recipient (one award per team).
 * Returns the most takers seen. The two awards are added to each base future
 * incrementally; `realTakers` recomputes a sample of them in full so the
 * increment cannot drift from the oracle.
 */
function exhaustiveMaxTakers(
  input: JointLockInput,
  teamKey: string,
  completions: readonly { placementByAlliance: ReadonlyMap<number, number>; loserWonAFinal: boolean }[],
  backupCandidates: readonly string[]
): number {
  const self = input.pool.find((rival) => rival.teamKey === teamKey)!;
  const m = self.floor;
  const allianceOf = new Map<string, number>();
  for (const alliance of input.alliances) for (const member of alliance.members) allianceOf.set(member, alliance.allianceNumber);
  const everyone = [...input.pool.map((rival) => rival.teamKey), ...input.slotOnlyRivals];
  const poolKeys = new Set(input.pool.map((rival) => rival.teamKey));
  const alive = input.aliveAlliances;

  // Every placement of the backup candidates: none, or one alive alliance each, at most one per alliance.
  const placements: (number | null)[][] = [[]];
  for (let c = 0; c < backupCandidates.length; c++) {
    const next: (number | null)[][] = [];
    for (const partial of placements) {
      next.push([...partial, null]);
      for (const allianceNumber of alive) if (!partial.includes(allianceNumber)) next.push([...partial, allianceNumber]);
    }
    placements.splice(0, placements.length, ...next);
  }

  let most = 0;
  let checks = 0;
  for (const completion of completions) {
    let winner: number | null = null;
    for (const [allianceNumber, placement] of completion.placementByAlliance) if (placement === 1) winner = allianceNumber;
    if (winner !== null && allianceOf.get(teamKey) === winner) continue;
    for (const placement of placements) {
      const winnerBackups = backupCandidates.filter((_, index) => placement[index] === winner);
      if (winnerBackups.includes(teamKey)) continue;
      const paid = new Map<string, number>();
      for (const allianceNumber of alive) {
        const value = placementPay(completion.placementByAlliance.get(allianceNumber)!, completion.loserWonAFinal);
        for (const member of input.alliances.find((a) => a.allianceNumber === allianceNumber)!.members) paid.set(member, value);
      }
      backupCandidates.forEach((key, index) => {
        const seat = placement[index];
        if (seat !== null && seat !== undefined) paid.set(key, placementPay(completion.placementByAlliance.get(seat)!, completion.loserWonAFinal));
      });
      paid.delete(teamKey);
      const base: Future = { winner, winnerBackups, paid, consuming: new Set(), judged: new Set() };
      const baseTakers = realTakers(input, teamKey, m, base);

      const winnerMembers = new Set([...(winner === null ? [] : input.alliances.find((a) => a.allianceNumber === winner)!.members), ...winnerBackups]);
      const points = new Map(input.pool.map((rival) => [rival.teamKey, rival.floor + rival.extra + (paid.get(rival.teamKey) ?? 0)] as const));
      const pointsOf = (key: string): number => points.get(key)!;
      const takers0 = new Set(everyone.filter((key) => winnerMembers.has(key) || (poolKeys.has(key) && pointsOf(key) >= m)));
      const takerAlready = (key: string): boolean => takers0.has(key);

      for (const consuming of [null, ...everyone]) {
        if (consuming === teamKey) continue;
        const consumingDelta = consuming !== null && !takerAlready(consuming) ? 1 : 0;
        for (const judged of [null, ...everyone]) {
          if (judged === teamKey || (judged !== null && judged === consuming)) continue;
          const judgedDelta = judged !== null && poolKeys.has(judged) && !takerAlready(judged) && pointsOf(judged) + JUDGED >= m ? 1 : 0;
          const takers = baseTakers + consumingDelta + judgedDelta;
          if (takers > most) most = takers;
          if (++checks % 997 === 0) {
            const full = realTakers(input, teamKey, m, {
              ...base,
              consuming: new Set(consuming === null ? [] : [consuming]),
              judged: new Set(judged === null ? [] : [judged]),
            });
            expect(full, `${teamKey}: incremental count drifted from the oracle`).toBe(takers);
          }
        }
      }
    }
  }
  return most;
}

describe("champJointLock: constants and the bracket state", () => {
  it("caps every rival at one point paying award", () => {
    expect(MAX_POINT_PAYING_AWARDS_PER_TEAM).toBe(1);
  });

  it("dcmpBracketState routes the played rows, and refuses a mis-mapped row", () => {
    const state = dcmpBracketState(playedRows(ROUND_TWO_DECISIONS), [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(state?.alive).toEqual([1, 2, 3, 4, 5, 6]);
    expect(state?.decidedWinner).toBeUndefined();
    expect(dcmpBracketState(playedRows([["sf1", 5]]), [1, 2, 3, 4, 5, 6, 7, 8])).toBeUndefined();
    const decided = dcmpBracketState(
      playedRows([...ROUND_FOUR_DECISIONS, ["sf13", 3]]).concat([
        { compLevel: "f", setNumber: 1, matchNumber: 1, winningAllianceNumber: 3 },
        { compLevel: "f", setNumber: 1, matchNumber: 2, winningAllianceNumber: 3 },
      ]),
      [1, 2, 3, 4, 5, 6, 7, 8]
    );
    expect(decided?.decidedWinner).toBe(3);
    expect(decided?.alive).toEqual([]);
  });
});

describe("champJointLock: exhaustive soundness (D5)", () => {
  it("E1: after Round 2, C=1, K=1, no future's real takers exceed the bound for any team", () => {
    const { pool, alliances, unpicked } = exhaustiveField();
    const input: JointLockInput = {
      pool,
      slotOnlyRivals: [],
      pointsSlots: 15,
      alliances,
      aliveAlliances: [1, 2, 3, 4, 5, 6],
      candidateWinners: [1, 2, 3, 4, 5, 6],
      placementPoints: [75, 39, 21],
      consumingAwards: 1,
      judgedAwards: 1,
      judgedAwardPoints: JUDGED,
      maxAllianceSize: 4,
    };
    const completions = everyCompletion(playedMap(ROUND_TWO_DECISIONS));
    expect(completions).toHaveLength(128);
    const locked = jointLockedTeams(input);
    expect(locked.size).toBeGreaterThan(0);
    expect(locked.size).toBeLessThan(pool.length);
    for (const rival of pool) {
      const bound = jointLockBound(input, rival.teamKey);
      const most = exhaustiveMaxTakers(input, rival.teamKey, completions, unpicked);
      expect(most, `${rival.teamKey}: real takers ${most} above bound ${bound}`).toBeLessThanOrEqual(bound);
    }
  }, 120_000);

  it("E2: after Round 4 with slot only rivals on an alive alliance and unpicked, the bound still holds", () => {
    const { pool: fullPool, alliances: fullAlliances } = exhaustiveField();
    // Alliance 3's third member is a prequalified team not yet award qualified,
    // so it leaves the points pool and becomes a slot only rival.
    const pool = fullPool.filter((rival) => rival.teamKey !== "a33");
    // Alliance 6 was placed fourth in Round 4: its members' settled maximum, 21, sits in extra.
    const withSettled = pool.map((rival) => (rival.teamKey.startsWith("a6") ? { ...rival, extra: 21 } : rival));
    const input: JointLockInput = {
      pool: withSettled,
      slotOnlyRivals: ["a33", "q1"],
      pointsSlots: 15,
      alliances: fullAlliances,
      aliveAlliances: [1, 2, 3],
      candidateWinners: [1, 2, 3],
      placementPoints: [75, 39, 21],
      consumingAwards: 1,
      judgedAwards: 1,
      judgedAwardPoints: JUDGED,
      maxAllianceSize: 4,
    };
    const completions = everyCompletion(playedMap(ROUND_FOUR_DECISIONS));
    expect(completions).toHaveLength(8);
    for (const rival of withSettled) {
      const bound = jointLockBound(input, rival.teamKey);
      const most = exhaustiveMaxTakers(input, rival.teamKey, completions, ["u1", "u2", "q1"]);
      expect(most, `${rival.teamKey}: real takers ${most} above bound ${bound}`).toBeLessThanOrEqual(bound);
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// The sampled test (D5): realistic budgets and 2026 values
// ---------------------------------------------------------------------------

interface SampledCase {
  readonly label: string;
  readonly decisions: readonly (readonly [string, number])[];
  /** True for the Playoffs final, winner posted case: alliance 3 wins the final 2 to 0. */
  readonly posted: boolean;
}

/** The two Finals rows of the posted case. */
const FINAL_ROWS: PlayedBracketMatch[] = [
  { compLevel: "f", setNumber: 1, matchNumber: 1, winningAllianceNumber: 3 },
  { compLevel: "f", setNumber: 1, matchNumber: 2, winningAllianceNumber: 3 },
];

const SAMPLED_CASES: readonly SampledCase[] = [
  { label: "Alliances final, 8 alive", decisions: [], posted: false },
  { label: "after Round 2", decisions: ROUND_TWO_DECISIONS, posted: false },
  { label: "after Round 4", decisions: ROUND_FOUR_DECISIONS, posted: false },
  {
    label: "Playoffs final, winner posted",
    decisions: [...ROUND_FOUR_DECISIONS, ["sf13", 3]],
    posted: true,
  },
];

describe("champJointLock: sampled soundness (D5)", () => {
  for (const sampled of SAMPLED_CASES) {
    it(`S1 ${sampled.label}: 20,000 random futures, C=5, K=13, never above the bound`, () => {
      const random = mulberry32(2610092 + sampled.decisions.length);
      const teamKeys = Array.from({ length: 52 }, (_, index) => `frc${index + 1}`);
      const floors = new Map(teamKeys.map((key) => [key, 120 + Math.floor(random() * 201)] as const));
      // Eight alliances of three, two of them four, from a shuffled field; the rest unpicked.
      const shuffled = [...teamKeys].sort(() => random() - 0.5);
      const alliances: JointLockAlliance[] = [];
      let cursor = 0;
      for (let allianceNumber = 1; allianceNumber <= 8; allianceNumber++) {
        const size = allianceNumber === 2 || allianceNumber === 5 ? 4 : 3;
        alliances.push({ allianceNumber, members: shuffled.slice(cursor, cursor + size) });
        cursor += size;
      }
      const unpicked = shuffled.slice(cursor);
      const allianceOf = new Map<string, number>();
      for (const alliance of alliances) for (const member of alliance.members) allianceOf.set(member, alliance.allianceNumber);

      // The fixed decisions, and the full played bracket for the posted case.
      const played = playedMap(sampled.decisions);
      const state = dcmpBracketState(playedRows(sampled.decisions).concat(sampled.posted ? FINAL_ROWS : []), [1, 2, 3, 4, 5, 6, 7, 8])!;
      if (sampled.posted) expect(state.decidedWinner).toBe(3);
      const decided = state.placementByAlliance;
      const postedWinners = sampled.posted ? new Set(alliances[2]!.members) : new Set<string>();

      // Decided placements before the stop: exact at their value in the floor
      // when the playoffs are final, otherwise the maximum in `extra`.
      const pool: JointLockRival[] = teamKeys
        .filter((key) => !postedWinners.has(key))
        .map((teamKey) => {
          const allianceNumber = allianceOf.get(teamKey);
          const placement = allianceNumber === undefined ? undefined : decided.get(allianceNumber);
          const value = placement === undefined ? 0 : maxPlayoffPointsByPlacement(2026, "dcmp", placement);
          const floor = floors.get(teamKey)!;
          return sampled.posted ? { teamKey, floor: floor + value, extra: 0 } : { teamKey, floor, extra: value };
        });
      const input: JointLockInput = {
        pool,
        slotOnlyRivals: [],
        pointsSlots: 15,
        alliances,
        aliveAlliances: sampled.posted ? [] : state.alive,
        candidateWinners: sampled.posted ? [null] : state.alive,
        placementPoints: [75, 39, 21],
        consumingAwards: 5,
        judgedAwards: 13,
        judgedAwardPoints: JUDGED,
        maxAllianceSize: 4,
      };
      const bounds = new Map(pool.map((rival) => [rival.teamKey, jointLockBound(input, rival.teamKey)] as const));
      const most = new Map<string, number>();

      for (let draw = 0; draw < 20_000; draw++) {
        // The bracket: random winners for the open sets.
        let placementByAlliance: ReadonlyMap<number, number> = decided;
        const loserWonAFinal = random() < 0.5;
        if (!sampled.posted) placementByAlliance = completeBracket(played, (a, b) => (random() < 0.5 ? a : b));
        let winner: number | null = null;
        if (!sampled.posted) for (const [allianceNumber, placement] of placementByAlliance) if (placement === 1) winner = allianceNumber;

        const paid = new Map<string, number>();
        const extraPaid = new Map<string, number>();
        const winnerBackups: string[] = [];
        if (!sampled.posted) {
          const freeUnpicked = [...unpicked];
          for (const allianceNumber of state.alive) {
            const value = placementPay(placementByAlliance.get(allianceNumber)!, loserWonAFinal);
            const alliance = alliances[allianceNumber - 1]!;
            for (const member of alliance.members) paid.set(member, random() < 0.1 ? Math.floor(random() * value) : value);
            for (let seat = alliance.members.length; seat < 4; seat++) {
              if (random() >= 0.3 || freeUnpicked.length === 0) continue;
              const backup = freeUnpicked.splice(Math.floor(random() * freeUnpicked.length), 1)[0]!;
              paid.set(backup, value);
              if (allianceNumber === winner) winnerBackups.push(backup);
            }
          }
          // A decided placement's settled value can be prorated below its maximum.
          for (const rival of pool) if (rival.extra > 0 && random() < 0.1) extraPaid.set(rival.teamKey, Math.floor(random() * rival.extra));
        }

        // Awards: C distinct consuming recipients, K judged to other distinct teams.
        const order = [...teamKeys].sort(() => random() - 0.5);
        const consuming = new Set(order.slice(0, 5));
        const judged = new Set(order.slice(5, 18));

        for (const rival of pool) {
          const teamKey = rival.teamKey;
          if (consuming.has(teamKey)) continue; // T qualifies by its award
          if (winner !== null && (allianceOf.get(teamKey) === winner || winnerBackups.includes(teamKey))) continue;
          const own = paid.has(teamKey) && random() < 0.5 ? paid.get(teamKey)! : 0;
          const tPoints = rival.floor + own + (judged.has(teamKey) ? JUDGED : 0);
          const future: Future = { winner, winnerBackups, paid, extraPaid, consuming, judged };
          const takers = realTakers(input, teamKey, tPoints, future);
          if (takers > (most.get(teamKey) ?? 0)) most.set(teamKey, takers);
        }
      }

      for (const rival of pool) {
        const bound = bounds.get(rival.teamKey)!;
        const seen = most.get(rival.teamKey) ?? 0;
        expect(seen, `${sampled.label} ${rival.teamKey}: real takers ${seen} above bound ${bound}`).toBeLessThanOrEqual(bound);
      }
    }, 120_000);
  }
});

// ---------------------------------------------------------------------------
// The literal greedy order of CONTEXT D2, as a reference the bound must dominate
// ---------------------------------------------------------------------------

/** D2's steps 1 to 6 in their literal order: ties broken by input order. A feasible allocation, so never above the bound. */
function greedyReference(input: JointLockInput, teamKey: string): number {
  const self = input.pool.find((rival) => rival.teamKey === teamKey);
  if (self === undefined || input.candidateWinners.length === 0) return Infinity;
  const m = self.floor;
  const allianceOf = new Map<string, number>();
  for (const alliance of input.alliances) for (const member of alliance.members) allianceOf.set(member, alliance.allianceNumber);
  const membersOf = (n: number): readonly string[] => input.alliances.find((a) => a.allianceNumber === n)?.members ?? [];
  const rivals = input.pool.filter((rival) => rival.teamKey !== teamKey);
  const slotOnly = input.slotOnlyRivals.filter((key) => key !== teamKey);
  const values = [...input.placementPoints].sort((a, b) => b - a);
  let best = 0;
  let anyWinner = false;
  for (const winner of input.candidateWinners) {
    if (winner !== null && membersOf(winner).includes(teamKey)) continue;
    anyWinner = true;
    const others = input.aliveAlliances.filter((n) => n !== winner);
    const k = Math.min(values.length, others.length);
    const selections: number[][] = [];
    const visit = (current: number[]): void => {
      if (current.length === k) return void selections.push(current);
      for (const n of others) if (!current.includes(n)) visit([...current, n]);
    };
    visit([]);
    for (const selection of selections) {
      const assigned = new Map(selection.map((n, index) => [n, values[index]!] as const));
      const covered = new Set<string>();
      const winnerMembers = winner === null ? [] : membersOf(winner);
      for (const member of winnerMembers) if (member !== teamKey && (rivals.some((r) => r.teamKey === member) || slotOnly.includes(member))) covered.add(member);
      const points = new Map<string, number>();
      for (const rival of rivals) {
        const n = allianceOf.get(rival.teamKey);
        points.set(rival.teamKey, rival.floor + rival.extra + (n === undefined ? 0 : (assigned.get(n) ?? 0)));
      }
      for (const rival of rivals) if (points.get(rival.teamKey)! >= m) covered.add(rival.teamKey);
      // 3b: seats on the losing alive alliances, largest value first, each to the highest unpicked uncovered rival.
      const seated = new Set<string>();
      for (const [n, value] of [...assigned].sort((a, b) => b[1] - a[1])) {
        if (value <= 0) continue;
        for (let seat = membersOf(n).length; seat < input.maxAllianceSize; seat++) {
          const candidates = rivals
            .filter((r) => !allianceOf.has(r.teamKey) && !covered.has(r.teamKey) && !seated.has(r.teamKey))
            .sort((a, b) => b.floor + b.extra - (a.floor + a.extra));
          const pick = candidates[0];
          if (pick === undefined) continue;
          seated.add(pick.teamKey);
          points.set(pick.teamKey, points.get(pick.teamKey)! + value);
          if (points.get(pick.teamKey)! >= m) covered.add(pick.teamKey);
        }
      }
      // 4: consuming awards to the largest need first (slot only rivals can only be reached this way).
      const need = (key: string): number => (points.has(key) ? m - points.get(key)! : Infinity);
      const uncoveredAll = (): string[] => [...rivals.map((r) => r.teamKey), ...slotOnly].filter((key) => !covered.has(key));
      for (const key of uncoveredAll().sort((a, b) => need(b) - need(a)).slice(0, input.consumingAwards)) covered.add(key);
      // 5: judged awards, ascending deficit, one each.
      const liftable = rivals.map((r) => r.teamKey).filter((key) => !covered.has(key) && points.get(key)! + input.judgedAwardPoints >= m);
      for (const key of liftable.sort((a, b) => need(a) - need(b)).slice(0, input.judgedAwards)) covered.add(key);
      // 6: fill ins from the unpicked.
      const fillIns = winner === null ? 0 : Math.max(0, input.maxAllianceSize - winnerMembers.length);
      for (const key of uncoveredAll().filter((key) => !allianceOf.has(key)).slice(0, fillIns)) covered.add(key);
      best = Math.max(best, covered.size);
    }
  }
  return anyWinner ? best : 0;
}

/** A minimal input: alliances 1 to 8, the given members, nobody else on them. */
function minimalInput(overrides: Partial<JointLockInput> & Pick<JointLockInput, "pool">): JointLockInput {
  return {
    slotOnlyRivals: [],
    pointsSlots: 3,
    alliances: [],
    aliveAlliances: [],
    candidateWinners: [],
    placementPoints: [75, 39, 21],
    consumingAwards: 0,
    judgedAwards: 0,
    judgedAwardPoints: JUDGED,
    maxAllianceSize: 4,
    ...overrides,
  };
}

/** Alliance 1 wins with three members who are not in the pool, so one backup seat (a fill in) is open. */
const OUTSIDE_WINNER: JointLockAlliance = { allianceNumber: 1, members: ["x1", "x2", "x3"] };

describe("champJointLock: where D2's literal greedy order undercounts", () => {
  it("R1: a consuming award against a fill in, two rivals at the same need, bound 2 where greedy gives 1", () => {
    const input = minimalInput({
      pool: [
        { teamKey: "T", floor: 100, extra: 0 },
        { teamKey: "u1", floor: 50, extra: 0 },
        { teamKey: "n1", floor: 50, extra: 0 },
      ],
      alliances: [OUTSIDE_WINNER, { allianceNumber: 8, members: ["n1", "y1", "y2"] }],
      aliveAlliances: [1],
      candidateWinners: [1],
      consumingAwards: 1,
    });
    expect(greedyReference(input, "T")).toBe(1);
    expect(jointLockBound(input, "T")).toBe(2);
  });

  it("R2: seat matching, 75 and 21 against 180 and 125 with T at 200, bound 2 where greedy gives 1", () => {
    const input = minimalInput({
      pool: [
        { teamKey: "T", floor: 200, extra: 0 },
        { teamKey: "u180", floor: 180, extra: 0 },
        { teamKey: "u125", floor: 125, extra: 0 },
      ],
      alliances: [
        { allianceNumber: 1, members: ["x1", "x2", "x3", "x4"] },
        { allianceNumber: 2, members: ["y1", "y2", "y3"] },
        { allianceNumber: 3, members: ["z1", "z2", "z3"] },
      ],
      aliveAlliances: [1, 2, 3],
      candidateWinners: [1],
      placementPoints: [75, 21],
    });
    expect(greedyReference(input, "T")).toBe(1);
    expect(jointLockBound(input, "T")).toBe(2);
  });

  it("R3: a judged award against a fill in, bound 2 where greedy gives 1", () => {
    const input = minimalInput({
      pool: [
        { teamKey: "T", floor: 100, extra: 0 },
        { teamKey: "u", floor: 95, extra: 0 },
        { teamKey: "n", floor: 90, extra: 0 },
      ],
      alliances: [OUTSIDE_WINNER, { allianceNumber: 8, members: ["n", "y1", "y2"] }],
      aliveAlliances: [1],
      candidateWinners: [1],
      judgedAwards: 1,
    });
    expect(greedyReference(input, "T")).toBe(1);
    expect(jointLockBound(input, "T")).toBe(2);
  });

  it("dominance: the literal greedy never exceeds the bound on 500 seeded random instances", () => {
    const random = mulberry32(26100901);
    const integer = (lo: number, hi: number): number => lo + Math.floor(random() * (hi - lo + 1));
    for (let instance = 0; instance < 500; instance++) {
      const keys = Array.from({ length: integer(8, 16) }, (_, index) => `t${index}`);
      const shuffled = [...keys].sort(() => random() - 0.5);
      const alliances: JointLockAlliance[] = [];
      let cursor = 0;
      for (let allianceNumber = 1; allianceNumber <= 4 && cursor < shuffled.length - 2; allianceNumber++) {
        const size = integer(1, 3);
        alliances.push({ allianceNumber, members: shuffled.slice(cursor, cursor + size) });
        cursor += size;
      }
      const slotOnly = random() < 0.3 ? [shuffled[shuffled.length - 1]!] : [];
      const pool = keys.filter((key) => !slotOnly.includes(key)).map((teamKey) => ({ teamKey, floor: integer(50, 150), extra: random() < 0.2 ? integer(1, 30) : 0 }));
      const alive = alliances.map((a) => a.allianceNumber).filter(() => random() < 0.8);
      const input: JointLockInput = {
        pool,
        slotOnlyRivals: slotOnly,
        pointsSlots: 4,
        alliances,
        aliveAlliances: alive,
        candidateWinners: alive.length > 0 ? alive : [null],
        placementPoints: [75, 39, 21],
        consumingAwards: integer(0, 2),
        judgedAwards: integer(0, 3),
        judgedAwardPoints: JUDGED,
        maxAllianceSize: 4,
      };
      for (const rival of pool) {
        const greedy = greedyReference(input, rival.teamKey);
        const bound = jointLockBound(input, rival.teamKey);
        expect(greedy, `instance ${instance} ${rival.teamKey}`).toBeLessThanOrEqual(bound);
      }
    }
  }, 60_000);
});

describe("champJointLock: edges", () => {
  const pool: JointLockRival[] = [
    { teamKey: "T", floor: 100, extra: 0 },
    { teamKey: "r1", floor: 99, extra: 0 },
    { teamKey: "r2", floor: 98, extra: 0 },
    { teamKey: "r3", floor: 97, extra: 0 },
    { teamKey: "r4", floor: 96, extra: 0 },
  ];

  it("no candidate winner gives Infinity and an empty locked set", () => {
    const input = minimalInput({ pool });
    expect(jointLockBound(input, "T")).toBe(Infinity);
    expect(jointLockedTeams(input).size).toBe(0);
  });

  it("T on the only candidate winner gives bound 0 and T locked", () => {
    const input = minimalInput({
      pool,
      alliances: [{ allianceNumber: 1, members: ["T", "r1", "r2"] }],
      aliveAlliances: [1],
      candidateWinners: [1],
      pointsSlots: 1,
    });
    expect(jointLockBound(input, "T")).toBe(0);
    expect(jointLockedTeams(input).has("T")).toBe(true);
  });

  it("a team outside the pool gives Infinity", () => {
    expect(jointLockBound(minimalInput({ pool, candidateWinners: [null] }), "nobody")).toBe(Infinity);
  });

  it("stopAt returns the first value at or above it, never above the exact maximum", () => {
    const input = minimalInput({ pool, candidateWinners: [null], judgedAwards: 4 });
    const exact = jointLockBound(input, "T");
    expect(exact).toBe(4);
    const early = jointLockBound(input, "T", 2);
    expect(early).toBeGreaterThanOrEqual(2);
    expect(early).toBeLessThanOrEqual(exact);
    expect(jointLockBound(input, "T", 99)).toBe(exact);
  });
});

// ===========================================================================
// Quick task 261009-kt3: frames, divisioned and multiple championships
// ===========================================================================

describe("champJointLock: frames, the observer and the guards (261009-kt3)", () => {
  it("jointLockBound equals jointLockBoundAt at the team's own floor, and the single frames are the shipped scenarios", () => {
    const { pool, alliances } = exhaustiveField();
    const input: JointLockInput = {
      pool,
      slotOnlyRivals: [],
      pointsSlots: 15,
      alliances,
      aliveAlliances: [1, 2, 3, 4, 5, 6],
      candidateWinners: [1, 2, 3, 4, 5, 6],
      placementPoints: [75, 39, 21],
      consumingAwards: 1,
      judgedAwards: 2,
      judgedAwardPoints: JUDGED,
      maxAllianceSize: 4,
    };
    const frames = singleChampionshipFrames(input);
    expect(frames.map((frame) => frame.winner)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const frame of frames) {
      expect(frame.fillIns).toBe(1);
      expect(frame.fillInsFromAnyRival).toBe(false);
      expect(frame.enumeratedSeatBonus).toBe(0);
      expect(frame.fixed.size + frame.extraSeats.size + frame.anyRivalSeats.size).toBe(0);
    }
    for (const rival of pool) {
      expect(jointLockBoundAt(input, rival.teamKey, rival.floor)).toBe(jointLockBound(input, rival.teamKey));
      expect(jointLockBound({ ...input, frames }, rival.teamKey)).toBe(jointLockBound(input, rival.teamKey));
    }
  });

  it("the observer variant counts every candidate winner when T is absent from the pool", () => {
    const pool: JointLockRival[] = [
      { teamKey: "r1", floor: 99, extra: 0 },
      { teamKey: "r2", floor: 40, extra: 0 },
    ];
    const input = minimalInput({
      pool,
      alliances: [{ allianceNumber: 1, members: ["r2", "x1", "x2"] }],
      aliveAlliances: [1],
      candidateWinners: [1],
    });
    // T absent at floor 90: r1 reaches it, r2 wins with alliance 1.
    expect(jointLockBoundAt(input, "T", 90)).toBe(2);
    expect(jointLockBound(input, "T")).toBe(Infinity);
  });

  it("R10 (b): assertOneAwardPerRival accepts 1 and throws on 2, naming the constant", () => {
    expect(() => assertOneAwardPerRival(1)).not.toThrow();
    expect(() => assertOneAwardPerRival(2)).toThrow(/MAX_POINT_PAYING_AWARDS_PER_TEAM/);
    expect(EXACT_COVER_STATE_CAP).toBe(250_000);
  });

  it("R10: the cover upper bound is never below the exact program on 20,000 seeded random instances", () => {
    const random = mulberry32(26100903);
    const integer = (lo: number, hi: number): number => lo + Math.floor(random() * (hi - lo + 1));
    const valuePalette = [120, 90, 75, 60, 45, 39, 30, 21];
    let above = 0;
    for (let instance = 0; instance < 20_000; instance++) {
      const deficits = Array.from({ length: integer(1, 9) }, () => integer(1, 140));
      const types = [...valuePalette].sort(() => random() - 0.5).slice(0, integer(0, 3)).sort((a, b) => b - a);
      const counts = types.map(() => integer(1, 3));
      const budget = integer(0, 5);
      const exact = unpickedCover(deficits, types, counts, budget, JUDGED);
      const upper = coverUpperBound(deficits, types, counts, budget, JUDGED);
      for (let j = 0; j <= budget; j++) {
        expect(upper[j]!, `instance ${instance} j ${j}: ${JSON.stringify({ deficits, types, counts, budget })}`).toBeGreaterThanOrEqual(exact[j]!);
        if (upper[j]! > exact[j]!) above += 1;
      }
    }
    expect(above).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it("R11: a rival reachable only through a 120 point seat is covered when a frame credits 120 and the placement values top out at 75", () => {
    const input = minimalInput({
      pool: [
        { teamKey: "T", floor: 200, extra: 0 },
        { teamKey: "u", floor: 70, extra: 0 },
      ],
      alliances: [
        { allianceNumber: 1, members: ["x1", "x2", "x3", "x4"] },
        { allianceNumber: 2, members: ["y1", "y2", "y3"] },
      ],
      aliveAlliances: [1, 2],
      candidateWinners: [1],
      judgedAwards: 1,
      frames: [
        {
          winner: 1,
          enumerated: [],
          fixed: new Map([[2, 120]]),
          extraSeats: new Map(),
          fillIns: 0,
          fillInsFromAnyRival: true,
          enumeratedSeatBonus: 0,
          anyRivalSeats: new Map(),
        },
      ],
    });
    // Deficit 130: one seat at 120 plus one judged award (15) covers it; 75 plus 15 would not.
    expect(jointLockBound(input, "T")).toBe(1);
  });

  it("D10: a listed fourth pick at 0 points leaves its seat open, so a coverable rival X is counted", () => {
    const base = minimalInput({
      pool: [
        { teamKey: "T", floor: 200, extra: 0 },
        { teamKey: "X", floor: 130, extra: 0 },
        { teamKey: "a", floor: 10, extra: 0 },
        { teamKey: "d", floor: 10, extra: 0 },
      ],
      alliances: [
        { allianceNumber: 1, members: ["x1", "x2", "x3", "x4"] },
        { allianceNumber: 2, members: ["a", "b", "c", "d"] },
      ],
      aliveAlliances: [1, 2],
      candidateWinners: [1],
      placementPoints: [75],
    });
    // Listed counting (no spareSeats): alliance 2 is full and X is never counted.
    expect(jointLockBound(base, "T")).toBe(0);
    // Confirmed counting: three confirmed picks, one seat at 75, X (needs 70) takes it.
    const confirmed: JointLockInput = { ...base, alliances: [base.alliances[0]!, { ...base.alliances[1]!, spareSeats: 1 }] };
    expect(jointLockBound(confirmed, "T")).toBe(1);
  });

  it("R8 G3: a divisioned frame's fill in counts an uncovered PICKED rival, a single frame's does not", () => {
    const input = minimalInput({
      pool: [
        { teamKey: "T", floor: 100, extra: 0 },
        { teamKey: "p", floor: 50, extra: 0 },
      ],
      alliances: [
        { allianceNumber: 1, members: ["x1", "x2", "x3"] },
        { allianceNumber: 2, members: ["p", "y1", "y2", "y3"] },
      ],
      aliveAlliances: [1],
      candidateWinners: [1],
    });
    expect(jointLockBound(input, "T")).toBe(0);
    const anyRival = singleChampionshipFrames(input).map((frame) => ({ ...frame, fillInsFromAnyRival: true }));
    expect(jointLockBound({ ...input, frames: anyRival }, "T")).toBe(1);
  });

  it("R9 saturation: a no row rival entered in both championships is counted through the one it can still reach", () => {
    const saturated = (withX: boolean): JointLockInput =>
      minimalInput({
        pool: [
          { teamKey: "T", floor: 100, extra: 0 },
          { teamKey: "r1", floor: 50, extra: 0 },
          { teamKey: "r2", floor: 50, extra: 0 },
          ...(withX ? [{ teamKey: "X", floor: 50, extra: 0 }] : []),
        ],
        candidateWinners: [null],
        consumingAwards: 1,
      });
    const second = (withX: boolean): JointLockInput =>
      minimalInput({ pool: withX ? [{ teamKey: "X", floor: 50, extra: 0 }] : [], candidateWinners: [null], consumingAwards: 1 });
    // Championship 1 is saturated: two uncovered rivals, one award; X adds nothing there.
    expect(jointLockBound(saturated(true), "T")).toBe(jointLockBound(saturated(false), "T"));
    const inBoth = jointLockBoundMultiple([saturated(true), second(true)], "T");
    const inFirstOnly = jointLockBoundMultiple([saturated(true), second(false)], "T");
    expect(inBoth).toBe(inFirstOnly + 1);
    // The real future: r1 takes championship 1's award and X takes championship 2's.
    expect(inBoth).toBeGreaterThanOrEqual(2);
    expect(jointLockedTeamsMultiple([saturated(true), second(true)], 2).has("T")).toBe(false);
    expect(jointLockedTeamsMultiple([saturated(true), second(true)], 3).has("T")).toBe(true);
  });
});

/** A four division structure for the frame tests: three alliances per division alive or decided as given. */
function frameStructure(overrides: Partial<DivisionedJointStructure> = {}): DivisionedJointStructure {
  const divisions = [1, 2, 3, 4].map((d) => ({
    alliances: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => divisionAllianceId(d, n)),
    alive: [] as number[],
    decidedWinner: divisionAllianceId(d, 1) as number | undefined,
  }));
  const membersByAlliance = new Map<number, string[]>();
  const finalsSpareByAlliance = new Map<number, number>();
  for (const division of divisions) {
    for (const id of division.alliances) {
      membersByAlliance.set(id, [`t${id}a`, `t${id}b`, `t${id}c`]);
      finalsSpareByAlliance.set(id, 1);
    }
  }
  return {
    divisions,
    finalsPlacementByAlliance: new Map(),
    finalsElimFinal: false,
    winnerPosted: false,
    divisionChampionMax: 90,
    finalsMaxByPlacement: [60, 30, 0, 0],
    membersByAlliance,
    finalsSpareByAlliance,
    maxAllianceSize: 4,
    ...overrides,
  };
}

describe("divisionedJointFrames (261009-kt3, D4 and R5 to R8)", () => {
  it("a round stop: two divisions decided, two undecided, one frame per candidate with the other division values fixed", () => {
    const base = frameStructure();
    const divisions = base.divisions.map((division, index) =>
      index < 2 ? division : { ...division, decidedWinner: undefined, alive: index === 2 ? [31, 32, 33] : [41, 42] }
    );
    const result = divisionedJointFrames({ ...base, divisions });
    if ("refused" in result) throw new Error("refused");
    expect(result.candidateWinners).toEqual([11, 21, 31, 32, 33, 41, 42]);
    expect(result.aliveAlliances).toEqual([31, 32, 33, 41, 42]);
    const frame = result.frames.find((entry) => entry.winner === 31)!;
    expect(frame.enumerated).toEqual([32, 33]);
    expect([...frame.fixed].sort((a, b) => a[0] - b[0])).toEqual([
      [11, 30],
      [21, 30],
      [41, 120],
      [42, 120],
    ]);
    // R5 (a) with D9: W's division seat at 90 plus 30; R5 (b): finals seats of 41 and 42 at 30.
    expect([...frame.extraSeats].sort((a, b) => a[0] - b[0])).toEqual([
      [30, 2],
      [120, 1],
    ]);
    expect([...frame.anyRivalSeats]).toEqual([[30, 4]]);
    expect(frame.fillIns).toBe(1);
    expect(frame.fillInsFromAnyRival).toBe(true);
    expect(frame.enumeratedSeatBonus).toBe(30);
    for (const entry of result.frames) expect(entry.fillInsFromAnyRival).toBe(true);
  });

  it("Divisions final: one frame per division winner, the other winners at F_nw", () => {
    const result = divisionedJointFrames(frameStructure());
    if ("refused" in result) throw new Error("refused");
    expect(result.candidateWinners).toEqual([11, 21, 31, 41]);
    const frame = result.frames[0]!;
    expect(frame.enumerated).toEqual([]);
    expect([...frame.fixed].sort((a, b) => a[0] - b[0])).toEqual([
      [21, 30],
      [31, 30],
      [41, 30],
    ]);
    expect(frame.extraSeats.size).toBe(0);
  });

  it("R8 G1: W's fill ins come from finalsSpareByAlliance, never from its listed members", () => {
    const base = frameStructure();
    const membersByAlliance = new Map(base.membersByAlliance);
    membersByAlliance.set(11, ["p1", "p2", "p3", "p4"]);
    const result = divisionedJointFrames({ ...base, membersByAlliance });
    if ("refused" in result) throw new Error("refused");
    expect(result.frames.find((frame) => frame.winner === 11)!.fillIns).toBe(1);
  });

  it("a finals routing placing a winner fourth removes it and credits 0; second keeps 30; a routed champion is the only candidate", () => {
    const placedFourth = divisionedJointFrames(frameStructure({ finalsPlacementByAlliance: new Map([[41, 4]]) }));
    if ("refused" in placedFourth) throw new Error("refused");
    expect(placedFourth.candidateWinners).toEqual([11, 21, 31]);
    expect(placedFourth.frames[0]!.fixed.has(41)).toBe(false);
    const champion = divisionedJointFrames(
      frameStructure({
        finalsPlacementByAlliance: new Map([
          [11, 1],
          [21, 2],
          [31, 3],
          [41, 4],
        ]),
      })
    );
    if ("refused" in champion) throw new Error("refused");
    expect(champion.candidateWinners).toEqual([11]);
    expect([...champion.frames[0]!.fixed]).toEqual([[21, 30]]);
  });

  it("a posted winner gives [null]; finals Playoffs final with neither refuses winnerNotPosted; once final every finals value is 0", () => {
    const posted = divisionedJointFrames(frameStructure({ winnerPosted: true, finalsElimFinal: true }));
    if ("refused" in posted) throw new Error("refused");
    expect(posted.candidateWinners).toEqual([null]);
    expect(posted.frames[0]!.fixed.size).toBe(0);
    expect(divisionedJointFrames(frameStructure({ finalsElimFinal: true }))).toEqual({ refused: "winnerNotPosted" });
  });

  it("D9: a seat on an enumerated alliance in W's division at 21 plus 30 covers a rival that 21 alone does not", () => {
    const base = frameStructure({ finalsMaxByPlacement: [60, 30, 0, 0] });
    const finalsSpareByAlliance = new Map(base.finalsSpareByAlliance);
    for (const id of [11, 21, 31, 41]) finalsSpareByAlliance.set(id, 0);
    const divisions = base.divisions.map((division, index) => (index === 0 ? { ...division, alive: [11, 12] } : division));
    const result = divisionedJointFrames({ ...base, divisions, finalsSpareByAlliance });
    if ("refused" in result) throw new Error("refused");
    expect(result.candidateWinners).toEqual([11, 21, 31, 41]);
    const input: JointLockInput = {
      pool: [
        { teamKey: "T", floor: 200, extra: 0 },
        { teamKey: "u", floor: 149, extra: 0 },
      ],
      slotOnlyRivals: [],
      pointsSlots: 1,
      alliances: [...base.membersByAlliance].map(([allianceNumber, members]) => ({ allianceNumber, members, spareSeats: finalsSpareByAlliance.get(allianceNumber)! })),
      aliveAlliances: result.aliveAlliances,
      candidateWinners: result.candidateWinners.slice(0, 1),
      placementPoints: [21],
      consumingAwards: 0,
      judgedAwards: 0,
      judgedAwardPoints: JUDGED,
      maxAllianceSize: 4,
      frames: result.frames.slice(0, 1),
    };
    // Deficit 51: the seat on alliance 12 pays 21 plus F_nw 30.
    expect(jointLockBound(input, "T")).toBe(1);
    const withoutBonus = { ...input, frames: input.frames!.map((frame) => ({ ...frame, enumeratedSeatBonus: 0 })) };
    expect(jointLockBound(withoutBonus, "T")).toBe(0);
  });

  it("header step 6: a pick of an eliminated alliance may take a losing finals alliance's seat at F_nw", () => {
    const base = frameStructure();
    const result = divisionedJointFrames(base);
    if ("refused" in result) throw new Error("refused");
    const frame = result.frames[0]!;
    expect(frame.winner).toBe(11);
    const input: JointLockInput = {
      pool: [
        { teamKey: "T", floor: 200, extra: 0 },
        // On alliance 25 (a decided, eliminated alliance of division 2), 30 short.
        { teamKey: "t25a", floor: 170, extra: 0 },
      ],
      slotOnlyRivals: [],
      pointsSlots: 1,
      alliances: [...base.membersByAlliance].map(([allianceNumber, members]) => ({ allianceNumber, members, spareSeats: 1 })),
      aliveAlliances: [],
      candidateWinners: [11],
      placementPoints: [75, 39, 21],
      consumingAwards: 0,
      judgedAwards: 0,
      judgedAwardPoints: JUDGED,
      maxAllianceSize: 4,
      frames: [{ ...frame, fillIns: 0 }],
    };
    expect(jointLockBound(input, "T")).toBe(1);
    expect(jointLockBound({ ...input, frames: [{ ...frame, fillIns: 0, anyRivalSeats: new Map() }] }, "T")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Divisioned soundness: E3 (exhaustive, two divisions) and S2 (sampled, four)
// ---------------------------------------------------------------------------

/** One divisioned future, as far as the slot takers against T are concerned. */
interface DivisionedFuture {
  /** The champion's finals roster: its members and its finals backups. */
  readonly championRoster: ReadonlySet<string>;
  /** Playoff points still to be paid, division and finals together. */
  readonly paid: ReadonlyMap<string, number>;
  readonly consuming: ReadonlySet<string>;
  readonly judged: ReadonlySet<string>;
}

/** The oracle for a divisioned future: the champion's roster, the consuming award winners, and every pool rival reaching T's points. */
function divisionedTakers(input: JointLockInput, teamKey: string, tPoints: number, future: DivisionedFuture): number {
  let takers = 0;
  for (const key of input.slotOnlyRivals) if (key !== teamKey && (future.championRoster.has(key) || future.consuming.has(key))) takers += 1;
  for (const rival of input.pool) {
    if (rival.teamKey === teamKey) continue;
    if (future.championRoster.has(rival.teamKey) || future.consuming.has(rival.teamKey)) {
      takers += 1;
      continue;
    }
    const points = rival.floor + rival.extra + (future.paid.get(rival.teamKey) ?? 0) + (future.judged.has(rival.teamKey) ? JUDGED : 0);
    if (points >= tPoints) takers += 1;
  }
  return takers;
}

/** A divisioned field: `divisionCount` divisions of eight alliances of three, plus unpicked teams. Floors from `floorOf`. */
function divisionedField(divisionCount: number, unpickedCount: number, floorOf: (index: number) => number) {
  const alliances: JointLockAlliance[] = [];
  const floors = new Map<string, number>();
  const divisionOf = new Map<number, number>();
  let index = 0;
  for (let d = 1; d <= divisionCount; d++) {
    for (let n = 1; n <= 8; n++) {
      const id = divisionAllianceId(d, n);
      divisionOf.set(id, d);
      const members = [1, 2, 3].map((k) => `d${d}a${n}m${k}`);
      for (const member of members) floors.set(member, floorOf(index++));
      alliances.push({ allianceNumber: id, members, spareSeats: 1 });
    }
  }
  const unpicked = Array.from({ length: unpickedCount }, (_, k) => `u${k + 1}`);
  for (const key of unpicked) floors.set(key, floorOf(index++));
  return { alliances, floors, unpicked, divisionOf };
}

/** Division alliance numbers placed by Round 4 (`ROUND_FOUR_DECISIONS`): 6 fourth, 4 fifth, 5 sixth, 8 seventh, 7 eighth. */
const ROUND_FOUR_PLACED = new Map([
  [6, 4],
  [4, 5],
  [5, 6],
  [8, 7],
  [7, 8],
]);

/**
 * Builds the divisioned proof input at "after Round 4 in every division,
 * finals not started", with the given finals maxima, pool and extras.
 */
function roundFourDivisionedInput(
  divisionCount: number,
  field: ReturnType<typeof divisionedField>,
  poolKeys: readonly string[],
  slotOnly: readonly string[],
  finalsMaxByPlacement: readonly number[],
  consumingAwards: number,
  judgedAwards: number
): JointLockInput {
  const extraOf = (key: string): number => {
    const alliance = field.alliances.find((entry) => entry.members.includes(key));
    if (alliance === undefined) return 0;
    const placement = ROUND_FOUR_PLACED.get(alliance.allianceNumber % 10);
    return placement === undefined ? 0 : maxPlayoffPointsByPlacement(2026, "dcmp", placement);
  };
  const divisions = Array.from({ length: divisionCount }, (_, i) => ({
    alliances: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => divisionAllianceId(i + 1, n)),
    alive: [1, 2, 3].map((n) => divisionAllianceId(i + 1, n)),
    decidedWinner: undefined,
  }));
  const structure: DivisionedJointStructure = {
    divisions,
    finalsPlacementByAlliance: new Map(),
    finalsElimFinal: false,
    winnerPosted: false,
    divisionChampionMax: 90,
    finalsMaxByPlacement,
    membersByAlliance: new Map(field.alliances.map((alliance) => [alliance.allianceNumber, alliance.members] as const)),
    finalsSpareByAlliance: new Map(field.alliances.map((alliance) => [alliance.allianceNumber, 1] as const)),
    maxAllianceSize: 4,
  };
  const result = divisionedJointFrames(structure);
  if ("refused" in result) throw new Error(result.refused);
  return {
    pool: poolKeys.map((teamKey) => ({ teamKey, floor: field.floors.get(teamKey)!, extra: extraOf(teamKey) })),
    slotOnlyRivals: slotOnly,
    pointsSlots: 10,
    alliances: field.alliances,
    aliveAlliances: result.aliveAlliances,
    candidateWinners: result.candidateWinners,
    placementPoints: [75, 39, 21],
    consumingAwards,
    judgedAwards,
    judgedAwardPoints: JUDGED,
    maxAllianceSize: 4,
    frames: result.frames,
  };
}

describe("champJointLock: divisioned exhaustive soundness E3 (261009-kt3, D7)", () => {
  /**
   * Two divisions after Round 4 (alliances 1, 2 and 3 alive in each, sf13 and
   * the final open), a two alliance finals open, two unpicked backup
   * candidates (a division seat and, independently, a finals seat), C=1, K=1.
   * Every division completion, every division backup placement, every losing
   * finals backup (any pool team off the finals rosters) and, in closed form,
   * every champion fill in and award assignment: the most takers is
   * `min(|N|, C + fill ins + min(K, |J|))` over the non takers N and the
   * judged liftable J, the maximum distinct assignment of those roles (Hall),
   * cross checked against explicit enumeration on a sample.
   */
  for (const variant of [
    { label: "2026 values (30, 0), C=1, K=1", finalsMax: [30, 0], consuming: 1, judged: 1 },
    { label: "a stress variant paying the finalist 30 (60, 30), C=1, K=1", finalsMax: [60, 30], consuming: 1, judged: 1 },
    { label: "the stress variant with no award (60, 30), C=0, K=0", finalsMax: [60, 30], consuming: 0, judged: 0 },
  ]) {
    it(`E3 ${variant.label}: no future's real takers exceed the bound`, () => {
      const field = divisionedField(2, 2, (index) => 140 + ((index * 37) % 97));
      // The pool: every member of the alive alliances, one member of each decided alliance, both unpicked teams.
      const poolKeys = field.alliances.flatMap((alliance) => (alliance.allianceNumber % 10 <= 3 ? alliance.members : alliance.members.slice(0, 1))).concat(field.unpicked);
      const input = roundFourDivisionedInput(2, field, poolKeys, ["q1"], variant.finalsMax, variant.consuming, variant.judged);
      const completions = everyCompletion(playedMap(ROUND_FOUR_DECISIONS));
      expect(completions).toHaveLength(8);
      const membersOf = (id: number): readonly string[] => field.alliances.find((alliance) => alliance.allianceNumber === id)!.members;
      const poolByKey = new Map(input.pool.map((rival) => [rival.teamKey, rival] as const));
      const everyone = [...input.pool.map((rival) => rival.teamKey), ...input.slotOnlyRivals];
      const alive = [11, 12, 13, 21, 22, 23];
      // Division backup placements: each unpicked team on no seat or one alive alliance's seat, at most one per alliance.
      const seatings: (number | null)[][] = [];
      for (const a of [null, ...alive]) for (const b of [null, ...alive]) if (a === null || a !== b) seatings.push([a, b]);
      let checks = 0;

      for (const teamKey of input.pool.map((rival) => rival.teamKey)) {
        const bound = jointLockBound(input, teamKey);
        const m = poolByKey.get(teamKey)!.floor;
        let most = 0;
        for (const c1 of completions) {
          for (const c2 of completions) {
            const placement = new Map<number, number>();
            for (const [n, p] of c1.placementByAlliance) placement.set(divisionAllianceId(1, n), p);
            for (const [n, p] of c2.placementByAlliance) placement.set(divisionAllianceId(2, n), p);
            const divisionPay = (id: number): number => placementPay(placement.get(id)!, (id < 20 ? c1 : c2).loserWonAFinal);
            const winners = [...placement].filter(([, p]) => p === 1).map(([id]) => id);
            for (const champion of winners) {
              const loser = winners.find((id) => id !== champion)!;
              const championMembers = membersOf(champion);
              if (championMembers.includes(teamKey)) continue;
              for (const seating of seatings) {
                const paid = new Map<string, number>();
                for (const id of alive) for (const member of membersOf(id)) paid.set(member, divisionPay(id));
                seating.forEach((seat, index) => {
                  if (seat !== null) paid.set(field.unpicked[index]!, divisionPay(seat));
                });
                for (const member of membersOf(champion)) paid.set(member, (paid.get(member) ?? 0) + variant.finalsMax[0]!);
                for (const member of membersOf(loser)) paid.set(member, (paid.get(member) ?? 0) + variant.finalsMax[1]!);
                paid.delete(teamKey);
                const finalsRosters = new Set([...membersOf(champion), ...membersOf(loser)]);
                const losingBackups = variant.finalsMax[1]! > 0 ? [null, ...everyone.filter((key) => key !== teamKey && !finalsRosters.has(key))] : [null];
                for (const losingBackup of losingBackups) {
                  const paidHere = new Map(paid);
                  if (losingBackup !== null && poolByKey.has(losingBackup)) paidHere.set(losingBackup, (paidHere.get(losingBackup) ?? 0) + variant.finalsMax[1]!);
                  const championRoster = new Set(championMembers);
                  const base: DivisionedFuture = { championRoster, paid: paidHere, consuming: new Set(), judged: new Set() };
                  const baseTakers = divisionedTakers(input, teamKey, m, base);
                  const pointsOf = (key: string): number => {
                    const rival = poolByKey.get(key)!;
                    return rival.floor + rival.extra + (paidHere.get(key) ?? 0);
                  };
                  const nonTakers = everyone.filter((key) => key !== teamKey && !championRoster.has(key) && !(poolByKey.has(key) && pointsOf(key) >= m));
                  const liftable = nonTakers.filter((key) => poolByKey.has(key) && pointsOf(key) + JUDGED >= m);
                  const roles = Math.min(nonTakers.length, input.consumingAwards + 1 + Math.min(input.judgedAwards, liftable.length));
                  const takers = baseTakers + roles;
                  if (takers > most) most = takers;
                  if (++checks % 1999 === 0) {
                    // Explicit enumeration of the champion fill in, the consuming and the judged recipient.
                    let explicit = baseTakers;
                    for (const fill of [null, ...nonTakers]) {
                      for (const consuming of [null, ...(input.consumingAwards > 0 ? nonTakers : [])]) {
                        if (consuming !== null && consuming === fill) continue;
                        for (const judged of [null, ...(input.judgedAwards > 0 ? liftable : [])]) {
                          if (judged !== null && (judged === fill || judged === consuming)) continue;
                          const roster = new Set([...championMembers, ...(fill === null ? [] : [fill])]);
                          const value = divisionedTakers(input, teamKey, m, {
                            championRoster: roster,
                            paid: paidHere,
                            consuming: new Set(consuming === null ? [] : [consuming]),
                            judged: new Set(judged === null ? [] : [judged]),
                          });
                          if (value > explicit) explicit = value;
                        }
                      }
                    }
                    expect(explicit, `${teamKey}: closed form drifted from enumeration`).toBe(takers);
                  }
                }
              }
            }
          }
        }
        expect(most, `${variant.label} ${teamKey}: real takers ${most} above bound ${bound}`).toBeLessThanOrEqual(bound);
      }
    }, 120_000);
  }
});

/** A random completion of the four (or two) alliance finals, with any played decisions fixed. */
function randomFinals(random: () => number, allianceCount: 2 | 4, played: ReadonlyMap<string, number>): ReadonlyMap<number, number> {
  const decisions = new Map(played);
  for (;;) {
    const routing = routeFinals(decisions, allianceCount);
    if (routing.champion !== undefined) return routing.placementByAlliance;
    for (const [setId, [a, b]] of routing.participantsBySet) {
      if (routing.winnerBySet.has(setId)) continue;
      let matchNumber = 1;
      while (decisions.has(bracketDecisionKey(setId, matchNumber))) matchNumber += 1;
      decisions.set(bracketDecisionKey(setId, matchNumber), random() < 0.5 ? a : b);
      break;
    }
  }
}

interface SampledDivisionedCase {
  readonly label: string;
  /** "round4": every division after Round 4; "divisionsFinal": every division decided; "finalsSf4": and the finals' sf1 to sf4 played. */
  readonly stop: "round4" | "divisionsFinal" | "finalsSf4";
}

describe("champJointLock: divisioned sampled soundness S2 (261009-kt3, D7)", () => {
  const cases: readonly SampledDivisionedCase[] = [
    { label: "after Round 4 in every division", stop: "round4" },
    { label: "Divisions final, finals not started", stop: "divisionsFinal" },
    { label: "finals after sf1 to sf4", stop: "finalsSf4" },
  ];
  for (const sampled of cases) {
    it(`S2 ${sampled.label}: four divisions, 20,000 futures, C=5, K=56, 2026 values, never above the bound`, () => {
      const random = mulberry32(2610093 + sampled.stop.length);
      const field = divisionedField(4, 24, () => 120 + Math.floor(random() * 201));
      const finalsMax = [60, 30, 0, 0];
      const allKeys = [...field.floors.keys()];
      const membersOf = (id: number): readonly string[] => field.alliances.find((alliance) => alliance.allianceNumber === id)!.members;

      // Division states at the stop. Divisions final: alliance 1 wins each division, the rest placed as Round 4 plus sf13 to 3 and the final 2 to 0.
      const fullDecisions = [...ROUND_FOUR_DECISIONS, ["sf13", 3]] as const;
      const finalPlacement = completeBracket(playedMap(fullDecisions), (a) => a);
      const decided = sampled.stop !== "round4";
      const placementAtStop = decided ? finalPlacement : (ROUND_FOUR_PLACED as ReadonlyMap<number, number>);
      // Finals seeds: division d's winner is finals alliance d; at finalsSf4, sf1 to sf4 are played (alliance 4 fourth).
      const finalsDecisions = new Map<string, number>();
      if (sampled.stop === "finalsSf4") {
        finalsDecisions.set(bracketDecisionKey("sf1", 1), 1);
        finalsDecisions.set(bracketDecisionKey("sf2", 1), 3);
        finalsDecisions.set(bracketDecisionKey("sf3", 1), 1);
        finalsDecisions.set(bracketDecisionKey("sf4", 1), 2);
      }
      const finalsRouting = routeFinals(finalsDecisions, 4);

      const valueAtStop = (n: number): number => {
        const placement = placementAtStop.get(n);
        return placement === undefined ? 0 : maxPlayoffPointsByPlacement(2026, "dcmp", placement);
      };
      const allianceOfKey = new Map<string, number>();
      for (const alliance of field.alliances) for (const member of alliance.members) allianceOfKey.set(member, alliance.allianceNumber);
      // Decided values: in the floor once every division is final, otherwise their maximum in extra.
      const pool: JointLockRival[] = allKeys.map((teamKey) => {
        const id = allianceOfKey.get(teamKey);
        const value = id === undefined ? 0 : valueAtStop(id % 10);
        const floor = field.floors.get(teamKey)!;
        return decided ? { teamKey, floor: floor + value, extra: 0 } : { teamKey, floor, extra: value };
      });
      const divisions = [1, 2, 3, 4].map((d) => ({
        alliances: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => divisionAllianceId(d, n)),
        alive: decided ? [] : [1, 2, 3].map((n) => divisionAllianceId(d, n)),
        decidedWinner: decided ? divisionAllianceId(d, 1) : undefined,
      }));
      const finalsPlacementByAlliance = new Map<number, number>();
      for (const [finalsAlliance, placement] of finalsRouting.placementByAlliance) finalsPlacementByAlliance.set(divisionAllianceId(finalsAlliance, 1), placement);
      const structure: DivisionedJointStructure = {
        divisions,
        finalsPlacementByAlliance,
        finalsElimFinal: false,
        winnerPosted: false,
        divisionChampionMax: 90,
        finalsMaxByPlacement: finalsMax,
        membersByAlliance: new Map(field.alliances.map((alliance) => [alliance.allianceNumber, alliance.members] as const)),
        finalsSpareByAlliance: new Map(field.alliances.map((alliance) => [alliance.allianceNumber, 1] as const)),
        maxAllianceSize: 4,
      };
      const frames = divisionedJointFrames(structure);
      if ("refused" in frames) throw new Error(frames.refused);
      const input: JointLockInput = {
        pool,
        slotOnlyRivals: [],
        pointsSlots: 60,
        alliances: field.alliances,
        aliveAlliances: frames.aliveAlliances,
        candidateWinners: frames.candidateWinners,
        placementPoints: [75, 39, 21],
        consumingAwards: 5,
        judgedAwards: 56,
        judgedAwardPoints: JUDGED,
        maxAllianceSize: 4,
        frames: frames.frames,
      };
      // Several T across the floors.
      const sortedPool = [...pool].sort((a, b) => b.floor + b.extra - (a.floor + a.extra));
      const tKeys = [0, 5, 10, 20, 30, 45, 60, 80, 100].map((rank) => sortedPool[rank]!.teamKey);
      const bounds = new Map(tKeys.map((key) => [key, jointLockBound(input, key)] as const));
      const most = new Map<string, number>();
      const poolByKey = new Map(pool.map((rival) => [rival.teamKey, rival] as const));

      for (let draw = 0; draw < 20_000; draw++) {
        const paid = new Map<string, number>();
        const add = (key: string, value: number): void => {
          paid.set(key, (paid.get(key) ?? 0) + value);
        };
        const extraPaidScale = new Map<string, number>();
        // Divisions.
        const winners: number[] = [];
        const freeUnpicked = [...field.unpicked];
        for (let d = 1; d <= 4; d++) {
          if (decided) {
            winners.push(divisionAllianceId(d, 1));
            continue;
          }
          const placement = completeBracket(playedMap(ROUND_FOUR_DECISIONS), (a, b) => (random() < 0.5 ? a : b));
          const loserWonAFinal = random() < 0.5;
          for (const n of [1, 2, 3]) {
            const id = divisionAllianceId(d, n);
            const value = placementPay(placement.get(n)!, loserWonAFinal);
            if (placement.get(n) === 1) winners.push(id);
            for (const member of membersOf(id)) add(member, random() < 0.1 ? Math.floor(random() * value) : value);
            if (random() < 0.4 && freeUnpicked.length > 0) {
              const backup = freeUnpicked.splice(Math.floor(random() * freeUnpicked.length), 1)[0]!;
              add(backup, value);
            }
          }
          for (const rival of pool) if (rival.extra > 0 && random() < 0.1) extraPaidScale.set(rival.teamKey, Math.floor(random() * rival.extra));
        }
        // Finals: division d's winner is finals alliance d.
        const finalsPlacement = randomFinals(random, 4, finalsDecisions);
        const onFinalsRoster = new Set<string>();
        const rosterOf = new Map<number, string[]>();
        winners.forEach((id, index) => {
          const roster = [...membersOf(id)];
          for (const member of roster) onFinalsRoster.add(member);
          rosterOf.set(index + 1, roster);
        });
        // Finals backups from the whole field: unpicked, division backups and eliminated picks alike.
        for (let finalsAlliance = 1; finalsAlliance <= 4; finalsAlliance++) {
          if (random() >= 0.5) continue;
          const candidates = allKeys.filter((key) => !onFinalsRoster.has(key));
          const backup = candidates[Math.floor(random() * candidates.length)]!;
          onFinalsRoster.add(backup);
          rosterOf.get(finalsAlliance)!.push(backup);
        }
        let championRoster = new Set<string>();
        for (const [finalsAlliance, placement] of finalsPlacement) {
          const value = finalsMax[placement - 1]!;
          for (const member of rosterOf.get(finalsAlliance)!) add(member, random() < 0.1 ? Math.floor(random() * value) : value);
          if (placement === 1) championRoster = new Set(rosterOf.get(finalsAlliance)!);
        }
        // Awards: 5 consuming and 56 judged, one per team.
        const order = [...allKeys].sort(() => random() - 0.5);
        const consuming = new Set(order.slice(0, 5));
        const judged = new Set(order.slice(5, 61));

        for (const teamKey of tKeys) {
          if (consuming.has(teamKey) || championRoster.has(teamKey)) continue;
          const self = poolByKey.get(teamKey)!;
          const own = paid.has(teamKey) && random() < 0.5 ? paid.get(teamKey)! : 0;
          const tPoints = self.floor + own + (judged.has(teamKey) ? JUDGED : 0);
          const scaledPool = extraPaidScale.size === 0 ? input : { ...input, pool: input.pool.map((rival) => (extraPaidScale.has(rival.teamKey) ? { ...rival, extra: extraPaidScale.get(rival.teamKey)! } : rival)) };
          const takers = divisionedTakers(scaledPool, teamKey, tPoints, { championRoster, paid, consuming, judged });
          if (takers > (most.get(teamKey) ?? 0)) most.set(teamKey, takers);
        }
      }

      for (const teamKey of tKeys) {
        const bound = bounds.get(teamKey)!;
        const seen = most.get(teamKey) ?? 0;
        expect(seen, `${sampled.label} ${teamKey}: real takers ${seen} above bound ${bound}`).toBeLessThanOrEqual(bound);
      }
    }, 120_000);
  }
});

describe("champJointLock: multiple championships sampled soundness S3 (261009-kt3, D5 and R9)", () => {
  it("S3: two championships, no row rivals in both inputs, 20,000 joint futures, never above jointLockBoundMultiple", () => {
    const random = mulberry32(2610094);
    const build = (prefix: string) => {
      const keys = Array.from({ length: 40 }, (_, index) => `${prefix}${index + 1}`);
      const shuffled = [...keys].sort(() => random() - 0.5);
      const alliances: JointLockAlliance[] = [];
      let cursor = 0;
      for (let n = 1; n <= 8; n++) {
        alliances.push({ allianceNumber: n, members: shuffled.slice(cursor, cursor + 3) });
        cursor += 3;
      }
      return { keys, alliances, unpicked: shuffled.slice(cursor) };
    };
    const one = build("n");
    const two = build("s");
    const noRow = ["z1", "z2", "z3", "z4"];
    const floors = new Map<string, number>();
    for (const key of [...one.keys, ...two.keys, ...noRow]) floors.set(key, 120 + Math.floor(random() * 201));
    const played = playedMap(ROUND_TWO_DECISIONS);
    const state = dcmpBracketState(playedRows(ROUND_TWO_DECISIONS), [1, 2, 3, 4, 5, 6, 7, 8])!;
    const extraOf = (alliances: readonly JointLockAlliance[], key: string): number => {
      const alliance = alliances.find((entry) => entry.members.includes(key));
      const placement = alliance === undefined ? undefined : state.placementByAlliance.get(alliance.allianceNumber);
      return placement === undefined ? 0 : maxPlayoffPointsByPlacement(2026, "dcmp", placement);
    };
    const inputFor = (side: typeof one): JointLockInput => ({
      pool: [...side.keys, ...noRow].map((teamKey) => ({ teamKey, floor: floors.get(teamKey)!, extra: extraOf(side.alliances, teamKey) })),
      slotOnlyRivals: [],
      pointsSlots: 20,
      alliances: side.alliances,
      aliveAlliances: state.alive,
      candidateWinners: state.alive,
      placementPoints: [75, 39, 21],
      consumingAwards: 4,
      judgedAwards: 14,
      judgedAwardPoints: JUDGED,
      maxAllianceSize: 4,
    });
    const inputs = [inputFor(one), inputFor(two)];
    const tKeys = ["n1", "n7", "n15", "n30", "s3", "s20", "z1", "z3"];
    const bounds = new Map(tKeys.map((key) => [key, jointLockBoundMultiple(inputs, key)] as const));
    const most = new Map<string, number>();
    const everyone = [...one.keys, ...two.keys, ...noRow];

    for (let draw = 0; draw < 20_000; draw++) {
      const paid = new Map<string, number>();
      const qualifying = new Set<string>();
      const judged = new Set<string>();
      const freeNoRow = [...noRow];
      for (const side of [one, two]) {
        const placement = completeBracket(played, (a, b) => (random() < 0.5 ? a : b));
        const loserWonAFinal = random() < 0.5;
        const freeUnpicked = [...side.unpicked];
        for (const n of state.alive) {
          const value = placementPay(placement.get(n)!, loserWonAFinal);
          const alliance = side.alliances[n - 1]!;
          const roster = [...alliance.members];
          for (const member of alliance.members) paid.set(member, value);
          // A backup from this championship's unpicked or from the no row rivals.
          if (random() < 0.4) {
            const fromNoRow = random() < 0.5 && freeNoRow.length > 0;
            const source = fromNoRow ? freeNoRow : freeUnpicked;
            if (source.length > 0) {
              const backup = source.splice(Math.floor(random() * source.length), 1)[0]!;
              paid.set(backup, value);
              roster.push(backup);
            }
          }
          if (placement.get(n) === 1) for (const key of roster) qualifying.add(key);
        }
      }
      // Each championship gives 4 consuming and 14 judged awards to its own teams or the no row rivals, one award per team.
      const awarded = new Set<string>();
      for (const side of [one, two]) {
        const order = [...side.keys, ...noRow].filter((key) => !awarded.has(key)).sort(() => random() - 0.5);
        for (const key of order.slice(0, 4)) {
          qualifying.add(key);
          awarded.add(key);
        }
        for (const key of order.slice(4, 18)) {
          judged.add(key);
          awarded.add(key);
        }
      }
      for (const teamKey of tKeys) {
        if (qualifying.has(teamKey)) continue;
        const own = paid.has(teamKey) && random() < 0.5 ? paid.get(teamKey)! : 0;
        const tPoints = floors.get(teamKey)! + own + (judged.has(teamKey) ? JUDGED : 0);
        let takers = 0;
        for (const key of everyone) {
          if (key === teamKey) continue;
          if (qualifying.has(key)) {
            takers += 1;
            continue;
          }
          const extra = Math.max(extraOf(one.alliances, key), extraOf(two.alliances, key));
          if (floors.get(key)! + extra + (paid.get(key) ?? 0) + (judged.has(key) ? JUDGED : 0) >= tPoints) takers += 1;
        }
        if (takers > (most.get(teamKey) ?? 0)) most.set(teamKey, takers);
      }
    }
    for (const teamKey of tKeys) {
      const bound = bounds.get(teamKey)!;
      const seen = most.get(teamKey) ?? 0;
      expect(seen, `${teamKey}: real takers ${seen} above bound ${bound}`).toBeLessThanOrEqual(bound);
    }
  }, 120_000);
});

describe("divisionedJointFrames: specific real futures the frames must cover (261009-kt3 mutation guards)", () => {
  /** Two divisions, alliances 11 and 12 alive in division 1, 21 and 22 in division 2; finals pay 60 and 30; no award. */
  function twoDivisionStructure(finalsSpare: (id: number) => number): DivisionedJointStructure {
    const divisions = [1, 2].map((d) => ({
      alliances: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => divisionAllianceId(d, n)),
      alive: [1, 2].map((n) => divisionAllianceId(d, n)),
      decidedWinner: undefined,
    }));
    const membersByAlliance = new Map<number, string[]>();
    for (const division of divisions) for (const id of division.alliances) membersByAlliance.set(id, [`t${id}a`, `t${id}b`, `t${id}c`]);
    return {
      divisions,
      finalsPlacementByAlliance: new Map(),
      finalsElimFinal: false,
      winnerPosted: false,
      divisionChampionMax: 90,
      finalsMaxByPlacement: [60, 30],
      membersByAlliance,
      finalsSpareByAlliance: new Map([...membersByAlliance.keys()].map((id) => [id, finalsSpare(id)] as const)),
      maxAllianceSize: 4,
    };
  }
  function inputFor(structure: DivisionedJointStructure, pool: JointLockRival[]): JointLockInput {
    const result = divisionedJointFrames(structure);
    if ("refused" in result) throw new Error(result.refused);
    return {
      pool,
      slotOnlyRivals: [],
      pointsSlots: 1,
      alliances: [...structure.membersByAlliance].map(([allianceNumber, members]) => ({ allianceNumber, members, spareSeats: structure.finalsSpareByAlliance.get(allianceNumber)! })),
      aliveAlliances: result.aliveAlliances,
      candidateWinners: result.candidateWinners,
      placementPoints: [75, 39, 21],
      consumingAwards: 0,
      judgedAwards: 0,
      judgedAwardPoints: JUDGED,
      maxAllianceSize: 4,
      frames: result.frames,
    };
  }

  it("another division's alliance is paid 90 plus the finalist's 30: alliance 11 wins everything, 21 wins its division and is the finalist", () => {
    const structure = twoDivisionStructure(() => 0);
    const pool: JointLockRival[] = [
      { teamKey: "T", floor: 200, extra: 0 },
      ...["t11a", "t11b", "t11c"].map((teamKey) => ({ teamKey, floor: 10, extra: 0 })),
      ...["t21a", "t21b", "t21c"].map((teamKey) => ({ teamKey, floor: 85, extra: 0 })),
    ];
    const input = inputFor(structure, pool);
    const paid = new Map<string, number>([
      ...["t11a", "t11b", "t11c"].map((key) => [key, 150] as const),
      ...["t21a", "t21b", "t21c"].map((key) => [key, 120] as const),
    ]);
    const real = divisionedTakers(input, "T", 200, { championRoster: new Set(["t11a", "t11b", "t11c"]), paid, consuming: new Set(), judged: new Set() });
    expect(real).toBe(6);
    expect(jointLockBound(input, "T")).toBeGreaterThanOrEqual(real);
  });

  it("W's own division seat (reading R5 a): an unpicked team on 11's division roster, not its finals roster, is paid 90 while another takes the finals fill in", () => {
    const structure = twoDivisionStructure((id) => (id === 11 ? 1 : 0));
    const pool: JointLockRival[] = [
      { teamKey: "T", floor: 200, extra: 0 },
      { teamKey: "u", floor: 110, extra: 0 },
      { teamKey: "v", floor: 0, extra: 0 },
    ];
    const input = inputFor(structure, pool);
    // 11 wins its division with u as its backup (90), and the finals with v as its finals backup.
    const real = divisionedTakers(input, "T", 200, { championRoster: new Set(["t11a", "t11b", "t11c", "v"]), paid: new Map([["u", 90]]), consuming: new Set(), judged: new Set() });
    expect(real).toBe(2);
    expect(jointLockBound(input, "T")).toBeGreaterThanOrEqual(real);
  });
});
