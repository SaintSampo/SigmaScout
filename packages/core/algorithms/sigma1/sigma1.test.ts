/**
 * Synthetic-fixture tests for the assembled Sigma1 `AlgorithmModule`
 * (ALGO-03) — matching `opr.test.ts`/`epa.test.ts`'s "known answer or
 * provable structural property" convention.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGMA1_PARAMS,
  SIGMA1_CONSISTENCY_CARRY_DECAY,
  SIGMA1_MIN_CONSISTENCY_VARIANCE,
  makeSigma1,
  sigma1,
  sigma1NormalCdf,
  sigma1SeasonSd,
  teamTotalVariance,
  type Sigma1State,
} from "./index.js";
import { emptyExpandingStats } from "../../scoring/expandingStats.js";
import { FALLBACK_NOISE_MULTIPLIER } from "../breakdown/fallback.js";
import { FOULS_COMMITTED_COMPONENT } from "../breakdown/index.js";
import type { MatchResult, UpcomingMatch } from "../types.js";
import { emptyInnovationStats } from "./adaptation.js";
import { opr } from "../opr.js";
import { epa } from "../epa.js";

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

/**
 * A valid 2024 `score_breakdown` JSON where BOTH alliances' 13 canonical
 * Sigma1 components (the 12 `OWN_FIELD_COMPONENT_MAP` fields plus
 * `foulsCommitted`) each parse to exactly `perComponentValue` — chosen so
 * the parsed vector matches `distributeResidual`'s own cold-start UNIFORM
 * split exactly (every Sigma1 component starts at an identical cold-start
 * mean, so `predictedComponentTotals` is uniform across components too),
 * letting tests isolate one variable (e.g. measurement-noise inflation)
 * without the real-vs-fallback paths also differing in their innovation.
 */
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
    // Each side's OWN foulPoints becomes the OPPOSING side's
    // foulsCommitted value (breakdown/2024.ts's parse()) — identical `side`
    // objects on both alliances keeps both alliances' foulsCommitted equal
    // to perComponentValue too.
    foulPoints: perComponentValue,
    // Plan 03-03: rp/2024.ts's OWN Zod schema (a DIFFERENT required-field
    // set than breakdown/2024.ts's, since sigma1/index.ts's update() now
    // also parses this same raw JSON through the season's RP rule module)
    // requires these fields too — breakdown/2024.ts's schema silently
    // strips them (default "strip" mode), so adding them here cannot
    // affect any SCORE-side assertion this file makes; placeholder values
    // since no test in this file exercises RP behavior.
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

const SIGMA1_2024_COMPONENT_COUNT = 13; // 12 OWN_FIELD_COMPONENT_MAP keys + foulsCommitted
const UNIFORM_PER_COMPONENT = 10;
const UNIFORM_TOTAL = SIGMA1_2024_COMPONENT_COUNT * UNIFORM_PER_COMPONENT; // 130

/**
 * T-03-18b (security audit, phase 03, quick task 260818-inm): derives a
 * malformed 2024 payload from `rawBreakdown2024Uniform`'s well-formed
 * baseline by deleting `fieldsToOmit` from BOTH sides, rather than
 * hand-typing a second payload — the malformed and well-formed fixtures
 * provably differ only in the removed fields.
 */
function rawBreakdown2024MissingFields(perComponentValue: number, fieldsToOmit: readonly string[]): string {
  const full = JSON.parse(rawBreakdown2024Uniform(perComponentValue)) as {
    red: Record<string, unknown>;
    blue: Record<string, unknown>;
  };
  for (const side of [full.red, full.blue]) {
    for (const field of fieldsToOmit) delete side[field];
  }
  return JSON.stringify(full);
}

/** The real `2024cafb_qm1` shape (security audit): missing `adjustPoints` on both sides, 2 Zod issues. */
const CAFB_QM1_MISSING_FIELDS = ["adjustPoints"];
/** The real `2024wvrox_sf1m1` shape (security audit): only `autoLeavePoints` survives per side, 20 Zod issues. */
const WVROX_SF1M1_MISSING_FIELDS = [
  "autoAmpNotePoints",
  "autoSpeakerNotePoints",
  "teleopAmpNotePoints",
  "teleopSpeakerNotePoints",
  "teleopSpeakerNoteAmplifiedPoints",
  "endGameOnStagePoints",
  "endGameParkPoints",
  "endGameHarmonyPoints",
  "endGameNoteInTrapPoints",
  "endGameSpotLightBonusPoints",
  "adjustPoints",
  "foulPoints",
];

function serializeState(state: Sigma1State): string {
  return JSON.stringify({
    season: state.season,
    componentOrder: state.componentOrder,
    teams: Object.fromEntries(state.teams),
    league: state.league,
    allianceScoreStats: state.allianceScoreStats,
    priorSeasonRatings: {
      lastSeason: Object.fromEntries(state.priorSeasonRatings.lastSeason),
      yearBefore: Object.fromEntries(state.priorSeasonRatings.yearBefore),
    },
  });
}

describe("sigma1.predict — shape", () => {
  it("returns winner, pRedWin, redScore, blueScore, variance, and per-component mean+variance vectors for both alliances", () => {
    let state = sigma1.initState([]);
    state = sigma1.update(
      state,
      match({
        matchKey: "2024test_qm1",
        redTeams: ["T1", "T2", "T3"],
        blueTeams: ["T4", "T5", "T6"],
        redScore: UNIFORM_TOTAL,
        blueScore: UNIFORM_TOTAL,
        hasScoreBreakdown: true,
        scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
      })
    );

    const upcoming: UpcomingMatch = {
      matchKey: "2024test_qm2",
      eventKey: "2024test",
      compLevel: "qm",
      setNumber: 1,
      matchNumber: 2,
      redTeams: ["T1", "T4", "T7"],
      blueTeams: ["T2", "T5", "T8"],
      redSurrogates: [],
      blueSurrogates: [],
      eventType: 0,
    };
    const prediction = sigma1.predict(state, upcoming);

    expect(["red", "blue"]).toContain(prediction.winner);
    expect(prediction.pRedWin).toBeGreaterThanOrEqual(0);
    expect(prediction.pRedWin).toBeLessThanOrEqual(1);
    expect(typeof prediction.redScore).toBe("number");
    expect(typeof prediction.blueScore).toBe("number");
    expect(typeof prediction.variance).toBe("number");
    expect(Number.isNaN(prediction.variance)).toBe(false);
    expect(prediction.redComponents).toBeDefined();
    expect(prediction.blueComponents).toBeDefined();
    for (const c of Object.values(prediction.redComponents!)) {
      expect(typeof c.mean).toBe("number");
      expect(typeof c.variance).toBe("number");
    }
    for (const c of Object.values(prediction.blueComponents!)) {
      expect(typeof c.mean).toBe("number");
      expect(typeof c.variance).toBe("number");
    }
  });

  it("gives a red-win probability of exactly 0.5 when the predicted score margin is zero (no ratings yet)", () => {
    const state = sigma1.initState([]);
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
    const prediction = sigma1.predict(state, upcoming);
    expect(prediction.redScore).toBe(0);
    expect(prediction.blueScore).toBe(0);
    expect(prediction.pRedWin).toBe(0.5);
  });
});

describe("sigma1.predict — D-01 own-variance publish (Phase 6)", () => {
  it("returns redScoreVarianceOwn/blueScoreVarianceOwn as finite numbers equal to each alliance's own posterior + covariance total, computed independently", () => {
    let state = sigma1.initState([]);
    state = sigma1.update(
      state,
      match({
        matchKey: "2024test_qm1",
        redTeams: ["T1", "T2", "T3"],
        blueTeams: ["T4", "T5", "T6"],
        redScore: UNIFORM_TOTAL,
        blueScore: UNIFORM_TOTAL,
        hasScoreBreakdown: true,
        scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
      })
    );

    const upcoming: UpcomingMatch = {
      matchKey: "2024test_qm2",
      eventKey: "2024test",
      compLevel: "qm",
      setNumber: 1,
      matchNumber: 2,
      redTeams: ["T1", "T4", "T7"],
      blueTeams: ["T2", "T5", "T8"],
      redSurrogates: [],
      blueSurrogates: [],
      eventType: 0,
    };
    const prediction = sigma1.predict(state, upcoming);

    expect(typeof prediction.redScoreVarianceOwn).toBe("number");
    expect(typeof prediction.blueScoreVarianceOwn).toBe("number");
    expect(Number.isFinite(prediction.redScoreVarianceOwn)).toBe(true);
    expect(Number.isFinite(prediction.blueScoreVarianceOwn)).toBe(true);

    // Independently recompute each alliance's posterior + covariance total
    // straight from `state`, rather than reading back predict()'s own
    // expression — a schema-shape assertion alone would pass even if the
    // field were populated with the wrong number (or left permanently 0).
    const posteriorSum = (teams: readonly string[]): number =>
      teams.reduce((sum, team) => {
        const beliefs = state.teams.get(team)?.beliefs;
        if (!beliefs) return sum;
        return sum + Object.values(beliefs).reduce((s, b) => s + b.variance, 0);
      }, 0);
    const covarianceSum = (teams: readonly string[]): number =>
      teams.reduce((sum, team) => sum + teamTotalVariance(state.teams.get(team)?.covariance ?? []), 0);

    const expectedRed = posteriorSum(["T1", "T4", "T7"]) + covarianceSum(["T1", "T4", "T7"]);
    const expectedBlue = posteriorSum(["T2", "T5", "T8"]) + covarianceSum(["T2", "T5", "T8"]);

    expect(Math.abs(prediction.redScoreVarianceOwn! - expectedRed)).toBeLessThan(1e-9);
    expect(Math.abs(prediction.blueScoreVarianceOwn! - expectedBlue)).toBeLessThan(1e-9);
  });

  it("opr.predict and epa.predict both leave redScoreVarianceOwn/blueScoreVarianceOwn undefined — neither models an alliance-level own variance", () => {
    const upcoming: UpcomingMatch = {
      matchKey: "2024test_qm1",
      eventKey: "2024test",
      compLevel: "qm",
      setNumber: 1,
      matchNumber: 1,
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["T4", "T5", "T6"],
      redSurrogates: [],
      blueSurrogates: [],
      eventType: 0,
    };

    const oprPrediction = opr.predict(opr.initState([]), upcoming);
    expect(oprPrediction.redScoreVarianceOwn).toBeUndefined();
    expect(oprPrediction.blueScoreVarianceOwn).toBeUndefined();

    const epaPrediction = epa.predict(epa.initState([]), upcoming);
    expect(epaPrediction.redScoreVarianceOwn).toBeUndefined();
    expect(epaPrediction.blueScoreVarianceOwn).toBeUndefined();
  });
});

describe("teamMetrics — D-27 contract shape", () => {
  it("returns exactly the requested teams, each with one entry per component plus total, every entry carrying a defined spread", () => {
    let state = sigma1.initState([]);
    state = sigma1.update(
      state,
      match({
        matchKey: "2024test_qm1",
        redTeams: ["frc254", "T2", "T3"],
        blueTeams: ["T4", "T5", "T6"],
        redScore: UNIFORM_TOTAL,
        blueScore: UNIFORM_TOTAL,
        hasScoreBreakdown: true,
        scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
      })
    );

    const metrics = sigma1.teamMetrics(state, ["frc254"]);
    expect(Object.keys(metrics)).toEqual(["frc254"]);
    const frc254 = metrics["frc254"]!;
    // One entry per component, plus total, plus the three phase groups
    // (phaseAuto/phaseTeleop/phaseEndgame) — see breakdown/groups.ts.
    expect(Object.keys(frc254).length).toBe(SIGMA1_2024_COMPONENT_COUNT + 1 + 3);
    for (const metric of Object.values(frc254)) {
      expect(metric.spread).toBeDefined();
      expect(Number.isFinite(metric.spread)).toBe(true);
    }
    expect(frc254["total"]).toBeDefined();

    // Each group carries a real spread of its own, derived from the
    // covariance quadratic form over its component indices — never a sum of
    // the per-component spreads, which would ignore the off-diagonal terms.
    for (const groupKey of ["phaseAuto", "phaseTeleop", "phaseEndgame"]) {
      const group = frc254[groupKey];
      expect(group, `${groupKey} must be published`).toBeDefined();
      expect(Number.isFinite(group!.value)).toBe(true);
      expect(Number.isFinite(group!.spread)).toBe(true);
    }

    // The group values partition the components, so together with the
    // ungrouped ones they must reconstruct total exactly.
    const groupSum = frc254["phaseAuto"]!.value + frc254["phaseTeleop"]!.value + frc254["phaseEndgame"]!.value;
    const ungroupedSum = (frc254["adjust"]?.value ?? 0) + (frc254["foulsCommitted"]?.value ?? 0);
    expect(groupSum + ungroupedSum).toBeCloseTo(frc254["total"]!.value, 9);
  });

  it("with no team filter, returns every team the state knows", () => {
    let state = sigma1.initState([]);
    state = sigma1.update(
      state,
      match({
        matchKey: "2024test_qm1",
        redTeams: ["T1", "T2", "T3"],
        blueTeams: ["T4", "T5", "T6"],
        redScore: UNIFORM_TOTAL,
        blueScore: UNIFORM_TOTAL,
        hasScoreBreakdown: true,
        scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
      })
    );
    const metrics = sigma1.teamMetrics(state);
    expect(Object.keys(metrics).sort()).toEqual(["T1", "T2", "T3", "T4", "T5", "T6"].sort());
  });
});

describe("teamMetrics — honest-variance check", () => {
  it("two teams with identical means but different observed residual histories report different spread values", () => {
    const componentOrder = ["autoLeave"];
    const state: Sigma1State = {
      season: 2024,
      componentOrder,
      teams: new Map([
        [
          "STEADY",
          {
            beliefs: { autoLeave: { mean: 10, variance: 4 } },
            covariance: [[4]],
            consistency: { autoLeave: 2 },
            matchCount: 20,
            lastEventKey: "2024test",
            innovationStats: emptyInnovationStats(),
            rpBeliefs: {},
            rpCovariance: [],
            rpCrossCovariance: [],
          },
        ],
        [
          "STREAKY",
          {
            beliefs: { autoLeave: { mean: 10, variance: 4 } },
            covariance: [[50]],
            consistency: { autoLeave: 40 },
            matchCount: 20,
            lastEventKey: "2024test",
            innovationStats: emptyInnovationStats(),
            rpBeliefs: {},
            rpCovariance: [],
            rpCrossCovariance: [],
          },
        ],
      ]),
      league: { componentMean: {}, componentConsistency: {}, rpVariableMean: {} },
      allianceScoreStats: emptyExpandingStats(),
      priorSeasonRatings: { lastSeason: new Map(), yearBefore: new Map() },
      rpSkippedMatchCount: 0,
      breakdownParseFailureCount: 0,
    };

    const metrics = sigma1.teamMetrics(state);
    expect(metrics["STEADY"]!["autoLeave"]!.value).toBe(metrics["STREAKY"]!["autoLeave"]!.value);
    expect(metrics["STEADY"]!["autoLeave"]!.spread).not.toBe(metrics["STREAKY"]!["autoLeave"]!.spread);
    // total spread also differs, since covariance matrices differ.
    expect(metrics["STEADY"]!["total"]!.spread).not.toBe(metrics["STREAKY"]!["total"]!.spread);
  });
});

/**
 * Plan 07-06 (D-01/D-02/D-03): `TeamMetric.spread` is redefined at its
 * assembly site from `√R` (D-09 consistency alone) to `√(P + R)` — the same
 * two-term construction `predict()`'s own `redScoreVarianceOwn`/
 * `blueScoreVarianceOwn` already use. This describe block is the tracer's
 * end-to-end proof (Task 1): the additivity identity pinned against
 * `predict()`'s own output, the non-vacuity of that identity, and the
 * floor-errs-wide direction.
 */
describe("teamMetrics — D-01/D-02 the ± redefinition (plan 07-06)", () => {
  /**
   * Same field set as `rawBreakdown2024Uniform` above (score fields plus the
   * RP-side placeholder fields `rp/2024.ts`'s own schema requires), but with
   * INDEPENDENT red/blue per-component values so repeated matches fold
   * genuinely varying residuals into every team's posterior AND covariance
   * — needed so Test 2 (non-vacuity) is real: a uniform, ever-repeating
   * observation would converge residuals toward zero and let the
   * `SIGMA1_MIN_CONSISTENCY_VARIANCE` floor do the work Test 1's identity is
   * supposed to be proving happens without it.
   */
  function rawBreakdown2024Split(redVal: number, blueVal: number): string {
    function side(perComponentValue: number) {
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

  const SIX_TEAM_RED_VALUES = [8, 22, 5, 30, 12, 25, 3, 18];
  const SIX_TEAM_BLUE_VALUES = [15, 4, 28, 9, 20, 6, 24, 11];

  /**
   * Six teams (T1-T3 red, T4-T6 blue), the same alliance pairing across
   * eight matches with genuinely varying per-component observations —
   * builds non-degenerate beliefs (P) AND covariance matrices (R) for every
   * team, per this task's `<behavior>` requirement.
   */
  function buildSixTeamFixtureState(): Sigma1State {
    let state = sigma1.initState([]);
    for (let i = 0; i < SIX_TEAM_RED_VALUES.length; i++) {
      state = sigma1.update(
        state,
        match({
          matchKey: `2024test_qm${i + 1}`,
          redTeams: ["T1", "T2", "T3"],
          blueTeams: ["T4", "T5", "T6"],
          hasScoreBreakdown: true,
          scoreBreakdownRaw: rawBreakdown2024Split(SIX_TEAM_RED_VALUES[i]!, SIX_TEAM_BLUE_VALUES[i]!),
        })
      );
    }
    return state;
  }

  const SIX_TEAM_UPCOMING: UpcomingMatch = {
    matchKey: "2024test_qm99",
    eventKey: "2024test",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 99,
    redTeams: ["T1", "T2", "T3"],
    blueTeams: ["T4", "T5", "T6"],
    redSurrogates: [],
    blueSurrogates: [],
    eventType: 0,
  };

  it("Test 1 (the tracer's proof) — three teams' published TOTAL spread squares sum to predict()'s own redScoreVarianceOwn/blueScoreVarianceOwn, on both alliances", () => {
    const state = buildSixTeamFixtureState();
    const prediction = sigma1.predict(state, SIX_TEAM_UPCOMING);
    const redMetrics = sigma1.teamMetrics(state, SIX_TEAM_UPCOMING.redTeams);
    const blueMetrics = sigma1.teamMetrics(state, SIX_TEAM_UPCOMING.blueTeams);

    const redSumOfSquares = SIX_TEAM_UPCOMING.redTeams.reduce(
      (sum, team) => sum + redMetrics[team]!["total"]!.spread! ** 2,
      0
    );
    const blueSumOfSquares = SIX_TEAM_UPCOMING.blueTeams.reduce(
      (sum, team) => sum + blueMetrics[team]!["total"]!.spread! ** 2,
      0
    );

    expect(Math.abs(redSumOfSquares - prediction.redScoreVarianceOwn!)).toBeLessThan(1e-9);
    expect(Math.abs(blueSumOfSquares - prediction.blueScoreVarianceOwn!)).toBeLessThan(1e-9);
  });

  it("Test 2 (non-vacuity of Test 1) — the SIGMA1_MIN_CONSISTENCY_VARIANCE floor does not bind for any of the six fixture teams", () => {
    const state = buildSixTeamFixtureState();
    for (const team of ["T1", "T2", "T3", "T4", "T5", "T6"]) {
      const teamState = state.teams.get(team)!;
      expect(teamTotalVariance(teamState.covariance)).toBeGreaterThan(SIGMA1_MIN_CONSISTENCY_VARIANCE);
    }
  });

  it("Test 3 — the floor errs wide, never narrow: a cold-start team's TOTAL spread strictly exceeds sqrt(the floor), because P is genuinely added on top of the floored R", () => {
    const componentOrder = ["autoLeave"];
    const state: Sigma1State = {
      season: 2024,
      componentOrder,
      teams: new Map([
        [
          "COLDSTART",
          {
            beliefs: { autoLeave: { mean: 10, variance: 4 } },
            // All-zero covariance — a genuine cold-start team, so
            // `teamTotalVariance` is 0 and the `minConsistencyVariance`
            // floor binds (PD-04).
            covariance: [[0]],
            consistency: { autoLeave: DEFAULT_SIGMA1_PARAMS.coldStartConsistencyVariance },
            matchCount: 0,
            lastEventKey: null,
            innovationStats: emptyInnovationStats(),
            rpBeliefs: {},
            rpCovariance: [],
            rpCrossCovariance: [],
          },
        ],
      ]),
      league: { componentMean: {}, componentConsistency: {}, rpVariableMean: {} },
      allianceScoreStats: emptyExpandingStats(),
      priorSeasonRatings: { lastSeason: new Map(), yearBefore: new Map() },
      rpSkippedMatchCount: 0,
      breakdownParseFailureCount: 0,
    };

    const metrics = sigma1.teamMetrics(state, ["COLDSTART"]);
    const totalSpread = metrics["COLDSTART"]!["total"]!.spread!;
    expect(Number.isFinite(totalSpread)).toBe(true);
    expect(totalSpread).toBeGreaterThan(0);
    expect(totalSpread).toBeGreaterThan(Math.sqrt(SIGMA1_MIN_CONSISTENCY_VARIANCE));
  });

  // Test 4 (regression floor, per this task's <behavior>): the pre-existing
  // "teamMetrics — D-27 contract shape" and "teamMetrics — honest-variance
  // check" describe blocks above are left byte-identical in this task's
  // diff and continue to pass unmodified under P + R — proven by the diff
  // itself (no edit to either block) rather than by a fourth added test,
  // which would falsify this task's own "3 higher" case-count criterion.
});

describe("D-05 fallback — null scoreBreakdownRaw still updates state, with inflated measurement noise", () => {
  it("a match with a null scoreBreakdownRaw still changes team state, and the fallback path's posterior variance shrinks LESS than an equivalent real-breakdown update (proving the inflated FALLBACK_NOISE_MULTIPLIER measurement noise was actually used)", () => {
    const realMatch = match({
      matchKey: "2024test_qm1",
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["T4", "T5", "T6"],
      redScore: UNIFORM_TOTAL,
      blueScore: UNIFORM_TOTAL,
      hasScoreBreakdown: true,
      scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
    });
    const fallbackMatch = match({
      matchKey: "2024test_qm1",
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["T4", "T5", "T6"],
      redScore: UNIFORM_TOTAL,
      blueScore: UNIFORM_TOTAL,
      hasScoreBreakdown: false,
      scoreBreakdownRaw: null,
    });

    let realState = sigma1.initState([]);
    realState = sigma1.update(realState, realMatch);
    let fallbackState = sigma1.initState([]);
    fallbackState = sigma1.update(fallbackState, fallbackMatch);

    // Both teams' state changed (state was not skipped/left cold-start).
    expect(fallbackState.teams.has("T1")).toBe(true);
    expect(fallbackState.teams.get("T1")!.matchCount).toBe(1);

    // At a genuine cold start, distributeResidual's fallback resolves to a
    // UNIFORM split identical to rawBreakdown2024Uniform's construction
    // (see that helper's own doc comment) — so both paths share the same
    // prior and the same innovation, isolating measurement-noise inflation
    // as the only difference. A larger R (fallback, x FALLBACK_NOISE_
    // MULTIPLIER) produces a strictly SMALLER Kalman gain and therefore a
    // strictly LARGER (less-shrunk) posterior variance than the real path.
    const realVariance = realState.teams.get("T1")!.beliefs["autoLeave"]!.variance;
    const fallbackVariance = fallbackState.teams.get("T1")!.beliefs["autoLeave"]!.variance;
    expect(fallbackVariance).toBeGreaterThan(realVariance);
  });
});

describe("all-surrogate alliance — no throw, no NaN, genuine no-op", () => {
  it("produces a prediction and a no-op update for an alliance whose every team is a surrogate", () => {
    const state = sigma1.initState([]);
    const upcoming: UpcomingMatch = {
      matchKey: "2024test_qm1",
      eventKey: "2024test",
      compLevel: "qm",
      setNumber: 1,
      matchNumber: 1,
      redTeams: ["S1", "S2", "S3"],
      blueTeams: ["B1", "B2", "B3"],
      redSurrogates: ["S1", "S2", "S3"],
      blueSurrogates: [],
      eventType: 0,
    };

    expect(() => sigma1.predict(state, upcoming)).not.toThrow();
    const prediction = sigma1.predict(state, upcoming);
    expect(Number.isNaN(prediction.pRedWin)).toBe(false);
    expect(Number.isNaN(prediction.variance)).toBe(false);

    const result: MatchResult = {
      ...upcoming,
      winner: "blue",
      redScore: UNIFORM_TOTAL,
      blueScore: UNIFORM_TOTAL,
      redRpEarned: null,
      blueRpEarned: null,
      hasScoreBreakdown: true,
      scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
    };
    expect(() => sigma1.update(state, result)).not.toThrow();
    const nextState = sigma1.update(state, result);
    // Red is entirely surrogates -> a genuine no-op for red's teams; blue
    // updates normally (mirrors opr.ts's/epa.ts's own empty-observation
    // handling).
    expect(nextState.teams.has("S1")).toBe(false);
    expect(nextState.teams.has("S2")).toBe(false);
    expect(nextState.teams.has("S3")).toBe(false);
    expect(nextState.teams.has("B1")).toBe(true);
  });
});

describe("D-07 process noise — cross-event vs within-event", () => {
  it("applies strictly more process noise at an event boundary than within the same event, producing a strictly larger posterior variance after the following update", () => {
    const firstMatch = match({
      matchKey: "2024eventa_qm1",
      eventKey: "2024eventa",
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["B1", "B2", "B3"],
      redScore: UNIFORM_TOTAL,
      blueScore: UNIFORM_TOTAL,
      hasScoreBreakdown: true,
      scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
    });

    let stateSameEvent = sigma1.update(sigma1.initState([]), firstMatch);
    let stateCrossEvent = sigma1.update(sigma1.initState([]), firstMatch);

    const secondMatchSameEvent = match({
      matchKey: "2024eventa_qm2",
      eventKey: "2024eventa",
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["B1", "B2", "B3"],
      redScore: UNIFORM_TOTAL,
      blueScore: UNIFORM_TOTAL,
      hasScoreBreakdown: true,
      scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
    });
    const secondMatchCrossEvent = match({
      matchKey: "2024eventb_qm1",
      eventKey: "2024eventb",
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["B1", "B2", "B3"],
      redScore: UNIFORM_TOTAL,
      blueScore: UNIFORM_TOTAL,
      hasScoreBreakdown: true,
      scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
    });

    stateSameEvent = sigma1.update(stateSameEvent, secondMatchSameEvent);
    stateCrossEvent = sigma1.update(stateCrossEvent, secondMatchCrossEvent);

    const sameEventVariance = stateSameEvent.teams.get("T1")!.beliefs["autoLeave"]!.variance;
    const crossEventVariance = stateCrossEvent.teams.get("T1")!.beliefs["autoLeave"]!.variance;
    expect(crossEventVariance).toBeGreaterThan(sameEventVariance);
  });
});

describe("makeSigma1 — distinct ids, shared update path, mode-specific predict", () => {
  it("gives sigma1 / sigma1SeasonSd / sigma1NormalCdf distinct ids matching D-12's three modes", () => {
    expect(sigma1.id).toBe("sigma1");
    expect(sigma1SeasonSd.id).toBe("sigma1-seasonsd");
    expect(sigma1NormalCdf.id).toBe("sigma1-normalcdf");
  });

  it("produces identical state via update() across all three modes, differing only in predict's outputs that depend on the link mode", () => {
    const m = match({
      matchKey: "2024test_qm1",
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["T4", "T5", "T6"],
      redScore: UNIFORM_TOTAL,
      blueScore: UNIFORM_TOTAL,
      hasScoreBreakdown: true,
      scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
    });

    const s1 = sigma1.update(sigma1.initState([]), m);
    const s2 = sigma1SeasonSd.update(sigma1SeasonSd.initState([]), m);
    const s3 = sigma1NormalCdf.update(sigma1NormalCdf.initState([]), m);

    expect(serializeState(s1)).toBe(serializeState(s2));
    expect(serializeState(s1)).toBe(serializeState(s3));

    const upcoming: UpcomingMatch = {
      matchKey: "2024test_qm2",
      eventKey: "2024test",
      compLevel: "qm",
      setNumber: 1,
      matchNumber: 2,
      redTeams: ["T1", "T4", "T7"],
      blueTeams: ["T2", "T5", "T8"],
      redSurrogates: [],
      blueSurrogates: [],
      eventType: 0,
    };
    const p1 = sigma1.predict(s1, upcoming);
    const p2 = sigma1SeasonSd.predict(s2, upcoming);
    const p3 = sigma1NormalCdf.predict(s3, upcoming);

    // Score/variance predictions don't depend on the link mode at all.
    expect(p1.redScore).toBe(p2.redScore);
    expect(p1.blueScore).toBe(p2.blueScore);
    expect(p1.variance).toBe(p2.variance);
    expect(p1.redScore).toBe(p3.redScore);
    expect(p1.variance).toBe(p3.variance);
  });

  it("makeSigma1({ id, linkMode }) round-trips a custom id", () => {
    const custom = makeSigma1({ id: "sigma1-custom", linkMode: "season-sd" });
    expect(custom.id).toBe("sigma1-custom");
  });

  it("throws when constructed with a params object that violates a cross-parameter invariant (WR-02, 03.1-REVIEW.md: makeSigma1 must parse options.params through Sigma1ParamsSchema, not merely accept it by TypeScript shape)", () => {
    // D-07's invariant: processNoiseEventBoundary must strictly exceed
    // processNoiseWithinEvent. TypeScript's structural typing enforces the
    // shape of Sigma1Params but not this cross-parameter invariant, so an
    // object like this compiles fine and previously reached makeSigma1
    // unvalidated.
    expect(() =>
      makeSigma1({
        id: "sigma1-invalid",
        linkMode: "predictive-variance",
        params: { ...DEFAULT_SIGMA1_PARAMS, processNoiseEventBoundary: 1, processNoiseWithinEvent: 5 },
      })
    ).toThrow(/processNoiseEventBoundary must strictly exceed processNoiseWithinEvent/);
  });
});

describe("determinism — replaying the same fixture twice", () => {
  it("produces byte-identical predictions", () => {
    const matches: MatchResult[] = [
      match({
        matchKey: "2024eventa_qm1",
        eventKey: "2024eventa",
        redTeams: ["T1", "T2", "T3"],
        blueTeams: ["T4", "T5", "T6"],
        redScore: UNIFORM_TOTAL,
        blueScore: UNIFORM_TOTAL,
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

    function replay(): unknown[] {
      let state = sigma1.initState([]);
      const predictions: unknown[] = [];
      for (const m of matches) {
        const upcoming: UpcomingMatch = {
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
        predictions.push(sigma1.predict(state, upcoming));
        state = sigma1.update(state, m);
      }
      return predictions;
    }

    const run1 = replay();
    const run2 = replay();
    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
  });
});

describe("T-02-01 — non-finite observed component values throw rather than fold into Kalman state", () => {
  it("throws when result.redScore is non-finite (a distributeResidual degenerate value that would otherwise reach updateAllianceSum unchecked)", () => {
    const state = sigma1.initState([]);
    const brokenMatch = match({
      matchKey: "2024test_qm1",
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["T4", "T5", "T6"],
      redScore: Number.NaN,
      blueScore: UNIFORM_TOTAL,
      hasScoreBreakdown: false,
      scoreBreakdownRaw: null,
    });
    expect(() => sigma1.update(state, brokenMatch)).toThrow(/non-finite/);
  });
});

describe("sigma1.update — D-05 fallback attribution (CR-01, code review phase 02)", () => {
  it("a NON-uniform predicted vector with a nonzero prior foulsCommitted mean: foulsCommitted's belief mean is carried forward unchanged, and the opponent's predicted foul contribution is netted out before the offensive split", () => {
    // Unlike rawBreakdown2024Uniform (deliberately uniform, so it
    // coincidentally matches distributeResidual's cold-start uniform
    // branch and cannot expose non-uniform misattribution), R1's predicted
    // shares here are deliberately non-uniform (40 vs 10) with a nonzero
    // prior foulsCommitted mean (8) — the exact shape CR-01 names as
    // untested. A custom 3-component componentOrder keeps the hand math
    // tractable while still exercising the real fallback code path.
    const componentOrder = ["autoLeave", "teleopSpeakerNote", FOULS_COMMITTED_COMPONENT];
    const state: Sigma1State = {
      season: 2024,
      componentOrder,
      teams: new Map([
        [
          "R1",
          {
            beliefs: {
              autoLeave: { mean: 40, variance: 4 },
              teleopSpeakerNote: { mean: 10, variance: 4 },
              [FOULS_COMMITTED_COMPONENT]: { mean: 8, variance: 4 },
            },
            covariance: [
              [4, 0, 0],
              [0, 4, 0],
              [0, 0, 4],
            ],
            consistency: { autoLeave: 2, teleopSpeakerNote: 2, [FOULS_COMMITTED_COMPONENT]: 2 },
            matchCount: 5,
            lastEventKey: "2024test",
            innovationStats: emptyInnovationStats(),
            rpBeliefs: {},
            rpCovariance: [],
            rpCrossCovariance: [],
          },
        ],
        [
          "B1",
          {
            beliefs: {
              autoLeave: { mean: 5, variance: 4 },
              teleopSpeakerNote: { mean: 0, variance: 4 },
              [FOULS_COMMITTED_COMPONENT]: { mean: 4, variance: 4 },
            },
            covariance: [
              [4, 0, 0],
              [0, 4, 0],
              [0, 0, 4],
            ],
            consistency: { autoLeave: 2, teleopSpeakerNote: 2, [FOULS_COMMITTED_COMPONENT]: 2 },
            matchCount: 5,
            lastEventKey: "2024test",
            innovationStats: emptyInnovationStats(),
            rpBeliefs: {},
            rpCovariance: [],
            rpCrossCovariance: [],
          },
        ],
      ]),
      league: { componentMean: {}, componentConsistency: {}, rpVariableMean: {} },
      allianceScoreStats: emptyExpandingStats(),
      priorSeasonRatings: { lastSeason: new Map(), yearBefore: new Map() },
      rpSkippedMatchCount: 0,
      breakdownParseFailureCount: 0,
    };

    const fallbackMatch = match({
      matchKey: "2024test_qm1",
      eventKey: "2024test",
      redTeams: ["R1"],
      blueTeams: ["B1"],
      redScore: 100,
      blueScore: 50,
      hasScoreBreakdown: false,
      scoreBreakdownRaw: null,
    });

    const next = sigma1.update(state, fallbackMatch);

    // Invariant 1 (CR-01): none of red's own actual score lands in red's
    // own foulsCommitted belief — the Kalman MEAN is left exactly
    // unchanged (the "carry forward" policy's zero-innovation design),
    // even though process noise (D-07, within-event) still widened its
    // variance and the Kalman gain still shrinks it somewhat (documented,
    // bounded approximation — see foulsCommittedCarryForward's doc
    // comment).
    expect(next.teams.get("R1")!.beliefs[FOULS_COMMITTED_COMPONENT]!.mean).toBeCloseTo(8, 10);
    expect(next.teams.get("B1")!.beliefs[FOULS_COMMITTED_COMPONENT]!.mean).toBeCloseTo(4, 10);

    // Invariant 2 (CR-01): blue's currently-predicted foulsCommitted mean
    // (4) is netted out of result.redScore (100 -> 96) BEFORE the split
    // across red's own non-fouls components, in proportion to their
    // predicted shares (40:10 of a 50 total) — hand-derived via the same
    // Kalman gain formula updateAllianceSum uses (single-teammate
    // alliance, so gain = P / (P + R) with the process-noise-inflated
    // prior variance and FALLBACK_NOISE_MULTIPLIER-inflated measurement
    // noise).
    const priorVariance = 4 + 0.5; // D-07 within-event process noise bump
    const measurementNoise = 2 * FALLBACK_NOISE_MULTIPLIER;
    const gain = priorVariance / (priorVariance + measurementNoise);
    const expectedAutoLeaveInnovation = 96 * (40 / 50) - 40;
    const expectedTeleopInnovation = 96 * (10 / 50) - 10;
    expect(next.teams.get("R1")!.beliefs["autoLeave"]!.mean).toBeCloseTo(40 + gain * expectedAutoLeaveInnovation, 9);
    expect(next.teams.get("R1")!.beliefs["teleopSpeakerNote"]!.mean).toBeCloseTo(10 + gain * expectedTeleopInnovation, 9);

    // Mirror invariant on blue: red's currently-predicted foulsCommitted
    // mean (8) is netted out of result.blueScore (50 -> 42) before blue's
    // own split; blue's only nonzero predicted offensive component
    // (autoLeave) absorbs the entire net residual.
    const expectedBlueAutoLeaveInnovation = 42 - 5;
    expect(next.teams.get("B1")!.beliefs["autoLeave"]!.mean).toBeCloseTo(5 + gain * expectedBlueAutoLeaveInnovation, 9);
  });
});

describe("carrySeason — D-16/D-17", () => {
  it("carries the component mean forward (an even split of the carried total, matching epa.ts's own carrySeason reshaping) and decays the consistency estimate by SIGMA1_CONSISTENCY_CARRY_DECAY", () => {
    let state = sigma1.initState([]);
    state = sigma1.update(
      state,
      match({
        matchKey: "2024test_qm1",
        redTeams: ["T1", "T2", "T3"],
        blueTeams: ["T4", "T5", "T6"],
        redScore: UNIFORM_TOTAL,
        blueScore: UNIFORM_TOTAL,
        hasScoreBreakdown: true,
        scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
      })
    );

    const beforeConsistency = state.teams.get("T1")!.consistency["foulsCommitted"]!;

    expect(sigma1.carrySeason).toBeDefined();
    const carried = sigma1.carrySeason!(state, { fromSeason: 2024, toSeason: 2025, isColdStart: false });

    expect(carried.season).toBe(2025);
    const t1After = carried.teams.get("T1");
    expect(t1After).toBeDefined();
    expect(t1After!.matchCount).toBe(0);

    // Mean carries via an even split of the carried total across the new
    // season's components — every component's carried mean is identical
    // (the same "share" division epa.ts's own carrySeason performs).
    const carriedMeans = new Set(carried.componentOrder.map((name) => t1After!.beliefs[name]!.mean));
    expect(carriedMeans.size).toBe(1);
    expect([...carriedMeans][0]).toBeGreaterThan(0);

    // Decay applied to the carried consistency: "foulsCommitted" is spelled
    // identically across every season's canonical component list
    // (FOULS_COMMITTED_COMPONENT), so this is a same-component comparison
    // across the boundary, not an apples-to-oranges one.
    const afterConsistency = t1After!.consistency["foulsCommitted"]!;
    expect(afterConsistency).toBeCloseTo(beforeConsistency * SIGMA1_CONSISTENCY_CARRY_DECAY, 9);

    // Posterior variance is re-inflated to a finite, non-negative value for
    // every carried component (D-07's reasoning applied one level up —
    // never an implausible near-zero P off a year of layoff).
    for (const name of carried.componentOrder) {
      expect(Number.isFinite(t1After!.beliefs[name]!.variance)).toBe(true);
      expect(t1After!.beliefs[name]!.variance).toBeGreaterThan(0);
    }
  });

  it("is a no-op at the cold-start boundary", () => {
    const state = sigma1.initState([]);
    const carried = sigma1.carrySeason!(state, { fromSeason: 2021, toSeason: 2022, isColdStart: true });
    expect(carried).toBe(state);
  });
});

describe("sigma1 — CR-01: unmapped eventType (offseason 99) is a defined skip, never a throw", () => {
  const offseasonMatch = match({
    matchKey: "2024off_qm1",
    eventKey: "2024off",
    eventType: 99,
    redTeams: ["T1", "T2", "T3"],
    blueTeams: ["T4", "T5", "T6"],
    redScore: UNIFORM_TOTAL,
    blueScore: UNIFORM_TOTAL,
    hasScoreBreakdown: true,
    scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
  });

  it("update() on a match with eventType: 99, compLevel: 'qm', and a real scoreBreakdownRaw does not throw, and rpSkippedMatchCount increments by exactly 1", () => {
    const state = sigma1.initState([]);
    const priorSkipped = state.rpSkippedMatchCount;
    let next!: Sigma1State;
    expect(() => {
      next = sigma1.update(state, offseasonMatch);
    }).not.toThrow();
    expect(next.rpSkippedMatchCount).toBe(priorSkipped + 1);
  });

  it("that same call leaves the score side working — team beliefs still change, proving the guard skipped only the RP fold, not update() wholesale", () => {
    const state = sigma1.initState([]);
    // Cold-start: no team has any belief yet.
    for (const teamId of ["T1", "T2", "T3", "T4", "T5", "T6"]) {
      expect(state.teams.has(teamId)).toBe(false);
    }
    const next = sigma1.update(state, offseasonMatch);
    for (const teamId of ["T1", "T2", "T3", "T4", "T5", "T6"]) {
      const team = next.teams.get(teamId);
      expect(team).toBeDefined();
      expect(team!.matchCount).toBe(1);
      for (const belief of Object.values(team!.beliefs)) {
        expect(Number.isFinite(belief.mean)).toBe(true);
      }
    }
  });

  it("predict() on an upcoming match with eventType: 99 and compLevel: 'qm' does not throw, and the Prediction carries neither redRpPmf nor blueRpPmf", () => {
    const state = sigma1.initState([]);
    const upcoming: UpcomingMatch = {
      matchKey: "2024off_qm2",
      eventKey: "2024off",
      compLevel: "qm",
      setNumber: 1,
      matchNumber: 2,
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["T4", "T5", "T6"],
      redSurrogates: [],
      blueSurrogates: [],
      eventType: 99,
    };
    let prediction!: ReturnType<typeof sigma1.predict>;
    expect(() => {
      prediction = sigma1.predict(state, upcoming);
    }).not.toThrow();
    expect("redRpPmf" in prediction).toBe(false);
    expect("blueRpPmf" in prediction).toBe(false);
  });

  it("positive control (non-negotiable): every EVENT_TYPE_TIERS-mapped eventType still takes the full RP path — update() never increments rpSkippedMatchCount, and predict() always carries redRpPmf/blueRpPmf", () => {
    // Without this test, an isRpEligibleEventType that always returned
    // false would silently disable RP prediction for the entire project
    // and still pass the three tests above.
    for (const eventType of [0, 1, 2, 3, 4, 5, 100]) {
      const state = sigma1.initState([]);
      const priorSkipped = state.rpSkippedMatchCount;
      const mappedMatch = match({
        matchKey: `2024et${eventType}_qm1`,
        eventKey: `2024et${eventType}`,
        eventType,
        redTeams: ["T1", "T2", "T3"],
        blueTeams: ["T4", "T5", "T6"],
        redScore: UNIFORM_TOTAL,
        blueScore: UNIFORM_TOTAL,
        hasScoreBreakdown: true,
        scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
      });
      const next = sigma1.update(state, mappedMatch);
      expect(next.rpSkippedMatchCount).toBe(priorSkipped);

      const upcoming: UpcomingMatch = {
        matchKey: `2024et${eventType}_qm2`,
        eventKey: `2024et${eventType}`,
        compLevel: "qm",
        setNumber: 1,
        matchNumber: 2,
        redTeams: ["T1", "T2", "T3"],
        blueTeams: ["T4", "T5", "T6"],
        redSurrogates: [],
        blueSurrogates: [],
        eventType,
      };
      const prediction = sigma1.predict(next, upcoming);
      expect("redRpPmf" in prediction).toBe(true);
      expect("blueRpPmf" in prediction).toBe(true);
    }
  });
});

describe("sigma1 — T-03-18b: a malformed self-reported breakdown degrades to the D-05 fallback, never a throw", () => {
  it("update() on a match with hasScoreBreakdown: true and the missing-adjustPoints (2024cafb_qm1) payload does not throw, and breakdownParseFailureCount increments by exactly 1", () => {
    const state = sigma1.initState([]);
    const priorFailures = state.breakdownParseFailureCount;
    const malformedMatch = match({
      matchKey: "2024cafb_qm1",
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["T4", "T5", "T6"],
      redScore: UNIFORM_TOTAL,
      blueScore: UNIFORM_TOTAL,
      hasScoreBreakdown: true,
      scoreBreakdownRaw: rawBreakdown2024MissingFields(UNIFORM_PER_COMPONENT, CAFB_QM1_MISSING_FIELDS),
    });
    let next!: Sigma1State;
    expect(() => {
      next = sigma1.update(state, malformedMatch);
    }).not.toThrow();
    expect(next.breakdownParseFailureCount).toBe(priorFailures + 1);
  });

  it("that same call still folds the score side — all six teams gain beliefs with finite means and matchCount 1 — and rpSkippedMatchCount also increments by 1 (the documented D-Q2 overlap)", () => {
    const state = sigma1.initState([]);
    const priorSkipped = state.rpSkippedMatchCount;
    const malformedMatch = match({
      matchKey: "2024cafb_qm1",
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["T4", "T5", "T6"],
      redScore: UNIFORM_TOTAL,
      blueScore: UNIFORM_TOTAL,
      hasScoreBreakdown: true,
      scoreBreakdownRaw: rawBreakdown2024MissingFields(UNIFORM_PER_COMPONENT, CAFB_QM1_MISSING_FIELDS),
    });
    const next = sigma1.update(state, malformedMatch);
    for (const teamId of ["T1", "T2", "T3", "T4", "T5", "T6"]) {
      const team = next.teams.get(teamId);
      expect(team).toBeDefined();
      expect(team!.matchCount).toBe(1);
      for (const belief of Object.values(team!.beliefs)) {
        expect(Number.isFinite(belief.mean)).toBe(true);
      }
    }
    expect(next.rpSkippedMatchCount).toBe(priorSkipped + 1);
  });

  it("the severely truncated 2024wvrox_sf1m1-shaped payload (only autoLeavePoints survives per side) behaves identically: no throw, counter plus 1", () => {
    const state = sigma1.initState([]);
    const priorFailures = state.breakdownParseFailureCount;
    const malformedMatch = match({
      matchKey: "2024wvrox_sf1m1",
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["T4", "T5", "T6"],
      redScore: UNIFORM_TOTAL,
      blueScore: UNIFORM_TOTAL,
      hasScoreBreakdown: true,
      scoreBreakdownRaw: rawBreakdown2024MissingFields(UNIFORM_PER_COMPONENT, WVROX_SF1M1_MISSING_FIELDS),
    });
    let next!: Sigma1State;
    expect(() => {
      next = sigma1.update(state, malformedMatch);
    }).not.toThrow();
    expect(next.breakdownParseFailureCount).toBe(priorFailures + 1);
  });

  it("update() on a match whose event key names an unregistered season still throws — the catch did not swallow the season-registry defect (T-03-21)", () => {
    const state = sigma1.initState([]);
    const unmappedSeasonMatch = match({
      matchKey: "1999test_qm1",
      eventKey: "1999test",
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["T4", "T5", "T6"],
      redScore: UNIFORM_TOTAL,
      blueScore: UNIFORM_TOTAL,
      hasScoreBreakdown: true,
      scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
    });
    expect(() => sigma1.update(state, unmappedSeasonMatch)).toThrow(/no component map registered/);
  });

  it("positive control (non-negotiable): a well-formed payload leaves breakdownParseFailureCount at 0 AND rpSkippedMatchCount at 0 AND every team's parsed component set includes foulsCommitted", () => {
    // Without this test, a helper that reported "malformed" unconditionally
    // would silently disable real component parsing across the whole
    // project and still pass every test above. rpSkippedMatchCount is
    // reachable at 0 only when the parse actually succeeded — any fallback
    // (absent OR malformed) also skips the RP fold.
    const state = sigma1.initState([]);
    const wellFormedMatch = match({
      matchKey: "2024test_qm1",
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["T4", "T5", "T6"],
      redScore: UNIFORM_TOTAL,
      blueScore: UNIFORM_TOTAL,
      hasScoreBreakdown: true,
      scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
    });
    const next = sigma1.update(state, wellFormedMatch);
    expect(next.breakdownParseFailureCount).toBe(0);
    expect(next.rpSkippedMatchCount).toBe(0);
    for (const teamId of ["T1", "T2", "T3", "T4", "T5", "T6"]) {
      const team = next.teams.get(teamId);
      expect(team).toBeDefined();
      expect(team!.beliefs[FOULS_COMMITTED_COMPONENT]).toBeDefined();
    }
  });
});
