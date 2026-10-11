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
  confirmedPicks,
  coverMatching,
  dcmpBracketState,
  divisionAllianceId,
  divisionedJointFrames,
  jointLockBound,
  jointLockBoundAt,
  jointLockBoundMultiple,
  jointLockedTeams,
  jointLockedTeamsMultiple,
  jointProofStillRuns,
  MAX_POINT_PAYING_AWARDS_PER_TEAM,
  singleChampionshipFrames,
  type DivisionedJointStructure,
  type JointLockAlliance,
  type JointLockFrame,
  type JointLockInput,
  type JointLockRival,
  type JointLockSeatGroup,
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

// ---------------------------------------------------------------------------
// The reference cover of one seat group (quick task 261010-l0s)
// ---------------------------------------------------------------------------

/** What `referenceCover` knows about each rival beyond its deficit, aligned with `deficits`. */
interface ReferenceCoverOptions {
  /** True for a rival that already holds a posted award (quick task 261010-d7r, D1): it takes no judged award. */
  readonly awarded?: readonly boolean[];
  /** Each rival's deficit where it takes a SEAT, never below its deficit alone (quick task 261010-d7r, finding F-D). */
  readonly seatDeficits?: readonly number[];
}

/**
 * THE REFERENCE THE MATCHING IS TESTED AGAINST: the exact dynamic program
 * that WAS the proof's seat and judged award cover of one seat group until
 * quick task 261010-l0s (`unpickedCover` in `champJointLock.ts`), moved here
 * unchanged but for its name. For the rivals of one seat group (their
 * deficits fixed for one T), the most of them the seats can cover together
 * with at most `j` judged awards, for every `j` from 0 to `budget`: a table
 * over (seats used per seat value, judged awards spent). It knows nothing of
 * fill ins, of a second seat group or of a listed pick's alliance, which is
 * why the proof no longer uses it; on ONE group with none of those the
 * matching must agree with it cell for cell.
 */
function referenceCover(
  deficits: readonly number[],
  seatValues: readonly number[],
  seatCounts: readonly number[],
  budget: number,
  judgedAwardPoints: number,
  options?: ReferenceCoverOptions
): number[] {
  const judgedCost = (deficit: number): number => {
    if (deficit <= 0) return 0;
    if (judgedAwardPoints <= 0) return Infinity;
    const cost = Math.ceil(deficit / judgedAwardPoints);
    return cost <= MAX_POINT_PAYING_AWARDS_PER_TEAM ? cost : Infinity;
  };
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

  for (let index = 0; index < deficits.length; index++) {
    const deficit = deficits[index]!;
    const next = dp.slice();
    const awarded = options?.awarded?.[index] === true;
    const costOf = (need: number): number => (awarded ? (need <= 0 ? 0 : Infinity) : judgedCost(need));
    const alone = costOf(deficit);
    const onSeat = options?.seatDeficits?.[index] ?? deficit;
    const withSeat = seatValues.map((value) => costOf(onSeat - value));
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

/** The same one seat group handed to the matching: one resource per seat value, then one judged award alone. */
function matchingOfOneGroup(deficits: readonly number[], seatValues: readonly number[], seatCounts: readonly number[], budget: number, options?: ReferenceCoverOptions): number[] {
  const costOf = (need: number, awarded: boolean): number => (need <= 0 ? 0 : awarded || need > JUDGED ? Infinity : 1);
  const rows = deficits.map((deficit, index) => {
    const awarded = options?.awarded?.[index] === true;
    const onSeat = options?.seatDeficits?.[index] ?? deficit;
    return [...seatValues.map((value) => costOf(onSeat - value, awarded)), costOf(deficit, awarded)];
  });
  return coverMatching(rows, [...seatCounts, deficits.length], budget);
}

// ---------------------------------------------------------------------------
// The proof of before the matching, kept whole as an oracle (quick task 261010-l0s)
// ---------------------------------------------------------------------------

/**
 * THE BOUND AS THE PROOF COUNTED IT UNTIL QUICK TASK 261010-l0s
 * (`jointLockBoundAt` in `champJointLock.ts` as that task found it), moved
 * here unchanged but for three things, none of which moves a value upward:
 * its name; the early stop and the cheap ceiling left out (both only skipped
 * work); and its cover always the exact program (`referenceCover`, where the
 * module fell back to an upper bound above 250,000 table cells, which only
 * raised it).
 *
 * WHAT IT IS FOR. It counted one rival more than once in three places: once
 * per seat group that could seat it, in the winner's fill in pool beside the
 * seat cover, and as a member of the alliance that lists it and again on a
 * seat. Each only RAISES the count, so this is a sound bound that is never
 * below the matching's. A rewrite of the proof that reads ABOVE this oracle
 * anywhere has LOOSENED it; one that reads BELOW the enumerated model
 * (`modelMostTakers`, further down) is UNSOUND. The tests of "every rival is
 * counted once" hold both.
 */
function boundBeforeTheMatching(input: JointLockInput, teamKey: string, floor: number): number {
  const oracleJudgedCost = (deficit: number): number => {
    if (deficit <= 0) return 0;
    if (input.judgedAwardPoints <= 0) return Infinity;
    const cost = Math.ceil(deficit / input.judgedAwardPoints);
    return cost <= MAX_POINT_PAYING_AWARDS_PER_TEAM ? cost : Infinity;
  };
  const orderedSelectionsOf = <T,>(items: readonly T[], k: number): T[][] => {
    if (k === 0) return [[]];
    const out: T[][] = [];
    items.forEach((item, index) => {
      const rest = [...items.slice(0, index), ...items.slice(index + 1)];
      for (const tail of orderedSelectionsOf(rest, k - 1)) out.push([item, ...tail]);
    });
    return out;
  };
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
  const spareOf = (allianceNumber: number): number => {
    const alliance = allianceByNumber.get(allianceNumber);
    if (alliance === undefined) return input.maxAllianceSize;
    return Math.max(0, alliance.spareSeats ?? input.maxAllianceSize - alliance.members.length);
  };

  const rivals = input.pool.filter((rival) => rival.teamKey !== teamKey);
  const rivalKeys = new Set(rivals.map((rival) => rival.teamKey));
  const slotOnly = [...new Set(input.slotOnlyRivals)].filter((key) => key !== teamKey && !rivalKeys.has(key));
  const slotOnlySet = new Set(slotOnly);
  const awardedSet = new Set(input.awardedRivals ?? []);
  const oneNamedWinner = frames.every((frame) => frame.winner !== null && frame.winner === frames[0]!.winner);
  const withoutSettled = (rival: JointLockRival): number => rival.floor + Math.max(0, rival.extra - rival.listedOnly!.settled);
  const alonePoints = rivals.map((rival) => (rival.listedOnly?.onWinner === true && oneNamedWinner ? withoutSettled(rival) : rival.floor + rival.extra));
  const seatPoints = rivals.map((rival) => (rival.listedOnly === undefined || (rival.listedOnly.onWinner && !oneNamedWinner) ? rival.floor + rival.extra : withoutSettled(rival)));

  const seatGroups = input.seatGroups !== undefined && input.seatGroups.length > 0 ? input.seatGroups : undefined;
  const groupCount = seatGroups === undefined ? 1 : seatGroups.length;
  const everyGroup: readonly number[] = Array.from({ length: groupCount }, (_, index) => index);
  const noGroup: readonly number[] = [];
  const groupByAlliance = new Map<number, number>();
  const namedGroups = new Map<string, number[]>();
  if (seatGroups !== undefined) {
    seatGroups.forEach((group, index) => {
      for (const allianceNumber of group.alliances) if (!groupByAlliance.has(allianceNumber)) groupByAlliance.set(allianceNumber, index);
      for (const key of group.eligible) {
        const named = namedGroups.get(key);
        if (named === undefined) namedGroups.set(key, [index]);
        else if (!named.includes(index)) named.push(index);
      }
    });
  }
  const groupOfAlliance = (allianceNumber: number): number | undefined => (seatGroups === undefined ? 0 : groupByAlliance.get(allianceNumber));
  const groupsOf = (key: string): readonly number[] => namedGroups.get(key) ?? (allianceOfTeam.has(key) ? noGroup : everyGroup);

  const usable = frames.filter((frame) => frame.winner === null || !membersOf(frame.winner).includes(teamKey) || namedGroups.has(teamKey));
  if (usable.length === 0) return 0;

  // ONE RIVAL, ONCE PER GROUP THAT CAN SEAT IT: the first of the three double counts.
  const seatRivals: { teamKey: string; deficit: number; seatDeficit: number; awarded: boolean }[][] = Array.from({ length: groupCount }, () => []);
  const slotOnlyByGroup: string[][] = Array.from({ length: groupCount }, () => []);
  rivals.forEach((rival, index) => {
    const deficit = m - alonePoints[index]!;
    if (deficit <= 0) return;
    const seatDeficit = m - seatPoints[index]!;
    const awarded = awardedSet.has(rival.teamKey);
    for (const group of groupsOf(rival.teamKey)) seatRivals[group]!.push({ teamKey: rival.teamKey, deficit, seatDeficit, awarded });
  });
  for (const key of slotOnly) for (const group of groupsOf(key)) slotOnlyByGroup[group]!.push(key);

  let maxSeatValue = Math.max(0, ...input.placementPoints);
  for (const frame of usable) for (const value of frame.fixed.values()) maxSeatValue = Math.max(maxSeatValue, value);
  const reachable = (deficit: number, seatDeficit: number): boolean => oracleJudgedCost(deficit) !== Infinity || oracleJudgedCost(seatDeficit - maxSeatValue) !== Infinity;
  const seatReachableEntries = seatRivals.map((list) => list.filter((entry) => (entry.awarded ? entry.seatDeficit <= maxSeatValue : reachable(entry.deficit, entry.seatDeficit))));
  const seatReachable = seatReachableEntries.map((list) => list.map((entry) => entry.deficit));
  const seatCoverOptions = seatReachableEntries.map((list): ReferenceCoverOptions | undefined => {
    const anyAwarded = list.some((entry) => entry.awarded);
    const anyListedOnly = list.some((entry) => entry.seatDeficit !== entry.deficit);
    if (!anyAwarded && !anyListedOnly) return undefined;
    return {
      ...(anyAwarded ? { awarded: list.map((entry) => entry.awarded) } : {}),
      ...(anyListedOnly ? { seatDeficits: list.map((entry) => entry.seatDeficit) } : {}),
    };
  });

  const placementValues = [...input.placementPoints].sort((a, b) => b - a);
  const budget = Math.max(0, input.judgedAwards);
  const coverCache = new Map<string, number[]>();
  const combinedCache = new Map<string, number[]>();
  const bestSplit = (a: readonly number[], b: readonly number[]): number[] => {
    const out = new Array<number>(budget + 1).fill(0);
    for (let j = 0; j <= budget; j++) {
      let top = 0;
      for (let i = 0; i <= j; i++) {
        const value = a[i]! + b[j - i]!;
        if (value > top) top = value;
      }
      out[j] = top;
    }
    return out;
  };

  let best = -Infinity;
  for (const frame of usable) {
    const { winner } = frame;
    const others = frame.enumerated.filter((allianceNumber) => allianceNumber !== winner && !frame.fixed.has(allianceNumber));
    const k = Math.min(placementValues.length, others.length);
    const winnerMembers = winner === null ? [] : membersOf(winner);
    const winnerSet = new Set(winnerMembers);
    let stepOne = 0;
    for (const member of winnerMembers) if (member !== teamKey && (rivalKeys.has(member) || slotOnlySet.has(member))) stepOne += 1;
    const fillIns = winner === null ? 0 : Math.max(0, frame.fillIns);
    // THE FILL IN POOL BESIDE THE SEAT COVER: the second double count.
    const winnerGroup = winner === null ? undefined : groupOfAlliance(winner);
    let fillInPool = 0;
    if (winnerGroup !== undefined) {
      for (const entry of seatRivals[winnerGroup]!) if (!winnerSet.has(entry.teamKey)) fillInPool += 1;
      for (const key of slotOnlyByGroup[winnerGroup]!) if (!winnerSet.has(key)) fillInPool += 1;
    }
    const others3 = input.consumingAwards + Math.min(fillIns, fillInPool);

    for (const selection of orderedSelectionsOf(others, k)) {
      const assigned = new Map<number, number>(frame.fixed);
      selection.forEach((allianceNumber, index) => assigned.set(allianceNumber, placementValues[index]!));

      let covered = stepOne;
      let uncovered = 0;
      const pickedCosts: number[] = [];
      for (let index = 0; index < rivals.length; index++) {
        const rival = rivals[index]!;
        if (winnerSet.has(rival.teamKey)) continue;
        const allianceNumber = allianceOfTeam.get(rival.teamKey);
        const points = alonePoints[index]! + (allianceNumber === undefined ? 0 : (assigned.get(allianceNumber) ?? 0));
        if (points >= m) {
          covered += 1;
          continue;
        }
        uncovered += 1;
        if (allianceNumber === undefined) continue;
        if (awardedSet.has(rival.teamKey)) continue;
        // A LISTED PICK COUNTED AS A MEMBER HERE AND AGAIN IN ITS GROUP'S SEAT COVER: the third double count.
        const cost = oracleJudgedCost(m - points);
        if (cost !== Infinity) pickedCosts.push(cost);
      }
      for (const key of slotOnly) if (!winnerSet.has(key)) uncovered += 1;

      const seatByGroup: Map<number, number>[] = Array.from({ length: groupCount }, () => new Map<number, number>());
      for (const [allianceNumber, value] of assigned) {
        const group = groupOfAlliance(allianceNumber);
        const count = spareOf(allianceNumber);
        if (group === undefined || value <= 0 || count <= 0) continue;
        const seats = seatByGroup[group]!;
        seats.set(value, (seats.get(value) ?? 0) + count);
      }

      const groupKeys: string[] = [];
      const groupSeatValues: number[][] = [];
      const groupSeatCounts: number[][] = [];
      for (let group = 0; group < groupCount; group++) {
        const seats = seatByGroup[group]!;
        const seatValues = [...seats.keys()].sort((a, b) => b - a);
        const seatCounts = seatValues.map((value) => seats.get(value)!);
        groupSeatValues.push(seatValues);
        groupSeatCounts.push(seatCounts);
        groupKeys.push(`${String(group)}:${seatValues.map((value, index) => `${String(value)}x${String(seatCounts[index])}`).join(",")}`);
      }
      const combinedKey = groupKeys.join("|");
      let seatBest = combinedCache.get(combinedKey);
      if (seatBest === undefined) {
        let combined: number[] | undefined;
        for (let group = 0; group < groupCount; group++) {
          let cover = coverCache.get(groupKeys[group]!);
          if (cover === undefined) {
            cover = referenceCover(seatReachable[group]!, groupSeatValues[group]!, groupSeatCounts[group]!, budget, input.judgedAwardPoints, seatCoverOptions[group]);
            coverCache.set(groupKeys[group]!, cover);
          }
          combined = combined === undefined ? cover : bestSplit(combined, cover);
        }
        seatBest = combined ?? new Array<number>(budget + 1).fill(0);
        combinedCache.set(combinedKey, seatBest);
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
      for (let j = 0; j <= budget; j++) lifted = Math.max(lifted, seatBest[j]! + pickedBest(budget - j));

      const total = covered + Math.min(uncovered, lifted + others3);
      if (total > best) best = total;
    }
  }
  return best;
}

/** The oracle for one pool team of a single or divisioned input, or summed over two championships as the module sums. */
function boundBeforeTheMatchingOver(inputs: readonly JointLockInput[], teamKey: string): number {
  const holder = inputs.find((input) => input.pool.some((rival) => rival.teamKey === teamKey));
  if (holder === undefined) return Infinity;
  const floor = holder.pool.find((rival) => rival.teamKey === teamKey)!.floor;
  let sum = 0;
  for (const input of inputs) {
    if (input.candidateWinners.length === 0) return Infinity;
    sum += boundBeforeTheMatching(input, teamKey, floor);
  }
  return sum;
}

describe("champJointLock: frames, the observer and the guards (261009-kt3, 261009-tx9)", () => {
  it("jointLockBound equals jointLockBoundAt at the team's own floor, and the single frames are the shipped scenarios with four fields and no more", () => {
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
      // Quick task 261009-tx9 (reading P7): a frame holds a winner, the enumerated alliances, the fixed values and the winner's fill ins.
      expect(Object.keys(frame).sort()).toEqual(["enumerated", "fillIns", "fixed", "winner"]);
      expect(frame.fillIns).toBe(1);
      expect(frame.fixed.size).toBe(0);
    }
    for (const rival of pool) {
      expect(jointLockBoundAt(input, rival.teamKey, rival.floor)).toBe(jointLockBound(input, rival.teamKey));
      expect(jointLockBound({ ...input, frames }, rival.teamKey)).toBe(jointLockBound(input, rival.teamKey));
    }
  });

  it("seat groups absent equal ONE explicit group of every alliance and every rival on no alliance (261009-tx9, reading P1)", () => {
    const { pool, alliances, unpicked } = exhaustiveField();
    const input: JointLockInput = {
      pool,
      slotOnlyRivals: ["q1"],
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
    const oneGroup: JointLockInput = { ...input, seatGroups: [{ alliances: alliances.map((alliance) => alliance.allianceNumber), eligible: [...unpicked, "q1"] }] };
    let above = 0;
    for (const rival of pool) {
      const bound = jointLockBound(input, rival.teamKey);
      expect(jointLockBound(oneGroup, rival.teamKey), rival.teamKey).toBe(bound);
      if (bound > 0) above += 1;
    }
    expect(above).toBeGreaterThan(0);
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

  it("the matching's one binding condition: assertOneAwardPerRival accepts 1 and throws on 2, naming the constant", () => {
    expect(() => assertOneAwardPerRival(1)).not.toThrow();
    expect(() => assertOneAwardPerRival(2)).toThrow(/MAX_POINT_PAYING_AWARDS_PER_TEAM/);
  });

  it("the matching equals the exact dynamic program of before quick task 261010-l0s on 20,000 seeded random instances of one seat group, for every judged budget", () => {
    const random = mulberry32(26100903);
    const integer = (lo: number, hi: number): number => lo + Math.floor(random() * (hi - lo + 1));
    const valuePalette = [120, 90, 75, 60, 45, 39, 30, 21];
    let cells = 0;
    for (let instance = 0; instance < 20_000; instance++) {
      const deficits = Array.from({ length: integer(1, 9) }, () => integer(1, 140));
      const types = [...valuePalette].sort(() => random() - 0.5).slice(0, integer(0, 3)).sort((a, b) => b - a);
      const counts = types.map(() => integer(1, 3));
      const budget = integer(0, 5);
      const exact = referenceCover(deficits, types, counts, budget, JUDGED);
      expect(matchingOfOneGroup(deficits, types, counts, budget), `instance ${instance}: ${JSON.stringify({ deficits, types, counts, budget })}`).toEqual(exact);
      cells += budget + 1;
    }
    // Pinned as the run shows: every one of these cells is compared.
    expect(cells).toBe(70_086);
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
      frames: [{ winner: 1, enumerated: [], fixed: new Map([[2, 120]]), fillIns: 0 }],
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

  it("the backup robot rule (261009-tx9, D2): a seat is taken only inside its alliance's own seat group", () => {
    const input = (eligible: readonly [readonly string[], readonly string[]]): JointLockInput =>
      minimalInput({
        pool: [
          { teamKey: "T", floor: 200, extra: 0 },
          { teamKey: "u", floor: 100, extra: 0 },
        ],
        alliances: [
          { allianceNumber: 11, members: ["a", "b", "c"], spareSeats: 0 },
          { allianceNumber: 21, members: ["x", "y", "z"], spareSeats: 1 },
        ],
        aliveAlliances: [11, 21],
        candidateWinners: [11],
        // Alliance 21 is fixed at 120 with one spare seat; u is 100 short.
        frames: [{ winner: 11, enumerated: [], fixed: new Map([[21, 120]]), fillIns: 0 }],
        seatGroups: [
          { alliances: [11], eligible: [...eligible[0]] },
          { alliances: [21], eligible: [...eligible[1]] },
        ],
      });
    // u has a row in alliance 21's division: it takes the seat.
    expect(jointLockBound(input([[], ["u"]]), "T")).toBe(1);
    // u has a row in the other division only: the seat on 21 is not its to take.
    expect(jointLockBound(input([["u"], []]), "T")).toBe(0);
  });

  it("reading P4 (261009-tx9): a rival on no alliance that NO group names is offered every division's seats, the champion's fill in and the awards; a confirmed pick no group names is offered none", () => {
    const wild = (o: { floor: number; rival?: string; seatOn?: number; fillIns?: number; judged?: number; consuming?: number }): JointLockInput =>
      minimalInput({
        pool: [
          { teamKey: "T", floor: 200, extra: 0 },
          { teamKey: o.rival ?? "r", floor: o.floor, extra: 0 },
        ],
        alliances: [
          { allianceNumber: 11, members: ["a", "b", "c"], spareSeats: 0 },
          { allianceNumber: 21, members: ["x", "y", "z"], spareSeats: 1 },
          { allianceNumber: 31, members: ["p", "q", "s"], spareSeats: 1 },
        ],
        aliveAlliances: [11, 21],
        candidateWinners: [11],
        judgedAwards: o.judged ?? 0,
        consumingAwards: o.consuming ?? 0,
        frames: [{ winner: 11, enumerated: [], fixed: new Map(o.seatOn === undefined ? [] : [[o.seatOn, 120]]), fillIns: o.fillIns ?? 0 }],
        seatGroups: [
          { alliances: [11], eligible: [] },
          { alliances: [21], eligible: [] },
          { alliances: [31], eligible: [] },
        ],
      });
    // 100 short: a 120 seat in division 2, or in division 3 instead, covers it; no seat anywhere does not.
    expect(jointLockBound(wild({ floor: 100, seatOn: 21 }), "T")).toBe(1);
    expect(jointLockBound(wild({ floor: 100, seatOn: 31 }), "T")).toBe(1);
    expect(jointLockBound(wild({ floor: 100 }), "T")).toBe(0);
    // Far below T: the winner's one fill in takes a slot whatever its points.
    expect(jointLockBound(wild({ floor: 0, fillIns: 1 }), "T")).toBe(1);
    // No seat and no fill in: one judged award alone at 10 short, one consuming award far below, and neither.
    expect(jointLockBound(wild({ floor: 190, judged: 1 }), "T")).toBe(1);
    expect(jointLockBound(wild({ floor: 0, consuming: 1 }), "T")).toBe(1);
    expect(jointLockBound(wild({ floor: 0 }), "T")).toBe(0);
    // x is a confirmed pick of alliance 21 that no group names: 100 short with a 120 seat on 31, it is eligible nowhere.
    expect(jointLockBound(wild({ floor: 100, rival: "x", seatOn: 31 }), "T")).toBe(0);
  });

  it("reading P3 (261009-tx9): a listed pick that is not confirmed may take another alliance's seat in its own division", () => {
    const input = (eligible: readonly string[]): JointLockInput =>
      minimalInput({
        pool: [
          { teamKey: "T", floor: 200, extra: 0 },
          { teamKey: "x", floor: 125, extra: 0 },
          { teamKey: "d", floor: 125, extra: 0 },
        ],
        alliances: [
          { allianceNumber: 11, members: ["a1", "a2", "a3"], spareSeats: 0 },
          { allianceNumber: 12, members: ["x", "y", "z"], spareSeats: 1 },
          // d is the listed fourth of alliance 13, which holds one spare seat.
          { allianceNumber: 13, members: ["p", "q", "s", "d"], spareSeats: 1 },
        ],
        aliveAlliances: [11, 12, 13],
        candidateWinners: [11],
        placementPoints: [75],
        frames: [{ winner: 11, enumerated: [12, 13], fixed: new Map(), fillIns: 0 }],
        seatGroups: [{ alliances: [11, 12, 13], eligible: [...eligible] }],
      });
    // Named by the group: 12 is second, x is paid 75 as its member, and d, never on 13, takes 12's seat at 75.
    expect(jointLockBound(input(["d"]), "T")).toBe(2);
    // Named by no group: d is a member of 13 and nothing else, so one of x and d reaches T, never both.
    expect(jointLockBound(input([]), "T")).toBe(1);
  });

  it("reading P3 (261009-tx9): a listed pick that is not confirmed on an alive alliance may still be the champion's one backup (the case guard G3 covered)", () => {
    const input = (eligible: readonly string[]): JointLockInput =>
      minimalInput({
        pool: [
          { teamKey: "T", floor: 200, extra: 0 },
          { teamKey: "d", floor: 10, extra: 0 },
        ],
        alliances: [
          { allianceNumber: 11, members: ["a1", "a2", "a3"], spareSeats: 1 },
          { allianceNumber: 12, members: ["p", "q", "s", "d"], spareSeats: 1 },
        ],
        aliveAlliances: [11, 12],
        candidateWinners: [11],
        placementPoints: [],
        frames: [{ winner: 11, enumerated: [12], fixed: new Map(), fillIns: 1 }],
        seatGroups: [{ alliances: [11, 12], eligible: [...eligible] }],
      });
    expect(jointLockBound(input(["d"]), "T")).toBe(1);
    expect(jointLockBound(input([]), "T")).toBe(0);
  });

  it("the backup robot rule (261009-tx9, D2; replaces the 261009-kt3 guard G3 test): a fill in never counts a CONFIRMED pick, since a team already on an alliance is never a backup", () => {
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
    // The single frames: one fill in on alliance 1, and p is a confirmed member of alliance 2.
    expect(singleChampionshipFrames(input)[0]!.fillIns).toBe(1);
    expect(jointLockBound(input, "T")).toBe(0);
    // With seat groups whose eligible lists do not hold p, the same.
    const grouped: JointLockInput = { ...input, frames: singleChampionshipFrames(input), seatGroups: [{ alliances: [1, 2], eligible: ["other"] }] };
    expect(jointLockBound(grouped, "T")).toBe(0);
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

/** A four division structure for the frame tests: every division decided with alliance 1 its winner, one spare seat per alliance. */
function frameStructure(overrides: Partial<DivisionedJointStructure> = {}): DivisionedJointStructure {
  const divisions = [1, 2, 3, 4].map((d) => ({
    alliances: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => divisionAllianceId(d, n)),
    alive: [] as number[],
    decidedWinner: divisionAllianceId(d, 1) as number | undefined,
  }));
  const membersByAlliance = new Map<number, string[]>();
  const spareByAlliance = new Map<number, number>();
  for (const division of divisions) {
    for (const id of division.alliances) {
      membersByAlliance.set(id, [`t${id}a`, `t${id}b`, `t${id}c`]);
      spareByAlliance.set(id, 1);
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
    spareByAlliance,
    maxAllianceSize: 4,
    ...overrides,
  };
}

/** One seat group per division of a frame structure, with the given teams named by each. */
function structureSeatGroups(structure: DivisionedJointStructure, eligible: (divisionIndex: number) => readonly string[]): JointLockSeatGroup[] {
  return structure.divisions.map((division, divisionIndex) => ({ alliances: [...division.alliances], eligible: [...eligible(divisionIndex)] }));
}

describe("divisionedJointFrames (261009-kt3 D4, 261009-tx9 D1 to D3: the backup robot rule)", () => {
  it("a round stop: two divisions decided, two undecided, one frame per candidate with the other division values fixed, and NO second seat set (261009-tx9, D1)", () => {
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
    expect(frame.fillIns).toBe(1);
    // An alliance has ONE backup for the whole championship: the frame holds its four fields and no extra seat,
    // no seat bonus and no seat open to any rival (the 261009-kt3 reading R5, D9 and step 6 terms are gone).
    for (const entry of result.frames) expect(Object.keys(entry).sort()).toEqual(["enumerated", "fillIns", "fixed", "winner"]);
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
    expect(Object.keys(frame).sort()).toEqual(["enumerated", "fillIns", "fixed", "winner"]);
  });

  it("R8 G1: W's fill ins come from spareByAlliance, the alliance's one seat pool, never from its listed members", () => {
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

  it("the backup robot rule (261009-tx9, D3; replaces the 261009-kt3 D9 test): a seat on an alive alliance in W's own division pays its division value and nothing more, since that alliance does not reach the finals", () => {
    const base = frameStructure();
    const spareByAlliance = new Map(base.spareByAlliance);
    for (const id of [11, 21, 31, 41]) spareByAlliance.set(id, 0);
    // Division 1 is undecided with 11 and 12 alive; alliance 12 holds the one seat.
    const divisions = base.divisions.map((division, index) => (index === 0 ? { ...division, decidedWinner: undefined, alive: [11, 12] } : division));
    const structure = { ...base, divisions, spareByAlliance };
    const result = divisionedJointFrames(structure);
    if ("refused" in result) throw new Error("refused");
    expect(result.candidateWinners).toEqual([11, 12, 21, 31, 41]);
    const frame = result.frames.find((entry) => entry.winner === 11)!;
    expect(frame.enumerated).toEqual([12]);
    const input = (floor: number): JointLockInput => ({
      pool: [
        { teamKey: "T", floor: 200, extra: 0 },
        { teamKey: "u", floor, extra: 0 },
      ],
      slotOnlyRivals: [],
      pointsSlots: 1,
      alliances: [...base.membersByAlliance].map(([allianceNumber, members]) => ({ allianceNumber, members, spareSeats: spareByAlliance.get(allianceNumber)! })),
      aliveAlliances: result.aliveAlliances,
      candidateWinners: [11],
      placementPoints: [21],
      consumingAwards: 0,
      judgedAwards: 0,
      judgedAwardPoints: JUDGED,
      maxAllianceSize: 4,
      frames: [frame],
      // u has a row in W's division.
      seatGroups: structureSeatGroups(structure, (divisionIndex) => (divisionIndex === 0 ? ["u"] : [])),
    });
    // 51 short: the seat on alliance 12 pays 21. The 261009-kt3 seat bonus of F_nw 30 on top is gone.
    expect(jointLockBound(input(149), "T")).toBe(0);
    // 21 short: the seat at 21 covers it.
    expect(jointLockBound(input(179), "T")).toBe(1);
  });

  it("the backup robot rule (261009-tx9, D2; replaces the 261009-kt3 header step 6 test): a confirmed pick of an eliminated alliance takes no seat, and a seat is taken only by a team of the alliance's own division", () => {
    const base = frameStructure();
    const result = divisionedJointFrames(base);
    if ("refused" in result) throw new Error("refused");
    const frame = result.frames[0]!;
    expect(frame.winner).toBe(11);
    const input = (rival: string, eligible: (divisionIndex: number) => readonly string[], spareOn31 = 1): JointLockInput => ({
      pool: [
        { teamKey: "T", floor: 200, extra: 0 },
        // 30 short of T.
        { teamKey: rival, floor: 170, extra: 0 },
      ],
      slotOnlyRivals: [],
      pointsSlots: 1,
      alliances: [...base.membersByAlliance].map(([allianceNumber, members]) => ({ allianceNumber, members, spareSeats: allianceNumber === 31 ? spareOn31 : 1 })),
      aliveAlliances: [],
      candidateWinners: [11],
      placementPoints: [75, 39, 21],
      consumingAwards: 0,
      judgedAwards: 0,
      judgedAwardPoints: JUDGED,
      maxAllianceSize: 4,
      frames: [{ ...frame, fillIns: 0 }],
      seatGroups: structureSeatGroups(base, eligible),
    });
    // t25a is a confirmed pick of alliance 25, a decided and eliminated alliance of division 2: never a backup.
    expect(jointLockBound(input("t25a", () => []), "T")).toBe(0);
    // w has a row in division 2 and is on no alliance: it takes the seat on decided winner 21 at F_nw 30.
    expect(jointLockBound(input("w", (divisionIndex) => (divisionIndex === 1 ? ["w"] : [])), "T")).toBe(1);
    // w has a row in division 3 and alliance 31 has no spare seat: the seats on 21 and 41 are not its to take.
    expect(jointLockBound(input("w", (divisionIndex) => (divisionIndex === 2 ? ["w"] : []), 0), "T")).toBe(0);
  });

  it("the backup robot rule (261009-tx9, D1; replaces the 261009-kt3 reading R5 (a) future): two backups on one alliance is not a rule legal future, so the bound is 1", () => {
    // Two divisions, 11 and 12 alive in division 1, 21 and 22 in division 2, finals paying 60 and 30, no award.
    // u (110) and v (0) both have a row in division 1 and alliance 11 has ONE spare seat. The 261009-kt3 future
    // put u on 11's division roster (paid 90) and v on its finals roster. One backup for the whole championship
    // leaves one of them: as 11's backup it qualifies with the champion, and the other gains nothing.
    const divisions = [1, 2].map((d) => ({
      alliances: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => divisionAllianceId(d, n)),
      alive: [1, 2].map((n) => divisionAllianceId(d, n)),
      decidedWinner: undefined,
    }));
    const membersByAlliance = new Map<number, string[]>();
    for (const division of divisions) for (const id of division.alliances) membersByAlliance.set(id, [`t${id}a`, `t${id}b`, `t${id}c`]);
    const spare = (id: number): number => (id === 11 ? 1 : 0);
    const structure: DivisionedJointStructure = {
      divisions,
      finalsPlacementByAlliance: new Map(),
      finalsElimFinal: false,
      winnerPosted: false,
      divisionChampionMax: 90,
      finalsMaxByPlacement: [60, 30],
      membersByAlliance,
      spareByAlliance: new Map([...membersByAlliance.keys()].map((id) => [id, spare(id)] as const)),
      maxAllianceSize: 4,
    };
    const result = divisionedJointFrames(structure);
    if ("refused" in result) throw new Error(result.refused);
    const input: JointLockInput = {
      pool: [
        { teamKey: "T", floor: 200, extra: 0 },
        { teamKey: "u", floor: 110, extra: 0 },
        { teamKey: "v", floor: 0, extra: 0 },
      ],
      slotOnlyRivals: [],
      pointsSlots: 1,
      alliances: [...membersByAlliance].map(([allianceNumber, members]) => ({ allianceNumber, members, spareSeats: spare(allianceNumber) })),
      aliveAlliances: result.aliveAlliances,
      candidateWinners: result.candidateWinners,
      placementPoints: [75, 39, 21],
      consumingAwards: 0,
      judgedAwards: 0,
      judgedAwardPoints: JUDGED,
      maxAllianceSize: 4,
      frames: result.frames,
      seatGroups: structureSeatGroups(structure, (divisionIndex) => (divisionIndex === 0 ? ["u", "v"] : [])),
    };
    expect(jointLockBound(input, "T")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Divisioned soundness over RULE LEGAL futures: E3 (exhaustive, two divisions)
// and S2 (sampled, four). Quick task 261009-tx9, CONTEXT D4.
// ---------------------------------------------------------------------------
//
// THE BACKUP ROBOT RULE every future below obeys. An alliance has at most ONE
// backup for the whole championship, division playoffs and finals together. A
// backup is a team with a row in the alliance's OWN division that no alliance
// there confirmed. A team an alliance confirmed is never a backup. A backup is
// paid the points of the matches its alliance wins after it joins, never more
// than the alliance's own value, and the champion's backup qualifies with it.
//
// A LISTED FOURTH is a team an alliance lists at 0 alliance selection points,
// which is a hindsight fact at a rewound stop. It has two futures and both are
// built: it stays as that alliance's one backup, or it was never on it and is
// free for any alliance of its division.

/** One divisioned future, as far as the slot takers against T are concerned. */
interface DivisionedFuture {
  /** The champion's finals roster: its confirmed members and its one backup. */
  readonly championRoster: ReadonlySet<string>;
  /** Playoff points still to be paid, division and finals together. */
  readonly paid: ReadonlyMap<string, number>;
  readonly consuming: ReadonlySet<string>;
  readonly judged: ReadonlySet<string>;
}

/** One backup of a future: the team, the alliance it joined, and whether it joined only for the finals. */
interface BackupRecord {
  readonly team: string;
  readonly alliance: number;
  readonly finalsOnly: boolean;
}

/** A future with the record the legality check reads (`ruleViolations`). */
interface RecordedFuture extends DivisionedFuture {
  /** The champion alliance. */
  readonly champion: number;
  /** Every division winner, the champion included. */
  readonly divisionWinners: readonly number[];
  /** Every backup of the future. A listed fourth that stays is recorded as its alliance's backup. */
  readonly backups: readonly BackupRecord[];
  /** Alliance -> the most its members are still paid in this future, division and finals together. */
  readonly allianceValue: ReadonlyMap<number, number>;
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

interface DivisionedFieldSpec {
  readonly divisionCount: number;
  /** Per division, the teams with a row there that no alliance confirmed, a listed fourth included. */
  readonly eligible: readonly (readonly string[])[];
  /** Teams with no division row. */
  readonly noRow: readonly string[];
  /** Alliance id -> the fourth it lists and has not confirmed. */
  readonly listedFourths?: ReadonlyMap<number, string>;
}

/**
 * A divisioned field: `divisionCount` divisions of eight alliances of three
 * CONFIRMED picks, the teams with a division row that no alliance confirmed,
 * the teams with no row, and the listed fourths. Floors from `floorOf`.
 */
function divisionedField(spec: DivisionedFieldSpec, floorOf: (index: number) => number) {
  const confirmed = new Map<number, readonly string[]>();
  const floors = new Map<string, number>();
  const divisionOfTeam = new Map<string, number>();
  let index = 0;
  for (let d = 1; d <= spec.divisionCount; d++) {
    for (let n = 1; n <= 8; n++) {
      const members = [1, 2, 3].map((k) => `d${d}a${n}m${k}`);
      for (const member of members) {
        floors.set(member, floorOf(index++));
        divisionOfTeam.set(member, d);
      }
      confirmed.set(divisionAllianceId(d, n), members);
    }
  }
  spec.eligible.forEach((keys, divisionIndex) => {
    for (const key of keys) {
      floors.set(key, floorOf(index++));
      divisionOfTeam.set(key, divisionIndex + 1);
    }
  });
  for (const key of spec.noRow) floors.set(key, floorOf(index++));
  const listedFourths = spec.listedFourths ?? new Map<number, string>();
  for (const [id, key] of listedFourths) {
    if (!confirmed.has(id) || !(spec.eligible[Math.floor(id / 10) - 1] ?? []).includes(key)) throw new Error(`listed fourth ${key} has no row in the division of alliance ${String(id)}`);
  }
  return { divisionCount: spec.divisionCount, confirmed, floors, eligible: spec.eligible, noRow: spec.noRow, listedFourths, divisionOfTeam };
}
type DivisionedField = ReturnType<typeof divisionedField>;

/**
 * The proof input's alliances. An alliance its division has not placed holds
 * its listed fourth among its members (reading R8); a placed one holds its
 * three confirmed picks (guard G2). One spare seat each (CONTEXT D10).
 */
function fieldAlliances(field: DivisionedField, placed: (id: number) => boolean): JointLockAlliance[] {
  return [...field.confirmed].map(([id, members]) => {
    const fourth = field.listedFourths.get(id);
    return { allianceNumber: id, members: fourth !== undefined && !placed(id) ? [...members, fourth] : [...members], spareSeats: 1 };
  });
}

/** One seat group per division: its eight alliances and the teams with a row there that no alliance confirmed. */
function fieldSeatGroups(field: DivisionedField): JointLockSeatGroup[] {
  return field.eligible.map((eligible, divisionIndex) => ({
    alliances: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => divisionAllianceId(divisionIndex + 1, n)),
    eligible: [...eligible],
  }));
}

/** Division alliance numbers placed by Round 4 (`ROUND_FOUR_DECISIONS`): 6 fourth, 4 fifth, 5 sixth, 8 seventh, 7 eighth. */
const ROUND_FOUR_PLACED = new Map([
  [6, 4],
  [4, 5],
  [5, 6],
  [8, 7],
  [7, 8],
]);

/** A decided division's settled values by alliance number: 1 first, 2 second (lost the final 0 to 2), 3 third, 6 fourth. */
const DECIDED_DIVISION_VALUE = new Map([
  [1, 90],
  [2, 60],
  [3, 39],
  [6, 21],
]);

interface E3Variant {
  readonly label: string;
  readonly finalsMax: readonly [number, number];
  readonly consuming: number;
  readonly judged: number;
  /** Division 1 is decided: 11 first and alive in the finals with its spare seat, 12 second, 13 third, 16 fourth, their settled values in the floors. */
  readonly divisionOneDecided: boolean;
  /** A decisive instance: a pool of exactly these teams at these floors, and the team whose worst legal future equals its bound. */
  readonly decisive?: { readonly floors: ReadonlyMap<string, number>; readonly team: string };
  /** Seeded random floors from 0 up to `spread`, in place of the file's floor function. */
  readonly randomFloors?: { readonly seed: number; readonly spread: number };
}

const E3_VARIANTS: readonly E3Variant[] = [
  { label: "2026 values (30, 0), C=1, K=1", finalsMax: [30, 0], consuming: 1, judged: 1, divisionOneDecided: false },
  { label: "a stress variant paying the finalist 30 (60, 30), C=1, K=1", finalsMax: [60, 30], consuming: 1, judged: 1, divisionOneDecided: false },
  { label: "the stress variant with no award (60, 30), C=0, K=0", finalsMax: [60, 30], consuming: 0, judged: 0, divisionOneDecided: false },
  { label: "division 1 decided, its winner alive in the finals with a spare seat (60, 30), C=1, K=1", finalsMax: [60, 30], consuming: 1, judged: 1, divisionOneDecided: true },
  {
    // Worst legal future: 21 wins everything with L2 as its one backup, while 11 wins division 1 with u1 as its backup and is the finalist (100 + 90 + 30).
    label: "the DECISIVE open instance (60, 30), C=0, K=0",
    finalsMax: [60, 30],
    consuming: 0,
    judged: 0,
    divisionOneDecided: false,
    decisive: {
      team: "d2a4m1",
      floors: new Map([
        ["d2a4m1", 200],
        ["d2a1m1", 10],
        ["d2a1m2", 12],
        ["d2a1m3", 14],
        ["L2", 5],
        ["u1", 100],
      ]),
    },
  },
  {
    // Worst legal future: 21 wins everything with L2 as its one backup, while decided winner 11 is the finalist with u1 as its finals backup (150 + 30).
    label: "the DECISIVE decided instance (60, 30), C=0, K=0",
    finalsMax: [60, 30],
    consuming: 0,
    judged: 0,
    divisionOneDecided: true,
    decisive: {
      team: "d1a2m1",
      floors: new Map([
        ["d1a2m1", 170],
        ["d2a1m1", 10],
        ["d2a1m2", 12],
        ["d2a1m3", 14],
        ["L2", 5],
        ["u1", 150],
      ]),
    },
  },
];

/**
 * THE E3 FIELD at "after Round 4 in every open division, finals not started".
 * Two divisions. Alliance 12 lists the fourth L1 and alliance 22 lists L2.
 * With a row in division 1 and confirmed by no alliance: u1, q2 (a slot only
 * rival) and L1; in division 2: L2. With no row: r (a pool team) and q1 (a
 * slot only rival). The pool is every member of the alive alliances, one
 * member of each placed alliance, u1, r, L1 and L2; with division 1 decided,
 * the three confirmed members of 11, 12 and 13 and one member of each other
 * alliance there. A decisive instance keeps its own six teams.
 */
function e3Setup(variant: E3Variant) {
  const randomFloor = variant.randomFloors === undefined ? undefined : mulberry32(variant.randomFloors.seed);
  const floorSpread = variant.randomFloors?.spread ?? 0;
  const field = divisionedField(
    {
      divisionCount: 2,
      eligible: [["u1", "q2", "L1"], ["L2"]],
      noRow: ["r", "q1"],
      listedFourths: new Map([
        [12, "L1"],
        [22, "L2"],
      ]),
    },
    (index) => (randomFloor === undefined ? 140 + ((index * 37) % 97) : Math.floor(randomFloor() * floorSpread))
  );
  const decided = (d: number): boolean => d === 1 && variant.divisionOneDecided;
  const aliveIn = (d: number): number[] => (decided(d) ? [] : [1, 2, 3].map((n) => divisionAllianceId(d, n)));
  const alive = [1, 2].flatMap(aliveIn);
  const allianceOfConfirmed = new Map<string, number>();
  for (const [id, members] of field.confirmed) for (const member of members) allianceOfConfirmed.set(member, id);

  const rivalOf = (teamKey: string): JointLockRival => {
    const floor = variant.decisive?.floors.get(teamKey) ?? field.floors.get(teamKey)!;
    const id = allianceOfConfirmed.get(teamKey);
    if (id === undefined) return { teamKey, floor, extra: 0 };
    // A decided division's values are settled into the floors; a decisive instance states its floors with them included.
    if (decided(Math.floor(id / 10))) return { teamKey, floor: floor + (variant.decisive === undefined ? (DECIDED_DIVISION_VALUE.get(id % 10) ?? 0) : 0), extra: 0 };
    const placement = ROUND_FOUR_PLACED.get(id % 10);
    return { teamKey, floor, extra: placement === undefined ? 0 : maxPlayoffPointsByPlacement(2026, "dcmp", placement) };
  };
  let poolKeys: string[];
  if (variant.decisive !== undefined) poolKeys = [...variant.decisive.floors.keys()];
  else {
    poolKeys = [];
    for (const [id, members] of field.confirmed) {
      const whole = alive.includes(id) || (decided(Math.floor(id / 10)) && id % 10 <= 3);
      poolKeys.push(...(whole ? members : members.slice(0, 1)));
    }
    poolKeys.push("u1", "r", "L1", "L2");
  }
  const slotOnly = variant.decisive !== undefined ? [] : ["q1", "q2"];

  const alliances = fieldAlliances(field, (id) => !alive.includes(id));
  const structure: DivisionedJointStructure = {
    divisions: [1, 2].map((d) => ({
      alliances: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => divisionAllianceId(d, n)),
      alive: aliveIn(d),
      decidedWinner: decided(d) ? divisionAllianceId(d, 1) : undefined,
    })),
    finalsPlacementByAlliance: new Map(),
    finalsElimFinal: false,
    winnerPosted: false,
    divisionChampionMax: 90,
    finalsMaxByPlacement: variant.finalsMax,
    membersByAlliance: new Map(alliances.map((alliance) => [alliance.allianceNumber, alliance.members] as const)),
    spareByAlliance: new Map(alliances.map((alliance) => [alliance.allianceNumber, 1] as const)),
    maxAllianceSize: 4,
  };
  const result = divisionedJointFrames(structure);
  if ("refused" in result) throw new Error(result.refused);
  const input: JointLockInput = {
    pool: poolKeys.map(rivalOf),
    slotOnlyRivals: slotOnly,
    pointsSlots: 10,
    alliances,
    aliveAlliances: result.aliveAlliances,
    candidateWinners: result.candidateWinners,
    placementPoints: [75, 39, 21],
    consumingAwards: variant.consuming,
    judgedAwards: variant.judged,
    judgedAwardPoints: JUDGED,
    maxAllianceSize: 4,
    frames: result.frames,
    seatGroups: fieldSeatGroups(field),
  };
  return { variant, field, input, decided, aliveIn };
}
type E3Setup = ReturnType<typeof e3Setup>;

const NO_AWARD: ReadonlySet<string> = new Set();

/**
 * THE E3 FUTURES for one T, every one rule legal, yielded without awards (the
 * tests add those in closed form). Every pair of division completions (one
 * outcome for a decided division); each division winner in turn as champion,
 * skipped only when T is a CONFIRMED member of it, so an alliance that merely
 * lists T may win without T; every division backup placement in which each
 * team with a row sits on no alliance or on one alive alliance of ITS OWN
 * division, one backup per alliance, T never a backup; then, for each division
 * winner still without a backup, no finals backup or one of its own division's
 * free teams with a row.
 *
 * A listed fourth is one of the teams with a row, which builds both of its
 * futures: on its own alliance it stays as that alliance's one backup and no
 * other backup joins; anywhere else or nowhere it was never on that alliance.
 *
 * Pay: the confirmed members of an alive alliance what its division pays; a
 * backup that joined in the division the same, the most it can be paid; the
 * finals alliances' confirmed members and backups their finals value on top; a
 * backup that joined only for the finals the finals value alone. The champion
 * roster is its confirmed members and its one backup.
 */
function forEachE3Future(setup: E3Setup, teamKey: string, visit: (future: RecordedFuture) => void): void {
  const { field, variant } = setup;
  const completions = everyCompletion(playedMap(ROUND_FOUR_DECISIONS));
  interface DivisionOutcome {
    readonly winner: number;
    /** What each alive alliance of the division is still paid there. */
    readonly pay: ReadonlyMap<number, number>;
  }
  const outcomesOf = (d: number): DivisionOutcome[] => {
    if (setup.decided(d)) return [{ winner: divisionAllianceId(d, 1), pay: new Map() }];
    return completions.map((completion) => {
      const pay = new Map<number, number>();
      let winner = 0;
      for (const n of [1, 2, 3]) {
        const placement = completion.placementByAlliance.get(n)!;
        if (placement === 1) winner = divisionAllianceId(d, n);
        pay.set(divisionAllianceId(d, n), placementPay(placement, completion.loserWonAFinal));
      }
      return { winner, pay };
    });
  };
  const seatingsOf = (d: number): ReadonlyMap<number, string>[] => {
    if (setup.decided(d)) return [new Map()];
    const teams = field.eligible[d - 1]!.filter((key) => key !== teamKey);
    const aliveHere = setup.aliveIn(d);
    const out: Map<number, string>[] = [];
    const current = new Map<number, string>();
    const place = (at: number): void => {
      if (at === teams.length) {
        out.push(new Map(current));
        return;
      }
      place(at + 1);
      for (const id of aliveHere) {
        if (current.has(id)) continue;
        current.set(id, teams[at]!);
        place(at + 1);
        current.delete(id);
      }
    };
    place(0);
    return out;
  };
  const seatingsOne = seatingsOf(1);
  const seatingsTwo = seatingsOf(2);

  for (const outcomeOne of outcomesOf(1)) {
    for (const outcomeTwo of outcomesOf(2)) {
      const divisionWinners = [outcomeOne.winner, outcomeTwo.winner];
      for (const champion of divisionWinners) {
        if (field.confirmed.get(champion)!.includes(teamKey)) continue;
        const loser = divisionWinners.find((id) => id !== champion)!;
        const allianceValue = new Map<number, number>([...outcomeOne.pay, ...outcomeTwo.pay]);
        allianceValue.set(champion, (allianceValue.get(champion) ?? 0) + variant.finalsMax[0]);
        allianceValue.set(loser, (allianceValue.get(loser) ?? 0) + variant.finalsMax[1]);
        for (const seatingOne of seatingsOne) {
          for (const seatingTwo of seatingsTwo) {
            const divisionBackup = new Map<number, string>([...seatingOne, ...seatingTwo]);
            const used = new Set(divisionBackup.values());
            const finalsOnly = (id: number): (string | null)[] =>
              divisionBackup.has(id) ? [null] : [null, ...field.eligible[Math.floor(id / 10) - 1]!.filter((key) => key !== teamKey && !used.has(key))];
            for (const championFinals of finalsOnly(champion)) {
              for (const loserFinals of finalsOnly(loser)) {
                const paid = new Map<string, number>();
                const backups: BackupRecord[] = [];
                for (const [id, value] of allianceValue) for (const member of field.confirmed.get(id)!) paid.set(member, value);
                for (const [id, team] of divisionBackup) {
                  paid.set(team, allianceValue.get(id)!);
                  backups.push({ team, alliance: id, finalsOnly: false });
                }
                if (championFinals !== null) {
                  paid.set(championFinals, variant.finalsMax[0]);
                  backups.push({ team: championFinals, alliance: champion, finalsOnly: true });
                }
                if (loserFinals !== null) {
                  paid.set(loserFinals, variant.finalsMax[1]);
                  backups.push({ team: loserFinals, alliance: loser, finalsOnly: true });
                }
                paid.delete(teamKey);
                const championRoster = new Set(field.confirmed.get(champion)!);
                const championBackup = divisionBackup.get(champion) ?? championFinals;
                if (championBackup !== null) championRoster.add(championBackup);
                visit({ championRoster, paid, consuming: NO_AWARD, judged: NO_AWARD, champion, divisionWinners, backups, allianceValue });
              }
            }
          }
        }
      }
    }
  }
}

/**
 * The most real takers against T over every E3 future. Awards are added to
 * each future in closed form over the non takers N: the consuming awards plus
 * the judged awards that reach a judged liftable non taker WITH a division row
 * (a team with no row wins no division award), capped by N. That is
 * `min(|N|, C + min(K, |J|))`, the maximum distinct assignment of those roles
 * (Hall), cross checked against explicit enumeration on every 1,999th future.
 * The champion's backup is explicit in the future, so the 261009-kt3 closed
 * form's fill in term is gone.
 */
function e3MostTakers(setup: E3Setup, teamKey: string, counters: { checks: number; futures: number }): number {
  const { input, field } = setup;
  const poolByKey = new Map(input.pool.map((rival) => [rival.teamKey, rival] as const));
  const everyone = [...input.pool.map((rival) => rival.teamKey), ...input.slotOnlyRivals];
  const m = poolByKey.get(teamKey)!.floor;
  let most = 0;
  forEachE3Future(setup, teamKey, (future) => {
    counters.futures += 1;
    const baseTakers = divisionedTakers(input, teamKey, m, future);
    const nonTakers: string[] = [];
    const liftable: string[] = [];
    for (const key of everyone) {
      if (key === teamKey || future.championRoster.has(key)) continue;
      const rival = poolByKey.get(key);
      const points = rival === undefined ? -Infinity : rival.floor + rival.extra + (future.paid.get(key) ?? 0);
      if (points >= m) continue;
      nonTakers.push(key);
      if (rival !== undefined && field.divisionOfTeam.has(key) && points + JUDGED >= m) liftable.push(key);
    }
    const takers = baseTakers + Math.min(nonTakers.length, input.consumingAwards + Math.min(input.judgedAwards, liftable.length));
    if (takers > most) most = takers;
    if (++counters.checks % 1999 === 0) {
      // Explicit enumeration of the consuming and the judged recipient.
      let explicit = baseTakers;
      for (const consuming of [null, ...(input.consumingAwards > 0 ? nonTakers : [])]) {
        for (const judged of [null, ...(input.judgedAwards > 0 ? liftable : [])]) {
          if (judged !== null && judged === consuming) continue;
          const value = divisionedTakers(input, teamKey, m, {
            championRoster: future.championRoster,
            paid: future.paid,
            consuming: new Set(consuming === null ? [] : [consuming]),
            judged: new Set(judged === null ? [] : [judged]),
          });
          if (value > explicit) explicit = value;
        }
      }
      expect(explicit, `${teamKey}: closed form drifted from enumeration`).toBe(takers);
    }
  });
  return most;
}

describe("champJointLock: divisioned exhaustive soundness E3 over rule legal futures (261009-kt3 D7, 261009-tx9 D4)", () => {
  for (const variant of E3_VARIANTS) {
    it(`E3 ${variant.label}: no rule legal future's real takers exceed the bound`, () => {
      const setup = e3Setup(variant);
      const { input } = setup;
      const counters = { checks: 0, futures: 0 };
      for (const teamKey of input.pool.map((rival) => rival.teamKey)) {
        const bound = jointLockBound(input, teamKey);
        const most = e3MostTakers(setup, teamKey, counters);
        expect(most, `${variant.label} ${teamKey}: real takers ${most} above bound ${bound}`).toBeLessThanOrEqual(bound);
        // A decisive instance: the decisive team's worst legal future EQUALS its bound, so every term of the bound is needed.
        if (variant.decisive?.team === teamKey) expect(most, `${variant.label}: the decisive team's worst legal future`).toBe(bound);
      }
      expect(counters.futures).toBeGreaterThan(0);
    }, 120_000);
  }

  /**
   * The same exhaustive check over SEEDED RANDOM FLOORS (executor addition,
   * quick task 261009-tx9). The four general variants above share one floor
   * function and leave slack against most of the bound's terms. Random floors
   * in a narrow, a middle and a wide spread, with the finals values, C, K and
   * the decided division drawn per seed, put many teams exactly ON their bound
   * (the count is asserted), so a term that undercounts is caught here.
   */
  it("E3 over seeded random floors: 8 fields, no rule legal future's real takers exceed the bound, and the bound is reached", () => {
    const counters = { checks: 0, futures: 0 };
    let onTheBound = 0;
    for (let seed = 1000; seed < 1008; seed++) {
      const random = mulberry32(seed);
      const spread = [40, 120, 260][Math.floor(random() * 3)]!;
      const variant: E3Variant = {
        label: `seed ${String(seed)}, spread ${String(spread)}`,
        finalsMax: random() < 0.5 ? [30, 0] : [60, 30],
        consuming: random() < 0.5 ? 1 : 0,
        judged: random() < 0.5 ? 1 : 0,
        divisionOneDecided: random() < 0.4,
        randomFloors: { seed: seed + 7919, spread },
      };
      const setup = e3Setup(variant);
      for (const teamKey of setup.input.pool.map((rival) => rival.teamKey)) {
        const bound = jointLockBound(setup.input, teamKey);
        const most = e3MostTakers(setup, teamKey, counters);
        expect(most, `${variant.label} ${teamKey}: real takers ${most} above bound ${bound}`).toBeLessThanOrEqual(bound);
        if (most === bound) onTheBound += 1;
      }
    }
    expect(counters.futures).toBeGreaterThan(1_000_000);
    // Measured at these seeds: 5,697,088 futures and 106 teams on their bound.
    expect(onTheBound).toBeGreaterThan(50);
  }, 120_000);
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

/** "round4": every division after Round 4; "divisionsFinal": every division decided; "finalsSf4": and the finals' sf1 to sf4 played. */
type SampledDivisionedStop = "round4" | "divisionsFinal" | "finalsSf4";

interface SampledDivisionedCase {
  readonly label: string;
  readonly stop: SampledDivisionedStop;
}

const S2_CASES: readonly SampledDivisionedCase[] = [
  { label: "after Round 4 in every division", stop: "round4" },
  { label: "Divisions final, finals not started", stop: "divisionsFinal" },
  { label: "finals after sf1 to sf4", stop: "finalsSf4" },
];

const S2_FINALS_MAX = [60, 30, 0, 0];

/**
 * THE S2 FIELD AND INPUT at one stop. Four divisions, 24 teams with a row that
 * no alliance confirmed (six per division) and four more with no row.
 * Alliances 12 and 22 each list a fourth, as in the E3 field; they are members
 * at the Round 4 stop only, where their divisions have not placed them.
 */
function s2Setup(stop: SampledDivisionedStop) {
  const random = mulberry32(2610093 + stop.length);
  const field = divisionedField(
    {
      divisionCount: 4,
      eligible: [1, 2, 3, 4].map((d) => [1, 2, 3, 4, 5, 6].map((k) => `d${d}u${k}`)),
      noRow: ["n1", "n2", "n3", "n4"],
      listedFourths: new Map([
        [12, "d1u1"],
        [22, "d2u1"],
      ]),
    },
    () => 120 + Math.floor(random() * 201)
  );
  const allKeys = [...field.floors.keys()];

  // Division states at the stop. Divisions final: alliance 1 wins each division, the rest placed as Round 4 plus sf13 to 3 and the final 2 to 0.
  const fullDecisions = [...ROUND_FOUR_DECISIONS, ["sf13", 3]] as const;
  const finalPlacement = completeBracket(playedMap(fullDecisions), (a) => a);
  const decided = stop !== "round4";
  const placementAtStop = decided ? finalPlacement : (ROUND_FOUR_PLACED as ReadonlyMap<number, number>);
  // Finals seeds: division d's winner is finals alliance d; at finalsSf4, sf1 to sf4 are played (alliance 4 fourth).
  const finalsDecisions = new Map<string, number>();
  if (stop === "finalsSf4") {
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
  for (const [id, members] of field.confirmed) for (const member of members) allianceOfKey.set(member, id);
  // Decided values: in the floor once every division is final, otherwise their maximum in extra.
  const pool: JointLockRival[] = allKeys.map((teamKey) => {
    const id = allianceOfKey.get(teamKey);
    const value = id === undefined ? 0 : valueAtStop(id % 10);
    const floor = field.floors.get(teamKey)!;
    return decided ? { teamKey, floor: floor + value, extra: 0 } : { teamKey, floor, extra: value };
  });
  const alliances = fieldAlliances(field, (id) => decided || id % 10 > 3);
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
    finalsMaxByPlacement: S2_FINALS_MAX,
    membersByAlliance: new Map(alliances.map((alliance) => [alliance.allianceNumber, alliance.members] as const)),
    spareByAlliance: new Map(alliances.map((alliance) => [alliance.allianceNumber, 1] as const)),
    maxAllianceSize: 4,
  };
  const frames = divisionedJointFrames(structure);
  if ("refused" in frames) throw new Error(frames.refused);
  const input: JointLockInput = {
    pool,
    slotOnlyRivals: [],
    pointsSlots: 60,
    alliances,
    aliveAlliances: frames.aliveAlliances,
    candidateWinners: frames.candidateWinners,
    placementPoints: [75, 39, 21],
    consumingAwards: 5,
    judgedAwards: 56,
    judgedAwardPoints: JUDGED,
    maxAllianceSize: 4,
    frames: frames.frames,
    seatGroups: fieldSeatGroups(field),
  };
  return { stop, random, field, allKeys, pool, input, decided, finalsDecisions };
}
type S2Setup = ReturnType<typeof s2Setup>;

/** One sampled future, with the part of each rival's `extra` this future pays. */
interface SampledDivisionedFuture extends RecordedFuture {
  readonly extraPaidScale: ReadonlyMap<string, number>;
}

/**
 * ONE S2 FUTURE, rule legal. The divisions complete at random. Each listed
 * fourth stays as its alliance's one backup with probability 0.5 and otherwise
 * joins its division's free teams; each other alive alliance takes, with
 * probability 0.4, ONE backup from its own division's free teams with a row. A
 * backup is paid its alliance's division value or, one draw in three, a random
 * amount below it. Each division winner still without a backup takes one for
 * the finals with probability 0.5, again only from its own division, paid at
 * most its alliance's finals value; a backup that joined in the division is
 * paid in the finals too. The champion roster is its confirmed members and its
 * one backup. Five consuming awards go to any teams and the 56 judged awards to
 * teams with a division row, one point paying award per team.
 */
function sampleS2Future(setup: S2Setup): SampledDivisionedFuture {
  const { random, field, allKeys, pool, decided, finalsDecisions } = setup;
  const paid = new Map<string, number>();
  const add = (key: string, value: number): void => {
    paid.set(key, (paid.get(key) ?? 0) + value);
  };
  const membersPay = (value: number): number => (random() < 0.1 ? Math.floor(random() * value) : value);
  const backupPay = (value: number): number => (random() < 1 / 3 ? Math.floor(random() * value) : value);
  const extraPaidScale = new Map<string, number>();
  const allianceValue = new Map<number, number>();
  const backupOf = new Map<number, string>();
  const backups: BackupRecord[] = [];
  const free = field.eligible.map((keys) => [...keys]);
  const takeFree = (d: number): string | undefined => {
    const list = free[d - 1]!;
    return list.length === 0 ? undefined : list.splice(Math.floor(random() * list.length), 1)[0]!;
  };

  // Divisions.
  const winners: number[] = [];
  for (let d = 1; d <= 4; d++) {
    if (decided) {
      winners.push(divisionAllianceId(d, 1));
      continue;
    }
    const placement = completeBracket(playedMap(ROUND_FOUR_DECISIONS), (a, b) => (random() < 0.5 ? a : b));
    const loserWonAFinal = random() < 0.5;
    // The listed fourths first: one that does not stay is free for every alive alliance of its division.
    for (const n of [1, 2, 3]) {
      const id = divisionAllianceId(d, n);
      const fourth = field.listedFourths.get(id);
      if (fourth === undefined || random() >= 0.5) continue;
      backupOf.set(id, fourth);
      free[d - 1]!.splice(free[d - 1]!.indexOf(fourth), 1);
    }
    for (const n of [1, 2, 3]) {
      const id = divisionAllianceId(d, n);
      const value = placementPay(placement.get(n)!, loserWonAFinal);
      allianceValue.set(id, value);
      if (placement.get(n) === 1) winners.push(id);
      for (const member of field.confirmed.get(id)!) add(member, membersPay(value));
      if (!backupOf.has(id) && random() < 0.4) {
        const joined = takeFree(d);
        if (joined !== undefined) backupOf.set(id, joined);
      }
      const backup = backupOf.get(id);
      if (backup !== undefined) {
        add(backup, backupPay(value));
        backups.push({ team: backup, alliance: id, finalsOnly: false });
      }
    }
    for (const rival of pool) if (rival.extra > 0 && random() < 0.1) extraPaidScale.set(rival.teamKey, Math.floor(random() * rival.extra));
  }

  // Finals: division d's winner is finals alliance d.
  const finalsPlacement = randomFinals(random, 4, finalsDecisions);
  let champion = 0;
  let championRoster = new Set<string>();
  winners.forEach((id, index) => {
    const d = index + 1;
    const placement = finalsPlacement.get(d)!;
    const value = S2_FINALS_MAX[placement - 1]!;
    allianceValue.set(id, (allianceValue.get(id) ?? 0) + value);
    if (!backupOf.has(id) && random() < 0.5) {
      const joined = takeFree(d);
      if (joined !== undefined) {
        backupOf.set(id, joined);
        backups.push({ team: joined, alliance: id, finalsOnly: true });
      }
    }
    for (const member of field.confirmed.get(id)!) add(member, membersPay(value));
    const backup = backupOf.get(id);
    if (backup !== undefined) add(backup, backupPay(value));
    if (placement === 1) {
      champion = id;
      championRoster = new Set([...field.confirmed.get(id)!, ...(backup === undefined ? [] : [backup])]);
    }
  });

  // Awards: 5 consuming to any teams, 56 judged to teams with a division row, one per team.
  const order = [...allKeys].sort(() => random() - 0.5);
  const consuming = new Set(order.slice(0, 5));
  const judged = new Set(order.filter((key) => !consuming.has(key) && field.divisionOfTeam.has(key)).slice(0, 56));

  return { championRoster, paid, consuming, judged, champion, divisionWinners: winners, backups, allianceValue, extraPaidScale };
}

describe("champJointLock: divisioned sampled soundness S2 over rule legal futures (261009-kt3 D7, 261009-tx9 D4)", () => {
  for (const sampled of S2_CASES) {
    it(`S2 ${sampled.label}: four divisions, 20,000 rule legal futures, C=5, K=56, 2026 values, never above the bound`, () => {
      const setup = s2Setup(sampled.stop);
      const { random, pool, input } = setup;
      // Several T across the floors.
      const sortedPool = [...pool].sort((a, b) => b.floor + b.extra - (a.floor + a.extra));
      const tKeys = [0, 5, 10, 20, 30, 45, 60, 80, 100].map((rank) => sortedPool[rank]!.teamKey);
      const bounds = new Map(tKeys.map((key) => [key, jointLockBound(input, key)] as const));
      const most = new Map<string, number>();
      const poolByKey = new Map(pool.map((rival) => [rival.teamKey, rival] as const));

      for (let draw = 0; draw < 20_000; draw++) {
        const future = sampleS2Future(setup);
        const { extraPaidScale, paid } = future;
        for (const teamKey of tKeys) {
          if (future.consuming.has(teamKey) || future.championRoster.has(teamKey)) continue;
          const self = poolByKey.get(teamKey)!;
          const own = paid.has(teamKey) && random() < 0.5 ? paid.get(teamKey)! : 0;
          const tPoints = self.floor + own + (future.judged.has(teamKey) ? JUDGED : 0);
          const scaledPool = extraPaidScale.size === 0 ? input : { ...input, pool: input.pool.map((rival) => (extraPaidScale.has(rival.teamKey) ? { ...rival, extra: extraPaidScale.get(rival.teamKey)! } : rival)) };
          const takers = divisionedTakers(scaledPool, teamKey, tPoints, future);
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

describe("divisionedJointFrames: specific real futures the frames must cover (261009-kt3 and 261009-tx9 mutation guards)", () => {
  /**
   * Two divisions, alliances 11 and 12 alive in division 1 (or division 1
   * decided with winner 11), 21 and 22 alive in division 2; finals pay 60 and
   * 30; no award. Every future below is rule legal: one backup per alliance for
   * the whole championship, from its own division's teams with a row that no
   * alliance confirmed (the backup robot rule, quick task 261009-tx9).
   */
  interface TargetedCase {
    readonly spare: (id: number) => number;
    readonly pool: JointLockRival[];
    /** Per division, the teams with a row there that no alliance confirmed. */
    readonly groups: readonly [readonly string[], readonly string[]];
    readonly divisionOneDecided?: boolean;
    /** An alliance and the fourth it lists and has not confirmed. */
    readonly listed?: readonly [number, string];
  }
  function inputFor(target: TargetedCase): JointLockInput {
    const divisions = [1, 2].map((d) => ({
      alliances: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => divisionAllianceId(d, n)),
      alive: d === 1 && target.divisionOneDecided === true ? [] : [1, 2].map((n) => divisionAllianceId(d, n)),
      decidedWinner: d === 1 && target.divisionOneDecided === true ? divisionAllianceId(1, 1) : undefined,
    }));
    const membersByAlliance = new Map<number, string[]>();
    for (const division of divisions) for (const id of division.alliances) membersByAlliance.set(id, [`t${id}a`, `t${id}b`, `t${id}c`]);
    if (target.listed !== undefined) membersByAlliance.set(target.listed[0], [...membersByAlliance.get(target.listed[0])!, target.listed[1]]);
    const structure: DivisionedJointStructure = {
      divisions,
      finalsPlacementByAlliance: new Map(),
      finalsElimFinal: false,
      winnerPosted: false,
      divisionChampionMax: 90,
      finalsMaxByPlacement: [60, 30],
      membersByAlliance,
      spareByAlliance: new Map([...membersByAlliance.keys()].map((id) => [id, target.spare(id)] as const)),
      maxAllianceSize: 4,
    };
    const result = divisionedJointFrames(structure);
    if ("refused" in result) throw new Error(result.refused);
    return {
      pool: target.pool,
      slotOnlyRivals: [],
      pointsSlots: 1,
      alliances: [...membersByAlliance].map(([allianceNumber, members]) => ({ allianceNumber, members, spareSeats: target.spare(allianceNumber) })),
      aliveAlliances: result.aliveAlliances,
      candidateWinners: result.candidateWinners,
      placementPoints: [75, 39, 21],
      consumingAwards: 0,
      judgedAwards: 0,
      judgedAwardPoints: JUDGED,
      maxAllianceSize: 4,
      frames: result.frames,
      seatGroups: divisions.map((division, index) => ({ alliances: division.alliances, eligible: [...target.groups[index]!] })),
    };
  }
  const T: JointLockRival = { teamKey: "T", floor: 200, extra: 0 };
  const three = (id: number, floor: number): JointLockRival[] => ["a", "b", "c"].map((suffix) => ({ teamKey: `t${id}${suffix}`, floor, extra: 0 }));
  const rosterOf = (id: number, backup?: string): Set<string> => new Set([`t${id}a`, `t${id}b`, `t${id}c`, ...(backup === undefined ? [] : [backup])]);
  const noAward = { consuming: new Set<string>(), judged: new Set<string>() };

  it("T1: another division's alliance is paid 90 plus the finalist's 30: alliance 11 wins everything, 21 wins its division and is the finalist", () => {
    const input = inputFor({ spare: () => 0, pool: [T, ...three(11, 10), ...three(21, 85)], groups: [[], []] });
    const paid = new Map<string, number>([...three(11, 0).map((rival) => [rival.teamKey, 150] as const), ...three(21, 0).map((rival) => [rival.teamKey, 120] as const)]);
    const real = divisionedTakers(input, "T", 200, { championRoster: rosterOf(11), paid, ...noAward });
    expect(real).toBe(6);
    expect(jointLockBound(input, "T")).toBeGreaterThanOrEqual(real);
  });

  it("T2: the champion's one backup far below T takes a slot: 11 wins everything with v, a team of its own division, as its backup", () => {
    const input = inputFor({ spare: (id) => (id === 11 ? 1 : 0), pool: [T, { teamKey: "v", floor: 0, extra: 0 }], groups: [["v"], []] });
    const real = divisionedTakers(input, "T", 200, { championRoster: rosterOf(11, "v"), paid: new Map([["v", 150]]), ...noAward });
    expect(real).toBe(1);
    expect(jointLockBound(input, "T")).toBeGreaterThanOrEqual(real);
  });

  it("T3: a backup on an alive alliance of another division is paid its 90 plus 30: 21 wins division 2 with u as its one backup and is the finalist", () => {
    const input = inputFor({ spare: (id) => (id === 21 ? 1 : 0), pool: [T, ...three(11, 10), { teamKey: "u", floor: 85, extra: 0 }], groups: [[], ["u"]] });
    const paid = new Map<string, number>([...three(11, 0).map((rival) => [rival.teamKey, 150] as const), ["u", 120]]);
    const real = divisionedTakers(input, "T", 200, { championRoster: rosterOf(11), paid, ...noAward });
    expect(real).toBe(4);
    expect(jointLockBound(input, "T")).toBeGreaterThanOrEqual(real);
  });

  it("T4 (reading P3): L, the listed fourth of alive alliance 12, was never on it and is champion 11's one backup", () => {
    const input = inputFor({
      listed: [12, "L"],
      spare: (id) => (id === 11 || id === 12 ? 1 : 0),
      pool: [T, ...three(11, 10), { teamKey: "L", floor: 0, extra: 0 }],
      groups: [["L"], []],
    });
    const paid = new Map<string, number>([...three(11, 0).map((rival) => [rival.teamKey, 150] as const), ["L", 150]]);
    const real = divisionedTakers(input, "T", 200, { championRoster: rosterOf(11, "L"), paid, ...noAward });
    expect(real).toBe(4);
    expect(jointLockBound(input, "T")).toBeGreaterThanOrEqual(real);
  });

  it("T5: a decided division winner's finals backup is paid the finals non champion value: 21 wins everything, decided winner 11 is the finalist with u as its finals backup", () => {
    const input = inputFor({
      divisionOneDecided: true,
      spare: (id) => (id === 11 ? 1 : 0),
      pool: [T, ...three(21, 10), { teamKey: "u", floor: 170, extra: 0 }],
      groups: [["u"], []],
    });
    const paid = new Map<string, number>([...three(21, 0).map((rival) => [rival.teamKey, 150] as const), ["u", 30]]);
    const real = divisionedTakers(input, "T", 200, { championRoster: rosterOf(21), paid, ...noAward });
    expect(real).toBe(4);
    expect(jointLockBound(input, "T")).toBeGreaterThanOrEqual(real);
  });

  it("T6 (reading P3 for T itself): T is the listed fourth of alive alliance 12 and was never on it; 12 wins everything without T", () => {
    const input = inputFor({ listed: [12, "T"], spare: (id) => (id === 12 ? 1 : 0), pool: [T, ...three(12, 10)], groups: [["T"], []] });
    const paid = new Map<string, number>(three(12, 0).map((rival) => [rival.teamKey, 150] as const));
    const real = divisionedTakers(input, "T", 200, { championRoster: rosterOf(12), paid, ...noAward });
    expect(real).toBe(3);
    expect(jointLockBound(input, "T")).toBeGreaterThanOrEqual(real);
  });
});

// ---------------------------------------------------------------------------
// The samplers themselves are rule legal (quick task 261009-tx9, CONTEXT D4)
// ---------------------------------------------------------------------------

/**
 * THE LEGALITY CHECK: one message per breach of the backup robot rule in a
 * recorded future. It KNOWS THE HINDSIGHT ROSTER, which alliance lists which
 * fourth that is not confirmed. The breaches: two backups on one alliance over
 * the whole championship, division and finals together; a listed fourth that
 * stays on its alliance while another backup joins it; one team a backup on
 * two alliances; a backup that is a confirmed pick of any alliance; a backup
 * with no row in its alliance's division; a backup paid more than its
 * alliance's own value; the champion's backup missing from the champion
 * roster, or a team on that roster that is not on the champion; a team paid
 * without being on an alliance, a listed fourth paid as its listed alliance's
 * member without being recorded as its backup among them; a team holding two
 * point paying awards; a judged award to a team with no division row.
 */
function ruleViolations(future: RecordedFuture, field: DivisionedField): string[] {
  const messages: string[] = [];
  const confirmedOn = new Map<string, number>();
  for (const [id, members] of field.confirmed) for (const member of members) confirmedOn.set(member, id);
  const listedOn = new Map<string, number>();
  for (const [id, key] of field.listedFourths) listedOn.set(key, id);
  const byAlliance = new Map<number, BackupRecord[]>();
  const byTeam = new Map<string, BackupRecord[]>();
  for (const backup of future.backups) {
    byAlliance.set(backup.alliance, [...(byAlliance.get(backup.alliance) ?? []), backup]);
    byTeam.set(backup.team, [...(byTeam.get(backup.team) ?? []), backup]);
  }

  for (const [id, list] of byAlliance) {
    if (list.length < 2) continue;
    const fourth = field.listedFourths.get(id);
    if (fourth !== undefined && list.some((backup) => backup.team === fourth)) messages.push(`alliance ${String(id)}: its listed fourth ${fourth} stays while another backup joins it`);
    else messages.push(`alliance ${String(id)}: ${String(list.length)} backups over the whole championship`);
  }
  for (const [team, list] of byTeam) {
    const alliances = new Set(list.map((backup) => backup.alliance));
    if (alliances.size > 1) messages.push(`${team}: a backup on ${String(alliances.size)} alliances`);
  }
  for (const backup of future.backups) {
    const eligibleHere = field.eligible[Math.floor(backup.alliance / 10) - 1] ?? [];
    const confirmedAlliance = confirmedOn.get(backup.team);
    if (confirmedAlliance !== undefined) messages.push(`${backup.team}: a confirmed pick of alliance ${String(confirmedAlliance)} is a backup on alliance ${String(backup.alliance)}`);
    else if (!eligibleHere.includes(backup.team)) messages.push(`${backup.team}: a backup on alliance ${String(backup.alliance)} with no row in its division`);
    const value = future.allianceValue.get(backup.alliance) ?? 0;
    const paid = future.paid.get(backup.team) ?? 0;
    if (paid > value) messages.push(`${backup.team}: a backup paid ${String(paid)}, above the ${String(value)} of its alliance ${String(backup.alliance)}`);
    if (backup.alliance === future.champion && !future.championRoster.has(backup.team)) messages.push(`${backup.team}: the champion's backup is missing from the champion roster`);
  }
  for (const key of future.championRoster) {
    if (confirmedOn.get(key) === future.champion) continue;
    if ((byTeam.get(key) ?? []).some((backup) => backup.alliance === future.champion)) continue;
    messages.push(`${key}: on the champion roster without being on the champion alliance`);
  }
  for (const [key, paid] of future.paid) {
    if (paid <= 0 || byTeam.has(key)) continue;
    const confirmedAlliance = confirmedOn.get(key);
    if (confirmedAlliance !== undefined) {
      const value = future.allianceValue.get(confirmedAlliance) ?? 0;
      if (paid > value) messages.push(`${key}: a member paid ${String(paid)}, above the ${String(value)} of its alliance ${String(confirmedAlliance)}`);
      continue;
    }
    const listedAlliance = listedOn.get(key);
    if (listedAlliance !== undefined) messages.push(`${key}: a listed fourth paid as a member of alliance ${String(listedAlliance)} without being recorded as its backup`);
    else messages.push(`${key}: paid without being on an alliance`);
  }
  for (const key of future.consuming) if (future.judged.has(key)) messages.push(`${key}: two point paying awards`);
  for (const key of future.judged) if (!field.divisionOfTeam.has(key)) messages.push(`${key}: a judged award to a team with no division row`);
  return messages;
}

describe("champJointLock: the divisioned samplers obey the backup robot rule (261009-tx9, D4)", () => {
  it("every future the E3 enumerator yields for one pool team of each of the six variants, and 20,000 S2 futures at each of the three stops, break no rule, and the samplers are not vacuous", () => {
    const seen = { futures: 0, championBackup: 0, losingFinalsBackup: 0, finalsOnlyBackup: 0, winnerWithoutBackup: 0, listedFourthStays: 0, listedFourthElsewhere: 0 };
    const check = (future: RecordedFuture, field: DivisionedField, label: string): void => {
      seen.futures += 1;
      const messages = ruleViolations(future, field);
      if (messages.length > 0) throw new Error(`${label}: an illegal future: ${messages.join("; ")}`);
      const backed = new Set<number>();
      for (const backup of future.backups) {
        backed.add(backup.alliance);
        if (backup.alliance === future.champion) seen.championBackup += 1;
        else if (future.divisionWinners.includes(backup.alliance)) seen.losingFinalsBackup += 1;
        if (backup.finalsOnly) seen.finalsOnlyBackup += 1;
        for (const [id, fourth] of field.listedFourths) {
          if (fourth !== backup.team) continue;
          if (id === backup.alliance) seen.listedFourthStays += 1;
          else seen.listedFourthElsewhere += 1;
        }
      }
      if (future.divisionWinners.some((id) => !backed.has(id))) seen.winnerWithoutBackup += 1;
    };

    let enumerated = 0;
    for (const variant of E3_VARIANTS) {
      const setup = e3Setup(variant);
      // A member of a placed alliance: no champion is skipped for it and every team with a row is placed.
      const teamKey = variant.decisive?.team ?? "d2a4m1";
      expect(setup.input.pool.some((rival) => rival.teamKey === teamKey)).toBe(true);
      forEachE3Future(setup, teamKey, (future) => {
        enumerated += 1;
        check(future, setup.field, `E3 ${variant.label}`);
      });
    }
    expect(enumerated).toBeGreaterThan(50_000);

    let sampled = 0;
    for (const sampledCase of S2_CASES) {
      const setup = s2Setup(sampledCase.stop);
      for (let draw = 0; draw < 20_000; draw++) {
        sampled += 1;
        check(sampleS2Future(setup), setup.field, `S2 ${sampledCase.label}`);
      }
    }
    expect(sampled).toBe(60_000);

    // Not vacuous: each kind of backup the rule allows is drawn, and so is its absence.
    expect(seen.futures).toBe(enumerated + sampled);
    expect(seen.championBackup).toBeGreaterThan(0);
    expect(seen.losingFinalsBackup).toBeGreaterThan(0);
    expect(seen.finalsOnlyBackup).toBeGreaterThan(0);
    expect(seen.winnerWithoutBackup).toBeGreaterThan(0);
    expect(seen.listedFourthStays).toBeGreaterThan(0);
    expect(seen.listedFourthElsewhere).toBeGreaterThan(0);
  }, 120_000);

  it("five hand built illegal futures are each reported with their own message", () => {
    const { field } = e3Setup(E3_VARIANTS[1]!);
    const members = (id: number): readonly string[] => field.confirmed.get(id)!;
    // The legal base: 11 wins division 1 (90) and the finals (60); 21 wins division 2 (90) and is the finalist (30);
    // 12 and 22 are second in their divisions (75) and 13 and 23 third (39). No backup anywhere.
    const allianceValue = new Map([
      [11, 150],
      [12, 75],
      [13, 39],
      [21, 120],
      [22, 75],
      [23, 39],
    ]);
    const basePaid = new Map<string, number>();
    for (const [id, value] of allianceValue) for (const member of members(id)) basePaid.set(member, value);
    const built = (backups: readonly BackupRecord[], paid: readonly (readonly [string, number])[], onRoster: readonly string[] = []): RecordedFuture => ({
      championRoster: new Set([...members(11), ...onRoster]),
      paid: new Map([...basePaid, ...paid]),
      consuming: new Set(),
      judged: new Set(),
      champion: 11,
      divisionWinners: [11, 21],
      backups,
      allianceValue,
    });
    expect(ruleViolations(built([], []), field)).toEqual([]);
    // A legal backup of each kind, so the five below fail for their own reason and no other.
    expect(ruleViolations(built([{ team: "u1", alliance: 11, finalsOnly: false }], [["u1", 150]], ["u1"]), field)).toEqual([]);
    expect(ruleViolations(built([{ team: "L1", alliance: 12, finalsOnly: false }], [["L1", 75]]), field)).toEqual([]);
    expect(ruleViolations(built([{ team: "L2", alliance: 21, finalsOnly: true }], [["L2", 30]]), field)).toEqual([]);

    const illegal: readonly { readonly label: string; readonly future: RecordedFuture; readonly message: RegExp }[] = [
      {
        // The 261009-kt3 reading R5 future: u1 on 11's division roster and q2 on its finals roster.
        label: "a second backup on one alliance",
        future: built(
          [
            { team: "u1", alliance: 11, finalsOnly: false },
            { team: "q2", alliance: 11, finalsOnly: true },
          ],
          [
            ["u1", 90],
            ["q2", 60],
          ],
          ["u1", "q2"]
        ),
        message: /^alliance 11: 2 backups over the whole championship$/,
      },
      {
        label: "a backup from another division",
        future: built([{ team: "L2", alliance: 12, finalsOnly: false }], [["L2", 75]]),
        message: /^L2: a backup on alliance 12 with no row in its division$/,
      },
      {
        // The 261009-kt3 seat open to any rival: a pick of eliminated alliance 25 on the losing finals alliance.
        label: "a confirmed pick of an eliminated alliance as a backup",
        future: built([{ team: "d2a5m1", alliance: 21, finalsOnly: true }], [["d2a5m1", 30]]),
        message: /^d2a5m1: a confirmed pick of alliance 25 is a backup on alliance 21$/,
      },
      {
        label: "a backup paid above its alliance",
        future: built([{ team: "u1", alliance: 12, finalsOnly: false }], [["u1", 90]]),
        message: /^u1: a backup paid 90, above the 75 of its alliance 12$/,
      },
      {
        label: "a listed fourth that stays while another backup joins its alliance",
        future: built(
          [
            { team: "L1", alliance: 12, finalsOnly: false },
            { team: "u1", alliance: 12, finalsOnly: false },
          ],
          [
            ["L1", 75],
            ["u1", 75],
          ]
        ),
        message: /^alliance 12: its listed fourth L1 stays while another backup joins it$/,
      },
    ];
    for (const entry of illegal) {
      const messages = ruleViolations(entry.future, field);
      expect(messages, entry.label).toHaveLength(1);
      expect(messages[0], entry.label).toMatch(entry.message);
    }
    // Two more breaches the samplers never draw: a listed fourth paid as a member with no backup record, and a judged award with no row.
    expect(ruleViolations(built([], [["L1", 75]]), field)).toEqual(["L1: a listed fourth paid as a member of alliance 12 without being recorded as its backup"]);
    expect(ruleViolations({ ...built([], []), judged: new Set(["r"]) }, field)).toEqual(["r: a judged award to a team with no division row"]);
  });
});

// ===========================================================================
// Quick task 261010-d7r, D1: a rival that already holds a posted award takes
// no further judged award
// ===========================================================================

describe("champJointLock: a rival that holds a posted award takes no further judged award (261010-d7r, D1)", () => {
  it("a picked rival one judged award short of T, with budget left, is counted without awardedRivals and NOT counted with it", () => {
    // n is a confirmed pick of the placed alliance 8, 10 short of T. One judged award (15) is left in the budget.
    const base = minimalInput({
      pool: [
        { teamKey: "T", floor: 100, extra: 0 },
        { teamKey: "n", floor: 90, extra: 0 },
      ],
      alliances: [
        { allianceNumber: 1, members: ["x1", "x2", "x3", "x4"] },
        { allianceNumber: 8, members: ["n", "y1", "y2"] },
      ],
      aliveAlliances: [1],
      candidateWinners: [1],
      judgedAwards: 1,
    });
    expect(jointLockBound(base, "T")).toBe(1);
    expect(jointLockBound({ ...base, awardedRivals: ["n"] }, "T")).toBe(0);
    // Naming a team that is not a rival, or T itself, changes nothing.
    expect(jointLockBound({ ...base, awardedRivals: ["T", "nobody"] }, "T")).toBe(1);
    expect(jointLockBound({ ...base, awardedRivals: [] }, "T")).toBe(1);
  });

  it("an awarded rival on no alliance is counted through a seat whose value alone reaches T, and not through a seat plus an award or an award alone", () => {
    // Alliance 1 wins with four members (no fill in). Alliance 2 is paid 75 and has one seat. One judged award is left.
    const inputFor = (floor: number, awarded: boolean): JointLockInput =>
      minimalInput({
        pool: [
          { teamKey: "T", floor: 200, extra: 0 },
          { teamKey: "u", floor, extra: 0 },
        ],
        alliances: [
          { allianceNumber: 1, members: ["x1", "x2", "x3", "x4"] },
          { allianceNumber: 2, members: ["y1", "y2", "y3"] },
        ],
        aliveAlliances: [1, 2],
        candidateWinners: [1],
        judgedAwards: 1,
        frames: [{ winner: 1, enumerated: [], fixed: new Map([[2, 75]]), fillIns: 0 }],
        ...(awarded ? { awardedRivals: ["u"] } : {}),
      });
    // 70 short: the 75 seat alone reaches T, awarded or not.
    expect(jointLockBound(inputFor(130, false), "T")).toBe(1);
    expect(jointLockBound(inputFor(130, true), "T")).toBe(1);
    // 85 short: the seat (75) and one award (15) reach T; the seat alone does not.
    expect(jointLockBound(inputFor(115, false), "T")).toBe(1);
    expect(jointLockBound(inputFor(115, true), "T")).toBe(0);
    // 10 short with no seat taken: one award alone reaches T, which an awarded rival does not get. The seat still covers it.
    expect(jointLockBound({ ...inputFor(190, true), frames: [{ winner: 1, enumerated: [], fixed: new Map(), fillIns: 0 }] }, "T")).toBe(0);
    expect(jointLockBound({ ...inputFor(190, false), frames: [{ winner: 1, enumerated: [], fixed: new Map(), fillIns: 0 }] }, "T")).toBe(1);
    expect(jointLockBound(inputFor(190, true), "T")).toBe(1);
  });

  it("premise P1: an awarded rival still short of T is counted through a consuming award, and can still be the winner's backup", () => {
    // Six teams of 2017 and 2018 FIM held a division judged award and then won Impact or Rookie All Star at the finals,
    // so the rule must NOT deny an awarded rival a consuming award's place. No other rival, the winner posted.
    const posted = (consumingAwards: number): JointLockInput =>
      minimalInput({
        pool: [
          { teamKey: "T", floor: 100, extra: 0 },
          { teamKey: "u", floor: 50, extra: 0 },
        ],
        candidateWinners: [null],
        consumingAwards,
        judgedAwards: 3,
        awardedRivals: ["u"],
      });
    expect(jointLockBound(posted(1), "T")).toBe(1);
    expect(jointLockBound(posted(0), "T")).toBe(0);
    // The winner has one seat left and u, on no alliance, may be called onto it: a backup on the winner takes a slot whatever its points.
    const fillIn = minimalInput({
      pool: [
        { teamKey: "T", floor: 100, extra: 0 },
        { teamKey: "u", floor: 50, extra: 0 },
      ],
      alliances: [OUTSIDE_WINNER],
      aliveAlliances: [1],
      candidateWinners: [1],
      awardedRivals: ["u"],
    });
    expect(jointLockBound(fillIn, "T")).toBe(1);
    expect(jointLockBound({ ...fillIn, alliances: [{ allianceNumber: 1, members: ["x1", "x2", "x3", "x4"] }] }, "T")).toBe(0);
  });

  it("naming awarded rivals never raises a bound: 500 seeded random single championship instances, every team", () => {
    const random = mulberry32(26101001);
    const integer = (lo: number, hi: number): number => lo + Math.floor(random() * (hi - lo + 1));
    let lower = 0;
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
      const pool = keys.map((teamKey) => ({ teamKey, floor: integer(50, 150), extra: random() < 0.2 ? integer(1, 30) : 0 }));
      const alive = alliances.map((a) => a.allianceNumber).filter(() => random() < 0.8);
      const input: JointLockInput = {
        pool,
        slotOnlyRivals: [],
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
      const awardedRivals = keys.filter(() => random() < 0.3);
      for (const rival of pool) {
        const without = jointLockBound(input, rival.teamKey);
        const withRule = jointLockBound({ ...input, awardedRivals }, rival.teamKey);
        expect(withRule, `instance ${instance} ${rival.teamKey}`).toBeLessThanOrEqual(without);
        if (withRule < without) lower += 1;
      }
    }
    // The rule is not vacuous on these instances: it lowers some bounds.
    expect(lower).toBeGreaterThan(0);
  }, 60_000);

  it("with awarded rivals: the matching equals the exact dynamic program on 20,000 seeded flagged instances of one seat group, and a flag never raises the cover", () => {
    const random = mulberry32(26101002);
    const integer = (lo: number, hi: number): number => lo + Math.floor(random() * (hi - lo + 1));
    const valuePalette = [120, 90, 75, 60, 45, 39, 30, 21];
    let flagged = 0;
    let lowered = 0;
    for (let instance = 0; instance < 20_000; instance++) {
      const deficits = Array.from({ length: integer(1, 9) }, () => integer(1, 140));
      const awarded = deficits.map(() => random() < 0.35);
      const types = [...valuePalette].sort(() => random() - 0.5).slice(0, integer(0, 3)).sort((a, b) => b - a);
      const counts = types.map(() => integer(1, 3));
      const budget = integer(0, 5);
      const exact = referenceCover(deficits, types, counts, budget, JUDGED, { awarded });
      const matched = matchingOfOneGroup(deficits, types, counts, budget, { awarded });
      const unflagged = matchingOfOneGroup(deficits, types, counts, budget);
      if (awarded.some((flag) => flag)) flagged += 1;
      const where = `instance ${instance}: ${JSON.stringify({ deficits, awarded, types, counts, budget })}`;
      expect(matched, where).toEqual(exact);
      for (let j = 0; j <= budget; j++) {
        expect(matched[j]!, where).toBeLessThanOrEqual(unflagged[j]!);
        if (matched[j]! < unflagged[j]!) lowered += 1;
      }
      // No flag set is the matching with no flags at all, cell for cell.
      expect(matchingOfOneGroup(deficits, types, counts, budget, { awarded: deficits.map(() => false) })).toEqual(unflagged);
    }
    expect(flagged).toBeGreaterThan(15_000);
    expect(lowered).toBeGreaterThan(0);
  }, 120_000);
});

/**
 * As `e3MostTakers`, over the same rule legal futures, at a state where the
 * teams of `awarded` already hold their one judged award (its points are in
 * their floors). THE LEGAL AWARD FUTURES THERE: a judged award goes only to a
 * liftable non taker with a division row that is NOT awarded; a consuming
 * award goes to ANY non taker, an awarded one included (2017 and 2018 FIM: six
 * teams held a division judged award and then won Impact or Rookie All Star at
 * the finals).
 */
function e3MostTakersAwarded(setup: E3Setup, input: JointLockInput, awarded: ReadonlySet<string>, teamKey: string, counters: { futures: number }): number {
  const { field } = setup;
  const poolByKey = new Map(input.pool.map((rival) => [rival.teamKey, rival] as const));
  const everyone = [...input.pool.map((rival) => rival.teamKey), ...input.slotOnlyRivals];
  const m = poolByKey.get(teamKey)!.floor;
  let most = 0;
  forEachE3Future(setup, teamKey, (future) => {
    counters.futures += 1;
    const baseTakers = divisionedTakers(input, teamKey, m, future);
    const nonTakers: string[] = [];
    const liftable: string[] = [];
    for (const key of everyone) {
      if (key === teamKey || future.championRoster.has(key)) continue;
      const rival = poolByKey.get(key);
      const points = rival === undefined ? -Infinity : rival.floor + rival.extra + (future.paid.get(key) ?? 0);
      if (points >= m) continue;
      nonTakers.push(key);
      if (rival !== undefined && field.divisionOfTeam.has(key) && !awarded.has(key) && points + JUDGED >= m) liftable.push(key);
    }
    const takers = baseTakers + Math.min(nonTakers.length, input.consumingAwards + Math.min(input.judgedAwards, liftable.length));
    if (takers > most) most = takers;
  });
  return most;
}

describe("champJointLock: divisioned exhaustive soundness E3 with AWARDED rivals (261010-d7r, D4)", () => {
  /**
   * The state where some divisions' Awards read final: each awarded team's
   * judged award (15) is in its floor and it is named in `awardedRivals`. The
   * fields, the futures and the closed form of the awards are E3's; only who
   * may still take a judged award differs. Three things are held:
   *
   *   - no rule legal future's real takers exceed the bound WITH the rule
   *     (soundness, the one that must never fail);
   *   - the bound is reached, so the rule's terms are not slack;
   *   - the bound with the rule is never ABOVE the bound without it, and is
   *     below it for some teams, so the rule only removes futures.
   */
  it("8 seeded fields with awarded rivals: no rule legal future's real takers exceed the bound, the bound is reached, and it is never above the bound without the rule", () => {
    const counters = { futures: 0 };
    let teams = 0;
    let onTheBound = 0;
    let withoutBelowWith = 0;
    let ruleTighter = 0;
    let awardedTotal = 0;
    for (let seed = 2000; seed < 2008; seed++) {
      const random = mulberry32(seed);
      const spread = [40, 120, 260][Math.floor(random() * 3)]!;
      const variant: E3Variant = {
        label: `awarded seed ${String(seed)}, spread ${String(spread)}`,
        finalsMax: random() < 0.5 ? [30, 0] : [60, 30],
        consuming: random() < 0.6 ? 1 : 0,
        judged: Math.floor(random() * 3),
        divisionOneDecided: random() < 0.4,
        randomFloors: { seed: seed + 7919, spread },
      };
      const setup = e3Setup(variant);
      // The awarded teams: pool teams with a division row, each with its judged award already in its floor.
      const awardedKeys = setup.input.pool.map((rival) => rival.teamKey).filter((key) => setup.field.divisionOfTeam.has(key) && random() < 0.3);
      const awarded = new Set(awardedKeys);
      awardedTotal += awarded.size;
      const pool = setup.input.pool.map((rival) => (awarded.has(rival.teamKey) ? { ...rival, floor: rival.floor + JUDGED } : rival));
      const withRule: JointLockInput = { ...setup.input, pool, awardedRivals: awardedKeys };
      const withoutRule: JointLockInput = { ...setup.input, pool };
      for (const teamKey of pool.map((rival) => rival.teamKey)) {
        teams += 1;
        const most = e3MostTakersAwarded(setup, withRule, awarded, teamKey, counters);
        const bound = jointLockBound(withRule, teamKey);
        expect(most, `${variant.label} ${teamKey}: real takers ${most} above the bound ${bound}`).toBeLessThanOrEqual(bound);
        if (most === bound) onTheBound += 1;
        const boundWithout = jointLockBound(withoutRule, teamKey);
        if (boundWithout < bound) withoutBelowWith += 1;
        if (bound < boundWithout) ruleTighter += 1;
      }
    }
    console.log(
      `[261010-d7r E3 awarded] fields 8 | teams ${String(teams)} | awarded rivals ${String(awardedTotal)} | futures ${String(counters.futures)} | teams on their bound ${String(onTheBound)} | bound with the rule below the bound without it ${String(ruleTighter)} | above it ${String(withoutBelowWith)}`
    );
    expect(withoutBelowWith).toBe(0);
    // Pinned as the run shows (the planner's prototype read the same): the fields, the awarded rivals and the futures.
    expect({ teams, awardedTotal, futures: counters.futures }).toEqual({ teams: 256, awardedTotal: 69, futures: 3_821_696 });
    // Since quick task 261010-l0s (every rival counted once) 74 teams are on their bound, where 52 were, and the
    // rule tightens the bound for 16, where it was 17: the bound without the rule came down onto it for one team.
    expect({ onTheBound, ruleTighter }).toEqual({ onTheBound: 74, ruleTighter: 16 });
  }, 600_000);
});

describe("champJointLock: brute force soundness on small instances with awarded rivals and listed only picks (261010-d7r, D4)", () => {
  /**
   * AN INDEPENDENT BRUTE FORCE of the bound on small single group instances.
   * Every legal future is enumerated; the real slot takers against T must
   * never exceed the bound, and the bound should be reached often.
   *
   * THE LEGAL FUTURES HERE. One frame: the winner W is alliance 1, the one
   * candidate; alliances 2 and 3 are paid fixed values. Every member of W
   * takes a slot. A rival on no alliance takes at most one seat (on 2 or 3,
   * where that alliance has a spare seat and a value above 0) or is W's
   * backup (where W has a spare seat), or neither. At most K judged awards,
   * one per rival, never to an awarded rival, each lifting a rival that is
   * within one award of T. At most C consuming awards, to anyone not already
   * a taker, AN AWARDED RIVAL INCLUDED: a consuming award takes a slot
   * whatever its winner's points, and six teams of 2017 and 2018 FIM won one
   * at the finals while holding a division judged award (premise P1 of the
   * quick task). On top of each seating the awards are added in closed form:
   * `min(non takers, C + min(K, liftable non takers that are not awarded))`.
   *
   * LISTED ONLY PICKS (finding F-D of the quick task). A listed pick that is
   * not confirmed, of a PLACED alliance that would pay it its settled value
   * (21, 39 or 75), has one more choice than a rival on no alliance: it WAS
   * on that alliance, is paid the settled value and takes no seat and no
   * fill in ("own"). Or it never was, is paid nothing by it, and is free
   * like any rival on no alliance. A listed pick that is not confirmed of the
   * WINNER (settled 90) is W's backup, where W has a spare seat, or it never
   * was on W and is free like any rival on no alliance. It is never paid the
   * 90 as points. The pool hands each such rival its settled value inside
   * `extra` with `listedOnly`, exactly as the status code does.
   */
  it("20,000 seeded instances: the bound is never below a legal future, and it is reached at every one of them", () => {
    const INSTANCES = 20_000;
    const m = 200;
    type Kind = "memberW" | "member2" | "member3" | "free" | "listedPlaced" | "listedWinner";
    interface Rival {
      readonly key: string;
      readonly floor: number;
      readonly extra: number;
      readonly kind: Kind;
      /** What the alliance listing the rival would pay it: 0 for a rival that no placed alliance lists. */
      readonly settled: number;
      readonly awarded: boolean;
    }
    type Choice = "none" | "seat2" | "seat3" | "fill" | "own";
    let onBound = 0;
    let withAwarded = 0;
    let withListedOnly = 0;
    let slackTotal = 0;
    const failures: string[] = [];
    for (let seed = 1; seed <= INSTANCES; seed++) {
      const random = mulberry32(seed);
      const pick = (n: number): number => Math.floor(random() * n);
      // What alliances 2 and 3 are paid, and the spare seats of W, 2 and 3.
      const values = [[75, 39, 21][pick(3)]!, [75, 39, 21, 120][pick(4)]!] as const;
      const spare = [pick(2), pick(2), pick(2)] as const;
      const K = pick(3);
      const C = pick(2);
      const rivals: Rival[] = [];
      const add = (kind: Kind, count: number): void => {
        for (let i = 0; i < count; i++) {
          // Drawn in this order: awarded, floor, extra, then the settled value of a placed alliance's listed pick.
          const awarded = random() < 0.3;
          const floor = 80 + pick(150);
          const extra = pick(2) === 0 ? 0 : pick(30);
          const settled = kind === "listedPlaced" ? [21, 39, 75][pick(3)]! : kind === "listedWinner" ? 90 : 0;
          rivals.push({ key: `${kind}${String(i)}`, floor, extra, kind, settled, awarded });
        }
      };
      add("memberW", pick(2));
      add("member2", pick(3));
      add("member3", pick(2));
      add("free", 1 + pick(3));
      add("listedPlaced", pick(3));
      add("listedWinner", pick(2));
      if (rivals.some((rival) => rival.awarded)) withAwarded += 1;
      if (rivals.some((rival) => rival.settled > 0)) withListedOnly += 1;
      const membersOf = (kind: Kind): string[] => rivals.filter((rival) => rival.kind === kind).map((rival) => rival.key);
      const input: JointLockInput = {
        pool: [
          { teamKey: "T", floor: m, extra: 0 },
          ...rivals.map((rival): JointLockRival =>
            rival.settled > 0
              ? { teamKey: rival.key, floor: rival.floor, extra: rival.extra + rival.settled, listedOnly: { settled: rival.settled, onWinner: rival.kind === "listedWinner" } }
              : { teamKey: rival.key, floor: rival.floor, extra: rival.extra }
          ),
        ],
        slotOnlyRivals: [],
        pointsSlots: 99,
        alliances: [
          { allianceNumber: 1, members: membersOf("memberW"), spareSeats: spare[0] },
          { allianceNumber: 2, members: membersOf("member2"), spareSeats: spare[1] },
          { allianceNumber: 3, members: membersOf("member3"), spareSeats: spare[2] },
        ],
        aliveAlliances: [2, 3],
        candidateWinners: [1],
        placementPoints: [75, 39, 21],
        consumingAwards: C,
        judgedAwards: K,
        judgedAwardPoints: JUDGED,
        maxAllianceSize: 4,
        frames: [
          {
            winner: 1,
            enumerated: [],
            fixed: new Map([
              [2, values[0]],
              [3, values[1]],
            ]),
            fillIns: spare[0],
          },
        ],
        awardedRivals: rivals.filter((rival) => rival.awarded).map((rival) => rival.key),
      };
      const bound = jointLockBound(input, "T");

      const movable = rivals.filter((rival) => rival.kind === "free" || rival.kind === "listedPlaced" || rival.kind === "listedWinner");
      const choice = new Map<string, Choice>();
      const used = { seat2: 0, seat3: 0, fill: 0 };
      let most = 0;
      const settle = (): void => {
        const takers = new Set<string>();
        const points = new Map<string, number>();
        for (const rival of rivals) {
          if (rival.kind === "memberW" || choice.get(rival.key) === "fill") {
            takers.add(rival.key);
            continue;
          }
          let total = rival.floor + rival.extra;
          if (rival.kind === "member2" || choice.get(rival.key) === "seat2") total += values[0];
          if (rival.kind === "member3" || choice.get(rival.key) === "seat3") total += values[1];
          // It was on the placed alliance that lists it: paid the settled value, and on no seat.
          if (choice.get(rival.key) === "own") total += rival.settled;
          points.set(rival.key, total);
          if (total >= m) takers.add(rival.key);
        }
        const nonTakers = rivals.filter((rival) => !takers.has(rival.key));
        const liftable = nonTakers.filter((rival) => !rival.awarded && points.get(rival.key)! + JUDGED >= m).length;
        const total = takers.size + Math.min(nonTakers.length, C + Math.min(K, liftable));
        if (total > most) most = total;
      };
      const visit = (at: number): void => {
        if (at === movable.length) {
          settle();
          return;
        }
        const rival = movable[at]!;
        const options: Choice[] = ["none"];
        if (used.seat2 < spare[1]) options.push("seat2");
        if (used.seat3 < spare[2]) options.push("seat3");
        if (used.fill < spare[0]) options.push("fill");
        if (rival.kind === "listedPlaced") options.push("own");
        for (const option of options) {
          choice.set(rival.key, option);
          if (option !== "none" && option !== "own") used[option] += 1;
          visit(at + 1);
          if (option !== "none" && option !== "own") used[option] -= 1;
        }
        choice.delete(rival.key);
      };
      visit(0);

      slackTotal += bound - most;
      if (most === bound) onBound += 1;
      if (most > bound && failures.length < 6) {
        failures.push(
          `seed ${String(seed)}: real ${String(most)} above bound ${String(bound)} | K ${String(K)} C ${String(C)} spare ${spare.join(",")} values ${values.join(",")} | ${rivals.map((rival) => `${rival.key}:${String(rival.floor)}+${String(rival.extra)}${rival.settled > 0 ? `~${String(rival.settled)}` : ""}${rival.awarded ? "*" : ""}`).join(" ")}`
        );
      }
      expect(most, failures.at(-1) ?? `seed ${String(seed)}`).toBeLessThanOrEqual(bound);
    }
    console.log(
      `[261010-d7r brute force] instances ${String(INSTANCES)} | with a listed only pick ${String(withListedOnly)} | with an awarded rival ${String(withAwarded)} | the bound is reached at ${String(onBound)} | the bound is below a legal future at ${String(failures.length)} | mean slack ${(slackTotal / INSTANCES).toFixed(3)}`
    );
    expect(failures).toEqual([]);
    // The instances are not vacuous. Pinned as the run shows. Until the listed only picks joined the draw (two more
    // kinds of rival after the free ones, which moves the seeded stream) these read 14,577 with an awarded rival.
    // THE BOUND IS REACHED AT EVERY INSTANCE since quick task 261010-l0s: it is the exact maximum of what it models.
    // Until then it was reached at 19,693; at the other 307 a rival was counted once on a seat and once more as the
    // winner's backup.
    expect({ withListedOnly, withAwarded, onBound }).toEqual({ withListedOnly: 16_657, withAwarded: 16_641, onBound: INSTANCES });
  }, 120_000);
});

// ===========================================================================
// Quick task 261010-d7r, finding F-D: a listed pick that is not confirmed is
// paid its decided alliance's value or takes another seat, never both
// ===========================================================================

describe("champJointLock: a listed pick that is not confirmed is read at its placed alliance's settled value OR on another seat, never both (261010-d7r, F-D)", () => {
  /** Alliance 1 wins with four members (no fill in). Alliance 2 is paid 75 and has one seat. u is on no alliance. */
  const placedInput = (floor: number, listed: boolean, overrides: Partial<JointLockInput> = {}): JointLockInput =>
    minimalInput({
      pool: [
        { teamKey: "T", floor: 200, extra: 0 },
        // u's `extra` is the 21 a fourth place alliance that lists it would pay it.
        { teamKey: "u", floor, extra: 21, ...(listed ? { listedOnly: { settled: 21, onWinner: false } } : {}) },
      ],
      alliances: [
        { allianceNumber: 1, members: ["x1", "x2", "x3", "x4"] },
        { allianceNumber: 2, members: ["y1", "y2", "y3"] },
      ],
      aliveAlliances: [1, 2],
      candidateWinners: [1],
      frames: [{ winner: 1, enumerated: [], fixed: new Map([[2, 75]]), fillIns: 0 }],
      ...overrides,
    });

  it("a placed alliance's listed pick is counted alone where its floor plus extra reaches T, NOT where it needs both its settled 21 and a 75 seat, and through the seat where the 75 alone reaches T", () => {
    // 180 + 21 reaches T with no seat: it was on that alliance and is paid its 21.
    expect(jointLockBound(placedInput(180, true), "T")).toBe(1);
    expect(jointLockBound(placedInput(180, false), "T")).toBe(1);
    // 110 + 21 + 75 reaches T, and no future pays both: on that alliance it takes no seat (131), off it the 21 is
    // gone (185). Until this rule the bound counted it.
    expect(jointLockBound(placedInput(110, true), "T")).toBe(0);
    expect(jointLockBound(placedInput(110, false), "T")).toBe(1);
    // 130 + 75 reaches T without the 21: it never was on that alliance and takes the seat.
    expect(jointLockBound(placedInput(130, true), "T")).toBe(1);
    // With no seat on offer the 21 is all it can be paid.
    const noSeat = { frames: [{ winner: 1, enumerated: [], fixed: new Map<number, number>(), fillIns: 0 }] };
    expect(jointLockBound(placedInput(130, true, noSeat), "T")).toBe(0);
    expect(jointLockBound(placedInput(179, true, noSeat), "T")).toBe(1);
  });

  it("either reading may still add one judged award: the settled value and an award alone, or a seat and an award, never the settled value, a seat and an award", () => {
    const oneAward = { judgedAwards: 1 };
    // Alone: 165 + 21 + 15 reaches T.
    expect(jointLockBound(placedInput(165, true, { ...oneAward, frames: [{ winner: 1, enumerated: [], fixed: new Map<number, number>(), fillIns: 0 }] }), "T")).toBe(1);
    // On the seat: 115 + 75 + 15 reaches T without the 21.
    expect(jointLockBound(placedInput(115, true, oneAward), "T")).toBe(1);
    // 100 + 21 + 75 + 15 reaches T only with all three, which no future pays.
    expect(jointLockBound(placedInput(100, true, oneAward), "T")).toBe(0);
    expect(jointLockBound(placedInput(100, false, oneAward), "T")).toBe(1);
  });

  it("with the awarded rule: an awarded listed pick is covered on a seat only where the seat's value alone reaches T without the settled value", () => {
    const awarded = { judgedAwards: 1, awardedRivals: ["u"] };
    // 130 + 75 reaches T on the seat; the award it already holds is in its floor.
    expect(jointLockBound(placedInput(130, true, awarded), "T")).toBe(1);
    // 115 + 75 falls short and it takes no further judged award; with the 21 as well it would reach T, which no future pays.
    expect(jointLockBound(placedInput(115, true, awarded), "T")).toBe(0);
    expect(jointLockBound(placedInput(115, false, awarded), "T")).toBe(1);
    // Alone it keeps the 21 and still takes no award: 179 + 21 reaches T, 170 + 21 does not.
    expect(jointLockBound(placedInput(179, true, awarded), "T")).toBe(1);
    expect(jointLockBound(placedInput(170, true, { ...awarded, frames: [{ winner: 1, enumerated: [], fixed: new Map<number, number>(), fillIns: 0 }] }), "T")).toBe(0);
  });

  /** Alliance 1 is the decided winner with `confirmed` members outside the pool. u is its listed pick at 0 points, v is on no alliance. */
  const winnerInput = (confirmed: number, listed: boolean, overrides: Partial<JointLockInput> = {}): JointLockInput =>
    minimalInput({
      pool: [
        { teamKey: "T", floor: 200, extra: 0 },
        // u's `extra` is the 90 the winner would pay it.
        { teamKey: "u", floor: 150, extra: 90, ...(listed ? { listedOnly: { settled: 90, onWinner: true } } : {}) },
        { teamKey: "v", floor: 100, extra: 0 },
      ],
      alliances: [{ allianceNumber: 1, members: ["x1", "x2", "x3", "x4"].slice(0, confirmed), spareSeats: 4 - confirmed }],
      aliveAlliances: [],
      candidateWinners: [1],
      ...overrides,
    });

  it("the decided winner's listed pick is not counted through its settled value: it is the winner's fill in where a seat is spare, or nothing", () => {
    // One spare seat on the winner. Without the rule u is covered at 150 + 90 and v takes the fill in: 2. With it u
    // and v share the one fill in: being on the winner IS that seat.
    expect(jointLockBound(winnerInput(3, false), "T")).toBe(2);
    expect(jointLockBound(winnerInput(3, true), "T")).toBe(1);
    // No spare seat: u was never on the winner and is paid nothing by it.
    expect(jointLockBound(winnerInput(4, false), "T")).toBe(1);
    expect(jointLockBound(winnerInput(4, true), "T")).toBe(0);
    // Two spare seats take both.
    expect(jointLockBound(winnerInput(2, true), "T")).toBe(2);
    // A rival that reaches T without the 90 is counted on its own points whatever the seats.
    const strong = winnerInput(4, true);
    expect(jointLockBound({ ...strong, pool: strong.pool.map((rival) => (rival.teamKey === "u" ? { ...rival, floor: 200 } : rival)) }, "T")).toBe(1);
  });

  it("the winner's reading is applied only where every frame names that one winner: with the posted winner frame, or two candidate winners, the rival is read as with no listedOnly", () => {
    // The posted winner case (a null winner): no fill in is left to count u through, so its 90 stays in every reading.
    const posted = { alliances: [], candidateWinners: [null] as (number | null)[] };
    expect(jointLockBound(winnerInput(3, true, posted), "T")).toBe(jointLockBound(winnerInput(3, false, posted), "T"));
    expect(jointLockBound(winnerInput(3, true, posted), "T")).toBe(1);
    // Two candidate winners: none is decided, so `onWinner` names no alliance the bound can read.
    const two = {
      alliances: [
        { allianceNumber: 1, members: ["x1", "x2", "x3"], spareSeats: 1 },
        { allianceNumber: 2, members: ["y1", "y2", "y3"], spareSeats: 1 },
      ],
      aliveAlliances: [1, 2],
      candidateWinners: [1, 2] as (number | null)[],
    };
    expect(jointLockBound(winnerInput(3, true, two), "T")).toBe(jointLockBound(winnerInput(3, false, two), "T"));
  });

  it("500 seeded random single championship instances, every team: the winner's reading IS the rival without its settled value, a placed alliance's reading never raises a bound and lowers some, and neither reading is above the reading of before the rule", () => {
    // TWO PROPERTIES, one per kind of listed only pick.
    //
    // THE WINNER'S (`onWinner`, one decided winner): the bound equals the bound with that rival handed over WITHOUT
    // the settled value and with no `listedOnly`. That is the rival exactly as it read before the row that decided
    // the winner, which is what makes that row's edge monotone.
    //
    // A PLACED ALLIANCE'S: the bound is never above the bound with the same `extra` and no `listedOnly` (the reading
    // of before this rule), because the rival reads the same alone and no nearer to T on a seat.
    //
    // THE WINNER'S READING IS NEVER ABOVE THE READING OF BEFORE THIS RULE EITHER (quick task 261010-l0s): every role
    // the rival can take without its settled value it could take with it. `raisedByTheWinnerReading` counts the team
    // bounds where it is above, and must be 0. Until that task it read 10 on these instances: a rival that dropped
    // from "its points reach T" to "short of T, on no alliance" joined the winner's fill in pool and was counted
    // there beside a seat that lifted the same rival.
    const random = mulberry32(26101003);
    const integer = (lo: number, hi: number): number => lo + Math.floor(random() * (hi - lo + 1));
    let lower = 0;
    let onWinnerInstances = 0;
    let raisedByTheWinnerReading = 0;
    for (let instance = 0; instance < 500; instance++) {
      const keys = Array.from({ length: integer(8, 16) }, (_, index) => `t${index}`);
      const shuffled = [...keys].sort(() => random() - 0.5);
      const alliances: JointLockAlliance[] = [];
      let cursor = 0;
      for (let allianceNumber = 1; allianceNumber <= 4 && cursor < shuffled.length - 4; allianceNumber++) {
        const size = integer(1, 3);
        alliances.push({ allianceNumber, members: shuffled.slice(cursor, cursor + size), spareSeats: 4 - size });
        cursor += size;
      }
      const unpicked = new Set(shuffled.slice(cursor));
      // One decided winner (alliance 1) in half the instances, else every alliance may still win.
      const decided = random() < 0.5;
      if (decided) onWinnerInstances += 1;
      const numbers = alliances.map((alliance) => alliance.allianceNumber);
      const plain: JointLockRival[] = keys.map((teamKey) => ({ teamKey, floor: integer(50, 150), extra: random() < 0.2 ? integer(1, 30) : 0 }));
      // Some rivals on no alliance are listed picks of a placed alliance: their settled value sits in `extra`.
      const listed: JointLockRival[] = plain.map((rival) => {
        if (!unpicked.has(rival.teamKey) || random() >= 0.5) return rival;
        const onWinner = decided && random() < 0.3;
        const settled = onWinner ? 90 : [21, 39, 75][integer(0, 2)]!;
        return { ...rival, extra: rival.extra + settled, listedOnly: { settled, onWinner } };
      });
      /** The winner's listed picks handed over without the settled value and with no `listedOnly`; every other rival as in `listed`. */
      const winnerAsBefore = listed.map((rival): JointLockRival => (rival.listedOnly?.onWinner === true ? { teamKey: rival.teamKey, floor: rival.floor, extra: rival.extra - rival.listedOnly.settled } : rival));
      /** `winnerAsBefore` with no `listedOnly` on anyone: the placed alliances' picks read at `extra` alone and on a seat. */
      const placedAsBefore = winnerAsBefore.map((rival): JointLockRival => ({ teamKey: rival.teamKey, floor: rival.floor, extra: rival.extra }));
      /** Nobody carries a `listedOnly` and every settled value stays in `extra`: the reading of before this rule. */
      const noRule = listed.map((rival): JointLockRival => ({ teamKey: rival.teamKey, floor: rival.floor, extra: rival.extra }));
      const base: Omit<JointLockInput, "pool"> = {
        slotOnlyRivals: [],
        pointsSlots: 4,
        alliances,
        aliveAlliances: decided ? numbers.slice(1) : numbers,
        candidateWinners: decided ? [1] : numbers,
        placementPoints: [75, 39, 21],
        consumingAwards: integer(0, 2),
        judgedAwards: integer(0, 3),
        judgedAwardPoints: JUDGED,
        maxAllianceSize: 4,
      };
      const awardedRivals = keys.filter(() => random() < 0.2);
      for (const rival of listed) {
        const withRule = jointLockBound({ ...base, pool: listed, awardedRivals }, rival.teamKey);
        expect(withRule, `instance ${instance} ${rival.teamKey}: the winner's reading`).toBe(jointLockBound({ ...base, pool: winnerAsBefore, awardedRivals }, rival.teamKey));
        const placedBefore = jointLockBound({ ...base, pool: placedAsBefore, awardedRivals }, rival.teamKey);
        expect(withRule, `instance ${instance} ${rival.teamKey}: a placed alliance's reading`).toBeLessThanOrEqual(placedBefore);
        if (withRule < placedBefore) lower += 1;
        if (withRule > jointLockBound({ ...base, pool: noRule, awardedRivals }, rival.teamKey)) raisedByTheWinnerReading += 1;
      }
    }
    expect(onWinnerInstances).toBeGreaterThan(100);
    // The placed alliance's reading is not vacuous on these instances: it lowers some bounds.
    expect(lower).toBeGreaterThan(0);
    // A requirement since quick task 261010-l0s. It read 10 until then.
    expect(raisedByTheWinnerReading).toBe(0);
  }, 60_000);

  it("with seat deficits: the matching equals the exact dynamic program on 20,000 seeded instances of one seat group, and a larger deficit on a seat never raises the cover", () => {
    const random = mulberry32(26101004);
    const integer = (lo: number, hi: number): number => lo + Math.floor(random() * (hi - lo + 1));
    const valuePalette = [120, 90, 75, 60, 45, 39, 30, 21];
    let withSeatDeficits = 0;
    let lowered = 0;
    for (let instance = 0; instance < 20_000; instance++) {
      const deficits = Array.from({ length: integer(1, 9) }, () => integer(1, 140));
      const awarded = deficits.map(() => random() < 0.25);
      // A listed only pick is further from T on a seat by its settled value.
      const seatDeficits = deficits.map((deficit) => (random() < 0.35 ? deficit + [21, 39, 75][integer(0, 2)]! : deficit));
      const types = [...valuePalette].sort(() => random() - 0.5).slice(0, integer(0, 3)).sort((a, b) => b - a);
      const counts = types.map(() => integer(1, 3));
      const budget = integer(0, 5);
      const exact = referenceCover(deficits, types, counts, budget, JUDGED, { awarded, seatDeficits });
      const matched = matchingOfOneGroup(deficits, types, counts, budget, { awarded, seatDeficits });
      const sameOnASeat = matchingOfOneGroup(deficits, types, counts, budget, { awarded });
      if (seatDeficits.some((deficit, index) => deficit !== deficits[index])) withSeatDeficits += 1;
      const where = `instance ${instance}: ${JSON.stringify({ deficits, seatDeficits, awarded, types, counts, budget })}`;
      expect(matched, where).toEqual(exact);
      for (let j = 0; j <= budget; j++) {
        expect(matched[j]!, where).toBeLessThanOrEqual(sameOnASeat[j]!);
        if (matched[j]! < sameOnASeat[j]!) lowered += 1;
      }
      // Seat deficits equal to the deficits are the matching without them, cell for cell.
      expect(matchingOfOneGroup(deficits, types, counts, budget, { awarded, seatDeficits: [...deficits] })).toEqual(sameOnASeat);
    }
    expect(withSeatDeficits).toBeGreaterThan(15_000);
    expect(lowered).toBeGreaterThan(0);
  }, 120_000);
});

describe("champJointLock: when the proof stops (261010-d7r, findings F-B and F-C)", () => {
  it("jointProofStillRuns: true while the championship's own Awards are open, true while another key's are, false only once every key's Awards are final", () => {
    // Its own Awards open: it runs whatever the other keys read.
    expect(jointProofStillRuns(false, false)).toBe(true);
    expect(jointProofStillRuns(false, true)).toBe(true);
    // Its own Awards final while another key's are open: it still runs (a division's flag after the finals', or
    // one championship of two finished before the other).
    expect(jointProofStillRuns(true, true)).toBe(true);
    // Every key's Awards final: it stops.
    expect(jointProofStillRuns(true, false)).toBe(false);
  });
});

// ===========================================================================
// Every rival is counted once (quick task 261010-l0s)
// ===========================================================================

/**
 * SEEDED INSTANCES OF THE THREE CHAMPIONSHIP SHAPES, built for one purpose:
 * rivals sit close to each other in points, so one team's floor rising
 * passes others, and every way one rival could be counted twice is in the
 * draw (a free rival the winner can also call up, a rival no seat group
 * names, a listed pick that is not confirmed on an alliance still in its
 * bracket, slot only rivals, awarded rivals, listed only picks).
 */
type OnceShape = "single" | "divisioned" | "multiple";
interface OnceInstance {
  readonly shape: OnceShape;
  /** One input, or the two championships' inputs. */
  readonly inputs: JointLockInput[];
  /** Every pool team, across the inputs. */
  readonly teams: string[];
  /** The teams a transition may post a judged award to (never a listed only pick). */
  readonly postable: string[];
}

function onceFloor(random: () => number): number {
  const draw = random();
  if (draw < 0.7) return 170 + Math.floor(random() * 61);
  if (draw < 0.9) return 100 + Math.floor(random() * 70);
  return 231 + Math.floor(random() * 40);
}

/** A single championship: no seat group, the module builds the frames. `prefix` keeps the keys of two championships apart. */
function onceSingleInput(random: () => number, prefix: string): { input: JointLockInput; postable: string[] } {
  const pick = (count: number): number => Math.floor(random() * count);
  const allianceCount = 2 + pick(4);
  const pool: JointLockRival[] = [];
  const alliances: JointLockAlliance[] = [];
  const postable: string[] = [];
  const awarded: string[] = [];
  const mode = pick(6); // 0 to 3 an open bracket, 4 a decided winner, 5 a posted winner
  const numbers = Array.from({ length: allianceCount }, (_, index) => index + 1);
  let alive: number[];
  let candidates: (number | null)[];
  if (mode <= 3) {
    alive = numbers.filter(() => random() < 0.7);
    if (alive.length === 0) alive = [numbers[pick(allianceCount)]!];
    candidates = alive.filter(() => random() < 0.6);
    if (candidates.length === 0) candidates = [alive[pick(alive.length)]!];
  } else if (mode === 4) {
    const winner = numbers[pick(allianceCount)]!;
    alive = numbers.filter((allianceNumber) => allianceNumber !== winner && random() < 0.3);
    candidates = [winner];
  } else {
    alive = [];
    candidates = [null];
  }
  const placedValue = new Map<number, number>();
  for (const allianceNumber of numbers) {
    const members: string[] = [];
    const count = 1 + pick(3);
    for (let index = 0; index < count; index++) {
      const teamKey = `${prefix}a${String(allianceNumber)}m${String(index)}`;
      members.push(teamKey);
      pool.push({ teamKey, floor: onceFloor(random) - (random() < 0.5 ? 40 : 0), extra: pick(3) === 0 ? pick(25) : 0 });
      postable.push(teamKey);
      if (random() < 0.25) awarded.push(teamKey);
    }
    alliances.push({ allianceNumber, members, spareSeats: Math.min(4 - count, pick(3)) });
    if (!alive.includes(allianceNumber) && !candidates.includes(allianceNumber)) placedValue.set(allianceNumber, [75, 39, 21, 21][pick(4)]!);
  }
  const free = 1 + pick(6);
  for (let index = 0; index < free; index++) {
    const teamKey = `${prefix}f${String(index)}`;
    pool.push({ teamKey, floor: onceFloor(random), extra: pick(3) === 0 ? pick(25) : 0 });
    postable.push(teamKey);
    if (random() < 0.25) awarded.push(teamKey);
  }
  // Listed only picks (F-D): of a placed alliance, and of the decided winner.
  const placed = [...placedValue.keys()];
  if (placed.length > 0 && random() < 0.35) {
    const settled = placedValue.get(placed[pick(placed.length)]!)!;
    pool.push({ teamKey: `${prefix}lp`, floor: onceFloor(random) - 30, extra: pick(10) + settled, listedOnly: { settled, onWinner: false } });
  }
  if (mode === 4 && random() < 0.35) pool.push({ teamKey: `${prefix}lw`, floor: onceFloor(random) - 30, extra: pick(10) + 90, listedOnly: { settled: 90, onWinner: true } });
  const slotOnlyRivals = random() < 0.3 ? [`${prefix}so0`, ...(random() < 0.3 ? [`${prefix}so1`] : [])] : [];
  const judgedAwards = pick(5);
  const input: JointLockInput = {
    pool,
    slotOnlyRivals,
    pointsSlots: 99,
    alliances,
    aliveAlliances: alive,
    candidateWinners: candidates,
    placementPoints: [75, 39, 21],
    consumingAwards: pick(3),
    judgedAwards,
    judgedAwardPoints: JUDGED,
    maxAllianceSize: 4,
    ...(awarded.length > 0 && random() < 0.6 ? { awardedRivals: awarded } : {}),
  };
  return { input, postable };
}

/** A divisioned championship: one frame per candidate winner, one seat group per division, listed picks (P3) and rivals no group names (P4). */
function onceDivisionedInput(random: () => number): { input: JointLockInput; postable: string[] } {
  const pick = (count: number): number => Math.floor(random() * count);
  const groupCount = random() < 0.75 ? 2 : random() < 0.5 ? 3 : 4;
  const pool: JointLockRival[] = [];
  const alliances: JointLockAlliance[] = [];
  const postable: string[] = [];
  const awarded: string[] = [];
  const groups: { alliances: number[]; eligible: string[]; alive: number[]; decided: number | undefined }[] = [];
  const spare = new Map<number, number>();
  const addRival = (teamKey: string, floor: number, extra = 0): void => {
    pool.push({ teamKey, floor, extra });
    postable.push(teamKey);
    if (random() < 0.25) awarded.push(teamKey);
  };
  for (let group = 0; group < groupCount; group++) {
    const allianceCount = 2 + pick(2);
    const ids = Array.from({ length: allianceCount }, (_, index) => (group + 1) * 10 + index + 1);
    const eligible: string[] = [];
    const decided = random() < 0.3; // the division is decided: one winner, nobody alive
    const alive = decided ? [] : ids.filter(() => random() < 0.75);
    if (!decided && alive.length === 0) alive.push(ids[0]!);
    for (const id of ids) {
      const members: string[] = [];
      const count = 1 + pick(3);
      for (let index = 0; index < count; index++) {
        const teamKey = `d${String(group)}a${String(id)}m${String(index)}`;
        members.push(teamKey);
        addRival(teamKey, onceFloor(random) - (random() < 0.6 ? 60 : 0), pick(4) === 0 ? pick(20) : 0);
      }
      // Reading P3: a listed pick that is not confirmed, on an alliance still in its bracket: a member AND named by the group.
      if (alive.includes(id) && random() < 0.3) {
        const teamKey = `d${String(group)}a${String(id)}L`;
        members.push(teamKey);
        eligible.push(teamKey);
        addRival(teamKey, onceFloor(random) - (random() < 0.5 ? 40 : 0));
      }
      spare.set(id, Math.min(4 - count, pick(3)));
      alliances.push({ allianceNumber: id, members, spareSeats: spare.get(id)! });
    }
    const free = pick(5);
    for (let index = 0; index < free; index++) {
      const teamKey = `d${String(group)}f${String(index)}`;
      eligible.push(teamKey);
      addRival(teamKey, onceFloor(random), pick(3) === 0 ? pick(25) : 0);
    }
    groups.push({ alliances: ids, eligible, alive, decided: decided ? ids[pick(allianceCount)]! : undefined });
  }
  // Reading P4: rivals on no alliance that no group names.
  const unnamed = pick(4);
  for (let index = 0; index < unnamed; index++) addRival(`u${String(index)}`, onceFloor(random) - (random() < 0.5 ? 70 : 0));
  const slotOnlyRivals: string[] = [];
  if (random() < 0.3) {
    slotOnlyRivals.push("so0");
    if (random() < 0.6) groups[pick(groupCount)]!.eligible.push("so0");
  }
  // The frames as `divisionedJointFrames` builds them, by hand: the other divisions' alive alliances fixed at the
  // division champion's 90 plus the finalist's value, a decided winner of another division at the finalist's value.
  const finalist = groupCount === 2 ? 0 : 30;
  const posted = random() < 0.08 && groups.every((group) => group.decided !== undefined);
  const candidates: (number | null)[] = [];
  if (posted) candidates.push(null);
  else for (const group of groups) candidates.push(...(group.decided !== undefined ? [group.decided] : group.alive));
  const frames: JointLockFrame[] = candidates.map((winner) => {
    const fixed = new Map<number, number>();
    let enumerated: number[] = [];
    for (const group of groups) {
      if (winner !== null && group.alliances.includes(winner)) {
        enumerated = group.alive.filter((id) => id !== winner);
        continue;
      }
      for (const id of group.alive) fixed.set(id, 90 + finalist);
      if (group.decided !== undefined && finalist > 0) fixed.set(group.decided, finalist);
    }
    return { winner, enumerated, fixed, fillIns: winner === null ? 0 : spare.get(winner)! };
  });
  const seatGroups: JointLockSeatGroup[] = groups.map((group) => ({ alliances: group.alliances, eligible: group.eligible }));
  const input: JointLockInput = {
    pool,
    slotOnlyRivals,
    pointsSlots: 99,
    alliances,
    aliveAlliances: groups.flatMap((group) => group.alive),
    candidateWinners: candidates,
    placementPoints: [75, 39, 21],
    consumingAwards: pick(3),
    judgedAwards: pick(6),
    judgedAwardPoints: JUDGED,
    maxAllianceSize: 4,
    frames,
    seatGroups,
    ...(awarded.length > 0 && random() < 0.6 ? { awardedRivals: awarded } : {}),
  };
  return { input, postable };
}

function onceInstance(seed: number, shape: OnceShape): OnceInstance {
  const random = mulberry32(seed);
  if (shape !== "multiple") {
    const { input, postable } = shape === "single" ? onceSingleInput(random, "") : onceDivisionedInput(random);
    return { shape, inputs: [input], teams: input.pool.map((rival) => rival.teamKey), postable };
  }
  const first = onceSingleInput(random, "x");
  const second = onceSingleInput(random, "y");
  // Reading R9: a rival with no championship row is entered in every championship's pool at the same floor.
  const noRow: JointLockRival[] = Array.from({ length: Math.floor(random() * 3) }, (_, index) => ({ teamKey: `nr${String(index)}`, floor: onceFloor(random) - 30, extra: 0 }));
  const inputs = [first.input, second.input].map((input) => ({ ...input, pool: [...input.pool, ...noRow] }));
  return {
    shape,
    inputs,
    teams: [...first.input.pool, ...second.input.pool, ...noRow].map((rival) => rival.teamKey),
    postable: [...first.postable, ...second.postable, ...noRow.map((rival) => rival.teamKey)],
  };
}

const ONCE_SHAPES: readonly OnceShape[] = ["single", "divisioned", "multiple"];
const onceSeed = (index: number, shape: OnceShape): number => index * 3 + ONCE_SHAPES.indexOf(shape);
const onceBound = (instance: OnceInstance, inputs: readonly JointLockInput[], teamKey: string): number =>
  instance.shape === "multiple" ? jointLockBoundMultiple(inputs, teamKey) : jointLockBound(inputs[0]!, teamKey);

/**
 * THE ALLOCATION MODEL ENUMERATED, sharing no code with the module: for one
 * team T, every usable frame, every ordered placement assignment, and every
 * way to hand each rival still short of T ONE role: nothing; one judged
 * award on top of what it has (its floor plus extra, and for a listed pick
 * the value of the alliance that lists it); a seat of one ALLIANCE of a seat
 * group it is eligible in, with or without one judged award; the winner's
 * fill in; a consuming award. Seats are counted per alliance here, never
 * merged by value. `undefined` where a scenario leaves more rivals short of
 * T than `mostActors`, which the enumeration does not attempt.
 */
function modelMostTakers(input: JointLockInput, teamKey: string, mostActors: number): number | undefined {
  const m = input.pool.find((rival) => rival.teamKey === teamKey)!.floor;
  const allianceOf = new Map<string, number>();
  for (const alliance of input.alliances) for (const member of alliance.members) if (!allianceOf.has(member)) allianceOf.set(member, alliance.allianceNumber);
  const membersOf = (allianceNumber: number): readonly string[] => input.alliances.find((alliance) => alliance.allianceNumber === allianceNumber)?.members ?? [];
  const spareOf = new Map(input.alliances.map((alliance) => [alliance.allianceNumber, Math.max(0, alliance.spareSeats ?? input.maxAllianceSize - alliance.members.length)] as const));
  const groups = input.seatGroups !== undefined && input.seatGroups.length > 0 ? input.seatGroups : undefined;
  const groupCount = groups === undefined ? 1 : groups.length;
  const groupOfAlliance = (allianceNumber: number): number | undefined => {
    if (groups === undefined) return 0;
    const at = groups.findIndex((group) => group.alliances.includes(allianceNumber));
    return at === -1 ? undefined : at;
  };
  const groupsOfKey = (key: string): number[] => {
    const named = groups === undefined ? [] : groups.map((group, index) => (group.eligible.includes(key) ? index : -1)).filter((index) => index !== -1);
    if (named.length > 0) return named;
    return allianceOf.has(key) ? [] : Array.from({ length: groupCount }, (_, index) => index);
  };
  const frames = input.frames ?? singleChampionshipFrames(input);
  if (frames.length === 0) return Infinity;
  const tIsNamed = groups !== undefined && groups.some((group) => group.eligible.includes(teamKey));
  const usable = frames.filter((frame) => frame.winner === null || !membersOf(frame.winner).includes(teamKey) || tIsNamed);
  if (usable.length === 0) return 0;
  const rivals = input.pool.filter((rival) => rival.teamKey !== teamKey);
  const rivalKeys = new Set(rivals.map((rival) => rival.teamKey));
  const slotOnly = [...new Set(input.slotOnlyRivals)].filter((key) => key !== teamKey && !rivalKeys.has(key));
  const awarded = new Set(input.awardedRivals ?? []);
  const oneNamedWinner = frames.every((frame) => frame.winner !== null && frame.winner === frames[0]!.winner);
  const withoutSettled = (rival: JointLockRival): number => rival.floor + Math.max(0, rival.extra - rival.listedOnly!.settled);
  const alonePoints = (rival: JointLockRival): number => (rival.listedOnly?.onWinner === true && oneNamedWinner ? withoutSettled(rival) : rival.floor + rival.extra);
  const seatPoints = (rival: JointLockRival): number => (rival.listedOnly === undefined || (rival.listedOnly.onWinner && !oneNamedWinner) ? rival.floor + rival.extra : withoutSettled(rival));
  const orderedChoices = (items: readonly number[], count: number): number[][] => {
    if (count === 0) return [[]];
    return items.flatMap((item, index) => orderedChoices([...items.slice(0, index), ...items.slice(index + 1)], count - 1).map((tail) => [item, ...tail]));
  };
  const placement = [...input.placementPoints].sort((a, b) => b - a);
  interface Role {
    readonly seat?: number;
    readonly award: boolean;
    readonly fill?: boolean;
    readonly consuming?: boolean;
  }
  let best = -Infinity;
  for (const frame of usable) {
    const { winner } = frame;
    const winnerMembers = new Set(winner === null ? [] : membersOf(winner));
    const others = frame.enumerated.filter((allianceNumber) => allianceNumber !== winner && !frame.fixed.has(allianceNumber));
    const winnerGroup = winner === null ? undefined : groupOfAlliance(winner);
    const fillIns = winner === null || winnerGroup === undefined ? 0 : Math.max(0, frame.fillIns);
    let withTheWinner = 0;
    for (const member of winnerMembers) if (member !== teamKey && (rivalKeys.has(member) || slotOnly.includes(member))) withTheWinner += 1;
    for (const selection of orderedChoices(others, Math.min(placement.length, others.length))) {
      const assigned = new Map<number, number>(frame.fixed);
      selection.forEach((allianceNumber, index) => assigned.set(allianceNumber, placement[index]!));
      let covered = withTheWinner;
      const actors: Role[][] = [];
      for (const rival of rivals) {
        if (winnerMembers.has(rival.teamKey)) continue;
        const listedOn = allianceOf.get(rival.teamKey);
        const asItStands = alonePoints(rival) + (listedOn === undefined ? 0 : (assigned.get(listedOn) ?? 0));
        if (asItStands >= m) {
          covered += 1;
          continue;
        }
        const roles: Role[] = [];
        const isAwarded = awarded.has(rival.teamKey);
        if (!isAwarded && asItStands + JUDGED >= m) roles.push({ award: true });
        const eligible = groupsOfKey(rival.teamKey);
        for (const [allianceNumber, value] of assigned) {
          const group = groupOfAlliance(allianceNumber);
          if (group === undefined || value <= 0 || (spareOf.get(allianceNumber) ?? 0) <= 0 || !eligible.includes(group)) continue;
          if (seatPoints(rival) + value >= m) roles.push({ seat: allianceNumber, award: false });
          else if (!isAwarded && seatPoints(rival) + value + JUDGED >= m) roles.push({ seat: allianceNumber, award: true });
        }
        if (fillIns > 0 && eligible.includes(winnerGroup!)) roles.push({ fill: true, award: false });
        roles.push({ consuming: true, award: false });
        actors.push(roles);
      }
      for (const key of slotOnly) {
        if (winnerMembers.has(key)) continue;
        const roles: Role[] = [];
        if (fillIns > 0 && groupsOfKey(key).includes(winnerGroup!)) roles.push({ fill: true, award: false });
        roles.push({ consuming: true, award: false });
        actors.push(roles);
      }
      if (actors.length > mostActors) return undefined;
      const seatsUsed = new Map<number, number>();
      let most = 0;
      const visit = (at: number, count: number, judged: number, fills: number, consumed: number): void => {
        if (count + (actors.length - at) <= most) return;
        if (at === actors.length) {
          most = count;
          return;
        }
        visit(at + 1, count, judged, fills, consumed);
        for (const role of actors[at]!) {
          if (role.award && judged >= input.judgedAwards) continue;
          if (role.fill === true && fills >= fillIns) continue;
          if (role.consuming === true && consumed >= input.consumingAwards) continue;
          if (role.seat !== undefined) {
            if ((seatsUsed.get(role.seat) ?? 0) >= spareOf.get(role.seat)!) continue;
            seatsUsed.set(role.seat, (seatsUsed.get(role.seat) ?? 0) + 1);
          }
          visit(at + 1, count + 1, judged + (role.award ? 1 : 0), fills + (role.fill === true ? 1 : 0), consumed + (role.consuming === true ? 1 : 0));
          if (role.seat !== undefined) seatsUsed.set(role.seat, seatsUsed.get(role.seat)! - 1);
        }
      };
      visit(0, 0, 0, 0, 0);
      best = Math.max(best, covered + most);
    }
  }
  return best;
}

describe("champJointLock: the matching, one resource per entity (261010-l0s)", () => {
  it("coverMatching equals every assignment enumerated, for every judged budget, on 20,000 seeded cost tables", () => {
    const random = mulberry32(261010);
    const integer = (lo: number, hi: number): number => lo + Math.floor(random() * (hi - lo + 1));
    let cells = 0;
    for (let instance = 0; instance < 20_000; instance++) {
      const entityCount = integer(1, 6);
      const resourceCount = integer(1, 4);
      const capacities = Array.from({ length: resourceCount }, () => integer(0, 3));
      const rows = Array.from({ length: entityCount }, () =>
        Array.from({ length: resourceCount }, () => {
          const draw = random();
          return draw < 0.4 ? Infinity : draw < 0.7 ? 0 : 1;
        })
      );
      const budget = integer(0, 4);
      const enumerated = new Array<number>(budget + 1).fill(0);
      const used = new Array<number>(resourceCount).fill(0);
      const visit = (at: number, count: number, cost: number): void => {
        if (cost > budget) return;
        if (at === entityCount) {
          for (let j = cost; j <= budget; j++) if (count > enumerated[j]!) enumerated[j] = count;
          return;
        }
        visit(at + 1, count, cost);
        for (let resource = 0; resource < resourceCount; resource++) {
          const price = rows[at]![resource]!;
          if (price === Infinity || used[resource]! >= capacities[resource]!) continue;
          used[resource]! += 1;
          visit(at + 1, count + 1, cost + price);
          used[resource]! -= 1;
        }
      };
      visit(0, 0, 0);
      expect(coverMatching(rows, capacities, budget), `instance ${String(instance)}: ${JSON.stringify({ rows: rows.map((row) => row.map((price) => (price === Infinity ? "no" : price))), capacities, budget })}`).toEqual(enumerated);
      cells += budget + 1;
    }
    expect(cells).toBe(60_288);
  }, 60_000);

  it("a hundred entities with one row are one type: the answer does not depend on how many share a row", () => {
    // Two seats that cover as they stand, a third kind of seat that needs a judged award, and one judged award alone.
    const row = [0, 1, 1];
    const rows = Array.from({ length: 100 }, () => row);
    expect(coverMatching(rows, [2, 3, 100], 0)).toEqual([2]);
    expect(coverMatching(rows, [2, 3, 100], 4)).toEqual([2, 3, 4, 5, 6]);
    expect(coverMatching([], [2, 3, 100], 2)).toEqual([0, 0, 0]);
    // The same ARRAY handed again takes the shortcut, a copy of it walks the rows: both are the one type.
    const other = [1, Infinity, 1];
    const closed = [Infinity, Infinity, Infinity];
    expect(coverMatching([row, row, closed, closed, other, row, other], [1, 1, 100], 3)).toEqual(coverMatching([[...row], [...row], [...closed], [...closed], [...other], [...row], [...other]], [1, 1, 100], 3));
    expect(coverMatching([row, row, closed, closed, other, row, other], [1, 1, 100], 3)).toEqual([1, 2, 3, 4]);
  });

  it("a resource with no room is closed to everyone, and a cost that is not 0, 1 or Infinity is refused", () => {
    // The free seat has no room: the entity is covered only once a judged award is in hand.
    expect(coverMatching([[0, 1]], [0, 1], 1)).toEqual([0, 1]);
    // An entity whose every open resource has no room is no entity at all.
    expect(coverMatching([[0, Infinity]], [0, 5], 3)).toEqual([0, 0, 0, 0]);
    expect(() => coverMatching([[2]], [1], 2)).toThrow(/not 0, 1 or Infinity/);
  });

  it("a cheaper cover is found by moving an entity off a seat: one seat fits A as it stands and B with an award, and A alone can take an award", () => {
    // A: the seat free, or one award alone. B: the seat with an award only. Two awards cover both (B on the seat with one, A alone with the other).
    expect(coverMatching([[0, 1], [1, Infinity]], [1, 2], 2)).toEqual([1, 1, 2]);
  });
});

describe("champJointLock: every rival is counted once (261010-l0s)", () => {
  /** T and what the hand built instances share. */
  const onceInput = (overrides: Partial<JointLockInput> & Pick<JointLockInput, "pool" | "alliances">): JointLockInput => minimalInput({ pointsSlots: 99, ...overrides });

  it("the winner's fill in beside a seat (warning W1 of quick task 261010-d7r): T passes a free rival, which then counts once, not once on a seat and once as the winner's backup", () => {
    // w is the one candidate winner's member, with two spare seats. Alliance 2 is paid 75 and has one spare seat; its
    // members p1 and p2 are far below T. f is free and five points ahead of T, then ten short once T gains fifteen.
    const at = (floor: number): JointLockInput =>
      onceInput({
        pool: [
          { teamKey: "T", floor, extra: 0 },
          { teamKey: "w", floor: 66, extra: 0 },
          { teamKey: "p1", floor: 100, extra: 0 },
          { teamKey: "p2", floor: 90, extra: 0 },
          { teamKey: "f", floor: 238, extra: 0 },
        ],
        alliances: [
          { allianceNumber: 1, members: ["w"], spareSeats: 2 },
          { allianceNumber: 2, members: ["p1", "p2"], spareSeats: 1 },
        ],
        aliveAlliances: [1, 2],
        candidateWinners: [1],
      });
    // Before: w with the winner, f ahead by its floor. After: w, and f on alliance 2's seat OR as w's backup.
    expect(jointLockBound(at(233), "T")).toBe(2);
    expect(jointLockBound(at(248), "T")).toBe(2);
  });

  it("a cap on the distinct rivals is not enough, the matching is: one free rival a seat can lift, two picked rivals one judged award short, one award to give", () => {
    // The planner's smallest instance against the cap of CONTEXT D1: with T at 200 the three rivals R1, p1 and p2 are
    // three DISTINCT rivals the scenario can reach, so a cap on distinct rivals lets the old count of 4 stand (w, R1
    // on the seat, one of p1 and p2 with the award, and R1 AGAIN as w's backup). No allocation covers more than 3.
    const at = (floor: number): JointLockInput =>
      onceInput({
        pool: [
          { teamKey: "T", floor, extra: 0 },
          { teamKey: "w", floor: 50, extra: 0 },
          { teamKey: "p1", floor: 115, extra: 0 },
          { teamKey: "p2", floor: 116, extra: 0 },
          { teamKey: "R1", floor: 199, extra: 0 },
        ],
        alliances: [
          { allianceNumber: 1, members: ["w"], spareSeats: 1 },
          { allianceNumber: 2, members: ["p1", "p2"], spareSeats: 1 },
        ],
        aliveAlliances: [1, 2],
        candidateWinners: [1],
        judgedAwards: 1,
      });
    expect(jointLockBound(at(199), "T")).toBe(3);
    expect(jointLockBound(at(200), "T")).toBe(3);
    expect(modelMostTakers(at(200), "T", 8)).toBe(3);
  });

  it("reading P4: a rival no seat group names is ONE rival, lifted by one division's seat or the other's, or called up by the champion, never more than once", () => {
    // Two divisions. Alliance 11 may win everything (two spare seats); alliance 21 is fixed at 90 with one spare seat.
    // u is on no alliance and no group names it. Ahead of T at first; two points short once T gains fourteen.
    const at = (floor: number): JointLockInput =>
      onceInput({
        pool: [
          { teamKey: "T", floor, extra: 0 },
          { teamKey: "a", floor: 149, extra: 0 },
          { teamKey: "b", floor: 60, extra: 0 },
          { teamKey: "u", floor: 202, extra: 0 },
        ],
        alliances: [
          { allianceNumber: 11, members: ["a"], spareSeats: 2 },
          { allianceNumber: 21, members: ["T", "b"], spareSeats: 1 },
        ],
        aliveAlliances: [21],
        candidateWinners: [11],
        judgedAwards: 1,
        frames: [{ winner: 11, enumerated: [], fixed: new Map([[21, 90]]), fillIns: 2 }],
        seatGroups: [
          { alliances: [11], eligible: [] },
          { alliances: [21], eligible: [] },
        ],
      });
    // a with the champion; b at 60 plus 90 stays short of T; u counts once on both sides.
    expect(jointLockBound(at(190), "T")).toBe(2);
    expect(jointLockBound(at(204), "T")).toBe(2);
  });

  it("reading P3: a listed pick that is not confirmed, on an alliance still in its bracket, is read as a member at that alliance's value OR on another seat of its division, never both", () => {
    // Division 2: alliance 21 (fixed at 120) lists L beside its confirmed pick c; alliance 22 (fixed at 120) has one
    // spare seat and nobody else to give it to. L is 116 short of T alone. As a member of 21 it reaches T. The old
    // count read it there AND on 22's seat.
    const input = onceInput({
      pool: [
        { teamKey: "T", floor: 259, extra: 0 },
        { teamKey: "w", floor: 100, extra: 0 },
        { teamKey: "c", floor: 60, extra: 0 },
        { teamKey: "d", floor: 60, extra: 0 },
        { teamKey: "L", floor: 143, extra: 0 },
      ],
      alliances: [
        { allianceNumber: 11, members: ["w"], spareSeats: 0 },
        { allianceNumber: 21, members: ["c", "L"], spareSeats: 1 },
        { allianceNumber: 22, members: ["d"], spareSeats: 1 },
      ],
      aliveAlliances: [21, 22],
      candidateWinners: [11],
      frames: [{ winner: 11, enumerated: [], fixed: new Map([[21, 120], [22, 120]]), fillIns: 0 }],
      seatGroups: [
        { alliances: [11], eligible: [] },
        { alliances: [21, 22], eligible: ["L"] },
      ],
    });
    // w with the champion, L once. c and d at 60 plus 120 stay short.
    expect(jointLockBound(input, "T")).toBe(2);
    expect(modelMostTakers(input, "T", 8)).toBe(2);
    // Read as never on 21 it still counts through 22's seat: with 21 paid nothing, L on 22's seat reaches T.
    const without21 = { ...input, frames: [{ winner: 11, enumerated: [], fixed: new Map([[22, 120]]), fillIns: 0 }] };
    expect(jointLockBound(without21, "T")).toBe(2);
  });

  it("the bound EQUALS the exhaustive maximum of the allocation model on small seeded instances of the single and the divisioned shape, every team", () => {
    const tally = { single: { checked: 0, tooLarge: 0 }, divisioned: { checked: 0, tooLarge: 0 } };
    for (const shape of ["single", "divisioned"] as const) {
      for (let index = 1; index <= 1500; index++) {
        const instance = onceInstance(onceSeed(index, shape), shape);
        const input = instance.inputs[0]!;
        for (const teamKey of instance.teams) {
          const most = modelMostTakers(input, teamKey, 7);
          if (most === undefined) {
            tally[shape].tooLarge += 1;
            continue;
          }
          tally[shape].checked += 1;
          // Never below is SOUNDNESS against the model; never above is that no rival is counted twice.
          expect(jointLockBound(input, teamKey), `${shape} seed ${String(onceSeed(index, shape))} ${teamKey}`).toBe(most);
        }
      }
    }
    console.log(`[261010-l0s the model enumerated] single: teams ${String(tally.single.checked)}, left out as too large ${String(tally.single.tooLarge)} | divisioned: teams ${String(tally.divisioned.checked)}, left out ${String(tally.divisioned.tooLarge)}`);
    // Pinned as the run shows.
    expect(tally).toEqual({ single: { checked: 13_899, tooLarge: 2_378 }, divisioned: { checked: 17_628, tooLarge: 10_913 } });
  }, 120_000);

  it("the proof of before the matching, kept whole in this file as an oracle, is never BELOW the bound on seeded instances of every shape, every team: the rewrite loosened nothing, and the bound is lower where a rival had been counted twice", () => {
    const tally: Record<OnceShape, { compared: number; lower: number; largestDrop: number }> = {
      single: { compared: 0, lower: 0, largestDrop: 0 },
      divisioned: { compared: 0, lower: 0, largestDrop: 0 },
      multiple: { compared: 0, lower: 0, largestDrop: 0 },
    };
    const above: string[] = [];
    for (const shape of ONCE_SHAPES) {
      for (let index = 1; index <= 1500; index++) {
        const seed = onceSeed(index, shape);
        const instance = onceInstance(seed, shape);
        for (const teamKey of instance.teams) {
          const now = onceBound(instance, instance.inputs, teamKey);
          const was = boundBeforeTheMatchingOver(instance.inputs, teamKey);
          tally[shape].compared += 1;
          if (now > was && above.length < 6) above.push(`${shape} seed ${String(seed)} ${teamKey}: ${String(now)} against the oracle's ${String(was)}`);
          if (now < was) {
            tally[shape].lower += 1;
            tally[shape].largestDrop = Math.max(tally[shape].largestDrop, was - now);
          }
        }
      }
    }
    console.log(`[261010-l0s against the proof of before the matching] ${ONCE_SHAPES.map((shape) => `${shape}: ${String(tally[shape].compared)} compared, ${String(tally[shape].lower)} lower, by up to ${String(tally[shape].largestDrop)}`).join(" | ")}`);
    // THE REQUIREMENT. A bound ABOVE the oracle is a LOOSENED proof: a finding, never a pin to move.
    expect(above).toEqual([]);
    // Not vacuous: the oracle is strictly above the bound somewhere in every shape, which is the defect that task
    // closed. Pinned as the run shows.
    expect(tally).toEqual({
      single: { compared: 16_277, lower: 714, largestDrop: 2 },
      divisioned: { compared: 28_541, lower: 6_722, largestDrop: 6 },
      multiple: { compared: 33_913, lower: 2_346, largestDrop: 3 },
    });
  }, 300_000);

  /**
   * THE TWO PROPERTIES (CONTEXT D2 of the quick task), each an exact zero.
   *
   * (a) ANOTHER TEAM'S POSTING NEVER RAISES A BOUND. A legal posting: a team
   *     that holds no posted award yet, in a championship that still has a
   *     judged award to give, has 1 to 15 points added to its floor, is
   *     named in `awardedRivals`, and that championship's judged budget
   *     drops by one. Every OTHER team's bound is compared.
   * (b) A TEAM'S OWN FLOOR RISING NEVER RAISES ITS OWN BOUND: by any amount
   *     with nothing else changed (two draws a team, 1 to 15 and 16 to 90),
   *     and by its own legal posting.
   *
   * WHY THEY HOLD. A scenario's count is the exact maximum over every
   * allocation, each rival taking one resource. (b): an allocation that
   * covers a set of rivals against the higher floor covers at least that set
   * against the lower one. (a): an allocation after the posting, with the
   * posted award handed back to that team out of a budget one larger, is an
   * allocation of before it that covers the same rivals.
   *
   * WHAT THEY READ BEFORE THE MATCHING (the planner of the quick task, on
   * these seeds): (a) none. (b) rises on every shape, by up to 5.
   */
  it("over seeded transitions of every shape: another team's judged award posting never raises a bound, and a team's own floor rising never raises its own", () => {
    type Kind = "ownDelta" | "ownAward" | "otherPost";
    const tallies = new Map<string, { checks: number; rises: number; falls: number }>();
    const tallyOf = (shape: OnceShape, kind: Kind): { checks: number; rises: number; falls: number } => {
      const key = `${shape} ${kind}`;
      let tally = tallies.get(key);
      if (tally === undefined) {
        tally = { checks: 0, rises: 0, falls: 0 };
        tallies.set(key, tally);
      }
      return tally;
    };
    const firstRises: string[] = [];
    const record = (shape: OnceShape, kind: Kind, where: string, before: number, after: number): void => {
      const tally = tallyOf(shape, kind);
      tally.checks += 1;
      if (after < before) tally.falls += 1;
      if (after > before) {
        tally.rises += 1;
        if (firstRises.length < 6) firstRises.push(`${shape} ${kind}, ${where}: ${String(before)} then ${String(after)}`);
      }
    };
    const raised = (inputs: readonly JointLockInput[], teamKey: string, by: number): JointLockInput[] =>
      inputs.map((input) => ({ ...input, pool: input.pool.map((rival) => (rival.teamKey === teamKey ? { ...rival, floor: rival.floor + by } : rival)) }));
    const posted = (inputs: readonly JointLockInput[], teamKey: string, points: number): JointLockInput[] =>
      inputs.map((input) => {
        if (!input.pool.some((rival) => rival.teamKey === teamKey)) return input;
        return {
          ...input,
          pool: input.pool.map((rival) => (rival.teamKey === teamKey ? { ...rival, floor: rival.floor + points } : rival)),
          judgedAwards: input.judgedAwards - 1,
          awardedRivals: [...(input.awardedRivals ?? []), teamKey],
        };
      });
    const mayPost = (instance: OnceInstance, teamKey: string): boolean =>
      instance.postable.includes(teamKey) &&
      instance.inputs.every((input) => !input.pool.some((rival) => rival.teamKey === teamKey) || (input.judgedAwards >= 1 && !(input.awardedRivals ?? []).includes(teamKey)));

    for (const shape of ONCE_SHAPES) {
      for (let index = 1; index <= 3000; index++) {
        const seed = onceSeed(index, shape);
        const instance = onceInstance(seed, shape);
        const random = mulberry32(seed ^ 0x5bd1e995);
        const pick = (count: number): number => Math.floor(random() * count);
        const base = new Map<string, number>();
        for (const teamKey of instance.teams) base.set(teamKey, onceBound(instance, instance.inputs, teamKey));
        for (const teamKey of instance.teams) {
          const before = base.get(teamKey)!;
          if (!Number.isFinite(before)) continue;
          for (const by of [1 + pick(15), 16 + pick(75)]) record(shape, "ownDelta", `seed ${String(seed)} ${teamKey} up ${String(by)}`, before, onceBound(instance, raised(instance.inputs, teamKey, by), teamKey));
          if (mayPost(instance, teamKey)) {
            const points = 1 + pick(15);
            record(shape, "ownAward", `seed ${String(seed)} ${teamKey} posts ${String(points)}`, before, onceBound(instance, posted(instance.inputs, teamKey, points), teamKey));
          }
        }
        // Up to three legal postings an instance, each on its own against the instance as drawn.
        const legal = instance.postable.filter((teamKey) => mayPost(instance, teamKey));
        for (let draw = 0; draw < 3 && legal.length > 0; draw++) {
          const poster = legal.splice(pick(legal.length), 1)[0]!;
          const points = 1 + pick(15);
          const after = posted(instance.inputs, poster, points);
          for (const teamKey of instance.teams) {
            if (teamKey === poster) continue;
            const before = base.get(teamKey)!;
            if (!Number.isFinite(before)) continue;
            record(shape, "otherPost", `seed ${String(seed)} ${poster} posts ${String(points)}, read for ${teamKey}`, before, onceBound(instance, after, teamKey));
          }
        }
      }
    }
    const lines = [...tallies].sort(([a], [b]) => a.localeCompare(b)).map(([key, tally]) => `${key}: ${String(tally.checks)} compared, ${String(tally.rises)} rises, ${String(tally.falls)} falls`);
    console.log(`[261010-l0s the two properties] ${lines.join(" | ")}`);
    // THE REQUIREMENT: no bound rises, in any shape, over any of the three kinds of transition.
    expect({ rises: [...tallies].filter(([, tally]) => tally.rises > 0).map(([key, tally]) => `${key}: ${String(tally.rises)}`), firstRises }).toEqual({ rises: [], firstRises: [] });
    // Not vacuous, and at least 300,000 comparisons for each property. The counts are pinned as the run shows.
    const total = (kinds: readonly Kind[]): number => ONCE_SHAPES.reduce((sum, shape) => sum + kinds.reduce((inner, kind) => inner + tallyOf(shape, kind).checks, 0), 0);
    expect(total(["otherPost"])).toBeGreaterThanOrEqual(300_000);
    expect(total(["ownDelta", "ownAward"])).toBeGreaterThanOrEqual(300_000);
    for (const [, tally] of tallies) expect(tally.falls).toBeGreaterThan(0);
    expect(Object.fromEntries([...tallies].map(([key, tally]) => [key, tally.checks]))).toEqual({
      "divisioned otherPost": 135_543,
      "divisioned ownAward": 40_727,
      "divisioned ownDelta": 114_382,
      "multiple otherPost": 185_877,
      "multiple ownAward": 44_368,
      "multiple ownDelta": 135_816,
      "single otherPost": 70_521,
      "single ownAward": 21_554,
      "single ownDelta": 65_292,
    });
  }, 300_000);
});

// ===========================================================================
// A pick TBA has paid for an alliance's playoffs is on that alliance (quick task 261010-l0s, finding F2)
// ===========================================================================

describe("champJointLock: a pick TBA has paid for an alliance's playoffs is on that alliance (261010-l0s, finding F2)", () => {
  it("confirmedPicks: a listed team is confirmed by its alliance selection points or by TBA's payment for that alliance's playoffs, either one, in the list's own order", () => {
    const holds = new Set(["a", "b", "c"]);
    const paid = new Set(["d", "b"]);
    const of = (set: ReadonlySet<string>) => (teamKey: string) => set.has(teamKey);
    expect(confirmedPicks(["a", "b", "c", "d"], of(holds), of(paid))).toEqual(["a", "b", "c", "d"]);
    // Nobody paid: the rule of before quick task 261010-l0s, alliance selection points alone.
    expect(confirmedPicks(["a", "b", "c", "d"], of(holds), () => false)).toEqual(["a", "b", "c"]);
    // A backup holds no alliance selection points: the payment alone confirms it, and a listed team TBA paid nothing stays out.
    expect(confirmedPicks(["d", "e"], () => false, of(paid))).toEqual(["d"]);
    expect(confirmedPicks(["c", "a"], of(holds), of(paid))).toEqual(["c", "a"]);
    expect(confirmedPicks([], () => true, () => true)).toEqual([]);
  });

  /**
   * SIX TEAMS, FIVE POINTS SLOTS, the smallest input the planner of that task
   * found that takes a Locked back. The decided winner (alliance 1: w1, w2 and
   * w3 confirmed) lists L, which holds no alliance selection points. T is at
   * 110 and x far behind at 40. No award is left to give.
   */
  const winner = (members: string[], spareSeats: number): JointLockInput["alliances"] => [{ allianceNumber: 1, members, spareSeats }];
  const sixTeams = (listed: JointLockRival, alliances: JointLockInput["alliances"], playoffPointsLanded: boolean): JointLockInput => ({
    pool: [
      { teamKey: "T", floor: 110, extra: 0 },
      { teamKey: "w1", floor: playoffPointsLanded ? 390 : 300, extra: playoffPointsLanded ? 0 : 90 },
      { teamKey: "w2", floor: playoffPointsLanded ? 370 : 280, extra: playoffPointsLanded ? 0 : 90 },
      { teamKey: "w3", floor: playoffPointsLanded ? 350 : 260, extra: playoffPointsLanded ? 0 : 90 },
      listed,
      { teamKey: "x", floor: 40, extra: 0 },
    ],
    slotOnlyRivals: [],
    pointsSlots: 5,
    alliances,
    aliveAlliances: [],
    candidateWinners: [1],
    placementPoints: [75, 39, 21],
    consumingAwards: 0,
    judgedAwards: 0,
    judgedAwardPoints: JUDGED,
    maxAllianceSize: 4,
  });

  it("the tick the winner's playoff points land: with the paid pick left off the winner T's bound rises from 4 to 5 of 5 slots and its Locked is taken back; with the paid pick a member it stays 4 and T stays Locked", () => {
    // BEFORE the points land: L carries the winner's settled 90 only as a listed pick, so it is read at its floor of
    // 100 and counted through the winner's one fill in. w1, w2, w3 and that fill in: 4.
    const before = sixTeams({ teamKey: "L", floor: 100, extra: 90, listedOnly: { settled: 90, onWinner: true } }, winner(["w1", "w2", "w3"], 1), false);
    expect(jointLockBound(before, "T")).toBe(4);
    expect(jointLockedTeams(before).has("T")).toBe(true);

    // AFTER they land TBA has paid L 21 for the winner's playoffs: it is at 121, ahead of T by its own floor.
    const paidPick: JointLockRival = { teamKey: "L", floor: 121, extra: 0 };
    // THE INPUT OF BEFORE THE RULE: L is not confirmed (it holds no alliance selection points), so the winner still
    // shows three members and one spare seat. L counts by its floor AND x as the winner's backup: 5, no future's.
    const leftOff = sixTeams(paidPick, winner(["w1", "w2", "w3"], 1), true);
    expect(jointLockBound(leftOff, "T")).toBe(5);
    expect(jointLockedTeams(leftOff).has("T")).toBe(false);
    // THE INPUT UNDER THE RULE: L is the winner's fourth member and the seat it holds is closed.
    const members = confirmedPicks(
      ["w1", "w2", "w3", "L"],
      (teamKey) => teamKey !== "L",
      (teamKey) => teamKey === "L"
    );
    expect(members).toEqual(["w1", "w2", "w3", "L"]);
    const member = sixTeams(paidPick, winner(members, 4 - members.length), true);
    expect(jointLockBound(member, "T")).toBe(4);
    expect(jointLockedTeams(member).has("T")).toBe(true);
    // No team's bound is higher after the tick than before it, and the paid pick itself is on the winner.
    for (const teamKey of ["T", "w1", "w2", "w3", "L", "x"]) expect(jointLockBound(member, teamKey), teamKey).toBeLessThanOrEqual(jointLockBound(before, teamKey));
    expect(jointLockBound(member, "L")).toBe(0);
    // THE ALLOCATION MODEL ENUMERATED (no code shared with the module) reads the same three numbers: each bound is
    // the exact maximum of the input it is handed, so the rise was in the input and nowhere else.
    expect(modelMostTakers(before, "T", 8)).toBe(4);
    expect(modelMostTakers(leftOff, "T", 8)).toBe(5);
    expect(modelMostTakers(member, "T", 8)).toBe(4);
  });

  it("a listed pick TBA paid nothing is not confirmed and its seat stays open: the winner may still hold a member no row has named", () => {
    // The same six teams after the tick, L listed and paid nothing (floor 100): it is not a member, and the fill in
    // still covers one rival, L or x. Closing the seat here would count neither.
    const unpaid = sixTeams({ teamKey: "L", floor: 100, extra: 0 }, winner(confirmedPicks(["w1", "w2", "w3", "L"], (teamKey) => teamKey !== "L", () => false), 1), true);
    expect(unpaid.alliances[0]!.members).toEqual(["w1", "w2", "w3"]);
    expect(jointLockBound(unpaid, "T")).toBe(4);
  });
});

// ===========================================================================
// Quick task 261010-l0s, CONTEXT D5 (the plan check's addendum): a brute force
// over RULE LEGAL FUTURES with TWO SEAT GROUPS
// ===========================================================================

describe("champJointLock: brute force soundness over rule legal futures with TWO seat groups (261010-l0s, CONTEXT D5)", () => {
  /**
   * WHY THIS TEST EXISTS. `modelMostTakers` above enumerates the same
   * ALLOCATION reading the matching solves, so the bound being equal to it
   * says the matching is exact and nothing about the rules. The brute force
   * of quick task 261010-d7r enumerates futures, but with one seat group.
   * Two of the three double counts quick task 261010-l0s closed need two
   * groups to show (a rival no group names, a listed pick on an alliance
   * still in its bracket). So this test enumerates FUTURES, never
   * allocations, on small instances that always have two seat groups, and
   * holds that none puts more rivals ahead of T than the bound. It calls
   * `jointLockBound` and nothing else of the module: not `coverMatching`, and
   * none of this file's `modelMostTakers`, `matchingOfOneGroup`,
   * `referenceCover` or `boundBeforeTheMatching`.
   *
   * THE INSTANCES. Two seat groups: alliances 11, 12 and sometimes 13 in
   * group 0, alliance 21 and sometimes 22 in group 1. One frame (11 wins) or
   * two (11, and 12 or 21). A frame credits every other alliance one of three
   * ways: enumerated (an alliance of the winner's own group, paid 75, 39 or
   * 21 by its place in the order), fixed at a value, or nothing at all. The
   * teams, T aside:
   *
   *   - CONFIRMED PICKS, on an alliance and named by no group;
   *   - LISTED PICKS THAT ARE NOT CONFIRMED (reading P3), on an alliance AND
   *     named by its group (sometimes by both groups);
   *   - RIVALS ON NO ALLIANCE, named by one group, by both, or by none
   *     (reading P4: eligible in every group);
   *   - LISTED ONLY PICKS (finding F-D): of a placed alliance (settled 21, 39
   *     or 75) and, in a one frame instance, of the decided winner (settled
   *     90), handed over exactly as the status code hands them;
   *   - SLOT ONLY RIVALS, on no alliance (named by a group or by none) or a
   *     member of an alliance;
   *   - AWARDED RIVALS among all of the pool teams.
   *
   * T is on no alliance (named by a group or by none), a confirmed pick of an
   * alliance, or only LISTED by one (reading P3 for T itself).
   *
   * THE RULE LEGAL FUTURES, per frame. The frame's winner W wins. The
   * enumerated alliances finish in every order. Then every team takes ONE
   * place:
   *
   *   - a confirmed pick stays on its alliance: with W it takes a slot, else
   *     it is paid its alliance's value;
   *   - a team on no alliance (a listed only pick included) takes nothing, or
   *     ONE backup seat on an alliance the frame pays above 0, of a group it
   *     is eligible in, while that alliance has a spare seat, or is W's
   *     backup while W has a spare seat and it is eligible in W's group;
   *   - a listed pick that is not confirmed WAS on the alliance that lists
   *     it (paid its value, or a slot where that alliance is W), or NEVER
   *     WAS and is free like a team on no alliance;
   *   - a placed alliance's listed only pick WAS on that alliance (paid the
   *     settled value, no seat, no fill in) or never was and is free; the
   *     decided winner's is W's backup or is free, and is never paid the 90;
   *   - a slot only rival takes a slot only with W.
   *
   * An alliance takes as many backups as it has spare seats (0, 1 or 2
   * here), which is never fewer than the one the backup robot rule allows, so
   * every rule legal seating is among those enumerated. On top of each
   * seating the awards are added in closed form, exactly as the brute force
   * of quick task 261010-d7r adds them: `min(non takers, C + min(K, non
   * takers that are not awarded and are within one judged award of T))`. That
   * closed form is itself checked against every hand out of the awards
   * enumerated, at the first seating of every order and at every 257th
   * seating after it.
   *
   * TWO READINGS OF ONE THING, each enumerated in full: where a listed pick
   * that is not confirmed sits when it WAS on the alliance that lists it.
   *
   *   - RULE LEGAL. It sits in one of the seats that alliance has not
   *     confirmed. Seats count from confirmed picks (the module's header,
   *     "SEATS COUNT FROM CONFIRMED PICKS"), so that seat is one of the
   *     alliance's spare seats and the alliance has one fewer for a backup.
   *     No future of this reading may be above the bound: that is SOUNDNESS,
   *     the one thing that must never fail.
   *   - THE PROOF'S OWN. It is paid its alliance's value and the alliance
   *     still offers every spare seat: the proof does not take the seat
   *     away, which only raises its count. Every rule legal future is one of
   *     these too. Under this reading the bound is not only never below a
   *     future, it is REACHED at every instance: it is the exact maximum over
   *     the futures it reads, so no rival is counted twice. That is the claim
   *     of quick task 261010-l0s, held here from futures and not from
   *     allocations.
   *
   * WHERE T ONLY LISTS ON THE WINNER the futures counted are those where T
   * never was on it (where it was, T qualifies with the winner). Where T is
   * a confirmed pick of the winner the frame holds no future against T. T is
   * read at its floor throughout, as the bound reads it.
   *
   * IT BITES (run A of the quick task, measured on this test with the module
   * broken in one place at a time): a rival eligible in its first group only,
   * the winner's fill in closed, one seat a seat type, a slot only rival left
   * out, the judged award alone closed, a seat read one award too far and the
   * consuming awards dropped each put a rule legal future above the bound. A
   * listed pick read alone without its alliance's value puts a future of the
   * proof's own reading above it, and no rule legal one.
   *
   * A FAILURE HERE IS A FINDING, never a pin: a legal future above the bound
   * is the one thing this proof must not have.
   */
  it("40,000 seeded instances, two seat groups, one or two frames, with awarded rivals, listed picks, listed only picks, rivals no group names and slot only rivals: no rule legal future puts more rivals ahead of T than the bound, and on the proof's own reading of a listed pick's seat the bound is reached at every one", () => {
    const INSTANCES = 40_000;
    const MOST_ACTORS = 7;
    const m = 200;
    const PLACEMENT = [75, 39, 21] as const;
    type Kind = "member" | "listed" | "free" | "listedPlaced" | "listedWinner" | "slotFree" | "slotMember";
    interface Team {
      readonly key: string;
      readonly kind: Kind;
      readonly floor: number;
      /** What it may still be paid beyond its floor, a listed only pick's settled value NOT included. */
      readonly extra: number;
      /** A listed only pick's settled value: 21, 39 or 75 of a placed alliance, 90 of the decided winner. Else 0. */
      readonly settled: number;
      readonly awarded: boolean;
      /** The alliance it is a confirmed pick of ("member", "slotMember") or that lists it ("listed"). */
      readonly alliance: number | undefined;
      /** The seat groups that name it. `undefined`: no group names it. */
      readonly named: readonly number[] | undefined;
    }
    interface FrameSpec {
      readonly winner: number;
      readonly enumerated: number[];
      readonly fixed: Map<number, number>;
      readonly fillIns: number;
    }
    /** What one reading of the futures adds up to over the instances. */
    interface ReadingTally {
      futures: number;
      handOutChecks: number;
      onBound: number;
      slack: number;
    }
    // The places an actor may take, beside a backup seat on an alliance (its number, always above 0).
    const NONE = -1;
    const FILL = -2;
    const MEMBER = -3;
    const OWN = -4;
    const ordersOf = (items: readonly number[]): number[][] =>
      items.length === 0 ? [[]] : items.flatMap((item, index) => ordersOf([...items.slice(0, index), ...items.slice(index + 1)]).map((tail) => [item, ...tail]));
    /**
     * Every hand out of the awards enumerated, for the rivals a seating leaves short of T: each takes nothing, one
     * judged award (never an awarded rival, never a slot only one; it lifts the rival only where 15 points reach T)
     * or one consuming award (anyone, whatever its points). The most rivals that take a slot that way.
     */
    const handOutsEnumerated = (lifts: readonly boolean[], mayTakeJudged: readonly boolean[], judged: number, consuming: number): number => {
      let top = 0;
      const walk = (at: number, count: number, judgedLeft: number, consumingLeft: number): void => {
        if (at === lifts.length) {
          if (count > top) top = count;
          return;
        }
        walk(at + 1, count, judgedLeft, consumingLeft);
        if (judgedLeft > 0 && mayTakeJudged[at]!) walk(at + 1, count + (lifts[at]! ? 1 : 0), judgedLeft - 1, consumingLeft);
        if (consumingLeft > 0) walk(at + 1, count + 1, judgedLeft, consumingLeft - 1);
      };
      walk(0, 0, judged, consuming);
      return top;
    };

    const seen = { run: 0, tooLarge: 0, twoFrames: 0, enumerated: 0, listed: 0, unnamed: 0, listedOnly: 0, awarded: 0, slotOnly: 0, tOnlyListed: 0, noFrameAgainstT: 0 };
    const ruleLegal: ReadingTally = { futures: 0, handOutChecks: 0, onBound: 0, slack: 0 };
    const proofsOwn: ReadingTally = { futures: 0, handOutChecks: 0, onBound: 0, slack: 0 };
    let handOutMismatches = 0;
    const failures: string[] = [];

    for (let seed = 1; seed <= INSTANCES; seed++) {
      const random = mulberry32(0x10500000 + seed);
      const pick = (count: number): number => Math.floor(random() * count);
      const chance = (probability: number): boolean => random() < probability;
      const drawExtra = (): number => (pick(2) === 0 ? 0 : pick(30));

      // TWO SEAT GROUPS, always.
      const groupOf = new Map<number, number>([
        [11, 0],
        [12, 0],
        [21, 1],
      ]);
      if (chance(1 / 3)) groupOf.set(13, 0);
      if (chance(1 / 2)) groupOf.set(22, 1);
      const ids = [...groupOf.keys()].sort((a, b) => a - b);

      // T: on no alliance and named by one group, on none and named by none, a confirmed pick, or only listed.
      const tDraw = pick(20);
      const tRole = tDraw < 8 ? "freeNamed" : tDraw < 11 ? "freeUnnamed" : tDraw < 16 ? "member" : "listed";
      const tAlliance = tRole === "member" || tRole === "listed" ? ids[pick(ids.length)]! : undefined;
      const tNamed: readonly number[] | undefined = tRole === "freeNamed" ? [pick(2)] : tRole === "listed" ? [groupOf.get(tAlliance!)!] : undefined;

      const teams: Team[] = [];
      const membersOf = new Map<number, string[]>(ids.map((id) => [id, []]));
      const spare = new Map<number, number>();
      for (const id of ids) {
        const confirmed = pick(3);
        for (let index = 0; index < confirmed; index++) {
          const key = `a${String(id)}m${String(index)}`;
          teams.push({ key, kind: "member", floor: 60 + pick(170), extra: drawExtra(), settled: 0, awarded: chance(0.3), alliance: id, named: undefined });
          membersOf.get(id)!.push(key);
        }
        let listsATeam = false;
        if (tAlliance === id) {
          membersOf.get(id)!.push("T");
          listsATeam = tRole === "listed";
        }
        if (chance(0.25)) {
          const key = `a${String(id)}L`;
          const own = groupOf.get(id)!;
          teams.push({ key, kind: "listed", floor: 80 + pick(150), extra: drawExtra(), settled: 0, awarded: chance(0.3), alliance: id, named: chance(0.15) ? [0, 1] : [own] });
          membersOf.get(id)!.push(key);
          listsATeam = true;
        }
        // Seats count from confirmed picks, so an alliance that lists a team it has not confirmed has that seat spare.
        spare.set(id, listsATeam ? 1 + pick(2) : pick(3));
      }

      // ONE OR TWO FRAMES.
      const winners = chance(0.6) ? [11] : [11, chance(0.5) ? 12 : 21];
      const frames: FrameSpec[] = winners.map((winner) => {
        const enumerated: number[] = [];
        const fixed = new Map<number, number>();
        for (const id of ids) {
          if (id === winner) continue;
          const draw = random();
          if (draw < 0.1) continue; // this frame credits the alliance nothing
          if (groupOf.get(id) === groupOf.get(winner)) {
            if (draw < 0.65) enumerated.push(id);
            else fixed.set(id, [75, 39, 21, 0][pick(4)]!);
          } else {
            fixed.set(id, [120, 90, 30, 21, 0][pick(5)]!);
          }
        }
        return { winner, enumerated, fixed, fillIns: spare.get(winner)! };
      });

      const freeCount = 1 + pick(3);
      for (let index = 0; index < freeCount; index++) {
        const draw = pick(20);
        const named: readonly number[] | undefined = draw < 7 ? [0] : draw < 14 ? [1] : draw < 16 ? [0, 1] : undefined;
        teams.push({ key: `f${String(index)}`, kind: "free", floor: 80 + pick(150), extra: drawExtra(), settled: 0, awarded: chance(0.3), alliance: undefined, named });
      }
      if (chance(0.45)) {
        teams.push({ key: "lp", kind: "listedPlaced", floor: 80 + pick(150), extra: drawExtra(), settled: [21, 39, 75][pick(3)]!, awarded: chance(0.3), alliance: undefined, named: chance(0.15) ? undefined : [pick(2)] });
      }
      // The decided winner's listed only pick: read that way only where every frame names the one winner.
      if (winners.length === 1 && chance(0.4)) {
        teams.push({ key: "lw", kind: "listedWinner", floor: 80 + pick(150), extra: drawExtra(), settled: 90, awarded: chance(0.3), alliance: undefined, named: chance(0.15) ? [0, 1] : [groupOf.get(11)!] });
      }
      if (chance(0.35)) {
        const draw = pick(10);
        if (draw < 7) {
          teams.push({ key: "so", kind: "slotFree", floor: 0, extra: 0, settled: 0, awarded: false, alliance: undefined, named: draw < 4 ? [pick(2)] : undefined });
        } else {
          const id = ids[pick(ids.length)]!;
          teams.push({ key: "so", kind: "slotMember", floor: 0, extra: 0, settled: 0, awarded: false, alliance: id, named: undefined });
          membersOf.get(id)!.push("so");
        }
      }
      const K = pick(4);
      const C = pick(3);
      const tAwarded = chance(0.25);

      // The teams that still choose a place: everyone but the confirmed picks.
      const actors = teams.filter((team) => team.kind !== "member" && team.kind !== "slotMember");
      if (actors.length > MOST_ACTORS) {
        seen.tooLarge += 1;
        continue;
      }
      seen.run += 1;
      if (frames.length === 2) seen.twoFrames += 1;
      if (frames.some((frame) => frame.enumerated.length > 0)) seen.enumerated += 1;
      if (teams.some((team) => team.kind === "listed")) seen.listed += 1;
      if (teams.some((team) => team.alliance === undefined && team.named === undefined)) seen.unnamed += 1;
      if (teams.some((team) => team.settled > 0)) seen.listedOnly += 1;
      if (teams.some((team) => team.awarded)) seen.awarded += 1;
      if (teams.some((team) => team.kind === "slotFree" || team.kind === "slotMember")) seen.slotOnly += 1;
      if (tRole === "listed" && winners.includes(tAlliance!)) seen.tOnlyListed += 1;
      // T is a confirmed pick of the winner: T qualifies with it, and that frame holds no future against T.
      const framesAgainstT = frames.filter((frame) => !(tRole === "member" && tAlliance === frame.winner));
      if (framesAgainstT.length === 0) seen.noFrameAgainstT += 1;

      const isSlotOnly = (team: Team): boolean => team.kind === "slotFree" || team.kind === "slotMember";
      const input: JointLockInput = {
        pool: [
          { teamKey: "T", floor: m, extra: 0 },
          ...teams
            .filter((team) => !isSlotOnly(team))
            .map((team): JointLockRival =>
              team.settled > 0
                ? { teamKey: team.key, floor: team.floor, extra: team.extra + team.settled, listedOnly: { settled: team.settled, onWinner: team.kind === "listedWinner" } }
                : { teamKey: team.key, floor: team.floor, extra: team.extra }
            ),
        ],
        slotOnlyRivals: teams.filter(isSlotOnly).map((team) => team.key),
        pointsSlots: 99,
        alliances: ids.map((id): JointLockAlliance => ({ allianceNumber: id, members: membersOf.get(id)!, spareSeats: spare.get(id)! })),
        aliveAlliances: ids.filter((id) => !winners.includes(id)),
        candidateWinners: winners,
        placementPoints: [...PLACEMENT],
        consumingAwards: C,
        judgedAwards: K,
        judgedAwardPoints: JUDGED,
        maxAllianceSize: 4,
        frames: frames.map((frame): JointLockFrame => ({ winner: frame.winner, enumerated: frame.enumerated, fixed: frame.fixed, fillIns: frame.fillIns })),
        seatGroups: [0, 1].map(
          (group): JointLockSeatGroup => ({
            alliances: ids.filter((id) => groupOf.get(id) === group),
            eligible: [...teams.filter((team) => team.named?.includes(group) === true).map((team) => team.key), ...(tNamed?.includes(group) === true ? ["T"] : [])],
          })
        ),
        awardedRivals: [...teams.filter((team) => team.awarded).map((team) => team.key), ...(tAwarded ? ["T"] : [])],
      };
      const bound = jointLockBound(input, "T");

      /**
       * EVERY FUTURE of one reading, and the most rivals ahead of T in any of them. `listedTakesASeat`: a listed pick
       * that WAS on the alliance that lists it sits in one of that alliance's spare seats (rule legal), or the
       * alliance still offers every spare seat beside it (the proof's own reading).
       */
      const mostAheadOfT = (tally: ReadingTally, listedTakesASeat: boolean): number => {
        let most = 0;
        for (const frame of framesAgainstT) {
          const W = frame.winner;
          const winnerGroup = groupOf.get(W)!;
          for (const order of ordersOf(frame.enumerated)) {
            const pay = new Map<number, number>(frame.fixed);
            order.forEach((id, index) => pay.set(id, PLACEMENT[index] ?? 0));
            const payOf = (id: number): number => pay.get(id) ?? 0;
            const place = new Array<number>(actors.length).fill(NONE);
            const placeOf = new Map<string, number>();
            const seated = new Map<number, number>();
            let fills = 0;
            let seatingsOfThisOrder = 0;

            const settle = (): void => {
              tally.futures += 1;
              seatingsOfThisOrder += 1;
              actors.forEach((actor, index) => placeOf.set(actor.key, place[index]!));
              let takers = 0;
              const lifts: boolean[] = [];
              const mayTakeJudged: boolean[] = [];
              const leftShort = (lift: boolean, judged: boolean): void => {
                lifts.push(lift);
                mayTakeJudged.push(judged);
              };
              for (const team of teams) {
                if (team.kind === "slotMember") {
                  if (team.alliance === W) takers += 1;
                  else leftShort(false, false);
                  continue;
                }
                const at = placeOf.get(team.key);
                if (team.kind === "slotFree") {
                  if (at === FILL) takers += 1;
                  else leftShort(false, false);
                  continue;
                }
                let points = team.floor + team.extra;
                if (team.kind === "member") {
                  if (team.alliance === W) {
                    takers += 1;
                    continue;
                  }
                  points += payOf(team.alliance!);
                } else if (at === FILL) {
                  takers += 1;
                  continue;
                } else if (at === MEMBER) {
                  if (team.alliance === W) {
                    takers += 1;
                    continue;
                  }
                  points += payOf(team.alliance!);
                } else if (at === OWN) {
                  points += team.settled;
                } else if (at !== undefined && at !== NONE) {
                  points += payOf(at);
                }
                if (points >= m) {
                  takers += 1;
                  continue;
                }
                leftShort(points + JUDGED >= m, !team.awarded);
              }
              let liftable = 0;
              for (let index = 0; index < lifts.length; index++) if (lifts[index]! && mayTakeJudged[index]!) liftable += 1;
              const byAwards = Math.min(lifts.length, C + Math.min(K, liftable));
              if ((seatingsOfThisOrder === 1 || tally.futures % 257 === 0) && lifts.length <= 10) {
                tally.handOutChecks += 1;
                if (handOutsEnumerated(lifts, mayTakeJudged, K, C) !== byAwards) handOutMismatches += 1;
              }
              if (takers + byAwards > most) most = takers + byAwards;
            };

            const visit = (index: number): void => {
              if (index === actors.length) {
                settle();
                return;
              }
              const actor = actors[index]!;
              const eligibleIn = (group: number): boolean => actor.named === undefined || actor.named.includes(group);
              const options: number[] = [NONE];
              if (actor.kind === "listed") {
                // It WAS on the alliance that lists it. Rule legal: in one of the seats that alliance has not confirmed.
                const own = actor.alliance!;
                if (!listedTakesASeat || (own === W ? fills < frame.fillIns : (seated.get(own) ?? 0) < spare.get(own)!)) options.push(MEMBER);
              }
              // The winner's backup. (For a team the winner itself lists, that is MEMBER above.)
              if (!(actor.kind === "listed" && actor.alliance === W) && eligibleIn(winnerGroup) && fills < frame.fillIns) options.push(FILL);
              // A backup seat on another alliance the frame pays. It gives a slot only rival nothing.
              if (actor.kind !== "slotFree") {
                for (const id of ids) {
                  if (id === W || id === actor.alliance) continue;
                  if (payOf(id) <= 0 || !eligibleIn(groupOf.get(id)!) || (seated.get(id) ?? 0) >= spare.get(id)!) continue;
                  options.push(id);
                }
              }
              // It WAS on the placed alliance that lists it: paid the settled value, on no seat.
              if (actor.kind === "listedPlaced") options.push(OWN);
              for (const option of options) {
                place[index] = option;
                const takesItsOwnSeat = option === MEMBER && listedTakesASeat;
                const onTheWinner = option === FILL || (takesItsOwnSeat && actor.alliance === W);
                const seatOn = takesItsOwnSeat ? actor.alliance! : option;
                if (onTheWinner) fills += 1;
                else if (seatOn > 0) seated.set(seatOn, (seated.get(seatOn) ?? 0) + 1);
                visit(index + 1);
                if (onTheWinner) fills -= 1;
                else if (seatOn > 0) seated.set(seatOn, seated.get(seatOn)! - 1);
              }
              place[index] = NONE;
            };
            visit(0);
          }
        }
        tally.slack += bound - most;
        if (most === bound) tally.onBound += 1;
        return most;
      };

      const describeInstance = (): string =>
        `K ${String(K)} C ${String(C)} | T ${tRole}${tAlliance === undefined ? "" : ` on ${String(tAlliance)}`}${tNamed === undefined ? "" : ` named by ${tNamed.join("+")}`} | spare ${ids.map((id) => `${String(id)}:${String(spare.get(id))}`).join(" ")} | frames ${frames
          .map((frame) => `W${String(frame.winner)} enumerated [${frame.enumerated.join(",")}] fixed [${[...frame.fixed].map(([id, value]) => `${String(id)}=${String(value)}`).join(",")}] fill ins ${String(frame.fillIns)}`)
          .join(" ; ")} | ${teams
          .map((team) => `${team.key}(${team.kind}${team.alliance === undefined ? "" : `@${String(team.alliance)}`}${team.named === undefined ? "" : ` g${team.named.join("+")}`}):${String(team.floor)}+${String(team.extra)}${team.settled > 0 ? `~${String(team.settled)}` : ""}${team.awarded ? "*" : ""}`)
          .join(" ")}`;
      for (const [label, tally, listedTakesASeat] of [
        ["rule legal", ruleLegal, true],
        ["the proof's own reading of a listed pick's seat", proofsOwn, false],
      ] as const) {
        const most = mostAheadOfT(tally, listedTakesASeat);
        if (most > bound && failures.length < 6) failures.push(`seed ${String(seed)}, ${label}: a future has ${String(most)} rivals ahead of T, the bound is ${String(bound)} | ${describeInstance()}`);
        expect(most, failures.at(-1) ?? `seed ${String(seed)}`).toBeLessThanOrEqual(bound);
      }
    }
    const lineOf = (tally: ReadingTally): string =>
      `futures ${String(tally.futures)}, award hand outs enumerated at ${String(tally.handOutChecks)} seatings, the bound reached at ${String(tally.onBound)}, mean slack ${(tally.slack / Math.max(1, seen.run)).toFixed(3)}`;
    console.log(
      `[261010-l0s two seat groups] instances ${String(seen.run)} (left out as too large ${String(seen.tooLarge)}) | two frames ${String(seen.twoFrames)} | an enumerated alliance ${String(seen.enumerated)} | a listed pick that is not confirmed ${String(seen.listed)} | a team no group names ${String(seen.unnamed)} | a listed only pick ${String(seen.listedOnly)} | an awarded rival ${String(seen.awarded)} | a slot only rival ${String(seen.slotOnly)} | T only listed by a candidate winner ${String(seen.tOnlyListed)} | no frame against T ${String(seen.noFrameAgainstT)} | RULE LEGAL: ${lineOf(ruleLegal)} | THE PROOF'S OWN READING OF A LISTED PICK'S SEAT: ${lineOf(proofsOwn)} | the bound is below a future at ${String(failures.length)} | award hand outs differing from the closed form ${String(handOutMismatches)}`
    );
    // THE REQUIREMENT: no legal future above the bound, in either reading.
    expect(failures).toEqual([]);
    // The closed form of the awards is every hand out enumerated, wherever it was checked.
    expect(handOutMismatches).toBe(0);
    // The instances are not vacuous, and every kind of team is in the draw. Pinned as the run shows.
    expect(seen).toEqual({
      run: 39_751,
      tooLarge: 249,
      twoFrames: 15_928,
      enumerated: 27_776,
      listed: 26_334,
      unnamed: 18_163,
      listedOnly: 22_833,
      awarded: 35_971,
      slotOnly: 13_996,
      tOnlyListed: 3_000,
      noFrameAgainstT: 1_528,
    });
    // RULE LEGAL FUTURES: never above the bound (the requirement above), and the bound is reached at most instances.
    // Where it is not, the whole difference is the one reading the next lines remove. Pinned as the run shows.
    expect({ futures: ruleLegal.futures, handOutChecks: ruleLegal.handOutChecks, onBound: ruleLegal.onBound }).toEqual({ futures: 5_656_885, handOutChecks: 78_241, onBound: 36_680 });
    // THE PROOF'S OWN READING OF A LISTED PICK'S SEAT: the bound is the exact maximum over the futures, at EVERY
    // instance. An instance where it is not reached is a rival counted twice: a finding, not a pin to move.
    expect(proofsOwn.onBound).toBe(seen.run);
    expect({ futures: proofsOwn.futures, handOutChecks: proofsOwn.handOutChecks }).toEqual({ futures: 7_232_335, handOutChecks: 84_336 });
  }, 300_000);
});
