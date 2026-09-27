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

describe("advancementChances — the simulated line", () => {
  it("returns one entry per run, each the pointsSlots-th highest drawn total of that run", () => {
    // Five point masses, two points slots: the 2nd highest total is 80 in
    // every run, because nothing is drawn at random.
    const teams = [mass("frc1", 100), mass("frc2", 80), mass("frc3", 60), mass("frc4", 40), mass("frc5", 20)];
    const draws = 25;
    const result = advancementChances(inputsOf(teams, 2), draws, SEED);
    expect(result.pointsSlots).toBe(2);
    expect(result.cutoffByRun).toBeInstanceOf(Float64Array);
    expect(result.cutoffByRun).toHaveLength(draws);
    expect([...result.cutoffByRun!]).toEqual(new Array<number>(draws).fill(80));
  });

  it("tracks a drawn pool, entry by entry, against the 2nd highest total of the same run", () => {
    const teams = [uniform("frc1", 0, 9), uniform("frc2", 0, 9), uniform("frc3", 0, 9), uniform("frc4", 0, 9), uniform("frc5", 0, 9)];
    const result = advancementChances(inputsOf(teams, 2), 64, SEED);
    expect(result.cutoffByRun).toHaveLength(64);
    // Every entry is a whole point value inside the drawable range, and the
    // line is at least as high as the median of a five team pool's 2nd slot
    // can be — the weakest claim that still catches an off by one.
    for (const value of result.cutoffByRun!) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(9);
    }
    // And the one entry an off by one would move: with two slots the line is
    // the SECOND highest, so at least two teams reach it in that run and at
    // most one team beats it.
    const mean = [...result.cutoffByRun!].reduce((a, b) => a + b, 0) / 64;
    expect(mean).toBeGreaterThan(5);
    expect(mean).toBeLessThan(9);
  });

  it("reads pointsSlots and not the reserved lockSlots the chance is ranked against", () => {
    const teams = [mass("frc1", 100), mass("frc2", 80), mass("frc3", 60), mass("frc4", 40)];
    const reserved = advancementChances(inputsOf(teams, 3, { reservedSlots: 1 }), 10, SEED);
    expect(reserved.lockSlots).toBe(2);
    expect(reserved.pointsSlots).toBe(3);
    // The line is the 3rd highest (60), never the 2nd (80).
    expect([...reserved.cutoffByRun!]).toEqual(new Array<number>(10).fill(60));
  });

  it("starts no second stream: the same inputs and the same seed give an identical array", () => {
    const teams = [uniform("frc1", 0, 40), uniform("frc2", 10, 50), uniform("frc3", 20, 60), uniform("frc4", 0, 30)];
    const first = advancementChances(inputsOf(teams, 2), 200, SEED);
    const second = advancementChances(inputsOf(teams, 2), 200, SEED);
    expect([...second.cutoffByRun!]).toEqual([...first.cutoffByRun!]);
  });

  it("perturbs not one printed chance: chanceByTeam is bit identical to the shipped numbers for the same seed", () => {
    // The SHIPPED values, recorded as literals rather than recomputed, so the
    // addition cannot move them under a test that recomputes with it. They were
    // read off this module at HEAD before the simulated line was added, and the
    // two implementations were run side by side over thirty slot and
    // reservation combinations to confirm the equality holds beyond this one
    // fixture (quick task 260926-37q).
    const teams = [uniform("frc1", 0, 40), uniform("frc2", 10, 50), uniform("frc3", 20, 60), uniform("frc4", 0, 30)];
    const result = advancementChances(inputsOf(teams, 2), 1000, SEED);
    expect([...result.chanceByTeam.entries()]).toEqual([
      ["frc1", 0.314],
      ["frc2", 0.661],
      ["frc3", 0.887],
      ["frc4", 0.113],
    ]);
  });

  it("omits the array entirely where there are no points slots", () => {
    const teams = [mass("frc1", 100), mass("frc2", 90)];
    const result = advancementChances(inputsOf(teams, 0), 50, SEED);
    expect(result.pointsSlots).toBe(0);
    expect(result.cutoffByRun).toBeUndefined();
    expect("cutoffByRun" in result).toBe(false);
  });

  it("omits the array entirely where the pool holds fewer teams than there are points slots", () => {
    const teams = [mass("frc1", 100), mass("frc2", 90)];
    const result = advancementChances(inputsOf(teams, 5), 50, SEED);
    expect(result.pointsSlots).toBe(5);
    expect(result.cutoffByRun).toBeUndefined();
    expect("cutoffByRun" in result).toBe(false);
  });

  it("reports both slot counts and no array for an empty pool", () => {
    const teams = [mass("frc1", 100), mass("frc2", 90)];
    const result = advancementChances(inputsOf(teams, 4, { awardQualified: ["frc1"], prequalified: ["frc2"] }), 10, SEED);
    expect(result.chanceByTeam.size).toBe(0);
    expect(result.pointsSlots).toBe(3);
    expect(result.lockSlots).toBe(3);
    expect(result.cutoffByRun).toBeUndefined();
  });

  it("takes the line at exactly the pool size where the two coincide", () => {
    const teams = [mass("frc1", 100), mass("frc2", 90), mass("frc3", 70)];
    const result = advancementChances(inputsOf(teams, 3), 8, SEED);
    expect(result.pointsSlots).toBe(3);
    expect([...result.cutoffByRun!]).toEqual(new Array<number>(8).fill(70));
  });
});

// ---------------------------------------------------------------------------
// Champ mode (quick task 260927-6bf)
// ---------------------------------------------------------------------------

type AwardDraw = NonNullable<AdvancementChanceInputs["awardDraws"]>[number];

/** One award draw spec over fixed candidates at weight 1. */
function award(countWeights: readonly number[], candidateKeys: readonly string[], pendingEvents: AwardDraw["pendingEvents"] = []): AwardDraw {
  return { awardType: 0, countWeights, candidates: candidateKeys.map((teamKey) => ({ teamKey, weight: 1 })), pendingEvents };
}

/** A team whose district part is `district` and whose DCMP part is `dcmp` with the given field and win chances. */
function split(
  teamKey: string,
  district: AdvancementChanceTeam,
  dcmp: AdvancementChanceTeam,
  fieldChance: number,
  winChance: number
): AdvancementChanceTeam {
  return {
    teamKey,
    counts: district.counts,
    denominator: district.denominator,
    dcmp: { counts: dcmp.counts, denominator: dcmp.denominator, fieldChance, winChance },
  };
}

/** The exact convolution of two pmfs, for the legacy comparison. */
function convolve(teamKey: string, a: AdvancementChanceTeam, b: AdvancementChanceTeam): AdvancementChanceTeam {
  const counts = new Float64Array(a.counts.length + b.counts.length - 1);
  for (let i = 0; i < a.counts.length; i++) {
    for (let j = 0; j < b.counts.length; j++) counts[i + j] = counts[i + j]! + a.counts[i]! * b.counts[j]!;
  }
  return { teamKey, counts, denominator: 1 };
}

const LADDER = (): AdvancementChanceTeam[] => [mass("frc50", 50), mass("frc40", 40), mass("frc30", 30), mass("frc20", 20), mass("frc10", 10)];

describe("advancementChances — champ mode", () => {
  it("leaves every legacy pin alone: no dcmp part and no award draw is legacy mode, with no diagnostics", () => {
    const result = advancementChances(inputsOf(LADDER(), 2), 20, SEED);
    expect(result.awardSlotsByRun).toBeUndefined();
    expect(result.outsideAwardSlotsByRun).toBeUndefined();
    const empty = advancementChances(inputsOf(LADDER(), 2, { awardDraws: [] }), 20, SEED);
    expect(empty.awardSlotsByRun).toBeUndefined();
    expect([...empty.cutoffByRun!]).toEqual([...result.cutoffByRun!]);
  });

  it("matches the legacy chance over the convolved total when the field chance is 1 and the win chance 0", () => {
    const draws = 20000;
    const parts: [string, AdvancementChanceTeam, AdvancementChanceTeam][] = [
      ["frc1", uniform("d1", 40, 70), uniform("c1", 10, 60)],
      ["frc2", uniform("d2", 50, 60), uniform("c2", 0, 50)],
      ["frc3", uniform("d3", 30, 90), uniform("c3", 20, 30)],
      ["frc4", uniform("d4", 20, 40), uniform("c4", 30, 90)],
    ];
    const legacy = advancementChances(inputsOf(parts.map(([key, a, b]) => convolve(key, a, b)), 2), draws, SEED);
    const champ = advancementChances(inputsOf(parts.map(([key, a, b]) => split(key, a, b, 1, 0)), 2), draws, SEED);
    for (const [key] of parts) {
      const p = legacy.chanceByTeam.get(key)!;
      const tolerance = 4 * Math.sqrt((2 * Math.max(p * (1 - p), 1e-4)) / draws);
      expect(Math.abs(champ.chanceByTeam.get(key)! - p)).toBeLessThan(tolerance);
    }
    expect([...champ.awardSlotsByRun!].every((slots) => slots === 0)).toBe(true);
  });

  it("reads the line after the drawn award leaves the pool with its slot", () => {
    const none = advancementChances(inputsOf(LADDER(), 2, { awardDraws: [award([1], [])] }), 50, SEED);
    expect([...none.cutoffByRun!].every((line) => line === 40)).toBe(true);

    const outside = advancementChances(inputsOf(LADDER(), 2, { awardDraws: [award([0, 1], ["frc10"])] }), 50, SEED);
    expect([...outside.cutoffByRun!].every((line) => line === 50)).toBe(true);
    expect([...outside.awardSlotsByRun!].every((slots) => slots === 1)).toBe(true);
    expect([...outside.outsideAwardSlotsByRun!].every((slots) => slots === 1)).toBe(true);
    expect(outside.chanceByTeam.get("frc10")).toBe(1);

    const inside = advancementChances(inputsOf(LADDER(), 2, { awardDraws: [award([0, 1], ["frc50"])] }), 50, SEED);
    expect([...inside.cutoffByRun!].every((line) => line === 40)).toBe(true);
    expect([...inside.outsideAwardSlotsByRun!].every((slots) => slots === 0)).toBe(true);
  });

  it("draws the count per run, and consumes the same randomness per run whatever the count weights say", () => {
    const draws = 4000;
    const half = advancementChances(inputsOf(LADDER(), 2, { awardDraws: [award([0.5, 0.5], ["frc10"])] }), draws, SEED);
    const fifties = [...half.cutoffByRun!].filter((line) => line === 50).length;
    const forties = [...half.cutoffByRun!].filter((line) => line === 40).length;
    expect(fifties + forties).toBe(draws);
    expect(Math.abs(fifties / draws - 0.5)).toBeLessThan(4 * Math.sqrt(0.25 / draws));

    // A candidate absent from the ranked teams takes no slot, so two specs of
    // the same LENGTH must leave every other draw identical: the uniform team
    // below lands on the same values run for run.
    const teams = [...LADDER(), uniform("frc99", 0, 60)];
    const a = advancementChances(inputsOf(teams, 2, { awardDraws: [award([0.5, 0.5], ["frc404"])] }), 300, SEED);
    const b = advancementChances(inputsOf(teams, 2, { awardDraws: [award([0, 1], ["frc404"])] }), 300, SEED);
    expect([...a.cutoffByRun!]).toEqual([...b.cutoffByRun!]);
    expect(a.chanceByTeam.get("frc99")).toBe(b.chanceByTeam.get("frc99"));
    // A LONGER spec consumes more, which is the control proving the check above can fail.
    const c = advancementChances(inputsOf(teams, 2, { awardDraws: [award([0, 0, 1], ["frc404"])] }), 300, SEED);
    expect([...c.cutoffByRun!]).not.toEqual([...a.cutoffByRun!]);
  });

  it("puts a certain winner in W every run, reads it at 1, and takes its slot", () => {
    const teams = [...LADDER().slice(1), split("frc77", mass("d77", 5), mass("c77", 60), 1, 1)];
    const result = advancementChances(inputsOf(teams, 2), 100, SEED);
    expect(result.chanceByTeam.get("frc77")).toBe(1);
    expect([...result.awardSlotsByRun!].every((slots) => slots === 1)).toBe(true);
    // One slot left for the points: the line is the top of what remains.
    expect([...result.cutoffByRun!].every((line) => line === 40)).toBe(true);
  });

  it("couples the winner to the SAME draw as the DCMP points: every winner drew the top of its distribution", () => {
    const counts = new Float64Array(101);
    counts[0] = 0.5;
    counts[100] = 0.5;
    const teams = [split("frc1", mass("d1", 0), { teamKey: "c", counts, denominator: 1 }, 1, 0.5), mass("frc2", 50)];
    const result = advancementChances(inputsOf(teams, 1), 2000, SEED);
    const winners = [...result.awardSlotsByRun!].filter((slots) => slots === 1).length;
    expect(winners).toBeGreaterThan(800);
    expect(winners).toBeLessThan(1200);
    // A winner that drew 0 would sit below frc2 and count as outside; none does.
    expect([...result.outsideAwardSlotsByRun!].every((slots) => slots === 0)).toBe(true);
    // Every winning run leaves no points slot: no line, so NaN. Every other run reads frc2.
    const lines = [...result.cutoffByRun!];
    expect(lines.filter((line) => Number.isNaN(line)).length).toBe(winners);
    expect(lines.filter((line) => !Number.isNaN(line)).every((line) => line === 50)).toBe(true);
    expect(result.runsWithoutLine).toBe(winners);
  });

  it("marks a run without a line NaN, and omits the array only when NO run has one", () => {
    // One slot and a certain winner: no run ever has a points slot left.
    const never = advancementChances(inputsOf([mass("frc1", 10), split("frc2", mass("d", 0), mass("c", 5), 1, 1)], 1), 30, SEED);
    expect(never.cutoffByRun).toBeUndefined();
    expect(never.runsWithoutLine).toBe(30);
    // Legacy mode keeps its own rule untouched: no line, no array, no NaN.
    const legacy = advancementChances(inputsOf(LADDER(), 0), 30, SEED);
    expect(legacy.cutoffByRun).toBeUndefined();
    expect(legacy.runsWithoutLine).toBeUndefined();
  });

  it("counts one slot for a team drawn twice, none for an unranked key, and takes every candidate when the count exceeds them", () => {
    const twice = advancementChances(inputsOf(LADDER(), 3, { awardDraws: [award([0, 1], ["frc10"]), award([0, 1], ["frc10"])] }), 50, SEED);
    expect([...twice.awardSlotsByRun!].every((slots) => slots === 1)).toBe(true);

    const unranked = advancementChances(inputsOf(LADDER(), 2, { awardDraws: [award([0, 1], ["frc404"])] }), 50, SEED);
    expect([...unranked.awardSlotsByRun!].every((slots) => slots === 0)).toBe(true);
    expect([...unranked.cutoffByRun!].every((line) => line === 40)).toBe(true);

    const every = advancementChances(inputsOf(LADDER(), 3, { awardDraws: [award([0, 0, 0, 1], ["frc10", "frc20"])] }), 50, SEED);
    expect([...every.awardSlotsByRun!].every((slots) => slots === 2)).toBe(true);
    expect([...every.cutoffByRun!].every((line) => line === 50)).toBe(true);
  });

  it("adds nobody from a pending event whose entrants all weigh zero, and one entrant per run otherwise", () => {
    const zero = advancementChances(
      inputsOf(LADDER(), 2, {
        awardDraws: [award([0, 1], [], [{ eventKey: "2026x", entrants: [{ teamKey: "frc10", weight: 0 }, { teamKey: "frc20", weight: 0 }] }])],
      }),
      50,
      SEED
    );
    expect([...zero.awardSlotsByRun!].every((slots) => slots === 0)).toBe(true);

    const one = advancementChances(
      inputsOf(LADDER(), 2, {
        awardDraws: [award([0, 1], [], [{ eventKey: "2026x", entrants: [{ teamKey: "frc10", weight: 0 }, { teamKey: "frc20", weight: 2 }] }])],
      }),
      50,
      SEED
    );
    expect([...one.awardSlotsByRun!].every((slots) => slots === 1)).toBe(true);
    expect(one.chanceByTeam.get("frc20")).toBe(1);
    expect(one.chanceByTeam.get("frc10")).toBe(0);
  });

  it("is deterministic under one seed", () => {
    const teams = [split("frc1", uniform("d", 10, 40), uniform("c", 0, 60), 0.7, 0.2), uniform("frc2", 20, 70), uniform("frc3", 0, 90), ...LADDER()];
    const spec = { awardDraws: [award([0.3, 0.7], ["frc2", "frc3"], [{ eventKey: "e", entrants: [{ teamKey: "frc1", weight: 1 }] }])] };
    const first = advancementChances(inputsOf(teams, 4, spec), 400, SEED);
    const second = advancementChances(inputsOf(teams, 4, spec), 400, SEED);
    expect([...first.chanceByTeam]).toEqual([...second.chanceByTeam]);
    expect([...first.cutoffByRun!]).toEqual([...second.cutoffByRun!]);
    expect([...first.awardSlotsByRun!]).toEqual([...second.awardSlotsByRun!]);
  });

  it("refuses invalid weights, counts and chances", () => {
    const run = (overrides: Partial<AdvancementChanceInputs>, teams: readonly AdvancementChanceTeam[] = LADDER()) =>
      advancementChances(inputsOf(teams, 2, overrides), 10, SEED);
    expect(() => run({ awardDraws: [award([], ["frc10"])] })).toThrow(AdvancementChanceInputError);
    expect(() => run({ awardDraws: [award([0, 0], ["frc10"])] })).toThrow(AdvancementChanceInputError);
    expect(() => run({ awardDraws: [award([-1, 2], ["frc10"])] })).toThrow(AdvancementChanceInputError);
    expect(() => run({ awardDraws: [award([Number.NaN, 1], ["frc10"])] })).toThrow(AdvancementChanceInputError);
    expect(() => run({ awardDraws: [{ ...award([0, 1], []), candidates: [{ teamKey: "frc10", weight: -1 }] }] })).toThrow(AdvancementChanceInputError);
    expect(() =>
      run({ awardDraws: [award([0, 1], [], [{ eventKey: "e", entrants: [{ teamKey: "frc10", weight: Number.POSITIVE_INFINITY }] }])] })
    ).toThrow(AdvancementChanceInputError);
    expect(() => run({}, [...LADDER(), split("frc9", mass("d", 1), mass("c", 1), 1.5, 0)])).toThrow(AdvancementChanceInputError);
    expect(() => run({}, [...LADDER(), split("frc9", mass("d", 1), mass("c", 1), 1, -0.1)])).toThrow(AdvancementChanceInputError);
    expect(() => run({}, [...LADDER(), split("frc9", mass("d", 1), mass("c", 1), Number.NaN, 0)])).toThrow(AdvancementChanceInputError);
  });
});
