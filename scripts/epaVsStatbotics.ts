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
 * Our comparable value, per team, is `total` MINUS `foulsCommitted`:
 * Statbotics' `epa.total_points` is a NO-FOUL figure (verified live
 * 2026-09-04: `frc254`/2024 total_points 51.71 == auto 15.94 + teleop
 * 29.48 + endgame 6.28), while our own `total` includes `foulsCommitted`
 * (D-04's cross-attributed component). Comparing our raw `total` would
 * compare two different quantities and quietly inflate every residual.
 * Demo team keys (raw `frc9970`-`frc9999` and the shared pseudo key) never
 * enter the join, on either side (`epaStatboticsCompare.ts`'s `joinTeams`).
 *
 * Usage:
 *   npx tsx scripts/epaVsStatbotics.ts                                    # full range, offseason-inclusive, writes reports/epa-vs-statbotics/
 *   npx tsx scripts/epaVsStatbotics.ts --seasons 2022-2025 --no-offseason --out reports/epa-vs-statbotics-nooff
 *   npx tsx scripts/epaVsStatbotics.ts --check                            # re-measures the default range and checks it against the committed baseline
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
import { buildSeasonStream, WalkForwardSimulator } from "../packages/harness/replay.js";
import { seasonBoundaryFor } from "../packages/harness/seasonBoundary.js";
import { epa, type EpaState } from "../packages/core/algorithms/epa.js";
import { fetchStatboticsTeamYears, type StatboticsTeamYearRow } from "../packages/harness/statbotics.js";
import { isDemoTeamKey, DEMO_PSEUDO_TEAM_KEY } from "../packages/core/algorithms/demoTeams.js";
import { TOTAL_METRIC_KEY, type MatchResult } from "../packages/core/algorithms/types.js";
import { FOULS_COMMITTED_COMPONENT } from "../packages/core/algorithms/breakdown/constants.js";
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

export function parseSeasonRange(raw: string): number[] {
  const match = /^(\d{4})-(\d{4})$/.exec(raw);
  if (!match) {
    throw new Error(`epaVsStatbotics: --seasons must be of the form <start>-<end> (e.g. 2022-2026), got "${raw}"`);
  }
  const start = Number.parseInt(match[1]!, 10);
  const end = Number.parseInt(match[2]!, 10);
  if (start > end) {
    throw new Error(`epaVsStatbotics: --seasons start (${start}) must be <= end (${end})`);
  }
  const seasons: number[] = [];
  for (let season = start; season <= end; season++) seasons.push(season);
  return seasons;
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
 * One threaded, chronological replay across `seasons` (cold-starting
 * positionally at index 0, per `seasonBoundaryFor`'s D-1 contract), capturing
 * `epa`'s season-FINAL state at EVERY season in the range — the replay is
 * already chronological and visits each boundary, so one pass produces every
 * season's comparison rather than only the last.
 */
function replayEpaSeasonFinals(seasons: readonly number[], includeOffseason: boolean): Map<number, EpaState> {
  const finalStatesBySeason = new Map<number, EpaState>();
  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    let carriedFinalStates: ReadonlyMap<string, unknown> | undefined;
    for (const [seasonIdx, season] of seasons.entries()) {
      const stream = buildSeasonStream(db, season, { includeOffseason });
      const teams = uniqueTeamKeysInOrder(stream);

      const boundary = seasonBoundaryFor(seasons, seasonIdx);
      let initialStates: ReadonlyMap<string, unknown> | undefined;
      if (!boundary.isColdStart && carriedFinalStates) {
        const carried = new Map<string, unknown>();
        const prior = carriedFinalStates.get(epa.id);
        if (epa.carrySeason && prior !== undefined) {
          carried.set(epa.id, epa.carrySeason(prior as EpaState, boundary));
        }
        initialStates = carried;
      }

      const simulator = new WalkForwardSimulator(stream);
      const records = simulator.runAll([epa], teams, initialStates);
      carriedFinalStates = records.finalStates;
      finalStatesBySeason.set(season, records.finalStates.get(epa.id) as EpaState);
      console.log(`epaVsStatbotics: season ${season} replayed — ${stream.length} matches`);
    }
  } finally {
    db.close();
  }
  return finalStatesBySeason;
}

/** Our comparable value per team: `total` MINUS `foulsCommitted` (see file header). Demo keys are excluded here too, defensively — `joinTeams` also excludes them, but a caller inspecting `ours` directly should not see them either. */
function ourTeamValuesFromState(state: EpaState): OurTeamValue[] {
  const metrics = epa.teamMetrics(state);
  const values: OurTeamValue[] = [];
  for (const [teamKey, perTeam] of Object.entries(metrics)) {
    if (isDemoTeamKey(teamKey) || teamKey === DEMO_PSEUDO_TEAM_KEY) continue;
    const total = perTeam[TOTAL_METRIC_KEY]?.value ?? 0;
    const foulsCommitted = perTeam[FOULS_COMMITTED_COMPONENT]?.value ?? 0;
    values.push({ teamKey, value: total - foulsCommitted });
  }
  return values;
}

function theirTeamRowsFromStatbotics(rows: readonly StatboticsTeamYearRow[]): TheirTeamRow[] {
  return rows.map((row) => ({ teamKey: `frc${row.team}`, value: row.totalPoints, matchCount: row.matchCount }));
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

export interface SeasonReportEntry {
  readonly season: number;
  readonly allTeams: SeasonComparison;
  readonly minMatchesFiltered: SeasonComparison;
  readonly spotCheck: readonly SpotCheckRow[];
}

export interface EpaVsStatboticsReport {
  readonly measuredAt: string;
  readonly seasons: readonly number[];
  readonly includeOffseason: boolean;
  readonly minMatches: number;
  readonly seasonEntries: readonly SeasonReportEntry[];
}

function printSeasonRow(entry: SeasonReportEntry): void {
  const a = entry.allTeams;
  const f = entry.minMatchesFiltered;
  console.log(
    `season ${entry.season}: all-teams joined=${a.joinedCount} (our=${a.ourCount} their=${a.theirCount}) slope=${a.ordinaryLeastSquaresSlope.toFixed(3)} pearson=${a.pearson.toFixed(3)} mad=${a.meanAbsoluteDifference.toFixed(2)} ourSD=${a.ourStandardDeviation?.toFixed(2)} theirSD=${a.theirStandardDeviation?.toFixed(2)} | min-matches(${entry.minMatchesFiltered.minMatches}) joined=${f.joinedCount} slope=${f.ordinaryLeastSquaresSlope.toFixed(3)} pearson=${f.pearson.toFixed(3)} mad=${f.meanAbsoluteDifference.toFixed(2)}`
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

  const finalStatesBySeason = replayEpaSeasonFinals(options.seasons, options.includeOffseason);

  const statboticsBySeason = new Map<number, StatboticsTeamYearRow[]>();
  for (const season of options.seasons) {
    statboticsBySeason.set(season, await fetchStatboticsTeamYears(season, { cachePath: STATBOTICS_TEAM_YEARS_CACHE_PATH }));
  }

  const seasonEntries: SeasonReportEntry[] = options.seasons.map((season) => {
    const finalState = finalStatesBySeason.get(season);
    if (!finalState) throw new Error(`epaVsStatbotics: no replayed state for season ${season}`);
    const ours = ourTeamValuesFromState(finalState);
    const theirs = theirTeamRowsFromStatbotics(statboticsBySeason.get(season) ?? []);

    const allTeams = compareSeason(season, ours, theirs);
    const minMatchesFiltered = compareSeason(season, ours, theirs, { minMatches: options.minMatches });
    const spotCheck: SpotCheckRow[] = selectSpotCheckTeams(allTeams.pairs, { seed: SPOT_CHECK_SEED }).map((pair) => ({
      teamKey: pair.teamKey,
      theirs: pair.theirs,
      ours: pair.ours,
      difference: pair.ours - pair.theirs,
    }));

    const entry: SeasonReportEntry = { season, allTeams, minMatchesFiltered, spotCheck };
    printSeasonRow(entry);
    return entry;
  });

  const report: EpaVsStatboticsReport = {
    measuredAt: new Date().toISOString(),
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
