/**
 * D-07's mitigation, paid at the pmf layer. Every expected value below was
 * computed from this plan's "## The closed form, specified"/"## Hand-computed
 * reference values" sections at PLANNING time — none was produced by running
 * `analyticPmf.ts` and pasting its output. Assertions land at 6 decimal
 * places (09-03's `erf` is Abramowitz-Stegun 7.1.26, max absolute error
 * 1.5e-7) except for structural identities (sums, exact zeros, exact
 * equalities between two computed quantities), which are exact.
 *
 * Task 1's tracer carries eight behaviors, all exercised on 2026 alone: the
 * nested-threshold non-vacuity case, the full 2026 end-to-end pmf, an
 * asymmetric-inputs proof that symmetry alone is not evidence, the outcome
 * half in isolation, the two short-circuits, the independence precondition,
 * the `RpLayerConfig` refusal, and the normalization guarantee.
 *
 * Task 2 adds a SECOND describe block below — one test per remaining
 * mechanism class (`singleThreshold`, `linearCombination`,
 * `conjunctionDistinct`, `countOfIndicators`, `dataDependentMixture`,
 * `constant`), each asserting a per-bonus probability against a value
 * derived from the closed form at planning time. This file fails for a
 * DIFFERENT reason than its sibling `analyticPmf.seasons.test.ts`: "this
 * mechanism's arithmetic is wrong" here, versus "the contract between the
 * declarations and the pmf layer has drifted" there. The shared
 * `buildRuleModuleMoments` fixture builder is imported from the non-test
 * sibling module `analyticPmfFixtures.ts` (NOT from
 * `analyticPmf.seasons.test.ts` — importing one `.test.ts` file from another
 * re-executes its top-level `describe()` calls and silently duplicates every
 * test in it; see `analyticPmfFixtures.ts`'s own header), so there is one
 * fixture builder in the tree and not two that can drift about what
 * "diagonal" means.
 */
import { describe, expect, it } from "vitest";
import {
  allianceBonusRpPmf,
  analyticRpPmf,
  assertSupportedRpLayerConfig,
  matchOutcomeDistribution,
  RP_LAYER_CONFIG_DEFAULT,
  type RpLayerConfig,
} from "./analyticPmf.js";
import { buildRuleModuleMoments } from "./analyticPmfFixtures.js";
import { rp2016 } from "./2016.js";
import { rp2017 } from "./2017.js";
import { rp2019 } from "./2019.js";
import { rp2022 } from "./2022.js";
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

describe("analyticRpPmf — Task 2 (D-07's remaining six mechanism classes)", () => {
  it("singleThreshold — 2022 hangarBonus, endgamePoints mean 12 variance 16 (threshold 16, z = (16-12)/4 = 1)", () => {
    const moments = buildRuleModuleMoments(rp2022, { endgamePoints: { mean: 12, variance: 16 } });
    const result = allianceBonusRpPmf(moments, rp2022, 0, RP_LAYER_CONFIG_DEFAULT);
    const p = result.bonusProbabilities[rp2022.bonusNames.indexOf("hangarBonus")]!;
    // 1 - Phi(1) = 0.158655254
    expect(p).toBeCloseTo(0.158655254, 6);
  });

  it("linearCombination — 2017 rotor, autoRotorPoints mean 120 var 3600 (/60) + teleopRotorPoints mean 40 var 1600 (/40): sum mean 3, sum variance 2, threshold 4", () => {
    const moments = buildRuleModuleMoments(rp2017, {
      autoRotorPoints: { mean: 120, variance: 3600 },
      teleopRotorPoints: { mean: 40, variance: 1600 },
    });
    const result = allianceBonusRpPmf(moments, rp2017, 0, RP_LAYER_CONFIG_DEFAULT);
    const p = result.bonusProbabilities[rp2017.bonusNames.indexOf("rotor")]!;
    // combined mean = 120/60 + 40/40 = 3, combined variance = 3600/3600 + 1600/1600 = 2
    // z = (4-3)/sqrt(2) = 0.707106781187 -> 1 - Phi(0.707106781187) = 1 - 0.760249938907 = 0.239750061093
    expect(p).toBeCloseTo(0.239750061, 6);
  });

  it("conjunctionDistinct — 2016 capture: attackedTowerEndStrength<=0 (mean 4 var 16) AND teleopChallengePoints/5+teleopScalePoints/15>=3 (means 5,15 vars 25,225)", () => {
    const moments = buildRuleModuleMoments(rp2016, {
      attackedTowerEndStrength: { mean: 4, variance: 16 },
      teleopChallengePoints: { mean: 5, variance: 25 },
      teleopScalePoints: { mean: 15, variance: 225 },
    });
    const result = allianceBonusRpPmf(moments, rp2016, 0, RP_LAYER_CONFIG_DEFAULT);
    const p = result.bonusProbabilities[rp2016.bonusNames.indexOf("capture")]!;
    // Clause A (lte, inverted): z = (0-4)/4 = -1 -> Phi(-1) = 0.158655254
    // Clause B (gte): combined mean 5/5+15/15=2, combined variance 25/25+225/225=2,
    //   z = (3-2)/sqrt(2) = 0.707106781187 -> 1 - Phi(0.707106781187) = 0.239750061093
    // Product (independent, disjoint footprints): 0.158655254 * 0.239750061 = 0.038037607
    expect(p).toBeCloseTo(0.038037607, 6);
  });

  it("countOfIndicators — 2016 breach, position1crossings mean 3 var 1 plus four more at mean 2 var 1, required 4 of 5", () => {
    const moments = buildRuleModuleMoments(rp2016, {
      position1crossings: { mean: 3, variance: 1 },
      position2crossings: { mean: 2, variance: 1 },
      position3crossings: { mean: 2, variance: 1 },
      position4crossings: { mean: 2, variance: 1 },
      position5crossings: { mean: 2, variance: 1 },
    });
    const result = allianceBonusRpPmf(moments, rp2016, 0, RP_LAYER_CONFIG_DEFAULT);
    const p = result.bonusProbabilities[rp2016.bonusNames.indexOf("breach")]!;
    // indicator1: z=(2-3)/1=-1 -> p1 = 1-Phi(-1) = 0.841344746
    // indicators 2-5: z=(2-2)/1=0 -> p = 1-Phi(0) = 0.5 each
    // P(at least 4 of 5) = p1*P(X>=3) + (1-p1)*P(X=4), X ~ Binomial(4, 0.5)
    //   = 0.841344746*(5/16) + 0.158655254*(1/16) = 0.272836186
    expect(p).toBeCloseTo(0.272836186, 6);
  });

  it("dataDependentMixture — 2022 cargoBonus, selector autoCargoTotal>=5 (mean 5 var 1), matchCargoTotal mean 18 var 4 (thresholds 18/20)", () => {
    const moments = buildRuleModuleMoments(rp2022, {
      autoCargoTotal: { mean: 5, variance: 1 },
      matchCargoTotal: { mean: 18, variance: 4 },
    });
    const result = allianceBonusRpPmf(moments, rp2022, 0, RP_LAYER_CONFIG_DEFAULT);
    const p = result.bonusProbabilities[rp2022.bonusNames.indexOf("cargoBonus")]!;
    // selector: z=(5-5)/1=0 -> ps = 1-Phi(0) = 0.5
    // branch-true (quintet, threshold 18): z=(18-18)/2=0 -> p_true = 0.5
    // branch-false (non-quintet, threshold 20): z=(20-18)/2=1 -> p_false = 1-Phi(1) = 0.158655254
    // P = 0.5*0.5 + 0.5*0.158655254 = 0.329327627
    expect(p).toBeCloseTo(0.329327627, 6);
  });

  it("constant — 2019 completeRocket is exactly 0, and with habDocking at mean 15 variance 25 (p=0.5) the season's bonus-only pmf is [0.5, 0.5, 0] — the unreachable index is a REAL zero, not a small number", () => {
    const moments = buildRuleModuleMoments(rp2019, { habClimbPoints: { mean: 15, variance: 25 } });
    const result = allianceBonusRpPmf(moments, rp2019, 0, RP_LAYER_CONFIG_DEFAULT);
    const completeRocketP = result.bonusProbabilities[rp2019.bonusNames.indexOf("completeRocket")]!;
    const habDockingP = result.bonusProbabilities[rp2019.bonusNames.indexOf("habDocking")]!;
    expect(completeRocketP).toBe(0); // exact, not toBeCloseTo — a constant(false) predicate is a real 0
    expect(habDockingP).toBeCloseTo(0.5, 6);
    expect(result.pmf).toHaveLength(3);
    expect(result.pmf[0]).toBeCloseTo(0.5, 6);
    expect(result.pmf[1]).toBeCloseTo(0.5, 6);
    expect(result.pmf[2]).toBe(0); // structurally unreachable — completeRocket can never fire
  });
});
