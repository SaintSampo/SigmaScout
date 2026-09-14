/**
 * The lattice marginal family.
 * Expected values come from references built here — a series normal CDF, a
 * direct-product beta-binomial, brute-force enumeration — never from the
 * code under test.
 */
import { describe, expect, it } from "vitest";
import type { RpThresholdVariable } from "./constants.js";
import {
  divideLatticePmf,
  fitMarginal,
  IncommensurateLatticeStepsError,
  LATTICE_RHO_CLAMP,
  latticeSumTail,
  materializeLatticeMarginal,
  probAtLeast,
  probAtMost,
  type LatticePmf,
} from "./marginals.js";

/** Standard normal CDF from the Maclaurin series of erf — accurate to ~1e-15 for |z| up to about 4. */
function refPhi(z: number): number {
  const x = z / Math.SQRT2;
  let term = x;
  let sum = x;
  for (let n = 1; n < 400; n++) {
    term *= (-x * x) / n;
    const add = term / (2 * n + 1);
    sum += add;
    if (Math.abs(add) < 1e-20) break;
  }
  return 0.5 * (1 + (2 / Math.sqrt(Math.PI)) * sum);
}

function choose(n: number, k: number): number {
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return c;
}

function rising(a: number, k: number): number {
  let r = 1;
  for (let i = 0; i < k; i++) r *= a + i;
  return r;
}

function refBetaBinomial(n: number, alpha: number, beta: number): number[] {
  const raw = Array.from({ length: n + 1 }, (_, k) => (choose(n, k) * rising(alpha, k) * rising(beta, n - k)) / rising(alpha + beta, n));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((p) => p / sum);
}

function refBinomial(n: number, p: number): number[] {
  return Array.from({ length: n + 1 }, (_, k) => choose(n, k) * p ** k * (1 - p) ** (n - k));
}

function expectPmfClose(actual: readonly number[] | undefined, expected: readonly number[]): void {
  expect(actual).toBeDefined();
  expect(actual!.length).toBe(expected.length);
  actual!.forEach((p, i) => expect(Math.abs(p - expected[i]!), `index ${i}: ${p} vs ${expected[i]}`).toBeLessThan(1e-12));
}

function sumOf(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

describe("bounded lattice form (both bounds declared)", () => {
  const support = { step: 5, min: 0, max: 15 };

  it("a mean above max is a point mass on max, with no throw", () => {
    const fit = fitMarginal(15.2, 4, "lattice", support);
    expect(fit.resolved).toBe("lattice");
    expect(fit.fallbackReason).toBe("mean-outside-support");
    expect(fit.latticePmf).toEqual({ base: 15, step: 5, probabilities: [1] });
    expect(probAtLeast(fit, 15)).toBe(1);
    expect(probAtLeast(fit, 15.5)).toBe(0);
    expect(probAtMost(fit, 14)).toBe(0);
  });

  it("a mean below min is a point mass on min", () => {
    const fit = fitMarginal(-1, 4, "lattice", support);
    expect(fit.fallbackReason).toBe("mean-outside-support");
    expect(fit.latticePmf).toEqual({ base: 0, step: 5, probabilities: [1] });
    expect(probAtMost(fit, 0)).toBe(1);
    expect(probAtLeast(fit, 1)).toBe(0);
  });

  it("variance at or below the binomial variance falls back to binomial", () => {
    // n = 3, m = 1.5, p = 0.5, binomial variance 0.75 step^2 = 18.75.
    for (const variance of [10, 18.75]) {
      const fit = fitMarginal(7.5, variance, "lattice", support);
      expect(fit.fallbackReason).toBe("under-dispersed");
      expectPmfClose(fit.latticePmf?.probabilities, refBinomial(3, 0.5));
    }
  });

  it("overdispersion past rho 0.999 is clamped", () => {
    const fit = fitMarginal(7.5, 1e6, "lattice", support);
    expect(fit.fallbackReason).toBe("overdispersion-clamped");
    const shape = 1 / LATTICE_RHO_CLAMP - 1;
    expect(LATTICE_RHO_CLAMP).toBe(0.999);
    expectPmfClose(fit.latticePmf?.probabilities, refBetaBinomial(3, 0.5 * shape, 0.5 * shape));
  });

  it("n = 1 gives a Bernoulli on the mean", () => {
    const fit = fitMarginal(2, 100, "lattice", { step: 5, min: 0, max: 5 });
    expectPmfClose(fit.latticePmf?.probabilities, [0.6, 0.4]);
    expect(fit.latticePmf?.base).toBe(0);
  });

  it("min = max gives a point mass", () => {
    const fit = fitMarginal(10, 3, "lattice", { step: 5, min: 10, max: 10 });
    expect(fit.latticePmf).toEqual({ base: 10, step: 5, probabilities: [1] });
  });

  it("beta-binomial n=2, p=0.5, rho=0.5 matches the rising-factorial formula", () => {
    // m = 1, p = 0.5, binomial variance 0.5, rho = (v/0.5 - 1)/1 = 0.5 -> v = 0.75. alpha = beta = 0.5.
    const fit = fitMarginal(1, 0.75, "lattice", { step: 1, min: 0, max: 2 });
    expect(fit.fallbackReason).toBeUndefined();
    expectPmfClose(fit.latticePmf?.probabilities, [0.375, 0.25, 0.375]);
    expectPmfClose(fit.latticePmf?.probabilities, refBetaBinomial(2, 0.5, 0.5));
  });

  it("a general beta-binomial matches the reference (2023 linkPoints' support)", () => {
    const n = 9;
    const m = 17 / 5;
    const p = m / n;
    const bin = n * p * (1 - p);
    const rho = (200 / 25 / bin - 1) / (n - 1);
    const fit = fitMarginal(17, 200, "lattice", { step: 5, min: 0, max: 45 });
    expectPmfClose(fit.latticePmf?.probabilities, refBetaBinomial(n, p * (1 / rho - 1), (1 - p) * (1 / rho - 1)));
    const reference = refBetaBinomial(n, p * (1 / rho - 1), (1 - p) * (1 / rho - 1));
    for (const threshold of [0, 5, 12, 25, 45, 50]) {
      const expected = sumOf(reference.filter((_, k) => 5 * k >= threshold));
      expect(Math.abs(probAtLeast(fit, threshold) - expected)).toBeLessThan(1e-12);
      const expectedAtMost = sumOf(reference.filter((_, k) => 5 * k <= threshold));
      expect(Math.abs(probAtMost(fit, threshold) - expectedAtMost)).toBeLessThan(1e-12);
    }
  });

  it("every bounded pmf sums to 1 within 1e-12", () => {
    const cases: [number, number, { step: number; min: number; max: number }][] = [
      [15.2, 4, support],
      [-1, 4, support],
      [7.5, 10, support],
      [7.5, 1e6, support],
      [7.5, 40, support],
      [2, 100, { step: 5, min: 0, max: 5 }],
      [10, 3, { step: 5, min: 10, max: 10 }],
      [60, 900, { step: 5, min: 0, max: 120 }],
      [3.3, 50, { step: 1, min: 0, max: 45 }],
    ];
    for (const [mean, variance, s] of cases) {
      const fit = fitMarginal(mean, variance, "lattice", s);
      expect(Math.abs(sumOf(fit.latticePmf!.probabilities) - 1)).toBeLessThan(1e-12);
      expect(fit.latticePmf!.probabilities.every((p) => p >= 0)).toBe(true);
    }
  });
});

describe("discretized Gaussian (a bound not declared)", () => {
  it("{step 1, min 0}, mean 3, sd 2: closed-form tails", () => {
    const fit = fitMarginal(3, 4, "lattice", { step: 1, min: 0 });
    expect(fit.resolved).toBe("lattice");
    expect(fit.latticePmf).toBeUndefined();
    expect(Math.abs(probAtLeast(fit, 5) - refPhi(-(4.5 - 3) / 2))).toBeLessThan(1e-12);
    expect(Math.abs(probAtLeast(fit, 4.3) - refPhi(-(4.5 - 3) / 2))).toBeLessThan(1e-12);
    expect(probAtLeast(fit, 0)).toBe(1);
    expect(probAtLeast(fit, -3)).toBe(1);
    expect(probAtMost(fit, -1)).toBe(0);
    expect(Math.abs(probAtMost(fit, 2) - refPhi((2.5 - 3) / 2))).toBeLessThan(1e-12);
  });

  it("tails are monotone, and P(X <= t) + P(X >= t + step) = 1 on the lattice", () => {
    const fit = fitMarginal(3, 4, "lattice", { step: 1, min: 0 });
    let previousAtLeast = Number.POSITIVE_INFINITY;
    let previousAtMost = Number.NEGATIVE_INFINITY;
    for (let t = -3; t <= 15; t += 0.25) {
      const atLeast = probAtLeast(fit, t);
      const atMost = probAtMost(fit, t);
      expect(atLeast).toBeLessThanOrEqual(previousAtLeast);
      expect(atMost).toBeGreaterThanOrEqual(previousAtMost);
      previousAtLeast = atLeast;
      previousAtMost = atMost;
    }
    for (let t = 0; t <= 12; t++) expect(Math.abs(probAtMost(fit, t) + probAtLeast(fit, t + 1) - 1)).toBeLessThan(1e-12);
  });

  it("the materialized pmf lumps the lower tail onto min, is non-negative and sums to 1", () => {
    const fit = fitMarginal(3, 4, "lattice", { step: 1, min: 0 });
    const pmf = materializeLatticeMarginal(fit);
    expect(pmf.base).toBe(0);
    expect(pmf.step).toBe(1);
    expect(Math.abs(sumOf(pmf.probabilities) - 1)).toBeLessThan(1e-12);
    expect(pmf.probabilities.every((p) => p >= 0)).toBe(true);
    expect(Math.abs(pmf.probabilities[0]! - refPhi((0.5 - 3) / 2))).toBeLessThan(1e-12);
    expect(Math.abs(pmf.probabilities[3]! - (refPhi(0.25) - refPhi(-0.25)))).toBeLessThan(1e-12);
  });

  it("no mass is negative at mean 1e6, sd 1e-3", () => {
    for (const support of [{ step: 1, min: 0 }, { step: 1 }]) {
      const fit = fitMarginal(1e6, 1e-6, "lattice", support);
      const pmf = materializeLatticeMarginal(fit);
      expect(pmf.probabilities.every((p) => p >= 0 && Number.isFinite(p))).toBe(true);
      expect(Math.abs(sumOf(pmf.probabilities) - 1)).toBeLessThan(1e-12);
      for (const t of [999_998, 1e6, 1e6 + 0.4, 1e6 + 1]) {
        const atLeast = probAtLeast(fit, t);
        expect(atLeast >= 0 && atLeast <= 1).toBe(true);
      }
      expect(probAtLeast(fit, 1e6)).toBeCloseTo(1, 12);
      expect(probAtLeast(fit, 1e6 + 1)).toBeCloseTo(0, 12);
    }
  });

  it("unbounded {step 1} (2016 attackedTowerEndStrength): P(X <= 0) = Phi((0.5 - mean)/sd)", () => {
    const fit = fitMarginal(-4.2, 9, "lattice", { step: 1 });
    expect(fit.fallbackReason).toBeUndefined();
    expect(Math.abs(probAtMost(fit, 0) - refPhi((0.5 + 4.2) / 3))).toBeLessThan(1e-12);
    expect(Math.abs(probAtLeast(fit, -6) - refPhi(-(-6.5 + 4.2) / 3))).toBeLessThan(1e-12);
  });

  it("a fitted mean far below min never throws and puts all mass on min", () => {
    const fit = fitMarginal(-50, 1, "lattice", { step: 1, min: 0 });
    expect(fit.fallbackReason).toBe("mean-outside-support");
    expect(probAtLeast(fit, 0)).toBe(1);
    expect(probAtLeast(fit, 1)).toBeLessThan(1e-12);
    expect(materializeLatticeMarginal(fit)).toEqual({ base: 0, step: 1, probabilities: [1] });
  });
});

describe("the existing rungs still come first for a lattice declaration", () => {
  it("non-finite and zero-variance inputs resolve degenerate exactly as before", () => {
    expect(fitMarginal(Number.NaN, 4, "lattice", { step: 1, min: 0 })).toEqual({
      declared: "lattice",
      resolved: "degenerate",
      mean: 0,
      variance: 0,
      fallbackReason: "non-finite",
    });
    const zero = fitMarginal(7.3, 0, "lattice", { step: 5, min: 0, max: 15 });
    expect(zero.resolved).toBe("degenerate");
    expect(zero.fallbackReason).toBe("zero-variance");
    expect(materializeLatticeMarginal(zero)).toEqual({ base: 7.3, step: 1, probabilities: [1] });
  });

  it("declaring lattice without a lattice support is a type error, and throws at runtime", () => {
    // @ts-expect-error: "lattice" requires its RpLatticeSupport argument
    expect(() => fitMarginal(3, 4, "lattice")).toThrow(/no lattice support/);
    // @ts-expect-error: every RpThresholdVariable must declare its lattice
    const missing: RpThresholdVariable = { name: "x", unit: "count", marginalFamily: "lattice" };
    expect(missing.name).toBe("x");
  });

  it("a gaussian declaration ignores a supplied lattice entirely", () => {
    expect(fitMarginal(3, 4, "gaussian", { step: 1, min: 0 })).toEqual(fitMarginal(3, 4, "gaussian"));
  });
});

/** Every combination of lattice points, summed exactly as the rule evaluator sums them. */
function bruteForceTail(terms: readonly { values: readonly number[]; probabilities: readonly number[] }[], threshold: number, direction: "gte" | "lte"): number {
  let total = 0;
  const walk = (index: number, sum: number, probability: number): void => {
    if (index === terms.length) {
      if (direction === "gte" ? sum >= threshold - 1e-9 : sum <= threshold + 1e-9) total += probability;
      return;
    }
    const term = terms[index]!;
    term.values.forEach((value, k) => walk(index + 1, sum + value, probability * term.probabilities[k]!));
  };
  walk(0, 0, 1);
  return total;
}

describe("latticeSumTail — exact lattice sums", () => {
  it("matches brute force across commensurate steps and a point shift, both directions", () => {
    const a: LatticePmf = { base: 0, step: 1, probabilities: [0.2, 0.5, 0.3] };
    const b: LatticePmf = { base: -1, step: 0.5, probabilities: [0.1, 0.2, 0.3, 0.4] };
    const shift: LatticePmf = { base: 0.25, step: 1, probabilities: [1] };
    const reference = [
      { values: [0, 1, 2], probabilities: a.probabilities },
      { values: [-1, -0.5, 0, 0.5], probabilities: b.probabilities },
      { values: [0.25], probabilities: [1] },
    ];
    for (let t = -2; t <= 4; t += 0.25) {
      for (const direction of ["gte", "lte"] as const) {
        expect(Math.abs(latticeSumTail([a, b, shift], t, direction) - bruteForceTail(reference, t, direction)), `${direction} ${t}`).toBeLessThan(1e-12);
      }
    }
  });

  it("divided terms (2017 rotor's shape: points / 60 + points / 40) match brute force", () => {
    const auto: LatticePmf = { base: 0, step: 60, probabilities: [0.3, 0.45, 0.25] };
    const teleop: LatticePmf = { base: 0, step: 40, probabilities: [0.05, 0.2, 0.4, 0.25, 0.1] };
    const terms = [divideLatticePmf(auto, 60), divideLatticePmf(teleop, 40)];
    const reference = [
      { values: [0, 60, 120].map((v) => v / 60), probabilities: auto.probabilities },
      { values: [0, 40, 80, 120, 160].map((v) => v / 40), probabilities: teleop.probabilities },
    ];
    for (let t = -1; t <= 7; t++) {
      expect(Math.abs(latticeSumTail(terms, t, "gte") - bruteForceTail(reference, t, "gte"))).toBeLessThan(1e-12);
    }
  });

  it("three spread terms convolve in order and match brute force", () => {
    const terms: LatticePmf[] = [
      { base: 0, step: 2, probabilities: [0.25, 0.25, 0.5] },
      { base: 1, step: 1, probabilities: [0.6, 0.4] },
      { base: 0, step: 4, probabilities: [0.7, 0.2, 0.1] },
    ];
    const reference = terms.map((d) => ({ values: d.probabilities.map((_, i) => d.base + i * d.step), probabilities: d.probabilities }));
    for (let t = 0; t <= 16; t++) {
      expect(Math.abs(latticeSumTail(terms, t, "gte") - bruteForceTail(reference, t, "gte"))).toBeLessThan(1e-12);
    }
  });

  it("point masses alone reduce to a comparison of their sum", () => {
    const terms: LatticePmf[] = [
      { base: 2.5, step: 1, probabilities: [1] },
      { base: 0.5, step: 1, probabilities: [1] },
    ];
    expect(latticeSumTail(terms, 3, "gte")).toBe(1);
    expect(latticeSumTail(terms, 3.01, "gte")).toBe(0);
    expect(latticeSumTail(terms, 3, "lte")).toBe(1);
    expect(latticeSumTail(terms, 2.99, "lte")).toBe(0);
  });

  it("incommensurate steps throw the named error", () => {
    const a: LatticePmf = { base: 0, step: 1, probabilities: [0.5, 0.5] };
    const b: LatticePmf = { base: 0, step: Math.SQRT2, probabilities: [0.5, 0.5] };
    expect(() => latticeSumTail([a, b], 1, "gte")).toThrow(IncommensurateLatticeStepsError);
    expect(() => latticeSumTail([a, b, a], 1, "gte")).toThrow(IncommensurateLatticeStepsError);
  });
});
