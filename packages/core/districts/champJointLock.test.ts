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
  dcmpBracketState,
  jointLockBound,
  jointLockedTeams,
  MAX_POINT_PAYING_AWARDS_PER_TEAM,
  type JointLockAlliance,
  type JointLockInput,
  type JointLockRival,
} from "./champJointLock.js";
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
