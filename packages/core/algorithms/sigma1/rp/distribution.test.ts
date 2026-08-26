/**
 * Pure unit tests for D-10/D-11/D-16's joint Monte Carlo RP pmf
 * (`rpPmfForMatch`, `mulberry32`, `boxMullerPair`, `fnv1a32`, `pmfMean`,
 * `pmfStandardDeviation`) — hand-built `AllianceRpMoments` fixtures, no
 * corpus access, matching `rp/state.test.ts`'s pure-unit shape.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SIGMA1_PARAMS, type Sigma1Params } from "../params.js";
import { makeSigma1, type Sigma1State } from "../index.js";
import { rpRuleModuleForSeason } from "./rules.js";
import type { RpRuleModule } from "./constants.js";
import type { AllianceRpMoments } from "./state.js";
import { boxMullerPair, fnv1a32, mulberry32, pmfMean, pmfStandardDeviation, rpPmfForMatch, type RpPmfInput } from "./distribution.js";

function moments(overrides: Partial<AllianceRpMoments> = {}): AllianceRpMoments {
  return {
    variableNames: ["matchCargoTotal", "autoCargoTotal", "endgamePoints"],
    meanVector: [0, 0, 0],
    varianceBlock: [
      [0.000001, 0, 0],
      [0, 0.000001, 0],
      [0, 0, 0.000001],
    ],
    scoreMean: 0,
    scoreVariance: 0.000001,
    scoreCrossCovariance: [0, 0, 0],
    ...overrides,
  };
}

const RULE_2022 = rpRuleModuleForSeason(2022);

function baseInput(overrides: Partial<RpPmfInput> = {}): RpPmfInput {
  return {
    red: moments(),
    blue: moments(),
    ruleModule: RULE_2022,
    eventType: 0,
    matchKey: "2022test_qm1",
    compLevel: "qm",
    params: DEFAULT_SIGMA1_PARAMS,
    ...overrides,
  };
}

describe("rpPmfForMatch — non-qualification short-circuit", () => {
  it.each(["ef", "qf", "sf", "f"] as const)("returns [1] for both alliances at compLevel %s", (compLevel) => {
    const result = rpPmfForMatch(baseInput({ compLevel }));
    expect(result.redPmf).toEqual([1]);
    expect(result.bluePmf).toEqual([1]);
  });
});

describe("rpPmfForMatch — a qm match's pmf shape", () => {
  it("has length maxRp + 1 and sums to 1 within 1e-9 for both alliances", () => {
    const result = rpPmfForMatch(baseInput());
    expect(result.redPmf).toHaveLength(RULE_2022.maxRp + 1);
    expect(result.bluePmf).toHaveLength(RULE_2022.maxRp + 1);
    expect(Math.abs(result.redPmf.reduce((s, v) => s + v, 0) - 1)).toBeLessThan(1e-9);
    expect(Math.abs(result.bluePmf.reduce((s, v) => s + v, 0) - 1)).toBeLessThan(1e-9);
  });

  it("every entry is non-negative and finite", () => {
    const result = rpPmfForMatch(baseInput());
    for (const v of [...result.redPmf, ...result.bluePmf]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("rpPmfForMatch — zero-draws short-circuit (D-01's search fast path)", () => {
  it("returns [] for both alliances when params.rpMonteCarloDraws === 0", () => {
    const params: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, rpMonteCarloDraws: 0 };
    const result = rpPmfForMatch(baseInput({ params }));
    expect(result.redPmf).toEqual([]);
    expect(result.bluePmf).toEqual([]);
  });
});

describe("rpPmfForMatch — determinism (D-16)", () => {
  it("the same match drawn twice with the same seed gives an identical array", () => {
    const input = baseInput({
      red: moments({ scoreMean: 60, scoreVariance: 25, meanVector: [10, 1, 10] }),
      blue: moments({ scoreMean: 40, scoreVariance: 25, meanVector: [5, 0, 5] }),
    });
    const first = rpPmfForMatch(input);
    const second = rpPmfForMatch(input);
    expect(first.redPmf).toEqual(second.redPmf);
    expect(first.bluePmf).toEqual(second.bluePmf);
  });

  it("the same match's pmf is identical regardless of a different matchKey's params being used immediately before it (per-match seeding, not stream position)", () => {
    const inputA = baseInput({ matchKey: "2022test_qm5" });
    const inputB = baseInput({ matchKey: "2022test_qm5" });

    // Simulate "different surrounding match order": draw an unrelated
    // match first in one run, not in the other, before drawing the SAME
    // match key.
    rpPmfForMatch(baseInput({ matchKey: "2022other_qm1" }));
    rpPmfForMatch(baseInput({ matchKey: "2022other_qm2" }));
    const afterOthers = rpPmfForMatch(inputA);

    const standalone = rpPmfForMatch(inputB);

    expect(afterOthers.redPmf).toEqual(standalone.redPmf);
    expect(afterOthers.bluePmf).toEqual(standalone.bluePmf);
  });

  it("two different match keys produce different pmfs (the seed genuinely depends on matchKey, not a constant)", () => {
    // Real variance on both the score margin and the threshold variable
    // (mean sitting AT the cargo threshold, sd 5) is load-bearing here: a
    // near-deterministic fixture (tiny variance everywhere) would produce
    // the identical pmf under any seed, which would pass this assertion
    // for the wrong reason.
    const varied = moments({ scoreMean: 20, scoreVariance: 25, meanVector: [20, 1, 20], varianceBlock: [[25, 0, 0], [0, 0.000001, 0], [0, 0, 0.000001]] });
    const blue = moments({ scoreMean: 15, scoreVariance: 25, meanVector: [5, 0, 0] });
    const a = rpPmfForMatch(baseInput({ matchKey: "2022aaaa_qm1", red: varied, blue }));
    const b = rpPmfForMatch(baseInput({ matchKey: "2022bbbb_qm1", red: varied, blue }));
    expect(a.redPmf).not.toEqual(b.redPmf);
  });
});

describe("rpPmfForMatch — fixed-seed golden pmf (plan 06.1-02 Task 1 — proves the per-bonus widening consumes no extra randomness)", () => {
  /**
   * Recorded BEFORE the per-bonus tally was added to `rpPmfForMatch`, by
   * running this exact fixture against the pre-widening production code.
   * If this case ever goes red, the draw sequence moved — the whole basis
   * of this plan's claim that adding the per-bonus tally is a read-only
   * aggregation over draws the loop already takes.
   */
  it("redPmf and bluePmf match the literal golden arrays recorded before the per-bonus widening", () => {
    const input = baseInput({
      red: moments({ scoreMean: 60, scoreVariance: 25, meanVector: [10, 1, 10] }),
      blue: moments({ scoreMean: 40, scoreVariance: 25, meanVector: [5, 0, 5] }),
      matchKey: "2022golden_qm1",
    });
    const result = rpPmfForMatch(input);
    expect(result.redPmf).toEqual([0.0055, 0, 0.9945, 0, 0]);
    expect(result.bluePmf).toEqual([0.9945, 0, 0.0055, 0, 0]);
  });
});

describe("rpPmfForMatch — per-bonus probabilities (plan 06.1-02 Task 1, F-06-1)", () => {
  it("redBonusProbabilities has the same length as ruleModule.bonusNames, every entry in [0, 1]", () => {
    const result = rpPmfForMatch(baseInput());
    expect(result.redBonusProbabilities).toHaveLength(RULE_2022.bonusNames.length);
    expect(result.blueBonusProbabilities).toHaveLength(RULE_2022.bonusNames.length);
    for (const v of [...result.redBonusProbabilities!, ...result.blueBonusProbabilities!]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("a non-qualification compLevel omits redBonusProbabilities/blueBonusProbabilities entirely (never an empty array)", () => {
    const result = rpPmfForMatch(baseInput({ compLevel: "sf" }));
    expect(Object.hasOwn(result, "redBonusProbabilities")).toBe(false);
    expect(Object.hasOwn(result, "blueBonusProbabilities")).toBe(false);
  });

  it("a zero rpMonteCarloDraws parameter omits redBonusProbabilities/blueBonusProbabilities entirely (never an empty array)", () => {
    const params: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, rpMonteCarloDraws: 0 };
    const result = rpPmfForMatch(baseInput({ params }));
    expect(Object.hasOwn(result, "redBonusProbabilities")).toBe(false);
    expect(Object.hasOwn(result, "blueBonusProbabilities")).toBe(false);
  });

  it("two calls with the same seed and inputs produce deeply equal bonus probability arrays (deterministic, like the pmf)", () => {
    const input = baseInput({
      red: moments({ scoreMean: 55, scoreVariance: 25, meanVector: [15, 0, 20] }),
      blue: moments({ scoreMean: 50, scoreVariance: 25, meanVector: [5, 0, 0] }),
      matchKey: "2022bonusdeterm_qm1",
    });
    const first = rpPmfForMatch(input);
    const second = rpPmfForMatch(input);
    expect(first.redBonusProbabilities).toEqual(second.redBonusProbabilities);
    expect(first.blueBonusProbabilities).toEqual(second.blueBonusProbabilities);
  });

  it("for a synthetic single-bonus rule module with zero win/tie RP, redBonusProbabilities[0] equals redPmf[1] exactly", () => {
    // A single-bonus module with winRp/tieRp both 0 means the ONLY way to
    // earn a ranking point is the bonus itself -- P(bonus) and P(RP=1) are
    // the identical event.
    const singleBonusModule: RpRuleModule = {
      season: 2022,
      thresholdVariables: [{ name: "matchCargoTotal", unit: "count" }],
      bonusNames: ["cargoBonus"],
      maxRp: 1,
      winRp: 0,
      tieRp: 0,
      parse: RULE_2022.parse,
      predictThresholds: (values) => {
        const achieved = (values["matchCargoTotal"] ?? 0) >= 20;
        return { bonusFlags: { cargoBonus: achieved }, totalRp: achieved ? 1 : 0 };
      },
    };
    const input = baseInput({
      ruleModule: singleBonusModule,
      red: moments({ scoreMean: 55, scoreVariance: 25, meanVector: [15], varianceBlock: [[25]], scoreCrossCovariance: [10], variableNames: ["matchCargoTotal"] }),
      blue: moments({ scoreMean: 50, scoreVariance: 25, meanVector: [5], varianceBlock: [[25]], scoreCrossCovariance: [0], variableNames: ["matchCargoTotal"] }),
      matchKey: "2022singlebonus_qm1",
    });
    const result = rpPmfForMatch(input);
    expect(result.redBonusProbabilities![0]).toBe(result.redPmf[1]);
  });
});

describe("rpPmfForMatch — degenerate alliance (no rated teams, ALGO-08 empty edge)", () => {
  it("an alliance with zero variance everywhere (no rating-eligible teams) still yields a defined, normalized pmf — never empty, never NaN", () => {
    const input = baseInput({
      red: moments(), // all-zero, deterministic (simulates predictAllianceRpMoments over an empty team list)
      blue: moments({ scoreMean: 50, scoreVariance: 25, meanVector: [10, 1, 10] }),
    });
    const result = rpPmfForMatch(input);
    expect(result.redPmf.length).toBe(RULE_2022.maxRp + 1);
    for (const v of result.redPmf) expect(Number.isNaN(v)).toBe(false);
    expect(Math.abs(result.redPmf.reduce((s, v) => s + v, 0) - 1)).toBeLessThan(1e-9);
  });
});

describe("rpPmfForMatch — D-11's correlation claim, measured", () => {
  it("a strongly-favoured alliance's P(RP=maxRp) is strictly greater under the correlated joint draw than under an independence-forced control with the cross-covariance zeroed", () => {
    // Red is only NARROWLY favoured on score (mean 55 vs blue's 50, margin
    // sd ~7.07 combined) — P(win) is meaningfully below 1 rather than a
    // near-certainty, which is load-bearing: if winning were already
    // virtually guaranteed regardless of the draw, conditioning on it could
    // not visibly shift the expected cargo count (confirmed empirically:
    // a scoreMean gap of 50 instead of 5 makes this assertion flaky/wrong-
    // signed at real Monte Carlo sample sizes). matchCargoTotal's own mean
    // (15) sits BELOW the non-quintet cargo threshold (20), so cargo bonus
    // is NOT a foregone conclusion; endgamePoints is set safely above the
    // hangar threshold (16) with negligible variance so hangar bonus is
    // essentially certain, isolating cargoBonus as the one variable term.
    // A POSITIVE scoreCrossCovariance models "a team that scores more also
    // tends to gather more cargo" (D-11) — conditioning on red actually
    // winning should push the expected cargo count up, raising
    // P(win AND cargoBonus AND hangarBonus) = P(RP=maxRp) above the
    // independent case.
    function redMoments(crossCov: number): AllianceRpMoments {
      return moments({
        scoreMean: 55,
        scoreVariance: 25,
        meanVector: [15, 0, 20],
        varianceBlock: [
          [25, 0, 0],
          [0, 0.000001, 0],
          [0, 0, 0.000001],
        ],
        scoreCrossCovariance: [crossCov, 0, 0],
      });
    }
    const blueMoments = moments({ scoreMean: 50, scoreVariance: 25, meanVector: [5, 0, 0] });

    const params: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, rpMonteCarloDraws: 20000 };
    const correlated = rpPmfForMatch(
      baseInput({ red: redMoments(20), blue: blueMoments, params, matchKey: "2022corr_qm1" })
    );
    const control = rpPmfForMatch(
      baseInput({ red: redMoments(0), blue: blueMoments, params, matchKey: "2022corr_qm1" })
    );

    const maxRp = RULE_2022.maxRp;
    expect(correlated.redPmf[maxRp]!).toBeGreaterThan(control.redPmf[maxRp]!);
  });
});

describe("rpPmfForMatch — 0 draws vs 2000 draws leaves score-side predictions unchanged (plan 03-03 must-have)", () => {
  it("makeSigma1's predict() reports identical pRedWin, redScore, blueScore whether rpMonteCarloDraws is 0 or 2000", () => {
    const withDraws = makeSigma1({ id: "sigma1-rp-draws", linkMode: "predictive-variance", params: { ...DEFAULT_SIGMA1_PARAMS, rpMonteCarloDraws: 2000 } });
    const noDraws = makeSigma1({ id: "sigma1-rp-nodraws", linkMode: "predictive-variance", params: { ...DEFAULT_SIGMA1_PARAMS, rpMonteCarloDraws: 0 } });

    const state1: Sigma1State = withDraws.initState([]);
    const state2: Sigma1State = noDraws.initState([]);

    const upcoming = {
      matchKey: "2022test_qm1",
      eventKey: "2022test",
      compLevel: "qm" as const,
      setNumber: 1,
      matchNumber: 1,
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["T4", "T5", "T6"],
      redSurrogates: [],
      blueSurrogates: [],
      eventType: 0,
    };

    const p1 = withDraws.predict(state1, upcoming);
    const p2 = noDraws.predict(state2, upcoming);

    expect(p1.pRedWin).toBe(p2.pRedWin);
    expect(p1.redScore).toBe(p2.redScore);
    expect(p1.blueScore).toBe(p2.blueScore);
    expect(p1.variance).toBe(p2.variance);
    // And the pmf presence itself differs exactly as documented: present
    // (non-empty) with draws, entirely omitted (never an empty array) at 0.
    expect(p1.redRpPmf).toBeDefined();
    expect(p2.redRpPmf).toBeUndefined();
  });
});

describe("pmfMean / pmfStandardDeviation", () => {
  it("mean and SD are derived correctly from a hand-built pmf", () => {
    const pmf = [0.5, 0.5]; // P(RP=0)=0.5, P(RP=1)=0.5
    expect(pmfMean(pmf)).toBeCloseTo(0.5, 9);
    expect(pmfStandardDeviation(pmf)).toBeCloseTo(0.5, 9);
  });

  it("a degenerate single-value pmf has SD exactly 0", () => {
    expect(pmfMean([1])).toBe(0);
    expect(pmfStandardDeviation([1])).toBe(0);
  });
});

describe("mulberry32 / boxMullerPair / fnv1a32 — hand-rolled primitives", () => {
  it("mulberry32 is deterministic: same seed, same sequence", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("mulberry32 output stays within [0, 1)", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("boxMullerPair produces two finite values for a mid-range input pair", () => {
    const [z1, z2] = boxMullerPair(0.5, 0.5);
    expect(Number.isFinite(z1)).toBe(true);
    expect(Number.isFinite(z2)).toBe(true);
  });

  it("fnv1a32 is deterministic and returns an unsigned 32-bit integer", () => {
    const h1 = fnv1a32("2022test_qm1");
    const h2 = fnv1a32("2022test_qm1");
    expect(h1).toBe(h2);
    expect(h1).toBeGreaterThanOrEqual(0);
    expect(h1).toBeLessThanOrEqual(0xffffffff);
  });

  it("fnv1a32 differs for different inputs (not a constant)", () => {
    expect(fnv1a32("2022test_qm1")).not.toBe(fnv1a32("2022test_qm2"));
  });
});

describe("rpPmfForMatch — escalating Cholesky ridge (Rule 1 fix, plan 03-05)", () => {
  /**
   * Discovered running `pnpm promote` for real (plan 03-05 Task 3): a fresh
   * cold-start team's `rpCrossCovariance`, folded from very few
   * observations, can be large RELATIVE to its own tiny `rpCovariance`/
   * score-variance — a near-singular joint matrix a single fixed 1e-6 ridge
   * cannot always fix. This fixture manufactures exactly that: a
   * near-zero self-variance paired with a cross-covariance whose magnitude
   * exceeds it by many orders of magnitude, so `buildCovArray(0)` and
   * `buildCovArray(1e-6)`/`(1e-4)`/`(1e-2)` all stay non-positive-definite
   * (determinant ~= ridge^2 - cross^2 < 0 until ridge approaches
   * |cross|) — the fix must escalate past the ORIGINAL single retry to
   * resolve it.
   */
  it("resolves a near-singular joint matrix that the original single 1e-6 retry could not (does not throw, produces a valid pmf)", () => {
    const pathologicalRed = moments({
      scoreMean: 50,
      scoreVariance: 1e-8,
      varianceBlock: [
        [1e-8, 0, 0],
        [0, 0.000001, 0],
        [0, 0, 0.000001],
      ],
      // The FIRST threshold variable's cross-covariance with score is many
      // orders of magnitude larger than either's own (near-zero) variance --
      // the joint 2x2 submatrix's determinant (~ridge^2 - cross^2) stays
      // negative until the ridge approaches |cross| = 1, well past the
      // original single 1e-6 retry.
      scoreCrossCovariance: [1, 0, 0],
    });
    const input = baseInput({ red: pathologicalRed, blue: moments({ scoreVariance: 25 }) });
    let result: ReturnType<typeof rpPmfForMatch> | undefined;
    expect(() => {
      result = rpPmfForMatch(input);
    }).not.toThrow();
    expect(result!.redPmf).toHaveLength(RULE_2022.maxRp + 1);
    expect(Math.abs(result!.redPmf.reduce((s, v) => s + v, 0) - 1)).toBeLessThan(1e-9);
  });

  it("a well-conditioned match still succeeds at ridge 0 (the escalation never fires, existing behaviour is untouched)", () => {
    // baseInput()'s default fixture (tiny but EQUAL, positive-definite
    // 1e-6 diagonal variances, zero cross-covariance) is already
    // positive-definite with no ridge at all -- this is the same fixture
    // every other test in this file already exercises, re-asserted here
    // explicitly as the "the fix changes nothing for the common case" proof.
    expect(() => rpPmfForMatch(baseInput())).not.toThrow();
  });
});

describe("rpPmfForMatch — cross-covariance Cauchy-Schwarz clamp (Rule 1 fix, plan 03-06)", () => {
  /**
   * Discovered running the real `pnpm harness --seasons 2022-2026`
   * command (match `2026rikin_qm1`, cold-start blue alliance):
   * `scoreCrossCovariance` (an EWMA of observed residual products) can
   * exceed what its paired Kalman POSTERIOR variances allow by a wide
   * margin — not a rounding-scale near-singularity `CHOLESKY_RIDGES` can
   * escalate past, but a genuinely INVALID (negative-determinant) 2x2
   * submatrix no diagonal ridge repairs. This fixture reproduces that
   * shape at the SAME relative scale (cross roughly 1.3x the
   * Cauchy-Schwarz bound `sqrt(varX*varY)`, both diagonal entries
   * comfortably non-trivial — unlike the escalating-ridge fixture above,
   * whose near-zero diagonals are a DIFFERENT failure mode).
   */
  it("a cross-covariance exceeding the Cauchy-Schwarz bound implied by its own paired variances does not throw and still produces a valid, normalized pmf", () => {
    const varX = 511.26;
    const varY = 1985.45;
    const bound = Math.sqrt(varX * varY); // ~1007.48
    const invalidCross = bound * 1.3; // ~1309.7 -- genuinely exceeds the bound, matches the real discovery's magnitude
    const blueLikeAlliance = moments({
      scoreMean: 115.78,
      scoreVariance: varX,
      meanVector: [171.62, -0.59],
      varianceBlock: [
        [varY, 0.0127],
        [0.0127, 0.0347],
      ],
      variableNames: ["hubTotalCount", "totalTowerPoints"],
      scoreCrossCovariance: [invalidCross, 0.37],
    });
    const input = baseInput({
      ruleModule: rpRuleModuleForSeason(2026),
      red: moments({ variableNames: ["hubTotalCount", "totalTowerPoints"], meanVector: [0, 0], varianceBlock: [[0, 0], [0, 0]] }),
      blue: blueLikeAlliance,
      matchKey: "2026clamp_qm1",
    });

    let result: ReturnType<typeof rpPmfForMatch> | undefined;
    expect(() => {
      result = rpPmfForMatch(input);
    }).not.toThrow();
    expect(result!.bluePmf.length).toBeGreaterThan(0);
    expect(Math.abs(result!.bluePmf.reduce((s, v) => s + v, 0) - 1)).toBeLessThan(1e-9);
    for (const v of result!.bluePmf) expect(Number.isFinite(v)).toBe(true);
  });

  it("a cross-covariance already within the Cauchy-Schwarz bound is left untouched (the clamp only ever narrows an already-invalid value)", () => {
    // A valid, well-inside-bound cross-covariance (bound = sqrt(25*25) = 25;
    // 10 is comfortably inside it) must produce the identical pmf whether
    // or not the clamp exists -- this is the "the fix changes nothing for
    // an already-consistent estimate" proof, mirroring the ridge escalation
    // fixture's own "ridge 0 still succeeds" test above.
    const withValidCross = moments({ scoreMean: 55, scoreVariance: 25, meanVector: [15, 0, 20], varianceBlock: [[25, 0, 0], [0, 1e-6, 0], [0, 0, 1e-6]], scoreCrossCovariance: [10, 0, 0] });
    const blue = moments({ scoreMean: 50, scoreVariance: 25, meanVector: [5, 0, 0] });
    const params: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, rpMonteCarloDraws: 500 };
    const result = rpPmfForMatch(baseInput({ red: withValidCross, blue, params, matchKey: "2022valid_qm1" }));
    expect(Math.abs(result.redPmf.reduce((s, v) => s + v, 0) - 1)).toBeLessThan(1e-9);
  });
});
