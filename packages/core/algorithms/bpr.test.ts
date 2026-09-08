/**
 * Regression cover for BPR's link boundary at a dead-even matchup.
 *
 * `packages/core/scoring/brier.ts` identifies a no-call by EXACT equality with
 * 0.5, and D-Q3 counts a no-call against a decided match as a MISS. BPR reaches
 * that boundary for real -- 275 matches over 2016-2026, all at cold start when
 * both alliances are entirely unseen -- but the Abramowitz-Stegun erf
 * approximation returns +1.0e-9 at the origin, so `normCdf(0)` came out as
 * 0.5000000005: a hair above the line, scored as a confident red pick, and
 * credited on the 134 of those the red alliance happened to win.
 *
 * That was a real scoring advantage over OPR/EPA/VPR, whose logistic links land
 * on 0.5 exactly and pay the D-Q3 penalty. These tests pin the exactness,
 * because the boundary -- not the approximation's accuracy -- is what both the
 * reporting layer and the accuracy rule key off.
 */
import { describe, expect, it } from "vitest";
import { bpr, type BprState, type BprTeamState } from "./bpr.js";
import { accuracyCall, scoreSet } from "../scoring/brier.js";
import type { MatchResult, UpcomingMatch } from "./types.js";

const SIX = ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"];

function upcoming(overrides: Partial<UpcomingMatch> = {}): UpcomingMatch {
  return {
    matchKey: "2016test_qm1",
    eventKey: "2016test",
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

function result(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    ...upcoming(),
    winner: "red",
    redScore: 90,
    blueScore: 40,
    redRpEarned: null,
    blueRpEarned: null,
    redDqs: [],
    blueDqs: [],
    hasScoreBreakdown: false,
    scoreBreakdownRaw: null,
    ...overrides,
  };
}

describe("bpr dead-even predictions", () => {
  it("returns exactly 0.5 when both alliances are identically unseen", () => {
    const prediction = bpr.predict(bpr.initState(SIX), upcoming());

    // Exact equality is the point of this assertion; toBeCloseTo would pass
    // against the 0.5000000005 this test exists to prevent.
    expect(prediction.pRedWin).toBe(0.5);
  });

  it("holds at 0.5 for an uneven alliance size, since rank weights renormalize to 3", () => {
    const prediction = bpr.predict(bpr.initState(SIX), upcoming({ redTeams: ["frc1", "frc2"] }));
    expect(prediction.pRedWin).toBe(0.5);
  });

  it("is counted as a no-call, and as a miss whichever side won", () => {
    const pRedWin = bpr.predict(bpr.initState(SIX), upcoming()).pRedWin;

    const scored = scoreSet([
      { pRedWin, actualWinner: "red" },
      { pRedWin, actualWinner: "blue" },
    ]);

    expect(scored.noCallCount).toBe(2);
    // D-Q3: an abstention against a decided match is never silently credited to
    // whichever side the float happens to round toward. Both are misses.
    expect(scored.winnerAccuracy).toBe(0);
    expect(accuracyCall({ pRedWin, actualWinner: "red" })).toBe(false);
    expect(accuracyCall({ pRedWin, actualWinner: "blue" })).toBe(false);
  });

  it("leaves a genuinely lopsided prediction on the approximation path", () => {
    const seeded = bpr.update(bpr.initState(SIX), result());
    const prediction = bpr.predict(seeded, upcoming({ matchKey: "2016test_qm2" }));

    expect(prediction.pRedWin).not.toBe(0.5);
    expect(prediction.pRedWin).toBeGreaterThan(0.5);
  });
});

/**
 * A fully zeroed 2024 score_breakdown, overridable per side — the same shape
 * `epa.test.ts` builds, duplicated rather than shared because both files want
 * to stay readable standalone and neither owns the other's fixture.
 */
function breakdown2024Json(red: Record<string, number> = {}, blue: Record<string, number> = {}): string {
  const zeroed = {
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
  return JSON.stringify({ red: { ...zeroed, ...red }, blue: { ...zeroed, ...blue } });
}

// `carrySeason` is optional on AlgorithmModule; BPR implements it, and these
// tests are meaningless without it, so fail loudly here rather than at a `!`.
const carrySeason: NonNullable<typeof bpr.carrySeason> = (() => {
  const fn = bpr.carrySeason;
  if (fn === undefined) throw new Error("bpr must implement carrySeason");
  return fn;
})();

function season2024(teams: readonly string[]): BprState {
  return carrySeason(bpr.initState([...teams]), {
    fromSeason: 2024,
    toSeason: 2024,
    isColdStart: true,
  });
}

/** Replaces every phase rating with nonsense, leaving the predictor half untouched. */
function scramblePhases(state: BprState): BprState {
  const junk = (i: number): BprTeamState => ({ muL: 100 * i, pL: 7 * i + 1, muS: -50 * i, pS: 3 * i + 1 });
  const scrambled = { auto: new Map(), teleop: new Map(), endgame: new Map() } as Record<
    "auto" | "teleop" | "endgame",
    Map<string, BprTeamState>
  >;
  let i = 1;
  for (const phase of ["auto", "teleop", "endgame"] as const) {
    for (const key of state.teams.keys()) scrambled[phase].set(key, junk(i++));
  }
  return {
    ...state,
    phaseTeams: scrambled,
    phaseScale: { auto: 999, teleop: -42, endgame: 1e6 },
    phaseScaleCount: { auto: 50, teleop: 50, endgame: 50 },
  };
}

describe("bpr phase components are display-only", () => {
  const played = (n: number, red: Record<string, number>, blue: Record<string, number>): MatchResult =>
    result({
      matchKey: `2024test_qm${n}`,
      redScore: Object.values(red).reduce((a, b) => a + b, 0),
      blueScore: Object.values(blue).reduce((a, b) => a + b, 0),
      winner: "red",
      hasScoreBreakdown: true,
      scoreBreakdownRaw: breakdown2024Json(red, blue),
    });

  const drive = (): BprState => {
    let state = season2024(SIX);
    for (let n = 1; n <= 6; n += 1) {
      state = bpr.update(
        state,
        played(
          n,
          { autoSpeakerNotePoints: 10 + n, teleopSpeakerNotePoints: 40 + n, endGameOnStagePoints: 9 },
          { autoSpeakerNotePoints: 5, teleopSpeakerNotePoints: 30, endGameParkPoints: 3 },
        ),
      );
    }
    return state;
  };

  it("predicts identically when every phase rating is replaced with nonsense", () => {
    const state = drive();
    const match = upcoming({ matchKey: "2024test_qm99" });

    expect(bpr.predict(scramblePhases(state), match)).toEqual(bpr.predict(state, match));
  });

  it("keeps the predictor half of update identical under scrambled phase state", () => {
    const state = drive();
    const next = bpr.update(state, played(7, { teleopSpeakerNotePoints: 55 }, { teleopSpeakerNotePoints: 20 }));
    const nextScrambled = bpr.update(scramblePhases(state), played(7, { teleopSpeakerNotePoints: 55 }, { teleopSpeakerNotePoints: 20 }));

    expect(nextScrambled.logTau).toBe(next.logTau);
    expect(nextScrambled.scale).toBe(next.scale);
    expect(nextScrambled.scaleCount).toBe(next.scaleCount);
    expect([...nextScrambled.teams.entries()]).toEqual([...next.teams.entries()]);
  });

  it("emits no phase metric at all before any breakdown has been folded", () => {
    // initState, not season2024: a cold-start carrySeason empties the team
    // map, and this test needs a team that exists but has folded no breakdown.
    const metrics = bpr.teamMetrics(bpr.initState(SIX), ["frc1"])["frc1"];

    // Absent, never 0 — "not measured" and "scores nothing in auto" are
    // different claims and must not be published as the same number.
    expect(metrics).toHaveProperty("total");
    expect(metrics).not.toHaveProperty("phaseAuto");
    expect(metrics).not.toHaveProperty("phaseTeleop");
    expect(metrics).not.toHaveProperty("phaseEndgame");
  });

  it("emits all three phases once real breakdowns have been folded", () => {
    const metrics = bpr.teamMetrics(drive(), ["frc1"])["frc1"];

    expect(metrics).toHaveProperty("phaseAuto");
    expect(metrics).toHaveProperty("phaseTeleop");
    expect(metrics).toHaveProperty("phaseEndgame");
    for (const key of ["phaseAuto", "phaseTeleop", "phaseEndgame"] as const) {
      expect(Number.isFinite(metrics?.[key]?.value)).toBe(true);
      expect(metrics?.[key]?.spread).toBeGreaterThan(0);
    }
  });

  it("leaves phase state untouched when a match carries no breakdown", () => {
    const state = drive();
    const next = bpr.update(state, result({ matchKey: "2024test_qm8", scoreBreakdownRaw: null }));

    expect(next.phaseScaleCount).toEqual(state.phaseScaleCount);
    expect([...next.phaseTeams.teleop.entries()]).toEqual([...state.phaseTeams.teleop.entries()]);
  });

  it("leaves phase state untouched when a breakdown fails its season schema", () => {
    const state = drive();
    const next = bpr.update(
      state,
      result({ matchKey: "2024test_qm9", scoreBreakdownRaw: '{"red":{"autoLeavePoints":1},"blue":{}}' }),
    );

    expect(next.phaseScaleCount).toEqual(state.phaseScaleCount);
    expect([...next.phaseTeams.auto.entries()]).toEqual([...state.phaseTeams.auto.entries()]);
  });
});

