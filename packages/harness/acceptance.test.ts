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

/** A comparison that is comfortably accepted, used as the base for one-field overrides below. */
function baseInput(overrides: Partial<AcceptanceInput> = {}): AcceptanceInput {
  return {
    incumbentAccuracy: 0.6,
    candidateAccuracy: 0.61,
    incumbentBrier: 0.16,
    candidateBrier: 0.16,
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
  it("accepts a challenger whose accuracy beats the incumbent comfortably above the bar, Brier and MAE unchanged", () => {
    const outcome = decideAcceptance(baseInput());
    expect(outcome.decision).toBe("accept");
    expect(outcome.accuracyMargin).toBeCloseTo(0.01, 12);
    expect(outcome.threshold).toBeCloseTo(0.0034883, 6);
    expect(outcome.evaluationCount).toBe(60);
    expect(outcome.maeDelta).toBe(0);
    expect(outcome.brierDelta).toBe(0);
  });

  it("accepts a challenger that is clearly more accurate even though its Brier is slightly WORSE — inside the guardrail (the whole point of the change)", () => {
    // Brier worsens by 0.0005 (well under the 2*SE noise bound and under 1% of
    // 0.16 = 0.0016) while accuracy clears the bar comfortably.
    const outcome = decideAcceptance(baseInput({ candidateBrier: 0.1605, brierStandardError: 0.001 }));
    expect(outcome.decision).toBe("accept");
    expect(outcome.brierDelta).toBeCloseTo(0.0005, 12);
    expect(outcome.brierDelta).toBeLessThan(outcome.brierVetoBound);
  });

  it("returns keep-incumbent / below-threshold — WITHOUT throwing — for a positive but sub-bar accuracy margin", () => {
    const input = baseInput({ candidateAccuracy: 0.602 });
    expect(() => decideAcceptance(input)).not.toThrow();
    const outcome = decideAcceptance(input);
    expect(outcome).toMatchObject({ decision: "keep-incumbent", reason: "below-threshold", evaluationCount: 60 });
    expect(outcome.accuracyMargin).toBeCloseTo(0.002, 12);
    expect(outcome.accuracyMargin).toBeLessThan(outcome.threshold);
  });

  it("returns keep-incumbent / brier-veto for an accuracy win that ships a Brier regression clearing BOTH halves of the guardrail", () => {
    // Brier worsens by 0.008 (about 5% of 0.16, well past the 1% relative
    // bound) with a small SE (well past the 2*SE noise bound too).
    const outcome = decideAcceptance(baseInput({ candidateBrier: 0.168, brierStandardError: 0.0005 }));
    expect(outcome).toMatchObject({ decision: "keep-incumbent", reason: "brier-veto" });
    expect(outcome.brierDelta).toBeCloseTo(0.008, 12);
    expect(outcome.brierDelta).toBeGreaterThan(outcome.brierVetoBound);
  });

  it("does NOT trip the Brier veto on a move that fails the NOISE half only (material, but not distinguishable — large SE)", () => {
    // 5% of 0.16 = 0.008 is material (over the 1% relative bound), but with
    // SE 0.01 the delta is inside 2*SE = 0.02 — not distinguishable from
    // noise, so the noise half fails and the AND does not fire.
    const outcome = decideAcceptance(baseInput({ candidateBrier: 0.168, brierStandardError: 0.01 }));
    expect(outcome.decision).toBe("accept");
    expect(outcome.brierDelta).toBeGreaterThan(ACCEPTANCE_BRIER_VETO_RELATIVE_TOLERANCE * 0.16);
    expect(outcome.brierDelta).toBeLessThan(ACCEPTANCE_BRIER_VETO_NOISE_MULTIPLE * 0.01);
  });

  it("does NOT trip the Brier veto on a move that fails the MATERIALITY half only (distinguishable, but not material — tiny SE)", () => {
    // 0.001 on a 0.16 incumbent is 0.625%, under the 1% relative bound (not
    // material), but with a tiny SE of 0.0001 it is well past 2*SE = 0.0002
    // (clearly distinguishable from noise) — the materiality half fails and
    // the AND does not fire. Mirrors the pair of tests already proving the
    // MAE veto's two halves are both load-bearing.
    const outcome = decideAcceptance(baseInput({ candidateBrier: 0.161, brierStandardError: 0.0001 }));
    expect(outcome.decision).toBe("accept");
    expect(outcome.brierDelta).toBeGreaterThan(ACCEPTANCE_BRIER_VETO_NOISE_MULTIPLE * 0.0001);
    expect(outcome.brierDelta).toBeLessThan(ACCEPTANCE_BRIER_VETO_RELATIVE_TOLERANCE * 0.16);
  });

  it("never vetoes a challenger that IMPROVES Brier", () => {
    const outcome = decideAcceptance(baseInput({ candidateBrier: 0.14, brierStandardError: 0.0001 }));
    expect(outcome.decision).toBe("accept");
    expect(outcome.brierDelta).toBeLessThan(0);
  });

  it("precedence: a challenger that fails the bar AND regresses Brier reports below-threshold", () => {
    const outcome = decideAcceptance(
      baseInput({ candidateAccuracy: 0.6005, candidateBrier: 0.2, brierStandardError: 0.0001 })
    );
    expect(outcome).toMatchObject({ decision: "keep-incumbent", reason: "below-threshold" });
  });

  it("precedence: a challenger that clears the bar and trips BOTH vetoes reports mae-veto", () => {
    const outcome = decideAcceptance(
      baseInput({
        candidateMae: 21.6,
        maeStandardError: 0.05,
        candidateBrier: 0.2,
        brierStandardError: 0.0001,
      })
    );
    expect(outcome).toMatchObject({ decision: "keep-incumbent", reason: "mae-veto" });
  });

  it("returns keep-incumbent / mae-veto for a Brier-unchanged accuracy win that ships an 8% MAE regression", () => {
    const outcome = decideAcceptance(baseInput({ candidateMae: 21.6, maeStandardError: 0.05 }));
    expect(outcome).toMatchObject({ decision: "keep-incumbent", reason: "mae-veto" });
    expect(outcome.maeDelta).toBeCloseTo(1.6, 12);
    expect(outcome.maeDelta).toBeGreaterThan(outcome.maeVetoBound);
  });

  it("does NOT veto a +0.3% MAE move with a large SE (fails both halves of the AND)", () => {
    const outcome = decideAcceptance(baseInput({ candidateMae: 20.06, maeStandardError: 0.5 }));
    expect(outcome.decision).toBe("accept");
    expect(outcome.maeDelta).toBeLessThan(ACCEPTANCE_MAE_NOISE_MULTIPLE * 0.5);
    expect(outcome.maeDelta).toBeLessThan(ACCEPTANCE_MAE_RELATIVE_TOLERANCE * 20);
  });

  it("does NOT veto a +5% MAE move whose SE is large enough to leave it inside 2 SE", () => {
    const outcome = decideAcceptance(baseInput({ candidateMae: 21, maeStandardError: 1.0 }));
    expect(outcome.decision).toBe("accept");
    expect(outcome.maeDelta).toBeGreaterThan(ACCEPTANCE_MAE_RELATIVE_TOLERANCE * 20);
    expect(outcome.maeDelta).toBeLessThan(ACCEPTANCE_MAE_NOISE_MULTIPLE * 1.0);
  });

  it("never vetoes a candidate that IMPROVES score MAE", () => {
    const outcome = decideAcceptance(baseInput({ candidateMae: 17, maeStandardError: 0.01 }));
    expect(outcome.decision).toBe("accept");
    expect(outcome.maeDelta).toBeLessThan(0);
  });

  it("reports below-threshold, not mae-veto, for a candidate that fails the bar AND regresses MAE", () => {
    const outcome = decideAcceptance(baseInput({ candidateAccuracy: 0.6002, candidateMae: 24, maeStandardError: 0.05 }));
    expect(outcome).toMatchObject({ decision: "keep-incumbent", reason: "below-threshold" });
  });

  it("carries the same evidence fields on all outcomes", () => {
    const accepted = decideAcceptance(baseInput());
    const keptBelowThreshold = decideAcceptance(baseInput({ candidateAccuracy: 0.6002 }));
    const keptMaeVeto = decideAcceptance(baseInput({ candidateMae: 21.6, maeStandardError: 0.05 }));
    const keptBrierVeto = decideAcceptance(baseInput({ candidateBrier: 0.168, brierStandardError: 0.0005 }));
    for (const outcome of [accepted, keptBelowThreshold, keptMaeVeto, keptBrierVeto]) {
      expect(typeof outcome.accuracyMargin).toBe("number");
      expect(typeof outcome.threshold).toBe("number");
      expect(typeof outcome.evaluationCount).toBe("number");
      expect(typeof outcome.maeDelta).toBe("number");
      expect(typeof outcome.maeVetoBound).toBe("number");
      expect(typeof outcome.brierDelta).toBe("number");
      expect(typeof outcome.brierVetoBound).toBe("number");
    }
  });
});
