/**
 * Proves the claim the 2026-09-09 extraction rests on: `distribution.ts` needs
 * NO algorithm.
 *
 * Its sibling `sigma1/rp/distribution.test.ts` exercises the same module by
 * building real Sigma1 state, and that test deliberately stayed behind in
 * `sigma1/` — it is an integration test of one implementation, not evidence
 * that the module is universal. This file supplies `AllianceRpMoments` as plain
 * hand-written numbers, imports nothing from `algorithms/`, and is what will
 * still pass on the day Sigma1 is deleted.
 */
import { describe, expect, it } from "vitest";
import { rpPmfForMatch } from "./distribution.js";
import { rpRuleModuleForSeason } from "./rules.js";
import type { AllianceRpMoments, RpMonteCarloConfig } from "./moments.js";

const MC: RpMonteCarloConfig = { rpMonteCarloSeed: 12345, rpMonteCarloDraws: 4000 };

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
  matchKey: "2026casj_qm1",
  compLevel: "qm" as const,
  params: MC,
};

describe("rpPmfForMatch — universal, with no algorithm anywhere in the test", () => {
  it("produces a real pmf for both alliances from hand-written moments", () => {
    const result = rpPmfForMatch({ ...BASE, red: moments(), blue: moments() });
    expect(result.redPmf.length).toBeGreaterThan(0);
    expect(result.bluePmf.length).toBeGreaterThan(0);
    const sum = result.redPmf.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it("gives an alliance far above both thresholds a higher expected RP than one far below", () => {
    const strong = moments({ meanVector: [200, 200] });
    const weak = moments({ meanVector: [1, 1] });
    const expected = (pmf: readonly number[]) => pmf.reduce((acc, p, rp) => acc + p * rp, 0);

    const strongRun = rpPmfForMatch({ ...BASE, red: strong, blue: weak });
    expect(expected(strongRun.redPmf)).toBeGreaterThan(expected(strongRun.bluePmf));
  });

  it("is deterministic for a given seed and match key, and varies with the match key", () => {
    const a = rpPmfForMatch({ ...BASE, red: moments(), blue: moments() });
    const b = rpPmfForMatch({ ...BASE, red: moments(), blue: moments() });
    expect(a.redPmf).toEqual(b.redPmf);

    const other = rpPmfForMatch({ ...BASE, matchKey: "2026casj_qm2", red: moments(), blue: moments() });
    expect(other.redPmf).not.toEqual(a.redPmf);
  });

  it("reports one marginal probability per bonus, in bonusNames order", () => {
    const result = rpPmfForMatch({ ...BASE, red: moments(), blue: moments() });
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
    expect(() => rpPmfForMatch({ ...BASE, red: diagonal, blue: diagonal })).not.toThrow();
  });

  it("works for every registered season, so the extraction covers all ten rule modules", () => {
    for (const season of [2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026]) {
      const ruleModule = rpRuleModuleForSeason(season);
      expect(ruleModule, `season ${season} must have a registered rule module`).toBeDefined();
      const names = ruleModule!.thresholdVariables.map((v) => v.name);
      const seasonMoments = moments({
        variableNames: names,
        meanVector: names.map(() => 30),
        varianceBlock: names.map((_, i) => names.map((__, j) => (i === j ? 25 : 0))),
        scoreCrossCovariance: names.map(() => 0),
      });
      const result = rpPmfForMatch({ ...BASE, ruleModule: ruleModule!, red: seasonMoments, blue: seasonMoments });
      expect(result.redPmf.reduce((a, b) => a + b, 0), `season ${season} pmf must sum to 1`).toBeCloseTo(1, 6);
    }
  });
});
