/**
 * Synthetic-fixture tests for D-03's full quadratic-form alliance-variance
 * calculation and the EWMA covariance estimator (Pitfall Sigma1-3).
 */
import { describe, expect, it } from "vitest";
import {
  SIGMA1_COV_EWMA_ALPHA,
  SIGMA1_COV_SHRINKAGE,
  allianceTotalPredictiveVariance,
  emptyCovariance,
  ewmaCovariance,
  teamTotalVariance,
} from "./covariance.js";

describe("SIGMA1_COV_EWMA_ALPHA / SIGMA1_COV_SHRINKAGE", () => {
  it("are exported constants within (0, 1)", () => {
    expect(SIGMA1_COV_EWMA_ALPHA).toBeGreaterThan(0);
    expect(SIGMA1_COV_EWMA_ALPHA).toBeLessThan(1);
    expect(SIGMA1_COV_SHRINKAGE).toBeGreaterThan(0);
    expect(SIGMA1_COV_SHRINKAGE).toBeLessThan(1);
  });
});

describe("teamTotalVariance — full sum, not the trace", () => {
  it("returns the sum of all nine entries of a 3x3 matrix, not the trace, on a fixture where the two differ", () => {
    const covariance = [
      [4, 1, 0.5],
      [1, 3, 0.2],
      [0.5, 0.2, 2],
    ];
    const trace = 4 + 3 + 2; // 9
    const totalSum = 4 + 1 + 0.5 + 1 + 3 + 0.2 + 0.5 + 0.2 + 2; // 12.4
    expect(trace).not.toBe(totalSum);
    expect(teamTotalVariance(covariance)).toBeCloseTo(totalSum, 9);
  });
});

describe("allianceTotalPredictiveVariance", () => {
  it("sums 1^T Sigma 1 across every teammate's own covariance matrix", () => {
    const covA = [
      [2, 0],
      [0, 3],
    ];
    const covB = [
      [1, 1],
      [1, 1],
    ];
    const expected = teamTotalVariance(covA) + teamTotalVariance(covB);
    expect(allianceTotalPredictiveVariance([covA, covB])).toBeCloseTo(expected, 9);
  });

  it("returns 0 for an empty list of teammates", () => {
    expect(allianceTotalPredictiveVariance([])).toBe(0);
  });
});

describe("emptyCovariance", () => {
  it("returns an all-zero componentCount x componentCount matrix", () => {
    const cov = emptyCovariance(3);
    expect(cov.length).toBe(3);
    for (const row of cov) {
      expect(row.length).toBe(3);
      expect(row.every((v) => v === 0)).toBe(true);
    }
  });
});

describe("ewmaCovariance — convergence toward sample covariance", () => {
  it("converges toward the sample covariance of a repeated residual vector sequence", () => {
    // A residual pattern with a real, non-diagonal correlation structure:
    // component 0 and component 1 always move together (rho=1 in the
    // underlying signal), component 2 is independent noise.
    const residuals: number[][] = [
      [2, 2, -1],
      [-2, -2, 1],
      [3, 3, 0.5],
      [-3, -3, -0.5],
      [1, 1, 2],
      [-1, -1, -2],
    ];

    let cov = emptyCovariance(3);
    // Fold the same pattern many times so the EWMA has converged well past
    // its initial all-zero seed.
    for (let pass = 0; pass < 50; pass++) {
      for (const residual of residuals) {
        cov = ewmaCovariance(cov, residual, 0.2);
      }
    }

    // Components 0 and 1 should show strong positive covariance; component
    // 2 (independent-ish noise around a small mean) should be much weaker
    // in its cross terms with 0/1.
    expect(cov[0]![1]!).toBeGreaterThan(0);
    expect(cov[0]![1]!).toBeGreaterThan(Math.abs(cov[0]![2]!));
  });

  it("is positive semi-definite for a rank-deficient residual history (all residuals scalar multiples of one direction)", () => {
    let cov = emptyCovariance(3);
    const direction = [1, 2, -1];
    for (let i = 0; i < 20; i++) {
      const scale = i % 2 === 0 ? 1 : -1;
      const residual = direction.map((d) => d * scale);
      cov = ewmaCovariance(cov, residual, 0.3);
    }

    // PSD check via Sylvester's criterion on a small (3x3) matrix: every
    // leading principal minor must be >= 0 (within floating tolerance).
    const m1 = cov[0]![0]!;
    const m2 = cov[0]![0]! * cov[1]![1]! - cov[0]![1]! * cov[1]![0]!;
    const det3 =
      cov[0]![0]! * (cov[1]![1]! * cov[2]![2]! - cov[1]![2]! * cov[2]![1]!) -
      cov[0]![1]! * (cov[1]![0]! * cov[2]![2]! - cov[1]![2]! * cov[2]![0]!) +
      cov[0]![2]! * (cov[1]![0]! * cov[2]![1]! - cov[1]![1]! * cov[2]![0]!);

    expect(m1).toBeGreaterThanOrEqual(-1e-9);
    expect(m2).toBeGreaterThanOrEqual(-1e-9);
    expect(det3).toBeGreaterThanOrEqual(-1e-9);
  });

  it("shrinks off-diagonal entries relative to an unshrunk EWMA fold, leaving diagonal entries at the unshrunk value", () => {
    const residual = [2, 3];
    const folded = ewmaCovariance(emptyCovariance(2), residual, 0.5);
    // Unshrunk EWMA would give exactly alpha * outer(residual, residual)
    // from an all-zero prior.
    const unshrunkOffDiag = 0.5 * (2 * 3);
    const unshrunkDiag0 = 0.5 * (2 * 2);
    expect(folded[0]![1]!).toBeLessThan(unshrunkOffDiag);
    expect(folded[0]![0]!).toBeCloseTo(unshrunkDiag0, 9);
  });
});
