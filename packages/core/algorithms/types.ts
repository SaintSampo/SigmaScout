/**
 * Shared, framework-agnostic algorithm contract (RESEARCH.md Pattern 1,
 * ARCHITECTURE.md Pattern 1). This module must stay importable unchanged by
 * the Phase 4 Cloudflare Worker — no Node-only APIs, no better-sqlite3, no
 * Cloudflare bindings.
 *
 * `predict` and `update` are pure: neither may mutate its `state` argument.
 * `predict` never receives outcome-bearing fields (see
 * `packages/harness/replay.ts`'s `toLeakProofUpcoming`, which enforces this
 * at runtime for every call site inside the walk-forward simulator).
 */

export type CompLevel = "qm" | "ef" | "qf" | "sf" | "f";

/** A match with no outcome-bearing fields at all — deliberately. */
export interface UpcomingMatch {
  matchKey: string;
  eventKey: string;
  compLevel: CompLevel;
  setNumber: number;
  matchNumber: number;
  redTeams: string[];
  blueTeams: string[];
  redSurrogates: string[];
  blueSurrogates: string[];
}

/** A completed match — the only place outcome fields exist. */
export interface MatchResult extends UpcomingMatch {
  winner: "red" | "blue" | "tie";
  redScore: number;
  blueScore: number;
  redRpEarned: number | null;
  blueRpEarned: number | null;
  hasScoreBreakdown: boolean;
}

export interface Prediction {
  winner: "red" | "blue";
  /** Predicted probability the red alliance wins, in the closed interval [0, 1]. */
  pRedWin: number;
  redScore: number;
  blueScore: number;
  /** Optional variance channel — left unpopulated by OPR, populated by later algorithms. */
  variance?: number;
}

export interface AlgorithmModule<S> {
  id: string;
  version: string;
  initState(teams: string[]): S;
  /** Read-only with respect to outcomes: never touches match results. */
  predict(state: S, match: UpcomingMatch): Prediction;
  /** The only place a match's outcome is read. */
  update(state: S, result: MatchResult): S;
}
