/**
 * Pure, synthetic, corpus-free pins for the browser's alliance pricer. Every
 * expected value below is hand-computed from the closed form in the plan's
 * `<baseline>` block, never lifted from this module's own output.
 *
 * The load-bearing one is the UNCORRECTED-VARIANCE pin: it is the test that
 * fails if a future editor reaches for `sigmaMatchBandVariance`'s display band.
 */
import { describe, expect, it } from "vitest";
import { standardNormalCdf } from "../../rankingPoints/marginals.js";
import { TOTAL_METRIC_KEY } from "../types.js";
import { SIGMA_METRIC_KEY } from "../../../harness/sigmaScore.js";
import {
  ALLIANCE_WIN_PROBABILITY_EPSILON,
  allianceRatingsFromMetrics,
  allianceWinProbability,
  PRICING_SIGMA_KEY,
  PRICING_TOTAL_KEY,
  type AllianceMemberRating,
} from "./allianceWinProbability.js";

/** The `<baseline>` fixture: red totals [30,20,10] / sigmas [6,8,10]. Mean 60, variance 200. */
const RED: AllianceMemberRating[] = [
  { teamKey: "frc1", total: 30, sigma: 6 },
  { teamKey: "frc2", total: 20, sigma: 8 },
  { teamKey: "frc3", total: 10, sigma: 10 },
];
/** The `<baseline>` fixture: blue totals [25,20,15] / sigmas [5,5,5]. Mean 60, variance 75. */
const BLUE: AllianceMemberRating[] = [
  { teamKey: "frc4", total: 25, sigma: 5 },
  { teamKey: "frc5", total: 20, sigma: 5 },
  { teamKey: "frc6", total: 15, sigma: 5 },
];
/** The same fixture with red's first total at 31, so the mean gap is exactly 1. */
const RED_OFFSET: AllianceMemberRating[] = [{ teamKey: "frc1", total: 31, sigma: 6 }, RED[1]!, RED[2]!];

describe("standardNormalCdf — the z-table pins this module's arithmetic rests on", () => {
  it("is EXACTLY 0.5 at zero, by strict equality (brier.ts detects a no-call by exact equality with 0.5)", () => {
    expect(standardNormalCdf(0)).toBe(0.5);
  });

  it("matches the tabulated normal CDF within the stated 2e-7 Abramowitz-Stegun 7.1.26 bound", () => {
    expect(Math.abs(standardNormalCdf(1) - 0.8413447460685429)).toBeLessThan(2e-7);
    expect(Math.abs(standardNormalCdf(-1) - 0.15865525393145705)).toBeLessThan(2e-7);
    expect(Math.abs(standardNormalCdf(1.959963984540054) - 0.975)).toBeLessThan(2e-7);
  });
});

describe("allianceWinProbability — hand-computed pins", () => {
  it("returns EXACTLY 0.5 for equal means and unequal variances (a symmetric link makes that a coin)", () => {
    // redMean = 60, blueMean = 60, z = 0 / sqrt(200 + 75) = 0.
    expect(allianceWinProbability(RED, BLUE)).toBe(0.5);
  });

  it("returns Phi(1 / sqrt(275)) to 12 places when red's mean is one point higher", () => {
    // redMean = 61, blueMean = 60, redVar = 36 + 64 + 100 = 200, blueVar = 25 + 25 + 25 = 75.
    const expected = standardNormalCdf(1 / Math.sqrt(275));
    expect(allianceWinProbability(RED_OFFSET, BLUE)).toBeCloseTo(expected, 12);
  });

  it("uses the UNCORRECTED sum of squared Sigma Scores: Phi(1/sqrt(275)), NOT the display band's Phi(1/sqrt(825))", () => {
    // `sigmaMatchBandVariance(rosterSize, v)` multiplies by roster size — 3 here —
    // giving redVar 600 and blueVar 225, hence sqrt(825). Win and tie odds keep
    // the uncorrected variance: red's and blue's misses are correlated, so
    // widening it worsens Brier (sigmaScore.ts's own doc comment). This is the
    // assertion that fails if anyone substitutes the display band.
    const actual = allianceWinProbability(RED_OFFSET, BLUE)!;
    expect(actual).toBeCloseTo(standardNormalCdf(1 / Math.sqrt(275)), 12);
    expect(actual).not.toBeCloseTo(standardNormalCdf(1 / Math.sqrt(825)), 6);
  });

  it("is symmetric: f(red, blue) + f(blue, red) is exactly 1 away from the clamp", () => {
    const forward = allianceWinProbability(RED_OFFSET, BLUE)!;
    const reversed = allianceWinProbability(BLUE, RED_OFFSET)!;
    expect(forward + reversed).toBe(1);
  });

  it("is order-free within a roster: the mean and the variance are both order-free sums", () => {
    const shuffled = [RED_OFFSET[2]!, RED_OFFSET[0]!, RED_OFFSET[1]!];
    expect(allianceWinProbability(shuffled, BLUE)).toBe(allianceWinProbability(RED_OFFSET, BLUE));
  });
});

describe("allianceWinProbability — all-or-nothing absence, one case per path", () => {
  const cases: Array<[string, AllianceMemberRating]> = [
    ["an absent total", { teamKey: "frcX", total: undefined, sigma: 5 }],
    ["an absent sigma", { teamKey: "frcX", total: 20, sigma: undefined }],
    ["a NaN total", { teamKey: "frcX", total: Number.NaN, sigma: 5 }],
    ["a NaN sigma", { teamKey: "frcX", total: 20, sigma: Number.NaN }],
    ["an Infinity total", { teamKey: "frcX", total: Number.POSITIVE_INFINITY, sigma: 5 }],
    ["a non-number sigma", { teamKey: "frcX", total: 20, sigma: "5" as unknown as number }],
  ];

  for (const [label, broken] of cases) {
    it(`returns undefined for a red roster member with ${label} — never a narrower plausible number`, () => {
      expect(allianceWinProbability([RED[0]!, RED[1]!, broken], BLUE)).toBeUndefined();
    });
    it(`returns undefined for a blue roster member with ${label}`, () => {
      expect(allianceWinProbability(RED, [BLUE[0]!, BLUE[1]!, broken])).toBeUndefined();
    });
  }
});

describe("allianceWinProbability — the other honest-undefined paths", () => {
  it("returns undefined for an empty roster on either side (a zero-length alliance is never valid)", () => {
    expect(allianceWinProbability([], BLUE)).toBeUndefined();
    expect(allianceWinProbability(RED, [])).toBeUndefined();
  });

  it("returns undefined for a zero combined variance rather than dividing by zero or returning a hard 0/1", () => {
    const zeroRed: AllianceMemberRating[] = [{ teamKey: "frc1", total: 50, sigma: 0 }];
    const zeroBlue: AllianceMemberRating[] = [{ teamKey: "frc2", total: 10, sigma: 0 }];
    expect(allianceWinProbability(zeroRed, zeroBlue)).toBeUndefined();
  });
});

describe("allianceWinProbability — the clamp matches spr.ts:605 exactly", () => {
  it("never returns exactly 0 or exactly 1, so a comparison against pRedWin is not an artifact of two clamps", () => {
    const eps = ALLIANCE_WIN_PROBABILITY_EPSILON;
    const high = allianceWinProbability([{ teamKey: "a", total: 100_000, sigma: 1 }], [{ teamKey: "b", total: 0, sigma: 1 }])!;
    const low = allianceWinProbability([{ teamKey: "a", total: 0, sigma: 1 }], [{ teamKey: "b", total: 100_000, sigma: 1 }])!;
    expect(high).toBe(1 - eps);
    expect(low).toBe(eps);
    expect(high).toBeLessThan(1);
    expect(low).toBeGreaterThan(0);
  });

  it("uses the same epsilon spr.ts uses", () => {
    expect(ALLIANCE_WIN_PROBABILITY_EPSILON).toBe(1e-6);
  });
});

describe("allianceWinProbability — a roster, not a fixed triple", () => {
  it("prices two-, three- and four-team rosters (surrogate and no-show rosters are real)", () => {
    const two: AllianceMemberRating[] = [RED[0]!, RED[1]!];
    const four: AllianceMemberRating[] = [...RED, { teamKey: "frc7", total: 5, sigma: 4 }];
    expect(allianceWinProbability(two, BLUE)).toBeTypeOf("number");
    expect(allianceWinProbability(RED, BLUE)).toBeTypeOf("number");
    expect(allianceWinProbability(four, BLUE)).toBeTypeOf("number");
  });
});

describe("allianceRatingsFromMetrics — one definition of the two published keys", () => {
  it("pins the local key literals against the real published constants (drift turns this red, not a bundle)", () => {
    expect(PRICING_TOTAL_KEY).toBe(TOTAL_METRIC_KEY);
    expect(PRICING_SIGMA_KEY).toBe(SIGMA_METRIC_KEY);
  });

  it("reads total and sigma out of a published metrics record", () => {
    const metrics = {
      frc1: { total: { value: 30 }, sigma: { value: 6 } },
      frc2: { total: { value: 20, spread: 3 }, sigma: { value: 8 } },
    };
    expect(allianceRatingsFromMetrics(["frc1", "frc2"], metrics)).toEqual([
      { teamKey: "frc1", total: 30, sigma: 6 },
      { teamKey: "frc2", total: 20, sigma: 8 },
    ]);
  });

  it("yields undefined fields for an absent team or an absent component, which the pricer turns into an undefined alliance", () => {
    const metrics = { frc1: { total: { value: 30 } } };
    const ratings = allianceRatingsFromMetrics(["frc1", "frcMissing"], metrics);
    expect(ratings).toEqual([
      { teamKey: "frc1", total: 30, sigma: undefined },
      { teamKey: "frcMissing", total: undefined, sigma: undefined },
    ]);
    expect(allianceWinProbability(ratings, BLUE)).toBeUndefined();
  });
});
