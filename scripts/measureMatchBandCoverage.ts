/**
 * Measures the PUBLISHED Match Band's coverage of actual alliance scores.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SCRIPT EXISTS
 * ---------------------------------------------------------------------------
 *
 * Quick task 260913-g66 found SPR's band holding 47.1% of actual alliance
 * scores against the 68.3% a "one standard deviation" label promises. The
 * cause: Sigma Score is the 1 standard deviation of a robot's EVEN-SPLIT SHARE
 * of its alliance's miss, so summing three shares' variances gives
 * Var(alliance) / rosterSize, and a band built from that sum is
 * sqrt(rosterSize) too narrow. `sigmaMatchBandVariance` multiplies the roster
 * size back in, for the display band only.
 *
 * That measurement was a scratch run. The corrected band is a PUBLISHED
 * number, and a published number with no committed harness is the failure this
 * project's log names as its original sin. This script is that harness, and the
 * Sigma methodology page quotes its output and nothing else.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT MEASURES, AND WHY IT IS WALK-FORWARD BY CONSTRUCTION
 * ---------------------------------------------------------------------------
 *
 * Every season is replayed through the SAME `WalkForwardSimulator` and the SAME
 * `SigmaScoutLayer` the publisher runs, one layer per (algorithm, season), with
 * Sigma talent captured after each match exactly as `publishSeasons` captures
 * it. The band is read from the record `foldPlayed` returns, which computes it
 * BEFORE folding that match: predict before update, no match informs its own
 * band. State carries across seasons through `carrySeason` and
 * `seasonBoundaryFor`, as the publisher carries it, so the first reported
 * season is not scored on a cold model. Warmup seasons are replayed and not
 * counted.
 *
 * For each counted alliance row:
 *
 *     miss          = actual alliance score - predicted alliance score
 *     inside k bands = |miss| <= k * sqrt(matchBand variance)
 *
 * Rows are gated by the identical rules `SigmaScoreAccumulator.foldMatch`
 * gates its fold with (a fully demo alliance skips the whole match; a fully
 * DQ'd zero-score alliance skips that side), so the scored population is the
 * learned population.
 *
 * The PRE-CORRECTION REFERENCE is the same row scored against band variance /
 * rosterSize, which is the band as it was published before 260913-g66. It is
 * printed to show the correction is doing what it claims, never as a candidate.
 *
 * n IS ALLIANCE ROWS: one match contributes up to two, and red and blue misses
 * in one match are correlated (+0.21 for SPR), so the rows are not independent.
 *
 * Usage:
 *   npx tsx scripts/measureMatchBandCoverage.ts [--seasons 2024-2026] [--warmup-from 2023] [--algorithms spr] [--exclude-offseason]
 *   pnpm measure:match-band
 */

import { pathToFileURL } from "node:url";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import { buildSeasonStream, WalkForwardSimulator } from "../packages/harness/replay.js";
import type { MultiAlgorithmPredictionRecord } from "../packages/harness/replay.js";
import { corpusColdStartIndex } from "../packages/harness/corpusColdStart.js";
import { resolvePublishAlgorithms } from "../packages/harness/publish.js";
import { seasonBoundaryFor } from "../packages/harness/seasonBoundary.js";
import { SigmaScoutLayer } from "../packages/harness/sigmaScoutLayer.js";
import { usesSigmaScore } from "../packages/harness/sigmaScore.js";
import { RP_RULE_MODULES } from "../packages/core/rankingPoints/rules.js";
import { TOTAL_METRIC_KEY } from "../packages/core/algorithms/types.js";
import type { AlgorithmModule, MatchResult } from "../packages/core/algorithms/types.js";
import { isFullyDemoAlliance } from "../packages/core/algorithms/demoTeams.js";
import { isFullyDqZeroScoreAlliance } from "../packages/core/algorithms/dq.js";
import { parseSeasons } from "./scriptHelpers.js";

const CORPUS_PATH = "data/corpus.sqlite";

/** The coverage a "one standard deviation" label implies. */
const GAUSSIAN_1SIGMA_COVERAGE = 0.683;
/** The coverage a "two standard deviations" label implies. */
const GAUSSIAN_2SIGMA_COVERAGE = 0.954;

// ───────────────────────────── pure helpers ─────────────────────────────
// Everything in this section is pure and unit-tested in measureMatchBandCoverage.test.ts.

/** The coldest-robot buckets, in print order. */
export const COLDEST_BUCKETS = ["under 3", "3 to 11", "12 plus"] as const;
export type ColdestBucket = (typeof COLDEST_BUCKETS)[number];

/**
 * Whether an alliance's miss lands inside `k` bands. Inclusive at the edge. A
 * negative or non-finite variance is a defect in the caller, so it reads as
 * outside rather than being coerced into a band.
 */
export function insideBands(miss: number, bandVariance: number, k: number): boolean {
  if (!Number.isFinite(miss) || !Number.isFinite(bandVariance) || bandVariance < 0) return false;
  return Math.abs(miss) <= k * Math.sqrt(bandVariance);
}

/**
 * Buckets the coldest roster member by how many counted matches it had played
 * this season BEFORE this one: 0 to 2 is "under 3", 3 to 11 is "3 to 11", 12 or
 * more is "12 plus".
 */
export function coldestBucket(priorMatches: number): ColdestBucket {
  if (priorMatches < 3) return "under 3";
  if (priorMatches < 12) return "3 to 11";
  return "12 plus";
}

/** One counted alliance row. */
export interface CoverageRow {
  readonly season: number;
  readonly quals: boolean;
  /** The coldest roster member's counted matches this season, before this row. */
  readonly coldestPrior: number;
  readonly inside1: boolean;
  readonly inside2: boolean;
  /** PRE-CORRECTION REFERENCE: inside 1 band of band variance / rosterSize. */
  readonly preCorrectionInside1: boolean;
}

export interface CoverageSummary {
  readonly n: number;
  readonly inside1: number;
  readonly inside2: number;
  readonly preCorrectionInside1: number;
}

/** Shares are `NaN` for an empty row list: honest absence, never 0%. */
export function summarizeCoverage(rows: readonly CoverageRow[]): CoverageSummary {
  const n = rows.length;
  if (n === 0) return { n: 0, inside1: Number.NaN, inside2: Number.NaN, preCorrectionInside1: Number.NaN };
  let inside1 = 0;
  let inside2 = 0;
  let pre = 0;
  for (const row of rows) {
    if (row.inside1) inside1++;
    if (row.inside2) inside2++;
    if (row.preCorrectionInside1) pre++;
  }
  return { n, inside1: inside1 / n, inside2: inside2 / n, preCorrectionInside1: pre / n };
}

/**
 * The seasons to replay, in order: from the warmup season (or the first
 * reported season, if that is earlier) through the last reported season.
 * Seasons with no matches are dropped later, at stream-build time, so a gapped
 * corpus (no 2021) still carries across the gap.
 */
export function replaySeasons(reported: readonly number[], warmupFrom: number | undefined): number[] {
  if (reported.length === 0) return [];
  const sorted = [...reported].sort((a, b) => a - b);
  const first = warmupFrom === undefined ? sorted[0]! : Math.min(warmupFrom, sorted[0]!);
  const last = sorted[sorted.length - 1]!;
  const out: number[] = [];
  for (let s = first; s <= last; s++) out.push(s);
  return out;
}

export function formatShare(share: number): string {
  return Number.isFinite(share) ? `${(share * 100).toFixed(1)}%` : "n/a";
}

// ───────────────────────────── CLI plumbing ─────────────────────────────

function flagValue(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

// ───────────────────────────── the measurement ─────────────────────────────

interface SeasonResult {
  readonly rows: CoverageRow[];
  readonly matches: number;
  readonly skippedRows: number;
  readonly noBandRows: number;
}

/**
 * Scores one season's played records. `layer` is fresh for this season, as it
 * is in `publishSeasons`. The coldest-robot counter is incremented AFTER a row
 * is read, so a row's bucket reflects only matches before it.
 */
function scoreSeason(
  season: number,
  records: readonly MultiAlgorithmPredictionRecord[],
  layer: SigmaScoutLayer,
  talentAfterMatch: ReadonlyMap<string, ReadonlyMap<string, number>>,
  count: boolean
): SeasonResult {
  const rows: CoverageRow[] = [];
  const priorByTeam = new Map<string, number>();
  let skippedRows = 0;
  let noBandRows = 0;

  for (const record of records) {
    const match = record.match;
    const folded = layer.foldPlayed(match, record.prediction, talentAfterMatch.get(match.matchKey));
    if (!count) continue;

    const demoMatch = isFullyDemoAlliance(match.redTeams) || isFullyDemoAlliance(match.blueTeams);
    const sides = [
      { teams: match.redTeams, actual: match.redScore, dqs: match.redDqs, predicted: record.prediction.redScore, band: folded.matchBand?.red },
      { teams: match.blueTeams, actual: match.blueScore, dqs: match.blueDqs, predicted: record.prediction.blueScore, band: folded.matchBand?.blue },
    ];

    for (const side of sides) {
      if (
        demoMatch ||
        side.teams.length === 0 ||
        isFullyDqZeroScoreAlliance(side.teams, side.dqs, side.actual) ||
        !Number.isFinite(side.actual) ||
        !Number.isFinite(side.predicted)
      ) {
        skippedRows++;
        continue;
      }

      const coldestPrior = Math.min(...side.teams.map((t) => priorByTeam.get(t) ?? 0));
      if (side.band === undefined) {
        noBandRows++;
      } else {
        const miss = side.actual - side.predicted;
        rows.push({
          season,
          quals: match.compLevel === "qm",
          coldestPrior,
          inside1: insideBands(miss, side.band, 1),
          inside2: insideBands(miss, side.band, 2),
          preCorrectionInside1: insideBands(miss, side.band / side.teams.length, 1),
        });
      }
      for (const t of side.teams) priorByTeam.set(t, (priorByTeam.get(t) ?? 0) + 1);
    }
  }

  return { rows, matches: records.length, skippedRows, noBandRows };
}

function printSummaryLine(label: string, rows: readonly CoverageRow[]): void {
  const s = summarizeCoverage(rows);
  console.log(
    `   ${label.padEnd(22)} n=${String(s.n).padStart(6)}   inside 1 band ${formatShare(s.inside1).padStart(6)}   inside 2 bands ${formatShare(s.inside2).padStart(6)}`
  );
}

function reportBlock(label: string, rows: readonly CoverageRow[], matches: number, skippedRows: number, noBandRows: number): void {
  const s = summarizeCoverage(rows);
  console.log(`── ${label} ── ${s.n} alliance rows from ${matches} matches (${skippedRows} rows skipped by fold rules, ${noBandRows} rows with no band)`);
  console.log(
    `   ALL                    n=${String(s.n).padStart(6)}   inside 1 band ${formatShare(s.inside1).padStart(6)}   inside 2 bands ${formatShare(s.inside2).padStart(6)}   ` +
      `(targets ${(GAUSSIAN_1SIGMA_COVERAGE * 100).toFixed(1)}% / ${(GAUSSIAN_2SIGMA_COVERAGE * 100).toFixed(1)}%)`
  );
  printSummaryLine("quals", rows.filter((r) => r.quals));
  printSummaryLine("elims", rows.filter((r) => !r.quals));
  for (const bucket of COLDEST_BUCKETS) {
    printSummaryLine(`coldest robot ${bucket}`, rows.filter((r) => coldestBucket(r.coldestPrior) === bucket));
  }
  console.log(
    `   PRE-CORRECTION REFERENCE (band variance / roster size, the band before 260913-g66): inside 1 band ${formatShare(s.preCorrectionInside1)}`
  );
  console.log("");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const reported = parseSeasons(flagValue(args, "--seasons") ?? "2024-2026");
  const warmupSpec = flagValue(args, "--warmup-from") ?? "2023";
  const warmupFrom = Number.parseInt(warmupSpec, 10);
  const includeOffseason = !args.includes("--exclude-offseason");
  const algorithms = resolvePublishAlgorithms(flagValue(args, "--algorithms") ?? "spr");
  const seasons = replaySeasons(reported, Number.isFinite(warmupFrom) ? warmupFrom : undefined);
  const reportedSet = new Set(reported);

  console.log(`MATCH BAND COVERAGE — the published display band against actual alliance scores.`);
  console.log(`algorithms: ${algorithms.map((a) => `${a.id}@${a.version}`).join(", ")}`);
  console.log(`seasons:    ${reported.join(", ")} counted; ${seasons.filter((s) => !reportedSet.has(s)).join(", ") || "none"} warmup (replayed, not counted)`);
  console.log(`offseason:  ${includeOffseason ? "INCLUDED (as publish:seasons runs)" : "excluded"}`);
  console.log(``);
  console.log(`Walk-forward: every band is read from SigmaScoutLayer.foldPlayed BEFORE its match is folded.`);
  console.log(`n is alliance rows; red and blue in one match are correlated, so rows are not independent.`);
  console.log(``);

  const bandAlgorithms: AlgorithmModule<any>[] = [];
  for (const algorithm of algorithms) {
    if (usesSigmaScore(algorithm.id)) bandAlgorithms.push(algorithm);
    else console.log(`═══ ${algorithm.id}@${algorithm.version} ═══ publishes no display band; skipped.\n`);
  }
  if (bandAlgorithms.length === 0) return;

  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    const coldStartIndex = corpusColdStartIndex(db);
    const pooledByAlgo = new Map<string, { rows: CoverageRow[]; matches: number; skipped: number; noBand: number }>();
    for (const algorithm of bandAlgorithms) pooledByAlgo.set(algorithm.id, { rows: [], matches: 0, skipped: 0, noBand: 0 });

    const replayed: number[] = [];
    let carryStates: ReadonlyMap<string, unknown> | undefined;

    for (const season of seasons) {
      const stream = buildSeasonStream(db, season, { includeOffseason });
      if (stream.length === 0) {
        console.log(`── ${season} ── no matches in corpus; carrying across it\n`);
        continue;
      }
      replayed.push(season);
      const boundary = seasonBoundaryFor(replayed, replayed.length - 1);
      let initialStates: ReadonlyMap<string, unknown> | undefined;
      if (!boundary.isColdStart && carryStates !== undefined) {
        const carried = new Map<string, unknown>();
        for (const algorithm of bandAlgorithms) {
          const prior = carryStates.get(algorithm.id);
          if (algorithm.carrySeason && prior !== undefined) carried.set(algorithm.id, algorithm.carrySeason(prior, boundary));
        }
        initialStates = carried;
      }

      const byId = new Map(bandAlgorithms.map((a) => [a.id, a]));
      const talentAfterMatch = new Map<string, Map<string, Map<string, number>>>();
      for (const algorithm of bandAlgorithms) talentAfterMatch.set(algorithm.id, new Map());
      const onMatchComplete = (match: MatchResult, algorithmId: string, state: unknown): void => {
        const algorithm = byId.get(algorithmId);
        if (!algorithm || !usesSigmaScore(algorithmId)) return;
        const involvedTeams = [...match.redTeams, ...match.blueTeams];
        const metrics = algorithm.teamMetrics(state, involvedTeams);
        const talent = new Map<string, number>();
        for (const teamKey of involvedTeams) {
          const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
          if (total !== undefined) talent.set(teamKey, total);
        }
        talentAfterMatch.get(algorithmId)!.set(match.matchKey, talent);
      };

      const teams = [...new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
      const records = new WalkForwardSimulator(stream, coldStartIndex).runAll(bandAlgorithms, teams, initialStates, onMatchComplete);
      carryStates = records.carryStates;
      const counted = reportedSet.has(season);

      for (const algorithm of bandAlgorithms) {
        const layer = new SigmaScoutLayer(RP_RULE_MODULES[season], algorithm.id);
        const algoRecords = records.filter((r) => r.algorithmId === algorithm.id);
        const result = scoreSeason(season, algoRecords, layer, talentAfterMatch.get(algorithm.id)!, counted);
        if (!counted) {
          console.log(`── ${algorithm.id} ${season} ── warmup: ${algoRecords.length} matches replayed, not counted (${boundary.isColdStart ? "started cold" : "carried state in"})\n`);
          continue;
        }
        reportBlock(`${algorithm.id} ${season} (${boundary.isColdStart ? "started cold" : "carried state in"})`, result.rows, result.matches, result.skippedRows, result.noBandRows);
        const pooled = pooledByAlgo.get(algorithm.id)!;
        pooled.rows.push(...result.rows);
        pooled.matches += result.matches;
        pooled.skipped += result.skippedRows;
        pooled.noBand += result.noBandRows;
      }
    }

    if (reported.length > 1) {
      for (const algorithm of bandAlgorithms) {
        const pooled = pooledByAlgo.get(algorithm.id)!;
        reportBlock(`${algorithm.id} POOLED ${reported[0]} to ${reported[reported.length - 1]}`, pooled.rows, pooled.matches, pooled.skipped, pooled.noBand);
      }
    }
  } finally {
    db.close();
  }
}

// Guard: only auto-run `main()` when this file is the process entry point, so
// the pure helpers above can be imported by the test file without opening a
// corpus. Same idiom as `measureAllianceReconstruction.ts`.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("measure:match-band failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
