/**
 * `epaRankingPoints.ts`: Statbotics' RP slot math for EPA (quick task
 * 260929-mat). The sigmoid pair, the cold slot, the league rate, the week 1
 * freeze, the slot update and the Prediction field mapping.
 */
import { describe, expect, it } from "vitest";
import {
  applyEpaRpSlotUpdate,
  emptyEpaRpLeague,
  epaRpColdSlot,
  epaRpLeagueRate,
  epaRpPreImage,
  epaRpTeamZ,
  EPA_RP_EPS,
  EPA_RP_NUM_TEAMS,
  EPA_RP_RATE_MIN_ALLIANCES,
  EPA_RP_UNINFORMED_RATE,
  foldEpaRpLeague,
  freezeEpaRpLeague,
  invUnitSigmoid,
  rpPredictionFieldsFrom,
  unitSigmoid,
} from "./epaRankingPoints.js";
import { EPA_CARRY_RESCALE_MIN_OBS } from "./epaCarryScale.js";
import { epaCarryover, EPA_NORM_MEAN, EPA_NORM_SD, normalizedFromPoints, populationMeanSd } from "./carryover.js";
import { epaPercentFunc } from "./epa.js";
import { bonusMarginalRpPmf } from "../rankingPoints/bonusMarginalPmf.js";
import { rpRuleModuleForSeason } from "../rankingPoints/rules.js";

describe("unitSigmoid / invUnitSigmoid (Statbotics math.py)", () => {
  it("unitSigmoid is 1/(1+exp(-4(x-0.5))) and unitSigmoid(0.5) is exactly 0.5", () => {
    expect(unitSigmoid(0.5)).toBe(0.5);
    for (const x of [-1, -0.2, 0, 0.3, 0.9, 1.7]) {
      expect(unitSigmoid(x)).toBe(1 / (1 + Math.exp(-4 * (x - 0.5))));
    }
  });

  it("invUnitSigmoid round-trips unitSigmoid within 1e-12", () => {
    for (const x of [-1, -0.5, 0, 0.25, 0.5, 0.75, 1, 1.5]) {
      expect(Math.abs(invUnitSigmoid(unitSigmoid(x)) - x)).toBeLessThan(1e-12);
    }
  });
});

describe("epaRpPreImage and epaRpColdSlot (get_init_epa)", () => {
  it("the uninformed rate 0.5 has pre-image exactly 0.5", () => {
    expect(epaRpPreImage(EPA_RP_UNINFORMED_RATE)).toBe(0.5);
  });

  it("a rate of 0 clamps through EPS and floors the pre-image at -1; a rate of 1 clamps through 1 - EPS", () => {
    expect(EPA_RP_EPS).toBe(1e-6);
    expect(epaRpPreImage(0)).toBe(-1);
    expect(epaRpPreImage(1)).toBe(invUnitSigmoid(1 - EPA_RP_EPS));
  });

  it("three z-neutral teams with no offsets predict exactly the league rate (within 1e-12)", () => {
    for (const rate of [0.05, 0.12, 0.3, 0.5, 0.8, 0.97]) {
      const preImage = epaRpPreImage(rate);
      for (const sdFrac of [null, 0.4]) {
        const cold = epaRpColdSlot(preImage, sdFrac, -2, 0);
        const p = unitSigmoid(cold + cold + cold);
        expect(Math.abs(p - rate)).toBeLessThan(1e-12);
      }
    }
  });

  it("keeps Statbotics' z term whole: floored at zFloor, and below about 12% a stronger team's cold slot is LOWER", () => {
    expect(EPA_RP_NUM_TEAMS).toBe(3);
    const sdFrac = 0.5;
    const zFloor = -1 / (3 * sdFrac);
    // Above the rate whose pre-image is 0 (about 11.9%), stronger is higher.
    const high = epaRpPreImage(0.4);
    expect(epaRpColdSlot(high, sdFrac, zFloor, 1)).toBeGreaterThan(epaRpColdSlot(high, sdFrac, zFloor, 0));
    // Below it, the pre-image is negative and the ordering inverts (recorded, not corrected).
    const low = epaRpPreImage(0.05);
    expect(low).toBeLessThan(0);
    expect(epaRpColdSlot(low, sdFrac, zFloor, 1)).toBeLessThan(epaRpColdSlot(low, sdFrac, zFloor, 0));
    // The floor: a z below zFloor is read as zFloor, which zeroes the cold slot.
    expect(epaRpColdSlot(high, sdFrac, zFloor, -50)).toBeCloseTo(0, 12);
    // No readable scale drops the z term entirely.
    expect(epaRpColdSlot(high, null, zFloor, 3)).toBe(high / 3);
  });
});

describe("epaRpTeamZ", () => {
  it("equals the normalized rating epaCarryover itself used for a carried team", () => {
    const teamTotals = new Map([
      ["frc1", 40],
      ["frc2", 25],
      ["frc3", 12],
      ["frc4", 30],
    ]);
    const priorSeasonRatings = { lastSeason: new Map([["frc1", 1700], ["frc4", 1400]]), yearBefore: new Map([["frc1", 1650]]) };
    const result = epaCarryover({ teamTotals, priorSeasonRatings });
    const { mean, sd } = populationMeanSd([...teamTotals.values()]);
    for (const team of ["frc1", "frc2", "frc4"]) {
      const carriedPoints = result.teamPointTotals.get(team)!;
      expect(carriedPoints).toBeGreaterThan(0); // above the floor, so the unit conversion inverts exactly
      const usedNormalized = normalizedFromPoints(carriedPoints, mean, sd);
      expect(EPA_NORM_MEAN + epaRpTeamZ(result.priorSeasonRatings, team) * EPA_NORM_SD).toBeCloseTo(usedNormalized, 9);
    }
  });

  it("a team with no history is the rookie baseline, z = -0.2", () => {
    expect(epaRpTeamZ({ lastSeason: new Map(), yearBefore: new Map() }, "frc9999")).toBeCloseTo(-0.2, 12);
  });
});

describe("epaRpLeagueRate / foldEpaRpLeague / freezeEpaRpLeague", () => {
  const NAMES = ["a", "b"];

  it("reads 0.5 until EPA_CARRY_RESCALE_MIN_OBS alliances have folded, then the live season rate", () => {
    expect(EPA_RP_RATE_MIN_ALLIANCES).toBe(EPA_CARRY_RESCALE_MIN_OBS);
    let league = emptyEpaRpLeague();
    for (let i = 0; i < EPA_RP_RATE_MIN_ALLIANCES - 1; i++) league = foldEpaRpLeague(league, NAMES, { a: i % 4 === 0, b: false }, false);
    expect(epaRpLeagueRate(league, "a")).toBe(EPA_RP_UNINFORMED_RATE);
    league = foldEpaRpLeague(league, NAMES, { a: false, b: true }, false);
    expect(league.alliances).toBe(EPA_RP_RATE_MIN_ALLIANCES);
    expect(epaRpLeagueRate(league, "a")).toBe(league.sums.a! / league.alliances);
    expect(epaRpLeagueRate(league, "b")).toBe(1 / league.alliances);
    expect(league.weekOneAlliances).toBe(0);
  });

  it("freezes the week 1 rate on the seal when at least two week 1 alliances folded, and the frozen rate wins from then on", () => {
    let league = emptyEpaRpLeague();
    league = foldEpaRpLeague(league, NAMES, { a: true, b: false }, true);
    league = foldEpaRpLeague(league, NAMES, { a: true, b: true }, true);
    league = foldEpaRpLeague(league, NAMES, { a: false, b: false }, true);
    league = foldEpaRpLeague(league, NAMES, { a: false, b: false }, false);
    const frozen = freezeEpaRpLeague(league);
    expect(frozen.frozenRates).toEqual({ a: 2 / 3, b: 1 / 3 });
    expect(epaRpLeagueRate(frozen, "a")).toBe(2 / 3);
    // A second freeze is a no-op.
    expect(freezeEpaRpLeague(frozen)).toBe(frozen);
  });

  it("a seal that found fewer than two week 1 alliances freezes nothing, so the live rule keeps applying", () => {
    const league = foldEpaRpLeague(emptyEpaRpLeague(), NAMES, { a: true, b: true }, true);
    expect(freezeEpaRpLeague(league).frozenRates).toBeNull();
    expect(epaRpLeagueRate(freezeEpaRpLeague(league), "a")).toBe(EPA_RP_UNINFORMED_RATE);
  });
});

describe("applyEpaRpSlotUpdate", () => {
  it("moves each team's offset by percent * (flag - p) / eligibleCount and never mutates its input", () => {
    const before = new Map([["frc1", { a: 0.1 }]]);
    const percent = (team: string): number => epaPercentFunc(team === "frc1" ? 8 : 0);
    const after = applyEpaRpSlotUpdate(before, ["frc1", "frc2"], ["a", "b"], { a: true, b: false }, [0.3, 0.6], percent);
    expect(after.get("frc1")!.a).toBe(0.1 + (epaPercentFunc(8) * (1 - 0.3)) / 2);
    expect(after.get("frc1")!.b).toBe(0 + (epaPercentFunc(8) * (0 - 0.6)) / 2);
    expect(after.get("frc2")!.a).toBe(0 + (epaPercentFunc(0) * (1 - 0.3)) / 2);
    expect(before.get("frc1")).toEqual({ a: 0.1 });
    expect(before.has("frc2")).toBe(false);
  });

  it("an empty roster is a no-op returning the same map", () => {
    const before = new Map([["frc1", { a: 0.1 }]]);
    expect(applyEpaRpSlotUpdate(before, [], ["a"], { a: true }, [0.3], () => 0.2)).toBe(before);
  });
});

describe("rpPredictionFieldsFrom", () => {
  it("maps the nine RP fields exactly as SigmaScoutLayer does, with the decomposition as a set", () => {
    const ruleModule = rpRuleModuleForSeason(2026);
    const result = bonusMarginalRpPmf({
      redBonusProbabilities: [0.6, 0.2, 0.5],
      blueBonusProbabilities: [0.4, 0.1, 0.3],
      pRedWin: 0.7,
      ruleModule,
      eventType: 0,
      compLevel: "qm",
    });
    const fields = rpPredictionFieldsFrom(result);
    expect(Object.keys(fields).sort()).toEqual(
      [
        "blueBonusRp",
        "blueBonusRpPmf",
        "blueOutcomeRp",
        "blueRpPmf",
        "matchOutcomePmf",
        "redBonusRp",
        "redBonusRpPmf",
        "redOutcomeRp",
        "redRpPmf",
      ].sort()
    );
    expect(fields.matchOutcomePmf).toEqual([0.7, 0, 1 - 0.7]);
    expect(fields.redOutcomeRp).toEqual([3, 1, 0]);
    expect(fields.blueOutcomeRp).toEqual([0, 1, 3]);
    expect(fields.redRpPmf).toBe(result.redPmf);
    expect(fields.blueBonusRpPmf).toBe(result.blueBonusPmf);
  });

  it("a non-qualification result maps to the two [1] pmfs only", () => {
    const fields = rpPredictionFieldsFrom({ redPmf: [1], bluePmf: [1] });
    expect(fields).toEqual({ redRpPmf: [1], blueRpPmf: [1] });
  });
});
