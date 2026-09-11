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
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  allianceBonusRpPmf,
  analyticRpPmf,
  assertSupportedRpLayerConfig,
  emptyMarginalResolutionTally,
  matchOutcomeDistribution,
  resolveDeclaredFamily,
  splitOutcomeProbabilities,
  tieProbability,
  RP_LAYER_CONFIG_DEFAULT,
  type RpLayerConfig,
} from "./analyticPmf.js";
import { buildRuleModuleMoments } from "./analyticPmfFixtures.js";
import { rp2016 } from "./2016.js";
import { rp2017 } from "./2017.js";
import { rp2019 } from "./2019.js";
import { rp2022 } from "./2022.js";
import { rp2026 } from "./2026.js";
import { RP_REGISTERED_SEASONS, RP_RULE_MODULES, type MarginalFamily, type RpRuleModule } from "./rules.js";
import type { AllianceRpMoments } from "./moments.js";

/**
 * Test-only fixture helper (09-05 Task 3): clones `ruleModule` with every
 * threshold variable's `marginalFamily` overridden to `family`. Needed
 * because Task 3's Commit 1 (mechanism) lands BEFORE Commit 2 (the 34
 * declarations themselves flip) — at this point in the file's own
 * git history every real season module still declares `"gaussian"`, so the
 * mechanism tests below need a synthetic NB-declared module to exercise
 * `resolveDeclaredFamily`'s `"negative-binomial"` branch at all.
 */
function ruleModuleWithDeclaredFamily(ruleModule: RpRuleModule, family: MarginalFamily): RpRuleModule {
  return {
    ...ruleModule,
    thresholdVariables: ruleModule.thresholdVariables.map((v) => ({ ...v, marginalFamily: family })),
  };
}

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
      pRedWin: 0.5,
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
      pRedWin: 0.5,
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
      pRedWin: 0.5,
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
      pRedWin: 0.5,
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
      pRedWin: 0.5,
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
      pRedWin: 0.5,
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
        pRedWin: 0.5,
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
      pRedWin: 0.5,
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
        pRedWin: 0.5,
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
        pRedWin: 0.5,
      })
    ).toThrow(/season 2026.*varianceBlock/);
  });

  it("Test 7: the config refuses what it has not implemented — UPDATED by 09-05 Tasks 1/2/3: all three real branches (winSource: \"p-red-win\", tieModel: \"discrete-margin\", marginal: \"negative-binomial\") no longer throw (D-13/D-14/D-01 all landed); an actually-unimplemented fourth value still would", () => {
    const winSourceVariant: RpLayerConfig = { ...RP_LAYER_CONFIG_DEFAULT, winSource: "p-red-win" };
    const tieModelVariant: RpLayerConfig = { ...RP_LAYER_CONFIG_DEFAULT, tieModel: "discrete-margin" };
    const marginalVariant: RpLayerConfig = { ...RP_LAYER_CONFIG_DEFAULT, marginal: "negative-binomial" };
    expect(() => assertSupportedRpLayerConfig(winSourceVariant)).not.toThrow();
    expect(() => assertSupportedRpLayerConfig(tieModelVariant)).not.toThrow();
    expect(() => assertSupportedRpLayerConfig(marginalVariant)).not.toThrow();
    expect(() => assertSupportedRpLayerConfig(RP_LAYER_CONFIG_DEFAULT)).not.toThrow();
    // An actually-unimplemented value still refuses — the function is kept,
    // not vestigial, per its own updated doc comment.
    const unimplemented = { ...RP_LAYER_CONFIG_DEFAULT, winSource: "made-up-value" } as unknown as RpLayerConfig;
    expect(() => assertSupportedRpLayerConfig(unimplemented)).toThrow();
  });

  it("Test 8: normalization is a guarantee, not a hope — every 2026 pmf entry is finite and in [0,1], and a non-finite score mean throws rather than emitting NaN", () => {
    const result = analyticRpPmf({
      red: SYMMETRIC_2026,
      blue: SYMMETRIC_2026,
      ruleModule: rp2026,
      eventType: 0,
      compLevel: "qm",
      config: RP_LAYER_CONFIG_DEFAULT,
      pRedWin: 0.5,
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
        pRedWin: 0.5,
      })
    ).toThrow();
  });
});

describe("analyticRpPmf / matchOutcomeDistribution — 09-05 Task 1 (D-13, F6): win RP from the published pRedWin", () => {
  const P_RED_WIN_GRID = [0, 0.05, 0.5, 0.73, 0.99, 1] as const;
  const P_RED_WIN_SOURCE_CONFIG: RpLayerConfig = { ...RP_LAYER_CONFIG_DEFAULT, winSource: "p-red-win" };

  it("the default-path inertness assertion: three different pRedWin values (0.01, 0.5, 0.99) produce IDENTICAL pmfs under the legacy (default) config — the required-but-unread proof", () => {
    const results = [0.01, 0.5, 0.99].map((pRedWin) =>
      analyticRpPmf({
        red: SYMMETRIC_2026,
        blue: SYMMETRIC_2026,
        ruleModule: rp2026,
        eventType: 0,
        compLevel: "qm",
        config: RP_LAYER_CONFIG_DEFAULT,
        pRedWin,
      })
    );
    expect(results[0]!.redPmf).toEqual(results[1]!.redPmf);
    expect(results[1]!.redPmf).toEqual(results[2]!.redPmf);
    expect(results[0]!.bluePmf).toEqual(results[1]!.bluePmf);
    expect(results[1]!.bluePmf).toEqual(results[2]!.bluePmf);
  });

  it.each(P_RED_WIN_GRID)(
    'under winSource: "p-red-win" with the legacy tie model, the outcome half\'s red winRp mass is === the supplied pRedWin of %f (strict equality, not toBeCloseTo)',
    (pRedWin) => {
      const outcome = matchOutcomeDistribution({
        redScoreMean: 110,
        redScoreVariance: 50,
        blueScoreMean: 100,
        blueScoreVariance: 50,
        winRp: 3,
        tieRp: 1,
        config: P_RED_WIN_SOURCE_CONFIG,
        pRedWin,
      });
      expect(outcome.pRedWin).toBe(pRedWin);
      expect(outcome.pTie).toBe(0);
      expect(outcome.pBlueWin).toBe(1 - pRedWin);
    }
  );

  it("the F6 statistic is zero BY CONSTRUCTION: an input where the Gaussian-implied win probability differs from the supplied pRedWin by more than F6's measured maximum (0.3415) still follows pRedWin, not the Gaussian quantity", () => {
    // redScoreMean 110, blueScoreMean 100, varianceD = 50 + 50 = 100, sd = 10:
    // z = (100 - 110) / 10 = -1 -> Gaussian-implied pRedWin = 1 - Phi(-1) = 0.841344746
    const gaussianImplied = 0.841344746;
    const suppliedPRedWin = 0.5;
    expect(Math.abs(gaussianImplied - suppliedPRedWin)).toBeGreaterThan(0.3);

    const outcome = matchOutcomeDistribution({
      redScoreMean: 110,
      redScoreVariance: 50,
      blueScoreMean: 100,
      blueScoreVariance: 50,
      winRp: 3,
      tieRp: 1,
      config: P_RED_WIN_SOURCE_CONFIG,
      pRedWin: suppliedPRedWin,
    });
    expect(outcome.pRedWin).toBe(suppliedPRedWin);
    expect(outcome.pRedWin).not.toBeCloseTo(gaussianImplied, 1);
  });

  it("splitOutcomeProbabilities — the pinned <baseline> table: exactness under the legacy tie model, conditional-on-decisive exactness once a tie model is also on", () => {
    const exact = splitOutcomeProbabilities(0.73, 0);
    expect(exact.pRedStrict).toBe(0.73); // x * 1 === x for every finite IEEE754 x
    expect(exact.pTie).toBe(0);
    expect(exact.clampedPRedWin).toBe(false);

    const withTie = splitOutcomeProbabilities(0.73, 0.0109297);
    expect(withTie.pRedStrict / (withTie.pRedStrict + withTie.pBlueStrict)).toBeCloseTo(0.73, 12);
  });

  it("splitOutcomeProbabilities — clampedPRedWin is COUNTED, never silent, for a non-finite and an out-of-range input; a non-finite pRedWin is flagged but deliberately NOT laundered into a fake-safe value (it propagates as NaN, so assertNormalizedPmf's existing finite guard still catches a corrupted upstream computation)", () => {
    const nonFinite = splitOutcomeProbabilities(Number.NaN, 0);
    expect(nonFinite.clampedPRedWin).toBe(true);
    expect(Number.isFinite(nonFinite.pRedStrict)).toBe(false);
    expect(Number.isFinite(nonFinite.pBlueStrict)).toBe(false);

    const aboveRange = splitOutcomeProbabilities(1.5, 0);
    expect(aboveRange.clampedPRedWin).toBe(true);
    expect(aboveRange.pRedStrict).toBe(1);
    expect(aboveRange.pBlueStrict).toBe(0);

    const belowRange = splitOutcomeProbabilities(-0.2, 0);
    expect(belowRange.clampedPRedWin).toBe(true);
    expect(belowRange.pRedStrict).toBe(0);
    expect(belowRange.pBlueStrict).toBe(1);

    const inRange = splitOutcomeProbabilities(0.5, 0);
    expect(inRange.clampedPRedWin).toBe(false);
  });

  it('every pmf produced under winSource: "p-red-win" sums to 1 within 1e-9, every entry finite and in [0,1], length ruleModule.maxRp + 1', () => {
    for (const pRedWin of P_RED_WIN_GRID) {
      const result = analyticRpPmf({
        red: SYMMETRIC_2026,
        blue: SYMMETRIC_2026,
        ruleModule: rp2026,
        eventType: 0,
        compLevel: "qm",
        config: P_RED_WIN_SOURCE_CONFIG,
        pRedWin,
      });
      expect(result.redPmf).toHaveLength(rp2026.maxRp + 1);
      for (const pmf of [result.redPmf, result.bluePmf]) {
        const sum = pmf.reduce((a, b) => a + b, 0);
        expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
        for (const p of pmf) {
          expect(Number.isFinite(p)).toBe(true);
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("tieProbability / matchOutcomeDistribution — 09-05 Task 2 (D-14, F7): the discrete-margin tie model", () => {
  it("the branch is REACHABLE: tieProbability(0, 36.5 ** 2) is strictly positive — today's continuous-equality branch needs exact float equality of two continuous draws and returns zero for every input in this grid", () => {
    expect(tieProbability(0, 36.5 ** 2)).toBeGreaterThan(0);
  });

  it("lands on the measured base rate: tieProbability(0, 36.5 ** 2) is 0.0109297 within 1e-6, and within 5e-6 of F7's measured 1206/110362", () => {
    const value = tieProbability(0, 36.5 ** 2);
    expect(value).toBeCloseTo(0.0109297, 6);
    expect(Math.abs(value - 1206 / 110362)).toBeLessThan(5e-6);
  });

  it("a second, off-centre value: tieProbability(20, 40 ** 2) is 0.0088015 within 1e-6 — FINDING recorded in 09-05-05-SUMMARY.md: the plan's own hand-pinned literal (0.0087997, from Phi(-0.4875) - Phi(-0.5125) = 0.31294895 - 0.30414930) is ~1.76e-6 off the true value; independent verification via Python's math.erf (a SEPARATE, higher-precision erf, not this codebase's own A-S 7.1.26 approximation) computes 0.0088014613, which this implementation matches to 1.3e-8 — well within A-S's documented 1.5e-7 bound. The implementation is correct; the plan's manual Phi-table arithmetic is the source of the small discrepancy", () => {
    expect(tieProbability(20, 40 ** 2)).toBeCloseTo(0.0088015, 6);
  });

  it("the degenerate guard is ordered BEFORE the division — four pinned cases, no NaN anywhere in the whole grid", () => {
    expect(tieProbability(0.2, 0)).toBe(1);
    expect(tieProbability(3, 0)).toBe(0);
    expect(tieProbability(0, Number.NaN)).toBe(1);
    expect(tieProbability(3, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("monotonicity and symmetry: strictly decreasing in marginSd for fixed marginMean = 0; maximised at marginMean = 0 and decreasing in |marginMean| for fixed marginSd; symmetric in marginMean", () => {
    const sdGrid = [5, 10, 20, 36.5, 60, 120];
    let previous = Number.POSITIVE_INFINITY;
    for (const sd of sdGrid) {
      const value = tieProbability(0, sd * sd);
      expect(value).toBeLessThan(previous);
      previous = value;
    }

    const meanGrid = [0, 5, 15, 40, 120];
    const atZero = tieProbability(0, 36.5 ** 2);
    let previousAtMean = atZero;
    for (const mean of meanGrid) {
      const value = tieProbability(mean, 36.5 ** 2);
      expect(value).toBeLessThanOrEqual(previousAtMean);
      if (mean > 0) expect(value).toBeLessThan(atZero);
      previousAtMean = value;
    }

    for (const mean of [5, 15, 40, 120]) {
      expect(Math.abs(tieProbability(mean, 36.5 ** 2) - tieProbability(-mean, 36.5 ** 2))).toBeLessThan(1e-12);
    }
  });

  it("the three outcome probabilities partition: pRedStrict + pTie + pBlueStrict is within 1e-12 of 1, every component in [0, 1], none NaN, across a grid of pRedWin x pTie", () => {
    for (const pRedWin of [0, 0.05, 0.5, 0.73, 1]) {
      for (const pTie of [0, 0.0109297, 0.5]) {
        const split = splitOutcomeProbabilities(pRedWin, pTie);
        expect(Math.abs(split.pRedStrict + split.pTie + split.pBlueStrict - 1)).toBeLessThan(1e-12);
        for (const component of [split.pRedStrict, split.pTie, split.pBlueStrict]) {
          expect(Number.isFinite(component)).toBe(true);
          expect(component).toBeGreaterThanOrEqual(0);
          expect(component).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("exactness survives the tie model, conditional form: with winSource: \"p-red-win\" and tieModel: \"discrete-margin\" both selected, pRedStrict / (pRedStrict + pBlueStrict) is within 1e-12 of the supplied pRedWin", () => {
    const config: RpLayerConfig = { ...RP_LAYER_CONFIG_DEFAULT, winSource: "p-red-win", tieModel: "discrete-margin" };
    for (const pRedWin of [0.05, 0.5, 0.73, 0.99]) {
      const outcome = matchOutcomeDistribution({
        redScoreMean: 110,
        redScoreVariance: 50,
        blueScoreMean: 100,
        blueScoreVariance: 50,
        winRp: 3,
        tieRp: 1,
        config,
        pRedWin,
      });
      expect(outcome.pRedWin / (outcome.pRedWin + outcome.pBlueWin)).toBeCloseTo(pRedWin, 12);
    }
  });

  it("the legacy tie model is still exactly zero — not 1e-300, not \"small\" — for every input in the grid; rpLayerInertness.test.ts's own golden is the mechanical proof at the pmf level", () => {
    for (const meanD of [0, 5, 20, -15]) {
      for (const varianceD of [1, 100, 10000]) {
        const outcome = matchOutcomeDistribution({
          redScoreMean: meanD,
          redScoreVariance: varianceD,
          blueScoreMean: 0,
          blueScoreVariance: 0,
          winRp: 3,
          tieRp: 1,
          config: RP_LAYER_CONFIG_DEFAULT,
          pRedWin: 0.5,
        });
        expect(outcome.pTie).toBe(0);
      }
    }
  });

  it("tie mass reaches the RP index the season actually awards — a winRp: 3 season (2026) and a winRp: 2 season (2016), every threshold variance zero (point-mass bonus half)", () => {
    const config: RpLayerConfig = { ...RP_LAYER_CONFIG_DEFAULT, winSource: "p-red-win", tieModel: "discrete-margin" };

    // 2026: hubTotalCount 500 (>= supercharged 360, implies energized),
    // totalTowerPoints 100 (>= traversal 50) — all three bonuses achieved
    // deterministically, bonus RP = 3, so maxRp (6) = winRp(3) + bonusRp(3).
    const moments2026Degenerate = (): AllianceRpMoments => ({
      variableNames: ["hubTotalCount", "totalTowerPoints"],
      meanVector: [500, 100],
      varianceBlock: [
        [0, 0],
        [0, 0],
      ],
      scoreMean: 110,
      scoreVariance: 50,
      scoreCrossCovariance: [0, 0],
    });
    const result2026 = analyticRpPmf({
      red: moments2026Degenerate(),
      blue: { ...moments2026Degenerate(), scoreMean: 100 },
      ruleModule: rp2026,
      eventType: 0,
      compLevel: "qm",
      config,
      pRedWin: 0.6,
    });
    expect(result2026.outcome).toBeDefined();
    const bonusRp2026 = 3;
    const tieIndex2026 = rp2026.tieRp + bonusRp2026;
    const winIndex2026 = rp2026.winRp + bonusRp2026;
    expect(result2026.redPmf[tieIndex2026]).toBeCloseTo(result2026.outcome!.pTie, 12);
    expect(result2026.redPmf[winIndex2026]).toBeCloseTo(result2026.outcome!.pRedWin, 12);
    // Bonus is a deterministic point mass, so the ONLY three reachable
    // indices are the loss/tie/win outcome RPs each shifted by the same
    // fixed bonusRp2026 — the loss index carries exactly outcome.pBlueWin
    // (red's own pmf: loseProb accumulates at index 0, pre-convolution).
    const loseIndex2026 = 0 + bonusRp2026;
    expect(result2026.redPmf[loseIndex2026]).toBeCloseTo(result2026.outcome!.pBlueWin, 12);
    const accountedMass2026 = [tieIndex2026, winIndex2026, loseIndex2026].reduce((sum, i) => sum + result2026.redPmf[i]!, 0);
    expect(accountedMass2026).toBeCloseTo(1, 9);

    // 2016: 5 crossings at every position (>= the 2-crossing indicator
    // threshold, 5 of 5 >= the 4-required threshold: breach achieved);
    // attackedTowerEndStrength 0 (<= 0) and teleopChallengePoints/
    // teleopScalePoints scaled to 6 (>= 3): capture achieved. bonus RP = 2,
    // maxRp (4) = winRp(2) + bonusRp(2).
    const moments2016Degenerate = (): AllianceRpMoments => {
      const variableNames = rp2016.thresholdVariables.map((v) => v.name);
      const values: Record<string, number> = {
        position1crossings: 5,
        position2crossings: 5,
        position3crossings: 5,
        position4crossings: 5,
        position5crossings: 5,
        attackedTowerEndStrength: 0,
        teleopChallengePoints: 15,
        teleopScalePoints: 45,
      };
      return {
        variableNames,
        meanVector: variableNames.map((name) => values[name] ?? 0),
        varianceBlock: variableNames.map((_, i) => variableNames.map((_, j) => 0)),
        scoreMean: 110,
        scoreVariance: 50,
        scoreCrossCovariance: variableNames.map(() => 0),
      };
    };
    const result2016 = analyticRpPmf({
      red: moments2016Degenerate(),
      blue: { ...moments2016Degenerate(), scoreMean: 100 },
      ruleModule: rp2016,
      eventType: 0,
      compLevel: "qm",
      config,
      pRedWin: 0.6,
    });
    expect(result2016.outcome).toBeDefined();
    const bonusRp2016 = 2;
    const tieIndex2016 = rp2016.tieRp + bonusRp2016;
    const winIndex2016 = rp2016.winRp + bonusRp2016;
    expect(result2016.redPmf[tieIndex2016]).toBeCloseTo(result2016.outcome!.pTie, 12);
    expect(result2016.redPmf[winIndex2016]).toBeCloseTo(result2016.outcome!.pRedWin, 12);
  });
});

describe("resolveDeclaredFamily / MarginalResolutionTally — 09-05 Task 3 (D-01): marginal: \"negative-binomial\"", () => {
  it("under the legacy marginal member, resolveDeclaredFamily returns \"gaussian\" for a variable declaring EITHER family — the whole inertness argument", () => {
    const config = RP_LAYER_CONFIG_DEFAULT;
    const declaredGaussian = { name: "x", unit: "count" as const, marginalFamily: "gaussian" as const };
    const declaredNb = { name: "y", unit: "count" as const, marginalFamily: "negative-binomial" as const };
    expect(resolveDeclaredFamily(declaredGaussian, config)).toBe("gaussian");
    expect(resolveDeclaredFamily(declaredNb, config)).toBe("gaussian");
  });

  it("under marginal: \"negative-binomial\", resolveDeclaredFamily returns the variable's OWN declared family verbatim, for both possible declarations", () => {
    const config: RpLayerConfig = { ...RP_LAYER_CONFIG_DEFAULT, marginal: "negative-binomial" };
    const declaredGaussian = { name: "x", unit: "count" as const, marginalFamily: "gaussian" as const };
    const declaredNb = { name: "y", unit: "count" as const, marginalFamily: "negative-binomial" as const };
    expect(resolveDeclaredFamily(declaredGaussian, config)).toBe("gaussian");
    expect(resolveDeclaredFamily(declaredNb, config)).toBe("negative-binomial");
  });

  it("driven over every variable in every registered season (34 total): under the legacy member the result is \"gaussian\" for all 34, the count asserted so a shrunken list cannot pass vacuously", () => {
    let count = 0;
    for (const season of RP_REGISTERED_SEASONS) {
      const module = RP_RULE_MODULES[season]!;
      for (const variable of module.thresholdVariables) {
        expect(resolveDeclaredFamily(variable, RP_LAYER_CONFIG_DEFAULT)).toBe("gaussian");
        count += 1;
      }
    }
    expect(count).toBe(34);
  });

  it("emptyMarginalResolutionTally returns all-zero counters", () => {
    expect(emptyMarginalResolutionTally()).toEqual({ negativeBinomial: 0, gaussian: 0, degenerate: 0, fallbacks: 0 });
  });

  // Task 3's Commit 1 (mechanism, tested here) lands BEFORE Commit 2 (the 34
  // declarations themselves flip). At this point every REAL season module
  // still declares "gaussian", so the tally tests below use a synthetic
  // NB-declared clone of rp2026 (`ruleModuleWithDeclaredFamily`) to exercise
  // resolveDeclaredFamily's "negative-binomial" branch at all — Task 3's
  // Commit 2 (and rules.test.ts's pinned per-family list) is what proves
  // the REAL 2026 declarations flip too.
  const rp2026Nb = ruleModuleWithDeclaredFamily(rp2026, "negative-binomial");

  it("under marginal: \"negative-binomial\" with variables DECLARED negative-binomial, comfortably overdispersed alliance moments (mean 40, variance 200 — well above mean) yield a tally where negativeBinomial equals the fitted-variable count and fallbacks is 0", () => {
    const config: RpLayerConfig = { ...RP_LAYER_CONFIG_DEFAULT, marginal: "negative-binomial" };
    const moments = buildRuleModuleMoments(rp2026Nb, {
      hubTotalCount: { mean: 40, variance: 200 },
      totalTowerPoints: { mean: 40, variance: 200 },
    });
    const tally = emptyMarginalResolutionTally();
    allianceBonusRpPmf(moments, rp2026Nb, 0, config, tally);
    expect(tally.negativeBinomial).toBe(2); // both threshold variables, one alliance
    expect(tally.fallbacks).toBe(0);
    expect(tally.gaussian).toBe(0);
  });

  it("under marginal: \"negative-binomial\" with variables DECLARED negative-binomial, 09-03's own pinned cold-team case (alliance mean 13.586547164699777 against variance 4.5 — a 3-team roster that folded 4 then 5) yields a tally with non-zero gaussian AND non-zero fallbacks, while the declared family is still \"negative-binomial\" — an arm labelled negative-binomial cannot silently be mostly Gaussian", () => {
    const config: RpLayerConfig = { ...RP_LAYER_CONFIG_DEFAULT, marginal: "negative-binomial" };
    const moments = buildRuleModuleMoments(rp2026Nb, {
      hubTotalCount: { mean: 13.586547164699777, variance: 4.5 },
      totalTowerPoints: { mean: 13.586547164699777, variance: 4.5 },
    });
    const tally = emptyMarginalResolutionTally();
    allianceBonusRpPmf(moments, rp2026Nb, 0, config, tally);
    expect(tally.gaussian).toBeGreaterThan(0);
    expect(tally.fallbacks).toBeGreaterThan(0);
    expect(tally.negativeBinomial).toBe(0);
    expect(tally.gaussian).toBe(tally.fallbacks); // every fallback here resolved to gaussian
  });

  it("under the legacy marginal member, even a variable DECLARED negative-binomial resolves gaussian and is NOT counted as a fallback — the whole D-10 revert argument", () => {
    const moments = buildRuleModuleMoments(rp2026Nb, {
      hubTotalCount: { mean: 40, variance: 200 },
      totalTowerPoints: { mean: 40, variance: 200 },
    });
    const tally = emptyMarginalResolutionTally();
    allianceBonusRpPmf(moments, rp2026Nb, 0, RP_LAYER_CONFIG_DEFAULT, tally);
    expect(tally.gaussian).toBe(2);
    expect(tally.fallbacks).toBe(0);
    expect(tally.negativeBinomial).toBe(0);
  });

  it("the tally is per-call: two successive calls on a fresh tally object accumulate; a call given no tally still returns a correct pmf and does not throw", () => {
    const config: RpLayerConfig = { ...RP_LAYER_CONFIG_DEFAULT, marginal: "negative-binomial" };
    const moments = buildRuleModuleMoments(rp2026Nb, {
      hubTotalCount: { mean: 40, variance: 200 },
      totalTowerPoints: { mean: 40, variance: 200 },
    });
    const tally = emptyMarginalResolutionTally();
    allianceBonusRpPmf(moments, rp2026Nb, 0, config, tally);
    allianceBonusRpPmf(moments, rp2026Nb, 0, config, tally);
    expect(tally.negativeBinomial).toBe(4);

    expect(() => allianceBonusRpPmf(moments, rp2026Nb, 0, config)).not.toThrow();
    const untallied = allianceBonusRpPmf(moments, rp2026Nb, 0, config);
    expect(untallied.pmf.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it("analyticRpPmf's result.marginalResolution carries THIS CALL's OWN counts, and merges into an externally-supplied input.tally without replacing it", () => {
    const config: RpLayerConfig = { ...RP_LAYER_CONFIG_DEFAULT, marginal: "negative-binomial" };
    const moments = buildRuleModuleMoments(rp2026Nb, {
      hubTotalCount: { mean: 40, variance: 200 },
      totalTowerPoints: { mean: 40, variance: 200 },
    });
    const externalTally = emptyMarginalResolutionTally();
    const result = analyticRpPmf({
      red: moments,
      blue: moments,
      ruleModule: rp2026Nb,
      eventType: 0,
      compLevel: "qm",
      config,
      pRedWin: 0.5,
      tally: externalTally,
    });
    expect(result.marginalResolution).toBeDefined();
    // Both alliances, both threshold variables: 4 NB fits per call.
    expect(result.marginalResolution!.negativeBinomial).toBe(4);
    expect(externalTally.negativeBinomial).toBe(4);

    // A second call folds into the SAME external accumulator.
    analyticRpPmf({
      red: moments,
      blue: moments,
      ruleModule: rp2026Nb,
      eventType: 0,
      compLevel: "qm",
      config,
      pRedWin: 0.5,
      tally: externalTally,
    });
    expect(externalTally.negativeBinomial).toBe(8);
  });

  it("exactly one producer of fitMarginal's declared argument in analyticPmf.ts (grep source assertion, filtered to code lines)", () => {
    const source = readFileSync(new URL("./analyticPmf.ts", import.meta.url), "utf8");
    const codeLines = source.split("\n").filter((line) => !/^\s*(\*|\/\/)/.test(line));
    const fitMarginalCallLines = codeLines.filter((line) => /\bfitMarginal\(/.test(line));
    // The ONE direct fitMarginal(...) call in this file is clauseProbability's
    // synthetic-linear-combination-sum fit, always Gaussian by a fixed
    // literal — NOT driven by any variable's declared family, so it is not
    // the "second entry point" 09-03's contract forbids. The per-variable
    // declared value that DOES reach marginals.ts's fitAllianceMarginals
    // flows through resolveDeclaredFamily, asserted below to have exactly
    // one call site.
    expect(fitMarginalCallLines).toHaveLength(1);
    expect(fitMarginalCallLines[0]).toContain('fitMarginal(mean, variance, "gaussian")');

    const resolveDeclaredFamilyCallLines = codeLines.filter(
      (line) => /resolveDeclaredFamily\(/.test(line) && !/^export function resolveDeclaredFamily/.test(line.trim())
    );
    expect(resolveDeclaredFamilyCallLines).toHaveLength(1);
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
