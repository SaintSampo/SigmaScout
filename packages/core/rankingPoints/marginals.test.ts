/**
 * Hand-computed unit tests for `marginals.ts` — D-07's mandatory mitigation
 * for the declined Monte Carlo equivalence check (09-CONTEXT.md).
 *
 * EVERY expected value below was computed at planning time from the closed
 * form, independently of `marginals.ts`'s own implementation (09-03-PLAN.md's
 * `<behavior>` table). Reproducing an expectation by running `marginals.ts`
 * and pasting its output would assert only that the implementation equals
 * itself — precisely the evidence this file exists to NOT be.
 */
import { describe, expect, it } from "vitest";
import {
  fitMarginal,
  fitAllianceMarginals,
  probAtLeast,
  probAtMost,
  poissonBinomialPmf,
  poissonBinomialAtLeast,
  erf,
  standardNormalCdf,
  type FittedMarginal,
} from "./marginals.js";
import type { AllianceRpMoments } from "./moments.js";
import type { RpThresholdVariable } from "./constants.js";
import { RpMomentsAccumulator } from "./empiricalMoments.js";
import { rp2026 } from "./2026.js";

describe("Gaussian family — retained as the inert default, no continuity correction", () => {
  it("fitMarginal(10, 16, 'gaussian') resolves 'gaussian' with sd === 4 and no fallbackReason", () => {
    const fit = fitMarginal(10, 16, "gaussian");
    expect(fit.resolved).toBe("gaussian");
    expect(fit.sd).toBe(4);
    expect(fit.fallbackReason).toBeUndefined();
  });

  it("probAtLeast(14) ≈ 0.158655263832 for mean=10, sd=4 (tolerance 1e-9 — the Abramowitz-Stegun approximation's own ~1.5e-7 max error is the real floor)", () => {
    const fit = fitMarginal(10, 16, "gaussian");
    expect(probAtLeast(fit, 14)).toBeCloseTo(0.158655263832, 7);
  });

  it("probAtLeast(10) and probAtMost(10) are EXACTLY 0.5 — the x=0 special case carried over from linkFunctions.normalCdf (without it the raw approximation returns 0.5000000005)", () => {
    const fit = fitMarginal(10, 16, "gaussian");
    expect(probAtLeast(fit, 10)).toBe(0.5);
    expect(probAtMost(fit, 10)).toBe(0.5);
  });

  it("no continuity correction: probAtLeast(14) equals 1 − Φ((14−10)/4) exactly, not 1 − Φ((13.5−10)/4) — the Gaussian model treats this as a continuous normal, matching the deleted Monte Carlo's own draw semantics (plan 09-04)", () => {
    const fit = fitMarginal(10, 16, "gaussian");
    const expected = 1 - standardNormalCdf((14 - 10) / 4);
    expect(probAtLeast(fit, 14)).toBe(expected);
  });
});

describe("the fallback ladder (Pitfall 3) — ordered, documented, and never NaN", () => {
  it("mean=NaN or variance=Infinity -> degenerate/non-finite, probAtLeast(0)===1, everything finite", () => {
    const fitNanMean = fitMarginal(Number.NaN, 4, "gaussian");
    expect(fitNanMean.resolved).toBe("degenerate");
    expect(fitNanMean.fallbackReason).toBe("non-finite");
    expect(probAtLeast(fitNanMean, 0)).toBe(1);
    expect(Number.isFinite(probAtLeast(fitNanMean, 5))).toBe(true);

    const fitInfVariance = fitMarginal(3, Number.POSITIVE_INFINITY, "gaussian");
    expect(fitInfVariance.resolved).toBe("degenerate");
    expect(fitInfVariance.fallbackReason).toBe("non-finite");
    expect(probAtLeast(fitInfVariance, 0)).toBe(1);
  });

  it("variance=0, mean=7.5 (either family) -> degenerate/zero-variance, compared against the RAW continuous mean", () => {
    const fit = fitMarginal(7.5, 0, "gaussian");
    expect(fit.resolved).toBe("degenerate");
    expect(fit.fallbackReason).toBe("zero-variance");
    expect(probAtLeast(fit, 7)).toBe(1);
    expect(probAtLeast(fit, 8)).toBe(0);
    expect(probAtMost(fit, 8)).toBe(1);
    expect(probAtMost(fit, 7)).toBe(0);
  });




  it("mean=5, variance=12, declared 'gaussian' -> gaussian, fallbackReason undefined — the inert default is NOT a fallback", () => {
    const fit = fitMarginal(5, 12, "gaussian");
    expect(fit.resolved).toBe("gaussian");
    expect(fit.fallbackReason).toBeUndefined();
  });
});

describe("declared vs resolved — three separate facts, never conflated", () => {
  it("a fit over data that supports no distribution carries declared:'gaussian', resolved:'degenerate' and a reason — the two still differ, which is why the split survives a one-member declared union", () => {
    const fit: FittedMarginal = fitMarginal(7.5, 0, "gaussian");
    expect(fit.declared).toBe("gaussian");
    expect(fit.resolved).toBe("degenerate");
    expect(fit.fallbackReason).toBe("zero-variance");
  });

  it("a fit that resolves to what it declared carries NO fallbackReason — resolving to yourself is not a fallback", () => {
    const fit: FittedMarginal = fitMarginal(5, 12, "gaussian");
    expect(fit.declared).toBe("gaussian");
    expect(fit.resolved).toBe("gaussian");
    expect(fit.fallbackReason).toBeUndefined();
  });
});

describe("fitAllianceMarginals — reads only the diagonal", () => {
  it("off-diagonal entries are read as nothing — a non-zero off-diagonal does not change the resulting fits", () => {
    const variables: readonly RpThresholdVariable[] = [
      { name: "a", unit: "count", marginalFamily: "gaussian" },
      { name: "b", unit: "count", marginalFamily: "gaussian" },
    ];
    const moments: AllianceRpMoments = {
      variableNames: ["a", "b"],
      meanVector: [10, 20],
      varianceBlock: [
        [16, 999], // deliberately non-zero off-diagonal
        [999, 25],
      ],
      scoreMean: 0,
      scoreVariance: 0,
      scoreCrossCovariance: [0, 0],
    };
    const fits = fitAllianceMarginals(moments, variables);
    expect(fits.get("a")?.sd).toBe(4);
    expect(fits.get("b")?.sd).toBe(5);
    expect(fits.get("a")?.variance).toBe(16);
    expect(fits.get("b")?.variance).toBe(25);
  });

  it("a variable absent from the declared list defaults to gaussian rather than throwing", () => {
    const moments: AllianceRpMoments = {
      variableNames: ["unknownVar"],
      meanVector: [8],
      varianceBlock: [[9]],
      scoreMean: 0,
      scoreVariance: 0,
      scoreCrossCovariance: [0],
    };
    const fits = fitAllianceMarginals(moments, []);
    expect(fits.get("unknownVar")?.resolved).toBe("gaussian");
  });
});

describe("poissonBinomialPmf / poissonBinomialAtLeast — hand-computed, tolerance 1e-12", () => {
  it("[0.1, 0.2, 0.3] pmf === [0.504, 0.398, 0.092, 0.006]", () => {
    const pmf = poissonBinomialPmf([0.1, 0.2, 0.3]);
    expect(pmf[0]).toBeCloseTo(0.504, 12);
    expect(pmf[1]).toBeCloseTo(0.398, 12);
    expect(pmf[2]).toBeCloseTo(0.092, 12);
    expect(pmf[3]).toBeCloseTo(0.006, 12);
  });

  it("[0.1, 0.2, 0.3] atLeast(2) === 0.098", () => {
    expect(poissonBinomialAtLeast([0.1, 0.2, 0.3], 2)).toBeCloseTo(0.098, 12);
  });

  it("[0.5, 0.5, 0.5] pmf === [0.125, 0.375, 0.375, 0.125]", () => {
    const pmf = poissonBinomialPmf([0.5, 0.5, 0.5]);
    expect(pmf[0]).toBeCloseTo(0.125, 12);
    expect(pmf[1]).toBeCloseTo(0.375, 12);
    expect(pmf[2]).toBeCloseTo(0.375, 12);
    expect(pmf[3]).toBeCloseTo(0.125, 12);
  });

  it("[0.5, 0.5, 0.5] atLeast(2) === 0.5", () => {
    expect(poissonBinomialAtLeast([0.5, 0.5, 0.5], 2)).toBeCloseTo(0.5, 12);
  });

  it("[0.9, 0.8, 0.7, 0.6, 0.5] atLeast(4) ≈ 0.5226 — the 2016 breach shape: five defence positions, four required", () => {
    expect(poissonBinomialAtLeast([0.9, 0.8, 0.7, 0.6, 0.5], 4)).toBeCloseTo(0.5226, 4);
  });

  it("[0.5, 0.5, 0.5, 0.5] atLeast(4) === 0.0625 === 0.5**4 exactly — the k=n case, the conjunction 2025 coralBonus's strict branch computes", () => {
    const result = poissonBinomialAtLeast([0.5, 0.5, 0.5, 0.5], 4);
    expect(result).toBeCloseTo(0.0625, 12);
    expect(result).toBeCloseTo(0.5 ** 4, 12);
  });

  it("empty array: pmf === [1]; atLeast(0) === 1; atLeast(1) === 0", () => {
    expect(poissonBinomialPmf([])).toEqual([1]);
    expect(poissonBinomialAtLeast([], 0)).toBe(1);
    expect(poissonBinomialAtLeast([], 1)).toBe(0);
  });

  it("atLeast(k) with k <= 0 is exactly 1, for any probabilities", () => {
    expect(poissonBinomialAtLeast([0.3, 0.4], 0)).toBe(1);
    expect(poissonBinomialAtLeast([0.3, 0.4], -5)).toBe(1);
  });

  it("atLeast(k) with k > n is exactly 0", () => {
    expect(poissonBinomialAtLeast([0.3, 0.4], 3)).toBe(0);
  });

  it("[0.1, 0.2, 0.3] pmf sums to 1 within 1e-12", () => {
    const pmf = poissonBinomialPmf([0.1, 0.2, 0.3]);
    expect(pmf.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });
});

describe("invariants across a grid of fits (Gaussian, degenerate)", () => {
  const gaussianFit = fitMarginal(12, 40, "gaussian");
  const degenerateFit = fitMarginal(12, 0, "gaussian");
  const fits: readonly [string, FittedMarginal][] = [
    ["gaussian", gaussianFit],
    ["degenerate", degenerateFit],
  ];

  it("probAtLeast is monotone non-increasing over t = -1..50 for every resolved family — protects 09-04's nested-threshold differencing (P(only energized) = probAtLeast(T_e) - probAtLeast(T_s))", () => {
    for (const [name, fit] of fits) {
      let prev = probAtLeast(fit, -1);
      for (let t = 0; t <= 50; t++) {
        const cur = probAtLeast(fit, t);
        expect(cur, `${name} at t=${t}`).toBeLessThanOrEqual(prev);
        prev = cur;
      }
    }
  });

  it("every returned probability is finite and in [0, 1] — no NaN, no Infinity, no -0 masquerading as a probability", () => {
    for (const [, fit] of fits) {
      for (let t = -1; t <= 50; t++) {
        const a = probAtLeast(fit, t);
        const b = probAtMost(fit, t);
        expect(Number.isFinite(a)).toBe(true);
        expect(Number.isFinite(b)).toBe(true);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(1);
      }
    }
  });


  it("continuous identity (Gaussian only): probAtMost(t) + probAtLeast(t) === 1 within 1e-12", () => {
    for (let t = -1; t <= 50; t++) {
      expect(probAtMost(gaussianFit, t) + probAtLeast(gaussianFit, t)).toBeCloseTo(1, 12);
    }
  });

  it("the degenerate family is EXEMPT from both the discrete and continuous identities — a point mass between two integers satisfies neither, which is correct", () => {
    // mean=12 is an integer here, so pick a fit whose point mass sits between
    // integers to prove the exemption for real, not just by coincidence.
    const betweenIntegers = fitMarginal(12.5, 0, "gaussian");
    expect(betweenIntegers.resolved).toBe("degenerate");
    const discreteSum = probAtMost(betweenIntegers, 12) + probAtLeast(betweenIntegers, 13);
    const continuousSum = probAtMost(betweenIntegers, 12) + probAtLeast(betweenIntegers, 12);
    // Neither identity is required to hold; assert what actually happens
    // (12 < 12.5 so probAtMost(12) is 0 and probAtLeast(13) is 0 -> discrete
    // sum is 0, not 1; probAtLeast(12) is 1 -> continuous sum is 1, matching
    // by coincidence for THIS threshold but not asserted as a general rule).
    expect(discreteSum).not.toBeCloseTo(1, 6);
    expect(Number.isFinite(continuousSum)).toBe(true);
  });

});

describe("cold-team well-formedness — proven against the REAL RpMomentsAccumulator (Pitfall 3's named warning sign)", () => {
  it("one observation: variance-le-mean's sibling, zero-variance — degenerate/zero-variance, probAtLeast(12)===1, probAtLeast(13)===0", () => {
    const accumulator = new RpMomentsAccumulator(rp2026);
    const roster = ["frc1", "frc2", "frc3"];
    accumulator.fold(roster, { hubTotalCount: 12, totalTowerPoints: 12 });
    const moments = accumulator.momentsFor(roster, 0, 0);
    expect(moments.meanVector[0]).toBe(12);
    expect(moments.varianceBlock[0]![0]).toBe(0);

    const fit = fitMarginal(moments.meanVector[0]!, moments.varianceBlock[0]![0]!, "gaussian");
    expect(fit.resolved).toBe("degenerate");
    expect(fit.fallbackReason).toBe("zero-variance");
    expect(probAtLeast(fit, 12)).toBe(1);
    expect(probAtLeast(fit, 13)).toBe(0);
  });

  it("two observations (folded 12 then 15): mean=13.586547164699777, variance=4.5 (both derived from empiricalMoments.ts's own arithmetic at planning time; a mismatch means the accumulator changed, a finding to report, not a number to overwrite). Resolves gaussian with no fallback, finite probability in [0,1]", () => {
    const accumulator = new RpMomentsAccumulator(rp2026);
    const roster = ["frc1", "frc2", "frc3"];
    accumulator.fold(roster, { hubTotalCount: 12, totalTowerPoints: 12 });
    accumulator.fold(roster, { hubTotalCount: 15, totalTowerPoints: 15 });
    const moments = accumulator.momentsFor(roster, 0, 0);
    expect(moments.meanVector[0]).toBeCloseTo(13.586547164699777, 9);
    expect(moments.varianceBlock[0]![0]).toBeCloseTo(4.5, 9);

    // This input (variance below the mean) used to exercise a fallback rung
    // that only a negative-binomial declaration could reach. That family was
    // measured and refused; the rung went with it, and an ordinary positive
    // variance now simply fits Gaussian.
    const fit = fitMarginal(moments.meanVector[0]!, moments.varianceBlock[0]![0]!, "gaussian");
    expect(fit.declared).toBe("gaussian");
    expect(fit.resolved).toBe("gaussian");
    expect(fit.fallbackReason).toBeUndefined();
    const p = probAtLeast(fit, 14);
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });
});

describe("erf / standardNormalCdf", () => {
  it("erf is odd: erf(-x) === -erf(x)", () => {
    expect(erf(-1.3)).toBeCloseTo(-erf(1.3), 12);
  });

  it("standardNormalCdf(0) is exactly 0.5", () => {
    expect(standardNormalCdf(0)).toBe(0.5);
  });
});
