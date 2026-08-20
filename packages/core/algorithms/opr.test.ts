/**
 * Synthetic-fixture tests for the season-pooled, ridge-regularized OPR
 * baseline (RESEARCH.md Pattern 4, Pitfall 2). Every fixture here has a
 * known answer or a provable structural property, so a failure points at
 * the math, not at the corpus.
 */
import { describe, expect, it } from "vitest";
import {
  OPR_LOGISTIC_SCALE,
  OPR_RIDGE_LAMBDA,
  allianceObservation,
  opr,
  ratingEligibleTeams,
  solveRidgeOpr,
  type OprObservation,
  type OprState,
} from "./opr.js";
import type { MatchResult, UpcomingMatch } from "./types.js";

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

describe("OPR_RIDGE_LAMBDA / OPR_LOGISTIC_SCALE", () => {
  it("are exported positive constants", () => {
    expect(OPR_RIDGE_LAMBDA).toBeGreaterThan(0);
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

describe("solveRidgeOpr — synthetic strength recovery", () => {
  it("recovers known synthetic team strengths within a documented tolerance", () => {
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
    // exact sum of the true strengths (no noise) — enough independent,
    // overlapping rows that ridge bias becomes small relative to signal.
    const alliances = combinations(teams, 3);
    const observations: OprObservation[] = alliances.map((allianceTeams) => ({
      teams: allianceTeams,
      allianceScore: allianceTeams.reduce((sum, t) => sum + strengths[t]!, 0),
    }));
    const teamIndex = buildTeamIndex(observations);
    const ratings = solveRidgeOpr(observations, teamIndex);

    for (const team of teams) {
      expect(ratings.get(team)).toBeDefined();
      // Documented tolerance: within 4 points of true strength (measured
      // ridge bias at lambda=3 over this 56-observation, 8-team fixture
      // peaks around 2.8; 4 leaves headroom without being loose enough to
      // pass a badly wrong solve).
      expect(Math.abs(ratings.get(team)! - strengths[team]!)).toBeLessThan(4);
    }
  });
});

describe("opr — cold start / under-determined regime", () => {
  it("returns a finite rating for every team in a two-match, many-team system with more teams than independent observations", () => {
    // 2 matches, 4 alliance observations, 12 unique teams that never repeat
    // across alliances — massively rank-deficient without the ridge term.
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
    expect(state.ratings.size).toBe(12);
    for (const team of allTeams) {
      const rating = state.ratings.get(team);
      expect(rating).toBeDefined();
      expect(Number.isFinite(rating)).toBe(true);
    }
  });

  it("keeps every rating between zero and the observed mean alliance score, demonstrating shrinkage toward the mean rather than divergence", () => {
    let state: OprState = opr.initState([]);
    state = opr.update(
      state,
      match({ matchKey: "2024test_qm1", redTeams: ["A1", "A2", "A3"], blueTeams: ["A4", "A5", "A6"], redScore: 30, blueScore: 25 })
    );
    state = opr.update(
      state,
      match({ matchKey: "2024test_qm2", redTeams: ["A7", "A8", "A9"], blueTeams: ["A10", "A11", "A12"], redScore: 40, blueScore: 35 })
    );

    const observedMean = (30 + 25 + 40 + 35) / 4;
    for (const rating of state.ratings.values()) {
      expect(rating).toBeGreaterThanOrEqual(0);
      expect(rating).toBeLessThanOrEqual(observedMean);
    }
  });
});

describe("opr — season-scope pooling across events", () => {
  it("gives a team that has played at two different events both events' observations in its rating as of a match at the second event", () => {
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
        blueTeams: ["P8", "P9", "P10"],
        redScore: 33,
        blueScore: 29,
      })
    );

    const observationsForT1 = state.observations.filter((o) => o.teams.includes("T1"));
    expect(observationsForT1.length).toBe(2);
  });
});

describe("opr — update purity", () => {
  it("returns a new state and leaves the input state structurally unchanged", () => {
    let state: OprState = opr.initState([]);
    state = opr.update(
      state,
      match({ matchKey: "2024test_qm1", redTeams: ["A1", "A2", "A3"], blueTeams: ["A4", "A5", "A6"], redScore: 30, blueScore: 25 })
    );
    const beforeObservations = state.observations;
    const beforeRatings = state.ratings;
    const beforeObservationsSnapshot = JSON.stringify(state.observations);
    const beforeRatingsSnapshot = JSON.stringify([...state.ratings.entries()]);

    const nextState = opr.update(
      state,
      match({ matchKey: "2024test_qm2", redTeams: ["A7", "A8", "A9"], blueTeams: ["A10", "A11", "A12"], redScore: 20, blueScore: 22 })
    );

    // The input state's own properties still reference the exact same
    // arrays/map — update() never mutated it in place.
    expect(state.observations).toBe(beforeObservations);
    expect(state.ratings).toBe(beforeRatings);
    expect(JSON.stringify(state.observations)).toBe(beforeObservationsSnapshot);
    expect(JSON.stringify([...state.ratings.entries()])).toBe(beforeRatingsSnapshot);

    // The returned state is a genuinely different object.
    expect(nextState).not.toBe(state);
    expect(nextState.observations).not.toBe(state.observations);
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
    const beforeRatings = state.ratings;
    const beforeObservations = state.observations;

    const p1 = opr.predict(state, upcoming);
    const p2 = opr.predict(state, upcoming);

    expect(p1).toEqual(p2);
    expect(state.ratings).toBe(beforeRatings);
    expect(state.observations).toBe(beforeObservations);
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
  it("a team appearing as a surrogate in a later match has its rating unchanged by that match", () => {
    let state: OprState = opr.initState([]);
    // Match 1: T1 is a normal participant, earns a real rating.
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
    const ratingAfterMatch1 = state.ratings.get("T1");
    expect(ratingAfterMatch1).toBeDefined();

    // Match 2: T1 appears again, but only as a surrogate on a completely
    // disjoint roster (no shared teams with match 1), so its rating should
    // come out identical (its column is untouched by this new observation).
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

    expect(state.ratings.get("T1")).toBeCloseTo(ratingAfterMatch1!, 6);
  });

  it("a team appearing normally in one match and as a surrogate in another accumulates exactly one observation, from the normal appearance", () => {
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

    const observationsForT1 = state.observations.filter((o) => o.teams.includes("T1"));
    expect(observationsForT1.length).toBe(1);
  });
});

describe("opr.update — incremental solve matches solveRidgeOpr's from-scratch batch solve", () => {
  it("produces ratings numerically equivalent to solving the accumulated observations from scratch (proves update()'s O(n^2) incremental Sherman-Morrison/RLS path is exact, not an approximation — see opr.ts's performance-note comment)", () => {
    let state: OprState = opr.initState([]);
    const matches: MatchResult[] = [
      match({
        matchKey: "2024a_qm1",
        eventKey: "2024a",
        redTeams: ["T1", "T2", "T3"],
        blueTeams: ["T4", "T5", "T6"],
        redScore: 40,
        blueScore: 30,
      }),
      match({
        matchKey: "2024a_qm2",
        eventKey: "2024a",
        redTeams: ["T1", "T4", "T7"],
        blueTeams: ["T2", "T5", "T8"],
        redScore: 55,
        blueScore: 20,
      }),
      match({
        matchKey: "2024b_qm1",
        eventKey: "2024b",
        redTeams: ["T9", "T10", "T3"],
        blueTeams: ["T1", "T6", "T11"],
        redScore: 45,
        blueScore: 35,
      }),
      match({
        matchKey: "2024b_qm2",
        eventKey: "2024b",
        redTeams: ["T2", "T9", "T12"],
        redSurrogates: ["T9"],
        blueTeams: ["T7", "T10", "T13"],
        redScore: 60,
        blueScore: 40,
      }),
      match({
        matchKey: "2024c_qm1",
        eventKey: "2024c",
        redTeams: ["T14", "T15", "T16"],
        blueTeams: ["T1", "T2", "T3"],
        redScore: 25,
        blueScore: 50,
      }),
    ];

    for (const m of matches) {
      state = opr.update(state, m);
    }

    const teamIndex = buildTeamIndex(state.observations);
    const batchRatings = solveRidgeOpr(state.observations, teamIndex);

    expect(state.ratings.size).toBe(batchRatings.size);
    expect(state.ratings.size).toBeGreaterThan(0);
    for (const [team, incrementalRating] of state.ratings) {
      expect(incrementalRating).toBeCloseTo(batchRatings.get(team)!, 6);
    }
  });
});

describe("opr.update — applyObservation's numerical-breakdown guard (D-08, 01-REVIEW WR-01)", () => {
  it("throws when a match's alliance score is non-finite, naming the offending score and the computed residual, instead of writing a non-finite rating into the returned state", () => {
    let state: OprState = opr.initState([]);
    state = opr.update(
      state,
      match({ matchKey: "2024test_qm1", redTeams: ["A1", "A2", "A3"], blueTeams: ["A4", "A5", "A6"], redScore: 30, blueScore: 25 })
    );

    expect(() =>
      opr.update(
        state,
        match({ matchKey: "2024test_qm2", redTeams: ["A1", "A7", "A8"], blueTeams: ["A9", "A10", "A11"], redScore: Number.NaN, blueScore: 20 })
      )
    ).toThrow(/residual=NaN/);
  });

  it("never fires when an alliance's every team is a surrogate — that observation returns early before the guard is reached, and remains a genuine no-op", () => {
    let state: OprState = opr.initState([]);
    state = opr.update(
      state,
      match({ matchKey: "2024test_qm1", redTeams: ["A1", "A2", "A3"], blueTeams: ["A4", "A5", "A6"], redScore: 30, blueScore: 25 })
    );

    expect(() =>
      opr.update(
        state,
        match({
          matchKey: "2024test_qm2",
          redTeams: ["A1", "A2", "A3"],
          redSurrogates: ["A1", "A2", "A3"],
          blueTeams: ["A4", "A5", "A6"],
          redScore: Number.NaN,
          blueScore: 20,
        })
      )
    ).not.toThrow();
  });
});

describe("opr.update — season-scale drift proof against a fresh batch solve (D-08, 01-REVIEW WR-01)", () => {
  /**
   * Calibration rationale (03.1-03-PLAN.md's planning notes, planner
   * discretion granted by 03.1-CONTEXT.md D-08): `OPR_DRIFT_MATCH_COUNT` is
   * the low end of 01-REVIEW.md WR-01's own prescribed 5,000-15,000
   * sequential-update range — this is the drift-accumulation axis that
   * matters. `OPR_DRIFT_TEAM_POOL_SIZE` is held well below the review's
   * 1,500-3,700-team range because the comparison below calls the dense
   * O(n^3) `solveRidgeOpr` batch solve THREE times (once per checkpoint,
   * over the full accumulated observation set each time); a full-season
   * team pool would turn this into a multi-minute test instead of a fast
   * CI gate. `OPR_DRIFT_RELATIVE_TOLERANCE` is relative with an absolute
   * floor (`tolerance = OPR_DRIFT_RELATIVE_TOLERANCE * max(1, |batchRating|)`),
   * matching the order of magnitude of this file's existing five-match
   * equivalence test's six-decimal `toBeCloseTo` assertion, but expressed
   * relatively so it does not tighten as ratings grow with the design
   * matrix's rank.
   */
  const OPR_DRIFT_MATCH_COUNT = 5000;
  const OPR_DRIFT_TEAM_POOL_SIZE = 400;
  const OPR_DRIFT_CHECKPOINTS = [1000, 3000, 5000];
  const OPR_DRIFT_RELATIVE_TOLERANCE = 1e-6;

  /**
   * Small seeded PRNG, reimplemented locally rather than imported from
   * `packages/harness/tune.ts`'s `mulberry32` — `packages/core` must not
   * import from `packages/harness` (verified by this describe block's own
   * "no harness import" acceptance criterion).
   */
  function mulberry32(seed: number): () => number {
    let a = seed;
    return function next(): number {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** A fixed latent strength per team, derived deterministically from its pool index. */
  function latentStrength(teamIndex: number): number {
    return 10 + ((teamIndex * 7) % 60);
  }

  function pickDistinctTeamIndices(rng: () => number, poolSize: number, count: number): number[] {
    const chosen = new Set<number>();
    while (chosen.size < count) {
      chosen.add(Math.floor(rng() * poolSize));
    }
    return [...chosen];
  }

  /** Deterministic synthetic-match generator: same seed always produces the same sequence. */
  function generateSyntheticMatches(seed: number, matchCount: number, poolSize: number): MatchResult[] {
    const rng = mulberry32(seed);
    const matches: MatchResult[] = [];
    for (let m = 0; m < matchCount; m++) {
      const indices = pickDistinctTeamIndices(rng, poolSize, 6);
      const redIndices = indices.slice(0, 3);
      const blueIndices = indices.slice(3, 6);
      const redPerturbation = (rng() - 0.5) * 4;
      const bluePerturbation = (rng() - 0.5) * 4;
      const redScore = redIndices.reduce((sum, i) => sum + latentStrength(i), 0) + redPerturbation;
      const blueScore = blueIndices.reduce((sum, i) => sum + latentStrength(i), 0) + bluePerturbation;
      matches.push(
        match({
          matchKey: `2024synth_qm${m}`,
          eventKey: "2024synth",
          compLevel: "qm",
          matchNumber: m + 1,
          redTeams: redIndices.map((i) => `S${i}`),
          blueTeams: blueIndices.map((i) => `S${i}`),
          redScore,
          blueScore,
        })
      );
    }
    return matches;
  }

  it(`stays finite and within OPR_DRIFT_RELATIVE_TOLERANCE of a fresh solveRidgeOpr batch solve at ${OPR_DRIFT_CHECKPOINTS.join(", ")} matches, over ${OPR_DRIFT_MATCH_COUNT} sequential synthetic matches`, () => {
    const start = performance.now();
    const matches = generateSyntheticMatches(42, OPR_DRIFT_MATCH_COUNT, OPR_DRIFT_TEAM_POOL_SIZE);

    let state: OprState = opr.initState([]);
    const maxDeviationByCheckpoint: Record<number, number> = {};

    for (let m = 0; m < matches.length; m++) {
      state = opr.update(state, matches[m]!);
      const matchNumber = m + 1;
      if (OPR_DRIFT_CHECKPOINTS.includes(matchNumber)) {
        const teamIndex = buildTeamIndex(state.observations);
        const batchRatings = solveRidgeOpr(state.observations, teamIndex, OPR_RIDGE_LAMBDA);

        // Same team set known to both solves — no team dropped or invented.
        expect(state.ratings.size).toBe(batchRatings.size);
        expect(new Set(state.ratings.keys())).toEqual(new Set(batchRatings.keys()));

        let maxDeviation = 0;
        for (const [team, incrementalRating] of state.ratings) {
          expect(Number.isFinite(incrementalRating)).toBe(true);
          const batchRating = batchRatings.get(team)!;
          const deviation = Math.abs(incrementalRating - batchRating);
          const tolerance = OPR_DRIFT_RELATIVE_TOLERANCE * Math.max(1, Math.abs(batchRating));
          expect(deviation).toBeLessThanOrEqual(tolerance);
          if (deviation > maxDeviation) maxDeviation = deviation;
        }
        maxDeviationByCheckpoint[matchNumber] = maxDeviation;
      }
    }

    const durationMs = performance.now() - start;
    console.log(
      `opr season-scale drift test: ${durationMs.toFixed(0)}ms over ${OPR_DRIFT_MATCH_COUNT} matches / ${OPR_DRIFT_TEAM_POOL_SIZE} teams, ` +
        `max deviation by checkpoint: ${JSON.stringify(maxDeviationByCheckpoint)}`
    );
    // Escape valve (planning_notes): if this exceeds 30s, reduce
    // OPR_DRIFT_TEAM_POOL_SIZE (never OPR_DRIFT_MATCH_COUNT) and record the
    // reduction + measured time in the plan SUMMARY.
    expect(durationMs).toBeLessThan(30000);
  }, 30000);

  it("is deterministic: two runs of the generator with the same seed over a short prefix produce identical incremental ratings, so a failure here is reproducible rather than flaky", () => {
    const prefixLength = 200;
    const matchesA = generateSyntheticMatches(42, prefixLength, OPR_DRIFT_TEAM_POOL_SIZE);
    const matchesB = generateSyntheticMatches(42, prefixLength, OPR_DRIFT_TEAM_POOL_SIZE);

    let stateA: OprState = opr.initState([]);
    for (const m of matchesA) stateA = opr.update(stateA, m);
    let stateB: OprState = opr.initState([]);
    for (const m of matchesB) stateB = opr.update(stateB, m);

    expect([...stateA.ratings.entries()]).toEqual([...stateB.ratings.entries()]);
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

    expect(state.ratings.has("DQD_TEAM")).toBe(true);
    const observationsForDq = state.observations.filter((o) => o.teams.includes("DQD_TEAM"));
    expect(observationsForDq.length).toBe(1);
  });
});
