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
import { selectionPoints } from "./selectionPoints.js";

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

interface EventAllianceRow {
  event_key: string;
  alliance_number: number;
  picks: string;
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

/**
 * Fact 5, measured read-only against `data/corpus.sqlite` on 2026-09-25
 * while planning 10-01: the per-season count of real pick slots at
 * EIGHT-ALLIANCE district events the selection formula was proven exact
 * on. 20,209 in total, zero mismatches. A floor, for the same reason as
 * `EXPECTED_QUAL_CHECKED`.
 */
const EXPECTED_SELECTION_CHECKED: Readonly<Record<number, number>> = {
  2016: 1477,
  2017: 1838,
  2018: 1952,
  2019: 2296,
  2020: 825,
  2022: 1731,
  2023: 2255,
  2024: 2380,
  2025: 2473,
  2026: 2982,
};

/**
 * Fact 5's two exclusion ceilings, summed across all ten seasons: 4,014
 * pick slots with no base-tier `event_points_raw` entry for the event, and
 * 174 alliances excluded by the eight-alliance restriction (102 of them in
 * 2022, exactly as measured).
 *
 * This block splits Fact 5's single 4,014 figure into its two real causes,
 * measured during execution: 645 slots whose team has no entry for the
 * event at ANY tier (a non-district team playing a district event) plus
 * 3,369 slots whose only entry is dcmp-tier (a district championship's own
 * alliances, outside this base-tier block's scope). 645 + 3,369 = 4,014, so
 * the split reconciles exactly with the planning measurement — Fact 5
 * simply did not separate the two. The ceiling below is kept on the
 * combined figure so it remains comparable to Fact 5.
 *
 * Ceilings rather than equalities so a later ingest that resolves more
 * teams is an improvement, not a failure — but neither exclusion can grow
 * silently.
 */
const MAX_SELECTION_ABSENT_TEAM_TOTAL = 4014;
const MAX_SELECTION_EXCLUDED_NON_EIGHT_TOTAL = 174;

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

// ---------------------------------------------------------------------------
// Alliance selection block
// ---------------------------------------------------------------------------

function loadDistrictEventAlliances(db: ReturnType<typeof openCorpusReadOnly>, year: number): EventAllianceRow[] {
  return db
    .prepare(
      `SELECT ea.event_key, ea.alliance_number, ea.picks
       FROM event_alliances ea
       JOIN events e ON e.event_key = ea.event_key
       WHERE e.year = ? AND e.district_key IS NOT NULL
       ORDER BY ea.event_key, ea.alliance_number`
    )
    .all(year) as EventAllianceRow[];
}

/** `team_key` -> (`event_key` -> that team's base-tier `event_points_raw` entry for the event). */
function indexBaseTierEntriesByTeam(rows: readonly DistrictRankingRow[]): Map<string, Map<string, EventPointsEntry>> {
  const byTeam = new Map<string, Map<string, EventPointsEntry>>();
  for (const row of rows) {
    const entries = JSON.parse(row.event_points_raw) as EventPointsEntry[];
    let forTeam = byTeam.get(row.team_key);
    if (forTeam === undefined) {
      forTeam = new Map<string, EventPointsEntry>();
      byTeam.set(row.team_key, forTeam);
    }
    for (const entry of entries) {
      // Base tier only — this block proves the unweighted formula. A
      // dcmp-tier entry for the same event key cannot overwrite a base-tier
      // one, and its absence is counted separately below.
      if (entry.district_cmp) continue;
      forTeam.set(entry.event_key, entry);
    }
  }
  return byTeam;
}

interface SelectionBlockResult {
  checked: number;
  mismatches: string[];
  /** Pick slots whose team has no base-tier entry for the event: a non-district team playing a district event. */
  absentTeam: number;
  /** Alliances dropped by the eight-alliance restriction. */
  excludedNonEight: number;
  /** Pick slots whose only entry for the event is dcmp-tier — a district championship's own alliances, out of this block's base-tier scope. */
  dcmpTier: number;
}

/**
 * Reconciles `selectionPoints(pickIndex, allianceNumber)` against TBA's own
 * reported `alliance_points` for every real pick slot at every
 * eight-alliance district event in `year`.
 *
 * THE EIGHT-ALLIANCE RESTRICTION IS LOAD-BEARING, NOT TIDINESS. Without it
 * 2022 produces 209 mismatches — and they are not a formula error. They
 * localize entirely to 26 COVID-era split district events (`event_type` 1,
 * names ending "Day 1"/"Day 2", e.g. `2022dc305`, `2022on034`,
 * `2022va319`) that ran with FOUR alliances, and a four-alliance event's
 * alliance point model is a different model (its observed values read as if
 * shifted by one seed). A reader who does not know this will "simplify" the
 * filter away and get 209 red assertions with no explanation. It filters by
 * MEASURED alliance count rather than by season or event key, so the same
 * rule also catches the divisioned district-championship parents and
 * anything similar a future ingest adds.
 *
 * `restrictToEightAlliances` exists so that removal is a one-line local
 * experiment (it is how the 209 figure above was re-confirmed during
 * execution) rather than an edit to the filter logic. It must stay `true`
 * for every committed assertion.
 */
function reconcileSelectionPoints(year: number, restrictToEightAlliances = true): SelectionBlockResult {
  const db = openCorpusReadOnly(CORPUS_PATH);
  let alliances: EventAllianceRow[];
  let districtRankings: DistrictRankingRow[];
  try {
    alliances = loadDistrictEventAlliances(db, year);
    districtRankings = loadDistrictRankings(db, year);
  } finally {
    db.close();
  }

  const allianceCountByEvent = new Map<string, number>();
  for (const row of alliances) {
    allianceCountByEvent.set(row.event_key, (allianceCountByEvent.get(row.event_key) ?? 0) + 1);
  }

  const entriesByTeam = indexBaseTierEntriesByTeam(districtRankings);
  const result: SelectionBlockResult = { checked: 0, mismatches: [], absentTeam: 0, excludedNonEight: 0, dcmpTier: 0 };

  // Teams whose only entry for an event is dcmp-tier, resolved by rescanning
  // the raw rows once — needed only to separate "non-district team" from
  // "district championship alliance" in the exclusion counts.
  const dcmpEventKeysByTeam = new Map<string, Set<string>>();
  for (const row of districtRankings) {
    const entries = JSON.parse(row.event_points_raw) as EventPointsEntry[];
    for (const entry of entries) {
      if (!entry.district_cmp) continue;
      let keys = dcmpEventKeysByTeam.get(row.team_key);
      if (keys === undefined) {
        keys = new Set<string>();
        dcmpEventKeysByTeam.set(row.team_key, keys);
      }
      keys.add(entry.event_key);
    }
  }

  for (const row of alliances) {
    if (restrictToEightAlliances && allianceCountByEvent.get(row.event_key) !== 8) {
      result.excludedNonEight++;
      continue;
    }

    const picks = JSON.parse(row.picks) as string[];
    for (let pickIndex = 0; pickIndex < picks.length; pickIndex++) {
      const teamKey = picks[pickIndex]!;
      const entry = entriesByTeam.get(teamKey)?.get(row.event_key);
      if (entry === undefined) {
        if (dcmpEventKeysByTeam.get(teamKey)?.has(row.event_key) === true) result.dcmpTier++;
        else result.absentTeam++;
        continue;
      }

      result.checked++;
      const expected = selectionPoints(pickIndex, row.alliance_number);
      if (expected !== entry.alliance_points) {
        result.mismatches.push(
          `season ${year} event ${row.event_key} alliance ${row.alliance_number} pick ${pickIndex} team ${teamKey}: selectionPoints expected ${expected}, TBA reported ${entry.alliance_points}`
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

  it(`selectionPoints(pickIndex, allianceNumber) reproduces every resolvable alliance_points TBA reported at ${year}'s eight-alliance district events`, () => {
    const { checked, mismatches, absentTeam, excludedNonEight, dcmpTier } = reconcileSelectionPoints(year);
    tally("selection.checked", checked);
    tally("selection.mismatches", mismatches.length);
    tally("selection.absentTeam", absentTeam);
    tally("selection.excludedNonEight", excludedNonEight);
    tally("selection.dcmpTier", dcmpTier);
    console.log(
      `[selection ${year}] checked=${checked} mismatches=${mismatches.length} absentTeam=${absentTeam} excludedNonEightAlliances=${excludedNonEight} dcmpTierSlots=${dcmpTier}`
    );

    expect(
      mismatches,
      `${mismatches.length} selection mismatch(es) in ${year}:\n${mismatches.slice(0, 20).join("\n")}`
    ).toEqual([]);

    // Population floor (Fact 5).
    expect(
      checked,
      `season ${year} checked only ${checked} pick slots, below the ${EXPECTED_SELECTION_CHECKED[year]} measured on 2026-09-25 — an ingest regression shrank the scan`
    ).toBeGreaterThanOrEqual(EXPECTED_SELECTION_CHECKED[year]!);

    // Non-vacuity.
    expect(checked).toBeGreaterThan(0);
  });
});

describe("alliance selection exclusion populations, summed across every registered season", () => {
  if (!CORPUS_AVAILABLE) {
    it.skip(SKIP_MESSAGE, () => {});
    return;
  }

  it("keeps both exclusions at or below the populations measured on 2026-09-25", () => {
    let absentTeam = 0;
    let dcmpTier = 0;
    let excludedNonEight = 0;
    let checked = 0;
    for (const year of DISTRICT_REGISTERED_SEASONS) {
      const result = reconcileSelectionPoints(year);
      absentTeam += result.absentTeam;
      dcmpTier += result.dcmpTier;
      excludedNonEight += result.excludedNonEight;
      checked += result.checked;
    }
    console.log(
      `[selection totals] checked=${checked} absentTeam=${absentTeam} dcmpTierSlots=${dcmpTier} unresolvedBaseTier=${absentTeam + dcmpTier} excludedNonEightAlliances=${excludedNonEight}`
    );

    expect(
      absentTeam + dcmpTier,
      `${absentTeam + dcmpTier} pick slots have no base-tier event_points entry, above the measured ${MAX_SELECTION_ABSENT_TEAM_TOTAL}`
    ).toBeLessThanOrEqual(MAX_SELECTION_ABSENT_TEAM_TOTAL);
    expect(
      excludedNonEight,
      `${excludedNonEight} alliances were excluded by the eight-alliance restriction, above the measured ${MAX_SELECTION_EXCLUDED_NON_EIGHT_TOTAL}`
    ).toBeLessThanOrEqual(MAX_SELECTION_EXCLUDED_NON_EIGHT_TOTAL);
    expect(checked).toBeGreaterThanOrEqual(20_209);
  });
});
