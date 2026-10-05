/**
 * `asOfLookup.ts` `resolveAsOf`: every branch of the walk, the missing lists,
 * the league, the demo pseudo team, ties at equal sort_time across events, and
 * the season start object (Part 1b). The last describe folds a seeded random
 * season (overlapping events, shared sort_times, demo robots) through the real
 * reducer and checks EVERY cut against a brute force answer, and against the
 * same season truncated at that cut.
 */
import { describe, expect, it } from "vitest";
import { DEMO_PSEUDO_TEAM_KEY, isDemoTeamKey } from "../core/algorithms/demoTeams.js";
import {
  applyAsOfFold,
  AS_OF_SEASON_START_CUT,
  asOfTupleKeys,
  createAsOfSeason,
  createAsOfStart,
  UNSEEN_AS_OF_TUPLE,
  type AsOfCut,
  type AsOfFold,
  type AsOfIndex,
  type AsOfLog,
  type AsOfSeason,
  type AsOfStamp,
  type AsOfStart,
  type AsOfTeamTuple,
} from "./asOfState.js";
import { asOfCutAtMatch, asOfCutBeforeMatch, AsOfResolveError, asOfResultIsStale, resolveAsOf, type AsOfResolveInput, type AsOfResolveTeam } from "./asOfLookup.js";

const STAMP: AsOfStamp = { generation: "g1", computedAt: "2026-10-05T00:00:00.000Z", algorithmId: "spr", algorithmVersion: "10.0.0+test" };

function tuple(n: number): AsOfTeamTuple {
  return [[n, 0, 0, 0], null, null];
}

function league(n: number): number[] {
  return [n, n, n, n, n];
}

class Season {
  readonly indexes = new Map<string, AsOfIndex>();
  readonly logs = new Map<string, AsOfLog>();
  readonly season: AsOfSeason = createAsOfSeason({ season: 2026, vars: [], L0: league(-1), stamp: STAMP });
  /** The season start tuples; each test sets the ones it needs. */
  start: AsOfStart = createAsOfStart({ season: 2026, vars: [], teams: new Map(), stamp: STAMP });
  /** The league the last fold left: what the next fold hands the reducer as `Lb`. */
  lastL: number[] = league(-1);

  fold(eventKey: string, matchKey: string, t: number, teams: Record<string, [number, number]>, compLevel = "qm"): void {
    const f: AsOfFold = {
      eventKey,
      matchKey,
      t,
      compLevel,
      L: league(t),
      Lb: this.lastL,
      teams: Object.entries(teams).map(([teamKey, [before, after]]) => ({ teamKey, before: tuple(before), after: tuple(after) })),
    };
    this.lastL = league(t);
    const out = applyAsOfFold({ index: this.indexes.get(eventKey), log: this.logs.get(eventKey), season: this.season }, f, STAMP);
    this.indexes.set(eventKey, out.index);
    this.logs.set(eventKey, out.log);
  }

  /** Everything published, so no call reports anything missing. */
  input(cut: AsOfCut, teams: readonly AsOfResolveTeam[]): AsOfResolveInput {
    return { cut, teams, season: this.season, indexes: this.indexes, logs: this.logs, start: this.start };
  }

  cut(eventKey: string, matchKey: string): AsOfCut {
    return asOfCutAtMatch(this.indexes.get(eventKey)!, matchKey)!;
  }
}

/**
 * frc1: 2026a rows 0-1, then 2026b row 0, then 2026c rows 0-1.
 * frc2: 2026a row 0 only. frc3: 2026c row 1 only.
 * Season start: frc1, frc2 and frc3 at their pre-season tuples, plus frc50,
 * carried into the season and never playing.
 */
function threeEvents(): Season {
  const s = new Season();
  s.start = createAsOfStart({
    season: 2026,
    vars: [],
    teams: new Map([
      ["frc1", tuple(0)],
      ["frc2", tuple(20)],
      ["frc3", tuple(30)],
      ["frc50", tuple(50)],
    ]),
    stamp: STAMP,
  });
  s.fold("2026a", "2026a_qm1", 100, { frc1: [0, 1], frc2: [20, 21] });
  s.fold("2026a", "2026a_qm2", 110, { frc1: [1, 2] });
  s.fold("2026b", "2026b_qm1", 200, { frc1: [2, 3] });
  s.fold("2026c", "2026c_qm1", 300, { frc1: [3, 4] });
  s.fold("2026c", "2026c_qm2", 310, { frc1: [4, 5], frc3: [30, 31] });
  return s;
}

describe("resolveAsOf — the walk", () => {
  it("x: the segment began and ended at or before the cut", () => {
    const s = threeEvents();
    const r = resolveAsOf(s.input(s.cut("2026b", "2026b_qm1"), [{ teamKey: "frc1", knownEventKeys: ["2026a"] }]));
    // No known segment begins after the cut, so the walk starts from the tail (2026c) and hops back to 2026b.
    expect(r.states.get("frc1")).toEqual(tuple(3));
  });

  it("log: the cut falls inside the segment, so the team's last LOG row at or before it answers", () => {
    const s = threeEvents();
    const r = resolveAsOf(s.input(s.cut("2026a", "2026a_qm1"), [{ teamKey: "frc1", knownEventKeys: ["2026a"] }]));
    expect(r.states.get("frc1")).toEqual(tuple(1));
  });

  it("s with p null: the team's first segment of the season begins after the cut", () => {
    const s = threeEvents();
    const r = resolveAsOf(s.input(AS_OF_SEASON_START_CUT, [{ teamKey: "frc1", knownEventKeys: ["2026c"] }]));
    expect(r.states.get("frc1")).toEqual(tuple(0));
    // Season start with a known first event: no hop beyond the p chain is needed.
    expect(resolveAsOf(s.input(AS_OF_SEASON_START_CUT, [{ teamKey: "frc3", knownEventKeys: ["2026c"] }])).states.get("frc3")).toEqual(tuple(30));
  });

  it("s with p at or before the cut: the segment after the cut opens with the state the cut left", () => {
    const s = threeEvents();
    const r = resolveAsOf(s.input(s.cut("2026b", "2026b_qm1"), [{ teamKey: "frc1", knownEventKeys: ["2026c"] }]));
    expect(r.states.get("frc1")).toEqual(tuple(3));
  });

  it("hop: p is after the cut too, so the walk continues at p's event", () => {
    const s = threeEvents();
    const r = resolveAsOf(s.input(s.cut("2026a", "2026a_qm2"), [{ teamKey: "frc1", knownEventKeys: ["2026c"] }]));
    expect(r.states.get("frc1")).toEqual(tuple(2));
  });

  it("tail: with no known event at all the walk starts from the team's season tail", () => {
    const s = threeEvents();
    expect(resolveAsOf(s.input(s.cut("2026a", "2026a_qm2"), [{ teamKey: "frc2", knownEventKeys: [] }])).states.get("frc2")).toEqual(tuple(21));
    expect(resolveAsOf(s.input(AS_OF_SEASON_START_CUT, [{ teamKey: "frc2", knownEventKeys: [] }])).states.get("frc2")).toEqual(tuple(20));
  });

  it("unseen: a team with no tail anywhere and no season start tuple is all nulls", () => {
    const s = threeEvents();
    expect(resolveAsOf(s.input(s.cut("2026c", "2026c_qm2"), [{ teamKey: "frc9999", knownEventKeys: ["2026a"] }])).states.get("frc9999")).toEqual(UNSEEN_AS_OF_TUPLE);
  });

  it("start: a team with no tail anywhere reads its season start tuple, at every cut", () => {
    const s = threeEvents();
    for (const cut of [AS_OF_SEASON_START_CUT, s.cut("2026a", "2026a_qm1"), s.cut("2026c", "2026c_qm2")]) {
      expect(resolveAsOf(s.input(cut, [{ teamKey: "frc50", knownEventKeys: ["2026a"] }])).states.get("frc50")).toEqual(tuple(50));
    }
  });
});

describe("resolveAsOf — the season start object (Part 1b)", () => {
  it("a team whose first match is after the cut reads the same tuple from the full season (its first segment's s) and from the season truncated at the cut (start)", () => {
    const full = threeEvents();
    // The same season truncated right after 2026a_qm1: frc3 has played nowhere yet, and 2026c does not exist.
    const truncated = new Season();
    truncated.start = full.start;
    truncated.fold("2026a", "2026a_qm1", 100, { frc1: [0, 1], frc2: [20, 21] });
    const cut = truncated.cut("2026a", "2026a_qm1");
    const teams = ["frc1", "frc2", "frc3", "frc50", "frc9999"].map((teamKey) => ({ teamKey, knownEventKeys: [] }));
    const fromFull = resolveAsOf(full.input(cut, teams));
    const fromTruncated = resolveAsOf(truncated.input(cut, teams));
    for (const { teamKey } of teams) expect(fromTruncated.states.get(teamKey), teamKey).toEqual(fromFull.states.get(teamKey));
    expect(fromTruncated.states.get("frc3")).toEqual(tuple(30));
    expect(fromTruncated.states.get("frc9999")).toEqual(UNSEEN_AS_OF_TUPLE);
  });

  it("start undefined: missingStart only when a requested team needs it, and that team stays unresolved until it arrives", () => {
    const s = threeEvents();
    const cut = s.cut("2026a", "2026a_qm1");
    const notNeeded = resolveAsOf({ ...s.input(cut, [{ teamKey: "frc1", knownEventKeys: ["2026a"] }]), start: undefined });
    expect(notNeeded.missingStart).toBe(false);
    expect(notNeeded.states.get("frc1")).toEqual(tuple(1));

    const needed = resolveAsOf({ ...s.input(cut, [{ teamKey: "frc1", knownEventKeys: ["2026a"] }, { teamKey: "frc50", knownEventKeys: [] }]), start: undefined });
    expect(needed.missingStart).toBe(true);
    expect(needed.states.get("frc1")).toEqual(tuple(1));
    expect(needed.states.has("frc50")).toBe(false);
    expect(needed.missingIndexes).toEqual([]);
    expect(needed.missingLogs).toEqual([]);

    expect(resolveAsOf(s.input(cut, [{ teamKey: "frc50", knownEventKeys: [] }])).missingStart).toBe(false);
  });

  it("start null (not published) throws only when a walk needs it; a start object of another season throws", () => {
    const s = threeEvents();
    const cut = s.cut("2026a", "2026a_qm1");
    expect(resolveAsOf({ ...s.input(cut, [{ teamKey: "frc1", knownEventKeys: [] }]), start: null }).states.get("frc1")).toEqual(tuple(1));
    expect(() => resolveAsOf({ ...s.input(cut, [{ teamKey: "frc50", knownEventKeys: [] }]), start: null })).toThrow(AsOfResolveError);
    expect(() => resolveAsOf({ ...s.input(cut, []), start: { ...s.start, season: 2025 } })).toThrow(AsOfResolveError);
  });
});

describe("resolveAsOf — the missing lists", () => {
  it("reports every INDEX and LOG it needs, resolves nothing it cannot, and finishes once they arrive", () => {
    const s = threeEvents();
    const cut = s.cut("2026a", "2026a_qm1");
    const teams = [{ teamKey: "frc1", knownEventKeys: ["2026c"] }];
    const indexes = new Map<string, AsOfIndex | null>();
    const logs = new Map<string, AsOfLog | null>();
    const rounds: { missingIndexes: string[]; missingLogs: string[] }[] = [];
    for (let round = 0; round < 10; round++) {
      const r = resolveAsOf({ cut, teams, season: s.season, indexes, logs, start: s.start });
      rounds.push({ missingIndexes: r.missingIndexes, missingLogs: r.missingLogs });
      if (r.missingIndexes.length === 0 && r.missingLogs.length === 0) {
        expect(r.states.get("frc1")).toEqual(tuple(1));
        expect(r.league).toEqual(league(100));
        break;
      }
      expect(r.states.has("frc1")).toBe(false);
      for (const key of r.missingIndexes) indexes.set(key, s.indexes.get(key)!);
      for (const key of r.missingLogs) logs.set(key, s.logs.get(key)!);
    }
    // The known event, then the hop to 2026b, then the hop to 2026a with the cut's log.
    expect(rounds).toEqual([
      { missingIndexes: ["2026a", "2026c"], missingLogs: [] },
      { missingIndexes: ["2026b"], missingLogs: ["2026a"] },
      { missingIndexes: [], missingLogs: [] },
    ]);
  });

  it("a known event published as null contributes no segment; a hop INTO an unpublished object throws", () => {
    const s = threeEvents();
    const indexes = new Map<string, AsOfIndex | null>(s.indexes);
    indexes.set("2026zzz", null);
    const r = resolveAsOf({ cut: AS_OF_SEASON_START_CUT, teams: [{ teamKey: "frc1", knownEventKeys: ["2026zzz", "2026a"] }], season: s.season, indexes, logs: s.logs, start: s.start });
    expect(r.states.get("frc1")).toEqual(tuple(0));
    indexes.set("2026b", null);
    expect(() =>
      resolveAsOf({ cut: s.cut("2026a", "2026a_qm1"), teams: [{ teamKey: "frc1", knownEventKeys: ["2026c"] }], season: s.season, indexes, logs: s.logs, start: s.start })
    ).toThrow(AsOfResolveError);
  });
});

describe("resolveAsOf — the league", () => {
  it("L0 at the season start; lq/le straight from the INDEX when the cut is that key; the LOG row otherwise", () => {
    const s = threeEvents();
    expect(resolveAsOf(s.input(AS_OF_SEASON_START_CUT, [])).league).toEqual(league(-1));
    // 2026a_qm2 is both lq and le of 2026a: no LOG is needed.
    const noLogs = resolveAsOf({ cut: s.cut("2026a", "2026a_qm2"), teams: [], season: s.season, indexes: s.indexes, logs: new Map(), start: s.start });
    expect(noLogs.league).toEqual(league(110));
    expect(noLogs.missingLogs).toEqual([]);
    // 2026a_qm1 is neither: its LOG is needed.
    const needsLog = resolveAsOf({ cut: s.cut("2026a", "2026a_qm1"), teams: [], season: s.season, indexes: s.indexes, logs: new Map(), start: s.start });
    expect(needsLog.league).toBeUndefined();
    expect(needsLog.missingLogs).toEqual(["2026a"]);
    expect(resolveAsOf(s.input(s.cut("2026a", "2026a_qm1"), [])).league).toEqual(league(100));
  });

  it("a cut just before an event's first row reads the INDEX's lb; without lb it throws", () => {
    const s = threeEvents();
    const cut = asOfCutBeforeMatch(s.indexes.get("2026b")!, "2026b_qm1")!;
    expect(cut).toEqual({ eventKey: "2026b", t: 200, i: -1 });
    // lb is the league the season held just before 2026b's first row: after 2026a_qm2.
    expect(s.indexes.get("2026b")!.lb).toEqual(league(110));
    const r = resolveAsOf(s.input(cut, [{ teamKey: "frc1", knownEventKeys: ["2026b"] }]));
    expect(r.league).toEqual(league(110));
    expect(r.missingLogs).toEqual([]);
    expect(r.states.get("frc1")).toEqual(tuple(2));
    const { lb: _lb, ...withoutLb } = s.indexes.get("2026b")!;
    const indexes = new Map(s.indexes).set("2026b", withoutLb);
    expect(() => resolveAsOf({ ...s.input(cut, []), indexes })).toThrow(AsOfResolveError);
  });

  it("asOfCutBeforeMatch: the row before in the event's own fold order, i -1 for its first row, undefined when not folded", () => {
    const s = threeEvents();
    expect(asOfCutBeforeMatch(s.indexes.get("2026c")!, "2026c_qm2")).toEqual({ eventKey: "2026c", t: 300, i: 0 });
    expect(asOfCutBeforeMatch(s.indexes.get("2026c")!, "2026c_qm1")).toEqual({ eventKey: "2026c", t: 300, i: -1 });
    expect(asOfCutBeforeMatch(s.indexes.get("2026c")!, "2026c_qm9")).toBeUndefined();
  });

  it("a Worker-created season object (L0 null) has no season start league", () => {
    const s = threeEvents();
    expect(resolveAsOf({ ...s.input(AS_OF_SEASON_START_CUT, []), season: { ...s.season, L0: null } }).league).toBeUndefined();
  });
});

describe("resolveAsOf — objects a live write left behind a lost season object (C1)", () => {
  it("a fold after the season object's write was lost grows the team's segment, so every cut inside it reads the true row and none throws", () => {
    const s = new Season();
    for (let row = 0; row < 4; row++) s.fold("2026e", `2026e_qm${row + 1}`, 100 + 10 * row, { frc1: [row, row + 1] });
    // Tick N wrote the LOG and the INDEX and lost the season object: frc1's tail still names row 1.
    s.season.tails.frc1 = ["2026e", 110, 1];
    s.fold("2026e", "2026e_qm5", 140, { frc1: [4, 5] });
    for (let row = 0; row < 5; row++) {
      const r = resolveAsOf(s.input(s.cut("2026e", `2026e_qm${row + 1}`), [{ teamKey: "frc1", knownEventKeys: ["2026e"] }]));
      expect(r.states.get("frc1"), `cut at row ${row}`).toEqual(tuple(row + 1));
    }
  });
});

/** A JSON copy, so a test can hand the resolver an object of another age without touching the live one. */
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("resolveAsOf — a straddling segment answers from its own LOG (R2)", () => {
  it("a cut inside a known segment reads that event's LOG with no other event's object and no tail walk", () => {
    const s = threeEvents();
    const cut = s.cut("2026a", "2026a_qm1");
    // Only 2026a's objects are in hand: the old walk went to the tail (2026c), then back through 2026b.
    const r = resolveAsOf({ cut, teams: [{ teamKey: "frc1", knownEventKeys: ["2026a"] }], season: s.season, indexes: new Map([["2026a", s.indexes.get("2026a")!]]), logs: new Map([["2026a", s.logs.get("2026a")!]]), start: s.start });
    expect(r.states.get("frc1")).toEqual(tuple(1));
    expect(r.missingIndexes).toEqual([]);
    expect(r.missingLogs).toEqual([]);
  });

  it("a straddling segment answers even while another known event's INDEX is still missing", () => {
    const s = threeEvents();
    const r = resolveAsOf({ cut: s.cut("2026c", "2026c_qm1"), teams: [{ teamKey: "frc1", knownEventKeys: ["2026zz", "2026c"] }], season: s.season, indexes: new Map([["2026c", s.indexes.get("2026c")!]]), logs: s.logs, start: s.start });
    expect(r.states.get("frc1")).toEqual(tuple(4));
  });
});

describe("resolveAsOf — an INDEX ahead of the season object wins (R1)", () => {
  it("a season copy whose tail is behind an INDEX in hand: the walk starts from the INDEX's segment, not the tail", () => {
    const s = threeEvents();
    // The season copy predates 2026c: frc1's tail still names 2026b.
    const olderSeason = { ...copy(s.season), tails: { ...copy(s.season.tails), frc1: ["2026b", 200, 0] as [string, number, number] } };
    const r = resolveAsOf({ ...s.input(s.cut("2026c", "2026c_qm1"), [{ teamKey: "frc1", knownEventKeys: [] }]), season: olderSeason });
    expect(r.states.get("frc1")).toEqual(tuple(4));
    expect(r.staleIndexes).toEqual([]);
    // A season copy with no tail at all for a team an INDEX in hand holds.
    const noTail = { ...copy(s.season), tails: {} };
    expect(resolveAsOf({ ...s.input(s.cut("2026c", "2026c_qm2"), [{ teamKey: "frc3", knownEventKeys: [] }]), season: noTail }).states.get("frc3")).toEqual(tuple(31));
  });

  it("a tail naming a row inside a longer segment of a newer INDEX copy reads that segment", () => {
    const s = new Season();
    s.fold("2026a", "2026a_qm1", 100, { frc1: [0, 1] });
    s.fold("2026a", "2026a_qm2", 110, { frc1: [1, 2] });
    s.fold("2026a", "2026a_qm3", 120, { frc1: [2, 3] });
    const olderSeason = { ...copy(s.season), tails: { frc1: ["2026a", 100, 0] as [string, number, number] } };
    // The tail names row 0; the INDEX's segment for frc1 now runs to row 2, and is in hand only under another key's walk.
    const r = resolveAsOf({ cut: s.cut("2026a", "2026a_qm3"), teams: [{ teamKey: "frc1", knownEventKeys: [] }], season: olderSeason, indexes: s.indexes, logs: s.logs, start: s.start });
    expect(r.states.get("frc1")).toEqual(tuple(3));
  });
});

describe("resolveAsOf — objects of different ages are reported, never answered from (C4)", () => {
  it("a tail naming a row the INDEX copy does not hold yet: staleIndexes, the team unresolved, no throw", () => {
    const s = threeEvents();
    const older = new Season();
    older.fold("2026a", "2026a_qm1", 100, { frc1: [0, 1], frc2: [20, 21] });
    older.fold("2026a", "2026a_qm2", 110, { frc1: [1, 2] });
    older.fold("2026b", "2026b_qm1", 200, { frc1: [2, 3] });
    older.fold("2026c", "2026c_qm1", 300, { frc1: [3, 4] });
    const indexes = new Map<string, AsOfIndex | null>(s.indexes).set("2026c", older.indexes.get("2026c")!);
    const r = resolveAsOf({ ...s.input(s.cut("2026b", "2026b_qm1"), [{ teamKey: "frc1", knownEventKeys: [] }, { teamKey: "frc2", knownEventKeys: [] }]), indexes });
    expect(r.states.has("frc1")).toBe(false);
    expect(r.staleIndexes).toEqual(["2026c"]);
    expect(r.staleSeason).toBe(false);
    // Another team in the same call still resolves.
    expect(r.states.get("frc2")).toEqual(tuple(21));
    // Refetched fresh, it resolves.
    expect(resolveAsOf(s.input(s.cut("2026b", "2026b_qm1"), [{ teamKey: "frc1", knownEventKeys: [] }])).states.get("frc1")).toEqual(tuple(3));
  });

  it("a tail naming a row its INDEX holds for other teams only: the season object is reported out of step too", () => {
    const s = threeEvents();
    const season = { ...copy(s.season), tails: { ...copy(s.season.tails), frc2: ["2026c", 300, 0] as [string, number, number] } };
    const r = resolveAsOf({ ...s.input(s.cut("2026a", "2026a_qm2"), [{ teamKey: "frc2", knownEventKeys: [] }]), season });
    expect(r.states.has("frc2")).toBe(false);
    expect(r.staleIndexes).toEqual(["2026c"]);
    expect(r.staleSeason).toBe(true);
  });

  it("a p naming a row the hop's INDEX copy does not hold yet: staleIndexes", () => {
    const s = threeEvents();
    const older = new Season();
    older.fold("2026a", "2026a_qm1", 100, { frc1: [0, 1], frc2: [20, 21] });
    const indexes = new Map<string, AsOfIndex | null>(s.indexes).set("2026a", older.indexes.get("2026a")!);
    // frc1's 2026b segment has p = 2026a row 1, which the older 2026a copy lacks; the cut is 2026a row 0.
    const r = resolveAsOf({ ...s.input(asOfCutAtMatch(older.indexes.get("2026a")!, "2026a_qm1")!, [{ teamKey: "frc1", knownEventKeys: ["2026b"] }]), indexes });
    expect(r.states.has("frc1")).toBe(false);
    expect(r.staleIndexes).toEqual(["2026a"]);
  });

  it("a LOG copy shorter than the rows its INDEX names at or before the cut is reported, never read for an older row", () => {
    const s = new Season();
    s.fold("2026g", "2026g_qm1", 100, { frc1: [0, 1] });
    s.fold("2026g", "2026g_qm2", 110, { frc1: [1, 2] });
    s.fold("2026g", "2026g_qm3", 120, { frc1: [2, 3] });
    s.fold("2026g", "2026g_qm4", 130, { frc1: [3, 4] });
    s.fold("2026f", "2026f_qm1", 125, { frc9: [0, 1] });
    // The cut is 2026f's row at 125: frc1's segment at 2026g straddles it (rows 0 to 3, row 2 at 120 is the last before it).
    const shortLog = { ...copy(s.logs.get("2026g")!), rows: copy(s.logs.get("2026g")!.rows.slice(0, 2)) };
    const logs = new Map<string, AsOfLog | null>(s.logs).set("2026g", shortLog);
    const cut = s.cut("2026f", "2026f_qm1");
    const r = resolveAsOf({ ...s.input(cut, [{ teamKey: "frc1", knownEventKeys: ["2026g"] }]), logs });
    expect(r.states.has("frc1")).toBe(false);
    expect(r.staleLogs).toEqual(["2026g"]);
    // The whole LOG in hand answers the true row.
    expect(resolveAsOf(s.input(cut, [{ teamKey: "frc1", knownEventKeys: ["2026g"] }])).states.get("frc1")).toEqual(tuple(3));
  });

  it("a LOG copy whose rows are not the ones its INDEX names (another capture's) is reported too", () => {
    const s = threeEvents();
    const log = copy(s.logs.get("2026a")!);
    log.rows[0]!.k = "2026a_qm99";
    const r = resolveAsOf({ ...s.input(s.cut("2026a", "2026a_qm1"), [{ teamKey: "frc1", knownEventKeys: ["2026a"] }]), logs: new Map(s.logs).set("2026a", log) });
    expect(r.states.has("frc1")).toBe(false);
    expect(r.staleLogs).toEqual(["2026a"]);
  });

  it("the league: a cut row the INDEX copy lacks is a stale INDEX, a cut row the LOG copy lacks a stale LOG", () => {
    const s = threeEvents();
    const cut = s.cut("2026a", "2026a_qm1");
    const shortIndex = { ...copy(s.indexes.get("2026a")!), m: [] };
    const noRow = resolveAsOf({ ...s.input(cut, []), indexes: new Map(s.indexes).set("2026a", shortIndex) });
    expect(noRow.league).toBeUndefined();
    expect(noRow.staleIndexes).toEqual(["2026a"]);
    const shortLog = { ...copy(s.logs.get("2026a")!), rows: [] };
    const noLogRow = resolveAsOf({ ...s.input(cut, []), logs: new Map(s.logs).set("2026a", shortLog) });
    expect(noLogRow.league).toBeUndefined();
    expect(noLogRow.staleLogs).toEqual(["2026a"]);
  });
});

describe("resolveAsOf — ties and demo robots", () => {
  it("rows at an equal sort_time across events order by event key: before the cut's event is in, after it is out", () => {
    const s = new Season();
    s.fold("2026a", "2026a_qm1", 500, { frc1: [0, 1] });
    s.fold("2026b", "2026b_qm1", 500, { frc2: [0, 1] });
    s.fold("2026c", "2026c_qm1", 500, { frc3: [0, 1] });
    const r = resolveAsOf(
      s.input(s.cut("2026b", "2026b_qm1"), [
        { teamKey: "frc1", knownEventKeys: ["2026a"] },
        { teamKey: "frc2", knownEventKeys: ["2026b"] },
        { teamKey: "frc3", knownEventKeys: ["2026c"] },
      ])
    );
    expect(r.states.get("frc1")).toEqual(tuple(1));
    expect(r.states.get("frc2")).toEqual(tuple(1));
    expect(r.states.get("frc3")).toEqual(tuple(0));
  });

  it("asking for a demo key also resolves the pseudo team, from the demo keys' known events", () => {
    const s = new Season();
    s.fold("2026a", "2026a_qm1", 100, { frc9970: [0, 1], [DEMO_PSEUDO_TEAM_KEY]: [50, 51] });
    s.fold("2026b", "2026b_qm1", 200, { frc9971: [0, 1], [DEMO_PSEUDO_TEAM_KEY]: [51, 52] });
    const r = resolveAsOf(s.input(s.cut("2026a", "2026a_qm1"), [{ teamKey: "frc9971", knownEventKeys: ["2026b"] }]));
    expect(r.states.get("frc9971")).toEqual(tuple(0));
    expect(r.states.get(DEMO_PSEUDO_TEAM_KEY)).toEqual(tuple(51));
    expect(resolveAsOf(s.input(s.cut("2026a", "2026a_qm1"), [{ teamKey: "frc1", knownEventKeys: ["2026b"] }])).states.has(DEMO_PSEUDO_TEAM_KEY)).toBe(false);
  });
});

/** Every tuple key the rows fold, in first-seen order. */
function asOfTupleKeysOfRows(rows: readonly { red: string[]; blue: string[] }[]): string[] {
  return [...new Set(rows.flatMap((row) => asOfTupleKeys(row.red, row.blue)))];
}

/** A small seeded generator, so the random season is the same on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A seeded random season (overlapping events, shared sort_times, demo robots)
 * folded through the real reducer, with every object's JSON after each of the
 * folds that touched it, so a test can hand the resolver copies of any age.
 */
function randomSeason() {
  const rand = mulberry32(20261005);
  const events = ["2026aa", "2026bb", "2026cc", "2026dd", "2026ee"];
  const teams = [...Array.from({ length: 14 }, (_, n) => `frc${n + 1}`), "frc9970", "frc9971"];
  // Rows in stream order: (sort_time, eventKey, per-event play order). Few distinct times, so ties are common,
  // and events interleave so teams overlap events.
  const rows: { eventKey: string; t: number; red: string[]; blue: string[] }[] = [];
  for (let n = 0; n < 160; n++) {
    const shuffled = [...teams].sort(() => rand() - 0.5);
    rows.push({ eventKey: events[Math.floor(rand() * events.length)]!, t: 1000 + Math.floor(rand() * 40) * 10, red: shuffled.slice(0, 3), blue: shuffled.slice(3, 6) });
  }
  rows.sort((a, b) => a.t - b.t || (a.eventKey < b.eventKey ? -1 : a.eventKey > b.eventKey ? 1 : 0));

  const s = new Season();
  s.start = createAsOfStart({ season: 2026, vars: [], teams: new Map(asOfTupleKeysOfRows(rows).map((key) => [key, tuple(-1)])), stamp: STAMP });
  const current = new Map<string, number>();
  const history: { eventKey: string; matchKey: string; after: Map<string, number> }[] = [];
  const folds: { eventKey: string; matchKey: string; t: number; folded: Record<string, [number, number]> }[] = [];
  /** Per event, its INDEX and LOG JSON after each of its own folds (entry k-1 is the copy after its k-th row). */
  const versions = new Map<string, { index: string[]; log: string[] }>();
  /** The season object's JSON after each fold of the season (entry g is the copy after fold g; the copy before any fold is `seasonBefore`). */
  const seasonVersions: string[] = [];
  const seasonBefore = JSON.stringify(s.season);
  rows.forEach((row, g) => {
    const keys = asOfTupleKeys(row.red, row.blue);
    const folded: Record<string, [number, number]> = {};
    for (const key of keys) {
      const before = current.get(key) ?? -1;
      folded[key] = [before, g * 100 + keys.indexOf(key)];
      current.set(key, g * 100 + keys.indexOf(key));
    }
    const matchKey = `${row.eventKey}_qm${g}`;
    s.fold(row.eventKey, matchKey, row.t, folded);
    folds.push({ eventKey: row.eventKey, matchKey, t: row.t, folded });
    history.push({ eventKey: row.eventKey, matchKey, after: new Map(current) });
    const v = versions.get(row.eventKey) ?? { index: [], log: [] };
    v.index.push(JSON.stringify(s.indexes.get(row.eventKey)));
    v.log.push(JSON.stringify(s.logs.get(row.eventKey)));
    versions.set(row.eventKey, v);
    seasonVersions.push(JSON.stringify(s.season));
  });

  const allKeys = [...teams, DEMO_PSEUDO_TEAM_KEY];
  const playedAt = new Map<string, Set<string>>();
  rows.forEach((row) => {
    for (const key of asOfTupleKeys(row.red, row.blue)) playedAt.set(key, (playedAt.get(key) ?? new Set()).add(row.eventKey));
  });
  return { rand, events, teams, rows, s, history, folds, versions, seasonVersions, seasonBefore, allKeys, playedAt };
}

describe("resolveAsOf — every cut of a random season against a brute force answer", () => {
  it("matches the team's tuple after its last row at or before the cut, for every team, every cut and several known-event choices", () => {
    const { events, rows, s, history, folds, allKeys, playedAt } = randomSeason();

    let compared = 0;
    const cuts: { cut: AsOfCut; expected: Map<string, number> }[] = [{ cut: AS_OF_SEASON_START_CUT, expected: new Map() }];
    for (const h of history) cuts.push({ cut: s.cut(h.eventKey, h.matchKey), expected: h.after });
    for (const { cut, expected } of cuts) {
      for (const knownChoice of ["all", "none", "first", "last"] as const) {
        const requests = allKeys
          .filter((key) => key !== DEMO_PSEUDO_TEAM_KEY || knownChoice !== "none")
          .map((teamKey) => {
            const known = [...(playedAt.get(teamKey) ?? [])].sort();
            const knownEventKeys = knownChoice === "all" ? known : knownChoice === "none" ? [] : knownChoice === "first" ? known.slice(0, 1) : known.slice(-1);
            return { teamKey, knownEventKeys };
          });
        const r = resolveAsOf(s.input(cut, requests));
        expect(r.missingIndexes).toEqual([]);
        expect(r.missingLogs).toEqual([]);
        for (const teamKey of allKeys) {
          const want = expected.get(teamKey);
          const got = r.states.get(teamKey);
          compared += 1;
          if (want === undefined) {
            // Never played at or before the cut: its pre-season tuple (-1) when it plays later, unseen when never.
            expect(got, `${teamKey} at ${JSON.stringify(cut)} (${knownChoice})`).toEqual(playedAt.has(teamKey) ? tuple(-1) : UNSEEN_AS_OF_TUPLE);
          } else {
            expect(got, `${teamKey} at ${JSON.stringify(cut)} (${knownChoice})`).toEqual(tuple(want));
          }
        }
        expect(r.league).toEqual(cut === AS_OF_SEASON_START_CUT ? league(-1) : league(cut.t));
      }
    }
    expect(compared).toBeGreaterThan(5000);

    // TRUNCATION (Part 1b): the season folded only up to each cut, with the same start object, resolves every
    // team (played or not, with no known event) exactly as the full season does.
    let truncatedCompared = 0;
    for (let g = -1; g < folds.length; g++) {
      const truncated = new Season();
      truncated.start = s.start;
      for (const f of folds.slice(0, g + 1)) truncated.fold(f.eventKey, f.matchKey, f.t, f.folded);
      const cut = g < 0 ? AS_OF_SEASON_START_CUT : truncated.cut(folds[g]!.eventKey, folds[g]!.matchKey);
      const requests = [...allKeys, "frc9999"].map((teamKey) => ({ teamKey, knownEventKeys: [] }));
      const fromFull = resolveAsOf(s.input(cut, requests));
      const fromTruncated = resolveAsOf(truncated.input(cut, requests));
      for (const { teamKey } of requests) {
        truncatedCompared += 1;
        expect(fromTruncated.states.get(teamKey), `${teamKey} truncated at ${g}`).toEqual(fromFull.states.get(teamKey));
      }
      expect(fromTruncated.league).toEqual(fromFull.league);
    }
    expect(truncatedCompared).toBeGreaterThan(2000);

    // JUST BEFORE every match (`asOfCutBeforeMatch`): every team and the league equal the brute force state
    // after the event's previous row, or, for an event's first row, after the season stream's previous row.
    let beforeCompared = 0;
    let firstRows = 0;
    folds.forEach((f, g) => {
      const index = s.indexes.get(f.eventKey)!;
      const cut = asOfCutBeforeMatch(index, f.matchKey)!;
      const i = index.m.findIndex(([matchKey]) => matchKey === f.matchKey);
      let expected: Map<string, number>;
      let expectedLeague: number[];
      if (i > 0) {
        const previous = history.find((h) => h.matchKey === index.m[i - 1]![0])!;
        expected = previous.after;
        expectedLeague = league(index.m[i - 1]![1]);
      } else {
        firstRows += 1;
        expected = g > 0 ? history[g - 1]!.after : new Map();
        expectedLeague = g > 0 ? league(folds[g - 1]!.t) : league(-1);
      }
      const r = resolveAsOf(s.input(cut, allKeys.map((teamKey) => ({ teamKey, knownEventKeys: [f.eventKey] }))));
      expect(r.missingIndexes).toEqual([]);
      expect(r.missingLogs).toEqual([]);
      for (const teamKey of allKeys) {
        beforeCompared += 1;
        const want = expected.get(teamKey);
        const got = r.states.get(teamKey);
        if (want === undefined) expect(got, `${teamKey} before ${f.matchKey}`).toEqual(playedAt.has(teamKey) ? tuple(-1) : UNSEEN_AS_OF_TUPLE);
        else expect(got, `${teamKey} before ${f.matchKey}`).toEqual(tuple(want));
      }
      expect(r.league, `league before ${f.matchKey}`).toEqual(expectedLeague);
    });
    expect(firstRows).toBe(events.length);
    expect(beforeCompared).toBeGreaterThan(2000);
    expect(rows.length).toBe(folds.length);
    // Non-vacuity: the random season really holds overlapping segments and demo rows.
    const multiSegment = [...s.indexes.values()].some((index) => Object.values(index.teams).some((segments) => segments.length > 1));
    expect(multiSegment).toBe(true);
    expect(rows.some((row) => [...row.red, ...row.blue].some((key) => isDemoTeamKey(key)))).toBe(true);
  });

  it("OBJECTS OF DIFFERENT AGES (C4, R1): at every cut, with each INDEX and LOG copy of a random age, every answer is the truth or a stale report, and refetching the reported objects resolves everything", () => {
    const { rand, s, history, versions, seasonVersions, seasonBefore, allKeys, playedAt } = randomSeason();
    const truthOf = (expected: Map<string, number>, teamKey: string): AsOfTeamTuple => {
      const want = expected.get(teamKey);
      return want === undefined ? (playedAt.has(teamKey) ? tuple(-1) : UNSEEN_AS_OF_TUPLE) : tuple(want);
    };
    const newestIndex = (eventKey: string): AsOfIndex => JSON.parse(versions.get(eventKey)!.index.at(-1)!) as AsOfIndex;
    const newestLog = (eventKey: string): AsOfLog => JSON.parse(versions.get(eventKey)!.log.at(-1)!) as AsOfLog;

    let staleRounds = 0;
    let answeredFromOldCopies = 0;
    history.forEach((h, g) => {
      const cut = s.cut(h.eventKey, h.matchKey);
      for (const knownChoice of ["all", "none"] as const) {
        // The season object newest (the tails name every row), each INDEX and LOG at its own random age; the
        // cut's own INDEX holds the cut row, because the caller read the cut from it.
        const indexes = new Map<string, AsOfIndex | null>();
        const logs = new Map<string, AsOfLog | null>();
        for (const [eventKey, v] of versions) {
          let indexAge = 1 + Math.floor(rand() * v.index.length);
          if (eventKey === cut.eventKey) indexAge = Math.max(indexAge, cut.i + 1);
          indexes.set(eventKey, JSON.parse(v.index[indexAge - 1]!) as AsOfIndex);
          logs.set(eventKey, JSON.parse(v.log[Math.floor(rand() * v.log.length)]!) as AsOfLog);
        }
        const requests = allKeys.map((teamKey) => ({ teamKey, knownEventKeys: knownChoice === "all" ? [...(playedAt.get(teamKey) ?? [])].sort() : [] }));
        for (let round = 0; ; round++) {
          expect(round, `cut ${g} did not settle`).toBeLessThan(4);
          const r = resolveAsOf({ cut, teams: requests, season: s.season, indexes, logs, start: s.start });
          for (const [teamKey, got] of r.states) expect(got, `${teamKey} at fold ${g} (${knownChoice}, round ${round})`).toEqual(truthOf(h.after, teamKey));
          if (r.league !== undefined) expect(r.league).toEqual(league(cut.t));
          expect(r.missingIndexes).toEqual([]);
          expect(r.missingLogs).toEqual([]);
          if (r.staleIndexes.length === 0 && r.staleLogs.length === 0) {
            expect(r.staleSeason).toBe(false);
            expect(r.states.size).toBe(allKeys.length);
            expect(r.league).toEqual(league(cut.t));
            if (round === 0) answeredFromOldCopies += 1;
            break;
          }
          staleRounds += 1;
          for (const eventKey of r.staleIndexes) indexes.set(eventKey, newestIndex(eventKey));
          for (const eventKey of r.staleLogs) logs.set(eventKey, newestLog(eventKey));
        }
      }
    });
    // Non-vacuity: some calls really met an out of step copy, and some answered at once from older copies.
    expect(staleRounds).toBeGreaterThan(50);
    expect(answeredFromOldCopies).toBeGreaterThan(10);

    // And the other way round: the season object at a random age (its tails behind), every INDEX and LOG newest.
    // The INDEX wins, so every team resolves to the truth in one call with nothing reported.
    const indexes = new Map<string, AsOfIndex | null>([...versions.keys()].map((eventKey) => [eventKey, newestIndex(eventKey)]));
    const logs = new Map<string, AsOfLog | null>([...versions.keys()].map((eventKey) => [eventKey, newestLog(eventKey)]));
    let olderSeasons = 0;
    history.forEach((h, g) => {
      const cut = s.cut(h.eventKey, h.matchKey);
      const age = Math.floor(rand() * (seasonVersions.length + 1)) - 1;
      const season = JSON.parse(age < 0 ? seasonBefore : seasonVersions[age]!) as AsOfSeason;
      if (age < seasonVersions.length - 1) olderSeasons += 1;
      const r = resolveAsOf({ cut, teams: allKeys.map((teamKey) => ({ teamKey, knownEventKeys: [] })), season, indexes, logs, start: s.start });
      expect(asOfResultIsStale(r), `fold ${g} with the season object after fold ${age}`).toBe(false);
      for (const teamKey of allKeys) expect(r.states.get(teamKey), `${teamKey} at fold ${g}, season object after fold ${age}`).toEqual(truthOf(h.after, teamKey));
    });
    expect(olderSeasons).toBeGreaterThan(100);
  });
});
