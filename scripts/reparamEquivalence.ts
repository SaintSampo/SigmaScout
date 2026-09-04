/**
 * The measuring instrument for quick task 260901-trz's D-T1/D-T2 parameter
 * reshape: it establishes the reference scale the reparameterization is
 * defined against, and it takes the BEFORE/AFTER readings that decide whether
 * the reshape was a rename or an accidental retune.
 *
 * ## Why a reference scale has to be MEASURED, not chosen
 *
 * D-T1 turns five absolute hyperparameters into dimensionless fractions of
 * the season's alliance-score variance. For that to be a REPARAMETERIZATION,
 * the relative defaults must reproduce, on the seasons the absolutes were
 * tuned on, roughly the absolute behaviour those numbers already produce. The
 * conversion `rel = absolute / V_ref` therefore needs a `V_ref` that IS the
 * scale the promoted absolutes actually operated at.
 *
 * `--mode reference` measures exactly that: the MATCH-COUNT-WEIGHTED MEAN of
 * the realized expanding alliance-score variance over every tune-season match
 * (2022-2024), folded the same way `sigma1/index.ts`'s `update()` folds it —
 * both alliances per match, a whole-alliance-DQ zero excluded, and NEVER
 * reset at a season boundary. That last point is not a detail: `carrySeason`
 * deliberately carries `allianceScoreStats` forward, so resetting here would
 * measure a statistic the model never sees.
 *
 * ## Exact per-match equivalence is impossible, by construction
 *
 * The realized `sigma^2` at match m is a weighted blend of every alliance
 * score folded since 2022 — neither the season's final variance nor constant
 * within a season. The retired parameterization applied ONE number at every
 * match; the new one applies `rel * sigma^2_m`, which moves match to match.
 * The two can agree on AVERAGE over a pool and never at a single match. That
 * is why this script reports gated DELTAS over a pool rather than asserting
 * a per-match identity, and why `docs/models/sigma1-reparameterization.md`
 * states the four tolerances up front rather than deriving them afterwards
 * from whatever came out.
 *
 * ## Secrets
 *
 * This path opens the corpus READ-ONLY and makes no network call, so no
 * credential is ever legitimately in scope. Its `package.json` entry
 * deliberately omits `--env-file=.env`, placing it with `tune`, `promote`,
 * `fingerprint`, `identifiability` and `measure:rewind-gap` — the corpus-only
 * offline scripts (CLAUDE.md, Secrets handling). `.env` is never read,
 * printed, copied or interpolated.
 */
import { statSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import type { AlgorithmModule, MatchResult, SeasonBoundary } from "../packages/core/algorithms/types.js";
import { openCorpusReadOnly, type Corpus } from "../packages/corpus/db.js";
import { buildSeasonStream, WalkForwardSimulator } from "../packages/harness/replay.js";
import { emptyExpandingStats, foldObservation, standardDeviation } from "../packages/core/scoring/expandingStats.js";
import { SIGMA1_FALLBACK_SCORE_SD } from "../packages/core/algorithms/sigma1/params.js";
import { isFullyDqZeroScoreAlliance } from "../packages/core/algorithms/dq.js";
import { isFullyDemoAlliance } from "../packages/core/algorithms/demoTeams.js";
import { ratingEligibleTeams } from "../packages/core/algorithms/opr.js";
import { COLD_START_SEASON } from "../packages/core/algorithms/breakdown/index.js";
import { outcomeTarget, scoreSet, type MatchOutcome } from "../packages/core/scoring/brier.js";
import { isValidPRedWin } from "../packages/core/scoring/predictionValidity.js";
import { aggregateScores, ELIGIBILITY_NOT_CLAIMED, type HarnessPredictionInput } from "../packages/harness/score.js";
import { eventBlockedBootstrap, type EventBlockedUnit } from "../packages/harness/eventBootstrap.js";
import { PromotedVersionSchema } from "../packages/harness/promote.js";
import { makeSeasonalSigma1 } from "../packages/harness/seasonParamSets.js";

const CORPUS_PATH = "data/corpus.sqlite";

/** D-09's tune seasons, restated locally: `V_ref` is defined over the pool the promoted absolutes were selected on, and must not silently follow a future edit of `score.ts`'s split. */
const REFERENCE_SEASONS = [2022, 2023, 2024] as const;

// ---------------------------------------------------------------------------
// --mode reference
// ---------------------------------------------------------------------------

interface ReferenceSeasonReport {
  readonly season: number;
  readonly matchCount: number;
  /** Mean of the per-match realized variance over this season's matches (each match weight 1). */
  readonly meanVariance: number;
  readonly firstVariance: number;
  readonly finalVariance: number;
}

interface ReferenceReport {
  readonly referenceScoreVariance: number;
  readonly matchCount: number;
  readonly firstVariance: number;
  readonly finalVariance: number;
  readonly perSeason: readonly ReferenceSeasonReport[];
}

/**
 * Replays the tune seasons' alliance scores through the SAME expanding
 * statistic `update()` maintains, recording, before each match, the variance
 * that match's update would have been scaled by.
 *
 * Three fidelity points, each of which would change the answer if got wrong:
 *
 *   1. A fully-demo match is skipped WHOLE (both alliances) — `update()`'s
 *      first statement returns the state untouched for one.
 *   2. A whole-alliance-DQ zero is excluded from the fold for THAT alliance
 *      only, via the shared `isFullyDqZeroScoreAlliance` predicate (never a
 *      re-derived one), exactly as `update()` does.
 *   3. The statistic is NEVER reset at a season boundary.
 */
function measureReferenceVariance(db: Corpus): ReferenceReport {
  let stats = emptyExpandingStats();
  const perSeason: ReferenceSeasonReport[] = [];
  const allVariances: number[] = [];

  for (const season of REFERENCE_SEASONS) {
    const stream = buildSeasonStream(db, season, { includeOffseason: false });
    const seasonVariances: number[] = [];

    for (const match of stream) {
      if (isFullyDemoAlliance(match.redTeams) || isFullyDemoAlliance(match.blueTeams)) continue;

      const sd = standardDeviation(stats, SIGMA1_FALLBACK_SCORE_SD);
      seasonVariances.push(sd * sd);

      const redTeams = ratingEligibleTeams(match.redTeams, match.redSurrogates);
      const blueTeams = ratingEligibleTeams(match.blueTeams, match.blueSurrogates);
      if (!isFullyDqZeroScoreAlliance(redTeams, match.redDqs, match.redScore)) {
        stats = foldObservation(stats, match.redScore);
      }
      if (!isFullyDqZeroScoreAlliance(blueTeams, match.blueDqs, match.blueScore)) {
        stats = foldObservation(stats, match.blueScore);
      }
    }

    for (const v of seasonVariances) allVariances.push(v);
    perSeason.push({
      season,
      matchCount: seasonVariances.length,
      meanVariance: seasonVariances.reduce((sum, v) => sum + v, 0) / seasonVariances.length,
      firstVariance: seasonVariances[0]!,
      finalVariance: seasonVariances[seasonVariances.length - 1]!,
    });
  }

  return {
    referenceScoreVariance: allVariances.reduce((sum, v) => sum + v, 0) / allVariances.length,
    matchCount: allVariances.length,
    firstVariance: allVariances[0]!,
    finalVariance: allVariances[allVariances.length - 1]!,
    perSeason,
  };
}

// ---------------------------------------------------------------------------
// --mode measure
// ---------------------------------------------------------------------------

/**
 * One replayed match, carrying BOTH the win-probability side (Brier) and the
 * score side (MAE/bias) so the two are guaranteed to describe the same
 * population. `eventKey` makes it an `EventBlockedUnit` — every standard
 * error below is event-blocked (D-T6).
 */
interface ScoredRecord extends EventBlockedUnit {
  readonly matchKey: string;
  readonly season: number;
  readonly pRedWin: number;
  readonly predictedRedScore: number;
  readonly predictedBlueScore: number;
  readonly actualRedScore: number;
  readonly actualBlueScore: number;
  readonly actualWinner: MatchOutcome;
}

interface SeasonMetrics {
  readonly season: number | "pooled";
  readonly matchCount: number;
  readonly eventCount: number;
  readonly brier: number;
  readonly brierStandardError: number;
  readonly winnerAccuracy: number | null;
  /** Mean |predicted - actual| over BOTH alliances (2 * matchCount observations). */
  readonly scoreMae: number;
  readonly scoreMaeStandardError: number;
  /** Mean (predicted - actual) over both alliances — positive means the model over-predicts scores. */
  readonly scoreBias: number;
}

const perMatchBrier = (r: ScoredRecord): number => (r.pRedWin - outcomeTarget(r.actualWinner)) ** 2;
const perMatchAbsoluteError = (r: ScoredRecord): number =>
  Math.abs(r.predictedRedScore - r.actualRedScore) + Math.abs(r.predictedBlueScore - r.actualBlueScore);
const perMatchSignedError = (r: ScoredRecord): number =>
  r.predictedRedScore - r.actualRedScore + (r.predictedBlueScore - r.actualBlueScore);

const meanBrier = (sample: readonly ScoredRecord[]): number =>
  sample.length === 0 ? 0 : sample.reduce((sum, r) => sum + perMatchBrier(r), 0) / sample.length;
const meanScoreMae = (sample: readonly ScoredRecord[]): number =>
  sample.length === 0 ? 0 : sample.reduce((sum, r) => sum + perMatchAbsoluteError(r), 0) / (2 * sample.length);

function metricsFor(label: number | "pooled", records: readonly ScoredRecord[], bootstrapResamples: number): SeasonMetrics {
  const brierBootstrap = eventBlockedBootstrap(records, meanBrier, { resamples: bootstrapResamples });
  const maeBootstrap = eventBlockedBootstrap(records, meanScoreMae, { resamples: bootstrapResamples });
  const accuracy = scoreSet(records.map((r) => ({ pRedWin: r.pRedWin, actualWinner: r.actualWinner })));
  return {
    season: label,
    matchCount: records.length,
    eventCount: brierBootstrap.eventCount,
    brier: brierBootstrap.pointEstimate,
    brierStandardError: brierBootstrap.standardError,
    winnerAccuracy: accuracy.winnerAccuracy,
    scoreMae: maeBootstrap.pointEstimate,
    scoreMaeStandardError: maeBootstrap.standardError,
    scoreBias: records.reduce((sum, r) => sum + perMatchSignedError(r), 0) / (2 * records.length),
  };
}

interface MeasureReport {
  readonly paramsFile: string;
  readonly version: string;
  readonly seasons: readonly number[];
  readonly corpus: { readonly path: string; readonly sizeBytes: number; readonly modifiedAt: string };
  readonly perSeason: readonly SeasonMetrics[];
  readonly pooled: SeasonMetrics;
}

/**
 * Replays ONE named promoted parameter set across `seasons` as a single
 * continuous run, threading `carrySeason` across every boundary — five
 * independent per-season runs would measure a different model (D-16/D-19).
 * Every match goes through `WalkForwardSimulator`, so `replay.ts` stays the
 * only replay implementation in the repo (the same constraint `tune.ts`'s
 * header places on itself).
 */
function replaySeasons(db: Corpus, seasons: readonly number[], paramsFile: string, bootstrapResamples: number): MeasureReport {
  const promoted = PromotedVersionSchema.parse(JSON.parse(readFileSync(paramsFile, "utf8")));
  // D-2 (quick task 260904-100): routed through the per-season facade rather
  // than a bare `makeSigma1({ params: promoted.params, ... })` — `params` is
  // schema-optional (absent for a `paramSetsBySeason` file), and this
  // script's own multi-season loop below (with its own `carrySeason`
  // threading) needs the season-appropriate set at every boundary, not a
  // silent `DEFAULT_SIGMA1_PARAMS` fallback.
  // `AlgorithmModule<any>` matches `cli.ts`'s/`tune.ts`'s own convention for a
  // module whose state is threaded across boundaries as an opaque value —
  // `finalStates` is a `ReadonlyMap<string, unknown>` by design (it holds many
  // algorithms' differently-shaped states), so the carried value cannot be
  // statically narrowed back to `Sigma1State` at this seam.
  const algorithm: AlgorithmModule<any> = makeSeasonalSigma1(promoted, { id: "vpr", linkMode: "predictive-variance" });

  const bySeason = new Map<number, ScoredRecord[]>();
  const all: ScoredRecord[] = [];
  const harnessPredictions: HarnessPredictionInput[] = [];
  let liveState: unknown;

  for (const season of seasons) {
    const boundary: SeasonBoundary = { fromSeason: season - 1, toSeason: season, isColdStart: season === COLD_START_SEASON };
    let initialStates: ReadonlyMap<string, unknown> | undefined;
    if (!boundary.isColdStart && liveState !== undefined && algorithm.carrySeason) {
      initialStates = new Map([[algorithm.id, algorithm.carrySeason(liveState, boundary)]]);
    }

    const stream: MatchResult[] = buildSeasonStream(db, season, { includeOffseason: false });
    const teams = Array.from(new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
    const records = new WalkForwardSimulator(stream).runAll([algorithm], teams, initialStates);
    liveState = records.finalStates.get(algorithm.id);

    const seasonRecords: ScoredRecord[] = [];
    for (const r of records) {
      const isSurrogateAffected = r.match.redSurrogates.length > 0 || r.match.blueSurrogates.length > 0;
      harnessPredictions.push({
        matchKey: r.match.matchKey,
        season,
        eventKey: r.match.eventKey,
        compLevel: r.match.compLevel,
        algorithmId: algorithm.id,
        pRedWin: r.prediction.pRedWin,
        predictedRedScore: r.prediction.redScore,
        predictedBlueScore: r.prediction.blueScore,
        actualWinner: r.match.winner,
        // `buildSeasonStream` already excluded offseason events (D-06's default).
        isOffseason: false,
        isSurrogateAffected,
      });

      // The SAME four exclusions `aggregateScores` applies, in the same
      // order. Applying a different (or differently-ordered) filter would
      // make Brier and MAE describe two different populations and reintroduce
      // — inside the measuring instrument — exactly the silent-narrowing
      // failure `score.ts`'s quarantine bounds exist to prevent. The
      // agreement is CHECKED below, not assumed.
      if (isSurrogateAffected) continue;
      if (r.match.winner === null) continue;
      if (!isValidPRedWin(r.prediction.pRedWin)) continue;

      seasonRecords.push({
        matchKey: r.match.matchKey,
        season,
        eventKey: r.match.eventKey,
        pRedWin: r.prediction.pRedWin,
        predictedRedScore: r.prediction.redScore,
        predictedBlueScore: r.prediction.blueScore,
        actualRedScore: r.match.redScore,
        actualBlueScore: r.match.blueScore,
        actualWinner: r.match.winner,
      });
    }

    bySeason.set(season, seasonRecords);
    for (const record of seasonRecords) all.push(record);
    console.log(`  season ${season}: ${stream.length} replayed, ${seasonRecords.length} scorable`);
  }

  // Population cross-check: this script's own filtered set must reproduce
  // `aggregateScores`' combined-view Brier to the last digit. A mismatch means
  // the two populations diverged, which invalidates every MAE/bias figure
  // below — so it throws rather than printing a caveat.
  // D-2 (quick task 260903-krp): `seasons` (in scope from this script's own
  // loop above) is the declared season set.
  // D-2 (quick task 260903-n2o): the sentinel — this cross-check reads only
  // `brierScore`/`scoredCount`, never `headlineEligible`.
  const slices = aggregateScores(harnessPredictions, {
    corpusSeasons: seasons,
    selectedOnSeasons: ELIGIBILITY_NOT_CLAIMED,
  });
  for (const season of seasons) {
    const slice = slices.find((s) => s.season === season && s.compLevelView === "combined");
    if (!slice || slice.brierScore === null) throw new Error(`reparamEquivalence: aggregateScores produced no combined slice for ${season}`);
    const own = meanBrier(bySeason.get(season)!);
    if (Math.abs(slice.brierScore - own) > 1e-12 || slice.scoredCount !== bySeason.get(season)!.length) {
      throw new Error(
        `reparamEquivalence: season ${season} population disagreement — aggregateScores scored ${slice.scoredCount} at Brier ` +
          `${slice.brierScore}, this script scored ${bySeason.get(season)!.length} at ${own}`
      );
    }
  }

  const corpusStat = statSync(CORPUS_PATH);

  return {
    paramsFile,
    version: promoted.version,
    seasons: [...seasons],
    corpus: { path: CORPUS_PATH, sizeBytes: corpusStat.size, modifiedAt: corpusStat.mtime.toISOString() },
    perSeason: seasons.map((season) => metricsFor(season, bySeason.get(season)!, bootstrapResamples)),
    pooled: metricsFor("pooled", all, bootstrapResamples),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseSeasons(spec: string): number[] {
  const seasons = spec.split(",").map((part) => {
    const season = Number.parseInt(part.trim(), 10);
    if (!Number.isInteger(season) || String(season).length !== 4) {
      throw new Error(`--seasons expects a comma-separated list of 4-digit years, got "${part}"`);
    }
    return season;
  });
  for (let i = 1; i < seasons.length; i++) {
    if (seasons[i]! !== seasons[i - 1]! + 1) {
      throw new Error(
        `--seasons must be contiguous and ascending (this is ONE continuous replay with carrySeason threading, not independent runs), got "${spec}"`
      );
    }
  }
  return seasons;
}

function formatMetrics(m: SeasonMetrics): string {
  return (
    `${String(m.season).padEnd(7)} n=${String(m.matchCount).padStart(6)} events=${String(m.eventCount).padStart(4)}  ` +
    `Brier ${m.brier.toFixed(6)} +/- ${m.brierStandardError.toFixed(6)}  ` +
    `acc ${m.winnerAccuracy === null ? "n/a" : m.winnerAccuracy.toFixed(4)}  ` +
    `MAE ${m.scoreMae.toFixed(4)} +/- ${m.scoreMaeStandardError.toFixed(4)}  ` +
    `bias ${m.scoreBias >= 0 ? "+" : ""}${m.scoreBias.toFixed(4)}`
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      mode: { type: "string" },
      params: { type: "string" },
      seasons: { type: "string" },
      out: { type: "string" },
      resamples: { type: "string" },
    },
  });

  const mode = values.mode;
  if (mode !== "reference" && mode !== "measure") {
    throw new Error(`--mode must be "reference" or "measure", got "${mode ?? "(missing)"}"`);
  }
  const resamples = values.resamples !== undefined ? Number.parseInt(values.resamples, 10) : 2000;

  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    if (mode === "reference") {
      const report = measureReferenceVariance(db);
      console.log(`SIGMA1_REFERENCE_SCORE_VARIANCE = ${report.referenceScoreVariance}`);
      console.log(`  match-count-weighted mean of the realized expanding alliance-score variance`);
      console.log(`  over ${report.matchCount} tune-season matches (${REFERENCE_SEASONS.join(", ")}), folded continuously`);
      console.log(`  first match: ${report.firstVariance}   final: ${report.finalVariance}`);
      for (const s of report.perSeason) {
        console.log(
          `  ${s.season}: n=${s.matchCount} mean=${s.meanVariance.toFixed(3)} first=${s.firstVariance.toFixed(3)} final=${s.finalVariance.toFixed(3)}`
        );
      }
      // The weighted mean must lie strictly between the smallest and largest
      // per-season mean it averages; if it does not, the weighting is wrong.
      const seasonMeans = report.perSeason.map((s) => s.meanVariance);
      const withinRange =
        report.referenceScoreVariance > Math.min(...seasonMeans) && report.referenceScoreVariance < Math.max(...seasonMeans);
      console.log(`  sanity: weighted mean strictly inside [min, max] of per-season means: ${withinRange ? "OK" : "FAILED"}`);
      if (values.out) {
        mkdirSync(dirname(values.out), { recursive: true });
        writeFileSync(values.out, JSON.stringify(report, null, 2), "utf8");
        console.log(`Wrote ${values.out}`);
      }
      return;
    }

    const paramsFile = values.params;
    if (!paramsFile) throw new Error("--mode measure requires --params <version-file>");
    const seasons = parseSeasons(values.seasons ?? "2022,2023,2024,2025,2026");
    console.log(`Replaying ${paramsFile} over ${seasons.join(", ")} (one continuous run, carrySeason threaded)`);
    const report = replaySeasons(db, seasons, paramsFile, resamples);
    console.log("");
    console.log(`version: ${report.version}`);
    for (const m of report.perSeason) console.log(formatMetrics(m));
    console.log(formatMetrics(report.pooled));
    if (values.out) {
      mkdirSync(dirname(values.out), { recursive: true });
      writeFileSync(values.out, JSON.stringify(report, null, 2), "utf8");
      console.log(`Wrote ${values.out}`);
    }
  } finally {
    db.close();
  }
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("reparamEquivalence failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
