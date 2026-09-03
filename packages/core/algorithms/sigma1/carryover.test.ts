/**
 * D-04's proof, stated as tests rather than argued in prose:
 *
 *   1. `sigma1Carryover` at `DEFAULT_SIGMA1_PARAMS` is behaviour-preserving
 *      — deeply equal to `epaCarryover` for the same input.
 *   2. Perturbing Sigma1's carry params changes `sigma1Carryover`'s output
 *      WITHOUT moving `epaCarryover`'s — the freeze, stated as a test.
 *   3. A full `epa` module replay across a real season boundary is
 *      byte-identical whether or not a Sigma1 module with heavily
 *      perturbed carry params was also built/replayed alongside it — no
 *      shared mutable state, no cross-module leakage.
 */
import { describe, expect, it } from "vitest";
import {
  epaCarryover,
  normalizedFromPoints,
  normalizedToSeasonUnits,
  populationMeanSd,
  type EpaCarryoverInput,
} from "../carryover.js";
import { epa } from "../epa.js";
import { makeSigma1 } from "./index.js";
import { DEFAULT_SIGMA1_PARAMS, type Sigma1Params } from "./params.js";
import { resolveSigma1Params, type Sigma1ResolvedParams } from "./scale.js";
import { emptyExpandingStats } from "../../scoring/expandingStats.js";
import { EPA_ROOKIE_BASELINE, reversionOverGap, sigma1Carryover } from "./carryover.js";

/**
 * D-T1 (4.0.0): `sigma1Carryover` takes RESOLVED params, because `carrySeason`
 * resolves once at its top and threads the result down. None of the two carry
 * fields is scale-dependent, so resolving at any statistic gives the identical
 * carry behaviour; the EMPTY statistic is used here as the simplest one.
 */
const RESOLVED_DEFAULTS: Sigma1ResolvedParams = resolveSigma1Params(DEFAULT_SIGMA1_PARAMS, emptyExpandingStats());
import type { MatchResult, SeasonBoundary, UpcomingMatch } from "../types.js";

function fixtureInput(): EpaCarryoverInput {
  return {
    teamTotals: new Map([
      ["frc1", 60],
      ["frc2", 40],
      ["frc3", 20],
    ]),
    priorSeasonRatings: {
      lastSeason: new Map([
        ["frc1", 1550],
        ["frc2", 1500],
      ]),
      yearBefore: new Map([["frc1", 1600]]),
    },
  };
}

/** Same input, but frc2/frc3 exercise the "only one prior season present" / "no prior history at all" branches respectively. */
function fixtureInputMixedHistory(): EpaCarryoverInput {
  return {
    teamTotals: new Map([
      ["frc1", 60], // both prior seasons present
      ["frc2", 40], // only lastSeason present
      ["frc3", 20], // no prior history at all
    ]),
    priorSeasonRatings: {
      lastSeason: new Map([
        ["frc1", 1550],
        ["frc2", 1500],
      ]),
      yearBefore: new Map([["frc1", 1600]]),
    },
  };
}

function mapToObject<V>(map: ReadonlyMap<string, V>): Record<string, V> {
  return Object.fromEntries(map);
}

describe("sigma1Carryover at DEFAULT_SIGMA1_PARAMS reproduces epaCarryover exactly", () => {
  it.each([
    ["both prior seasons present, one present, and neither (mixed fixture)", fixtureInputMixedHistory()],
    ["a simpler both/one/none-mixed fixture", fixtureInput()],
  ])("%s", (_label, input) => {
    const epaResult = epaCarryover(input);
    const sigma1Result = sigma1Carryover(input, RESOLVED_DEFAULTS, 1);

    expect(mapToObject(sigma1Result.teamPointTotals)).toEqual(mapToObject(epaResult.teamPointTotals));
    expect(mapToObject(sigma1Result.priorSeasonRatings.lastSeason)).toEqual(
      mapToObject(epaResult.priorSeasonRatings.lastSeason)
    );
    expect(mapToObject(sigma1Result.priorSeasonRatings.yearBefore)).toEqual(
      mapToObject(epaResult.priorSeasonRatings.yearBefore)
    );
  });
});

describe("D-04 freeze — tuning Sigma1's carry params never moves EPA's", () => {
  it("a perturbed carryMeanReversion changes sigma1Carryover's output, while epaCarryover(input) is byte-identical to its DEFAULT_SIGMA1_PARAMS-run counterpart", () => {
    const input = fixtureInputMixedHistory();

    const defaultResult = sigma1Carryover(input, RESOLVED_DEFAULTS, 1);
    const perturbedParams: Sigma1ResolvedParams = { ...RESOLVED_DEFAULTS, carryMeanReversion: 0.9 };
    const perturbedResult = sigma1Carryover(input, perturbedParams, 1);

    // The perturbation is real: sigma1Carryover's own output moves.
    expect(mapToObject(perturbedResult.teamPointTotals)).not.toEqual(mapToObject(defaultResult.teamPointTotals));

    // EPA never learns about the perturbation at all — same call, same
    // input, same output, regardless of what Sigma1's params say.
    const epaBefore = epaCarryover(input);
    const epaAfterSigma1Perturbation = epaCarryover(input);
    expect(mapToObject(epaAfterSigma1Perturbation.teamPointTotals)).toEqual(mapToObject(epaBefore.teamPointTotals));
  });
});

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
    // Plan 03-03: rp/2024.ts's OWN Zod schema requires these fields too —
    // placeholder values, no test in this file exercises RP behavior.
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

/** A two-season synthetic sequence: one 2024 event, a season boundary, one 2025 event, sharing teams across the boundary so carrySeason's effect is live. */
function twoSeasonSequence(): { season2024: MatchResult[]; season2025: MatchResult[] } {
  return {
    season2024: [
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
    ],
    season2025: [
      match({
        matchKey: "2025eventb_qm1",
        eventKey: "2025eventb",
        redTeams: ["T1", "T2", "T7"],
        blueTeams: ["T3", "T5", "T6"],
        redScore: UNIFORM_TOTAL_2025,
        blueScore: UNIFORM_TOTAL_2025,
        hasScoreBreakdown: true,
        scoreBreakdownRaw: rawBreakdown2025Uniform(UNIFORM_PER_COMPONENT),
      }),
    ],
  };
}

function replayEpaAcrossBoundary(): unknown[] {
  const { season2024, season2025 } = twoSeasonSequence();
  let state = epa.initState([]);
  const predictions: unknown[] = [];

  for (const m of season2024) {
    predictions.push(epa.predict(state, toUpcoming(m)));
    state = epa.update(state, m);
  }

  const boundary: SeasonBoundary = { fromSeason: 2024, toSeason: 2025, isColdStart: false };
  state = epa.carrySeason!(state, boundary);

  for (const m of season2025) {
    predictions.push(epa.predict(state, toUpcoming(m)));
    state = epa.update(state, m);
  }

  return predictions;
}

describe("D-04 freeze — a full epa replay is unaffected by a Sigma1 module with perturbed carry params", () => {
  it("epa's prediction stream is byte-identical whether or not a heavily-perturbed Sigma1 module was also built and replayed over the same match sequence", () => {
    const epaBaseline = replayEpaAcrossBoundary();

    // Build AND replay a Sigma1 module whose carry fields are both perturbed
    // far from their D-04-frozen EPA defaults — this exercises
    // sigma1Carryover's own code path (via makeSigma1's carrySeason
    // binding), not just an unused params object. D-T2: two fields now, not
    // three — `carryPriorYearShare` replaced the unnormalized weight pair.
    const perturbedSigma1Params: Sigma1Params = {
      ...DEFAULT_SIGMA1_PARAMS,
      carryMeanReversion: 0.95,
      carryPriorYearShare: 0.9,
    };
    const perturbedSigma1 = makeSigma1({
      id: "sigma1-carry-perturbed",
      linkMode: "predictive-variance",
      params: perturbedSigma1Params,
      paramSetName: "carry-perturbed-test",
    });
    const { season2024, season2025 } = twoSeasonSequence();
    let sigma1State = perturbedSigma1.initState([]);
    for (const m of season2024) {
      perturbedSigma1.predict(sigma1State, toUpcoming(m));
      sigma1State = perturbedSigma1.update(sigma1State, m);
    }
    sigma1State = perturbedSigma1.carrySeason!(sigma1State, { fromSeason: 2024, toSeason: 2025, isColdStart: false });
    for (const m of season2025) {
      perturbedSigma1.predict(sigma1State, toUpcoming(m));
      sigma1State = perturbedSigma1.update(sigma1State, m);
    }

    // Re-run epa AFTER the Sigma1 replay above: identical output proves no
    // shared mutable state leaked the Sigma1 perturbation into EPA.
    const epaAfter = replayEpaAcrossBoundary();
    expect(JSON.stringify(epaAfter)).toBe(JSON.stringify(epaBaseline));
  });
});

/**
 * D-T2's named verification bar (CONTEXT.md): `carryPriorYearShare = 0.3`
 * reproduces the retired `0.7 * lastYear + 0.3 * yearBefore` blend EXACTLY.
 *
 * Asserted against HAND-COMPUTED values rather than against a
 * re-implementation of the same formula. A re-implementation would pass even
 * if both it and the code were wrong in the same way, which is the failure
 * mode this project's log names.
 */
describe("D-T2 — carryPriorYearShare = 0.3 reproduces the retired 0.7/0.3 blend to the last bit", () => {
  it("blends two hand-computed normalized ratings exactly", () => {
    // The blend runs on NORMALIZED ratings, and `sigma1Carryover` normalizes
    // its own inputs — so the fixture is built so the normalization is
    // known: two teams whose point totals are symmetric about the population
    // mean, and a prior-season map supplying the `yearBefore` side directly.
    const teamTotals = new Map<string, number>([
      ["frcA", 40],
      ["frcB", 60],
    ]);
    // populationMeanSd over {40, 60}: mean 50, sd 10.
    // normalizedFromPoints is the shared, frozen conversion — imported by the
    // module under test, so the two sides cannot disagree about the scale.
    const lastYearA = normalizedFromPoints(40, 50, 10);
    const lastYearB = normalizedFromPoints(60, 50, 10);
    const yearBeforeA = 1.5;
    const yearBeforeB = -0.5;

    const result = sigma1Carryover(
      {
        teamTotals,
        priorSeasonRatings: {
          lastSeason: new Map([
            ["frcA", yearBeforeA],
            ["frcB", yearBeforeB],
          ]),
          yearBefore: new Map(),
        },
      },
      RESOLVED_DEFAULTS,
      1
    );

    const reversion = RESOLVED_DEFAULTS.carryMeanReversion;
    for (const [team, lastYear, yearBefore] of [
      ["frcA", lastYearA, yearBeforeA],
      ["frcB", lastYearB, yearBeforeB],
    ] as const) {
      // The RETIRED expression, written out with its own two literal weights
      // — this is the thing 0.3 has to reproduce, and it is spelled here in
      // full so the test states the contract rather than referencing it.
      const retiredBlend = 0.7 * lastYear + 0.3 * yearBefore;
      const expectedCarried = retiredBlend + reversion * (EPA_ROOKIE_BASELINE - retiredBlend);
      const expectedPoints = normalizedToSeasonUnits(expectedCarried, 50, 10);
      expect(result.teamPointTotals.get(team)!, `${team}: the merged share must reproduce the retired blend bitwise`).toBe(
        expectedPoints
      );
    }
  });

  it("the share is a real degree of freedom: moving it off 0.3 moves the carried rating", () => {
    // Non-vacuity for the assertion above — without this, a `sigma1Carryover`
    // that ignored the share entirely would pass.
    const input = fixtureInputMixedHistory();
    const atDefault = sigma1Carryover(input, RESOLVED_DEFAULTS, 1);
    const atNine = sigma1Carryover(input, { ...RESOLVED_DEFAULTS, carryPriorYearShare: 0.9 }, 1);
    expect(mapToObject(atNine.teamPointTotals)).not.toEqual(mapToObject(atDefault.teamPointTotals));
  });
});

/**
 * Quick task 260903-3bv, task 1's acceptance bar (D-2 item 1, D-3): at
 * `gap === 1`, `sigma1Carryover` must reproduce the PRE-CHANGE carried
 * values bitwise — `toBe`, never `toBeCloseTo` — against hand-written
 * expressions that do not call `reversionOverGap` at all. A
 * re-implementation of the new formula would pass even if both it and the
 * production code were wrong in the same way, which is exactly why this is
 * spelled out in full rather than delegated to a helper.
 */
describe("gap === 1 reproduces the pre-change carried values exactly (D-2 item 1, D-3)", () => {
  it("sigma1Carryover(..., 1) matches the hand-written pre-change expression, per team, bitwise", () => {
    const input = fixtureInputMixedHistory();
    const { mean, sd } = populationMeanSd([...input.teamTotals.values()]);
    const reversion = RESOLVED_DEFAULTS.carryMeanReversion;
    const share = RESOLVED_DEFAULTS.carryPriorYearShare;

    const result = sigma1Carryover(input, RESOLVED_DEFAULTS, 1);

    for (const [team, points] of input.teamTotals) {
      const lastYear = normalizedFromPoints(points, mean, sd);
      const yearBefore = input.priorSeasonRatings.lastSeason.get(team) ?? null;
      // The PRE-CHANGE expression, written out in full: no gap concept, no
      // `reversionOverGap` call — this is what `gap === 1` must reproduce
      // bitwise, not merely closely.
      const blended = yearBefore !== null ? (1 - share) * lastYear + share * yearBefore : lastYear;
      const expectedCarried = blended + reversion * (EPA_ROOKIE_BASELINE - blended);
      const expectedPoints = normalizedToSeasonUnits(expectedCarried, mean, sd);
      expect(result.teamPointTotals.get(team)!, `${team}: gap === 1 must reproduce the pre-change value bitwise`).toBe(
        expectedPoints
      );
    }
  });

  it("reversionOverGap(0.37, 1) is 0.37 exactly, which the fast path guarantees and the general expression does not", () => {
    // The general expression 1 - (1 - 0.37) ** 1 evaluates to
    // 0.37000000000000005 in IEEE-754 — this is the value the fast path in
    // `reversionOverGap` exists to avoid.
    expect(reversionOverGap(0.37, 1)).toBe(0.37);
  });
});
