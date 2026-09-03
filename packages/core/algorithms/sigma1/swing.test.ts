/**
 * D-Y1/D-Y2 (quick task 260903-750): the recency-weighted robot-consistency
 * estimator, tested at the module level. The developer's three user stories
 * are ALSO tested end-to-end through `vpr.teamMetrics` in `sigma1.test.ts` —
 * that is where they bind the shipped display; this file pins the arithmetic
 * those tests depend on, so a failure here says WHICH property broke rather
 * than only that the published number moved.
 */
import { describe, expect, it } from "vitest";
import {
  SIGMA1_SWING_HALF_LIFE_MATCHES,
  SIGMA1_SWING_SCALE,
  emptyTeamSwing,
  foldSwingObservation,
  swingDecayFor,
  swingSpread,
  type TeamSwing,
} from "./swing.js";

const KEY = "total";
const HALF_LIFE = SIGMA1_SWING_HALF_LIFE_MATCHES;

/** Folds a series of raw DEVIATIONS (not squares) in order, oldest first. */
function foldDeviations(deviations: readonly number[], halfLife = HALF_LIFE): TeamSwing {
  let swing = emptyTeamSwing();
  for (const deviation of deviations) {
    swing = foldSwingObservation(swing, { [KEY]: deviation * deviation }, halfLife);
  }
  return swing;
}

function spreadOf(deviations: readonly number[], halfLife = HALF_LIFE): number {
  return swingSpread(foldDeviations(deviations, halfLife), KEY, SIGMA1_SWING_SCALE)!;
}

describe("the two measured constants", () => {
  it("are the values CONTEXT's measurements selected — 6 matches and 1.92", () => {
    // Asserted as literals on purpose. Both were measured (a walk-forward
    // sweep of 275,172 team-matches for the half-life; a non-circular
    // regression on 86,844 alliance-observations for the scale), so a silent
    // edit to either is a change to a published number that no measurement
    // supports. This test is what makes such an edit loud.
    expect(SIGMA1_SWING_HALF_LIFE_MATCHES).toBe(6);
    expect(SIGMA1_SWING_SCALE).toBe(1.92);
  });

  it("the scale EXCEEDS sqrt(3), which is the independence assumption failing rather than a fitting artifact", () => {
    // D-06 assumes independent teammates, under which an alliance swings
    // exactly sqrt(3) times one robot. The measured excess is teammate
    // correlation, absorbed rather than assumed away — see SIGMA1_SWING_SCALE.
    expect(SIGMA1_SWING_SCALE).toBeGreaterThan(Math.sqrt(3));
    // ...and not by so much that it stopped being a per-robot quantity.
    expect(SIGMA1_SWING_SCALE).toBeLessThan(2 * Math.sqrt(3));
  });
});

describe("swingDecayFor — the half-life is the half-life", () => {
  it("compounds to exactly one half over the half-life's own horizon", () => {
    expect(swingDecayFor(6) ** 6).toBeCloseTo(0.5, 12);
    expect(swingDecayFor(1) ** 1).toBeCloseTo(0.5, 12);
    expect(swingDecayFor(20) ** 20).toBeCloseTo(0.5, 12);
  });

  it("an observation exactly one half-life old carries HALF the weight of the newest one", () => {
    // Measured through the accumulator itself rather than asserted about the
    // decay in isolation, so the fold and the constant are checked together.
    const w = swingDecayFor(HALF_LIFE);
    let swing = foldSwingObservation(emptyTeamSwing(), { [KEY]: 1 }, HALF_LIFE);
    for (let i = 0; i < HALF_LIFE; i++) swing = foldSwingObservation(swing, { [KEY]: 0 }, HALF_LIFE);
    // The old unit observation now contributes w^HALF_LIFE = 0.5 of a unit.
    expect(swing[KEY]!.weightedSquares).toBeCloseTo(0.5, 12);
    // Sanity on the shared decay: the newest zero contributed nothing.
    expect(w ** HALF_LIFE).toBeCloseTo(0.5, 12);
  });
});

describe("D-Y2 — never blank, from the first match", () => {
  it("a team with EXACTLY ONE match publishes Y = scale * |deviation| — not blank, not zero", () => {
    const y = spreadOf([7]);
    expect(y).toBeDefined();
    expect(y).toBeCloseTo(SIGMA1_SWING_SCALE * 7, 12);
  });

  it("the sign of that single deviation cannot matter — a robot 7 points UNDER is as inconsistent as one 7 points OVER", () => {
    expect(spreadOf([-7])).toBe(spreadOf([7]));
  });

  it("a team with NO matches is the ONE undefined case, and it is a domain check rather than a threshold", () => {
    expect(swingSpread(emptyTeamSwing(), KEY, SIGMA1_SWING_SCALE)).toBeUndefined();
    // The threshold half: one match is enough, so nothing here is a
    // minimum-match rule. D-Y2 forbids adding one.
    expect(swingSpread(foldDeviations([3]), KEY, SIGMA1_SWING_SCALE)).toBeDefined();
  });

  it("a key never folded is undefined even for a team that HAS folded other keys", () => {
    const swing = foldSwingObservation(emptyTeamSwing(), { total: 9 }, HALF_LIFE);
    expect(swingSpread(swing, "total", SIGMA1_SWING_SCALE)).toBeDefined();
    expect(swingSpread(swing, "phaseAuto", SIGMA1_SWING_SCALE)).toBeUndefined();
  });

  it("an all-zero deviation history publishes an exact 0 rather than omitting the cell", () => {
    // The retired decomposition's 0 meant "the solve could not support a
    // positive variance" — a statement about the SOLVE, hence omitted. This 0
    // means every observed deviation was exactly zero — a statement about the
    // DATA, hence published. See `swingSpread`'s doc comment.
    expect(spreadOf([0, 0, 0])).toBe(0);
  });
});

describe("the estimator is a weighted RMS ABOUT ZERO — no running mean is subtracted", () => {
  it("a CONSTANT non-zero deviation series publishes scale * |deviation|, not 0", () => {
    // A sample standard deviation of a constant series is exactly 0. If a
    // future edit ever introduces mean-subtraction, this is the test that
    // catches it: a robot that misses its prediction by 5 points EVERY match
    // is not perfectly consistent in the sense Y publishes — its contribution
    // genuinely swings 5 points from what the model expects each time.
    expect(spreadOf([5, 5, 5, 5, 5, 5, 5, 5])).toBeCloseTo(SIGMA1_SWING_SCALE * 5, 12);
  });

  it("symmetric alternating deviations give the same answer as their constant-magnitude twin", () => {
    // +5/-5 and +5/+5 have the same squared magnitudes and therefore the same
    // Y — a centred estimator would rate the second at 0 and the first at 5.
    expect(spreadOf([5, -5, 5, -5, 5, -5])).toBeCloseTo(spreadOf([5, 5, 5, 5, 5, 5]), 12);
  });

  it("the weights are a true weighted MEAN — the accumulator's ratio, at every match count", () => {
    // Hand-worked against the definition, at k = 3, so the fold is checked
    // against arithmetic rather than against itself.
    const w = swingDecayFor(HALF_LIFE);
    const deviations = [2, 3, 4];
    const expectedNumerator = w * w * 4 + w * 9 + 16;
    const expectedDenominator = w * w + w + 1;
    const swing = foldDeviations(deviations);
    expect(swing[KEY]!.weightedSquares).toBeCloseTo(expectedNumerator, 12);
    expect(swing[KEY]!.weight).toBeCloseTo(expectedDenominator, 12);
    expect(spreadOf(deviations)).toBeCloseTo(SIGMA1_SWING_SCALE * Math.sqrt(expectedNumerator / expectedDenominator), 12);
  });
});

describe("story 1 vs story 2 — a steadier robot publishes a strictly SMALLER Y", () => {
  it("THE DEVELOPER'S EXAMPLE — 50/50 beats 30/70 at equal mean", () => {
    // Two robots whose contributions average the same 50: one lands on 50
    // every match, the other alternates 30 and 70. Expressed as deviations
    // from that shared mean, that is a 0-swing robot against a 20-swing one.
    const steady = spreadOf([0, 0, 0, 0, 0, 0, 0, 0]);
    const streaky = spreadOf([-20, 20, -20, 20, -20, 20, -20, 20]);
    expect(steady).toBeLessThan(streaky);
    // Non-vacuity, and story 2's actual requirement: the gap is READABLE, not
    // a last-digit artifact. The retired estimators ranked these correctly and
    // then compressed the gap to nothing, which is what made them useless for
    // the alliance-8 captain who NEEDS the high number to be visible.
    expect(streaky - steady).toBeGreaterThan(10);
  });

  it("orders three robots monotonically by their true swing", () => {
    const tight = spreadOf([1, -1, 1, -1, 1, -1]);
    const middle = spreadOf([6, -6, 6, -6, 6, -6]);
    const wild = spreadOf([25, -25, 25, -25, 25, -25]);
    expect(tight).toBeLessThan(middle);
    expect(middle).toBeLessThan(wild);
  });
});

describe("story 3 — recency BITES", () => {
  it("the SAME multiset of deviations in a different ORDER gives a different Y", () => {
    const erraticFirst = spreadOf([30, 30, 30, 2, 2, 2]);
    const erraticLast = spreadOf([2, 2, 2, 30, 30, 30]);
    expect(erraticFirst).not.toBe(erraticLast);
    // And the direction is the one the half-life was bought for: whichever
    // ordering puts the big deviations LAST publishes the larger Y.
    expect(erraticLast).toBeGreaterThan(erraticFirst);
  });

  it("A ROBOT THAT HAS SETTLED SHOWS A FALLING Y WITHIN ~6 MATCHES — this is what the half-life buys", () => {
    // Six erratic matches, then six calm ones. Y is sampled after the last
    // erratic match and again six calm matches later; the drop is what a
    // mid-quals scout (story 3) is looking at when they decide whether this
    // partner can be relied on NOW rather than on average.
    const erratic = [30, -30, 30, -30, 30, -30];
    const calm = [2, -2, 2, -2, 2, -2];
    const atPeak = spreadOf(erratic);
    const sixCalmMatchesLater = spreadOf([...erratic, ...calm]);
    expect(sixCalmMatchesLater).toBeLessThan(atPeak);
    // Quantified rather than merely "smaller": one half-life of calm matches
    // must retire a real share of the erratic history, not a rounding error.
    expect(sixCalmMatchesLater).toBeLessThan(atPeak * 0.8);
    // ...and it must NOT have forgotten the erratic run entirely — a robot
    // that was wild six matches ago is not yet a metronome, and an estimator
    // that said so would be overselling six matches of evidence.
    expect(sixCalmMatchesLater).toBeGreaterThan(spreadOf(calm));
  });

  it("a FLAT average would rank the two orderings identically — the decay is doing the work", () => {
    // The negative control for the test above: with an effectively infinite
    // half-life the same two orderings collapse to the same number, so the
    // difference measured there is attributable to the decay and to nothing
    // else about the fixture.
    const flatHalfLife = 1e9;
    const a = spreadOf([30, 30, 30, 2, 2, 2], flatHalfLife);
    const b = spreadOf([2, 2, 2, 30, 30, 30], flatHalfLife);
    expect(a).toBeCloseTo(b, 6);
  });

  it("a SHORTER half-life reacts faster than a longer one, and both react", () => {
    const history = [30, -30, 30, -30, 30, -30, 2, -2, 2, -2, 2, -2];
    const fast = spreadOf(history, 2);
    const shipped = spreadOf(history, SIGMA1_SWING_HALF_LIFE_MATCHES);
    const slow = spreadOf(history, 20);
    expect(fast).toBeLessThan(shipped);
    expect(shipped).toBeLessThan(slow);
  });
});

describe("foldSwingObservation — purity and refusals", () => {
  it("returns a NEW object and never mutates its input", () => {
    const before = foldDeviations([4]);
    const snapshot = JSON.stringify(before);
    const after = foldSwingObservation(before, { [KEY]: 100 }, HALF_LIFE);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(after).not.toBe(before);
    expect(after[KEY]).not.toBe(before[KEY]);
  });

  it("folds each key independently — one key's history never leaks into another's", () => {
    let swing = emptyTeamSwing();
    swing = foldSwingObservation(swing, { total: 400, phaseAuto: 1 }, HALF_LIFE);
    swing = foldSwingObservation(swing, { total: 400, phaseAuto: 1 }, HALF_LIFE);
    expect(swingSpread(swing, "total", 1)).toBeCloseTo(20, 12);
    expect(swingSpread(swing, "phaseAuto", 1)).toBeCloseTo(1, 12);
  });

  it("refuses a non-finite squared deviation by throwing, naming the metric key", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => foldSwingObservation(emptyTeamSwing(), { total: bad }, HALF_LIFE)).toThrow(/total/);
    }
  });

  it("is deterministic — the same history folded twice gives bitwise-identical accumulators", () => {
    const history = [3, -9, 14, 0, -2, 7, 7, -11];
    expect(JSON.stringify(foldDeviations(history))).toBe(JSON.stringify(foldDeviations(history)));
  });
});

describe("the accumulator's weight converges rather than growing without bound", () => {
  it("approaches 1 / (1 - w), which is what makes this O(1) state rather than a growing history", () => {
    const w = swingDecayFor(HALF_LIFE);
    const swing = foldDeviations(new Array(400).fill(1));
    expect(swing[KEY]!.weight).toBeCloseTo(1 / (1 - w), 6);
    // The estimator itself is unaffected by that convergence: a constant
    // unit-deviation history still publishes exactly the scale.
    expect(swingSpread(swing, KEY, SIGMA1_SWING_SCALE)).toBeCloseTo(SIGMA1_SWING_SCALE, 9);
  });
});
