import { describe, expect, it } from "vitest";
import {
  ACCEPTANCE_BRIER_VETO_NOISE_MULTIPLE,
  ACCEPTANCE_BRIER_VETO_RELATIVE_TOLERANCE,
  ACCEPTANCE_MAE_NOISE_MULTIPLE,
  ACCEPTANCE_MAE_RELATIVE_TOLERANCE,
  acceptanceThreshold,
  decideAcceptance,
  type AcceptanceInput,
} from "./acceptance.js";

/** D-T6's measured event-blocked level SE on the tune pool (47,851 matches, 561 events) — reused here as a realistic SE scale, now applied to the ACCURACY delta per quick task 260904-oiu. */
const D_T6_EVENT_BLOCKED_SE = 0.001219;

/**
 * A comparison that is accepted under Rule A (quick task 260905-t88), used as
 * the base for one-field overrides below. `candidateBrier` is 0.159 — an
 * IMPROVEMENT over the 0.16 incumbent — because under Rule A a fixture with
 * an unchanged Brier is not an accepting fixture: the Brier half requires a
 * STRICT improvement, and 0.16 === 0.16 fails that strictly.
 */
function baseInput(overrides: Partial<AcceptanceInput> = {}): AcceptanceInput {
  return {
    incumbentAccuracy: 0.6,
    candidateAccuracy: 0.61,
    incumbentBrier: 0.16,
    candidateBrier: 0.159,
    incumbentMae: 20,
    candidateMae: 20,
    accuracyStandardError: D_T6_EVENT_BLOCKED_SE,
    brierStandardError: D_T6_EVENT_BLOCKED_SE,
    maeStandardError: 0.05,
    evaluationCount: 60,
    ...overrides,
  };
}

describe("acceptanceThreshold", () => {
  it("reproduces D-T7's published 0.0035 bar at N = 60 (formula unchanged; now applied to whatever SE is passed)", () => {
    const expected = Math.sqrt(2 * Math.log(60)) * D_T6_EVENT_BLOCKED_SE;
    const actual = acceptanceThreshold(60, D_T6_EVENT_BLOCKED_SE);
    expect(actual).toBeCloseTo(expected, 12);
    expect(actual).toBeCloseTo(0.0035, 4);
  });

  it("MOVES with N — which is why D-T7 requires N recorded alongside every result", () => {
    const se = D_T6_EVENT_BLOCKED_SE;
    expect(acceptanceThreshold(120, se)).toBeGreaterThan(acceptanceThreshold(60, se));
    expect(acceptanceThreshold(60, se)).toBeGreaterThan(acceptanceThreshold(30, se));
  });

  it("refuses N < 2, where the union bound is exactly 0 and is not a bar", () => {
    expect(() => acceptanceThreshold(1, D_T6_EVENT_BLOCKED_SE)).toThrow(/evaluationCount must be an integer >= 2/);
    expect(() => acceptanceThreshold(0, D_T6_EVENT_BLOCKED_SE)).toThrow(/evaluationCount must be an integer >= 2/);
  });
});

describe("decideAcceptance", () => {
  it("[fixture 1] accepts a challenger whose accuracy beats the incumbent ABOVE the noise bar, with an IMPROVING Brier and flat MAE — both halves of Rule A satisfied", () => {
    const outcome = decideAcceptance(baseInput());
    expect(outcome.decision).toBe("accept");
    expect(outcome.accuracyMargin).toBeCloseTo(0.01, 12);
    expect(outcome.threshold).toBeCloseTo(0.0034883, 6);
    expect(outcome.clearedNoiseBar).toBe(true);
    expect(outcome.evaluationCount).toBe(60);
    expect(outcome.maeDelta).toBe(0);
    expect(outcome.brierDelta).toBeCloseTo(-0.001, 12);
  });

  it("[fixture 2, tiny regression] keep-incumbent / brier-regression for a challenger that is clearly more accurate but whose Brier is even slightly WORSE — Rule A requires BOTH halves, not accuracy alone", () => {
    const outcome = decideAcceptance(baseInput({ candidateBrier: 0.1605, brierStandardError: 0.001 }));
    expect(outcome).toMatchObject({ decision: "keep-incumbent", reason: "brier-regression" });
    expect(outcome.brierDelta).toBeCloseTo(0.0005, 12);
  });

  it("[2026-09-05 MOTIVATING CASE] accepts a challenger whose accuracy margin is BELOW the retired noise bar, because Rule A does not gate on the bar — clearedNoiseBar is false but the candidate still ships", () => {
    const input = baseInput({ candidateAccuracy: 0.602 });
    expect(() => decideAcceptance(input)).not.toThrow();
    const outcome = decideAcceptance(input);
    expect(outcome.decision).toBe("accept");
    expect(outcome.accuracyMargin).toBeCloseTo(0.002, 12);
    expect(outcome.threshold).toBeCloseTo(0.0034883, 6);
    expect(outcome.accuracyMargin).toBeLessThan(outcome.threshold);
    expect(outcome.clearedNoiseBar).toBe(false);
  });

  it("[fixture 2, large regression] keep-incumbent / brier-regression for an accuracy win that ships a Brier regression that used to clear BOTH halves of the retired veto — brierVetoBound is still computed and reported", () => {
    const outcome = decideAcceptance(baseInput({ candidateBrier: 0.168, brierStandardError: 0.0005 }));
    expect(outcome).toMatchObject({ decision: "keep-incumbent", reason: "brier-regression" });
    expect(outcome.brierDelta).toBeCloseTo(0.008, 12);
    expect(outcome.brierDelta).toBeGreaterThan(outcome.brierVetoBound);
    expect(typeof outcome.brierVetoBound).toBe("number");
  });

  it("[fixture 2, retired veto's two halves] both the noise-half-only and materiality-half-only Brier regressions are now brier-regression — the retired veto's two-half structure no longer decides anything", () => {
    // Fails the retired veto's NOISE half only (material, but large SE): 5% of
    // 0.16 = 0.008 is material, but SE 0.01 puts it inside 2*SE = 0.02.
    const noiseHalfOnly = decideAcceptance(baseInput({ candidateBrier: 0.168, brierStandardError: 0.01 }));
    expect(noiseHalfOnly).toMatchObject({ decision: "keep-incumbent", reason: "brier-regression" });

    // Fails the retired veto's MATERIALITY half only (distinguishable, but
    // tiny relative to 0.16): 0.001 is 0.625%, under the 1% relative bound,
    // but a tiny SE of 0.0001 puts it well past 2*SE = 0.0002.
    const materialityHalfOnly = decideAcceptance(baseInput({ candidateBrier: 0.161, brierStandardError: 0.0001 }));
    expect(materialityHalfOnly).toMatchObject({ decision: "keep-incumbent", reason: "brier-regression" });
  });

  it("never vetoes (and Rule A accepts) a challenger that IMPROVES Brier", () => {
    const outcome = decideAcceptance(baseInput({ candidateBrier: 0.14, brierStandardError: 0.0001 }));
    expect(outcome.decision).toBe("accept");
    expect(outcome.brierDelta).toBeLessThan(0);
  });

  it("[fixture 3] keep-incumbent / no-accuracy-gain when accuracy WORSENS and Brier also worsens", () => {
    const outcome = decideAcceptance(baseInput({ candidateAccuracy: 0.59, candidateBrier: 0.165 }));
    expect(outcome).toMatchObject({ decision: "keep-incumbent", reason: "no-accuracy-gain" });
    expect(outcome.accuracyMargin).toBeLessThan(0);
  });

  it("strict tie on accuracy: candidateAccuracy === incumbentAccuracy (with an improving Brier) is keep-incumbent / no-accuracy-gain, not accept — Rule A's accuracy half is STRICT", () => {
    const outcome = decideAcceptance(baseInput({ candidateAccuracy: 0.6 }));
    expect(outcome).toMatchObject({ decision: "keep-incumbent", reason: "no-accuracy-gain" });
    expect(outcome.accuracyMargin).toBe(0);
  });

  it("strict tie on Brier: candidateBrier === incumbentBrier (with an improving accuracy) is keep-incumbent / brier-regression, not accept — Rule A's Brier half is STRICT", () => {
    const outcome = decideAcceptance(baseInput({ candidateBrier: 0.16 }));
    expect(outcome).toMatchObject({ decision: "keep-incumbent", reason: "brier-regression" });
    expect(outcome.brierDelta).toBe(0);
  });

  it("precedence: a challenger whose accuracy margin is positive but sub-bar, and whose Brier regresses, reports brier-regression (accuracy half passed, so the bar is irrelevant and the Brier half decides)", () => {
    const outcome = decideAcceptance(
      baseInput({ candidateAccuracy: 0.6005, candidateBrier: 0.2, brierStandardError: 0.0001 })
    );
    expect(outcome).toMatchObject({ decision: "keep-incumbent", reason: "brier-regression" });
  });

  it("precedence: a challenger that clears the accuracy half but regresses Brier AND would also trip the MAE veto reports brier-regression, not mae-veto — the Brier half is checked first", () => {
    const outcome = decideAcceptance(
      baseInput({
        candidateMae: 21.6,
        maeStandardError: 0.05,
        candidateBrier: 0.2,
        brierStandardError: 0.0001,
      })
    );
    expect(outcome).toMatchObject({ decision: "keep-incumbent", reason: "brier-regression" });
  });

  it("MAE guardrail preserved (new MAE-precedence case with an IMPROVING Brier so the MAE veto is what is actually under test): accuracy improves, Brier improves, an 8% MAE regression -> mae-veto", () => {
    const outcome = decideAcceptance(baseInput({ candidateMae: 21.6, maeStandardError: 0.05 }));
    expect(outcome).toMatchObject({ decision: "keep-incumbent", reason: "mae-veto" });
    expect(outcome.maeDelta).toBeCloseTo(1.6, 12);
    expect(outcome.maeDelta).toBeGreaterThan(outcome.maeVetoBound);
  });

  it("does NOT veto a +0.3% MAE move with a large SE (fails both halves of the AND) — still accept under the improving-Brier base", () => {
    const outcome = decideAcceptance(baseInput({ candidateMae: 20.06, maeStandardError: 0.5 }));
    expect(outcome.decision).toBe("accept");
    expect(outcome.maeDelta).toBeLessThan(ACCEPTANCE_MAE_NOISE_MULTIPLE * 0.5);
    expect(outcome.maeDelta).toBeLessThan(ACCEPTANCE_MAE_RELATIVE_TOLERANCE * 20);
  });

  it("does NOT veto a +5% MAE move whose SE is large enough to leave it inside 2 SE — still accept under the improving-Brier base", () => {
    const outcome = decideAcceptance(baseInput({ candidateMae: 21, maeStandardError: 1.0 }));
    expect(outcome.decision).toBe("accept");
    expect(outcome.maeDelta).toBeGreaterThan(ACCEPTANCE_MAE_RELATIVE_TOLERANCE * 20);
    expect(outcome.maeDelta).toBeLessThan(ACCEPTANCE_MAE_NOISE_MULTIPLE * 1.0);
  });

  it("never vetoes a candidate that IMPROVES score MAE — still accept under the improving-Brier base", () => {
    const outcome = decideAcceptance(baseInput({ candidateMae: 17, maeStandardError: 0.01 }));
    expect(outcome.decision).toBe("accept");
    expect(outcome.maeDelta).toBeLessThan(0);
  });

  it("precedence: accuracy does NOT improve AND MAE blows up -> no-accuracy-gain, not mae-veto (a negative accuracy margin, not merely sub-bar)", () => {
    const outcome = decideAcceptance(
      baseInput({ candidateAccuracy: 0.599, candidateMae: 24, maeStandardError: 0.05 })
    );
    expect(outcome).toMatchObject({ decision: "keep-incumbent", reason: "no-accuracy-gain" });
    expect(outcome.accuracyMargin).toBeLessThan(0);
  });

  it("carries the same evidence fields, including clearedNoiseBar and threshold, on all outcomes", () => {
    const accepted = decideAcceptance(baseInput());
    const keptNoAccuracyGain = decideAcceptance(baseInput({ candidateAccuracy: 0.599 }));
    const keptBrierRegression = decideAcceptance(baseInput({ candidateBrier: 0.168, brierStandardError: 0.0005 }));
    const keptMaeVeto = decideAcceptance(baseInput({ candidateMae: 21.6, maeStandardError: 0.05 }));
    for (const outcome of [accepted, keptNoAccuracyGain, keptBrierRegression, keptMaeVeto]) {
      expect(typeof outcome.accuracyMargin).toBe("number");
      expect(typeof outcome.threshold).toBe("number");
      expect(typeof outcome.clearedNoiseBar).toBe("boolean");
      expect(typeof outcome.evaluationCount).toBe("number");
      expect(typeof outcome.maeDelta).toBe("number");
      expect(typeof outcome.maeVetoBound).toBe("number");
      expect(typeof outcome.brierDelta).toBe("number");
      expect(typeof outcome.brierVetoBound).toBe("number");
    }
    expect(keptNoAccuracyGain).toMatchObject({ reason: "no-accuracy-gain" });
    expect(keptBrierRegression).toMatchObject({ reason: "brier-regression" });
    expect(keptMaeVeto).toMatchObject({ reason: "mae-veto" });
  });
});
