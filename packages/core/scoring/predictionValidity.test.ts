/**
 * Regression coverage for 01-REVIEW WR-05: a malformed `pRedWin` must fail
 * loudly at the moment it is produced, never silently reach `scoreSet` or
 * `calibrationBins`. The `opr.predict` case at the bottom of this file is
 * the end-to-end proof required by this phase's success criterion 1 — it
 * is deliberately placed here rather than in `opr.test.ts` (owned
 * exclusively by plan 03.1-03 in the next wave) to avoid a file conflict
 * between the two plans.
 */
import { describe, expect, it } from "vitest";
import { assertValidPRedWin, isValidPRedWin } from "./predictionValidity.js";
import { opr, type OprState } from "../algorithms/opr.js";
import type { UpcomingMatch } from "../algorithms/types.js";

describe("isValidPRedWin", () => {
  it("returns true for both endpoints of the closed interval and the midpoint", () => {
    expect(isValidPRedWin(0)).toBe(true);
    expect(isValidPRedWin(0.5)).toBe(true);
    expect(isValidPRedWin(1)).toBe(true);
  });

  it("returns false for NaN", () => {
    expect(isValidPRedWin(NaN)).toBe(false);
  });

  it("returns false for positive and negative infinity", () => {
    expect(isValidPRedWin(Infinity)).toBe(false);
    expect(isValidPRedWin(-Infinity)).toBe(false);
  });

  it("returns false for any negative value", () => {
    expect(isValidPRedWin(-0.001)).toBe(false);
    expect(isValidPRedWin(-1)).toBe(false);
  });

  it("returns false for any value above 1", () => {
    expect(isValidPRedWin(1.001)).toBe(false);
    expect(isValidPRedWin(2)).toBe(false);
  });
});

describe("assertValidPRedWin", () => {
  it("returns without throwing for every value the predicate accepts", () => {
    expect(() => assertValidPRedWin(0, "test context")).not.toThrow();
    expect(() => assertValidPRedWin(0.5, "test context")).not.toThrow();
    expect(() => assertValidPRedWin(1, "test context")).not.toThrow();
  });

  it("throws for every value the predicate rejects, naming the value and the context", () => {
    for (const bad of [NaN, Infinity, -Infinity, -1, 1.5]) {
      expect(() => assertValidPRedWin(bad, "opr.predict 2024test_qm1")).toThrow(
        /2024test_qm1/
      );
    }
    try {
      assertValidPRedWin(NaN, "opr.predict 2024test_qm1");
      throw new Error("expected assertValidPRedWin to throw");
    } catch (err) {
      expect(String((err as Error).message)).toContain("NaN");
      expect(String((err as Error).message)).toContain("opr.predict 2024test_qm1");
    }
  });
});

describe("opr.predict end-to-end — regression proof for 01-REVIEW WR-05", () => {
  it("throws instead of returning a Prediction with a non-finite pRedWin when a team's rating is non-finite", () => {
    // A directly-constructed OprState with one participating team's rating
    // set to NaN — simulates a corrupted rating reaching predict() without
    // needing a full update() sequence to produce it.
    const state: OprState = {
      observations: [],
      ratings: new Map([["frc100", NaN]]),
      incrementalSolve: opr.initState([]).incrementalSolve,
    };
    const match: UpcomingMatch = {
      matchKey: "2024test_qm1",
      eventKey: "2024test",
      compLevel: "qm",
      setNumber: 1,
      matchNumber: 1,
      redTeams: ["frc100", "frc200", "frc300"],
      blueTeams: ["frc400", "frc500", "frc600"],
      redSurrogates: [],
      blueSurrogates: [],
      eventType: 0,
    };

    expect(() => opr.predict(state, match)).toThrow(/2024test_qm1/);
  });
});
