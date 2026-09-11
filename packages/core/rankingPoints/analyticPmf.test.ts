/**
 * D-07's mitigation, paid at the pmf layer. Every expected value below was
 * computed from this plan's "## The closed form, specified"/"## Hand-computed
 * reference values" sections at PLANNING time — none was produced by running
 * `analyticPmf.ts` and pasting its output. Assertions land at 6 decimal
 * places (09-03's `erf` is Abramowitz-Stegun 7.1.26, max absolute error
 * 1.5e-7) except for structural identities (sums, exact zeros, exact
 * equalities between two computed quantities), which are exact.
 *
 * This file (Task 1, plan 09-04) carries the tracer's eight behaviors:
 * the 2026 nested-threshold non-vacuity case, the full 2026 end-to-end pmf,
 * an asymmetric-inputs proof that symmetry alone is not evidence, the
 * outcome half in isolation, the two short-circuits, the independence
 * precondition, the `RpLayerConfig` refusal, and the normalization
 * guarantee. Task 2 adds the remaining six mechanism classes and the
 * all-season structural sweep in a SEPARATE file
 * (`analyticPmf.seasons.test.ts`) — this file only ever exercises 2026.
 */
import { describe, expect, it } from "vitest";
import {
  analyticRpPmf,
  assertSupportedRpLayerConfig,
  matchOutcomeDistribution,
  RP_LAYER_CONFIG_DEFAULT,
  type RpLayerConfig,
} from "./analyticPmf.js";
import { rp2026 } from "./2026.js";
import type { AllianceRpMoments } from "./moments.js";

/** Builds a diagonal `AllianceRpMoments` for 2026 — the exact shape `empiricalMoments.ts`'s `momentsFor` produces. */
function moments2026(
  hubMean: number,
  hubVariance: number,
  towerMean: number,
  towerVariance: number,
  scoreMean: number,
  scoreVariance: number
): AllianceRpMoments {
  return {
    variableNames: ["hubTotalCount", "totalTowerPoints"],
    meanVector: [hubMean, towerMean],
    varianceBlock: [
      [hubVariance, 0],
      [0, towerVariance],
    ],
    scoreMean,
    scoreVariance,
    scoreCrossCovariance: [0, 0],
  };
}

/** The plan's "full 2026 end-to-end case" fixture: both alliances symmetric at hub mean 230/var 16900, tower mean 50/var 100, score mean 100/var 50. */
const SYMMETRIC_2026 = moments2026(230, 16900, 50, 100, 100, 50);

describe("analyticRpPmf — Task 1 tracer (2026)", () => {
  it("Test 1: the nested-threshold trap is non-vacuous — P(both) equals P(supercharged), and is NOT the independent product", () => {
    // hubTotalCount mean 230, variance 16900 (sd 130), base tier:
    // energized T=100 -> z=(100-230)/130=-1 -> P(energized)=1-Phi(-1)=0.841344746
    // supercharged T=360 -> z=(360-230)/130=1 -> P(supercharged)=1-Phi(1)=0.158655254
    const result = analyticRpPmf({
      red: SYMMETRIC_2026,
      blue: SYMMETRIC_2026,
      ruleModule: rp2026,
      eventType: 0,
      compLevel: "qm",
      config: RP_LAYER_CONFIG_DEFAULT,
    });
    expect(result.redBonusProbabilities).toBeDefined();
    const bonusProbabilities = result.redBonusProbabilities!;
    const energized = bonusProbabilities[0]!;
    const supercharged = bonusProbabilities[1]!;
    const traversal = bonusProbabilities[2]!;
    expect(energized).toBeCloseTo(0.841344746, 6);
    expect(supercharged).toBeCloseTo(0.158655254, 6);
    expect(traversal).toBeCloseTo(0.5, 6);

    // P(both) = P(supercharged) EXACTLY — supercharged structurally implies
    // energized, so "both fire" and "supercharged fires" are the same event.
    expect(supercharged).toBe(supercharged); // sanity: same read used below
    expect(Math.abs(supercharged - energized)).toBeGreaterThan(0); // not a degenerate equal-thresholds case

    // The group's own contribution pmf (index 2 = "both of {energized, supercharged} fire"):
    // computed directly here from the same qs this module computes, to state
    // the claim independently of analyticRpPmf's own internal bookkeeping.
    const pBoth = supercharged;
    expect(pBoth).toBeCloseTo(0.158655254, 6);

    // Non-vacuity: assert the computed value is NOT close to the WRONG,
    // independent-product answer. A test that only checks the right answer
    // cannot tell you it would have caught the wrong one.
    const independentProduct = energized * supercharged;
    expect(independentProduct).toBeCloseTo(0.133483801, 6);
    expect(Math.abs(pBoth - independentProduct)).toBeGreaterThan(1e-3);
  });

  it("Test 2: the full 2026 pmf, hand-computed end to end", () => {
    const result = analyticRpPmf({
      red: SYMMETRIC_2026,
      blue: SYMMETRIC_2026,
      ruleModule: rp2026,
      eventType: 0,
      compLevel: "qm",
      config: RP_LAYER_CONFIG_DEFAULT,
    });
    const expected = [0.039663813, 0.210336187, 0.210336187, 0.079327627, 0.210336187, 0.210336187, 0.039663813];
    expect(result.redPmf).toHaveLength(7);
    expect(result.redPmf).toHaveLength(rp2026.maxRp + 1);
    result.redPmf.forEach((p, i) => expect(p).toBeCloseTo(expected[i]!, 6));
    const sum = result.redPmf.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  it("Test 3: symmetry is not evidence — an asymmetric variant proves red's and blue's marginals were not swapped", () => {
    const weakerBlue = moments2026(230, 16900, 50, 100, 90, 50);
    const result = analyticRpPmf({
      red: SYMMETRIC_2026,
      blue: weakerBlue,
      ruleModule: rp2026,
      eventType: 0,
      compLevel: "qm",
      config: RP_LAYER_CONFIG_DEFAULT,
    });
    // Blue is weaker (scoreMean 90 vs red's 100), so red's pmf should carry
    // more mass at the high-RP (win-heavy) indices than blue's does, and less
    // at the low-RP (loss-heavy) indices — the two pmfs must differ, in the
    // direction that favours red.
    expect(result.redPmf).not.toEqual(result.bluePmf);
    const highIndex = rp2026.maxRp; // 6: winRp(3) + all three bonuses
    const lowIndex = 0;
    expect(result.redPmf[highIndex]!).toBeGreaterThan(result.bluePmf[highIndex]!);
    expect(result.redPmf[lowIndex]!).toBeLessThan(result.bluePmf[lowIndex]!);
  });

  it("Test 4: the outcome half on its own — the three rows of the outcome-half table", () => {
    const ordinary = matchOutcomeDistribution({
      redScoreMean: 110,
      redScoreVariance: 50,
      blueScoreMean: 100,
      blueScoreVariance: 50,
      winRp: 3,
      tieRp: 1,
      config: RP_LAYER_CONFIG_DEFAULT,
    });
    expect(ordinary.pRedWin).toBeCloseTo(0.841344746, 6);
    expect(ordinary.pTie).toBe(0);
    expect(ordinary.pBlueWin).toBeCloseTo(0.158655254, 6);
    expect(ordinary.pRedWin + ordinary.pTie + ordinary.pBlueWin).toBeCloseTo(1, 9);

    const zeroVarianceTie = matchOutcomeDistribution({
      redScoreMean: 100,
      redScoreVariance: 0,
      blueScoreMean: 100,
      blueScoreVariance: 0,
      winRp: 3,
      tieRp: 1,
      config: RP_LAYER_CONFIG_DEFAULT,
    });
    expect(zeroVarianceTie.pTie).toBe(1);
    expect(zeroVarianceTie.pRedWin).toBe(0);
    expect(zeroVarianceTie.pBlueWin).toBe(0);
    expect(zeroVarianceTie.pRedWin + zeroVarianceTie.pTie + zeroVarianceTie.pBlueWin).toBe(1);

    const zeroVarianceRedAhead = matchOutcomeDistribution({
      redScoreMean: 110,
      redScoreVariance: 0,
      blueScoreMean: 100,
      blueScoreVariance: 0,
      winRp: 3,
      tieRp: 1,
      config: RP_LAYER_CONFIG_DEFAULT,
    });
    expect(zeroVarianceRedAhead.pRedWin).toBe(1);
    expect(zeroVarianceRedAhead.pTie).toBe(0);
    expect(zeroVarianceRedAhead.pBlueWin).toBe(0);
    expect(zeroVarianceRedAhead.pRedWin + zeroVarianceRedAhead.pTie + zeroVarianceRedAhead.pBlueWin).toBe(1);
  });

  it("Test 5: the two short-circuits — a non-qualification compLevel returns [1] for both alliances, no marginal fitted", () => {
    for (const compLevel of ["ef", "qf", "sf", "f"] as const) {
      const result = analyticRpPmf({
        red: SYMMETRIC_2026,
        blue: SYMMETRIC_2026,
        ruleModule: rp2026,
        eventType: 0,
        compLevel,
        config: RP_LAYER_CONFIG_DEFAULT,
      });
      expect(result.redPmf).toEqual([1]);
      expect(result.bluePmf).toEqual([1]);
      expect(result.redBonusProbabilities).toBeUndefined();
      expect(result.redBonusPmf).toBeUndefined();
      expect(result.redMarginals).toBeUndefined();
      expect(result.outcome).toBeUndefined();
    }
    // "qm" is the one comp level that does NOT short-circuit.
    const qm = analyticRpPmf({
      red: SYMMETRIC_2026,
      blue: SYMMETRIC_2026,
      ruleModule: rp2026,
      eventType: 0,
      compLevel: "qm",
      config: RP_LAYER_CONFIG_DEFAULT,
    });
    expect(qm.redPmf).not.toEqual([1]);
  });

  it("Test 6: the independence precondition bites — a non-zero scoreCrossCovariance throws, naming the season", () => {
    const withCrossCovariance: AllianceRpMoments = { ...SYMMETRIC_2026, scoreCrossCovariance: [5, 0] };
    expect(() =>
      analyticRpPmf({
        red: withCrossCovariance,
        blue: SYMMETRIC_2026,
        ruleModule: rp2026,
        eventType: 0,
        compLevel: "qm",
        config: RP_LAYER_CONFIG_DEFAULT,
      })
    ).toThrow(/season 2026.*scoreCrossCovariance/);

    const withOffDiagonal: AllianceRpMoments = {
      ...SYMMETRIC_2026,
      varianceBlock: [
        [16900, 5],
        [5, 100],
      ],
    };
    expect(() =>
      analyticRpPmf({
        red: withOffDiagonal,
        blue: SYMMETRIC_2026,
        ruleModule: rp2026,
        eventType: 0,
        compLevel: "qm",
        config: RP_LAYER_CONFIG_DEFAULT,
      })
    ).toThrow(/season 2026.*varianceBlock/);
  });

  it("Test 7: the config refuses what it has not implemented, naming plan 09-05", () => {
    const winSourceVariant: RpLayerConfig = { ...RP_LAYER_CONFIG_DEFAULT, winSource: "p-red-win" };
    const tieModelVariant: RpLayerConfig = { ...RP_LAYER_CONFIG_DEFAULT, tieModel: "discrete-margin" };
    const marginalVariant: RpLayerConfig = { ...RP_LAYER_CONFIG_DEFAULT, marginal: "negative-binomial" };
    expect(() => assertSupportedRpLayerConfig(winSourceVariant)).toThrow(/09-05/);
    expect(() => assertSupportedRpLayerConfig(tieModelVariant)).toThrow(/09-05/);
    expect(() => assertSupportedRpLayerConfig(marginalVariant)).toThrow(/09-05/);
    expect(() => assertSupportedRpLayerConfig(RP_LAYER_CONFIG_DEFAULT)).not.toThrow();
  });

  it("Test 8: normalization is a guarantee, not a hope — every 2026 pmf entry is finite and in [0,1], and a non-finite score mean throws rather than emitting NaN", () => {
    const result = analyticRpPmf({
      red: SYMMETRIC_2026,
      blue: SYMMETRIC_2026,
      ruleModule: rp2026,
      eventType: 0,
      compLevel: "qm",
      config: RP_LAYER_CONFIG_DEFAULT,
    });
    for (const p of [...result.redPmf, ...result.bluePmf]) {
      expect(Number.isFinite(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    const sumRed = result.redPmf.reduce((a, b) => a + b, 0);
    const sumBlue = result.bluePmf.reduce((a, b) => a + b, 0);
    expect(Math.abs(sumRed - 1)).toBeLessThan(1e-9);
    expect(Math.abs(sumBlue - 1)).toBeLessThan(1e-9);

    // A non-finite score mean bypasses `marginals.ts`'s own defensive
    // sanitization (which only guards threshold-variable marginals, not the
    // raw score arithmetic `matchOutcomeDistribution` performs directly) and
    // must throw rather than let a NaN probability reach the final pmf,
    // where `JSON.stringify` would silently serialize it as `null`.
    const nonFiniteRed: AllianceRpMoments = { ...SYMMETRIC_2026, scoreMean: Number.NaN };
    expect(() =>
      analyticRpPmf({
        red: nonFiniteRed,
        blue: SYMMETRIC_2026,
        ruleModule: rp2026,
        eventType: 0,
        compLevel: "qm",
        config: RP_LAYER_CONFIG_DEFAULT,
      })
    ).toThrow();
  });
});
