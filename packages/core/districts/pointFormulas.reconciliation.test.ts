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
import {
  BRACKET_REGISTERED_SEASONS,
  DIVISIONED_DCMP_PLAYOFF_OBSERVATIONS,
  playoffPoints,
  routeBracket,
  type DivisionedDcmpObservation,
} from "./bracket.js";
import { DISTRICT_REGISTERED_SEASONS } from "./pointModel.js";
import { districtTierWeight, qualPoints } from "./qualPoints.js";
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

interface PlayoffMatchRow {
  event_key: string;
  comp_level: string;
  set_number: number;
  match_number: number;
  winner: string | null;
  red_teams: string;
  blue_teams: string;
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

/**
 * The playoff block's populations, measured during execution of 10-01
 * (2026-09-25) over 2023 through 2026. Fact 1 gave the event-level shape
 * (418 district-tier eight-alliance events, 408 showing the exact
 * {30, 20, 13, 7, 0, 0, 0, 0} multiset); these are the row-level figures
 * that go with it: 478 complete brackets routed from real match rows
 * (105 / 112 / 118 / 143 by season) against 13 whose real matches could not
 * resolve a routing, 10,278 team-level `elim_points` values checked, zero
 * mismatches.
 *
 * Checked is a floor; every exclusion is a ceiling.
 */
const EXPECTED_PLAYOFF_CHECKED = 10_278;
const MAX_PLAYOFF_EXCLUDED_FOUR_ROBOT = 330;
const MAX_PLAYOFF_PRORATED_THREE_PICK = 1;
const MAX_PLAYOFF_ABSENT_TEAM = 201;

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

// ---------------------------------------------------------------------------
// Playoff bracket block
// ---------------------------------------------------------------------------

function loadDistrictPlayoffMatches(db: ReturnType<typeof openCorpusReadOnly>, year: number): PlayoffMatchRow[] {
  return db
    .prepare(
      `SELECT m.event_key, m.comp_level, m.set_number, m.match_number, m.winner, m.red_teams, m.blue_teams
       FROM matches m
       JOIN events e ON e.event_key = m.event_key
       WHERE e.year = ? AND e.district_key IS NOT NULL AND m.comp_level IN ('sf', 'f')`
    )
    .all(year) as PlayoffMatchRow[];
}

/** Raised inside a decider when a real match cannot resolve a winner; caught per event, which is then counted as unreconcilable rather than failed. */
class UnreconcilableEventError extends Error {}

interface PlayoffBlockResult {
  checked: number;
  mismatches: string[];
  /** Events with a complete eight-alliance bracket that reconciled end to end. */
  reconciledEvents: number;
  /** Events with a complete bracket whose real matches could not resolve a routing (a tie, an unplayed set, an unmappable alliance). */
  unreconcilableEvents: number;
  /** Alliances excluded because their `picks` array is not exactly three teams — Fact 3's backup-robot proration. */
  excludedFourRobot: number;
  /**
   * Three-pick alliances whose teams do NOT all report the same
   * `elim_points`: a backup robot substituted in without TBA adding a
   * fourth `picks` entry, so the slot's points are split. The routed
   * placement is still proven for these, via the max-anchor assertion in
   * `reconcilePlayoffPoints` — only the prorated slot is set aside.
   */
  proratedThreePick: number;
  /** Pick slots whose team has no `event_points_raw` entry for the event: a non-district team on a district alliance. */
  absentTeam: number;
}

/**
 * Routes every complete 2023-plus eight-alliance district bracket in the
 * corpus from its REAL match results and checks the resulting placement
 * points against TBA's own reported `elim_points`.
 *
 * The decider handed to `routeBracket` here reads real `matches` rows; in
 * 10-04 the decider will draw from a win-probability function. Same
 * `BRACKET_SETS`, same `routeBracket` — which is the point: this block
 * proves the exact routing code the browser will run.
 *
 * Two exclusions are counted rather than silently dropped. Fact 3: an
 * alliance that used a backup robot splits one slot's points across two
 * teams (`2023vabla` alliance 1 reads 30, 30, 5, 25 against a placement of
 * 30; `2023midet` alliance 3 reads 13, 13, 9, 5, which does not even sum to
 * 3x13), so only alliances whose `picks` array has exactly three entries
 * are reconciled. Fact 1: seven of the 418 eight-alliance events have an
 * alliance whose every pick is a non-district team absent from
 * `district_rankings`.
 */
function reconcilePlayoffPoints(year: number): PlayoffBlockResult {
  const db = openCorpusReadOnly(CORPUS_PATH);
  let alliances: EventAllianceRow[];
  let matches: PlayoffMatchRow[];
  let districtRankings: DistrictRankingRow[];
  try {
    alliances = loadDistrictEventAlliances(db, year);
    matches = loadDistrictPlayoffMatches(db, year);
    districtRankings = loadDistrictRankings(db, year);
  } finally {
    db.close();
  }

  // team_key -> event_key -> entry, at whichever tier the entry declares.
  const entriesByTeam = new Map<string, Map<string, EventPointsEntry>>();
  for (const row of districtRankings) {
    let forTeam = entriesByTeam.get(row.team_key);
    if (forTeam === undefined) {
      forTeam = new Map<string, EventPointsEntry>();
      entriesByTeam.set(row.team_key, forTeam);
    }
    for (const entry of JSON.parse(row.event_points_raw) as EventPointsEntry[]) {
      forTeam.set(entry.event_key, entry);
    }
  }

  const alliancesByEvent = new Map<string, EventAllianceRow[]>();
  for (const row of alliances) {
    const list = alliancesByEvent.get(row.event_key);
    if (list === undefined) alliancesByEvent.set(row.event_key, [row]);
    else list.push(row);
  }

  const matchesByEvent = new Map<string, PlayoffMatchRow[]>();
  for (const row of matches) {
    const list = matchesByEvent.get(row.event_key);
    if (list === undefined) matchesByEvent.set(row.event_key, [row]);
    else list.push(row);
  }

  const result: PlayoffBlockResult = {
    checked: 0,
    mismatches: [],
    reconciledEvents: 0,
    unreconcilableEvents: 0,
    excludedFourRobot: 0,
    proratedThreePick: 0,
    absentTeam: 0,
  };

  for (const [eventKey, eventAlliances] of alliancesByEvent) {
    if (eventAlliances.length !== 8) continue;
    const eventMatches = matchesByEvent.get(eventKey);
    if (eventMatches === undefined) continue;

    const sfSets = new Set(eventMatches.filter((m) => m.comp_level === "sf").map((m) => m.set_number));
    const finalMatches = eventMatches.filter((m) => m.comp_level === "f");
    if (sfSets.size !== 13 || finalMatches.length < 2) continue;

    // team_key -> alliance_number, for mapping a match's colour back to an alliance.
    const allianceByTeam = new Map<string, number>();
    for (const row of eventAlliances) {
      for (const teamKey of JSON.parse(row.picks) as string[]) allianceByTeam.set(teamKey, row.alliance_number);
    }

    const matchIndex = new Map<string, PlayoffMatchRow>();
    for (const m of eventMatches) matchIndex.set(`${m.comp_level}|${m.set_number}|${m.match_number}`, m);

    /** The alliance number the majority of a colour's teams belong to, or null when none of them do. */
    function allianceOfColour(teamsJson: string): number | null {
      const votes = new Map<number, number>();
      for (const teamKey of JSON.parse(teamsJson) as string[]) {
        const allianceNumber = allianceByTeam.get(teamKey);
        if (allianceNumber === undefined) continue;
        votes.set(allianceNumber, (votes.get(allianceNumber) ?? 0) + 1);
      }
      let best: number | null = null;
      let bestVotes = 0;
      for (const [allianceNumber, count] of votes) {
        if (count > bestVotes) {
          best = allianceNumber;
          bestVotes = count;
        }
      }
      return best;
    }

    let routed;
    try {
      routed = routeBracket((allianceA, allianceB, setId, matchNumber) => {
        const compLevel = setId === "f" ? "f" : "sf";
        const setNumber = setId === "f" ? 1 : Number(setId.slice(2));
        const rowMatchNumber = setId === "f" ? matchNumber : 1;
        const row = matchIndex.get(`${compLevel}|${setNumber}|${rowMatchNumber}`);
        if (row === undefined || (row.winner !== "red" && row.winner !== "blue")) {
          throw new UnreconcilableEventError(`${eventKey} ${setId} match ${rowMatchNumber} has no decisive result`);
        }
        const winningAlliance = allianceOfColour(row.winner === "red" ? row.red_teams : row.blue_teams);
        if (winningAlliance !== allianceA && winningAlliance !== allianceB) {
          throw new UnreconcilableEventError(
            `${eventKey} ${setId}: winning colour maps to alliance ${winningAlliance}, not ${allianceA} or ${allianceB}`
          );
        }
        return winningAlliance;
      });
    } catch (error) {
      if (error instanceof UnreconcilableEventError) {
        result.unreconcilableEvents++;
        continue;
      }
      throw error;
    }

    result.reconciledEvents++;

    for (const row of eventAlliances) {
      const picks = JSON.parse(row.picks) as string[];
      if (picks.length !== 3) {
        result.excludedFourRobot++;
        continue;
      }
      const placement = routed.placementByAlliance.get(row.alliance_number)!;
      const resolved: { teamKey: string; tier: "district" | "dcmp"; observed: number }[] = [];
      for (const teamKey of picks) {
        const entry = entriesByTeam.get(teamKey)?.get(eventKey);
        if (entry === undefined) {
          result.absentTeam++;
          continue;
        }
        resolved.push({ teamKey, tier: entry.district_cmp ? "dcmp" : "district", observed: entry.elim_points });
      }
      if (resolved.length === 0) continue;

      const observedValues = new Set(resolved.map((r) => r.observed));
      if (observedValues.size > 1) {
        // A backup robot substituted in WITHOUT TBA adding a fourth `picks`
        // entry (measured at `2024onwat` alliance 2, where the winning
        // alliance reads 30, 30, 25 and a team absent from `picks`
        // — frc9663 — appears in the first final). Fact 3 scopes its
        // exclusion to four-entry `picks` arrays, which does not catch this
        // shape. The alliance's PLACEMENT is still proven: the unprorated
        // teams carry the full value, so the maximum observed value must
        // equal the routed expectation. Only the split slot is set aside.
        result.proratedThreePick++;
        const expected = playoffPoints(year, resolved[0]!.tier, placement);
        const highest = Math.max(...resolved.map((r) => r.observed));
        if (highest !== expected) {
          result.mismatches.push(
            `season ${year} event ${eventKey} alliance ${row.alliance_number} (prorated, values ${resolved
              .map((r) => `${r.teamKey}=${r.observed}`)
              .join(", ")}): routed placement ${placement} -> playoffPoints expected ${expected}, highest observed ${highest}`
          );
        }
        continue;
      }

      for (const { teamKey, tier, observed } of resolved) {
        result.checked++;
        const expected = playoffPoints(year, tier, placement);
        if (expected !== observed) {
          result.mismatches.push(
            `season ${year} event ${eventKey} alliance ${row.alliance_number} team ${teamKey} (${tier}): routed placement ${placement} -> playoffPoints expected ${expected}, TBA reported ${observed}`
          );
        }
      }
    }
  }

  return result;
}

/**
 * Re-measures `DIVISIONED_DCMP_PLAYOFF_OBSERVATIONS` from the corpus, so
 * the committed table is proven equal to the measurement in the same run
 * rather than trusted. Alliance count -> alliance number -> point value ->
 * observation count.
 */
function measureDivisionedDcmpObservations(): {
  table: Map<number, Map<number, Map<number, number>>>;
  parentEvents: number;
  unresolvedAlliances: number;
  proratedAlliances: number;
} {
  const table = new Map<number, Map<number, Map<number, number>>>();
  let parentEvents = 0;
  let unresolvedAlliances = 0;
  let proratedAlliances = 0;

  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    for (const year of BRACKET_REGISTERED_SEASONS) {
      const alliances = loadDistrictEventAlliances(db, year);
      const districtRankings = loadDistrictRankings(db, year);
      const weight = districtTierWeight(year, "dcmp");

      const dcmpEntriesByTeam = new Map<string, Map<string, EventPointsEntry>>();
      for (const row of districtRankings) {
        let forTeam = dcmpEntriesByTeam.get(row.team_key);
        if (forTeam === undefined) {
          forTeam = new Map<string, EventPointsEntry>();
          dcmpEntriesByTeam.set(row.team_key, forTeam);
        }
        for (const entry of JSON.parse(row.event_points_raw) as EventPointsEntry[]) {
          if (entry.district_cmp) forTeam.set(entry.event_key, entry);
        }
      }

      const byEvent = new Map<string, EventAllianceRow[]>();
      for (const row of alliances) {
        const list = byEvent.get(row.event_key);
        if (list === undefined) byEvent.set(row.event_key, [row]);
        else list.push(row);
      }

      for (const [eventKey, eventAlliances] of byEvent) {
        const allianceCount = eventAlliances.length;
        if (allianceCount === 8) continue;
        parentEvents++;

        for (const row of eventAlliances) {
          const values = new Set<number>();
          for (const teamKey of JSON.parse(row.picks) as string[]) {
            const entry = dcmpEntriesByTeam.get(teamKey)?.get(eventKey);
            if (entry !== undefined) values.add(entry.elim_points / weight);
          }
          if (values.size === 0) {
            unresolvedAlliances++;
            continue;
          }
          if (values.size > 1) {
            proratedAlliances++;
            continue;
          }
          const points = [...values][0]!;
          let byNumber = table.get(allianceCount);
          if (byNumber === undefined) {
            byNumber = new Map<number, Map<number, number>>();
            table.set(allianceCount, byNumber);
          }
          let byPoints = byNumber.get(row.alliance_number);
          if (byPoints === undefined) {
            byPoints = new Map<number, number>();
            byNumber.set(row.alliance_number, byPoints);
          }
          byPoints.set(points, (byPoints.get(points) ?? 0) + 1);
        }
      }
    }
  } finally {
    db.close();
  }

  return { table, parentEvents, unresolvedAlliances, proratedAlliances };
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

describe.each(BRACKET_REGISTERED_SEASONS)("season %i playoff bracket reconciliation", (year) => {
  if (!CORPUS_AVAILABLE) {
    it.skip(SKIP_MESSAGE, () => {});
    return;
  }

  it(`routing ${year}'s real eight-alliance district brackets reproduces every resolvable elim_points TBA reported`, () => {
    const result = reconcilePlayoffPoints(year);
    tally("playoff.checked", result.checked);
    tally("playoff.mismatches", result.mismatches.length);
    tally("playoff.reconciledEvents", result.reconciledEvents);
    tally("playoff.unreconcilableEvents", result.unreconcilableEvents);
    tally("playoff.excludedFourRobotAlliances", result.excludedFourRobot);
    tally("playoff.proratedThreePickAlliances", result.proratedThreePick);
    tally("playoff.absentTeam", result.absentTeam);
    console.log(
      `[playoff ${year}] events=${result.reconciledEvents} unreconcilable=${result.unreconcilableEvents} checked=${result.checked} mismatches=${result.mismatches.length} excludedFourRobotAlliances=${result.excludedFourRobot} proratedThreePick=${result.proratedThreePick} absentTeam=${result.absentTeam}`
    );

    expect(
      result.mismatches,
      `${result.mismatches.length} playoff mismatch(es) in ${year}:\n${result.mismatches.slice(0, 20).join("\n")}`
    ).toEqual([]);
    expect(result.reconciledEvents, `season ${year} reconciled no complete brackets at all`).toBeGreaterThan(0);
    expect(result.checked).toBeGreaterThan(0);
  });
});

describe("playoff bracket populations and the divisioned-dcmp fallback, across 2023 through 2026", () => {
  if (!CORPUS_AVAILABLE) {
    it.skip(SKIP_MESSAGE, () => {});
    return;
  }

  it("reconciles at least 400 complete eight-alliance district brackets, with both exclusions pinned", () => {
    let checked = 0;
    let reconciledEvents = 0;
    let unreconcilableEvents = 0;
    let excludedFourRobot = 0;
    let proratedThreePick = 0;
    let absentTeam = 0;
    for (const year of BRACKET_REGISTERED_SEASONS) {
      const result = reconcilePlayoffPoints(year);
      checked += result.checked;
      reconciledEvents += result.reconciledEvents;
      unreconcilableEvents += result.unreconcilableEvents;
      excludedFourRobot += result.excludedFourRobot;
      proratedThreePick += result.proratedThreePick;
      absentTeam += result.absentTeam;
    }
    console.log(
      `[playoff totals] reconciledEvents=${reconciledEvents} unreconcilableEvents=${unreconcilableEvents} checked=${checked} excludedFourRobotAlliances=${excludedFourRobot} proratedThreePick=${proratedThreePick} absentTeam=${absentTeam}`
    );

    expect(
      reconciledEvents,
      `only ${reconciledEvents} complete eight-alliance district brackets reconciled across 2023 through 2026, below the 400 floor`
    ).toBeGreaterThanOrEqual(400);
    expect(
      excludedFourRobot,
      `${excludedFourRobot} alliances were excluded for carrying a backup robot, above the ${MAX_PLAYOFF_EXCLUDED_FOUR_ROBOT} measured during execution`
    ).toBeLessThanOrEqual(MAX_PLAYOFF_EXCLUDED_FOUR_ROBOT);
    expect(
      proratedThreePick,
      `${proratedThreePick} three-pick alliances show a prorated split, above the ${MAX_PLAYOFF_PRORATED_THREE_PICK} measured during execution`
    ).toBeLessThanOrEqual(MAX_PLAYOFF_PRORATED_THREE_PICK);
    expect(
      absentTeam,
      `${absentTeam} pick slots have no event_points entry, above the ${MAX_PLAYOFF_ABSENT_TEAM} measured during execution`
    ).toBeLessThanOrEqual(MAX_PLAYOFF_ABSENT_TEAM);
    expect(checked).toBeGreaterThanOrEqual(EXPECTED_PLAYOFF_CHECKED);
  });

  it("reproduces DIVISIONED_DCMP_PLAYOFF_OBSERVATIONS exactly from the corpus, cell for cell", () => {
    const { table, parentEvents, unresolvedAlliances, proratedAlliances } = measureDivisionedDcmpObservations();
    console.log(
      `[divisioned dcmp] parentEvents=${parentEvents} unresolvedAlliances=${unresolvedAlliances} proratedAlliances=${proratedAlliances}`
    );

    expect(parentEvents, "the divisioned-dcmp parent population is not the 16 events Fact 2 measured").toBe(16);
    expect(proratedAlliances, "a prorated alliance appeared at a divisioned-dcmp parent, which Fact 2 did not observe").toBe(0);
    expect(unresolvedAlliances).toBe(7);

    // Every alliance count the measurement found must be one the committed
    // table carries, and vice versa.
    expect([...table.keys()].sort((a, b) => a - b)).toEqual([2, 4]);

    for (const allianceCount of [2, 4] as const) {
      const measured = table.get(allianceCount)!;
      const committed = DIVISIONED_DCMP_PLAYOFF_OBSERVATIONS[allianceCount];
      expect(
        [...measured.keys()].sort((a, b) => a - b),
        `alliance numbers observed at ${allianceCount}-alliance parents`
      ).toEqual(Object.keys(committed).map(Number).sort((a, b) => a - b));

      for (const [allianceNumber, byPoints] of measured) {
        const measuredEntries: DivisionedDcmpObservation[] = [...byPoints.entries()]
          .map(([points, count]) => ({ points, count }))
          .sort((a, b) => a.points - b.points);
        expect(
          measuredEntries,
          `committed DIVISIONED_DCMP_PLAYOFF_OBSERVATIONS[${allianceCount}][${allianceNumber}] does not match the corpus`
        ).toEqual(committed[allianceNumber]);
      }
    }
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
