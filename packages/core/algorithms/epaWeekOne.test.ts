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
import {
  EPA_FALLBACK_FOUL_RATE,
  EPA_WEEK_ONE_MIN_FOUL_OBS,
  EPA_WEEK_ONE_MIN_OBS,
  STATBOTICS_WEEK_ONE_CORPUS_WEEK,
  emptyEpaWeekOneState,
  foldWeekOneAllianceScore,
  foldWeekOneFoulSplit,
  foulRateFrom,
  isStatboticsWeekOne,
  sealWeekOneIfPast,
} from "./epaWeekOne.js";

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

// ---------------------------------------------------------------------------
// The week-1 accumulator and its freeze rule (quick task 260911-j2w Task 3)
// ---------------------------------------------------------------------------

describe("emptyEpaWeekOneState", () => {
  it("starts with no observations, nothing frozen, and unsealed", () => {
    const state = emptyEpaWeekOneState();
    expect(state.stats.count).toBe(0);
    expect(state.frozen).toBeNull();
    expect(state.sealed).toBe(false);
  });
});

describe("foldWeekOneAllianceScore", () => {
  it("advances the week-1 accumulator for a week-0 (Statbotics week 1) match", () => {
    let state = emptyEpaWeekOneState();
    state = foldWeekOneAllianceScore(state, 0, 100);
    state = foldWeekOneAllianceScore(state, 0, 140);
    expect(state.stats.count).toBe(2);
    expect(state.stats.mean).toBeCloseTo(120, 10);
    expect(state.frozen).toBeNull();
    expect(state.sealed).toBe(false);
  });

  it("ignores a null-week alliance score entirely and never seals on one", () => {
    let state = emptyEpaWeekOneState();
    state = foldWeekOneAllianceScore(state, 0, 100);
    state = foldWeekOneAllianceScore(state, null, 999);
    state = foldWeekOneAllianceScore(state, null, 1);
    expect(state.stats.count).toBe(1);
    expect(state.sealed).toBe(false);
    expect(state.frozen).toBeNull();
  });

  it("does not fold a non-finite score", () => {
    let state = emptyEpaWeekOneState();
    state = foldWeekOneAllianceScore(state, 0, Number.NaN);
    expect(state.stats.count).toBe(0);
  });
});

describe("sealWeekOneIfPast", () => {
  it("freezes the week-1 aggregate on the first week greater than 0", () => {
    let state = emptyEpaWeekOneState();
    state = foldWeekOneAllianceScore(state, 0, 100);
    state = foldWeekOneAllianceScore(state, 0, 140);
    state = sealWeekOneIfPast(state, 1);
    expect(state.sealed).toBe(true);
    expect(state.frozen).not.toBeNull();
    expect(state.frozen?.mean).toBeCloseTo(120, 10);
    expect(state.frozen?.sd).toBeCloseTo(20, 10);
  });

  it("does not seal on week 0, and does not seal on a null week", () => {
    let state = emptyEpaWeekOneState();
    state = foldWeekOneAllianceScore(state, 0, 100);
    state = foldWeekOneAllianceScore(state, 0, 140);
    expect(sealWeekOneIfPast(state, 0).sealed).toBe(false);
    expect(sealWeekOneIfPast(state, null).sealed).toBe(false);
  });

  it("a late week-1 arrival after the seal does NOT reopen the frozen aggregate", () => {
    let state = emptyEpaWeekOneState();
    state = foldWeekOneAllianceScore(state, 0, 100);
    state = foldWeekOneAllianceScore(state, 0, 140);
    state = sealWeekOneIfPast(state, 2);
    const frozenAtSeal = state.frozen;
    state = foldWeekOneAllianceScore(state, 0, 5000);
    expect(state.frozen).toEqual(frozenAtSeal);
    expect(state.stats.count).toBe(2);
  });

  it("a second week greater than 0 does not re-seal at a different value", () => {
    let state = emptyEpaWeekOneState();
    state = foldWeekOneAllianceScore(state, 0, 100);
    state = foldWeekOneAllianceScore(state, 0, 140);
    state = sealWeekOneIfPast(state, 1);
    const first = state.frozen;
    state = sealWeekOneIfPast(state, 5);
    expect(state.frozen).toEqual(first);
  });

  it("a seal with fewer than 2 week-1 observations takes NO effect but is recorded as sealed", () => {
    let state = emptyEpaWeekOneState();
    state = foldWeekOneAllianceScore(state, 0, 100);
    state = sealWeekOneIfPast(state, 1);
    expect(state.sealed).toBe(true);
    expect(state.frozen).toBeNull();
  });

  it("a seal with zero week-1 observations takes NO effect but is recorded as sealed", () => {
    const state = sealWeekOneIfPast(emptyEpaWeekOneState(), 3);
    expect(state.sealed).toBe(true);
    expect(state.frozen).toBeNull();
  });

  it("refuses to freeze a degenerate zero-spread aggregate, which would be an infinite logistic scale", () => {
    let state = emptyEpaWeekOneState();
    state = foldWeekOneAllianceScore(state, 0, 90);
    state = foldWeekOneAllianceScore(state, 0, 90);
    state = sealWeekOneIfPast(state, 1);
    expect(state.sealed).toBe(true);
    expect(state.frozen).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// THE WEEK-1 FOUL / NO-FOUL SPLIT (quick task 260911-l2k Task 1)
// ---------------------------------------------------------------------------
//
// `avg.py` writes `year.foul_mean` and `year.no_foul_mean` from the SAME
// week-1 list that writes `score_sd` (reference section 21), and
// `get_foul_rate()` is their ratio (`year.py:176-177`). These cases pin the
// accumulator, the ratio's guards, and the seal that freezes it — all of it
// corpus-independent, because none of it depends on a real match.
describe("foulRateFrom", () => {
  it("is foulMean / noFoulMean, the ratio get_foul_rate() computes", () => {
    expect(foulRateFrom(100, 10)).toBeCloseTo(0.1, 12);
  });

  it("is exactly 0 when no fouls were observed, not null — a zero rate is a real answer", () => {
    expect(foulRateFrom(100, 0)).toBe(0);
  });

  it("REFUSES a zero no-foul mean rather than substituting a denominator of 1", () => {
    // Upstream guards with `(self.no_foul_mean or 1)`, silently turning a
    // degenerate divide into a rate of `foul_mean` itself. This project
    // refuses instead (D-5), the `sealWeekOneIfPast` precedent.
    expect(foulRateFrom(0, 10)).toBeNull();
  });

  it("refuses a negative no-foul mean", () => {
    expect(foulRateFrom(-50, 10)).toBeNull();
  });

  it("refuses a non-finite input on either side", () => {
    expect(foulRateFrom(Number.NaN, 10)).toBeNull();
    expect(foulRateFrom(100, Number.NaN)).toBeNull();
    expect(foulRateFrom(Number.POSITIVE_INFINITY, 10)).toBeNull();
  });

  it("refuses a negative foul mean, which would deflate both published scores", () => {
    expect(foulRateFrom(100, -5)).toBeNull();
  });
});

describe("foldWeekOneFoulSplit", () => {
  it("folds a week-1 observation into both accumulators", () => {
    let state = emptyEpaWeekOneState();
    state = foldWeekOneFoulSplit(state, 0, 90, 10);
    expect(state.noFoulStats.count).toBe(1);
    expect(state.noFoulStats.mean).toBeCloseTo(90, 12);
    expect(state.foulStats.count).toBe(1);
    expect(state.foulStats.mean).toBeCloseTo(10, 12);
  });

  it("ignores a week greater than 0 — that is Statbotics' week 2 and beyond", () => {
    let state = emptyEpaWeekOneState();
    state = foldWeekOneFoulSplit(state, 1, 90, 10);
    expect(state.noFoulStats.count).toBe(0);
    expect(state.foulStats.count).toBe(0);
  });

  it("ignores a null week — unplaced play is neither week 1 nor after it", () => {
    let state = emptyEpaWeekOneState();
    state = foldWeekOneFoulSplit(state, null, 90, 10);
    expect(state.noFoulStats.count).toBe(0);
  });

  it("ignores everything once sealed — a frozen constant that keeps moving is not a constant", () => {
    let state = emptyEpaWeekOneState();
    state = foldWeekOneFoulSplit(state, 0, 90, 10);
    state = foldWeekOneFoulSplit(state, 0, 110, 20);
    state = sealWeekOneIfPast(state, 1);
    state = foldWeekOneFoulSplit(state, 0, 5000, 5000);
    expect(state.noFoulStats.count).toBe(2);
  });

  it("drops a non-finite observation on either side rather than poisoning both means", () => {
    let state = emptyEpaWeekOneState();
    state = foldWeekOneFoulSplit(state, 0, Number.NaN, 10);
    expect(state.noFoulStats.count).toBe(0);
    expect(state.foulStats.count).toBe(0);
    state = foldWeekOneFoulSplit(state, 0, 90, Number.NaN);
    expect(state.noFoulStats.count).toBe(0);
    expect(state.foulStats.count).toBe(0);
  });

  it("never mutates its input", () => {
    const state = emptyEpaWeekOneState();
    foldWeekOneFoulSplit(state, 0, 90, 10);
    expect(state.noFoulStats.count).toBe(0);
  });
});

describe("sealWeekOneIfPast — the foul record", () => {
  it("freezes { rate, noFoulMean } in the SAME call that freezes mean/sd", () => {
    let state = emptyEpaWeekOneState();
    state = foldWeekOneAllianceScore(state, 0, 100);
    state = foldWeekOneAllianceScore(state, 0, 140);
    state = foldWeekOneFoulSplit(state, 0, 90, 10);
    state = foldWeekOneFoulSplit(state, 0, 130, 10);
    state = sealWeekOneIfPast(state, 1);
    expect(state.frozen).not.toBeNull();
    expect(state.frozenFoul).not.toBeNull();
    expect(state.frozenFoul?.noFoulMean).toBeCloseTo(110, 12);
    expect(state.frozenFoul?.rate).toBeCloseTo(10 / 110, 12);
  });

  it("freezes the foul record at ONE observation — a mean's own contract boundary", () => {
    // Deliberately DIFFERENT from `frozen`'s EPA_WEEK_ONE_MIN_OBS = 2 gate:
    // that one is `standardDeviation`'s boundary, this one is a mean's. The
    // two gates are independent by design.
    let state = emptyEpaWeekOneState();
    state = foldWeekOneFoulSplit(state, 0, 90, 9);
    state = sealWeekOneIfPast(state, 1);
    expect(state.frozen).toBeNull();
    expect(state.frozenFoul).not.toBeNull();
    expect(state.frozenFoul?.rate).toBeCloseTo(0.1, 12);
  });

  it("records sealed with a NULL foul record when zero foul observations exist", () => {
    let state = emptyEpaWeekOneState();
    state = foldWeekOneAllianceScore(state, 0, 100);
    state = foldWeekOneAllianceScore(state, 0, 140);
    state = sealWeekOneIfPast(state, 1);
    expect(state.sealed).toBe(true);
    expect(state.frozen).not.toBeNull();
    expect(state.frozenFoul).toBeNull();
  });

  it("refuses a degenerate rate rather than fudging it, and does not retry", () => {
    let state = emptyEpaWeekOneState();
    state = foldWeekOneFoulSplit(state, 0, 0, 10);
    state = foldWeekOneFoulSplit(state, 0, 0, 10);
    state = sealWeekOneIfPast(state, 1);
    expect(state.sealed).toBe(true);
    expect(state.frozenFoul).toBeNull();
    state = sealWeekOneIfPast(state, 5);
    expect(state.frozenFoul).toBeNull();
  });

  it("never reopens a frozen foul record for a late week-1 arrival", () => {
    let state = emptyEpaWeekOneState();
    state = foldWeekOneFoulSplit(state, 0, 100, 10);
    state = sealWeekOneIfPast(state, 1);
    const frozenAtSeal = state.frozenFoul;
    state = foldWeekOneFoulSplit(state, 0, 100, 90);
    expect(state.frozenFoul).toEqual(frozenAtSeal);
  });

  it("noFoulMean + foulMean equals the raw score mean over the same population, by construction", () => {
    // D-2: the foul side is taken from the SCORE, so the complement identity
    // `(1 + rate) * noFoulMean === scoreMean` holds exactly rather than
    // approximately. This is what makes the rate precisely the inflation from
    // a no-foul total to a real score.
    const scores = [112, 87, 140, 65];
    const fouls = [12, 0, 20, 5];
    let state = emptyEpaWeekOneState();
    for (let i = 0; i < scores.length; i += 1) {
      state = foldWeekOneAllianceScore(state, 0, scores[i] as number);
      state = foldWeekOneFoulSplit(state, 0, (scores[i] as number) - (fouls[i] as number), fouls[i] as number);
    }
    const scoreMean = scores.reduce((a, b) => a + b, 0) / scores.length;
    expect(state.noFoulStats.mean + state.foulStats.mean).toBeCloseTo(scoreMean, 10);
    state = sealWeekOneIfPast(state, 1);
    const frozenFoul = state.frozenFoul as { rate: number; noFoulMean: number };
    expect((1 + frozenFoul.rate) * frozenFoul.noFoulMean).toBeCloseTo(scoreMean, 10);
  });
});

describe("EPA_FALLBACK_FOUL_RATE", () => {
  it("is exactly 0, so a match with no foul information is published at its plain no-foul total", () => {
    expect(EPA_FALLBACK_FOUL_RATE).toBe(0);
  });
});

describe("EPA_WEEK_ONE_MIN_FOUL_OBS", () => {
  it("is 1 — a mean is defined at one observation, where a standard deviation is not", () => {
    expect(EPA_WEEK_ONE_MIN_FOUL_OBS).toBe(1);
    expect(EPA_WEEK_ONE_MIN_OBS).toBe(2);
  });
});
