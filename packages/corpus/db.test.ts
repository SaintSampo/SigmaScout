/**
 * Corpus accessor tests (DATA-02 Task 1): the chronological read's total
 * order under sort_time ties, upsert idempotency, the offseason exclusion
 * filter, and the single-writer lock. Each test opens a fresh temp SQLite
 * file so tests never share state.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OUTCOME_KEYS } from "../core/algorithms/leakProof.js";
import type { CorpusEvent, CorpusMatch } from "../ingest/normalize.js";
import {
  findIncompleteIngestRuns,
  openCorpus,
  recordIngestRun,
  selectMatchesChronological,
  selectScheduledMatches,
  upsertEvent,
  upsertMatch,
  upsertTeam,
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
