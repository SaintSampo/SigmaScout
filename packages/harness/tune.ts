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
 * hyperparameters are selected using ONLY seasons strictly before S, capped
 * at the `SELECTION_WINDOW_SEASONS` (3) most recent available (see that
 * constant's doc comment for the recency + bounded-cost rationale). On the
 * backfilled 2019–2027 corpus:
 *
 *     scored (origin) | selected on
 *     2024            | 2020, 2022-2023
 *     2025            | 2022-2024
 *     2026            | 2023-2025
 *     2027            | 2024-2026
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
 * `score.ts`'s retired `TUNE_SEASONS`/`HOLDOUT_SEASONS`/`seasonSplit` were
 * DELETED outright by quick task 260903-krp, rather than kept as an alias
 * this module simply stopped importing — D-T5 already established that the
 * fixed split had nothing left to say once only origin seasons are ever
 * displayed, and 260903-krp carried that through to the vocabulary itself.
 * This module's own dependence on the fixed split was removed earlier, by
 * D-T5; 260903-krp is what removed the split from the rest of the harness.
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
 * `decideAcceptance`. Since quick task 260904-oiu (OBJ-BAR) the bar is on
 * ACCURACY: `sqrt(2 ln N) * SE_paired(accuracy delta)`, where N is the
 * number of candidates actually evaluated (`evaluationCountForBar` — not the
 * requested `--evals`, and not the rejected-and-resampled draws that were
 * never scored). N is recorded in the artifact beside the threshold it
 * produced, because the bar MOVES with it. Brier is now a two-half GUARDRAIL
 * VETO alongside the pre-existing score-MAE veto — see `acceptance.ts`'s
 * header for the full three-condition shape.
 *
 * The incumbent is read from the committed
 * `data/algorithm-versions/vpr@{SIGMA1_CODE_VERSION}+tuned-2026-08.json` and a
 * missing file THROWS. D-T7's bar is "beats what ships", and the shipped set
 * is not `DEFAULT_SIGMA1_PARAMS`.
 *
 * Three standard errors are reported under deliberately distinct names.
 * `accuracyDeltaStandardError` is the PAIRED difference SE the bar is
 * actually ON. `brierDeltaStandardError` is the PAIRED difference SE that now
 * feeds only the Brier guardrail. `brierLevelStandardError` is the
 * candidate's own level SE, the quantity D-T6's published 0.001219 is
 * comparable to. Three fields all called `se` would be confusable at a
 * glance; these are not.
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
 * the per-candidate compute. (Measured on the PRE-CAP, pre-backfill windows —
 * still the right order of magnitude, and `SELECTION_WINDOW_SEASONS` now pins
 * every mature origin near the middle row's cost instead of letting the last
 * row grow by a season every year.)
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
import { seasonBoundaryFor } from "./seasonBoundary.js";
import { makeSigma1 } from "../core/algorithms/sigma1/index.js";
import {
  DEFAULT_SIGMA1_PARAMS,
  SIGMA1_CODE_VERSION,
  Sigma1ParamsSchema,
  type Sigma1Params,
} from "../core/algorithms/sigma1/params.js";
import { accuracyCall, outcomeTarget, type MatchOutcome } from "../core/scoring/brier.js";
import { isValidPRedWin } from "../core/scoring/predictionValidity.js";
import { decideAcceptance, type AcceptanceOutcome } from "./acceptance.js";
import { eventBlockedBootstrap, type EventBlockedUnit } from "./eventBootstrap.js";
import { SEARCH_OBJECTIVE_DEFINITION, SCREEN_OBJECTIVE_DEFINITION } from "./objectiveDefinition.js";
import { openCorpusReadOnly, type Corpus } from "../corpus/db.js";
import { PromotedVersionSchema } from "./promote.js";
import { buildSeasonStream, WalkForwardSimulator } from "./replay.js";
import { makeSeasonalSigma1 } from "./seasonParamSets.js";
// D-T5 removed this module's dependence on the fixed split; quick task
// 260903-krp then deleted `TUNE_SEASONS`/`HOLDOUT_SEASONS`/`seasonSplit`
// entirely from `score.ts` — there is nothing left to import. See this
// module's header for the full history.
import { aggregateScores, ELIGIBILITY_NOT_CLAIMED, type HarnessPredictionInput, type ScoreSlice } from "./score.js";
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
 * The selection window CAP (quick task 260904, user decision): an origin
 * selects on at most the N most recent available prior seasons, not on every
 * prior season the corpus carries. A max, never a minimum — an origin with
 * fewer prior seasons keeps them all (2022 keeps its two-season 2019–2020
 * window).
 *
 * Two reasons, cost second:
 *
 *   1. **Recency.** The 2024 origin verdict (retune-sigma1-rolling-origin
 *      todo) established that a season under a different game mechanic is
 *      STRUCTURALLY different — a tightly-measured systematic miss, not
 *      noise. Seasons four-plus years back were played under different rules
 *      and score regimes; letting them vote on hyperparameters biases
 *      selection toward stale dynamics. And `carryMeanReversion` decays
 *      carried state geometrically at each boundary, so the warm-up a capped
 *      window truncates was already nearly fully decayed.
 *   2. **Bounded cost.** Uncapped, every origin's window grows by one season
 *      per year forever (origin 2027 was already ~115k matches per
 *      candidate); capped, every mature origin settles at ~45–50k matches.
 *
 * The cap weakens NO D-T5 discipline: a capped window is still strictly
 * before the origin, so all four gates hold unchanged, and the one-screen
 * argument (earliest window strictly prior to every origin) holds too.
 */
export const SELECTION_WINDOW_SEASONS = 3;

/**
 * D-T5 GATE 1 — the derivation itself, run before any MATCH is read.
 *
 * Keeps only the `SELECTION_WINDOW_SEASONS` most recent seasons STRICTLY
 * BEFORE `originSeason`, and throws if the result would be empty.
 * `availableSeasons` is whatever the corpus actually carries (a metadata
 * query, not a replay), so this stays pure and `tune.test.ts` drives it
 * directly.
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
  const selection = [...new Set(availableSeasons)]
    .filter((season) => season < originSeason)
    .sort((a, b) => a - b)
    // The window cap — the MOST RECENT prior seasons, so the slice comes
    // after the ascending sort. See SELECTION_WINDOW_SEASONS's doc comment.
    .slice(-SELECTION_WINDOW_SEASONS);
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
 * The FOUR exclusions `aggregateScores` (`score.ts`) applies to its own
 * scorable population, in the SAME order, mirrored here rather than
 * re-derived so the tuner's own accuracy blocks (`buildEventAccuracyBlocks`
 * below) and the acceptance path's `scoreOriginRows` can never silently
 * diverge from the published population or from each other (quick task
 * 260904-oiu, `<key_links>`). `score.ts`'s own loop is not itself refactored
 * to call this — it is out of this task's file scope — so this predicate is
 * a mirror, not a shared implementation; keeping the two in agreement is a
 * discipline `score.test.ts`'s own equivalence coverage checks.
 */
export function isScorablePrediction<
  T extends { isOffseason: boolean; isSurrogateAffected: boolean; actualWinner: MatchOutcome | null; pRedWin: number },
>(p: T): p is T & { actualWinner: MatchOutcome } {
  if (p.isOffseason) return false;
  if (p.isSurrogateAffected) return false;
  if (p.actualWinner === null) return false;
  if (!isValidPRedWin(p.pRedWin)) return false;
  return true;
}

/**
 * One event's worth of winner-accuracy evidence for ONE candidate: the
 * correct-call count and the accuracy DENOMINATOR (non-tie scorable
 * matches) — the minimum sufficient statistic for a paired accuracy-delta
 * bootstrap, since the per-event difference of two candidates' correct-counts
 * over the shared denominator is exactly the block sum of the per-match
 * paired difference. `season` is carried because the noise-band statistic
 * mirrors the accuracy objective's own shape (per-season accuracy, then the
 * mean over seasons), which a bare event-keyed block cannot answer alone.
 */
export interface EventAccuracyBlock extends EventBlockedUnit {
  readonly eventKey: string;
  readonly season: number;
  readonly correct: number;
  readonly denominator: number;
}

/**
 * Builds `candidateId`'s per-event accuracy blocks straight from the
 * replayed predictions — never from `aggregateScores`' output, which has
 * already collapsed the per-match detail a block needs. Applies
 * `isScorablePrediction` (the same four exclusions the published accuracy
 * figure applies) and then `accuracyCall` (the SAME predicate `scoreSet`
 * uses) so a tie contributes to NEITHER `correct` NOR `denominator` — an
 * event whose every prediction was a tie therefore never becomes a block at
 * all, which is correct: it carries no accuracy-relevant evidence either way.
 */
export function buildEventAccuracyBlocks(predictions: readonly ReplayedPrediction[], candidateId: string): EventAccuracyBlock[] {
  const blocksByEvent = new Map<string, { eventKey: string; season: number; correct: number; denominator: number }>();
  for (const p of predictions) {
    if (p.algorithmId !== candidateId) continue;
    if (!isScorablePrediction(p)) continue;
    const call = accuracyCall({ pRedWin: p.pRedWin, actualWinner: p.actualWinner });
    if (call === null) continue; // an actual tie — excluded from the accuracy denominator entirely
    let block = blocksByEvent.get(p.eventKey);
    if (!block) {
      block = { eventKey: p.eventKey, season: p.season, correct: 0, denominator: 0 };
      blocksByEvent.set(p.eventKey, block);
    }
    block.denominator += 1;
    if (call) block.correct += 1;
  }
  return [...blocksByEvent.values()];
}

/**
 * The accuracy objective's own shape, applied to a (possibly resampled) set
 * of event blocks: per-season accuracy from the summed blocks, then the mean
 * over seasons that have a POSITIVE denominator in this draw. Shared by
 * `objectiveForCandidate`'s sibling accuracy statistic and by the paired
 * bootstrap's resampled statistic below, so the noise band is an SE OF THE
 * OBJECTIVE rather than of a differently-shaped quantity. Returns
 * `Number.NEGATIVE_INFINITY` when no season has a positive denominator —
 * mirroring `objectiveForCandidate`'s own empty-case fallback.
 */
function seasonMeanAccuracyFromBlocks(blocks: readonly { readonly season: number; readonly correct: number; readonly denominator: number }[]): number {
  const correctBySeason = new Map<number, number>();
  const denominatorBySeason = new Map<number, number>();
  for (const b of blocks) {
    correctBySeason.set(b.season, (correctBySeason.get(b.season) ?? 0) + b.correct);
    denominatorBySeason.set(b.season, (denominatorBySeason.get(b.season) ?? 0) + b.denominator);
  }
  const seasonAccuracies: number[] = [];
  for (const [season, denominator] of denominatorBySeason) {
    if (denominator > 0) seasonAccuracies.push(correctBySeason.get(season)! / denominator);
  }
  if (seasonAccuracies.length === 0) return Number.NEGATIVE_INFINITY;
  return seasonAccuracies.reduce((sum, v) => sum + v, 0) / seasonAccuracies.length;
}

/** One event's accuracy evidence for BOTH sides of a comparison, paired by `eventKey`. */
interface PairedAccuracyBlockUnit extends EventBlockedUnit {
  readonly eventKey: string;
  readonly season: number;
  readonly aCorrect: number;
  readonly aDenominator: number;
  readonly bCorrect: number;
  readonly bDenominator: number;
}

/**
 * Pairs two candidates' event accuracy blocks by `eventKey` and refuses a
 * mismatch by name — the same reason `buildPairedOriginUnits` already gives:
 * an unpaired or partially-overlapping comparison would still produce a
 * number, and that number would be a meaningless standard error the search
 * comparator would then be built on.
 */
export function pairEventAccuracyBlocks(
  aBlocks: readonly EventAccuracyBlock[],
  bBlocks: readonly EventAccuracyBlock[]
): PairedAccuracyBlockUnit[] {
  if (aBlocks.length !== bBlocks.length) {
    throw new Error(
      `tune: cannot pair the accuracy-delta comparison — one candidate produced ${aBlocks.length} scorable event blocks and the ` +
        `other produced ${bBlocks.length}. A paired event-blocked standard error requires both candidates scored on the ` +
        `IDENTICAL event set; an unpaired difference would report a meaningless SE that the search comparator would then be built on.`
    );
  }
  const bByEvent = new Map(bBlocks.map((b) => [b.eventKey, b]));
  const units: PairedAccuracyBlockUnit[] = [];
  for (const a of aBlocks) {
    const b = bByEvent.get(a.eventKey);
    if (b === undefined) {
      throw new Error(
        `tune: cannot pair the accuracy-delta comparison — event "${a.eventKey}" was scored for one candidate but not the ` +
          `other. Both candidates must see the identical event set.`
      );
    }
    units.push({ eventKey: a.eventKey, season: a.season, aCorrect: a.correct, aDenominator: a.denominator, bCorrect: b.correct, bDenominator: b.denominator });
  }
  return units;
}

/**
 * The event-blocked PAIRED-DIFFERENCE standard error of the accuracy delta
 * between two candidates — the noise band the comparator judges an accuracy
 * delta against. Because each unit here is already an event AGGREGATE (not a
 * per-match row), the returned `eventBlockedBootstrap` result's `matchCount`
 * equals its block count; only `standardError` is consumed. Leaves
 * `eventBlockedBootstrap`'s DEFAULT seed in place — a seed derived from a
 * candidate index or a clock would make `determineWinner` non-deterministic,
 * which is forbidden.
 */
export function accuracyDeltaStandardError(aBlocks: readonly EventAccuracyBlock[], bBlocks: readonly EventAccuracyBlock[]): number {
  const paired = pairEventAccuracyBlocks(aBlocks, bBlocks);
  const result = eventBlockedBootstrap(paired, (sample) => {
    const aAccuracy = seasonMeanAccuracyFromBlocks(sample.map((u) => ({ season: u.season, correct: u.aCorrect, denominator: u.aDenominator })));
    const bAccuracy = seasonMeanAccuracyFromBlocks(sample.map((u) => ({ season: u.season, correct: u.bCorrect, denominator: u.bDenominator })));
    return aAccuracy - bAccuracy;
  });
  return result.standardError;
}

export type ComparatorDecisionAxis = "accuracy" | "brier" | "exact-tie";

/** Which of `a`/`b` wins a noise-band lexicographic comparison, plus the evidence that decided it. */
export interface CandidateComparison {
  readonly winner: "a" | "b" | "tie";
  /** `a.accuracyObjective - b.accuracyObjective`. */
  readonly accuracyDelta: number;
  /** The noise band this comparison judged `accuracyDelta` against. */
  readonly band: number;
  readonly decidedBy: ComparatorDecisionAxis;
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
    // Quick task 260904-cs1 (D-1): the cold start is positional, not a
    // module constant this replay range has to agree with — the first
    // season in `seasons` (whatever it is) has no predecessor to carry
    // from, so it cold-starts by construction. A `[2019, 2020, 2022]`
    // origin-2022 replay now cold-starts 2019 and carries two seasons of
    // state into 2022, instead of discarding them at 2022.
    const boundary = seasonBoundaryFor(seasons, seasonIdx);

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
  /**
   * quick task 260904-oiu (OBJ-RANK): the PRIMARY objective, MAXIMIZED — mean
   * per-season winner accuracy over the run's scored seasons.
   * `Number.NEGATIVE_INFINITY` when no season scored. Retires D-01's "recorded
   * but never read" comment — that sentence describing this exact field is
   * now false, and leaving a stale doc comment in place is precisely the
   * failure this project's log names.
   */
  readonly accuracyObjective: number;
  /**
   * The SECONDARY objective, MINIMIZED — mean tune-season `brierScore`
   * (combined `compLevelView`). Decides only when two candidates' accuracy is
   * inside the noise band (`compareCandidates`). `Number.POSITIVE_INFINITY`
   * when no season scored.
   */
  readonly brierObjective: number;
  /**
   * This candidate's per-event accuracy evidence, consumed ONLY by
   * `accuracyDeltaStandardError` (the comparator's noise band) — never
   * written to a search artifact (see `buildJointArtifact`'s explicit
   * destructure), since it is a per-event array that would bloat every
   * artifact for no reader.
   */
  readonly accuracyBlocks: readonly EventAccuracyBlock[];
}

/**
 * The joint search's structured objective, extracted from `aggregateScores`'
 * output for ONE candidate id: mean per-season `winnerAccuracy` (PRIMARY,
 * maximized) and mean per-season `brierScore` (SECONDARY, minimized), both
 * for the `"combined"` `compLevelView`, both derived from the SAME slices as
 * before D-01's retirement (quick task 260904-oiu). Shared by every stage so
 * the objective definition cannot drift between the tracer, the screen, and
 * the joint search.
 */
export function objectiveForCandidate(
  slices: readonly ScoreSlice[],
  candidateId: string
): { perSeason: PerSeasonScore[]; accuracyObjective: number; brierObjective: number } {
  const combinedSlices = slices
    .filter((s) => s.algorithmId === candidateId && s.compLevelView === "combined")
    .sort((a, b) => a.season - b.season);
  const perSeason = combinedSlices.map((s) => ({ season: s.season, brierScore: s.brierScore, winnerAccuracy: s.winnerAccuracy }));
  const brierValues = perSeason.map((p) => p.brierScore).filter((v): v is number => v !== null);
  const brierObjective = brierValues.length > 0 ? brierValues.reduce((sum, v) => sum + v, 0) / brierValues.length : Number.POSITIVE_INFINITY;
  const accuracyValues = perSeason.map((p) => p.winnerAccuracy).filter((v): v is number => v !== null);
  const accuracyObjective =
    accuracyValues.length > 0 ? accuracyValues.reduce((sum, v) => sum + v, 0) / accuracyValues.length : Number.NEGATIVE_INFINITY;
  return { perSeason, accuracyObjective, brierObjective };
}

/**
 * The noise-band lexicographic comparator (OBJ-RANK, quick task 260904-oiu):
 * accuracy is PRIMARY. When the absolute accuracy delta EXCEEDS the
 * event-blocked paired-difference noise band, the higher-accuracy candidate
 * wins outright (`decidedBy: "accuracy"`). Otherwise the two are
 * accuracy-tied and the LOWER `brierObjective` wins (`decidedBy: "brier"`).
 * Otherwise — identical accuracy AND identical Brier — it is an exact tie
 * (`decidedBy: "exact-tie"`), left to the caller's own tie-break discipline.
 *
 * Symmetric by construction: `compareCandidates(a, b)` and
 * `compareCandidates(b, a)` name the same winner (swapped label) and report
 * the same `band`, because `accuracyDeltaStandardError` resamples the
 * IDENTICAL paired units regardless of argument order and a bootstrap SE is
 * invariant to a uniform sign flip of the resampled statistic.
 */
export function compareCandidates(a: EvaluatedCandidate, b: EvaluatedCandidate): CandidateComparison {
  const accuracyDelta = a.accuracyObjective - b.accuracyObjective;
  const band = accuracyDeltaStandardError(a.accuracyBlocks, b.accuracyBlocks);
  if (Math.abs(accuracyDelta) > band) {
    return { winner: accuracyDelta > 0 ? "a" : "b", accuracyDelta, band, decidedBy: "accuracy" };
  }
  if (a.brierObjective !== b.brierObjective) {
    return { winner: a.brierObjective < b.brierObjective ? "a" : "b", accuracyDelta, band, decidedBy: "brier" };
  }
  return { winner: "tie", accuracyDelta, band, decidedBy: "exact-tie" };
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
  // D-2 (quick task 260903-krp): this batch's own `seasons` parameter is the
  // replay's declared season set.
  // D-2 (quick task 260903-n2o): the sentinel — `objectiveForCandidate` below
  // reads only `brierScore`, never `headlineEligible`.
  const slices = aggregateScores(predictions, { corpusSeasons: seasons, selectedOnSeasons: ELIGIBILITY_NOT_CLAIMED });
  assertNoFutureSeasonLeak(slices, boundary.season);
  return batch.map((c) => {
    const { perSeason, accuracyObjective, brierObjective } = objectiveForCandidate(slices, c.id);
    const accuracyBlocks = buildEventAccuracyBlocks(predictions, c.id);
    return { id: c.id, params: c.params, perSeason, accuracyObjective, brierObjective, accuracyBlocks };
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
  /** Both sides of an EXACT tie share identical objectives by definition — one pair of values suffices. */
  readonly accuracyObjective: number;
  readonly brierObjective: number;
  readonly winnerParams: Sigma1Params;
  readonly tiedParams: Sigma1Params;
}

/**
 * ALGO-04's deterministic tie-break (ADJACENCY edge), now routed through
 * `compareCandidates`'s noise-band lexicographic rule (OBJ-RANK, quick task
 * 260904-oiu) rather than a raw numeric comparison: candidates are compared
 * in GENERATION order; `winnerIndex` is only ever updated when the comparator
 * says the current candidate STRICTLY wins (`decidedBy: "accuracy"` or
 * `"brier"`), never on an exact tie — preserving today's
 * earlier-generation-wins-on-ties discipline. Every EXACT tie against the
 * then-current winner is recorded with BOTH candidates' full parameter sets,
 * so an objective that cannot separate two materially different
 * configurations is visible in the log rather than silently resolved.
 * `noiseBandResolvedCount` makes VISIBLE how often Brier — rather than
 * accuracy — actually decided a comparison, rather than that fact staying
 * invisible inside the comparator.
 *
 * Deterministic across repeated runs on identical input: `compareCandidates`
 * itself is pure and uses `eventBlockedBootstrap`'s fixed default seed, so
 * comparing the same array twice reproduces the same winner, the same ties,
 * and the same `noiseBandResolvedCount`.
 */
export function determineWinner(results: readonly EvaluatedCandidate[]): { winnerIndex: number; ties: TieRecord[]; noiseBandResolvedCount: number } {
  let winnerIndex = 0;
  const ties: TieRecord[] = [];
  let noiseBandResolvedCount = 0;
  for (let i = 1; i < results.length; i++) {
    const current = results[i]!;
    const winner = results[winnerIndex]!;
    const comparison = compareCandidates(winner, current);
    if (comparison.decidedBy === "brier") noiseBandResolvedCount += 1;
    if (comparison.winner === "b") {
      winnerIndex = i;
    } else if (comparison.winner === "tie") {
      ties.push({
        winnerIndex,
        tiedIndex: i,
        accuracyObjective: winner.accuracyObjective,
        brierObjective: winner.brierObjective,
        winnerParams: winner.params,
        tiedParams: current.params,
      });
    }
  }
  return { winnerIndex, ties, noiseBandResolvedCount };
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
      `Candidate ${results.indexOf(result)} (${result.id}): accuracy=${result.accuracyObjective.toFixed(6)} brier=${result.brierObjective.toFixed(6)}${
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
    objective: SEARCH_OBJECTIVE_DEFINITION,
    tieBreak: ties.length > 0 ? "accuracy AND brier tied across multiple candidates — lowest candidate index wins" : null,
    winnerIndex,
    // `accuracyBlocks` destructured OUT — per-event arrays that would bloat
    // the artifact for no reader (`objective` numeric field kept for
    // `promote.ts`'s existing readers, set to the PRIMARY (accuracy) value).
    candidates: results.map((result, index) => {
      const { accuracyBlocks, ...rest } = result;
      return { index, ...rest, objective: result.accuracyObjective, winner: index === winnerIndex };
    }),
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
      // The screen deliberately keeps reading the BRIER component — see
      // `SCREEN_OBJECTIVE_DEFINITION`'s own doc comment for why.
      return { value: c.value, brierScore: evaluatedCandidate.brierObjective, winnerAccuracy: evaluatedCandidate.perSeason[0]?.winnerAccuracy ?? null };
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
    objective: SCREEN_OBJECTIVE_DEFINITION,
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
  outPath: string,
  incumbentPath?: string
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

        // Routed through the comparator (OBJ-RANK, quick task 260904-oiu) so
        // the refinement pass and the final `determineWinner` ranking can
        // never disagree about which candidate is actually better.
        for (const candidate of evaluatedNeighbors) {
          if (compareCandidates(anchor, candidate).winner === "b") anchor = candidate;
        }
      }
    }

    const { winnerIndex, ties, noiseBandResolvedCount } = determineWinner(results);
    const winner = results[winnerIndex]!;
    console.log(
      `Noise-band comparator: ${noiseBandResolvedCount} of ${results.length - 1} comparisons were resolved by Brier ` +
        `(inside the accuracy noise band); the rest were decided by accuracy alone.`
    );

    const atBound: Record<string, boolean> = {};
    for (const key of survivors) {
      const bound = SIGMA1_SEARCH_SPACE[key];
      const value = (winner.params as unknown as Record<string, number>)[key]!;
      atBound[key] = value === bound.min || value === bound.max;
    }

    for (const result of results) {
      const index = results.indexOf(result);
      console.log(
        `Candidate ${index} (${result.id}): accuracy=${result.accuracyObjective.toFixed(6)} brier=${result.brierObjective.toFixed(6)}${
          index === winnerIndex ? " <- winner" : ""
        }`
      );
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
      noiseBandResolvedCount,
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
      incumbentVersionPath: incumbentPath,
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
  /** How many ranking comparisons in this run were decided by Brier (inside the accuracy noise band) rather than by accuracy alone (OBJ-RANK). */
  noiseBandResolvedCount: number;
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
    objective: SEARCH_OBJECTIVE_DEFINITION,
    evals: input.evalsCount,
    seed: input.seed,
    batch: input.batchSize,
    survivorsPath: input.survivorsPath,
    survivors: [...input.survivors],
    skipped: input.skipped,
    rejectedCandidates: input.rejectedCandidates,
    tieBreak: input.ties.length > 0 ? "accuracy AND brier tied across multiple candidates — lowest candidate index wins" : null,
    ties: input.ties,
    winnerIndex: input.winnerIndex,
    // How often Brier actually decided a comparison — VISIBLE rather than
    // invisible inside the comparator (OBJ-RANK's own must-have truth).
    noiseBandResolvedCount: input.noiseBandResolvedCount,
    atBound: input.atBound,
    // `accuracyBlocks` destructured OUT — see the tracer artifact's identical
    // comment above; `objective` kept as the numeric PRIMARY (accuracy) value
    // for `promote.ts`'s existing readers.
    candidates: input.results.map((result, index) => {
      const { accuracyBlocks, ...rest } = result;
      return { index, ...rest, objective: result.accuracyObjective, winner: index === input.winnerIndex };
    }),
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
 *
 * DO NOT MOVE this off `tuned-2026-08` (quick task 260904-2i9). Every other
 * promoted-version path in the repo collapsed into
 * `packages/harness/promotedVersionPath.ts` and now follows the live pin
 * (currently `rolling-2026-09`) — this constant is the ONE deliberate
 * exception. It stays on `tuned-2026-08` because it is the D-T7 acceptance
 * BASELINE against which TEN verdicts are already recorded (`tune.test.ts`
 * and the search history reference it by that identity). Repointing it to
 * follow a future re-pin would silently redefine what "the incumbent" meant
 * in results already written down — it is not an oversight left behind by
 * the pin move, and it must never be "fixed" into agreement with
 * `promotedVersionPath.ts`.
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
  /**
   * `0` for an actual tie (excluded from the accuracy denominator entirely),
   * `1` otherwise. SHARED between both models — it is a fact about the
   * MATCH's real outcome, not about either model's call — so
   * `buildPairedOriginUnits` asserts both rows agree rather than picking one
   * arbitrarily (quick task 260904-oiu, OBJ-BAR).
   */
  readonly accuracyDenominator: 0 | 1;
  /** Whether the candidate's call was correct; `null` iff `accuracyDenominator` is 0 (no call to have been right or wrong about). Computed with `brier.ts`'s `accuracyCall` — the SAME predicate `scoreSet` uses. */
  readonly candidateCorrect: boolean | null;
  readonly incumbentCorrect: boolean | null;
}

/** Per-model per-match row, before pairing. */
interface OriginScoredRow extends EventBlockedUnit {
  readonly matchKey: string;
  readonly brier: number;
  readonly absoluteError: number;
  readonly accuracyDenominator: 0 | 1;
  readonly correct: boolean | null;
}

function scoreOriginRows(predictions: readonly ReplayedPrediction[], algorithmId: string, originSeason: number): OriginScoredRow[] {
  const rows: OriginScoredRow[] = [];
  for (const p of predictions) {
    if (p.algorithmId !== algorithmId || p.season !== originSeason) continue;
    // The SAME exclusions `aggregateScores` applies, mirrored via
    // `isScorablePrediction` so Brier, MAE and accuracy describe one
    // population and this can never silently diverge from the tuner's own
    // accuracy blocks (`buildEventAccuracyBlocks`, quick task 260904-oiu).
    // Two populations would make the acceptance rule's conditions
    // incomparable and would reintroduce, inside the measuring instrument,
    // exactly the silent-narrowing failure `score.ts`'s quarantine bounds
    // exist to prevent.
    if (!isScorablePrediction(p)) continue;
    // The SAME correctness predicate `scoreSet` uses — never a local
    // re-derivation (OBJ-RANK/OBJ-BAR's anti-drift requirement).
    const call = accuracyCall({ pRedWin: p.pRedWin, actualWinner: p.actualWinner });
    rows.push({
      eventKey: p.eventKey,
      matchKey: p.matchKey,
      brier: (p.pRedWin - outcomeTarget(p.actualWinner)) ** 2,
      absoluteError:
        (Math.abs(p.predictedRedScore - p.actualRedScore) + Math.abs(p.predictedBlueScore - p.actualBlueScore)) / 2,
      accuracyDenominator: call === null ? 0 : 1,
      correct: call,
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
 * So a mismatch throws here rather than degrading quietly. Also asserts the
 * two rows' `accuracyDenominator` agree for each paired match — it is a fact
 * about the match's real outcome, so a mismatch here would mean the two
 * models were scored against different ground truth, which is a bug, not a
 * modeling difference.
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
    if (candidate.accuracyDenominator !== incumbent.accuracyDenominator) {
      throw new Error(
        `tune: cannot pair the origin-season comparison — match "${candidate.matchKey}" has DIFFERENT accuracy denominators ` +
          `between the candidate (${candidate.accuracyDenominator}) and the incumbent (${incumbent.accuracyDenominator}). This is a ` +
          `fact about the match's real outcome (a tie), not about either model's call, so the two must agree.`
      );
    }
    units.push({
      eventKey: candidate.eventKey,
      matchKey: candidate.matchKey,
      candidateBrier: candidate.brier,
      incumbentBrier: incumbent.brier,
      candidateAbsoluteError: candidate.absoluteError,
      incumbentAbsoluteError: incumbent.absoluteError,
      accuracyDenominator: candidate.accuracyDenominator,
      candidateCorrect: candidate.correct,
      incumbentCorrect: incumbent.correct,
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
  /** Mean winner accuracy over the paired units' shared accuracy denominator (quick task 260904-oiu, OBJ-BAR). */
  readonly candidateAccuracy: number;
  readonly incumbentAccuracy: number;
  readonly candidateBrier: number;
  readonly incumbentBrier: number;
  readonly candidateMae: number;
  readonly incumbentMae: number;
  /** PAIRED event-blocked SE of `candidateAccuracy - incumbentAccuracy` — the quantity D-T7's bar is now ON (quick task 260904-oiu). */
  readonly accuracyDeltaStandardError: number;
  /** PAIRED event-blocked SE of `candidateBrier - incumbentBrier` — feeds ONLY the Brier guardrail now, never the bar. */
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
  accuracyDeltaStandardError: number;
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

  const accuracyDenominatorSum = input.units.reduce((sum, u) => sum + u.accuracyDenominator, 0);
  const candidateCorrectSum = input.units.reduce((sum, u) => sum + (u.accuracyDenominator === 1 && u.candidateCorrect ? 1 : 0), 0);
  const incumbentCorrectSum = input.units.reduce((sum, u) => sum + (u.accuracyDenominator === 1 && u.incumbentCorrect ? 1 : 0), 0);
  const candidateAccuracy = candidateCorrectSum / accuracyDenominatorSum;
  const incumbentAccuracy = incumbentCorrectSum / accuracyDenominatorSum;

  const outcome = decideAcceptance({
    incumbentAccuracy,
    candidateAccuracy,
    incumbentBrier,
    candidateBrier,
    incumbentMae,
    candidateMae,
    accuracyStandardError: input.accuracyDeltaStandardError,
    brierStandardError: input.brierDeltaStandardError,
    maeStandardError: input.maeDeltaStandardError,
    evaluationCount: input.evaluationCount,
  });

  // One plain sentence per case. `keep-incumbent` reads as a RESULT, not as a
  // failure — see `acceptance.ts`'s header; a report that phrases it as a
  // failure is how an operator gets talked into widening the bar.
  //
  // The shared prefix is SIGN-NEUTRAL, and must stay that way (260904-4ik's
  // hard-won fix, carried forward through the accuracy-primary rewrite).
  // `outcome.accuracyMargin` is SIGNED (`candidateAccuracy - incumbentAccuracy`),
  // so it is negative for every candidate that is genuinely less accurate. A
  // directional verb in a prefix all four branches reuse would assert the
  // OPPOSITE of the number beside it on those outcomes — exactly the hazard
  // that once rendered a loss as a near-miss. Report the number; claim no side.
  //
  // The prefix's TRAILING clause is load-bearing grammar: both veto branches
  // concatenate `${shared} and was cleared`, where "cleared" refers to *the
  // bar* the tail names. Restructuring that tail breaks those branches'
  // sentences while every assertion still passes.
  const shared =
    `Origin ${input.originSeason}: the search evaluated ${input.evaluationCount} candidates on ${input.selectionSeasons.join(", ")} ` +
    `and its winner's out-of-sample ACCURACY margin over the incumbent (${input.incumbentVersion}) was ${outcome.accuracyMargin.toFixed(6)} ` +
    `over ${n} matches across ${input.eventCount} events; the bar at N = ${input.evaluationCount} was ${outcome.threshold.toFixed(6)}`;
  const verdict =
    outcome.decision === "accept"
      ? `${shared}, so the candidate is ACCEPTED (score-MAE delta ${outcome.maeDelta.toFixed(4)}, inside the guardrail's ` +
        `${outcome.maeVetoBound.toFixed(4)} bound; Brier delta ${outcome.brierDelta.toFixed(6)}, inside the guardrail's ` +
        `${outcome.brierVetoBound.toFixed(6)} bound).`
      : outcome.reason === "below-threshold"
        ? `${shared}, so the INCUMBENT STANDS. Nothing cleared a pre-committed bar, which is a completed search, not a failed one.`
        : outcome.reason === "mae-veto"
          ? `${shared} and was cleared — but the candidate worsens alliance-score MAE by ${outcome.maeDelta.toFixed(4)} points, past the ` +
            `guardrail's ${outcome.maeVetoBound.toFixed(4)} bound, so it is VETOED and the INCUMBENT STANDS. D-T7's guardrail exists because ` +
            `the vpr@3.0.0 fix shipped a 16% score-MAE regression that Brier and SD(z) both rated equal-or-better.`
          : `${shared} and was cleared — but the candidate is more accurate at the cost of a Brier regression of ${outcome.brierDelta.toFixed(6)}, ` +
            `past the guardrail's ${outcome.brierVetoBound.toFixed(6)} bound, so it is VETOED and the INCUMBENT STANDS. A challenger more ` +
            `accurate but materially worse-calibrated is not shipped (quick task 260904-oiu).`;

  return {
    originSeason: input.originSeason,
    selectionSeasons: [...input.selectionSeasons],
    incumbentVersionPath: input.incumbentVersionPath,
    incumbentVersion: input.incumbentVersion,
    matchCount: n,
    eventCount: input.eventCount,
    candidateAccuracy,
    incumbentAccuracy,
    candidateBrier,
    incumbentBrier,
    candidateMae,
    incumbentMae,
    accuracyDeltaStandardError: input.accuracyDeltaStandardError,
    brierDeltaStandardError: input.brierDeltaStandardError,
    brierLevelStandardError: input.brierLevelStandardError,
    maeDeltaStandardError: input.maeDeltaStandardError,
    outcome,
    verdict,
  };
}

/**
 * Reads the committed incumbent and builds a runnable module for it. Throws
 * by name if it is missing rather than substituting `DEFAULT_SIGMA1_PARAMS`
 * — see `INCUMBENT_VERSION_PATH`.
 *
 * D-2 (quick task 260904-100): returns a built `AlgorithmModule`, via
 * `makeSeasonalSigma1`, rather than a bare `{ params, version }` pair. The
 * OLD shape hand-rolled `JSON.parse(...) as { params?: unknown }` and pushed
 * `raw.params` straight into `Sigma1ParamsSchema.parse` — `tsc` cannot flag
 * that as broken by a `paramSetsBySeason` file (both sides are already
 * `unknown`/optional), so a per-season incumbent would have failed with an
 * opaque Zod error instead of a named one. Parsing through
 * `PromotedVersionSchema` first gives a named, schema-validated error for
 * either file shape, and the returned module's own `id`/`params` are
 * whichever season's set actually governs each replayed match.
 */
export function loadIncumbent(path: string = INCUMBENT_VERSION_PATH, id = "acceptance-incumbent"): AlgorithmModule<any> {
  if (!existsSync(path)) {
    throw new Error(
      `tune: the incumbent version file ${path} does not exist. D-T7's bar is "beats what SHIPS", and the shipped parameter set is ` +
        `NOT DEFAULT_SIGMA1_PARAMS (the promoted set carries overrides that exist nowhere else). Refusing to silently substitute the defaults.`
    );
  }
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const promoted = PromotedVersionSchema.parse(raw);
  return makeSeasonalSigma1(promoted, { id, linkMode: "predictive-variance" });
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
    /** `--incumbent`: compare against this version file instead of the frozen `INCUMBENT_VERSION_PATH` default. */
    incumbentVersionPath?: string;
  }
): Promise<OriginAcceptanceReport> {
  const CANDIDATE_ID = "acceptance-candidate";
  const INCUMBENT_ID = "acceptance-incumbent";
  // D-2 (quick task 260904-100): `loadIncumbent` now returns a built module
  // directly (routed through `makeSeasonalSigma1`) rather than a
  // `{ params, version }` pair rebuilt here with a bare `makeSigma1` call —
  // see `loadIncumbent`'s own doc comment for why that bare rebuild was the
  // one `tsc` could not have caught.
  const incumbent = loadIncumbent(input.incumbentVersionPath, INCUMBENT_ID);

  const algorithms = [
    makeSigma1({ id: CANDIDATE_ID, linkMode: "predictive-variance", params: input.winnerParams }),
    incumbent,
  ];
  const replaySeasons = [...input.selectionSeasons, input.originSeason].sort((a, b) => a - b);
  const predictions = await runBoundedSeasons(db, replaySeasons, algorithms, input.eventsLimit);

  // D-2 (quick task 260903-krp): `replaySeasons` (selection seasons plus the
  // origin) is this run's declared season set.
  // D-2 (quick task 260903-n2o): the sentinel — `assertNoFutureSeasonLeak`
  // reads only `season`, never `headlineEligible`.
  assertNoFutureSeasonLeak(
    aggregateScores(predictions, { corpusSeasons: replaySeasons, selectedOnSeasons: ELIGIBILITY_NOT_CLAIMED }),
    input.originSeason + 1
  );

  const units = buildPairedOriginUnits(
    scoreOriginRows(predictions, CANDIDATE_ID, input.originSeason),
    scoreOriginRows(predictions, INCUMBENT_ID, input.originSeason)
  );

  // PAIRED differences for the accuracy, Brier and MAE axes — one resample of
  // events, every model scored on the same draw. `eventBootstrap.ts`'s header
  // explains why the paired SE, not either side's level SE, is the faithful
  // quantity for a bar that is itself on a difference.
  //
  // Accuracy delta (quick task 260904-oiu, OBJ-BAR): the resampled statistic
  // is the difference of the two summed correct-counts over the summed
  // accuracy denominator — mirroring the noise-band comparator's own paired
  // accuracy statistic (`tune.ts`'s `accuracyDeltaStandardError`). Throws by
  // NAME if a resampled draw's denominator is zero (every resampled event was
  // all-ties) rather than silently returning `NaN`.
  const accuracyDelta = eventBlockedBootstrap(units, (sample) => {
    let candidateCorrectSum = 0;
    let incumbentCorrectSum = 0;
    let denominatorSum = 0;
    for (const u of sample) {
      denominatorSum += u.accuracyDenominator;
      if (u.accuracyDenominator === 1) {
        if (u.candidateCorrect) candidateCorrectSum += 1;
        if (u.incumbentCorrect) incumbentCorrectSum += 1;
      }
    }
    if (denominatorSum === 0) {
      throw new Error(
        `tune: a resampled origin-season accuracy-delta draw had an accuracy denominator of 0 — every resampled event was an ` +
          `actual tie, so the accuracy delta cannot be computed for this draw.`
      );
    }
    return (candidateCorrectSum - incumbentCorrectSum) / denominatorSum;
  });
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
    incumbentVersionPath: input.incumbentVersionPath ?? INCUMBENT_VERSION_PATH,
    incumbentVersion: incumbent.version,
    units,
    eventCount: brierDelta.eventCount,
    accuracyDeltaStandardError: accuracyDelta.standardError,
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
      // D-T7's bar is "beats what SHIPS". `INCUMBENT_VERSION_PATH` is frozen
      // on `tuned-2026-08` (the baseline of the ten recorded verdicts — see
      // its own comment), so when the live pin has moved past that identity
      // the operator points the acceptance comparison at the currently
      // shipping version file with this flag instead of repointing the
      // constant. Joint stage only; the winner search never reads it.
      incumbent: { type: "string" },
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
    await runJointStage(values.origin, values.seasons, eventsLimit, evalsCount, seed, batchSize, survivorsPath, adaptationSpec, outPath, values.incumbent);
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
