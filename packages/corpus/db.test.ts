/**
 * Corpus accessor tests (DATA-02 Task 1): the chronological read's total
 * order under sort_time ties, upsert idempotency, the offseason exclusion
 * filter, and the single-writer lock. Each test opens a fresh temp SQLite
 * file so tests never share state.
 */
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OUTCOME_KEYS } from "../core/algorithms/leakProof.js";
import type { CorpusEvent, CorpusMatch } from "../ingest/normalize.js";
import {
  findIncompleteIngestRuns,
  hasEventRankingRecordColumns,
  openCorpus,
  parseAllianceRecord,
  recordIngestRun,
  selectEventAlliancesForSeason,
  selectEventRankingsForSeason,
  selectMatchesChronological,
  selectScheduledMatches,
  selectTeamKeysForYear,
  selectTeamMediaForYear,
  upsertEvent,
  upsertEventAlliance,
  upsertEventRanking,
  upsertMatch,
  upsertTeam,
  upsertTeamMedia,
  type Corpus,
} from "./db.js";

// WR-03 TOCTOU regression proof: acquireWriteLock's success path no longer
// consults existsSync at all (the atomic `wx` exclusive-create replaced
// it), so wrapping it here and forcing it to lie ("not present") on demand
// reproduces the race window a genuinely concurrent second process could
// hit against the OLD probe-then-write ordering, without needing real
// multi-process timing. Every other call passes straight through to the
// real implementation, so this leaves the rest of this file's fs usage
// unaffected.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync), unlinkSync: vi.fn(actual.unlinkSync) };
});

let dir: string;
let corpusPath: string;
let db: Corpus;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sigmascout-corpus-"));
  corpusPath = join(dir, "corpus.sqlite");
  db = openCorpus(corpusPath);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function event(overrides: Partial<CorpusEvent> = {}): CorpusEvent {
  return {
    eventKey: "2024casj",
    year: 2024,
    eventType: 0,
    isOffseason: false,
    startDate: "2024-03-01",
    name: "Silicon Valley Regional",
    week: 1,
    country: "USA",
    stateProv: "CA",
    districtKey: null,
    ...overrides,
  };
}

function match(overrides: Partial<CorpusMatch> = {}): CorpusMatch {
  return {
    matchKey: "2024casj_qm1",
    eventKey: "2024casj",
    compLevel: "qm",
    matchNumber: 1,
    setNumber: 1,
    sortTime: 1_000,
    redTeams: ["frc1", "frc2", "frc3"],
    blueTeams: ["frc4", "frc5", "frc6"],
    redSurrogates: [],
    blueSurrogates: [],
    redDqs: [],
    blueDqs: [],
    winner: "red",
    winnerImputed: false,
    redScore: 100,
    blueScore: 50,
    redRpEarned: 2,
    blueRpEarned: 0,
    hasScoreBreakdown: true,
    scoreBreakdownRaw: '{"red":{}}',
    ...overrides,
  };
}

describe("selectMatchesChronological — total order under sort_time ties", () => {
  it("breaks ties deterministically on event_key, comp-level play order, set_number, match_number", () => {
    upsertEvent(db, event({ eventKey: "2024aaaa" }));
    upsertEvent(db, event({ eventKey: "2024zzzz" }));

    // All four share sort_time = 5000. Expected total order per the
    // documented tie-break: event_key ASC, then comp-level play order
    // (qm < sf < f), then set_number ASC, then match_number ASC.
    upsertMatch(
      db,
      match({ matchKey: "2024zzzz_qm1", eventKey: "2024zzzz", compLevel: "qm", setNumber: 1, matchNumber: 1, sortTime: 5000 })
    );
    upsertMatch(
      db,
      match({ matchKey: "2024aaaa_f1m2", eventKey: "2024aaaa", compLevel: "f", setNumber: 1, matchNumber: 2, sortTime: 5000 })
    );
    upsertMatch(
      db,
      match({ matchKey: "2024aaaa_sf2m1", eventKey: "2024aaaa", compLevel: "sf", setNumber: 2, matchNumber: 1, sortTime: 5000 })
    );
    upsertMatch(
      db,
      match({ matchKey: "2024aaaa_sf1m1", eventKey: "2024aaaa", compLevel: "sf", setNumber: 1, matchNumber: 1, sortTime: 5000 })
    );

    const expectedOrder = [
      "2024aaaa_sf1m1",
      "2024aaaa_sf2m1",
      "2024aaaa_f1m2",
      "2024zzzz_qm1",
    ];

    const first = selectMatchesChronological(db).map((m) => m.matchKey);
    const second = selectMatchesChronological(db).map((m) => m.matchKey);

    expect(first).toEqual(expectedOrder);
    expect(second).toEqual(expectedOrder);
  });
});

describe("selectMatchesChronological — eventType round trip (plan 03-03 Task 1)", () => {
  it("carries the event_type its event row was upserted with", () => {
    upsertEvent(db, event({ eventKey: "2024casj", eventType: 3 }));
    upsertMatch(db, match({ matchKey: "2024casj_qm1", eventKey: "2024casj" }));

    const [row] = selectMatchesChronological(db, { eventKey: "2024casj" });
    expect(row?.eventType).toBe(3);
  });
});

describe("upsertMatch — idempotency", () => {
  it("upserting the same match twice leaves exactly one row", () => {
    upsertEvent(db, event());
    upsertMatch(db, match());
    upsertMatch(db, match({ redScore: 100, blueScore: 50 }));

    const count = db.prepare("SELECT COUNT(*) as n FROM matches").get() as { n: number };
    expect(count.n).toBe(1);
  });
});

describe("selectMatchesChronological — offseason exclusion", () => {
  it("omits matches belonging to an event flagged is_offseason when excludeOffseason is set", () => {
    upsertEvent(db, event({ eventKey: "2024normal", eventType: 0, isOffseason: false }));
    upsertEvent(db, event({ eventKey: "2024off", eventType: 99, isOffseason: true }));

    upsertMatch(db, match({ matchKey: "2024normal_qm1", eventKey: "2024normal", sortTime: 1 }));
    upsertMatch(db, match({ matchKey: "2024off_qm1", eventKey: "2024off", sortTime: 2 }));

    const withOffseason = selectMatchesChronological(db).map((m) => m.matchKey);
    expect(withOffseason).toContain("2024normal_qm1");
    expect(withOffseason).toContain("2024off_qm1");

    const withoutOffseason = selectMatchesChronological(db, { excludeOffseason: true }).map(
      (m) => m.matchKey
    );
    expect(withoutOffseason).toEqual(["2024normal_qm1"]);
  });
});

describe("upsertMatch — winner_imputed round trip (D-01/D-03, 01-REVIEW WR-06)", () => {
  it("a true winnerImputed flag survives a write/read round trip as 1", () => {
    upsertEvent(db, event());
    upsertMatch(db, match({ winnerImputed: true }));

    const row = db.prepare("SELECT winner_imputed FROM matches WHERE match_key = ?").get("2024casj_qm1") as {
      winner_imputed: number;
    };
    expect(row.winner_imputed).toBe(1);
  });

  it("a false winnerImputed flag survives a write/read round trip as 0", () => {
    upsertEvent(db, event());
    upsertMatch(db, match({ winnerImputed: false }));

    const row = db.prepare("SELECT winner_imputed FROM matches WHERE match_key = ?").get("2024casj_qm1") as {
      winner_imputed: number;
    };
    expect(row.winner_imputed).toBe(0);
  });

  it("a second upsert with a false flag overwrites a previously-stored true value (not sticky, unlike replayed)", () => {
    upsertEvent(db, event());
    upsertMatch(db, match({ winnerImputed: true }));
    upsertMatch(db, match({ winnerImputed: false }));

    const row = db.prepare("SELECT winner_imputed FROM matches WHERE match_key = ?").get("2024casj_qm1") as {
      winner_imputed: number;
    };
    expect(row.winner_imputed).toBe(0);
  });
});

describe("openCorpus — single-writer lock", () => {
  it("opening the same corpus file twice for writing throws a clear error", () => {
    expect(() => openCorpus(corpusPath)).toThrow(/already open for writing/);
  });

  it("allows reopening after the first handle is closed", () => {
    db.close();
    const reopened = openCorpus(corpusPath);
    expect(() => reopened.prepare("SELECT 1").get()).not.toThrow();
    reopened.close();
    // Reopen once more so the outer afterEach's db.close() doesn't error on an already-released lock.
    db = openCorpus(corpusPath);
  });
});

describe("openCorpus — atomic write-lock acquisition (WR-03)", () => {
  it("creates the lock file containing the current process id when none exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "sigmascout-lock-"));
    const freshPath = join(dir, "corpus.sqlite");
    const lockPath = `${freshPath}.lock`;
    try {
      const fresh = openCorpus(freshPath);
      expect(readFileSync(lockPath, "utf8")).toBe(String(process.pid));
      fresh.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws the existing already-open message when the recorded owner pid is alive, and never clobbers the lock file", () => {
    const dir = mkdtempSync(join(tmpdir(), "sigmascout-lock-"));
    const freshPath = join(dir, "corpus.sqlite");
    const lockPath = `${freshPath}.lock`;
    try {
      // Our own process id really is alive — simulates a live concurrent owner.
      writeFileSync(lockPath, String(process.pid), "utf8");

      expect(() => openCorpus(freshPath)).toThrow(/already open for writing/);
      // The throwing path must never write — the lock file still names the
      // original owner.
      expect(readFileSync(lockPath, "utf8")).toBe(String(process.pid));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("TOCTOU regression proof: a race-simulated 'lock file absent' probe must not let acquisition silently clobber an alive owner's lock", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sigmascout-lock-race-"));
    const freshPath = join(dir, "corpus.sqlite");
    const lockPath = `${freshPath}.lock`;
    try {
      // Our own process id really is alive — a live concurrent owner already
      // holds this lock.
      writeFileSync(lockPath, String(process.pid), "utf8");

      // Simulate the exact TOCTOU window a probe-then-write implementation
      // is exposed to: between a userspace existence check and the
      // eventual write, a genuinely concurrent second process could create
      // the file in between, making the earlier "absent" answer stale by
      // the time it's acted on. Forcing the probe to (incorrectly) report
      // "absent" here reproduces that window deterministically. The fixed
      // implementation's success path never calls existsSync at all — it
      // attempts a real atomic exclusive-create syscall, which the OS
      // itself rejects with EEXIST regardless of what any prior probe
      // believed — so this mock has no effect on it. Before the fix, this
      // same setup caused acquisition to skip the ownership check entirely
      // and silently overwrite the alive owner's lock file.
      const fsModule = await import("node:fs");
      (fsModule.existsSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

      let opened: Corpus | undefined;
      try {
        expect(() => {
          opened = openCorpus(freshPath);
        }).toThrow(/already open for writing/);
      } finally {
        opened?.close();
      }
      expect(readFileSync(lockPath, "utf8")).toBe(String(process.pid));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reclaims a lock file whose recorded pid is not alive", () => {
    const dir = mkdtempSync(join(tmpdir(), "sigmascout-lock-"));
    const freshPath = join(dir, "corpus.sqlite");
    const lockPath = `${freshPath}.lock`;
    try {
      // A pid vanishingly unlikely to be a live process on any test runner.
      writeFileSync(lockPath, "999999999", "utf8");

      const reclaimed = openCorpus(freshPath);
      expect(readFileSync(lockPath, "utf8")).toBe(String(process.pid));
      reclaimed.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reclaims a lock file whose contents are not a parseable pid", () => {
    const dir = mkdtempSync(join(tmpdir(), "sigmascout-lock-"));
    const freshPath = join(dir, "corpus.sqlite");
    const lockPath = `${freshPath}.lock`;
    try {
      writeFileSync(lockPath, "not-a-pid", "utf8");

      const reclaimed = openCorpus(freshPath);
      expect(readFileSync(lockPath, "utf8")).toBe(String(process.pid));
      reclaimed.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("WR-01 regression proof: does not let two concurrent stale-lock reclaimers both believe they hold the lock", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sigmascout-lock-reclaim-race-"));
    const freshPath = join(dir, "corpus.sqlite");
    const lockPath = `${freshPath}.lock`;
    try {
      // A dead pid — any reclaimer's isProcessAlive(...) check reads false.
      writeFileSync(lockPath, "999999999", "utf8");

      // Simulate a second, genuinely concurrent process winning the race to
      // reclaim: immediately after THIS process's own unlink of the stale
      // file (the first step of the atomic reclaim), a competitor
      // recreates the lock, atomically, under its own (alive) pid — exactly
      // what a second real `openCorpus` call doing the same
      // unlink-then-retry sequence would do if it got there microseconds
      // first. The fixed implementation must notice this on retry (its own
      // `wx` re-attempt now hits a real `EEXIST` against a LIVE owner) and
      // throw, rather than the old plain-`writeFileSync` reclaim, which had
      // no such re-check and would let both callers "win".
      const fsModule = await import("node:fs");
      const realUnlinkSync = (await vi.importActual<typeof import("node:fs")>("node:fs")).unlinkSync;
      (fsModule.unlinkSync as ReturnType<typeof vi.fn>).mockImplementationOnce((path: string) => {
        realUnlinkSync(path);
        writeFileSync(path, String(process.pid), { flag: "wx" });
      });

      // Pre-fix, this call does not throw at all — it silently reclaims a
      // second time, opening a real db handle. Capture and close it so the
      // `finally` block's directory cleanup does not fail on an open
      // Windows file handle regardless of which state (red or green) this
      // assertion runs against.
      let opened: Corpus | undefined;
      try {
        expect(() => {
          opened = openCorpus(freshPath);
        }).toThrow(/already open for writing/);
      } finally {
        opened?.close();
      }
      // The simulated competitor's (live) pid lock must survive untouched —
      // this process must not have clobbered it.
      expect(readFileSync(lockPath, "utf8")).toBe(String(process.pid));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("upsertTeam and recordIngestRun", () => {
  it("upserts team rows idempotently", () => {
    upsertTeam(db, { teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs" });
    upsertTeam(db, { teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs" });
    const row = db.prepare("SELECT COUNT(*) as n FROM teams").get() as { n: number };
    expect(row.n).toBe(1);
  });

  it("records an in-progress run as incomplete until finished", () => {
    recordIngestRun(db, {
      runId: "run-1",
      startedAt: "2026-08-13T00:00:00Z",
      finishedAt: null,
      seasonStart: 2022,
      seasonEnd: 2026,
      requestCount: 10,
      cacheHitCount: 3,
      completed: false,
    });

    expect(findIncompleteIngestRuns(db).map((r) => r.runId)).toEqual(["run-1"]);

    recordIngestRun(db, {
      runId: "run-1",
      startedAt: "2026-08-13T00:00:00Z",
      finishedAt: "2026-08-13T00:05:00Z",
      seasonStart: 2022,
      seasonEnd: 2026,
      requestCount: 20,
      cacheHitCount: 8,
      completed: true,
    });

    expect(findIncompleteIngestRuns(db)).toEqual([]);
  });
});

describe("upsertEvent — EVNT-01 location/calendar fields round trip (plan 05-02)", () => {
  it("round-trips name, week, country, stateProv and districtKey", () => {
    upsertEvent(
      db,
      event({
        eventKey: "2024fim",
        name: "FIM District Champs",
        week: 3,
        country: "USA",
        stateProv: "MI",
        districtKey: "fim",
      })
    );

    const row = db
      .prepare(`SELECT name, week, country, state_prov, district_key FROM events WHERE event_key = ?`)
      .get("2024fim") as {
      name: string | null;
      week: number | null;
      country: string | null;
      state_prov: string | null;
      district_key: string | null;
    };

    expect(row.name).toBe("FIM District Champs");
    expect(row.week).toBe(3);
    expect(row.country).toBe("USA");
    expect(row.state_prov).toBe("MI");
    expect(row.district_key).toBe("fim");
  });

  it("a null week, country, stateProv and districtKey survive the round trip as NULL, not a coerced default", () => {
    upsertEvent(
      db,
      event({
        eventKey: "2024off",
        week: null,
        country: null,
        stateProv: null,
        districtKey: null,
      })
    );

    const row = db
      .prepare(`SELECT week, country, state_prov, district_key FROM events WHERE event_key = ?`)
      .get("2024off") as {
      week: number | null;
      country: string | null;
      state_prov: string | null;
      district_key: string | null;
    };

    expect(row.week).toBeNull();
    expect(row.country).toBeNull();
    expect(row.state_prov).toBeNull();
    expect(row.district_key).toBeNull();
  });

  it("a second upsert with changed location values overwrites, rather than being ignored", () => {
    upsertEvent(db, event({ eventKey: "2024casj", week: null, country: null, stateProv: null, districtKey: null }));
    upsertEvent(
      db,
      event({ eventKey: "2024casj", week: 1, country: "USA", stateProv: "CA", districtKey: "pnw" })
    );

    const row = db
      .prepare(`SELECT week, country, state_prov, district_key FROM events WHERE event_key = ?`)
      .get("2024casj") as {
      week: number | null;
      country: string | null;
      state_prov: string | null;
      district_key: string | null;
    };

    expect(row.week).toBe(1);
    expect(row.country).toBe("USA");
    expect(row.state_prov).toBe("CA");
    expect(row.district_key).toBe("pnw");
  });
});

describe("selectScheduledMatches (D-08, plan 04-02 Task 3)", () => {
  it("returns only rows whose winner is NULL, partitioning exactly with selectMatchesChronological", () => {
    upsertEvent(db, event({ eventKey: "2026casj" }));
    upsertMatch(
      db,
      match({ matchKey: "2026casj_qm1", eventKey: "2026casj", sortTime: 1, winner: "red" })
    );
    upsertMatch(
      db,
      match({ matchKey: "2026casj_qm2", eventKey: "2026casj", matchNumber: 2, sortTime: 2, winner: null })
    );
    upsertMatch(
      db,
      match({ matchKey: "2026casj_qm3", eventKey: "2026casj", matchNumber: 3, sortTime: 3, winner: null })
    );

    const played = selectMatchesChronological(db, { eventKey: "2026casj" }).map((m) => m.matchKey);
    const scheduled = selectScheduledMatches(db, { eventKey: "2026casj" }).map((m) => m.matchKey);

    expect(played).toEqual(["2026casj_qm1"]);
    expect(scheduled).toEqual(["2026casj_qm2", "2026casj_qm3"]);

    // Partition property: disjoint, union covers every row for the event.
    const playedSet = new Set(played);
    const scheduledSet = new Set(scheduled);
    for (const key of playedSet) expect(scheduledSet.has(key)).toBe(false);
    for (const key of scheduledSet) expect(playedSet.has(key)).toBe(false);
    expect(new Set([...played, ...scheduled])).toEqual(new Set(["2026casj_qm1", "2026casj_qm2", "2026casj_qm3"]));
  });

  it("returned objects carry no OUTCOME_KEYS field — driven by the shared exported set, not a copied literal", () => {
    upsertEvent(db, event({ eventKey: "2026casj" }));
    upsertMatch(db, match({ matchKey: "2026casj_qm1", eventKey: "2026casj", winner: null }));

    const [result] = selectScheduledMatches(db, { eventKey: "2026casj" });
    expect(result).toBeDefined();
    const keys = Object.keys(result as object);
    for (const outcomeKey of OUTCOME_KEYS) {
      expect(keys).not.toContain(outcomeKey);
    }
  });

  it("results come back in the same five-key total order selectMatchesChronological uses", () => {
    upsertEvent(db, event({ eventKey: "2026aaaa" }));
    // All share sort_time = 5000; expected order: comp-level play order, then set_number, then match_number.
    upsertMatch(
      db,
      match({
        matchKey: "2026aaaa_f1m2",
        eventKey: "2026aaaa",
        compLevel: "f",
        setNumber: 1,
        matchNumber: 2,
        sortTime: 5000,
        winner: null,
      })
    );
    upsertMatch(
      db,
      match({
        matchKey: "2026aaaa_sf1m1",
        eventKey: "2026aaaa",
        compLevel: "sf",
        setNumber: 1,
        matchNumber: 1,
        sortTime: 5000,
        winner: null,
      })
    );
    upsertMatch(
      db,
      match({
        matchKey: "2026aaaa_qm1",
        eventKey: "2026aaaa",
        compLevel: "qm",
        setNumber: 1,
        matchNumber: 1,
        sortTime: 5000,
        winner: null,
      })
    );

    const order = selectScheduledMatches(db, { eventKey: "2026aaaa" }).map((m) => m.matchKey);
    expect(order).toEqual(["2026aaaa_qm1", "2026aaaa_sf1m1", "2026aaaa_f1m2"]);
  });

  it("an event with no unplayed matches returns [] — never undefined, never a throw", () => {
    upsertEvent(db, event({ eventKey: "2026allplayed" }));
    upsertMatch(db, match({ matchKey: "2026allplayed_qm1", eventKey: "2026allplayed", winner: "red" }));

    expect(selectScheduledMatches(db, { eventKey: "2026allplayed" })).toEqual([]);
  });

  it("an event key that does not exist returns []", () => {
    expect(selectScheduledMatches(db, { eventKey: "2026nonexistent" })).toEqual([]);
  });
});

describe("team_media — corpus table and accessors (plan 06-03 Task 1)", () => {
  it("an existing corpus file created before this change gains the table on open, with 0 rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "sigmascout-team-media-migration-"));
    const freshPath = join(dir, "corpus.sqlite");
    try {
      // Simulate a corpus built from the schema text as it existed before
      // this plan (no team_media table) — the additive CREATE TABLE IF NOT
      // EXISTS in schema.sql must not require this corpus to be rebuilt.
      const priorSchema = `
        CREATE TABLE IF NOT EXISTS teams (
          team_key TEXT PRIMARY KEY,
          team_number INTEGER NOT NULL,
          nickname TEXT
        );
        CREATE TABLE IF NOT EXISTS events (
          event_key TEXT PRIMARY KEY,
          year INTEGER NOT NULL,
          event_type INTEGER NOT NULL,
          is_offseason INTEGER NOT NULL,
          start_date TEXT NOT NULL,
          name TEXT, week INTEGER, country TEXT, state_prov TEXT, district_key TEXT
        );
        CREATE TABLE IF NOT EXISTS matches (
          match_key TEXT PRIMARY KEY,
          event_key TEXT NOT NULL REFERENCES events(event_key),
          comp_level TEXT NOT NULL, match_number INTEGER NOT NULL, set_number INTEGER NOT NULL,
          sort_time INTEGER NOT NULL, red_teams TEXT NOT NULL, blue_teams TEXT NOT NULL,
          red_surrogates TEXT NOT NULL, blue_surrogates TEXT NOT NULL,
          red_dqs TEXT NOT NULL, blue_dqs TEXT NOT NULL,
          winner TEXT, winner_imputed INTEGER NOT NULL DEFAULT 0,
          red_score INTEGER, blue_score INTEGER, red_rp_earned INTEGER, blue_rp_earned INTEGER,
          has_score_breakdown INTEGER NOT NULL, score_breakdown_raw TEXT,
          replayed INTEGER NOT NULL DEFAULT 0, replay_detected_at TEXT
        );
        CREATE TABLE IF NOT EXISTS http_cache (
          url TEXT PRIMARY KEY, etag TEXT NOT NULL, fetched_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ingest_runs (
          run_id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT,
          season_start INTEGER NOT NULL, season_end INTEGER NOT NULL,
          request_count INTEGER NOT NULL DEFAULT 0, cache_hit_count INTEGER NOT NULL DEFAULT 0,
          completed INTEGER NOT NULL DEFAULT 0
        );
      `;
      expect(priorSchema).not.toContain("team_media");
      const rawDb = new Database(freshPath);
      rawDb.pragma("foreign_keys = ON");
      rawDb.exec(priorSchema);
      rawDb.close();

      const reopened = openCorpus(freshPath);
      const row = reopened.prepare("SELECT count(*) as n FROM team_media").get() as { n: number };
      expect(row.n).toBe(0);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("insert-then-read round trip", () => {
    upsertTeam(db, { teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs" });
    upsertTeamMedia(db, {
      teamKey: "frc254",
      year: 2024,
      imageUrl: "https://i.imgur.com/1kDEW6V.jpeg",
      mediaType: "imgur",
      fetchedAt: "2026-08-25T00:00:00Z",
    });

    const media = selectTeamMediaForYear(db, 2024);
    expect(media.get("frc254")).toEqual({ imageUrl: "https://i.imgur.com/1kDEW6V.jpeg", mediaType: "imgur" });
  });

  it("upsert overwrite — a second call for the same (team_key, year) leaves exactly one row with the second call's value", () => {
    upsertTeam(db, { teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs" });
    upsertTeamMedia(db, {
      teamKey: "frc254",
      year: 2024,
      imageUrl: "https://i.imgur.com/first.jpeg",
      mediaType: "imgur",
      fetchedAt: "2026-08-25T00:00:00Z",
    });
    upsertTeamMedia(db, {
      teamKey: "frc254",
      year: 2024,
      imageUrl: "https://i.imgur.com/second.jpeg",
      mediaType: "imgur",
      fetchedAt: "2026-08-25T01:00:00Z",
    });

    const count = db.prepare("SELECT COUNT(*) as n FROM team_media").get() as { n: number };
    expect(count.n).toBe(1);
    const media = selectTeamMediaForYear(db, 2024);
    expect(media.get("frc254")?.imageUrl).toBe("https://i.imgur.com/second.jpeg");
  });

  it("a null imageUrl round-trips as null, not an empty string — a photoless team is present with imageUrl: null", () => {
    upsertTeam(db, { teamKey: "frc1", teamNumber: 1, nickname: null });
    upsertTeamMedia(db, {
      teamKey: "frc1",
      year: 2024,
      imageUrl: null,
      mediaType: null,
      fetchedAt: "2026-08-25T00:00:00Z",
    });

    const media = selectTeamMediaForYear(db, 2024);
    expect(media.has("frc1")).toBe(true);
    expect(media.get("frc1")?.imageUrl).toBeNull();
  });

  it("selectTeamKeysForYear returns the union of both alliances across two events, sorted, no duplicates", () => {
    upsertEvent(db, event({ eventKey: "2024aaaa" }));
    upsertEvent(db, event({ eventKey: "2024bbbb" }));
    upsertMatch(
      db,
      match({
        matchKey: "2024aaaa_qm1",
        eventKey: "2024aaaa",
        redTeams: ["frc1", "frc2", "frc3"],
        blueTeams: ["frc4", "frc5", "frc6"],
      })
    );
    upsertMatch(
      db,
      match({
        matchKey: "2024bbbb_qm1",
        eventKey: "2024bbbb",
        redTeams: ["frc1", "frc7", "frc8"], // frc1 shared with the first event
        blueTeams: ["frc9", "frc10", "frc11"],
      })
    );

    const keys = selectTeamKeysForYear(db, 2024);
    expect(keys).toEqual([
      "frc1",
      "frc10",
      "frc11",
      "frc2",
      "frc3",
      "frc4",
      "frc5",
      "frc6",
      "frc7",
      "frc8",
      "frc9",
    ]);
  });

  it("selectTeamKeysForYear excludes offseason events when excludeOffseason is set", () => {
    upsertEvent(db, event({ eventKey: "2024normal", eventType: 0, isOffseason: false }));
    upsertEvent(db, event({ eventKey: "2024off", eventType: 99, isOffseason: true }));
    upsertMatch(
      db,
      match({
        matchKey: "2024normal_qm1",
        eventKey: "2024normal",
        redTeams: ["frc1", "frc2", "frc3"],
        blueTeams: ["frc4", "frc5", "frc6"],
      })
    );
    upsertMatch(
      db,
      match({
        matchKey: "2024off_qm1",
        eventKey: "2024off",
        redTeams: ["frc20", "frc21", "frc22"],
        blueTeams: ["frc23", "frc24", "frc25"],
      })
    );

    const withOffseason = selectTeamKeysForYear(db, 2024);
    expect(withOffseason).toContain("frc20");

    const withoutOffseason = selectTeamKeysForYear(db, 2024, { excludeOffseason: true });
    expect(withoutOffseason).not.toContain("frc20");
    expect(withoutOffseason).toEqual(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]);
  });
});

interface AllianceOverrides {
  eventKey?: string;
  allianceNumber?: number;
  name?: string | null;
  picks?: string[];
  declines?: string[];
  statusRaw?: string | null;
  fetchedAt?: string;
}

function alliance(overrides: AllianceOverrides = {}) {
  return {
    eventKey: "2024casj",
    allianceNumber: 1,
    name: "Alliance 1",
    picks: ["frc1", "frc2", "frc3"],
    declines: [],
    statusRaw: null,
    fetchedAt: "2026-08-27T00:00:00Z",
    ...overrides,
  };
}

describe("event_alliances — corpus table and accessors (plan 07-02 Task 1)", () => {
  it("an existing corpus file created before this change gains the table on open, with 0 rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "sigmascout-event-alliances-migration-"));
    const freshPath = join(dir, "corpus.sqlite");
    try {
      // Simulate a corpus built from the schema text as it existed before
      // this plan (no event_alliances table) — the additive CREATE TABLE IF
      // NOT EXISTS in schema.sql must not require this corpus to be
      // rebuilt.
      const priorSchema = `
        CREATE TABLE IF NOT EXISTS teams (
          team_key TEXT PRIMARY KEY,
          team_number INTEGER NOT NULL,
          nickname TEXT
        );
        CREATE TABLE IF NOT EXISTS events (
          event_key TEXT PRIMARY KEY,
          year INTEGER NOT NULL,
          event_type INTEGER NOT NULL,
          is_offseason INTEGER NOT NULL,
          start_date TEXT NOT NULL,
          name TEXT, week INTEGER, country TEXT, state_prov TEXT, district_key TEXT
        );
        CREATE TABLE IF NOT EXISTS matches (
          match_key TEXT PRIMARY KEY,
          event_key TEXT NOT NULL REFERENCES events(event_key),
          comp_level TEXT NOT NULL, match_number INTEGER NOT NULL, set_number INTEGER NOT NULL,
          sort_time INTEGER NOT NULL, red_teams TEXT NOT NULL, blue_teams TEXT NOT NULL,
          red_surrogates TEXT NOT NULL, blue_surrogates TEXT NOT NULL,
          red_dqs TEXT NOT NULL, blue_dqs TEXT NOT NULL,
          winner TEXT, winner_imputed INTEGER NOT NULL DEFAULT 0,
          red_score INTEGER, blue_score INTEGER, red_rp_earned INTEGER, blue_rp_earned INTEGER,
          has_score_breakdown INTEGER NOT NULL, score_breakdown_raw TEXT,
          replayed INTEGER NOT NULL DEFAULT 0, replay_detected_at TEXT
        );
        CREATE TABLE IF NOT EXISTS http_cache (
          url TEXT PRIMARY KEY, etag TEXT NOT NULL, fetched_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ingest_runs (
          run_id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT,
          season_start INTEGER NOT NULL, season_end INTEGER NOT NULL,
          request_count INTEGER NOT NULL DEFAULT 0, cache_hit_count INTEGER NOT NULL DEFAULT 0,
          completed INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS event_rankings (
          event_key TEXT NOT NULL REFERENCES events(event_key),
          team_key TEXT NOT NULL REFERENCES teams(team_key),
          rank INTEGER NOT NULL, total_teams INTEGER NOT NULL, fetched_at TEXT NOT NULL,
          PRIMARY KEY (event_key, team_key)
        );
      `;
      expect(priorSchema).not.toContain("event_alliances");
      const rawDb = new Database(freshPath);
      rawDb.pragma("foreign_keys = ON");
      rawDb.exec(priorSchema);
      rawDb.close();

      const reopened = openCorpus(freshPath);
      const row = reopened.prepare("SELECT count(*) as n FROM event_alliances").get() as { n: number };
      expect(row.n).toBe(0);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("insert-then-read round trip: allianceNumber, name and picks come back identical, picks in the same order", () => {
    upsertEvent(db, event({ eventKey: "2024casj" }));
    upsertEventAlliance(db, alliance({ eventKey: "2024casj", allianceNumber: 1, name: "Alliance 1", picks: ["frc3", "frc1", "frc2"] }));

    const result = selectEventAlliancesForSeason(db, 2024);
    expect(result.get("2024casj")).toEqual([{ allianceNumber: 1, name: "Alliance 1", picks: ["frc3", "frc1", "frc2"], record: null }]);
  });

  it("a name of null round-trips as null, not an empty string and not a generated label", () => {
    upsertEvent(db, event({ eventKey: "2024wvrox" }));
    upsertEventAlliance(db, alliance({ eventKey: "2024wvrox", allianceNumber: 1, name: null }));

    const [row] = selectEventAlliancesForSeason(db, 2024).get("2024wvrox") ?? [];
    expect(row?.name).toBeNull();
  });

  it("a 4-pick alliance round-trips with picks.length 4 and picks[3] holding the 4th (backup) team key", () => {
    upsertEvent(db, event({ eventKey: "2024roe" }));
    upsertEventAlliance(
      db,
      alliance({ eventKey: "2024roe", allianceNumber: 1, picks: ["frc3310", "frc67", "frc4451", "frc3539"] })
    );

    const [row] = selectEventAlliancesForSeason(db, 2024).get("2024roe") ?? [];
    expect(row?.picks).toHaveLength(4);
    expect(row?.picks[3]).toBe("frc3539");
  });

  it("a 3-pick alliance round-trips with picks.length 3", () => {
    upsertEvent(db, event({ eventKey: "2024casj" }));
    upsertEventAlliance(db, alliance({ eventKey: "2024casj", allianceNumber: 1, picks: ["frc1", "frc2", "frc3"] }));

    const [row] = selectEventAlliancesForSeason(db, 2024).get("2024casj") ?? [];
    expect(row?.picks).toHaveLength(3);
  });

  it("two upserts for the same (event_key, alliance_number) leave exactly one row carrying the second call's values", () => {
    upsertEvent(db, event({ eventKey: "2024casj" }));
    upsertEventAlliance(db, alliance({ eventKey: "2024casj", allianceNumber: 1, picks: ["frc1", "frc2", "frc3"] }));
    upsertEventAlliance(db, alliance({ eventKey: "2024casj", allianceNumber: 1, picks: ["frc9", "frc8", "frc7"] }));

    const count = db.prepare("SELECT COUNT(*) as n FROM event_alliances").get() as { n: number };
    expect(count.n).toBe(1);
    const [row] = selectEventAlliancesForSeason(db, 2024).get("2024casj") ?? [];
    expect(row?.picks).toEqual(["frc9", "frc8", "frc7"]);
  });

  it("the same alliance_number under a second event_key leaves two rows, not merged", () => {
    upsertEvent(db, event({ eventKey: "2024aaaa" }));
    upsertEvent(db, event({ eventKey: "2024bbbb" }));
    upsertEventAlliance(db, alliance({ eventKey: "2024aaaa", allianceNumber: 1 }));
    upsertEventAlliance(db, alliance({ eventKey: "2024bbbb", allianceNumber: 1 }));

    const count = db.prepare("SELECT COUNT(*) as n FROM event_alliances").get() as { n: number };
    expect(count.n).toBe(2);
  });

  it("an event for which nothing was ever upserted is absent from the returned map entirely — no key, no zero-row placeholder", () => {
    upsertEvent(db, event({ eventKey: "2024noalliances" }));

    const result = selectEventAlliancesForSeason(db, 2024);
    expect(result.has("2024noalliances")).toBe(false);
  });

  it("returns alliances ascending by alliance_number even when inserted in descending/shuffled order", () => {
    upsertEvent(db, event({ eventKey: "2024shuffled" }));
    upsertEventAlliance(db, alliance({ eventKey: "2024shuffled", allianceNumber: 3 }));
    upsertEventAlliance(db, alliance({ eventKey: "2024shuffled", allianceNumber: 1 }));
    upsertEventAlliance(db, alliance({ eventKey: "2024shuffled", allianceNumber: 2 }));

    const rows = selectEventAlliancesForSeason(db, 2024).get("2024shuffled") ?? [];
    expect(rows.map((r) => r.allianceNumber)).toEqual([1, 2, 3]);
  });

  it("selectEventAlliancesForSeason(db, 2024) returns alliances only for events whose events.year is 2024", () => {
    upsertEvent(db, event({ eventKey: "2023old", year: 2023 }));
    upsertEvent(db, event({ eventKey: "2024new", year: 2024 }));
    upsertEventAlliance(db, alliance({ eventKey: "2023old", allianceNumber: 1 }));
    upsertEventAlliance(db, alliance({ eventKey: "2024new", allianceNumber: 1 }));

    const result = selectEventAlliancesForSeason(db, 2024);
    expect(result.has("2023old")).toBe(false);
    expect(result.has("2024new")).toBe(true);
  });
});

describe("parseAllianceRecord — the alliance playoff win-loss-tie record, absence discipline (07-UAT.md G-8)", () => {
  it("a real TBA status object round-trips its record, extra keys (status/level/double_elim_round) ignored", () => {
    const statusRaw = JSON.stringify({ record: { losses: 3, ties: 0, wins: 4 }, status: "eliminated", level: "f", double_elim_round: "Finals" });
    expect(parseAllianceRecord(statusRaw)).toEqual({ wins: 4, losses: 3, ties: 0 });
  });

  it("null statusRaw (no status ever recorded) returns null, never a fabricated 0-0-0", () => {
    expect(parseAllianceRecord(null)).toBeNull();
  });

  it("statusRaw that is not valid JSON returns null rather than throwing", () => {
    expect(parseAllianceRecord("{not json")).toBeNull();
  });

  it("statusRaw that parses as JSON but carries no record key at all returns null", () => {
    expect(parseAllianceRecord(JSON.stringify({ status: "unknown" }))).toBeNull();
  });

  it("a record object missing one of the three counts (partial shape) returns null, never a two-of-three partial", () => {
    expect(parseAllianceRecord(JSON.stringify({ record: { wins: 4, losses: 3 } }))).toBeNull();
  });

  it("a real 0-0-0 record (genuinely no playoff matches decided yet) round-trips as real zeros, distinct from the null-absence case", () => {
    const result = parseAllianceRecord(JSON.stringify({ record: { wins: 0, losses: 0, ties: 0 } }));
    expect(result).toEqual({ wins: 0, losses: 0, ties: 0 });
    expect(result).not.toBeNull();
  });

  it("selectEventAlliancesForSeason parses a real status_raw round trip through the corpus into `record`", () => {
    upsertEvent(db, event({ eventKey: "2024casj" }));
    upsertEventAlliance(
      db,
      alliance({
        eventKey: "2024casj",
        allianceNumber: 1,
        statusRaw: JSON.stringify({ record: { wins: 4, losses: 3, ties: 0 }, status: "eliminated", level: "f" }),
      }),
    );

    const [row] = selectEventAlliancesForSeason(db, 2024).get("2024casj") ?? [];
    expect(row?.record).toEqual({ wins: 4, losses: 3, ties: 0 });
  });

  it("selectEventAlliancesForSeason leaves `record` null when statusRaw carries an unmodelled playoff_type shape (no record key)", () => {
    upsertEvent(db, event({ eventKey: "2024noplayoffs" }));
    upsertEventAlliance(db, alliance({ eventKey: "2024noplayoffs", allianceNumber: 1, statusRaw: JSON.stringify({ playoff_type: 10 }) }));

    const [row] = selectEventAlliancesForSeason(db, 2024).get("2024noplayoffs") ?? [];
    expect(row?.record).toBeNull();
  });
});

/** An `event_rankings` table shaped exactly like the pre-07-02 schema — five columns, none of D-18.6's new record/ranking-score fields. */
function createLegacyEventRankingsTable(rawDb: Database.Database): void {
  rawDb.exec(`
    CREATE TABLE event_rankings (
      event_key TEXT NOT NULL REFERENCES events(event_key),
      team_key TEXT NOT NULL REFERENCES teams(team_key),
      rank INTEGER NOT NULL,
      total_teams INTEGER NOT NULL,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (event_key, team_key)
    );
  `);
}

describe("event_rankings — record and ranking-score columns (plan 07-02 Task 2)", () => {
  it("a CorpusEventRanking written without any of the four new fields stores NULL in all four columns, read back as null", () => {
    upsertEvent(db, event({ eventKey: "2024casj" }));
    upsertTeam(db, { teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs" });
    upsertEventRanking(db, { eventKey: "2024casj", teamKey: "frc254", rank: 1, totalTeams: 40, fetchedAt: "2026-08-27T00:00:00Z" });

    const result = selectEventRankingsForSeason(db, 2024).get("2024casj")?.get("frc254");
    expect(result?.recordWins).toBeNull();
    expect(result?.recordLosses).toBeNull();
    expect(result?.recordTies).toBeNull();
    expect(result?.rankingScore).toBeNull();
  });

  it("a CorpusEventRanking written with all four values round-trips each exactly, including a fractional ranking_score", () => {
    upsertEvent(db, event({ eventKey: "2024casj" }));
    upsertTeam(db, { teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs" });
    upsertEventRanking(db, {
      eventKey: "2024casj",
      teamKey: "frc254",
      rank: 1,
      totalTeams: 40,
      fetchedAt: "2026-08-27T00:00:00Z",
      recordWins: 9,
      recordLosses: 1,
      recordTies: 0,
      rankingScore: 3.83,
    });

    const result = selectEventRankingsForSeason(db, 2024).get("2024casj")?.get("frc254");
    expect(result?.recordWins).toBe(9);
    expect(result?.recordLosses).toBe(1);
    expect(result?.recordTies).toBe(0);
    expect(result?.rankingScore).toBe(3.83);
  });

  it("a ranking_score of exactly 0 round-trips as 0, distinguishable from null", () => {
    upsertEvent(db, event({ eventKey: "2024casj" }));
    upsertTeam(db, { teamKey: "frc9999", teamNumber: 9999, nickname: null });
    upsertEventRanking(db, {
      eventKey: "2024casj",
      teamKey: "frc9999",
      rank: 40,
      totalTeams: 40,
      fetchedAt: "2026-08-27T00:00:00Z",
      recordWins: 0,
      recordLosses: 10,
      recordTies: 0,
      rankingScore: 0,
    });

    const result = selectEventRankingsForSeason(db, 2024).get("2024casj")?.get("frc9999");
    expect(result?.rankingScore).toBe(0);
    expect(result?.rankingScore).not.toBeNull();
  });

  it("hasEventRankingRecordColumns is false when even one of the four is missing, true when all four are present", () => {
    const legacyDir = mkdtempSync(join(tmpdir(), "sigmascout-ranking-columns-partial-"));
    const legacyPath = join(legacyDir, "legacy.sqlite");
    try {
      const rawDb = new Database(legacyPath);
      createLegacyEventRankingsTable(rawDb);
      rawDb.exec(`ALTER TABLE event_rankings ADD COLUMN record_wins INTEGER`);
      rawDb.exec(`ALTER TABLE event_rankings ADD COLUMN record_losses INTEGER`);
      rawDb.exec(`ALTER TABLE event_rankings ADD COLUMN record_ties INTEGER`);
      // ranking_score deliberately omitted — one of the four is missing.
      expect(hasEventRankingRecordColumns(rawDb)).toBe(false);
      rawDb.exec(`ALTER TABLE event_rankings ADD COLUMN ranking_score REAL`);
      expect(hasEventRankingRecordColumns(rawDb)).toBe(true);
      rawDb.close();
    } finally {
      rmSync(legacyDir, { recursive: true, force: true });
    }
  });

  it("a legacy event_rankings table gains all four columns on the next openCorpus, with every pre-existing row's rank/total_teams/fetched_at unchanged and the row count unchanged", () => {
    const legacyDir = mkdtempSync(join(tmpdir(), "sigmascout-ranking-columns-migrate-"));
    const legacyPath = join(legacyDir, "legacy.sqlite");
    try {
      const rawDb = new Database(legacyPath);
      rawDb.pragma("foreign_keys = ON");
      rawDb.exec(`
        CREATE TABLE teams (team_key TEXT PRIMARY KEY, team_number INTEGER NOT NULL, nickname TEXT);
        CREATE TABLE events (
          event_key TEXT PRIMARY KEY, year INTEGER NOT NULL, event_type INTEGER NOT NULL,
          is_offseason INTEGER NOT NULL, start_date TEXT NOT NULL
        );
      `);
      createLegacyEventRankingsTable(rawDb);
      rawDb.exec(`INSERT INTO events (event_key, year, event_type, is_offseason, start_date) VALUES ('2024casj', 2024, 0, 0, '2024-03-01')`);
      rawDb.exec(`INSERT INTO teams (team_key, team_number, nickname) VALUES ('frc1', 1, NULL), ('frc2', 2, NULL), ('frc3', 3, NULL)`);
      const seeded = [
        { teamKey: "frc1", rank: 1, totalTeams: 40, fetchedAt: "2026-08-01T00:00:00Z" },
        { teamKey: "frc2", rank: 2, totalTeams: 40, fetchedAt: "2026-08-01T00:00:00Z" },
        { teamKey: "frc3", rank: 3, totalTeams: 40, fetchedAt: "2026-08-01T00:00:00Z" },
      ];
      for (const row of seeded) {
        rawDb
          .prepare(
            `INSERT INTO event_rankings (event_key, team_key, rank, total_teams, fetched_at) VALUES (?, ?, ?, ?, ?)`
          )
          .run("2024casj", row.teamKey, row.rank, row.totalTeams, row.fetchedAt);
      }
      rawDb.close();

      const migrated = openCorpus(legacyPath);
      try {
        expect(hasEventRankingRecordColumns(migrated)).toBe(true);
        const count = migrated.prepare(`SELECT COUNT(*) as n FROM event_rankings`).get() as { n: number };
        expect(count.n).toBe(3);
        for (const row of seeded) {
          const readBack = migrated
            .prepare(`SELECT rank, total_teams, fetched_at FROM event_rankings WHERE team_key = ?`)
            .get(row.teamKey) as { rank: number; total_teams: number; fetched_at: string };
          expect(readBack.rank).toBe(row.rank);
          expect(readBack.total_teams).toBe(row.totalTeams);
          expect(readBack.fetched_at).toBe(row.fetchedAt);
        }
      } finally {
        migrated.close();
      }
    } finally {
      rmSync(legacyDir, { recursive: true, force: true });
    }
  });

  it("a fresh corpus and a legacy-migrated corpus end with identical PRAGMA table_info(event_rankings) column-name sets, of length 9", () => {
    const legacyDir = mkdtempSync(join(tmpdir(), "sigmascout-ranking-columns-fresh-vs-migrated-legacy-"));
    const legacyPath = join(legacyDir, "legacy.sqlite");
    const freshDir = mkdtempSync(join(tmpdir(), "sigmascout-ranking-columns-fresh-vs-migrated-fresh-"));
    const freshPath = join(freshDir, "fresh.sqlite");
    try {
      const rawDb = new Database(legacyPath);
      rawDb.exec(`
        CREATE TABLE teams (team_key TEXT PRIMARY KEY, team_number INTEGER NOT NULL, nickname TEXT);
        CREATE TABLE events (
          event_key TEXT PRIMARY KEY, year INTEGER NOT NULL, event_type INTEGER NOT NULL,
          is_offseason INTEGER NOT NULL, start_date TEXT NOT NULL
        );
      `);
      createLegacyEventRankingsTable(rawDb);
      rawDb.close();

      const migrated = openCorpus(legacyPath);
      const fresh = openCorpus(freshPath);
      try {
        const migratedNames = (migrated.prepare(`PRAGMA table_info(event_rankings)`).all() as { name: string }[])
          .map((c) => c.name)
          .sort();
        const freshNames = (fresh.prepare(`PRAGMA table_info(event_rankings)`).all() as { name: string }[])
          .map((c) => c.name)
          .sort();
        expect(migratedNames).toEqual(freshNames);
        expect(migratedNames).toHaveLength(9);
      } finally {
        migrated.close();
        fresh.close();
      }
    } finally {
      rmSync(legacyDir, { recursive: true, force: true });
      rmSync(freshDir, { recursive: true, force: true });
    }
  });

  it("re-opening an already-migrated corpus runs no ALTER and throws nothing — idempotent", () => {
    const dir = mkdtempSync(join(tmpdir(), "sigmascout-ranking-columns-idempotent-"));
    const path = join(dir, "corpus.sqlite");
    try {
      const first = openCorpus(path);
      first.close();
      expect(() => {
        const second = openCorpus(path);
        second.close();
      }).not.toThrow();

      const reopened = openCorpus(path);
      try {
        const count = reopened.prepare(`SELECT COUNT(*) as n FROM event_rankings`).get() as { n: number };
        expect(count.n).toBe(0);
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("selectEventRankingsForSeason returns the four new values alongside rank/totalTeams, null for any not stored", () => {
    upsertEvent(db, event({ eventKey: "2024casj" }));
    upsertTeam(db, { teamKey: "frc1", teamNumber: 1, nickname: null });
    upsertTeam(db, { teamKey: "frc2", teamNumber: 2, nickname: null });
    upsertEventRanking(db, {
      eventKey: "2024casj",
      teamKey: "frc1",
      rank: 1,
      totalTeams: 40,
      fetchedAt: "2026-08-27T00:00:00Z",
      recordWins: 9,
      recordLosses: 1,
      recordTies: 0,
      rankingScore: 3.9,
    });
    upsertEventRanking(db, { eventKey: "2024casj", teamKey: "frc2", rank: 2, totalTeams: 40, fetchedAt: "2026-08-27T00:00:00Z" });

    const bySeason = selectEventRankingsForSeason(db, 2024).get("2024casj");
    expect(bySeason?.get("frc1")).toEqual({
      rank: 1,
      totalTeams: 40,
      recordWins: 9,
      recordLosses: 1,
      recordTies: 0,
      rankingScore: 3.9,
    });
    expect(bySeason?.get("frc2")).toEqual({
      rank: 2,
      totalTeams: 40,
      recordWins: null,
      recordLosses: null,
      recordTies: null,
      rankingScore: null,
    });
  });
});
