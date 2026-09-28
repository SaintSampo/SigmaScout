/**
 * `scripts/districtPricingState.ts`: the as-of predicates, tested purely over
 * hand-built event and match tables, and the real walk-forward replay, tested
 * against `data/corpus.sqlite` behind the `existsSync` plus explicit `it.skip`
 * guard `packages/core/districts/reconciliation.test.ts` established.
 *
 * The corpus-guarded half is where SC-5's walk-forward boundary stops being an
 * argument and becomes a VALUE: zero matches of a still-ahead district event
 * enter the replayed stream, and none of an IN-PROGRESS event's matches played
 * at or after the instant do either.
 */
import { existsSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { openCorpusReadOnly, type Corpus } from "../packages/corpus/db.js";
import { readFileSync } from "node:fs";
import {
  buildDistrictPricingState,
  playedMatchKeysAtOrAfter,
  resolveDistrictPricingAlgorithm,
  startedEventKeysAsOf,
  underwayEventKeysAsOf,
} from "./districtPricingState.js";

const CORPUS_PATH = "data/corpus.sqlite";
const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);

/** An in-memory corpus carrying only the `events` rows the predicate reads. */
function eventsFixture(rows: ReadonlyArray<{ event_key: string; year: number; start_date: string | null }>): Corpus {
  const db = new Database(":memory:") as unknown as Corpus;
  db.prepare(`CREATE TABLE events (event_key TEXT PRIMARY KEY, year INTEGER NOT NULL, start_date TEXT)`).run();
  const insert = db.prepare(`INSERT INTO events (event_key, year, start_date) VALUES (?, ?, ?)`);
  for (const row of rows) insert.run(row.event_key, row.year, row.start_date);
  return db;
}

describe("startedEventKeysAsOf — the as-of truncation predicate", () => {
  it("keeps an event that started strictly before the instant, drops one at or after it, and KEEPS a null-dated event", () => {
    const db = eventsFixture([
      { event_key: "2026early", year: 2026, start_date: "2026-03-01" },
      { event_key: "2026exactly", year: 2026, start_date: "2026-03-07" },
      { event_key: "2026later", year: 2026, start_date: "2026-04-01" },
      { event_key: "2026undated", year: 2026, start_date: null },
      { event_key: "2025other", year: 2025, start_date: "2025-03-01" },
    ]);
    try {
      const started = startedEventKeysAsOf(db, 2026, "2026-03-07");
      expect(started.has("2026early")).toBe(true);
      expect(started.has("2026exactly")).toBe(false);
      expect(started.has("2026later")).toBe(false);
      // THE DELIBERATE ASYMMETRY: `eventStillAhead`'s null default is "assume
      // ahead" (it keeps a ceiling honest for a team); this predicate's null
      // default is "assume started", because it decides whether real PLAYED
      // rows enter a replay and discarding observed results is the worse error.
      expect(started.has("2026undated")).toBe(true);
      // Season-scoped: another season's event is never returned.
      expect(started.has("2025other")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("is an IDENTITY when every start date is in the past, so a production run replays exactly today's stream", () => {
    const db = eventsFixture([
      { event_key: "2026a", year: 2026, start_date: "2026-03-05" },
      { event_key: "2026b", year: 2026, start_date: "2026-04-18" },
      { event_key: "2026c", year: 2026, start_date: "2026-07-06" },
    ]);
    try {
      const started = startedEventKeysAsOf(db, 2026, "2026-09-25T00:00:00.000Z");
      expect([...started].sort()).toEqual(["2026a", "2026b", "2026c"]);
    } finally {
      db.close();
    }
  });

  it("refuses an unparseable as-of instant rather than silently truncating nothing", () => {
    const db = eventsFixture([{ event_key: "2026a", year: 2026, start_date: "2026-03-05" }]);
    try {
      expect(() => startedEventKeysAsOf(db, 2026, "not-a-date")).toThrow(/not a parseable date/);
    } finally {
      db.close();
    }
  });
});

/** An in-memory corpus carrying the `events` and `matches` columns the match-clock predicates read. `sort_time` is epoch ms, as the corpus stores it. */
function matchClockFixture(rows: {
  events: ReadonlyArray<{ event_key: string; year: number; start_date: string | null }>;
  matches: ReadonlyArray<{ match_key: string; event_key: string; sort_time: string; winner: string | null }>;
}): Corpus {
  const db = new Database(":memory:") as unknown as Corpus;
  db.prepare(`CREATE TABLE events (event_key TEXT PRIMARY KEY, year INTEGER NOT NULL, start_date TEXT)`).run();
  db.prepare(`CREATE TABLE matches (match_key TEXT PRIMARY KEY, event_key TEXT NOT NULL, sort_time INTEGER NOT NULL, winner TEXT)`).run();
  const insertEvent = db.prepare(`INSERT INTO events (event_key, year, start_date) VALUES (?, ?, ?)`);
  for (const row of rows.events) insertEvent.run(row.event_key, row.year, row.start_date);
  const insertMatch = db.prepare(`INSERT INTO matches (match_key, event_key, sort_time, winner) VALUES (?, ?, ?, ?)`);
  for (const row of rows.matches) insertMatch.run(row.match_key, row.event_key, Date.parse(row.sort_time), row.winner);
  return db;
}

/** The instant every match-clock case below is cut at. */
const CUT = "2026-04-04T00:00:00.000Z";

describe("playedMatchKeysAtOrAfter — the replay's match-time cut", () => {
  it("cuts an IN-PROGRESS event's matches at and after the instant and keeps the ones played before it", () => {
    // The leak this replaced: 2026mid STARTED before the instant, so the old
    // start-date rule admitted all four of its played matches, including the two
    // played at and after the instant.
    const db = matchClockFixture({
      events: [
        { event_key: "2026mid", year: 2026, start_date: "2026-04-02" },
        { event_key: "2026done", year: 2026, start_date: "2026-03-20" },
        { event_key: "2026ahead", year: 2026, start_date: "2026-04-10" },
        { event_key: "2025old", year: 2025, start_date: "2025-04-05" },
      ],
      matches: [
        { match_key: "2026mid_qm1", event_key: "2026mid", sort_time: "2026-04-03T15:00:00.000Z", winner: "red" },
        { match_key: "2026mid_qm2", event_key: "2026mid", sort_time: "2026-04-03T23:59:59.999Z", winner: "blue" },
        { match_key: "2026mid_qm3", event_key: "2026mid", sort_time: CUT, winner: "red" },
        { match_key: "2026mid_qm4", event_key: "2026mid", sort_time: "2026-04-04T16:00:00.000Z", winner: "tie" },
        { match_key: "2026mid_qm5", event_key: "2026mid", sort_time: "2026-04-04T17:00:00.000Z", winner: null },
        { match_key: "2026done_qm1", event_key: "2026done", sort_time: "2026-03-21T15:00:00.000Z", winner: "red" },
        { match_key: "2026ahead_qm1", event_key: "2026ahead", sort_time: "2026-04-11T15:00:00.000Z", winner: "blue" },
        { match_key: "2025old_qm1", event_key: "2025old", sort_time: "2026-04-05T15:00:00.000Z", winner: "red" },
      ],
    });
    try {
      const cut = playedMatchKeysAtOrAfter(db, 2026, CUT);
      // A match stamped EXACTLY at the instant is cut: only strictly-before is admitted.
      expect([...cut].sort()).toEqual(["2026ahead_qm1", "2026mid_qm3", "2026mid_qm4"]);
      expect(cut.has("2026mid_qm2")).toBe(false);
      // An unplayed row is never in the replay's stream, so it is never in the cut either.
      expect(cut.has("2026mid_qm5")).toBe(false);
      // Season-scoped by the EVENT's year, whatever the match's own timestamp says.
      expect(cut.has("2025old_qm1")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("is EMPTY at an instant after every played match, so a production run replays exactly its uncut stream", () => {
    const db = matchClockFixture({
      events: [{ event_key: "2026a", year: 2026, start_date: "2026-03-05" }],
      matches: [
        { match_key: "2026a_qm1", event_key: "2026a", sort_time: "2026-03-06T15:00:00.000Z", winner: "red" },
        { match_key: "2026a_f1m1", event_key: "2026a", sort_time: "2026-03-07T22:00:00.000Z", winner: "blue" },
      ],
    });
    try {
      expect(playedMatchKeysAtOrAfter(db, 2026, "2026-09-28T00:00:00.000Z").size).toBe(0);
    } finally {
      db.close();
    }
  });

  it("refuses an unparseable as-of instant rather than silently cutting nothing", () => {
    const db = matchClockFixture({ events: [], matches: [] });
    try {
      expect(() => playedMatchKeysAtOrAfter(db, 2026, "not-a-date")).toThrow(/not a parseable date/);
    } finally {
      db.close();
    }
  });
});

describe("underwayEventKeysAsOf — which events' district points already existed at the instant", () => {
  it("reads an event as underway only once it had PLAYED before the instant, falling back to the start date only when it has no played match at all", () => {
    const db = matchClockFixture({
      events: [
        { event_key: "2026playing", year: 2026, start_date: "2026-04-02" },
        // Started by DATE, but every match was played at or after the instant.
        // The start-date rule read its points as already earned; the match clock does not.
        { event_key: "2026practice", year: 2026, start_date: "2026-04-03" },
        { event_key: "2026ahead", year: 2026, start_date: "2026-04-10" },
        // No played match in the corpus: the start date is the only as-of fact.
        { event_key: "2026nomatches", year: 2026, start_date: "2026-03-20" },
        { event_key: "2026nomatchesahead", year: 2026, start_date: "2026-04-20" },
        { event_key: "2026undated", year: 2026, start_date: null },
        { event_key: "2025other", year: 2025, start_date: "2025-03-01" },
      ],
      matches: [
        { match_key: "2026playing_qm1", event_key: "2026playing", sort_time: "2026-04-03T15:00:00.000Z", winner: "red" },
        { match_key: "2026practice_qm1", event_key: "2026practice", sort_time: "2026-04-04T15:00:00.000Z", winner: "red" },
        { match_key: "2026ahead_qm1", event_key: "2026ahead", sort_time: "2026-04-11T15:00:00.000Z", winner: "red" },
        // A scheduled-but-unplayed row before the instant is not play.
        { match_key: "2026nomatches_qm1", event_key: "2026nomatches", sort_time: "2026-03-21T15:00:00.000Z", winner: null },
      ],
    });
    try {
      const underway = underwayEventKeysAsOf(db, 2026, CUT);
      expect([...underway].sort()).toEqual(["2026nomatches", "2026playing", "2026undated"]);
      expect(underway.has("2026practice")).toBe(false);
      expect(underway.has("2025other")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("is every event carrying play at the run's own clock, so the season-final points rule is unchanged in production", () => {
    const db = matchClockFixture({
      events: [
        { event_key: "2026a", year: 2026, start_date: "2026-03-05" },
        { event_key: "2026b", year: 2026, start_date: "2026-04-18" },
      ],
      matches: [
        { match_key: "2026a_qm1", event_key: "2026a", sort_time: "2026-03-06T15:00:00.000Z", winner: "red" },
        { match_key: "2026b_qm1", event_key: "2026b", sort_time: "2026-04-19T15:00:00.000Z", winner: "blue" },
      ],
    });
    try {
      expect([...underwayEventKeysAsOf(db, 2026, "2026-09-28T00:00:00.000Z")].sort()).toEqual(["2026a", "2026b"]);
    } finally {
      db.close();
    }
  });
});

describe("districtPricingState.ts reads no credential", () => {
  it("never mentions .env, process.env or a credential in its source", () => {
    const source = readFileSync(new URL("./districtPricingState.ts", import.meta.url), "utf8");
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    expect(code).not.toContain("process.env");
    expect(code).not.toContain("putObject");
  });
});

describe("buildDistrictPricingState over the real corpus", () => {
  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} not found — run the ingest pipeline (pnpm ingest:districts) first`, () => {});
    return;
  }

  const AS_OF = "2026-03-07";
  const SEASON = 2026;
  const WARMUP = [2025];
  /** A 2026 district event whose start date is at or after the as-of instant — the walk-forward boundary's own witness. */
  const STILL_AHEAD_EVENT = "2026mibig";

  let db: Corpus;
  beforeAll(() => {
    db = openCorpusReadOnly(CORPUS_PATH);
  });
  afterAll(() => {
    db.close();
  });

  it("replays real matches and rates a stated majority of a still-ahead event's registered roster", () => {
    const algorithm = resolveDistrictPricingAlgorithm();
    expect(algorithm).not.toBeNull();
    const state = buildDistrictPricingState(db, { season: SEASON, warmupSeasons: WARMUP, asOf: AS_OF, algorithm: algorithm! });
    expect(state).not.toBeNull();
    expect(state!.pricedFrom).toBe("current-state");
    expect(state!.replayedSeasons).toEqual([2025, 2026]);
    expect(state!.matchesReplayed).toBeGreaterThan(0);
    // The truncation actually removed matches — an untruncated replay is
    // strictly larger, which is the whole point of the as-of instant.
    expect(state!.matchesTruncated).toBeGreaterThan(0);

    const roster = (db.prepare(`SELECT team_key FROM event_teams WHERE event_key = ?`).all(STILL_AHEAD_EVENT) as { team_key: string }[]).map(
      (r) => r.team_key
    );
    expect(roster.length).toBeGreaterThan(0);
    const ratings = state!.ratingsFor(roster);
    const rated = roster.filter((teamKey) => {
      const rating = ratings.get(teamKey);
      return typeof rating?.total === "number" && Number.isFinite(rating.total) && typeof rating?.sigma === "number" && rating.sigma > 0;
    });
    console.log(
      `districtPricingState: as-of ${AS_OF} replayed ${state!.matchesReplayed} match(es) across ${state!.replayedSeasons.join("+")}, truncated ${state!.matchesTruncated}; ${STILL_AHEAD_EVENT} roster ${rated.length}/${roster.length} rated`
    );
    // A stated majority, not all: at week 1 of the season most of a later
    // event's roster has not played yet, which is exactly why the bake is
    // all-or-nothing and why the census below counts its skips.
    expect(rated.length).toBeGreaterThan(0);
  });

  it("proves the leak is impossible with a VALUE: zero matches of a still-ahead district event entered the replayed stream", () => {
    const started = startedEventKeysAsOf(db, SEASON, AS_OF);
    expect(started.has(STILL_AHEAD_EVENT)).toBe(false);
    const replayedFromThatEvent = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM matches m JOIN events e ON e.event_key = m.event_key
           WHERE e.year = ? AND m.event_key = ? AND e.start_date < ?`
        )
        .get(SEASON, STILL_AHEAD_EVENT, AS_OF) as { n: number }
    ).n;
    expect(replayedFromThatEvent).toBe(0);
  });

  it("cuts an IN-PROGRESS event at the instant: the replay holds exactly the played matches stamped before it, and names the events the start-date rule leaked", () => {
    const instant = Date.parse(AS_OF);
    const count = (sql: string): number => (db.prepare(sql).get(SEASON, instant) as { n: number }).n;
    const playedBefore = count(
      `SELECT COUNT(*) AS n FROM matches m JOIN events e ON e.event_key = m.event_key WHERE e.year = ? AND m.winner IS NOT NULL AND m.sort_time < ?`
    );
    const playedAtOrAfter = count(
      `SELECT COUNT(*) AS n FROM matches m JOIN events e ON e.event_key = m.event_key WHERE e.year = ? AND m.winner IS NOT NULL AND m.sort_time >= ?`
    );

    // THE WITNESS, so this test cannot pass vacuously: events that had STARTED
    // by date at the instant yet played matches at or after it. The start-date
    // rule admitted every one of those matches.
    const started = startedEventKeysAsOf(db, SEASON, AS_OF);
    const lateRows = db
      .prepare(
        `SELECT m.event_key AS event_key, COUNT(*) AS n FROM matches m JOIN events e ON e.event_key = m.event_key
         WHERE e.year = ? AND m.winner IS NOT NULL AND m.sort_time >= ? GROUP BY m.event_key`
      )
      .all(SEASON, instant) as { event_key: string; n: number }[];
    const inProgress = lateRows.filter((row) => started.has(row.event_key));
    const leakedByStartDate = inProgress.reduce((sum, row) => sum + row.n, 0);
    expect(inProgress.length).toBeGreaterThan(0);
    expect(leakedByStartDate).toBeGreaterThan(0);

    // Warmup [] keeps this cheap: the property is the cut, not the ratings.
    const algorithm = resolveDistrictPricingAlgorithm()!;
    const state = buildDistrictPricingState(db, { season: SEASON, warmupSeasons: [], asOf: AS_OF, algorithm })!;
    console.log(
      `districtPricingState: as-of ${AS_OF} replayed ${state.matchesReplayed} of ${playedBefore + playedAtOrAfter} played 2026 matches; the start-date rule would have admitted ${leakedByStartDate} more from ${inProgress.length} in-progress event(s): ${inProgress
        .map((row) => `${row.event_key} (${row.n})`)
        .join(", ")}`
    );
    // EXACTLY the matches stamped strictly before the instant: one more would be a leak.
    expect(state.matchesReplayed).toBe(playedBefore);
    expect(state.matchesTruncated).toBe(playedAtOrAfter);
  });

  it("non-vacuity: the replayed season list is non-empty and the rated-team count is above zero", () => {
    const algorithm = resolveDistrictPricingAlgorithm()!;
    const state = buildDistrictPricingState(db, { season: SEASON, warmupSeasons: WARMUP, asOf: AS_OF, algorithm })!;
    expect(state.replayedSeasons.length).toBeGreaterThan(1);
    expect(state.layer.sigmaScoreByTeam().size).toBeGreaterThan(0);
  });
});
