/**
 * Corpus-wide district-points reconciliation (quick task 260905-lic Task 2)
 * -- the test that makes the word "guaranteed" true. Mirrors
 * `packages/core/algorithms/sigma1/rp/reconciliation.test.ts`'s shape
 * (`existsSync` corpus guard, `openCorpusReadOnly` with `try/finally` close,
 * `describe.each`, an explicit skip message rather than a silent pass) but
 * proves a different invariant: every one of the four district point
 * components TBA has ever reported, at every ingested season, is at or below
 * `pointModel.ts`'s declared ceiling for that row's tier
 * (`district_cmp` picks the tier). A violation fails naming the offending
 * season, team key, event key, component name, observed value and declared
 * ceiling -- exactly what a human needs to either fix the declared ceiling
 * or investigate a genuine data anomaly.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openCorpusReadOnly } from "../../corpus/db.js";
import { DISTRICT_REGISTERED_SEASONS, maxEventPoints } from "./pointModel.js";

const CORPUS_PATH = "data/corpus.sqlite";
const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);

interface DistrictEventPointRow {
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

function sampleDistrictRankings(db: ReturnType<typeof openCorpusReadOnly>, year: number): DistrictRankingRow[] {
  return db
    .prepare(
      `SELECT dr.team_key, dr.event_points_raw
       FROM district_rankings dr
       JOIN districts d ON d.district_key = dr.district_key
       WHERE d.year = ?`
    )
    .all(year) as DistrictRankingRow[];
}

describe.each(DISTRICT_REGISTERED_SEASONS)("season %i district point reconciliation", (year) => {
  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} not found -- run the ingest pipeline (pnpm ingest:districts) first`, () => {});
    return;
  }

  it(`no district point component reported for ${year} exceeds pointModel.ts's declared ceiling for its tier`, () => {
    const db = openCorpusReadOnly(CORPUS_PATH);
    let rows: DistrictRankingRow[];
    try {
      rows = sampleDistrictRankings(db, year);
    } finally {
      db.close();
    }

    const districtMax = maxEventPoints(year, "district");
    const dcmpMax = maxEventPoints(year, "dcmp");
    let checked = 0;

    for (const row of rows) {
      const eventPoints = JSON.parse(row.event_points_raw) as DistrictEventPointRow[];
      for (const ep of eventPoints) {
        const tier = ep.district_cmp ? "dcmp" : "district";
        const max = tier === "dcmp" ? dcmpMax : districtMax;
        checked++;

        expect(
          ep.qual_points,
          `season ${year} team ${row.team_key} event ${ep.event_key} (${tier}): qual_points ${ep.qual_points} exceeds declared ceiling ${max.qual}`
        ).toBeLessThanOrEqual(max.qual);
        expect(
          ep.alliance_points,
          `season ${year} team ${row.team_key} event ${ep.event_key} (${tier}): alliance_points ${ep.alliance_points} exceeds declared ceiling ${max.alliance}`
        ).toBeLessThanOrEqual(max.alliance);
        expect(
          ep.elim_points,
          `season ${year} team ${row.team_key} event ${ep.event_key} (${tier}): elim_points ${ep.elim_points} exceeds declared ceiling ${max.elim}`
        ).toBeLessThanOrEqual(max.elim);
        expect(
          ep.award_points,
          `season ${year} team ${row.team_key} event ${ep.event_key} (${tier}): award_points ${ep.award_points} exceeds declared ceiling ${max.award}`
        ).toBeLessThanOrEqual(max.award);
      }
    }

    // A season with real district data must actually exercise at least one
    // component row -- an accidentally-empty scan would otherwise pass this
    // test vacuously and silently stop proving anything.
    expect(checked).toBeGreaterThan(0);
  });
});
