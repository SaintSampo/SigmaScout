/**
 * Pure unit tests for the phase 8 rank-distribution simulation core
 * (`simulateRanks`, `drawCategorical`, `mulberry32`). Fixtures build real
 * pipeline-produced pmfs via `rpPmfForMatch` (`sigma1/rp/distribution.js`),
 * matching `rp/distribution.test.ts`'s pure-unit shape — no corpus access,
 * no network, in-process only.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SIGMA1_PARAMS, type Sigma1Params } from "../sigma1/params.js";
import { rpPmfForMatch, type RpPmfInput } from "../sigma1/rp/distribution.js";
import { rpRuleModuleForSeason } from "../sigma1/rp/rules.js";
import type { AllianceRpMoments } from "../sigma1/rp/state.js";
import {
  drawCategorical,
  mulberry32,
  simulateRanks,
  type SimMatchInput,
  type SimTeamBaseline,
} from "./rankSimulation.js";

/** Mirrors `rp/distribution.test.ts`'s `moments()` fixture builder exactly — same shape, same defaults. */
function moments(overrides: Partial<AllianceRpMoments> = {}): AllianceRpMoments {
  return {
    variableNames: ["matchCargoTotal", "autoCargoTotal", "endgamePoints"],
    meanVector: [0, 0, 0],
    varianceBlock: [
      [0.000001, 0, 0],
      [0, 0.000001, 0],
      [0, 0, 0.000001],
    ],
    scoreMean: 0,
    scoreVariance: 0.000001,
    scoreCrossCovariance: [0, 0, 0],
    ...overrides,
  };
}

const RULE_2024 = rpRuleModuleForSeason(2024);

function pmfInput(overrides: Partial<RpPmfInput> = {}): RpPmfInput {
  return {
    red: moments(),
    blue: moments(),
    ruleModule: RULE_2024,
    eventType: 0,
    matchKey: "2024test_qm1",
    compLevel: "qm",
    params: DEFAULT_SIGMA1_PARAMS,
    ...overrides,
  };
}

/** Builds a real pmf pair from the pipeline's own `rpPmfForMatch`, one call per remaining match — this is what makes the fixture the pipeline's own output rather than a hand-typed probability array. */
function realPmfPair(matchKey: string, redScoreMean: number, blueScoreMean: number): { redRpPmf: number[]; bluePmf: number[] } {
  const result = rpPmfForMatch(
    pmfInput({
      matchKey,
      red: moments({ scoreMean: redScoreMean }),
      blue: moments({ scoreMean: blueScoreMean }),
    })
  );
  return { redRpPmf: [...result.redPmf], bluePmf: [...result.bluePmf] };
}

/** Same as `realPmfPair` but with genuine score variance (not the near-zero default), so the winner/RP outcome actually varies draw to draw — needed for tests that assert two different seeds produce different results. */
function realPmfPairWithSpread(matchKey: string, redScoreMean: number, blueScoreMean: number): { redRpPmf: number[]; bluePmf: number[] } {
  const result = rpPmfForMatch(
    pmfInput({
      matchKey,
      red: moments({ scoreMean: redScoreMean, scoreVariance: 200 }),
      blue: moments({ scoreMean: blueScoreMean, scoreVariance: 200 }),
    })
  );
  return { redRpPmf: [...result.redPmf], bluePmf: [...result.bluePmf] };
}

describe("simulateRanks — Test 1: a real event shape produces a complete distribution", () => {
  it("returns one complete-sum histogram per team for a 6-team, 2-remaining-match fixture", () => {
    const teamKeys = ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"];
    const baselines: SimTeamBaseline[] = teamKeys.map((teamKey, i) => ({
      teamKey,
      earnedRpSum: i * 2,
      matchesPlayed: 3,
    }));
    const match1 = realPmfPair("2024test_qm1", 50, 50);
    const match2 = realPmfPair("2024test_qm2", 50, 50);
    const remainingMatches: SimMatchInput[] = [
      { redTeamKeys: ["frc1", "frc2", "frc3"], blueTeamKeys: ["frc4", "frc5", "frc6"], redRpPmf: match1.redRpPmf, blueRpPmf: match1.bluePmf },
      { redTeamKeys: ["frc1", "frc3", "frc5"], blueTeamKeys: ["frc2", "frc4", "frc6"], redRpPmf: match2.redRpPmf, blueRpPmf: match2.bluePmf },
    ];

    const rng = mulberry32(12345);
    const result = simulateRanks(remainingMatches, baselines, 1000, rng);

    expect(result.draws).toBe(1000);
    expect(result.rankHistograms.size).toBe(6);
    for (const teamKey of teamKeys) {
      const histogram = result.rankHistograms.get(teamKey);
      expect(histogram).toBeDefined();
      expect(histogram).toHaveLength(6);
      const sum = Array.from(histogram!).reduce((a, b) => a + b, 0);
      expect(sum).toBe(1000);
    }
  });
});

describe("simulateRanks — Test 2: the fixture's pmfs are genuinely pmf-shaped", () => {
  it("each generated pmf is non-empty and sums to 1 within 1e-9", () => {
    const match1 = realPmfPair("2024test_qm1", 50, 50);
    const match2 = realPmfPair("2024test_qm2", 50, 50);
    for (const pmf of [match1.redRpPmf, match1.bluePmf, match2.redRpPmf, match2.bluePmf]) {
      expect(pmf.length).toBeGreaterThan(0);
      const sum = pmf.reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    }
  });
});

describe("simulateRanks — Test 3: the degenerate single-remaining-match event ranks correctly", () => {
  it("puts the far-ahead team at rank 1 in all 1000 draws and the far-behind team last in all 1000", () => {
    // Force the outcome: red alliance's score mean is far above blue's, so
    // red teams win their bonus-RP-eligible match with overwhelming
    // probability in every draw.
    const match = realPmfPair("2024test_qm1", 500, 0);
    const baselines: SimTeamBaseline[] = [
      { teamKey: "frcRed1", earnedRpSum: 0, matchesPlayed: 0 },
      { teamKey: "frcRed2", earnedRpSum: 0, matchesPlayed: 0 },
      { teamKey: "frcRed3", earnedRpSum: 0, matchesPlayed: 0 },
      { teamKey: "frcBlue1", earnedRpSum: 0, matchesPlayed: 0 },
      { teamKey: "frcBlue2", earnedRpSum: 0, matchesPlayed: 0 },
      { teamKey: "frcBlue3", earnedRpSum: 0, matchesPlayed: 0 },
    ];
    const remainingMatches: SimMatchInput[] = [
      {
        redTeamKeys: ["frcRed1", "frcRed2", "frcRed3"],
        blueTeamKeys: ["frcBlue1", "frcBlue2", "frcBlue3"],
        redRpPmf: match.redRpPmf,
        blueRpPmf: match.bluePmf,
      },
    ];

    const rng = mulberry32(999);
    const result = simulateRanks(remainingMatches, baselines, 1000, rng);

    // All three red teams draw the SAME winning alliance RP and start from
    // identical baselines, so they tie on average RP and are separated only
    // by the team-key tie-break (ascending) -- "frcRed1" sorts first among
    // them, landing at the best (lowest-index) rank in every draw. The
    // mirror holds for the losing blue alliance: "frcBlue3" sorts last among
    // its tied group, landing at the worst (highest-index) rank.
    const redHistogram = result.rankHistograms.get("frcRed1")!;
    const blueHistogram = result.rankHistograms.get("frcBlue3")!;
    expect(redHistogram[0]).toBe(1000);
    expect(blueHistogram[5]).toBe(1000);
  });
});

describe("simulateRanks — Test 4: ranking uses average RP per match played, not total", () => {
  it("ranks the team with fewer matches played ahead when totals are equal", () => {
    const baselines: SimTeamBaseline[] = [
      { teamKey: "frcFewMatches", earnedRpSum: 20, matchesPlayed: 5 },
      { teamKey: "frcManyMatches", earnedRpSum: 20, matchesPlayed: 10 },
    ];
    const rng = mulberry32(42);
    const result = simulateRanks([], baselines, 1000, rng);

    const fewHistogram = result.rankHistograms.get("frcFewMatches")!;
    const manyHistogram = result.rankHistograms.get("frcManyMatches")!;
    // frcFewMatches has avg 4.0, frcManyMatches has avg 2.0 -- frcFewMatches
    // must rank first in every draw (no remaining matches, no randomness).
    expect(fewHistogram[0]).toBe(1000);
    expect(manyHistogram[1]).toBe(1000);
  });
});

describe("simulateRanks — Test 5: a fixed seed reproduces identical output", () => {
  it("produces entry-for-entry identical histograms across two fresh mulberry32(12345) runs", () => {
    const baselines: SimTeamBaseline[] = [
      { teamKey: "frc1", earnedRpSum: 4, matchesPlayed: 2 },
      { teamKey: "frc2", earnedRpSum: 3, matchesPlayed: 2 },
      { teamKey: "frc3", earnedRpSum: 2, matchesPlayed: 2 },
    ];
    const match1 = realPmfPairWithSpread("2024test_qm1", 50, 50);
    const match2 = realPmfPairWithSpread("2024test_qm2", 50, 50);
    const remainingMatches: SimMatchInput[] = [
      { redTeamKeys: ["frc1", "frc2"], blueTeamKeys: ["frc3"], redRpPmf: match1.redRpPmf, blueRpPmf: match1.bluePmf },
      { redTeamKeys: ["frc1"], blueTeamKeys: ["frc2", "frc3"], redRpPmf: match2.redRpPmf, blueRpPmf: match2.bluePmf },
    ];

    const resultA = simulateRanks(remainingMatches, baselines, 500, mulberry32(12345));
    const resultB = simulateRanks(remainingMatches, baselines, 500, mulberry32(12345));

    for (const baseline of baselines) {
      expect(Array.from(resultA.rankHistograms.get(baseline.teamKey)!)).toEqual(
        Array.from(resultB.rankHistograms.get(baseline.teamKey)!)
      );
    }
  });
});

describe("simulateRanks — Test 6: a different seed produces a different distribution", () => {
  it("produces at least one differing team histogram between two different seeds on a fixture with genuine spread", () => {
    const baselines: SimTeamBaseline[] = [
      { teamKey: "frc1", earnedRpSum: 4, matchesPlayed: 2 },
      { teamKey: "frc2", earnedRpSum: 3, matchesPlayed: 2 },
      { teamKey: "frc3", earnedRpSum: 2, matchesPlayed: 2 },
    ];
    const match1 = realPmfPairWithSpread("2024test_qm1", 50, 50);
    const match2 = realPmfPairWithSpread("2024test_qm2", 50, 50);
    const remainingMatches: SimMatchInput[] = [
      { redTeamKeys: ["frc1", "frc2"], blueTeamKeys: ["frc3"], redRpPmf: match1.redRpPmf, blueRpPmf: match1.bluePmf },
      { redTeamKeys: ["frc1"], blueTeamKeys: ["frc2", "frc3"], redRpPmf: match2.redRpPmf, blueRpPmf: match2.bluePmf },
    ];

    const resultA = simulateRanks(remainingMatches, baselines, 500, mulberry32(12345));
    const resultB = simulateRanks(remainingMatches, baselines, 500, mulberry32(999999));

    const anyDiffer = baselines.some((baseline) => {
      const histA = Array.from(resultA.rankHistograms.get(baseline.teamKey)!);
      const histB = Array.from(resultB.rankHistograms.get(baseline.teamKey)!);
      return histA.some((value, i) => value !== histB[i]);
    });
    expect(anyDiffer).toBe(true);
  });
});

describe("simulateRanks — Test 7: ties stay ties and resolve by team key", () => {
  it("keeps exactly-equal teams at the same rank in every draw, ordered ascending by team key", () => {
    // "frc1114" sorts before "frc254" lexicographically ('1' < '2'), which
    // is NOT their numeric order (254 < 1114) -- this pins the actual
    // string comparator rather than an accidental numeric agreement.
    const baselines: SimTeamBaseline[] = [
      { teamKey: "frc254", earnedRpSum: 10, matchesPlayed: 5 },
      { teamKey: "frc1114", earnedRpSum: 10, matchesPlayed: 5 },
      { teamKey: "frc48", earnedRpSum: 10, matchesPlayed: 5 },
    ];
    const rng = mulberry32(7);
    const result = simulateRanks([], baselines, 1000, rng);

    // Ascending lexicographic order: "frc1114" < "frc254" < "frc48".
    expect(result.rankHistograms.get("frc1114")![0]).toBe(1000);
    expect(result.rankHistograms.get("frc254")![1]).toBe(1000);
    expect(result.rankHistograms.get("frc48")![2]).toBe(1000);
  });
});

describe("simulateRanks — Test 8: the module adds no RP of its own", () => {
  it("matches an independently computed expected average with no win/tie/bonus RP added on top", () => {
    // A degenerate pmf placing all mass on RP=4 for red, RP=1 for blue.
    const redRpPmf = [0, 0, 0, 0, 1];
    const blueRpPmf = [0, 1];
    const baselines: SimTeamBaseline[] = [
      { teamKey: "frcRed1", earnedRpSum: 6, matchesPlayed: 3 }, // baseline avg 2
      { teamKey: "frcBlue1", earnedRpSum: 6, matchesPlayed: 3 }, // baseline avg 2
    ];
    const remainingMatches: SimMatchInput[] = [
      { redTeamKeys: ["frcRed1"], blueTeamKeys: ["frcBlue1"], redRpPmf, blueRpPmf },
    ];
    const rng = mulberry32(1);
    const result = simulateRanks(remainingMatches, baselines, 1, rng);

    // Expected, computed independently of the module: (6+4)/4 = 2.5 for red,
    // (6+1)/4 = 1.75 for blue -- red must rank first. If the module added
    // any win/tie/bonus RP on top, the ordering (and the exact averages,
    // asserted via the ordering) would come out wrong even though it looks
    // plausible.
    expect(result.rankHistograms.get("frcRed1")![0]).toBe(1);
    expect(result.rankHistograms.get("frcBlue1")![1]).toBe(1);
  });
});
