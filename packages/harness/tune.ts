/**
 * ALGO-04's offline hyperparameter search entry point.
 *
 * Standalone runnable script (`pnpm tune --stage <tracer|screen|joint> ...`),
 * following `identifiability.ts`'s own shape: `parseArgs`, `async function
 * main()`, an entry-point guard so importing this module never has the side
 * effect of running a real corpus replay.
 *
 * Three stages:
 *   - `tracer` (plan 03-01): the original one-knob, three-candidate proof
 *     that the pipeline works end to end. Unchanged by this plan.
 *   - `screen` (plan 03-05 Task 1, D-03a): a one-at-a-time sensitivity
 *     sweep over every `searchSpace.ts`-registered hyperparameter, every
 *     other parameter held at its default, answering "which knobs are
 *     actually live" — published as `docs/models/sigma1-sensitivity-screen.md`.
 *   - `joint` (plan 03-05 Task 2, D-01/D-06): a seeded random + coordinate-
 *     descent search over the screen's survivors only, minimizing
 *     tune-season Brier, run twice (once per `--adaptation on|off`) at
 *     IDENTICAL budgets for D-06's best-vs-best comparison.
 *
 * Holdout blindness is STRUCTURAL, not conventional (Claude's Discretion,
 * recommended by CONTEXT.md), enforced by THREE independent gates, because
 * one gate is a convention (T-03-07):
 *   1. every requested season checked against `HOLDOUT_SEASONS` BEFORE any
 *      corpus read;
 *   2. every requested season independently re-checked via `seasonSplit`
 *      (a separate code path from gate 1, so a bug in one cannot silently
 *      disable the other);
 *   3. every produced `ScoreSlice` checked for `seasonLabel !== "tune"` /
 *      `headlineEligible !== false` AFTER scoring.
 * The optimizer must be UNABLE to read 2025/2026, not merely expected not
 * to.
 *
 * `--events <N>` bounds the replay to the first N event keys of a season
 * (`ORDER BY event_key ASC`) for a fast, deterministic verification run.
 * `buildSeasonStream`/`WalkForwardSimulator` (from `replay.ts`) remain the
 * ONLY replay implementation this script drives through — bounding events
 * is a post-hoc filter of `buildSeasonStream`'s own chronologically-ordered
 * output, never a second predict/update loop, so every optimizer evaluation
 * still inherits `toLeakProofUpcoming`'s leak-proof guarantee. This
 * script's season loop (with `carrySeason` threading across boundaries)
 * intentionally mirrors `cli.ts`'s exported `runSeasons`, because that
 * function has no event-bounding parameter to plug into — the mirroring is
 * scoped to orchestration (which season, which carried state), not to
 * re-deriving chronological ordering or the predict-before-update
 * discipline, both of which stay owned by `replay.ts`.
 *
 * Every candidate this script builds (screen and joint alike) fixes
 * `rpMonteCarloDraws: 0` — plan 03-03's `distribution.test.ts` proves this
 * never moves `pRedWin`/predicted scores, and `rp/distribution.ts`'s own
 * zero-draws short-circuit skips the RP joint model's Cholesky
 * decomposition entirely, which is what keeps a tune-season replay at the
 * ~1ms/match cost this plan's runtime guidance assumes rather than paying
 * for a Monte Carlo draw the objective never reads.
 */
import { dirname, join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import type { AlgorithmModule, MatchResult, SeasonBoundary } from "../core/algorithms/types.js";
import { COLD_START_SEASON } from "../core/algorithms/breakdown/index.js";
import { makeSigma1 } from "../core/algorithms/sigma1/index.js";
import { DEFAULT_SIGMA1_PARAMS, Sigma1ParamsSchema, type Sigma1Params } from "../core/algorithms/sigma1/params.js";
import { openCorpusReadOnly, type Corpus } from "../corpus/db.js";
import { buildSeasonStream, WalkForwardSimulator } from "./replay.js";
import { aggregateScores, HOLDOUT_SEASONS, seasonSplit, TUNE_SEASONS, type HarnessPredictionInput, type ScoreSlice } from "./score.js";
import {
  SEARCHABLE_PARAM_KEYS,
  SEARCH_EXCLUSIONS,
  SIGMA1_SEARCH_SPACE,
  isValidParamSet,
  screenGridFor,
  type SearchableParamKey,
} from "./searchSpace.js";

const CORPUS_PATH = "data/corpus.sqlite";

// ─────────────────────────────────────────────────────────────────────────
// Shared plumbing (all three stages)
// ─────────────────────────────────────────────────────────────────────────

function parseSeasonsList(spec: string): number[] {
  const seasons = spec
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const year = Number.parseInt(s, 10);
      if (!Number.isInteger(year) || String(year).length !== 4) {
        throw new Error(`--seasons must be a comma-separated list of 4-digit years, got "${s}" (in "${spec}")`);
      }
      return year;
    });
  if (seasons.length === 0) {
    throw new Error(`--seasons must name at least one season, got "${spec}"`);
  }
  return seasons;
}

function parseEventsLimit(spec: string): number {
  const n = Number.parseInt(spec, 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`--events must be a positive integer, got "${spec}"`);
  }
  return n;
}

function parsePositiveInt(name: string, spec: string): number {
  const n = Number.parseInt(spec, 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer, got "${spec}"`);
  }
  return n;
}

/**
 * Structural holdout blindness, gates 1+2 — checked BEFORE any corpus read.
 * Two INDEPENDENT code paths (T-03-07: "one gate is a convention") so a bug
 * in either cannot silently disable the other.
 */
function assertSeasonsAreTuneOnly(seasons: readonly number[]): void {
  for (const season of seasons) {
    if ((HOLDOUT_SEASONS as readonly number[]).includes(season)) {
      throw new Error(
        `tune: season ${season} is a HOLDOUT season (${HOLDOUT_SEASONS.join(", ")}) — the optimizer must never read holdout data. Structural blindness, not a convention.`
      );
    }
  }
  for (const season of seasons) {
    let label: "tune" | "holdout";
    try {
      label = seasonSplit(season);
    } catch (err) {
      throw new Error(`tune: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (label !== "tune") {
      throw new Error(
        `tune: season ${season} is labelled "${label}" by seasonSplit, not "tune" — the optimizer must never read non-tune data.`
      );
    }
  }
}

/** Structural holdout blindness, gate 3 — checked AFTER scoring, on every produced slice. Exported so `tune.test.ts` can assert a holdout-labelled slice makes this guard throw, without spinning up a real corpus replay. */
export function assertNoHoldoutLeak(slices: readonly ScoreSlice[]): void {
  for (const slice of slices) {
    if (slice.seasonLabel !== "tune" || slice.headlineEligible !== false) {
      throw new Error(
        `tune: produced a non-tune / headline-eligible score slice (season ${slice.season}, algorithm ${slice.algorithmId}, seasonLabel ${slice.seasonLabel}) — this must be structurally impossible.`
      );
    }
  }
}

/**
 * `buildSeasonStream`'s full, correctly-interleaved chronological output,
 * filtered down to matches whose event is among the first `eventsLimit`
 * event keys (`ORDER BY event_key ASC`) — never a re-derivation of
 * chronological order, only a post-hoc subset filter that preserves it.
 */
function boundedSeasonStream(db: Corpus, season: number, eventsLimit: number | undefined): MatchResult[] {
  const fullStream = buildSeasonStream(db, season, { includeOffseason: false });
  if (eventsLimit === undefined) return fullStream;

  const eventRows = db
    .prepare(`SELECT event_key FROM events WHERE year = ? AND is_offseason = 0 ORDER BY event_key ASC LIMIT ?`)
    .all(season, eventsLimit) as { event_key: string }[];
  const allowedEvents = new Set(eventRows.map((row) => row.event_key));
  return fullStream.filter((match) => allowedEvents.has(match.eventKey));
}

/**
 * Mirrors `cli.ts`'s exported `runSeasons` season loop (D-16/D-19
 * `carrySeason` threading across boundaries) but sources each season's
 * stream from `boundedSeasonStream` above instead of the unbounded
 * `buildSeasonStream` directly — the one piece `runSeasons` cannot do (it
 * has no event-count parameter). Every match replayed still goes through
 * `WalkForwardSimulator`/`toLeakProofUpcoming`, exactly as `runSeasons`
 * itself does internally.
 */
async function runBoundedSeasons(
  db: Corpus,
  seasons: readonly number[],
  algorithms: readonly AlgorithmModule<any>[],
  eventsLimit: number | undefined
): Promise<HarnessPredictionInput[]> {
  const all: HarnessPredictionInput[] = [];
  let liveStates = new Map<string, unknown>();

  for (const season of seasons) {
    const boundary: SeasonBoundary = {
      fromSeason: season - 1,
      toSeason: season,
      isColdStart: season === COLD_START_SEASON,
    };

    let initialStates: ReadonlyMap<string, unknown> | undefined;
    if (!boundary.isColdStart) {
      const carried = new Map<string, unknown>();
      for (const algorithm of algorithms) {
        const priorState = liveStates.get(algorithm.id);
        if (algorithm.carrySeason && priorState !== undefined) {
          carried.set(algorithm.id, algorithm.carrySeason(priorState, boundary));
        }
      }
      initialStates = carried;
    }

    const stream = boundedSeasonStream(db, season, eventsLimit);
    const teams = Array.from(new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
    const simulator = new WalkForwardSimulator(stream);
    const records = simulator.runAll(algorithms, teams, initialStates);

    console.log(
      `Season ${season}: ${stream.length} matches replayed` +
        (eventsLimit !== undefined ? ` (bounded to first ${eventsLimit} events)` : "") +
        ` across ${algorithms.length} candidates`
    );

    const predictions: HarnessPredictionInput[] = records.map((r) => ({
      matchKey: r.match.matchKey,
      season,
      // D-T6 (quick task 260901-trz): carried for downstream event-blocked
      // resampling — see `HarnessPredictionInput.eventKey`'s own doc comment.
      eventKey: r.match.eventKey,
      compLevel: r.match.compLevel,
      algorithmId: r.algorithmId,
      pRedWin: r.prediction.pRedWin,
      predictedRedScore: r.prediction.redScore,
      predictedBlueScore: r.prediction.blueScore,
      actualWinner: r.match.winner,
      // boundedSeasonStream/buildSeasonStream already excludes offseason
      // events (D-06 default) — every replayed match here is non-offseason.
      isOffseason: false,
      isSurrogateAffected: r.match.redSurrogates.length > 0 || r.match.blueSurrogates.length > 0,
    }));

    // Rule 1 (bug) fix, discovered running this plan's own real full-season
    // screen: `all.push(...predictions)` blows V8's call-stack argument
    // limit once `predictions.length` (matches x candidates in this batch)
    // reaches the tens of thousands -- a 14,677-match season x an 8-candidate
    // batch is 117,416 elements, well past it. A plain loop has no such
    // limit; cli.ts's own `runSeasons` carries the identical pattern but at
    // a smaller per-run scale (fewer simultaneous algorithms) that has not
    // yet tripped it — out of this plan's file scope, logged separately.
    for (const prediction of predictions) all.push(prediction);
    liveStates = new Map(records.finalStates);
  }

  return all;
}

interface PerSeasonScore {
  readonly season: number;
  readonly brierScore: number | null;
  readonly winnerAccuracy: number | null;
}

interface EvaluatedCandidate {
  readonly id: string;
  readonly params: Sigma1Params;
  readonly perSeason: readonly PerSeasonScore[];
  /** D-01: mean tune-season brierScore (combined compLevelView), minimized. Winner accuracy is recorded above but NEVER read here. */
  readonly objective: number;
}

/**
 * D-01's objective, extracted from `aggregateScores`' output for ONE
 * candidate id: mean `brierScore` across the requested tune seasons for the
 * `"combined"` `compLevelView`. Shared by every stage so the objective
 * definition cannot drift between the tracer, the screen, and the joint
 * search.
 */
export function objectiveForCandidate(slices: readonly ScoreSlice[], candidateId: string): { perSeason: PerSeasonScore[]; objective: number } {
  const combinedSlices = slices
    .filter((s) => s.algorithmId === candidateId && s.compLevelView === "combined")
    .sort((a, b) => a.season - b.season);
  const perSeason = combinedSlices.map((s) => ({ season: s.season, brierScore: s.brierScore, winnerAccuracy: s.winnerAccuracy }));
  const brierValues = perSeason.map((p) => p.brierScore).filter((v): v is number => v !== null);
  const objective = brierValues.length > 0 ? brierValues.reduce((sum, v) => sum + v, 0) / brierValues.length : Number.POSITIVE_INFINITY;
  return { perSeason, objective };
}

/**
 * Evaluates one BATCH of candidates through a single shared-stream replay
 * (`runBoundedSeasons`'s own `runAll` call underneath) — one corpus read
 * and one stream build serving every candidate in `batch`, per this file's
 * batching contract. Runs gate 3 (post-scoring holdout check) once per
 * batch, immediately after scoring.
 */
async function evaluateCandidateBatch(
  db: Corpus,
  seasons: readonly number[],
  eventsLimit: number | undefined,
  batch: readonly { id: string; params: Sigma1Params }[]
): Promise<EvaluatedCandidate[]> {
  const algorithms = batch.map((c) => makeSigma1({ id: c.id, linkMode: "predictive-variance", params: c.params }));
  const predictions = await runBoundedSeasons(db, seasons, algorithms, eventsLimit);
  const slices = aggregateScores(predictions);
  assertNoHoldoutLeak(slices);
  return batch.map((c) => {
    const { perSeason, objective } = objectiveForCandidate(slices, c.id);
    return { id: c.id, params: c.params, perSeason, objective };
  });
}

/** Chunks `candidates` into `batchSize`-sized groups and evaluates each group via `evaluateCandidateBatch`, concatenating results in generation order. */
async function evaluateAll(
  db: Corpus,
  seasons: readonly number[],
  eventsLimit: number | undefined,
  candidates: readonly { id: string; params: Sigma1Params }[],
  batchSize: number
): Promise<EvaluatedCandidate[]> {
  const results: EvaluatedCandidate[] = [];
  for (let i = 0; i < candidates.length; i += batchSize) {
    const chunk = candidates.slice(i, i + batchSize);
    const evaluated = await evaluateCandidateBatch(db, seasons, eventsLimit, chunk);
    results.push(...evaluated);
  }
  return results;
}

interface TieRecord {
  readonly winnerIndex: number;
  readonly tiedIndex: number;
  readonly objective: number;
  readonly winnerParams: Sigma1Params;
  readonly tiedParams: Sigma1Params;
}

/**
 * ALGO-04's deterministic tie-break (ADJACENCY edge): candidates are
 * compared in GENERATION order; on an exact tie the earlier-generated
 * candidate wins — `winnerIndex` is only ever updated on a STRICT
 * improvement, never on equality. Every tie against the then-current
 * winner is recorded with BOTH candidates' full parameter sets, so an
 * objective that cannot separate two materially different configurations
 * is visible in the log rather than silently resolved.
 */
export function determineWinner(results: readonly EvaluatedCandidate[]): { winnerIndex: number; ties: TieRecord[] } {
  let winnerIndex = 0;
  const ties: TieRecord[] = [];
  for (let i = 1; i < results.length; i++) {
    const current = results[i]!;
    const winner = results[winnerIndex]!;
    if (current.objective < winner.objective) {
      winnerIndex = i;
    } else if (current.objective === winner.objective) {
      ties.push({ winnerIndex, tiedIndex: i, objective: current.objective, winnerParams: winner.params, tiedParams: current.params });
    }
  }
  return { winnerIndex, ties };
}

// ─────────────────────────────────────────────────────────────────────────
// Stage: tracer (plan 03-01, unchanged)
// ─────────────────────────────────────────────────────────────────────────

/**
 * The tracer's ONE searched knob (this stage's whole point): the default is
 * inside the swept set, so a search that cannot beat today's default says so
 * honestly rather than being unable to compare.
 *
 * D-T1 (`SIGMA1_CODE_VERSION` 4.0.0): the knob is now DIMENSIONLESS, so the
 * swept set is expressed as MULTIPLIERS of the default (`0.5x / 1x / 2x`)
 * rather than as the absolute `[4, 8, 16]` points^2 it used to be. Written
 * as multipliers rather than as three re-typed relative literals for the
 * reason `params.ts`'s header gives about derived defaults: the middle entry
 * IS the default by construction, so it cannot drift out of the set when the
 * default moves.
 */
const TRACER_EVENT_BOUNDARY_MULTIPLIERS = [0.5, 1, 2] as const;

function buildTracerCandidates(): { id: string; params: Sigma1Params }[] {
  return TRACER_EVENT_BOUNDARY_MULTIPLIERS.map((multiplier, index) => ({
    id: `sigma1-cand-${index}`,
    params: {
      ...DEFAULT_SIGMA1_PARAMS,
      processNoiseEventBoundaryRel: DEFAULT_SIGMA1_PARAMS.processNoiseEventBoundaryRel * multiplier,
    },
  }));
}

async function runTracerStage(seasonsSpec: string, eventsLimit: number | undefined, outPath: string): Promise<void> {
  const seasons = parseSeasonsList(seasonsSpec);
  assertSeasonsAreTuneOnly(seasons);

  const candidates = buildTracerCandidates();
  const db = openCorpusReadOnly(CORPUS_PATH);
  let results: EvaluatedCandidate[];
  try {
    results = await evaluateAll(db, seasons, eventsLimit, candidates, candidates.length);
  } finally {
    db.close();
  }

  const { winnerIndex, ties } = determineWinner(results);
  for (const result of results) {
    console.log(
      `Candidate ${results.indexOf(result)} (${result.id}): objective=${result.objective.toFixed(6)}${
        results.indexOf(result) === winnerIndex ? " <- winner" : ""
      }`
    );
  }

  const output = {
    generatedAt: new Date().toISOString(),
    stage: "tracer",
    seasons,
    eventsLimit: eventsLimit ?? null,
    corpusIdentity: CORPUS_PATH,
    objective: "mean tune-season brierScore (combined compLevelView), minimized (D-01)",
    tieBreak: ties.length > 0 ? "objective tied across multiple candidates — lowest candidate index wins" : null,
    winnerIndex,
    candidates: results.map((result, index) => ({ index, ...result, winner: index === winnerIndex })),
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");
  console.log(`Wrote ${outPath}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Stage: screen (plan 03-05 Task 1, D-03a)
// ─────────────────────────────────────────────────────────────────────────

/**
 * A parameter "survives" the screen when its one-at-a-time sweep moves the
 * tune-season objective by more than this — declared and justified in
 * prose, matching `identifiability.ts`'s own threshold-justification
 * convention (never a bare literal at the comparison site).
 *
 * 1e-4 is roughly 0.06% of Phase 2's measured ~0.17 combined-view tune Brier
 * (`03-CONTEXT.md`'s own starting-position table) — small enough to keep
 * anything that plausibly reflects a real effect, large enough to exclude
 * pure replay/floating-point noise. This is a STARTING POINT, stated as
 * such in the published document rather than presented as a
 * once-and-for-all calibrated constant.
 */
export const SCREEN_SURVIVAL_THRESHOLD = 1e-4;

interface ScreenParameterResult {
  readonly bound: { min: number; max: number; scale: "linear" | "log" };
  readonly defaultValue: number;
  readonly sweptValues: readonly number[];
  readonly results: readonly { value: number; brierScore: number; winnerAccuracy: number | null }[];
  readonly bestValue: number;
  readonly bestBrierScore: number;
  readonly brierRange: number;
  readonly atBound: boolean;
  readonly survives: boolean;
}

/** One evaluated grid point of one parameter's one-at-a-time sweep — the row shape `selectBestScreenRow` below picks from, exported so `tune.test.ts` can build fixtures directly without duplicating this shape inline. */
export interface ScreenRow {
  readonly value: number;
  readonly brierScore: number;
  readonly winnerAccuracy: number | null;
}

/**
 * D-10 / 03-REVIEW WR-02: selects the lowest-Brier row for one parameter's
 * one-at-a-time sweep — moved out of `runScreenStage`'s aggregation loop
 * verbatim (selection behaviour is unchanged) so this policy can be
 * unit-tested without a corpus. Throws, rather than returning `undefined` or
 * silently reading index 0 of a possibly-empty array (`rows[0]!`, the
 * non-null assertion that only silenced the type checker before this fix),
 * when `rows` is empty: every candidate value for this parameter was
 * rejected by the cross-parameter validity check
 * (`isValidParamSet`/`Sigma1ParamsSchema`, D-11), which means the search
 * space is misconfigured for this key, not merely that the parameter has no
 * effect.
 *
 * D-10's policy (Claude's Discretion, recorded in
 * `03.1-CONTEXT.md`): ABORT the whole screen rather than skip this
 * parameter and mark it "unscreenable" — the rejected alternative, because
 * a fully-rejected grid silently publishing a screen artifact
 * (`docs/models/sigma1-sensitivity-screen.md`) with a hole in it would be
 * indistinguishable from a parameter that genuinely has no effect, which is
 * a worse failure than stopping the run.
 */
export function selectBestScreenRow(key: SearchableParamKey, rows: readonly ScreenRow[]): ScreenRow {
  if (rows.length === 0) {
    throw new Error(
      `tune: every candidate value for parameter "${key}" was rejected by the cross-parameter validity check (isValidParamSet/Sigma1ParamsSchema) — "${key}" cannot be screened. Check "${key}"'s bound in SIGMA1_SEARCH_SPACE (packages/harness/searchSpace.ts) against the other parameters' defaults.`
    );
  }
  let bestRow = rows[0]!;
  for (const row of rows) {
    if (row.brierScore < bestRow.brierScore) bestRow = row;
  }
  return bestRow;
}

async function runScreenStage(
  seasonsSpec: string,
  eventsLimit: number | undefined,
  valueCount: number,
  batchSize: number,
  outPath: string
): Promise<void> {
  const seasons = parseSeasonsList(seasonsSpec);
  assertSeasonsAreTuneOnly(seasons);

  interface ScreenCandidate {
    readonly id: string;
    readonly param: SearchableParamKey;
    readonly value: number;
    readonly params: Sigma1Params;
  }

  const candidates: ScreenCandidate[] = [];
  let rejectedCandidates = 0;
  let seq = 0;
  for (const key of SEARCHABLE_PARAM_KEYS) {
    const values = screenGridFor(key, valueCount);
    for (const value of values) {
      const candidateParams: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, [key]: value, rpMonteCarloDraws: 0 };
      // D-11 / 03-REVIEW WR-01: `isValidParamSet` stays the cheap boolean
      // pre-filter so a rejected grid point is counted rather than throwing
      // mid-sweep; the surviving value is then parsed through
      // `Sigma1ParamsSchema` (the two must agree) before it reaches the
      // candidate list — a bare `as Sigma1Params` cast would bypass that.
      if (!isValidParamSet(candidateParams)) {
        rejectedCandidates++;
        continue;
      }
      const params = Sigma1ParamsSchema.parse(candidateParams);
      candidates.push({ id: `screen-${seq}`, param: key, value, params });
      seq++;
    }
  }

  const db = openCorpusReadOnly(CORPUS_PATH);
  let evaluated: EvaluatedCandidate[];
  try {
    evaluated = await evaluateAll(db, seasons, eventsLimit, candidates, batchSize);
  } finally {
    db.close();
  }
  const evaluatedById = new Map(evaluated.map((e) => [e.id, e]));

  const parameters: Record<string, ScreenParameterResult> = {};
  const survivors: SearchableParamKey[] = [];

  for (const key of SEARCHABLE_PARAM_KEYS) {
    const bound = SIGMA1_SEARCH_SPACE[key];
    const paramCandidates = candidates.filter((c) => c.param === key);
    const rows = paramCandidates.map((c) => {
      const evaluatedCandidate = evaluatedById.get(c.id)!;
      return { value: c.value, brierScore: evaluatedCandidate.objective, winnerAccuracy: evaluatedCandidate.perSeason[0]?.winnerAccuracy ?? null };
    });

    const bestRow = selectBestScreenRow(key, rows);
    const brierValues = rows.map((r) => r.brierScore);
    const brierRange = Math.max(...brierValues) - Math.min(...brierValues);
    const atBound = bestRow.value === bound.min || bestRow.value === bound.max;
    const survives = brierRange > SCREEN_SURVIVAL_THRESHOLD;
    if (survives) survivors.push(key);

    parameters[key] = {
      bound,
      defaultValue: DEFAULT_SIGMA1_PARAMS[key] as number,
      sweptValues: rows.map((r) => r.value),
      results: rows,
      bestValue: bestRow.value,
      bestBrierScore: bestRow.brierScore,
      brierRange,
      atBound,
      survives,
    };

    console.log(
      `${key}: swept ${rows.length} values, best=${bestRow.value} brier=${bestRow.brierScore.toFixed(6)} ` +
        `range=${brierRange.toExponential(3)} ${survives ? "SURVIVES" : "does not survive"}${atBound ? " (AT BOUND)" : ""}`
    );
  }

  const output = {
    generatedAt: new Date().toISOString(),
    stage: "screen",
    seasons,
    eventsLimit: eventsLimit ?? null,
    corpusIdentity: CORPUS_PATH,
    valuesPerParameter: valueCount,
    objective: "mean tune-season brierScore (combined compLevelView), minimized (D-01)",
    survivalThreshold: SCREEN_SURVIVAL_THRESHOLD,
    survivalThresholdRationale:
      "roughly 0.06% of Phase 2's measured ~0.17 combined-view tune Brier -- small enough to keep a plausibly real effect, large enough to exclude pure replay noise (see SCREEN_SURVIVAL_THRESHOLD's own doc comment in tune.ts)",
    rejectedCandidates,
    parameters,
    survivors,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");
  console.log(`Wrote ${outPath} — ${survivors.length}/${SEARCHABLE_PARAM_KEYS.length} parameters survive`);
}

// ─────────────────────────────────────────────────────────────────────────
// Stage: joint (plan 03-05 Task 2, D-01/D-06/D-14)
// ─────────────────────────────────────────────────────────────────────────

/** Deterministic PRNG (Mulberry32), same construction as `identifiability.ts`'s/`rp/distribution.ts`'s own `mulberry32` (cited there to the same source) — same seed always produces the same candidate sequence. */
function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let t2 = Math.imul(t ^ (t >>> 15), t | 1);
    t2 ^= t2 + Math.imul(t2 ^ (t2 >>> 7), t2 | 61);
    return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform sampling on a bound's own declared scale — uniform in LOG space for `"log"`-scaled parameters (Task 2's own instruction), so the search does not spend most of its budget in the top decade of a wide multiplicative range. */
function sampleOnScale(bound: { min: number; max: number; scale: "linear" | "log" }, rng: () => number): number {
  const u = rng();
  return bound.scale === "log" ? bound.min * Math.pow(bound.max / bound.min, u) : bound.min + u * (bound.max - bound.min);
}

const MAX_RESAMPLE_ATTEMPTS = 1000;

/** Builds one randomly-sampled candidate over `survivors`, rejecting and resampling invalid draws (T-03-06/D-04's cross-parameter constraints); every non-survivor stays at its exact default. */
function buildRandomCandidate(
  survivors: readonly SearchableParamKey[],
  rng: () => number,
  adaptationEnabled: boolean
): { params: Sigma1Params; rejected: number } {
  let rejected = 0;
  for (let attempt = 0; attempt < MAX_RESAMPLE_ATTEMPTS; attempt++) {
    const overrides: Partial<Sigma1Params> = {};
    for (const key of survivors) {
      (overrides as Record<string, number>)[key] = sampleOnScale(SIGMA1_SEARCH_SPACE[key], rng);
    }
    const params: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, ...overrides, adaptationEnabled, rpMonteCarloDraws: 0 };
    if (isValidParamSet(params)) return { params, rejected };
    rejected++;
  }
  throw new Error(`tune: could not sample a valid candidate over survivors [${survivors.join(", ")}] after ${MAX_RESAMPLE_ATTEMPTS} attempts`);
}

/** A moderate, documented local step for the coordinate-descent refinement pass — a quarter of the bound's own full multiplicative (log) or additive (linear) span, clamped back into `[min, max]`. Not itself a modeling hyperparameter, so it is never searched. */
function neighborValues(bound: { min: number; max: number; scale: "linear" | "log" }, current: number): number[] {
  const clamp = (v: number) => Math.min(bound.max, Math.max(bound.min, v));
  if (bound.scale === "log") {
    const factor = Math.pow(bound.max / bound.min, 0.25);
    return [clamp(current / factor), clamp(current * factor)];
  }
  const step = (bound.max - bound.min) * 0.1;
  return [clamp(current - step), clamp(current + step)];
}

interface LosoFold {
  readonly heldOutSeason: number;
  readonly trainingSeasons: readonly number[];
  readonly losoWinnerIndex: number;
  readonly losoWinnerHeldOutBrier: number | null;
  readonly losoWinnerHeldOutAccuracy: number | null;
  readonly matchesPooledWinner: boolean;
}

/**
 * The overfitting guard (Claude's Discretion, resolved: leave-one-season-out
 * over the tune seasons). Costs NO new replays — every candidate's
 * per-season score is already in hand from the pooled evaluation above; LOSO
 * only re-slices that already-computed data. Requires exactly the three
 * TUNE_SEASONS to be meaningful; any other `--seasons` request records an
 * explicit skip rather than fabricating folds over a season set that was
 * never asked to support them. Never touches 2025/2026 — LOSO happens
 * entirely inside 2022-2024.
 */
function computeLoso(
  seasons: readonly number[],
  results: readonly EvaluatedCandidate[],
  pooledWinnerIndex: number
): { skipped: string } | { folds: LosoFold[]; pooledWinnerPerSeasonBrierSpread: number | null } {
  const tuneSeasonsSorted: number[] = [...TUNE_SEASONS].sort((a, b) => a - b);
  const requestedSorted = [...seasons].sort((a, b) => a - b);
  if (requestedSorted.length !== tuneSeasonsSorted.length || requestedSorted.some((s, i) => s !== tuneSeasonsSorted[i])) {
    return {
      skipped: `LOSO requires exactly the three tune seasons (${tuneSeasonsSorted.join(", ")}); this run used [${seasons.join(", ")}]`,
    };
  }

  const folds: LosoFold[] = tuneSeasonsSorted.map((heldOutSeason) => {
    const trainingSeasons = tuneSeasonsSorted.filter((s) => s !== heldOutSeason);
    const foldObjectives = results.map((r) => {
      const values = r.perSeason
        .filter((p) => trainingSeasons.includes(p.season))
        .map((p) => p.brierScore)
        .filter((v): v is number => v !== null);
      return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : Number.POSITIVE_INFINITY;
    });
    let losoWinnerIndex = 0;
    for (let i = 1; i < foldObjectives.length; i++) {
      if (foldObjectives[i]! < foldObjectives[losoWinnerIndex]!) losoWinnerIndex = i;
    }
    const heldOutEntry = results[losoWinnerIndex]!.perSeason.find((p) => p.season === heldOutSeason) ?? null;
    return {
      heldOutSeason,
      trainingSeasons,
      losoWinnerIndex,
      losoWinnerHeldOutBrier: heldOutEntry?.brierScore ?? null,
      losoWinnerHeldOutAccuracy: heldOutEntry?.winnerAccuracy ?? null,
      matchesPooledWinner: losoWinnerIndex === pooledWinnerIndex,
    };
  });

  const pooledWinnerBriers = results[pooledWinnerIndex]!.perSeason.map((p) => p.brierScore).filter((v): v is number => v !== null);
  const pooledWinnerPerSeasonBrierSpread = pooledWinnerBriers.length > 0 ? Math.max(...pooledWinnerBriers) - Math.min(...pooledWinnerBriers) : null;

  return { folds, pooledWinnerPerSeasonBrierSpread };
}

export type JointPlanMode = "empty" | "singleton" | "random";

export interface JointPlan {
  readonly mode: JointPlanMode;
  /** Non-null only for `mode === "empty"` (ALGO-04's empty edge). */
  readonly skipped: string | null;
  readonly candidates: readonly { id: string; params: Sigma1Params }[];
  /** Rejected-and-resampled invalid draws during candidate GENERATION (before any evaluation) — always 0 outside `mode === "random"`. */
  readonly rejectedCandidates: number;
}

/**
 * The joint search's candidate-GENERATION logic, entirely pure (no corpus,
 * no I/O) — exported so `tune.test.ts` can exercise the empty/singleton/
 * random branching and the random phase's reproducibility/validity
 * guarantees directly, without a real replay. Handles ALGO-04's empty and
 * singleton survivor edges (Task 2's own required behaviour):
 *
 *   - 0 survivors: skip the search, the defaults ARE the winner (`mode:
 *     "empty"`, one candidate, `skipped` set).
 *   - 1 survivor: a one-dimensional sweep (`mode: "singleton"`) rather than
 *     a degenerate random search over a single axis — reuses
 *     `screenGridFor`, which already always includes the default among its
 *     points.
 *   - 2+ survivors: `mode: "random"` — candidate 0 is always the exact
 *     default parameter set (so the search can never report a "winner"
 *     that never beat doing nothing), followed by `evalsCount - 1`
 *     seeded-random draws, each rejected and resampled against
 *     `isValidParamSet` until valid.
 */
export function planJointCandidates(
  survivors: readonly SearchableParamKey[],
  evalsCount: number,
  seed: number,
  adaptationEnabled: boolean
): JointPlan {
  const defaultCandidateParams: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, adaptationEnabled, rpMonteCarloDraws: 0 };

  if (survivors.length === 0) {
    return {
      mode: "empty",
      skipped: "no survivors",
      candidates: [{ id: "cand-0", params: defaultCandidateParams }],
      rejectedCandidates: 0,
    };
  }

  if (survivors.length === 1) {
    const key = survivors[0]!;
    const gridPoints = Math.max(3, Math.min(evalsCount, 9));
    const values = screenGridFor(key, gridPoints);
    // D-11 / 03-REVIEW WR-01: mirrors `buildRandomCandidate`'s own
    // reject-and-count discipline rather than the bare `as Sigma1Params`
    // cast this branch used before — a grid point that violates a
    // cross-parameter invariant (varying one key while every other stays at
    // its default can still violate D-07/T-03-06/D-04 near a bound) is
    // counted here instead of silently reaching the candidate list.
    const candidates: { id: string; params: Sigma1Params }[] = [];
    let rejectedCandidates = 0;
    for (const value of values) {
      const candidateParams: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, [key]: value, adaptationEnabled, rpMonteCarloDraws: 0 };
      if (!isValidParamSet(candidateParams)) {
        rejectedCandidates++;
        continue;
      }
      candidates.push({ id: `cand-${candidates.length}`, params: Sigma1ParamsSchema.parse(candidateParams) });
    }
    return { mode: "singleton", skipped: null, candidates, rejectedCandidates };
  }

  const rng = mulberry32(seed);
  const candidates: { id: string; params: Sigma1Params }[] = [{ id: "cand-0", params: defaultCandidateParams }];
  let rejectedCandidates = 0;
  for (let i = 1; i < evalsCount; i++) {
    const { params, rejected } = buildRandomCandidate(survivors, rng, adaptationEnabled);
    rejectedCandidates += rejected;
    candidates.push({ id: `cand-${i}`, params });
  }
  return { mode: "random", skipped: null, candidates, rejectedCandidates };
}

interface ScreenArtifact {
  readonly survivors: readonly string[];
}

/**
 * Reads a screen artifact's `survivors` list and validates every name against
 * the CURRENT searchable set. Exported so `tune.test.ts` can exercise both
 * rejection paths without running a search.
 *
 * D-T3: an EXCLUDED key and an UNKNOWN key are two different failures and get
 * two different messages. A survivors artifact written before an exclusion
 * landed names a key that was searchable at the time and is not now — that
 * artifact is stale, not corrupt, and the message quotes
 * `SEARCH_EXCLUSIONS`' recorded reason so the operator can see WHY the key
 * left the space rather than only that it is gone. A key that was never a
 * parameter at all is a different problem (a typo, or an artifact from a
 * different project) and keeps the pre-existing message.
 */
export function loadSurvivors(path: string): SearchableParamKey[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as ScreenArtifact;
  const searchableSet = new Set<string>(SEARCHABLE_PARAM_KEYS);
  const survivors: SearchableParamKey[] = [];
  for (const key of raw.survivors) {
    const exclusionReason = (SEARCH_EXCLUSIONS as Partial<Record<string, string>>)[key];
    if (exclusionReason !== undefined) {
      throw new Error(
        `tune: survivors file ${path} names "${key}", which is deliberately EXCLUDED from the search space (D-T3, SEARCH_EXCLUSIONS in packages/harness/searchSpace.ts). This artifact predates that exclusion and must be regenerated by re-running --stage screen. Its recorded reason: ${exclusionReason}`
      );
    }
    if (!searchableSet.has(key)) {
      throw new Error(`tune: survivors file ${path} names "${key}", which is not a SEARCHABLE_PARAM_KEYS member`);
    }
    survivors.push(key as SearchableParamKey);
  }
  return survivors;
}

async function runJointStage(
  seasonsSpec: string,
  eventsLimit: number | undefined,
  evalsCount: number,
  seed: number,
  batchSize: number,
  survivorsPath: string,
  adaptationSpec: string,
  outPath: string
): Promise<void> {
  const seasons = parseSeasonsList(seasonsSpec);
  assertSeasonsAreTuneOnly(seasons);

  if (adaptationSpec !== "on" && adaptationSpec !== "off") {
    throw new Error(`--adaptation must be "on" or "off", got "${adaptationSpec}"`);
  }
  const adaptationEnabled = adaptationSpec === "on";

  const survivors = loadSurvivors(survivorsPath);

  const plan = planJointCandidates(survivors, evalsCount, seed, adaptationEnabled);
  let rejectedCandidates = plan.rejectedCandidates;
  const skipped = plan.skipped;

  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    let results: EvaluatedCandidate[] = await evaluateAll(
      db,
      seasons,
      eventsLimit,
      plan.candidates,
      plan.mode === "empty" ? 1 : batchSize
    );

    if (plan.mode === "random") {
      // Coordinate-descent refinement pass (extra, beyond `evalsCount`):
      // one axis at a time, in survivor order, moving to a neighbor only on
      // a STRICT improvement -- see `neighborValues`'s own doc comment for
      // the step formula.
      const { winnerIndex: randomPhaseWinnerIndex } = determineWinner(results);
      let anchor = results[randomPhaseWinnerIndex]!;
      let nextIndex = results.length;

      for (const key of survivors) {
        const bound = SIGMA1_SEARCH_SPACE[key];
        const currentValue = (anchor.params as unknown as Record<string, number>)[key]!;
        // 03-REVIEW IN-02: computed once — `rejectedCandidates` sizes against
        // this same array rather than re-deriving it.
        const distinctNeighbors = neighborValues(bound, currentValue).filter((v) => v !== currentValue);
        const neighborCandidates = distinctNeighbors
          .map((value) => ({ id: `refine-${nextIndex++}`, params: { ...anchor.params, [key]: value } as Sigma1Params }))
          .filter((c) => isValidParamSet(c.params));
        rejectedCandidates += distinctNeighbors.length - neighborCandidates.length;
        if (neighborCandidates.length === 0) continue;

        const evaluatedNeighbors = await evaluateCandidateBatch(db, seasons, eventsLimit, neighborCandidates);
        results.push(...evaluatedNeighbors);

        for (const candidate of evaluatedNeighbors) {
          if (candidate.objective < anchor.objective) anchor = candidate;
        }
      }
    }

    const { winnerIndex, ties } = determineWinner(results);
    const winner = results[winnerIndex]!;

    const atBound: Record<string, boolean> = {};
    for (const key of survivors) {
      const bound = SIGMA1_SEARCH_SPACE[key];
      const value = (winner.params as unknown as Record<string, number>)[key]!;
      atBound[key] = value === bound.min || value === bound.max;
    }

    const loso = computeLoso(seasons, results, winnerIndex);

    for (const result of results) {
      const index = results.indexOf(result);
      console.log(`Candidate ${index} (${result.id}): objective=${result.objective.toFixed(6)}${index === winnerIndex ? " <- winner" : ""}`);
    }

    const output = {
      generatedAt: new Date().toISOString(),
      stage: "joint",
      adaptation: adaptationSpec,
      seasons,
      eventsLimit: eventsLimit ?? null,
      corpusIdentity: CORPUS_PATH,
      objective: "mean tune-season brierScore (combined compLevelView), minimized (D-01)",
      evals: evalsCount,
      seed,
      batch: batchSize,
      survivorsPath,
      survivors,
      skipped,
      rejectedCandidates,
      tieBreak: ties.length > 0 ? "objective tied across multiple candidates — lowest candidate index wins" : null,
      ties,
      winnerIndex,
      atBound,
      loso,
      candidates: results.map((result, index) => ({ index, ...result, winner: index === winnerIndex })),
    };

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");
    console.log(`Wrote ${outPath}`);
  } finally {
    db.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      seasons: { type: "string" },
      events: { type: "string" },
      stage: { type: "string" },
      out: { type: "string" },
      values: { type: "string" },
      batch: { type: "string" },
      evals: { type: "string" },
      seed: { type: "string" },
      survivors: { type: "string" },
      adaptation: { type: "string" },
    },
  });

  const stage = values.stage ?? "tracer";
  const eventsLimit = values.events !== undefined ? parseEventsLimit(values.events) : undefined;

  if (stage === "tracer") {
    const seasonsSpec = values.seasons ?? "2022";
    const outPath = values.out ?? join("reports", "tune-tracer.json");
    await runTracerStage(seasonsSpec, eventsLimit, outPath);
  } else if (stage === "screen") {
    const seasonsSpec = values.seasons ?? "2022,2023";
    const valueCount = values.values !== undefined ? parsePositiveInt("--values", values.values) : 5;
    const batchSize = values.batch !== undefined ? parsePositiveInt("--batch", values.batch) : 8;
    const outPath = values.out ?? join("reports", "sensitivity-screen.json");
    await runScreenStage(seasonsSpec, eventsLimit, valueCount, batchSize, outPath);
  } else if (stage === "joint") {
    const seasonsSpec = values.seasons ?? "2022,2023,2024";
    const evalsCount = values.evals !== undefined ? parsePositiveInt("--evals", values.evals) : 60;
    const seed = values.seed !== undefined ? parsePositiveInt("--seed", values.seed) : 42;
    const batchSize = values.batch !== undefined ? parsePositiveInt("--batch", values.batch) : 8;
    const survivorsPath = values.survivors ?? join("reports", "sensitivity-screen.json");
    const adaptationSpec = values.adaptation ?? "off";
    const outPath = values.out ?? join("reports", `tune-joint-${adaptationSpec}.json`);
    await runJointStage(seasonsSpec, eventsLimit, evalsCount, seed, batchSize, survivorsPath, adaptationSpec, outPath);
  } else {
    throw new Error(`tune: unknown --stage "${stage}" (expected "tracer", "screen", or "joint")`);
  }
}

// Guard: only auto-run `main()` when this file is the process entry point —
// importing this module (e.g. from a test) must never have the side effect
// of running a real corpus replay.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("tune failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
