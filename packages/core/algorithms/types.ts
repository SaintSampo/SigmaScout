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
  readonly redTeams: readonly string[];
  readonly blueTeams: readonly string[];
  readonly redSurrogates: readonly string[];
  readonly blueSurrogates: readonly string[];
}

/** A completed match — the only place outcome fields exist. */
export interface MatchResult extends UpcomingMatch {
  winner: "red" | "blue" | "tie";
  redScore: number;
  blueScore: number;
  redRpEarned: number | null;
  blueRpEarned: number | null;
  hasScoreBreakdown: boolean;
  /**
   * Verbatim TBA `score_breakdown` JSON for this match, or `null` when TBA
   * omitted it (`hasScoreBreakdown === false`). D-02/D-27: this is the raw
   * input a per-season `breakdown/*.ts` component map parses into
   * `ParsedComponents` — never parsed here, `packages/corpus` stays
   * season-agnostic by design. Outcome-bearing: added to
   * `packages/harness/replay.ts`'s `OUTCOME_KEYS` in the same commit that
   * adds this field, so the leak-proof Proxy guards it identically to every
   * other outcome field.
   */
  scoreBreakdownRaw: string | null;
}

/** D-24: one component's predicted contribution to an alliance's score. */
export interface ComponentPrediction {
  mean: number;
  /** Present only for algorithms carrying variance (Sigma1). */
  variance?: number;
}

export interface Prediction {
  winner: "red" | "blue";
  /** Predicted probability the red alliance wins, in the closed interval [0, 1]. */
  pRedWin: number;
  redScore: number;
  blueScore: number;
  /** Optional variance channel — left unpopulated by OPR, populated by later algorithms. */
  variance?: number;
  /** D-24: full component vectors, present only for algorithms that decompose scores (EPA, Sigma1). */
  redComponents?: Record<string, ComponentPrediction>;
  blueComponents?: Record<string, ComponentPrediction>;
}

/** D-27: one team's named metric — a value with an optional consistency/uncertainty spread. */
export interface TeamMetric {
  value: number;
  spread?: number;
}

/**
 * D-27: the plain-data shape every `AlgorithmModule.teamMetrics` returns.
 * Outer key is the team key, inner key is the component name (e.g.
 * `TOTAL_METRIC_KEY`, or a per-season component like `autoAmpNote`).
 */
export type TeamMetrics = Record<string, Record<string, TeamMetric>>;

/**
 * D-27: the one component name every algorithm must include in
 * `teamMetrics`'s per-team record, so a renderer has a headline number
 * regardless of which algorithm is selected.
 */
export const TOTAL_METRIC_KEY = "total";

/**
 * D-16/D-19: describes a season-boundary carryover call — which season a
 * team's rating is carrying *from* and *to*, and whether `toSeason` is the
 * corpus's cold-start season (in which case there is no `fromSeason` state
 * to carry, only a rookie-baseline reversion).
 */
export interface SeasonBoundary {
  fromSeason: number;
  toSeason: number;
  isColdStart: boolean;
}

export interface AlgorithmModule<S> {
  id: string;
  version: string;
  initState(teams: string[]): S;
  /** Read-only with respect to outcomes: never touches match results. */
  predict(state: S, match: UpcomingMatch): Prediction;
  /** The only place a match's outcome is read. */
  update(state: S, result: MatchResult): S;
  /**
   * D-27: pure, read-only accessor returning plain data only — this is the
   * one contract member Phases 5-7 render regardless of which algorithm is
   * selected, and it must stay plain data so `packages/core` stays
   * Worker-importable unchanged by the Phase 4 Cloudflare Worker. The
   * optional `teams` filter exists because D-28 snapshots only the 6 teams
   * in a match after every match; a full-state snapshot per match would be
   * O(all teams) and is not acceptable. When `teams` is omitted, every team
   * known to `state` is returned.
   */
  teamMetrics(state: S, teams?: readonly string[]): TeamMetrics;
  /**
   * D-16/D-17/D-19: carries a team's rating across a season boundary.
   * Declared optional now (implemented by EPA and Sigma1 in later plans) so
   * the season loop that calls it can be written once, before either
   * algorithm implements it.
   */
  carrySeason?(state: S, boundary: SeasonBoundary): S;
}
