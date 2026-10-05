/**
 * No ranking point state crosses a season boundary, and offseason play is no
 * exception (quick task 261004-uyc plan 03). Offseason (TBA event type 99) became a
 * base tier RP event, so its matches fold into the RP beliefs, the RP population
 * summary, the RP mean shift and EPA's bonus slots exactly as they fold into
 * ratings. That is safe only because none of those four things is handed to the
 * next season: `publishSeasons` passes the next season's layer the Sigma carry and
 * nothing else, and every resume path discards another season's RP state.
 *
 * This file pins that finding. A future RP carry must change this file on purpose:
 * until then, whatever an offseason event teaches the RP state dies at the season's
 * end, and no offseason observation can leak into the next season's predictions.
 */
import { describe, expect, it } from "vitest";
import type { MatchResult } from "../core/algorithms/types.js";
import { epa, type EpaState } from "../core/algorithms/epa.js";
import { emptyEpaRpLeague } from "../core/algorithms/epaRankingPoints.js";
import { rp2020 } from "../core/rankingPoints/2020.js";
import { rp2022 } from "../core/rankingPoints/2022.js";
import { RpMomentsAccumulator } from "../core/rankingPoints/empiricalMoments.js";
import { RpMeanShiftAccumulator } from "../core/rankingPoints/meanShift.js";
import { SigmaScoutLayer } from "./sigmaScoutLayer.js";

const RED = ["frc1", "frc2", "frc3"];
const BLUE = ["frc4", "frc5", "frc6"];

function breakdown2020(red: number, blue: number): string {
  return JSON.stringify({
    red: { endgamePoints: red, shieldOperationalRankingPoint: red >= 65 },
    blue: { endgamePoints: blue, shieldOperationalRankingPoint: blue >= 65 },
  });
}

function qm(eventKey: string, eventType: number, n: number, red: number, blue: number): MatchResult {
  return {
    matchKey: `${eventKey}_qm${n}`,
    eventKey,
    compLevel: "qm",
    setNumber: 1,
    matchNumber: n,
    redTeams: RED,
    blueTeams: BLUE,
    redSurrogates: [],
    blueSurrogates: [],
    redDqs: [],
    blueDqs: [],
    eventType,
    week: null,
    winner: "red",
    redScore: 100,
    blueScore: 90,
    redRpEarned: null,
    blueRpEarned: null,
    hasScoreBreakdown: true,
    scoreBreakdownRaw: breakdown2020(red, blue),
  };
}

const PREDICTION = { winner: "red" as const, pRedWin: 0.55, redScore: 100, blueScore: 90 };

/** A season N layer fed one official and one offseason qualification match, shaped as `publishSeasons` builds it. */
function seasonNLayer(): SigmaScoutLayer {
  const layer = new SigmaScoutLayer(rp2020, "spr", { sigmaCarry: { from: undefined }, rpColdPrior: true });
  layer.foldPlayed(qm("2020casj", 0, 1, 40, 25), PREDICTION);
  layer.foldPlayed(qm("2020off", 99, 1, 70, 30), PREDICTION);
  return layer;
}

describe("offseason RP observations fold, and none of it reaches the next season", () => {
  it("non-vacuity: the season's own layer learned from BOTH the official and the offseason match", () => {
    const official = new SigmaScoutLayer(rp2020, "spr", { sigmaCarry: { from: undefined }, rpColdPrior: true });
    official.foldPlayed(qm("2020casj", 0, 1, 40, 25), PREDICTION);
    const both = seasonNLayer();

    const officialN = official.rpPopulationState()!.variables.endgamePoints!.n;
    const bothN = both.rpPopulationState()!.variables.endgamePoints!.n;
    expect(bothN, "the offseason match left no mark on the population summary").toBeGreaterThan(officialN);
    expect(both.rpAccumulator!.beliefsByTeam().size).toBe(6);
    expect(both.rpAccumulator!.hasHistory("frc1")).toBe(true);
  });

  it("the layer publishSeasons builds for season N plus 1, given season N's sigmaCarryOut, holds no RP belief, an empty population and a zero mean shift", () => {
    const carry = seasonNLayer().sigmaCarryOut();
    expect(carry, "the Sigma carry is the only thing handed across, so it must exist for this test to mean anything").toBeDefined();

    const next = new SigmaScoutLayer(rp2022, "spr", { sigmaCarry: { from: carry }, rpColdPrior: true });
    expect(next.rpAccumulator!.beliefsByTeam().size).toBe(0);
    for (const teamKey of [...RED, ...BLUE]) expect(next.rpAccumulator!.hasHistory(teamKey), teamKey).toBe(false);
    for (const [name, variable] of Object.entries(next.rpPopulationState()!.variables)) {
      expect(variable, name).toEqual({ n: 0, mean: 0, m2: 0 });
    }
    for (const [name, variable] of Object.entries(next.rpMeanShiftState()!.variables)) {
      expect(variable, name).toEqual({ count: 0, sum: 0 });
    }
  });

  it("the layer exposes no RP carry at all: its only cross season output is the Sigma carry", () => {
    const carry = seasonNLayer().sigmaCarryOut()!;
    expect(Object.keys(carry).sort()).toEqual(["beliefs", "population"]);
    expect(typeof (seasonNLayer() as unknown as { rpCarryOut?: unknown }).rpCarryOut).toBe("undefined");
  });

  it("RpMeanShiftAccumulator.fromState and RpMomentsAccumulator.fromBeliefs given season N's state with season N plus 1's rule module resume empty", () => {
    const layer = seasonNLayer();
    const shiftState = layer.rpMeanShiftState()!;
    expect(Object.values(shiftState.variables).some((v) => v.count > 0), "season N's shift holds nothing, so the resume check would be vacuous").toBe(true);
    // Positive control: the SAME season's rule module does resume it, so the empty result below is the season check and nothing else.
    expect(RpMeanShiftAccumulator.fromState(rp2020, shiftState).toState()).toEqual(shiftState);
    const resumedShift = RpMeanShiftAccumulator.fromState(rp2022, shiftState);
    for (const [name, variable] of Object.entries(resumedShift.toState().variables)) expect(variable, name).toEqual({ count: 0, sum: 0 });

    const beliefs = layer.rpAccumulator!.beliefsByTeam();
    const population = layer.rpPopulationState()!;
    expect(beliefs.size).toBeGreaterThan(0);
    expect(RpMomentsAccumulator.fromBeliefs(rp2020, beliefs, { population }).hasHistory("frc1")).toBe(true);
    const resumed = RpMomentsAccumulator.fromBeliefs(rp2022, beliefs, { population });
    for (const teamKey of [...RED, ...BLUE]) expect(resumed.hasHistory(teamKey), teamKey).toBe(false);
    for (const [name, variable] of Object.entries(resumed.populationState()!.variables)) expect(variable, name).toEqual({ n: 0, mean: 0, m2: 0 });
  });

  it("epa.carrySeason given a state with non empty bonus slots returns empty bonus slots", () => {
    const base = epa.initState(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]);
    const withSlots: EpaState = {
      ...base,
      rpSlotOffsets: new Map([["frc1", { energized: 0.25 }]]),
      rpLeague: { ...base.rpLeague, alliances: 12 },
    };
    expect(withSlots.rpSlotOffsets.size, "the state holds no bonus slot, so the reset below would be vacuous").toBeGreaterThan(0);
    // 2025 to 2026: both seasons have score component maps, so this is a real boundary.
    const carried = epa.carrySeason(withSlots, { fromSeason: 2025, toSeason: 2026, isColdStart: false });
    expect(carried.rpSlotOffsets.size).toBe(0);
    expect(carried.rpLeague).toEqual(emptyEpaRpLeague());
  });
});
