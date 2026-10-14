/**
 * Pure, corpus free tests for `measureRandomPickDraft.ts` (quick task
 * 261014-mji): the walk forward tables and their leak boundary, the quals done
 * baselines, the rank draft's ratings, the real outcomes, every score, the
 * calibration table, the playoff buckets and the real placements.
 */
import { describe, expect, it } from "vitest";
import { mulberry32, simulateRanks } from "../packages/core/algorithms/simulation/rankSimulation.js";
import type { AllianceMemberRating } from "../packages/core/algorithms/simulation/allianceWinProbability.js";
import { playoffPoints, routeBracket, type PlayedBracketMatch } from "../packages/core/districts/bracket.js";
import type { EventAllianceSelection } from "../packages/corpus/db.js";
import type { TurnResult } from "./measureSelectionAgreement.js";
import {
  accuracyAtHalf,
  brierScore,
  calibrationTable,
  DuplicateRankError,
  logLoss,
  MissingRankError,
  multiclassBrier,
  multiclassLogLoss,
  NONE_SLOT_CLASS,
  pickPositionTables,
  playoffBucketChances,
  qualsDoneBaselines,
  rankOrderRatings,
  realOnAlliance,
  realPlacements,
  realSlots,
  slotClass,
  winRuleVerdict,
} from "./measureRandomPickDraft.js";

function turn(season: number, round: 1 | 2, modelRank: number): TurnResult {
  return { eventKey: `${String(season)}zz`, season, round, allianceNumber: 1, modelRank, availableCount: 30 };
}

function alliance(allianceNumber: number, picks: string[]): EventAllianceSelection {
  return { allianceNumber, name: null, picks, record: null };
}

describe("pickPositionTables", () => {
  const turns: TurnResult[] = [
    turn(2015, 1, 5),
    turn(2019, 1, 1),
    turn(2020, 1, 1),
    turn(2020, 1, 1),
    turn(2020, 1, 3),
    turn(2020, 2, 2),
    turn(2021, 1, 9),
  ];

  it("counts by round over trainFrom <= season < eventSeason, raw frequency to the deepest position", () => {
    const tables = pickPositionTables(turns, 2021, 2016);
    expect(tables.firstTurns).toBe(4);
    expect(tables.secondTurns).toBe(1);
    expect(tables.pmf.firstPick).toEqual([0.75, 0, 0.25]);
    expect(tables.pmf.secondPick).toEqual([0, 1]);
    for (const pmf of [tables.pmf.firstPick, tables.pmf.secondPick]) {
      expect(pmf.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    }
  });

  it("leaves out seasons below trainFrom", () => {
    const withEarly = pickPositionTables(turns, 2021, 2015);
    expect(withEarly.firstTurns).toBe(5);
    expect(withEarly.pmf.firstPick).toHaveLength(5);
  });

  it("the walk forward boundary: turns from season Y and Y + 1 leave the season Y tables deep equal", () => {
    const before = pickPositionTables(turns, 2021, 2016);
    const leaked = pickPositionTables([...turns, turn(2021, 1, 12), turn(2021, 2, 7), turn(2022, 2, 20)], 2021, 2016);
    expect(leaked).toEqual(before);
  });
});

describe("qualsDoneBaselines", () => {
  it("reproduces the real rank order through simulateRanks with zero matches, keys sorting the other way included", () => {
    // frc10 sorts before frc9 by key, but frc9 ranks first; frc100 sorts before both and ranks last.
    const rankByTeam = new Map<string, number>([
      ["frc100", 7],
      ["frc10", 2],
      ["frc9", 1],
      ["frc55", 4],
    ]);
    const baselines = qualsDoneBaselines(rankByTeam);
    let order: string[] = [];
    simulateRanks([], baselines, 1, mulberry32(1), (o) => {
      order = o.map((i) => baselines[i]!.teamKey);
    });
    expect(order).toEqual(["frc9", "frc10", "frc55", "frc100"]);
  });

  it("refuses two teams at one rank", () => {
    expect(() => qualsDoneBaselines(new Map([["frc1", 1], ["frc2", 1]]))).toThrow(DuplicateRankError);
  });
});

describe("rankOrderRatings", () => {
  it("total strictly falls as rank rises, sigma is kept", () => {
    const ratings = new Map<string, AllianceMemberRating>([
      ["frc1", { teamKey: "frc1", total: 10, sigma: 2 }],
      ["frc2", { teamKey: "frc2", total: 50, sigma: 3 }],
      ["frc3", { teamKey: "frc3", total: 30, sigma: 4 }],
    ]);
    const rankByTeam = new Map([["frc1", 1], ["frc2", 2], ["frc3", 3]]);
    const out = rankOrderRatings(ratings, rankByTeam);
    expect(out.get("frc1")).toEqual({ teamKey: "frc1", total: 3, sigma: 2 });
    expect(out.get("frc2")).toEqual({ teamKey: "frc2", total: 2, sigma: 3 });
    expect(out.get("frc3")).toEqual({ teamKey: "frc3", total: 1, sigma: 4 });
  });

  it("throws for a team missing from the rank map", () => {
    const ratings = new Map<string, AllianceMemberRating>([["frc1", { teamKey: "frc1", total: 10, sigma: 2 }]]);
    expect(() => rankOrderRatings(ratings, new Map())).toThrow(MissingRankError);
  });
});

describe("real outcomes", () => {
  const alliances = [alliance(1, ["frc1", "frc2", "frc3", "frc4"]), alliance(2, ["frc5", "frc6", "frc7"])];

  it("picks 0 to 2 are on an alliance; a backup (picks[3]) is not", () => {
    expect([...realOnAlliance(alliances)].sort()).toEqual(["frc1", "frc2", "frc3", "frc5", "frc6", "frc7"]);
  });

  it("realSlots gives each pick its alliance and slot, and no backup", () => {
    const slots = realSlots(alliances);
    expect(slots.get("frc1")).toBe(slotClass(1, 0));
    expect(slots.get("frc3")).toBe(slotClass(1, 2));
    expect(slots.get("frc7")).toBe(slotClass(2, 2));
    expect(slots.has("frc4")).toBe(false);
    expect(slotClass(8, 2)).toBe(23);
    expect(NONE_SLOT_CLASS).toBe(24);
  });
});

describe("scores", () => {
  it("brierScore on a hand computed case with a wrong 0", () => {
    expect(brierScore([0, 1, 0.5], [1, 1, 0])).toBeCloseTo((1 + 0 + 0.25) / 3, 12);
    expect(brierScore([], [])).toBeUndefined();
  });

  it("logLoss clips a wrong 0 and a wrong 1 at eps", () => {
    const expected01 = (2 * -Math.log(0.01) + -Math.log(0.5)) / 3;
    const expected001 = (2 * -Math.log(0.001) + -Math.log(0.5)) / 3;
    expect(logLoss([0, 1, 0.5], [1, 0, 1], 0.01)).toBeCloseTo(expected01, 12);
    expect(logLoss([0, 1, 0.5], [1, 0, 1], 0.001)).toBeCloseTo(expected001, 12);
    expect(expected01).toBeCloseTo(3.301163, 5);
  });

  it("accuracyAtHalf counts 0.5 as on", () => {
    expect(accuracyAtHalf([0.5, 0.49, 1, 0], [1, 1, 1, 1])).toBe(0.5);
    expect(accuracyAtHalf([0.5], [0])).toBe(0);
  });

  it("multiclassBrier and multiclassLogLoss", () => {
    expect(multiclassBrier([[1, 0, 0], [0.5, 0.5, 0]], [1, 0])).toBeCloseTo(1.25, 12);
    expect(multiclassLogLoss([[1, 0, 0], [0.5, 0.5, 0]], [1, 0], 0.01)).toBeCloseTo((-Math.log(0.01) - Math.log(0.5)) / 2, 12);
  });

  it("calibrationTable has 12 rows whose counts add to the input size", () => {
    const predictions = [0, 0, 0.05, 0.1, 0.15, 0.95, 1, 0.999999];
    const outcomes = [0, 1, 0, 0, 1, 1, 1, 0];
    const table = calibrationTable(predictions, outcomes);
    expect(table).toHaveLength(12);
    expect(table.reduce((sum, row) => sum + row.n, 0)).toBe(predictions.length);
    expect(table[0]!.label).toBe("exactly 0");
    expect(table[0]!.n).toBe(2);
    expect(table[0]!.observed).toBe(0.5);
    expect(table[1]!.n).toBe(1);
    expect(table[2]!.n).toBe(2);
    expect(table[2]!.meanPredicted).toBeCloseTo(0.125, 12);
    expect(table[2]!.observed).toBe(0.5);
    expect(table[10]!.n).toBe(2);
    expect(table[11]!.label).toBe("exactly 1");
    expect(table[11]!.n).toBe(1);
    expect(table[5]!.n).toBe(0);
    expect(table[5]!.observed).toBeUndefined();
  });

  it("winRuleVerdict needs Brier lower AND log loss lower AND accuracy not lower", () => {
    const base = { teams: 10, brier: 0.1, logLoss01: 0.5, logLoss001: 0.6, accuracy: 0.9, wrong: 1 };
    expect(winRuleVerdict({ ...base, brier: 0.09, logLoss01: 0.4 }, base).win).toBe(true);
    expect(winRuleVerdict({ ...base, brier: 0.09, logLoss01: 0.4, accuracy: 0.89 }, base).win).toBe(false);
    expect(winRuleVerdict({ ...base, brier: 0.09 }, base).win).toBe(false);
    expect(winRuleVerdict({ ...base, logLoss01: 0.4 }, base).win).toBe(false);
  });
});

describe("playoffBucketChances", () => {
  for (const tier of ["district", "dcmp"] as const) {
    it(`splits the elimination histogram into five chances at the ${tier} tier`, () => {
      const p = [1, 2, 3, 4].map((placement) => playoffPoints(2026, tier, placement));
      const histogram = new Int32Array(p[0]! + 1);
      histogram[p[0]!] = 10;
      histogram[p[1]!] = 15;
      histogram[p[2]!] = 5;
      histogram[p[3]!] = 5;
      histogram[0] = 65;
      const chances = playoffBucketChances(2026, tier, histogram, 40, 100);
      expect(chances).toHaveLength(5);
      expect(chances[0]).toBeCloseTo(0.1, 12);
      expect(chances[1]).toBeCloseTo(0.15, 12);
      expect(chances[2]).toBeCloseTo(0.1, 12);
      expect(chances[3]).toBeCloseTo(0.25, 12);
      expect(chances[4]).toBeCloseTo(0.4, 12);
      expect(chances.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    });
  }
});

describe("realPlacements", () => {
  function playedRowsFromRouting(): { rows: PlayedBracketMatch[]; placements: ReadonlyMap<number, number> } {
    const rows: PlayedBracketMatch[] = [];
    const routed = routeBracket((a, b, setId, matchNumber) => {
      const winner = Math.min(a, b);
      rows.push({
        compLevel: setId === "f" ? "f" : "sf",
        setNumber: setId === "f" ? 1 : Number.parseInt(setId.slice(2), 10),
        matchNumber,
        winningAllianceNumber: winner,
      });
      return winner;
    });
    return { rows, placements: routed.placementByAlliance };
  }

  it("played rows from a routed bracket give that routing's placements", () => {
    const { rows, placements } = playedRowsFromRouting();
    const real = realPlacements(rows);
    expect(real).toBeDefined();
    expect([...real!.entries()].sort((x, y) => x[0] - y[0])).toEqual([...placements.entries()].sort((x, y) => x[0] - y[0]));
  });

  it("a bracket missing its final yields no placement map", () => {
    const { rows } = playedRowsFromRouting();
    expect(realPlacements(rows.filter((row) => row.compLevel !== "f"))).toBeUndefined();
  });
});
