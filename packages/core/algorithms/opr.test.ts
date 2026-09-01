/**
 * Synthetic-fixture tests for the event-scoped, quals-only, no-ridge OPR
 * baseline (Phase 3.2, D-01/D-02/D-03/D-05/D-06). Every fixture here has a
 * known answer or a provable structural property, so a failure points at
 * the math, not at the corpus.
 */
import { describe, expect, it } from "vitest";
import {
  OPR_FALLBACK_SCORE_SD,
  OPR_SCALE_DIVISOR_K,
  allianceObservation,
  opr,
  ratingEligibleTeams,
  solveEventOpr,
  type OprObservation,
  type OprState,
} from "./opr.js";
import { EPA_FALLBACK_SCORE_SD } from "./epa.js";
import { standardDeviation } from "../scoring/expandingStats.js";
import { TOTAL_METRIC_KEY, type MatchResult, type UpcomingMatch } from "./types.js";
import { WalkForwardSimulator } from "../../harness/replay.js";
import { ALGORITHMS } from "../../harness/cli.js";
import * as oprModule from "./opr.js";
import { DEMO_PSEUDO_TEAM_KEY } from "./demoTeams.js";

function match(overrides: Partial<MatchResult> & Pick<MatchResult, "matchKey">): MatchResult {
  return {
    eventKey: overrides.matchKey.split("_")[0] ?? "2024test",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 1,
    redTeams: [],
    blueTeams: [],
    redSurrogates: [],
    blueSurrogates: [],
    redDqs: [],
    blueDqs: [],
    winner: "red",
    redScore: 0,
    blueScore: 0,
    redRpEarned: null,
    blueRpEarned: null,
    hasScoreBreakdown: false,
    scoreBreakdownRaw: null,
    eventType: 0,
    ...overrides,
  };
}

function buildTeamIndex(observations: readonly OprObservation[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const obs of observations) {
    for (const team of obs.teams) {
      if (!index.has(team)) index.set(team, index.size);
    }
  }
  return index;
}

/** Convenience accessors into the event-scoped state shape (D-01). */
function ratingsAt(state: OprState, eventKey: string): ReadonlyMap<string, number> {
  return state.perEvent.get(eventKey)?.ratings ?? new Map();
}
function observationsAt(state: OprState, eventKey: string): readonly OprObservation[] {
  return state.perEvent.get(eventKey)?.observations ?? [];
}

describe("OPR logistic-scale constants (D-Q4)", () => {
  it("both exported constants are positive — a zero or negative either would make the scale non-finite or invert the logistic", () => {
    expect(OPR_SCALE_DIVISOR_K).toBeGreaterThan(0);
    expect(OPR_FALLBACK_SCORE_SD).toBeGreaterThan(0);
  });

  it("OPR_FALLBACK_SCORE_SD equals EPA_FALLBACK_SCORE_SD — the 'matching' claim is pinned, not just asserted in prose", () => {
    // The two cannot be a single shared import: epa.ts imports
    // ratingEligibleTeams from opr.ts, so importing back would create a module
    // cycle. This test is what stops the duplicated constants drifting apart.
    expect(OPR_FALLBACK_SCORE_SD).toBe(EPA_FALLBACK_SCORE_SD);
  });
});

/** Inverts `pRedWin = 1/(1 + exp(-margin/scale))` to recover the scale a prediction was made under. */
function impliedScale(pRedWin: number, margin: number): number {
  return -margin / Math.log(1 / pRedWin - 1);
}

describe("opr.predict — expanding-window logistic scale (D-Q4)", () => {
  /** A state with a known rating spread at one event, so `predict` produces a known margin. */
  function stateWithRatings(state: OprState, eventKey: string, ratings: [string, number][]): OprState {
    const perEvent = new Map(state.perEvent);
    perEvent.set(eventKey, { observations: [], ratings: new Map(ratings) });
    return { ...state, perEvent };
  }

  const upcoming: UpcomingMatch = {
    matchKey: "2024test_qm9",
    eventKey: "2024test",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 9,
    redTeams: ["R1", "R2", "R3"],
    blueTeams: ["B1", "B2", "B3"],
    redSurrogates: [],
    blueSurrogates: [],
    eventType: 0,
  };

  it("with fewer than 2 folded scores, falls back to OPR_FALLBACK_SCORE_SD / OPR_SCALE_DIVISOR_K — never 0, never NaN, and never the retired 10", () => {
    const state = stateWithRatings(opr.initState([]), "2024test", [
      ["R1", 20],
      ["R2", 0],
      ["R3", 0],
      ["B1", 0],
      ["B2", 0],
      ["B3", 0],
    ]);
    expect(state.allianceScoreStats.count).toBeLessThan(2);

    const prediction = opr.predict(state, upcoming);
    const margin = prediction.redScore - prediction.blueScore;
    expect(margin).toBeCloseTo(20, 10);
    expect(Number.isFinite(prediction.pRedWin)).toBe(true);

    expect(impliedScale(prediction.pRedWin, margin)).toBeCloseTo(OPR_FALLBACK_SCORE_SD / OPR_SCALE_DIVISOR_K, 9);
    // Proves the retired fixed constant is gone from the prediction path.
    expect(impliedScale(prediction.pRedWin, margin)).not.toBeCloseTo(10, 6);
  });

  it("after folding a spread of alliance scores, the scale is standardDeviation(allianceScoreStats, 25) / 1.1", () => {
    // Fold a sequence of qm matches with a deliberately wide score spread.
    let state = opr.initState([]);
    const scores: [number, number][] = [
      [30, 20],
      [80, 45],
      [120, 60],
      [55, 95],
    ];
    scores.forEach(([redScore, blueScore], i) => {
      state = opr.update(
        state,
        match({
          matchKey: `2024test_qm${i + 1}`,
          matchNumber: i + 1,
          redTeams: ["R1", "R2", "R3"],
          blueTeams: ["B1", "B2", "B3"],
          redScore,
          blueScore,
        })
      );
    });
    expect(state.allianceScoreStats.count).toBe(8);

    const withRatings = stateWithRatings(state, "2024other", [
      ["R1", 15],
      ["R2", 0],
      ["R3", 0],
      ["B1", 0],
      ["B2", 0],
      ["B3", 0],
    ]);
    const prediction = opr.predict(withRatings, { ...upcoming, eventKey: "2024other" });
    const margin = prediction.redScore - prediction.blueScore;
    const expectedScale = standardDeviation(state.allianceScoreStats, OPR_FALLBACK_SCORE_SD) / OPR_SCALE_DIVISOR_K;

    expect(impliedScale(prediction.pRedWin, margin)).toBeCloseTo(expectedScale, 9);
    // Non-vacuity: the measured spread must actually have moved the scale off
    // the cold-start fallback, or this test would pass against a stuck scale.
    expect(expectedScale).not.toBeCloseTo(OPR_FALLBACK_SCORE_SD / OPR_SCALE_DIVISOR_K, 3);
  });

  it("is leak-free: folding match i+1 does not change the prediction already made for match i (Pitfall EPA-1)", () => {
    let state = opr.initState([]);
    state = opr.update(
      state,
      match({ matchKey: "2024test_qm1", matchNumber: 1, redTeams: ["R1", "R2", "R3"], blueTeams: ["B1", "B2", "B3"], redScore: 40, blueScore: 30 })
    );
    state = opr.update(
      state,
      match({ matchKey: "2024test_qm2", matchNumber: 2, redTeams: ["R1", "B1", "B2"], blueTeams: ["R2", "R3", "B3"], redScore: 70, blueScore: 50 })
    );

    const stateAtI = state;
    const predictionAtI = opr.predict(stateAtI, upcoming);

    // Fold match i+1, a deliberately extreme score that would move the SD a lot.
    const stateAfter = opr.update(
      stateAtI,
      match({ matchKey: "2024test_qm3", matchNumber: 3, redTeams: ["R1", "R2", "R3"], blueTeams: ["B1", "B2", "B3"], redScore: 300, blueScore: 5 })
    );
    expect(stateAfter.allianceScoreStats.count).toBeGreaterThan(stateAtI.allianceScoreStats.count);

    // Re-predicting match i from the OLD state must be byte-identical: the
    // property, not a restatement of the implementation.
    const rePredicted = opr.predict(stateAtI, upcoming);
    expect(rePredicted.pRedWin).toBe(predictionAtI.pRedWin);
    expect(rePredicted.redScore).toBe(predictionAtI.redScore);
    expect(rePredicted.blueScore).toBe(predictionAtI.blueScore);
  });

  it("excludes a whole-alliance-DQ zero score from the fold, while the opposing alliance's real score still folds", () => {
    const before = opr.initState([]);
    const after = opr.update(
      before,
      match({
        matchKey: "2024test_qm1",
        matchNumber: 1,
        redTeams: ["R1", "R2", "R3"],
        blueTeams: ["B1", "B2", "B3"],
        redScore: 0,
        redDqs: ["R1", "R2", "R3"],
        blueScore: 88,
      })
    );
    // Exactly one score folded — blue's. Red's 0 is a ruling, not an observation.
    expect(after.allianceScoreStats.count).toBe(1);
    expect(after.allianceScoreStats.mean).toBeCloseTo(88, 10);
  });

  it("folds an all-surrogate alliance's real score even though it contributes no design-matrix row", () => {
    // This is the newRows.length === 0 early-return path: no ratings change,
    // but both scores were genuinely observed and belong in the scale.
    const after = opr.update(
      opr.initState([]),
      match({
        matchKey: "2024test_qm1",
        matchNumber: 1,
        redTeams: ["R1", "R2", "R3"],
        redSurrogates: ["R1", "R2", "R3"],
        blueTeams: ["B1", "B2", "B3"],
        blueSurrogates: ["B1", "B2", "B3"],
        redScore: 60,
        blueScore: 40,
      })
    );
    expect(after.perEvent.size).toBe(0); // nothing solved
    expect(after.allianceScoreStats.count).toBe(2); // both scores still folded
    expect(after.allianceScoreStats.mean).toBeCloseTo(50, 10);
  });
});

/** Every k-team combination drawn from `teams`, order-independent. */
function combinations<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [first, ...rest] = items;
  const withFirst = combinations(rest, k - 1).map((combo) => [first!, ...combo]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

describe("opr — end-to-end through WalkForwardSimulator (tracer)", () => {
  it("keeps two interleaved events' ratings independent, predicts each event's first match at exactly 0.5, and produces only finite, valid predictions", () => {
    // Two events' qualification matches strictly interleave in one
    // chronological stream, mirroring buildSeasonStream's real behavior —
    // a team ("SHARED") plays at both.
    const stream: MatchResult[] = [
      match({
        matchKey: "2024aaa_qm1",
        eventKey: "2024aaa",
        matchNumber: 1,
        redTeams: ["SHARED", "A1", "A2"],
        blueTeams: ["A3", "A4", "A5"],
        redScore: 30,
        blueScore: 20,
      }),
      match({
        matchKey: "2024bbb_qm1",
        eventKey: "2024bbb",
        matchNumber: 1,
        redTeams: ["SHARED", "B1", "B2"],
        blueTeams: ["B3", "B4", "B5"],
        redScore: 40,
        blueScore: 25,
      }),
      match({
        matchKey: "2024aaa_qm2",
        eventKey: "2024aaa",
        matchNumber: 2,
        redTeams: ["A1", "A3", "A4"],
        blueTeams: ["A2", "A5", "SHARED"],
        redScore: 35,
        blueScore: 28,
      }),
      match({
        matchKey: "2024bbb_qm2",
        eventKey: "2024bbb",
        matchNumber: 2,
        redTeams: ["B1", "B3", "B4"],
        blueTeams: ["B2", "B5", "SHARED"],
        redScore: 45,
        blueScore: 30,
      }),
    ];

    const simulator = new WalkForwardSimulator(stream);
    const records = simulator.runAll([opr], []);
    const finalState = records.finalStates.get("opr") as OprState;

    for (const record of records) {
      expect(Number.isFinite(record.prediction.pRedWin)).toBe(true);
      expect(record.prediction.pRedWin).toBeGreaterThanOrEqual(0);
      expect(record.prediction.pRedWin).toBeLessThanOrEqual(1);
      expect(Number.isFinite(record.prediction.redScore)).toBe(true);
      expect(Number.isFinite(record.prediction.blueScore)).toBe(true);
    }

    // D-02: the first qualification match of each event predicts exactly 0.5.
    const firstAaa = records.find((r) => r.match.matchKey === "2024aaa_qm1")!;
    const firstBbb = records.find((r) => r.match.matchKey === "2024bbb_qm1")!;
    expect(firstAaa.prediction.pRedWin).toBe(0.5);
    expect(firstAaa.prediction.redScore).toBe(0);
    expect(firstAaa.prediction.blueScore).toBe(0);
    expect(firstBbb.prediction.pRedWin).toBe(0.5);

    // D-01: a team present at both events holds two different ratings.
    const sharedAtAaa = finalState.perEvent.get("2024aaa")!.ratings.get("SHARED");
    const sharedAtBbb = finalState.perEvent.get("2024bbb")!.ratings.get("SHARED");
    expect(sharedAtAaa).toBeDefined();
    expect(sharedAtBbb).toBeDefined();
    expect(sharedAtAaa).not.toBe(sharedAtBbb);
  });
});

describe("opr — public export surface (SC-1)", () => {
  it("exports exactly the surviving symbols — no accidental re-export of retired season-pooled machinery, no accidental loss of a symbol epa.ts/identifiability.ts depend on", () => {
    expect(Object.keys(oprModule).sort()).toEqual([
      // D-Q4: OPR_LOGISTIC_SCALE retired — the fixed scale WAS the defect.
      "OPR_FALLBACK_SCORE_SD",
      "OPR_SCALE_DIVISOR_K",
      "allianceObservation",
      "opr",
      "ratingEligibleTeams",
      "solveEventOpr",
    ]);
  });

  it("identifies itself as opr, version 4.0.0+baseline", () => {
    expect(opr.id).toBe("opr");
    expect(opr.version).toBe("4.0.0+baseline");
  });
});

describe("opr — harness registry resolves to the rewritten module (SC-1)", () => {
  it("ALGORITHMS.opr (packages/harness/cli.ts) is the exact same object as the opr export from packages/core/algorithms/opr.ts", () => {
    expect(ALGORITHMS.opr).toBe(opr);
  });
});

describe("solveEventOpr — synthetic strength recovery without shrinkage (D-06)", () => {
  it("recovers known synthetic team strengths near-exactly at event scale (~39 teams) — no ridge term means no shrinkage bias to tolerate", () => {
    // Corpus-measured event scale: mean 38.7 / median 38 teams per event
    // (03.2-RESEARCH.md). Every 3-team combination among 39 teams (9139
    // alliances), scored as an exact sum of the true strengths (no noise)
    // — a well-connected, heavily overdetermined design matrix.
    const teamCount = 39;
    const teams = Array.from({ length: teamCount }, (_, i) => `T${i}`);
    const strengths = new Map(teams.map((team, i) => [team, 10 + ((i * 7) % 40)]));
    const alliances = combinations(teams, 3);
    const observations: OprObservation[] = alliances.map((allianceTeams) => ({
      teams: allianceTeams,
      allianceScore: allianceTeams.reduce((sum, t) => sum + strengths.get(t)!, 0),
    }));
    const teamIndex = buildTeamIndex(observations);
    const ratings = solveEventOpr(observations, teamIndex);

    for (const team of teams) {
      expect(ratings.get(team)).toBeDefined();
      expect(ratings.get(team)!).toBeCloseTo(strengths.get(team)!, 4);
    }
  });
});

describe("opr — literal-zero cold start (D-02)", () => {
  it("gives the first qualification match of an event a prediction of exactly {redScore: 0, blueScore: 0, pRedWin: 0.5} — no observations yet at this event", () => {
    const state: OprState = opr.initState([]);
    const upcoming: UpcomingMatch = {
      matchKey: "2024test_qm1",
      eventKey: "2024test",
      compLevel: "qm",
      setNumber: 1,
      matchNumber: 1,
      redTeams: ["A1", "A2", "A3"],
      blueTeams: ["A4", "A5", "A6"],
      redSurrogates: [],
      blueSurrogates: [],
      eventType: 0,
    };
    const prediction = opr.predict(state, upcoming);
    expect(prediction.redScore).toBe(0);
    expect(prediction.blueScore).toBe(0);
    expect(prediction.pRedWin).toBe(0.5);
  });
});

describe("opr — rank-deficient event scale stays finite", () => {
  it("returns an all-finite rating for every team in a ~39-team event fixture with only 4 qualification matches played (8 alliance rows, far fewer independent rows than teams)", () => {
    // Corpus-measured event scale (39 teams — 03.2-RESEARCH.md), but only 4
    // of an event's ~73 qualification matches played so far: massively
    // rank-deficient by construction, with no team repeating across
    // alliances. D-08: this measures the regime — no fallback, floor, or
    // seeded value is asserted, because none exists and none is added.
    const teamCount = 39;
    const teams = Array.from({ length: teamCount }, (_, i) => `R${i}`);
    let state: OprState = opr.initState([]);
    for (let m = 0; m < 4; m++) {
      const redTeams = teams.slice(m * 6, m * 6 + 3);
      const blueTeams = teams.slice(m * 6 + 3, m * 6 + 6);
      state = opr.update(
        state,
        match({
          matchKey: `2024rank_qm${m + 1}`,
          eventKey: "2024rank",
          matchNumber: m + 1,
          redTeams,
          blueTeams,
          redScore: 30 + m,
          blueScore: 25 + m,
        })
      );
    }

    const ratings = ratingsAt(state, "2024rank");
    expect(ratings.size).toBe(24); // 4 matches x 6 rating-eligible teams each
    for (const [, rating] of ratings) {
      expect(Number.isFinite(rating)).toBe(true);
    }
  });
});

describe("opr — per-event keying under interleaved events (D-01)", () => {
  it("gives each event exactly the ratings a solo run over that event's own matches (in isolation) would produce, even when the events' matches interleave in one stream", () => {
    const sharedTeam = "SHARED";

    function eventAMatches(): MatchResult[] {
      return [
        match({ matchKey: "2024eventa_qm1", eventKey: "2024eventa", matchNumber: 1, redTeams: [sharedTeam, "A1", "A2"], blueTeams: ["A3", "A4", "A5"], redScore: 30, blueScore: 22 }),
        match({ matchKey: "2024eventa_qm2", eventKey: "2024eventa", matchNumber: 2, redTeams: ["A1", "A3", sharedTeam], blueTeams: ["A2", "A4", "A5"], redScore: 35, blueScore: 25 }),
        match({ matchKey: "2024eventa_qm3", eventKey: "2024eventa", matchNumber: 3, redTeams: ["A4", "A5", "A1"], blueTeams: [sharedTeam, "A2", "A3"], redScore: 20, blueScore: 33 }),
      ];
    }
    function eventBMatches(): MatchResult[] {
      return [
        match({ matchKey: "2024eventb_qm1", eventKey: "2024eventb", matchNumber: 1, redTeams: [sharedTeam, "B1", "B2"], blueTeams: ["B3", "B4", "B5"], redScore: 45, blueScore: 27 }),
        match({ matchKey: "2024eventb_qm2", eventKey: "2024eventb", matchNumber: 2, redTeams: ["B1", "B3", sharedTeam], blueTeams: ["B2", "B4", "B5"], redScore: 50, blueScore: 24 }),
        match({ matchKey: "2024eventb_qm3", eventKey: "2024eventb", matchNumber: 3, redTeams: ["B4", "B5", "B1"], blueTeams: [sharedTeam, "B2", "B3"], redScore: 18, blueScore: 40 }),
      ];
    }

    // Interleaved: A1, B1, A2, B2, A3, B3 — mirrors buildSeasonStream's
    // real cross-event interleaving.
    const [a1, a2, a3] = eventAMatches();
    const [b1, b2, b3] = eventBMatches();
    let interleavedState: OprState = opr.initState([]);
    for (const m of [a1!, b1!, a2!, b2!, a3!, b3!]) {
      interleavedState = opr.update(interleavedState, m);
    }

    // Solo: each event replayed completely alone, in its own event-only order.
    let soloAState: OprState = opr.initState([]);
    for (const m of eventAMatches()) soloAState = opr.update(soloAState, m);
    let soloBState: OprState = opr.initState([]);
    for (const m of eventBMatches()) soloBState = opr.update(soloBState, m);

    expect([...ratingsAt(interleavedState, "2024eventa").entries()]).toEqual([...ratingsAt(soloAState, "2024eventa").entries()]);
    expect([...ratingsAt(interleavedState, "2024eventb").entries()]).toEqual([...ratingsAt(soloBState, "2024eventb").entries()]);

    // The shared team holds two distinct ratings, one per event.
    const sharedAtA = ratingsAt(interleavedState, "2024eventa").get(sharedTeam);
    const sharedAtB = ratingsAt(interleavedState, "2024eventb").get(sharedTeam);
    expect(sharedAtA).toBeDefined();
    expect(sharedAtB).toBeDefined();
    expect(sharedAtA).not.toBe(sharedAtB);
  });
});

describe("opr — qualification matches only feed the fit (D-05)", () => {
  it("update() is a no-op on playoff comp levels (state.perEvent unchanged) while predict() still returns a finite prediction for them, reflecting the ratings this event's quals produced", () => {
    let state: OprState = opr.initState([]);
    state = opr.update(
      state,
      match({ matchKey: "2024test_qm1", eventKey: "2024test", redTeams: ["A1", "A2", "A3"], blueTeams: ["A4", "A5", "A6"], redScore: 30, blueScore: 25 })
    );
    const beforePerEvent = state.perEvent;

    for (const compLevel of ["sf", "f"] as const) {
      const playoffMatch = match({
        matchKey: `2024test_${compLevel}1`,
        eventKey: "2024test",
        compLevel,
        redTeams: ["A1", "A4", "A2"],
        blueTeams: ["A3", "A5", "A6"],
        redScore: 50,
        blueScore: 45,
      });

      const nextState = opr.update(state, playoffMatch);
      expect(nextState).toBe(state); // A genuine no-op — the identical object.
      expect(nextState.perEvent).toBe(beforePerEvent);

      const prediction = opr.predict(state, playoffMatch);
      expect(Number.isFinite(prediction.pRedWin)).toBe(true);
      expect(prediction.pRedWin).toBeGreaterThanOrEqual(0);
      expect(prediction.pRedWin).toBeLessThanOrEqual(1);
      expect(Number.isFinite(prediction.redScore)).toBe(true);
      expect(Number.isFinite(prediction.blueScore)).toBe(true);
    }
  });
});

describe("opr.teamMetrics — most recent event headlines (D-04)", () => {
  it("headlines a team's MOST RECENT event, not the event it was first inserted into — a team playing event B before event A finishes in stream order still headlines A", () => {
    let state: OprState = opr.initState([]);
    // Event B is seen FIRST in stream order (so perEvent's insertion order
    // would wrongly point at B if teamMetrics inferred from it).
    state = opr.update(
      state,
      match({ matchKey: "2024eventb_qm1", eventKey: "2024eventb", redTeams: ["SHARED", "B1", "B2"], blueTeams: ["B3", "B4", "B5"], redScore: 40, blueScore: 30 })
    );
    // Event A is seen SECOND — it is SHARED's most recent event.
    state = opr.update(
      state,
      match({ matchKey: "2024eventa_qm1", eventKey: "2024eventa", redTeams: ["SHARED", "A1", "A2"], blueTeams: ["A3", "A4", "A5"], redScore: 35, blueScore: 20 })
    );

    const expectedRating = ratingsAt(state, "2024eventa").get("SHARED");
    expect(expectedRating).toBeDefined();
    const metrics = opr.teamMetrics(state, ["SHARED"]);
    expect(metrics["SHARED"]![TOTAL_METRIC_KEY]!.value).toBe(expectedRating);
  });

  it("never registers a team in lastEventByTeam from a playoff-only appearance at an event (D-05: update() never touches lastEventByTeam for a non-qm match)", () => {
    let state: OprState = opr.initState([]);
    state = opr.update(
      state,
      match({
        matchKey: "2024test_sf1",
        eventKey: "2024test",
        compLevel: "sf",
        redTeams: ["P1", "P2", "P3"],
        blueTeams: ["P4", "P5", "P6"],
        redScore: 40,
        blueScore: 35,
      })
    );
    expect(state.lastEventByTeam.has("P1")).toBe(false);
  });
});

describe("opr — finiteness guard throws loudly (01-REVIEW WR-01, D-03)", () => {
  it("throws when an alliance's score is non-finite, naming the eventKey, instead of writing a non-finite rating into the returned state", () => {
    let state: OprState = opr.initState([]);
    // Establish a well-connected event first so the corrupted match shares
    // a team with real observations, forcing the corruption to propagate
    // through the solve rather than staying isolated.
    state = opr.update(
      state,
      match({ matchKey: "2024test_qm1", eventKey: "2024test", redTeams: ["A1", "A2", "A3"], blueTeams: ["A4", "A5", "A6"], redScore: 30, blueScore: 25 })
    );

    expect(() =>
      opr.update(
        state,
        match({
          matchKey: "2024test_qm2",
          eventKey: "2024test",
          redTeams: ["A1", "A7", "A8"],
          blueTeams: ["A9", "A10", "A11"],
          redScore: Number.NaN,
          blueScore: 20,
        })
      )
    ).toThrow(/2024test/);
  });
});

describe("opr — update purity", () => {
  it("returns a new state and leaves the input state structurally unchanged", () => {
    let state: OprState = opr.initState([]);
    state = opr.update(
      state,
      match({ matchKey: "2024test_qm1", redTeams: ["A1", "A2", "A3"], blueTeams: ["A4", "A5", "A6"], redScore: 30, blueScore: 25 })
    );
    const beforePerEvent = state.perEvent;
    const beforeLastEventByTeam = state.lastEventByTeam;
    const snapshot = (s: OprState): string =>
      JSON.stringify(
        [...s.perEvent.entries()].map(([eventKey, es]) => [eventKey, es.observations, [...es.ratings.entries()]])
      );
    const beforeSnapshot = snapshot(state);

    const nextState = opr.update(
      state,
      match({ matchKey: "2024test_qm2", redTeams: ["A7", "A8", "A9"], blueTeams: ["A10", "A11", "A12"], redScore: 20, blueScore: 22 })
    );

    // The input state's own top-level maps still reference the exact same
    // objects — update() never mutated it in place.
    expect(state.perEvent).toBe(beforePerEvent);
    expect(state.lastEventByTeam).toBe(beforeLastEventByTeam);
    expect(snapshot(state)).toBe(beforeSnapshot);

    // The returned state is a genuinely different object.
    expect(nextState).not.toBe(state);
    expect(nextState.perEvent).not.toBe(state.perEvent);
  });
});

describe("opr — predict determinism and non-mutation", () => {
  it("returns equal predictions for the same state and match, and does not alter the state", () => {
    let state: OprState = opr.initState([]);
    state = opr.update(
      state,
      match({ matchKey: "2024test_qm1", redTeams: ["A1", "A2", "A3"], blueTeams: ["A4", "A5", "A6"], redScore: 30, blueScore: 25 })
    );
    const upcoming: UpcomingMatch = {
      matchKey: "2024test_qm2",
      eventKey: "2024test",
      compLevel: "qm",
      setNumber: 1,
      matchNumber: 2,
      redTeams: ["A1", "A4", "A7"],
      blueTeams: ["A2", "A5", "A8"],
      redSurrogates: [],
      blueSurrogates: [],
      eventType: 0,
    };
    const beforePerEvent = state.perEvent;
    const beforeLastEventByTeam = state.lastEventByTeam;

    const p1 = opr.predict(state, upcoming);
    const p2 = opr.predict(state, upcoming);

    expect(p1).toEqual(p2);
    expect(state.perEvent).toBe(beforePerEvent);
    expect(state.lastEventByTeam).toBe(beforeLastEventByTeam);
  });

  it("returns a red-win probability strictly inside the open interval (0, 1) for any finite score pair", () => {
    let state: OprState = opr.initState([]);
    state = opr.update(
      state,
      match({ matchKey: "2024test_qm1", redTeams: ["A1", "A2", "A3"], blueTeams: ["A4", "A5", "A6"], redScore: 200, blueScore: 5 })
    );
    const upcoming: UpcomingMatch = {
      matchKey: "2024test_qm2",
      eventKey: "2024test",
      compLevel: "qm",
      setNumber: 1,
      matchNumber: 2,
      redTeams: ["A1"],
      blueTeams: ["A6"],
      redSurrogates: [],
      blueSurrogates: [],
      eventType: 0,
    };
    const prediction = opr.predict(state, upcoming);
    expect(prediction.pRedWin).toBeGreaterThan(0);
    expect(prediction.pRedWin).toBeLessThan(1);
  });

  it("gives a red-win probability of exactly 0.5 when the predicted score margin is zero", () => {
    const state: OprState = opr.initState([]);
    const upcoming: UpcomingMatch = {
      matchKey: "2024test_qm1",
      eventKey: "2024test",
      compLevel: "qm",
      setNumber: 1,
      matchNumber: 1,
      redTeams: ["A1", "A2", "A3"],
      blueTeams: ["A4", "A5", "A6"],
      redSurrogates: [],
      blueSurrogates: [],
      eventType: 0,
    };
    // No ratings yet — both alliances predict to 0, margin is exactly 0.
    const prediction = opr.predict(state, upcoming);
    expect(prediction.redScore).toBe(0);
    expect(prediction.blueScore).toBe(0);
    expect(prediction.pRedWin).toBe(0.5);
  });
});

describe("ratingEligibleTeams / allianceObservation — D-07 surrogate handling", () => {
  it("excludes the surrogate's column while keeping its non-surrogate teammates", () => {
    expect(ratingEligibleTeams(["T1", "T2", "SURR"], ["SURR"])).toEqual(["T1", "T2"]);
  });

  it("computes the non-surrogate teammates' observed target as the alliance score minus the surrogate's current rating", () => {
    const ratings = new Map([["SURR", 20]]);
    const observation = allianceObservation(["T1", "T2", "SURR"], ["SURR"], 90, ratings, 15);
    expect(observation.teams).toEqual(["T1", "T2"]);
    expect(observation.allianceScore).toBe(90 - 20);
  });

  it("uses the league-mean per-team share as the offset for a surrogate with no prior rating, and does not throw", () => {
    const ratings = new Map<string, number>();
    expect(() => allianceObservation(["T1", "T2", "SURR"], ["SURR"], 90, ratings, 12)).not.toThrow();
    const observation = allianceObservation(["T1", "T2", "SURR"], ["SURR"], 90, ratings, 12);
    expect(observation.allianceScore).toBe(90 - 12);
  });
});

describe("opr — surrogate appearances leave the surrogate's rating untouched", () => {
  it("a team appearing as a surrogate at a different event never receives a rating there, and its rating at its real event is unaffected (D-01 event isolation)", () => {
    let state: OprState = opr.initState([]);
    // Match 1 (event A): T1 is a normal participant, earns a real rating.
    state = opr.update(
      state,
      match({
        matchKey: "2024eventa_qm1",
        eventKey: "2024eventa",
        redTeams: ["T1", "P1", "P2"],
        blueTeams: ["P3", "P4", "P5"],
        redScore: 30,
        blueScore: 27,
      })
    );
    const eventARatingsBefore = ratingsAt(state, "2024eventa");
    const ratingAfterMatch1 = eventARatingsBefore.get("T1");
    expect(ratingAfterMatch1).toBeDefined();

    // Match 2 (event B, a completely different event): T1 appears only as
    // a surrogate on a disjoint roster.
    state = opr.update(
      state,
      match({
        matchKey: "2024eventb_qm1",
        eventKey: "2024eventb",
        redTeams: ["T1", "P6", "P7"],
        redSurrogates: ["T1"],
        blueTeams: ["P8", "P9", "P10"],
        redScore: 33,
        blueScore: 29,
      })
    );

    // Event A's per-event ratings are untouched — same Map reference even.
    expect(ratingsAt(state, "2024eventa")).toBe(eventARatingsBefore);
    expect(ratingsAt(state, "2024eventa").get("T1")).toBe(ratingAfterMatch1);
    // T1 never appears in event B's ratings — it was always a surrogate there.
    expect(ratingsAt(state, "2024eventb").has("T1")).toBe(false);
  });

  it("a team appearing normally at one event accumulates exactly one observation there, and none at an event where it only ever appeared as a surrogate", () => {
    let state: OprState = opr.initState([]);
    state = opr.update(
      state,
      match({
        matchKey: "2024eventa_qm1",
        eventKey: "2024eventa",
        redTeams: ["T1", "P1", "P2"],
        blueTeams: ["P3", "P4", "P5"],
        redScore: 30,
        blueScore: 27,
      })
    );
    state = opr.update(
      state,
      match({
        matchKey: "2024eventb_qm1",
        eventKey: "2024eventb",
        redTeams: ["T1", "P6", "P7"],
        redSurrogates: ["T1"],
        blueTeams: ["P8", "P9", "P10"],
        redScore: 33,
        blueScore: 29,
      })
    );

    expect(observationsAt(state, "2024eventa").filter((o) => o.teams.includes("T1")).length).toBe(1);
    expect(observationsAt(state, "2024eventb").filter((o) => o.teams.includes("T1")).length).toBe(0);
  });
});

describe("opr — disqualification policy (Open Question 3): opposite of surrogates", () => {
  it("a disqualified team's rating is updated from the match it was disqualified in — MatchResult carries no dq field, so a dq'd participant is indistinguishable from any other and keeps its column", () => {
    let state: OprState = opr.initState([]);
    // "DQd" here means: the team physically played and appears in redTeams
    // like any other participant — there is no dq flag on MatchResult to
    // exclude it with (see allianceObservation's disqualification-policy
    // comment). This proves the column is kept and the rating updates.
    state = opr.update(
      state,
      match({
        matchKey: "2024eventa_qm1",
        eventKey: "2024eventa",
        redTeams: ["DQD_TEAM", "P1", "P2"],
        blueTeams: ["P3", "P4", "P5"],
        redScore: 30,
        blueScore: 27,
      })
    );

    expect(ratingsAt(state, "2024eventa").has("DQD_TEAM")).toBe(true);
    const observationsForDq = observationsAt(state, "2024eventa").filter((o) => o.teams.includes("DQD_TEAM"));
    expect(observationsForDq.length).toBe(1);
  });

  it("partial DQ (redDqs populated but not covering the whole alliance) still contributes exactly as if redDqs were empty — leave it exactly as today", () => {
    let withPartialDq: OprState = opr.initState([]);
    withPartialDq = opr.update(
      withPartialDq,
      match({
        matchKey: "2024eventa_qm1",
        eventKey: "2024eventa",
        redTeams: ["D1", "P1", "P2"],
        blueTeams: ["frc4", "frc5", "frc6"],
        redDqs: ["D1"],
        redScore: 68,
        blueScore: 40,
      })
    );

    let withoutDq: OprState = opr.initState([]);
    withoutDq = opr.update(
      withoutDq,
      match({
        matchKey: "2024eventa_qm1",
        eventKey: "2024eventa",
        redTeams: ["D1", "P1", "P2"],
        blueTeams: ["frc4", "frc5", "frc6"],
        redDqs: [],
        redScore: 68,
        blueScore: 40,
      })
    );

    // redDqs alone (without covering every rating-eligible team AND a zero
    // score) must never change the fit — byte-identical either way.
    expect(ratingsAt(withPartialDq, "2024eventa")).toEqual(ratingsAt(withoutDq, "2024eventa"));
    expect(ratingsAt(withPartialDq, "2024eventa").has("D1")).toBe(true);
  });
});

describe("opr — whole-alliance DQ zero-score exclusion (.planning/todos/pending/exclude-whole-alliance-dq-zero-scores.md)", () => {
  it("a fully-DQ'd, zero-score alliance contributes NO observation — byte-identical to an all-surrogate alliance's existing no-op treatment, and the opposing alliance's real score still updates", () => {
    let viaDq: OprState = opr.initState([]);
    viaDq = opr.update(
      viaDq,
      match({
        matchKey: "2024eventa_qm1",
        eventKey: "2024eventa",
        redTeams: ["D1", "D2", "D3"],
        blueTeams: ["frc1", "frc2", "frc3"],
        redDqs: ["D1", "D2", "D3"],
        redScore: 0,
        blueScore: 90,
      })
    );

    let viaSurrogate: OprState = opr.initState([]);
    viaSurrogate = opr.update(
      viaSurrogate,
      match({
        matchKey: "2024eventa_qm1",
        eventKey: "2024eventa",
        redTeams: ["D1", "D2", "D3"],
        blueTeams: ["frc1", "frc2", "frc3"],
        redSurrogates: ["D1", "D2", "D3"],
        redScore: 0,
        blueScore: 90,
      })
    );

    expect(ratingsAt(viaDq, "2024eventa")).toEqual(ratingsAt(viaSurrogate, "2024eventa"));
    expect(ratingsAt(viaDq, "2024eventa").has("D1")).toBe(false);
    expect(observationsAt(viaDq, "2024eventa").some((o) => o.teams.includes("D1"))).toBe(false);
    // Blue's real observation is untouched — this is a per-alliance drop,
    // never a whole-match drop like isFullyDemoAlliance's.
    expect(ratingsAt(viaDq, "2024eventa").has("frc1")).toBe(true);
  });

  it("guards the inverse error: a whole-alliance DQ with a NON-zero recorded score is still counted, exactly like an ordinary observation", () => {
    let withNonZeroDq: OprState = opr.initState([]);
    withNonZeroDq = opr.update(
      withNonZeroDq,
      match({
        matchKey: "2024eventa_qm1",
        eventKey: "2024eventa",
        redTeams: ["D1", "D2", "D3"],
        blueTeams: ["frc1", "frc2", "frc3"],
        redDqs: ["D1", "D2", "D3"],
        redScore: 45,
        blueScore: 30,
      })
    );

    let noDq: OprState = opr.initState([]);
    noDq = opr.update(
      noDq,
      match({
        matchKey: "2024eventa_qm1",
        eventKey: "2024eventa",
        redTeams: ["D1", "D2", "D3"],
        blueTeams: ["frc1", "frc2", "frc3"],
        redDqs: [],
        redScore: 45,
        blueScore: 30,
      })
    );

    // A non-zero score for a whole-alliance DQ must be fitted exactly as if
    // no DQ were recorded at all — the todo's own named guard against the
    // inverse error.
    expect(ratingsAt(withNonZeroDq, "2024eventa")).toEqual(ratingsAt(noDq, "2024eventa"));
    expect(ratingsAt(withNonZeroDq, "2024eventa").has("D1")).toBe(true);
  });
});

describe("opr — off-season demo team exclusion (frc9970-frc9999, demoTeams.ts)", () => {
  it("case 1: a fully-demo alliance never updates ANY rating for either alliance, even at a qm comp level where OPR would otherwise fold it", () => {
    let withForfeit: OprState = opr.initState([]);
    withForfeit = opr.update(
      withForfeit,
      match({
        matchKey: "2024eventa_qm1",
        eventKey: "2024eventa",
        redTeams: ["frc1", "frc2", "frc3"],
        blueTeams: ["frc9970", "frc9971", "frc9972"],
        redScore: 90,
        blueScore: 5,
      })
    );
    withForfeit = opr.update(
      withForfeit,
      match({
        matchKey: "2024eventa_qm2",
        eventKey: "2024eventa",
        redTeams: ["frc1", "frc4", "frc5"],
        blueTeams: ["frc2", "frc3", "frc6"],
        redScore: 60,
        blueScore: 70,
      })
    );

    let withoutForfeit: OprState = opr.initState([]);
    withoutForfeit = opr.update(
      withoutForfeit,
      match({
        matchKey: "2024eventa_qm2",
        eventKey: "2024eventa",
        redTeams: ["frc1", "frc4", "frc5"],
        blueTeams: ["frc2", "frc3", "frc6"],
        redScore: 60,
        blueScore: 70,
      })
    );

    // Replaying the forfeit match first, versus never replaying it at all,
    // must produce byte-identical event ratings — a genuine no-op, not
    // merely "small effect".
    expect(ratingsAt(withForfeit, "2024eventa")).toEqual(ratingsAt(withoutForfeit, "2024eventa"));
    // And no rating exists for the demo pseudo entity itself — the forfeit
    // row was never folded, not folded-then-hidden.
    expect(ratingsAt(withForfeit, "2024eventa").has(DEMO_PSEUDO_TEAM_KEY)).toBe(false);
  });

  it("case 2: a real teammate of a mixed alliance is NOT inflated by the demo exclusion — quantified against what naive column deletion would have produced", () => {
    // Chosen treatment: the demo slot is REMAPPED to the shared pseudo key,
    // not deleted — allianceObservation (via ratingEligibleTeams) keeps all
    // three columns.
    const chosenObservation = allianceObservation(["frc1", "frc2", "frc9985"], [], 90, new Map(), 30);
    expect(chosenObservation.teams).toEqual(["frc1", "frc2", DEMO_PSEUDO_TEAM_KEY]);
    expect(chosenObservation.allianceScore).toBe(90); // no offset subtracted — unlike a surrogate, the demo slot is kept, not paid out of the target.
    const chosenRatings = solveEventOpr([chosenObservation], buildTeamIndex([chosenObservation]));

    // Naive alternative this design explicitly rejects: delete the demo
    // team's column outright but keep the alliance's full observed score —
    // exactly the bug the central design constraint warns against.
    const naiveObservation: OprObservation = { teams: ["frc1", "frc2"], allianceScore: 90 };
    const naiveRatings = solveEventOpr([naiveObservation], buildTeamIndex([naiveObservation]));

    // Minimum-norm least squares on a single "a+b+c=90" equation splits it
    // three ways; naive deletion's "a+b=90" splits it two ways instead.
    expect(chosenRatings.get("frc1")).toBeCloseTo(30, 9);
    expect(chosenRatings.get("frc2")).toBeCloseTo(30, 9);
    expect(naiveRatings.get("frc1")).toBeCloseTo(45, 9);
    expect(naiveRatings.get("frc2")).toBeCloseTo(45, 9);
    // The quantified difference this todo requires be reported: naive
    // deletion would have inflated frc1's fitted rating by a full 50%
    // (45 vs 30) relative to the chosen treatment, for this one match alone.
    expect(naiveRatings.get("frc1")!).toBeGreaterThan(chosenRatings.get("frc1")!);
    expect(naiveRatings.get("frc1")! / chosenRatings.get("frc1")!).toBeCloseTo(1.5, 9);
  });

  it("case 2, end-to-end through update(): a real team's rating after playing beside one demo teammate is IDENTICAL to playing beside a normal third teammate, given the same alliance score", () => {
    let withDemo: OprState = opr.initState([]);
    withDemo = opr.update(
      withDemo,
      match({
        matchKey: "2024eventa_qm1",
        eventKey: "2024eventa",
        redTeams: ["frc1", "frc2", "frc9985"],
        blueTeams: ["frc4", "frc5", "frc6"],
        redScore: 90,
        blueScore: 60,
      })
    );

    let withRealThird: OprState = opr.initState([]);
    withRealThird = opr.update(
      withRealThird,
      match({
        matchKey: "2024eventa_qm1",
        eventKey: "2024eventa",
        redTeams: ["frc1", "frc2", "frc3"],
        blueTeams: ["frc4", "frc5", "frc6"],
        redScore: 90,
        blueScore: 60,
      })
    );

    expect(ratingsAt(withDemo, "2024eventa").get("frc1")).toBeCloseTo(ratingsAt(withRealThird, "2024eventa").get("frc1")!, 9);
    expect(ratingsAt(withDemo, "2024eventa").get("frc2")).toBeCloseTo(ratingsAt(withRealThird, "2024eventa").get("frc2")!, 9);
  });

  it("two demo teammates on one real alliance: the design-matrix column accumulates to 2 (not overwritten to 1), and even this single-equation minimum-norm split leaves the real teammate FAR below what naive column deletion would have produced", () => {
    let state: OprState = opr.initState([]);
    state = opr.update(
      state,
      match({
        matchKey: "2024eventa_qm1",
        eventKey: "2024eventa",
        redTeams: ["frc1", "frc9985", "frc9990"],
        blueTeams: ["frc4", "frc5", "frc6"],
        redScore: 90,
        blueScore: 60,
      })
    );
    // Minimum-norm least squares on "a + 2c = 90" (frc1's column coefficient
    // 1, the pseudo column's coefficient 2, from `M.get(row, idx) + 1`
    // accumulating both demo occurrences into the same column) solves to
    // (a, c) = 90/5 * (1, 2) = (18, 36) — NOT an even 30/30/30 three-way
    // split. Minimum-norm weighting favors a higher-coefficient column, a
    // property of the L2-minimization objective itself (the identical split
    // would occur for any repeated real-team column, not something specific
    // to how demo teams are modeled) — documented here rather than assumed.
    expect(ratingsAt(state, "2024eventa").get("frc1")).toBeCloseTo(18, 9);
    expect(ratingsAt(state, "2024eventa").get(DEMO_PSEUDO_TEAM_KEY)).toBeCloseTo(36, 9);

    // The quantified comparison that matters: naive deletion of BOTH demo
    // columns (dropping them from the design matrix entirely while keeping
    // the alliance's full observed score, exactly the bug this design
    // avoids) collapses this same match to the single equation "a = 90" —
    // frc1 alone credited with the WHOLE alliance score.
    const naiveObservation: OprObservation = { teams: ["frc1"], allianceScore: 90 };
    const naiveRatings = solveEventOpr([naiveObservation], buildTeamIndex([naiveObservation]));
    expect(naiveRatings.get("frc1")).toBeCloseTo(90, 9);
    // Chosen (18) is 5x LESS than naive deletion would have produced (90) —
    // the real teammate is not inflated under the chosen treatment, even in
    // this two-demo-teammate edge case where the minimum-norm split itself
    // is not a perfectly even three-way share.
    expect(naiveRatings.get("frc1")! / ratingsAt(state, "2024eventa").get("frc1")!).toBeCloseTo(5, 9);
  });
});
