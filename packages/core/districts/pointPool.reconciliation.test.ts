/**
 * Corpus-wide reconciliation of `pointPool.ts`'s four pools against every
 * district-tier event The Blue Alliance has ever reported — the test that
 * licenses the pooled remaining-points lock to publish a `Locked` guarantee.
 *
 * THE INVARIANT IS ONE-SIDED AND THAT IS THE POINT. A pool larger than the
 * points really handed out only delays a lock; a pool SMALLER than the points
 * really handed out publishes a guarantee that is not true. So every assertion
 * below is "no real event ever exceeded the declared pool", per category and in
 * total, never "the pool equals what happened".
 *
 * Mirrors `pointFormulas.reconciliation.test.ts`'s shape: `existsSync` corpus
 * guard, an explicit `it.skip` message rather than a silent pass,
 * `openCorpusReadOnly` inside `try`/`finally`, and a terminal non-vacuous
 * population assertion so a future ingest regression that empties a table is a
 * red test rather than a quiet zero.
 *
 * THIS TEST SKIPS WHERE `data/corpus.sqlite` IS ABSENT, WHICH IS CI. A green
 * skip is not a pass — `pointPool.test.ts` is the pure half that runs
 * everywhere, and it is load-bearing rather than a formality.
 *
 * AN EVENT'S TIER COMES FROM ITS OWN `district_cmp` BOOLEAN, never from a join
 * to `events`; `pointModel.ts`'s header names the misclassification trap that
 * shortcut produces. A district championship's pool is not modelled at all, so
 * every dcmp-tier entry is out of scope here.
 *
 * ROOKIE COUNT COMES FROM `district_rankings.rookie_bonus`. TBA pays 10 in a
 * team's first season and 5 in its second, so `rookie_bonus === 10` is exactly
 * the rookie state `awardBaseRates.rookieStateFor` derives from TBA's
 * `rookie_year`, read from a column this corpus actually carries.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openCorpusReadOnly } from "../../corpus/db.js";
import { PLAYOFF_POOL, SELECTION_POOL, awardPool, qualificationPool } from "./pointPool.js";

const CORPUS_PATH = "data/corpus.sqlite";
const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);
const SKIP_MESSAGE = `skipped: ${CORPUS_PATH} not found -- run the ingest pipeline (pnpm ingest:districts, pnpm ingest:rankings) first; a skipped reconciliation proves nothing`;

/**
 * The measured population and maxima, read-only against `data/corpus.sqlite`
 * on 2026-09-25 over every registered season (2016-2020, 2022-2026).
 *
 * The event count is a FLOOR (a later ingest that resolves more events is an
 * improvement); the three maxima are recorded rather than asserted equal, so a
 * season whose awards change is visible in the failure message instead of
 * hiding behind an inequality.
 */
const MEASURED_DISTRICT_TIER_EVENTS = 951;
/** The highest award, selection and playoff totals ever handed out at one district event. */
const MEASURED_MAX_AWARD_TOTAL = 91;
const MEASURED_MAX_SELECTION_TOTAL = 236;
const MEASURED_MAX_PLAYOFF_TOTAL = 212;

interface DistrictRankingRow {
  readonly team_key: string;
  readonly rookie_bonus: number;
  readonly event_points_raw: string;
}

interface EventPointsEntry {
  readonly event_key: string;
  readonly district_cmp: boolean;
  readonly qual_points: number;
  readonly alliance_points: number;
  readonly elim_points: number;
  readonly award_points: number;
}

interface EventTotals {
  qual: number;
  alliance: number;
  elim: number;
  award: number;
  readonly teams: Set<string>;
  rookies: number;
}

/** Every district-tier event's per-category totals, attendee set and rookie count, summed over every `district_rankings` row that names it. */
function loadDistrictTierEventTotals(): Map<string, EventTotals> {
  const db = openCorpusReadOnly(CORPUS_PATH);
  let rows: DistrictRankingRow[];
  try {
    rows = db.prepare(`SELECT team_key, rookie_bonus, event_points_raw FROM district_rankings`).all() as DistrictRankingRow[];
  } finally {
    db.close();
  }

  const byEvent = new Map<string, EventTotals>();
  for (const row of rows) {
    const entries = JSON.parse(row.event_points_raw) as EventPointsEntry[];
    for (const entry of entries) {
      // Tier from the entry's OWN district_cmp boolean; a dcmp entry is out of
      // this module's scope entirely.
      if (entry.district_cmp) continue;
      let totals = byEvent.get(entry.event_key);
      if (totals === undefined) {
        totals = { qual: 0, alliance: 0, elim: 0, award: 0, teams: new Set<string>(), rookies: 0 };
        byEvent.set(entry.event_key, totals);
      }
      totals.qual += entry.qual_points;
      totals.alliance += entry.alliance_points;
      totals.elim += entry.elim_points;
      totals.award += entry.award_points;
      if (!totals.teams.has(row.team_key)) {
        totals.teams.add(row.team_key);
        if (row.rookie_bonus === 10) totals.rookies += 1;
      }
    }
  }
  return byEvent;
}

if (!CORPUS_AVAILABLE) {
  describe("pointPool — corpus reconciliation", () => {
    it.skip(SKIP_MESSAGE, () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe("pointPool — corpus reconciliation", () => {
    const byEvent = loadDistrictTierEventTotals();
    const events = [...byEvent.entries()].filter(([, totals]) => totals.teams.size > 0);

    it("reads a non-vacuous population of district-tier events", () => {
      expect(events.length).toBeGreaterThanOrEqual(MEASURED_DISTRICT_TIER_EVENTS);
    });

    it("never hands out more QUALIFICATION points than qualificationPool declares", () => {
      // This is the pool whose field size the artifact can only estimate, so it
      // is the one the phantom-attendee margin exists for. At a margin of zero
      // this assertion fails at 38 events, by up to 10 points.
      const over = events
        .filter(([, totals]) => totals.qual > qualificationPool(totals.teams.size))
        .map(([key, totals]) => `${key}: reported ${String(totals.qual)} over pool ${String(qualificationPool(totals.teams.size))} at ${String(totals.teams.size)} rows`);
      expect(over).toEqual([]);
    });

    it("never hands out more ALLIANCE SELECTION points than SELECTION_POOL declares", () => {
      const over = events.filter(([, totals]) => totals.alliance > SELECTION_POOL).map(([key, totals]) => `${key}: ${String(totals.alliance)}`);
      expect(over).toEqual([]);
      expect(Math.max(...events.map(([, totals]) => totals.alliance))).toBe(MEASURED_MAX_SELECTION_TOTAL);
    });

    it("never hands out more PLAYOFF points than PLAYOFF_POOL declares", () => {
      const over = events.filter(([, totals]) => totals.elim > PLAYOFF_POOL).map(([key, totals]) => `${key}: ${String(totals.elim)}`);
      expect(over).toEqual([]);
      expect(Math.max(...events.map(([, totals]) => totals.elim))).toBe(MEASURED_MAX_PLAYOFF_TOTAL);
    });

    it("never hands out more AWARD points than awardPool declares for its attending rookie count", () => {
      const over = events
        .filter(([, totals]) => totals.award > awardPool(totals.rookies))
        .map(([key, totals]) => `${key}: reported ${String(totals.award)} over pool ${String(awardPool(totals.rookies))} at ${String(totals.rookies)} rookies`);
      expect(over).toEqual([]);
      expect(Math.max(...events.map(([, totals]) => totals.award))).toBe(MEASURED_MAX_AWARD_TOTAL);
    });

    it("shows the award pool's rookie structure in the data it was measured from", () => {
      const maxFor = (predicate: (rookies: number) => boolean): number =>
        Math.max(...events.filter(([, totals]) => predicate(totals.rookies)).map(([, totals]) => totals.award));
      expect(maxFor((rookies) => rookies === 0)).toBe(awardPool(0));
      expect(maxFor((rookies) => rookies === 1)).toBe(awardPool(1));
      expect(maxFor((rookies) => rookies >= 2)).toBe(awardPool(2));
    });

    it("never hands out more points IN TOTAL than the four pools together declare", () => {
      const over = events
        .filter(([, totals]) => {
          const pool = qualificationPool(totals.teams.size) + SELECTION_POOL + PLAYOFF_POOL + awardPool(totals.rookies);
          return totals.qual + totals.alliance + totals.elim + totals.award > pool;
        })
        .map(([key]) => key);
      expect(over).toEqual([]);
    });
  });
}
