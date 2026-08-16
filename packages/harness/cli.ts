/**
 * Harness entry point (EVAL-01/EVAL-02, ALGO-01):
 *
 *   pnpm harness --event <event_key> --algorithm opr [--out <dir>]
 *   pnpm harness --season <year> --algorithm opr [--out <dir>] [--include-offseason]
 *   pnpm harness --seasons <start>-<end> --algorithm opr [--out <dir>] [--include-offseason] [--cold-start-season <year>]
 *
 * --event fetches one event from TBA (conditional requests via tbaClient),
 * Zod-validates the response, normalizes and stores it in the SQLite
 * corpus, then replays it. --season/--seasons instead read the
 * already-ingested corpus (Plan 03's `pnpm ingest`) directly and
 * read-only — no network access, no writes (T-01-13) — replaying every
 * season in the range walk-forward across every event in it (Plan 06
 * Task 1's cross-event interleaving), scoring the whole set with one
 * combined artifact and report so the score table reads as a single
 * scoreboard rather than one file per season.
 *
 * D-16/D-19 (plan 02-03): `--seasons` threads each algorithm's state
 * across every season boundary in the range via `algorithm.carrySeason`,
 * rather than starting every season fresh — see `runSeasons` below.
 * `--cold-start-season` overrides which season is treated as having
 * nothing to carry from (defaults to `COLD_START_SEASON`), so extending
 * the corpus back to 2016 is a flag, not an edit.
 *
 * `--measure-update-cost` (plan 02-06 Task 2): wraps every algorithm's
 * `update` with a sampled high-resolution timer before the run starts and
 * prints each algorithm's mean/p99 per-match update cost in microseconds
 * once the run completes — see `withUpdateTiming` below. RESEARCH.md's
 * ~100-150-scalar-op estimate for Sigma1's per-match update must be
 * MEASURED against the real corpus, not assumed (coverage D6, 02-04's own
 * carry-forward note); this flag is that measurement, opt-in so an ordinary
 * scoring run pays zero timing overhead.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import type { AlgorithmModule, MatchResult, SeasonBoundary } from "../core/algorithms/types.js";
import { opr } from "../core/algorithms/opr.js";
import { epa } from "../core/algorithms/epa.js";
import {
  sigma1,
  sigma1Adaptive,
  sigma1Defaults,
  sigma1NormalCdf,
  sigma1SeasonSd,
  makeSigma1,
  DEFAULT_SIGMA1_PARAMS,
  Sigma1ParamsSchema,
} from "../core/algorithms/sigma1/index.js";
import { COLD_START_SEASON } from "../core/algorithms/breakdown/index.js";
import {
  openCorpus,
  openCorpusReadOnly,
  readEtag,
  selectMatchesChronological,
  upsertEvent,
  upsertMatch,
  writeEtag,
  type Corpus,
} from "../corpus/db.js";
import { tbaMatchListSchema, tbaEventSchema } from "../ingest/schemas.js";
import { normalizeEvent, normalizeMatch } from "../ingest/normalize.js";
import { tbaFetch } from "../ingest/tbaClient.js";
import { buildArtifact, writeArtifact } from "./artifact.js";
import {
  closeMetricHistoryWriter,
  openMetricHistoryWriter,
  writeMetricHistoryRows,
  type MetricHistoryRow,
  type MetricHistoryWriterHandle,
} from "./metricHistory.js";
import {
  closePredictionsWriter,
  openPredictionsWriter,
  writePredictionLine,
  type PredictionsWriterHandle,
} from "./predictions.js";
import { PromotedVersionSchema } from "./promote.js";
import { renderHtmlReport } from "./report.js";
import { buildSeasonStream, WalkForwardSimulator } from "./replay.js";
import { aggregateScores, type HarnessPredictionInput } from "./score.js";
import { statboticsReference, type StatboticsReference } from "./statbotics.js";

// `any` here: this registry maps CLI strings to modules with different
// (incompatible) state types S; each entry is internally type-safe. D-12's
// three Sigma1 link modes share one update path (sigma1/index.ts's
// makeSigma1) but are registered as three distinct entries so one harness
// run scores all three side by side (plan 02-05). D-05/D-06 (plan 03-04
// Task 2): `sigma1-adapt` is the SAME shape applied to the adaptation-on/off
// question — `pnpm harness --algorithm sigma1,sigma1-adapt` scores both
// variants in one pass over one shared match stream, so any difference is
// the adaptation and nothing else. `sigma1-defaults` (plan 03-06) is the
// Phase-2-reproducing untuned baseline, registered explicitly so a run can
// show `sigma1` (the currently-promoted, potentially tuned version, see
// `applyPromotedOverrides` below) alongside it — this is what makes "what
// did tuning buy" legible in one artifact rather than implied.
const ALGORITHMS: Record<string, AlgorithmModule<any>> = {
  opr,
  epa,
  sigma1,
  "sigma1-defaults": sigma1Defaults,
  "sigma1-seasonsd": sigma1SeasonSd,
  "sigma1-normalcdf": sigma1NormalCdf,
  "sigma1-adapt": sigma1Adaptive,
};

const CORPUS_PATH = "data/corpus.sqlite";
const STATBOTICS_CACHE_PATH = join("data", "statbotics-cache.json");
/**
 * D-13/D-14 (plan 03-06): once a version is promoted, `--algorithm sigma1`
 * should mean THAT shipped version, not the Phase-2-reproducing defaults
 * `ALGORITHMS.sigma1` above still is — `sigma1-defaults` above is what keeps
 * the untuned baseline available for comparison. Read LAZILY, inside
 * `applyPromotedOverrides` (called only from `main()`, at CLI-entry time,
 * never at this module's top-level import) — `data/algorithm-versions/*.json`
 * IS committed (`.gitignore`'s `data/*` + negation), so this file always
 * exists once promoted, but resolving it eagerly at import time would still
 * be surprising for any other module (e.g. `cli.season-carry.test.ts`) that
 * imports this file only for `runSeasons` and never invokes `main()`.
 */
const PROMOTED_SIGMA1_VERSION_PATH = join("data", "algorithm-versions", "sigma1@2.0.0+tuned-2026-08.json");
/**
 * D-06/D-08/ALGO-05 (plan 03-06): the adaptation-ON joint search's own
 * winning candidate — "each search's own best configuration," not a bare
 * defaults-plus-flag module. `reports/` is gitignored (D-14: a search
 * evaluation is an experiment, not a version), so this file is NOT always
 * present — `applyPromotedOverrides` falls back to the existing
 * `sigma1Adaptive` (defaults + `adaptationEnabled: true`) when it is
 * absent, exactly the pre-existing behavior for every invocation that
 * predates this override.
 */
const ON_SEARCH_ARTIFACT_PATH = join("reports", "tune-joint-on.json");

interface TuneSearchCandidateForOverride {
  readonly index: number;
  readonly params: unknown;
}
interface TuneSearchOutputForOverride {
  readonly winnerIndex: number;
  readonly candidates: readonly TuneSearchCandidateForOverride[];
}

/** Builds a Sigma1 module from a committed, promoted version file — `undefined` if the file does not exist, so the caller can fall back to the plain untuned default. */
function loadPromotedSigma1(id: string, versionPath: string): AlgorithmModule<any> | undefined {
  if (!existsSync(versionPath)) return undefined;
  const raw: unknown = JSON.parse(readFileSync(versionPath, "utf8"));
  const promoted = PromotedVersionSchema.parse(raw);
  return makeSigma1({ id, linkMode: "predictive-variance", params: promoted.params, paramSetName: promoted.paramSetName });
}

/** Builds a Sigma1 module from a `tune.ts --stage joint` search artifact's own winning candidate — restoring `rpMonteCarloDraws` to the versioned default the same way `promote.ts` does for a promoted winner (the search fixes it to 0 for speed). `undefined` if the artifact does not exist. */
function loadSearchWinnerSigma1(id: string, searchArtifactPath: string, paramSetName: string): AlgorithmModule<any> | undefined {
  if (!existsSync(searchArtifactPath)) return undefined;
  const raw: unknown = JSON.parse(readFileSync(searchArtifactPath, "utf8"));
  const output = raw as TuneSearchOutputForOverride;
  const winner = output.candidates.find((c) => c.index === output.winnerIndex);
  if (!winner) return undefined;
  const searchedParams = Sigma1ParamsSchema.parse(winner.params);
  const params = { ...searchedParams, rpMonteCarloDraws: DEFAULT_SIGMA1_PARAMS.rpMonteCarloDraws };
  return makeSigma1({ id, linkMode: "predictive-variance", params, paramSetName });
}

/**
 * Plan 03-06: swaps the static `sigma1`/`sigma1-adapt` registry entries for
 * the currently-promoted version / the on-search's own winner when their
 * source files are present, leaving every other algorithm (and either of
 * these two when their file is absent) exactly as `resolveAlgorithms`
 * returned it. Applied once in `main()`, never inside the static
 * `ALGORITHMS` registry itself (see the file-presence comments above).
 */
function applyPromotedOverrides(algorithms: AlgorithmModule<any>[]): AlgorithmModule<any>[] {
  return algorithms.map((algorithm) => {
    if (algorithm.id === "sigma1") {
      return loadPromotedSigma1("sigma1", PROMOTED_SIGMA1_VERSION_PATH) ?? algorithm;
    }
    if (algorithm.id === "sigma1-adapt") {
      return loadSearchWinnerSigma1("sigma1-adapt", ON_SEARCH_ARTIFACT_PATH, "tune-joint-on-winner") ?? algorithm;
    }
    return algorithm;
  });
}
const DEFAULT_OUT_DIR = "reports";

function tbaApiKey(): string {
  const key = process.env["TBA_API_KEY"];
  if (!key) {
    throw new Error("TBA_API_KEY is not set in the environment. Populate .env from .env.example.");
  }
  return key;
}

/**
 * D-22: `--algorithm` now accepts a comma-separated list ("opr,epa"),
 * driving many algorithms over one shared stream in a single run. Keeps
 * the exact "Unknown algorithm" error-message shape the single-algorithm
 * resolver used, and rejects a duplicate name rather than silently
 * de-duplicating it.
 */
function resolveAlgorithms(spec: string | undefined): AlgorithmModule<any>[] {
  if (!spec) throw new Error("--algorithm is required");
  const names = spec
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (names.length === 0) throw new Error("--algorithm is required");

  const seen = new Set<string>();
  const algorithms: AlgorithmModule<any>[] = [];
  for (const name of names) {
    if (seen.has(name)) {
      throw new Error(`--algorithm lists "${name}" more than once`);
    }
    seen.add(name);
    const algorithm = ALGORITHMS[name];
    if (!algorithm) {
      throw new Error(`Unknown algorithm: ${name} (known: ${Object.keys(ALGORITHMS).join(", ")})`);
    }
    algorithms.push(algorithm);
  }
  return algorithms;
}

/**
 * Plan 02-06 Task 2: every `UPDATE_TIMING_SAMPLE_INTERVAL`-th call to a
 * given algorithm's `update` is timed via `performance.now()` (Node's
 * high-resolution clock); every other call pays only one integer
 * comparison. 20 was chosen so a multi-hour, multi-season run collects
 * thousands of samples per algorithm (enough for a stable p99) without
 * paying the clock's own overhead on every single match.
 */
const UPDATE_TIMING_SAMPLE_INTERVAL = 20;

interface UpdateTimingCollector {
  readonly samplesByAlgorithm: Map<string, number[]>;
}

function createUpdateTimingCollector(): UpdateTimingCollector {
  return { samplesByAlgorithm: new Map() };
}

/**
 * Returns a NEW `AlgorithmModule` whose `update` is wrapped with the
 * sampled timer above; `predict`/`teamMetrics`/`carrySeason`/`initState`
 * are passed through unchanged. Never mutates `algorithm` — the shared
 * `ALGORITHMS` registry instances stay untouched for every other CLI
 * invocation that doesn't pass `--measure-update-cost`.
 */
function withUpdateTiming<S>(algorithm: AlgorithmModule<S>, collector: UpdateTimingCollector): AlgorithmModule<S> {
  let callCount = 0;
  return {
    ...algorithm,
    update(state: S, result: MatchResult): S {
      callCount++;
      if (callCount % UPDATE_TIMING_SAMPLE_INTERVAL !== 0) {
        return algorithm.update(state, result);
      }
      const start = performance.now();
      const next = algorithm.update(state, result);
      const durationMicros = (performance.now() - start) * 1000;
      const samples = collector.samplesByAlgorithm.get(algorithm.id) ?? [];
      samples.push(durationMicros);
      collector.samplesByAlgorithm.set(algorithm.id, samples);
      return next;
    },
  };
}

function percentile(sortedAscending: readonly number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  const idx = Math.min(sortedAscending.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAscending.length) - 1));
  return sortedAscending[idx]!;
}

/** Prints each timed algorithm's mean/p99 per-match update cost in microseconds — the number this plan's SUMMARY quotes, measured rather than estimated. */
function reportUpdateTiming(collector: UpdateTimingCollector): void {
  for (const [algorithmId, samples] of collector.samplesByAlgorithm) {
    if (samples.length === 0) continue;
    const sorted = [...samples].sort((a, b) => a - b);
    const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
    const p99 = percentile(sorted, 99);
    console.log(
      `Update timing [${algorithmId}]: n=${sorted.length} sampled updates, mean=${mean.toFixed(2)}us, p99=${p99.toFixed(2)}us`
    );
  }
}

/** Parses `--seasons "2022-2026"` into an inclusive array of season years. */
function parseSeasonsRange(spec: string): number[] {
  const rangeMatch = /^(\d{4})-(\d{4})$/.exec(spec);
  if (!rangeMatch) {
    throw new Error(`--seasons must be a range like "2022-2026", got "${spec}"`);
  }
  const start = Number.parseInt(rangeMatch[1]!, 10);
  const end = Number.parseInt(rangeMatch[2]!, 10);
  if (end < start) {
    throw new Error(`--seasons range end (${end}) must be >= start (${start})`);
  }
  const seasons: number[] = [];
  for (let year = start; year <= end; year++) seasons.push(year);
  return seasons;
}

function parseSingleSeason(spec: string): number {
  const season = Number.parseInt(spec, 10);
  if (!Number.isInteger(season)) {
    throw new Error(`--season must be a 4-digit year, got "${spec}"`);
  }
  return season;
}

async function writeReport(outDir: string, artifact: Parameters<typeof renderHtmlReport>[0]): Promise<void> {
  const html = renderHtmlReport(artifact);
  mkdirSync(outDir, { recursive: true });
  const htmlPath = join(outDir, "report.html");
  writeFileSync(htmlPath, html, "utf8");
  console.log(`Wrote ${htmlPath}`);
}

/** Result of replaying one season: predictions tagged for scoring, plus every algorithm's state after the season's last match — the value plan 02-03's `runSeasons` threads across the next boundary via `carrySeason`. */
interface SeasonRunResult {
  predictions: HarnessPredictionInput[];
  finalStates: ReadonlyMap<string, unknown>;
}

/** Plan 02-05: the two optional sidecar writers a season replay can stream into — both open for the duration of exactly one season, opened/closed by the caller (`runSeasons`) at each season boundary. */
interface SeasonSidecarWriters {
  predictionsWriter?: PredictionsWriterHandle;
  metricHistoryWriter?: MetricHistoryWriterHandle;
}

/**
 * Replays one season (every event in it, cross-event interleaved) through
 * every supplied `algorithms` over one shared stream (D-22) and returns
 * predictions tagged for scoring, one per (match, algorithm), plus each
 * algorithm's final state. `initialStates`, when supplied (plan 02-03's
 * `runSeasons`), seeds an algorithm's replay from a carried-over state
 * instead of `initState` — see `WalkForwardSimulator.runAll`. Prints a
 * progress line carrying both the replayed match count and the excluded
 * count PER algorithm so a season that silently scored far fewer matches
 * than expected is visible while the run happens, not after, plus whether
 * this algorithm carried state into the season or started cold (D-16: a
 * silent regression to per-season resets must be visible in the run log,
 * not just in the numbers).
 *
 * Plan 02-05 (D-23/D-24/D-25/D-28): when `sidecars.predictionsWriter` is
 * supplied, every `MultiAlgorithmPredictionRecord` this season's replay
 * produces is appended as one JSONL line, in the exact order `runAll`
 * returned them (contiguous per match, stable algorithm order — D-25).
 * When `sidecars.metricHistoryWriter` is supplied, `runAll`'s existing
 * `onMatchComplete` hook (02-01, unused until this plan) snapshots the six
 * involved teams' `teamMetrics` after every (match, algorithm) — inside the
 * loop already running, no second pass over the corpus.
 */
async function runSeason(
  db: Corpus,
  season: number,
  algorithms: readonly AlgorithmModule<any>[],
  includeOffseason: boolean,
  initialStates?: ReadonlyMap<string, unknown>,
  sidecars?: SeasonSidecarWriters
): Promise<SeasonRunResult> {
  const stream = buildSeasonStream(db, season, { includeOffseason });

  const offseasonEventKeys = new Set(
    (
      db.prepare(`SELECT event_key FROM events WHERE year = ? AND is_offseason = 1`).all(season) as {
        event_key: string;
      }[]
    ).map((row) => row.event_key)
  );

  const teams = Array.from(new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
  const algorithmById = new Map(algorithms.map((a) => [a.id, a]));
  // D-28: this match's position in the season's own chronological stream —
  // the same total order every algorithm replays, not a per-team counter.
  const matchIndexByKey = new Map(stream.map((m, i) => [m.matchKey, i]));

  const metricHistoryWriter = sidecars?.metricHistoryWriter;
  const onMatchComplete = metricHistoryWriter
    ? (match: MatchResult, algorithmId: string, state: unknown): void => {
        const algorithm = algorithmById.get(algorithmId);
        if (!algorithm) return;
        const involvedTeams = [...match.redTeams, ...match.blueTeams];
        const metrics = algorithm.teamMetrics(state, involvedTeams);
        const rows: MetricHistoryRow[] = involvedTeams.map((teamKey) => ({
          matchKey: match.matchKey,
          season,
          eventKey: match.eventKey,
          algorithmId,
          teamKey,
          matchIndex: matchIndexByKey.get(match.matchKey) ?? 0,
          metrics: metrics[teamKey] ?? {},
        }));
        writeMetricHistoryRows(metricHistoryWriter, rows);
      }
    : undefined;

  const simulator = new WalkForwardSimulator(stream);
  const records = simulator.runAll(algorithms, teams, initialStates, onMatchComplete);

  const predictionsWriter = sidecars?.predictionsWriter;
  if (predictionsWriter) {
    for (const r of records) {
      const algorithm = algorithmById.get(r.algorithmId);
      writePredictionLine(predictionsWriter, {
        matchKey: r.match.matchKey,
        season,
        eventKey: r.match.eventKey,
        compLevel: r.match.compLevel,
        algorithmId: r.algorithmId,
        algorithmVersion: algorithm?.version ?? "unknown",
        predictedWinner: r.prediction.winner,
        pRedWin: r.prediction.pRedWin,
        predictedRedScore: r.prediction.redScore,
        predictedBlueScore: r.prediction.blueScore,
        redComponents: r.prediction.redComponents ?? {},
        blueComponents: r.prediction.blueComponents ?? {},
        variance: r.prediction.variance,
        // D-10 (plan 03-03): present only for an algorithm that modeled RP
        // (Sigma1) — `writePredictionLine`'s schema treats `undefined` as
        // "omit entirely", never coercing to an empty array.
        redRpPmf: r.prediction.redRpPmf ? [...r.prediction.redRpPmf] : undefined,
        blueRpPmf: r.prediction.blueRpPmf ? [...r.prediction.blueRpPmf] : undefined,
        actualWinner: r.match.winner,
        actualRedScore: r.match.redScore,
        actualBlueScore: r.match.blueScore,
      });
    }
  }

  const predictions: HarnessPredictionInput[] = records.map((r) => ({
    matchKey: r.match.matchKey,
    season,
    compLevel: r.match.compLevel,
    algorithmId: r.algorithmId,
    pRedWin: r.prediction.pRedWin,
    predictedRedScore: r.prediction.redScore,
    predictedBlueScore: r.prediction.blueScore,
    actualWinner: r.match.winner,
    isOffseason: offseasonEventKeys.has(r.match.eventKey),
    isSurrogateAffected: r.match.redSurrogates.length > 0 || r.match.blueSurrogates.length > 0,
  }));

  for (const algorithm of algorithms) {
    const algorithmPredictions = predictions.filter((p) => p.algorithmId === algorithm.id);
    const excludedCount = algorithmPredictions.filter((p) => p.isOffseason || p.isSurrogateAffected).length;
    const carryStatus = initialStates?.has(algorithm.id) ? "carried state in" : "started cold";
    console.log(
      `Season ${season} [${algorithm.id}]: ${algorithmPredictions.length} matches replayed, ${algorithmPredictions.length - excludedCount} scorable, ${excludedCount} excluded (${carryStatus})`
    );
  }

  return { predictions, finalStates: records.finalStates };
}

/**
 * D-16/D-19: threads each algorithm's state across every season boundary
 * in `seasons`, so replaying 2022-2026 in one invocation lets 2026's
 * predictions be informed by 2022-2025 rather than starting every season
 * from a fresh cold start.
 *
 * At each season after `coldStartSeason`, every algorithm that implements
 * `carrySeason` is carried forward from its live state via
 * `algorithm.carrySeason(state, boundary)`; the carried states become that
 * season's `initialStates` for `runSeason`/`WalkForwardSimulator.runAll`.
 * An algorithm with no `carrySeason` (OPR) is deliberately left OUT of
 * `initialStates` for every season — `runAll` falls back to `initState`
 * for any algorithm id missing from the map, exactly reproducing Phase 1's
 * per-season-fresh-start behavior. This is intentional, not an oversight:
 * OPR is season-pooled by design (see `opr.ts`'s file header), and a
 * cross-season OPR would be a different algorithm, not a bug fix.
 *
 * An algorithm that HAS carried-in live state from a prior season in this
 * same run, but whose current live state is `undefined` (it was never
 * replayed at all, e.g. added to `--algorithm` partway through a manually
 * assembled multi-run pipeline), is also left out of `initialStates` for
 * that boundary — there is nothing to carry, so it starts that season
 * cold rather than the run throwing.
 *
 * Plan 02-05: `sidecarConfig`, when supplied, opens one `predictionsWriter`
 * and/or `metricHistoryWriter` PER SEASON — a fresh file per season boundary
 * — passes them to `runSeason`, and closes both before moving to the next
 * season, so a season's sidecar file is complete the moment that season's
 * loop iteration ends rather than staying open across the whole range.
 */
// Exported for `cli.season-carry.test.ts`'s T-02-08 regression: a
// 2022-2023 run's 2022 predictions must be byte-identical to a
// 2022-only run's, proving carrySeason cannot leak a later season's
// information backward into an earlier one's predictions.
export interface RunSeasonsSidecarConfig {
  /** When set, a `predictions-{season}.jsonl` writer is opened in this directory for every season. */
  predictionsOutDir?: string;
  /** When set, a `metrics-{season}.jsonl` writer is opened in this directory for every season. */
  metricHistoryOutDir?: string;
  /** Forwarded to both writers' secret-scrub check; `undefined` on a path with no secret in scope. */
  secretToScrub?: string;
}

export async function runSeasons(
  db: Corpus,
  seasons: readonly number[],
  algorithms: readonly AlgorithmModule<any>[],
  includeOffseason: boolean,
  coldStartSeason: number,
  sidecarConfig?: RunSeasonsSidecarConfig
): Promise<HarnessPredictionInput[]> {
  const all: HarnessPredictionInput[] = [];
  let liveStates = new Map<string, unknown>();

  for (const season of seasons) {
    const boundary: SeasonBoundary = {
      fromSeason: season - 1,
      toSeason: season,
      isColdStart: season === coldStartSeason,
    };

    let initialStates: ReadonlyMap<string, unknown> | undefined;
    if (boundary.isColdStart) {
      console.log(`Season ${season}: cold-start season (--cold-start-season=${coldStartSeason}) — every algorithm starts fresh.`);
    } else {
      const carried = new Map<string, unknown>();
      for (const algorithm of algorithms) {
        const priorState = liveStates.get(algorithm.id);
        if (algorithm.carrySeason && priorState !== undefined) {
          carried.set(algorithm.id, algorithm.carrySeason(priorState, boundary));
        }
      }
      initialStates = carried;
    }

    const predictionsWriter = sidecarConfig?.predictionsOutDir
      ? openPredictionsWriter(sidecarConfig.predictionsOutDir, season, sidecarConfig.secretToScrub)
      : undefined;
    const metricHistoryWriter = sidecarConfig?.metricHistoryOutDir
      ? openMetricHistoryWriter(sidecarConfig.metricHistoryOutDir, season, sidecarConfig.secretToScrub)
      : undefined;

    const { predictions, finalStates } = await runSeason(db, season, algorithms, includeOffseason, initialStates, {
      predictionsWriter,
      metricHistoryWriter,
    });

    if (predictionsWriter) closePredictionsWriter(predictionsWriter);
    if (metricHistoryWriter) closeMetricHistoryWriter(metricHistoryWriter);

    all.push(...predictions);
    liveStates = new Map(finalStates);
  }
  return all;
}

/**
 * The season/multi-season path: reads the already-ingested corpus
 * read-only (T-01-13 — a scoring run cannot mutate the data it scores),
 * replays every requested season cross-event-interleaved for every
 * supplied algorithm (D-22), and writes one combined artifact and report
 * covering the whole range and every algorithm (D-20).
 *
 * Plan 02-05 (D-23): `predictionsOutDir` (defaults to `outDir` — the
 * sidecar is part of what a run produces) and `writeMetricHistory` (default
 * off, `--metric-history`) wire the two per-season sidecar writers through
 * `runSeasons`. Both are passed `secretToScrub: undefined` — this path
 * reads the corpus read-only and never has the TBA API key in scope (no
 * network calls happen here), so there is no secret to scrub against.
 */
async function runSeasonsMode(
  seasons: readonly number[],
  algorithms: readonly AlgorithmModule<any>[],
  outDir: string,
  includeOffseason: boolean,
  coldStartSeason: number,
  predictionsOutDir: string,
  writeMetricHistory: boolean
): Promise<void> {
  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    const predictions = await runSeasons(db, seasons, algorithms, includeOffseason, coldStartSeason, {
      predictionsOutDir,
      metricHistoryOutDir: writeMetricHistory ? outDir : undefined,
      secretToScrub: undefined,
    });
    const slices = aggregateScores(predictions);

    const statboticsReferences: StatboticsReference[] = [];
    for (const season of seasons) {
      statboticsReferences.push(await statboticsReference(season, { cachePath: STATBOTICS_CACHE_PATH }));
    }

    const artifact = buildArtifact({
      algorithms: algorithms.map((a) => ({ id: a.id, version: a.version })),
      corpusIdentity: CORPUS_PATH,
      slices,
      statboticsReferences,
    });

    const artifactPath = writeArtifact(outDir, artifact);
    console.log(`Wrote ${artifactPath}`);
    await writeReport(outDir, artifact);
  } finally {
    db.close();
  }
}

/**
 * The legacy single-event path (unchanged from the tracer/Plan 05 scope,
 * extended for D-22 to drive several algorithms over the one event's
 * shared stream): fetches one event from TBA, normalizes and upserts it
 * into the corpus, then replays and scores just that event. Kept for quick
 * single-event smoke tests; --season/--seasons is the path Phase 1's full
 * backtest uses.
 */
async function runEventMode(eventKey: string, algorithms: readonly AlgorithmModule<any>[], outDir: string): Promise<void> {
  const apiKey = tbaApiKey();
  const db = openCorpus(CORPUS_PATH);

  try {
    const eventUrl = `/event/${eventKey}`;
    const eventFetch = await tbaFetch(eventUrl, apiKey, readEtag(db, eventUrl));
    if (eventFetch.status === 304) {
      console.log(`TBA ${eventUrl}: 304 Not Modified`);
    } else {
      console.log(`TBA ${eventUrl}: 200 OK`);
      const rawEvent = tbaEventSchema.parse(eventFetch.body);
      upsertEvent(db, normalizeEvent(rawEvent));
      if (eventFetch.etag) writeEtag(db, eventUrl, eventFetch.etag);
    }

    const matchesUrl = `/event/${eventKey}/matches`;
    const matchesFetch = await tbaFetch(matchesUrl, apiKey, readEtag(db, matchesUrl));
    if (matchesFetch.status === 304) {
      console.log(`TBA ${matchesUrl}: 304 Not Modified`);
    } else {
      console.log(`TBA ${matchesUrl}: 200 OK`);
      const rawMatches = tbaMatchListSchema.parse(matchesFetch.body);
      const eventRow = db
        .prepare("SELECT start_date FROM events WHERE event_key = ?")
        .get(eventKey) as { start_date: string } | undefined;
      const startDate = eventRow?.start_date ?? new Date().toISOString();
      for (const rawMatch of rawMatches) {
        upsertMatch(db, normalizeMatch(rawMatch, startDate));
      }
      if (matchesFetch.etag) writeEtag(db, matchesUrl, matchesFetch.etag);
    }

    const matches = selectMatchesChronological(db, { eventKey });
    if (matches.length === 0) {
      throw new Error(`No completed matches found in corpus for event ${eventKey}`);
    }

    const eventRowForOffseason = db
      .prepare("SELECT is_offseason FROM events WHERE event_key = ?")
      .get(eventKey) as { is_offseason: number } | undefined;
    const isOffseason = eventRowForOffseason?.is_offseason === 1;

    // The single-event CLI derives season from the event key's leading
    // 4 digits (TBA's own convention, e.g. "2024casj").
    const season = Number.parseInt(eventKey.slice(0, 4), 10);
    if (!Number.isInteger(season)) {
      throw new Error(`Could not derive a season from event key ${eventKey} (expected a leading 4-digit year)`);
    }

    const teams = Array.from(new Set(matches.flatMap((m) => [...m.redTeams, ...m.blueTeams])));

    const simulator = new WalkForwardSimulator(matches);
    const records = simulator.runAll(algorithms, teams);

    const predictions: HarnessPredictionInput[] = records.map((r) => ({
      matchKey: r.match.matchKey,
      season,
      compLevel: r.match.compLevel,
      algorithmId: r.algorithmId,
      pRedWin: r.prediction.pRedWin,
      predictedRedScore: r.prediction.redScore,
      predictedBlueScore: r.prediction.blueScore,
      actualWinner: r.match.winner,
      isOffseason,
      isSurrogateAffected: r.match.redSurrogates.length > 0 || r.match.blueSurrogates.length > 0,
    }));

    const slices = aggregateScores(predictions);
    const statboticsRef = await statboticsReference(season, { cachePath: STATBOTICS_CACHE_PATH });

    const artifact = buildArtifact({
      algorithms: algorithms.map((a) => ({ id: a.id, version: a.version })),
      corpusIdentity: CORPUS_PATH,
      slices,
      statboticsReferences: [statboticsRef],
    });

    const artifactPath = writeArtifact(outDir, artifact, apiKey);

    const html = renderHtmlReport(artifact);
    if (html.includes(apiKey)) {
      throw new Error("Refusing to write HTML report: rendered output contains a secret value.");
    }
    mkdirSync(outDir, { recursive: true });
    const htmlPath = join(outDir, "report.html");
    writeFileSync(htmlPath, html, "utf8");

    console.log(`Wrote ${artifactPath}`);
    console.log(`Wrote ${htmlPath}`);
  } finally {
    db.close();
  }
}

/** `--cold-start-season <year>` (D-19): parses to a 4-digit year, defaulting to `COLD_START_SEASON` when omitted. */
function parseColdStartSeason(spec: string | undefined): number {
  if (spec === undefined) return COLD_START_SEASON;
  const season = Number.parseInt(spec, 10);
  if (!Number.isInteger(season)) {
    throw new Error(`--cold-start-season must be a 4-digit year, got "${spec}"`);
  }
  return season;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      event: { type: "string" },
      season: { type: "string" },
      seasons: { type: "string" },
      algorithm: { type: "string" },
      out: { type: "string" },
      "include-offseason": { type: "boolean" },
      "cold-start-season": { type: "string" },
      "predictions-out": { type: "string" },
      "metric-history": { type: "boolean" },
      "measure-update-cost": { type: "boolean" },
    },
  });

  // Plan 03-06: swaps in the currently-promoted `sigma1` version and the
  // adaptation-on search's own winner for `sigma1-adapt`, when their source
  // files exist — see `applyPromotedOverrides`'s own doc comment. A no-op
  // for every other algorithm id and for either of these two when its
  // source file is absent.
  const algorithms = applyPromotedOverrides(resolveAlgorithms(values.algorithm));
  const outDir = values.out ?? DEFAULT_OUT_DIR;
  const includeOffseason = values["include-offseason"] === true;
  const coldStartSeason = parseColdStartSeason(values["cold-start-season"]);
  // D-23: the prediction sidecar is part of what a run produces, so it
  // defaults to living beside artifact.json rather than requiring an
  // explicit opt-in flag every time.
  const predictionsOutDir = values["predictions-out"] ?? outDir;
  // D-28: off by default — a run that only wants scores should not pay the
  // ~6-teams-x-matches-per-algorithm row cost.
  const writeMetricHistory = values["metric-history"] === true;

  // Plan 02-06 Task 2: opt-in per-match update timing — wraps every
  // resolved algorithm's `update` (not just Sigma1's) so the run produces a
  // real side-by-side comparison, at zero cost when the flag is absent.
  const measureUpdateCost = values["measure-update-cost"] === true;
  const updateTimingCollector = measureUpdateCost ? createUpdateTimingCollector() : undefined;
  const timedAlgorithms = updateTimingCollector
    ? algorithms.map((algorithm) => withUpdateTiming(algorithm, updateTimingCollector))
    : algorithms;

  if (values.event) {
    await runEventMode(values.event, timedAlgorithms, outDir);
  } else if (values.seasons || values.season) {
    const seasons = values.seasons ? parseSeasonsRange(values.seasons) : [parseSingleSeason(values.season!)];
    await runSeasonsMode(seasons, timedAlgorithms, outDir, includeOffseason, coldStartSeason, predictionsOutDir, writeMetricHistory);
  } else {
    throw new Error("One of --event, --season, or --seasons is required");
  }

  if (updateTimingCollector) reportUpdateTiming(updateTimingCollector);
}

// Guard: only auto-run `main()` when this file is the process entry point
// (`pnpm harness ...`), never on a bare `import` — `cli.season-carry.test.ts`
// imports `runSeasons` directly for the T-02-08 regression, and importing a
// module must never have the side effect of parsing `process.argv` and
// invoking a real corpus run.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("harness failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
