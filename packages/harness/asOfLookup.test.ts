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
import { asOfCutAtMatch, AsOfResolveError, resolveAsOf, type AsOfResolveInput, type AsOfResolveTeam } from "./asOfLookup.js";

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

  fold(eventKey: string, matchKey: string, t: number, teams: Record<string, [number, number]>, compLevel = "qm"): void {
    const f: AsOfFold = {
      eventKey,
      matchKey,
      t,
      compLevel,
      L: league(t),
      teams: Object.entries(teams).map(([teamKey, [before, after]]) => ({ teamKey, before: tuple(before), after: tuple(after) })),
    };
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

  it("a Worker-created season object (L0 null) has no season start league", () => {
    const s = threeEvents();
    expect(resolveAsOf({ ...s.input(AS_OF_SEASON_START_CUT, []), season: { ...s.season, L0: null } }).league).toBeUndefined();
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

describe("resolveAsOf — every cut of a random season against a brute force answer", () => {
  it("matches the team's tuple after its last row at or before the cut, for every team, every cut and several known-event choices", () => {
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
    });

    const allKeys = [...teams, DEMO_PSEUDO_TEAM_KEY];
    const playedAt = new Map<string, Set<string>>();
    rows.forEach((row) => {
      for (const key of asOfTupleKeys(row.red, row.blue)) playedAt.set(key, (playedAt.get(key) ?? new Set()).add(row.eventKey));
    });

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
    // Non-vacuity: the random season really holds overlapping segments and demo rows.
    const multiSegment = [...s.indexes.values()].some((index) => Object.values(index.teams).some((segments) => segments.length > 1));
    expect(multiSegment).toBe(true);
    expect(rows.some((row) => [...row.red, ...row.blue].some((key) => isDemoTeamKey(key)))).toBe(true);
  });
});
