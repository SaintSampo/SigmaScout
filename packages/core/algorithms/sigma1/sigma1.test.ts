/**
 * Synthetic-fixture tests for the assembled Sigma1 `AlgorithmModule`
 * (ALGO-03) — matching `opr.test.ts`/`epa.test.ts`'s "known answer or
 * provable structural property" convention.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGMA1_PARAMS,
  SIGMA1_CODE_VERSION,
  SIGMA1_CONSISTENCY_CARRY_DECAY,
  SIGMA1_MIN_CONSISTENCY_VARIANCE,
  allianceTotalPredictiveVariance,
  emptyTeamSwing,
  foldSwingObservation,
  makeSigma1,
  swingSpread,
  teamTotalVariance,
  vpr,
  vprNormalCdf,
  vprSeasonSd,
  type Sigma1State,
} from "./index.js";
import { emptyExpandingStats } from "../../scoring/expandingStats.js";
import { resolveSigma1Params } from "./scale.js";
import { distributeResidual, FALLBACK_NOISE_MULTIPLIER } from "../breakdown/fallback.js";
import { ADJUST_COMPONENT, COMPONENT_GROUP_METRIC_KEYS, FOULS_COMMITTED_COMPONENT, componentGroupsForSeason } from "../breakdown/index.js";
import { TOTAL_METRIC_KEY } from "../types.js";
import type { MatchResult, UpcomingMatch } from "../types.js";
import { emptyInnovationStats } from "./adaptation.js";
import { subsetVariance } from "./covariance.js";
import { opr } from "../opr.js";
import { epa } from "../epa.js";

/**
 * D-T1 (4.0.0): `teamMetrics` resolves the scale-relative params against the
 * state's OWN `allianceScoreStats` before applying any floor. A test that
 * reconstructs what `teamMetrics` computed must resolve at the SAME statistic,
 * or it is asserting against a different scale than the code used. For a state
 * whose `allianceScoreStats` is empty this is the documented cold-start scale
 * (`fallbackScoreSd ** 2` = 625).
 */
const RESOLVED_AT_COLD_START = resolveSigma1Params(DEFAULT_SIGMA1_PARAMS, emptyExpandingStats());

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
/**
 * `overrides.red`/`overrides.blue` (quick task 260904-6a1) let a caller move
 * ONE field — e.g. `adjustPoints` — away from the uniform value on just one
 * side, without hand-writing a second raw JSON payload in the test body.
 * Every other field stays at `perComponentValue`.
 */
function rawBreakdown2024Uniform(
  perComponentValue: number,
  overrides: { red?: Record<string, number>; blue?: Record<string, number> } = {}
): string {
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
  return JSON.stringify({ red: { ...side, ...overrides.red }, blue: { ...side, ...overrides.blue } });
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

describe("vpr.predict — shape", () => {
  it("returns winner, pRedWin, redScore, blueScore, variance, and per-component mean+variance vectors for both alliances", () => {
    let state = vpr.initState([]);
    state = vpr.update(
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
    const prediction = vpr.predict(state, upcoming);

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
    const state = vpr.initState([]);
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
    const prediction = vpr.predict(state, upcoming);
    expect(prediction.redScore).toBe(0);
    expect(prediction.blueScore).toBe(0);
    expect(prediction.pRedWin).toBe(0.5);
  });
});

describe("vpr.predict — D-01 own-variance publish (Phase 6)", () => {
  it("returns redScoreVarianceOwn/blueScoreVarianceOwn as finite numbers equal to each alliance's own posterior + covariance total, computed independently", () => {
    let state = vpr.initState([]);
    state = vpr.update(
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
    const prediction = vpr.predict(state, upcoming);

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
    let state = vpr.initState([]);
    state = vpr.update(
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

    const metrics = vpr.teamMetrics(state, ["frc254"]);
    expect(Object.keys(metrics)).toEqual(["frc254"]);
    const frc254 = metrics["frc254"]!;
    // One entry per component, plus total, plus the three phase groups
    // (phaseAuto/phaseTeleop/phaseEndgame) — see breakdown/groups.ts.
    expect(Object.keys(frc254).length).toBe(SIGMA1_2024_COMPONENT_COUNT + 1 + 3);
    for (const [name, metric] of Object.entries(frc254)) {
      // `adjust` is the ONE key with no spread at all (quick task 260904-6a1,
      // D-5/D-6): it is pinned at 0 and never folded into swing — a
      // scorekeeper's ruling carries no per-team uncertainty to publish.
      if (name === ADJUST_COMPONENT) {
        expect(metric.spread).toBeUndefined();
        continue;
      }
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
    let state = vpr.initState([]);
    state = vpr.update(
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
    const metrics = vpr.teamMetrics(state);
    expect(Object.keys(metrics).sort()).toEqual(["T1", "T2", "T3", "T4", "T5", "T6"].sort());
  });

  it("OMITS a never-seen team from the result entirely — never present-with-zeros", () => {
    // Todo sigma1-cold-start-zero-plus-minus: every downstream layer (publish's
    // `?? {}` defaults, MetricValue's blank cell, rowModel's missing-sorts-last)
    // renders "no data" honestly ONLY because absence propagates from here. If
    // this ever returned `{ total: { value: 0, spread: 0 } }` for an unknown
    // team, the whole chain would faithfully publish a confident `0 ± 0` for
    // the team the model knows least about, and no other test would catch it.
    let state = vpr.initState([]);
    state = vpr.update(
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

    const metrics = vpr.teamMetrics(state, ["frc254", "NEVERSEEN"]);
    expect(Object.keys(metrics)).toEqual(["frc254"]);
    expect("NEVERSEEN" in metrics).toBe(false);
  });
});

/**
 * D-Y1/D-Y2/D-Y3 (quick task 260903-750): `TeamMetric.spread` is redefined at
 * its assembly site AGAIN — from `sqrt` of the per-team variance
 * decomposition's solved variance to `swingScale * sqrt` of the team's own
 * recency-weighted mean squared deviation (`swing.ts`).
 *
 * WHAT SURVIVED THE SWAP AND WHAT DID NOT, because both halves are load-bearing:
 *
 *   - SURVIVED, and is tested below against the NEW source: P is absent from
 *     the display; a phase group publishes from its own key and a group with
 *     no present component publishes nothing; the alliance-additivity identity
 *     is false by design.
 *   - DID NOT SURVIVE, and was DELETED rather than given a contrived swing
 *     analogue: everything that named the retired estimator's INTERNALS —
 *     `perEventVariance` keys, `rowCount`, per-event partitioning, and the
 *     `solveEventVariance` lookup identity. Those asserted properties of a
 *     solve that no longer runs, and porting them would have manufactured
 *     coverage of a model that does not exist.
 *
 * `swing.test.ts` owns the estimator's own algebra and all three of the
 * developer's user stories at the unit level. This block owns the WIRING: that
 * `teamMetrics` reads that estimator and nothing else.
 */
describe("teamMetrics — D-Y1/D-Y3 the published +/- is the recency-weighted swing", () => {
  /**
   * The same field set as `rawBreakdown2024Uniform`, but with INDEPENDENT
   * red/blue per-component values and a SEPARATE `foulPoints` knob. The
   * separate foul knob is load-bearing for the steady/streaky comparison: each
   * side's own `foulPoints` becomes the OPPOSING side's `foulsCommitted`
   * component (breakdown/2024.ts), so tying fouls to the own-field value would
   * leak one alliance's variation into the other's observed total.
   */
  function rawBreakdown2024Split(redVal: number, blueVal: number, foulPoints = 0): string {
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
        foulPoints,
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

  /** Six teams over eight matches with genuinely varying observations, so every accumulator is non-degenerate. */
  function buildSixTeamFixtureState(): Sigma1State {
    let state = vpr.initState([]);
    for (let i = 0; i < SIX_TEAM_RED_VALUES.length; i++) {
      state = vpr.update(
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

  it("THE USER'S EXAMPLE — a robot that lands at 50, 50 publishes a SMALLER +/- than one that lands at 30, 70", () => {
    // The verification bar this whole task exists to clear, made executable:
    // "a robot scoring 50, 50 is more reliable than one scoring 30, 70."
    //
    // Two alliances with MATCHED structure — the same three-team roster on
    // each side across the same matches, so the only difference between them
    // is the shape of their own observations. Red's alliance totals are
    // identical every match (13 x 15 = 195); blue's swing symmetrically around
    // that same mean (13 x 9 = 117 and 13 x 21 = 273), so both sides average
    // the same and only their VARIABILITY differs. That is the user's
    // 50/50-vs-30/70 example, scaled to a real 2024 breakdown.
    //
    // EIGHT matches, not two, and the reason is worth stating: on the first
    // couple of matches BOTH sides' residuals are dominated by cold-start
    // error (every belief starts at the same league-free seed), so a two-match
    // fixture measures how far each alliance sits from the cold-start prior
    // rather than how much it varies. The filter has to converge before the
    // steady/streaky difference is the dominant term. That is a genuine
    // property of the estimator — its correlation with truth is ~0.55 at one
    // event and ~0.86 at a full season — not a fixture convenience.
    let state = vpr.initState([]);
    const redValues = [15, 15, 15, 15, 15, 15, 15, 15];
    const blueValues = [9, 21, 9, 21, 9, 21, 9, 21];
    for (let i = 0; i < redValues.length; i++) {
      state = vpr.update(
        state,
        match({
          matchKey: `2024test_qm${i + 1}`,
          redTeams: ["STEADY1", "STEADY2", "STEADY3"],
          blueTeams: ["STREAKY1", "STREAKY2", "STREAKY3"],
          hasScoreBreakdown: true,
          scoreBreakdownRaw: rawBreakdown2024Split(redValues[i]!, blueValues[i]!, 5),
        })
      );
    }

    const metrics = vpr.teamMetrics(state);
    const steady = metrics["STEADY1"]!["total"]!.spread;
    const streaky = metrics["STREAKY1"]!["total"]!.spread;
    expect(steady, "the steady robot publishes a spread at all").toBeDefined();
    expect(streaky, "the streaky robot publishes a spread at all").toBeDefined();
    expect(steady!).toBeLessThan(streaky!);
    // Non-vacuity: the difference is a real, readable gap rather than a last-
    // digit artifact. THIS is the property the retired estimators failed —
    // they ranked the two correctly and then compressed the gap to nothing.
    expect(streaky! - steady!).toBeGreaterThan(1);
  });

  it("D-Y2 — THE ONLY no-spread case is a key this team has NEVER FOLDED, and `lastEventKey` is no longer any part of the rule", () => {
    // THE RULE CHANGED HERE, and the change is the point of the whole task.
    // Until 6.0.0 a team with `lastEventKey === null` published no spread
    // (there was no event whose system it could be solved in) and, worse, a
    // team WITH an event could still be blanked whenever its solved variance
    // pinned at 0 — 40.2% of published cells on real 2026 data. D-Y2 replaces
    // both with ONE domain check: the key has no observation to summarise.
    //
    // Both teams below are hand-built with `lastEventKey: null`, so the RETIRED
    // rule would blank BOTH. They differ only in whether their swing carries
    // the key, which is the new rule and the only rule.
    const componentOrder = ["autoLeave"];
    function teamState(swing: ReturnType<typeof emptyTeamSwing>, matchCount: number) {
      return {
        beliefs: { autoLeave: { mean: 10, variance: 4 } },
        covariance: [[4]],
        consistency: { autoLeave: 2 },
        matchCount,
        lastEventKey: null,
        innovationStats: emptyInnovationStats(),
        rpBeliefs: {},
        rpCovariance: [],
        rpCrossCovariance: [],
        swing,
      };
    }
    // ONE observation, which under D-Y2 is already a valid (noisy) estimate.
    const oneMatchSwing = foldSwingObservation(
      emptyTeamSwing(),
      { autoLeave: 9, [TOTAL_METRIC_KEY]: 49 },
      DEFAULT_SIGMA1_PARAMS.swingHalfLifeMatches
    );
    const state: Sigma1State = {
      season: 2024,
      componentOrder,
      teams: new Map([
        ["NEVERPLAYED", teamState(emptyTeamSwing(), 0)],
        ["ONEMATCH", teamState(oneMatchSwing, 1)],
      ]),
      league: { componentMean: {}, componentConsistency: {}, rpVariableMean: {} },
      allianceScoreStats: emptyExpandingStats(),
      priorSeasonRatings: { lastSeason: new Map(), yearBefore: new Map() },
      rpSkippedMatchCount: 0,
      breakdownParseFailureCount: 0,
    };

    const metrics = vpr.teamMetrics(state, ["NEVERPLAYED", "ONEMATCH"]);

    // Never folded -> the one undefined case. `value` is still published.
    expect(metrics["NEVERPLAYED"]!["autoLeave"]!.value).toBe(10);
    expect(metrics["NEVERPLAYED"]!["autoLeave"]!.spread).toBeUndefined();
    expect(metrics["NEVERPLAYED"]!["total"]!.value).toBe(10);
    expect(metrics["NEVERPLAYED"]!["total"]!.spread).toBeUndefined();

    // ONE match, `lastEventKey: null`, and it publishes anyway — exactly
    // `scale * |dev|`, with no floor and no minimum-match threshold. Story 2
    // (a low seed WANTING to see a high `±`) is why an omission here would be
    // actively harmful rather than merely conservative.
    expect(metrics["ONEMATCH"]!["autoLeave"]!.spread).toBe(DEFAULT_SIGMA1_PARAMS.swingScale * 3);
    expect(metrics["ONEMATCH"]!["total"]!.spread).toBe(DEFAULT_SIGMA1_PARAMS.swingScale * 7);

    // Non-vacuity, and the sharpest statement of the change: the two teams
    // carry IDENTICAL `lastEventKey`, beliefs, consistency and covariance, so
    // nothing but the swing accumulator can be producing the difference.
    expect(state.teams.get("NEVERPLAYED")!.lastEventKey).toBe(state.teams.get("ONEMATCH")!.lastEventKey);
  });

  it("P IS GONE FROM THE DISPLAY — belief.variance and the shrunk consistency term reach no published spread", () => {
    // Proven by CONSTRUCTION rather than by inspection: two states identical
    // except for every team's `belief.variance` and `consistency` (the P and R
    // terms of the retired construction) publish byte-identical spreads,
    // because neither term is read any more. Under `sqrt(P + R)` this test
    // would fail on every key.
    const state = buildSixTeamFixtureState();
    const perturbed: Sigma1State = {
      ...state,
      teams: new Map(
        [...state.teams].map(([team, teamState]) => [
          team,
          {
            ...teamState,
            beliefs: Object.fromEntries(
              Object.entries(teamState.beliefs).map(([name, belief]) => [name, { ...belief, variance: belief.variance * 37 + 11 }])
            ),
            consistency: Object.fromEntries(Object.entries(teamState.consistency).map(([name, v]) => [name, v * 53 + 7])),
          },
        ])
      ),
    };

    const before = vpr.teamMetrics(state);
    const after = vpr.teamMetrics(perturbed);
    for (const team of Object.keys(before)) {
      for (const [key, metric] of Object.entries(before[team]!)) {
        expect(after[team]![key]!.spread, `${team}/${key}`).toBe(metric.spread);
      }
    }
    // Non-vacuity: the perturbation is real and large.
    const sample = state.teams.get("T1")!.beliefs["autoLeave"]!.variance;
    expect(perturbed.teams.get("T1")!.beliefs["autoLeave"]!.variance).not.toBe(sample);
  });

  it("RETIRED IDENTITY (D-V4's real cost) — the alliance-additivity identity is FALSE BY DESIGN, and what replaced it", () => {
    // Under plan 07-06's D-01, the three teammates' published TOTAL spreads
    // summed IN QUADRATURE to exactly `predict()`'s `redScoreVarianceOwn` —
    // because both were the same construction over the same state
    // (`teamOwnComponentVarianceSum` was shared by the match path and the
    // publish path). That identity is now FALSE: the published spread and
    // `predict()`'s variance are different quantities again. Losing it is a
    // REAL COST of D-V4, and this test records it rather than deleting the
    // rationale along with the assertion.
    const state = buildSixTeamFixtureState();
    const prediction = vpr.predict(state, SIX_TEAM_UPCOMING);
    const redMetrics = vpr.teamMetrics(state, SIX_TEAM_UPCOMING.redTeams);
    const publishedSumOfSquares = SIX_TEAM_UPCOMING.redTeams.reduce(
      (sum, team) => sum + (redMetrics[team]!["total"]!.spread ?? 0) ** 2,
      0
    );
    // Asserted as a genuine INEQUALITY, not merely "not close": pinning the
    // break makes an accidental re-coupling of the two paths fail loudly.
    expect(Math.abs(publishedSumOfSquares - prediction.redScoreVarianceOwn!)).toBeGreaterThan(1e-6);

    // WHAT IS STILL TRUE, and is now the thing worth pinning: `predict()`'s
    // own `redScoreVarianceOwn` is STILL the alliance sum of per-team
    // posterior variance plus that alliance's covariance totals, computed
    // from state alone and completely independent of what `teamMetrics`
    // publishes.
    const expectedOwn =
      SIX_TEAM_UPCOMING.redTeams.reduce((sum, team) => {
        const teamState = state.teams.get(team)!;
        return sum + Object.values(teamState.beliefs).reduce((s, b) => s + b.variance, 0);
      }, 0) +
      allianceTotalPredictiveVariance(SIX_TEAM_UPCOMING.redTeams.map((t) => state.teams.get(t)!.covariance));
    expect(Math.abs(prediction.redScoreVarianceOwn! - expectedOwn)).toBeLessThan(1e-9);

    // And it stays true no matter what the display does: perturbing nothing
    // but re-running `teamMetrics` first cannot move it, because `predict()`
    // is pure over state.
    vpr.teamMetrics(state);
    expect(vpr.predict(state, SIX_TEAM_UPCOMING).redScoreVarianceOwn).toBe(prediction.redScoreVarianceOwn);
  });

  it("a phase group publishes from the swing accumulator's own group key, and a group with no present component publishes nothing", () => {
    // PORTED, not reinvented: the property is unchanged — a group key is a
    // LOOKUP of that same key, never a second assembly rule over the
    // per-component spreads — only its source moved. Asserted against a
    // DIRECTLY-COMPUTED `swingSpread` over the same team's own accumulator, so
    // a divergent second construction inside `teamMetrics` fails here rather
    // than being invisible.
    const state = buildSixTeamFixtureState();
    const metrics = vpr.teamMetrics(state, ["T1"]);
    const swing = state.teams.get("T1")!.swing;
    for (const groupId of ["auto", "teleop", "endgame"] as const) {
      const key = COMPONENT_GROUP_METRIC_KEYS[groupId];
      const metric = metrics["T1"]![key];
      expect(metric, `${key} is published`).toBeDefined();
      const expected = swingSpread(swing, key, DEFAULT_SIGMA1_PARAMS.swingScale);
      expect(expected, `${key} was folded at all`).toBeDefined();
      expect(metric!.spread, key).toBe(expected);
    }
    // The same lookup holds at EVERY aggregation level, which is what leaves
    // nothing to drift between levels: each component and TOTAL too.
    for (const key of [...state.componentOrder, TOTAL_METRIC_KEY]) {
      expect(metrics["T1"]![key]!.spread, key).toBe(swingSpread(swing, key, DEFAULT_SIGMA1_PARAMS.swingScale));
    }
    // D-Y2 non-vacuity: a played team publishes a `±` on EVERY key it shows —
    // the never-blank guarantee, at the wiring level rather than the unit one
    // — EXCEPT `adjust` (quick task 260904-6a1, D-5/D-6): pinned at 0 and
    // never folded into swing, so it is the one key that is always blank,
    // by design, for every team regardless of match count.
    for (const [key, metric] of Object.entries(metrics["T1"]!)) {
      if (key === ADJUST_COMPONENT) {
        expect(metric.spread, `${key} is never published`).toBeUndefined();
        continue;
      }
      expect(metric.spread, `${key} is never blank for a played team`).toBeDefined();
    }

    // A group whose components are ALL absent from `componentOrder` publishes
    // no metric at all — the same `indexOf(name) === -1` skip `update()`'s own
    // `varianceGroups` applies when it builds that key's fold target, which is
    // what keeps the folded and published key sets in agreement by
    // construction.
    const narrow: Sigma1State = { ...state, componentOrder: ["autoLeave"] };
    const narrowMetrics = vpr.teamMetrics(narrow, ["T1"]);
    expect(narrowMetrics["T1"]!["phaseAuto"]).toBeDefined();
    expect(narrowMetrics["T1"]!["phaseEndgame"]).toBeUndefined();
  });
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

    let realState = vpr.initState([]);
    realState = vpr.update(realState, realMatch);
    let fallbackState = vpr.initState([]);
    fallbackState = vpr.update(fallbackState, fallbackMatch);

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
    const state = vpr.initState([]);
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

    expect(() => vpr.predict(state, upcoming)).not.toThrow();
    const prediction = vpr.predict(state, upcoming);
    expect(Number.isNaN(prediction.pRedWin)).toBe(false);
    expect(Number.isNaN(prediction.variance)).toBe(false);

    const result: MatchResult = {
      ...upcoming,
      winner: "blue",
      redScore: UNIFORM_TOTAL,
      blueScore: UNIFORM_TOTAL,
      redRpEarned: null,
      blueRpEarned: null,
      redDqs: [],
      blueDqs: [],
      hasScoreBreakdown: true,
      scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
    };
    expect(() => vpr.update(state, result)).not.toThrow();
    const nextState = vpr.update(state, result);
    // Red is entirely surrogates -> a genuine no-op for red's teams; blue
    // updates normally (mirrors opr.ts's/epa.ts's own empty-observation
    // handling).
    expect(nextState.teams.has("S1")).toBe(false);
    expect(nextState.teams.has("S2")).toBe(false);
    expect(nextState.teams.has("S3")).toBe(false);
    expect(nextState.teams.has("B1")).toBe(true);
  });
});

describe("vpr — whole-alliance DQ zero-score exclusion (.planning/todos/pending/exclude-whole-alliance-dq-zero-scores.md)", () => {
  it("a fully-DQ'd, zero-score alliance is a genuine no-op — no throw, no NaN, and no team state created for the DQ'd alliance, while the opposing alliance updates normally", () => {
    const state = vpr.initState([]);
    const upcoming: UpcomingMatch = {
      matchKey: "2024test_qm1",
      eventKey: "2024test",
      compLevel: "qm",
      setNumber: 1,
      matchNumber: 1,
      redTeams: ["D1", "D2", "D3"],
      blueTeams: ["B1", "B2", "B3"],
      redSurrogates: [],
      blueSurrogates: [],
      eventType: 0,
    };

    expect(() => vpr.predict(state, upcoming)).not.toThrow();
    const prediction = vpr.predict(state, upcoming);
    expect(Number.isNaN(prediction.pRedWin)).toBe(false);
    expect(Number.isNaN(prediction.variance)).toBe(false);

    const result: MatchResult = {
      ...upcoming,
      winner: "blue",
      redScore: 0,
      blueScore: UNIFORM_TOTAL,
      redRpEarned: null,
      blueRpEarned: null,
      redDqs: ["D1", "D2", "D3"],
      blueDqs: [],
      hasScoreBreakdown: true,
      scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
    };
    expect(() => vpr.update(state, result)).not.toThrow();
    const nextState = vpr.update(state, result);
    // Red is fully DQ'd with a zero score -> a genuine no-op for red's
    // teams (mirrors the all-surrogate no-op immediately above); blue's own
    // real observation still updates, exactly as an ordinary match would.
    expect(nextState.teams.has("D1")).toBe(false);
    expect(nextState.teams.has("D2")).toBe(false);
    expect(nextState.teams.has("D3")).toBe(false);
    expect(nextState.teams.has("B1")).toBe(true);
    // The DQ never touched the expanding-window season-score SD either — a
    // ruling's 0 is not a real alliance-score observation.
    expect(nextState.allianceScoreStats.count).toBe(1);
  });

  it("partial DQ (redDqs populated but not covering the whole alliance) still contributes exactly as if redDqs were empty — leave it exactly as today", () => {
    const withPartialDq = vpr.update(
      vpr.initState([]),
      match({
        matchKey: "2024test_qm1",
        redTeams: ["D1", "R1", "R2"],
        blueTeams: ["B1", "B2", "B3"],
        redDqs: ["D1"],
        redScore: 68,
        blueScore: 40,
        hasScoreBreakdown: true,
        scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
      })
    );
    const withoutDq = vpr.update(
      vpr.initState([]),
      match({
        matchKey: "2024test_qm1",
        redTeams: ["D1", "R1", "R2"],
        blueTeams: ["B1", "B2", "B3"],
        redDqs: [],
        redScore: 68,
        blueScore: 40,
        hasScoreBreakdown: true,
        scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
      })
    );

    for (const team of ["D1", "R1", "R2", "B1", "B2", "B3"]) {
      expect(withPartialDq.teams.get(team)).toEqual(withoutDq.teams.get(team));
    }
    expect(withPartialDq.allianceScoreStats).toEqual(withoutDq.allianceScoreStats);
  });

  it("guards the inverse error: a whole-alliance DQ with a NON-zero recorded score is still counted, exactly like an ordinary observation", () => {
    const withNonZeroDq = vpr.update(
      vpr.initState([]),
      match({
        matchKey: "2024test_qm1",
        redTeams: ["D1", "D2", "D3"],
        blueTeams: ["B1", "B2", "B3"],
        redDqs: ["D1", "D2", "D3"],
        redScore: 45,
        blueScore: 30,
        hasScoreBreakdown: true,
        scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
      })
    );
    const noDq = vpr.update(
      vpr.initState([]),
      match({
        matchKey: "2024test_qm1",
        redTeams: ["D1", "D2", "D3"],
        blueTeams: ["B1", "B2", "B3"],
        redDqs: [],
        redScore: 45,
        blueScore: 30,
        hasScoreBreakdown: true,
        scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
      })
    );

    for (const team of ["D1", "D2", "D3", "B1", "B2", "B3"]) {
      expect(withNonZeroDq.teams.get(team)).toEqual(noDq.teams.get(team));
    }
    expect(withNonZeroDq.allianceScoreStats).toEqual(noDq.allianceScoreStats);
  });
});

describe("vpr — adjust-zeroed alliance exclusion (quick task 260904-6a1, .planning/todos/pending/exclude-whole-alliance-dq-zero-scores.md's sibling)", () => {
  it("an alliance zeroed by a negative parsed adjustPoints with EMPTY dq lists is a genuine no-op — no team state created for the zeroed alliance, while the opposing alliance updates normally", () => {
    const state = vpr.initState([]);
    const result: MatchResult = match({
      matchKey: "2024test_qm1",
      redTeams: ["frc190", "frc3467", "frc237"],
      blueTeams: ["B1", "B2", "B3"],
      redDqs: [],
      blueDqs: [],
      redScore: 0,
      blueScore: UNIFORM_TOTAL,
      hasScoreBreakdown: true,
      scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT, { red: { adjustPoints: -456 } }),
    });

    expect(() => vpr.update(state, result)).not.toThrow();
    const nextState = vpr.update(state, result);
    expect(nextState.teams.has("frc190")).toBe(false);
    expect(nextState.teams.has("frc3467")).toBe(false);
    expect(nextState.teams.has("frc237")).toBe(false);
    expect(nextState.teams.has("B1")).toBe(true);
    // The ruling never touched the expanding-window season-score SD either —
    // a ruling's 0 is not a real alliance-score observation.
    expect(nextState.allianceScoreStats.count).toBe(1);
  });

  it("a non-zero recorded score with a large negative adjust is still counted normally, exactly like an ordinary observation", () => {
    const withNegativeAdjust = vpr.update(
      vpr.initState([]),
      match({
        matchKey: "2024test_qm1",
        redTeams: ["R1", "R2", "R3"],
        blueTeams: ["B1", "B2", "B3"],
        redDqs: [],
        blueDqs: [],
        redScore: 68,
        blueScore: 40,
        hasScoreBreakdown: true,
        scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT, { red: { adjustPoints: -30 } }),
      })
    );
    const withoutNegativeAdjust = vpr.update(
      vpr.initState([]),
      match({
        matchKey: "2024test_qm1",
        redTeams: ["R1", "R2", "R3"],
        blueTeams: ["B1", "B2", "B3"],
        redDqs: [],
        blueDqs: [],
        redScore: 68,
        blueScore: 40,
        hasScoreBreakdown: true,
        scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
      })
    );
    for (const team of ["R1", "R2", "R3"]) {
      expect(withNegativeAdjust.teams.has(team)).toBe(true);
    }
    expect(withNegativeAdjust.allianceScoreStats.count).toBe(withoutNegativeAdjust.allianceScoreStats.count);
  });

  it("a breakdown-less match with score 0 and empty dq lists still updates normally — adjust is unknown, not negative", () => {
    const withFallback = vpr.update(
      vpr.initState([]),
      match({
        matchKey: "2024test_qm1",
        redTeams: ["R1", "R2", "R3"],
        blueTeams: ["B1", "B2", "B3"],
        redDqs: [],
        blueDqs: [],
        redScore: 0,
        blueScore: 40,
        hasScoreBreakdown: false,
        scoreBreakdownRaw: null,
      })
    );
    for (const team of ["R1", "R2", "R3", "B1", "B2", "B3"]) {
      expect(withFallback.teams.has(team)).toBe(true);
    }
    expect(withFallback.allianceScoreStats.count).toBe(2);
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

    let stateSameEvent = vpr.update(vpr.initState([]), firstMatch);
    let stateCrossEvent = vpr.update(vpr.initState([]), firstMatch);

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

    stateSameEvent = vpr.update(stateSameEvent, secondMatchSameEvent);
    stateCrossEvent = vpr.update(stateCrossEvent, secondMatchCrossEvent);

    const sameEventVariance = stateSameEvent.teams.get("T1")!.beliefs["autoLeave"]!.variance;
    const crossEventVariance = stateCrossEvent.teams.get("T1")!.beliefs["autoLeave"]!.variance;
    expect(crossEventVariance).toBeGreaterThan(sameEventVariance);
  });
});

describe("makeSigma1 — distinct ids, shared update path, mode-specific predict", () => {
  it("gives vpr / vprSeasonSd / vprNormalCdf distinct ids matching D-12's three modes", () => {
    expect(vpr.id).toBe("vpr");
    expect(vprSeasonSd.id).toBe("vpr-seasonsd");
    expect(vprNormalCdf.id).toBe("vpr-normalcdf");
  });

  // Test 11 (plan 07-16 Task 1): the renamed registry entry's id is
  // strictly `vpr`, and its `version` string is UNCHANGED by the rename —
  // `SIGMA1_CODE_VERSION` plus the default `paramSetName` fallback ("defaults")
  // is an implementation constant PD-02 leaves alone; only the identity
  // (`id`) moved.
  it("vpr's id is exactly \"vpr\" and its version string is unchanged from before the rename", () => {
    expect(vpr.id).toBe("vpr");
    expect(vpr.version).toBe(`${SIGMA1_CODE_VERSION}+defaults`);
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

    const s1 = vpr.update(vpr.initState([]), m);
    const s2 = vprSeasonSd.update(vprSeasonSd.initState([]), m);
    const s3 = vprNormalCdf.update(vprNormalCdf.initState([]), m);

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
    const p1 = vpr.predict(s1, upcoming);
    const p2 = vprSeasonSd.predict(s2, upcoming);
    const p3 = vprNormalCdf.predict(s3, upcoming);

    // Score/variance predictions don't depend on the link mode at all.
    expect(p1.redScore).toBe(p2.redScore);
    expect(p1.blueScore).toBe(p2.blueScore);
    expect(p1.variance).toBe(p2.variance);
    expect(p1.redScore).toBe(p3.redScore);
    expect(p1.variance).toBe(p3.variance);
  });

  it("makeSigma1({ id, linkMode }) round-trips a custom id", () => {
    const custom = makeSigma1({ id: "vpr-custom", linkMode: "season-sd" });
    expect(custom.id).toBe("vpr-custom");
  });

  it("throws when constructed with a params object that violates a cross-parameter invariant (WR-02, 03.1-REVIEW.md: makeSigma1 must parse options.params through Sigma1ParamsSchema, not merely accept it by TypeScript shape)", () => {
    // D-07's invariant: processNoiseEventBoundaryRel must strictly exceed
    // processNoiseWithinEventRel. TypeScript's structural typing enforces the
    // shape of Sigma1Params but not this cross-parameter invariant, so an
    // object like this compiles fine and previously reached makeSigma1
    // unvalidated.
    expect(() =>
      makeSigma1({
        id: "vpr-invalid",
        linkMode: "predictive-variance",
        params: { ...DEFAULT_SIGMA1_PARAMS, processNoiseEventBoundaryRel: 1e-3, processNoiseWithinEventRel: 5e-3 },
      })
    ).toThrow(/processNoiseEventBoundaryRel must strictly exceed processNoiseWithinEventRel/);
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
      let state = vpr.initState([]);
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
        predictions.push(vpr.predict(state, upcoming));
        state = vpr.update(state, m);
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
    const state = vpr.initState([]);
    const brokenMatch = match({
      matchKey: "2024test_qm1",
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["T4", "T5", "T6"],
      redScore: Number.NaN,
      blueScore: UNIFORM_TOTAL,
      hasScoreBreakdown: false,
      scoreBreakdownRaw: null,
    });
    expect(() => vpr.update(state, brokenMatch)).toThrow(/non-finite/);
  });
});

describe("vpr.update — D-05 fallback attribution (CR-01, code review phase 02)", () => {
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
            swing: emptyTeamSwing(),
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
            swing: emptyTeamSwing(),
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

    const next = vpr.update(state, fallbackMatch);

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
    // D-07 within-event process noise bump. D-T1 (4.0.0): the magnitude is no
    // longer the absolute 0.5 — it is `processNoiseWithinEventRel * sigma^2`,
    // and this state's `allianceScoreStats` is empty, so `update()` resolved
    // at the documented cold-start scale (`fallbackScoreSd ** 2` = 625).
    // Recomputed from that resolved value so the assertion stays EXACT rather
    // than being loosened to a tolerance wide enough to hide the difference.
    const priorVariance = 4 + RESOLVED_AT_COLD_START.processNoiseWithinEvent;
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
    let state = vpr.initState([]);
    state = vpr.update(
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

    expect(vpr.carrySeason).toBeDefined();
    const carried = vpr.carrySeason!(state, { fromSeason: 2024, toSeason: 2025, isColdStart: false });

    expect(carried.season).toBe(2025);
    const t1After = carried.teams.get("T1");
    expect(t1After).toBeDefined();
    expect(t1After!.matchCount).toBe(0);

    // Mean carries via an even split of the carried total across the new
    // season's MODELED components — every non-adjust component's carried
    // mean is identical (the same "share" division epa.ts's own carrySeason
    // performs). `adjust` is pinned at exactly 0 instead (quick task
    // 260904-6a1, D-5/D-6), excluded from the divisor and from this
    // "identical share" check — it never gets a share at all.
    expect(t1After!.beliefs[ADJUST_COMPONENT]!.mean).toBe(0);
    const nonAdjustComponents = carried.componentOrder.filter((name) => name !== ADJUST_COMPONENT);
    const carriedMeans = new Set(nonAdjustComponents.map((name) => t1After!.beliefs[name]!.mean));
    expect(carriedMeans.size).toBe(1);
    expect([...carriedMeans][0]).toBeGreaterThan(0);

    // Decay applied to the carried consistency: "foulsCommitted" is spelled
    // identically across every season's canonical component list
    // (FOULS_COMMITTED_COMPONENT), so this is a same-component comparison
    // across the boundary, not an apples-to-oranges one.
    const afterConsistency = t1After!.consistency["foulsCommitted"]!;
    expect(afterConsistency).toBeCloseTo(beforeConsistency * SIGMA1_CONSISTENCY_CARRY_DECAY, 9);

    // Posterior variance is re-inflated to a finite, non-negative value for
    // every carried MODELED component (D-07's reasoning applied one level
    // up — never an implausible near-zero P off a year of layoff). `adjust`
    // is the one exception (quick task 260904-6a1, D-5/D-6): its carried
    // belief is pinned at exactly `{ mean: 0, variance: 0 }`, never
    // re-inflated, since it is never folded and has no gain to protect.
    expect(t1After!.beliefs[ADJUST_COMPONENT]!.variance).toBe(0);
    for (const name of carried.componentOrder) {
      if (name === ADJUST_COMPONENT) continue;
      expect(Number.isFinite(t1After!.beliefs[name]!.variance)).toBe(true);
      expect(t1After!.beliefs[name]!.variance).toBeGreaterThan(0);
    }
  });

  it("is a no-op at the cold-start boundary", () => {
    const state = vpr.initState([]);
    const carried = vpr.carrySeason!(state, { fromSeason: 2021, toSeason: 2022, isColdStart: true });
    expect(carried).toBe(state);
  });
});

describe("vpr — CR-01: unmapped eventType (offseason 99) is a defined skip, never a throw", () => {
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
    const state = vpr.initState([]);
    const priorSkipped = state.rpSkippedMatchCount;
    let next!: Sigma1State;
    expect(() => {
      next = vpr.update(state, offseasonMatch);
    }).not.toThrow();
    expect(next.rpSkippedMatchCount).toBe(priorSkipped + 1);
  });

  it("that same call leaves the score side working — team beliefs still change, proving the guard skipped only the RP fold, not update() wholesale", () => {
    const state = vpr.initState([]);
    // Cold-start: no team has any belief yet.
    for (const teamId of ["T1", "T2", "T3", "T4", "T5", "T6"]) {
      expect(state.teams.has(teamId)).toBe(false);
    }
    const next = vpr.update(state, offseasonMatch);
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
    const state = vpr.initState([]);
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
    let prediction!: ReturnType<typeof vpr.predict>;
    expect(() => {
      prediction = vpr.predict(state, upcoming);
    }).not.toThrow();
    expect("redRpPmf" in prediction).toBe(false);
    expect("blueRpPmf" in prediction).toBe(false);
  });

  it("positive control (non-negotiable): every EVENT_TYPE_TIERS-mapped eventType still takes the full RP path — update() never increments rpSkippedMatchCount, and predict() always carries redRpPmf/blueRpPmf", () => {
    // Without this test, an isRpEligibleEventType that always returned
    // false would silently disable RP prediction for the entire project
    // and still pass the three tests above.
    for (const eventType of [0, 1, 2, 3, 4, 5, 100]) {
      const state = vpr.initState([]);
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
      const next = vpr.update(state, mappedMatch);
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
      const prediction = vpr.predict(next, upcoming);
      expect("redRpPmf" in prediction).toBe(true);
      expect("blueRpPmf" in prediction).toBe(true);
    }
  });
});

describe("vpr — T-03-18b: a malformed self-reported breakdown degrades to the D-05 fallback, never a throw", () => {
  it("update() on a match with hasScoreBreakdown: true and the missing-adjustPoints (2024cafb_qm1) payload does not throw, and breakdownParseFailureCount increments by exactly 1", () => {
    const state = vpr.initState([]);
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
      next = vpr.update(state, malformedMatch);
    }).not.toThrow();
    expect(next.breakdownParseFailureCount).toBe(priorFailures + 1);
  });

  it("that same call still folds the score side — all six teams gain beliefs with finite means and matchCount 1 — and rpSkippedMatchCount also increments by 1 (the documented D-Q2 overlap)", () => {
    const state = vpr.initState([]);
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
    const next = vpr.update(state, malformedMatch);
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
    const state = vpr.initState([]);
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
      next = vpr.update(state, malformedMatch);
    }).not.toThrow();
    expect(next.breakdownParseFailureCount).toBe(priorFailures + 1);
  });

  it("update() on a match whose event key names an unregistered season still throws — the catch did not swallow the season-registry defect (T-03-21)", () => {
    const state = vpr.initState([]);
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
    expect(() => vpr.update(state, unmappedSeasonMatch)).toThrow(/no component map registered/);
  });

  it("positive control (non-negotiable): a well-formed payload leaves breakdownParseFailureCount at 0 AND rpSkippedMatchCount at 0 AND every team's parsed component set includes foulsCommitted", () => {
    // Without this test, a helper that reported "malformed" unconditionally
    // would silently disable real component parsing across the whole
    // project and still pass every test above. rpSkippedMatchCount is
    // reachable at 0 only when the parse actually succeeded — any fallback
    // (absent OR malformed) also skips the RP fold.
    const state = vpr.initState([]);
    const wellFormedMatch = match({
      matchKey: "2024test_qm1",
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["T4", "T5", "T6"],
      redScore: UNIFORM_TOTAL,
      blueScore: UNIFORM_TOTAL,
      hasScoreBreakdown: true,
      scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
    });
    const next = vpr.update(state, wellFormedMatch);
    expect(next.breakdownParseFailureCount).toBe(0);
    expect(next.rpSkippedMatchCount).toBe(0);
    for (const teamId of ["T1", "T2", "T3", "T4", "T5", "T6"]) {
      const team = next.teams.get(teamId);
      expect(team).toBeDefined();
      expect(team!.beliefs[FOULS_COMMITTED_COMPONENT]).toBeDefined();
    }
  });
});

describe("vpr — off-season demo team exclusion (frc9970-frc9999, demoTeams.ts)", () => {
  it("case 1: a fully-demo alliance never updates state for either alliance", () => {
    const initial = vpr.initState([]);
    const forfeitMatch = match({
      matchKey: "2024test_sf1m1",
      compLevel: "sf",
      redTeams: ["frc1", "frc2", "frc3"],
      blueTeams: ["frc9970", "frc9971", "frc9972"],
      redScore: 200,
      blueScore: 0,
    });
    const afterForfeit = vpr.update(initial, forfeitMatch);
    // A genuine no-op — the forfeit row never touches state at all.
    expect(afterForfeit).toEqual(initial);
  });

  it("case 2: a real teammate of a mixed alliance is computed IDENTICALLY whether the third slot is a demo team or an ordinary real team — not inflated by absorbing the demo slot's share", () => {
    const withDemo = vpr.update(
      vpr.initState([]),
      match({
        matchKey: "2024test_qm1",
        redTeams: ["frc1", "frc2", "frc9985"],
        blueTeams: ["frc4", "frc5", "frc6"],
        redScore: 120,
        blueScore: 80,
      })
    );
    const withRealThird = vpr.update(
      vpr.initState([]),
      match({
        matchKey: "2024test_qm1",
        redTeams: ["frc1", "frc2", "frc3"],
        blueTeams: ["frc4", "frc5", "frc6"],
        redScore: 120,
        blueScore: 80,
      })
    );

    for (const team of ["frc1", "frc2"]) {
      expect(withDemo.teams.get(team)).toEqual(withRealThird.teams.get(team));
    }
    // The demo pseudo entity absorbed the third teammate's share under its
    // own shared identity, never under "frc9985" — matching the real
    // third-teammate's own resulting state exactly (both cold-started
    // identically, both folded the same alliance observation).
    expect(withDemo.teams.has("frc9985")).toBe(false);
    expect(withDemo.teams.get("demo-pseudo-unregistered")).toEqual(withRealThird.teams.get("frc3"));
  });

  it("predict(): a real alliance's predicted score/variance is unaffected by whether its teammate is a demo team or an ordinary team", () => {
    const stateWithDemo = vpr.update(
      vpr.initState([]),
      match({ matchKey: "2024test_qm1", redTeams: ["frc1", "frc2", "frc9985"], blueTeams: ["frc4", "frc5", "frc6"], redScore: 120, blueScore: 80 })
    );
    const stateWithReal = vpr.update(
      vpr.initState([]),
      match({ matchKey: "2024test_qm1", redTeams: ["frc1", "frc2", "frc3"], blueTeams: ["frc4", "frc5", "frc6"], redScore: 120, blueScore: 80 })
    );
    const upcomingWithDemo: UpcomingMatch = {
      matchKey: "2024test_qm2",
      eventKey: "2024test",
      compLevel: "qm",
      setNumber: 1,
      matchNumber: 2,
      redTeams: ["frc1", "frc2", "frc9985"],
      blueTeams: ["frc4", "frc5", "frc6"],
      redSurrogates: [],
      blueSurrogates: [],
      eventType: 0,
    };
    const upcomingWithReal: UpcomingMatch = { ...upcomingWithDemo, redTeams: ["frc1", "frc2", "frc3"] };
    const predictedWithDemo = vpr.predict(stateWithDemo, upcomingWithDemo);
    const predictedWithReal = vpr.predict(stateWithReal, upcomingWithReal);
    expect(predictedWithDemo.redScore).toBeCloseTo(predictedWithReal.redScore, 9);
    expect(predictedWithDemo.redScoreVarianceOwn).toBeCloseTo(predictedWithReal.redScoreVarianceOwn!, 9);
  });
});

/**
 * D-Y1/D-Y3 (quick task 260903-750): the swing fold, at the STATE level.
 * `swing.test.ts` owns the estimator's algebra; this block owns what
 * `update()` and `carrySeason` do to the accumulator that lives on each team.
 *
 * THIS BLOCK REPLACES "per-event variance accumulator (D-V1/D-V3)", and most
 * of that block was DELETED rather than ported, deliberately. Its subjects
 * were the retired estimator's own internals — `perEventVariance` map keys,
 * `rowCount`, and per-event PARTITIONING (a team at two events feeding two
 * independent accumulators). None of those is a property of a per-team running
 * mean: there is no map, no row count, and swing is deliberately NOT
 * partitioned by event, because a robot's match-to-match consistency is a
 * property of the robot and does not restart when it travels. Inventing swing
 * analogues for them would have manufactured coverage of a model that no
 * longer exists.
 *
 * The two no-fold cases those tests also touched (an all-surrogate alliance
 * and a whole-alliance-DQ-zero alliance) keep their coverage where it already
 * lived and is stronger — "all-surrogate alliance — no throw, no NaN, genuine
 * no-op" and the whole-alliance-DQ block above both assert that NO TEAM STATE
 * IS TOUCHED at all, which subsumes "no swing was folded".
 */
describe("swing folding into state (D-Y1/D-Y3)", () => {
  it("carrySeason DROPS every team's swing — points^2 under one season's rules are not points^2 under another's", () => {
    // PORTED from "carrySeason EMPTIES the map": the map is gone but the
    // DECISION survived intact into `carrySeason`'s `swing: emptyTeamSwing()`,
    // for the identical reason. A 2024 deviation measured in 2024 points says
    // nothing about a robot's consistency under 2025's scoring rules, so
    // carrying it would publish a number about a game that is not being played.
    let state = vpr.initState([]);
    state = vpr.update(
      state,
      match({
        matchKey: "2024test_qm1",
        redTeams: ["R1", "R2", "R3"],
        blueTeams: ["B1", "B2", "B3"],
        hasScoreBreakdown: true,
        scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
      })
    );
    // Non-vacuity: there IS something to drop, and it was being published.
    expect(Object.keys(state.teams.get("R1")!.swing).length).toBeGreaterThan(0);
    expect(vpr.teamMetrics(state, ["R1"])["R1"]![TOTAL_METRIC_KEY]!.spread).toBeDefined();

    const carried = vpr.carrySeason!(state, { fromSeason: 2024, toSeason: 2025, isColdStart: false });
    for (const [team, teamState] of carried.teams) {
      expect(Object.keys(teamState.swing).length, `${team} carries no swing`).toBe(0);
    }
    // And the display follows: D-Y2's ONE undefined case is exactly "never
    // folded", which a carried team now is. The `value` still publishes —
    // `carrySeason` carries the MEAN forward, only the spread resets.
    for (const [key, metric] of Object.entries(vpr.teamMetrics(carried, ["R1"])["R1"]!)) {
      expect(metric.spread, `${key} publishes no spread after the carry`).toBeUndefined();
      expect(Number.isFinite(metric.value), `${key} still publishes a value`).toBe(true);
    }
  });

  it("the TOTAL key's folded deviation is the SQUARE OF THE SUM of the per-component innovations, not the sum of their squares", () => {
    // PORTED from the retired accumulator's `targets` assertion — the rule it
    // pinned did not move, only where its answer is stored.
    // `applyAllianceUpdate` still sums a key's component innovations BEFORE
    // squaring, because `e_m` for the TOTAL key is the alliance's total-score
    // residual and squaring per component first would discard every
    // cross-component term it carries.
    //
    // On the FIRST match of a cold-start state every component's belief mean is
    // the same cold-start value and the observation is uniform across
    // components, so every component's innovation is the SAME number `i`. The
    // published spread after ONE fold is exactly `scale * |dev|` (D-Y2), so the
    // ratio of TOTAL's spread to a component's is `C` — against the `sqrt(C)` a
    // sum-of-squares fold would produce. Asserted on the SPREAD rather than on
    // the squared target because the spread is the number that ships.
    let state = vpr.initState([]);
    state = vpr.update(
      state,
      match({
        matchKey: "2024test_qm1",
        redTeams: ["R1", "R2", "R3"],
        blueTeams: ["B1", "B2", "B3"],
        hasScoreBreakdown: true,
        scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
      })
    );
    const componentCount = state.componentOrder.length;
    expect(componentCount).toBe(SIGMA1_2024_COMPONENT_COUNT);
    // `adjust` (quick task 260904-6a1, D-5/D-6) is pinned at 0 and never
    // folds an innovation, so it contributes nothing to TOTAL's summed
    // innovation — the ratio below is over the MODELED (non-adjust)
    // component count, one less than the structural `componentCount` above.
    const modeledComponentCount = state.componentOrder.filter((name) => name !== ADJUST_COMPONENT).length;
    expect(modeledComponentCount).toBe(componentCount - 1);

    const metrics = vpr.teamMetrics(state, ["R1"])["R1"]!;
    const perComponent = metrics[state.componentOrder[0]!]!.spread!;
    const total = metrics[TOTAL_METRIC_KEY]!.spread!;
    expect(perComponent).toBeGreaterThan(0);
    expect(total / perComponent).toBeCloseTo(modeledComponentCount, 6);
    // Non-vacuity: the sum-of-squares alternative would give sqrt(C) ~ 3.5,
    // which this fixture keeps a wide margin away from the asserted 12.
    expect(total / perComponent).not.toBeCloseTo(Math.sqrt(modeledComponentCount), 6);
  });

  it("every teammate receives the SAME deviation for a match — per-team differentiation comes from ACROSS matches, never from within one", () => {
    // NOT a defect and not a fixture artifact: there is no way to recover a
    // team-differentiated residual from a SUMMED observation (FRC records no
    // individual robot's score — this project's Assumption A1), which is the
    // same limitation `componentGains` and `residualsByTeam` already document.
    // Per-team differentiation comes from WHICH alliances a team played on
    // across many matches. Pinning it here is what stops a future "improvement"
    // from inventing a within-match split that the data cannot support, and it
    // is also why the module header states an honest ceiling of r ~= 0.59.
    let state = vpr.initState([]);
    state = vpr.update(
      state,
      match({
        matchKey: "2024test_qm1",
        redTeams: ["R1", "R2", "R3"],
        blueTeams: ["B1", "B2", "B3"],
        hasScoreBreakdown: true,
        scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
      })
    );
    const r1 = vpr.teamMetrics(state, ["R1"])["R1"]![TOTAL_METRIC_KEY]!.spread!;
    for (const team of ["R2", "R3"]) {
      expect(vpr.teamMetrics(state, [team])[team]![TOTAL_METRIC_KEY]!.spread, team).toBe(r1);
    }

    // The OPPOSING alliance, folded from the SAME match, gets a different
    // number — so "identical" is a statement about teammates specifically, not
    // a fixture in which every team happens to coincide.
    expect(vpr.teamMetrics(state, ["B1"])["B1"]![TOTAL_METRIC_KEY]!.spread).not.toBe(r1);

    // And the k = 1 case D-Y2 rests on, at the wiring level: one fold leaves
    // weight at exactly 1, so the published spread is exactly `scale * |dev|`
    // with no averaging, no seeding and no floor in between.
    //
    // The `/ n` in `dev = (observed - predicted) / n` is NOT re-derived here.
    // It is the exact quantity `SIGMA1_SWING_SCALE` was regressed against over
    // 86,844 alliance-observations, and reconstructing the alliance residual
    // independently would mean reimplementing the breakdown parse and the
    // cold-start prior in the test — which would pin the fixture rather than
    // the division. `swing.test.ts` owns the estimator's algebra given a
    // deviation; this owns that a deviation reaches it at all.
    const accumulator = state.teams.get("R1")!.swing[TOTAL_METRIC_KEY]!;
    expect(accumulator.weight).toBe(1);
    expect(r1).toBe(DEFAULT_SIGMA1_PARAMS.swingScale * Math.sqrt(accumulator.weightedSquares));
  });
});

describe("vpr — adjust pinned at 0 per team (D-5/D-6, quick task 260904-6a1)", () => {
  it("every team's adjust belief mean and variance are exactly 0 after any number of updates, and after carrySeason", () => {
    let state = vpr.initState([]);
    for (let i = 0; i < 5; i++) {
      state = vpr.update(
        state,
        match({
          matchKey: `2024test_qm${i + 1}`,
          redTeams: ["R1", "R2", "R3"],
          blueTeams: ["B1", "B2", "B3"],
          // Nonzero recorded scores on BOTH sides so neither alliance is a
          // ruling-zero (Task 1's isAdjustZeroedAlliance requires score 0) —
          // this test is about the pinning, not the ruling-zero exclusion.
          redScore: UNIFORM_TOTAL - 30,
          blueScore: UNIFORM_TOTAL + 40,
          hasScoreBreakdown: true,
          scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT, {
            red: { adjustPoints: -30 },
            blue: { adjustPoints: 40 },
          }),
        })
      );
    }
    for (const team of ["R1", "R2", "R3", "B1", "B2", "B3"]) {
      const belief = state.teams.get(team)!.beliefs[ADJUST_COMPONENT]!;
      expect(belief.mean).toBe(0);
      expect(belief.variance).toBe(0);
    }

    const carried = vpr.carrySeason!(state, { fromSeason: 2024, toSeason: 2025, isColdStart: false });
    for (const team of ["R1", "R2", "R3", "B1", "B2", "B3"]) {
      const belief = carried.teams.get(team)!.beliefs[ADJUST_COMPONENT]!;
      expect(belief.mean).toBe(0);
      expect(belief.variance).toBe(0);
    }
  });

  it("adjust's belief variance does not grow across an event boundary — process noise is skipped for it (a real component's variance moves, proving the exclusion is a genuine divergence)", () => {
    let state = vpr.initState([]);
    state = vpr.update(
      state,
      match({
        matchKey: "2024eventa_qm1",
        eventKey: "2024eventa",
        redTeams: ["R1", "R2", "R3"],
        blueTeams: ["B1", "B2", "B3"],
        hasScoreBreakdown: true,
        scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
      })
    );
    // A DIFFERENT event for the same teams — applyTeamProcessNoise takes the
    // larger event-boundary branch for every OTHER component.
    state = vpr.update(
      state,
      match({
        matchKey: "2024eventb_qm1",
        eventKey: "2024eventb",
        redTeams: ["R1", "R2", "R3"],
        blueTeams: ["B1", "B2", "B3"],
        hasScoreBreakdown: true,
        scoreBreakdownRaw: rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT),
      })
    );
    for (const team of ["R1", "R2", "R3", "B1", "B2", "B3"]) {
      expect(state.teams.get(team)!.beliefs[ADJUST_COMPONENT]!.variance).toBe(0);
    }
    const ordinaryComponent = state.componentOrder.find(
      (name) => name !== ADJUST_COMPONENT && name !== FOULS_COMMITTED_COMPONENT
    )!;
    expect(state.teams.get("R1")!.beliefs[ordinaryComponent]!.variance).toBeGreaterThan(0);
  });

  it("a cold-start team's summed belief means equal params.coldStartTeamTotal — unchanged by excluding adjust from the divisor (D-6)", () => {
    // Single team per alliance (n=1): with every raw breakdown field set to
    // EXACTLY the modeled cold-start value, the alliance-level observation
    // matches the predicted sum exactly (n=1, fresh cold start), so the
    // Kalman update is a genuine no-op — the mean stays at the cold-start
    // seed. The resulting per-team sum is therefore exactly
    // `coldStartTeamTotal` BY CONSTRUCTION only if the divisor (D-6)
    // excludes `adjust` — otherwise the sum would fall short by one share.
    const resolved = resolveSigma1Params(DEFAULT_SIGMA1_PARAMS, emptyExpandingStats());
    const modeledComponentCount = SIGMA1_2024_COMPONENT_COUNT - 1; // exclude adjust
    const coldStartMean = resolved.coldStartTeamTotal / modeledComponentCount;

    const state = vpr.update(
      vpr.initState([]),
      match({
        matchKey: "2024test_qm1",
        redTeams: ["R1"],
        blueTeams: ["B1"],
        hasScoreBreakdown: true,
        scoreBreakdownRaw: rawBreakdown2024Uniform(coldStartMean),
      })
    );
    for (const team of ["R1", "B1"]) {
      const beliefs = state.teams.get(team)!.beliefs;
      const total = Object.values(beliefs).reduce((sum, b) => sum + b.mean, 0);
      expect(total).toBeCloseTo(resolved.coldStartTeamTotal, 6);
    }
  });

  it("distributeResidual, fed Sigma1's modeled (non-fouls, non-adjust) component list, still sums to the observed total — ADJUST_COMPONENT never receives a share", () => {
    const modeledComponents = ["autoLeave", "autoAmpNote", "teleopSpeakerNote"]; // any subset excluding fouls/adjust
    const result = distributeResidual(90, {}, modeledComponents);
    const sum = Object.values(result).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(90, 9);
    expect(result[ADJUST_COMPONENT]).toBeUndefined();
  });

  it("a D-05 fallback match (null scoreBreakdownRaw) still updates every rating-eligible team, and adjust stays pinned at 0 throughout", () => {
    const state = vpr.update(
      vpr.initState([]),
      match({
        matchKey: "2024test_qm1",
        redTeams: ["R1", "R2", "R3"],
        blueTeams: ["B1", "B2", "B3"],
        redScore: 140,
        blueScore: 90,
        hasScoreBreakdown: false,
        scoreBreakdownRaw: null,
      })
    );
    for (const team of ["R1", "R2", "R3", "B1", "B2", "B3"]) {
      expect(state.teams.has(team)).toBe(true);
      expect(state.teams.get(team)!.beliefs[ADJUST_COMPONENT]!.mean).toBe(0);
      expect(state.teams.get(team)!.beliefs[ADJUST_COMPONENT]!.variance).toBe(0);
    }
  });
});
