/**
 * SC-2 ("EPA runs walk-forward at any point in a season, and spot-checked
 * teams land within a documented tolerance of published Statbotics
 * numbers") — quick task 260904-4aa. Recorded blocked-on-external-dependency
 * since 2026-08-13 (`api.statbotics.io` reproducibly 500'd); re-verified
 * live 2026-09-04 that `/v3/team_years` is back up. This script replaces an
 * ad-hoc, un-re-runnable measurement (see `packages/core/algorithms/epa.ts`'s
 * file header) with a committed, re-runnable comparison.
 *
 * Season-loop shape mirrors `scripts/measureRewindGap.ts`: `openCorpusReadOnly`,
 * `buildSeasonStream`, `seasonBoundaryFor` (cold-starting positionally at
 * the first season in the requested range), `carrySeason` threading between
 * seasons. Statistics live in `packages/harness/epaStatboticsCompare.ts` — a
 * pure, network-free, corpus-free module this script calls into rather than
 * duplicating.
 *
 * Our comparable value, per team, is `total` — no subtraction here anymore.
 * As of `epa@3.0.0+baseline` (D-01, quick task 260904-5px), EPA's own
 * published `total` (`epa.ts`'s `teamMetrics()`) already excludes
 * `foulsCommitted`, exactly the no-foul figure Statbotics publishes as
 * `epa.total_points` (verified live 2026-09-04: `frc254`/2024 total_points
 * 51.71 == auto 15.94 + teleop 29.48 + endgame 6.28). The exclusion used to
 * live HERE, subtracting `foulsCommitted` from `total` after the fact; it
 * now lives in the metric itself, so this script reads `total` directly.
 * Demo team keys (raw `frc9970`-`frc9999` and the shared pseudo key) never
 * enter the join, on either side (`epaStatboticsCompare.ts`'s `joinTeams`).
 *
 * Usage:
 *   npx tsx scripts/epaVsStatbotics.ts                                    # full range, offseason-inclusive, writes reports/epa-vs-statbotics/
 *   npx tsx scripts/epaVsStatbotics.ts --seasons 2022-2026 --no-offseason --out reports/epa-vs-statbotics-nooff
 *   npx tsx scripts/epaVsStatbotics.ts --check                            # re-measures the default range and checks it against the committed baseline
 *
 * The offseason-excluded invocation above names the full 2022-2026 range,
 * not 2022-2025 — quick task 260908-n5o. The 2022-2025 restriction was
 * written when 2026 was still in progress; 2026 is now the season the
 * production tables already report, and the two arms must cover the same
 * seasons or they are not an A/B at all (`epaVersion` below is the OTHER
 * half of that same guarantee — see its own doc comment).
 *
 * Revision, same day, after reviewing the shipped page: the published
 * agreement table compared `minMatchesFiltered` — each team's SEASON-FINAL
 * total, offseason play included — against Statbotics. That is not the
 * number anyone sees on this site. The Teams list and the team-page header
 * both show a team's total as of its own LAST OFFICIAL match
 * (`packages/harness/publish.ts`'s `lastOfficialMetricsByTeam`), and that
 * quantity agrees with Statbotics far more closely than the season-final one
 * does. This script now also measures a THIRD arm, `officialOnly`, computed
 * by the SAME rule, so the published comparison measures the number a
 * visitor actually sees. `allTeams`, `minMatchesFiltered`, and
 * `includeOffseason` are UNCHANGED — they still gate `--check` against the
 * committed baseline exactly as before; this is a strict addition, not a
 * replacement.
 *
 * This script reads the corpus READ-ONLY and touches NO credential of any
 * kind: no network request needs auth (Statbotics is unauthenticated), no
 * environment variable is read, and its `package.json` entry deliberately
 * omits `--env-file`. `.env` is never read, printed, copied or interpolated.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import { buildSeasonStream, WalkForwardSimulator, type MultiAlgorithmPredictionRecord } from "../packages/harness/replay.js";
import { seasonBoundaryFor } from "../packages/harness/seasonBoundary.js";
import { epa, type EpaState } from "../packages/core/algorithms/epa.js";
import { OFFSEASON_EVENT_TYPE, isOfficialEventType } from "../packages/core/algorithms/eventTypes.js";
import { fetchStatboticsTeamYears, statboticsReference, type StatboticsTeamYearRow } from "../packages/harness/statbotics.js";
import { isDemoTeamKey, DEMO_PSEUDO_TEAM_KEY } from "../packages/core/algorithms/demoTeams.js";
import { TOTAL_METRIC_KEY, type MatchResult } from "../packages/core/algorithms/types.js";
import { aggregateScores, ELIGIBILITY_NOT_CLAIMED, type HarnessPredictionInput, type ScoreSlice } from "../packages/harness/score.js";
import {
  compareSeason,
  checkAgainstTolerance,
  selectSpotCheckTeams,
  type OurTeamValue,
  type TheirTeamRow,
  type SeasonComparison,
  type ToleranceBand,
} from "../packages/harness/epaStatboticsCompare.js";

export const CORPUS_PATH = join("data", "corpus.sqlite");
export const STATBOTICS_TEAM_YEARS_CACHE_PATH = join("reports", "epa-vs-statbotics", "statbotics-team-years-cache.json");
/** Quick task 260908-n5o: a SEPARATE cache from the team-years cache above — a different Statbotics endpoint (`statboticsReference`'s season-level accuracy/Brier, not the per-team `/v3/team_years` rows), so the two caches never collide on one file. */
export const STATBOTICS_YEAR_REFERENCE_CACHE_PATH = join("reports", "epa-vs-statbotics", "statbotics-year-reference-cache.json");
export const DEFAULT_BASELINE_PATH = join("data", "baselines", "epa-vs-statbotics-2026-09.json");

const DEFAULT_SEASONS_RANGE = "2022-2026";
const DEFAULT_MIN_MATCHES = 12;
const DEFAULT_OUT_DIR = join("reports", "epa-vs-statbotics");
/** Fixed seed for the deterministic 15-team spot-check sample — a re-run must print the identical named rows. */
const SPOT_CHECK_SEED = 20260904;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOptions {
  readonly seasons: readonly number[];
  readonly minMatches: number;
  readonly includeOffseason: boolean;
  readonly outDir: string;
  readonly check: boolean;
}

/**
 * Parses `--seasons` into an ascending, de-duplicated season list.
 *
 * Accepts a comma-separated list of ranges AND bare years, matching the
 * spelling `publish:seasons` already uses (`2016-2020,2022-2026`). A single
 * range (`2022-2026`) is still accepted unchanged, so every existing
 * invocation and the `DEFAULT_SEASONS_RANGE` keep their exact behaviour.
 *
 * Quick task 260911-r7e added the gapped form for one concrete reason: the
 * replay carries EPA state across each season boundary, so measuring 2022
 * from a 2022 start cold-starts every team in the one season whose carry-in
 * Statbotics actually has. Reaching a warm 2022 requires naming 2016-2020 and
 * 2022-2026 while SKIPPING 2021 — `componentMapForSeason` has no 2021 map
 * (the season had no on-field play with a TBA score breakdown), so a
 * contiguous 2016-2026 range throws. This function is what makes the warm
 * measurement expressible at all.
 */
export function parseSeasonRange(raw: string): number[] {
  const parts = raw.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) {
    throw new Error(`epaVsStatbotics: --seasons must name at least one season, got "${raw}"`);
  }

  const seasons = new Set<number>();
  for (const part of parts) {
    const range = /^(\d{4})-(\d{4})$/.exec(part);
    if (range) {
      const start = Number.parseInt(range[1]!, 10);
      const end = Number.parseInt(range[2]!, 10);
      if (start > end) {
        throw new Error(`epaVsStatbotics: --seasons start (${start}) must be <= end (${end})`);
      }
      for (let season = start; season <= end; season++) seasons.add(season);
      continue;
    }

    const single = /^(\d{4})$/.exec(part);
    if (single) {
      seasons.add(Number.parseInt(single[1]!, 10));
      continue;
    }

    throw new Error(
      `epaVsStatbotics: --seasons takes comma-separated years and <start>-<end> ranges (e.g. 2016-2020,2022-2026), got "${part}"`
    );
  }

  // Ascending order is load-bearing, not cosmetic: `replayEpaSeasonFinals`
  // walks this list in order and carries EPA state from one season into the
  // next, so an out-of-order list would carry backwards in time.
  return [...seasons].sort((a, b) => a - b);
}

function parseCliOptions(): CliOptions {
  const { values } = parseArgs({
    options: {
      seasons: { type: "string" },
      "min-matches": { type: "string" },
      "no-offseason": { type: "boolean" },
      out: { type: "string" },
      check: { type: "boolean" },
    },
  });

  return {
    seasons: parseSeasonRange(values.seasons ?? DEFAULT_SEASONS_RANGE),
    minMatches: values["min-matches"] ? Number.parseInt(values["min-matches"], 10) : DEFAULT_MIN_MATCHES,
    includeOffseason: !(values["no-offseason"] ?? false),
    outDir: values.out ?? DEFAULT_OUT_DIR,
    check: values.check ?? false,
  };
}

// ---------------------------------------------------------------------------
// Replay driver
// ---------------------------------------------------------------------------

function uniqueTeamKeysInOrder(matches: readonly MatchResult[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of matches) {
    for (const teamKey of [...match.redTeams, ...match.blueTeams]) {
      if (!seen.has(teamKey)) {
        seen.add(teamKey);
        result.push(teamKey);
      }
    }
  }
  return result;
}

/**
 * One season's replay output this script needs: the season-FINAL `EpaState`
 * (unchanged contract — see `replayEpaSeasonFinals`'s own doc comment on
 * `finalStates` vs `carryStates`) PLUS the `PredictionRecord[]` that same
 * replay already produced and, before quick task 260908-n5o, threw away.
 * Keeping both off ONE pass is the tracer's whole point (Task 1's own
 * `<action>`): no second replay, no second corpus read, to get the
 * win-probability arm this task adds.
 */
export interface SeasonReplayResult {
  readonly finalState: EpaState;
  readonly records: readonly MultiAlgorithmPredictionRecord[];
  /**
   * Revision 260908-n5o: each involved team's `total` value as of its own
   * LAST OFFICIAL match within this season's replay — the exact rule
   * `packages/harness/publish.ts`'s `lastOfficialMetricsByTeam` already
   * establishes for the Teams-list snapshot and the team-page header ("As of
   * last official match"), mirrored here via `onMatchComplete` rather than
   * reinvented. A team's entry is overwritten only on an official-event
   * match, so a team with no official match this season is simply ABSENT
   * from this map — never zero, and never carried forward from offseason
   * play alone.
   */
  readonly officialTotals: ReadonlyMap<string, number>;
}

/**
 * One threaded, chronological replay across `seasons` (cold-starting
 * positionally at index 0, per `seasonBoundaryFor`'s D-1 contract), capturing
 * `epa`'s season-FINAL state AND its per-match prediction records at EVERY
 * season in the range — the replay is already chronological and visits each
 * boundary, so one pass produces every season's comparison rather than only
 * the last.
 *
 * Quick task 260908-615: two as-of instants are now in play here, and this
 * function deliberately uses BOTH.
 *
 *   - The value each entry's `finalState` carries is `finalStates` — that is
 *     the MEASURED quantity this script compares against Statbotics, and the
 *     committed baseline in `data/baselines/epa-vs-statbotics-2026-09.json`
 *     is documented as the offseason-inclusive production arm. Rewinding it
 *     would change what the measurement MEANS, not what the model does.
 *   - The value it THREADS across each boundary is `carryStates`, matching
 *     every other season loop, so the replay this script measures is the
 *     same replay the publisher performs.
 */
function replayEpaSeasonFinals(seasons: readonly number[], includeOffseason: boolean): Map<number, SeasonReplayResult> {
  const resultsBySeason = new Map<number, SeasonReplayResult>();
  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    let carriedStates: ReadonlyMap<string, unknown> | undefined;
    for (const [seasonIdx, season] of seasons.entries()) {
      const stream = buildSeasonStream(db, season, { includeOffseason });
      const teams = uniqueTeamKeysInOrder(stream);

      const boundary = seasonBoundaryFor(seasons, seasonIdx);
      let initialStates: ReadonlyMap<string, unknown> | undefined;
      if (!boundary.isColdStart && carriedStates) {
        const carried = new Map<string, unknown>();
        const prior = carriedStates.get(epa.id);
        if (epa.carrySeason && prior !== undefined) {
          carried.set(epa.id, epa.carrySeason(prior as EpaState, boundary));
        }
        initialStates = carried;
      }

      const officialTotals = new Map<string, number>();
      const onMatchComplete = (match: MatchResult, algorithmId: string, state: unknown): void => {
        if (algorithmId !== epa.id || !isOfficialEventType(match.eventType)) return;
        const involvedTeams = [...match.redTeams, ...match.blueTeams];
        const metrics = epa.teamMetrics(state as EpaState, involvedTeams);
        for (const teamKey of involvedTeams) {
          if (isDemoTeamKey(teamKey) || teamKey === DEMO_PSEUDO_TEAM_KEY) continue;
          const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
          if (total !== undefined) officialTotals.set(teamKey, total);
        }
      };

      const simulator = new WalkForwardSimulator(stream);
      const records = simulator.runAll([epa], teams, initialStates, onMatchComplete);
      carriedStates = records.carryStates;
      const finalState = records.finalStates.get(epa.id) as EpaState;
      // `records` is an array with two extra properties bolted on
      // (`finalStates`/`carryStates`, both already read above) — spreading it
      // here keeps only the plain array this function's own contract needs.
      resultsBySeason.set(season, { finalState, records: [...records], officialTotals });
      console.log(`epaVsStatbotics: season ${season} replayed — ${stream.length} matches`);
    }
  } finally {
    db.close();
  }
  return resultsBySeason;
}

/**
 * Maps one season's replayed EPA records into `HarnessPredictionInput[]`,
 * mirroring `packages/harness/publish.ts`'s own field-for-field mapping at
 * its `harnessPredictions` call site rather than reinventing it. `eventKey`
 * is carried as a REAL field off the match, never derived by splitting
 * `matchKey` — matching `HarnessPredictionInput.eventKey`'s own doc comment's
 * warning against that shortcut.
 *
 * `isOffseason` reads `match.eventType` directly rather than joining against
 * a separately-queried `events.is_offseason` set (`publish.ts`'s own
 * `offseasonEventKeys`): `packages/corpus/schema.sql` documents
 * `is_offseason` itself as `-- derived: event_type == 99 (D-06)`, so the two
 * are the same fact, and this script does not otherwise need a second corpus
 * query just to restate it.
 *
 * Exported and pure — no corpus, no network — so it is unit-testable with a
 * synthetic record (Task 1's own requirement).
 */
export function mapRecordsToHarnessPredictionInput(
  records: readonly MultiAlgorithmPredictionRecord[],
  season: number
): HarnessPredictionInput[] {
  return records.map((r) => ({
    matchKey: r.match.matchKey,
    season,
    eventKey: r.match.eventKey,
    compLevel: r.match.compLevel,
    algorithmId: r.algorithmId,
    pRedWin: r.prediction.pRedWin,
    predictedRedScore: r.prediction.redScore,
    predictedBlueScore: r.prediction.blueScore,
    actualWinner: r.match.winner,
    isOffseason: r.match.eventType === OFFSEASON_EVENT_TYPE,
    isSurrogateAffected: r.match.redSurrogates.length > 0 || r.match.blueSurrogates.length > 0,
    // Quick task 260909-t5q: read off the record's own stamp, same as every
    // other producer — this script's `WalkForwardSimulator` construction is
    // deliberately left on the default (no-op) cold-start index, so this is
    // always `false` today, but the vocabulary stays single-source rather
    // than a second hardcoded literal.
    isColdStart: r.coldStart === true,
  }));
}

/**
 * Selects the `"combined"` `compLevelView` slice for one (algorithmId,
 * season) pair, loudly: a missing combined slice here means `aggregateScores`
 * was handed the wrong season set or algorithm id, and a silent fallback
 * (e.g. an empty-figures default) would hide exactly that bug — Task 1's own
 * requirement that "given none, the failure is loud rather than a silent
 * null."
 */
export function selectCombinedSlice(slices: readonly ScoreSlice[], algorithmId: string, season: number): ScoreSlice {
  const slice = slices.find((s) => s.algorithmId === algorithmId && s.season === season && s.compLevelView === "combined");
  if (!slice) {
    throw new Error(
      `epaVsStatbotics: no "combined" compLevelView slice for algorithm "${algorithmId}" season ${season} — aggregateScores did not produce one`
    );
  }
  return slice;
}

/**
 * The version stamp `main()` writes onto `EpaVsStatboticsReport.epaVersion` —
 * a named export purely so `scripts/epaVsStatbotics.test.ts` can assert it
 * against a live `epa.version` import without running `main()`'s own
 * corpus/network-touching driver. Equality only, never a hand-typed literal
 * and never a pattern match — a future `epa.ts` version bump must flow
 * through here automatically.
 */
export function currentEpaVersion(): string {
  return epa.version;
}

/** Our comparable value per team: `total`, straight from `teamMetrics()` (see file header — EPA's own `total` is now the no-foul figure as of D-01). Demo keys are excluded here too, defensively — `joinTeams` also excludes them, but a caller inspecting `ours` directly should not see them either. */
function ourTeamValuesFromState(state: EpaState): OurTeamValue[] {
  const metrics = epa.teamMetrics(state);
  const values: OurTeamValue[] = [];
  for (const [teamKey, perTeam] of Object.entries(metrics)) {
    if (isDemoTeamKey(teamKey) || teamKey === DEMO_PSEUDO_TEAM_KEY) continue;
    const total = perTeam[TOTAL_METRIC_KEY]?.value ?? 0;
    values.push({ teamKey, value: total });
  }
  return values;
}

function theirTeamRowsFromStatbotics(rows: readonly StatboticsTeamYearRow[]): TheirTeamRow[] {
  return rows.map((row) => ({ teamKey: `frc${row.team}`, value: row.totalPoints, matchCount: row.matchCount }));
}

/**
 * Converts a season's LAST-OFFICIAL-MATCH totals map
 * (`SeasonReplayResult.officialTotals`) into the same `OurTeamValue[]` shape
 * `compareSeason` already accepts for every other arm. Pure and exported so
 * the shape is unit-testable without a replay, the corpus, or the network.
 */
export function officialOnlyTeamValues(officialTotals: ReadonlyMap<string, number>): OurTeamValue[] {
  return [...officialTotals.entries()].map(([teamKey, value]) => ({ teamKey, value }));
}

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

export interface SpotCheckRow {
  readonly teamKey: string;
  readonly theirs: number;
  readonly ours: number;
  readonly difference: number;
}

/**
 * One season's winner-prediction comparison: our own `aggregateScores`
 * `"combined"`-view figures alongside Statbotics' own published season
 * figures (quick task 260908-n5o). `ourWinnerAccuracy`/`ourBrierScore` are
 * nullable, matching `ScoreSlice`'s own contract (a slice with zero scored
 * matches carries `null` for both, honestly, rather than a fabricated
 * number). `statboticsBrierScore` is nullable too, matching
 * `StatboticsReference.mse`'s own optionality (unreachable in practice today
 * — every fallback constant this project carries also carries `mse` — but
 * the type says so rather than assuming it).
 */
export interface WinProbabilityComparison {
  readonly ourWinnerAccuracy: number | null;
  readonly ourBrierScore: number | null;
  readonly scoredCount: number;
  readonly statboticsWinnerAccuracy: number;
  readonly statboticsBrierScore: number | null;
  readonly statboticsCapturedAt: string;
  readonly statboticsFetched: boolean;
}

export interface SeasonReportEntry {
  readonly season: number;
  readonly allTeams: SeasonComparison;
  readonly minMatchesFiltered: SeasonComparison;
  /**
   * Revision 260908-n5o: the same `compareSeason` join and the same
   * min-matches(12) filter as `minMatchesFiltered`, but against each team's
   * `officialOnlyTeamValues` — its rating as of its own last official match,
   * rather than the season-final total. This is the arm the published
   * comparison page reads: it is the number the Teams list and the
   * team-page header actually show a visitor, and `minMatchesFiltered` is
   * not.
   */
  readonly officialOnly: SeasonComparison;
  readonly spotCheck: readonly SpotCheckRow[];
  readonly winProbability: WinProbabilityComparison;
}

export interface EpaVsStatboticsReport {
  readonly measuredAt: string;
  /**
   * The `epa` algorithm module's OWN `version` field (`epa.ts`'s `version:
   * "6.0.0+baseline"` today) — never a hand-typed version string. This is
   * what makes a mixed-model-version publish detectable downstream
   * (`scripts/publishEpaComparison.ts`'s own version-equality gate): two
   * report files carrying different `epaVersion` values were measured under
   * two different models and must never compose into one artifact.
   */
  readonly epaVersion: string;
  readonly seasons: readonly number[];
  readonly includeOffseason: boolean;
  readonly minMatches: number;
  readonly seasonEntries: readonly SeasonReportEntry[];
}

function printSeasonRow(entry: SeasonReportEntry): void {
  const a = entry.allTeams;
  const f = entry.minMatchesFiltered;
  const o = entry.officialOnly;
  console.log(
    `season ${entry.season}: all-teams joined=${a.joinedCount} (our=${a.ourCount} their=${a.theirCount}) slope=${a.ordinaryLeastSquaresSlope.toFixed(3)} pearson=${a.pearson.toFixed(3)} mad=${a.meanAbsoluteDifference.toFixed(2)} ourSD=${a.ourStandardDeviation?.toFixed(2)} theirSD=${a.theirStandardDeviation?.toFixed(2)} | min-matches(${entry.minMatchesFiltered.minMatches}) joined=${f.joinedCount} slope=${f.ordinaryLeastSquaresSlope.toFixed(3)} pearson=${f.pearson.toFixed(3)} mad=${f.meanAbsoluteDifference.toFixed(2)} | official-only(${o.minMatches}) joined=${o.joinedCount} slope=${o.ordinaryLeastSquaresSlope.toFixed(3)} pearson=${o.pearson.toFixed(3)} mad=${o.meanAbsoluteDifference.toFixed(2)}`
  );
}

/** Flattens the statistics `checkAgainstTolerance` gates on for one season's min-matches-filtered arm — the baseline is built from this arm (see `docs/models/epa-vs-statbotics.md`: low-match teams are noisy on both sides). */
function toFlatStatistics(comparison: SeasonComparison): Record<string, number> {
  if (comparison.ourStandardDeviation === undefined || comparison.theirStandardDeviation === undefined) {
    throw new Error(
      `epaVsStatbotics: season ${comparison.season}'s min-matches arm joined fewer than 2 teams — cannot compute a standard deviation to check`
    );
  }
  return {
    ordinaryLeastSquaresSlope: comparison.ordinaryLeastSquaresSlope,
    pearson: comparison.pearson,
    meanAbsoluteDifference: comparison.meanAbsoluteDifference,
    ourStandardDeviation: comparison.ourStandardDeviation,
    theirStandardDeviation: comparison.theirStandardDeviation,
  };
}

interface EpaStatboticsBaseline {
  readonly createdAt: string;
  readonly rationale: string;
  readonly seasons: Readonly<Record<string, Readonly<Record<string, ToleranceBand>>>>;
}

function runCheck(seasonEntries: readonly SeasonReportEntry[]): boolean {
  if (!existsSync(DEFAULT_BASELINE_PATH)) {
    throw new Error(`epaVsStatbotics --check: baseline not found at ${DEFAULT_BASELINE_PATH} — run without --check first to establish one`);
  }
  const baseline = JSON.parse(readFileSync(DEFAULT_BASELINE_PATH, "utf8")) as EpaStatboticsBaseline;

  let passed = true;
  for (const entry of seasonEntries) {
    const bands = baseline.seasons[String(entry.season)];
    if (!bands) {
      console.error(`epaVsStatbotics --check: FAILED — no baseline band recorded for season ${entry.season}`);
      passed = false;
      continue;
    }
    const measured = toFlatStatistics(entry.minMatchesFiltered);
    const violations = checkAgainstTolerance(measured, bands);
    for (const violation of violations) {
      passed = false;
      console.error(
        `epaVsStatbotics --check: FAILED — season ${entry.season} ${violation.statistic}=${violation.value} outside [${violation.band.min}, ${violation.band.max}]`
      );
    }
  }
  return passed;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseCliOptions();

  const replayResultsBySeason = replayEpaSeasonFinals(options.seasons, options.includeOffseason);

  // One `aggregateScores` call over EVERY requested season's records at
  // once — `corpusSeasons` is the run's own full requested season list (per
  // that option's own contract: a caller must declare its full season set,
  // never narrow it silently), and `selectedOnSeasons` is the
  // `ELIGIBILITY_NOT_CLAIMED` sentinel because this measurement makes no
  // headline-eligibility claim of its own (Task 1's own instruction: the
  // sentinel is the strictest available answer, not a convenience default).
  const allPredictions: HarnessPredictionInput[] = options.seasons.flatMap((season) => {
    const replayed = replayResultsBySeason.get(season);
    if (!replayed) throw new Error(`epaVsStatbotics: no replayed records for season ${season}`);
    return mapRecordsToHarnessPredictionInput(replayed.records, season);
  });
  const slices = aggregateScores(allPredictions, {
    corpusSeasons: options.seasons,
    selectedOnSeasons: ELIGIBILITY_NOT_CLAIMED,
  });

  const statboticsBySeason = new Map<number, StatboticsTeamYearRow[]>();
  for (const season of options.seasons) {
    statboticsBySeason.set(season, await fetchStatboticsTeamYears(season, { cachePath: STATBOTICS_TEAM_YEARS_CACHE_PATH }));
  }

  const seasonEntries: SeasonReportEntry[] = [];
  for (const season of options.seasons) {
    const replayed = replayResultsBySeason.get(season);
    if (!replayed) throw new Error(`epaVsStatbotics: no replayed state for season ${season}`);
    const ours = ourTeamValuesFromState(replayed.finalState);
    const theirs = theirTeamRowsFromStatbotics(statboticsBySeason.get(season) ?? []);

    const allTeams = compareSeason(season, ours, theirs);
    const minMatchesFiltered = compareSeason(season, ours, theirs, { minMatches: options.minMatches });
    const officialOnlyOurs = officialOnlyTeamValues(replayed.officialTotals);
    const officialOnly = compareSeason(season, officialOnlyOurs, theirs, { minMatches: options.minMatches });
    const spotCheck: SpotCheckRow[] = selectSpotCheckTeams(allTeams.pairs, { seed: SPOT_CHECK_SEED }).map((pair) => ({
      teamKey: pair.teamKey,
      theirs: pair.theirs,
      ours: pair.ours,
      difference: pair.ours - pair.theirs,
    }));

    const combinedSlice = selectCombinedSlice(slices, epa.id, season);
    const statboticsRef = await statboticsReference(season, { cachePath: STATBOTICS_YEAR_REFERENCE_CACHE_PATH });
    const winProbability: WinProbabilityComparison = {
      ourWinnerAccuracy: combinedSlice.winnerAccuracy,
      ourBrierScore: combinedSlice.brierScore,
      scoredCount: combinedSlice.scoredCount,
      statboticsWinnerAccuracy: statboticsRef.value,
      statboticsBrierScore: statboticsRef.mse ?? null,
      statboticsCapturedAt: statboticsRef.capturedAt,
      statboticsFetched: statboticsRef.fetched,
    };

    const entry: SeasonReportEntry = { season, allTeams, minMatchesFiltered, officialOnly, spotCheck, winProbability };
    printSeasonRow(entry);
    seasonEntries.push(entry);
  }

  const report: EpaVsStatboticsReport = {
    measuredAt: new Date().toISOString(),
    epaVersion: currentEpaVersion(),
    seasons: options.seasons,
    includeOffseason: options.includeOffseason,
    minMatches: options.minMatches,
    seasonEntries,
  };

  mkdirSync(options.outDir, { recursive: true });
  const outPath = join(options.outDir, "epa-vs-statbotics.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`epaVsStatbotics: wrote ${outPath}`);

  if (options.check) {
    const passed = runCheck(seasonEntries);
    if (!passed) {
      console.error("epaVsStatbotics --check: FAILED — one or more statistics fell outside the committed baseline band (see above)");
      process.exitCode = 1;
      return;
    }
    console.log("epaVsStatbotics --check: PASSED — every measured statistic is within its committed baseline band");
  }
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("epaVsStatbotics failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
