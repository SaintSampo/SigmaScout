/**
 * Walk-forward replay driver (EVAL-01). This is the phase's signature
 * guarantee: `WalkForwardSimulator` owns the only reference to the
 * chronological match list, and every algorithm call site goes through
 * `toLeakProofUpcoming`, whose Proxy `get` trap throws for any
 * outcome-bearing property name — a runtime fact, not a type-level
 * convention that a cast could bypass (RESEARCH.md Pattern 1,
 * ARCHITECTURE.md Pattern 1).
 */
import type { AlgorithmModule, MatchResult, Prediction, UpcomingMatch } from "../core/algorithms/types.js";
import { selectMatchesChronological, type Corpus } from "../corpus/db.js";

/**
 * Properties that exist on `MatchResult` but not `UpcomingMatch` — the
 * exact set an algorithm's `predict()` must never observe.
 */
const OUTCOME_KEYS = new Set<string>([
  "winner",
  "redScore",
  "blueScore",
  "redRpEarned",
  "blueRpEarned",
  "hasScoreBreakdown",
  "scoreBreakdownRaw",
]);

/**
 * Shared throw helper (D-A/T-Q2x6-01) — the `get` and `getOwnPropertyDescriptor`
 * traps both call this so the two surfaces can never drift onto two different
 * message strings.
 */
function denyOutcomeKey(target: MatchResult, prop: string): never {
  throw new Error(
    `Outcome leakage: attempted to read "${prop}" on match ${target.matchKey} before predict() completed`
  );
}

export function toLeakProofUpcoming(result: MatchResult): UpcomingMatch {
  return new Proxy(result, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && OUTCOME_KEYS.has(prop)) {
        denyOutcomeKey(target, prop);
      }
      return Reflect.get(target, prop, receiver);
    },
    // A direct descriptor probe has no innocent reading — it should fail as
    // loudly as a direct property read does (D-A).
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === "string" && OUTCOME_KEYS.has(prop)) {
        denyOutcomeKey(target, prop);
      }
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    // Unlike `get`/`getOwnPropertyDescriptor`, `ownKeys` has no per-key call
    // shape — it returns a list or throws for the WHOLE object. Throwing
    // here would blow up every benign whole-object operation (`console.log`,
    // `util.inspect`, spread, `JSON.stringify`) since every `MatchResult`
    // carries all 7 outcome keys, so filtering is the only workable choice
    // (D-A). Omitting configurable own keys of an extensible target is
    // invariant-legal (D-B) — `MatchResult` objects are plain object
    // literals built in packages/corpus/db.ts and are never frozen/sealed.
    ownKeys(target) {
      return Reflect.ownKeys(target).filter((key) => !(typeof key === "string" && OUTCOME_KEYS.has(key)));
    },
  }) as UpcomingMatch;
}

export interface PredictionRecord {
  match: MatchResult;
  prediction: Prediction;
}

/** D-22: one (match, algorithm) prediction from a multi-algorithm shared-stream run. */
export interface MultiAlgorithmPredictionRecord {
  match: MatchResult;
  algorithmId: string;
  prediction: Prediction;
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

  constructor(chronologicalMatches: readonly MatchResult[]) {
    this.#matches = chronologicalMatches;
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
      const prediction = algorithm.predict(state, toLeakProofUpcoming(result));
      predictions.push({ match: result, prediction });
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
   * The returned array also carries a `finalStates` property (each
   * algorithm's state after the last replayed match) — an intersection
   * type rather than a wrapper object, so every existing caller that treats
   * the return value as a plain `MultiAlgorithmPredictionRecord[]` keeps
   * working unchanged; only a caller that needs to THREAD state across a
   * season boundary (plan 02-03's `runSeasons`) reads `.finalStates`.
   */
  runAll(
    algorithms: readonly AlgorithmModule<any>[],
    teams: readonly string[],
    initialStates?: ReadonlyMap<string, unknown>,
    onMatchComplete?: (match: MatchResult, algorithmId: string, state: unknown) => void
  ): MultiAlgorithmPredictionRecord[] & { finalStates: ReadonlyMap<string, unknown> } {
    const states = new Map<string, unknown>(
      algorithms.map((algorithm) => [algorithm.id, initialStates?.get(algorithm.id) ?? algorithm.initState([...teams])])
    );
    const records: MultiAlgorithmPredictionRecord[] = [];

    for (const result of this.#matches) {
      const upcoming = toLeakProofUpcoming(result);
      for (const algorithm of algorithms) {
        const state = states.get(algorithm.id);
        const prediction = algorithm.predict(state, upcoming);
        records.push({ match: result, algorithmId: algorithm.id, prediction });
        const nextState = algorithm.update(state, result);
        states.set(algorithm.id, nextState);
        onMatchComplete?.(result, algorithm.id, nextState);
      }
    }

    return Object.assign(records, { finalStates: states });
  }
}
