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
import { DEMO_PSEUDO_TEAM_KEY } from "./demoTeams.js";

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
    eventType: 0,
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
    redDqs: [],
    blueDqs: [],
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
      breakdownParseFailureCount: 0,
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
      breakdownParseFailureCount: 0,
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
      breakdownParseFailureCount: 0,
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
      breakdownParseFailureCount: 0,
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
      breakdownParseFailureCount: 0,
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
      breakdownParseFailureCount: 0,
    };
    const metrics = epa.teamMetrics(state);
    expect(metrics["frc1"]!["autoLeave"]).toEqual({ value: 10 });
    expect(metrics["frc1"]!["autoAmpNote"]).toEqual({ value: 5 });
    expect(metrics["frc1"]!["total"]).toEqual({ value: 15 });
  });
});

describe("epa.update — D-05 fallback attribution (CR-01, code review phase 02)", () => {
  it("a NON-uniform predicted vector with a nonzero prior foulsCommitted mean: foulsCommitted is carried forward unchanged, and the opponent's predicted foul contribution is netted out before the offensive split", () => {
    // R1's predicted shares are deliberately non-uniform (40 vs 10) and its
    // prior foulsCommitted mean (8) is nonzero — unlike sigma1.test.ts's
    // rawBreakdown2024Uniform fixture, this is constructed so CR-01's bug
    // (feeding a share of red's own score into foulsCommitted, and never
    // netting blue's predicted foul contribution out of red's own score
    // before the split) cannot hide behind distributeResidual's uniform
    // cold-start branch.
    const state: EpaState = {
      season: 2024,
      teamComponents: new Map<string, Record<string, number>>([
        ["R1", { autoLeave: 40, teleopSpeakerNote: 10, [FOULS_COMMITTED_COMPONENT]: 8 }],
        ["B1", { autoLeave: 5, [FOULS_COMMITTED_COMPONENT]: 4 }],
      ]),
      teamMatchCounts: new Map([
        ["R1", 0],
        ["B1", 0],
      ]),
      allianceScoreStats: emptyExpandingStats(),
      fallbackSkipped: 0,
      priorSeasonRatings: emptyPriorSeasonRatings(),
      breakdownParseFailureCount: 0,
    };

    const fallbackMatch = matchResult({
      redTeams: ["R1"],
      redSurrogates: [],
      blueTeams: ["B1"],
      blueSurrogates: [],
      redScore: 100,
      blueScore: 50,
      hasScoreBreakdown: false,
      scoreBreakdownRaw: null,
    });

    const next = epa.update(state, fallbackMatch);

    // Invariant 1 (CR-01): none of red's own actual score lands in red's
    // own foulsCommitted slot — it is carried forward EXACTLY unchanged
    // (never a coerced zero, never a synthesized share of red's score).
    expect(next.teamComponents.get("R1")!["foulsCommitted"]).toBeCloseTo(8, 10);
    expect(next.teamComponents.get("B1")!["foulsCommitted"]).toBeCloseTo(4, 10);

    // Invariant 2 (CR-01): blue's currently-predicted foulsCommitted mean
    // (4 — points blue's fouls would cost red) is netted out of
    // result.redScore (100 -> 96) BEFORE the split across red's own
    // non-fouls components, in proportion to their predicted shares
    // (40:10 of a 50 total) — NOT the pre-fix formula, which would have
    // split the full, un-netted 100 across all 13 components including
    // foulsCommitted (giving autoLeave = 100*40/58 ~= 68.97, not 52.27).
    const expectedAutoLeave = (2 / 3) * 40 + (1 / 3) * (96 * (40 / 50));
    const expectedTeleopSpeakerNote = (2 / 3) * 10 + (1 / 3) * (96 * (10 / 50));
    expect(next.teamComponents.get("R1")!["autoLeave"]).toBeCloseTo(expectedAutoLeave, 9);
    expect(next.teamComponents.get("R1")!["teleopSpeakerNote"]).toBeCloseTo(expectedTeleopSpeakerNote, 9);

    // Mirror invariant on blue: red's currently-predicted foulsCommitted
    // mean (8) is netted out of result.blueScore (50 -> 42) before blue's
    // own split (blue's only-nonzero predicted offensive component is
    // autoLeave, so it absorbs the entire net residual).
    const expectedBlueAutoLeave = (2 / 3) * 5 + (1 / 3) * 42;
    expect(next.teamComponents.get("B1")!["autoLeave"]).toBeCloseTo(expectedBlueAutoLeave, 9);
  });
});

describe("epa.update — WR-01 finite-value gate (code review phase 02)", () => {
  it("throws when result.redScore is non-finite, rather than silently folding NaN into a team's EWMA state for the rest of the season", () => {
    const state = epa.initState(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]);
    const brokenMatch = matchResult({
      redScore: Number.NaN,
      blueScore: 80,
      hasScoreBreakdown: false,
      scoreBreakdownRaw: null,
    });
    expect(() => epa.update(state, brokenMatch)).toThrow(/non-finite/);
  });
});

/**
 * T-03-18b (security audit, phase 03, quick task 260818-inm): derives a
 * malformed 2024 payload from the well-formed `breakdown2024Json()`
 * baseline by deleting `fieldsToOmit` from BOTH sides, rather than
 * hand-typing a second payload.
 */
function breakdown2024JsonMissingFields(fieldsToOmit: readonly string[]): string {
  const full = JSON.parse(breakdown2024Json()) as { red: Record<string, unknown>; blue: Record<string, unknown> };
  for (const side of [full.red, full.blue]) {
    for (const field of fieldsToOmit) delete side[field];
  }
  return JSON.stringify(full);
}

describe("epa.update — T-03-18b: a malformed self-reported breakdown degrades to the D-05 fallback, never a throw", () => {
  it("the missing-adjustPoints (2024cafb_qm1) payload does not throw, breakdownParseFailureCount increments by 1, team components move off cold start, and fallbackSkipped remains 0", () => {
    const state = epa.initState(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]);
    // Cold start: every team's teamComponents entry is genuinely EMPTY (no
    // keys at all) before its first observation — see epa.ts's initState.
    expect(state.teamComponents.get("frc1")).toEqual({});

    const malformedMatch = matchResult({
      matchKey: "2024cafb_qm1",
      hasScoreBreakdown: true,
      scoreBreakdownRaw: breakdown2024JsonMissingFields(["adjustPoints"]),
    });
    let next!: EpaState;
    expect(() => {
      next = epa.update(state, malformedMatch);
    }).not.toThrow();
    expect(next.breakdownParseFailureCount).toBe(1);
    // The permanently-zero invariant (breakdown.test.ts's own describe
    // block) is untouched — a malformed breakdown is not the "no
    // score_breakdown at all" code path fallbackSkipped instruments.
    expect(next.fallbackSkipped).toBe(0);
    // "Moved off cold start" — every registered component is now DEFINED
    // and finite, where it was previously entirely absent.
    for (const componentName of breakdown2024.components) {
      const value = next.teamComponents.get("frc1")![componentName];
      expect(value).toBeDefined();
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(next.teamMatchCounts.get("frc1")).toBe(1);
  });

  it("positive control: a well-formed payload leaves breakdownParseFailureCount at 0 and each team's component means equal the expected parsed per-team shares, proving the full parse path still runs", () => {
    const state = epa.initState(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]);
    const wellFormedMatch = matchResult({
      scoreBreakdownRaw: breakdown2024Json({ autoLeavePoints: 12, teleopSpeakerNotePoints: 30 }, { autoLeavePoints: 6 }),
    });
    const next = epa.update(state, wellFormedMatch);
    expect(next.breakdownParseFailureCount).toBe(0);
    // Red's roster (frc1/frc2/frc3) is all rating-eligible, so the alliance's
    // observed 12-point autoLeavePoints/30-point teleopSpeakerNotePoints
    // totals are evenly split three ways — every teammate must receive the
    // IDENTICAL observed share, proving the real parse (not a cross-alliance
    // or degenerate split) actually ran.
    for (const team of ["frc2", "frc3"]) {
      expect(next.teamComponents.get(team)!["autoLeave"]).toBe(next.teamComponents.get("frc1")!["autoLeave"]);
      expect(next.teamComponents.get(team)!["teleopSpeakerNote"]).toBe(next.teamComponents.get("frc1")!["teleopSpeakerNote"]);
    }
    // A component this match's payload left at 0 (e.g. adjustPoints) still
    // moves off the empty cold-start state to a defined, finite value —
    // proving the well-formed payload took the REAL parse path end to end,
    // not merely the two components this test explicitly overrode.
    expect(Number.isFinite(next.teamComponents.get("frc1")!["adjust"])).toBe(true);
    expect(next.teamMatchCounts.get("frc1")).toBe(1);
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

describe("epa — off-season demo team exclusion (frc9970-frc9999, demoTeams.ts)", () => {
  it("case 1: a fully-demo alliance never updates state for either alliance, even though EPA (unlike OPR) folds every comp level", () => {
    const initial = epa.initState(["frc1", "frc2", "frc3"]);
    const forfeitMatch = matchResult({
      matchKey: "2024test_sf1m1",
      compLevel: "sf",
      redTeams: ["frc1", "frc2", "frc3"],
      blueTeams: ["frc9970", "frc9971", "frc9972"],
      redScore: 200,
      blueScore: 0,
    });
    const afterForfeit = epa.update(initial, forfeitMatch);
    // A genuine no-op: every field the real corpus update() actually
    // mutates is untouched, not merely "close".
    expect(afterForfeit).toEqual(initial);
  });

  it("case 2: a real teammate of a mixed alliance is computed IDENTICALLY whether the third slot is a demo team or an ordinary real team — not inflated by absorbing the demo slot's share", () => {
    // `initState` is seeded from `teamsThisSeason` in the real pipeline,
    // which `publish.ts` filters to exclude every raw demo key (Published-
    // surface exclusion, scope item 2) — so a demo key is never itself a
    // seed team, exactly as reproduced here (only the real teams are seeded;
    // the demo key only ever appears inside a match's `redTeams`/`blueTeams`).
    const withDemo = epa.update(
      epa.initState(["frc1", "frc2", "frc4", "frc5", "frc6"]),
      matchResult({
        redTeams: ["frc1", "frc2", "frc9985"],
        blueTeams: ["frc4", "frc5", "frc6"],
        redScore: 120,
        blueScore: 80,
      })
    );
    const withRealThird = epa.update(
      epa.initState(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]),
      matchResult({
        redTeams: ["frc1", "frc2", "frc3"],
        blueTeams: ["frc4", "frc5", "frc6"],
        redScore: 120,
        blueScore: 80,
      })
    );

    // frc1/frc2's own learned component means and match counts are
    // byte-identical regardless of whether their teammate was a real team
    // or the shared demo pseudo entity — the observed alliance total is
    // still divided by the true 3-slot count either way.
    for (const team of ["frc1", "frc2"]) {
      expect(withDemo.teamComponents.get(team)).toEqual(withRealThird.teamComponents.get(team));
      expect(withDemo.teamMatchCounts.get(team)).toBe(withRealThird.teamMatchCounts.get(team));
    }
    // The demo pseudo entity itself picked up the third teammate's share
    // (never left at cold start), but under its OWN shared identity, never
    // under "frc9985".
    expect(withDemo.teamComponents.has("frc9985")).toBe(false);
    expect(withDemo.teamComponents.get(DEMO_PSEUDO_TEAM_KEY)).toEqual(withRealThird.teamComponents.get("frc3"));
  });

  it("predict(): a real alliance's predicted score is unaffected by whether its teammate is a demo team or an ordinary team, given identical prior state shape", () => {
    const stateWithDemo = epa.update(
      epa.initState(["frc1", "frc2", "frc4", "frc5", "frc6"]),
      matchResult({ redTeams: ["frc1", "frc2", "frc9985"], blueTeams: ["frc4", "frc5", "frc6"], redScore: 120, blueScore: 80 })
    );
    const stateWithReal = epa.update(
      epa.initState(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]),
      matchResult({ redTeams: ["frc1", "frc2", "frc3"], blueTeams: ["frc4", "frc5", "frc6"], redScore: 120, blueScore: 80 })
    );
    const predictedWithDemo = epa.predict(stateWithDemo, upcoming({ redTeams: ["frc1", "frc2", "frc9985"], blueTeams: ["frc4", "frc5", "frc6"] }));
    const predictedWithReal = epa.predict(stateWithReal, upcoming({ redTeams: ["frc1", "frc2", "frc3"], blueTeams: ["frc4", "frc5", "frc6"] }));
    expect(predictedWithDemo.redScore).toBeCloseTo(predictedWithReal.redScore, 9);
  });
});

describe("epa — whole-alliance DQ zero-score exclusion (.planning/todos/pending/exclude-whole-alliance-dq-zero-scores.md)", () => {
  it("a fully-DQ'd, zero-score alliance gets NO component update — its teamComponents stay at the pre-match cold-start record, while the opposing alliance's real fold is completely unaffected by the DQ", () => {
    const initial = epa.initState(["frc1", "frc2", "frc3", "D1", "D2", "D3"]);
    const afterDq = epa.update(
      initial,
      matchResult({
        redTeams: ["D1", "D2", "D3"],
        blueTeams: ["frc1", "frc2", "frc3"],
        redDqs: ["D1", "D2", "D3"],
        redScore: 0,
        blueScore: 90,
      })
    );
    const afterNoDq = epa.update(
      initial,
      matchResult({
        redTeams: ["D1", "D2", "D3"],
        blueTeams: ["frc1", "frc2", "frc3"],
        redDqs: [],
        redScore: 0,
        blueScore: 90,
      })
    );

    // The DQ'd teams never received any component update — still exactly
    // the cold-start record initState seeded, match count still 0.
    for (const team of ["D1", "D2", "D3"]) {
      expect(afterDq.teamComponents.get(team)).toEqual(initial.teamComponents.get(team));
      expect(afterDq.teamMatchCounts.get(team)).toBe(0);
    }
    // Without the fix (redDqs ignored), the SAME 0 score would have been
    // fitted as real per-component performance — this pins that contrast.
    expect(afterNoDq.teamComponents.get("D1")).not.toEqual(initial.teamComponents.get("D1"));

    // Blue's real observation is a genuine, ordinary fold either way — the
    // DQ on the OPPOSING alliance never touches it.
    for (const team of ["frc1", "frc2", "frc3"]) {
      expect(afterDq.teamComponents.get(team)).toEqual(afterNoDq.teamComponents.get(team));
      expect(afterDq.teamMatchCounts.get(team)).toBe(afterNoDq.teamMatchCounts.get(team));
    }
  });

  it("partial DQ (redDqs populated but not covering the whole alliance) still contributes exactly as if redDqs were empty — leave it exactly as today", () => {
    const initial = epa.initState(["frc1", "frc2", "frc3", "D1"]);
    const withPartialDq = epa.update(
      initial,
      matchResult({ redTeams: ["D1", "frc1", "frc2"], blueTeams: ["frc3"], redDqs: ["D1"], redScore: 68, blueScore: 40 })
    );
    const withoutDq = epa.update(
      initial,
      matchResult({ redTeams: ["D1", "frc1", "frc2"], blueTeams: ["frc3"], redDqs: [], redScore: 68, blueScore: 40 })
    );

    for (const team of ["D1", "frc1", "frc2", "frc3"]) {
      expect(withPartialDq.teamComponents.get(team)).toEqual(withoutDq.teamComponents.get(team));
      expect(withPartialDq.teamMatchCounts.get(team)).toBe(withoutDq.teamMatchCounts.get(team));
    }
  });

  it("guards the inverse error: a whole-alliance DQ with a NON-zero recorded score is still counted, exactly like an ordinary observation", () => {
    const initial = epa.initState(["frc1", "frc2", "frc3", "D1", "D2", "D3"]);
    const withNonZeroDq = epa.update(
      initial,
      matchResult({ redTeams: ["D1", "D2", "D3"], blueTeams: ["frc1", "frc2", "frc3"], redDqs: ["D1", "D2", "D3"], redScore: 45, blueScore: 30 })
    );
    const noDq = epa.update(
      initial,
      matchResult({ redTeams: ["D1", "D2", "D3"], blueTeams: ["frc1", "frc2", "frc3"], redDqs: [], redScore: 45, blueScore: 30 })
    );

    for (const team of ["D1", "D2", "D3", "frc1", "frc2", "frc3"]) {
      expect(withNonZeroDq.teamComponents.get(team)).toEqual(noDq.teamComponents.get(team));
      expect(withNonZeroDq.teamMatchCounts.get(team)).toBe(noDq.teamMatchCounts.get(team));
    }
  });
});
