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
import { makeSigma1, type Sigma1State, type TeamComponentBelief } from "./index.js";
import {
  DEFAULT_SIGMA1_PARAMS,
  SIGMA1_PARAM_KEYS,
  SIGMA1_REFERENCE_SCORE_VARIANCE,
  Sigma1ParamsSchema,
  type Sigma1Params,
} from "./params.js";
import { emptyInnovationStats } from "./adaptation.js";
import { emptyElimScoreOffset } from "./elim.js";
import { SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY, SIGMA1_PROCESS_NOISE_WITHIN_EVENT } from "./kalman.js";
import { SIGMA1_CONSISTENCY_EWMA_ALPHA, SIGMA1_MIN_CONSISTENCY_VARIANCE } from "./consistency.js";
import { SIGMA1_SWING_HALF_LIFE_MATCHES, SIGMA1_SWING_SCALE, emptyTeamSwing } from "./swing.js";
import { SIGMA1_COV_EWMA_ALPHA, SIGMA1_COV_SHRINKAGE, emptyCovariance } from "./covariance.js";
import { SIGMA1_LINK_C } from "./linkFunctions.js";
import { EPA_CARRY_LAST_YEAR_WEIGHT, EPA_CARRY_PRIOR_YEAR_WEIGHT, EPA_MEAN_REVERSION } from "../carryover.js";
import { emptyExpandingStats } from "../../scoring/expandingStats.js";
import { resolveSigma1Params } from "./scale.js";
import { FALLBACK_NOISE_MULTIPLIER } from "../breakdown/fallback.js";
import type { MatchResult, Prediction, UpcomingMatch } from "../types.js";
import { ADJUST_COMPONENT } from "../breakdown/constants.js";

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
    // Plan 03-03: rp/2024.ts's OWN Zod schema requires these fields too
    // (a DIFFERENT required-field set than breakdown/2024.ts's), since
    // sigma1/index.ts's update() now also parses this same raw JSON
    // through the season's RP rule module — placeholder values, no test in
    // this file exercises RP behavior.
    autoAmpNoteCount: 0,
    autoSpeakerNoteCount: 0,
    teleopAmpNoteCount: 0,
    teleopSpeakerNoteCount: 0,
    teleopSpeakerNoteAmplifiedCount: 0,
    endGameTotalStagePoints: 0,
    endGameRobot1: "None",
    endGameRobot2: "None",
    endGameRobot3: "None",
    coopertitionBonusAchieved: false,
    melodyBonusAchieved: false,
    ensembleBonusAchieved: false,
    melodyBonusThresholdCoop: 0,
    melodyBonusThresholdNonCoop: 0,
    ensembleBonusStagePointsThreshold: 0,
    ensembleBonusOnStageRobotsThreshold: 0,
  };
  return JSON.stringify({ red: side, blue: side });
}

/** Same 2024 field set as `rawBreakdown2024Uniform` above, but ASYMMETRIC — each alliance gets its own per-component value, so the two sides build genuinely different beliefs (ELIM-OFF's tests below need pre-existing, nonzero margin to prove D-13's cancellation is non-trivial). `rawBreakdown2024Split(v, v)` reproduces `rawBreakdown2024Uniform(v)` exactly. */
function rawBreakdown2024Split(redVal: number, blueVal: number): string {
  function side(perComponentValue: number): Record<string, unknown> {
    return {
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
      autoAmpNoteCount: 0,
      autoSpeakerNoteCount: 0,
      teleopAmpNoteCount: 0,
      teleopSpeakerNoteCount: 0,
      teleopSpeakerNoteAmplifiedCount: 0,
      endGameTotalStagePoints: 0,
      endGameRobot1: "None",
      endGameRobot2: "None",
      endGameRobot3: "None",
      coopertitionBonusAchieved: false,
      melodyBonusAchieved: false,
      ensembleBonusAchieved: false,
      melodyBonusThresholdCoop: 0,
      melodyBonusThresholdNonCoop: 0,
      ensembleBonusStagePointsThreshold: 0,
      ensembleBonusOnStageRobotsThreshold: 0,
    };
  }
  return JSON.stringify({ red: side(redVal), blue: side(blueVal) });
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
    // Plan 03-03: rp/2025.ts's OWN Zod schema requires these fields too —
    // placeholder values, no test in this file exercises RP behavior.
    autoLineRobot1: "None",
    autoLineRobot2: "None",
    autoLineRobot3: "None",
    autoCoralCount: 0,
    autoReef: { trough: 0, tba_botRowCount: 0, tba_midRowCount: 0, tba_topRowCount: 0 },
    teleopReef: { trough: 0, tba_botRowCount: 0, tba_midRowCount: 0, tba_topRowCount: 0 },
    coopertitionCriteriaMet: false,
    autoBonusAchieved: false,
    coralBonusAchieved: false,
    bargeBonusAchieved: false,
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
    eventType: m.eventType,
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
    eventType: 0,
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
      eventType: 0,
    })
  );

  return predictions;
}

describe("DEFAULT_SIGMA1_PARAMS reproduces Phase-2 behaviour exactly", () => {
  it("every field imported from an existing module constant equals that constant's current value", () => {
    // The rpMonteCarlo* fields have no Phase-2 predecessor constant (D-16:
    // versioned parameters introduced fresh by this plan, consumed by plan
    // 03-03) — excluded here, asserted as literals instead.
    // D-T1 (4.0.0): the five SCALE-RELATIVE defaults are DERIVED from the
    // same imported constants, divided by the measured reference (or its
    // square root for the ONE linear field). Asserting the division here is
    // what pins params.ts's "derived, never re-typed" rule as a TEST rather
    // than as a convention a future edit could quietly break.
    expect(DEFAULT_SIGMA1_PARAMS.processNoiseWithinEventRel).toBe(
      SIGMA1_PROCESS_NOISE_WITHIN_EVENT / SIGMA1_REFERENCE_SCORE_VARIANCE
    );
    expect(DEFAULT_SIGMA1_PARAMS.processNoiseEventBoundaryRel).toBe(
      SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY / SIGMA1_REFERENCE_SCORE_VARIANCE
    );
    expect(DEFAULT_SIGMA1_PARAMS.minConsistencyVarianceRel).toBe(
      SIGMA1_MIN_CONSISTENCY_VARIANCE / SIGMA1_REFERENCE_SCORE_VARIANCE
    );
    expect(DEFAULT_SIGMA1_PARAMS.coldStartConsistencyVarianceRel).toBe(25 / SIGMA1_REFERENCE_SCORE_VARIANCE);
    // The ONE linear field: a point total, so sqrt(V_ref), not V_ref.
    expect(DEFAULT_SIGMA1_PARAMS.coldStartTeamTotalRel).toBe(20 / Math.sqrt(SIGMA1_REFERENCE_SCORE_VARIANCE));
    expect(DEFAULT_SIGMA1_PARAMS.consistencyEwmaAlpha).toBe(SIGMA1_CONSISTENCY_EWMA_ALPHA);
    // D-Y1 (7.0.0): `varianceOprRidge` is DELETED in its turn and the two
    // swing constants take its place. Asserted as IDENTITIES against the
    // imported constants, never against the literals 6 and 1.92 — the same
    // never-re-typed rule every other default here follows, and the reason it
    // matters is sharper for these two than for most: both were MEASURED, so a
    // re-typed copy could drift from the measurement it records.
    expect(DEFAULT_SIGMA1_PARAMS.swingHalfLifeMatches).toBe(SIGMA1_SWING_HALF_LIFE_MATCHES);
    expect(DEFAULT_SIGMA1_PARAMS.swingScale).toBe(SIGMA1_SWING_SCALE);
    expect(DEFAULT_SIGMA1_PARAMS.covEwmaAlpha).toBe(SIGMA1_COV_EWMA_ALPHA);
    expect(DEFAULT_SIGMA1_PARAMS.covShrinkage).toBe(SIGMA1_COV_SHRINKAGE);
    expect(DEFAULT_SIGMA1_PARAMS.linkC).toBe(SIGMA1_LINK_C);
    expect(DEFAULT_SIGMA1_PARAMS.carryMeanReversion).toBe(EPA_MEAN_REVERSION);
    // D-T2: one share, derived from the retired pair's own RATIO.
    expect(DEFAULT_SIGMA1_PARAMS.carryPriorYearShare).toBe(
      EPA_CARRY_PRIOR_YEAR_WEIGHT / (EPA_CARRY_LAST_YEAR_WEIGHT + EPA_CARRY_PRIOR_YEAR_WEIGHT)
    );
    expect(DEFAULT_SIGMA1_PARAMS.carryPriorYearShare).toBe(0.3);
    // F3: RP's own ABSOLUTE trio, sourced from exactly the constants
    // rp/state.ts read through the score-side fields before 4.0.0.
    expect(DEFAULT_SIGMA1_PARAMS.rpProcessNoiseWithinEvent).toBe(SIGMA1_PROCESS_NOISE_WITHIN_EVENT);
    expect(DEFAULT_SIGMA1_PARAMS.rpProcessNoiseEventBoundary).toBe(SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY);
    expect(DEFAULT_SIGMA1_PARAMS.rpColdStartVariance).toBe(25);
    // Values whose canonical home is params.ts itself (moved there from a
    // draft sigma1/index.ts location — see params.ts's file-header
    // deviation note on the ESM import-cycle this avoids). Asserted as the
    // documented literals rather than a self-referential import.
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

  // D-11 / 03-REVIEW WR-01: the cross-parameter invariants that used to live
  // ONLY in `packages/harness/searchSpace.ts`'s `isValidParamSet` are now
  // additionally enforced here, folded into the schema every construction
  // path already parses through — see `Sigma1ParamsSchema`'s own doc
  // comment. Each case asserts the reported issue names the field(s) it
  // broke, not just that parsing failed.
  describe("cross-parameter invariants (D-11 / 03-REVIEW WR-01)", () => {
    it("rejects processNoiseEventBoundary not strictly exceeding processNoiseWithinEvent, naming both fields", () => {
      const result = Sigma1ParamsSchema.safeParse({
        ...DEFAULT_SIGMA1_PARAMS,
        processNoiseEventBoundary: 0.5,
        processNoiseWithinEvent: 0.5,
      });
      expect(result.success).toBe(false);
      const messages = result.success ? [] : result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("processNoiseEventBoundary") && m.includes("processNoiseWithinEvent"))).toBe(true);
    });

    it("rejects adaptationMinFactor >= adaptationMaxFactor, naming both fields", () => {
      const result = Sigma1ParamsSchema.safeParse({
        ...DEFAULT_SIGMA1_PARAMS,
        adaptationMinFactor: 4,
        adaptationMaxFactor: 4,
      });
      expect(result.success).toBe(false);
      const messages = result.success ? [] : result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("adaptationMinFactor") && m.includes("adaptationMaxFactor"))).toBe(true);
    });

    it.each([
      ["carryMeanReversion", -0.1] as const,
      ["carryMeanReversion", 1.1] as const,
      ["carryLastYearWeight", -0.1] as const,
      ["carryLastYearWeight", 1.1] as const,
      ["carryPriorYearWeight", -0.1] as const,
      ["carryPriorYearWeight", 1.1] as const,
    ])("rejects %s = %d outside [0, 1], naming the field", (field, value) => {
      const result = Sigma1ParamsSchema.safeParse({ ...DEFAULT_SIGMA1_PARAMS, [field]: value });
      expect(result.success).toBe(false);
      const messages = result.success ? [] : result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes(field))).toBe(true);
    });

    it("parsing DEFAULT_SIGMA1_PARAMS succeeds and returns a value equal to it — the defaults remain valid", () => {
      const parsed = Sigma1ParamsSchema.parse(DEFAULT_SIGMA1_PARAMS);
      expect(parsed).toEqual(DEFAULT_SIGMA1_PARAMS);
    });
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
    // D-T1: the perturbed values are now DIMENSIONLESS, and each is chosen
    // roughly an order of magnitude off its own default so the perturbation
    // is unambiguously observable rather than lost in the last bits.
    { field: "processNoiseWithinEventRel", perturbed: 5e-3 },
    { field: "processNoiseEventBoundaryRel", perturbed: 4e-2 },
    { field: "consistencyEwmaAlpha", perturbed: 0.9 },
    { field: "covEwmaAlpha", perturbed: 0.9 },
    { field: "covShrinkage", perturbed: 0.9 },
    { field: "linkC", perturbed: 5 },
    { field: "coldStartTeamTotalRel", perturbed: 3 },
    { field: "coldStartConsistencyVarianceRel", perturbed: 0.2 },
    { field: "consistencyCarryDecay", perturbed: 0.01 },
    // D-V4 (5.0.0): MOVED here from the teamMetrics group below. It still
    // floors seedConsistencyFor on the update path (coldStartTeamState and
    // carrySeason), but teamMetrics no longer reads it at all — the published
    // +/- is the variance decomposition, which has no floor.
    { field: "minConsistencyVarianceRel", perturbed: 0.2 },
  ];

  it.each(WIRED_VIA_REPLAY)("$field is actually read by the update/predict path", ({ field, perturbed }) => {
    const defaultRun = combinedObservables(DEFAULT_SIGMA1_PARAMS);
    const perturbedParams: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, [field]: perturbed };
    const perturbedRun = combinedObservables(perturbedParams);
    expect(JSON.stringify(perturbedRun)).not.toBe(JSON.stringify(defaultRun));
  });
});

describe("fields observable only through teamMetrics (D-27's display contract)", () => {
  // `swingHalfLifeMatches`/`swingScale` (D-Y1, 7.0.0) are read ONLY inside
  // teamMetrics and `update()`'s swing fold — they parameterise the
  // recency-weighted consistency estimate that produces every published +/-.
  // `predict()` never reads either, so a predict()-stream comparison would
  // (correctly) show no difference at all; that would be a false "not wired"
  // signal, not evidence of a bug.
  //
  // They replaced `varianceOprRidge`, which was DELETED from Sigma1Params in
  // the same version — which in its turn had replaced `shrinkagePriorMatches`
  // at 5.0.0. Three display parameters, three versions, and the SAME wiring
  // test each time: the display contract is the one thing that has to keep
  // being checked while the estimator behind it changes.
  //
  // `swingHalfLifeMatches` is perturbed to 0.5 rather than to something large:
  // the decay `0.5 ** (1 / h)` is bounded in (0, 1) and flattens as `h` grows,
  // so a big half-life converges toward the flat average and could plausibly
  // round to it on a short fixture. A SHORT half-life cannot — it weights the
  // newest observation overwhelmingly, which is the direction that always
  // moves the number.
  const WIRED_VIA_TEAM_METRICS: readonly { field: keyof Sigma1Params; perturbed: number }[] = [
    { field: "swingHalfLifeMatches", perturbed: 0.5 },
    { field: "swingScale", perturbed: 1000 },
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

/**
 * A longer same-alliance sequence (T1/T2/T3 vs T4/T5/T6, one event) with a
 * deliberately SWINGING per-component value — large, small, large again —
 * so each team crosses `adaptationMinObservations` (3) with a genuinely
 * non-unit mean squared normalized innovation, giving `adaptationFactor`
 * room to diverge from exactly 1 once adaptation is enabled. Six matches:
 * long enough for that divergence to feed back into a LATER match's Kalman
 * gain (not just a single process-noise bump `predict()` alone would show —
 * `applyProcessNoise` only ever changes `belief.variance`, never
 * `belief.mean` directly; the mean only diverges once a later
 * `updateAllianceSum` reads that different variance as part of its own gain).
 */
function swingingSequence(): MatchResult[] {
  const values = [10, 10, 80, 5, 80, 5];
  return values.map((value, i) =>
    match({
      matchKey: `2024eventa_qm${i + 1}`,
      eventKey: "2024eventa",
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["T4", "T5", "T6"],
      redScore: 13 * value,
      blueScore: 13 * value,
      hasScoreBreakdown: true,
      scoreBreakdownRaw: rawBreakdown2024Uniform(value),
    })
  );
}

function swingingObservables(params: Sigma1Params): unknown {
  const algorithm = makeSigma1({ id: "sigma1-adapt-identity-test", linkMode: "predictive-variance", params });
  let state: Sigma1State = algorithm.initState([]);
  const predictions: unknown[] = [];
  for (const m of swingingSequence()) {
    predictions.push(algorithm.predict(state, toUpcoming(m)));
    state = algorithm.update(state, m);
  }
  return predictions;
}

describe("adaptation-off is bitwise identical to the pre-adaptation module (D-08, plan 03-04 Task 2)", () => {
  // Every OTHER adaptation field perturbed to an extreme value alongside
  // `adaptationEnabled: false` — proving `adaptationFactor`'s disabled
  // branch is checked BEFORE any of these fields is ever read, not merely
  // that the defaults happen to be inert.
  const EXTREME_OFF_PARAMS: Sigma1Params = {
    ...DEFAULT_SIGMA1_PARAMS,
    adaptationEnabled: false,
    adaptationEwmaAlpha: 0.999,
    adaptationExponent: 10,
    adaptationMinFactor: 0.0001,
    adaptationMaxFactor: 10000,
    adaptationMinObservations: 0,
  };

  it("DEFAULT_SIGMA1_PARAMS and an adaptation-off params object with every other adaptation field perturbed produce byte-identical prediction streams", () => {
    const defaultRun = swingingObservables(DEFAULT_SIGMA1_PARAMS);
    const offRun = swingingObservables(EXTREME_OFF_PARAMS);
    expect(JSON.stringify(offRun)).toBe(JSON.stringify(defaultRun));
  });

  it("adaptationEnabled: true produces a stream that DIFFERS from the off stream for at least one match — the mechanism is wired, not decorative", () => {
    const onParams: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, adaptationEnabled: true };
    const onRun = swingingObservables(onParams);
    const offRun = swingingObservables(DEFAULT_SIGMA1_PARAMS);
    expect(JSON.stringify(onRun)).not.toBe(JSON.stringify(offRun));
  });

  it("both the on and off streams are individually reproducible — running each twice gives byte-identical output", () => {
    const onParams: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, adaptationEnabled: true };
    expect(JSON.stringify(swingingObservables(onParams))).toBe(JSON.stringify(swingingObservables(onParams)));
    expect(JSON.stringify(swingingObservables(DEFAULT_SIGMA1_PARAMS))).toBe(
      JSON.stringify(swingingObservables(DEFAULT_SIGMA1_PARAMS))
    );
  });
});

describe("Sigma1ParamsSchema — elimObservationNoiseMultiplier (D-2, ELIM-WIRE)", () => {
  it("parses an object omitting the field and defaults it to exactly 1 — the executable proof every committed vpr@8.0.0+*.json file still parses unchanged", () => {
    const { elimObservationNoiseMultiplier: _omitted, ...withoutElim } = DEFAULT_SIGMA1_PARAMS;
    const parsed = Sigma1ParamsSchema.parse(withoutElim);
    expect(parsed.elimObservationNoiseMultiplier).toBe(1);
  });
});

/**
 * D-4's end-to-end proof (quick task 260904-v9n, ELIM-R): a sequence whose
 * later matches are ELIMINATION `compLevel`s (`"ef"`/`"qf"`/`"sf"`/`"f"`),
 * modelled on `swingingSequence` above but never mutating that fixture — the
 * adaptation tests that depend on it must not move.
 */
function elimSequence(): MatchResult[] {
  const qualValues = [10, 12, 9];
  const quals = qualValues.map((value, i) =>
    match({
      matchKey: `2024eventa_qm${i + 1}`,
      eventKey: "2024eventa",
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["T4", "T5", "T6"],
      redScore: 13 * value,
      blueScore: 13 * value,
      hasScoreBreakdown: true,
      scoreBreakdownRaw: rawBreakdown2024Uniform(value),
    })
  );
  const elimCompLevels = ["ef", "qf", "sf", "f"] as const;
  const elims = elimCompLevels.map((compLevel, i) =>
    match({
      matchKey: `2024eventa_${compLevel}1m${i + 1}`,
      eventKey: "2024eventa",
      compLevel,
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["T4", "T5", "T6"],
      redScore: 13 * 20,
      blueScore: 13 * 20,
      hasScoreBreakdown: true,
      scoreBreakdownRaw: rawBreakdown2024Uniform(20),
    })
  );
  return [...quals, ...elims];
}

function elimObservables(params: Sigma1Params): unknown {
  const algorithm = makeSigma1({ id: "sigma1-elim-identity-test", linkMode: "predictive-variance", params });
  let state: Sigma1State = algorithm.initState([]);
  const predictions: unknown[] = [];
  for (const m of elimSequence()) {
    predictions.push(algorithm.predict(state, toUpcoming(m)));
    state = algorithm.update(state, m);
  }
  return predictions;
}

describe("elimObservationNoiseMultiplier — inert at default, wired when moved, gated on comp level (D-4/D-6)", () => {
  it("DEFAULT_SIGMA1_PARAMS and an explicit elimObservationNoiseMultiplier: 1 produce byte-identical prediction streams over an elim-bearing replay", () => {
    const explicitParams: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, elimObservationNoiseMultiplier: 1 };
    const defaultRun = elimObservables(DEFAULT_SIGMA1_PARAMS);
    const explicitRun = elimObservables(explicitParams);
    expect(JSON.stringify(explicitRun)).toBe(JSON.stringify(defaultRun));
  });

  it("elimObservationNoiseMultiplier: 8 produces a stream that DIFFERS from the default for at least one match — the mechanism is wired, not decorative", () => {
    const movedParams: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, elimObservationNoiseMultiplier: 8 };
    const movedRun = elimObservables(movedParams);
    const defaultRun = elimObservables(DEFAULT_SIGMA1_PARAMS);
    expect(JSON.stringify(movedRun)).not.toBe(JSON.stringify(defaultRun));
  });

  it("elimObservationNoiseMultiplier: 8 over a QUALS-ONLY replay (swingingSequence, all qm) is byte-identical to the default — proves the multiplier is gated on comp level rather than applied everywhere", () => {
    const movedParams: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, elimObservationNoiseMultiplier: 8 };
    expect(JSON.stringify(swingingObservables(movedParams))).toBe(JSON.stringify(swingingObservables(DEFAULT_SIGMA1_PARAMS)));
  });
});

describe("elimObservationNoiseMultiplier composes with FALLBACK_NOISE_MULTIPLIER (D-4)", () => {
  it("a fallback elim match's posterior variance matches the COMPOSED multiplier (FALLBACK_NOISE_MULTIPLIER x elimObservationNoiseMultiplier), not either alone", () => {
    const elimMultiplier = 5;
    const params: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, elimObservationNoiseMultiplier: elimMultiplier };
    const algorithm = makeSigma1({ id: "sigma1-elim-composition-test", linkMode: "predictive-variance", params });
    // Resolved at the SAME (empty, cold-start) scale `initState()`'s
    // `allianceScoreStats` resolves at — this is the ONLY call in the whole
    // test, matching Pitfall EPA-1's leak-free placement.
    const resolved = resolveSigma1Params(params, emptyExpandingStats());

    const fallbackElimMatch = match({
      matchKey: "2024test_ef1m1",
      compLevel: "ef",
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["T4", "T5", "T6"],
      redScore: 150,
      blueScore: 140,
      hasScoreBreakdown: false,
      scoreBreakdownRaw: null,
    });

    let state = algorithm.initState([]);
    state = algorithm.update(state, fallbackElimMatch);

    // At a genuine cold start every teammate's prior variance AND consistency
    // for "autoLeave" is exactly `resolved.coldStartConsistencyVariance` (p0):
    // `updateAllianceSum`'s posterior variance for one of 3 symmetric
    // teammates is `p0 * (1 - p0 / (3*p0 + measurementNoise))`, and
    // `measurementNoise = 3 * p0 * measurementNoiseMultiplier` — this does not
    // depend on the observed value/innovation at all, only on the prior and
    // the multiplier, so this fixture needs no particular score to prove it.
    const p0 = resolved.coldStartConsistencyVariance;
    function posteriorVarianceAt(multiplier: number): number {
      const measurementNoise = 3 * p0 * multiplier;
      const pooled = 3 * p0 + measurementNoise;
      const gain = p0 / pooled;
      return p0 * (1 - gain);
    }

    const actualVariance = state.teams.get("T1")!.beliefs["autoLeave"]!.variance;
    const composedMultiplier = FALLBACK_NOISE_MULTIPLIER * elimMultiplier;
    expect(actualVariance).toBeCloseTo(posteriorVarianceAt(composedMultiplier), 6);

    // Not merely one inflation alone.
    expect(actualVariance).not.toBeCloseTo(posteriorVarianceAt(FALLBACK_NOISE_MULTIPLIER), 3);
    expect(actualVariance).not.toBeCloseTo(posteriorVarianceAt(elimMultiplier), 3);
  });
});

describe("Sigma1ParamsSchema — elimScoreOffsetEnabled/elimScoreOffsetEwmaAlpha (D-2, ELIM-WIRE)", () => {
  it("parses an object omitting both fields and defaults them to false/0.05 — every committed vpr@8.0.0+*.json file still parses", () => {
    const { elimScoreOffsetEnabled: _e, elimScoreOffsetEwmaAlpha: _a, ...withoutOffset } = DEFAULT_SIGMA1_PARAMS;
    const parsed = Sigma1ParamsSchema.parse(withoutOffset);
    expect(parsed.elimScoreOffsetEnabled).toBe(false);
    expect(parsed.elimScoreOffsetEwmaAlpha).toBe(0.05);
  });
});

/**
 * D-7/D-9/D-10/D-13's end-to-end proofs (quick task 260904-v9n, ELIM-OFF): a
 * sequence whose quals build ASYMMETRIC beliefs (`rawBreakdown2024Split`, red
 * consistently ahead of blue) — so the pre-existing predicted margin is
 * genuinely nonzero — followed by elimination matches whose OBSERVED alliance
 * totals (`redScore`/`blueScore`) are set well ABOVE what those beliefs would
 * predict, so the offset accumulator has something unambiguous to learn.
 */
function elimBiasedSequence(): MatchResult[] {
  const qualPairs: readonly [number, number][] = [
    [20, 8],
    [22, 9],
    [19, 10],
  ];
  const quals = qualPairs.map(([redVal, blueVal], i) =>
    match({
      matchKey: `2024eventa_qm${i + 1}`,
      eventKey: "2024eventa",
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["T4", "T5", "T6"],
      redScore: 13 * redVal,
      blueScore: 13 * blueVal,
      hasScoreBreakdown: true,
      scoreBreakdownRaw: rawBreakdown2024Split(redVal, blueVal),
    })
  );
  const elimCompLevels = ["ef", "qf", "sf"] as const;
  const elims = elimCompLevels.map((compLevel, i) =>
    match({
      matchKey: `2024eventa_${compLevel}1m${i + 1}`,
      eventKey: "2024eventa",
      compLevel,
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["T4", "T5", "T6"],
      // The RAW breakdown stays near the quals' own scale (the per-component
      // Kalman fold this drives is not this suite's subject); the OBSERVED
      // totals below are set well above what quals-derived beliefs predict —
      // that gap is what ELIM-OFF's residual fold is measuring.
      redScore: 13 * 60,
      blueScore: 13 * 45,
      hasScoreBreakdown: true,
      scoreBreakdownRaw: rawBreakdown2024Split(20, 9),
    })
  );
  return [...quals, ...elims];
}

function elimReplay(params: Sigma1Params, sequence: MatchResult[]): { predictions: Prediction[]; state: Sigma1State } {
  const algorithm = makeSigma1({ id: "sigma1-elim-offset-test", linkMode: "predictive-variance", params });
  let state: Sigma1State = algorithm.initState([]);
  const predictions: Prediction[] = [];
  for (const m of sequence) {
    predictions.push(algorithm.predict(state, toUpcoming(m)));
    state = algorithm.update(state, m);
  }
  return { predictions, state };
}

describe("elimScoreOffset — inert at default, wired when enabled, leak-free, margin-neutral, reset at season boundary", () => {
  it("DEFAULT_SIGMA1_PARAMS and elimScoreOffsetEwmaAlpha perturbed to an extreme (elimScoreOffsetEnabled stays false) produce byte-identical prediction streams, AND the post-replay accumulator is still { value: 0, count: 0 } for both", () => {
    const extremeOffParams: Sigma1Params = {
      ...DEFAULT_SIGMA1_PARAMS,
      elimScoreOffsetEnabled: false,
      elimScoreOffsetEwmaAlpha: 0.999,
    };
    const defaultRun = elimReplay(DEFAULT_SIGMA1_PARAMS, elimSequence());
    const offRun = elimReplay(extremeOffParams, elimSequence());
    expect(JSON.stringify(offRun.predictions)).toBe(JSON.stringify(defaultRun.predictions));
    expect(defaultRun.state.elimScoreOffset).toEqual({ value: 0, count: 0 });
    expect(offRun.state.elimScoreOffset).toEqual({ value: 0, count: 0 });
  });

  it("elimScoreOffsetEnabled: true, over a replay whose elim matches score systematically ABOVE prediction, drives elimScoreOffset.value positive and count up, and raises the elim predictions that follow", () => {
    const onParams: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, elimScoreOffsetEnabled: true };
    const onRun = elimReplay(onParams, elimBiasedSequence());
    const offRun = elimReplay(DEFAULT_SIGMA1_PARAMS, elimBiasedSequence());

    expect(onRun.state.elimScoreOffset.value).toBeGreaterThan(0);
    expect(onRun.state.elimScoreOffset.count).toBeGreaterThan(0);

    // Indices 0-2 are the qm quals (offset never applies there regardless of
    // the flag). Index 3 is "ef"'s own predict(), which runs BEFORE "ef"'s
    // own update() ever folds anything — still offset-0, proven directly by
    // the leak-freeness test below. Indices 4 ("qf") and 5 ("sf") run AFTER
    // at least one elim fold, so they are where the raise is observable.
    for (let i = 4; i < onRun.predictions.length; i++) {
      expect(onRun.predictions[i]!.redScore).toBeGreaterThan(offRun.predictions[i]!.redScore);
      expect(onRun.predictions[i]!.blueScore).toBeGreaterThan(offRun.predictions[i]!.blueScore);
    }
  });

  it("leak-freeness: the FIRST elim match of a cold-started replay is predicted with an offset of EXACTLY 0, even with the flag on", () => {
    const onParams: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, elimScoreOffsetEnabled: true };
    const onRun = elimReplay(onParams, elimBiasedSequence());
    const offRun = elimReplay(DEFAULT_SIGMA1_PARAMS, elimBiasedSequence());
    // Index 3: "ef"'s own predict(), strictly before any elim fold exists.
    expect(onRun.predictions[3]!.redScore).toBeCloseTo(offRun.predictions[3]!.redScore, 9);
    expect(onRun.predictions[3]!.blueScore).toBeCloseTo(offRun.predictions[3]!.blueScore, 9);
  });

  it("margin neutrality (D-13): every elim prediction's redScore - blueScore matches the flag-off run's margin to within floating-point tolerance, and winner is unchanged", () => {
    const onParams: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, elimScoreOffsetEnabled: true };
    const onRun = elimReplay(onParams, elimBiasedSequence());
    const offRun = elimReplay(DEFAULT_SIGMA1_PARAMS, elimBiasedSequence());
    for (let i = 3; i < onRun.predictions.length; i++) {
      const onMargin = onRun.predictions[i]!.redScore - onRun.predictions[i]!.blueScore;
      const offMargin = offRun.predictions[i]!.redScore - offRun.predictions[i]!.blueScore;
      // A TOLERANCE, not an exact equality — D-13's cancellation is
      // analytic, not bitwise: `(a+k) - (b+k)` is not guaranteed to equal
      // `a-b` in IEEE-754, so asserting exact equality here would be wrong.
      expect(onMargin).toBeCloseTo(offMargin, 9);
      expect(onRun.predictions[i]!.winner).toBe(offRun.predictions[i]!.winner);
    }
  });

  it("resets to { value: 0, count: 0 } after carrySeason across a real season boundary, even after learning a nonzero value", () => {
    const onParams: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, elimScoreOffsetEnabled: true };
    const algorithm = makeSigma1({ id: "sigma1-elim-offset-reset-test", linkMode: "predictive-variance", params: onParams });
    let state: Sigma1State = algorithm.initState([]);
    for (const m of elimBiasedSequence()) state = algorithm.update(state, m);

    // Sanity: the accumulator genuinely learned something before the reset —
    // otherwise this test could pass by never having moved at all.
    expect(state.elimScoreOffset.value).not.toBe(0);
    expect(state.elimScoreOffset.count).not.toBe(0);

    const carried = algorithm.carrySeason!(state, { fromSeason: 2024, toSeason: 2025, isColdStart: false });
    expect(carried.elimScoreOffset).toEqual({ value: 0, count: 0 });
  });

  it("quals are untouched: elimScoreOffsetEnabled: true over a QUALS-ONLY replay (swingingSequence, all qm) is byte-identical to the flag-off run", () => {
    const onParams: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, elimScoreOffsetEnabled: true };
    expect(JSON.stringify(swingingObservables(onParams))).toBe(JSON.stringify(swingingObservables(DEFAULT_SIGMA1_PARAMS)));
  });
});

/**
 * D-1's end-to-end proof (quick task 260905-kjb, CVR-WIRE): `carrySeason`'s
 * belief-variance seed for a RETURNING team, scaled by `carryVarianceFactor`
 * — inert at the default, wired when moved, gated on the SEASON BOUNDARY
 * (not the parameter's mere presence), reaching EVERY modeled component of
 * the incoming season (not merely a per-component name match, which is the
 * design this revision replaced), and floored at `minConsistencyVariance`
 * like every other seeded variance in this file.
 */

/**
 * (a) RED and BLUE must accumulate DIFFERENT totals in 2024: under
 * `predictive-variance` link mode a zero predicted margin pins `pRedWin` at
 * exactly 0.5 regardless of variance, so a SYMMETRIC fixture could not show
 * this knob's wiring effect at all. `rawBreakdown2024Split` (defined above
 * for the elim-offset tests) keeps T1/T2/T3 consistently ahead of T4/T5/T6
 * across both matches.
 */
function carryVarianceBoundarySequence(): MatchResult[] {
  const qualPairs: readonly [number, number][] = [
    [20, 8],
    [22, 9],
  ];
  return qualPairs.map(([redVal, blueVal], i) =>
    match({
      matchKey: `2024eventa_qm${i + 1}`,
      eventKey: "2024eventa",
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["T4", "T5", "T6"],
      redScore: 13 * redVal,
      blueScore: 13 * blueVal,
      hasScoreBreakdown: true,
      scoreBreakdownRaw: rawBreakdown2024Split(redVal, blueVal),
    })
  );
}

/** A single 2025 predict() for the same six teams, after a REAL 2024 -> 2025 `carrySeason` crossing. */
function carryVarianceObservables(params: Sigma1Params): unknown {
  const algorithm = makeSigma1({ id: "sigma1-carry-variance-test", linkMode: "predictive-variance", params });
  let state: Sigma1State = algorithm.initState([]);
  for (const m of carryVarianceBoundarySequence()) state = algorithm.update(state, m);
  const carried = algorithm.carrySeason!(state, { fromSeason: 2024, toSeason: 2025, isColdStart: false });
  return algorithm.predict(carried, {
    matchKey: "2025eventc_qm1",
    eventKey: "2025eventc",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 1,
    redTeams: ["T1", "T2", "T3"],
    blueTeams: ["T4", "T5", "T6"],
    redSurrogates: [],
    blueSurrogates: [],
    eventType: 0,
  });
}

describe("Sigma1ParamsSchema — carryVarianceFactor (D-1, CVR-PARAM)", () => {
  it("parses an object omitting the field and defaults it to exactly 1 — the executable proof every committed vpr@8.0.0+*.json file still parses unchanged", () => {
    const { carryVarianceFactor: _omitted, ...withoutIt } = DEFAULT_SIGMA1_PARAMS;
    const parsed = Sigma1ParamsSchema.parse(withoutIt);
    expect(parsed.carryVarianceFactor).toBe(1);
  });

  it.each([0, -0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects %s (outside the open-closed (0, 1] domain)",
    (value) => {
      expect(Sigma1ParamsSchema.safeParse({ ...DEFAULT_SIGMA1_PARAMS, carryVarianceFactor: value }).success).toBe(false);
    }
  );

  it.each([0.05, 0.3, 0.75, 1])("accepts %s", (value) => {
    expect(Sigma1ParamsSchema.safeParse({ ...DEFAULT_SIGMA1_PARAMS, carryVarianceFactor: value }).success).toBe(true);
  });
});

describe("carryVarianceFactor — inert at 1, wired at 0.3, gated on the season boundary (D-1, CVR-WIRE)", () => {
  it("DEFAULT_SIGMA1_PARAMS and an explicit carryVarianceFactor: 1 produce byte-identical prediction streams across a real 2024 -> 2025 season boundary", () => {
    const explicitParams: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, carryVarianceFactor: 1 };
    const defaultRun = carryVarianceObservables(DEFAULT_SIGMA1_PARAMS);
    const explicitRun = carryVarianceObservables(explicitParams);
    expect(JSON.stringify(explicitRun)).toBe(JSON.stringify(defaultRun));
  });

  it("carryVarianceFactor: 0.3 across that same boundary produces a stream that DIFFERS from the default — the mechanism is wired, not decorative", () => {
    const movedParams: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, carryVarianceFactor: 0.3 };
    const movedRun = carryVarianceObservables(movedParams);
    const defaultRun = carryVarianceObservables(DEFAULT_SIGMA1_PARAMS);
    expect(JSON.stringify(movedRun)).not.toBe(JSON.stringify(defaultRun));
  });

  it("carryVarianceFactor: 0.3 over a SINGLE-SEASON, no-boundary replay (swingingSequence, all qm) is byte-identical to the default — proves the gate is carrySeason, not the parameter's mere presence", () => {
    const movedParams: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, carryVarianceFactor: 0.3 };
    expect(JSON.stringify(swingingObservables(movedParams))).toBe(JSON.stringify(swingingObservables(DEFAULT_SIGMA1_PARAMS)));
  });
});

/**
 * A hand-built FROM-season (2024) state with exactly ONE returning team
 * ("T1", present in `state.teams`) and exactly one CARRY-WORTHY BUT
 * NON-RETURNING team ("T99", present ONLY in `priorSeasonRatings.lastSeason`
 * — `carryover.ts`'s `epaCarryover` `carryWorthyTeams` union is the ONLY
 * route by which a team can reach `carryResult.teamPointTotals` without ever
 * being in `state.teams`: a rating carried INTO `fromSeason` from the season
 * before it, for a team that then sat out `fromSeason` entirely). `league`
 * is deliberately EMPTY so `seedConsistencyFor` resolves to the SAME
 * `coldStartConsistencyVariance` for every component, making the seeded
 * variances directly comparable across factors and across components.
 */
function stateForCarryVarianceProbe(): Sigma1State {
  const componentOrder = [
    "autoLeave",
    "autoAmpNote",
    "autoSpeakerNote",
    "teleopAmpNote",
    "teleopSpeakerNote",
    "teleopSpeakerNoteAmplified",
    "endGameOnStage",
    "endGamePark",
    "endGameHarmony",
    "endGameNoteInTrap",
    "endGameSpotLightBonus",
    ADJUST_COMPONENT,
    "foulsCommitted",
  ];
  const beliefs: Record<string, TeamComponentBelief> = {};
  const consistency: Record<string, number> = {};
  for (const name of componentOrder) {
    beliefs[name] = { mean: 10, variance: 4 };
    consistency[name] = 4;
  }
  return {
    season: 2024,
    componentOrder,
    teams: new Map([
      [
        "T1",
        {
          beliefs,
          covariance: emptyCovariance(componentOrder.length),
          consistency,
          matchCount: 3,
          lastEventKey: "2024eventa",
          innovationStats: emptyInnovationStats(),
          rpBeliefs: {},
          rpCovariance: [],
          rpCrossCovariance: [],
          swing: emptyTeamSwing(),
        },
      ],
    ]),
    league: { componentMean: {}, componentConsistency: {}, rpVariableMean: {} },
    allianceScoreStats: emptyExpandingStats(),
    priorSeasonRatings: { lastSeason: new Map([["T99", 0]]), yearBefore: new Map() },
    rpSkippedMatchCount: 0,
    breakdownParseFailureCount: 0,
    elimScoreOffset: emptyElimScoreOffset(),
  };
}

function carriedStateAt(carryVarianceFactor: number): Sigma1State {
  const params: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, carryVarianceFactor };
  const algorithm = makeSigma1({ id: "sigma1-carry-variance-probe", linkMode: "predictive-variance", params });
  return algorithm.carrySeason!(stateForCarryVarianceProbe(), { fromSeason: 2024, toSeason: 2025, isColdStart: false });
}

describe("carrySeason's seeded variance, read directly off state (D-1, CVR-WIRE)", () => {
  it("no-carried-state branch: T99 (carry-worthy via priorSeasonRatings, absent from state.teams) has EVERY seeded belief variance bitwise equal at carryVarianceFactor 0.05 and 1", () => {
    const factor1 = carriedStateAt(1);
    const factor005 = carriedStateAt(0.05);
    const t99At1 = factor1.teams.get("T99");
    const t99At005 = factor005.teams.get("T99");
    expect(t99At1).toBeDefined();
    expect(t99At005).toBeDefined();
    for (const name of factor1.componentOrder) {
      expect(t99At005!.beliefs[name]!.variance).toBe(t99At1!.beliefs[name]!.variance);
    }
  });

  it("ALL-COMPONENTS reach: for the returning team T1 at carryVarianceFactor 0.3, EVERY modeled component of the incoming (2025) season is seeded at max(minConsistencyVariance, itsColdStartVariance * 0.3) — including 'algae', a component present in 2025's own OWN_FIELD_COMPONENT_MAP and ABSENT from 2024's", () => {
    const factor1 = carriedStateAt(1);
    const factor03 = carriedStateAt(0.3);
    const t1At1 = factor1.teams.get("T1")!;
    const t1At03 = factor03.teams.get("T1")!;
    // A component whose NAME does not survive the boundary — checked
    // directly against breakdown/2024.ts and breakdown/2025.ts's own
    // OWN_FIELD_COMPONENT_MAPs, not assumed. Both t1At1 and t1At03 target
    // the SAME incoming (2025) component set regardless of factor — the
    // absence to check is against the OUTGOING (2024) shape the fixture's
    // own `stateForCarryVarianceProbe` state was built with, not against
    // either carried result. A per-component NAME-MATCHED gate (Stage 1's
    // R1 shape, which this design deliberately replaced) could never move
    // "algae", because `oldTeamState.consistency["algae"]` is always
    // `undefined` at this real boundary. This field's TEAM-level gate does
    // move it — that is the entire point of this pin.
    expect(stateForCarryVarianceProbe().componentOrder).not.toContain("algae");
    expect(Object.keys(t1At1.beliefs)).toContain("algae");
    expect(Object.keys(t1At03.beliefs)).toContain("algae");

    const resolved = resolveSigma1Params(DEFAULT_SIGMA1_PARAMS, emptyExpandingStats());
    for (const name of Object.keys(t1At03.beliefs)) {
      if (name === ADJUST_COMPONENT) continue;
      // Factor 1 IS `coldStartVariance` bitwise, by the explicit `=== 1`
      // branch the inertness test above already establishes independently —
      // both t1At1 and t1At03 are carries of the SAME fixture state, so this
      // read is exact rather than approximate.
      const coldStartVariance = t1At1.beliefs[name]!.variance;
      const expected = Math.max(resolved.minConsistencyVariance, coldStartVariance * 0.3);
      expect(t1At03.beliefs[name]!.variance).toBeCloseTo(expected, 9);
    }
  });

  it("pinned branch: 'adjust' remains exactly { mean: 0, variance: 0 } at every carryVarianceFactor value tested", () => {
    for (const factor of [0.05, 0.3, 1]) {
      const t1 = carriedStateAt(factor).teams.get("T1")!;
      expect(t1.beliefs[ADJUST_COMPONENT]).toEqual({ mean: 0, variance: 0 });
    }
  });

  it("monotonicity: for T1's own 'autoMobility' (a component modeled in the incoming 2025 season), seeded variance at factor 0.25 is strictly less than at 0.5, strictly less than at 1", () => {
    const at025 = carriedStateAt(0.25).teams.get("T1")!.beliefs["autoMobility"]!.variance;
    const at05 = carriedStateAt(0.5).teams.get("T1")!.beliefs["autoMobility"]!.variance;
    const at1 = carriedStateAt(1).teams.get("T1")!.beliefs["autoMobility"]!.variance;
    expect(at025).toBeLessThan(at05);
    expect(at05).toBeLessThan(at1);
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
              innovationStats: emptyInnovationStats(),
              rpBeliefs: {},
              rpCovariance: [],
              rpCrossCovariance: [],
              swing: emptyTeamSwing(),
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
              innovationStats: emptyInnovationStats(),
              rpBeliefs: {},
              rpCovariance: [],
              rpCrossCovariance: [],
              swing: emptyTeamSwing(),
            },
          ],
        ]),
        league: { componentMean: {}, componentConsistency: {}, rpVariableMean: {} },
        allianceScoreStats: emptyExpandingStats(), // count === 0, forces the fallback
        priorSeasonRatings: { lastSeason: new Map(), yearBefore: new Map() },
        rpSkippedMatchCount: 0,
        breakdownParseFailureCount: 0,
        elimScoreOffset: emptyElimScoreOffset(),
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
      eventType: 0,
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

/**
 * D-T1/D-T2/F3's key-shape contract, asserted BOTH ways. The positive half
 * alone would pass a partial rename that left an old field behind; the
 * NEGATIVE half is what makes a half-finished rename fail loudly.
 */
describe("SIGMA1_PARAM_KEYS after the 4.0.0 shape change", () => {
  const keys = new Set<string>(SIGMA1_PARAM_KEYS as readonly string[]);

  it("carries the five renamed keys under their NEW names", () => {
    for (const key of [
      "processNoiseWithinEventRel",
      "processNoiseEventBoundaryRel",
      "minConsistencyVarianceRel",
      "coldStartConsistencyVarianceRel",
      "coldStartTeamTotalRel",
    ]) {
      expect(keys.has(key), `${key} must be present`).toBe(true);
    }
  });

  it("carries NONE of the retired absolute names — a partial rename fails here", () => {
    for (const key of [
      "processNoiseWithinEvent",
      "processNoiseEventBoundary",
      "minConsistencyVariance",
      "coldStartConsistencyVariance",
      "coldStartTeamTotal",
    ]) {
      expect(keys.has(key), `${key} was renamed by D-T1 and must be gone`).toBe(false);
    }
  });

  it("D-T2: one carryPriorYearShare replaces the two retired carry weights", () => {
    expect(keys.has("carryPriorYearShare")).toBe(true);
    expect(keys.has("carryLastYearWeight")).toBe(false);
    expect(keys.has("carryPriorYearWeight")).toBe(false);
  });

  it("F3: RP carries its own three ABSOLUTE fields", () => {
    expect(keys.has("rpProcessNoiseWithinEvent")).toBe(true);
    expect(keys.has("rpProcessNoiseEventBoundary")).toBe(true);
    expect(keys.has("rpColdStartVariance")).toBe(true);
  });

  it("stays the canonical sorted order derived from DEFAULT_SIGMA1_PARAMS, never hand-typed", () => {
    expect([...SIGMA1_PARAM_KEYS]).toEqual([...SIGMA1_PARAM_KEYS].sort());
    expect(SIGMA1_PARAM_KEYS.length).toBe(Object.keys(DEFAULT_SIGMA1_PARAMS).length);
  });
});

describe("Sigma1ParamsSchema — the invariants D-T1/F3 renamed or added", () => {
  it("rejects a set whose RELATIVE process-noise ordering is inverted (D-07, renamed not weakened)", () => {
    const bad = { ...DEFAULT_SIGMA1_PARAMS, processNoiseWithinEventRel: 5e-3, processNoiseEventBoundaryRel: 1e-3 };
    expect(() => Sigma1ParamsSchema.parse(bad)).toThrow(/processNoiseEventBoundaryRel must strictly exceed/);
  });

  it("rejects a set whose RP absolute process-noise ordering is inverted (F3, the same argument on the count-scale pair)", () => {
    const bad = { ...DEFAULT_SIGMA1_PARAMS, rpProcessNoiseWithinEvent: 5, rpProcessNoiseEventBoundary: 1 };
    expect(() => Sigma1ParamsSchema.parse(bad)).toThrow(/rpProcessNoiseEventBoundary must strictly exceed/);
  });

  it("rejects a carryPriorYearShare outside [0, 1] (D-04/D-T2)", () => {
    expect(() => Sigma1ParamsSchema.parse({ ...DEFAULT_SIGMA1_PARAMS, carryPriorYearShare: 1.5 })).toThrow(/carryPriorYearShare/);
    expect(() => Sigma1ParamsSchema.parse({ ...DEFAULT_SIGMA1_PARAMS, carryPriorYearShare: -0.1 })).toThrow(/carryPriorYearShare/);
  });

  it("still rejects a retired key by name — z.strictObject means no 3.0.0 file can be read as a 4.0.0 one", () => {
    const legacyShaped = { ...DEFAULT_SIGMA1_PARAMS, processNoiseWithinEvent: 0.5 };
    expect(() => Sigma1ParamsSchema.parse(legacyShaped)).toThrow(/[Uu]nrecognized key/);
  });
});
