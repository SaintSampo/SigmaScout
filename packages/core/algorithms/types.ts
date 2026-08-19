/**
 * Shared, framework-agnostic algorithm contract (RESEARCH.md Pattern 1,
 * ARCHITECTURE.md Pattern 1). This module must stay importable unchanged by
 * the Phase 4 Cloudflare Worker — no Node-only APIs, no better-sqlite3, no
 * Cloudflare bindings.
 *
 * `predict` and `update` are pure: neither may mutate its `state` argument.
 * `predict` never receives outcome-bearing fields (see
 * `packages/harness/replay.ts`'s `toLeakProofUpcoming`, which enforces this
 * at runtime for every call site inside the walk-forward simulator, across
 * all three Proxy surfaces an outcome field could otherwise leak through —
 * direct read, descriptor probe, and key enumeration).
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
  /**
   * TBA's `event_type` enum value for this match's event (0=Regional,
   * 1=District, 2=District Championship, 3=Championship Division,
   * 4=Championship Finals, 5=District Championship Division,
   * 99=Offseason, 100=Preseason — see
   * `packages/core/algorithms/sigma1/rp/constants.ts`'s `EVENT_TYPE_TIERS`
   * for the RP-relevant tier mapping). REQUIRED, not optional: an optional
   * field with a silent default is the failure mode this plan exists to
   * prevent (plan 03-03 Task 1 — RESEARCH.md Open Question 2). NOT
   * outcome-bearing — an event's type is fixed when the event is
   * scheduled, long before any match is played — so it is deliberately NOT
   * added to `packages/harness/replay.ts`'s `OUTCOME_KEYS`, in explicit
   * contrast to `scoreBreakdownRaw`'s note below.
   */
  eventType: number;
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
   * other outcome field on all three trap surfaces (`get`,
   * `getOwnPropertyDescriptor`, `ownKeys`).
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
  /**
   * D-10: the full discrete ranking-point pmf, `P(RP = i)` at index `i`,
   * for `i` in `0..maxRp` (that season's `RpRuleModule.maxRp`). Sums to 1
   * within 1e-9. Optional — omitted entirely (never an empty array
   * standing in for "this algorithm does not model RP"), following the
   * existing optional-field convention above (`variance`, `redComponents`).
   * Mean and standard deviation are DERIVED from this array at read time
   * (`packages/core/algorithms/sigma1/rp/distribution.ts`'s `pmfMean`/
   * `pmfStandardDeviation`) and never stored alongside it — one
   * representation of one fact (D-10, mirrors D-21's raw-numbers-only
   * artifact rule).
   */
  redRpPmf?: readonly number[];
  /** D-10: the blue alliance's counterpart to `redRpPmf` — see its doc comment for the full contract. */
  blueRpPmf?: readonly number[];
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

/**
 * T-03-18b (security audit, phase 03, quick task 260818-inm): the shared
 * telemetry seam every algorithm that routes its `score_breakdown` parse
 * through `breakdown/index.ts`'s `tryParseBreakdownPair` implements on its
 * state. Cumulative over the algorithm's whole lifetime, never reset by
 * `carrySeason` (D-Q2) — this is a data-quality observation about the
 * corpus, not a per-season quantity. Kept as its own field, deliberately
 * SEPARATE from any per-algorithm "RP fold skipped"-style counter (e.g.
 * Sigma1's `rpSkippedMatchCount`): the two overlap on a malformed match
 * (both increment) but record different facts — this one the CAUSE (the
 * breakdown failed its schema), the other the EFFECT (a downstream fold was
 * skipped) — and folding a ~21% population into a counter whose documented
 * expectation is ~0.1% would destroy the signal in both.
 */
export interface BreakdownParseTelemetry {
  readonly breakdownParseFailureCount: number;
}

/**
 * Reads `breakdownParseFailureCount` off an arbitrary algorithm state,
 * returning `null` when the value does not track it (e.g. OPR, which never
 * touches `score_breakdown` at all) rather than fabricating a `0` — a caller
 * (`packages/harness/cli.ts`'s `reportBreakdownParseFailures`) must be able
 * to distinguish "this algorithm has no opinion" from "this algorithm
 * observed zero parse failures."
 */
export function breakdownParseFailureCountOf(state: unknown): number | null {
  if (
    typeof state === "object" &&
    state !== null &&
    "breakdownParseFailureCount" in state &&
    Number.isFinite((state as { breakdownParseFailureCount: unknown }).breakdownParseFailureCount)
  ) {
    return (state as BreakdownParseTelemetry).breakdownParseFailureCount;
  }
  return null;
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
