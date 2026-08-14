/**
 * Synthetic-fixture tests for the EPA reimplementation (ALGO-02, D-13,
 * D-08), following `opr.test.ts`'s convention: build a small deterministic
 * fixture, drive `epa` through it, and assert against hand-computed values.
 */
import { describe, expect, it } from "vitest";
import { epa, epaPercentFunc, EPA_K, EPA_FALLBACK_SCORE_SD, type EpaState } from "./epa.js";
import { opr } from "./opr.js";
import { breakdown2024 } from "./breakdown/2024.js";
import { FOULS_COMMITTED_COMPONENT } from "./breakdown/index.js";
import { emptyExpandingStats, foldObservation, standardDeviation } from "../scoring/expandingStats.js";
import type { EpaCarryoverPriorRatings } from "./carryover.js";
import type { MatchResult, UpcomingMatch } from "./types.js";

/** Empty `EpaState.priorSeasonRatings` — the value every intra-season fixture in this file carries, since none of these tests exercise a season boundary. */
function emptyPriorSeasonRatings(): EpaCarryoverPriorRatings {
  return { lastSeason: new Map(), yearBefore: new Map() };
}

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

/** A full, schema-valid 2024 score_breakdown with every field zeroed except the ones explicitly overridden per side. */
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

describe("epaPercentFunc — decaying, clamped learning rate", () => {
  it("is 1/3 at match count 0", () => {
    expect(epaPercentFunc(0)).toBeCloseTo(1 / 3, 10);
  });

  it("is still 1/3 at match count 6 (the clamp's inflection point)", () => {
    expect(epaPercentFunc(6)).toBeCloseTo(1 / 3, 10);
  });

  it("decays to 0.2 at match count 12", () => {
    expect(epaPercentFunc(12)).toBeCloseTo(0.2, 10);
  });

  it("stays clamped at 0.2 at match count 20 (past the decay floor)", () => {
    expect(epaPercentFunc(20)).toBeCloseTo(0.2, 10);
  });
});

describe("epa.update — two-stage EWMA reproduces a hand-computed value", () => {
  it("starting mean 10, observation 40, percent 1/3 (match count 0), weight 1 (D-08: always full weight) gives 20", () => {
    // Only frc1 is rating-eligible on red (its two teammates are surrogates),
    // so the alliance's whole autoLeavePoints observation attributes to it
    // alone (observedShare === allianceValue, no /3 split to reason about).
    // Blue's whole roster is surrogates too, so blue attribution is a
    // documented no-op and cannot perturb frc1's component.
    const state: EpaState = {
      season: 2024,
      teamComponents: new Map([["frc1", { autoLeave: 10 }]]),
      teamMatchCounts: new Map([["frc1", 0]]),
      allianceScoreStats: emptyExpandingStats(),
      fallbackSkipped: 0,
      priorSeasonRatings: emptyPriorSeasonRatings(),
    };

    const result = matchResult({
      redTeams: ["frc1", "surr1", "surr2"],
      redSurrogates: ["surr1", "surr2"],
      blueTeams: ["s1", "s2", "s3"],
      blueSurrogates: ["s1", "s2", "s3"],
      scoreBreakdownRaw: breakdown2024Json({ autoLeavePoints: 40 }),
    });

    const next = epa.update(state, result);
    expect(next.teamComponents.get("frc1")!["autoLeave"]).toBeCloseTo(20, 10);
    // D-08: the match counter increments on every match, including this one.
    expect(next.teamMatchCounts.get("frc1")).toBe(1);
  });
});

describe("epa.update — D-08 elimination divergence", () => {
  it("an elimination match moves a team's component mean by the same amount as a qualification match with the same observation, and increments the match counter identically", () => {
    const baseState: EpaState = {
      season: 2024,
      teamComponents: new Map([["frc1", { autoLeave: 10 }]]),
      teamMatchCounts: new Map([["frc1", 0]]),
      allianceScoreStats: emptyExpandingStats(),
      fallbackSkipped: 0,
      priorSeasonRatings: emptyPriorSeasonRatings(),
    };

    const qualResult = matchResult({
      compLevel: "qm",
      redTeams: ["frc1", "surr1", "surr2"],
      redSurrogates: ["surr1", "surr2"],
      blueTeams: ["s1", "s2", "s3"],
      blueSurrogates: ["s1", "s2", "s3"],
      scoreBreakdownRaw: breakdown2024Json({ autoLeavePoints: 40 }),
    });
    const elimResult = matchResult({
      matchKey: "2024test_sf1",
      compLevel: "sf",
      redTeams: ["frc1", "surr1", "surr2"],
      redSurrogates: ["surr1", "surr2"],
      blueTeams: ["s1", "s2", "s3"],
      blueSurrogates: ["s1", "s2", "s3"],
      scoreBreakdownRaw: breakdown2024Json({ autoLeavePoints: 40 }),
    });

    const afterQual = epa.update(baseState, qualResult);
    const afterElim = epa.update(baseState, elimResult);

    expect(afterElim.teamComponents.get("frc1")!["autoLeave"]).toBeCloseTo(
      afterQual.teamComponents.get("frc1")!["autoLeave"]!,
      10
    );
    expect(afterElim.teamMatchCounts.get("frc1")).toBe(afterQual.teamMatchCounts.get("frc1"));
    expect(afterElim.teamMatchCounts.get("frc1")).toBe(1);
  });
});

describe("epa.predict / opr.predict — exactly-tied predicted margin", () => {
  it("both return pRedWin === 0.5 and winner === 'red' when the predicted margin is exactly zero", () => {
    const epaState = epa.initState(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]);
    const epaPrediction = epa.predict(epaState, upcoming());
    expect(epaPrediction.redScore).toBe(0);
    expect(epaPrediction.blueScore).toBe(0);
    expect(epaPrediction.pRedWin).toBe(0.5);
    expect(epaPrediction.winner).toBe("red");

    const oprState = opr.initState(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]);
    const oprPrediction = opr.predict(oprState, upcoming());
    expect(oprPrediction.redScore).toBe(0);
    expect(oprPrediction.blueScore).toBe(0);
    expect(oprPrediction.pRedWin).toBe(0.5);
    expect(oprPrediction.winner).toBe("red");
  });
});

describe("epa.predict — win-probability scale derivation (Pitfall EPA-1)", () => {
  it("derives its scale from standardDeviation(allianceScoreStats, fallback) / (-EPA_K * Math.LN10) — a known margin maps to a known probability", () => {
    let stats = emptyExpandingStats();
    // Textbook Welford fixture: population sd = 2.
    for (const x of [2, 4, 4, 4, 5, 5, 7, 9]) {
      stats = foldObservation(stats, x);
    }
    const sd = standardDeviation(stats, EPA_FALLBACK_SCORE_SD);
    expect(sd).toBeCloseTo(2, 10);

    const state: EpaState = {
      season: 2024,
      teamComponents: new Map([
        ["R1", { comp: 30 }],
        ["B1", { comp: 10 }],
      ]),
      teamMatchCounts: new Map([
        ["R1", 0],
        ["B1", 0],
      ]),
      allianceScoreStats: stats,
      fallbackSkipped: 0,
      priorSeasonRatings: emptyPriorSeasonRatings(),
    };

    const prediction = epa.predict(
      state,
      upcoming({ redTeams: ["R1"], blueTeams: ["B1"], redSurrogates: [], blueSurrogates: [] })
    );
    expect(prediction.redScore).toBe(30);
    expect(prediction.blueScore).toBe(10);

    const margin = 20;
    const scale = sd / (-EPA_K * Math.LN10);
    const expectedPRedWin = 1 / (1 + Math.exp(-margin / scale));
    expect(prediction.pRedWin).toBeCloseTo(expectedPRedWin, 10);
  });
});

describe("epa.predict — D-04 foulsCommitted attributed to the opposing alliance", () => {
  it("an alliance's own learned foulsCommitted component adds to the OPPONENT's predicted score, not its own", () => {
    const state: EpaState = {
      season: 2024,
      teamComponents: new Map<string, Record<string, number>>([
        ["R1", { comp: 30, [FOULS_COMMITTED_COMPONENT]: 5 }],
        ["B1", { comp: 10 }],
      ]),
      teamMatchCounts: new Map([
        ["R1", 0],
        ["B1", 0],
      ]),
      allianceScoreStats: emptyExpandingStats(),
      fallbackSkipped: 0,
      priorSeasonRatings: emptyPriorSeasonRatings(),
    };

    const prediction = epa.predict(
      state,
      upcoming({ redTeams: ["R1"], blueTeams: ["B1"], redSurrogates: [], blueSurrogates: [] })
    );

    // Red's own foulsCommitted (5) must NOT inflate red's own predicted
    // score — pre-fix, the old summation put it here instead.
    expect(prediction.redScore).toBe(30);
    // It must instead land in blue's predicted score (D-04: the receiving
    // alliance's predicted score, not the fouling alliance's own).
    expect(prediction.blueScore).toBe(15);
    // The returned component records themselves are unchanged — only the
    // scalar score summation changes (matches sigma1's D-04 handling).
    expect(prediction.redComponents![FOULS_COMMITTED_COMPONENT]).toEqual({ mean: 5 });
    expect(prediction.blueComponents![FOULS_COMMITTED_COMPONENT]).toBeUndefined();
  });
});

describe("epa.update — event-boundary invariance (ALGO-02 checkpoint gap, D-13)", () => {
  it("produces identical resulting state for a team's second match whether it shares the first match's eventKey or falls in a different event of the same season", () => {
    // EPA has no event-boundary-sensitive code at all (unlike Sigma1's
    // 02-04 process-noise bump on an event change) — this is deliberate
    // fidelity to Statbotics (D-13), but nothing proved it until now. This
    // test pins the invariant: `update()`'s only use of `eventKey` is
    // deriving `season` on a team's very first-ever match (`epa.ts`'s
    // `deriveSeasonFromEventKey`); every later call ignores it entirely.
    // If EPA ever gained event-boundary-sensitive behavior (a streak
    // reset, a within-season event-change decay bump, anything keyed off
    // "did this match's eventKey change"), this test would start failing
    // the moment `secondMatchSameEvent`/`secondMatchDifferentEvent`
    // diverged from each other.
    const initial: EpaState = {
      season: null,
      teamComponents: new Map([["frc1", {}]]),
      teamMatchCounts: new Map([["frc1", 0]]),
      allianceScoreStats: emptyExpandingStats(),
      fallbackSkipped: 0,
      priorSeasonRatings: emptyPriorSeasonRatings(),
    };

    const firstMatch = matchResult({
      matchKey: "2024test_qm1",
      eventKey: "2024test",
      redTeams: ["frc1", "surr1", "surr2"],
      redSurrogates: ["surr1", "surr2"],
      blueTeams: ["s1", "s2", "s3"],
      blueSurrogates: ["s1", "s2", "s3"],
      scoreBreakdownRaw: breakdown2024Json({ autoLeavePoints: 30 }),
    });
    const afterFirst = epa.update(initial, firstMatch);

    // Same match count (1 -> 2) and identical observation on both branches
    // — the ONLY thing that differs is whether the second match's
    // `eventKey` matches the first match's.
    const secondMatchSameEvent = matchResult({
      matchKey: "2024test_qm2",
      eventKey: "2024test",
      redTeams: ["frc1", "surr1", "surr2"],
      redSurrogates: ["surr1", "surr2"],
      blueTeams: ["s1", "s2", "s3"],
      blueSurrogates: ["s1", "s2", "s3"],
      scoreBreakdownRaw: breakdown2024Json({ autoLeavePoints: 45 }),
    });
    const secondMatchDifferentEvent = matchResult({
      matchKey: "2024other_qm2",
      eventKey: "2024other",
      redTeams: ["frc1", "surr1", "surr2"],
      redSurrogates: ["surr1", "surr2"],
      blueTeams: ["s1", "s2", "s3"],
      blueSurrogates: ["s1", "s2", "s3"],
      scoreBreakdownRaw: breakdown2024Json({ autoLeavePoints: 45 }),
    });

    const afterSameEvent = epa.update(afterFirst, secondMatchSameEvent);
    const afterDifferentEvent = epa.update(afterFirst, secondMatchDifferentEvent);

    expect(afterSameEvent.teamComponents.get("frc1")).toEqual(afterDifferentEvent.teamComponents.get("frc1"));
    expect(afterSameEvent.teamMatchCounts.get("frc1")).toBe(afterDifferentEvent.teamMatchCounts.get("frc1"));
    expect(afterSameEvent.allianceScoreStats).toEqual(afterDifferentEvent.allianceScoreStats);
    expect(afterSameEvent.season).toBe(afterDifferentEvent.season);
  });
});

describe("epa — contract shape", () => {
  it("exports an AlgorithmModule with id 'epa' and every required member", () => {
    expect(epa.id).toBe("epa");
    expect(typeof epa.version).toBe("string");
    expect(typeof epa.initState).toBe("function");
    expect(typeof epa.predict).toBe("function");
    expect(typeof epa.update).toBe("function");
    expect(typeof epa.teamMetrics).toBe("function");
  });

  it("teamMetrics reports one entry per learned component plus TOTAL_METRIC_KEY, with no spread", () => {
    const state: EpaState = {
      season: 2024,
      teamComponents: new Map([["frc1", { autoLeave: 10, autoAmpNote: 5 }]]),
      teamMatchCounts: new Map([["frc1", 1]]),
      allianceScoreStats: emptyExpandingStats(),
      fallbackSkipped: 0,
      priorSeasonRatings: emptyPriorSeasonRatings(),
    };
    const metrics = epa.teamMetrics(state);
    expect(metrics["frc1"]!["autoLeave"]).toEqual({ value: 10 });
    expect(metrics["frc1"]!["autoAmpNote"]).toEqual({ value: 5 });
    expect(metrics["frc1"]!["total"]).toEqual({ value: 15 });
  });
});

describe("breakdown2024.parse — Assumption A1 per-robot field guard", () => {
  it("never emits a component key ending in Robot1, Robot2, or Robot3", () => {
    const raw = JSON.parse(breakdown2024Json({ autoLeavePoints: 12 }, { autoLeavePoints: 6 }));
    const redComponents = breakdown2024.parse(raw, "red");
    const blueComponents = breakdown2024.parse(raw, "blue");
    for (const key of [...Object.keys(redComponents), ...Object.keys(blueComponents)]) {
      expect(key).not.toMatch(/Robot[123]$/);
    }
  });
});
