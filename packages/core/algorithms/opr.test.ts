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
import type { MatchResult, UpcomingMatch } from "./types.js";
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

describe("solveEventOpr — synthetic strength recovery", () => {
  it("recovers known synthetic team strengths near-exactly — no ridge shrinkage to tolerate", () => {
    const strengths: Record<string, number> = {
      T1: 20,
      T2: 25,
      T3: 15,
      T4: 10,
      T5: 30,
      T6: 5,
      T7: 22,
      T8: 18,
    };
    const teams = Object.keys(strengths);
    // Every 3-team combination among 8 teams (56 alliances), scored as an
    // exact sum of the true strengths (no noise) — a well-connected,
    // overdetermined design matrix.
    const alliances = combinations(teams, 3);
    const observations: OprObservation[] = alliances.map((allianceTeams) => ({
      teams: allianceTeams,
      allianceScore: allianceTeams.reduce((sum, t) => sum + strengths[t]!, 0),
    }));
    const teamIndex = buildTeamIndex(observations);
    const ratings = solveEventOpr(observations, teamIndex);

    for (const team of teams) {
      expect(ratings.get(team)).toBeDefined();
      // D-06: no ridge term means no shrinkage bias to tolerate — the
      // minimum-norm solve recovers the exact synthetic strengths.
      expect(ratings.get(team)!).toBeCloseTo(strengths[team]!, 6);
    }
  });
});

describe("opr — cold start / under-determined regime", () => {
  it("returns a finite rating for every team in a two-match, many-team system with more teams than independent observations", () => {
    // 2 matches, 4 alliance observations, 12 unique teams that never repeat
    // across alliances — massively rank-deficient at this event.
    let state: OprState = opr.initState([]);
    state = opr.update(
      state,
      match({ matchKey: "2024test_qm1", redTeams: ["A1", "A2", "A3"], blueTeams: ["A4", "A5", "A6"], redScore: 30, blueScore: 25 })
    );
    state = opr.update(
      state,
      match({ matchKey: "2024test_qm2", redTeams: ["A7", "A8", "A9"], blueTeams: ["A10", "A11", "A12"], redScore: 40, blueScore: 35 })
    );

    const allTeams = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "A11", "A12"];
    const ratings = ratingsAt(state, "2024test");
    expect(ratings.size).toBe(12);
    for (const team of allTeams) {
      const rating = ratings.get(team);
      expect(rating).toBeDefined();
      expect(Number.isFinite(rating)).toBe(true);
    }
  });

  it("gives the first qualification match of an event a literal-zero cold-start prediction (D-02)", () => {
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
