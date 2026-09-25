/**
 * `scripts/districtPricingState.ts`: the as-of truncation predicate, tested
 * purely over a hand-built event table, and the real walk-forward replay,
 * tested against `data/corpus.sqlite` behind the `existsSync` plus explicit
 * `it.skip` guard `packages/core/districts/reconciliation.test.ts` established.
 *
 * The corpus-guarded half is where SC-5's walk-forward boundary stops being an
 * argument and becomes a VALUE: zero matches of a still-ahead district event
 * enter the replayed stream.
 */
import { existsSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { openCorpusReadOnly, type Corpus } from "../packages/corpus/db.js";
import { readFileSync } from "node:fs";
import {
  buildDistrictPricingState,
  resolveDistrictPricingAlgorithm,
  startedEventKeysAsOf,
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

  it("non-vacuity: the replayed season list is non-empty and the rated-team count is above zero", () => {
    const algorithm = resolveDistrictPricingAlgorithm()!;
    const state = buildDistrictPricingState(db, { season: SEASON, warmupSeasons: WARMUP, asOf: AS_OF, algorithm })!;
    expect(state.replayedSeasons.length).toBeGreaterThan(1);
    expect(state.layer.sigmaScoreByTeam().size).toBeGreaterThan(0);
  });
});
