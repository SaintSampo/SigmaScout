/**
 * Shared, framework-agnostic algorithm contract. This module must stay
 * importable unchanged by the Cloudflare Worker — no Node-only APIs, no
 * better-sqlite3, no Cloudflare bindings.
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
   * TBA's `event_type` enum value for this match's event (see
   * `packages/core/rankingPoints/constants.ts`'s `EVENT_TYPE_TIERS` for the
   * RP-relevant tier mapping). Required, not optional. Not outcome-bearing
   * — an event's type is fixed when the event is scheduled.
   */
  eventType: number;
  /**
   * TBA's competition week for this match's event, 0-indexed as this
   * corpus stores it, or `null` when TBA gives the event no week at all
   * (corpus week 0 is competition "Week 1" — see
   * `packages/core/algorithms/epaWeekOne.ts`). Required, not optional:
   * `null` is a real and common state, and an optional field would
   * collapse "no week for this event" with "forgot to supply one". `0` is
   * a real week, so it is never used as the unknown sentinel. Not
   * outcome-bearing, for the same reason `eventType` above is not.
   */
  week: number | null;
}

/** A completed match — the only place outcome fields exist. */
export interface MatchResult extends UpcomingMatch {
  winner: "red" | "blue" | "tie";
  redScore: number;
  blueScore: number;
  redRpEarned: number | null;
  blueRpEarned: number | null;
  /**
   * TBA's `dq_team_keys` for each alliance, verbatim. Outcome-bearing: a
   * disqualification is a ranking-and-record ruling resolved alongside the
   * match result, not knowable before the match is played, so it is part
   * of `packages/harness/replay.ts`'s `OUTCOME_KEYS`. Required, not
   * optional: an empty array is the honest "no DQ" value. Consumed by
   * `packages/core/algorithms/dq.ts`'s `isFullyDqZeroScoreAlliance`.
   */
  redDqs: readonly string[];
  /** The blue alliance's counterpart to `redDqs` — see its doc comment for the full contract. */
  blueDqs: readonly string[];
  hasScoreBreakdown: boolean;
  /**
   * Verbatim TBA `score_breakdown` JSON for this match, or `null` when TBA
   * omitted it (`hasScoreBreakdown === false`). The raw input a per-season
   * `breakdown/*.ts` component map parses into `ParsedComponents` — never
   * parsed here. Outcome-bearing: part of `packages/harness/replay.ts`'s
   * `OUTCOME_KEYS`, so the leak-proof Proxy guards it identically to every
   * other outcome field.
   */
  scoreBreakdownRaw: string | null;
}

/** One component's predicted contribution to an alliance's score. */
export interface ComponentPrediction {
  mean: number;
}

export interface Prediction {
  winner: "red" | "blue";
  /** Predicted probability the red alliance wins, in the closed interval [0, 1]. */
  pRedWin: number;
  redScore: number;
  blueScore: number;
  /**
   * Optional variance channel — populated by `spr` only. The red+blue sum,
   * not either alliance's own variance (see `redScoreVarianceOwn` below).
   * Not a win-probability denominator: `pRedWin` is computed from the raw,
   * uncalibrated figure, so reconstructing a win probability from this
   * field would disagree with `pRedWin`. Published on match rows, but no
   * page draws it — match bands read the Match Band instead.
   */
  variance?: number;
  /**
   * Each alliance's own predicted-score variance, in points squared. Not
   * the same quantity as `variance` above (which sums both alliances), and
   * not the sum of its teams' `TeamMetric.spread` squares. Populated only
   * by `spr`; `pRedWin` is computed from the raw, uncalibrated variance,
   * never from this field. Left `undefined` by OPR and EPA.
   */
  redScoreVarianceOwn?: number;
  /** The blue alliance's counterpart to `redScoreVarianceOwn` — see its doc comment for the full contract. */
  blueScoreVarianceOwn?: number;
  /** Full component vectors, present only for algorithms that decompose scores (EPA). */
  redComponents?: Record<string, ComponentPrediction>;
  blueComponents?: Record<string, ComponentPrediction>;
  /**
   * The full discrete ranking-point pmf, `P(RP = i)` at index `i`, for `i`
   * in `0..maxRp`. Sums to 1 within 1e-9. Optional — omitted entirely
   * (never an empty array standing in for "not modelled"). The mean is
   * derived from this array at read time (`pmfMean`), never stored
   * alongside it. No algorithm's own `predict()` populates this field: it
   * is attached uniformly, for every algorithm, by the level-2
   * `SigmaScoutLayer` via `analyticRpPmf`.
   */
  redRpPmf?: readonly number[];
  /** The blue alliance's counterpart to `redRpPmf` — see its doc comment for the full contract. */
  blueRpPmf?: readonly number[];
  /**
   * Predicted per-bonus marginal probabilities. Entry `i` is the predicted
   * probability this alliance earns the bonus at the same index of
   * `rpRuleModuleForSeason(season).bonusNames` — a positional array, so a
   * reader must always index against `bonusNames`. A marginal, not a
   * distribution: entries do not sum to 1 and must never be passed through
   * `roundPmf`. A different quantity from `redRpPmf` above (a distribution
   * over the RP total) — never conflate the two. Same omitted-entirely
   * convention as `redRpPmf`.
   */
  redBonusRp?: readonly number[];
  /** The blue alliance's counterpart to `redBonusRp` — see its doc comment for the full contract. */
  blueBonusRp?: readonly number[];
  /**
   * The win/tie/loss half of the RP decomposition —
   * `[P(red wins), P(tie), P(blue wins)]`, three entries, sums to 1.
   * `analyticRpPmf`'s `outcome` field flattened into a fixed index order.
   * Published so the rank simulation can draw a match's outcome once
   * instead of drawing each alliance's total RP independently, which would
   * let both alliances "win" the same draw. Optional, following
   * `redRpPmf`'s omitted-entirely convention.
   */
  matchOutcomePmf?: readonly number[];
  /**
   * The red alliance's ranking points under each entry of
   * `matchOutcomePmf`, index-aligned to it — `[winRp, tieRp, 0]`, read from
   * the season's own `RpRuleModule.winRp`/`.tieRp`, never hardcoded. A
   * third quantity, distinct from both neighbours: `redRpPmf` is a
   * distribution over the RP total, `redBonusRp` is a per-bonus marginal
   * that does not sum to 1, and this is a small exact vector giving each
   * alliance's outcome-only RP conditional on which outcome occurred.
   */
  redOutcomeRp?: readonly number[];
  /** The blue alliance's counterpart to `redOutcomeRp` — `[0, tieRp, winRp]`, index-aligned to the SAME `matchOutcomePmf` order. See its doc comment for the full contract. */
  blueOutcomeRp?: readonly number[];
  /**
   * The red alliance's bonus ranking points only — `analyticRpPmf`'s
   * `redBonusPmf`, a distribution over the bonus-RP count (sums to 1,
   * unlike `redBonusRp`'s per-bonus marginal above). Distinct from
   * `redRpPmf` (the RP total distribution, win/tie RP and bonus RP already
   * folded in) and from `redBonusRp` (a per-bonus marginal that does not
   * sum to 1) — this is a distribution over the bonus-RP count alone,
   * independent of the match outcome.
   */
  redBonusRpPmf?: readonly number[];
  /** The blue alliance's counterpart to `redBonusRpPmf` — see its doc comment for the full contract. */
  blueBonusRpPmf?: readonly number[];
}

/**
 * One team's named metric — a value with an optional `spread`: the
 * algorithm's own confidence in `value`. For `spr`, the only algorithm that
 * sets it, it is the standard deviation of the team's rating estimate
 * alone, scaled into points by `teamMetrics`; OPR and EPA leave it unset.
 * Not what the site displays: `spread` never renders — the `±` beside an
 * SPR Total is Sigma Score, and match bands are the Match Band. No
 * identity ties it to `Prediction.redScoreVarianceOwn`.
 */
export interface TeamMetric {
  value: number;
  spread?: number;
}

/**
 * The plain-data shape every `AlgorithmModule.teamMetrics` returns. Outer
 * key is the team key, inner key is the component name (e.g.
 * `TOTAL_METRIC_KEY`, or a per-season component like `autoAmpNote`).
 */
export type TeamMetrics = Record<string, Record<string, TeamMetric>>;

/**
 * The one component name every algorithm must include in `teamMetrics`'s
 * per-team record, so a renderer has a headline number regardless of which
 * algorithm is selected.
 */
export const TOTAL_METRIC_KEY = "total";

/**
 * Describes a season-boundary carryover call — which season a team's
 * rating is carrying *from* and *to*, and whether `toSeason` is the
 * corpus's cold-start season (in which case there is no `fromSeason` state
 * to carry, only a rookie-baseline reversion).
 */
export interface SeasonBoundary {
  fromSeason: number;
  toSeason: number;
  isColdStart: boolean;
}

/**
 * The shared telemetry seam every algorithm that routes its
 * `score_breakdown` parse through `breakdown/index.ts`'s
 * `tryParseBreakdownPair` implements on its state. Cumulative over the
 * algorithm's whole lifetime, never reset by `carrySeason` — a data-quality
 * observation about the corpus, not a per-season quantity. Kept separate
 * from any per-algorithm "RP fold skipped"-style counter: the two overlap
 * on a malformed match but record different facts (this one the cause, the
 * other the effect), and their expected rates differ by two orders of magnitude.
 */
export interface BreakdownParseTelemetry {
  readonly breakdownParseFailureCount: number;
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
   * Pure, read-only accessor returning plain data only — the one contract
   * member the site renders regardless of which algorithm is selected, so
   * it must stay plain data. The optional `teams` filter exists because a
   * full-state snapshot per match would be O(all teams) and is not
   * acceptable; when omitted, every team known to `state` is returned.
   */
  teamMetrics(state: S, teams?: readonly string[]): TeamMetrics;
  /**
   * Carries a team's rating across a season boundary. Optional: EPA and
   * SPR implement it, OPR does not — declared optional so the season loop
   * that calls it could be written once, before any algorithm implemented it.
   */
  carrySeason?(state: S, boundary: SeasonBoundary): S;
  /**
   * Selects which as-of instant `carrySeason` above receives at a season
   * boundary — `carrySeason` says how a rating crosses a boundary, this
   * says from when.
   *
   *   - `"season-final"` (the default): the state after the last replayed
   *     match of the season, whatever kind of event that match belonged to.
   *   - `"last-official-match"`: the state as it stood immediately after the
   *     season's last official match, so exhibition play cannot seed the
   *     next season's prior. EPA declares this; OPR does not.
   *
   * Only the harness season loops read this; an algorithm's own
   * `update`/`predict` never see it, and it is not a hyperparameter — a
   * statement about the replay's plumbing, which is why it lives on the
   * module contract rather than in a parameter set.
   */
  carryFrom?: "season-final" | "last-official-match";
}
