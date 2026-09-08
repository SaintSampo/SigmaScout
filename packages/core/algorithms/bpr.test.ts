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
import { bpr } from "./bpr.js";
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
