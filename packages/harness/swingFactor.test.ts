import { describe, expect, it } from "vitest";
import {
  allianceSwingBandVariance,
  SwingFactorAccumulator,
  SWING_FACTOR_HALF_LIFE_MATCHES,
  SWING_FACTOR_SCALE,
  swingDecayFor,
  swingFactorFromDeviations,
} from "./swingFactor.js";
import type { SwingFoldMatch, SwingFoldPrediction } from "./swingFactor.js";

describe("swingFactorFromDeviations", () => {
  it("returns undefined below two observations — one point cannot separate model bias from robot swing", () => {
    expect(swingFactorFromDeviations([])).toBeUndefined();
    expect(swingFactorFromDeviations([7])).toBeUndefined();
  });

  it("returns exactly 0 for identical deviations — a model that is CONSISTENTLY wrong describes a consistent robot", () => {
    for (const k of [2, 5, 20]) {
      expect(swingFactorFromDeviations(Array.from({ length: k }, () => 3))).toBeCloseTo(0, 10);
    }
  });

  it("is invariant to a constant shift, which is what makes it a statement about the ROBOT and not the model", () => {
    const base = [4, -2, 7, 1, -3];
    // +250 is roughly OPR's measured Einstein bias; it must not move the number.
    expect(swingFactorFromDeviations(base.map((d) => d + 250))).toBeCloseTo(swingFactorFromDeviations(base) as number, 8);
  });

  it("weights recent matches more: the same large deviation counts for more when it is newer", () => {
    const recent = swingFactorFromDeviations([1, 1, 1, 1, 1, 1, 10]) as number;
    const old = swingFactorFromDeviations([10, 1, 1, 1, 1, 1, 1]) as number;
    expect(recent).toBeGreaterThan(old);
  });

  it("matches an independently computed weighted-unbiased variance", () => {
    const decay = swingDecayFor(SWING_FACTOR_HALF_LIFE_MATCHES);
    const [older, newer] = [2, 10];
    const sumW = decay + 1;
    const mean = (decay * older + newer) / sumW;
    const numerator = decay * (older - mean) ** 2 + (newer - mean) ** 2;
    const denominator = sumW - (decay * decay + 1) / sumW;
    expect(swingFactorFromDeviations([older, newer])).toBeCloseTo(SWING_FACTOR_SCALE * Math.sqrt(numerator / denominator), 10);
  });

  it("throws on a non-finite deviation rather than coercing it to a flattering zero", () => {
    expect(() => swingFactorFromDeviations([1, Number.NaN])).toThrow(/non-finite/);
  });
});

describe("allianceSwingBandVariance", () => {
  const swings = new Map([["a", 10], ["b", 10], ["c", 10]]);

  it("combines by summing SQUARES — three robots at ±10 give ±17.32, never ±30", () => {
    expect(Math.sqrt(allianceSwingBandVariance(["a", "b", "c"], swings) as number)).toBeCloseTo(17.3205, 4);
  });

  it("returns undefined when any member is missing — never a narrower band from a partial sum", () => {
    expect(allianceSwingBandVariance(["a", "b", "unknown"], swings)).toBeUndefined();
    expect(allianceSwingBandVariance([], swings)).toBeUndefined();
  });
});

describe("SwingFactorAccumulator — walk-forward", () => {
  const RED = ["frc1", "frc2", "frc3"];

  it("has no band before two observations, and one after", () => {
    const acc = new SwingFactorAccumulator();
    expect(acc.bandVarianceFor(RED)).toBeUndefined();
    acc.fold(RED, 130, 100);
    expect(acc.bandVarianceFor(RED)).toBeUndefined();
    acc.fold(RED, 70, 100);
    expect(acc.bandVarianceFor(RED)).toBeGreaterThan(0);
  });

  it("never lets a match inform its own band — the project's predict-before-update rule", () => {
    const acc = new SwingFactorAccumulator();
    acc.fold(RED, 130, 100);
    acc.fold(RED, 70, 100);
    const beforeWildMatch = acc.bandVarianceFor(RED);
    acc.fold(RED, 99999, 100); // a wild result, folded AFTER the read above
    expect(beforeWildMatch).toBeLessThan(acc.bandVarianceFor(RED) as number);
  });

  it("divides an alliance residual by roster size, so a 2-team alliance is not read like a 3-team one", () => {
    const pair = new SwingFactorAccumulator();
    pair.fold(["frc1", "frc2"], 130, 100);
    pair.fold(["frc1", "frc2"], 70, 100);
    expect(pair.swingFor("frc1")).toBeCloseTo(swingFactorFromDeviations([15, -15]) as number, 10);
  });

  it("carries across events rather than resetting, so a team's second event starts from what it showed at its first", () => {
    const acc = new SwingFactorAccumulator();
    acc.fold(RED, 130, 100);
    acc.fold(RED, 70, 100);
    // No reset call exists by design; a later fold keeps building on the same history.
    expect(acc.swingFor("frc1")).toBeDefined();
  });

  it("ignores an unplayed or malformed row instead of throwing or consuming a decay step", () => {
    const acc = new SwingFactorAccumulator();
    acc.fold(RED, 130, 100);
    acc.fold(RED, Number.NaN, 100);
    acc.fold([], 130, 100);
    acc.fold(RED, 70, 100);
    expect(acc.swingFor("frc1")).toBeCloseTo(swingFactorFromDeviations([10, -10]) as number, 10);
  });

  it("is algorithm-agnostic: a WORSE model's larger residuals simply produce a wider band", () => {
    const good = new SwingFactorAccumulator();
    const bad = new SwingFactorAccumulator();
    good.fold(RED, 130, 100);
    good.fold(RED, 70, 100);
    bad.fold(RED, 400, 100);
    bad.fold(RED, -200, 100);
    expect(bad.bandVarianceFor(RED) as number).toBeGreaterThan(good.bandVarianceFor(RED) as number);
  });
});

describe("SwingFactorAccumulator.foldMatch — card-driven zero scores", () => {
  const RED = ["r1", "r2", "r3"];
  const BLUE = ["b1", "b2", "b3"];
  const DEMO_BLUE = ["frc9970", "frc9971", "frc9972"];
  const PREDICTION: SwingFoldPrediction = { redScore: 100, blueScore: 100 };

  /** Six-field literal, overriding only what a given test is about. */
  function match(overrides: Partial<SwingFoldMatch> = {}): SwingFoldMatch {
    return {
      redTeams: RED,
      redScore: 100,
      redDqs: [],
      blueTeams: BLUE,
      blueScore: 100,
      blueDqs: [],
      ...overrides,
    };
  }

  // Shared three-match stream for the first two tests: a real match, a
  // card-zeroed red alliance, then another real match.
  const REAL_1 = match({ redScore: 130, blueScore: 115 });
  const CARDED = match({ redScore: 0, redDqs: RED, blueScore: 90 });
  const REAL_2 = match({ redScore: 70, blueScore: 105 });

  it("a card is a ruling, not evidence: a fully-DQ'd zero-score alliance does not fold", () => {
    const acc = new SwingFactorAccumulator();
    acc.foldMatch(REAL_1, PREDICTION);
    acc.foldMatch(CARDED, PREDICTION);
    acc.foldMatch(REAL_2, PREDICTION);

    // Only the two real deviations (10, -10) ever reach the belief — the
    // carded row between them contributed nothing.
    const expected = swingFactorFromDeviations([10, -10]) as number;
    expect(acc.swingFor("r1")).toBeCloseTo(expected, 10);

    // Non-vacuity: a second accumulator that folds the SAME zero directly
    // (bypassing the DQ skip via the public `fold` method) must disagree —
    // proving the skip in `foldMatch` actually did something.
    const withZeroFolded = new SwingFactorAccumulator();
    withZeroFolded.fold(RED, 130, 100);
    withZeroFolded.fold(RED, 0, 100);
    withZeroFolded.fold(RED, 70, 100);
    expect(withZeroFolded.swingFor("r1")).not.toBeCloseTo(acc.swingFor("r1") as number, 5);
  });

  it("the opposing alliance still folds when the other side is carded", () => {
    const acc = new SwingFactorAccumulator();
    acc.foldMatch(REAL_1, PREDICTION);
    acc.foldMatch(CARDED, PREDICTION);
    acc.foldMatch(REAL_2, PREDICTION);

    // Blue was never DQ'd, so all three of its observations fold, including
    // the one opposite the carded red alliance: (115-100)/3, (90-100)/3,
    // (105-100)/3.
    const expectedBlue = swingFactorFromDeviations([5, -10 / 3, 5 / 3]) as number;
    expect(acc.swingFor("b1")).toBeDefined();
    expect(acc.swingFor("b1")).toBeCloseTo(expectedBlue, 10);
  });

  it("a partial DQ still folds — dq.ts measures that population as genuinely bad-but-real play", () => {
    const partiallyDqd = match({ redScore: 0, redDqs: [RED[0]!, RED[1]!], blueScore: 90 });

    const acc = new SwingFactorAccumulator();
    acc.foldMatch(REAL_1, PREDICTION);
    acc.foldMatch(partiallyDqd, PREDICTION);
    acc.foldMatch(REAL_2, PREDICTION);

    // Not every rating-eligible team is in `redDqs` (r3 is missing), so the
    // predicate returns false and the zero folds in like any other row.
    const expected = swingFactorFromDeviations([10, -100 / 3, -10]) as number;
    expect(acc.swingFor("r1")).toBeCloseTo(expected, 10);
  });

  it("a whole-alliance DQ with a non-zero score still folds — the zero, not the DQ, is what triggers the skip", () => {
    const nonZeroDqd = match({ redScore: 220, redDqs: RED, blueScore: 90 });

    const acc = new SwingFactorAccumulator();
    acc.foldMatch(REAL_1, PREDICTION);
    acc.foldMatch(nonZeroDqd, PREDICTION);
    acc.foldMatch(REAL_2, PREDICTION);

    const expected = swingFactorFromDeviations([10, 40, -10]) as number;
    expect(acc.swingFor("r1")).toBeCloseTo(expected, 10);
  });

  it("a skipped fold consumes no decay step — an interleaved carded match changes nothing", () => {
    const m1 = match({ redScore: 130 });
    const m2 = match({ redScore: 70 });
    const carded = match({ redScore: 0, redDqs: RED });
    const m3 = match({ redScore: 160 });

    const withCardedInterleaved = new SwingFactorAccumulator();
    withCardedInterleaved.foldMatch(m1, PREDICTION);
    withCardedInterleaved.foldMatch(m2, PREDICTION);
    withCardedInterleaved.foldMatch(carded, PREDICTION); // between the 2nd and 3rd real match
    withCardedInterleaved.foldMatch(m3, PREDICTION);

    const withCardedAbsent = new SwingFactorAccumulator();
    withCardedAbsent.foldMatch(m1, PREDICTION);
    withCardedAbsent.foldMatch(m2, PREDICTION);
    withCardedAbsent.foldMatch(m3, PREDICTION);

    // An implementation that decayed the belief and then declined to add
    // would leave the interleaved accumulator strictly below the other one —
    // this asserts exact equality, not merely "close", to catch that.
    expect(withCardedInterleaved.swingFor("r1")).toBeCloseTo(withCardedAbsent.swingFor("r1") as number, 12);
  });

  it("the demo rule still drops the whole match — the DQ change does not disturb its ordering", () => {
    const acc = new SwingFactorAccumulator();
    acc.foldMatch(REAL_1, PREDICTION);
    acc.foldMatch(REAL_2, PREDICTION);
    const redBeforeDemo = acc.swingFor("r1");
    expect(redBeforeDemo).toBeDefined();

    // Blue fully demo, empty DQ lists, non-zero scores on both sides — the
    // demo early return must still drop the WHOLE match, red included, even
    // though this predicate now sits beside a second, DQ-driven skip.
    const demoBlueMatch = match({ redScore: 300, blueTeams: DEMO_BLUE, blueScore: 250 });
    acc.foldMatch(demoBlueMatch, PREDICTION);

    expect(acc.swingFor("r1")).toBe(redBeforeDemo);
    expect(acc.swingFor(DEMO_BLUE[0]!)).toBeUndefined();
  });
});
