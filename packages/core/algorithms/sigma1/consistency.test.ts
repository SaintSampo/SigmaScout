/**
 * Synthetic-fixture tests for D-09/D-11's consistency estimator and
 * empirical-Bayes shrinkage.
 */
import { describe, expect, it } from "vitest";
import {
  SIGMA1_CONSISTENCY_EWMA_ALPHA,
  SIGMA1_MIN_CONSISTENCY_VARIANCE,
  SIGMA1_SHRINKAGE_PRIOR_MATCHES,
  foldConsistency,
  shrinkConsistency,
} from "./consistency.js";

describe("SIGMA1_CONSISTENCY_EWMA_ALPHA / SIGMA1_SHRINKAGE_PRIOR_MATCHES", () => {
  it("are exported positive constants", () => {
    expect(SIGMA1_CONSISTENCY_EWMA_ALPHA).toBeGreaterThan(0);
    expect(SIGMA1_CONSISTENCY_EWMA_ALPHA).toBeLessThan(1);
    expect(SIGMA1_SHRINKAGE_PRIOR_MATCHES).toBeGreaterThan(0);
  });
});

describe("foldConsistency", () => {
  it("folds the squared residual toward the prior via an EWMA", () => {
    const next = foldConsistency(4, 3, 0.5); // 0.5*4 + 0.5*9 = 6.5
    expect(next).toBeCloseTo(6.5, 9);
  });

  it("a team with a wide spread of realized contributions keeps a larger consistency estimate than a team with a narrow spread, given equal match counts", () => {
    let wideTeam = 0;
    let narrowTeam = 0;
    const wideResiduals = [10, -12, 15, -9, 11];
    const narrowResiduals = [1, -1.2, 1.5, -0.9, 1.1];
    for (const r of wideResiduals) wideTeam = foldConsistency(wideTeam, r);
    for (const r of narrowResiduals) narrowTeam = foldConsistency(narrowTeam, r);
    expect(wideTeam).toBeGreaterThan(narrowTeam);
  });
});

describe("shrinkConsistency — D-11 empirical-Bayes blend", () => {
  it("with 2 matches played, sits close to the league average; with 40 matches, sits close to the team's own observed spread", () => {
    const observed = 30;
    const leagueMean = 20;
    const thin = shrinkConsistency(observed, 2, leagueMean);
    const deep = shrinkConsistency(observed, 40, leagueMean);

    // Thin history: within 20% of the league mean.
    expect(Math.abs(thin - leagueMean) / leagueMean).toBeLessThan(0.2);
    // Deep history: within 20% of the team's own observed spread.
    expect(Math.abs(deep - observed) / observed).toBeLessThan(0.2);
  });

  it("at exactly SIGMA1_SHRINKAGE_PRIOR_MATCHES matches, weights the team's own observed spread and the league mean equally", () => {
    const observed = 50;
    const leagueMean = 10;
    const result = shrinkConsistency(observed, SIGMA1_SHRINKAGE_PRIOR_MATCHES, leagueMean);
    expect(result).toBeCloseTo((observed + leagueMean) / 2, 9);
  });

  it("with zero matches played, the shrunk spread is exactly the league average", () => {
    expect(shrinkConsistency(500, 0, 30)).toBeCloseTo(30, 9);
  });

  it("no team with fewer than the prior count of matches reports a spread smaller than SIGMA1_MIN_CONSISTENCY_VARIANCE", () => {
    for (let matchCount = 0; matchCount < SIGMA1_SHRINKAGE_PRIOR_MATCHES; matchCount++) {
      const result = shrinkConsistency(0, matchCount, 0);
      expect(result).toBeGreaterThanOrEqual(SIGMA1_MIN_CONSISTENCY_VARIANCE);
    }
  });
});
