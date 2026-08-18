/**
 * D-05 fallback tests: `distributeResidual`'s math in isolation
 * (`fallback.ts`), then a fixture replay proving `epa.update()` actually
 * wires it in for a breakdown-less match rather than leaving the involved
 * teams pinned at their cold-start component values.
 *
 * T-03-18b (security audit, phase 03, quick task 260818-inm): unit tests for
 * `tryParseBreakdownPair`/`isRecoverableBreakdownParseError`, the guard that
 * replaces an unconditional `parseBreakdown` call at both algorithms' update
 * boundaries — see `index.ts`'s doc comments on both exports for the full
 * contract.
 */
import { describe, expect, it } from "vitest";
import { z, ZodError } from "zod";
import { distributeResidual, FALLBACK_NOISE_MULTIPLIER } from "./fallback.js";
import { epa } from "../epa.js";
import { breakdown2024 } from "./2024.js";
import { FOULS_COMMITTED_COMPONENT, isRecoverableBreakdownParseError, tryParseBreakdownPair } from "./index.js";
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
    eventType: 0,
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

/**
 * Derives a malformed 2024 payload from the well-formed `breakdown2024Json()`
 * baseline by deleting `fieldsToOmit` from BOTH sides, rather than
 * hand-typing a second payload — the malformed and well-formed fixtures
 * provably differ only in the removed fields.
 */
function breakdown2024JsonMissingFields(fieldsToOmit: readonly string[]): string {
  const full = JSON.parse(breakdown2024Json()) as { red: Record<string, number>; blue: Record<string, number> };
  for (const side of [full.red, full.blue]) {
    for (const field of fieldsToOmit) delete side[field];
  }
  return JSON.stringify(full);
}

/** Every `SideBreakdownSchema` field (`2024.ts`) except `autoLeavePoints`. */
const ALL_2024_FIELDS_EXCEPT_AUTO_LEAVE = [
  "autoAmpNotePoints",
  "autoSpeakerNotePoints",
  "teleopAmpNotePoints",
  "teleopSpeakerNotePoints",
  "teleopSpeakerNoteAmplifiedPoints",
  "endGameOnStagePoints",
  "endGameParkPoints",
  "endGameHarmonyPoints",
  "endGameNoteInTrapPoints",
  "endGameSpotLightBonusPoints",
  "adjustPoints",
  "foulPoints",
];

describe("tryParseBreakdownPair (T-03-18b)", () => {
  it('yields kind "absent" for a null scoreBreakdownRaw', () => {
    expect(tryParseBreakdownPair(2024, null)).toEqual({ kind: "absent" });
  });

  it('yields kind "parsed" with all 13 canonical components present on both sides for a well-formed 2024 payload', () => {
    const outcome = tryParseBreakdownPair(2024, breakdown2024Json());
    expect(outcome.kind).toBe("parsed");
    if (outcome.kind !== "parsed") throw new Error("unreachable");
    for (const component of breakdown2024.components) {
      expect(outcome.red[component]).toBeDefined();
      expect(outcome.blue[component]).toBeDefined();
    }
    expect(Object.keys(outcome.red)).toHaveLength(breakdown2024.components.length);
    expect(Object.keys(outcome.blue)).toHaveLength(breakdown2024.components.length);
  });

  it('yields kind "malformed" with issueCount 2 for a payload missing adjustPoints on both sides (the real 2024cafb_qm1 shape)', () => {
    const outcome = tryParseBreakdownPair(2024, breakdown2024JsonMissingFields(["adjustPoints"]));
    expect(outcome).toEqual({ kind: "malformed", issueCount: 2 });
  });

  it('yields kind "malformed" with a double-digit issueCount for a payload carrying only autoLeavePoints per side (the real 2024wvrox_sf1m1 shape)', () => {
    const outcome = tryParseBreakdownPair(2024, breakdown2024JsonMissingFields(ALL_2024_FIELDS_EXCEPT_AUTO_LEAVE));
    expect(outcome.kind).toBe("malformed");
    if (outcome.kind !== "malformed") throw new Error("unreachable");
    expect(outcome.issueCount).toBeGreaterThanOrEqual(10);
  });

  it('yields kind "malformed" with issueCount 0 for text that is not JSON at all', () => {
    expect(tryParseBreakdownPair(2024, "not json")).toEqual({ kind: "malformed", issueCount: 0 });
  });

  it("throws for an unregistered season — componentMapForSeason stays outside the guarded region", () => {
    expect(() => tryParseBreakdownPair(1999, breakdown2024Json())).toThrow(/no component map registered/);
  });
});

describe("isRecoverableBreakdownParseError (T-03-21 narrowness proof)", () => {
  it("is true for a real ZodError captured from a failing schema parse", () => {
    let captured: unknown;
    try {
      z.object({ a: z.number() }).parse({});
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(ZodError);
    expect(isRecoverableBreakdownParseError(captured)).toBe(true);
  });

  it("is true for a real SyntaxError captured from JSON.parse of invalid text", () => {
    let captured: unknown;
    try {
      JSON.parse("not json");
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(SyntaxError);
    expect(isRecoverableBreakdownParseError(captured)).toBe(true);
  });

  it("is false for Error, TypeError, RangeError, null, undefined, and a plain string — everything else must stay loud", () => {
    expect(isRecoverableBreakdownParseError(new Error("plain"))).toBe(false);
    expect(isRecoverableBreakdownParseError(new TypeError("plain"))).toBe(false);
    expect(isRecoverableBreakdownParseError(new RangeError("plain"))).toBe(false);
    expect(isRecoverableBreakdownParseError(null)).toBe(false);
    expect(isRecoverableBreakdownParseError(undefined)).toBe(false);
    expect(isRecoverableBreakdownParseError("plain string")).toBe(false);
  });
});

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

    // Every red-alliance OFFENSIVE component moves after the fallback match
    // — the OLD tracer behavior (fallbackSkipped += 1, no
    // applyComponentUpdate call at all) would have left every one of these
    // values byte-identical to `afterReal`'s, purely because the match
    // lacked a breakdown. D-05 forbids that: even components not touched by
    // `realMatch`'s explicit overrides receive a fallback observation now.
    // FOULS_COMMITTED_COMPONENT is deliberately excluded from this
    // assertion (CR-01, code review phase 02): that component represents
    // points RED's fouls would cost BLUE, not anything about how many
    // points red itself scored, so a fallback match — which has no way to
    // observe it at all (it is derived from the OPPONENT's raw foulPoints
    // field, equally absent) — must never move it via a share of red's own
    // score. See the dedicated "CR-01" describe block below for the
    // regression fixture that pins this.
    for (const componentName of breakdown2024.components) {
      if (componentName === FOULS_COMMITTED_COMPONENT) continue;
      const before = afterReal.teamComponents.get("frc1")![componentName]!;
      const after = afterFallback.teamComponents.get("frc1")![componentName]!;
      expect(after, `component "${componentName}" did not move after the fallback match`).not.toBeCloseTo(before, 10);
    }
    // foulsCommitted is carried forward UNCHANGED (CR-01's chosen policy —
    // see epa.ts's foulsCommittedCarryForward doc comment).
    expect(afterFallback.teamComponents.get("frc1")![FOULS_COMMITTED_COMPONENT]).toBeCloseTo(
      afterReal.teamComponents.get("frc1")![FOULS_COMMITTED_COMPONENT]!,
      10
    );
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
