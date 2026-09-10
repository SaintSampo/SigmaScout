/**
 * Walk-forward replay driver (EVAL-01). This is the phase's signature
 * guarantee: `WalkForwardSimulator` owns the only reference to the
 * chronological match list, and every algorithm call site goes through
 * `toLeakProofUpcoming`, whose Proxy guards outcome-bearing properties on
 * three surfaces — `get` and `getOwnPropertyDescriptor` both throw for a
 * direct read/probe of any outcome key, while `ownKeys` instead OMITS
 * outcome keys from enumeration (`Object.keys`, `for...in`, spread,
 * `JSON.stringify`), since a whole-object operation has no per-key failure
 * shape to throw into — a runtime fact, not a type-level convention that a
 * cast could bypass (RESEARCH.md Pattern 1, ARCHITECTURE.md Pattern 1).
 * The `ownKeys` omission is invariant-legal only while every `MatchResult`
 * stays an extensible plain object literal with configurable properties
 * (built in packages/corpus/db.ts); freezing/sealing one instead turns
 * this guarantee into a loud engine `TypeError`, never silent leakage.
 *
 * `toLeakProofUpcoming`/`OUTCOME_KEYS` themselves now live in
 * `packages/core/algorithms/leakProof.ts` (04-01-PLAN.md Task 3): this file
 * imports `packages/corpus/db.ts`, which pulls in `better-sqlite3`, so it is
 * not importable by the Phase 4 Cloudflare Worker — the guard had to move to
 * a module the Worker CAN import. Re-exported below so every existing call
 * site in this repo keeps its `from "../harness/replay.js"` import path.
 */
import type { AlgorithmModule, MatchResult, Prediction } from "../core/algorithms/types.js";
import { toLeakProofUpcoming } from "../core/algorithms/leakProof.js";
import { isOfficialEventType } from "../core/algorithms/eventTypes.js";
import { applyColdStartTie, NO_COLD_START_INDEX } from "../core/scoring/coldStart.js";
import { selectMatchesChronological, type Corpus } from "../corpus/db.js";

export { toLeakProofUpcoming, OUTCOME_KEYS } from "../core/algorithms/leakProof.js";

export interface PredictionRecord {
  match: MatchResult;
  prediction: Prediction;
  /**
   * The SigmaScout-layer match band for this match (quick task 260908-5wd) —
   * each alliance's variance as `Σ its three teams' Swing Factor²`, walk-forward
   * as of this match. Optional because it is attached by `publish.ts` AFTER the
   * replay, not produced by any algorithm: see `swingFactor.ts`'s header for the
   * two-level split this field belongs to (a scouting heuristic layered on top
   * of whatever the algorithm predicted, computed identically for OPR, EPA, BPR
   * and VPR alike).
   *
   * Attached to the ONE record object that both the event-artifact builder and
   * the team-artifact builder read, which is what makes a match's band
   * byte-identical on an event page and a team page rather than merely intended
   * to be.
   */
  swingBand?: { red?: number; blue?: number };
  /**
   * D-01/D-02 (quick task 260909-t5q): present ONLY when `true` — the single
   * source of truth for whether `WalkForwardSimulator` recognized this match
   * as cold start (all six robots making their corpus-global first
   * appearance) and forced `prediction.pRedWin` to exactly 0.5. Every
   * downstream consumer (`packages/harness/score.ts`'s
   * `HarnessPredictionInput.isColdStart`, the published Compare/match-table
   * surfaces) reads THIS stamp rather than re-deriving the predicate, so the
   * unified answer cannot drift as it is threaded through the pipeline.
   */
  coldStart?: true;
}

/** D-22: one (match, algorithm) prediction from a multi-algorithm shared-stream run. */
export interface MultiAlgorithmPredictionRecord {
  match: MatchResult;
  algorithmId: string;
  prediction: Prediction;
  /** See `PredictionRecord.coldStart`'s doc comment for the full contract — identical here. */
  coldStart?: true;
}

/** Options for `buildSeasonStream`. */
export interface SeasonStreamOptions {
  /**
   * Include matches from events flagged `is_offseason` (default: excluded,
   * per D-06). Scoring (`aggregateScores`) always excludes offseason
   * matches regardless of this flag — this only controls whether they are
   * REPLAYED (fed through the algorithm's `predict`/`update`) at all.
   * Phase 4 needs an offseason event replayable for its live-freshness
   * test, so the capability must exist even though scoring never uses it
   * by default.
   */
  includeOffseason?: boolean;
}

/**
 * Builds the single chronological match list for a whole season, across
 * every event in it, not one event at a time. Delegates ordering entirely
 * to `selectMatchesChronological` (packages/corpus/db.ts) rather than
 * re-sorting in memory, so exactly one definition of chronological order
 * exists in the system: the same total order (sort_time, then event_key,
 * then comp-level play order, then set_number, then match_number) Plan 03
 * proved and this replay never has the chance to silently diverge from.
 *
 * This is what makes cross-event interleaving correct: two events running
 * concurrently in real time contribute matches to a single merged stream
 * ordered by when they were actually played, not grouped by event —
 * replaying one event to completion before starting the next would let a
 * team's rating reflect a concurrent event that had not finished yet in
 * real time, a subtle form of the leakage this phase exists to eliminate.
 */
export function buildSeasonStream(
  corpus: Corpus,
  season: number,
  options: SeasonStreamOptions = {}
): MatchResult[] {
  return selectMatchesChronological(corpus, {
    year: season,
    excludeOffseason: !options.includeOffseason,
  });
}

export class WalkForwardSimulator {
  readonly #matches: readonly MatchResult[];
  readonly #coldStartIndex: ReadonlySet<string>;

  /**
   * `coldStartIndex` (D-01, quick task 260909-t5q) defaults to
   * `NO_COLD_START_INDEX` — every existing caller that does not pass one is
   * provably unaffected. The simulator CANNOT derive this itself: it holds
   * only one season's (or one event's) stream, and building an index from
   * that alone would silently produce D-01's REJECTED season-global
   * definition rather than the required corpus-global one. A caller with a
   * corpus-global view must build a real index (e.g.
   * `packages/harness/corpusColdStart.ts`'s `corpusColdStartIndex`) and pass
   * it explicitly.
   */
  constructor(chronologicalMatches: readonly MatchResult[], coldStartIndex: ReadonlySet<string> = NO_COLD_START_INDEX) {
    this.#matches = chronologicalMatches;
    this.#coldStartIndex = coldStartIndex;
  }

  /**
   * For each match, strictly in the supplied chronological order: calls
   * `predict` with a leak-proof wrapper, records the prediction, and only
   * then calls `update` with the real result. Nothing may reorder those
   * two calls, and the underlying array is never handed to algorithm code.
   *
   * Works identically whether `chronologicalMatches` is a single event's
   * list or a whole season's `buildSeasonStream` output: `initState` is
   * called exactly once, right here, and every match in the supplied list
   * shares that one algorithm state through to the end of the run —
   * season-scope pooling is a property of calling this once over the
   * whole season's stream, not something this method needs to know about.
   */
  run<S>(algorithm: AlgorithmModule<S>, teams: readonly string[]): PredictionRecord[] {
    let state = algorithm.initState([...teams]);
    const predictions: PredictionRecord[] = [];
    for (const result of this.#matches) {
      const rawPrediction = algorithm.predict(state, toLeakProofUpcoming(result));
      // D-01: the stamp is the single source of truth — nothing downstream
      // re-derives cold start, every consumer reads this.
      const isColdStart = this.#coldStartIndex.has(result.matchKey);
      const prediction = isColdStart ? applyColdStartTie(rawPrediction) : rawPrediction;
      predictions.push({ match: result, prediction, ...(isColdStart ? { coldStart: true as const } : {}) });
      // The `update` call is UNCHANGED — a cold-start match still teaches
      // the algorithm (this is the match that ends the team's cold-start
      // status for every LATER match), it just is not scored (D-02).
      state = algorithm.update(state, result);
    }
    return predictions;
  }

  /**
   * D-22: drives EVERY supplied algorithm over one shared chronological
   * stream — `initState` once per algorithm (or, when `initialStates`
   * supplies an entry for an algorithm's id, that carried-in state instead
   * — plan 02-03's season-boundary threading, D-16), then a single outer
   * loop over `this.#matches`; for each match, an inner loop over
   * algorithms calling `predict(state, toLeakProofUpcoming(result))`, then
   * `update`. Exactly one `toLeakProofUpcoming(result)` value is built per
   * match and shared across the inner algorithm loop, so every algorithm
   * provably receives the identical object for that match — any score
   * difference is the algorithm, not the data. `onMatchComplete`, when
   * supplied, is invoked immediately after each algorithm's `update` — the
   * seam plan 02-05 uses for D-28's per-match metric-history snapshots;
   * unused by this plan.
   *
   * The returned array also carries TWO state maps — an intersection type
   * rather than a wrapper object, so every existing caller that treats the
   * return value as a plain `MultiAlgorithmPredictionRecord[]` keeps working
   * unchanged. They answer different questions and are NOT interchangeable:
   *
   *   - `finalStates` — each algorithm's state after the LAST REPLAYED
   *     MATCH, whatever kind of event it belonged to. The honest "where this
   *     replay ended" value: what cumulative telemetry must read (a
   *     since-start counter has to see the whole season), what the D-12 live
   *     Worker seed must read (the Worker resumes the real, offseason-
   *     inclusive season), and what a MEASURED comparison against an
   *     external reference must read.
   *   - `carryStates` — the state a season-boundary threading site must
   *     hand `carrySeason` (quick task 260908-615). Identical to
   *     `finalStates` for every algorithm except one declaring
   *     `carryFrom: "last-official-match"`, whose entry is instead the state
   *     immediately after this stream's last OFFICIAL match
   *     (`isOfficialEventType` — neither offseason nor preseason Week 0), so
   *     exhibition play cannot seed the next season's prior.
   *
   * Fallback: an algorithm that declares the last-official instant but whose
   * stream contained no official match at all (an offseason-only slice, a
   * truncated diagnostic stream) records no snapshot, so its `carryStates`
   * entry falls back to its final state — never `undefined`.
   *
   * Identity: when every replayed match is official, `carryStates` agrees
   * with `finalStates` entry-for-entry (the same state objects, by
   * reference), so an all-official run is unchanged by this mechanism.
   */
  runAll(
    algorithms: readonly AlgorithmModule<any>[],
    teams: readonly string[],
    initialStates?: ReadonlyMap<string, unknown>,
    onMatchComplete?: (match: MatchResult, algorithmId: string, state: unknown) => void
  ): MultiAlgorithmPredictionRecord[] & {
    finalStates: ReadonlyMap<string, unknown>;
    carryStates: ReadonlyMap<string, unknown>;
  } {
    const states = new Map<string, unknown>(
      algorithms.map((algorithm) => [algorithm.id, initialStates?.get(algorithm.id) ?? algorithm.initState([...teams])])
    );
    const records: MultiAlgorithmPredictionRecord[] = [];
    // Quick task 260908-615: post-update state after the most recent
    // OFFICIAL match, recorded only for algorithms that ask for it. Empty
    // for every algorithm today except EPA.
    const lastOfficialStates = new Map<string, unknown>();
    const wantsLastOfficial = algorithms.some((algorithm) => algorithm.carryFrom === "last-official-match");

    for (const result of this.#matches) {
      const upcoming = toLeakProofUpcoming(result);
      // Officialness is a property of the MATCH, not of any algorithm, so it
      // is computed once per match rather than once per (match, algorithm) —
      // keeping the inner loop's shape unchanged for the common case where
      // no algorithm asks for the last-official instant at all.
      const isOfficial = wantsLastOfficial && isOfficialEventType(result.eventType);
      // D-01: also a property of the MATCH, not of any algorithm — computed
      // once per match so every algorithm this run scores over the SAME
      // match receives the identical cold-start answer (this IS D-01's
      // unification, mechanically: one lookup shared across the inner loop).
      const isColdStart = this.#coldStartIndex.has(result.matchKey);
      for (const algorithm of algorithms) {
        const state = states.get(algorithm.id);
        const rawPrediction = algorithm.predict(state, upcoming);
        const prediction = isColdStart ? applyColdStartTie(rawPrediction) : rawPrediction;
        records.push({
          match: result,
          algorithmId: algorithm.id,
          prediction,
          ...(isColdStart ? { coldStart: true as const } : {}),
        });
        const nextState = algorithm.update(state, result);
        states.set(algorithm.id, nextState);
        // The stream is chronological, so the LAST write here is by
        // construction the state immediately after the season's final
        // official match — no scan back, no second pass.
        if (isOfficial && algorithm.carryFrom === "last-official-match") {
          lastOfficialStates.set(algorithm.id, nextState);
        }
        onMatchComplete?.(result, algorithm.id, nextState);
      }
    }

    const carryStates = new Map<string, unknown>(states);
    for (const [algorithmId, officialState] of lastOfficialStates) {
      carryStates.set(algorithmId, officialState);
    }

    return Object.assign(records, { finalStates: states, carryStates });
  }
}
