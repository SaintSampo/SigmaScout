/**
 * ALGO-04's offline hyperparameter search entry point. This task (03-01
 * Task 1) wires exactly ONE live knob — `processNoiseEventBoundary` — end
 * to end through search, promotion, and reproduction before this phase's
 * later plans expand the searched surface (03-05's sensitivity screen +
 * joint search, D-03).
 *
 * Standalone runnable script (`pnpm tune --seasons 2022 --events 8`),
 * following `identifiability.ts`'s own shape: `parseArgs`, `async function
 * main()`, an entry-point guard so importing this module never has the side
 * effect of running a real corpus replay.
 *
 * Holdout blindness is STRUCTURAL, not conventional (Claude's Discretion,
 * recommended by CONTEXT.md): every requested season is checked against
 * `HOLDOUT_SEASONS` BEFORE any corpus read happens, and every produced
 * `ScoreSlice` is checked for `seasonLabel !== "tune"` /
 * `headlineEligible !== false` AFTER scoring — the optimizer must be
 * UNABLE to read 2025/2026, not merely expected not to.
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
 */
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import type { AlgorithmModule, MatchResult, SeasonBoundary } from "../core/algorithms/types.js";
import { COLD_START_SEASON } from "../core/algorithms/breakdown/index.js";
import { makeSigma1 } from "../core/algorithms/sigma1/index.js";
import { DEFAULT_SIGMA1_PARAMS, type Sigma1Params } from "../core/algorithms/sigma1/params.js";
import { openCorpusReadOnly, type Corpus } from "../corpus/db.js";
import { buildSeasonStream, WalkForwardSimulator } from "./replay.js";
import { aggregateScores, HOLDOUT_SEASONS, type HarnessPredictionInput } from "./score.js";

const CORPUS_PATH = "data/corpus.sqlite";

/**
 * The tracer's ONE searched knob (this task's whole point): the default
 * (8) is inside the swept set, so a search that cannot beat today's default
 * says so honestly rather than being unable to compare.
 */
const TRACER_EVENT_BOUNDARY_VALUES = [4, 8, 16] as const;

interface TuneCandidate {
  readonly id: string;
  readonly params: Sigma1Params;
}

function buildTracerCandidates(): TuneCandidate[] {
  return TRACER_EVENT_BOUNDARY_VALUES.map((processNoiseEventBoundary, index) => ({
    id: `sigma1-cand-${index}`,
    params: { ...DEFAULT_SIGMA1_PARAMS, processNoiseEventBoundary },
  }));
}

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
 * `buildSeasonStream` directly — the one piece `runSeasons` cannot do
 * (it has no event-count parameter). Every match replayed still goes
 * through `WalkForwardSimulator`/`toLeakProofUpcoming`, exactly as
 * `runSeasons` itself does internally.
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

    all.push(...predictions);
    liveStates = new Map(records.finalStates);
  }

  return all;
}

interface CandidateResult {
  readonly index: number;
  readonly id: string;
  readonly params: Sigma1Params;
  readonly perSeason: readonly { season: number; brierScore: number | null; winnerAccuracy: number | null }[];
  readonly objective: number;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      seasons: { type: "string" },
      events: { type: "string" },
      stage: { type: "string" },
      out: { type: "string" },
    },
  });

  const seasons = parseSeasonsList(values.seasons ?? "2022");
  const eventsLimit = values.events !== undefined ? parseEventsLimit(values.events) : undefined;
  const stage = values.stage ?? "tracer";
  const outPath = values.out ?? join("reports", `tune-${stage}.json`);

  // Structural holdout blindness, part 1: checked BEFORE any corpus read —
  // the optimizer must be unable to even request holdout data.
  for (const season of seasons) {
    if ((HOLDOUT_SEASONS as readonly number[]).includes(season)) {
      throw new Error(
        `tune: season ${season} is a HOLDOUT season (${HOLDOUT_SEASONS.join(", ")}) — the optimizer must never read holdout data. Structural blindness, not a convention.`
      );
    }
  }

  const candidates = buildTracerCandidates();
  const algorithms = candidates.map((candidate) =>
    makeSigma1({ id: candidate.id, linkMode: "predictive-variance", params: candidate.params })
  );

  const db = openCorpusReadOnly(CORPUS_PATH); // read-only, matching cli.ts/identifiability.ts's runSeasonsMode
  let predictions: HarnessPredictionInput[];
  try {
    predictions = await runBoundedSeasons(db, seasons, algorithms, eventsLimit);
  } finally {
    db.close();
  }

  const slices = aggregateScores(predictions);

  // Structural holdout blindness, part 2: checked AFTER scoring — no
  // produced slice may ever be non-tune or headline-eligible, a runtime
  // fact rather than a convention the optimizer is merely expected to obey.
  for (const slice of slices) {
    if (slice.seasonLabel !== "tune" || slice.headlineEligible !== false) {
      throw new Error(
        `tune: produced a non-tune / headline-eligible score slice (season ${slice.season}, algorithm ${slice.algorithmId}, seasonLabel ${slice.seasonLabel}) — this must be structurally impossible.`
      );
    }
  }

  // D-01: the objective is the mean of brierScore across the requested
  // tune seasons for the "combined" compLevelView — winner accuracy is
  // computed and recorded per season but never used to rank.
  const results: CandidateResult[] = candidates.map((candidate, index) => {
    const combinedSlices = slices
      .filter((s) => s.algorithmId === candidate.id && s.compLevelView === "combined")
      .sort((a, b) => a.season - b.season);
    const perSeason = combinedSlices.map((s) => ({
      season: s.season,
      brierScore: s.brierScore,
      winnerAccuracy: s.winnerAccuracy,
    }));
    const brierValues = perSeason.map((p) => p.brierScore).filter((v): v is number => v !== null);
    const objective =
      brierValues.length > 0 ? brierValues.reduce((sum, v) => sum + v, 0) / brierValues.length : Number.POSITIVE_INFINITY;
    return { index, id: candidate.id, params: candidate.params, perSeason, objective };
  });

  // Ties broken deterministically: lowest candidate index wins — a strict
  // `<` comparison never displaces an earlier equal-or-better winner.
  let winnerIndex = 0;
  let tied = false;
  for (let i = 1; i < results.length; i++) {
    const current = results[i]!;
    const winner = results[winnerIndex]!;
    if (current.objective < winner.objective) {
      winnerIndex = i;
      tied = false;
    } else if (current.objective === winner.objective) {
      tied = true;
    }
  }

  for (const result of results) {
    console.log(
      `Candidate ${result.index} (${result.id}): objective=${result.objective.toFixed(6)}${
        result.index === winnerIndex ? " <- winner" : ""
      }`
    );
  }

  const output = {
    generatedAt: new Date().toISOString(),
    stage,
    seasons,
    eventsLimit: eventsLimit ?? null,
    corpusIdentity: CORPUS_PATH,
    objective: "mean tune-season brierScore (combined compLevelView), minimized (D-01)",
    tieBreak: tied ? "objective tied across multiple candidates — lowest candidate index wins" : null,
    winnerIndex,
    candidates: results.map((result) => ({ ...result, winner: result.index === winnerIndex })),
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");
  console.log(`Wrote ${outPath}`);
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
