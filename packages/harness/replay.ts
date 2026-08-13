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
]);

export function toLeakProofUpcoming(result: MatchResult): UpcomingMatch {
  return new Proxy(result, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && OUTCOME_KEYS.has(prop)) {
        throw new Error(
          `Outcome leakage: attempted to read "${prop}" on match ${target.matchKey} before predict() completed`
        );
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as UpcomingMatch;
}

export interface PredictionRecord {
  match: MatchResult;
  prediction: Prediction;
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
}
