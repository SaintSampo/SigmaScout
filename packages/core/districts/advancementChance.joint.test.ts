/**
 * `advancementChances`' joint events (quick task 261014-qv2): every team at one
 * event reads its points from the SAME drawn run of that event, events draw
 * their runs independently, and everything else is today's draw.
 *
 * Six jobs: inertness (no referenced event is the shipped run byte for byte),
 * the joint read itself, independence between events, conservation inside an
 * event (priced by the real simulation, with alliance selection the only
 * category left to vary), the lock guarantees, determinism, and the refusals.
 */
import { describe, expect, it } from "vitest";
import {
  advancementChances,
  AdvancementChanceInputError,
  type AdvancementChanceInputs,
  type AdvancementChanceJointEvent,
  type AdvancementChanceObservation,
  type AdvancementChanceTeam,
} from "./advancementChance.js";
import { computeLocksWithQualifiers } from "./locks.js";
import type { SimTeamBaseline } from "../algorithms/simulation/rankSimulation.js";
import type { AllianceMemberRating } from "../algorithms/simulation/allianceWinProbability.js";
import { draftedAllianceCount, simulateDistrictEvent, type DistrictAwardProfile } from "./ledgerSimulation.js";
import { pickPositionPmfForSeason } from "./pickDraft.js";
import { districtQualPoints } from "./qualPoints.js";
import { districtSelectionPoints } from "./selectionPoints.js";

const SEED = 20261014;

function mass(teamKey: string, value: number, jointEventKeys?: readonly string[]): AdvancementChanceTeam {
  const counts = new Float64Array(value + 1);
  counts[value] = 1;
  return { teamKey, counts, denominator: 1, ...(jointEventKeys === undefined ? {} : { jointEventKeys }) };
}

function uniform(teamKey: string, lo: number, hi: number, jointEventKeys?: readonly string[]): AdvancementChanceTeam {
  const counts = new Float64Array(hi + 1);
  for (let value = lo; value <= hi; value++) counts[value] = 1 / (hi - lo + 1);
  return { teamKey, counts, denominator: 1, ...(jointEventKeys === undefined ? {} : { jointEventKeys }) };
}

function inputsOf(teams: readonly AdvancementChanceTeam[], slots: number, overrides: Partial<AdvancementChanceInputs> = {}): AdvancementChanceInputs {
  return { teams, slots, awardQualified: [], prequalified: [], reservedSlots: 0, ...overrides };
}

/** A joint event from per run columns: `columns[j][run]` is team `j`'s total in run `run`. */
function jointEvent(eventKey: string, teamKeys: readonly string[], columns: readonly (readonly number[])[]): AdvancementChanceJointEvent {
  const runs = columns[0]!.length;
  const totals = new Uint8Array(runs * teamKeys.length);
  for (let run = 0; run < runs; run++) for (let j = 0; j < teamKeys.length; j++) totals[run * teamKeys.length + j] = columns[j]![run]!;
  return { eventKey, teamKeys, runs, totals };
}

/** A random but fixed per run table, deterministic in `salt`. */
function columnsOf(teamCount: number, runs: number, salt: number, spread = 40): number[][] {
  const out: number[][] = [];
  let state = salt;
  for (let j = 0; j < teamCount; j++) {
    const column: number[] = [];
    for (let run = 0; run < runs; run++) {
      state = (state * 1103515245 + 12345) % 2147483648;
      column.push(state % spread);
    }
    out.push(column);
  }
  return out;
}

const KEYS = ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"];

describe("advancementChances: joint events, inertness", () => {
  const teams = [uniform("frc1", 0, 30), uniform("frc2", 5, 25), uniform("frc3", 10, 40), uniform("frc4", 0, 12)];

  it("absent, empty, or named by no pool team gives a byte identical result", () => {
    const shipped = advancementChances(inputsOf(teams, 2), 600, SEED);
    const empty = advancementChances(inputsOf(teams, 2, { jointEvents: [] }), 600, SEED);
    const unreferenced = advancementChances(
      inputsOf(teams, 2, { jointEvents: [jointEvent("2026x", ["frc1", "frc2"], columnsOf(2, 50, 7))] }),
      600,
      SEED
    );
    // A team that names the event but sits outside the pool (an award
    // qualifier) references nothing either.
    const awardQualifiedNames = advancementChances(
      inputsOf([...teams.slice(0, 3), uniform("frc4", 0, 12, ["2026x"])], 2, {
        jointEvents: [jointEvent("2026x", ["frc1", "frc4"], columnsOf(2, 50, 7))],
        awardQualified: ["frc4"],
      }),
      600,
      SEED
    );
    const shippedWithoutFour = advancementChances(inputsOf(teams, 2, { awardQualified: ["frc4"] }), 600, SEED);
    for (const result of [empty, unreferenced]) {
      expect(result.chanceByTeam).toEqual(shipped.chanceByTeam);
      expect(result.cutoffByRun).toEqual(shipped.cutoffByRun);
    }
    expect(awardQualifiedNames.chanceByTeam).toEqual(shippedWithoutFour.chanceByTeam);
    expect(awardQualifiedNames.cutoffByRun).toEqual(shippedWithoutFour.cutoffByRun);
  });
});

describe("advancementChances: joint events, the read", () => {
  it("every team at an event reads its column at the ONE index drawn for that event this run", () => {
    const columns = columnsOf(KEYS.length, 80, 11);
    const event = jointEvent("2026a", KEYS, columns);
    const teams = KEYS.map((key, j) => uniform(key, 0, j + 3, ["2026a"]));
    let runs = 0;
    advancementChances(inputsOf(teams, 3, { jointEvents: [event] }), 500, SEED, (o: AdvancementChanceObservation) => {
      runs += 1;
      const index = o.eventIndices[0]!;
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(80);
      o.poolKeys.forEach((key, i) => {
        const column = KEYS.indexOf(key);
        expect(o.jointPoints[i]).toBe(event.totals[index * KEYS.length + column]);
        expect(o.totals[i]! - o.jointPoints[i]!).toBeGreaterThanOrEqual(0);
        expect(o.totals[i]! - o.jointPoints[i]!).toBeLessThanOrEqual(column + 3);
      });
    });
    expect(runs).toBe(500);
  });

  it("an unreferenced event reports index -1", () => {
    const teams = [uniform("frc1", 0, 9, ["2026a"]), uniform("frc2", 0, 9)];
    const events = [jointEvent("2026b", ["frc2"], [[1, 2, 3]]), jointEvent("2026a", ["frc1"], [[4, 5]])];
    advancementChances(inputsOf(teams, 1, { jointEvents: events }), 50, SEED, (o) => {
      expect(o.eventIndices[0]).toBe(-1);
      expect(o.eventIndices[1]).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("advancementChances: joint events, independence between events", () => {
  it("one team at two events whose columns are both [0, 10] reads 10 in between 35% and 65% of runs", () => {
    const team = mass("frc1", 0, ["2026a", "2026b"]);
    const events = [jointEvent("2026a", ["frc1"], [[0, 10]]), jointEvent("2026b", ["frc1"], [[0, 10]])];
    const draws = 2000;
    const result = advancementChances(inputsOf([team], 1, { jointEvents: events }), draws, SEED);
    const line = result.cutoffByRun!;
    let tens = 0;
    for (const value of line) {
      expect([0, 10, 20]).toContain(value);
      if (value === 10) tens += 1;
    }
    expect(tens / draws).toBeGreaterThan(0.35);
    expect(tens / draws).toBeLessThan(0.65);
  });
});

// ---------------------------------------------------------------------------
// Conservation, priced by the real simulation
// ---------------------------------------------------------------------------

const SEASON = 2026;
const TEAM_COUNT = 30;

function teamKey(n: number): string {
  return `frc${100 + n}`;
}

describe("advancementChances: joint events, conservation inside an event", () => {
  it("every run hands out exactly the fixed qualification points, the draft payout and the known elim and award points", () => {
    const baselines: SimTeamBaseline[] = [];
    const ratings = new Map<string, AllianceMemberRating>();
    const awardProfiles = new Map<string, DistrictAwardProfile>();
    const knownElimPoints = new Map<string, number>();
    const knownAwardPoints = new Map<string, number>();
    for (let i = 1; i <= TEAM_COUNT; i++) {
      baselines.push({ teamKey: teamKey(i), earnedRpSum: (TEAM_COUNT + 1 - i) * 10, matchesPlayed: 10 });
      ratings.set(teamKey(i), { teamKey: teamKey(i), total: ((i * 7) % TEAM_COUNT) + 1, sigma: 3 });
      awardProfiles.set(teamKey(i), { bucket: "none", rookieState: "veteran" });
      knownElimPoints.set(teamKey(i), (i % 4) * 5);
      knownAwardPoints.set(teamKey(i), i % 7 === 0 ? 5 : 0);
    }
    const pickPositionPmf = pickPositionPmfForSeason(SEASON)!;
    const result = simulateDistrictEvent(
      {
        eventKey: "2026cons",
        season: SEASON,
        tier: "district",
        fieldSize: TEAM_COUNT,
        allianceCount: 8,
        remainingMatches: [],
        baselines,
        ratings,
        awardProfiles,
        knownElimPoints,
        knownAwardPoints,
        pickPositionPmf,
        recordEventTotalByRun: true,
      },
      400,
      5
    );
    const record = result.eventTotalByRun!;

    let expected = 0;
    for (let rank = 1; rank <= TEAM_COUNT; rank++) expected += districtQualPoints(SEASON, "district", rank, TEAM_COUNT);
    const drafted = draftedAllianceCount(TEAM_COUNT, 8);
    for (let alliance = 1; alliance <= drafted; alliance++) {
      for (const slot of [0, 1, 2]) expected += districtSelectionPoints(SEASON, "district", slot, alliance);
    }
    for (const value of knownElimPoints.values()) expected += value;
    for (const value of knownAwardPoints.values()) expected += value;

    const teams = record.teamKeys.map((key) => mass(key, 0, ["2026cons"]));
    const seenByTeam = record.teamKeys.map(() => new Set<number>());
    advancementChances(
      inputsOf(teams, 10, { jointEvents: [{ eventKey: "2026cons", teamKeys: record.teamKeys, runs: record.runs, totals: record.totals }] }),
      1000,
      SEED,
      (o) => {
        let sum = 0;
        for (let i = 0; i < o.jointPoints.length; i++) {
          sum += o.jointPoints[i]!;
          seenByTeam[i]!.add(o.jointPoints[i]!);
        }
        expect(sum).toBe(expected);
      }
    );
    expect(seenByTeam.some((seen) => seen.size >= 2)).toBe(true);
  });
});

describe("advancementChances: joint events, the lock guarantees", () => {
  it("a ceiling locked team reads 1 and an eliminated team reads 0", () => {
    const keys = ["frc1", "frc2", "frc3", "frc4"];
    const event = jointEvent("2026g", keys, [
      [50, 55, 60, 52],
      [0, 10, 4, 8],
      [3, 9, 0, 10],
      [0, 1, 2, 3],
    ]);
    const teams = [
      mass("frc1", 0, ["2026g"]),
      mass("frc2", 0, ["2026g"]),
      mass("frc3", 0, ["2026g"]),
      mass("frc4", 0, ["2026g"]),
    ];
    const verdicts = computeLocksWithQualifiers(
      [
        { teamKey: "frc1", pointTotal: 50, maxRemaining: 10 },
        { teamKey: "frc2", pointTotal: 0, maxRemaining: 10 },
        { teamKey: "frc3", pointTotal: 0, maxRemaining: 10 },
        { teamKey: "frc4", pointTotal: 0, maxRemaining: 3 },
      ],
      2,
      { awardQualified: new Set(), prequalified: new Set() }
    );
    expect(verdicts.find((v) => v.teamKey === "frc1")!.status).toBe("locked");
    const result = advancementChances(inputsOf(teams, 2, { jointEvents: [event] }), 500, SEED);
    expect(result.chanceByTeam.get("frc1")).toBe(1);
    // frc4 is eliminated only once a rival's floor clears its ceiling; give it a
    // sure rival by a second slot fixture.
    const elimEvent = jointEvent("2026e", ["frc1", "frc2", "frc4"], [
      [50, 55],
      [40, 45],
      [0, 3],
    ]);
    const elimTeams = [mass("frc1", 0, ["2026e"]), mass("frc2", 0, ["2026e"]), mass("frc4", 0, ["2026e"])];
    const elimVerdicts = computeLocksWithQualifiers(
      [
        { teamKey: "frc1", pointTotal: 50, maxRemaining: 5 },
        { teamKey: "frc2", pointTotal: 40, maxRemaining: 5 },
        { teamKey: "frc4", pointTotal: 0, maxRemaining: 3 },
      ],
      2,
      { awardQualified: new Set(), prequalified: new Set() }
    );
    expect(elimVerdicts.find((v) => v.teamKey === "frc4")!.status).toBe("eliminated");
    const elimResult = advancementChances(inputsOf(elimTeams, 2, { jointEvents: [elimEvent] }), 500, SEED);
    expect(elimResult.chanceByTeam.get("frc4")).toBe(0);
  });
});

describe("advancementChances: joint events, determinism", () => {
  it("same inputs and seed give identical numbers; another seed moves the line", () => {
    const event = jointEvent("2026d", KEYS, columnsOf(KEYS.length, 120, 3));
    const teams = KEYS.map((key, j) => uniform(key, 0, 2 * j + 1, ["2026d"]));
    const inputs = inputsOf(teams, 2, { jointEvents: [event] });
    const a = advancementChances(inputs, 400, SEED);
    const b = advancementChances(inputs, 400, SEED);
    const c = advancementChances(inputs, 400, SEED + 1);
    expect(b.chanceByTeam).toEqual(a.chanceByTeam);
    expect(b.cutoffByRun).toEqual(a.cutoffByRun);
    expect(c.cutoffByRun).not.toEqual(a.cutoffByRun);
  });
});

describe("advancementChances: joint events, refusals", () => {
  const event = jointEvent("2026r", ["frc1", "frc2"], [
    [1, 2],
    [3, 4],
  ]);
  const refuse = (inputs: AdvancementChanceInputs): void => {
    expect(() => advancementChances(inputs, 10, SEED)).toThrow(AdvancementChanceInputError);
  };

  it("refuses an unknown event, an event that omits the team, and an event named twice", () => {
    refuse(inputsOf([mass("frc1", 0, ["2026zz"])], 1, { jointEvents: [event] }));
    refuse(inputsOf([mass("frc3", 0, ["2026r"])], 1, { jointEvents: [event] }));
    refuse(inputsOf([mass("frc1", 0, ["2026r", "2026r"])], 1, { jointEvents: [event] }));
  });

  it("refuses a repeated event key, a repeated team inside an event, bad runs and a totals length mismatch", () => {
    refuse(inputsOf([mass("frc1", 0, ["2026r"])], 1, { jointEvents: [event, event] }));
    refuse(inputsOf([mass("frc1", 0)], 1, { jointEvents: [{ ...event, teamKeys: ["frc1", "frc1"] }] }));
    for (const runs of [0, -1, 1.5, Number.NaN]) {
      refuse(inputsOf([mass("frc1", 0)], 1, { jointEvents: [{ ...event, runs }] }));
    }
    refuse(inputsOf([mass("frc1", 0)], 1, { jointEvents: [{ ...event, totals: new Uint8Array(3) }] }));
  });

  it("refuses any joint event or jointEventKeys in champ mode", () => {
    const dcmp = { counts: [1], denominator: 1, fieldChance: 1, winChance: 0 };
    refuse(inputsOf([{ ...mass("frc1", 0), dcmp }], 1, { jointEvents: [event] }));
    refuse(inputsOf([{ ...mass("frc1", 0), dcmp }, mass("frc2", 0, [])], 1));
    refuse(inputsOf([mass("frc1", 0, ["2026r"])], 1, {
      jointEvents: [event],
      awardDraws: [{ awardType: 0, countWeights: [1], candidates: [], pendingEvents: [] }],
    }));
  });
});
