/**
 * Sigma1Params executable-spec tests (ALGO-04/ALGO-06): the default set
 * cannot drift from the Phase-2 constants it reproduces (test 1), the
 * schema enforces D-13's strict/finite discipline (tests 2-4), the
 * canonical iteration order is derived rather than hand-typed (test 5),
 * two independently-built default modules are bitwise deterministic
 * (test 6), and every field this plan wires by the end of Task 2 is
 * PROVEN wired by a differing output, not just present in the type
 * (test 7, split across three groups by WHERE each field's effect
 * actually surfaces — see each group's own comment).
 */
import { describe, expect, it } from "vitest";
import { makeSigma1, type Sigma1State } from "./index.js";
import { DEFAULT_SIGMA1_PARAMS, SIGMA1_PARAM_KEYS, Sigma1ParamsSchema, type Sigma1Params } from "./params.js";
import { SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY, SIGMA1_PROCESS_NOISE_WITHIN_EVENT } from "./kalman.js";
import { SIGMA1_CONSISTENCY_EWMA_ALPHA, SIGMA1_MIN_CONSISTENCY_VARIANCE, SIGMA1_SHRINKAGE_PRIOR_MATCHES } from "./consistency.js";
import { SIGMA1_COV_EWMA_ALPHA, SIGMA1_COV_SHRINKAGE } from "./covariance.js";
import { SIGMA1_LINK_C } from "./linkFunctions.js";
import { EPA_CARRY_LAST_YEAR_WEIGHT, EPA_CARRY_PRIOR_YEAR_WEIGHT, EPA_MEAN_REVERSION } from "../carryover.js";
import { emptyExpandingStats } from "../../scoring/expandingStats.js";
import type { MatchResult, UpcomingMatch } from "../types.js";

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
    ...overrides,
  };
}

/** Same shape as `sigma1.test.ts`'s own fixture — every 2024 component parses to `perComponentValue`, matching `distributeResidual`'s cold-start uniform split. */
function rawBreakdown2024Uniform(perComponentValue: number): string {
  const side = {
    autoLeavePoints: perComponentValue,
    autoAmpNotePoints: perComponentValue,
    autoSpeakerNotePoints: perComponentValue,
    teleopAmpNotePoints: perComponentValue,
    teleopSpeakerNotePoints: perComponentValue,
    teleopSpeakerNoteAmplifiedPoints: perComponentValue,
    endGameOnStagePoints: perComponentValue,
    endGameParkPoints: perComponentValue,
    endGameHarmonyPoints: perComponentValue,
    endGameNoteInTrapPoints: perComponentValue,
    endGameSpotLightBonusPoints: perComponentValue,
    adjustPoints: perComponentValue,
    foulPoints: perComponentValue,
  };
  return JSON.stringify({ red: side, blue: side });
}

/** 2025 (Reefscape) breakdown/2025.ts's own 6 own-fields + foulPoints, all set to `perComponentValue` — same uniform-cold-start-matching trick as the 2024 helper, used to exercise a real POST-carry update. */
function rawBreakdown2025Uniform(perComponentValue: number): string {
  const side = {
    autoMobilityPoints: perComponentValue,
    autoCoralPoints: perComponentValue,
    teleopCoralPoints: perComponentValue,
    algaePoints: perComponentValue,
    endGameBargePoints: perComponentValue,
    adjustPoints: perComponentValue,
    foulPoints: perComponentValue,
  };
  return JSON.stringify({ red: side, blue: side });
}

const UNIFORM_PER_COMPONENT = 10;
const UNIFORM_TOTAL_2024 = 13 * UNIFORM_PER_COMPONENT;
const UNIFORM_TOTAL_2025 = 7 * UNIFORM_PER_COMPONENT;

function toUpcoming(m: MatchResult): UpcomingMatch {
  return {
    matchKey: m.matchKey,
    eventKey: m.eventKey,
    compLevel: m.compLevel,
    setNumber: m.setNumber,
    matchNumber: m.matchNumber,
    redTeams: m.redTeams,
    blueTeams: m.blueTeams,
    redSurrogates: m.redSurrogates,
    blueSurrogates: m.blueSurrogates,
  };
}

function syntheticSequence(): MatchResult[] {
  return [
    match({
      matchKey: "2024eventa_qm1",
      eventKey: "2024eventa",
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["T4", "T5", "T6"],
      redScore: UNIFORM_TOTAL_2024,
      blueScore: UNIFORM_TOTAL_2024,
      hasScoreBreakdown: true,
      scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
    }),
    match({
      matchKey: "2024eventa_qm2",
      eventKey: "2024eventa",
      redTeams: ["T1", "T4", "T7"],
      blueTeams: ["T2", "T5", "T8"],
      redScore: 140,
      blueScore: 120,
      hasScoreBreakdown: false,
      scoreBreakdownRaw: null,
    }),
    match({
      matchKey: "2024eventb_qm1",
      eventKey: "2024eventb",
      redTeams: ["T1", "T2", "T9"],
      redSurrogates: ["T9"],
      blueTeams: ["T3", "T5", "T6"],
      redScore: 100,
      blueScore: 110,
      hasScoreBreakdown: true,
      scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
    }),
  ];
}

/**
 * A combined snapshot deliberately deeper than a bare predict()-stream
 * replay, because several Task 2 fields do NOT surface in predict()'s
 * output from the 3-match sequence alone:
 *
 *   - `processNoiseEventBoundary`'s bump is applied DURING match 3's own
 *     update (T1/T2 crossing from event a to event b) — match 3's own
 *     predict() necessarily ran on the PRE-match-3 state, so only a
 *     FOLLOW-UP predict (after match 3's update) can observe the widened
 *     belief.variance it left behind.
 *   - `consistencyCarryDecay` only touches the CARRIED `consistency` value
 *     (`carrySeason`), which `predict()` never reads directly — it only
 *     becomes observable once a REAL post-carry `update()` uses that
 *     carried consistency as `applyAllianceUpdate`'s measurement noise R
 *     (see that function's own "R is the sum of each teammate's current
 *     consistency estimate" comment), shifting the resulting belief
 *     mean/variance a LATER predict() reports.
 *
 * `shrinkagePriorMatches`/`minConsistencyVariance` (teamMetrics-only) and
 * `fallbackScoreSd` (predict-only, but unreachable via ANY normal replay —
 * see its own dedicated test below) are deliberately NOT covered here.
 */
function combinedObservables(params: Sigma1Params): unknown {
  const algorithm = makeSigma1({ id: "sigma1-params-test", linkMode: "predictive-variance", params });
  let state: Sigma1State = algorithm.initState([]);
  const predictions: unknown[] = [];
  for (const m of syntheticSequence()) {
    predictions.push(algorithm.predict(state, toUpcoming(m)));
    state = algorithm.update(state, m);
  }

  const eventBFollowUp: UpcomingMatch = {
    matchKey: "2024eventb_qm2",
    eventKey: "2024eventb",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 2,
    redTeams: ["T1", "T2", "T10"],
    blueTeams: ["T3", "T5", "T6"],
    redSurrogates: [],
    blueSurrogates: [],
  };
  predictions.push(algorithm.predict(state, eventBFollowUp));

  const carried = algorithm.carrySeason!(state, { fromSeason: 2024, toSeason: 2025, isColdStart: false });
  const postCarryMatch = match({
    matchKey: "2025eventc_qm1",
    eventKey: "2025eventc",
    redTeams: ["T1", "T2", "T11"],
    blueTeams: ["T3", "T5", "T6"],
    redScore: UNIFORM_TOTAL_2025,
    blueScore: UNIFORM_TOTAL_2025,
    hasScoreBreakdown: true,
    scoreBreakdownRaw: rawBreakdown2025Uniform(UNIFORM_PER_COMPONENT),
  });
  predictions.push(algorithm.predict(carried, toUpcoming(postCarryMatch)));
  const postCarryState = algorithm.update(carried, postCarryMatch);
  predictions.push(
    algorithm.predict(postCarryState, {
      matchKey: "2025eventc_qm2",
      eventKey: "2025eventc",
      compLevel: "qm",
      setNumber: 1,
      matchNumber: 2,
      redTeams: ["T1", "T2", "T12"],
      blueTeams: ["T3", "T5", "T6"],
      redSurrogates: [],
      blueSurrogates: [],
    })
  );

  return predictions;
}

describe("DEFAULT_SIGMA1_PARAMS reproduces Phase-2 behaviour exactly", () => {
  it("every field imported from an existing module constant equals that constant's current value", () => {
    // The rpMonteCarlo* fields have no Phase-2 predecessor constant (D-16:
    // versioned parameters introduced fresh by this plan, consumed by plan
    // 03-03) — excluded here, asserted as literals instead.
    expect(DEFAULT_SIGMA1_PARAMS.processNoiseWithinEvent).toBe(SIGMA1_PROCESS_NOISE_WITHIN_EVENT);
    expect(DEFAULT_SIGMA1_PARAMS.processNoiseEventBoundary).toBe(SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY);
    expect(DEFAULT_SIGMA1_PARAMS.consistencyEwmaAlpha).toBe(SIGMA1_CONSISTENCY_EWMA_ALPHA);
    expect(DEFAULT_SIGMA1_PARAMS.shrinkagePriorMatches).toBe(SIGMA1_SHRINKAGE_PRIOR_MATCHES);
    expect(DEFAULT_SIGMA1_PARAMS.minConsistencyVariance).toBe(SIGMA1_MIN_CONSISTENCY_VARIANCE);
    expect(DEFAULT_SIGMA1_PARAMS.covEwmaAlpha).toBe(SIGMA1_COV_EWMA_ALPHA);
    expect(DEFAULT_SIGMA1_PARAMS.covShrinkage).toBe(SIGMA1_COV_SHRINKAGE);
    expect(DEFAULT_SIGMA1_PARAMS.linkC).toBe(SIGMA1_LINK_C);
    expect(DEFAULT_SIGMA1_PARAMS.carryMeanReversion).toBe(EPA_MEAN_REVERSION);
    expect(DEFAULT_SIGMA1_PARAMS.carryLastYearWeight).toBe(EPA_CARRY_LAST_YEAR_WEIGHT);
    expect(DEFAULT_SIGMA1_PARAMS.carryPriorYearWeight).toBe(EPA_CARRY_PRIOR_YEAR_WEIGHT);
    // Values whose canonical home is params.ts itself (moved there from a
    // draft sigma1/index.ts location — see params.ts's file-header
    // deviation note on the ESM import-cycle this avoids). Asserted as the
    // documented literals rather than a self-referential import.
    expect(DEFAULT_SIGMA1_PARAMS.coldStartTeamTotal).toBe(20);
    expect(DEFAULT_SIGMA1_PARAMS.coldStartConsistencyVariance).toBe(25);
    expect(DEFAULT_SIGMA1_PARAMS.fallbackScoreSd).toBe(25);
    expect(DEFAULT_SIGMA1_PARAMS.consistencyCarryDecay).toBe(0.5);
    expect(DEFAULT_SIGMA1_PARAMS.rpMonteCarloSeed).toBe(42);
    expect(DEFAULT_SIGMA1_PARAMS.rpMonteCarloDraws).toBe(2000);
  });
});

describe("Sigma1ParamsSchema", () => {
  it("round-trips DEFAULT_SIGMA1_PARAMS deeply equal", () => {
    const parsed = Sigma1ParamsSchema.parse(DEFAULT_SIGMA1_PARAMS);
    expect(parsed).toEqual(DEFAULT_SIGMA1_PARAMS);
  });

  it("throws on an unknown key (z.strictObject, T-03-08)", () => {
    expect(() => Sigma1ParamsSchema.parse({ ...DEFAULT_SIGMA1_PARAMS, notAField: 1 })).toThrow();
  });

  it("throws on a non-finite field value", () => {
    expect(() => Sigma1ParamsSchema.parse({ ...DEFAULT_SIGMA1_PARAMS, linkC: Number.NaN })).toThrow();
  });
});

describe("SIGMA1_PARAM_KEYS", () => {
  it("is sorted lexicographically and covers exactly DEFAULT_SIGMA1_PARAMS's keys", () => {
    const expectedKeys = Object.keys(DEFAULT_SIGMA1_PARAMS).sort();
    expect([...SIGMA1_PARAM_KEYS]).toEqual(expectedKeys);
    expect([...SIGMA1_PARAM_KEYS].sort()).toEqual([...SIGMA1_PARAM_KEYS]); // already sorted
  });
});

describe("determinism — two independently-built default modules", () => {
  it("produce byte-identical JSON.stringify observables over the synthetic fixture", () => {
    const run1 = combinedObservables(DEFAULT_SIGMA1_PARAMS);
    const run2 = combinedObservables({ ...DEFAULT_SIGMA1_PARAMS });
    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
  });
});

describe("fields observable through the predict/update replay stream", () => {
  // Task 1 wires the first two; Task 2 wires the rest of this list. The
  // three carry fields (Task 3) and the two rpMonteCarlo* fields (plan
  // 03-03) are deliberately NOT in this list — they are declared in
  // Sigma1Params now but not yet read anywhere on the predict/update path,
  // by this plan's own staged design (03-01-PLAN.md Task 1/Task 3's
  // read_first notes).
  const WIRED_VIA_REPLAY: readonly { field: keyof Sigma1Params; perturbed: number }[] = [
    { field: "processNoiseWithinEvent", perturbed: 5 },
    { field: "processNoiseEventBoundary", perturbed: 40 },
    { field: "consistencyEwmaAlpha", perturbed: 0.9 },
    { field: "covEwmaAlpha", perturbed: 0.9 },
    { field: "covShrinkage", perturbed: 0.9 },
    { field: "linkC", perturbed: 5 },
    { field: "coldStartTeamTotal", perturbed: 100 },
    { field: "coldStartConsistencyVariance", perturbed: 200 },
    { field: "consistencyCarryDecay", perturbed: 0.01 },
  ];

  it.each(WIRED_VIA_REPLAY)("$field is actually read by the update/predict path", ({ field, perturbed }) => {
    const defaultRun = combinedObservables(DEFAULT_SIGMA1_PARAMS);
    const perturbedParams: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, [field]: perturbed };
    const perturbedRun = combinedObservables(perturbedParams);
    expect(JSON.stringify(perturbedRun)).not.toBe(JSON.stringify(defaultRun));
  });
});

describe("fields observable only through teamMetrics (D-27's display contract)", () => {
  // `shrinkagePriorMatches`/`minConsistencyVariance` feed shrinkConsistency
  // ONLY inside teamMetrics — predict()/update() never read them, so a
  // predict()-stream comparison would (correctly) show no difference at
  // all; that would be a false "not wired" signal, not evidence of a bug.
  const WIRED_VIA_TEAM_METRICS: readonly { field: keyof Sigma1Params; perturbed: number }[] = [
    { field: "shrinkagePriorMatches", perturbed: 50 },
    { field: "minConsistencyVariance", perturbed: 200 },
  ];

  it.each(WIRED_VIA_TEAM_METRICS)("$field changes teamMetrics output", ({ field, perturbed }) => {
    function metricsSnapshot(params: Sigma1Params): unknown {
      const algorithm = makeSigma1({ id: "sigma1-teammetrics-test", linkMode: "predictive-variance", params });
      let state = algorithm.initState([]);
      for (const m of syntheticSequence()) {
        state = algorithm.update(state, m);
      }
      return algorithm.teamMetrics(state);
    }
    const defaultMetrics = metricsSnapshot(DEFAULT_SIGMA1_PARAMS);
    const perturbedParams: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, [field]: perturbed };
    const perturbedMetrics = metricsSnapshot(perturbedParams);
    expect(JSON.stringify(perturbedMetrics)).not.toBe(JSON.stringify(defaultMetrics));
  });
});

describe("fallbackScoreSd — predict-only, but unreachable via a normal replay", () => {
  it("changes season-sd mode's win probability when allianceScoreStats has fewer than 2 folded observations", () => {
    // Architecturally unreachable through a normal predict-then-update
    // replay: `update()` always folds exactly 2 allianceScoreStats
    // observations per call (one per side), so `count` jumps 0 -> 2 in a
    // single step — there is no reachable point where `count === 1`. The
    // FIRST-ever predict() (count === 0) always has margin === 0 (no
    // beliefs exist yet, since beliefs are only created by update()),
    // which resolves to 0.5 through every link mode's own boundary
    // handling regardless of the fallback SD used. A hand-built state
    // (bypassing update(), matching sigma1.test.ts's own "STEADY vs
    // STREAKY" pattern) is the only way to exercise a NONZERO margin at
    // `allianceScoreStats.count < 2` — and `season-sd` mode is required
    // too, since `predictive-variance` mode only reads seasonScoreSd in
    // its own variance<=0 degenerate branch, which a nonzero margin here
    // does not hit (nonzero belief.variance is part of the hand-built
    // state).
    const componentOrder = ["autoLeave"];
    function stateWithMargin(): Sigma1State {
      return {
        season: 2024,
        componentOrder,
        teams: new Map([
          [
            "T1",
            {
              beliefs: { autoLeave: { mean: 20, variance: 4 } },
              covariance: [[4]],
              consistency: { autoLeave: 4 },
              matchCount: 3,
              lastEventKey: "2024test",
            },
          ],
          [
            "T2",
            {
              beliefs: { autoLeave: { mean: 5, variance: 4 } },
              covariance: [[4]],
              consistency: { autoLeave: 4 },
              matchCount: 3,
              lastEventKey: "2024test",
            },
          ],
        ]),
        league: { componentMean: {}, componentConsistency: {} },
        allianceScoreStats: emptyExpandingStats(), // count === 0, forces the fallback
        priorSeasonRatings: { lastSeason: new Map(), yearBefore: new Map() },
      };
    }
    const upcoming: UpcomingMatch = {
      matchKey: "2024test_qm1",
      eventKey: "2024test",
      compLevel: "qm",
      setNumber: 1,
      matchNumber: 1,
      redTeams: ["T1"],
      blueTeams: ["T2"],
      redSurrogates: [],
      blueSurrogates: [],
    };

    const defaultAlgorithm = makeSigma1({ id: "fallback-sd-default", linkMode: "season-sd", params: DEFAULT_SIGMA1_PARAMS });
    const perturbedAlgorithm = makeSigma1({
      id: "fallback-sd-perturbed",
      linkMode: "season-sd",
      params: { ...DEFAULT_SIGMA1_PARAMS, fallbackScoreSd: 200 },
    });

    const defaultPrediction = defaultAlgorithm.predict(stateWithMargin(), upcoming);
    const perturbedPrediction = perturbedAlgorithm.predict(stateWithMargin(), upcoming);

    expect(defaultPrediction.pRedWin).not.toBe(perturbedPrediction.pRedWin);
  });
});
