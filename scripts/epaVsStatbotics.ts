/**
 * SC-2 ("EPA runs walk-forward at any point in a season, and spot-checked
 * teams land within a documented tolerance of published Statbotics
 * numbers") — quick task 260904-4aa. Recorded blocked-on-external-dependency
 * since 2026-08-13 (`api.statbotics.io` reproducibly 500'd); re-verified
 * live 2026-09-04 that `/v3/team_years` is back up. This script replaces an
 * ad-hoc, un-re-runnable measurement (see `packages/core/algorithms/epa.ts`'s
 * file header) with a committed, re-runnable comparison.
 *
 * Task 1 (this commit): wires ONE path end to end, for season 2025 only —
 * fetch Statbotics' 2025 team-years, replay `epa` across 2022-2025
 * offseason-inclusive (mirroring `scripts/measureRewindGap.ts`'s season-loop
 * shape: `openCorpusReadOnly`, `buildSeasonStream`, `seasonBoundaryFor`,
 * `carrySeason` threading, cold-starting positionally at index 0), take the
 * 2025 season-final `epa.teamMetrics()`, join on `frc{team}` excluding demo
 * keys, and print one line: joined/our/their counts and the Pearson
 * correlation between our comparable value (`total` minus `foulsCommitted`,
 * since Statbotics' `epa.total_points` is a no-foul figure) and Statbotics'
 * `total_points`.
 *
 * Multi-season expansion, tested statistics, tolerance gating, and CLI
 * flags land in Task 2 (`packages/harness/epaStatboticsCompare.ts`).
 *
 * This script reads the corpus READ-ONLY and touches NO credential of any
 * kind: no network request needs auth (Statbotics is unauthenticated), no
 * environment variable is read, and its `package.json` entry deliberately
 * omits `--env-file`. `.env` is never read, printed, copied or interpolated.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import { buildSeasonStream, WalkForwardSimulator } from "../packages/harness/replay.js";
import { seasonBoundaryFor } from "../packages/harness/seasonBoundary.js";
import { epa, type EpaState } from "../packages/core/algorithms/epa.js";
import { fetchStatboticsTeamYears } from "../packages/harness/statbotics.js";
import { isDemoTeamKey, DEMO_PSEUDO_TEAM_KEY } from "../packages/core/algorithms/demoTeams.js";
import { TOTAL_METRIC_KEY, type MatchResult } from "../packages/core/algorithms/types.js";
import { FOULS_COMMITTED_COMPONENT } from "../packages/core/algorithms/breakdown/constants.js";

export const CORPUS_PATH = join("data", "corpus.sqlite");
export const STATBOTICS_TEAM_YEARS_CACHE_PATH = join("reports", "epa-vs-statbotics", "statbotics-team-years-cache.json");

/** Task 1 tracer: hardcoded to season 2025 only. Task 2 widens this via `--seasons`. */
const TRACER_SEASON = 2025;
const TRACER_REPLAY_SEASONS = [2022, 2023, 2024, 2025];

/** Pearson correlation coefficient. Task 2 extracts and tests this properly in `epaStatboticsCompare.ts`; here it exists only to prove the one path end to end. */
function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  const meanX = xs.reduce((sum, v) => sum + v, 0) / n;
  const meanY = ys.reduce((sum, v) => sum + v, 0) / n;
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  return numerator / Math.sqrt(denomX * denomY);
}

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

async function main(): Promise<void> {
  const statboticsRows = await fetchStatboticsTeamYears(TRACER_SEASON, { cachePath: STATBOTICS_TEAM_YEARS_CACHE_PATH });

  const db = openCorpusReadOnly(CORPUS_PATH);
  let carriedFinalStates: ReadonlyMap<string, unknown> | undefined;
  let seasonFinalState: unknown;
  try {
    for (const [seasonIdx, season] of TRACER_REPLAY_SEASONS.entries()) {
      const stream = buildSeasonStream(db, season, { includeOffseason: true });
      const teams = uniqueTeamKeysInOrder(stream);

      const boundary = seasonBoundaryFor(TRACER_REPLAY_SEASONS, seasonIdx);
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
      seasonFinalState = records.finalStates.get(epa.id);
      console.log(`epaVsStatbotics: season ${season} replayed — ${stream.length} matches`);
    }
  } finally {
    db.close();
  }

  const metrics = epa.teamMetrics(seasonFinalState as EpaState);

  // Our comparable value: `total` MINUS `foulsCommitted` — Statbotics'
  // `epa.total_points` is a no-foul figure, so comparing our raw `total`
  // would compare two different quantities and quietly inflate every
  // residual. Demo keys (raw `frc9970`-`frc9999` AND the shared pseudo key)
  // never enter the join, on either side.
  const ourComparableByTeamKey = new Map<string, number>();
  for (const [teamKey, perTeam] of Object.entries(metrics)) {
    if (isDemoTeamKey(teamKey) || teamKey === DEMO_PSEUDO_TEAM_KEY) continue;
    const total = perTeam[TOTAL_METRIC_KEY]?.value ?? 0;
    const foulsCommitted = perTeam[FOULS_COMMITTED_COMPONENT]?.value ?? 0;
    ourComparableByTeamKey.set(teamKey, total - foulsCommitted);
  }

  const ourValues: number[] = [];
  const theirValues: number[] = [];
  for (const row of statboticsRows) {
    const teamKey = `frc${row.team}`;
    const ourValue = ourComparableByTeamKey.get(teamKey);
    if (ourValue === undefined) continue;
    ourValues.push(ourValue);
    theirValues.push(row.totalPoints);
  }

  const correlation = pearson(ourValues, theirValues);
  console.log(
    `epaVsStatbotics (tracer, season ${TRACER_SEASON}): joined=${ourValues.length} ourCount=${ourComparableByTeamKey.size} theirCount=${statboticsRows.length} pearson=${correlation.toFixed(4)}`
  );
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("epaVsStatbotics failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
