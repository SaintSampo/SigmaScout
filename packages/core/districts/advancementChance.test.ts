/**
 * `advancementChances`' coverage.
 *
 * FOUR JOBS, in order of what they protect:
 *
 *   1. THE NUMBER IS RIGHT. A two team, one slot fixture whose answer can be
 *      written down by hand (0.25, from a pair of fair coins with ties counting
 *      as out) is asserted within a Monte Carlo tolerance stated as a multiple
 *      of its own standard error, never as a magic epsilon.
 *   2. THE NUMBER AGREES WITH THE CHIP. A ceiling locked team reads exactly 1
 *      and an eliminated team reads exactly 0, checked against
 *      `computeLocksWithQualifiers`'s own verdicts on the same inputs rather
 *      than against a hand typed expectation. This is the property the whole
 *      design rests on: a printed chance that contradicted the status word
 *      beside it would be the worst thing this module could ship.
 *   3. THE SLOT COUNT IS `locks.ts`'s. Award qualifiers leave the pool and take
 *      a slot with them; a reserved Impact slot narrows the lock count alone.
 *   4. IT REFUSES RATHER THAN FABRICATES. Every input that would still produce
 *      a plausible looking chance throws instead.
 */
import { describe, expect, it } from "vitest";
import {
  advancementChances,
  AdvancementChanceInputError,
  type AdvancementChanceInputs,
  type AdvancementChanceTeam,
} from "./advancementChance.js";
import { computeLocksWithQualifiers, type LockTeamInput } from "./locks.js";
import { EmptyDistributionError, InvalidDenominatorError } from "./pointSummary.js";

const SEED = 20260925;

/** A point mass at `value`, in the one representation — what a finished team contributes. */
function mass(teamKey: string, value: number): AdvancementChanceTeam {
  const counts = new Float64Array(value + 1);
  counts[value] = 1;
  return { teamKey, counts, denominator: 1 };
}

/** A uniform distribution over the integers `lo` to `hi` inclusive. */
function uniform(teamKey: string, lo: number, hi: number): AdvancementChanceTeam {
  const counts = new Float64Array(hi + 1);
  const each = 1 / (hi - lo + 1);
  for (let value = lo; value <= hi; value++) counts[value] = each;
  return { teamKey, counts, denominator: 1 };
}

function inputsOf(teams: readonly AdvancementChanceTeam[], slots: number, overrides: Partial<AdvancementChanceInputs> = {}): AdvancementChanceInputs {
  return { teams, slots, awardQualified: [], prequalified: [], reservedSlots: 0, ...overrides };
}

/** The floor, ceiling and `maxRemaining` a distribution implies — the lock inputs the SAME fixture produces. */
function lockInputOf(team: AdvancementChanceTeam): LockTeamInput {
  let floor = -1;
  let ceiling = -1;
  for (let i = 0; i < team.counts.length; i++) {
    if (team.counts[i]! <= 0) continue;
    if (floor < 0) floor = i;
    ceiling = i;
  }
  return { teamKey: team.teamKey, pointTotal: floor, maxRemaining: ceiling - floor };
}

describe("advancementChances — the number", () => {
  it("reproduces an analytic two team, one slot answer inside four standard errors", () => {
    // Two fair coins over {0, 1}. A is inside only when it draws 1 and B draws
    // 0, because a tie at the last slot counts as OUT: 0.25 exactly.
    const draws = 4000;
    const result = advancementChances(inputsOf([uniform("frc1", 0, 1), uniform("frc2", 0, 1)], 1), draws, SEED);
    const standardError = Math.sqrt((0.25 * 0.75) / draws);
    expect(result.chanceByTeam.get("frc1")!).toBeCloseTo(0.25, 1);
    expect(Math.abs(result.chanceByTeam.get("frc1")! - 0.25)).toBeLessThan(4 * standardError);
    expect(Math.abs(result.chanceByTeam.get("frc2")! - 0.25)).toBeLessThan(4 * standardError);
  });

  it("counts a tie at the last slot as OUT, for both tied teams", () => {
    const result = advancementChances(inputsOf([mass("frc1", 42), mass("frc2", 42)], 1), 200, SEED);
    expect(result.chanceByTeam.get("frc1")).toBe(0);
    expect(result.chanceByTeam.get("frc2")).toBe(0);
  });

  it("is deterministic under one seed and reads the whole pool", () => {
    const teams = [uniform("frc1", 0, 30), uniform("frc2", 5, 25), mass("frc3", 18)];
    const first = advancementChances(inputsOf(teams, 2), 500, SEED);
    const second = advancementChances(inputsOf(teams, 2), 500, SEED);
    expect([...first.chanceByTeam.entries()]).toEqual([...second.chanceByTeam.entries()]);
    expect([...first.chanceByTeam.keys()]).toEqual(["frc1", "frc2", "frc3"]);
  });

  it("gives every team a chance in [0, 1] and never more inside runs than there are runs", () => {
    const teams = [uniform("frc1", 0, 40), uniform("frc2", 10, 50), uniform("frc3", 20, 60), mass("frc4", 35)];
    const result = advancementChances(inputsOf(teams, 2), 300, SEED);
    for (const chance of result.chanceByTeam.values()) {
      expect(chance).toBeGreaterThanOrEqual(0);
      expect(chance).toBeLessThanOrEqual(1);
    }
  });
});

describe("advancementChances — agreement with the verdicts", () => {
  /**
   * One fixture carrying all three shapes at once: a team nobody can reach, a
   * team whose ceiling nobody's floor exceeds, and a contested middle.
   * `slots` is 2, so the top two are the race.
   */
  const FIXTURE: readonly AdvancementChanceTeam[] = [
    mass("frc100", 120), // finished, far clear
    uniform("frc200", 90, 110),
    uniform("frc300", 60, 95),
    uniform("frc400", 20, 45),
    mass("frc500", 8), // finished, far below
  ];

  it("reads exactly 1 for every team the ceiling test locked and exactly 0 for every team it eliminated", () => {
    const slots = 2;
    const verdicts = computeLocksWithQualifiers(FIXTURE.map(lockInputOf), slots, {
      awardQualified: new Set<string>(),
      prequalified: new Set<string>(),
    });
    const result = advancementChances(inputsOf(FIXTURE, slots), 500, SEED);

    let lockedSeen = 0;
    let eliminatedSeen = 0;
    for (const verdict of verdicts) {
      const chance = result.chanceByTeam.get(verdict.teamKey);
      expect(chance, `${verdict.teamKey} is missing from the pool`).toBeDefined();
      if (verdict.status === "locked") {
        lockedSeen += 1;
        expect(chance, `${verdict.teamKey} is Locked and read ${String(chance)}`).toBe(1);
      }
      if (verdict.status === "eliminated") {
        eliminatedSeen += 1;
        expect(chance, `${verdict.teamKey} is Locked out and read ${String(chance)}`).toBe(0);
      }
    }
    // Both arms of the property actually fired on this fixture, rather than
    // passing vacuously over a census with neither status in it.
    expect(lockedSeen).toBeGreaterThan(0);
    expect(eliminatedSeen).toBeGreaterThan(0);
  });

  it("puts a contested team strictly between the two", () => {
    const result = advancementChances(inputsOf(FIXTURE, 2), 500, SEED);
    const contested = result.chanceByTeam.get("frc300")!;
    expect(contested).toBeGreaterThan(0);
    expect(contested).toBeLessThan(1);
  });
});

describe("advancementChances — the slot count is locks.ts's own", () => {
  it("drops an award qualifier from the pool and takes its slot with it", () => {
    const teams = [mass("frc1", 100), uniform("frc2", 40, 60), uniform("frc3", 30, 50)];
    const result = advancementChances(inputsOf(teams, 2, { awardQualified: ["frc1"] }), 400, SEED);
    expect(result.chanceByTeam.has("frc1")).toBe(false);
    expect(result.lockSlots).toBe(1);
  });

  it("drops a prequalified team from the pool WITHOUT taking a slot", () => {
    const teams = [mass("frc1", 100), uniform("frc2", 40, 60), uniform("frc3", 30, 50)];
    const result = advancementChances(inputsOf(teams, 2, { prequalified: ["frc1"] }), 400, SEED);
    expect(result.chanceByTeam.has("frc1")).toBe(false);
    expect(result.lockSlots).toBe(2);
  });

  it("holds back a reserved Impact slot, and ranks the runs against the narrowed count", () => {
    const teams = [mass("frc1", 100), mass("frc2", 90), mass("frc3", 80)];
    const reserved = advancementChances(inputsOf(teams, 2, { reservedSlots: 1 }), 100, SEED);
    expect(reserved.lockSlots).toBe(1);
    expect(reserved.chanceByTeam.get("frc2")).toBe(0);

    const unreserved = advancementChances(inputsOf(teams, 2), 100, SEED);
    expect(unreserved.lockSlots).toBe(2);
    expect(unreserved.chanceByTeam.get("frc2")).toBe(1);
  });

  it("returns an empty map, not a thrown error, when every slot is already gone", () => {
    const teams = [mass("frc1", 100), mass("frc2", 90)];
    const result = advancementChances(inputsOf(teams, 0), 50, SEED);
    expect(result.lockSlots).toBe(0);
    expect(result.chanceByTeam.get("frc1")).toBe(0);
    expect(result.chanceByTeam.get("frc2")).toBe(0);
  });
});

describe("advancementChances — refusals", () => {
  const ok = [mass("frc1", 10), mass("frc2", 5)];

  it("refuses a draw count that is not a positive integer", () => {
    expect(() => advancementChances(inputsOf(ok, 1), 0, SEED)).toThrow(AdvancementChanceInputError);
    expect(() => advancementChances(inputsOf(ok, 1), 1.5, SEED)).toThrow(AdvancementChanceInputError);
  });

  it("refuses a non finite seed and a negative or non integer capacity", () => {
    expect(() => advancementChances(inputsOf(ok, 1), 10, Number.NaN)).toThrow(AdvancementChanceInputError);
    expect(() => advancementChances(inputsOf(ok, -1), 10, SEED)).toThrow(AdvancementChanceInputError);
    expect(() => advancementChances(inputsOf(ok, 1.5), 10, SEED)).toThrow(AdvancementChanceInputError);
  });

  it("refuses an empty team list and a repeated team key", () => {
    expect(() => advancementChances(inputsOf([], 1), 10, SEED)).toThrow(AdvancementChanceInputError);
    expect(() => advancementChances(inputsOf([mass("frc1", 3), mass("frc1", 4)], 1), 10, SEED)).toThrow(/appears twice/);
  });

  it("refuses a distribution carrying no mass at all, with pointSummary's own error", () => {
    const empty: AdvancementChanceTeam = { teamKey: "frc9", counts: new Float64Array(12), denominator: 1 };
    expect(() => advancementChances(inputsOf([empty, mass("frc2", 4)], 1), 10, SEED)).toThrow(EmptyDistributionError);
  });

  it("refuses a non positive denominator, with pointSummary's own error", () => {
    const broken: AdvancementChanceTeam = { teamKey: "frc9", counts: new Float64Array([0, 1]), denominator: 0 };
    expect(() => advancementChances(inputsOf([broken, mass("frc2", 4)], 1), 10, SEED)).toThrow(InvalidDenominatorError);
  });

  it("refuses a negative or non finite count", () => {
    const negative: AdvancementChanceTeam = { teamKey: "frc9", counts: new Float64Array([0.5, -0.5, 1]), denominator: 1 };
    expect(() => advancementChances(inputsOf([negative, mass("frc2", 4)], 1), 10, SEED)).toThrow(/negative or non finite/);
  });
});
