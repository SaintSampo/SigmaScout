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
   * TBA's `event_type` enum value for this match's event (0=Regional,
   * 1=District, 2=District Championship, 3=Championship Division,
   * 4=Championship Finals, 5=District Championship Division, 99=Offseason,
   * 100=Preseason — see `packages/core/rankingPoints/constants.ts`'s
   * `EVENT_TYPE_TIERS` for the RP-relevant tier mapping). REQUIRED, not
   * optional — a silent default here is the exact failure mode this
   * contract's required fields exist to prevent. NOT outcome-bearing — an
   * event's type is fixed when the event is scheduled — so it is
   * deliberately NOT added to `packages/harness/replay.ts`'s `OUTCOME_KEYS`,
   * in explicit contrast to `scoreBreakdownRaw`'s note below.
   */
  eventType: number;
  /**
   * TBA's competition week for this match's event, **0-INDEXED as this
   * corpus stores it** (`events.week`), or `null` when TBA gives the event
   * no week at all. Corpus week 0 is competition "Week 1" — the mapping, its
   * evidence and the null-week policy all live in
   * `packages/core/algorithms/epaWeekOne.ts`, the only place a read site
   * should get the constant from.
   *
   * REQUIRED, not optional: `null` is a real and common state (143 of 2024's
   * events carry no week, covering 6,255 played matches), and an optional
   * field would collapse "TBA has no week for this event" with "this
   * construction site forgot to supply one". Where the week genuinely
   * cannot be known, `null` is correct and `0` is NOT, because `0` is a real
   * week. NOT outcome-bearing, for the same reason `eventType` above is not.
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
   * match result, not a fact knowable before the match is played, so it is
   * part of `packages/harness/replay.ts`'s `OUTCOME_KEYS` — mirrors
   * `scoreBreakdownRaw`'s doc comment below. Required, not optional: an
   * empty array is the honest "no DQ" value (the corpus always has an
   * answer for this column). Consumed by
   * `packages/core/algorithms/dq.ts`'s `isFullyDqZeroScoreAlliance`.
   */
  redDqs: readonly string[];
  /** The blue alliance's counterpart to `redDqs` — see its doc comment for the full contract. */
  blueDqs: readonly string[];
  hasScoreBreakdown: boolean;
  /**
   * Verbatim TBA `score_breakdown` JSON for this match, or `null` when TBA
   * omitted it (`hasScoreBreakdown === false`). This is the raw input a
   * per-season `breakdown/*.ts` component map parses into
   * `ParsedComponents` — never parsed here, `packages/corpus` stays
   * season-agnostic by design. Outcome-bearing: part of
   * `packages/harness/replay.ts`'s `OUTCOME_KEYS`, so the leak-proof Proxy
   * guards it identically to every other outcome field on all three trap
   * surfaces (`get`, `getOwnPropertyDescriptor`, `ownKeys`).
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
   * Optional variance channel — populated by `spr` only; OPR and EPA leave it
   * unset. This is the red+blue SUM, NOT either alliance's own variance —
   * see `redScoreVarianceOwn`/`blueScoreVarianceOwn` below for that.
   *
   * NOT A WIN-PROBABILITY DENOMINATOR: `spr` calibrates what it EMITS here
   * while computing `pRedWin` from the raw, uncalibrated figure, so
   * reconstructing a win probability from this field would disagree with
   * `pRedWin`. It is still published on match rows, but no page draws it:
   * match bands read the Match Band (`redMatchBandVariance`/
   * `blueMatchBandVariance`).
   */
  variance?: number;
  /**
   * Each alliance's OWN predicted-score variance, in points squared. NOT the
   * same quantity as `variance` above (which sums both alliances), and NOT
   * the sum of its teams' `TeamMetric.spread` squares. For `spr`, the only
   * algorithm that populates this field, `predict()` builds it as
   * `(pv + obsSd²) × displaySdFactor(mu)² × unit²`: `pv` weights each team's
   * posterior by the square of its rank weight, `obsSd²` adds observation
   * noise that no team's spread carries, and `displaySdFactor` rescales the
   * result by alliance strength for display. `pRedWin` is computed from the
   * raw, uncalibrated variance, never from this field. Optional: left
   * `undefined` by OPR and EPA, neither of which models an alliance-level
   * own variance.
   */
  redScoreVarianceOwn?: number;
  /** The blue alliance's counterpart to `redScoreVarianceOwn` — see its doc comment for the full contract. */
  blueScoreVarianceOwn?: number;
  /** Full component vectors, present only for algorithms that decompose scores (EPA). */
  redComponents?: Record<string, ComponentPrediction>;
  blueComponents?: Record<string, ComponentPrediction>;
  /**
   * The full discrete ranking-point pmf, `P(RP = i)` at index `i`, for `i`
   * in `0..maxRp` (that season's `RpRuleModule.maxRp`). Sums to 1 within
   * 1e-9. Optional — omitted entirely (never an empty array standing in for
   * "this algorithm does not model RP"). The mean is DERIVED from this
   * array at read time (`packages/core/rankingPoints/analyticPmf.ts`'s
   * `pmfMean`) and never stored alongside it — one representation of one
   * fact. No algorithm's own `predict()` populates this field: it is
   * attached uniformly, for every algorithm, by the level-2
   * `SigmaScoutLayer` (`packages/harness/sigmaScoutLayer.ts`) via
   * `analyticRpPmf`.
   */
  redRpPmf?: readonly number[];
  /** The blue alliance's counterpart to `redRpPmf` — see its doc comment for the full contract. */
  blueRpPmf?: readonly number[];
  /**
   * Predicted per-bonus MARGINAL probabilities. Entry `i` is the predicted
   * probability this alliance earns the bonus at the same index of
   * `rpRuleModuleForSeason(season).bonusNames` — a positional array, not a
   * record, so a reader must always index against `bonusNames` rather than
   * assume field order. This is a per-bonus MARGINAL, not a distribution:
   * entries do NOT sum to 1 and must never be passed through `roundPmf`. It
   * is a DIFFERENT quantity from `redRpPmf` above, which is a distribution
   * over the RP TOTAL — never conflate the two. Optional, same
   * omitted-entirely convention as `redRpPmf`: absent when `analyticRpPmf`
   * did not run for this prediction (RP-ineligible event type,
   * non-qualification `compLevel`). Populated uniformly by the level-2
   * `SigmaScoutLayer`, not by any algorithm's own `predict()`.
   */
  redBonusRp?: readonly number[];
  /** The blue alliance's counterpart to `redBonusRp` — see its doc comment for the full contract. */
  blueBonusRp?: readonly number[];
  /**
   * The win/tie/loss half of the RP decomposition —
   * `[P(red wins), P(tie), P(blue wins)]`, three entries, sums to 1. This is
   * `analyticRpPmf`'s `outcome` field (`RpOutcomeDistribution`'s
   * `pRedWin`/`pTie`/`pBlueWin`) flattened into the index order pinned by
   * `EventMatchSchema.matchOutcomePmf`'s doc comment (the single definition
   * site). Published so the rank simulation can draw a match's outcome ONCE
   * instead of drawing each alliance's total RP independently — independent
   * draws let both alliances "win" the same draw. Optional, following
   * `redRpPmf`'s omitted-entirely convention.
   */
  matchOutcomePmf?: readonly number[];
  /**
   * The red alliance's ranking points under each entry of
   * `matchOutcomePmf`, index-aligned to it — `[winRp, tieRp, 0]`, read from
   * the season's own `RpRuleModule.winRp`/`.tieRp` (2/1 in 2016-2024, 3/1 in
   * 2025-2026), never hardcoded. A THIRD quantity, distinct from both
   * neighbours: `redRpPmf` is a distribution over the RP TOTAL, `redBonusRp`
   * is a per-bonus MARGINAL that does not sum to 1, and this is a small
   * exact vector giving each alliance's OUTCOME-only RP conditional on which
   * of the three outcomes occurred — never a distribution in its own right.
   * Optional, same convention as `matchOutcomePmf`.
   */
  redOutcomeRp?: readonly number[];
  /** The blue alliance's counterpart to `redOutcomeRp` — `[0, tieRp, winRp]`, index-aligned to the SAME `matchOutcomePmf` order. See its doc comment for the full contract. */
  blueOutcomeRp?: readonly number[];
  /**
   * The red alliance's BONUS ranking points only — `analyticRpPmf`'s
   * `redBonusPmf`, a distribution over the bonus-RP COUNT (sums to 1,
   * unlike `redBonusRp`'s per-bonus marginal above). A THIRD quantity from
   * both neighbours by name: `redRpPmf` is the RP TOTAL distribution
   * (win/tie RP and bonus RP already folded in), `redBonusRp` is a per-bonus
   * MARGINAL whose entries do not sum to 1, and this is a distribution over
   * the bonus-RP count alone, independent of the match outcome. Optional,
   * same convention as `matchOutcomePmf`.
   */
  redBonusRpPmf?: readonly number[];
  /** The blue alliance's counterpart to `redBonusRpPmf` — see its doc comment for the full contract. */
  blueBonusRpPmf?: readonly number[];
}

/**
 * One team's named metric — a value with an optional `spread`: the
 * algorithm's own confidence in `value`. For `spr`, the only algorithm that
 * sets it, it is the standard deviation of the team's rating estimate alone
 * (`√(pL + pS)`, scaled into points by `teamMetrics`); OPR and EPA leave it
 * unset. It is NOT what the site displays: `spread` never renders
 * (`DisplayMetric.spread` in `apps/web/src/components/MetricValue.tsx`),
 * the `±` beside an SPR Total is Sigma Score, and match bands are the Match
 * Band (`redMatchBandVariance`). No identity ties it to
 * `Prediction.redScoreVarianceOwn`; see that field's doc comment.
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
 * algorithm's whole lifetime, never reset by `carrySeason` — this is a
 * data-quality observation about the corpus, not a per-season quantity.
 * Kept as its own field, deliberately SEPARATE from any per-algorithm "RP
 * fold skipped"-style counter: the two overlap on a malformed match (both
 * increment) but record different facts — this one the CAUSE (the
 * breakdown failed its schema), the other the EFFECT (a downstream fold was
 * skipped) — and folding a ~21% population into a counter whose documented
 * expectation is ~0.1% would destroy the signal in both.
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
   * Pure, read-only accessor returning plain data only — this is the one
   * contract member the site renders regardless of which algorithm is
   * selected, and it must stay plain data so `packages/core` stays
   * Worker-importable unchanged. The optional `teams` filter exists because
   * state snapshots only the teams in a match after every match; a
   * full-state snapshot per match would be O(all teams) and is not
   * acceptable. When `teams` is omitted, every team known to `state` is
   * returned.
   */
  teamMetrics(state: S, teams?: readonly string[]): TeamMetrics;
  /**
   * Carries a team's rating across a season boundary. Optional: EPA and SPR
   * implement it, OPR does not. It was declared optional so the season loop
   * that calls it could be written once, before any algorithm implemented
   * it.
   */
  carrySeason?(state: S, boundary: SeasonBoundary): S;
  /**
   * Selects WHICH as-of instant `carrySeason` above receives at a season
   * boundary. Reads as a pair with it — `carrySeason` says HOW a rating
   * crosses a boundary, this says FROM WHEN.
   *
   *   - `"season-final"` (the default): the state after the last replayed
   *     match of the season, whatever kind of event that match belonged to.
   *   - `"last-official-match"`: the state as it stood immediately after the
   *     season's last OFFICIAL match (`isOfficialEventType`, i.e. neither
   *     offseason nor preseason Week 0), so exhibition play cannot seed the
   *     next season's prior. EPA declares this; OPR does not.
   *
   * Omitting the field means `"season-final"` — a module that never mentions
   * it is provably unaffected by this mechanism.
   *
   * Only the harness season loops read this: it selects between the two maps
   * `WalkForwardSimulator.runAll` returns (`carryStates` vs `finalStates`).
   * An algorithm's own `update`/`predict` never see it, and it is not a
   * hyperparameter — it is a statement about the replay's plumbing, which is
   * why it lives on the module contract rather than in a parameter set.
   */
  carryFrom?: "season-final" | "last-official-match";
}
