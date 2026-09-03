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
 *     descent search over the screen's survivors only, minimizing Brier over
 *     the SELECTION seasons, run twice (once per `--adaptation on|off`) at
 *     IDENTICAL budgets for D-06's best-vs-best comparison.
 *
 * ## ROLLING-ORIGIN SELECTION (D-T5, quick task 260901-trz)
 *
 * THIS REPLACED A FIXED TUNE/HOLDOUT SPLIT, and the replacement is the point
 * of the change, not a refactor of it. Until `SIGMA1_CODE_VERSION` 4.0.0 this
 * module selected on `TUNE_SEASONS` (2022-2024) and was structurally forbidden
 * from reading `HOLDOUT_SEASONS` (2025-2026). That made the split itself a
 * fixed, one-shot resource: every hyperparameter decision the project ever
 * makes is charged against the same two holdout seasons, and once they have
 * been looked at a few times they no longer measure what they claim to.
 *
 * Rolling origin replaces it. For each scored season S — the ORIGIN —
 * hyperparameters are selected using ONLY seasons strictly before S:
 *
 *     scored (origin) | selected on
 *     2024            | 2022-2023
 *     2025            | 2022-2024
 *     2026            | 2022-2025
 *
 * This lifts the project's match-level predict-before-update discipline
 * (`replay.ts`'s `toLeakProofUpcoming`) up one level, to the HYPERPARAMETER
 * level — which D-T5 names as the one place that discipline currently does not
 * reach. A match may not be predicted using its own result; by exactly the
 * same argument a season may not be scored using hyperparameters that were
 * chosen by looking at it. The origin season is SCORED but never SELECTED ON.
 *
 * ### The four gates, because one gate is a convention (T-03-07)
 *
 *   1. **Derivation (before any match is read).** `deriveSelectionSeasons`
 *      keeps only seasons STRICTLY LESS than the origin, and throws if any
 *      survivor is not. The origin's own season never enters the list that
 *      the replay is driven from.
 *   2. **Independent re-check.** `assertSelectionPrecedesOrigin` recomputes
 *      `Math.max(...selectionSeasons)` by a SEPARATE code path and re-asserts
 *      it is below the origin. Two paths so a bug in either cannot silently
 *      disable the other — the same reasoning the retired gates 1+2 used,
 *      carried over with the predicate changed.
 *   3. **Post-scoring.** `assertNoFutureSeasonLeak(slices, boundary)` checks
 *      every produced `ScoreSlice` for `season >= boundary` AFTER scoring, so
 *      a stream-building or aggregation bug that pulls in a later season is
 *      caught at the point the number is produced rather than at the point it
 *      is believed. This is the retired `assertNoHoldoutLeak` with its
 *      predicate changed from `seasonLabel !== "tune"` to a season
 *      comparison; the old name is DELETED rather than kept as an alias,
 *      because leaving both would let a call site keep the retired check by
 *      accident.
 *   4. **Write ordering (structural).** The winner is chosen from the
 *      selection seasons alone and WRITTEN TO DISK BEFORE any origin-season
 *      evaluation runs. Committing the choice to a file first is what makes
 *      it structurally impossible for the out-of-sample result to feed back
 *      into the choice — a later refactor that "tidies up" by moving the
 *      write to the end of the function would be removing the guarantee, not
 *      reordering statements.
 *
 * ### `--origin` mode versus `--seasons` mode, stated plainly
 *
 * `--origin S` DERIVES its selection seasons and carries all four gates.
 * `--seasons L` names them explicitly and carries only gates 3 and 4; its
 * boundary is `max(L) + 1`, i.e. "nothing beyond what was asked for was
 * scored", which catches a replay bug but is NOT a blindness guarantee — in
 * that mode the operator, not the machinery, is responsible for the choice.
 * Passing both is an error: two sources of truth for the same question.
 *
 * The screen stage stays in `--seasons` mode deliberately, and its own
 * leak-freeness is an ARGUMENT rather than a gate: survivor selection IS
 * hyperparameter selection, so it obeys the same rule, and running the screen
 * once at the EARLIEST origin's selection window (2022-2023) makes its
 * survivor set strictly prior to 2024, 2025 and 2026 simultaneously. One
 * screen is therefore leak-free for all three origins at once, and three
 * screens would cost three times as much for no additional discipline.
 *
 * `score.ts`'s `TUNE_SEASONS`/`HOLDOUT_SEASONS` still EXIST — other callers
 * and every already-committed artifact read them (D-T5 says so explicitly) —
 * but this module no longer imports them. The tuner's dependence on the fixed
 * split is what D-T5 removes; the constants' other consumers are untouched.
 *
 * `computeLoso`/`LosoFold` were DELETED here rather than gated off.
 * Leave-one-season-out re-sliced a POOLED selection over a fixed set of three
 * seasons, which is exactly the construct rolling origin removes, and dead
 * code describing a retired discipline is the specific failure mode this
 * project's log names. The artifact now records
 * `overfittingGuard: "rolling-origin (D-T5)"` in its place.
 * `ProvenanceSchema.losoSummary` STAYS in `promote.ts` (optional): it is how
 * already-promoted files describe how THEY were selected, and removing it
 * would invalidate a historical record.
 *
 * ## D-T7's PRE-COMMITTED ACCEPTANCE RULE, and D-T4's two arms
 *
 * After gate 4's write, an `--origin` run evaluates the winner AND the
 * incumbent on the origin season and applies `acceptance.ts`'s
 * `decideAcceptance`. The bar is `sqrt(2 ln N) * SE_paired`, where N is the
 * number of candidates actually evaluated (`evaluationCountForBar` — not the
 * requested `--evals`, and not the rejected-and-resampled draws that were
 * never scored). N is recorded in the artifact beside the threshold it
 * produced, because the bar MOVES with it.
 *
 * The incumbent is read from the committed
 * `data/algorithm-versions/vpr@{SIGMA1_CODE_VERSION}+tuned-2026-08.json` and a
 * missing file THROWS. D-T7's bar is "beats what ships", and the shipped set
 * is not `DEFAULT_SIGMA1_PARAMS`.
 *
 * Two standard errors are reported under deliberately distinct names.
 * `brierDeltaStandardError` is the PAIRED difference SE, and it is the one the
 * bar is on. `brierLevelStandardError` is the candidate's own level SE, the
 * quantity D-T6's published 0.001219 is comparable to. Two fields both called
 * `se` would be confusable at a glance; these are not.
 *
 * `keep-incumbent` EXITS 0 and reads as a result. A search that clears nothing
 * has completed successfully.
 *
 * D-T4's arms need no new machinery — `--adaptation on|off` already exists and
 * `adaptationEnabled` is in `SEARCH_EXCLUSIONS` (a mode, not a dimension). What
 * the acceptance rule adds is the COMPARISON SHAPE: the two arms produce two
 * artifacts per origin, and adaptation ships only if ITS arm's winner clears
 * the D-T7 bar against the incumbent out-of-sample. D-T4's measured -0.0015
 * Brier for adaptation-on (holdout 0.153558 -> 0.152054, on top of 16x process
 * noise, so it is NOT merely a proxy for process noise) is a real result with a
 * real caveat: its winning sub-parameters were selected by LOOKING AT HOLDOUT,
 * which inflates that figure by an unknown amount. That is exactly why it must
 * re-earn its place out-of-sample rather than being enabled on the strength of
 * the number.
 *
 * ### Measured cost, and the lean run shape it argues for
 *
 * One candidate's replay is ~1 ms/match with `rpMonteCarloDraws: 0` (this
 * file's own runtime assumption); batching amortizes the stream build but not
 * the per-candidate compute:
 *
 *     origin | selection seasons | matches | one candidate
 *     2024   | 2022-2023         | 31,030  | ~31 s
 *     2025   | 2022-2024         | 48,059  | ~48 s
 *     2026   | 2022-2025         | 65,936  | ~66 s
 *
 * A joint run at the retired default `--evals 60` plus coordinate descent over
 * ~12 survivors is ~84 evaluations, i.e. ~43 / ~67 / ~92 min per origin per
 * adaptation arm — about 6.7 HOURS sequential across three origins and D-T4's
 * two arms, before a per-origin screen would add ~4 hours more. Over ten hours
 * of single-threaded replay is not something to schedule by accident, so the
 * recommended shape is:
 *
 *   1. ONE screen, at the earliest origin's window (see the argument above).
 *   2. `--evals 40` per origin rather than 60. D-T7's acceptance bar moves
 *      with N as `sqrt(2 ln N)`, so 60 -> 40 moves it from ~0.003488 to
 *      ~0.003310 — a 5% relaxation of the bar for a 33% compute saving. The
 *      runner prints that tradeoff so the operator sees what the budget
 *      bought rather than finding it in a comment later.
 *   3. Six INDEPENDENT PROCESSES (3 origins x 2 adaptation arms) run
 *      concurrently — `openCorpusReadOnly` permits concurrent readers, so
 *      wall clock collapses to the largest single run (~70 min) rather than
 *      ~5 hours. Use `--batch 4`, not the default 8: `runBoundedSeasons`
 *      accumulates every prediction for a whole batch across every selection
 *      season, which at batch 8 on the 2026 origin is over half a million
 *      objects held per process.
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import type { AlgorithmModule, MatchResult } from "../core/algorithms/types.js";
import { COLD_START_SEASON } from "../core/algorithms/breakdown/index.js";
import { seasonBoundaryFor } from "./seasonBoundary.js";
import { makeSigma1 } from "../core/algorithms/sigma1/index.js";
import {
  DEFAULT_SIGMA1_PARAMS,
  SIGMA1_CODE_VERSION,
  Sigma1ParamsSchema,
  type Sigma1Params,
} from "../core/algorithms/sigma1/params.js";
import { outcomeTarget } from "../core/scoring/brier.js";
import { isValidPRedWin } from "../core/scoring/predictionValidity.js";
import { decideAcceptance, type AcceptanceOutcome } from "./acceptance.js";
import { eventBlockedBootstrap, type EventBlockedUnit } from "./eventBootstrap.js";
import { openCorpusReadOnly, type Corpus } from "../corpus/db.js";
import { buildSeasonStream, WalkForwardSimulator } from "./replay.js";
// D-T5: `TUNE_SEASONS`/`HOLDOUT_SEASONS`/`seasonSplit` are deliberately NOT
// imported. They still exist in `score.ts` for other callers and for every
// already-committed artifact, but the tuner's dependence on the fixed split is
// exactly what rolling-origin selection removes — see this module's header.
import { aggregateScores, type HarnessPredictionInput, type ScoreSlice } from "./score.js";
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
 * D-T5 GATE 1 — the derivation itself, run before any MATCH is read.
 *
 * Keeps only the seasons STRICTLY BEFORE `originSeason`, and throws if the
 * result would be empty. `availableSeasons` is whatever the corpus actually
 * carries (a metadata query, not a replay), so this stays pure and
 * `tune.test.ts` drives it directly.
 *
 * Note the wording shift from the retired gates' "before any corpus read":
 * enumerating which seasons EXIST is unavoidably a corpus read. What matters,
 * and what is true, is that the check happens before any match is replayed and
 * before the origin's own season could reach a stream — the origin never
 * enters the list the replay is driven from at all.
 *
 * An origin with no prior season (2022, the cold-start season) THROWS rather
 * than falling back to selecting on itself or on the defaults. There is
 * nothing to select on, so there is no honest answer to give, and the leanest
 * correct behaviour is to refuse.
 */
export function deriveSelectionSeasons(availableSeasons: readonly number[], originSeason: number): number[] {
  const selection = [...new Set(availableSeasons)].filter((season) => season < originSeason).sort((a, b) => a - b);
  if (selection.length === 0) {
    throw new Error(
      `tune: origin ${originSeason} has an EMPTY selection window — the corpus carries no season strictly before it ` +
        `(available: ${[...availableSeasons].sort((a, b) => a - b).join(", ") || "none"}). Rolling-origin selection needs at least one ` +
        `prior season to select on; there is nothing to select from and no honest answer to give.`
    );
  }
  // Gate 1's own assertion, kept explicit rather than left implicit in the
  // filter above: a filter typo is exactly the class of bug this catches.
  for (const season of selection) {
    if (!(season < originSeason)) {
      throw new Error(`tune: selection season ${season} is not strictly before origin ${originSeason} (D-T5 gate 1).`);
    }
  }
  return selection;
}

/**
 * D-T5 GATE 2 — an INDEPENDENT re-check of the same fact, by a different
 * route: recompute the maximum of the selection set and compare it against the
 * origin, rather than re-walking the per-element comparison gate 1 already
 * did.
 *
 * T-03-07's reasoning, unchanged from the retired gates it replaces: one gate
 * is a convention. Two gates over one fact, computed differently, mean a bug
 * in either cannot silently disable the other. This is the single edit in
 * quick task 260901-trz that can silently re-open hyperparameter-level
 * leakage, which is why it has two gates and its own paragraph in the module
 * header.
 */
export function assertSelectionPrecedesOrigin(selectionSeasons: readonly number[], originSeason: number): void {
  if (selectionSeasons.length === 0) {
    throw new Error(`tune: empty selection season set for origin ${originSeason} (D-T5 gate 2).`);
  }
  const latestSelected = Math.max(...selectionSeasons);
  if (!(latestSelected < originSeason)) {
    throw new Error(
      `tune: the latest selection season (${latestSelected}) is not strictly before origin ${originSeason} — ` +
        `hyperparameters would be chosen partly by looking at the season they are about to be scored on (D-T5 gate 2).`
    );
  }
}

/**
 * D-T5 GATE 3 — checked AFTER scoring, on every produced slice. Exported so
 * `tune.test.ts` can assert a future-season slice makes this guard throw
 * without spinning up a real corpus replay.
 *
 * Replaces the retired `assertNoHoldoutLeak`, whose predicate was
 * `seasonLabel !== "tune"` — a statement about D-09's FIXED split, which no
 * longer governs this module. The predicate is now a plain season comparison
 * against the run's own boundary, which is what rolling origin actually
 * requires. The old name is deleted rather than aliased: an alias would let a
 * call site keep the retired check by accident, and the retired check would
 * pass happily on an origin-2026 run selecting on 2025.
 */
export function assertNoFutureSeasonLeak(slices: readonly ScoreSlice[], boundarySeason: number): void {
  for (const slice of slices) {
    if (slice.season >= boundarySeason) {
      throw new Error(
        `tune: produced a score slice for season ${slice.season} (algorithm ${slice.algorithmId}), which is at or after this run's ` +
          `boundary season ${boundarySeason} — selection must never see the origin season or anything after it. ` +
          `This must be structurally impossible (D-T5 gate 3).`
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
 * One replayed prediction, carrying everything `aggregateScores` needs PLUS
 * the match's ACTUAL alliance scores.
 *
 * It extends `HarnessPredictionInput` rather than replacing it, so these rows
 * still pass straight into `aggregateScores` unchanged (the extra fields are
 * simply not read there). The actual scores are needed by D-T7's score-MAE
 * guardrail (`evaluateOriginSeason` below), which compares
 * `|predicted - actual|` per alliance — a quantity the win-probability side of
 * the harness has never needed and therefore never carried. Widening the row
 * here rather than adding two fields to `HarnessPredictionInput` keeps the
 * shared scoring interface describing exactly what scoring reads.
 */
interface ReplayedPrediction extends HarnessPredictionInput {
  readonly actualRedScore: number;
  readonly actualBlueScore: number;
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
): Promise<ReplayedPrediction[]> {
  const all: ReplayedPrediction[] = [];
  let liveStates = new Map<string, unknown>();

  for (const [seasonIdx, season] of seasons.entries()) {
    // Quick task 260903-3bv: `fromSeason` is now the ACTUAL preceding
    // element of `seasons`, not `season - 1` — see `seasonBoundary.ts`'s doc
    // comment for why a hardcoded label became a live behavioural input the
    // moment `carrySeason` started reading `fromSeason` to compute a gap.
    const boundary = seasonBoundaryFor(seasons, seasonIdx, COLD_START_SEASON);

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

    const predictions: ReplayedPrediction[] = records.map((r) => ({
      matchKey: r.match.matchKey,
      season,
      actualRedScore: r.match.redScore,
      actualBlueScore: r.match.blueScore,
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
 * Every non-offseason season the corpus actually carries, ascending. A
 * METADATA query, not a replay — it is what `deriveSelectionSeasons` (gate 1)
 * filters against, and it is deliberately read from the corpus rather than
 * hardcoded so an origin's selection window cannot silently disagree with the
 * data that exists.
 */
function corpusSeasons(db: Corpus): number[] {
  const rows = db.prepare(`SELECT DISTINCT year FROM events WHERE is_offseason = 0 ORDER BY year ASC`).all() as { year: number }[];
  return rows.map((row) => row.year);
}

/**
 * The season at or after which NOTHING may be scored during selection, and
 * where that number came from. Carried as a pair rather than a bare number so
 * gate 3's failure message can say which mode set the boundary — an operator
 * reading "boundary 2025" needs to know whether that was derived from
 * `--origin 2025` or is just `max(--seasons) + 1`.
 */
interface LeakBoundary {
  readonly season: number;
  readonly source: string;
}

/**
 * `--seasons` mode's boundary: one past the latest season the operator asked
 * for. This asserts "nothing beyond what was requested was scored", which
 * catches a stream-building or aggregation bug, and is NOT a blindness
 * guarantee — see the module header's `--origin` vs `--seasons` section. Said
 * plainly here rather than left for a reader to infer from the arithmetic.
 */
function requestedSeasonsBoundary(seasons: readonly number[]): LeakBoundary {
  return {
    season: Math.max(...seasons) + 1,
    source: `--seasons ${[...seasons].sort((a, b) => a - b).join(",")} (nothing beyond the requested set; NOT a forward-blindness guarantee)`,
  };
}

/**
 * Evaluates one BATCH of candidates through a single shared-stream replay
 * (`runBoundedSeasons`'s own `runAll` call underneath) — one corpus read
 * and one stream build serving every candidate in `batch`, per this file's
 * batching contract. Runs D-T5 gate 3 (the post-scoring future-season check)
 * once per batch, immediately after scoring.
 */
async function evaluateCandidateBatch(
  db: Corpus,
  seasons: readonly number[],
  eventsLimit: number | undefined,
  batch: readonly { id: string; params: Sigma1Params }[],
  boundary: LeakBoundary
): Promise<EvaluatedCandidate[]> {
  const algorithms = batch.map((c) => makeSigma1({ id: c.id, linkMode: "predictive-variance", params: c.params }));
  const predictions = await runBoundedSeasons(db, seasons, algorithms, eventsLimit);
  const slices = aggregateScores(predictions);
  assertNoFutureSeasonLeak(slices, boundary.season);
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
  batchSize: number,
  boundary: LeakBoundary
): Promise<EvaluatedCandidate[]> {
  const results: EvaluatedCandidate[] = [];
  for (let i = 0; i < candidates.length; i += batchSize) {
    const chunk = candidates.slice(i, i + batchSize);
    const evaluated = await evaluateCandidateBatch(db, seasons, eventsLimit, chunk, boundary);
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
  const boundary = requestedSeasonsBoundary(seasons);

  const candidates = buildTracerCandidates();
  const db = openCorpusReadOnly(CORPUS_PATH);
  let results: EvaluatedCandidate[];
  try {
    results = await evaluateAll(db, seasons, eventsLimit, candidates, candidates.length, boundary);
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
  // D-T5: the screen stays in `--seasons` mode, and its leak-freeness is an
  // ARGUMENT rather than a gate — run it once at the EARLIEST origin's
  // selection window and its survivor set is strictly prior to every origin
  // simultaneously. See the module header's screen paragraph.
  const boundary = requestedSeasonsBoundary(seasons);

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
    evaluated = await evaluateAll(db, seasons, eventsLimit, candidates, batchSize, boundary);
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

/**
 * D-T5: the overfitting guard this artifact records, replacing the deleted
 * `computeLoso`. Leave-one-season-out re-sliced a POOLED selection over a
 * FIXED set of three seasons — precisely the construct rolling origin removes
 * — so it was deleted rather than gated off, and the artifact names its
 * replacement instead of carrying a `loso` key that would describe a
 * discipline the tuner no longer practises.
 */
const OVERFITTING_GUARD = "rolling-origin (D-T5)";

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

/**
 * D-T5: resolves ONE run's selection seasons and its leak boundary from
 * mutually exclusive `--origin` / `--seasons` inputs. Exported so
 * `tune.test.ts` can exercise the mutual exclusion and the derivation without
 * a corpus (`availableSeasons` is injected).
 *
 * Passing BOTH is an error, not a precedence rule: they are two sources of
 * truth for the same question, and silently letting one win is how a run ends
 * up selecting on a set the operator did not intend.
 */
export function resolveJointSelection(
  originSpec: string | undefined,
  seasonsSpec: string | undefined,
  availableSeasons: readonly number[]
): { selectionSeasons: number[]; originSeason: number | null; boundary: LeakBoundary } {
  if (originSpec !== undefined && seasonsSpec !== undefined) {
    throw new Error(
      `tune: --origin and --seasons are mutually exclusive (got --origin ${originSpec} and --seasons ${seasonsSpec}). ` +
        `--origin DERIVES the selection seasons as every corpus season strictly before it; passing both would be two sources ` +
        `of truth for the same question (D-T5).`
    );
  }

  if (originSpec !== undefined) {
    const originSeason = Number.parseInt(originSpec, 10);
    if (!Number.isInteger(originSeason) || String(originSeason).length !== 4) {
      throw new Error(`--origin must be a 4-digit year, got "${originSpec}"`);
    }
    // Gate 1, then gate 2 by an independent route.
    const selectionSeasons = deriveSelectionSeasons(availableSeasons, originSeason);
    assertSelectionPrecedesOrigin(selectionSeasons, originSeason);
    return {
      selectionSeasons,
      originSeason,
      boundary: { season: originSeason, source: `--origin ${originSeason} (rolling-origin selection, D-T5)` },
    };
  }

  const selectionSeasons = parseSeasonsList(seasonsSpec ?? "2022,2023,2024");
  return { selectionSeasons, originSeason: null, boundary: requestedSeasonsBoundary(selectionSeasons) };
}

async function runJointStage(
  originSpec: string | undefined,
  seasonsSpec: string | undefined,
  eventsLimit: number | undefined,
  evalsCount: number,
  seed: number,
  batchSize: number,
  survivorsPath: string,
  adaptationSpec: string,
  outPath: string
): Promise<void> {
  if (adaptationSpec !== "on" && adaptationSpec !== "off") {
    throw new Error(`--adaptation must be "on" or "off", got "${adaptationSpec}"`);
  }
  const adaptationEnabled = adaptationSpec === "on";

  const survivors = loadSurvivors(survivorsPath);

  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    // Gates 1 and 2 run HERE, before a single match is replayed — the corpus
    // is open only for the season-metadata query `resolveJointSelection`
    // filters against.
    const { selectionSeasons: seasons, originSeason, boundary } = resolveJointSelection(originSpec, seasonsSpec, corpusSeasons(db));

    if (originSeason !== null) {
      console.log(
        `Rolling origin ${originSeason} (D-T5): selecting on ${seasons.join(", ")} — strictly prior seasons only. ` +
          `The origin season is SCORED but never SELECTED ON.`
      );
    } else {
      console.log(
        `--seasons mode: selecting on ${seasons.join(", ")}. This carries NO forward-blindness guarantee — ` +
          `the operator, not the machinery, chose this set. Use --origin for D-T5's rolling-origin discipline.`
      );
    }
    // The budget tradeoff, printed rather than buried: D-T7's acceptance bar
    // moves with N as sqrt(2 ln N), so the operator can see what a reduced
    // --evals bought before the run rather than after.
    console.log(
      `Budget: --evals ${evalsCount}, --batch ${batchSize}. D-T7's acceptance bar scales as sqrt(2 ln N) x SE, so a smaller ` +
        `--evals both costs less and RELAXES the bar (60 -> 40 moves it from ~0.003488 to ~0.003310 at SE 0.001219).`
    );

    const plan = planJointCandidates(survivors, evalsCount, seed, adaptationEnabled);
    let rejectedCandidates = plan.rejectedCandidates;
    const skipped = plan.skipped;

    let results: EvaluatedCandidate[] = await evaluateAll(
      db,
      seasons,
      eventsLimit,
      plan.candidates,
      plan.mode === "empty" ? 1 : batchSize,
      boundary
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

        const evaluatedNeighbors = await evaluateCandidateBatch(db, seasons, eventsLimit, neighborCandidates, boundary);
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

    for (const result of results) {
      const index = results.indexOf(result);
      console.log(`Candidate ${index} (${result.id}): objective=${result.objective.toFixed(6)}${index === winnerIndex ? " <- winner" : ""}`);
    }

    const output = buildJointArtifact({
      adaptationSpec,
      seasons,
      originSeason,
      boundary,
      eventsLimit,
      evalsCount,
      seed,
      batchSize,
      survivorsPath,
      survivors,
      skipped,
      rejectedCandidates,
      ties,
      winnerIndex,
      atBound,
      results,
    });

    // ─────────────────────────────────────────────────────────────────────
    // D-T5 GATE 4 — STRUCTURAL. The winner is written to disk HERE, before
    // any origin-season evaluation runs, and that ORDERING IS THE GUARANTEE:
    // once the choice is committed to a file, it is structurally impossible
    // for an out-of-sample result to feed back into it. A later refactor that
    // "tidies up" by moving this write to the end of the function would be
    // deleting the guarantee, not reordering statements. Anything that reads
    // the origin season must come strictly after this line.
    // ─────────────────────────────────────────────────────────────────────
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");
    console.log(`Wrote ${outPath}`);

    // Everything below this line reads the ORIGIN season. Nothing below it may
    // ever influence `output` above, which is why `output` is already on disk.
    if (originSeason === null) {
      console.log(
        `--seasons mode: no origin season, so no out-of-sample evaluation and no D-T7 acceptance decision. ` +
          `Re-run with --origin to get one.`
      );
      return;
    }

    const evaluationCount = evaluationCountForBar(results.length, rejectedCandidates, evalsCount);
    console.log(`Evaluating the winner and the incumbent on origin season ${originSeason} (out-of-sample, D-T6/D-T7)...`);
    const acceptance = await evaluateOriginSeason(db, {
      originSeason,
      selectionSeasons: seasons,
      eventsLimit,
      winnerParams: winner.params,
      evaluationCount,
    });

    const acceptancePath = outPath.replace(/\.json$/, "-acceptance.json");
    writeFileSync(acceptancePath, JSON.stringify(acceptance, null, 2), "utf8");
    console.log(acceptance.verdict);
    console.log(`Wrote ${acceptancePath}`);

    // ─────────────────────────────────────────────────────────────────────
    // The process exits 0 for EVERY outcome, `keep-incumbent` included.
    // This is the single place a future operator is most likely to "fix" by
    // adding a non-zero exit or a retry loop, so: doing either would defeat
    // the entire purpose of a pre-committed bar. A search that finds nothing
    // above the bar has SUCCEEDED and its correct output is "the incumbent
    // stands, and here is the bar it could not clear" (D-T7; `acceptance.ts`'s
    // header states the same contract at the decision function itself).
    // ─────────────────────────────────────────────────────────────────────
  } finally {
    db.close();
  }
}

/** The joint stage's artifact shape, built as a named function so `tune.test.ts` can assert the recorded fields without running a search. */
export function buildJointArtifact(input: {
  adaptationSpec: string;
  seasons: readonly number[];
  originSeason: number | null;
  boundary: { season: number; source: string };
  eventsLimit: number | undefined;
  evalsCount: number;
  seed: number;
  batchSize: number;
  survivorsPath: string;
  survivors: readonly string[];
  skipped: string | null;
  rejectedCandidates: number;
  ties: readonly TieRecord[];
  winnerIndex: number;
  atBound: Record<string, boolean>;
  results: readonly EvaluatedCandidate[];
}): Record<string, unknown> {
  return {
    generatedAt: new Date().toISOString(),
    stage: "joint",
    adaptation: input.adaptationSpec,
    // D-T5: the origin and the seasons it was selected on, recorded at the top
    // level so a reader of the artifact alone can reconstruct the discipline
    // that produced it. `origin: null` marks a `--seasons`-mode run, which
    // carries no forward-blindness guarantee.
    origin: input.originSeason,
    selectionSeasons: [...input.seasons],
    leakBoundarySeason: input.boundary.season,
    leakBoundarySource: input.boundary.source,
    overfittingGuard: OVERFITTING_GUARD,
    // `seasons` kept alongside `selectionSeasons` for artifact readers written
    // against the retired shape; the two are the same list.
    seasons: [...input.seasons],
    eventsLimit: input.eventsLimit ?? null,
    corpusIdentity: CORPUS_PATH,
    objective: "mean selection-season brierScore (combined compLevelView), minimized (D-01)",
    evals: input.evalsCount,
    seed: input.seed,
    batch: input.batchSize,
    survivorsPath: input.survivorsPath,
    survivors: [...input.survivors],
    skipped: input.skipped,
    rejectedCandidates: input.rejectedCandidates,
    tieBreak: input.ties.length > 0 ? "objective tied across multiple candidates — lowest candidate index wins" : null,
    ties: input.ties,
    winnerIndex: input.winnerIndex,
    atBound: input.atBound,
    candidates: input.results.map((result, index) => ({ index, ...result, winner: index === input.winnerIndex })),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Origin-season evaluation and D-T7's pre-committed acceptance rule
// (quick task 260901-trz Task 6)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Where the incumbent comes from. THE COMMITTED PROMOTED FILE, never
 * `DEFAULT_SIGMA1_PARAMS`: D-T7's bar is "beats what SHIPS", and Finding F1
 * of this task's own plan is that the shipped set is not the defaults — the
 * promoted `tuned-2026-08` carries a searched `linkC` override that exists
 * nowhere else. A run that silently fell back to the defaults would compare
 * the candidate against a model no user has ever seen and report the result
 * as though it were a shipping decision.
 */
const INCUMBENT_VERSION_PATH = join("data", "algorithm-versions", `vpr@${SIGMA1_CODE_VERSION}+tuned-2026-08.json`);

/** One origin-season match, scored for BOTH models. `eventKey` makes it an `EventBlockedUnit`, so every SE below is event-blocked (D-T6). */
export interface PairedOriginUnit extends EventBlockedUnit {
  readonly matchKey: string;
  readonly candidateBrier: number;
  readonly incumbentBrier: number;
  /** Mean `|predicted - actual|` across the match's TWO alliances, so a mean over matches equals the alliance-level MAE `reparamEquivalence.ts` reports. */
  readonly candidateAbsoluteError: number;
  readonly incumbentAbsoluteError: number;
}

/** Per-model per-match row, before pairing. */
interface OriginScoredRow extends EventBlockedUnit {
  readonly matchKey: string;
  readonly brier: number;
  readonly absoluteError: number;
}

function scoreOriginRows(predictions: readonly ReplayedPrediction[], algorithmId: string, originSeason: number): OriginScoredRow[] {
  const rows: OriginScoredRow[] = [];
  for (const p of predictions) {
    if (p.algorithmId !== algorithmId || p.season !== originSeason) continue;
    // The SAME exclusions `aggregateScores` applies, so Brier and MAE describe
    // one population. Two populations would make the acceptance rule's two
    // conditions incomparable and would reintroduce, inside the measuring
    // instrument, exactly the silent-narrowing failure `score.ts`'s quarantine
    // bounds exist to prevent.
    if (p.isOffseason || p.isSurrogateAffected) continue;
    if (p.actualWinner === null) continue;
    if (!isValidPRedWin(p.pRedWin)) continue;
    rows.push({
      eventKey: p.eventKey,
      matchKey: p.matchKey,
      brier: (p.pRedWin - outcomeTarget(p.actualWinner)) ** 2,
      absoluteError:
        (Math.abs(p.predictedRedScore - p.actualRedScore) + Math.abs(p.predictedBlueScore - p.actualBlueScore)) / 2,
    });
  }
  return rows;
}

/**
 * Pairs the two models' origin-season rows BY `matchKey`, and refuses anything
 * else.
 *
 * The paired bootstrap's validity rests entirely on both models having been
 * scored on the SAME matches — that is what makes the shared match-difficulty
 * variance cancel inside the difference before resampling (see
 * `eventBootstrap.ts`'s header). An unpaired or partially-overlapping
 * comparison would still produce a number, and that number would be a
 * meaningless standard error that the acceptance bar would then be built on.
 * So a mismatch throws here rather than degrading quietly.
 */
export function buildPairedOriginUnits(
  candidateRows: readonly OriginScoredRow[],
  incumbentRows: readonly OriginScoredRow[]
): PairedOriginUnit[] {
  if (candidateRows.length !== incumbentRows.length) {
    throw new Error(
      `tune: cannot pair the origin-season comparison — the candidate produced ${candidateRows.length} scorable matches and the ` +
        `incumbent produced ${incumbentRows.length}. A paired event-blocked standard error requires both models scored on the ` +
        `IDENTICAL match set; an unpaired difference would report a meaningless SE that D-T7's bar would then be built on.`
    );
  }
  const incumbentByMatch = new Map(incumbentRows.map((row) => [row.matchKey, row]));
  const units: PairedOriginUnit[] = [];
  for (const candidate of candidateRows) {
    const incumbent = incumbentByMatch.get(candidate.matchKey);
    if (incumbent === undefined) {
      throw new Error(
        `tune: cannot pair the origin-season comparison — match "${candidate.matchKey}" was scored for the candidate but not for ` +
          `the incumbent. Both models must see the identical match set (D-T6/D-T7).`
      );
    }
    units.push({
      eventKey: candidate.eventKey,
      matchKey: candidate.matchKey,
      candidateBrier: candidate.brier,
      incumbentBrier: incumbent.brier,
      candidateAbsoluteError: candidate.absoluteError,
      incumbentAbsoluteError: incumbent.absoluteError,
    });
  }
  return units;
}

/**
 * D-T7's N: how many candidates were actually EVALUATED in this origin's
 * search — random draws plus coordinate-descent neighbours — and deliberately
 * NOT the requested `--evals`, nor that plus the rejected-and-resampled draws.
 *
 * The union bound `sqrt(2 ln N)` is over the number of CHANCES the search had
 * to beat the incumbent by luck. A draw that was rejected by
 * `isValidParamSet` before ever being scored was never such a chance, so
 * counting it would inflate the bar. The requested `--evals` understates it
 * whenever the coordinate-descent refinement pass added candidates, which it
 * normally does — and understating the bar is the direction that lets noise
 * through. Recorded in the artifact next to the threshold it produced, because
 * D-T7 requires it: the bar MOVES with N, so a decision quoted without its N
 * cannot be checked.
 */
export function evaluationCountForBar(evaluatedCandidates: number, rejectedAndResampled: number, requestedEvals: number): number {
  if (!Number.isInteger(evaluatedCandidates) || evaluatedCandidates < 2) {
    throw new Error(
      `tune: the acceptance bar needs at least 2 evaluated candidates, got ${evaluatedCandidates} ` +
        `(rejected-and-resampled: ${rejectedAndResampled}, requested --evals: ${requestedEvals}). At N = 1 the union bound is exactly 0, which is not a bar.`
    );
  }
  return evaluatedCandidates;
}

/** The acceptance block this run writes alongside its winner artifact. */
export interface OriginAcceptanceReport {
  readonly originSeason: number;
  readonly selectionSeasons: readonly number[];
  readonly incumbentVersionPath: string;
  readonly incumbentVersion: string;
  readonly matchCount: number;
  readonly eventCount: number;
  readonly candidateBrier: number;
  readonly incumbentBrier: number;
  readonly candidateMae: number;
  readonly incumbentMae: number;
  /** PAIRED event-blocked SE of `candidateBrier - incumbentBrier` — the quantity D-T7's bar is actually on. */
  readonly brierDeltaStandardError: number;
  /** LEVEL event-blocked SE of the candidate's own Brier — the quantity D-T6's published 0.001219 is comparable to. Reported alongside so a later reader cannot compare a paired SE against a level one by mistake. */
  readonly brierLevelStandardError: number;
  readonly maeDeltaStandardError: number;
  readonly outcome: AcceptanceOutcome;
  readonly verdict: string;
}

/**
 * Builds D-T7's decision and the one plain sentence that reports it.
 *
 * Pure, and exported, so `tune.test.ts` can assert the shape of all three
 * outcomes without a corpus. The bootstrap and the rule itself are already
 * unit-tested in `eventBootstrap.test.ts`/`acceptance.test.ts`; what this
 * function is responsible for is the WIRING — that the paired SE goes to the
 * bar, the level SE goes only into the report, and the veto's two bounds
 * travel with the number they judged.
 */
export function buildAcceptanceReport(input: {
  originSeason: number;
  selectionSeasons: readonly number[];
  incumbentVersionPath: string;
  incumbentVersion: string;
  units: readonly PairedOriginUnit[];
  eventCount: number;
  brierDeltaStandardError: number;
  brierLevelStandardError: number;
  maeDeltaStandardError: number;
  evaluationCount: number;
}): OriginAcceptanceReport {
  const n = input.units.length;
  const mean = (pick: (u: PairedOriginUnit) => number): number => input.units.reduce((sum, u) => sum + pick(u), 0) / n;
  const candidateBrier = mean((u) => u.candidateBrier);
  const incumbentBrier = mean((u) => u.incumbentBrier);
  const candidateMae = mean((u) => u.candidateAbsoluteError);
  const incumbentMae = mean((u) => u.incumbentAbsoluteError);

  const outcome = decideAcceptance({
    incumbentBrier,
    candidateBrier,
    incumbentMae,
    candidateMae,
    brierStandardError: input.brierDeltaStandardError,
    maeStandardError: input.maeDeltaStandardError,
    evaluationCount: input.evaluationCount,
  });

  // One plain sentence per case. `keep-incumbent` reads as a RESULT, not as a
  // failure — see `acceptance.ts`'s header; a report that phrases it as a
  // failure is how an operator gets talked into widening the bar.
  const shared =
    `Origin ${input.originSeason}: the search evaluated ${input.evaluationCount} candidates on ${input.selectionSeasons.join(", ")} ` +
    `and its winner beat the incumbent (${input.incumbentVersion}) by ${outcome.margin.toFixed(6)} Brier out-of-sample ` +
    `over ${n} matches across ${input.eventCount} events; the bar at N = ${input.evaluationCount} was ${outcome.threshold.toFixed(6)}`;
  const verdict =
    outcome.decision === "accept"
      ? `${shared}, so the candidate is ACCEPTED (score-MAE delta ${outcome.maeDelta.toFixed(4)}, inside the guardrail's ${outcome.maeVetoBound.toFixed(4)} bound).`
      : outcome.reason === "below-threshold"
        ? `${shared}, so the INCUMBENT STANDS. Nothing cleared a pre-committed bar, which is a completed search, not a failed one.`
        : `${shared} and was cleared — but the candidate worsens alliance-score MAE by ${outcome.maeDelta.toFixed(4)} points, past the ` +
          `guardrail's ${outcome.maeVetoBound.toFixed(4)} bound, so it is VETOED and the INCUMBENT STANDS. D-T7's guardrail exists because ` +
          `the vpr@3.0.0 fix shipped a 16% score-MAE regression that Brier and SD(z) both rated equal-or-better.`;

  return {
    originSeason: input.originSeason,
    selectionSeasons: [...input.selectionSeasons],
    incumbentVersionPath: input.incumbentVersionPath,
    incumbentVersion: input.incumbentVersion,
    matchCount: n,
    eventCount: input.eventCount,
    candidateBrier,
    incumbentBrier,
    candidateMae,
    incumbentMae,
    brierDeltaStandardError: input.brierDeltaStandardError,
    brierLevelStandardError: input.brierLevelStandardError,
    maeDeltaStandardError: input.maeDeltaStandardError,
    outcome,
    verdict,
  };
}

/** Reads the committed incumbent. Throws by name if it is missing rather than substituting `DEFAULT_SIGMA1_PARAMS` — see `INCUMBENT_VERSION_PATH`. */
export function loadIncumbent(path: string = INCUMBENT_VERSION_PATH): { params: Sigma1Params; version: string } {
  if (!existsSync(path)) {
    throw new Error(
      `tune: the incumbent version file ${path} does not exist. D-T7's bar is "beats what SHIPS", and the shipped parameter set is ` +
        `NOT DEFAULT_SIGMA1_PARAMS (the promoted set carries overrides that exist nowhere else). Refusing to silently substitute the defaults.`
    );
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown; params?: unknown };
  return { params: Sigma1ParamsSchema.parse(raw.params), version: typeof raw.version === "string" ? raw.version : "(unknown)" };
}

/**
 * D-T6/D-T7's out-of-sample evaluation. Runs strictly AFTER the winner has
 * been written to disk (gate 4).
 *
 * DEVIATION FROM THE PLAN'S LETTER, recorded because it changes what is
 * measured: the plan said "replay exactly two candidates over the ORIGIN
 * season alone". This replays the SELECTION seasons THROUGH the origin as one
 * continuous run with `carrySeason` threading, and SCORES only the origin
 * season. A cold-start replay of the origin alone would measure a model that
 * does not exist — Sigma1 carries state across season boundaries (D-16/D-19,
 * and `reparamEquivalence.ts` makes the same point in as many words: "five
 * independent per-season runs would measure a different model"). The extra
 * cost is a few minutes of replay against a search measured in hours, so
 * there is no reason to approximate it.
 *
 * Both candidates go through ONE `runBoundedSeasons` call and therefore ONE
 * shared stream, which is what makes the PAIRED bootstrap valid.
 *
 * Note the boundary handed to gate 3 here: `originSeason + 1`, not
 * `originSeason`. This phase is DELIBERATELY allowed to score the origin —
 * that is the whole point of an out-of-sample evaluation — and is still
 * forbidden anything after it. The selection phase's own boundary was
 * `originSeason`, and it ran before this and against a different number.
 */
async function evaluateOriginSeason(
  db: Corpus,
  input: {
    originSeason: number;
    selectionSeasons: readonly number[];
    eventsLimit: number | undefined;
    winnerParams: Sigma1Params;
    evaluationCount: number;
  }
): Promise<OriginAcceptanceReport> {
  const incumbent = loadIncumbent();
  const CANDIDATE_ID = "acceptance-candidate";
  const INCUMBENT_ID = "acceptance-incumbent";

  const algorithms = [
    makeSigma1({ id: CANDIDATE_ID, linkMode: "predictive-variance", params: input.winnerParams }),
    makeSigma1({ id: INCUMBENT_ID, linkMode: "predictive-variance", params: incumbent.params }),
  ];
  const replaySeasons = [...input.selectionSeasons, input.originSeason].sort((a, b) => a - b);
  const predictions = await runBoundedSeasons(db, replaySeasons, algorithms, input.eventsLimit);

  assertNoFutureSeasonLeak(aggregateScores(predictions), input.originSeason + 1);

  const units = buildPairedOriginUnits(
    scoreOriginRows(predictions, CANDIDATE_ID, input.originSeason),
    scoreOriginRows(predictions, INCUMBENT_ID, input.originSeason)
  );

  // PAIRED differences for both axes — one resample of events, both models
  // scored on the same draw. `eventBootstrap.ts`'s header explains why the
  // paired SE, not either side's level SE, is the faithful quantity for a bar
  // that is itself on a difference.
  const brierDelta = eventBlockedBootstrap(units, (sample) =>
    sample.reduce((sum, u) => sum + (u.candidateBrier - u.incumbentBrier), 0) / sample.length
  );
  const maeDelta = eventBlockedBootstrap(units, (sample) =>
    sample.reduce((sum, u) => sum + (u.candidateAbsoluteError - u.incumbentAbsoluteError), 0) / sample.length
  );
  // The LEVEL SE as well: one extra call, and it prevents a later reader
  // comparing this run's paired SE against D-T6's published level figure.
  const brierLevel = eventBlockedBootstrap(units, (sample) => sample.reduce((sum, u) => sum + u.candidateBrier, 0) / sample.length);

  return buildAcceptanceReport({
    originSeason: input.originSeason,
    selectionSeasons: input.selectionSeasons,
    incumbentVersionPath: INCUMBENT_VERSION_PATH,
    incumbentVersion: incumbent.version,
    units,
    eventCount: brierDelta.eventCount,
    brierDeltaStandardError: brierDelta.standardError,
    brierLevelStandardError: brierLevel.standardError,
    maeDeltaStandardError: maeDelta.standardError,
    evaluationCount: input.evaluationCount,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      seasons: { type: "string" },
      // D-T5: the joint stage's rolling origin. Mutually exclusive with
      // `--seasons` (`resolveJointSelection` throws for both).
      origin: { type: "string" },
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
    const evalsCount = values.evals !== undefined ? parsePositiveInt("--evals", values.evals) : 60;
    const seed = values.seed !== undefined ? parsePositiveInt("--seed", values.seed) : 42;
    const batchSize = values.batch !== undefined ? parsePositiveInt("--batch", values.batch) : 8;
    const survivorsPath = values.survivors ?? join("reports", "sensitivity-screen.json");
    const adaptationSpec = values.adaptation ?? "off";
    // D-T5: ONE ARTIFACT PER ORIGIN. The origin is in the default filename so
    // six concurrent runs (3 origins x 2 adaptation arms, the recommended
    // shape in this module's header) cannot overwrite each other's results.
    const outPath =
      values.out ??
      join("reports", values.origin !== undefined ? `tune-joint-${adaptationSpec}-origin${values.origin}.json` : `tune-joint-${adaptationSpec}.json`);
    await runJointStage(values.origin, values.seasons, eventsLimit, evalsCount, seed, batchSize, survivorsPath, adaptationSpec, outPath);
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
