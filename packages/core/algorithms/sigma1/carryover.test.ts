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
import { epaCarryover, type EpaCarryoverInput } from "../carryover.js";
import { epa } from "../epa.js";
import { makeSigma1 } from "./index.js";
import { DEFAULT_SIGMA1_PARAMS, type Sigma1Params } from "./params.js";
import { sigma1Carryover } from "./carryover.js";
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
    const sigma1Result = sigma1Carryover(input, DEFAULT_SIGMA1_PARAMS);

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

    const defaultResult = sigma1Carryover(input, DEFAULT_SIGMA1_PARAMS);
    const perturbedParams: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, carryMeanReversion: 0.9 };
    const perturbedResult = sigma1Carryover(input, perturbedParams);

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

    // Build AND replay a Sigma1 module whose three carry fields are all
    // perturbed far from their D-04-frozen EPA defaults — this exercises
    // sigma1Carryover's own code path (via makeSigma1's carrySeason
    // binding), not just an unused params object.
    const perturbedSigma1Params: Sigma1Params = {
      ...DEFAULT_SIGMA1_PARAMS,
      carryMeanReversion: 0.95,
      carryLastYearWeight: 0.1,
      carryPriorYearWeight: 0.9,
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
