/**
 * D-05 fallback tests: `distributeResidual`'s math in isolation
 * (`fallback.ts`), then a fixture replay proving `epa.update()` actually
 * wires it in for a breakdown-less match rather than leaving the involved
 * teams pinned at their cold-start component values.
 */
import { describe, expect, it } from "vitest";
import { distributeResidual, FALLBACK_NOISE_MULTIPLIER } from "./fallback.js";
import { epa } from "../epa.js";
import { breakdown2024 } from "./2024.js";
import type { MatchResult, UpcomingMatch } from "../types.js";

describe("distributeResidual (D-05)", () => {
  it("splits the observed total across components in proportion to their predicted shares", () => {
    const result = distributeResidual(100, { a: 30, b: 10, c: 0 }, ["a", "b", "c"]);
    // Predicted total is 40; a gets 30/40 of 100, b gets 10/40 of 100, c gets 0.
    expect(result["a"]).toBeCloseTo(75, 10);
    expect(result["b"]).toBeCloseTo(25, 10);
    expect(result["c"]).toBe(0);
  });

  it("output sums to the observed total to within 1e-9", () => {
    const result = distributeResidual(137.5, { a: 7, b: 3, c: 21 }, ["a", "b", "c"]);
    const sum = Object.values(result).reduce((s, v) => s + v, 0);
    expect(Math.abs(sum - 137.5)).toBeLessThan(1e-9);
  });

  it("distributes uniformly, with no NaN, when every predicted component is 0 (genuine cold start)", () => {
    const result = distributeResidual(90, { a: 0, b: 0, c: 0 }, ["a", "b", "c"]);
    expect(result["a"]).toBeCloseTo(30, 10);
    expect(result["b"]).toBeCloseTo(30, 10);
    expect(result["c"]).toBeCloseTo(30, 10);
    for (const v of Object.values(result)) expect(Number.isNaN(v)).toBe(false);
  });

  it("distributes uniformly when predictedComponents has no entries at all for any named component", () => {
    const result = distributeResidual(60, {}, ["a", "b", "c"]);
    expect(result["a"]).toBeCloseTo(20, 10);
    expect(result["b"]).toBeCloseTo(20, 10);
    expect(result["c"]).toBeCloseTo(20, 10);
  });

  it("a component with predicted share 0 while others are positive is not resurrected — it stays 0", () => {
    const result = distributeResidual(50, { a: 10, b: 0, c: 10 }, ["a", "b", "c"]);
    expect(result["b"]).toBe(0);
    expect(result["a"]).toBeCloseTo(25, 10);
    expect(result["c"]).toBeCloseTo(25, 10);
  });

  it("returns an empty object for an empty componentNames list rather than throwing", () => {
    const result = distributeResidual(50, {}, []);
    expect(Object.keys(result)).toHaveLength(0);
  });
});

describe("FALLBACK_NOISE_MULTIPLIER", () => {
  it("is a positive, documented constant greater than 1 (a fallback observation carries MORE noise than a real one)", () => {
    expect(FALLBACK_NOISE_MULTIPLIER).toBeGreaterThan(1);
  });
});

function upcoming(overrides: Partial<UpcomingMatch> = {}): UpcomingMatch {
  return {
    matchKey: "2024test_qm1",
    eventKey: "2024test",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 1,
    redTeams: ["frc1", "frc2", "frc3"],
    blueTeams: ["frc4", "frc5", "frc6"],
    redSurrogates: [],
    blueSurrogates: [],
    ...overrides,
  };
}

function breakdown2024Json(redOverrides: Record<string, number> = {}, blueOverrides: Record<string, number> = {}): string {
  const zeroedSide = {
    autoLeavePoints: 0,
    autoAmpNotePoints: 0,
    autoSpeakerNotePoints: 0,
    teleopAmpNotePoints: 0,
    teleopSpeakerNotePoints: 0,
    teleopSpeakerNoteAmplifiedPoints: 0,
    endGameOnStagePoints: 0,
    endGameParkPoints: 0,
    endGameHarmonyPoints: 0,
    endGameNoteInTrapPoints: 0,
    endGameSpotLightBonusPoints: 0,
    adjustPoints: 0,
    foulPoints: 0,
  };
  return JSON.stringify({
    red: { ...zeroedSide, ...redOverrides },
    blue: { ...zeroedSide, ...blueOverrides },
  });
}

function matchResult(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    ...upcoming(),
    winner: "red",
    redScore: 100,
    blueScore: 80,
    redRpEarned: 2,
    blueRpEarned: 0,
    hasScoreBreakdown: true,
    scoreBreakdownRaw: breakdown2024Json(),
    ...overrides,
  };
}

describe("epa.update — D-05 fallback fixture replay", () => {
  it("a breakdown-less match still moves the involved teams' component means off their cold-start value", () => {
    const initial = epa.initState(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]);

    // First, a real breakdown-bearing match establishes real (non-cold-start)
    // predicted shares for red's roster, so the fallback below has a
    // non-uniform basis to distribute against.
    const realMatch = matchResult({
      scoreBreakdownRaw: breakdown2024Json({ autoLeavePoints: 12, teleopSpeakerNotePoints: 30 }, { autoLeavePoints: 6 }),
    });
    const afterReal = epa.update(initial, realMatch);

    // Now a breakdown-less match for the SAME teams (has_score_breakdown = false).
    const fallbackMatch = matchResult({
      matchKey: "2024test_qm2",
      matchNumber: 2,
      hasScoreBreakdown: false,
      scoreBreakdownRaw: null,
      redScore: 140,
      blueScore: 90,
    });
    const afterFallback = epa.update(afterReal, fallbackMatch);

    // Every red-alliance component moves after the fallback match — the OLD
    // tracer behavior (fallbackSkipped += 1, no applyComponentUpdate call at
    // all) would have left every one of these values byte-identical to
    // `afterReal`'s, purely because the match lacked a breakdown. D-05
    // forbids that: even components not touched by `realMatch`'s explicit
    // overrides receive a fallback observation now.
    for (const componentName of breakdown2024.components) {
      const before = afterReal.teamComponents.get("frc1")![componentName]!;
      const after = afterFallback.teamComponents.get("frc1")![componentName]!;
      expect(after, `component "${componentName}" did not move after the fallback match`).not.toBeCloseTo(before, 10);
    }
    expect(afterFallback.teamMatchCounts.get("frc1")).toBe(2);
  });

  it("a breakdown-less match on a fully cold-start alliance still populates every component (not left empty/undefined)", () => {
    const initial = epa.initState(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]);
    expect(initial.teamComponents.get("frc1")).toEqual({});

    const fallbackMatch = matchResult({ hasScoreBreakdown: false, scoreBreakdownRaw: null, redScore: 140, blueScore: 90 });
    const afterFallback = epa.update(initial, fallbackMatch);

    const frc1Components = afterFallback.teamComponents.get("frc1")!;
    for (const componentName of breakdown2024.components) {
      expect(frc1Components[componentName]).toBeDefined();
      expect(Number.isFinite(frc1Components[componentName])).toBe(true);
    }
  });

  it("the fallbackSkipped counter stays 0 after replaying a fixture containing a breakdown-less match", () => {
    const initial = epa.initState(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]);
    const fallbackMatch = matchResult({
      hasScoreBreakdown: false,
      scoreBreakdownRaw: null,
    });
    const next = epa.update(initial, fallbackMatch);
    expect(next.fallbackSkipped).toBe(0);
  });

  it("replaying several breakdown-less matches in a row never increments fallbackSkipped and never produces NaN component means", () => {
    let state = epa.initState(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]);
    for (let i = 0; i < 5; i++) {
      const match = matchResult({
        matchKey: `2024test_qm${i + 1}`,
        matchNumber: i + 1,
        hasScoreBreakdown: false,
        scoreBreakdownRaw: null,
        redScore: 100 + i,
        blueScore: 80 + i,
      });
      state = epa.update(state, match);
    }
    expect(state.fallbackSkipped).toBe(0);
    for (const [, components] of state.teamComponents) {
      for (const value of Object.values(components)) {
        expect(Number.isNaN(value)).toBe(false);
      }
    }
  });
});
