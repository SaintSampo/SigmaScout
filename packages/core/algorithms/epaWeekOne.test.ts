/**
 * The off-by-one gate for `epaWeekOne.ts` (quick task 260911-j2w Task 2).
 *
 * WHY THIS FILE EXISTS AT ALL. Statbotics' `backend/src/data/avg.py` filters
 * `m.week == 1`. This corpus stores TBA's week 0-INDEXED, so the same
 * population is `week === 0` here. Getting that backwards calibrates the model
 * on the wrong week and NOTHING visibly fails: the replay still runs, the
 * ratings still look plausible, every other test still passes, and the only
 * symptom is a silently wrong reproduction. A named constant is not enough on
 * its own — the constant could be named and still be wrong — so the mapping is
 * pinned here against `data/corpus.sqlite` itself rather than asserted from
 * memory.
 *
 * The corpus-backed cases follow `packages/core/rankingPoints/
 * reconciliation.test.ts`'s established shape: `existsSync` guard,
 * `openCorpusReadOnly` with `try/finally`, and an explicit skip message rather
 * than a silent pass when the 582 MB corpus is absent.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openCorpusReadOnly, selectMatchesChronological } from "../../corpus/db.js";
import { STATBOTICS_WEEK_ONE_CORPUS_WEEK, isStatboticsWeekOne } from "./epaWeekOne.js";

const CORPUS_PATH = "data/corpus.sqlite";
const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);

describe("STATBOTICS_WEEK_ONE_CORPUS_WEEK", () => {
  it("is 0, because this corpus stores TBA's week 0-indexed and Statbotics filters week == 1", () => {
    expect(STATBOTICS_WEEK_ONE_CORPUS_WEEK).toBe(0);
  });
});

describe("isStatboticsWeekOne", () => {
  it("accepts the corpus week that IS Statbotics' week 1", () => {
    expect(isStatboticsWeekOne(0)).toBe(true);
  });

  it("rejects corpus week 1, which is Statbotics' week 2 and the single most likely off-by-one", () => {
    expect(isStatboticsWeekOne(1)).toBe(false);
  });

  it("rejects a mid-season week", () => {
    expect(isStatboticsWeekOne(5)).toBe(false);
  });

  it("rejects null, because an unplaced event is neither week 1 nor after it", () => {
    expect(isStatboticsWeekOne(null)).toBe(false);
  });
});

describe.skipIf(!CORPUS_AVAILABLE)("corpus-backed: the 0-indexed week mapping, verified not assumed", () => {
  it("every 2024 week-0 event starts on or after 2024-02-24 and strictly before the first week-1 event", () => {
    const db = openCorpusReadOnly(CORPUS_PATH);
    try {
      const weekZero = db
        .prepare(`SELECT MIN(start_date) AS mn, MAX(start_date) AS mx, COUNT(*) AS n FROM events WHERE year = 2024 AND week = 0`)
        .get() as { mn: string; mx: string; n: number };
      const weekOne = db
        .prepare(`SELECT MIN(start_date) AS mn, COUNT(*) AS n FROM events WHERE year = 2024 AND week = 1`)
        .get() as { mn: string; n: number };

      expect(weekZero.n).toBeGreaterThan(0);
      expect(weekOne.n).toBeGreaterThan(0);
      // 2024-02-24 is FRC Week 1's own opening weekend. If corpus week 0 were
      // really Statbotics' week 0 (a preseason bucket), this window would sit
      // in January or early February instead.
      expect(weekZero.mn >= "2024-02-24").toBe(true);
      // Strict: the week-0 window must CLOSE before the week-1 window OPENS,
      // which is what lets a chronological stream use "first match with week
      // greater than 0" as proof that every week-1 match has already passed.
      expect(weekZero.mx < weekOne.mn).toBe(true);
    } finally {
      db.close();
    }
  });

  it("the week-0 window closes before the week-1 window opens in EVERY corpus season", () => {
    const db = openCorpusReadOnly(CORPUS_PATH);
    try {
      for (const year of [2016, 2017, 2018, 2019, 2022, 2023, 2024, 2025, 2026]) {
        const weekZero = db
          .prepare(`SELECT MAX(start_date) AS mx, COUNT(*) AS n FROM events WHERE year = @year AND week = 0`)
          .get({ year }) as { mx: string | null; n: number };
        const weekOne = db
          .prepare(`SELECT MIN(start_date) AS mn, COUNT(*) AS n FROM events WHERE year = @year AND week = 1`)
          .get({ year }) as { mn: string | null; n: number };
        expect(weekZero.n, `${year} has no week-0 events`).toBeGreaterThan(0);
        expect(weekOne.n, `${year} has no week-1 events`).toBeGreaterThan(0);
        expect(
          (weekZero.mx ?? "") < (weekOne.mn ?? ""),
          `${year}: week-0 window (ends ${String(weekZero.mx)}) must close before week-1 opens (${String(weekOne.mn)})`
        ).toBe(true);
      }
    } finally {
      db.close();
    }
  });

  it("no event carrying a non-null week is offseason or preseason", () => {
    const db = openCorpusReadOnly(CORPUS_PATH);
    try {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS n FROM events
           WHERE week IS NOT NULL AND (event_type >= 99 OR is_offseason = 1)`
        )
        .get() as { n: number };
      expect(row.n).toBe(0);
    } finally {
      db.close();
    }
  });
});

describe.skipIf(!CORPUS_AVAILABLE)("corpus-backed: week reaches the algorithm boundary", () => {
  it("selectMatchesChronological carries week 0, week null, and never undefined", () => {
    const db = openCorpusReadOnly(CORPUS_PATH);
    try {
      const matches = selectMatchesChronological(db, { year: 2024 });
      expect(matches.length).toBeGreaterThan(0);

      let sawWeekZero = false;
      let sawNullWeek = false;
      for (const match of matches) {
        // `in` rather than `!== undefined`: this catches a construction site
        // that omitted the key entirely, which is the silent-default failure
        // mode `eventType`'s own doc comment exists to prevent.
        expect("week" in match).toBe(true);
        expect(match.week === null || Number.isInteger(match.week)).toBe(true);
        if (match.week === 0) sawWeekZero = true;
        if (match.week === null) sawNullWeek = true;
      }
      expect(sawWeekZero, "2024 must contain played week-0 matches").toBe(true);
      expect(sawNullWeek, "2024 must contain played null-week (championship/offseason) matches").toBe(true);
    } finally {
      db.close();
    }
  });

  it("isStatboticsWeekOne selects exactly the corpus's own week-0 played population for 2024", () => {
    const db = openCorpusReadOnly(CORPUS_PATH);
    try {
      const matches = selectMatchesChronological(db, { year: 2024 });
      const selected = matches.filter((match) => isStatboticsWeekOne(match.week)).length;
      const expected = (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM matches m JOIN events e ON e.event_key = m.event_key
             WHERE e.year = 2024 AND e.week = 0 AND m.winner IS NOT NULL`
          )
          .get() as { n: number }
      ).n;
      expect(selected).toBe(expected);
      expect(selected).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });
});
