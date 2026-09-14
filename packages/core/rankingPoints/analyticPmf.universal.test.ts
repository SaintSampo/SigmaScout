/**
 * Proves the RP pmf engine needs no algorithm: hand-written moments only.
 * Also covers purity (equal inputs give equal pmfs) and `pmfMean`, with
 * hand-computed expectations.
 */
import { describe, expect, it } from "vitest";
import { analyticRpPmf, pmfMean } from "./analyticPmf.js";
import { RP_REGISTERED_SEASONS, RP_RULE_MODULES, rpRuleModuleForSeason } from "./rules.js";
import type { AllianceRpMoments } from "./moments.js";

/** 2026 gates on two threshold variables: `hubTotalCount` and `totalTowerPoints`. */
function moments(overrides: Partial<AllianceRpMoments> = {}): AllianceRpMoments {
  return {
    variableNames: ["hubTotalCount", "totalTowerPoints"],
    meanVector: [40, 30],
    varianceBlock: [
      [64, 0],
      [0, 36],
    ],
    scoreMean: 300,
    scoreVariance: 900,
    scoreCrossCovariance: [0, 0],
    ...overrides,
  };
}

const BASE = {
  ruleModule: rpRuleModuleForSeason(2026)!,
  eventType: 0,
  compLevel: "qm" as const,
  pRedWin: 0.5,
};

describe("analyticRpPmf — universal, with no algorithm anywhere in the test", () => {
  it("produces a real pmf for both alliances from hand-written moments", () => {
    const result = analyticRpPmf({ ...BASE, red: moments(), blue: moments() });
    expect(result.redPmf.length).toBeGreaterThan(0);
    expect(result.bluePmf.length).toBeGreaterThan(0);
    const sum = result.redPmf.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it("gives an alliance far above both thresholds a higher expected RP than one far below", () => {
    const strong = moments({ meanVector: [200, 200] });
    const weak = moments({ meanVector: [1, 1] });
    const expected = (pmf: readonly number[]) => pmf.reduce((acc, p, rp) => acc + p * rp, 0);

    const strongRun = analyticRpPmf({ ...BASE, red: strong, blue: weak });
    expect(expected(strongRun.redPmf)).toBeGreaterThan(expected(strongRun.bluePmf));
  });

  it("is PURE — two calls with equal inputs return equal pmfs (no seed, no match key, no stream position: nothing for a reproducibility contract to be about)", () => {
    const a = analyticRpPmf({ ...BASE, red: moments(), blue: moments() });
    const b = analyticRpPmf({ ...BASE, red: moments(), blue: moments() });
    expect(a.redPmf).toEqual(b.redPmf);
    expect(a.bluePmf).toEqual(b.bluePmf);
  });

  it("reports one marginal probability per bonus, in bonusNames order", () => {
    const result = analyticRpPmf({ ...BASE, red: moments(), blue: moments() });
    expect(result.redBonusProbabilities).toHaveLength(BASE.ruleModule.bonusNames.length);
    for (const p of result.redBonusProbabilities ?? []) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it("accepts a DIAGONAL variance block — the independence choice `moments.ts` documents as a decision, not a default", () => {
    const diagonal = moments({
      varianceBlock: [
        [64, 0],
        [0, 36],
      ],
      scoreCrossCovariance: [0, 0],
    });
    expect(() => analyticRpPmf({ ...BASE, red: diagonal, blue: diagonal })).not.toThrow();
  });

  it("works for every registered season, so the closed form covers all ten rule modules", () => {
    for (const season of RP_REGISTERED_SEASONS) {
      const ruleModule = RP_RULE_MODULES[season]!;
      const names = ruleModule.thresholdVariables.map((v) => v.name);
      const seasonMoments = moments({
        variableNames: names,
        meanVector: names.map(() => 30),
        varianceBlock: names.map((_, i) => names.map((__, j) => (i === j ? 25 : 0))),
        scoreCrossCovariance: names.map(() => 0),
      });
      const result = analyticRpPmf({ ...BASE, ruleModule, red: seasonMoments, blue: seasonMoments });
      expect(result.redPmf.reduce((a, b) => a + b, 0), `season ${season} pmf must sum to 1`).toBeCloseTo(1, 6);
    }
  });

  it("a degenerate alliance (no rated teams — every threshold variable and score at zero mean/variance) still returns a well-formed pmf (ALGO-08 empty edge)", () => {
    const degenerate = moments({ meanVector: [0, 0], varianceBlock: [[0, 0], [0, 0]], scoreMean: 0, scoreVariance: 0 });
    const result = analyticRpPmf({ ...BASE, red: degenerate, blue: degenerate });
    const sum = result.redPmf.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 9);
    // Both alliances identical and score-tied (meanD = 0, varianceD = 0) ->
    // the zero-variance tie branch: pTie = 1, all bonus probabilities are
    // exactly whatever predictThresholds(meanVector=0) says.
    expect(result.outcome?.pTie).toBe(1);
  });
});

describe("pmfMean — hand-computed (D-07), carried forward from the deleted sigma1/rp/distribution.test.ts", () => {
  it("pmfMean of a point mass at index k is exactly k", () => {
    expect(pmfMean([0, 0, 1, 0])).toBe(2);
    expect(pmfMean([1, 0, 0, 0])).toBe(0);
  });

  it("pmfMean of [0.5, 0.5] (a fair coin over {0,1}) is exactly 0.5", () => {
    expect(pmfMean([0.5, 0.5])).toBe(0.5);
  });

  it("pmfMean of the 2026 tracer's hand-computed pmf matches a direct hand computation", () => {
    // [0.039663813, 0.210336187, 0.210336187, 0.079327627, 0.210336187, 0.210336187, 0.039663813]
    // mean = sum(i * p_i) = 3 (symmetric around index 3 by construction)
    const pmf = [0.039663813, 0.210336187, 0.210336187, 0.079327627, 0.210336187, 0.210336187, 0.039663813];
    expect(pmfMean(pmf)).toBeCloseTo(3, 6);
  });
});
