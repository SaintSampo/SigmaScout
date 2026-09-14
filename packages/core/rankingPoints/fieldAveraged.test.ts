/**
 * Tests for the field-averaged pre-schedule predictor. Every expectation is a
 * hand-computed literal, never pasted from the implementation's output.
 */
import { describe, expect, it } from "vitest";
import {
  ALLIANCE_SIZE,
  InvalidMatchesPerTeamError,
  fieldAveragedAllianceMoments,
  fieldAveragedMatchPmf,
  fieldAveragedRankInputs,
  fieldStatistics,
  seasonTotalPmf,
  type FieldStatistics,
  type FieldTeamContribution,
} from "./fieldAveraged.js";
import { allianceBonusRpPmf, matchOutcomeDistribution, pmfMean } from "./analyticPmf.js";
import { RP_RULE_MODULES } from "./rules.js";
import { simulateRanks, mulberry32 } from "../algorithms/simulation/rankSimulation.js";

/** 2023 — two threshold variables (`totalChargeStationPoints`, `linkPoints`), `winRp` 2, `tieRp` 1. Small enough to reason about by hand. */
const RULE_2023 = RP_RULE_MODULES[2023]!;
/** TBA `event_type` 0 = Regional — RP-eligible ("base" tier). */
const REGIONAL_EVENT_TYPE = 0;

const ONE_VARIABLE = ["x"] as const;

function contribution(
  teamKey: string,
  variableMeans: readonly number[],
  variableVariances: readonly number[],
  scoreMean: number,
  bandVariance: number
): FieldTeamContribution {
  return { teamKey, variableMeans, variableVariances, scoreMean, bandVariance };
}

/** The hand-computed three-team field Tests 1 and 2 share. */
const THREE_TEAM_FIELD: readonly FieldTeamContribution[] = [
  contribution("frc1", [10], [1], 40, 4),
  contribution("frc2", [20], [2], 50, 9),
  contribution("frc3", [30], [3], 60, 16),
];

describe("fieldStatistics", () => {
  it("Test 1 — computes the hand-computed statistics of a three-team field, with POPULATION variance", () => {
    const stats = fieldStatistics(THREE_TEAM_FIELD, ONE_VARIABLE);

    expect(stats.teamCount).toBe(3);
    expect(stats.variableNames).toEqual(["x"]);
    // (10 + 20 + 30) / 3
    expect(stats.meanOfVariableMeans[0]).toBeCloseTo(20, 12);
    // (1 + 2 + 3) / 3
    expect(stats.meanOfVariableVariances[0]).toBeCloseTo(2, 12);
    // POPULATION variance: ((10-20)^2 + 0 + (30-20)^2) / 3 = 200/3
    expect(stats.varianceOfVariableMeans[0]).toBeCloseTo(200 / 3, 12);
    // Dividing by n-1 would give 100; asserted in both directions so a
    // sample-variance implementation cannot pass.
    expect(stats.varianceOfVariableMeans[0]).not.toBeCloseTo(100, 6);
    // (40 + 50 + 60) / 3
    expect(stats.meanOfScoreMeans).toBeCloseTo(50, 12);
    // ((40-50)^2 + 0 + (60-50)^2) / 3 = 200/3
    expect(stats.varianceOfScoreMeans).toBeCloseTo(200 / 3, 12);
    expect(stats.varianceOfScoreMeans).not.toBeCloseTo(100, 6);
    // (4 + 9 + 16) / 3
    expect(stats.meanOfBandVariances).toBeCloseTo(29 / 3, 12);
  });

  it("throws on an empty roster rather than returning NaN statistics", () => {
    expect(() => fieldStatistics([], ONE_VARIABLE)).toThrow(/empty roster/);
  });
});

describe("fieldAveragedAllianceMoments", () => {
  it("Test 2 — builds the hand-computed moments for the middle team of the three-team field", () => {
    expect(ALLIANCE_SIZE).toBe(3);
    const stats = fieldStatistics(THREE_TEAM_FIELD, ONE_VARIABLE);
    const { own, opponent } = fieldAveragedAllianceMoments(THREE_TEAM_FIELD[1]!, stats);

    // own meanVector = variableMeans + (A-1) * meanOfVariableMeans = 20 + 2*20
    expect(own.meanVector[0]).toBeCloseTo(60, 12);
    // own variance = A*(ownVar + (A-1)*meanOfVars) + (A-1)*varianceOfMeans
    //             = 3*(2 + 2*2) + 2*(200/3) = 18 + 400/3
    expect(own.varianceBlock[0]![0]!).toBeCloseTo(18 + 400 / 3, 12);
    // opponent meanVector = A * meanOfVariableMeans = 3*20
    expect(opponent.meanVector[0]).toBeCloseTo(60, 12);
    // opponent variance = A*(A*meanOfVars) + A*varianceOfMeans = 3*(3*2) + 3*(200/3) = 18 + 200
    expect(opponent.varianceBlock[0]![0]!).toBeCloseTo(18 + 200, 12);

    // own scoreMean = 50 + 2*50
    expect(own.scoreMean).toBeCloseTo(150, 12);
    // opponent scoreMean = 3*50
    expect(opponent.scoreMean).toBeCloseTo(150, 12);
    // own scoreVariance = bandVariance + (A-1)*meanOfBandVariances + (A-1)*varianceOfScoreMeans
    //                   = 9 + 2*(29/3) + 2*(200/3)
    expect(own.scoreVariance).toBeCloseTo(9 + 2 * (29 / 3) + 2 * (200 / 3), 12);
    // opponent scoreVariance = A*meanOfBandVariances + A*varianceOfScoreMeans
    expect(opponent.scoreVariance).toBeCloseTo(3 * (29 / 3) + 3 * (200 / 3), 12);

    // Every off-diagonal and cross-covariance entry is exactly zero; `analyticRpPmf` throws on either.
    for (const moments of [own, opponent]) {
      expect(moments.scoreCrossCovariance).toEqual([0]);
      for (let i = 0; i < moments.varianceBlock.length; i++) {
        for (let j = 0; j < moments.varianceBlock.length; j++) {
          if (i !== j) expect(moments.varianceBlock[i]![j]!).toBe(0);
        }
      }
    }
  });

  it("Test 2b — a two-variable field keeps the block strictly diagonal and the cross-covariance all zero", () => {
    const names = RULE_2023.thresholdVariables.map((v) => v.name);
    expect(names.length).toBe(2);
    const roster: FieldTeamContribution[] = [
      contribution("frc1", [10, 4], [1, 0.5], 40, 4),
      contribution("frc2", [20, 8], [2, 1.5], 50, 9),
    ];
    const stats = fieldStatistics(roster, names);
    const { own, opponent } = fieldAveragedAllianceMoments(roster[0]!, stats);
    for (const moments of [own, opponent]) {
      expect(moments.varianceBlock[0]![1]!).toBe(0);
      expect(moments.varianceBlock[1]![0]!).toBe(0);
      expect(moments.scoreCrossCovariance).toEqual([0, 0]);
    }
  });
});

describe("fieldAveragedMatchPmf", () => {
  const names = RULE_2023.thresholdVariables.map((v) => v.name);

  it("Test 3 — an IDENTICAL field is exactly symmetric, and its pmf mean is the even-odds outcome plus the expected bonus", () => {
    const identical = contribution("frcX", [12, 6], [3, 2], 55, 25);
    const roster = ["frc1", "frc2", "frc3", "frc4"].map((key) => ({ ...identical, teamKey: key }));
    const stats = fieldStatistics(roster, names);
    const { own, opponent } = fieldAveragedAllianceMoments(roster[0]!, stats);

    // EXACT equality, entry for entry, on all four moment fields. A tolerance
    // here would let a transposed (A-1)/A factor through, which is otherwise
    // completely invisible in the output.
    expect(own.meanVector).toEqual(opponent.meanVector);
    expect(own.varianceBlock).toEqual(opponent.varianceBlock);
    expect(own.scoreMean).toBe(opponent.scoreMean);
    expect(own.scoreVariance).toBe(opponent.scoreVariance);

    // Every team's pmf is identical, because every team's contribution is.
    const pmfA = fieldAveragedMatchPmf(roster[0]!, stats, RULE_2023, REGIONAL_EVENT_TYPE);
    const pmfB = fieldAveragedMatchPmf(roster[2]!, stats, RULE_2023, REGIONAL_EVENT_TYPE);
    expect(pmfA).toEqual(pmfB);

    // The outcome half plus the expected bonus RP, from the real
    // `matchOutcomeDistribution` and `allianceBonusRpPmf` on the same moments.
    const outcome = matchOutcomeDistribution({
      redScoreMean: own.scoreMean,
      redScoreVariance: own.scoreVariance,
      blueScoreMean: opponent.scoreMean,
      blueScoreVariance: opponent.scoreVariance,
      winRp: RULE_2023.winRp,
      tieRp: RULE_2023.tieRp,
    });
    // `pTie` is nonzero, so the decisive split is not 0.5, but it is exactly
    // even between red and blue, the property this test is for.
    expect(outcome.pRedWin).toBe(outcome.pBlueWin);
    expect(outcome.pRedWin).toBeCloseTo((1 - outcome.pTie) / 2, 12);
    const expectedBonusRp = pmfMean(allianceBonusRpPmf(own, RULE_2023, REGIONAL_EVENT_TYPE).pmf);
    const expectedMean = RULE_2023.winRp * outcome.pRedWin + RULE_2023.tieRp * outcome.pTie + expectedBonusRp;
    expect(pmfMean(pmfA)).toBeCloseTo(expectedMean, 10);
  });

  it("Test 4 — all variances zero degenerates to a point mass at the index analyticRpPmf would place it", () => {
    // `FieldStatistics` is built by hand: it is the only way to hold every
    // variance at zero while the team's score mean differs from the field's.
    const zeroStats: FieldStatistics = {
      variableNames: names,
      teamCount: 4,
      meanOfVariableMeans: [5, 2],
      meanOfVariableVariances: [0, 0],
      varianceOfVariableMeans: [0, 0],
      meanOfScoreMeans: 40,
      varianceOfScoreMeans: 0,
      meanOfBandVariances: 0,
    };
    const strong = contribution("frcStrong", [5, 2], [0, 0], 90, 0);
    const pmf = fieldAveragedMatchPmf(strong, zeroStats, RULE_2023, REGIONAL_EVENT_TYPE);

    const nonZero = [...pmf].map((p, i) => ({ p, i })).filter(({ p }) => p !== 0);
    expect(nonZero.length).toBe(1);
    expect(nonZero[0]!.p).toBeCloseTo(1, 12);

    // The index `analyticRpPmf` would place it at: a certain win (the team's
    // 90 against the field's 3*40/3 average side — see below) plus whichever
    // bonuses the degenerate marginals make certain.
    const { own, opponent } = fieldAveragedAllianceMoments(strong, zeroStats);
    expect(own.scoreMean).toBeGreaterThan(opponent.scoreMean);
    const certainBonus = allianceBonusRpPmf(own, RULE_2023, REGIONAL_EVENT_TYPE).pmf;
    const bonusIndex = [...certainBonus].findIndex((p) => p > 0.5);
    expect(nonZero[0]!.i).toBe(RULE_2023.winRp + bonusIndex);
  });

  it("Test 5 — a strictly higher own score mean strictly raises the pmf mean", () => {
    // (a) Statistics held fixed, only the team's own score mean moved: a sign
    // error here inverts the favourite everywhere with plausible output.
    const stats: FieldStatistics = {
      variableNames: names,
      teamCount: 20,
      meanOfVariableMeans: [12, 6],
      meanOfVariableVariances: [3, 2],
      varianceOfVariableMeans: [4, 1],
      meanOfScoreMeans: 50,
      varianceOfScoreMeans: 36,
      meanOfBandVariances: 25,
    };
    const lower = contribution("frcT", [12, 6], [3, 2], 45, 25);
    const higher = { ...lower, scoreMean: 65 };
    const meanLower = pmfMean(fieldAveragedMatchPmf(lower, stats, RULE_2023, REGIONAL_EVENT_TYPE));
    const meanHigher = pmfMean(fieldAveragedMatchPmf(higher, stats, RULE_2023, REGIONAL_EVENT_TYPE));
    expect(meanHigher).toBeGreaterThan(meanLower);

    // (b) The same property through the REAL path, where raising one team's
    // score also moves the field mean and the field's score spread. On a
    // 20-team roster the own-score term dominates both, which is the property
    // the shipped path actually relies on.
    const base = contribution("frcT", [12, 6], [3, 2], 45, 25);
    const roster = Array.from({ length: 20 }, (_, i) => ({ ...base, teamKey: `frc${i + 1}`, scoreMean: 45 + i }));
    const raised = roster.map((c, i) => (i === 0 ? { ...c, scoreMean: 80 } : c));
    const statsBase = fieldStatistics(roster, names);
    const statsRaised = fieldStatistics(raised, names);
    const realLower = pmfMean(fieldAveragedMatchPmf(roster[0]!, statsBase, RULE_2023, REGIONAL_EVENT_TYPE));
    const realHigher = pmfMean(fieldAveragedMatchPmf(raised[0]!, statsRaised, RULE_2023, REGIONAL_EVENT_TYPE));
    expect(realHigher).toBeGreaterThan(realLower);
  });
});

describe("seasonTotalPmf", () => {
  // A hand-written 3-entry per-match pmf: P(0) = 0.2, P(1) = 0.5, P(2) = 0.3.
  const PER_MATCH = [0.2, 0.5, 0.3] as const;

  it("Test 6 — the convolution mean identity, the one-fold identity, the length law and normalisation", () => {
    const total = seasonTotalPmf(PER_MATCH, 12);
    // mean of the per-match pmf = 0*0.2 + 1*0.5 + 2*0.3 = 1.1
    expect(pmfMean(PER_MATCH)).toBeCloseTo(1.1, 12);
    expect(pmfMean(total)).toBeCloseTo(12 * 1.1, 9);
    expect(total.length).toBe(12 * (PER_MATCH.length - 1) + 1);
    expect([...total].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);

    // One fold is the identity.
    expect([...seasonTotalPmf(PER_MATCH, 1)]).toEqual([...PER_MATCH]);

    // The length law at another k.
    expect(seasonTotalPmf(PER_MATCH, 5).length).toBe(5 * 2 + 1);
  });

  it("Test 6b — a non-positive matchesPerTeam throws BY NAME rather than returning the [1] point mass", () => {
    expect(() => seasonTotalPmf(PER_MATCH, 0)).toThrow(InvalidMatchesPerTeamError);
    expect(() => seasonTotalPmf(PER_MATCH, -3)).toThrow(InvalidMatchesPerTeamError);
    expect(() => seasonTotalPmf(PER_MATCH, 1.5)).toThrow(InvalidMatchesPerTeamError);
  });
});

describe("fieldAveragedRankInputs", () => {
  const ROSTER = ["frc1", "frc2", "frc3", "frc4"] as const;
  const PER_TEAM_PMF = [
    [0.2, 0.5, 0.3],
    [0.1, 0.4, 0.5],
    [0.5, 0.3, 0.2],
    [0.3, 0.3, 0.4],
  ] as const;

  it("Test 7 — one solo row per team, zero baselines, no outcome sub-object, and the real simulateRanks accepts it", () => {
    const matchesPerTeam = 9;
    const { matches, baselines } = fieldAveragedRankInputs(ROSTER, PER_TEAM_PMF, matchesPerTeam);

    expect(matches.length).toBe(ROSTER.length);
    expect(baselines.length).toBe(ROSTER.length);
    for (let i = 0; i < ROSTER.length; i++) {
      expect(matches[i]!.redTeamKeys).toEqual([ROSTER[i]]);
      expect(matches[i]!.blueTeamKeys).toEqual([]);
      expect(matches[i]!.blueRpPmf).toEqual([1]);
      expect(matches[i]!.redRpPmf.length).toBe(matchesPerTeam * 2 + 1);
      // No coupled-draw `outcome`: a solo row has no opposing alliance.
      expect(Object.prototype.hasOwnProperty.call(matches[i]!, "outcome")).toBe(false);
      expect(baselines[i]!).toEqual({ teamKey: ROSTER[i], earnedRpSum: 0, matchesPlayed: 0 });
    }

    // The end of the chain, proven against the REAL imported scorer rather
    // than a stub.
    const draws = 500;
    const result = simulateRanks(matches, baselines, draws, mulberry32(12345));
    expect(result.draws).toBe(draws);
    expect(result.rankHistograms.size).toBe(ROSTER.length);
    for (const teamKey of ROSTER) {
      const histogram = result.rankHistograms.get(teamKey)!;
      expect(histogram.length).toBe(ROSTER.length);
      expect([...histogram].reduce((a, b) => a + b, 0)).toBe(draws);
    }
  });

  it("throws when the roster and perTeamPmf index spaces disagree", () => {
    expect(() => fieldAveragedRankInputs(ROSTER, PER_TEAM_PMF.slice(0, 2), 9)).toThrow(/one index space/);
  });
});

describe("the mean shift in the field-averaged moments (quick task 260914-01x, CD-05)", () => {
  it("adds the shift ONCE to each alliance's mean, own and opponent, and moves nothing else (hand-computed)", () => {
    const stats = fieldStatistics(THREE_TEAM_FIELD, ONE_VARIABLE);
    const plain = fieldAveragedAllianceMoments(THREE_TEAM_FIELD[1]!, stats);
    const shifted = fieldAveragedAllianceMoments(THREE_TEAM_FIELD[1]!, stats, [7]);

    // own = 20 + 2*20 + 7; opponent = 3*20 + 7. Once per alliance, not once per team.
    expect(shifted.own.meanVector[0]).toBeCloseTo(67, 12);
    expect(shifted.opponent.meanVector[0]).toBeCloseTo(67, 12);
    for (const side of ["own", "opponent"] as const) {
      expect(shifted[side].varianceBlock).toEqual(plain[side].varianceBlock);
      expect(shifted[side].scoreMean).toBe(plain[side].scoreMean);
      expect(shifted[side].scoreVariance).toBe(plain[side].scoreVariance);
      expect(shifted[side].scoreCrossCovariance).toEqual(plain[side].scoreCrossCovariance);
    }
  });

  it("the absent path is byte-identical to the pre-shift model, in the moments and in the pmf", () => {
    const names = RULE_2023.thresholdVariables.map((v) => v.name);
    const roster: FieldTeamContribution[] = [
      contribution("frc1", [10, 4], [1, 0.5], 40, 4),
      contribution("frc2", [20, 8], [2, 1.5], 50, 9),
    ];
    const stats = fieldStatistics(roster, names);
    expect(JSON.stringify(fieldAveragedAllianceMoments(roster[0]!, stats, undefined))).toBe(JSON.stringify(fieldAveragedAllianceMoments(roster[0]!, stats)));
    const today = fieldAveragedMatchPmf(roster[0]!, stats, RULE_2023, REGIONAL_EVENT_TYPE);
    expect(fieldAveragedMatchPmf(roster[0]!, stats, RULE_2023, REGIONAL_EVENT_TYPE, undefined)).toEqual(today);
    // A positive shift on both variables raises the expected RP (more bonus odds on the own side).
    const shiftedMean = pmfMean(fieldAveragedMatchPmf(roster[0]!, stats, RULE_2023, REGIONAL_EVENT_TYPE, [6, 6]));
    expect(shiftedMean).not.toBe(pmfMean(today));
  });
});
