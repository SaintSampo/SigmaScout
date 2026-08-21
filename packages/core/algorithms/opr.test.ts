/**
 * Synthetic-fixture tests for the event-scoped, quals-only, no-ridge OPR
 * baseline (Phase 3.2, D-01/D-02/D-03/D-05/D-06). Every fixture here has a
 * known answer or a provable structural property, so a failure points at
 * the math, not at the corpus.
 */
import { describe, expect, it } from "vitest";
import {
  OPR_LOGISTIC_SCALE,
  allianceObservation,
  opr,
  ratingEligibleTeams,
  solveEventOpr,
  type OprObservation,
  type OprState,
} from "./opr.js";
import { TOTAL_METRIC_KEY, type MatchResult, type UpcomingMatch } from "./types.js";
import { WalkForwardSimulator } from "../../harness/replay.js";

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

describe("OPR_LOGISTIC_SCALE", () => {
  it("is an exported positive constant", () => {
    expect(OPR_LOGISTIC_SCALE).toBeGreaterThan(0);
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
});
