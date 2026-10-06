/**
 * `asOfState.ts`: the reducer both writers call (segments, tails, `m`, `lq`,
 * `le`, the demo pseudo team, idempotent re-folds), the readers, the order and
 * the schemas. Hand-built tuples only; the replay-driven capture is proven in
 * `asOfOracle.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { DEMO_PSEUDO_TEAM_KEY } from "../core/algorithms/demoTeams.js";
import {
  applyAsOfFold,
  AS_OF_SEASON_START_CUT,
  asOfAtOrBefore,
  AsOfFoldError,
  AsOfIndexSchema,
  AsOfLogSchema,
  AsOfSeasonSchema,
  AsOfStartSchema,
  asOfTupleKeys,
  asOfTupleParts,
  compareAsOfPositions,
  createAsOfSeason,
  createAsOfStart,
  readAsOfLeagueTuple,
  readAsOfTeamTuple,
  type AsOfFold,
  type AsOfIndex,
  type AsOfLog,
  type AsOfSeason,
  type AsOfStamp,
  type AsOfTeamTuple,
} from "./asOfState.js";

const STAMP: AsOfStamp = { generation: "g1", computedAt: "2026-10-05T00:00:00.000Z", algorithmId: "spr", algorithmVersion: "10.0.0+test" };
const VARS = ["v"];

/** A tuple whose every number is `n`, so a test can tell tuples apart by one number. */
function tuple(n: number): AsOfTeamTuple {
  return [
    [n, n, n, n],
    [n, n, n, n, n],
    [[n, n, n, n]],
  ];
}

function league(n: number): number[] {
  return Array.from({ length: 10 }, () => n);
}

/** A tiny in-memory writer: every event's INDEX and LOG, and one season object. */
class Season {
  readonly indexes = new Map<string, AsOfIndex>();
  readonly logs = new Map<string, AsOfLog>();
  readonly season: AsOfSeason = createAsOfSeason({ season: 2026, vars: VARS, L0: league(-1), stamp: STAMP });

  fold(fold: AsOfFold): void {
    const out = applyAsOfFold({ index: this.indexes.get(fold.eventKey), log: this.logs.get(fold.eventKey), season: this.season }, fold, STAMP);
    this.indexes.set(fold.eventKey, out.index);
    this.logs.set(fold.eventKey, out.log);
  }
}

function fold(eventKey: string, matchKey: string, t: number, teams: Record<string, [number, number]>, compLevel = "qm"): AsOfFold {
  return {
    eventKey,
    matchKey,
    t,
    compLevel,
    L: league(t),
    teams: Object.entries(teams).map(([teamKey, [before, after]]) => ({ teamKey, before: tuple(before), after: tuple(after) })),
  };
}

describe("applyAsOfFold — segments and tails", () => {
  it("one segment: a team's consecutive matches at one event grow one segment, with p null for its first of the season", () => {
    const s = new Season();
    s.fold(fold("2026a", "2026a_qm1", 100, { frc1: [0, 1] }));
    s.fold(fold("2026a", "2026a_qm2", 200, { frc1: [1, 2] }));
    const index = s.indexes.get("2026a")!;
    expect(index.teams.frc1).toEqual([{ f: [100, 0], l: [200, 1], p: null, s: tuple(0), x: tuple(2) }]);
    expect(index.m).toEqual([
      ["2026a_qm1", 100],
      ["2026a_qm2", 200],
    ]);
    expect(s.season.tails.frc1).toEqual(["2026a", 200, 1]);
    expect(s.logs.get("2026a")!.rows.map((row) => row.k)).toEqual(["2026a_qm1", "2026a_qm2"]);
    expect(s.logs.get("2026a")!.rows[1]!.tm).toEqual([["frc1", tuple(2)]]);
  });

  it("two segments on overlap: here, then another event, then here again opens a second segment whose p is the other event's row", () => {
    const s = new Season();
    s.fold(fold("2023oncmp1", "2023oncmp1_qm1", 100, { frc1: [0, 1] }));
    s.fold(fold("2023oncmp", "2023oncmp_f1m1", 150, { frc1: [1, 2] }, "f"));
    s.fold(fold("2023oncmp1", "2023oncmp1_qm2", 200, { frc1: [2, 3] }));
    expect(s.indexes.get("2023oncmp1")!.teams.frc1).toEqual([
      { f: [100, 0], l: [100, 0], p: null, s: tuple(0), x: tuple(1) },
      { f: [200, 1], l: [200, 1], p: ["2023oncmp", 150, 0], s: tuple(2), x: tuple(3) },
    ]);
    expect(s.indexes.get("2023oncmp")!.teams.frc1).toEqual([{ f: [150, 0], l: [150, 0], p: ["2023oncmp1", 100, 0], s: tuple(1), x: tuple(2) }]);
    expect(s.season.tails.frc1).toEqual(["2023oncmp1", 200, 1]);
  });

  it("the p chain: each event's segment points at the team's previous match, whatever event it was at", () => {
    const s = new Season();
    s.fold(fold("2026a", "2026a_qm1", 100, { frc1: [0, 1], frc2: [10, 11] }));
    s.fold(fold("2026b", "2026b_qm1", 200, { frc1: [1, 2] }));
    s.fold(fold("2026c", "2026c_qm1", 300, { frc1: [2, 3], frc2: [11, 12] }));
    expect(s.indexes.get("2026b")!.teams.frc1![0]!.p).toEqual(["2026a", 100, 0]);
    expect(s.indexes.get("2026c")!.teams.frc1![0]!.p).toEqual(["2026b", 200, 0]);
    expect(s.indexes.get("2026c")!.teams.frc2![0]!.p).toEqual(["2026a", 100, 0]);
  });

  it("lq moves on qualification matches only, le on every match", () => {
    const s = new Season();
    s.fold(fold("2026a", "2026a_qm1", 100, { frc1: [0, 1] }));
    s.fold(fold("2026a", "2026a_qm2", 200, { frc1: [1, 2] }));
    s.fold(fold("2026a", "2026a_sf1m1", 300, { frc1: [2, 3] }, "sf"));
    const index = s.indexes.get("2026a")!;
    expect(index.lq).toEqual({ k: [200, 1], L: league(200) });
    expect(index.le).toEqual({ k: [300, 2], L: league(300) });
    // An event with only playoff rows has no lq at all.
    s.fold(fold("2026cmp", "2026cmp_f1m1", 400, { frc1: [3, 4] }, "f"));
    expect(s.indexes.get("2026cmp")!.lq).toBeNull();
  });

  it("lb: the fold that creates the INDEX records the league before it, no later fold moves it, and a fold without Lb writes none", () => {
    const s = new Season();
    s.fold({ ...fold("2026a", "2026a_qm1", 100, { frc1: [0, 1] }), Lb: league(-1) });
    s.fold({ ...fold("2026a", "2026a_qm2", 200, { frc1: [1, 2] }), Lb: league(100) });
    expect(s.indexes.get("2026a")!.lb).toEqual(league(-1));
    s.fold(fold("2026b", "2026b_qm1", 300, { frc1: [2, 3] }));
    expect("lb" in s.indexes.get("2026b")!).toBe(false);
    // Backward compatible: an INDEX with and without lb both parse, and lb survives the round trip.
    expect(AsOfIndexSchema.parse(JSON.parse(JSON.stringify(s.indexes.get("2026a")))).lb).toEqual(league(-1));
    expect(AsOfIndexSchema.parse(JSON.parse(JSON.stringify(s.indexes.get("2026b")))).lb).toBeUndefined();
    expect(() => s.fold({ ...fold("2026c", "2026c_qm1", 400, { frc1: [3, 4] }), Lb: [1, 2] })).toThrow(AsOfFoldError);
  });

  it("is idempotent: re-folding a match key already in the event changes nothing", () => {
    const s = new Season();
    const first = fold("2026a", "2026a_qm1", 100, { frc1: [0, 1] });
    s.fold(first);
    s.fold(fold("2026a", "2026a_qm2", 200, { frc1: [1, 2] }));
    const snapshot = JSON.stringify({ index: s.indexes.get("2026a"), log: s.logs.get("2026a"), season: s.season });
    s.fold(first);
    s.fold({ ...first, teams: [{ teamKey: "frc9", before: tuple(7), after: tuple(8) }] });
    expect(JSON.stringify({ index: s.indexes.get("2026a"), log: s.logs.get("2026a"), season: s.season })).toBe(snapshot);
  });

  it("stamps every object with the writer's stamp and keeps an existing L0", () => {
    const s = new Season();
    const later: AsOfStamp = { ...STAMP, generation: "g2", computedAt: "2026-10-06T00:00:00.000Z" };
    applyAsOfFold({ index: undefined, log: undefined, season: s.season }, fold("2026a", "2026a_qm1", 100, { frc1: [0, 1] }), later);
    expect(s.season.generation).toBe("g2");
    expect(s.season.L0).toEqual(league(-1));
  });

  it("the INDEX wins over a tail behind it at this event: the last segment grows, so no second segment points inside the first (C1)", () => {
    // The review's failure: rows 0 to 3 indexed for frc1, then the season object's write was lost, so its tail still names row 1.
    const s = new Season();
    for (let row = 0; row < 4; row++) s.fold(fold("2026e", `2026e_qm${row + 1}`, 100 + 10 * row, { frc1: [row, row + 1] }));
    s.season.tails.frc1 = ["2026e", 110, 1];
    s.fold(fold("2026e", "2026e_qm5", 140, { frc1: [4, 5] }));
    expect(s.indexes.get("2026e")!.teams.frc1).toEqual([{ f: [100, 0], l: [140, 4], p: null, s: tuple(0), x: tuple(5) }]);
    // The fold's own tail write repairs the season object.
    expect(s.season.tails.frc1).toEqual(["2026e", 140, 4]);
  });

  it("the INDEX wins over a tail at an EARLIER event, and over a lost tail: the last segment grows (C1)", () => {
    const s = new Season();
    s.fold(fold("2026d", "2026d_qm1", 50, { frc1: [0, 1] }));
    s.fold(fold("2026e", "2026e_qm1", 100, { frc1: [1, 2] }));
    s.fold(fold("2026e", "2026e_qm2", 110, { frc1: [2, 3] }));
    // The season object lost E's ticks: the tail is back at D, before E's segment ends.
    s.season.tails.frc1 = ["2026d", 50, 0];
    s.fold(fold("2026e", "2026e_qm3", 120, { frc1: [3, 4] }));
    expect(s.indexes.get("2026e")!.teams.frc1).toEqual([{ f: [100, 0], l: [120, 2], p: ["2026d", 50, 0], s: tuple(1), x: tuple(4) }]);
    // A season object with no tail at all for the team (lost entirely) grows it too.
    delete s.season.tails.frc1;
    s.fold(fold("2026e", "2026e_qm4", 130, { frc1: [4, 5] }));
    expect(s.indexes.get("2026e")!.teams.frc1).toHaveLength(1);
    expect(s.indexes.get("2026e")!.teams.frc1![0]!.l).toEqual([130, 3]);
  });

  it("a tail at another event AFTER the last segment still opens a new one, including at an equal sort_time decided by the event key", () => {
    const s = new Season();
    s.fold(fold("2026b", "2026b_qm1", 100, { frc1: [0, 1] }));
    s.fold(fold("2026c", "2026c_qm1", 100, { frc1: [1, 2] }));
    s.fold(fold("2026b", "2026b_qm2", 200, { frc1: [2, 3] }));
    expect(s.indexes.get("2026b")!.teams.frc1).toEqual([
      { f: [100, 0], l: [100, 0], p: null, s: tuple(0), x: tuple(1) },
      { f: [200, 1], l: [200, 1], p: ["2026c", 100, 0], s: tuple(2), x: tuple(3) },
    ]);
  });

  it("refuses a league tuple of the wrong length and a fold for another event's objects", () => {
    const s = new Season();
    expect(() => s.fold({ ...fold("2026a", "2026a_qm1", 100, { frc1: [0, 1] }), L: [1, 2, 3] })).toThrow(AsOfFoldError);
    s.fold(fold("2026a", "2026a_qm1", 100, { frc1: [0, 1] }));
    expect(() =>
      applyAsOfFold({ index: s.indexes.get("2026a"), log: s.logs.get("2026a"), season: s.season }, fold("2026b", "2026b_qm1", 100, { frc1: [1, 2] }), STAMP)
    ).toThrow(AsOfFoldError);
  });
});

describe("the demo pseudo team", () => {
  it("asOfTupleKeys adds the pseudo team once when any roster key is a demo key, and never otherwise", () => {
    expect(asOfTupleKeys(["frc1", "frc2", "frc3"], ["frc4", "frc5", "frc6"])).toEqual(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]);
    expect(asOfTupleKeys(["frc9970", "frc2", "frc9971"], ["frc4", "frc5", "frc6"])).toEqual(["frc9970", "frc2", "frc9971", "frc4", "frc5", "frc6", DEMO_PSEUDO_TEAM_KEY]);
  });

  it("a raw demo key carries Sigma and RP only, the pseudo team SPR only, a real team all three", () => {
    expect(asOfTupleParts("frc9970")).toEqual({ spr: false, level2: true });
    expect(asOfTupleParts(DEMO_PSEUDO_TEAM_KEY)).toEqual({ spr: true, level2: false });
    expect(asOfTupleParts("frc254")).toEqual({ spr: true, level2: true });
    const state = {
      teams: new Map([
        ["frc254", { muL: 1, pL: 2, muS: 3, pS: 4 }],
        [DEMO_PSEUDO_TEAM_KEY, { muL: 5, pL: 6, muS: 7, pS: 8 }],
      ]),
    };
    const belief = { meanWeight: 1, mean: 2, varWeight: 3, sumSquares: 4, talent: 5 };
    const sources = {
      spr: state,
      sigma: { beliefFor: () => belief, population: () => undefined },
      rp: { beliefsFor: () => ({ v: { weight: 1, weightSquares: 1, mean: 0.5, m2: 0.1 } }), populationState: () => undefined },
      vars: VARS,
    };
    expect(readAsOfTeamTuple("frc254", sources)).toEqual([[1, 2, 3, 4], [1, 2, 3, 4, 5], [[1, 1, 0.5, 0.1]]]);
    expect(readAsOfTeamTuple(DEMO_PSEUDO_TEAM_KEY, sources)).toEqual([[5, 6, 7, 8], null, null]);
    expect(readAsOfTeamTuple("frc9970", sources)).toEqual([null, [1, 2, 3, 4, 5], [[1, 1, 0.5, 0.1]]]);
  });

  it("the pseudo team gets segments and a tail of its own, like any team", () => {
    const s = new Season();
    s.fold(fold("2026a", "2026a_qm1", 100, { frc9970: [0, 1], [DEMO_PSEUDO_TEAM_KEY]: [50, 51] }));
    s.fold(fold("2026b", "2026b_qm1", 200, { frc9971: [0, 1], [DEMO_PSEUDO_TEAM_KEY]: [51, 52] }));
    expect(s.indexes.get("2026b")!.teams[DEMO_PSEUDO_TEAM_KEY]).toEqual([{ f: [200, 0], l: [200, 0], p: ["2026a", 100, 0], s: tuple(51), x: tuple(52) }]);
    expect(s.season.tails[DEMO_PSEUDO_TEAM_KEY]).toEqual(["2026b", 200, 0]);
  });
});

describe("readAsOfLeagueTuple", () => {
  it("lays out logTau, scale, the Sigma population, then (n, mean, m2) per variable, then (count, sum) per variable", () => {
    const L = readAsOfLeagueTuple({
      spr: { logTau: 0.1, scale: 30 },
      sigma: { population: () => ({ sumSquares: 1, talentSquares: 2, count: 3 }) },
      rp: { populationState: () => ({ season: 2026, variables: { a: { n: 4, mean: 5, m2: 6 }, b: { n: 7, mean: 8, m2: 9 } } }) },
      meanShift: { toState: () => ({ season: 2026, variables: { a: { count: 10, sum: 11 }, b: { count: 12, sum: 13 } } }) },
      vars: ["a", "b"],
    });
    expect(L).toEqual([0.1, 30, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it("reads an absent population or shift as zeros", () => {
    expect(readAsOfLeagueTuple({ spr: { logTau: 0.1, scale: 30 }, sigma: undefined, rp: undefined, meanShift: undefined, vars: ["a"] })).toEqual([0.1, 30, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("order", () => {
  it("inside one event only the row index decides; across events sort_time then the event key; the season start precedes everything", () => {
    const cut = { eventKey: "2026b", t: 100, i: 3 };
    expect(asOfAtOrBefore("2026b", [999, 3], cut)).toBe(true);
    expect(asOfAtOrBefore("2026b", [0, 4], cut)).toBe(false);
    expect(asOfAtOrBefore("2026a", [100, 50], cut)).toBe(true);
    expect(asOfAtOrBefore("2026c", [100, 0], cut)).toBe(false);
    expect(asOfAtOrBefore("2026c", [99, 0], cut)).toBe(true);
    expect(asOfAtOrBefore("2026a", [101, 0], cut)).toBe(false);
    expect(asOfAtOrBefore("2026a", [0, 0], AS_OF_SEASON_START_CUT)).toBe(false);
    expect(compareAsOfPositions("2026a", [100, 9], "2026b", [100, 0])).toBeLessThan(0);
    expect(compareAsOfPositions("2026b", [5, 2], "2026b", [5, 1])).toBeGreaterThan(0);
  });
});

describe("schemas", () => {
  it("round trip: every object the reducer writes parses back to itself through JSON", () => {
    const s = new Season();
    s.fold(fold("2026a", "2026a_qm1", 100, { frc1: [0, 1], frc9970: [2, 3], [DEMO_PSEUDO_TEAM_KEY]: [4, 5] }));
    s.fold(fold("2026b", "2026b_qm1", 200, { frc1: [1, 6] }));
    const index = s.indexes.get("2026a")!;
    expect(AsOfIndexSchema.parse(JSON.parse(JSON.stringify(index)))).toEqual(index);
    expect(AsOfLogSchema.parse(JSON.parse(JSON.stringify(s.logs.get("2026a"))))).toEqual(s.logs.get("2026a"));
    expect(AsOfSeasonSchema.parse(JSON.parse(JSON.stringify(s.season)))).toEqual(s.season);
    // A Worker-created season object has no L0.
    expect(AsOfSeasonSchema.parse({ ...s.season, L0: null }).L0).toBeNull();
  });

  it("the season start object round trips, writes its keys sorted whatever order they were read in, and copies its vars", () => {
    const vars = ["v"];
    const start = createAsOfStart({
      season: 2026,
      vars,
      teams: new Map<string, AsOfTeamTuple>([
        ["frc254", [[1, 2, 3, 4], [1, 2, 3, 4, 5], null]],
        [DEMO_PSEUDO_TEAM_KEY, [[5, 6, 7, 8], null, null]],
        ["frc1", [null, [1, 2, 3, 4, 5], null]],
      ]),
      stamp: STAMP,
    });
    vars.push("mutated");
    expect(start.vars).toEqual(["v"]);
    expect(Object.keys(start.teams)).toEqual(["frc1", "frc254", DEMO_PSEUDO_TEAM_KEY].sort());
    expect(start).toMatchObject({ schemaVersion: 1, generation: STAMP.generation, algorithmId: "spr", season: 2026 });
    expect(AsOfStartSchema.parse(JSON.parse(JSON.stringify(start)))).toEqual(start);
    expect(() => AsOfStartSchema.parse({ ...start, teams: { frc1: [[Number.NaN, 0, 0, 0], null, null] } })).toThrow();
  });

  it("rejects a non-finite number and a mis-sized tuple rather than publishing them", () => {
    const s = new Season();
    s.fold(fold("2026a", "2026a_qm1", 100, { frc1: [0, 1] }));
    const log = s.logs.get("2026a")!;
    expect(() => AsOfLogSchema.parse({ ...log, rows: [{ ...log.rows[0]!, L: [Number.NaN] }] })).toThrow();
    expect(() => AsOfLogSchema.parse({ ...log, rows: [{ ...log.rows[0]!, tm: [["frc1", [[1, 2, 3], null, null]]] }] })).toThrow();
  });
});
