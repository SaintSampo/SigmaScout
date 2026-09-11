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
  erf,
  standardNormalCdf,
  type FittedMarginal,
} from "./marginals.js";
import type { AllianceRpMoments } from "./moments.js";
import type { RpThresholdVariable } from "./constants.js";

describe("fitMarginal — negative-binomial pinned parameterization (D-01)", () => {
  it("fitMarginal(2, 4, 'negative-binomial') yields the exact pinned r and p — r = mean²/(variance−mean), p = mean/(mean+r)", () => {
    const fit = fitMarginal(2, 4, "negative-binomial");
    expect(fit.resolved).toBe("negative-binomial");
    expect(fit.r).toBe(2);
    expect(fit.p).toBe(0.5);
  });
});

describe("negative-binomial CDF — hand-computed, exact dyadic rationals where noted", () => {
  it("mean 2, var 4 (r=2, p=0.5): probAtMost(0) === 0.25 exactly", () => {
    const fit = fitMarginal(2, 4, "negative-binomial");
    expect(probAtMost(fit, 0)).toBeCloseTo(0.25, 15);
  });

  it("mean 2, var 4 (r=2, p=0.5): probAtLeast(3) === 5/16 = 0.3125 exactly (NB(r=2,p=0.5) has P(X=k)=(k+1)·2^-(k+2), no rounding anywhere)", () => {
    const fit = fitMarginal(2, 4, "negative-binomial");
    expect(probAtLeast(fit, 3)).toBeCloseTo(0.3125, 15);
  });

  it("mean 2, var 4 (r=2, p=0.5): probAtLeast(5) === 7/64 = 0.109375 exactly", () => {
    const fit = fitMarginal(2, 4, "negative-binomial");
    expect(probAtLeast(fit, 5)).toBeCloseTo(0.109375, 15);
  });

  it("mean 1, var 2 (r=1, p=0.5, geometric): probAtLeast(3) === 0.125 exactly (p^3)", () => {
    const fit = fitMarginal(1, 2, "negative-binomial");
    expect(fit.r).toBe(1);
    expect(fit.p).toBe(0.5);
    expect(probAtLeast(fit, 3)).toBeCloseTo(0.125, 15);
  });

  it("mean 3, var 4.5 (r=6, p=1/3): probAtMost(0) === (2/3)^6 === 64/729 === 0.0877914951989", () => {
    const fit = fitMarginal(3, 4.5, "negative-binomial");
    expect(fit.r).toBe(6);
    expect(fit.p).toBeCloseTo(1 / 3, 15);
    expect(probAtMost(fit, 0)).toBeCloseTo(0.0877914951989, 12);
  });

  it("mean 3, var 4.5 (r=6, p=1/3): probAtLeast(5) === 0.213128080069", () => {
    const fit = fitMarginal(3, 4.5, "negative-binomial");
    expect(probAtLeast(fit, 5)).toBeCloseTo(0.213128080069, 12);
  });

  it("mean 3, var 4.5 (r=6, p=1/3): probAtLeast(8) === 0.0346548346853 — the upper-tail branch (small probability, computed directly rather than by cancellation)", () => {
    const fit = fitMarginal(3, 4.5, "negative-binomial");
    expect(probAtLeast(fit, 8)).toBeCloseTo(0.0346548346853, 12);
  });
});

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

  it("no continuity correction: probAtLeast(14) equals 1 − Φ((14−10)/4) exactly, not 1 − Φ((13.5−10)/4) — today's Monte Carlo draws a continuous normal", () => {
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

    const fitInfVariance = fitMarginal(3, Number.POSITIVE_INFINITY, "negative-binomial");
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

  it("mean=0, variance=3, declared 'negative-binomial' -> gaussian/non-positive-mean, finite probability in [0,1]", () => {
    const fit = fitMarginal(0, 3, "negative-binomial");
    expect(fit.declared).toBe("negative-binomial");
    expect(fit.resolved).toBe("gaussian");
    expect(fit.fallbackReason).toBe("non-positive-mean");
    const p = probAtLeast(fit, 2);
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });

  it("mean=13.586547164699777, variance=4.5, declared 'negative-binomial' -> gaussian/variance-le-mean — the real 2-observation alliance from 09-03-PLAN.md's <baseline> table, not a contrived input", () => {
    const fit = fitMarginal(13.586547164699777, 4.5, "negative-binomial");
    expect(fit.resolved).toBe("gaussian");
    expect(fit.fallbackReason).toBe("variance-le-mean");
    const p = probAtLeast(fit, 14);
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });

  it("mean=5, variance=5, declared 'negative-binomial' -> gaussian/variance-le-mean — exact equidispersion divides by zero in r; the ladder catches it before the division", () => {
    const fit = fitMarginal(5, 5, "negative-binomial");
    expect(fit.resolved).toBe("gaussian");
    expect(fit.fallbackReason).toBe("variance-le-mean");
  });

  it("mean=5, variance=12, declared 'gaussian' -> gaussian, fallbackReason undefined — the inert default is NOT a fallback", () => {
    const fit = fitMarginal(5, 12, "gaussian");
    expect(fit.resolved).toBe("gaussian");
    expect(fit.fallbackReason).toBeUndefined();
  });
});

describe("declared vs resolved — three separate facts, never conflated (D-09 observability)", () => {
  it("a fit that resolves to Gaussian under a 'negative-binomial' declaration carries declared:'negative-binomial', resolved:'gaussian' and a reason", () => {
    const fit: FittedMarginal = fitMarginal(0, 3, "negative-binomial");
    expect(fit.declared).toBe("negative-binomial");
    expect(fit.resolved).toBe("gaussian");
    expect(fit.fallbackReason).toBe("non-positive-mean");
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

describe("erf / standardNormalCdf", () => {
  it("erf is odd: erf(-x) === -erf(x)", () => {
    expect(erf(-1.3)).toBeCloseTo(-erf(1.3), 12);
  });

  it("standardNormalCdf(0) is exactly 0.5", () => {
    expect(standardNormalCdf(0)).toBe(0.5);
  });
});
