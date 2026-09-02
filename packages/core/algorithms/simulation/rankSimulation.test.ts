/**
 * Pure unit tests for the phase 8 rank-distribution simulation core
 * (`simulateRanks`, `drawCategorical`, `mulberry32`). Fixtures build real
 * pipeline-produced pmfs via `rpPmfForMatch` (`sigma1/rp/distribution.js`),
 * matching `rp/distribution.test.ts`'s pure-unit shape — no corpus access,
 * no network, in-process only.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SIGMA1_PARAMS, type Sigma1Params } from "../sigma1/params.js";
import { resolveSigma1Params } from "../sigma1/scale.js";
import { emptyExpandingStats } from "../../scoring/expandingStats.js";
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

/**
 * D-T1 (4.0.0): every Sigma1 internal takes RESOLVED params. Resolving the
 * defaults at an EMPTY expanding statistic is the documented cold-start
 * scale (`fallbackScoreSd ** 2` = 625), and none of the fields exercised in
 * this file is scale-dependent, so these assertions are unchanged in
 * substance -- only the parameter TYPE moved.
 */
const RESOLVED_DEFAULTS = resolveSigma1Params(DEFAULT_SIGMA1_PARAMS, emptyExpandingStats());

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
    params: RESOLVED_DEFAULTS,
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

describe("drawCategorical — Test 9: a malformed pmf terminates with a bounded result", () => {
  it("returns an in-range index for each of three malformed pmf shapes (residue, NaN entry, negative entry) — the loop's own bound is what makes this run at all", () => {
    // Sub-case A: entries sum to slightly less than 1 -- the residue
    // fallback the doc comment names.
    const residuePmf = [0.2, 0.2, 0.2, 0.2, 0.19]; // sums to 0.99
    const residueIndex = drawCategorical(residuePmf, () => 0.999999);
    expect(Number.isInteger(residueIndex)).toBe(true);
    expect(residueIndex).toBeGreaterThanOrEqual(0);
    expect(residueIndex).toBeLessThanOrEqual(residuePmf.length - 1);

    // Sub-case B: a NaN entry.
    const nanPmf = [0.5, Number.NaN, 0.5];
    const nanIndex = drawCategorical(nanPmf, () => 0.9);
    expect(Number.isInteger(nanIndex)).toBe(true);
    expect(nanIndex).toBeGreaterThanOrEqual(0);
    expect(nanIndex).toBeLessThanOrEqual(nanPmf.length - 1);

    // Sub-case C: a negative entry.
    const negativePmf = [0.5, -0.2, 0.7];
    const negativeIndex = drawCategorical(negativePmf, () => 0.9);
    expect(Number.isInteger(negativeIndex)).toBe(true);
    expect(negativeIndex).toBeGreaterThanOrEqual(0);
    expect(negativeIndex).toBeLessThanOrEqual(negativePmf.length - 1);
  });
});

describe("simulateRanks — Test 10: an empty pmf is rejected up front, not drawn from", () => {
  it("throws a named error identifying the offending match, before any draw runs", () => {
    const baselines: SimTeamBaseline[] = [
      { teamKey: "frc1", earnedRpSum: 0, matchesPlayed: 0 },
      { teamKey: "frc2", earnedRpSum: 0, matchesPlayed: 0 },
    ];
    const remainingMatches: SimMatchInput[] = [
      { redTeamKeys: ["frc1"], blueTeamKeys: ["frc2"], redRpPmf: [], blueRpPmf: [1] },
    ];
    // A large `draws` value: if the error were raised mid-draw-loop instead
    // of up front, this call would take a long time or produce a
    // draw-indexed error message instead of a match-indexed one.
    expect(() => simulateRanks(remainingMatches, baselines, 1_000_000, mulberry32(1))).toThrow(/position 0/);
  });
});

describe("simulateRanks — Test 11: an unknown team key throws and names the team", () => {
  it("throws with the missing team key in the message and does not return a result", () => {
    const baselines: SimTeamBaseline[] = [{ teamKey: "frc1", earnedRpSum: 0, matchesPlayed: 0 }];
    const remainingMatches: SimMatchInput[] = [
      { redTeamKeys: ["frc1"], blueTeamKeys: ["frcGhost9999"], redRpPmf: [1], blueRpPmf: [1] },
    ];
    expect(() => simulateRanks(remainingMatches, baselines, 10, mulberry32(1))).toThrow(/frcGhost9999/);
  });
});

describe("simulateRanks — Test 12: the corpus's measured worst case runs", () => {
  it("completes for 78 teams, 135 remaining matches, 1000 draws, with every histogram summing to exactly 1000", () => {
    const teamCount = 78;
    const matchCount = 135;
    const baselines: SimTeamBaseline[] = Array.from({ length: teamCount }, (_, i) => ({
      teamKey: `frc${i + 1}`,
      earnedRpSum: i,
      matchesPlayed: 5,
    }));
    const pmf = realPmfPairWithSpread("2024test_worstcase", 50, 50);
    const remainingMatches: SimMatchInput[] = Array.from({ length: matchCount }, (_, m) => {
      const base = (m * 6) % teamCount;
      const teamAt = (offset: number) => `frc${((base + offset) % teamCount) + 1}`;
      return {
        redTeamKeys: [teamAt(0), teamAt(1), teamAt(2)],
        blueTeamKeys: [teamAt(3), teamAt(4), teamAt(5)],
        redRpPmf: pmf.redRpPmf,
        blueRpPmf: pmf.bluePmf,
      };
    });

    const start = performance.now();
    const result = simulateRanks(remainingMatches, baselines, 1000, mulberry32(2024));
    const durationMs = performance.now() - start;
    // eslint-disable-next-line no-console -- SUMMARY.md records this measured duration per the plan's <output> spec
    console.log(`Test 12 measured duration: ${durationMs.toFixed(2)}ms (78 teams, 135 matches, 1000 draws)`);

    expect(result.rankHistograms.size).toBe(teamCount);
    for (const baseline of baselines) {
      const histogram = result.rankHistograms.get(baseline.teamKey)!;
      expect(histogram).toHaveLength(teamCount);
      const sum = Array.from(histogram).reduce((a, b) => a + b, 0);
      expect(sum).toBe(1000);
    }
  });
});

describe("simulateRanks — Test 13: a team with no matches at all is ranked, not NaN", () => {
  it("gives a roster team with matchesPlayed 0 and no remaining matches a complete histogram, ranked last", () => {
    const baselines: SimTeamBaseline[] = [
      { teamKey: "frcActive1", earnedRpSum: 10, matchesPlayed: 5 },
      { teamKey: "frcActive2", earnedRpSum: 8, matchesPlayed: 5 },
      { teamKey: "frcNeverPlayed", earnedRpSum: 0, matchesPlayed: 0 },
    ];
    const result = simulateRanks([], baselines, 1000, mulberry32(1));

    const neverPlayedHistogram = result.rankHistograms.get("frcNeverPlayed")!;
    const sum = Array.from(neverPlayedHistogram).reduce((a, b) => a + b, 0);
    expect(sum).toBe(1000);
    expect(neverPlayedHistogram[2]).toBe(1000); // last of 3 teams, every draw
  });
});

describe("simulateRanks — Test 14: zero remaining matches is a valid input", () => {
  it("concentrates every team's 1000 draws on the single rank its baseline already implies", () => {
    const baselines: SimTeamBaseline[] = [
      { teamKey: "frcTop", earnedRpSum: 30, matchesPlayed: 5 },
      { teamKey: "frcMid", earnedRpSum: 20, matchesPlayed: 5 },
      { teamKey: "frcBottom", earnedRpSum: 10, matchesPlayed: 5 },
    ];
    const result = simulateRanks([], baselines, 1000, mulberry32(1));

    expect(result.rankHistograms.get("frcTop")![0]).toBe(1000);
    expect(result.rankHistograms.get("frcMid")![1]).toBe(1000);
    expect(result.rankHistograms.get("frcBottom")![2]).toBe(1000);
  });
});
