import { describe, expect, it } from "vitest";
import { rpMoments } from "./rpMoments.js";

describe("rpMoments", () => {
  it("returns mean 1 and sd sqrt(0.5) for [0.25, 0.5, 0.25], within 1e-9", () => {
    const result = rpMoments([0.25, 0.5, 0.25]);
    expect(result).toBeDefined();
    expect(result!.mean).toBeCloseTo(1, 9);
    expect(result!.sd).toBeCloseTo(Math.sqrt(0.5), 9);
  });

  it("returns undefined for an undefined pmf", () => {
    expect(rpMoments(undefined)).toBeUndefined();
  });

  it("returns undefined for an empty pmf", () => {
    expect(rpMoments([])).toBeUndefined();
  });

  it("returns a standard deviation of exactly 0, not NaN, for a single-outcome pmf", () => {
    const result = rpMoments([1]);
    expect(result).toBeDefined();
    expect(result!.mean).toBe(0);
    expect(result!.sd).toBe(0);
    expect(Number.isNaN(result!.sd)).toBe(false);
  });

  it("computes a non-degenerate mean/sd for a four-outcome pmf", () => {
    // Mean = 0*0.1 + 1*0.2 + 2*0.3 + 3*0.4 = 0 + 0.2 + 0.6 + 1.2 = 2
    const result = rpMoments([0.1, 0.2, 0.3, 0.4]);
    expect(result).toBeDefined();
    expect(result!.mean).toBeCloseTo(2, 9);
    // Variance = (0-2)^2*.1 + (1-2)^2*.2 + (2-2)^2*.3 + (3-2)^2*.4 = .4+.2+0+.4 = 1
    expect(result!.sd).toBeCloseTo(1, 9);
  });
});
