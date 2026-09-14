/**
 * The walk-forward mean shift's accumulator: the observed population,
 * observe-before-fold residuals, the 200 warmup, fully-warm application and
 * the state round trip.
 */
import { describe, expect, it } from "vitest";
import type { MatchResult } from "../algorithms/types.js";
import { rp2020 } from "./2020.js";
import { rp2026 } from "./2026.js";
import { RpMomentsAccumulator } from "./empiricalMoments.js";
import { RP_MEAN_SHIFT_WARMUP_OBSERVATIONS, RpMeanShiftAccumulator, rosterIsFullyWarm, type RpMeanShiftState } from "./meanShift.js";

const RED = ["frc1", "frc2", "frc3"];
const BLUE = ["frc4", "frc5", "frc6"];

function breakdown2020(red: number, blue: number): string {
  return JSON.stringify({
    red: { endgamePoints: red, shieldOperationalRankingPoint: red >= 65 },
    blue: { endgamePoints: blue, shieldOperationalRankingPoint: blue >= 65 },
  });
}

function match(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    matchKey: "2020test_qm1",
    eventKey: "2020test",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 1,
    redTeams: RED,
    blueTeams: BLUE,
    redSurrogates: [],
    blueSurrogates: [],
    redDqs: [],
    blueDqs: [],
    eventType: 0,
    week: null,
    winner: "red",
    redScore: 100,
    blueScore: 90,
    redRpEarned: null,
    blueRpEarned: null,
    hasScoreBreakdown: true,
    scoreBreakdownRaw: breakdown2020(40, 25),
    ...overrides,
  };
}

/** Beliefs with every team on both rosters warm. */
function warmBeliefs(): RpMomentsAccumulator {
  const beliefs = new RpMomentsAccumulator(rp2020);
  beliefs.fold(RED, { endgamePoints: 30 });
  beliefs.fold(BLUE, { endgamePoints: 45 });
  beliefs.fold(RED, { endgamePoints: 36 });
  beliefs.fold(BLUE, { endgamePoints: 60 });
  return beliefs;
}

function stateOf(count: number, sum: number): RpMeanShiftState {
  return { season: 2020, variables: { endgamePoints: { count, sum } } };
}

describe("RP_MEAN_SHIFT_WARMUP_OBSERVATIONS and apply", () => {
  it("is 200", () => {
    expect(RP_MEAN_SHIFT_WARMUP_OBSERVATIONS).toBe(200);
  });

  it("returns the SAME moments object at 199 observations", () => {
    const moments = warmBeliefs().momentsFor(RED, 100, 400);
    const shift = RpMeanShiftAccumulator.fromState(rp2020, stateOf(199, 199 * 3));
    expect(shift.toState()).toEqual(stateOf(199, 199 * 3));
    expect(shift.apply(moments, true)).toBe(moments);
  });

  it("shifts only the mean by sum/count at 200, leaving every other block identical", () => {
    const moments = warmBeliefs().momentsFor(RED, 100, 400);
    const shift = RpMeanShiftAccumulator.fromState(rp2020, stateOf(200, 500));
    const out = shift.apply(moments, true);
    expect(out).not.toBe(moments);
    expect(out.meanVector).toEqual([moments.meanVector[0]! + 2.5]);
    expect(out.variableNames).toBe(moments.variableNames);
    expect(out.varianceBlock).toBe(moments.varianceBlock);
    expect(out.scoreMean).toBe(moments.scoreMean);
    expect(out.scoreVariance).toBe(moments.scoreVariance);
    expect(out.scoreCrossCovariance).toBe(moments.scoreCrossCovariance);
    // The input is never mutated.
    expect(moments.meanVector).toEqual(warmBeliefs().momentsFor(RED, 100, 400).meanVector);
  });

  it("returns the same object when fullyWarm is false, whatever the counts", () => {
    const moments = warmBeliefs().momentsFor(RED, 100, 400);
    for (const count of [0, 199, 200, 10_000]) {
      expect(RpMeanShiftAccumulator.fromState(rp2020, stateOf(count, count)).apply(moments, false)).toBe(moments);
    }
  });

  it("shifts only the variables past warmup in a multi-variable season", () => {
    const beliefs = new RpMomentsAccumulator(rp2026);
    beliefs.fold(RED, { hubTotalCount: 90, totalTowerPoints: 30 });
    const moments = beliefs.momentsFor(RED, 100, 400);
    const shift = RpMeanShiftAccumulator.fromState(rp2026, {
      season: 2026,
      variables: { hubTotalCount: { count: 250, sum: 1000 }, totalTowerPoints: { count: 150, sum: 900 } },
    });
    const out = shift.apply(moments, true);
    const hub = moments.variableNames.indexOf("hubTotalCount");
    const tower = moments.variableNames.indexOf("totalTowerPoints");
    expect(out.meanVector[hub]).toBe(moments.meanVector[hub]! + 4);
    expect(out.meanVector[tower]).toBe(moments.meanVector[tower]);
  });
});

describe("rosterIsFullyWarm", () => {
  it("is true only when every roster team has history, and false for an empty roster", () => {
    const beliefs = warmBeliefs();
    expect(rosterIsFullyWarm(beliefs, RED)).toBe(true);
    expect(rosterIsFullyWarm(beliefs, ["frc1", "frc2", "frc99"])).toBe(false);
    expect(rosterIsFullyWarm(beliefs, [])).toBe(false);
  });
});

describe("observeMatch", () => {
  it("adds nothing to either side for an elimination match, an offseason event type, a missing breakdown, or a side that fails to parse", () => {
    const cases: Partial<MatchResult>[] = [
      { compLevel: "qf" },
      { compLevel: "f" },
      { eventType: 99 },
      { hasScoreBreakdown: false, scoreBreakdownRaw: null },
      { hasScoreBreakdown: true, scoreBreakdownRaw: null },
      { scoreBreakdownRaw: "{not json" },
      { scoreBreakdownRaw: JSON.stringify({ red: { endgamePoints: 40, shieldOperationalRankingPoint: false }, blue: { endgamePoints: 25 } }) },
      { scoreBreakdownRaw: JSON.stringify({ red: { endgamePoints: "40", shieldOperationalRankingPoint: false }, blue: { endgamePoints: 25, shieldOperationalRankingPoint: false } }) },
    ];
    for (const overrides of cases) {
      const shift = new RpMeanShiftAccumulator(rp2020);
      shift.observeMatch(warmBeliefs(), match(overrides));
      expect(shift.toState(), JSON.stringify(overrides)).toEqual(stateOf(0, 0));
    }
  });

  it("a side with any roster team lacking history adds nothing, while a warm side still counts", () => {
    const beliefs = new RpMomentsAccumulator(rp2020);
    beliefs.fold(RED, { endgamePoints: 30 });
    beliefs.fold(["frc4", "frc5"], { endgamePoints: 40 });
    const shift = new RpMeanShiftAccumulator(rp2020);
    shift.observeMatch(beliefs, match({ scoreBreakdownRaw: breakdown2020(40, 25) }));
    expect(shift.toState()).toEqual(stateOf(1, 40 - beliefs.momentsFor(RED, 0, 0).meanVector[0]!));
  });

  it("a fully-warm side adds observed minus the unshifted mean read before the fold", () => {
    const beliefs = warmBeliefs();
    const redMean = beliefs.momentsFor(RED, 0, 0).meanVector[0]!;
    const blueMean = beliefs.momentsFor(BLUE, 0, 0).meanVector[0]!;
    // Even a shift already past warmup does not move the residual's reference mean.
    const shift = RpMeanShiftAccumulator.fromState(rp2020, stateOf(300, 3000));
    shift.observeMatch(beliefs, match({ scoreBreakdownRaw: breakdown2020(50, 20) }));
    const state = shift.toState().variables.endgamePoints!;
    expect(state.count).toBe(302);
    expect(state.sum).toBe(3000 + (50 - redMean) + (20 - blueMean));

    // Observing after the fold would read a different mean: the order is load-bearing.
    const afterFold = warmBeliefs();
    afterFold.fold(RED, { endgamePoints: 50 });
    expect(afterFold.momentsFor(RED, 0, 0).meanVector[0]).not.toBe(redMean);
  });
});

describe("toState and fromState", () => {
  it("round-trips in the same season, including a variable with count 0", () => {
    const beliefs = new RpMomentsAccumulator(rp2026);
    const roster = RED;
    beliefs.fold(roster, { hubTotalCount: 90, totalTowerPoints: 30 });
    beliefs.fold(BLUE, { hubTotalCount: 70, totalTowerPoints: 20 });
    const shift = new RpMeanShiftAccumulator(rp2026);
    const raw = JSON.stringify({
      red: { autoTowerPoints: 10, endGameTowerPoints: 15, hubScore: { totalCount: 120 }, energizedAchieved: true, superchargedAchieved: false, traversalAchieved: false },
      blue: { autoTowerPoints: 5, endGameTowerPoints: 5, hubScore: { totalCount: 60 }, energizedAchieved: false, superchargedAchieved: false, traversalAchieved: false },
    });
    shift.observeMatch(beliefs, match({ matchKey: "2026test_qm1", eventKey: "2026test", scoreBreakdownRaw: raw }));
    const state = shift.toState();
    expect(state.season).toBe(2026);
    expect(Object.keys(state.variables).sort()).toEqual(["hubTotalCount", "totalTowerPoints"]);
    expect(state.variables.hubTotalCount!.count).toBe(2);

    const zeroed: RpMeanShiftState = { ...state, variables: { ...state.variables, totalTowerPoints: { count: 0, sum: 0 } } };
    expect(RpMeanShiftAccumulator.fromState(rp2026, state).toState()).toEqual(state);
    expect(RpMeanShiftAccumulator.fromState(rp2026, zeroed).toState()).toEqual(zeroed);
  });

  it("returns a fresh accumulator for another season, undefined, or a malformed entry", () => {
    const fresh = new RpMeanShiftAccumulator(rp2020).toState();
    expect(fresh).toEqual(stateOf(0, 0));
    expect(RpMeanShiftAccumulator.fromState(rp2020, { season: 2019, variables: { endgamePoints: { count: 250, sum: 9 } } }).toState()).toEqual(fresh);
    expect(RpMeanShiftAccumulator.fromState(rp2020, undefined).toState()).toEqual(fresh);
    const malformed = [
      { season: 2020, variables: { endgamePoints: { count: 1.5, sum: 2 } } },
      { season: 2020, variables: { endgamePoints: { count: -1, sum: 2 } } },
      { season: 2020, variables: { endgamePoints: { count: 3, sum: Number.NaN } } },
      { season: 2020, variables: { endgamePoints: { count: 3, sum: Number.POSITIVE_INFINITY } } },
      { season: 2020, variables: { endgamePoints: null } },
      { season: 2020, variables: null },
    ];
    for (const state of malformed) {
      expect(RpMeanShiftAccumulator.fromState(rp2020, state as unknown as RpMeanShiftState).toState(), JSON.stringify(state)).toEqual(fresh);
    }
  });

  it("drops an undeclared variable and starts an absent declared one at zero", () => {
    const state = { season: 2020, variables: { retiredVariable: { count: 400, sum: 9 } } };
    expect(RpMeanShiftAccumulator.fromState(rp2020, state).toState()).toEqual(stateOf(0, 0));
  });

  it("toState is a snapshot: mutating it never reaches the accumulator", () => {
    const shift = RpMeanShiftAccumulator.fromState(rp2020, stateOf(5, 10));
    const snap = shift.toState() as { variables: Record<string, { count: number; sum: number }> };
    snap.variables.endgamePoints!.count = 9999;
    expect(shift.toState()).toEqual(stateOf(5, 10));
  });
});
