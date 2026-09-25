/**
 * Corpus-wide reconciliation of phase 10's district point FORMULAS against
 * TBA's own reported values — the test that licenses `qualPoints.ts`,
 * `selectionPoints.ts` and `bracket.ts` to produce numbers a visitor reads
 * as fact.
 *
 * Mirrors `reconciliation.test.ts`'s shape exactly (`existsSync` corpus
 * guard, an explicit `it.skip` message rather than a silent pass,
 * `openCorpusReadOnly` inside `try`/`finally`, `describe.each` over the
 * registered seasons, a terminal non-vacuous checked-count assertion) but
 * proves a different and stronger invariant: not that our declared ceilings
 * bound TBA's values, but that our formulas REPRODUCE them, value for
 * value.
 *
 * THIS TEST SKIPS WHERE `data/corpus.sqlite` IS ABSENT, WHICH IS CI. A
 * green skip is not a pass. Each formula module therefore carries its own
 * pure unit-test file (`qualPoints.test.ts`, `selectionPoints.test.ts`,
 * `bracket.test.ts`) which runs everywhere, and those are load-bearing
 * rather than a formality.
 *
 * Every block counts its population and its exclusions and ASSERTS both,
 * not merely the mismatch total. Pinning only "zero mismatches" lets a
 * future ingest regression that empties a table pass while proving
 * nothing; pinning the population turns that into a red test.
 *
 * An `event_points_raw` entry's tier is read from that entry's own
 * `district_cmp` boolean, never inferred by joining to `events` — see
 * `pointModel.ts`'s header for the measurement trap that misclassification
 * produces.
 */
import { existsSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { openCorpusReadOnly } from "../../corpus/db.js";
import { DISTRICT_REGISTERED_SEASONS } from "./pointModel.js";
import { qualPoints } from "./qualPoints.js";

const CORPUS_PATH = "data/corpus.sqlite";
const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);
const SKIP_MESSAGE = `skipped: ${CORPUS_PATH} not found -- run the ingest pipeline (pnpm ingest:districts, pnpm ingest:rankings, pnpm ingest:alliances) first; a skipped reconciliation proves nothing`;

/** One entry of TBA's verbatim `district_rankings.event_points_raw` JSON array. */
interface EventPointsEntry {
  event_key: string;
  district_cmp: boolean;
  qual_points: number;
  alliance_points: number;
  elim_points: number;
  award_points: number;
}

interface DistrictRankingRow {
  team_key: string;
  event_points_raw: string;
}

interface EventRankingRow {
  event_key: string;
  team_key: string;
  rank: number;
  total_teams: number;
}

/**
 * Fact 4, measured read-only against `data/corpus.sqlite` on 2026-09-25
 * while planning 10-01: the per-season count of district-tier `qual_points`
 * entries the formula was proven exact on. Every one of these ten figures
 * is reproduced exactly by this test; their sum is 29,796, zero mismatches.
 * (10-01-PLAN.md's Fact 4 states the total as 29,896 while listing these
 * same per-season values, which sum to 29,796 — the total was an arithmetic
 * slip in the plan, not a population this test fails to reach. The
 * per-season figures are the authoritative ones.)
 *
 * Asserted as a FLOOR — a later legitimate ingest can only add rows, so a
 * shrinking scan is a regression and turns this red rather than quietly
 * proving less.
 */
const EXPECTED_QUAL_CHECKED: Readonly<Record<number, number>> = {
  2016: 2314,
  2017: 2845,
  2018: 3055,
  2019: 3519,
  2020: 1193,
  2022: 2854,
  2023: 3146,
  2024: 3321,
  2025: 3464,
  2026: 4085,
};

/**
 * The only district-tier `qual_points` entries the corpus cannot resolve:
 * 75 rows in 2020, the truncated season, which carry no `event_rankings`
 * row at all. Asserted as a CEILING per season — every other season must
 * resolve every entry, and 2020's unresolvable set must not grow.
 */
const MAX_QUAL_UNRESOLVABLE: Readonly<Record<number, number>> = {
  2016: 0,
  2017: 0,
  2018: 0,
  2019: 0,
  2020: 75,
  2022: 0,
  2023: 0,
  2024: 0,
  2025: 0,
  2026: 0,
};

/**
 * Cross-season running totals, printed once at the end of the file's run.
 * The plan's verification step reads these off the test's own output — a
 * reconciliation whose population is invisible is one nobody can sanity
 * check, so the numbers are printed as well as asserted.
 */
const TOTALS: Record<string, number> = {};
function tally(label: string, amount: number): void {
  TOTALS[label] = (TOTALS[label] ?? 0) + amount;
}

afterAll(() => {
  if (!CORPUS_AVAILABLE) return;
  const lines = Object.entries(TOTALS)
    .map(([label, value]) => `  ${label}: ${value}`)
    .join("\n");
  console.log(`[pointFormulas.reconciliation] cross-season totals\n${lines}`);
});

function loadDistrictRankings(db: ReturnType<typeof openCorpusReadOnly>, year: number): DistrictRankingRow[] {
  return db
    .prepare(
      `SELECT dr.team_key, dr.event_points_raw
       FROM district_rankings dr
       JOIN districts d ON d.district_key = dr.district_key
       WHERE d.year = ?`
    )
    .all(year) as DistrictRankingRow[];
}

function loadEventRankings(db: ReturnType<typeof openCorpusReadOnly>, year: number): EventRankingRow[] {
  return db
    .prepare(
      `SELECT er.event_key, er.team_key, er.rank, er.total_teams
       FROM event_rankings er
       JOIN events e ON e.event_key = er.event_key
       WHERE e.year = ?`
    )
    .all(year) as EventRankingRow[];
}

/** `${event_key}|${team_key}` -> that team's qualification rank and the event's field size. */
function indexEventRankings(rows: readonly EventRankingRow[]): Map<string, EventRankingRow> {
  const byKey = new Map<string, EventRankingRow>();
  for (const row of rows) byKey.set(`${row.event_key}|${row.team_key}`, row);
  return byKey;
}

interface QualBlockResult {
  checked: number;
  mismatches: string[];
  unresolvable: string[];
}

function reconcileQualPoints(year: number): QualBlockResult {
  const db = openCorpusReadOnly(CORPUS_PATH);
  let districtRankings: DistrictRankingRow[];
  let eventRankings: EventRankingRow[];
  try {
    districtRankings = loadDistrictRankings(db, year);
    eventRankings = loadEventRankings(db, year);
  } finally {
    db.close();
  }

  const rankingIndex = indexEventRankings(eventRankings);
  const result: QualBlockResult = { checked: 0, mismatches: [], unresolvable: [] };

  for (const row of districtRankings) {
    const entries = JSON.parse(row.event_points_raw) as EventPointsEntry[];
    for (const entry of entries) {
      // Tier from the entry's OWN district_cmp boolean. This block proves
      // the base-tier formula, so a dcmp entry is out of its scope.
      if (entry.district_cmp) continue;

      const ranking = rankingIndex.get(`${entry.event_key}|${row.team_key}`);
      if (ranking === undefined) {
        result.unresolvable.push(`${year} ${row.team_key} @ ${entry.event_key}`);
        continue;
      }

      result.checked++;
      const expected = qualPoints(ranking.rank, ranking.total_teams);
      if (expected !== entry.qual_points) {
        result.mismatches.push(
          `season ${year} team ${row.team_key} event ${entry.event_key}: rank ${ranking.rank} of ${ranking.total_teams} -> qualPoints expected ${expected}, TBA reported ${entry.qual_points}`
        );
      }
    }
  }

  return result;
}

describe.each(DISTRICT_REGISTERED_SEASONS)("season %i district point formula reconciliation", (year) => {
  if (!CORPUS_AVAILABLE) {
    it.skip(SKIP_MESSAGE, () => {});
    return;
  }

  it(`qualPoints(rank, fieldSize) reproduces every resolvable district-tier qual_points TBA reported in ${year}`, () => {
    const { checked, mismatches, unresolvable } = reconcileQualPoints(year);
    tally("qual.checked", checked);
    tally("qual.unresolvable", unresolvable.length);
    tally("qual.mismatches", mismatches.length);
    console.log(
      `[qual ${year}] checked=${checked} mismatches=${mismatches.length} unresolvable=${unresolvable.length}`
    );

    expect(
      mismatches,
      `${mismatches.length} qualification mismatch(es) in ${year}:\n${mismatches.slice(0, 20).join("\n")}`
    ).toEqual([]);

    // Population floor (Fact 4): a shrinking scan is a regression, not a
    // quieter pass.
    expect(
      checked,
      `season ${year} checked only ${checked} district-tier qual_points entries, below the ${EXPECTED_QUAL_CHECKED[year]} measured on 2026-09-25 — an ingest regression shrank the scan`
    ).toBeGreaterThanOrEqual(EXPECTED_QUAL_CHECKED[year]!);

    // Unresolvable ceiling (Fact 4): only 2020 has any, and only 75.
    expect(
      unresolvable.length,
      `season ${year} has ${unresolvable.length} district-tier entries with no event_rankings row (ceiling ${MAX_QUAL_UNRESOLVABLE[year]}):\n${unresolvable.slice(0, 20).join("\n")}`
    ).toBeLessThanOrEqual(MAX_QUAL_UNRESOLVABLE[year]!);

    // Non-vacuity: an accidentally-empty scan must not pass.
    expect(checked).toBeGreaterThan(0);
  });
});
