import { describe, expect, it } from "vitest";
import {
  ACCEPTANCE_MAE_NOISE_MULTIPLE,
  ACCEPTANCE_MAE_RELATIVE_TOLERANCE,
  acceptanceThreshold,
  decideAcceptance,
  type AcceptanceInput,
} from "./acceptance.js";

/** D-T6's measured event-blocked level SE on the tune pool (47,851 matches, 561 events). */
const D_T6_EVENT_BLOCKED_SE = 0.001219;

/** A comparison that is comfortably accepted, used as the base for one-field overrides below. */
function baseInput(overrides: Partial<AcceptanceInput> = {}): AcceptanceInput {
  return {
    incumbentBrier: 0.16,
    candidateBrier: 0.15,
    incumbentMae: 20,
    candidateMae: 20,
    brierStandardError: D_T6_EVENT_BLOCKED_SE,
    maeStandardError: 0.05,
    evaluationCount: 60,
    ...overrides,
  };
}

describe("acceptanceThreshold", () => {
  it("reproduces D-T7's published 0.0035 bar at N = 60", () => {
    const expected = Math.sqrt(2 * Math.log(60)) * D_T6_EVENT_BLOCKED_SE;
    const actual = acceptanceThreshold(60, D_T6_EVENT_BLOCKED_SE);
    expect(actual).toBeCloseTo(expected, 12);
    // The published figure this bar IS, stated in the test so a change to the
    // formula fails against CONTEXT's own number rather than only against a
    // re-derivation of whatever the formula currently says.
    expect(actual).toBeCloseTo(0.0035, 4);
  });

  it("MOVES with N — which is why D-T7 requires N recorded alongside every result", () => {
    const se = D_T6_EVENT_BLOCKED_SE;
    // Measured: N=30 -> 0.0031928..., N=60 -> 0.0034883..., N=120 -> 0.0037601...
    // A margin of 0.0036 passes at N=120 and fails at N=60. A result quoted
    // without its N is therefore uncheckable, not merely under-documented.
    expect(acceptanceThreshold(120, se)).toBeGreaterThan(acceptanceThreshold(60, se));
    expect(acceptanceThreshold(60, se)).toBeGreaterThan(acceptanceThreshold(30, se));
  });

  it("refuses N < 2, where the union bound is exactly 0 and is not a bar", () => {
    expect(() => acceptanceThreshold(1, D_T6_EVENT_BLOCKED_SE)).toThrow(/evaluationCount must be an integer >= 2/);
    expect(() => acceptanceThreshold(0, D_T6_EVENT_BLOCKED_SE)).toThrow(/evaluationCount must be an integer >= 2/);
  });
});

describe("decideAcceptance", () => {
  it("accepts a candidate comfortably above the bar with unchanged MAE", () => {
    const outcome = decideAcceptance(baseInput());
    expect(outcome.decision).toBe("accept");
    expect(outcome.margin).toBeCloseTo(0.01, 12);
    expect(outcome.threshold).toBeCloseTo(0.0034883, 6);
    expect(outcome.evaluationCount).toBe(60);
    expect(outcome.maeDelta).toBe(0);
  });

  it("returns keep-incumbent / below-threshold — WITHOUT throwing — for a positive but sub-bar margin", () => {
    // 0.002 Brier better: a real improvement in sign, indistinguishable from
    // resampling noise at 60 evaluations.
    const input = baseInput({ candidateBrier: 0.158 });

    // The contract is that this is a NORMAL outcome, so assert explicitly
    // that no exception is thrown, not merely that the return value is right.
    expect(() => decideAcceptance(input)).not.toThrow();

    const outcome = decideAcceptance(input);
    expect(outcome).toMatchObject({ decision: "keep-incumbent", reason: "below-threshold", evaluationCount: 60 });
    expect(outcome.margin).toBeCloseTo(0.002, 12);
    expect(outcome.margin).toBeLessThan(outcome.threshold);
  });

  it("returns keep-incumbent / mae-veto for a Brier win that ships an 8% MAE regression", () => {
    // The shape of the regression that motivated the guardrail: Brier clearly
    // better, alliance-score MAE 8% worse with a small standard error.
    const outcome = decideAcceptance(baseInput({ candidateMae: 21.6, maeStandardError: 0.05 }));
    expect(outcome).toMatchObject({ decision: "keep-incumbent", reason: "mae-veto" });
    expect(outcome.maeDelta).toBeCloseTo(1.6, 12);
    expect(outcome.maeDelta).toBeGreaterThan(outcome.maeVetoBound);
  });

  it("does NOT veto a +0.3% MAE move with a large SE (fails both halves of the AND)", () => {
    const outcome = decideAcceptance(baseInput({ candidateMae: 20.06, maeStandardError: 0.5 }));
    expect(outcome.decision).toBe("accept");
    // 0.06 is under 2 * 0.5 = 1.0 (not distinguishable) AND under 1% of 20 =
    // 0.2 (not material) — neither half fires.
    expect(outcome.maeDelta).toBeLessThan(ACCEPTANCE_MAE_NOISE_MULTIPLE * 0.5);
    expect(outcome.maeDelta).toBeLessThan(ACCEPTANCE_MAE_RELATIVE_TOLERANCE * 20);
  });

  it("does NOT veto a +5% MAE move whose SE is large enough to leave it inside 2 SE", () => {
    // 1.0 point on 20 is 5% — MATERIAL by the relative half — but with an SE
    // of 1.0 it is inside 2 SE, so the noise half fails and the AND does not
    // fire. This test and the one above prove BOTH halves are load-bearing:
    // drop either condition and one of these two starts vetoing.
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
    // Precedence: a candidate that was never eligible on Brier reports the
    // reason that actually bound it. Reporting `mae-veto` here would suggest
    // the MAE guardrail was what stood in the way, which is false.
    const outcome = decideAcceptance(baseInput({ candidateBrier: 0.1599, candidateMae: 24, maeStandardError: 0.05 }));
    expect(outcome).toMatchObject({ decision: "keep-incumbent", reason: "below-threshold" });
  });

  it("carries the same evidence fields on both union members", () => {
    const accepted = decideAcceptance(baseInput());
    const kept = decideAcceptance(baseInput({ candidateBrier: 0.1599 }));
    for (const outcome of [accepted, kept]) {
      expect(typeof outcome.margin).toBe("number");
      expect(typeof outcome.threshold).toBe("number");
      expect(typeof outcome.evaluationCount).toBe("number");
      expect(typeof outcome.maeDelta).toBe("number");
      expect(typeof outcome.maeVetoBound).toBe("number");
    }
  });
});
