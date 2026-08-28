/**
 * Corpus integrity checks (D-02/D-03/D-04, 01-REVIEW WR-04): foreign-key
 * enforcement at corpus open, the `winner_imputed` schema guard, and the
 * two asymmetric regression baselines those fixes exist to protect — an
 * orphan-match count that must always be 0, and an imputed-winner count
 * that is merely reported, never asserted (D-04). The temp-path block below
 * needs no real corpus and always runs; the corpus-backed block skips
 * cleanly, with an explicit named message, when `data/corpus.sqlite` is
 * absent or predates the `winner_imputed` column — never a silent pass.
 * Mirrors `packages/harness/digest.test.ts`'s
 * `CORPUS_AVAILABLE`/skip-with-message shape.
 */
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CorpusEvent, CorpusMatch } from "../ingest/normalize.js";
import {
  hasEventLocationColumns,
  hasEventRankingRecordColumns,
  hasWinnerImputedColumn,
  openCorpus,
  openCorpusReadOnly,
  selectImputedWinnerCount,
  selectOrphanMatchCount,
  upsertMatch,
  type Corpus,
} from "./db.js";

const CORPUS_PATH = "data/corpus.sqlite";
const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);

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

/** A `matches` table shaped exactly like the pre-D-03 schema — every column `schema.sql` had before `winner_imputed` was added, nothing more. */
function createLegacyMatchesTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE matches (
      match_key TEXT PRIMARY KEY,
      event_key TEXT NOT NULL,
      comp_level TEXT NOT NULL,
      match_number INTEGER NOT NULL,
      set_number INTEGER NOT NULL,
      sort_time INTEGER NOT NULL,
      red_teams TEXT NOT NULL,
      blue_teams TEXT NOT NULL,
      red_surrogates TEXT NOT NULL,
      blue_surrogates TEXT NOT NULL,
      red_dqs TEXT NOT NULL,
      blue_dqs TEXT NOT NULL,
      winner TEXT,
      red_score INTEGER,
      blue_score INTEGER,
      red_rp_earned INTEGER,
      blue_rp_earned INTEGER,
      has_score_breakdown INTEGER NOT NULL,
      score_breakdown_raw TEXT,
      replayed INTEGER NOT NULL DEFAULT 0,
      replay_detected_at TEXT
    );
  `);
}

/** An `events` table shaped exactly like the pre-05-02 schema — five columns, none of EVNT-01's new location/calendar fields. */
function createLegacyEventsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE events (
      event_key TEXT PRIMARY KEY,
      year INTEGER NOT NULL,
      event_type INTEGER NOT NULL,
      is_offseason INTEGER NOT NULL,
      start_date TEXT NOT NULL
    );
  `);
}

describe("openCorpus — foreign-key enforcement and schema guard (D-02/D-03, 01-REVIEW WR-04)", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-integrity-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads back PRAGMA foreign_keys as enabled", () => {
    const row = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);
  });

  it("throws when inserting a match whose event_key has no matching events row", () => {
    expect(() => upsertMatch(db, match({ eventKey: "2024doesnotexist" }))).toThrow(
      /FOREIGN KEY constraint failed/i
    );
  });

  it("hasWinnerImputedColumn is true for a corpus created by the current schema.sql", () => {
    expect(hasWinnerImputedColumn(db)).toBe(true);
  });

  it("hasWinnerImputedColumn is false for a matches table created without the column", () => {
    const legacyDir = mkdtempSync(join(tmpdir(), "sigmascout-integrity-legacy-"));
    const legacyDb = new Database(join(legacyDir, "legacy.sqlite"));
    try {
      createLegacyMatchesTable(legacyDb);
      expect(hasWinnerImputedColumn(legacyDb)).toBe(false);
    } finally {
      legacyDb.close();
      rmSync(legacyDir, { recursive: true, force: true });
    }
  });

  it("openCorpus throws a named error naming the database path and the remedy when the matches table predates winner_imputed", () => {
    const legacyDir = mkdtempSync(join(tmpdir(), "sigmascout-integrity-legacy-open-"));
    const legacyPath = join(legacyDir, "legacy.sqlite");
    const seedDb = new Database(legacyPath);
    createLegacyMatchesTable(seedDb);
    seedDb.close();

    try {
      let caught: unknown;
      try {
        openCorpus(legacyPath);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      const message = (caught as Error).message;
      expect(message).toContain(legacyPath);
      expect(message).toContain("pnpm ingest");
    } finally {
      rmSync(legacyDir, { recursive: true, force: true });
    }
  });
});

describe("hasEventLocationColumns — additive migration path (EVNT-01, plan 05-02)", () => {
  it("is true for a corpus created by the current schema.sql", () => {
    const dir = mkdtempSync(join(tmpdir(), "sigmascout-integrity-events-"));
    const db = openCorpus(join(dir, "corpus.sqlite"));
    try {
      expect(hasEventLocationColumns(db)).toBe(true);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is false for an events table created without the five location/calendar columns", () => {
    const legacyDir = mkdtempSync(join(tmpdir(), "sigmascout-integrity-events-legacy-"));
    const legacyDb = new Database(join(legacyDir, "legacy.sqlite"));
    try {
      createLegacyEventsTable(legacyDb);
      expect(hasEventLocationColumns(legacyDb)).toBe(false);
    } finally {
      legacyDb.close();
      rmSync(legacyDir, { recursive: true, force: true });
    }
  });

  it("is true again after openCorpus runs the additive migration over a legacy database — proving the migration path, not just the predicate", () => {
    const legacyDir = mkdtempSync(join(tmpdir(), "sigmascout-integrity-events-migrate-"));
    const legacyPath = join(legacyDir, "legacy.sqlite");
    const seedDb = new Database(legacyPath);
    // Only `events` is pre-created in the legacy (pre-05-02) shape. `matches`
    // is deliberately left absent: openCorpus's own `CREATE TABLE IF NOT
    // EXISTS` (schema.sql) then creates it fresh, already carrying
    // winner_imputed (D-03) — so that older guard passes and this test
    // exercises only the events-location migration path.
    createLegacyEventsTable(seedDb);
    seedDb.close();

    try {
      const migrated = openCorpus(legacyPath);
      try {
        expect(hasEventLocationColumns(migrated)).toBe(true);
        // The migration is additive, not destructive — the pre-existing
        // events table (though empty here) still opens and is queryable
        // with the new columns present.
        const columns = migrated.prepare(`PRAGMA table_info(events)`).all() as { name: string }[];
        const names = new Set(columns.map((c) => c.name));
        for (const col of ["name", "week", "country", "state_prov", "district_key"]) {
          expect(names.has(col)).toBe(true);
        }
      } finally {
        migrated.close();
      }
    } finally {
      rmSync(legacyDir, { recursive: true, force: true });
    }
  });
});

describe("corpus-backed integrity report (D-04)", () => {
  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} is absent — run the ingest pipeline (pnpm ingest) to generate it`, () => {});
    return;
  }

  const readDb = openCorpusReadOnly(CORPUS_PATH);
  const columnPresent = hasWinnerImputedColumn(readDb);

  if (!columnPresent) {
    readDb.close();
    it.skip(
      `skipped: ${CORPUS_PATH} predates the winner_imputed column — delete it along with its -wal/-shm ` +
        `siblings and re-run pnpm ingest`,
      () => {}
    );
    return;
  }

  it("asserts the orphan match count is 0 and reports (never asserts) the imputed-winner count", () => {
    try {
      const orphanCount = selectOrphanMatchCount(readDb);
      const imputedWinnerCount = selectImputedWinnerCount(readDb);

      // eslint-disable-next-line no-console
      console.log(`corpus integrity: ${imputedWinnerCount} match(es) have a score-derived (imputed) winner`);

      expect(orphanCount).toBe(0);
    } finally {
      readDb.close();
    }
  });
});

/**
 * D-18.6/D-18.7, plan 07-02 Task 3. This is the only place the
 * non-destructiveness of this plan's schema change (the four
 * `event_rankings` ALTER TABLE ADD COLUMN statements, plus the brand-new
 * `event_alliances` table) against a populated, unrecoverable, gitignored
 * ~359 MB database is checked. It runs only on a machine holding
 * `data/corpus.sqlite` — corpus-gated behind `CORPUS_AVAILABLE`, skipping
 * with an explicit named message when absent, never a silent pass, matching
 * this file's own header discipline. It is a regression guard, not a
 * one-shot script: re-running it after 07-05's ingest (which will populate
 * `event_alliances` and refresh `event_rankings`' four new columns) must
 * still pass.
 */
describe("event_alliances / event_rankings migration against the real corpus (plan 07-02 Task 3)", () => {
  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} is absent — run the ingest pipeline (pnpm ingest) to generate it`, () => {});
    return;
  }

  it("migrates the real corpus in place: event_rankings row count is unchanged, event_alliances exists, and the four new columns are present", () => {
    const beforeDb = openCorpusReadOnly(CORPUS_PATH);
    const before = (beforeDb.prepare(`SELECT COUNT(*) as n FROM event_rankings`).get() as { n: number }).n;
    beforeDb.close();

    let db: Corpus | undefined;
    try {
      // This is the call that runs Task 2's ALTER TABLE block against the
      // real corpus for the first time.
      db = openCorpus(CORPUS_PATH);

      expect(hasEventRankingRecordColumns(db)).toBe(true);

      // The table exists after the migration — do not assert it is zero;
      // 07-05 will populate it and this guard has to keep passing
      // afterwards.
      const allianceCount = (db.prepare(`SELECT COUNT(*) as n FROM event_alliances`).get() as { n: number }).n;
      expect(typeof allianceCount).toBe("number");

      const after = (db.prepare(`SELECT COUNT(*) as n FROM event_rankings`).get() as { n: number }).n;
      expect(after).toBe(before);

      // Floor deliberately below the measured 47,695-row baseline (rather
      // than an exact match), since 07-05 re-runs the ingest and the count
      // legitimately moves — this only guards against the equality above
      // passing vacuously on an empty or truncated table.
      expect(before).toBeGreaterThanOrEqual(40000);

      // eslint-disable-next-line no-console
      console.log(
        `corpus migration (plan 07-02 Task 3): event_rankings before=${before}, after=${after} (equal: ${before === after})`
      );
    } finally {
      db?.close();
    }
  });

  it("the migration did not corrupt columns it did not touch, and wrote no default value into the four new columns on existing rows", () => {
    const readDb = openCorpusReadOnly(CORPUS_PATH);
    try {
      const invalidCount = (
        readDb.prepare(`SELECT COUNT(*) as n FROM event_rankings WHERE rank < 1 OR total_teams < 1`).get() as {
          n: number;
        }
      ).n;
      expect(invalidCount).toBe(0);

      const nullRows = readDb
        .prepare(
          `SELECT record_wins, record_losses, record_ties, ranking_score
           FROM event_rankings
           WHERE record_wins IS NULL AND record_losses IS NULL AND record_ties IS NULL AND ranking_score IS NULL
           LIMIT 1`
        )
        .get() as { record_wins: null; record_losses: null; record_ties: null; ranking_score: null } | undefined;
      expect(nullRows).toBeDefined();
      expect(nullRows?.record_wins).toBeNull();
      expect(nullRows?.record_losses).toBeNull();
      expect(nullRows?.record_ties).toBeNull();
      expect(nullRows?.ranking_score).toBeNull();
    } finally {
      readDb.close();
    }
  });
});
