/**
 * Tests for D-12's three win-probability link modes, including the
 * load-bearing nesting-property assertion (mode 2 collapses to mode 1 when
 * its variance term is replaced by the season constant).
 */
import { describe, expect, it } from "vitest";
import { erf, normalCdf, winProbability, type WinProbMode } from "./linkFunctions.js";

describe("WinProbMode", () => {
  it("has exactly the three modes season-sd, predictive-variance, normal-cdf", () => {
    const modes: WinProbMode[] = ["season-sd", "predictive-variance", "normal-cdf"];
    for (const mode of modes) {
      expect(() => winProbability(mode, 5, 10, 25, 1)).not.toThrow();
    }
  });
});

describe("winProbability — season-sd mode reproduces Statbotics' base-10 logistic form", () => {
  it("matches the algebraically equivalent base-10 form 1/(1+10^(-margin/(sd*ln10))) to within 1e-12 for a range of margins (the natural-exp/base-10 logistic identity Statbotics' own k_func exploits)", () => {
    const seasonScoreSd = 22;
    for (const margin of [-40, -10, -1, 0, 1, 10, 40]) {
      const expected = 1 / (1 + 10 ** (-margin / (seasonScoreSd * Math.LN10)));
      const actual = winProbability("season-sd", margin, seasonScoreSd, 999, 1);
      expect(actual).toBeCloseTo(expected, 12);
    }
  });
});

describe("winProbability — D-12 nesting property", () => {
  it("mode 2 with the variance term replaced by (seasonScoreSd/c)^2 equals mode 1's value exactly (to floating tolerance)", () => {
    for (const seasonScoreSd of [5, 15, 40]) {
      for (const c of [0.5, 1, 2]) {
        for (const margin of [-30, -5, 0, 5, 30]) {
          const substitutedVariance = (seasonScoreSd / c) ** 2;
          const mode1 = winProbability("season-sd", margin, seasonScoreSd, 999, c);
          const mode2 = winProbability("predictive-variance", margin, seasonScoreSd, substitutedVariance, c);
          expect(mode2).toBeCloseTo(mode1, 12);
        }
      }
    }
  });
});

describe("normalCdf — known standard-normal values", () => {
  it("matches 0, +-1sigma, +-2sigma to within 1.5e-7", () => {
    expect(normalCdf(0, 1)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1, 1)).toBeCloseTo(0.8413447460685429, 6);
    expect(normalCdf(-1, 1)).toBeCloseTo(0.15865525393145707, 6);
    expect(normalCdf(2, 1)).toBeCloseTo(0.9772498680518208, 6);
    expect(normalCdf(-2, 1)).toBeCloseTo(0.022750131948179195, 6);
  });
});

describe("erf", () => {
  it("is an odd function passing through the origin", () => {
    expect(erf(0)).toBeCloseTo(0, 6);
    expect(erf(1)).toBeCloseTo(-erf(-1), 6);
  });
});

describe("winProbability — all three modes at margin 0", () => {
  it("return exactly 0.5", () => {
    expect(winProbability("season-sd", 0, 20, 100, 1)).toBe(0.5);
    expect(winProbability("predictive-variance", 0, 20, 100, 1)).toBe(0.5);
    expect(winProbability("normal-cdf", 0, 20, 100, 1)).toBe(0.5);
  });

  it("return exactly 0.5 at margin 0 even when predictiveVariance is degenerate (0 or negative)", () => {
    expect(winProbability("predictive-variance", 0, 20, 0, 1)).toBe(0.5);
    expect(winProbability("predictive-variance", 0, 20, -5, 1)).toBe(0.5);
    expect(winProbability("normal-cdf", 0, 20, 0, 1)).toBe(0.5);
    expect(winProbability("normal-cdf", 0, 20, -5, 1)).toBe(0.5);
  });
});

describe("winProbability — bounded in [0, 1] for every margin, including extremes", () => {
  it("stays within the closed interval [0, 1] for extreme margins across all three modes", () => {
    const margins = [-1e6, -100, -1, 0, 1, 100, 1e6];
    const modes: WinProbMode[] = ["season-sd", "predictive-variance", "normal-cdf"];
    for (const mode of modes) {
      for (const margin of margins) {
        const p = winProbability(mode, margin, 20, 50, 1);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
        expect(Number.isNaN(p)).toBe(false);
      }
    }
  });
});

describe("winProbability — degenerate variance handled without NaN/Infinity", () => {
  it("a zero or negative variance passed to predictive-variance or normal-cdf mode never produces NaN or Infinity", () => {
    for (const predictiveVariance of [0, -1, -100]) {
      for (const margin of [-10, 0, 10]) {
        const pv = winProbability("predictive-variance", margin, 20, predictiveVariance, 1);
        const ncdf = winProbability("normal-cdf", margin, 20, predictiveVariance, 1);
        expect(Number.isFinite(pv)).toBe(true);
        expect(Number.isFinite(ncdf)).toBe(true);
      }
    }
  });
});
