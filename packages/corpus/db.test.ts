/**
 * Corpus accessor tests (DATA-02 Task 1): the chronological read's total
 * order under sort_time ties, upsert idempotency, the offseason exclusion
 * filter, and the single-writer lock. Each test opens a fresh temp SQLite
 * file so tests never share state.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CorpusEvent, CorpusMatch } from "../ingest/normalize.js";
import {
  findIncompleteIngestRuns,
  openCorpus,
  recordIngestRun,
  selectMatchesChronological,
  upsertEvent,
  upsertMatch,
  upsertTeam,
  type Corpus,
} from "./db.js";

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
