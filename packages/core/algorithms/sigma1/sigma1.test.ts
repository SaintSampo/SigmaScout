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
  makeSigma1,
  solveEventVariance,
  teamTotalVariance,
  vpr,
  vprNormalCdf,
  vprSeasonSd,
  type Sigma1State,
} from "./index.js";
import { emptyExpandingStats } from "../../scoring/expandingStats.js";
import { resolveSigma1Params } from "./scale.js";
import { FALLBACK_NOISE_MULTIPLIER } from "../breakdown/fallback.js";
import { COMPONENT_GROUP_METRIC_KEYS, FOULS_COMMITTED_COMPONENT, componentGroupsForSeason } from "../breakdown/index.js";
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
});

/**
 * D-V1/D-V4 (quick task 260902-varopr): `TeamMetric.spread` is redefined at
 * its assembly site, from `sqrt(P + R)` to `sqrt` of the per-team variance
 * decomposition's solved variance for that same key (`varianceOpr.ts`).
 *
 * This block replaces plan 07-06's own D-01/D-02 block wholesale. What that
 * block proved — the alliance-additivity identity, the "spread exceeds sqrt(R)
 * alone" direction, the min-consistency floor erring wide — were all
 * properties OF the `sqrt(P + R)` construction, and every one of them is false
 * by design now. Retiring them silently would leave the suite green about a
 * model that no longer exists; the retirement and its cost are recorded here
 * and in `teamMetrics`'s own doc comment.
 */
describe("teamMetrics — D-V1/D-V4 the published +/- is the variance decomposition", () => {
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

  it("A LOOKUP, NOT A RECONCILIATION — every published key's spread is sqrt of the decomposition's solved variance for that SAME key", () => {
    // Asserted against a DIRECTLY-COMPUTED `solveEventVariance` result over
    // the same state, so a divergent second construction inside `teamMetrics`
    // — a group assembled differently from a component, say — fails here
    // rather than being invisible.
    const state = buildSixTeamFixtureState();
    const metrics = vpr.teamMetrics(state, ["T1", "T2", "T3", "T4", "T5", "T6"]);
    const solved = solveEventVariance(
      state.perEventVariance.get("2024test")!,
      DEFAULT_SIGMA1_PARAMS.varianceOprRidge
    );

    let checkedKeys = 0;
    for (const team of ["T1", "T2", "T3", "T4", "T5", "T6"]) {
      const perTeam = metrics[team]!;
      const solvedForTeam = solved.get(team)!;
      // Every key the site shows: each component, TOTAL, and each phase group.
      expect(Object.keys(perTeam).length).toBe(SIGMA1_2024_COMPONENT_COUNT + 1 + 3);
      for (const [key, metric] of Object.entries(perTeam)) {
        const variance = solvedForTeam[key];
        expect(variance, `${team}/${key} has a solved variance`).toBeDefined();
        if (variance! <= 0) {
          // The clamped case: the additive model failed for this team on this
          // key, and publishing `0 +/-` would claim perfect consistency.
          expect(metric.spread, `${team}/${key} clamped -> no spread`).toBeUndefined();
          continue;
        }
        expect(metric.spread, `${team}/${key}`).toBe(Math.sqrt(variance!));
        checkedKeys++;
      }
    }
    // Non-vacuity: an all-clamped fixture would satisfy the loop above without
    // ever comparing a published number.
    expect(checkedKeys).toBeGreaterThan(0);
  });

  it("a team with lastEventKey === null publishes every value and NO spread", () => {
    // There is no event whose system it could be solved in — so the honest
    // answer is the absence of a `spread` key, not a fabricated one. This is a
    // DOMAIN check (the statistic does not exist), never a minimum-match
    // threshold: a team with ONE row does get a published spread.
    const componentOrder = ["autoLeave"];
    const state: Sigma1State = {
      season: 2024,
      componentOrder,
      teams: new Map([
        [
          "NEVERPLAYED",
          {
            beliefs: { autoLeave: { mean: 10, variance: 4 } },
            covariance: [[4]],
            consistency: { autoLeave: 2 },
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
      perEventVariance: new Map(),
      breakdownParseFailureCount: 0,
    };

    const metrics = vpr.teamMetrics(state, ["NEVERPLAYED"]);
    expect(metrics["NEVERPLAYED"]!["autoLeave"]!.value).toBe(10);
    expect(metrics["NEVERPLAYED"]!["autoLeave"]!.spread).toBeUndefined();
    expect(metrics["NEVERPLAYED"]!["total"]!.value).toBe(10);
    expect(metrics["NEVERPLAYED"]!["total"]!.spread).toBeUndefined();
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

  it("a phase group publishes from the decomposition's own group key, and a group with no present component publishes nothing", () => {
    const state = buildSixTeamFixtureState();
    const metrics = vpr.teamMetrics(state, ["T1"]);
    const solved = solveEventVariance(
      state.perEventVariance.get("2024test")!,
      DEFAULT_SIGMA1_PARAMS.varianceOprRidge
    ).get("T1")!;
    for (const groupId of ["auto", "teleop", "endgame"] as const) {
      const key = COMPONENT_GROUP_METRIC_KEYS[groupId];
      const metric = metrics["T1"]![key];
      expect(metric, `${key} is published`).toBeDefined();
      const variance = solved[key]!;
      if (variance > 0) expect(metric!.spread).toBe(Math.sqrt(variance));
      else expect(metric!.spread).toBeUndefined();
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
      perEventVariance: new Map(),
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
 * D-V1/D-V3 (quick task 260902-varopr): the per-team variance decomposition's
 * EVENT-SCOPED accumulator. This block covers the STATE side — what gets
 * folded, from which rows, partitioned how, and reset when.
 * `varianceOpr.test.ts` covers the accumulator's own algebra and the solve.
 */
describe("per-event variance accumulator (D-V1/D-V3)", () => {
  /**
   * A 2024 breakdown with INDEPENDENT red/blue own-field values and a
   * separately controlled `foulPoints`. The separate foul knob matters: each
   * side's own `foulPoints` becomes the OPPOSING side's `foulsCommitted`
   * component (breakdown/2024.ts), so tying fouls to the own-field value would
   * leak one alliance's variation into the other's observed total.
   */
  function breakdown(redVal: number, blueVal: number, foulPoints: number): string {
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

  it("PARTITIONED BY EVENT across an INTERLEAVED two-event stream — a team at both events feeds both accumulators, and neither is contaminated", () => {
    // `replay.ts`'s `buildSeasonStream` interleaves concurrent events into one
    // chronological stream. A single-event fixture cannot tell "partition by
    // event" apart from "reset on event change"; this one can, and the shared
    // team is what makes it non-vacuous.
    let state = vpr.initState([]);
    const stream: MatchResult[] = [
      match({
        matchKey: "2024eva_qm1",
        redTeams: ["A1", "A2", "SHARED"],
        blueTeams: ["A4", "A5", "A6"],
        hasScoreBreakdown: true,
        scoreBreakdownRaw: breakdown(20, 9, 3),
      }),
      match({
        matchKey: "2024evb_qm1",
        redTeams: ["B1", "B2", "SHARED"],
        blueTeams: ["B4", "B5", "B6"],
        hasScoreBreakdown: true,
        scoreBreakdownRaw: breakdown(6, 24, 5),
      }),
      match({
        matchKey: "2024eva_qm2",
        redTeams: ["A1", "A4", "SHARED"],
        blueTeams: ["A2", "A5", "A6"],
        hasScoreBreakdown: true,
        scoreBreakdownRaw: breakdown(11, 17, 2),
      }),
      match({
        matchKey: "2024evb_qm2",
        redTeams: ["B1", "B4", "SHARED"],
        blueTeams: ["B2", "B5", "B6"],
        hasScoreBreakdown: true,
        scoreBreakdownRaw: breakdown(28, 7, 4),
      }),
    ];
    for (const m of stream) state = vpr.update(state, m);

    expect([...state.perEventVariance.keys()].sort()).toEqual(["2024eva", "2024evb"]);
    const eva = state.perEventVariance.get("2024eva")!;
    const evb = state.perEventVariance.get("2024evb")!;
    // Two matches per event, two alliance rows per match.
    expect(eva.rowCount).toBe(4);
    expect(evb.rowCount).toBe(4);
    // Each accumulator knows ONLY its own event's teams, plus the shared one.
    expect([...eva.teamOrder].sort()).toEqual(["A1", "A2", "A4", "A5", "A6", "SHARED"]);
    expect([...evb.teamOrder].sort()).toEqual(["B1", "B2", "B4", "B5", "B6", "SHARED"]);
    // Non-vacuity: the shared team really did accumulate independently at both
    // events, and its two rows are genuinely different numbers.
    const evaShared = eva.targets[TOTAL_METRIC_KEY]![eva.teamOrder.indexOf("SHARED")]!;
    const evbShared = evb.targets[TOTAL_METRIC_KEY]![evb.teamOrder.indexOf("SHARED")]!;
    expect(evaShared).toBeGreaterThan(0);
    expect(evbShared).toBeGreaterThan(0);
    expect(evaShared).not.toBe(evbShared);
  });

  it("an ALL-SURROGATE alliance folds NO row (rowCount unchanged, not merely no throw)", () => {
    let state = vpr.initState([]);
    state = vpr.update(
      state,
      match({
        matchKey: "2024test_qm1",
        redTeams: ["R1", "R2", "R3"],
        blueTeams: ["B1", "B2", "B3"],
        hasScoreBreakdown: true,
        scoreBreakdownRaw: breakdown(14, 11, 3),
      })
    );
    const before = state.perEventVariance.get("2024test")!.rowCount;
    state = vpr.update(
      state,
      match({
        matchKey: "2024test_qm2",
        redTeams: ["R1", "R2", "R3"],
        blueTeams: ["B1", "B2", "B3"],
        redSurrogates: ["R1", "R2", "R3"],
        hasScoreBreakdown: true,
        scoreBreakdownRaw: breakdown(30, 11, 3),
      })
    );
    // Blue still folds; red does not. +1, never +2.
    expect(state.perEventVariance.get("2024test")!.rowCount).toBe(before + 1);
  });

  it("a WHOLE-ALLIANCE-DQ-ZERO alliance folds NO row (rowCount unchanged)", () => {
    let state = vpr.initState([]);
    state = vpr.update(
      state,
      match({
        matchKey: "2024test_qm1",
        redTeams: ["R1", "R2", "R3"],
        blueTeams: ["B1", "B2", "B3"],
        hasScoreBreakdown: true,
        scoreBreakdownRaw: breakdown(14, 11, 3),
      })
    );
    const before = state.perEventVariance.get("2024test")!.rowCount;
    state = vpr.update(
      state,
      match({
        matchKey: "2024test_qm2",
        redTeams: ["R1", "R2", "R3"],
        blueTeams: ["B1", "B2", "B3"],
        redDqs: ["R1", "R2", "R3"],
        redScore: 0,
        hasScoreBreakdown: true,
        scoreBreakdownRaw: breakdown(30, 11, 3),
      })
    );
    expect(state.perEventVariance.get("2024test")!.rowCount).toBe(before + 1);
    // Both no-fold cases reach `applyAllianceUpdate`'s PRE-EXISTING
    // `allianceTeams.length === 0` early return — no second eligibility rule
    // was added for the decomposition, which is what keeps predict, update and
    // this fold from drifting apart.
  });

  it("carrySeason EMPTIES the map — points^2 under one season's rules are not points^2 under another's", () => {
    let state = vpr.initState([]);
    state = vpr.update(
      state,
      match({
        matchKey: "2024test_qm1",
        redTeams: ["R1", "R2", "R3"],
        blueTeams: ["B1", "B2", "B3"],
        hasScoreBreakdown: true,
        scoreBreakdownRaw: breakdown(14, 11, 3),
      })
    );
    expect(state.perEventVariance.size).toBeGreaterThan(0);
    const carried = vpr.carrySeason!(state, { fromSeason: 2024, toSeason: 2025, isColdStart: false });
    expect(carried.perEventVariance.size).toBe(0);
  });

  it("the folded TOTAL target is the SQUARE OF THE SUM of the per-component innovations, not the sum of their squares", () => {
    // On the FIRST match of a cold-start state every component's belief mean is
    // the same cold-start value and the observation is uniform across
    // components, so every component's innovation is the SAME number `i`. Then
    // per component the folded target is `i^2`, and TOTAL's is
    // `(C * i)^2 = C^2 * i^2` — a factor of C^2 (169 at 2024's 13 components),
    // against the factor of C a sum-of-squares would produce. The distinction
    // is the whole reason an aggregate key sums innovations BEFORE squaring:
    // `e_m` for the TOTAL key is the alliance's total-score residual, and
    // squaring per component first would discard every cross-component term it
    // carries.
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
    const acc = state.perEventVariance.get("2024test")!;
    const index = acc.teamOrder.indexOf("R1");
    const componentCount = state.componentOrder.length;
    expect(componentCount).toBe(SIGMA1_2024_COMPONENT_COUNT);

    const perComponent = acc.targets[state.componentOrder[0]!]![index]!;
    const total = acc.targets[TOTAL_METRIC_KEY]![index]!;
    expect(perComponent).toBeGreaterThan(0);
    expect(total / perComponent).toBeCloseTo(componentCount * componentCount, 6);
    // Non-vacuity: the sum-of-squares alternative would give a ratio of C,
    // which this fixture keeps a factor of 13 away from the asserted value.
    expect(total / perComponent).not.toBeCloseTo(componentCount, 6);
  });
});
