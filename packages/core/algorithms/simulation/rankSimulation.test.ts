/**
 * Pure unit tests for the phase 8 rank-distribution simulation core
 * (`simulateRanks`, `drawCategorical`, `mulberry32`). Fixtures build real
 * pipeline-produced pmfs via `analyticRpPmf` (`rankingPoints/analyticPmf.js`,
 * plan 09-04 Task 3 — this file's fixtures used to route through the
 * deleted `rpPmfForMatch`/`rankingPoints/distribution.js`) — no corpus
 * access, no network, in-process only.
 *
 * The randomness these tests actually exercise (Test 5/Test 6's fixed-seed-
 * reproduces / different-seed-differs pair) is `simulateRanks`'s OWN `rng`
 * parameter — a SEPARATE draw from the pmf itself. The closed form has no
 * seed of its own (D-10), so the fixture builders below no longer take a
 * `matchKey`: two calls with equal score means now return byte-identical
 * pmfs, which changes nothing these tests assert.
 */
import { describe, expect, it } from "vitest";
import { analyticRpPmf, type AnalyticRpPmfInput } from "../../rankingPoints/analyticPmf.js";
import { rpRuleModuleForSeason } from "../../rankingPoints/rules.js";
import type { AllianceRpMoments } from "../../rankingPoints/moments.js";
import {
  drawCategorical,
  mulberry32,
  simulateRanks,
  type SimMatchInput,
  type SimMatchOutcomeInput,
  type SimTeamBaseline,
} from "./rankSimulation.js";

/**
 * Mirrors the deleted `rp/distribution.test.ts`'s `moments()` fixture
 * builder — same shape, same defaults — but with 2024's ACTUAL three
 * threshold variables (`noteCount`, `endGameTotalStagePoints`,
 * `onStageRobotCount`; see `2024.ts`'s `THRESHOLD_VARIABLES`), not 2022's.
 * The old fixture named 2022's variables while pairing them with
 * `RULE_2024` — the deleted Monte Carlo's `?? 0` default silently tolerated
 * a threshold variable this rule module needs (`melodyBonus`'s `noteCount`)
 * being absent from `AllianceRpMoments.variableNames`; `analyticRpPmf`
 * refuses that mismatch instead of guessing 0 for a fitted marginal that
 * was never asked for (Rule 2 — missing validation the old engine lacked).
 */
function moments(overrides: Partial<AllianceRpMoments> = {}): AllianceRpMoments {
  return {
    variableNames: ["noteCount", "endGameTotalStagePoints", "onStageRobotCount"],
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

function pmfInput(overrides: Partial<AnalyticRpPmfInput> = {}): AnalyticRpPmfInput {
  return {
    red: moments(),
    blue: moments(),
    ruleModule: RULE_2024,
    eventType: 0,
    compLevel: "qm",
    ...overrides,
  };
}

/** Builds a real pmf pair from the pipeline's own `analyticRpPmf` — this is what makes the fixture the pipeline's own output rather than a hand-typed probability array. */
function realPmfPair(redScoreMean: number, blueScoreMean: number): { redRpPmf: number[]; bluePmf: number[] } {
  const result = analyticRpPmf(
    pmfInput({
      red: moments({ scoreMean: redScoreMean }),
      blue: moments({ scoreMean: blueScoreMean }),
    })
  );
  return { redRpPmf: [...result.redPmf], bluePmf: [...result.bluePmf] };
}

/** Same as `realPmfPair` but with genuine score variance (not the near-zero default), so the winner/RP outcome actually varies draw to draw — needed for tests that assert two different seeds produce different results. */
function realPmfPairWithSpread(redScoreMean: number, blueScoreMean: number): { redRpPmf: number[]; bluePmf: number[] } {
  const result = analyticRpPmf(
    pmfInput({
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
    const match1 = realPmfPair(50, 50);
    const match2 = realPmfPair(50, 50);
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
    const match1 = realPmfPair(50, 50);
    const match2 = realPmfPair(50, 50);
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
    const match = realPmfPair(500, 0);
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
    const match1 = realPmfPairWithSpread(50, 50);
    const match2 = realPmfPairWithSpread(50, 50);
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
    const match1 = realPmfPairWithSpread(50, 50);
    const match2 = realPmfPairWithSpread(50, 50);
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
    const pmf = realPmfPairWithSpread(50, 50);
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

// ---------------------------------------------------------------------------
// D-15 (plan 09-07): the coupled draw — one outcome, then bonuses per
// alliance. Tests 15-21 continue this file's own numbering. Shared fixture
// convention for Tests 15-17: one remaining match (frcRed vs frcBlue) plus
// one frcRef team that plays no remaining match and whose baseline pins an
// exact average, so a rank read off the histogram observes a per-draw
// quantity even though the output is only a histogram.
// ---------------------------------------------------------------------------

describe("simulateRanks — Test 15: both alliances cannot win the same draw", () => {
  it("keeps frcRef strictly between the two alliances in all 1000 draws under the coupled path", () => {
    // Under today's independent draws this fixture would put frcRef at rank
    // 3 on a both-win draw and rank 1 on a both-lose draw roughly half the
    // time -- this assertion is exact and structural, not statistical.
    const outcome: SimMatchOutcomeInput = {
      outcomePmf: [0.5, 0, 0.5],
      redOutcomeRp: [2, 1, 0],
      blueOutcomeRp: [0, 1, 2],
      redBonusRpPmf: [1],
      blueBonusRpPmf: [1],
    };
    const baselines: SimTeamBaseline[] = [
      { teamKey: "frcRed", earnedRpSum: 0, matchesPlayed: 0 },
      { teamKey: "frcBlue", earnedRpSum: 0, matchesPlayed: 0 },
      { teamKey: "frcRef", earnedRpSum: 1, matchesPlayed: 1 }, // average exactly 1
    ];
    const remainingMatches: SimMatchInput[] = [
      { redTeamKeys: ["frcRed"], blueTeamKeys: ["frcBlue"], redRpPmf: [1], blueRpPmf: [1], outcome },
    ];

    const result = simulateRanks(remainingMatches, baselines, 1000, mulberry32(1));

    expect(Array.from(result.rankHistograms.get("frcRef")!)).toEqual([0, 1000, 0]);
  });
});

describe("simulateRanks — Test 16: bonus RP adds on top of the outcome RP, deterministically given the outcome", () => {
  it("pins red's total at exactly 3 via two brackets around it", () => {
    // Red always wins (outcomePmf: [1, 0, 0]) and always earns exactly 1
    // bonus RP (redBonusRpPmf: [0, 1]); blue never earns a bonus
    // (blueBonusRpPmf: [1]). Red's total is exactly 2 (win RP) + 1 (bonus) =
    // 3 every draw; blue's is exactly 0. Neither bracket alone pins the
    // value -- together they do.
    const outcome: SimMatchOutcomeInput = {
      outcomePmf: [1, 0, 0],
      redOutcomeRp: [2, 1, 0],
      blueOutcomeRp: [0, 1, 2],
      redBonusRpPmf: [0, 1],
      blueBonusRpPmf: [1],
    };
    const remainingMatches: SimMatchInput[] = [
      { redTeamKeys: ["frcRed"], blueTeamKeys: ["frcBlue"], redRpPmf: [1], blueRpPmf: [1], outcome },
    ];

    const lowBaselines: SimTeamBaseline[] = [
      { teamKey: "frcRed", earnedRpSum: 0, matchesPlayed: 0 },
      { teamKey: "frcBlue", earnedRpSum: 0, matchesPlayed: 0 },
      { teamKey: "frcRef", earnedRpSum: 2.5, matchesPlayed: 1 },
    ];
    const lowResult = simulateRanks(remainingMatches, lowBaselines, 1000, mulberry32(2));
    expect(lowResult.rankHistograms.get("frcRed")![0]).toBe(1000);
    expect(lowResult.rankHistograms.get("frcRef")![1]).toBe(1000);
    expect(lowResult.rankHistograms.get("frcBlue")![2]).toBe(1000);

    const highBaselines: SimTeamBaseline[] = [
      { teamKey: "frcRed", earnedRpSum: 0, matchesPlayed: 0 },
      { teamKey: "frcBlue", earnedRpSum: 0, matchesPlayed: 0 },
      { teamKey: "frcRef", earnedRpSum: 3.5, matchesPlayed: 1 },
    ];
    const highResult = simulateRanks(remainingMatches, highBaselines, 1000, mulberry32(2));
    expect(highResult.rankHistograms.get("frcRef")![0]).toBe(1000);
    expect(highResult.rankHistograms.get("frcRed")![1]).toBe(1000);
    expect(highResult.rankHistograms.get("frcBlue")![2]).toBe(1000);
  });
});

describe("simulateRanks — Test 17: the tie outcome is reachable and pays both alliances", () => {
  it("pays both alliances exactly tieRp, pinned via two brackets around frcRef", () => {
    // outcomePmf: [0, 1, 0] -- the tie entry always fires. This case could
    // not fire at all before 09-05 (today's tie branch needs exact
    // float-equality of two continuous draws, while 1.09% of quals actually
    // tie, F7), so it is asserted here rather than assumed to arrive free
    // with the config flip.
    const outcome: SimMatchOutcomeInput = {
      outcomePmf: [0, 1, 0],
      redOutcomeRp: [2, 1, 0],
      blueOutcomeRp: [0, 1, 2],
      redBonusRpPmf: [1],
      blueBonusRpPmf: [1],
    };
    const remainingMatches: SimMatchInput[] = [
      { redTeamKeys: ["frcRed"], blueTeamKeys: ["frcBlue"], redRpPmf: [1], blueRpPmf: [1], outcome },
    ];

    // frcRed and frcBlue both land on average 1 (tieRp), so frcRef at 0.5 is
    // last in every draw regardless of how the frcRed/frcBlue tie itself
    // resolves.
    const lowBaselines: SimTeamBaseline[] = [
      { teamKey: "frcRed", earnedRpSum: 0, matchesPlayed: 0 },
      { teamKey: "frcBlue", earnedRpSum: 0, matchesPlayed: 0 },
      { teamKey: "frcRef", earnedRpSum: 0.5, matchesPlayed: 1 },
    ];
    const lowResult = simulateRanks(remainingMatches, lowBaselines, 1000, mulberry32(3));
    expect(lowResult.rankHistograms.get("frcRef")![2]).toBe(1000);

    const highBaselines: SimTeamBaseline[] = [
      { teamKey: "frcRed", earnedRpSum: 0, matchesPlayed: 0 },
      { teamKey: "frcBlue", earnedRpSum: 0, matchesPlayed: 0 },
      { teamKey: "frcRef", earnedRpSum: 1.5, matchesPlayed: 1 },
    ];
    const highResult = simulateRanks(remainingMatches, highBaselines, 1000, mulberry32(3));
    expect(highResult.rankHistograms.get("frcRef")![0]).toBe(1000);
  });
});

describe("simulateRanks — Test 18: rng consumption is fixed per match list, never data-dependent", () => {
  function countingRng(seed: number): { rng: () => number; count: () => number } {
    const inner = mulberry32(seed);
    let calls = 0;
    return {
      rng: () => {
        calls++;
        return inner();
      },
      count: () => calls,
    };
  }

  const legacyMatch = (): SimMatchInput => ({
    redTeamKeys: ["frcRed"],
    blueTeamKeys: ["frcBlue"],
    redRpPmf: [1],
    blueRpPmf: [1],
  });

  const coupledMatch = (): SimMatchInput => ({
    redTeamKeys: ["frcRed"],
    blueTeamKeys: ["frcBlue"],
    redRpPmf: [1],
    blueRpPmf: [1],
    outcome: {
      outcomePmf: [0.5, 0, 0.5],
      redOutcomeRp: [2, 1, 0],
      blueOutcomeRp: [0, 1, 2],
      redBonusRpPmf: [1],
      blueBonusRpPmf: [1],
    },
  });

  const baselines: SimTeamBaseline[] = [
    { teamKey: "frcRed", earnedRpSum: 0, matchesPlayed: 0 },
    { teamKey: "frcBlue", earnedRpSum: 0, matchesPlayed: 0 },
  ];

  it("consumes exactly 2/3/(2*legacy+3*coupled) x draws for an all-legacy, all-coupled, and mixed fixture respectively", () => {
    const draws = 50;

    // Sub-case A: all-legacy fixture -- 2 rng values per match per draw.
    const legacyMatches = [legacyMatch(), legacyMatch(), legacyMatch()];
    const legacyCounter = countingRng(1);
    simulateRanks(legacyMatches, baselines, draws, legacyCounter.rng);
    expect(legacyCounter.count()).toBe(2 * legacyMatches.length * draws);

    // Sub-case B: all-coupled fixture -- 3 rng values per match per draw.
    const coupledMatches = [coupledMatch(), coupledMatch(), coupledMatch()];
    const coupledCounter = countingRng(1);
    simulateRanks(coupledMatches, baselines, draws, coupledCounter.rng);
    expect(coupledCounter.count()).toBe(3 * coupledMatches.length * draws);

    // Sub-case C: mixed fixture -- (2 x legacyCount + 3 x coupledCount) per draw.
    const mixedMatches = [legacyMatch(), coupledMatch(), legacyMatch(), coupledMatch(), coupledMatch()];
    const legacyCount = 2;
    const coupledCount = 3;
    const mixedCounter = countingRng(1);
    simulateRanks(mixedMatches, baselines, draws, mixedCounter.rng);
    expect(mixedCounter.count()).toBe((2 * legacyCount + 3 * coupledCount) * draws);
  });
});

describe("simulateRanks — Test 19: chunk-equals-whole still holds with outcome present", () => {
  it("ten chunked calls of 100 draws sharing one rng sum to the same histogram as one call of 1000", () => {
    const outcome: SimMatchOutcomeInput = {
      outcomePmf: [0.4, 0.2, 0.4],
      redOutcomeRp: [2, 1, 0],
      blueOutcomeRp: [0, 1, 2],
      redBonusRpPmf: [0.5, 0.5],
      blueBonusRpPmf: [0.3, 0.7],
    };
    const baselines: SimTeamBaseline[] = [
      { teamKey: "frcRed", earnedRpSum: 0, matchesPlayed: 0 },
      { teamKey: "frcBlue", earnedRpSum: 0, matchesPlayed: 0 },
    ];
    const remainingMatches: SimMatchInput[] = [
      { redTeamKeys: ["frcRed"], blueTeamKeys: ["frcBlue"], redRpPmf: [1], blueRpPmf: [1], outcome },
    ];

    const wholeResult = simulateRanks(remainingMatches, baselines, 1000, mulberry32(12345));

    const rng = mulberry32(12345);
    const accumulated = new Map<string, Int32Array>(baselines.map((b) => [b.teamKey, new Int32Array(baselines.length)]));
    for (let chunk = 0; chunk < 10; chunk++) {
      const chunkResult = simulateRanks(remainingMatches, baselines, 100, rng);
      for (const baseline of baselines) {
        const acc = accumulated.get(baseline.teamKey)!;
        const chunkHist = chunkResult.rankHistograms.get(baseline.teamKey)!;
        for (let i = 0; i < acc.length; i++) acc[i]! += chunkHist[i]!;
      }
    }

    for (const baseline of baselines) {
      expect(Array.from(accumulated.get(baseline.teamKey)!)).toEqual(
        Array.from(wholeResult.rankHistograms.get(baseline.teamKey)!)
      );
    }
  });
});

describe("simulateRanks — Test 20: every malformed new field is rejected up front, before any draw", () => {
  const baselines: SimTeamBaseline[] = [
    { teamKey: "frcRed", earnedRpSum: 0, matchesPlayed: 0 },
    { teamKey: "frcBlue", earnedRpSum: 0, matchesPlayed: 0 },
  ];

  function countingRng(seed: number): { rng: () => number; count: () => number } {
    const inner = mulberry32(seed);
    let calls = 0;
    return {
      rng: () => {
        calls++;
        return inner();
      },
      count: () => calls,
    };
  }

  function matchWithOutcome(outcome: SimMatchOutcomeInput): SimMatchInput[] {
    return [{ redTeamKeys: ["frcRed"], blueTeamKeys: ["frcBlue"], redRpPmf: [1], blueRpPmf: [1], outcome }];
  }

  it("throws InvalidPmfError naming the position and the offending field for each of five malformed shapes, with zero rng calls in every case", () => {
    // Sub-case A: an empty outcomePmf.
    const emptyOutcomePmf = matchWithOutcome({
      outcomePmf: [],
      redOutcomeRp: [2, 1, 0],
      blueOutcomeRp: [0, 1, 2],
      redBonusRpPmf: [1],
      blueBonusRpPmf: [1],
    });
    const counterA = countingRng(1);
    expect(() => simulateRanks(emptyOutcomePmf, baselines, 1000, counterA.rng)).toThrow(/position 0.*outcomePmf/s);
    expect(counterA.count()).toBe(0);

    // Sub-case B: a redOutcomeRp shorter than outcomePmf.
    const shortRedOutcomeRp = matchWithOutcome({
      outcomePmf: [0.5, 0, 0.5],
      redOutcomeRp: [2, 1],
      blueOutcomeRp: [0, 1, 2],
      redBonusRpPmf: [1],
      blueBonusRpPmf: [1],
    });
    const counterB = countingRng(1);
    expect(() => simulateRanks(shortRedOutcomeRp, baselines, 1000, counterB.rng)).toThrow(/position 0.*redOutcomeRp/s);
    expect(counterB.count()).toBe(0);

    // Sub-case C: a blueOutcomeRp containing NaN.
    const nanBlueOutcomeRp = matchWithOutcome({
      outcomePmf: [0.5, 0, 0.5],
      redOutcomeRp: [2, 1, 0],
      blueOutcomeRp: [0, 1, Number.NaN],
      redBonusRpPmf: [1],
      blueBonusRpPmf: [1],
    });
    const counterC = countingRng(1);
    expect(() => simulateRanks(nanBlueOutcomeRp, baselines, 1000, counterC.rng)).toThrow(/position 0.*blueOutcomeRp/s);
    expect(counterC.count()).toBe(0);

    // Sub-case D: an empty redBonusRpPmf.
    const emptyRedBonusRpPmf = matchWithOutcome({
      outcomePmf: [0.5, 0, 0.5],
      redOutcomeRp: [2, 1, 0],
      blueOutcomeRp: [0, 1, 2],
      redBonusRpPmf: [],
      blueBonusRpPmf: [1],
    });
    const counterD = countingRng(1);
    expect(() => simulateRanks(emptyRedBonusRpPmf, baselines, 1000, counterD.rng)).toThrow(/position 0.*redBonusRpPmf/s);
    expect(counterD.count()).toBe(0);

    // Sub-case E: a blueBonusRpPmf containing Infinity.
    const infiniteBlueBonusRpPmf = matchWithOutcome({
      outcomePmf: [0.5, 0, 0.5],
      redOutcomeRp: [2, 1, 0],
      blueOutcomeRp: [0, 1, 2],
      redBonusRpPmf: [1],
      blueBonusRpPmf: [Number.POSITIVE_INFINITY],
    });
    const counterE = countingRng(1);
    expect(() => simulateRanks(infiniteBlueBonusRpPmf, baselines, 1000, counterE.rng)).toThrow(/position 0.*blueBonusRpPmf/s);
    expect(counterE.count()).toBe(0);
  });
});

describe("simulateRanks — Test 21: mixed input is valid", () => {
  it("returns a complete histogram set when remainingMatches mixes a coupled match and a legacy match", () => {
    const legacyPmf = realPmfPair(50, 50);
    const outcome: SimMatchOutcomeInput = {
      outcomePmf: [0.4, 0.2, 0.4],
      redOutcomeRp: [2, 1, 0],
      blueOutcomeRp: [0, 1, 2],
      redBonusRpPmf: [0.5, 0.5],
      blueBonusRpPmf: [0.3, 0.7],
    };
    const baselines: SimTeamBaseline[] = [
      { teamKey: "frc1", earnedRpSum: 0, matchesPlayed: 0 },
      { teamKey: "frc2", earnedRpSum: 0, matchesPlayed: 0 },
      { teamKey: "frc3", earnedRpSum: 0, matchesPlayed: 0 },
      { teamKey: "frc4", earnedRpSum: 0, matchesPlayed: 0 },
    ];
    const remainingMatches: SimMatchInput[] = [
      { redTeamKeys: ["frc1"], blueTeamKeys: ["frc2"], redRpPmf: legacyPmf.redRpPmf, blueRpPmf: legacyPmf.bluePmf },
      { redTeamKeys: ["frc3"], blueTeamKeys: ["frc4"], redRpPmf: [1], blueRpPmf: [1], outcome },
    ];

    const result = simulateRanks(remainingMatches, baselines, 1000, mulberry32(5));

    expect(result.rankHistograms.size).toBe(4);
    for (const baseline of baselines) {
      const histogram = result.rankHistograms.get(baseline.teamKey)!;
      const sum = Array.from(histogram).reduce((a, b) => a + b, 0);
      expect(sum).toBe(1000);
    }
  });
});
