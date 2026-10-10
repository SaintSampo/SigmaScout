/**
 * `pooledLockInputs.ts`'s adapter contract. Pure and synthetic: this module
 * reads no artifact and no corpus, so every case here is a handful of event
 * keys and four booleans.
 *
 * THE CASES THAT MATTER MOST are the two zero cases. A district whose events
 * have all finished must produce a pool of exactly zero and an EMPTY
 * `hasRemainingEvent`, because that pair is what makes a finished season's
 * verdicts identical with and without the pooled argument — and "identical"
 * is the claim that licensed shipping this without republishing 109 artifacts.
 */
import { describe, expect, it } from "vitest";
import { pooledLockInputs, type PooledTeamEntry } from "./pooledLockInputs.js";
import { PLAYOFF_POOL, SELECTION_POOL, awardPool, qualificationPool } from "./pointPool.js";
import { ALL_CATEGORIES_OPEN, type DistrictCategoryFinality } from "./reservedSlots.js";

const ALL_FINAL: DistrictCategoryFinality = { qual: true, alliance: true, elim: true, award: true };

function entry(teamKey: string, rookie: boolean, events: readonly [string, DistrictCategoryFinality][]): PooledTeamEntry {
  return { teamKey, rookie, events: events.map(([eventKey, final]) => ({ eventKey, final })) };
}

/** `count` veterans all entered in the same events. */
function roster(count: number, events: readonly [string, DistrictCategoryFinality][], rookies = 0): PooledTeamEntry[] {
  return Array.from({ length: count }, (_, index) => entry(`frc${String(index + 1)}`, index < rookies, events));
}

describe("pooledLockInputs", () => {
  it("prices one wholly unplayed event at its whole four-category pool", () => {
    const result = pooledLockInputs(roster(40, [["e1", ALL_CATEGORIES_OPEN]]));
    expect(result.remainingPoints).toBe(qualificationPool(40) + SELECTION_POOL + PLAYOFF_POOL + awardPool(0));
    expect(result.byEvent).toEqual([{ eventKey: "e1", fieldSize: 40, rookieCount: 0, points: result.remainingPoints }]);
  });

  it("counts the attending rookies, which is the only thing that moves the award pool", () => {
    const none = pooledLockInputs(roster(40, [["e1", ALL_CATEGORIES_OPEN]], 0));
    const one = pooledLockInputs(roster(40, [["e1", ALL_CATEGORIES_OPEN]], 1));
    const two = pooledLockInputs(roster(40, [["e1", ALL_CATEGORIES_OPEN]], 2));
    expect(one.remainingPoints - none.remainingPoints).toBe(awardPool(1) - awardPool(0));
    expect(two.remainingPoints - one.remainingPoints).toBe(awardPool(2) - awardPool(1));
    expect(two.byEvent[0]!.rookieCount).toBe(2);
  });

  it("sums over every district-tier event the district carries", () => {
    const teams = [
      entry("frc1", false, [
        ["e1", ALL_CATEGORIES_OPEN],
        ["e2", ALL_CATEGORIES_OPEN],
      ]),
      entry("frc2", false, [["e1", ALL_CATEGORIES_OPEN]]),
      entry("frc3", false, [["e2", ALL_CATEGORIES_OPEN]]),
    ];
    const result = pooledLockInputs(teams);
    expect(result.byEvent.map((e) => [e.eventKey, e.fieldSize])).toEqual([
      ["e1", 2],
      ["e2", 2],
    ]);
    expect(result.remainingPoints).toBe(result.byEvent.reduce((sum, e) => sum + e.points, 0));
  });

  it("returns a pool of zero and an empty remaining set for a district whose events have all finished", () => {
    const result = pooledLockInputs(
      roster(40, [
        ["e1", ALL_FINAL],
        ["e2", ALL_FINAL],
      ])
    );
    expect(result.remainingPoints).toBe(0);
    expect([...result.hasRemainingEvent]).toEqual([]);
    expect(result.byEvent.every((e) => e.points === 0)).toBe(true);
  });

  it("returns a pool of zero for an empty district", () => {
    const result = pooledLockInputs([]);
    expect(result.remainingPoints).toBe(0);
    expect([...result.hasRemainingEvent]).toEqual([]);
    expect(result.byEvent).toEqual([]);
  });

  it("puts a team in hasRemainingEvent when ANY of its events has ANY open category", () => {
    const teams = [
      entry("done", false, [["finished", ALL_FINAL]]),
      entry("awardPending", false, [
        ["finished", ALL_FINAL],
        ["awaitingAward", { ...ALL_FINAL, award: false }],
      ]),
      entry("ahead", false, [["upcoming", ALL_CATEGORIES_OPEN]]),
    ];
    const result = pooledLockInputs(teams);
    expect(result.hasRemainingEvent.has("done")).toBe(false);
    expect(result.hasRemainingEvent.has("awardPending")).toBe(true);
    expect(result.hasRemainingEvent.has("ahead")).toBe(true);
  });

  it("prices a part played event at only its open categories", () => {
    const partPlayed: DistrictCategoryFinality = { qual: true, alliance: true, elim: false, award: false };
    const result = pooledLockInputs(roster(36, [["e1", partPlayed]]));
    expect(result.remainingPoints).toBe(PLAYOFF_POOL + awardPool(0));
  });

  it("takes the FIRST finality seen for an event, matching every other per-event derivation", () => {
    // Two teams disagreeing about one event's stage cannot arise from a real
    // artifact, but the answer must be deterministic when it does.
    const teams = [entry("frc1", false, [["e1", ALL_FINAL]]), entry("frc2", false, [["e1", ALL_CATEGORIES_OPEN]])];
    const result = pooledLockInputs(teams);
    expect(result.remainingPoints).toBe(0);
    expect([...result.hasRemainingEvent]).toEqual([]);
  });

  it("counts a team once per event however many times it appears", () => {
    const teams = [
      entry("frc1", true, [
        ["e1", ALL_CATEGORIES_OPEN],
        ["e1", ALL_CATEGORIES_OPEN],
      ]),
    ];
    const result = pooledLockInputs(teams);
    expect(result.byEvent).toHaveLength(1);
    expect(result.byEvent[0]!.fieldSize).toBe(1);
    expect(result.byEvent[0]!.rookieCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Quick task 261009-uhb: the pool nets out the playoff points an event has
// already handed out and that are already counted in team floors.
// ---------------------------------------------------------------------------

describe("pooledLockInputs nets out the playoff points already in floors (261009-uhb)", () => {
  /** Qualification and alliance selection final, Playoffs and awards open: a playoff round stop. */
  const OPEN_PLAYOFFS: DistrictCategoryFinality = { qual: true, alliance: true, elim: false, award: false };
  /** Only the Playoffs category open. */
  const ONLY_PLAYOFFS_OPEN: DistrictCategoryFinality = { qual: true, alliance: true, elim: false, award: true };
  /** Playoffs final, awards open: the stop after the last playoff match. */
  const PLAYOFFS_FINAL: DistrictCategoryFinality = { qual: true, alliance: true, elim: true, award: false };

  it("takes 60 settled playoff points off an event whose Playoffs category is open", () => {
    const result = pooledLockInputs(roster(36, [["e1", OPEN_PLAYOFFS]]), new Map([["e1", 60]]));
    const expected = PLAYOFF_POOL + awardPool(0) - 60;
    expect(result.remainingPoints).toBe(expected);
    expect(result.byEvent).toEqual([{ eventKey: "e1", fieldSize: 36, rookieCount: 0, points: expected }]);
    // Netting moves the size of the pool and nothing else: every team can still collect.
    expect(result.hasRemainingEvent.size).toBe(36);
  });

  it("never nets more than the playoff pool, so the award pool stays whole", () => {
    const teams = roster(36, [["e1", OPEN_PLAYOFFS]]);
    expect(pooledLockInputs(teams, new Map([["e1", PLAYOFF_POOL]])).remainingPoints).toBe(awardPool(0));
    expect(pooledLockInputs(teams, new Map([["e1", 500]])).remainingPoints).toBe(awardPool(0));
  });

  it("never goes below zero where the Playoffs category is the only one open", () => {
    const result = pooledLockInputs(roster(36, [["e1", ONLY_PLAYOFFS_OPEN]]), new Map([["e1", 500]]));
    expect(result.remainingPoints).toBe(0);
    expect(result.byEvent[0]!.points).toBe(0);
  });

  it("is identical to the one argument call when the input is absent, empty or keyed by an event no team carries", () => {
    const rosters: PooledTeamEntry[][] = [
      roster(40, [
        ["e1", ALL_CATEGORIES_OPEN],
        ["e2", ALL_CATEGORIES_OPEN],
      ]),
      roster(36, [
        ["e1", OPEN_PLAYOFFS],
        ["e2", ALL_FINAL],
      ]),
      roster(40, [
        ["e1", ALL_FINAL],
        ["e2", ALL_FINAL],
      ]),
    ];
    for (const teams of rosters) {
      const today = pooledLockInputs(teams);
      expect(pooledLockInputs(teams, undefined)).toEqual(today);
      expect(pooledLockInputs(teams, new Map())).toEqual(today);
      expect(pooledLockInputs(teams, new Map([["elsewhere", 60]]))).toEqual(today);
    }
  });

  it("nets nothing once the Playoffs category is final at the position", () => {
    // The whole playoff pool has already left the remaining pool, so there is
    // nothing of it left to take the settled points off.
    const result = pooledLockInputs(roster(36, [["e1", PLAYOFFS_FINAL]]), new Map([["e1", 60]]));
    expect(result.remainingPoints).toBe(awardPool(0));
  });

  it("subtracts nothing for an amount of 0, a negative amount, NaN or Infinity, and never throws", () => {
    const teams = roster(36, [["e1", OPEN_PLAYOFFS]]);
    const whole = PLAYOFF_POOL + awardPool(0);
    for (const amount of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(pooledLockInputs(teams, new Map([["e1", amount]])).remainingPoints).toBe(whole);
    }
  });

  it("nets each event by its own amount and leaves an event with no amount whole", () => {
    const teams = roster(36, [
      ["e1", OPEN_PLAYOFFS],
      ["e2", OPEN_PLAYOFFS],
    ]);
    const result = pooledLockInputs(teams, new Map([["e1", 60]]));
    const whole = PLAYOFF_POOL + awardPool(0);
    expect(result.byEvent).toEqual([
      { eventKey: "e1", fieldSize: 36, rookieCount: 0, points: whole - 60 },
      { eventKey: "e2", fieldSize: 36, rookieCount: 0, points: whole },
    ]);
    expect(result.remainingPoints).toBe(result.byEvent.reduce((sum, e) => sum + e.points, 0));
  });
});
