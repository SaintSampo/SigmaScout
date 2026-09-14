/**
 * A corpus-wide census gate for the full 2022-2026 pass, asserting facts
 * about the WHOLE `data/corpus.sqlite` rather than about one response or
 * one event.
 *
 * This file opens the corpus read-only via `openCorpusReadOnly`, acquires no
 * write lock, writes no row, and issues no network request of any kind. It
 * is gated on corpus availability alone (`CORPUS_AVAILABLE`) and must never
 * acquire a live-API gate the way `rankingsLive.test.ts` does for its
 * network-bound block — every case here reads only what a prior ingest run
 * already wrote.
 *
 * It stands afterwards as a regression guard for a write path
 * `packages/ingest/cli.ts` makes untestable by import, because that module
 * calls `main()` at top level: the only available proof that
 * `ingestSeasonRankingsOnly`/`ingestSeasonAlliancesOnly` actually wrote what
 * they claim is a fresh read-only query against the corpus they wrote to.
 *
 * Conventions copied verbatim from `rankingsLive.test.ts` rather than
 * invented fresh: `CORPUS_PATH`/`CORPUS_AVAILABLE`/`existsSync` gate, a
 * `describe`-level early-return with a single named `it.skip` whose message
 * names `CORPUS_PATH` literally, and `openCorpusReadOnly` opened once and
 * closed in `afterAll`.
 */
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openCorpusReadOnly, type Corpus } from "../corpus/db.js";

const CORPUS_PATH = "data/corpus.sqlite";
const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);

/** The five seasons this plan's full pass covers, module-level and readonly so the sweep cannot silently narrow. */
const SEASONS = [2022, 2023, 2024, 2025, 2026] as const;

/**
 * Per-season floor for "distinct events with at least one `event_rankings`
 * row", each set below its own measured value. These are deliberately NOT
 * predictions: several seasons have undershot an over-confident estimate
 * before, so a floor here exists to catch a season that silently
 * regressed, not to guess the real answer.
 */
const POPULATED_EVENT_FLOORS: Record<(typeof SEASONS)[number], number> = {
  2022: 210,
  2023: 220,
  2024: 250,
  2025: 280,
  2026: 215,
};

/**
 * A deliberately low non-vacuity bound, not a prediction: set low so this
 * catches a season that silently ingested nothing rather than trying to
 * predict the real figure. The real per-season numbers are recorded in
 * COVERAGE.md.
 */
const ALLIANCE_EVENT_FLOOR = 100;

/**
 * Three live-observed absent shapes: `2025bc` and `2026wvrox` each returned
 * a valid 200 with an empty array despite carrying real rankings (an event
 * that ran qualification matches but never held an alliance selection),
 * and `2022ispr` returned a bare null body. Both halves are asserted for
 * each key below — existence AND zero rows — so a typo'd key can never
 * pass vacuously.
 */
const ABSENT_ALLIANCE_EVENT_KEYS = ["2025bc", "2026wvrox", "2022ispr"] as const;

describe("event_rankings — full-corpus census after the forced 2022-2026 pass (plan 07-05)", () => {
  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} is absent — run the ingest pipeline (pnpm ingest) to generate it`, () => {});
    return;
  }

  let db: Corpus;

  beforeAll(() => {
    db = openCorpusReadOnly(CORPUS_PATH);
  });

  afterAll(() => {
    db.close();
  });

  for (const year of SEASONS) {
    it(`season ${year} has at least ${POPULATED_EVENT_FLOORS[year]} distinct events with at least one event_rankings row`, () => {
      const row = db
        .prepare(
          `SELECT COUNT(DISTINCT er.event_key) AS n
           FROM event_rankings er
           JOIN events e ON e.event_key = er.event_key
           WHERE e.year = ?`
        )
        .get(year) as { n: number };
      expect(row.n).toBeGreaterThanOrEqual(POPULATED_EVENT_FLOORS[year]);
    });
  }

  it("event_rankings holds at least 47695 rows total — the forced pass refreshes in place and never deletes, so the count is monotone against 06.1-04's measured 47,695", () => {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM event_rankings`).get() as { n: number };
    expect(row.n).toBeGreaterThanOrEqual(47695);
  });

  it("zero rows carry a NULL record_wins, record_losses, or record_ties", () => {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM event_rankings
         WHERE record_wins IS NULL OR record_losses IS NULL OR record_ties IS NULL`
      )
      .get() as { n: number };
    expect(row.n).toBe(0);
  });

  it("zero rows carry a negative value in record_wins, record_losses, or record_ties", () => {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM event_rankings
         WHERE record_wins < 0 OR record_losses < 0 OR record_ties < 0`
      )
      .get() as { n: number };
    expect(row.n).toBe(0);
  });

  it("at least 20000 rows carry record_wins greater than zero — a non-vacuity floor so the NULL/negativity checks above cannot pass against an all-zero table", () => {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM event_rankings WHERE record_wins > 0`).get() as {
      n: number;
    };
    expect(row.n).toBeGreaterThanOrEqual(20000);
  });

  for (const year of SEASONS) {
    it(`season ${year} has at least one row whose ranking_score differs from its own integer truncation, proving the REAL column type is load-bearing in every season`, () => {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS n
           FROM event_rankings er
           JOIN events e ON e.event_key = er.event_key
           WHERE e.year = ? AND er.ranking_score IS NOT NULL AND er.ranking_score != CAST(er.ranking_score AS INTEGER)`
        )
        .get(year) as { n: number };
      expect(row.n).toBeGreaterThan(0);
    });
  }

  it("zero rows violate rank >= 1 AND total_teams >= 1 — 06.1-04's own invariant, re-asserted at the new row count", () => {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM event_rankings WHERE NOT (rank >= 1 AND total_teams >= 1)`)
      .get() as { n: number };
    expect(row.n).toBe(0);
  });

  it("the count of corpus events with no event_rankings row at all is greater than 150", () => {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM events e
         WHERE NOT EXISTS (SELECT 1 FROM event_rankings er WHERE er.event_key = e.event_key)`
      )
      .get() as { n: number };
    expect(row.n).toBeGreaterThan(150);
  });

  /**
   * The upper bound is a function of corpus SIZE, so it must move as
   * seasons are added — and only after re-measuring, never reflexively.
   * Events with no `event_rankings` row are legitimately absent for a
   * handful of reasons: a cancelled season (2020, where 139 listed events
   * never happened), an offseason event TBA never posted rankings for even
   * though it played matches, a preseason shell with zero matches, or a
   * playoff-only event with zero `qm` matches (structurally cannot have a
   * qualification ranking). Current bound: one season of headroom above the
   * measured total, at the worst observed per-season rate (2026's 64) — a
   * margin derived from the data, not rounded up to a comfortable number.
   * It affords exactly ONE more season before this block needs
   * re-measuring. The bound still catches what it exists to catch, with
   * room to spare: `ingestSeasonRankingsOnly` silently writing nothing for
   * a season would add that season's FULL event count (~200+), not ~60.
   */
  it("the count of corpus events with no event_rankings row at all is less than 634", () => {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM events e
         WHERE NOT EXISTS (SELECT 1 FROM event_rankings er WHERE er.event_key = e.event_key)`
      )
      .get() as { n: number };
    expect(row.n).toBeLessThan(634);
  });
});

describe("event_alliances — full-corpus census after the 2022-2026 pass (plan 07-05)", () => {
  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} is absent — run the ingest pipeline (pnpm ingest) to generate it`, () => {});
    return;
  }

  let db: Corpus;

  beforeAll(() => {
    db = openCorpusReadOnly(CORPUS_PATH);
  });

  afterAll(() => {
    db.close();
  });

  for (const year of SEASONS) {
    it(`season ${year} has at least ${ALLIANCE_EVENT_FLOOR} distinct events with event_alliances rows`, () => {
      const row = db
        .prepare(
          `SELECT COUNT(DISTINCT ea.event_key) AS n
           FROM event_alliances ea
           JOIN events e ON e.event_key = ea.event_key
           WHERE e.year = ?`
        )
        .get(year) as { n: number };
      expect(row.n).toBeGreaterThanOrEqual(ALLIANCE_EVENT_FLOOR);
    });
  }

  /**
   * The 2016–2020 alliance backfill gets its own sweep, since `SEASONS`
   * scopes to a different five seasons. Floors sit below the measured
   * figures for the same catch-a-zero reason as `ALLIANCE_EVENT_FLOOR`.
   * 2020's floor is far lower and that is honest, not lenient: COVID
   * cancelled most of the season and most of its events returned a null
   * alliances body.
   */
  const BACKFILL_ALLIANCE_FLOORS: ReadonlyArray<readonly [year: number, floor: number]> = [
    [2016, 100],
    [2017, 100],
    [2018, 100],
    [2019, 100],
    [2020, 40],
  ];
  for (const [year, floor] of BACKFILL_ALLIANCE_FLOORS) {
    it(`backfilled season ${year} has at least ${floor} distinct events with event_alliances rows`, () => {
      const row = db
        .prepare(
          `SELECT COUNT(DISTINCT ea.event_key) AS n
           FROM event_alliances ea
           JOIN events e ON e.event_key = ea.event_key
           WHERE e.year = ?`
        )
        .get(year) as { n: number };
      expect(row.n).toBeGreaterThanOrEqual(floor);
    });
  }

  for (const eventKey of ABSENT_ALLIANCE_EVENT_KEYS) {
    it(`${eventKey} exists in events and carries exactly zero event_alliances rows`, () => {
      const eventRow = db.prepare(`SELECT event_key FROM events WHERE event_key = ?`).get(eventKey) as
        | { event_key: string }
        | undefined;
      expect(eventRow).toBeDefined();

      const countRow = db
        .prepare(`SELECT COUNT(*) AS n FROM event_alliances WHERE event_key = ?`)
        .get(eventKey) as { n: number };
      expect(countRow.n).toBe(0);
    });
  }

  it("every event with at least one event_alliances row has a contiguous alliance_number sequence (MIN=1, MAX=COUNT)", () => {
    const offenders = db
      .prepare(
        `SELECT event_key, MIN(alliance_number) AS minNum, MAX(alliance_number) AS maxNum, COUNT(*) AS n
         FROM event_alliances
         GROUP BY event_key
         HAVING minNum <> 1 OR maxNum <> n`
      )
      .all() as { event_key: string; minNum: number; maxNum: number; n: number }[];
    expect(offenders, `non-contiguous alliance_number sequence for: ${offenders.map((o) => o.event_key).join(", ")}`).toEqual(
      []
    );
  });

  it("every event_alliances row's picks parses as a JSON array whose length is between 1 and 4 inclusive", () => {
    const offenders = db
      .prepare(
        `SELECT event_key, alliance_number, json_array_length(picks) AS len
         FROM event_alliances
         WHERE json_array_length(picks) < 1 OR json_array_length(picks) > 4`
      )
      .all() as { event_key: string; alliance_number: number; len: number }[];
    expect(offenders).toEqual([]);
  });

  it("the maximum fetched_at across 2022 and 2024 event_alliances rows is strictly less than the minimum fetched_at across 2023, 2025 and 2026 rows — 07-03's rows survived this pass untouched", () => {
    const older = db
      .prepare(
        `SELECT MAX(ea.fetched_at) AS maxFetched
         FROM event_alliances ea
         JOIN events e ON e.event_key = ea.event_key
         WHERE e.year IN (2022, 2024)`
      )
      .get() as { maxFetched: string | null };

    const newer = db
      .prepare(
        `SELECT MIN(ea.fetched_at) AS minFetched
         FROM event_alliances ea
         JOIN events e ON e.event_key = ea.event_key
         WHERE e.year IN (2023, 2025, 2026)`
      )
      .get() as { minFetched: string | null };

    expect(older.maxFetched).not.toBeNull();
    expect(newer.minFetched).not.toBeNull();
    expect((older.maxFetched as string) < (newer.minFetched as string)).toBe(true);
  });

  it("at least one event_alliances row carries a SQL NULL name, and zero rows carry an empty-string name", () => {
    const nullCount = db.prepare(`SELECT COUNT(*) AS n FROM event_alliances WHERE name IS NULL`).get() as {
      n: number;
    };
    expect(nullCount.n).toBeGreaterThanOrEqual(1);

    const emptyStringCount = db
      .prepare(`SELECT COUNT(*) AS n FROM event_alliances WHERE name = ''`)
      .get() as { n: number };
    expect(emptyStringCount.n).toBe(0);
  });
});
