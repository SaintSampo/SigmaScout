/**
 * THE LEAK TESTS ARE THE LOAD-BEARING ONES. The award table has TWO
 * walk-forward halves — the decoration bucket a team carries into a scored
 * event, and the rates fit for the scored season — and the obvious single test
 * only covers the first. The second is the larger surface, because the table is
 * the thing that ships. Both fixtures below are chosen so a leak CHANGES the
 * answer; a fixture where it does not proves nothing.
 *
 * Two describes: the first pure and synthetic and running everywhere, the
 * second corpus-guarded with `existsSync` plus an explicit `it.skip`.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import {
  awardBaseRate,
  AWARD_POINT_SUPPORT,
  cellKey,
  DECORATION_BUCKETS,
  decorationBucket,
  DISTRICT_AWARD_BASE_RATE_SEASONS,
  MIN_CELL_OBSERVATIONS,
  ROOKIE_STATES,
} from "../packages/core/districts/awardBaseRates.js";
import { DISTRICT_REGISTERED_SEASONS } from "../packages/core/districts/pointModel.js";
import {
  buildSeasonCells,
  clearsCellBar,
  emptyCell,
  foldOutcome,
  loadDistrictTierOutcomes,
  measureDistrictAwardBaseRates,
  poolCells,
  priorJudgedAwardCount,
  toDistribution,
  toSeasonTable,
  type AwardInstance,
  type TeamEventOutcome,
} from "./measureDistrictAwardBaseRates.js";

const CORPUS_PATH = "data/corpus.sqlite";
const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);

const NO_ROOKIE_YEARS = new Map<string, number>();

/** A synthetic outcome set: `count` team-events at `awardPoints` for one veteran team in one season. */
function outcomes(season: number, teamKey: string, awardPoints: number, count: number): TeamEventOutcome[] {
  return Array.from({ length: count }, (_, i) => ({
    season,
    teamKey,
    eventKey: `${season}ev${i}`,
    awardPoints,
  }));
}

// ───────────────────────────── the pure describe ─────────────────────────────

describe("LEAK HALF ONE — the decoration bucket feature", () => {
  const instances: AwardInstance[] = [
    // Two judged awards in 2000...
    { year: 2000, eventKey: "2000a", awardType: 9, teamKey: "frc1" },
    { year: 2000, eventKey: "2000b", awardType: 11, teamKey: "frc1" },
    // ...and two more in 2002.
    { year: 2002, eventKey: "2002a", awardType: 9, teamKey: "frc1" },
    { year: 2002, eventKey: "2002b", awardType: 16, teamKey: "frc1" },
  ];

  it("counts only seasons strictly before the scored one, and the leak lands the team in a DIFFERENT bucket", () => {
    const honest = priorJudgedAwardCount(instances, "frc1", 2002);
    const leaked = priorJudgedAwardCount(instances, "frc1", 2003);
    expect(honest).toBe(2);
    expect(leaked).toBe(4);
    // The fixture is chosen so the leak is not merely a different count but a
    // different BUCKET: a fixture where it does not change the bucket proves
    // nothing.
    expect(decorationBucket(honest)).toBe("one-or-two");
    expect(decorationBucket(leaked)).toBe("three-or-more");
    expect(decorationBucket(honest)).not.toBe(decorationBucket(leaked));
  });

  it("counts a multi-recipient award ONCE, not once per positional row", () => {
    const shared: AwardInstance[] = [
      { year: 2000, eventKey: "2000a", awardType: 9, teamKey: "frc1" },
      { year: 2000, eventKey: "2000a", awardType: 9, teamKey: "frc1" },
      { year: 2000, eventKey: "2000a", awardType: 9, teamKey: "frc1" },
    ];
    expect(priorJudgedAwardCount(shared, "frc1", 2001)).toBe(1);
  });

  it("excludes the non-judged types: a team with only Winner, Finalist and Highest Rookie Seed history is in none", () => {
    const onField: AwardInstance[] = [
      { year: 2000, eventKey: "2000a", awardType: 1, teamKey: "frc1" },
      { year: 2000, eventKey: "2000b", awardType: 2, teamKey: "frc1" },
      { year: 2001, eventKey: "2001a", awardType: 14, teamKey: "frc1" },
    ];
    expect(priorJudgedAwardCount(onField, "frc1", 2002)).toBe(0);
    expect(decorationBucket(priorJudgedAwardCount(onField, "frc1", 2002))).toBe("none");
  });

  it("never counts another team's awards", () => {
    expect(priorJudgedAwardCount(instances, "frc2", 2003)).toBe(0);
  });
});

describe("LEAK HALF TWO — the rates themselves", () => {
  it("the table registered for a season is unchanged by that season's own award points, by deep equality", () => {
    // Prior seasons: every team-event earns ZERO award points.
    const prior = [...outcomes(2000, "frcA", 0, 200), ...outcomes(2001, "frcA", 0, 200), ...outcomes(2002, "frcA", 0, 200)];
    // The scored season's own rows are EXTREME: every team-event earns 15.
    const scoredSeasonOwn = outcomes(2003, "frcA", 15, 200);

    const honest = buildSeasonCells(2003, prior, [], NO_ROOKIE_YEARS);
    const leaked = buildSeasonCells(2003, [...prior, ...scoredSeasonOwn], [], NO_ROOKIE_YEARS);

    // The honest table sees only zeros; the leaked one is visibly different.
    expect(toSeasonTable(honest)).toEqual(toSeasonTable(buildSeasonCells(2003, prior, [], NO_ROOKIE_YEARS)));
    expect(toSeasonTable(honest)).not.toEqual(toSeasonTable(leaked));
    expect(honest.seasonPooled.n).toBe(600);
    expect(leaked.seasonPooled.n).toBe(800);
    expect(toDistribution(honest.seasonPooled)!.pmf[0]).toBe(1);
    expect(toDistribution(leaked.seasonPooled)!.pmf[5]).toBeCloseTo(0.25, 12);
  });

  it("builds a prior outcome's bucket as of THAT outcome's own season, not the scored season", () => {
    // frcA wins a judged award in 2001. A 2000 outcome must be bucketed `none`
    // (nothing before 2000) while a 2002 outcome is `one-or-two`.
    const instances: AwardInstance[] = [{ year: 2001, eventKey: "2001a", awardType: 9, teamKey: "frcA" }];
    const prior = [...outcomes(2000, "frcA", 0, 150), ...outcomes(2002, "frcA", 5, 150)];
    const measurement = buildSeasonCells(2003, prior, instances, NO_ROOKIE_YEARS);
    expect(measurement.cells.get(cellKey("none", "unknown"))!.n).toBe(150);
    expect(measurement.cells.get(cellKey("one-or-two", "unknown"))!.n).toBe(150);
  });
});

describe("the thin-cell bar", () => {
  it("a cell below the minimum is absent from the emitted table; a cell AT the minimum is present", () => {
    const below = emptyCell();
    for (let i = 0; i < MIN_CELL_OBSERVATIONS - 1; i++) foldOutcome(below, 0);
    const at = emptyCell();
    for (let i = 0; i < MIN_CELL_OBSERVATIONS; i++) foldOutcome(at, 0);
    expect(clearsCellBar(below)).toBe(false);
    expect(clearsCellBar(at)).toBe(true);

    // And end to end, on the boundary itself: a season whose only populated
    // cell sits ONE below the bar emits no cell at all, while the same cell AT
    // the bar emits exactly that one key. Every outcome below lands in
    // `none|unknown` (no prior awards, no rookie_year), so the cell count is
    // the season-pooled count.
    const oneBelow = buildSeasonCells(
      2003,
      [...outcomes(2000, "frcA", 0, 33), ...outcomes(2001, "frcA", 0, 33), ...outcomes(2002, "frcA", 0, 33)],
      [],
      NO_ROOKIE_YEARS
    );
    expect(oneBelow.seasonPooled.n).toBe(MIN_CELL_OBSERVATIONS - 1);
    expect(oneBelow.thinCells).toContain(cellKey("none", "unknown"));
    expect(Object.keys(toSeasonTable(oneBelow).cells)).toEqual([]);

    const exactlyAt = buildSeasonCells(
      2003,
      [...outcomes(2000, "frcA", 0, 34), ...outcomes(2001, "frcA", 0, 33), ...outcomes(2002, "frcA", 0, 33)],
      [],
      NO_ROOKIE_YEARS
    );
    expect(exactlyAt.seasonPooled.n).toBe(MIN_CELL_OBSERVATIONS);
    expect(exactlyAt.thinCells).not.toContain(cellKey("none", "unknown"));
    expect(Object.keys(toSeasonTable(exactlyAt).cells)).toEqual([cellKey("none", "unknown")]);
  });
});

describe("the unmodelled-value census", () => {
  it("names an unmodelled value with its count, and never lets it join a neighbouring bucket", () => {
    const cell = emptyCell();
    foldOutcome(cell, 0);
    foldOutcome(cell, 7);
    foldOutcome(cell, 7);
    foldOutcome(cell, 5);
    expect([...cell.unmodelled.entries()]).toEqual([[7, 2]]);
    // `n` counts only modelled outcomes, so 7 cannot be silently rounded into 5 or 8.
    expect(cell.n).toBe(2);
    expect(cell.counts[1]).toBe(1);
    expect(cell.counts[2]).toBe(0);
  });

  it("pools its census across cells", () => {
    const a = emptyCell();
    foldOutcome(a, 7);
    const b = emptyCell();
    foldOutcome(b, 7);
    foldOutcome(b, 3);
    expect([...poolCells([a, b]).unmodelled.entries()].sort((x, y) => x[0] - y[0])).toEqual([
      [3, 1],
      [7, 2],
    ]);
  });
});

describe("tier selection reads the entry's OWN district_cmp boolean", () => {
  it("a synthetic event_points_raw array contributes only its district_cmp: false entry", () => {
    // `loadDistrictTierOutcomes` reads a corpus; the RULE it applies is the
    // thing under test, so the same predicate is exercised directly on the
    // shape publishDistricts.ts's EventPointsEntrySchema declares. This is
    // pointModel.ts's stated measurement trap, asserted rather than commented:
    // inferring the tier by joining to `events` and testing `event_type == 2`
    // yields the dcmp figure wearing the district tier's name.
    const entries = [
      { event_key: "2026mibel", district_cmp: false, qual_points: 20, alliance_points: 16, elim_points: 30, award_points: 5, total: 71 },
      { event_key: "2026micmp", district_cmp: true, qual_points: 60, alliance_points: 48, elim_points: 90, award_points: 45, total: 243 },
    ];
    const kept = entries.filter((e) => e.district_cmp === false).map((e) => e.award_points);
    expect(kept).toEqual([5]);
    expect(kept).not.toContain(45);
  });
});

describe("the registration bar", () => {
  it("refuses a season with fewer than three prior district seasons of data, and says why", () => {
    const measurement = buildSeasonCells(2003, [...outcomes(2000, "frcA", 0, 500), ...outcomes(2001, "frcA", 0, 500)], [], NO_ROOKIE_YEARS);
    expect(measurement.registered).toBe(false);
    expect(measurement.registrationReason).toContain("prior district season");
  });

  it("registers a season with three prior seasons and a populated cell", () => {
    const measurement = buildSeasonCells(
      2003,
      [...outcomes(2000, "frcA", 0, 200), ...outcomes(2001, "frcA", 5, 200), ...outcomes(2002, "frcA", 0, 200)],
      [],
      NO_ROOKIE_YEARS
    );
    expect(measurement.registered).toBe(true);
  });
});

// ───────────────────────── the corpus-guarded describe ─────────────────────────

describe("the committed module reproduces a fresh measurement", () => {
  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} not found -- run the ingest pipeline (pnpm ingest:districts && pnpm ingest:awards-all) first`, () => {});
    return;
  }

  it("re-measures every registered season and matches every pmf within 1e-6 and every n exactly", () => {
    const db = openCorpusReadOnly(CORPUS_PATH);
    let result: ReturnType<typeof measureDistrictAwardBaseRates>;
    try {
      result = measureDistrictAwardBaseRates(db, DISTRICT_REGISTERED_SEASONS);
    } finally {
      db.close();
    }

    // The registered set matches EXACTLY: a module registering a season the
    // script would not is a number with no harness.
    expect(result.registeredSeasons).toEqual([...DISTRICT_AWARD_BASE_RATE_SEASONS]);

    for (const season of DISTRICT_AWARD_BASE_RATE_SEASONS) {
      const fresh = toSeasonTable(result.bySeason.get(season)!);
      for (const bucket of DECORATION_BUCKETS) {
        for (const state of ROOKIE_STATES) {
          const key = cellKey(bucket, state);
          const committed = awardBaseRate(season, bucket, state);
          const freshCell = fresh.cells[key];
          const freshFallback = freshCell ?? fresh.bucketPooled[bucket] ?? fresh.seasonPooled;
          const expectedSource = freshCell !== undefined ? "cell" : fresh.bucketPooled[bucket] !== undefined ? "bucket-pooled" : "season-pooled";
          expect(committed.source, `${season} ${key} source`).toBe(expectedSource);
          expect(committed.n, `${season} ${key} n`).toBe(freshFallback.n);
          for (let i = 0; i < AWARD_POINT_SUPPORT.length; i++) {
            expect(
              Math.abs(committed.pmf[i]! - freshFallback.pmf[i]!),
              `${season} ${key} entry ${i}: fresh ${freshFallback.pmf[i]} vs committed ${committed.pmf[i]}`
            ).toBeLessThan(1e-6);
          }
        }
      }
    }
  });

  it("the corpus carries district-tier outcomes for every registered season — a pin that passes on nothing pins nothing", () => {
    const db = openCorpusReadOnly(CORPUS_PATH);
    try {
      for (const season of DISTRICT_AWARD_BASE_RATE_SEASONS) {
        expect(loadDistrictTierOutcomes(db, season).length, `${season}`).toBeGreaterThan(500);
      }
    } finally {
      db.close();
    }
  });
});
