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
import { ADJUST_COMPONENT } from "../breakdown/index.js";

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

/**
 * Quick task 260903-3bv narrowed this equality to `gap === 1`. It was NOT
 * weakened: D-1 freezes EPA at literal Statbotics parity including the gap
 * (EPA never learns what a gap is), while D-2 makes Sigma1's carry apply
 * once per year elapsed. Those two constraints together mean the equality
 * this block asserts can only ever hold at a one-year gap — at any longer
 * gap the two are SUPPOSED to diverge (see the sibling block immediately
 * below). Deleting this test to make room for the divergence would have
 * hidden that the equality still holds exactly where it always did; the
 * divergence sibling exists precisely so the intentional split is pinned
 * rather than merely implied.
 */
describe("sigma1Carryover at DEFAULT_SIGMA1_PARAMS reproduces epaCarryover exactly, at gap === 1", () => {
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

/**
 * The intentional divergence at gap === 2 (D-1, D-2): EPA's frozen carry has
 * no concept of a gap at all, so `epaCarryover(input)` is the SAME call
 * whether the underlying boundary spans one year or two. Sigma1's carry
 * DOES change with gap, so at a two-year gap the two must disagree — and
 * disagree in a specific DIRECTION (Sigma1 reverts strictly further toward
 * `EPA_ROOKIE_BASELINE`), not merely produce different numbers. A bare
 * `not.toEqual` would also pass on a sign error (e.g. reverting the wrong
 * way), so this asserts direction explicitly.
 */
describe("sigma1Carryover(..., 2) diverges from epaCarryover, strictly toward EPA_ROOKIE_BASELINE (D-1, D-2)", () => {
  it("teamPointTotals differ from epaCarryover's, and every team sits strictly closer to the baseline", () => {
    // Reuses the D-T2 block's two-team, mean-50/sd-10 fixture shape so the
    // baseline's point-unit image is known by construction.
    const teamTotals = new Map<string, number>([
      ["frcA", 40],
      ["frcB", 60],
    ]);
    const input: EpaCarryoverInput = {
      teamTotals,
      priorSeasonRatings: {
        lastSeason: new Map([
          ["frcA", 1.5],
          ["frcB", -0.5],
        ]),
        yearBefore: new Map(),
      },
    };

    const epaResult = epaCarryover(input);
    const sigma1AtGap2 = sigma1Carryover(input, RESOLVED_DEFAULTS, 2);

    expect(mapToObject(sigma1AtGap2.teamPointTotals)).not.toEqual(mapToObject(epaResult.teamPointTotals));

    const { mean, sd } = populationMeanSd([...teamTotals.values()]);
    const baselinePoints = normalizedToSeasonUnits(EPA_ROOKIE_BASELINE, mean, sd);
    for (const team of teamTotals.keys()) {
      const epaPoints = epaResult.teamPointTotals.get(team)!;
      const sigma1Points = sigma1AtGap2.teamPointTotals.get(team)!;
      expect(
        Math.abs(sigma1Points - baselinePoints),
        `${team}: a two-year gap must revert strictly closer to the baseline than EPA's one-year-shaped carry`
      ).toBeLessThan(Math.abs(epaPoints - baselinePoints));
    }
  });
});

/**
 * Composition property (D-2): applying a two-year gap once is the same
 * generalization as applying a one-year gap twice — this is what makes
 * "per year elapsed" the right shape rather than an arbitrary curve.
 * `toBeCloseTo`, NOT `toBe`, is correct here: the composition is exact in
 * REAL arithmetic, but the two float evaluation orders differ, so demanding
 * bitwise equality would be a flaky test asserting something IEEE-754 never
 * promised. (Contrast task 1's `gap === 1` bar, where `toBe` is correct
 * because the fast path guarantees the SAME expression, not an equivalent
 * one evaluated a different way.)
 */
describe("gap === 2 composes with gap === 1 applied twice (D-2)", () => {
  it("reversionOverGap(r, 2) matches the two-step composite r + (1 - r) * r", () => {
    const r = RESOLVED_DEFAULTS.carryMeanReversion;
    expect(reversionOverGap(r, 2)).toBeCloseTo(r + (1 - r) * r, 12);
  });

  it("consistencyCarryDecay ** 2 matches the two-step composite d * d", () => {
    const d = RESOLVED_DEFAULTS.consistencyCarryDecay;
    expect(d ** 2).toBeCloseTo(d * d, 12);
  });
});

/**
 * Monotonicity (D-2 items 1 and 2): a longer gap must revert/decay strictly
 * further than a shorter one, both at the `reversionOverGap` level and
 * end-to-end through a full `carrySeason` call.
 */
describe("a longer gap reverts and decays strictly further than a shorter one (D-2)", () => {
  it("reversionOverGap(r, 2) is strictly greater than reversionOverGap(r, 1) for the default reversion", () => {
    const r = RESOLVED_DEFAULTS.carryMeanReversion;
    expect(reversionOverGap(r, 2)).toBeGreaterThan(reversionOverGap(r, 1));
  });

  it("consistencyCarryDecay ** 2 is strictly less than consistencyCarryDecay for the default value", () => {
    const d = RESOLVED_DEFAULTS.consistencyCarryDecay;
    expect(d ** 2).toBeLessThan(d);
  });

  it("a team's carried consistency after a two-year boundary is strictly smaller than after a one-year boundary, from the same starting state", () => {
    const sigma1TwoYear = makeSigma1({ id: "sigma1-gap-monotonicity-2y", linkMode: "predictive-variance" });
    const sigma1OneYear = makeSigma1({ id: "sigma1-gap-monotonicity-1y", linkMode: "predictive-variance" });
    const { season2024 } = twoSeasonSequence();

    function replayThenCarry(sigma1: ReturnType<typeof makeSigma1>, boundary: SeasonBoundary) {
      let state = sigma1.initState([]);
      for (const m of season2024) state = sigma1.update(state, m);
      return sigma1.carrySeason!(state, boundary);
    }

    // Both boundaries share the SAME toSeason (2024, season2024's own
    // component set) so the resulting consistency/beliefs keys line up
    // one-to-one across the two states — only the gap (fromSeason) differs.
    const stateTwoYear = replayThenCarry(sigma1TwoYear, { fromSeason: 2022, toSeason: 2024, isColdStart: false });
    const stateOneYear = replayThenCarry(sigma1OneYear, { fromSeason: 2023, toSeason: 2024, isColdStart: false });

    for (const [team, teamStateOneYear] of stateOneYear.teams) {
      const teamStateTwoYear = stateTwoYear.teams.get(team)!;
      for (const name of Object.keys(teamStateOneYear.consistency)) {
        // `adjust` (quick task 260904-6a1, D-5/D-6) is pinned at exactly `0`
        // consistency regardless of gap — it is never folded and never
        // decayed, so the strict-monotonicity claim below does not apply to
        // it (0 is not strictly less than 0).
        if (name === ADJUST_COMPONENT) continue;
        expect(
          teamStateTwoYear.consistency[name]!,
          `${team}/${name}: a two-year gap must decay consistency strictly further than a one-year gap`
        ).toBeLessThan(teamStateOneYear.consistency[name]!);
      }
    }
  });
});

/**
 * The gap guard (D-2's asserted, not merely documented, bar): `carrySeason`
 * throws rather than silently treating a non-advancing or backwards boundary
 * as a valid one-year gap.
 */
describe("carrySeason throws when the boundary does not advance by at least one whole year", () => {
  it("throws when toSeason === fromSeason", () => {
    const sigma1 = makeSigma1({ id: "sigma1-gap-guard-flat", linkMode: "predictive-variance" });
    const state = sigma1.initState([]);
    expect(() => sigma1.carrySeason!(state, { fromSeason: 2025, toSeason: 2025, isColdStart: false })).toThrow();
  });

  it("throws when toSeason < fromSeason", () => {
    const sigma1 = makeSigma1({ id: "sigma1-gap-guard-backwards", linkMode: "predictive-variance" });
    const state = sigma1.initState([]);
    expect(() => sigma1.carrySeason!(state, { fromSeason: 2026, toSeason: 2025, isColdStart: false })).toThrow();
  });
});

/**
 * Belief-variance regression (constraint D-2 item 3): an earlier framing of
 * this task wrongly said to ADD process noise `gap` times at a season
 * boundary. `carrySeason` does not add process noise here — it RESETS
 * belief variance to a cold-start value via `seedConsistencyFor`, and
 * nothing is more uncertain than cold start, so a longer gap must not
 * inflate it further. This test exists because a corrected instruction with
 * no test behind it is an instruction waiting to be re-broken.
 */
describe("belief variance is unchanged by gap (D-2 item 3)", () => {
  it("every beliefs[name].variance is identical whether the boundary spans one year or two", () => {
    const sigma1TwoYear = makeSigma1({ id: "sigma1-belief-variance-2y", linkMode: "predictive-variance" });
    const sigma1OneYear = makeSigma1({ id: "sigma1-belief-variance-1y", linkMode: "predictive-variance" });
    const { season2024 } = twoSeasonSequence();

    function replayThenCarry(sigma1: ReturnType<typeof makeSigma1>, boundary: SeasonBoundary) {
      let state = sigma1.initState([]);
      for (const m of season2024) state = sigma1.update(state, m);
      return sigma1.carrySeason!(state, boundary);
    }

    // Same reasoning as the monotonicity test above: identical toSeason so
    // the beliefs keys line up, only the gap differs.
    const stateTwoYear = replayThenCarry(sigma1TwoYear, { fromSeason: 2022, toSeason: 2024, isColdStart: false });
    const stateOneYear = replayThenCarry(sigma1OneYear, { fromSeason: 2023, toSeason: 2024, isColdStart: false });

    for (const [team, teamStateOneYear] of stateOneYear.teams) {
      const teamStateTwoYear = stateTwoYear.teams.get(team)!;
      for (const name of Object.keys(teamStateOneYear.consistency)) {
        expect(
          teamStateTwoYear.beliefs[name]!.variance,
          `${team}/${name}: belief variance must be reset to the same cold-start value regardless of gap`
        ).toBe(teamStateOneYear.beliefs[name]!.variance);
      }
    }
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
