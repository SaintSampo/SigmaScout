/**
 * Synthetic-fixture tests for the EPA reimplementation (ALGO-02, D-13,
 * D-08), following `opr.test.ts`'s convention: build a small deterministic
 * fixture, drive `epa` through it, and assert against hand-computed values.
 */
import { describe, expect, it } from "vitest";
import {
  epa,
  epaPercentFunc,
  EPA_K,
  EPA_FALLBACK_SCORE_SD,
  EPA_INIT_COMPONENT_TOTAL,
  EPA_ELIM_WEIGHT,
  type EpaState,
} from "./epa.js";
import { opr } from "./opr.js";
import { breakdown2024 } from "./breakdown/2024.js";
import {
  ADJUST_COMPONENT,
  FOULS_COMMITTED_COMPONENT,
  COMPONENT_GROUP_METRIC_KEYS,
  componentsInGroup,
} from "./breakdown/index.js";
import { distributeResidual } from "./breakdown/fallback.js";
import { emptyExpandingStats, foldObservation, standardDeviation } from "../scoring/expandingStats.js";
import type { EpaCarryoverPriorRatings } from "./carryover.js";
import type { MatchResult, SeasonBoundary, UpcomingMatch } from "./types.js";
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
  it("starting mean 10, observation 40, percent 1/3 (match count 0), weight 1 (a QUALIFICATION match — D-05's elim discount does not apply) gives 20", () => {
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
    // D-05: this is a qualification match (the default `compLevel: "qm"`),
    // so the counter increments — an elimination match with the identical
    // observation would leave it at 0 instead (see the D-05 describe below).
    expect(next.teamMatchCounts.get("frc1")).toBe(1);
  });
});

describe("epa.update — D-Q1 error-split attribution (Statbotics post_process_attrib)", () => {
  /**
   * Three rating-eligible teammates with deliberately UNEQUAL prior means on
   * `autoLeave` (40 / 10 / 10, summing to a predicted alliance total of 60),
   * all sharing a match count of 0 so they share one learning rate. Blue's
   * whole roster is surrogates, so blue attribution is a documented no-op and
   * cannot perturb red.
   */
  function unequalTeammatesState(): EpaState {
    return {
      season: 2024,
      teamComponents: new Map([
        ["frc1", { autoLeave: 40 }],
        ["frc2", { autoLeave: 10 }],
        ["frc3", { autoLeave: 10 }],
      ]),
      teamMatchCounts: new Map([
        ["frc1", 0],
        ["frc2", 0],
        ["frc3", 0],
      ]),
      allianceScoreStats: emptyExpandingStats(),
      fallbackSkipped: 0,
      priorSeasonRatings: emptyPriorSeasonRatings(),
      breakdownParseFailureCount: 0,
    };
  }

  function redObservationOf(autoLeavePoints: number): MatchResult {
    return matchResult({
      redTeams: ["frc1", "frc2", "frc3"],
      redSurrogates: [],
      blueTeams: ["s1", "s2", "s3"],
      blueSurrogates: ["s1", "s2", "s3"],
      scoreBreakdownRaw: breakdown2024Json({ autoLeavePoints }),
    });
  }

  it("a teammate on an alliance that hits its prediction exactly does not move", () => {
    // Predicted alliance total is 40 + 10 + 10 = 60 and the alliance scores
    // exactly 60, so the alliance ERROR is 0 and nobody moves —
    // twoStageEwma(mean, mean + 0/n, percent, 1) === mean for every teammate,
    // regardless of how unequal their levels are.
    //
    // This is the case that fails loudly against the retired EVEN SPLIT, which
    // fed every teammate allianceValue/n === 20 and therefore dragged the
    // 40-point robot down to 40 + (1/3)(20 - 40) = 33.33 and pushed both
    // 10-point robots up to 10 + (1/3)(20 - 10) = 13.33 — pulling every team
    // toward its alliance's mean on a match that told us nothing new.
    const next = epa.update(unequalTeammatesState(), redObservationOf(60));

    expect(next.teamComponents.get("frc1")!["autoLeave"]).toBeCloseTo(40, 10);
    expect(next.teamComponents.get("frc2")!["autoLeave"]).toBeCloseTo(10, 10);
    expect(next.teamComponents.get("frc3")!["autoLeave"]).toBeCloseTo(10, 10);

    // This is a qualification match (D-05), so the counters still increment
    // — the match WAS played and observed; it simply carried no information
    // about how to re-rank these three.
    expect(next.teamMatchCounts.get("frc1")).toBe(1);
    expect(next.teamMatchCounts.get("frc2")).toBe(1);
    expect(next.teamMatchCounts.get("frc3")).toBe(1);
  });

  it("negative control: a missed prediction moves every teammate by the SAME absolute amount", () => {
    // Same priors, but the alliance scores 90 against a predicted 60. The
    // error is +30 shared over n = 3, so each teammate is attributed
    // currentMean + 10 and moves by percent * 10 = (1/3) * 10 = 10/3.
    // The error is shared; the LEVEL is not.
    const next = epa.update(unequalTeammatesState(), redObservationOf(90));

    const expectedDelta = (1 / 3) * 10;
    expect(next.teamComponents.get("frc1")!["autoLeave"]).toBeCloseTo(40 + expectedDelta, 10);
    expect(next.teamComponents.get("frc2")!["autoLeave"]).toBeCloseTo(10 + expectedDelta, 10);
    expect(next.teamComponents.get("frc3")!["autoLeave"]).toBeCloseTo(10 + expectedDelta, 10);

    // Stated as a relation too, so the "same absolute amount" claim is pinned
    // independently of the hand-computed level above — and so this control
    // cannot pass vacuously alongside a no-op implementation.
    const d1 = next.teamComponents.get("frc1")!["autoLeave"]! - 40;
    const d2 = next.teamComponents.get("frc2")!["autoLeave"]! - 10;
    const d3 = next.teamComponents.get("frc3")!["autoLeave"]! - 10;
    expect(d2).toBeCloseTo(d1, 10);
    expect(d3).toBeCloseTo(d1, 10);
    expect(d1).toBeGreaterThan(0);
  });

  it("with one rating-eligible team the error split is arithmetically identical to the retired even split", () => {
    // n === 1: currentMean + (allianceValue - currentMean)/1 === allianceValue,
    // which is exactly the observedShare the retired formula fed. This is why
    // every pre-existing n === 1 fixture in this file is unchanged by D-Q1.
    const state: EpaState = {
      season: 2024,
      teamComponents: new Map([["frc1", { autoLeave: 10 }]]),
      teamMatchCounts: new Map([["frc1", 0]]),
      allianceScoreStats: emptyExpandingStats(),
      fallbackSkipped: 0,
      priorSeasonRatings: emptyPriorSeasonRatings(),
      breakdownParseFailureCount: 0,
    };
    const next = epa.update(
      state,
      matchResult({
        redTeams: ["frc1", "surr1", "surr2"],
        redSurrogates: ["surr1", "surr2"],
        blueTeams: ["s1", "s2", "s3"],
        blueSurrogates: ["s1", "s2", "s3"],
        scoreBreakdownRaw: breakdown2024Json({ autoLeavePoints: 40 }),
      })
    );
    // 10 + (1/3)(40 - 10) === 20, the same value the even-split fixture above
    // asserts — the two formulas coincide exactly at n === 1.
    expect(next.teamComponents.get("frc1")!["autoLeave"]).toBeCloseTo(20, 10);
  });
});

describe("epa.update — D-05: Statbotics' elimination discount, adopted (quick task 260904-5px)", () => {
  function baseStateForElimTests(): EpaState {
    return {
      season: 2024,
      teamComponents: new Map([["frc1", { autoLeave: 10 }]]),
      teamMatchCounts: new Map([["frc1", 0]]),
      allianceScoreStats: emptyExpandingStats(),
      fallbackSkipped: 0,
      priorSeasonRatings: emptyPriorSeasonRatings(),
      breakdownParseFailureCount: 0,
    };
  }

  function matchAt(compLevel: MatchResult["compLevel"], matchKey: string): MatchResult {
    return matchResult({
      matchKey,
      compLevel,
      redTeams: ["frc1", "surr1", "surr2"],
      redSurrogates: ["surr1", "surr2"],
      blueTeams: ["s1", "s2", "s3"],
      blueSurrogates: ["s1", "s2", "s3"],
      scoreBreakdownRaw: breakdown2024Json({ autoLeavePoints: 40 }),
    });
  }

  it("an elimination match moves the component mean to exactly 40/3 where the identical observation in a qualification match moves it to exactly 20, and leaves the match counter at 0 while the qualification match advances it to 1", () => {
    const baseState = baseStateForElimTests();
    const afterQual = epa.update(baseState, matchAt("qm", "2024test_qm1"));
    const afterElim = epa.update(baseState, matchAt("sf", "2024test_sf1"));

    // Qualification: twoStageEwma(10, 40, 1/3, weight=1) = 20 — unchanged
    // from the pre-D-05 behavior; a qualification match is never discounted.
    expect(afterQual.teamComponents.get("frc1")!["autoLeave"]).toBeCloseTo(20, 10);
    expect(afterQual.teamMatchCounts.get("frc1")).toBe(1);

    // Elimination: the SAME inner blend (10 -> 20) is then blended AGAIN, at
    // EPA_ELIM_WEIGHT (1/3), against the ORIGINAL mean (10):
    // (1/3)*20 + (2/3)*10 = 40/3.
    expect(afterElim.teamComponents.get("frc1")!["autoLeave"]).toBeCloseTo(40 / 3, 10);
    // The counter is left exactly where it started — an elimination match
    // never advances epaPercentFunc's decaying-learning-rate schedule.
    expect(afterElim.teamMatchCounts.get("frc1")).toBe(0);
  });

  it("two consecutive elimination matches both learn at epaPercentFunc(0), since the schedule never advances", () => {
    const baseState = baseStateForElimTests();
    const afterFirstElim = epa.update(baseState, matchAt("sf", "2024test_sf1"));
    expect(afterFirstElim.teamMatchCounts.get("frc1")).toBe(0);

    const afterSecondElim = epa.update(afterFirstElim, matchAt("sf", "2024test_sf2"));
    expect(afterSecondElim.teamMatchCounts.get("frc1")).toBe(0);

    // Hand-computed at percent = epaPercentFunc(0) for BOTH updates (the
    // schedule never advanced past match count 0), starting from the first
    // elim's own result (40/3) and observing 40 again.
    const percent = epaPercentFunc(0);
    const startingMean = 40 / 3;
    const observation = 40;
    const innerMean = (1 - percent) * startingMean + percent * observation;
    const expected = EPA_ELIM_WEIGHT * innerMean + (1 - EPA_ELIM_WEIGHT) * startingMean;
    expect(afterSecondElim.teamComponents.get("frc1")!["autoLeave"]).toBeCloseTo(expected, 10);
  });

  it("ef/qf/sf/f are all treated as eliminations identically; only qm is a qualification match", () => {
    const baseState = baseStateForElimTests();
    const afterSf = epa.update(baseState, matchAt("sf", "2024test_sf1"));
    for (const compLevel of ["ef", "qf", "f"] as const) {
      const afterOther = epa.update(baseState, matchAt(compLevel, `2024test_${compLevel}1`));
      expect(afterOther.teamComponents.get("frc1")!["autoLeave"]).toBeCloseTo(
        afterSf.teamComponents.get("frc1")!["autoLeave"]!,
        10
      );
      expect(afterOther.teamMatchCounts.get("frc1")).toBe(afterSf.teamMatchCounts.get("frc1"));
    }
  });

  it("both alliance scores still fold into allianceScoreStats for an elimination match — the win-probability scale is unaffected by D-05", () => {
    const baseState = baseStateForElimTests();
    const elimResult = matchAt("sf", "2024test_sf1");
    const afterElim = epa.update(baseState, elimResult);

    let expectedStats = emptyExpandingStats();
    expectedStats = foldObservation(expectedStats, elimResult.redScore);
    expectedStats = foldObservation(expectedStats, elimResult.blueScore);
    expect(afterElim.allianceScoreStats).toEqual(expectedStats);
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
      teamComponents: new Map([["frc1", { autoLeave: 10, autoAmpNote: 5, foulsCommitted: 7 }]]),
      teamMatchCounts: new Map([["frc1", 1]]),
      allianceScoreStats: emptyExpandingStats(),
      fallbackSkipped: 0,
      priorSeasonRatings: emptyPriorSeasonRatings(),
      breakdownParseFailureCount: 0,
    };
    const metrics = epa.teamMetrics(state);
    expect(metrics["frc1"]!["autoLeave"]).toEqual({ value: 10 });
    expect(metrics["frc1"]!["autoAmpNote"]).toEqual({ value: 5 });
    // D-01 (quick task 260904-5px): `total` is the OFFENSIVE sum alone (10 +
    // 5), excluding `foulsCommitted` — matching Statbotics' no-foul
    // `epa.total_points`.
    expect(metrics["frc1"]!["total"]).toEqual({ value: 15 });
    // `foulsCommitted` is still published as its own entry, with its own
    // value, unchanged — only its membership in `total` moved.
    expect(metrics["frc1"]!["foulsCommitted"]).toEqual({ value: 7 });
  });

  it("teamMetrics: a team with no foulsCommitted entry at all is unaffected — total is still the plain component sum", () => {
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
    expect(metrics["frc1"]!["total"]).toEqual({ value: 15 });
    expect(metrics["frc1"]!["foulsCommitted"]).toBeUndefined();
  });
});

/**
 * D-1 (quick task 260904-7id): EPA's teamMetrics() publishes
 * phaseAuto/phaseTeleop/phaseEndgame — the three season-declared component
 * groups (breakdown/groups.ts) — as first-class, value-only metrics, so the
 * existing publish-pipeline percentile/tier pass (generic over metric NAMES)
 * can attach a season-wide tier to them with zero harness changes. Every
 * assertion below is checked against `componentsInGroup`, never a
 * hand-typed number — that is what makes "identical by construction" to the
 * client's `withDerivedGroupMetrics` a checkable property rather than an
 * assertion of intent.
 */
describe("epa.teamMetrics — D-1 (quick task 260904-7id): phase groups published as first-class metrics", () => {
  /** One value per 2024-registered component (all three groups plus both ungrouped components), so every group has something present. */
  const FULL_2024_COMPONENTS: Readonly<Record<string, number>> = {
    autoLeave: 3,
    autoAmpNote: 4,
    autoSpeakerNote: 5,
    teleopAmpNote: 6,
    teleopSpeakerNote: 7,
    teleopSpeakerNoteAmplified: 8,
    endGameOnStage: 1,
    endGamePark: 2,
    endGameHarmony: 3,
    endGameNoteInTrap: 4,
    endGameSpotLightBonus: 5,
    adjust: 0,
    foulsCommitted: 9,
  };

  function stateWithComponents(components: Readonly<Record<string, number>>, season: number | null = 2024): EpaState {
    return {
      season,
      teamComponents: new Map([["frc1", components]]),
      teamMatchCounts: new Map([["frc1", 1]]),
      allianceScoreStats: emptyExpandingStats(),
      fallbackSkipped: 0,
      priorSeasonRatings: emptyPriorSeasonRatings(),
      breakdownParseFailureCount: 0,
    };
  }

  it("each group's published value equals the sum of componentsInGroup entries PRESENT in the team's component record — compared against a value computed from componentsInGroup, never a hand-typed number", () => {
    const state = stateWithComponents(FULL_2024_COMPONENTS);
    const metrics = epa.teamMetrics(state)["frc1"]!;
    for (const group of ["auto", "teleop", "endgame"] as const) {
      const expected = componentsInGroup(2024, group).reduce((sum, name) => sum + (FULL_2024_COMPONENTS[name] ?? 0), 0);
      const key = COMPONENT_GROUP_METRIC_KEYS[group];
      expect(metrics[key], `${key} must be published`).toBeDefined();
      expect(metrics[key]!.value).toBeCloseTo(expected, 10);
    }
  });

  it("each group entry carries a value and nothing else — no spread key at all (EPA carries a mean only, everywhere)", () => {
    const state = stateWithComponents(FULL_2024_COMPONENTS);
    const metrics = epa.teamMetrics(state)["frc1"]!;
    for (const key of ["phaseAuto", "phaseTeleop", "phaseEndgame"]) {
      expect(Object.keys(metrics[key]!)).toEqual(["value"]);
    }
  });

  it("a group whose components are all absent from the team's record publishes NO entry — never a fabricated zero", () => {
    const { endGameOnStage: _a, endGamePark: _b, endGameHarmony: _c, endGameNoteInTrap: _d, endGameSpotLightBonus: _e, ...withoutEndgame } =
      FULL_2024_COMPONENTS;
    const state = stateWithComponents(withoutEndgame);
    const metrics = epa.teamMetrics(state)["frc1"]!;
    expect(metrics["phaseAuto"]).toBeDefined();
    expect(metrics["phaseTeleop"]).toBeDefined();
    expect(metrics["phaseEndgame"]).toBeUndefined();
  });

  it("a state whose season is null publishes the components and total but no group entries, and does not throw", () => {
    const state = stateWithComponents(FULL_2024_COMPONENTS, null);
    expect(() => epa.teamMetrics(state)).not.toThrow();
    const metrics = epa.teamMetrics(state)["frc1"]!;
    expect(metrics["autoLeave"]).toEqual({ value: 3 });
    expect(metrics["total"]).toBeDefined();
    expect(metrics["phaseAuto"]).toBeUndefined();
    expect(metrics["phaseTeleop"]).toBeUndefined();
    expect(metrics["phaseEndgame"]).toBeUndefined();
  });

  it("reconciliation: phaseAuto + phaseTeleop + phaseEndgame + adjust equals total exactly — EPA-specific (total already excludes foulsCommitted, D-01; adjust is pinned at 0, D-5/D-6), NOT a general property of the grouping", () => {
    const state = stateWithComponents(FULL_2024_COMPONENTS);
    const metrics = epa.teamMetrics(state)["frc1"]!;
    const groupSum = metrics["phaseAuto"]!.value + metrics["phaseTeleop"]!.value + metrics["phaseEndgame"]!.value;
    const adjustValue = metrics["adjust"]?.value ?? 0;
    expect(groupSum + adjustValue).toBeCloseTo(metrics["total"]!.value, 10);
  });
});

describe("epa.carrySeason — D-01: the carryover input stays fouls-INCLUSIVE, deliberately different from the published total (quick task 260904-5px)", () => {
  it("a team with a nonzero foulsCommitted carries a LARGER point total than a teammate with an identical offensive component but zero foulsCommitted", () => {
    // frc1 and frc2 share the identical offensive component (autoLeave: 30)
    // — under the PUBLISHED (fouls-excluded) total they would be
    // indistinguishable. carrySeason sums teamComponents directly, without
    // routing through teamMetrics' D-01 exclusion, so frc1's fromSeason
    // total (30 + 20 = 50) is genuinely larger than frc2's (30 + 0 = 30),
    // and that gap must survive into the carried rating. If a future edit
    // "aligned" carrySeason with the published total, this test would start
    // failing the moment it made frc1 and frc2 carry identically.
    const state: EpaState = {
      season: 2024,
      teamComponents: new Map([
        ["frc1", { autoLeave: 30, foulsCommitted: 20 }],
        ["frc2", { autoLeave: 30, foulsCommitted: 0 }],
      ]),
      teamMatchCounts: new Map([
        ["frc1", 10],
        ["frc2", 10],
      ]),
      allianceScoreStats: emptyExpandingStats(),
      fallbackSkipped: 0,
      priorSeasonRatings: emptyPriorSeasonRatings(),
      breakdownParseFailureCount: 0,
    };

    const boundary: SeasonBoundary = { fromSeason: 2024, toSeason: 2025, isColdStart: false };
    const next = epa.carrySeason!(state, boundary);

    function carriedTotal(team: string): number {
      const components = next.teamComponents.get(team) ?? {};
      return Object.values(components).reduce((sum, value) => sum + value, 0);
    }

    expect(carriedTotal("frc1")).toBeGreaterThan(carriedTotal("frc2"));
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
    // Red's roster (frc1/frc2/frc3) is all rating-eligible and starts from
    // `initState`, so all three carry the IDENTICAL cold-start mean. D-Q1's
    // error split therefore attributes each of them
    // `mean + (observed - 3*mean)/3`, which is the same number for all three.
    // (In this equal-means case that value also happens to equal the retired
    // even split `observed/3` — the coincidence this test is NOT about. What
    // it asserts is teammate EQUALITY, which holds under both formulas and so
    // survived the D-Q1 change unedited: it proves the real parse ran, not a
    // cross-alliance or degenerate split. The error split's own contract is
    // pinned by the unequal-means cases above, which is where the two
    // formulas actually diverge.)
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

describe("epa — adjust-zeroed alliance exclusion (quick task 260904-6a1, .planning/todos/pending/exclude-whole-alliance-dq-zero-scores.md's sibling)", () => {
  it("an alliance zeroed by a negative parsed adjustPoints with EMPTY dq lists gets NO component update — the 2026bc2_sf14m1 shape (real ~456-point alliance, adjustPoints: -456, no DQ)", () => {
    const initial = epa.initState(["frc190", "frc3467", "frc237", "frc1", "frc2", "frc3"]);
    const afterAdjustZero = epa.update(
      initial,
      matchResult({
        redTeams: ["frc190", "frc3467", "frc237"],
        blueTeams: ["frc1", "frc2", "frc3"],
        redDqs: [],
        blueDqs: [],
        redScore: 0,
        blueScore: 90,
        scoreBreakdownRaw: breakdown2024Json({ autoLeavePoints: 456, adjustPoints: -456 }),
      })
    );

    // The zeroed alliance never received any component update — still
    // exactly the cold-start record initState seeded, match count still 0.
    for (const team of ["frc190", "frc3467", "frc237"]) {
      expect(afterAdjustZero.teamComponents.get(team)).toEqual(initial.teamComponents.get(team));
      expect(afterAdjustZero.teamMatchCounts.get(team)).toBe(0);
    }
    // The opposing alliance's real observation is a genuine, ordinary fold —
    // the ruling on the OTHER alliance never touches it.
    for (const team of ["frc1", "frc2", "frc3"]) {
      expect(afterAdjustZero.teamComponents.get(team)).not.toEqual(initial.teamComponents.get(team));
      expect(afterAdjustZero.teamMatchCounts.get(team)).toBe(1);
    }
  });

  it("the adjust-zeroed alliance's 0 is not folded into allianceScoreStats — the season SD is not dragged toward zero", () => {
    const initial = epa.initState(["frc190", "frc3467", "frc237", "frc1", "frc2", "frc3"]);
    const afterAdjustZero = epa.update(
      initial,
      matchResult({
        redTeams: ["frc190", "frc3467", "frc237"],
        blueTeams: ["frc1", "frc2", "frc3"],
        redDqs: [],
        blueDqs: [],
        redScore: 0,
        blueScore: 90,
        scoreBreakdownRaw: breakdown2024Json({ autoLeavePoints: 456, adjustPoints: -456 }),
      })
    );
    // Only blue's 90 is folded — red's ruling-zero is excluded.
    expect(afterAdjustZero.allianceScoreStats.count).toBe(1);
  });

  it("a non-zero recorded score with a large negative adjust is still counted normally — the 95 offseason nonzero-score rows this predicate must not touch", () => {
    const initial = epa.initState(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]);
    const withNegativeAdjust = epa.update(
      initial,
      matchResult({
        redTeams: ["frc1", "frc2", "frc3"],
        blueTeams: ["frc4", "frc5", "frc6"],
        redDqs: [],
        blueDqs: [],
        redScore: 68,
        blueScore: 40,
        scoreBreakdownRaw: breakdown2024Json({ autoLeavePoints: 68, adjustPoints: -30 }),
      })
    );
    const withoutNegativeAdjust = epa.update(
      initial,
      matchResult({
        redTeams: ["frc1", "frc2", "frc3"],
        blueTeams: ["frc4", "frc5", "frc6"],
        redDqs: [],
        blueDqs: [],
        redScore: 68,
        blueScore: 40,
        scoreBreakdownRaw: breakdown2024Json({ autoLeavePoints: 68, adjustPoints: 0 }),
      })
    );
    for (const team of ["frc1", "frc2", "frc3"]) {
      expect(withNegativeAdjust.teamMatchCounts.get(team)).toBe(1);
    }
    expect(withNegativeAdjust.allianceScoreStats.count).toBe(withoutNegativeAdjust.allianceScoreStats.count);
  });

  it("a breakdown-less match with score 0 and empty dq lists still updates normally — adjust is unknown, not negative", () => {
    const initial = epa.initState(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]);
    const afterFallback = epa.update(
      initial,
      matchResult({
        redTeams: ["frc1", "frc2", "frc3"],
        blueTeams: ["frc4", "frc5", "frc6"],
        redDqs: [],
        blueDqs: [],
        redScore: 0,
        blueScore: 40,
        hasScoreBreakdown: false,
        scoreBreakdownRaw: null,
      })
    );
    for (const team of ["frc1", "frc2", "frc3"]) {
      expect(afterFallback.teamMatchCounts.get(team)).toBe(1);
    }
    expect(afterFallback.allianceScoreStats.count).toBe(2);
  });
});

describe("epa — adjust pinned at 0 per team (D-5/D-6, quick task 260904-6a1)", () => {
  it("after N updates against breakdowns carrying nonzero adjustPoints, every team's adjust entry is exactly 0", () => {
    let state = epa.initState(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]);
    for (let i = 0; i < 5; i++) {
      state = epa.update(
        state,
        matchResult({
          matchKey: `2024test_qm${i + 1}`,
          matchNumber: i + 1,
          redTeams: ["frc1", "frc2", "frc3"],
          blueTeams: ["frc4", "frc5", "frc6"],
          redScore: 100 + i,
          blueScore: 80 + i,
          scoreBreakdownRaw: breakdown2024Json({ autoLeavePoints: 100 + i, adjustPoints: -20 }, { autoLeavePoints: 80 + i, adjustPoints: 15 }),
        })
      );
    }
    for (const team of ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]) {
      expect(state.teamComponents.get(team)![ADJUST_COMPONENT]).toBe(0);
    }
  });

  it("after carrySeason across a season boundary, every carried team's adjust entry is still exactly 0", () => {
    const state: EpaState = {
      season: 2024,
      teamComponents: new Map([
        ["frc1", { autoLeave: 30, [ADJUST_COMPONENT]: 0 }],
        ["frc2", { autoLeave: 20, [ADJUST_COMPONENT]: 0 }],
      ]),
      teamMatchCounts: new Map([
        ["frc1", 10],
        ["frc2", 10],
      ]),
      allianceScoreStats: emptyExpandingStats(),
      fallbackSkipped: 0,
      priorSeasonRatings: emptyPriorSeasonRatings(),
      breakdownParseFailureCount: 0,
    };
    const boundary: SeasonBoundary = { fromSeason: 2024, toSeason: 2025, isColdStart: false };
    const next = epa.carrySeason!(state, boundary);
    for (const team of ["frc1", "frc2"]) {
      expect(next.teamComponents.get(team)![ADJUST_COMPONENT]).toBe(0);
    }
  });

  it("a cold-start team's summed component means equal EPA_INIT_COMPONENT_TOTAL — unchanged by excluding adjust from the divisor (D-6)", () => {
    // One team per alliance (n=1): with every raw breakdown field set to
    // EXACTLY the modeled cold-start value, `predictedAllianceTotal` for
    // each component equals `coldStart` too (n=1), so `attributed` reduces
    // to `coldStart` and `twoStageEwma(coldStart, coldStart, percent, 1)`
    // is a genuine no-op — the observation matches the prior exactly. The
    // resulting per-team sum is therefore exactly the cold-start seed,
    // `componentCount * coldStart`, which is `EPA_INIT_COMPONENT_TOTAL` BY
    // CONSTRUCTION only if `componentCount` (D-6) excludes `adjust` —
    // otherwise the sum would fall short by exactly one `coldStart` share.
    const modeledComponentCount = breakdown2024.components.filter((name) => name !== ADJUST_COMPONENT).length;
    const coldStart = EPA_INIT_COMPONENT_TOTAL / modeledComponentCount;
    const uniformFields = {
      autoLeavePoints: coldStart,
      autoAmpNotePoints: coldStart,
      autoSpeakerNotePoints: coldStart,
      teleopAmpNotePoints: coldStart,
      teleopSpeakerNotePoints: coldStart,
      teleopSpeakerNoteAmplifiedPoints: coldStart,
      endGameOnStagePoints: coldStart,
      endGameParkPoints: coldStart,
      endGameHarmonyPoints: coldStart,
      endGameNoteInTrapPoints: coldStart,
      endGameSpotLightBonusPoints: coldStart,
      adjustPoints: coldStart, // irrelevant — pinned at 0 regardless (D-5)
      foulPoints: coldStart,
    };

    const initial = epa.initState(["frc1", "frc4"]);
    const next = epa.update(
      initial,
      matchResult({
        redTeams: ["frc1"],
        redSurrogates: [],
        blueTeams: ["frc4"],
        blueSurrogates: [],
        redScore: coldStart * (modeledComponentCount - 1),
        blueScore: coldStart * (modeledComponentCount - 1),
        scoreBreakdownRaw: breakdown2024Json(uniformFields, uniformFields),
      })
    );
    for (const team of ["frc1", "frc4"]) {
      const components = next.teamComponents.get(team)!;
      const total = Object.values(components).reduce((sum, value) => sum + value, 0);
      expect(total).toBeCloseTo(EPA_INIT_COMPONENT_TOTAL, 9);
    }
  });

  it("predicted alliance score is identical whether a team's adjust entry is consulted or not — adjust contributes 0", () => {
    const state = epa.update(
      epa.initState(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]),
      matchResult({
        redTeams: ["frc1", "frc2", "frc3"],
        blueTeams: ["frc4", "frc5", "frc6"],
        redScore: 120,
        blueScore: 80,
        scoreBreakdownRaw: breakdown2024Json({ autoLeavePoints: 120, adjustPoints: -999 }, { autoLeavePoints: 80 }),
      })
    );
    const prediction = epa.predict(state, upcoming({ redTeams: ["frc1", "frc2", "frc3"], blueTeams: ["frc4", "frc5", "frc6"] }));
    expect(prediction.redComponents![ADJUST_COMPONENT]!.mean).toBe(0);
  });

  it("distributeResidual, fed EPA's modeled (non-fouls, non-adjust) component list, still sums to the observed total — the fallback split covers every modeled component and ADJUST_COMPONENT never receives a share", () => {
    const modeledComponents = breakdown2024.components.filter(
      (name) => name !== FOULS_COMMITTED_COMPONENT && name !== ADJUST_COMPONENT
    );
    expect(modeledComponents).not.toContain(ADJUST_COMPONENT);
    const result = distributeResidual(140, {}, modeledComponents);
    const sum = Object.values(result).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(140, 9);
    expect(result[ADJUST_COMPONENT]).toBeUndefined();
  });

  it("a D-05 fallback match (null scoreBreakdownRaw) still updates every rating-eligible team, and adjust stays pinned at 0 throughout", () => {
    const initial = epa.initState(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]);
    const afterFallback = epa.update(
      initial,
      matchResult({
        redTeams: ["frc1", "frc2", "frc3"],
        blueTeams: ["frc4", "frc5", "frc6"],
        redScore: 140,
        blueScore: 90,
        hasScoreBreakdown: false,
        scoreBreakdownRaw: null,
      })
    );
    for (const team of ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]) {
      expect(afterFallback.teamComponents.get(team)![ADJUST_COMPONENT]).toBe(0);
      expect(afterFallback.teamMatchCounts.get(team)).toBe(1);
    }
  });
});
