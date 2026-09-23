/**
 * EPA (Expected Points Added) — a component-decomposed, variance-free
 * `AlgorithmModule` reimplementation of Statbotics'
 * github.com/avgupta456/statbotics/blob/master/backend/src/models/epa/{math,main}.py
 * (`add_obs`'s two-stage EWMA, `percent_func`'s decaying learning rate, and
 * `k_func`'s margin-over-season-SD win-probability logistic).
 * Statbotics is Copyright (c) 2020 Abhijit Gupta, MIT License; see
 * THIRD_PARTY_NOTICES.md at the repo root.
 *
 * Component attribution splits an alliance's ERROR across its
 * rating-eligible teammates, computed once per component from the
 * pre-update snapshot: `attrib = currentMean + (observed - predicted) / n`
 * — Statbotics' `post_process_attrib`. An alliance scoring exactly its
 * prediction is a no-op for every teammate; only the miss moves anyone.
 *
 * TBA's `score_breakdown` is alliance-level only (no per-robot fields), so
 * `n` is the rating-eligible teammate count and the error is shared equally
 * among them — the ERROR is shared; the LEVEL is not.
 *
 * Deliberate divergences from Statbotics (documented at each use site below):
 *   - `predict()`'s margin carries no foul term; both alliances' published
 *     scores are scaled afterward by one shared `(1 + foulRate)` (reference
 *     section 14). `FOULS_COMMITTED_COMPONENT` is still a per-team rated,
 *     cross-alliance quantity (`breakdown/{year}.ts`'s `parse()`).
 *   - Elimination matches blend at `EPA_ELIM_WEIGHT` (1/3) and do not advance
 *     a team's match counter, matching Statbotics' `ELIM_WEIGHT`.
 *   - No per-season post-processing beyond the attribution split above — no
 *     `post_process_breakdown` equivalent.
 *   - The win-probability scale denominator is an expanding-window
 *     alliance-score SD (Welford, `scoring/expandingStats.ts`), never a
 *     season-final constant — a season-batch SD would leak future variance
 *     into early-season predictions.
 *   - Cold start uses a fixed point-unit seed (`EPA_INIT_COMPONENT_TOTAL`)
 *     rather than live-converting Statbotics' normalized-scale constants,
 *     since no season point scale exists yet at a team's first-ever match.
 *     Cross-season carry (a team WITH prior-season history) is `carrySeason`
 *     below, backed by `carryover.ts`'s `epaCarryover`.
 *
 * Current measured fidelity against Statbotics: `docs/models/epa-vs-statbotics.md`
 * (re-runnable via `npx tsx scripts/epaVsStatbotics.ts --check`).
 */
import { ratingEligibleTeams } from "./opr.js";
import { foldsIntoRatings } from "./eventTypes.js";
import { isFullyDemoAlliance } from "./demoTeams.js";
import { isAdjustZeroedAlliance, isFullyDqZeroScoreAlliance } from "./dq.js";
import {
  ADJUST_COMPONENT,
  componentMapForSeason,
  assertFiniteComponents,
  FOULS_COMMITTED_COMPONENT,
  tryParseBreakdownPair,
  COMPONENT_GROUP_IDS,
  COMPONENT_GROUP_METRIC_KEYS,
  componentGroupsForSeason,
  type ParsedComponents,
  type SeasonComponentMap,
} from "./breakdown/index.js";
import { distributeResidual } from "./breakdown/fallback.js";
import {
  emptyExpandingStats,
  foldObservation,
  reseedFromPrior,
  standardDeviation,
  type ExpandingStats,
} from "../scoring/expandingStats.js";
import {
  EPA_FALLBACK_FOUL_RATE,
  emptyEpaWeekOneState,
  foldWeekOneAllianceScore,
  foldWeekOneFoulSplit,
  foulRateFrom,
  sealWeekOneIfPast,
  type EpaWeekOneState,
} from "./epaWeekOne.js";
import { assertValidPRedWin } from "../scoring/predictionValidity.js";
import {
  TOTAL_METRIC_KEY,
  type AlgorithmModule,
  type BreakdownParseTelemetry,
  type ComponentPrediction,
  type MatchResult,
  type Prediction,
  type SeasonBoundary,
  type TeamMetrics,
  type UpcomingMatch,
} from "./types.js";
import {
  EPA_INIT_PENALTY,
  EPA_NORM_MEAN,
  EPA_NORM_SD,
  epaCarryover,
  type EpaCarryoverPriorRatings,
} from "./carryover.js";
import {
  carryRescaleRatio,
  cleanSeasonMean,
  materializePendingTeams,
  EPA_CARRY_RESCALE_MIN_OBS,
  EPA_SCORE_SD_SEED_COUNT,
} from "./epaCarryScale.js";

// EPA_NORM_MEAN/EPA_NORM_SD/EPA_INIT_PENALTY/EPA_MEAN_REVERSION are owned by
// carryover.ts (avoids a circular import at module-init time) and
// re-exported here so every existing import path keeps working.
export { EPA_NORM_MEAN, EPA_NORM_SD, EPA_INIT_PENALTY };
export { EPA_MEAN_REVERSION } from "./carryover.js";

/**
 * The win-probability logistic's base-10 exponent coefficient (Statbotics'
 * `k_func` for year >= 2008). `epa.ts`'s `predict` uses the algebraically
 * identical natural-exp form: `10 ** (k * x) == exp(k * ln(10) * x)`, so
 * `winProb = 1 / (1 + exp(-margin / scale))` where
 * `scale = seasonScoreSd / (-k * ln(10))` — matching `opr.ts`'s
 * `logisticWinProbability` shape rather than introducing a second logistic
 * base.
 */
export const EPA_K = -5 / 8;

/**
 * Documented fallback for the expanding-window alliance-score SD before at
 * least 2 alliance-score observations exist this season (Pitfall EPA-1;
 * `standardDeviation`'s `count < 2` contract). A small, conservative
 * placeholder point-magnitude so week-1 win probabilities are neither
 * degenerate nor wildly over/underconfident before real variance data
 * accumulates. Phase 3 hyperparameter, default unverified.
 */
export const EPA_FALLBACK_SCORE_SD = 25;

// `EPA_SCORE_SD_SEED_COUNT` lives in `epaCarryScale.ts` (re-exported here so
// every existing import path is unchanged) because `cleanSeasonMean` UNWINDS
// exactly this seed: the seed strength and its unwind are one fact, and a
// reader who changes one must see the other.
export { EPA_SCORE_SD_SEED_COUNT, EPA_CARRY_RESCALE_MIN_OBS };

/**
 * Statbotics' own `ELIM_WEIGHT` (`backend/src/models/epa/constants.py`): an
 * elimination-match observation blends into a team's component mean at this
 * DISCOUNTED outer EWMA weight instead of full weight, and (see
 * `applyComponentUpdate`'s use of this constant) `epaPercentFunc`'s decaying
 * learning-rate schedule advances on qualification matches only.
 */
export const EPA_ELIM_WEIGHT = 1 / 3;

/**
 * A flat, documented placeholder for "a rookie team's typical total
 * contribution to an alliance's score," in point units (unverified default)
 * — used only to give `EPA_INIT_COMPONENT_TOTAL` below a defensible
 * point-unit magnitude to scale from.
 */
const EPA_INIT_TYPICAL_TEAM_SHARE = 20;

/**
 * A team's cold-start TOTAL contribution (summed across every component),
 * before any observation exists. `EPA_NORM_MEAN`/`EPA_NORM_SD`/
 * `EPA_INIT_PENALTY` are Statbotics' normalized-rating-scale constants, not
 * point units — this module implements no normalization layer, so there is
 * no live conversion from that scale into point units at cold start. Instead, the
 * SAME fractional structure Statbotics uses (how far below the normalized
 * mean a rookie starts, as a fraction: `INIT_PENALTY * NORM_SD / NORM_MEAN`)
 * is applied to the flat `EPA_INIT_TYPICAL_TEAM_SHARE` placeholder to get a
 * defensible, non-zero, FIXED point-unit seed — exactly what the plan asks
 * for ("there is no season scale yet, so seed from a documented constant
 * and let the first observations correct it"). This total is divided
 * evenly across the season's registered component count (see
 * `componentColdStartValue`) the first time each component is observed for
 * a team, and is corrected within roughly a dozen matches by
 * `epaPercentFunc`'s fast initial learning rate (1/3 at match count 0).
 */
export const EPA_INIT_COMPONENT_TOTAL =
  EPA_INIT_TYPICAL_TEAM_SHARE * (1 - (EPA_INIT_PENALTY * EPA_NORM_SD) / EPA_NORM_MEAN);

/**
 * Statbotics' decaying learning rate (`percent_func` for year >= 2016):
 * `(2/3) * clamp(0.5 - (0.2/6) * (matchCount - 6), 0.3, 0.5)`. 1/3 at
 * matchCount 0, decaying to 0.2 at matchCount >= 12 — a new team's rating
 * moves fast at first and settles as more observations accumulate.
 */
export function epaPercentFunc(matchCount: number): number {
  const prevYearShape = Math.min(0.5, Math.max(0.3, 0.5 - (0.2 / 6) * (matchCount - 6)));
  return (2 / 3) * prevYearShape;
}

/**
 * The two-stage EWMA from Statbotics' `EPARating.add_obs`. `weight` is `1`
 * for a qualification-match observation and `EPA_ELIM_WEIGHT` (1/3) for an
 * elimination-match observation (see `applyComponentUpdate`'s call site).
 */
function twoStageEwma(mean: number, observation: number, percent: number, weight: number): number {
  const newMean = (1 - percent) * mean + percent * observation;
  return weight * newMean + (1 - weight) * mean;
}

function componentColdStartValue(componentCount: number): number {
  return componentCount > 0 ? EPA_INIT_COMPONENT_TOTAL / componentCount : 0;
}

/**
 * Per-team state: a component-mean record per team, a per-team match
 * counter (increments on a qualification match; an elimination match leaves
 * it untouched), an expanding-window alliance-score SD, the season this
 * state belongs to (derived lazily from the first match's `eventKey`, since
 * `initState` receives no season parameter), and `fallbackSkipped` — a
 * permanently-zero invariant (asserted by test): every match reaches a
 * component update via `distributeResidual`'s fallback, so a future
 * regression that skips one fails loudly instead of silently.
 * `priorSeasonRatings`: normalized-scale ratings carried INTO `season` from
 * the two seasons before it, updated by `carrySeason` at each boundary —
 * empty maps at the cold-start season and for any team with no rating in a
 * given prior season (see `carryover.ts`).
 */
export interface EpaState extends BreakdownParseTelemetry {
  readonly season: number | null;
  readonly teamComponents: ReadonlyMap<string, Readonly<Record<string, number>>>;
  readonly teamMatchCounts: ReadonlyMap<string, number>;
  readonly allianceScoreStats: ExpandingStats;
  /**
   * SEASON-WIDE expanding accumulators over each alliance's NO-FOUL total and
   * its FOUL total — the live pre-seal estimate of Statbotics' week-1
   * `no_foul_mean`/`foul_mean` pair. They exist for the same reason
   * `allianceScoreStats` exists beside `weekOne.frozen`: `predict` needs a
   * usable rate before week 1 has provably ended, and the week-1 accumulator
   * cannot supply one for play that happens BEFORE week 1 (null-week preseason
   * play precedes week 1 in every season). League-scoped: flat in team count.
   * Both apply the SAME exclusions `allianceScoreStats` applies plus one more;
   * see the fold site in `update`.
   */
  readonly allianceNoFoulStats: ExpandingStats;
  readonly allianceFoulStats: ExpandingStats;
  /**
   * The OUTGOING season's alliance-score mean at the moment of the most recent
   * boundary — the point units every carried component is currently expressed
   * in, and the denominator of the rescale ratio. League-scoped: exactly one
   * number, captured in `carrySeason` BEFORE delegating to `epaCarryover`.
   * `Number.NaN` means "no boundary has been crossed", which
   * `carryRescaleRatio` treats as unreadable and therefore deferred — never
   * as a silent 1.
   */
  readonly carrySeedMean: number;
  /**
   * Teams carried across the most recent boundary that have NOT yet been
   * materialized into the incoming season's point units. Serialized PER TEAM,
   * as a flag on that team's own row, never in the league row, to keep the
   * league row's bytes flat in team count. A team leaves this set the first
   * time it is SEEN, whether or not its rescale could be read — see `update`.
   */
  readonly carryPending: ReadonlySet<string>;
  /**
   * WEEK-1 CALIBRATION STATE. Statbotics' `backend/src/data/avg.py` computes
   * every season-level `Year` aggregate from week-1 matches alone, so its
   * `year.score_sd` (the win-probability denominator) and its
   * `year.score_mean`/`no_foul_mean` (the `get_constants` scale anchor) are
   * WEEK-1 numbers, not season-final ones. A week-1 aggregate is knowable the
   * moment week 1 ends, so reading it from week 2 onward costs no
   * walk-forward legitimacy. League-scoped. `epaWeekOne.ts` owns the fold
   * rule, the seal rule, the 0-indexing evidence and the null-week policy;
   * nothing here re-derives any of them.
   */
  readonly weekOne: EpaWeekOneState;
  readonly fallbackSkipped: number;
  readonly priorSeasonRatings: EpaCarryoverPriorRatings;
  // Cumulative over the algorithm's whole lifetime, incremented only for a
  // "malformed" `tryParseBreakdownPair` outcome. Kept SEPARATE from
  // `fallbackSkipped` above — that field is a permanently-zero invariant
  // about a code path that must never run, while this one is a genuine,
  // expected-nonzero data-quality counter.
}

const EMPTY_PRIOR_SEASON_RATINGS: EpaCarryoverPriorRatings = {
  lastSeason: new Map(),
  yearBefore: new Map(),
};

const EMPTY_CARRY_PENDING: ReadonlySet<string> = new Set<string>();

/**
 * The season-boundary rescale factor for this state: how many of the INCOMING
 * season's points one of the OUTGOING season's is worth.
 *
 * Reads the accumulator as it stands BEFORE this match's own scores are folded,
 * which is what makes `predict`'s transient materialization and `update`'s
 * permanent one agree by construction rather than by coincidence.
 */
function carryRescaleRatioFor(state: EpaState): { ratio: number; deferred: boolean } {
  // `get_constants(year)` reads the INCOMING season's WEEK-1 mean, so once
  // week 1 has provably ended that frozen mean IS the numerator. Before the
  // freeze, the live unwind applies — load-bearing, not a fallback: a team
  // first seen during week 1 would otherwise forfeit its rescale entirely.
  //
  // Preference order, matching upstream's own (`get_constants` reads week-1
  // `no_foul_mean`, falling back to `score_mean`, `init.py:16-21`):
  //   1. the frozen week-1 NO-FOUL mean — `no_foul_mean`, exact;
  //   2. the frozen week-1 RAW mean — `score_mean`, upstream's own fallback;
  //   3. `cleanSeasonMean`'s live unwind, load-bearing during week 1 itself.
  //
  // NAMED RESIDUAL: the two frozen means are taken over slightly different
  // POPULATIONS. The raw-score accumulator folds every non-ruling-zero
  // alliance, while the no-foul one additionally requires a PARSED breakdown
  // (the fallback path imputes components from these very means, so folding
  // an imputed value would be circular). Registered in
  // `docs/models/epa-statbotics-gap.md`'s R3 entry.
  const numerator =
    state.weekOne.frozenFoul !== null
      ? state.weekOne.frozenFoul.noFoulMean
      : state.weekOne.frozen !== null
        ? state.weekOne.frozen.mean
        : cleanSeasonMean(state.allianceScoreStats, state.carrySeedMean, EPA_SCORE_SD_SEED_COUNT, EPA_CARRY_RESCALE_MIN_OBS);
  return carryRescaleRatio(numerator, state.carrySeedMean);
}

/** Both alliances' rating-eligible teams, through the SAME remap/surrogate filter `predict`/`update` already apply. */
function carryEligibleTeams(match: UpcomingMatch): string[] {
  return [
    ...ratingEligibleTeams(match.redTeams, match.redSurrogates),
    ...ratingEligibleTeams(match.blueTeams, match.blueSurrogates),
  ];
}

function deriveSeasonFromEventKey(eventKey: string): number {
  const season = Number.parseInt(eventKey.slice(0, 4), 10);
  if (!Number.isInteger(season)) {
    throw new Error(`epa: could not derive a season from event key "${eventKey}" (expected a leading 4-digit year)`);
  }
  return season;
}

function initState(teams: string[]): EpaState {
  const teamComponents = new Map<string, Readonly<Record<string, number>>>();
  const teamMatchCounts = new Map<string, number>();
  for (const team of teams) {
    teamComponents.set(team, {});
    teamMatchCounts.set(team, 0);
  }
  return {
    season: null,
    teamComponents,
    teamMatchCounts,
    allianceScoreStats: emptyExpandingStats(),
    allianceNoFoulStats: emptyExpandingStats(),
    allianceFoulStats: emptyExpandingStats(),
    // No boundary crossed yet: nothing is carried, and there is no outgoing
    // scale to unwind. NaN rather than 0 — a zero seed mean would be a legal
    // -looking denominator.
    carrySeedMean: Number.NaN,
    carryPending: EMPTY_CARRY_PENDING,
    weekOne: emptyEpaWeekOneState(),
    fallbackSkipped: 0,
    priorSeasonRatings: EMPTY_PRIOR_SEASON_RATINGS,
    breakdownParseFailureCount: 0,
  };
}

/** Sums each requested team's component means into one alliance-level `Record<component, ComponentPrediction>`. */
function sumComponentsAcrossTeam(
  teamComponents: ReadonlyMap<string, Readonly<Record<string, number>>>,
  teams: readonly string[]
): Record<string, ComponentPrediction> {
  const totals: Record<string, number> = {};
  for (const team of teams) {
    const components = teamComponents.get(team);
    if (!components) continue;
    for (const [name, value] of Object.entries(components)) {
      totals[name] = (totals[name] ?? 0) + value;
    }
  }
  // Emitted in SORTED key order, deliberately. `predict()` sums these into an
  // alliance total with `Object.entries(...).reduce(...)`, and floating-point
  // addition is not associative, so the order the keys happen to sit in
  // changes the last bits of every predicted score. That order is not stable
  // across the system: a live state carries a team's components in the order
  // `update()` inserted them, while a state rebuilt from a snapshot carries
  // them alphabetically, because `stateSnapshot.ts` writes rows with
  // `stableStringify` (sorted keys) so the payload itself is canonical.
  // Sorting here makes the prediction depend only on WHICH components exist
  // and their values, never on how the record was built — which is what
  // `stateSnapshot.test.ts`'s continuation-replay digest equality actually
  // asserts.
  const result: Record<string, ComponentPrediction> = {};
  for (const name of Object.keys(totals).sort()) {
    result[name] = { mean: totals[name]! };
  }
  return result;
}

/**
 * Same alliance-level sum `predict()` shows a caller, but as plain
 * `ParsedComponents` numbers rather than `ComponentPrediction` records.
 *
 * NOT the same vector `predict()` shows for this alliance: this is a
 * straight per-team sum across EVERY registered component, including this
 * alliance's own `FOULS_COMMITTED_COMPONENT` figure, with no cross-alliance
 * adjustment. `predict()` excludes that figure from an alliance's own total
 * and adds the OPPONENT's instead — the two are not interchangeable. A
 * caller that needs `predict()`'s cross-attributed total (the fallback path
 * below) must apply that adjustment itself; see `fallbackObserved`.
 */
function predictedComponentTotals(
  teamComponents: ReadonlyMap<string, Readonly<Record<string, number>>>,
  teams: readonly string[]
): ParsedComponents {
  const summed = sumComponentsAcrossTeam(teamComponents, teams);
  const result: ParsedComponents = Object.create(null) as ParsedComponents;
  for (const [name, componentPrediction] of Object.entries(summed)) {
    result[name] = componentPrediction.mean;
  }
  return result;
}

/**
 * This alliance's own currently-predicted total for
 * `FOULS_COMMITTED_COMPONENT`, carried forward UNCHANGED as the "observed"
 * value for a fallback match — never derived from `result.*Score`. Mirrors,
 * per team, exactly the cold-start fallback `applyComponentUpdate` uses
 * internally (`currentComponents[component] ?? coldStart`), so feeding this
 * value back in as the observation makes
 * `twoStageEwma(mean, mean, percent, 1) === mean`: a genuine no-op for a
 * component this project has no way to observe without a real breakdown (it
 * is derived from the OPPONENT's raw `foulPoints` field, equally absent
 * here) — never a silent drop, never a coerced zero. It also stays populated
 * even for a team whose very first match is a fallback match, so no
 * component is ever left undefined (`breakdown.test.ts`).
 */
function foulsCommittedCarryForward(
  teamComponents: ReadonlyMap<string, Readonly<Record<string, number>>>,
  teams: readonly string[],
  componentCount: number
): number {
  const coldStart = componentColdStartValue(componentCount);
  let total = 0;
  for (const team of teams) {
    total += teamComponents.get(team)?.[FOULS_COMMITTED_COMPONENT] ?? coldStart;
  }
  return total;
}

/**
 * Builds the fallback-imputed observation for one alliance when a match has
 * no `score_breakdown`, mirroring `predict()`'s own cross-alliance foul
 * attribution rather than summing every registered component (including
 * this alliance's own `foulsCommitted`) straight from `result.*Score`. Two
 * invariants:
 *
 *   1. None of this alliance's own actual score is ever folded into its
 *      own `FOULS_COMMITTED_COMPONENT` slot — `opponentFoulsMean` is
 *      subtracted from `observedAllianceScore` BEFORE the split, and the
 *      split itself only ever runs over `offensiveComponents` (every
 *      registered component EXCEPT `FOULS_COMMITTED_COMPONENT`).
 *   2. The opponent's currently-predicted foul contribution to this
 *      alliance's actual score (`opponentFoulsMean`) is netted out before
 *      that split, so it is never misattributed into this alliance's own
 *      offensive components.
 */
function fallbackObserved(
  teamComponents: ReadonlyMap<string, Readonly<Record<string, number>>>,
  teams: readonly string[],
  observedAllianceScore: number,
  opponentFoulsMean: number,
  offensiveComponents: readonly string[],
  componentCount: number
): ParsedComponents {
  const offensive = distributeResidual(
    observedAllianceScore - opponentFoulsMean,
    predictedComponentTotals(teamComponents, teams),
    offensiveComponents
  );
  return {
    ...offensive,
    [FOULS_COMMITTED_COMPONENT]: foulsCommittedCarryForward(teamComponents, teams, componentCount),
  };
}

/**
 * The season-boundary scale anchor's read path: a carried team still pending
 * is materialized into the INCOMING season's point units TRANSIENTLY — a
 * temporary component map for this match's teams only, used for this
 * prediction and then discarded.
 *
 * The early-out on an empty pending set is load-bearing, not an optimisation:
 * the common path (every team already seen) must do no work at all, and an
 * empty set is the state for all but the first appearance of each team after a
 * boundary.
 */
function predict(state: EpaState, match: UpcomingMatch): Prediction {
  if (state.carryPending.size > 0) {
    const { ratio } = carryRescaleRatioFor(state);
    const { teamComponents, touched } = materializePendingTeams(
      state.teamComponents,
      carryEligibleTeams(match),
      state.carryPending,
      ratio
    );
    if (touched.length > 0) return predictCore({ ...state, teamComponents }, match);
  }
  return predictCore(state, match);
}

function predictCore(state: EpaState, match: UpcomingMatch): Prediction {
  const redTeams = ratingEligibleTeams(match.redTeams, match.redSurrogates);
  const blueTeams = ratingEligibleTeams(match.blueTeams, match.blueSurrogates);

  const redComponents = sumComponentsAcrossTeam(state.teamComponents, redTeams);
  const blueComponents = sumComponentsAcrossTeam(state.teamComponents, blueTeams);

  // Each alliance's NO-FOUL total: every rated component EXCEPT its own
  // FOULS_COMMITTED_COMPONENT. That exclusion is what makes these the no-foul
  // quantity Statbotics scales — `no_foul_points = score - foulPoints -
  // adjustPoints` (reference section 2), and `adjust` is pinned at exactly 0
  // per team, so both sides target the same thing.
  const redOffensiveTotal = Object.entries(redComponents).reduce(
    (sum, [name, c]) => (name === FOULS_COMMITTED_COMPONENT ? sum : sum + c.mean),
    0
  );
  const blueOffensiveTotal = Object.entries(blueComponents).reduce(
    (sum, [name, c]) => (name === FOULS_COMMITTED_COMPONENT ? sum : sum + c.mean),
    0
  );

  // Statbotics divides by `year.score_sd`, which `avg.py` computes from
  // week-1 matches' RAW alliance scores with fouls INCLUDED — exactly the
  // quantity `update` below already folds, so this is an exact target.
  //
  // Once week 1 has provably ended (`epaWeekOne.ts`'s seal rule) that frozen
  // SD is used for every remaining match of the season; until then the live
  // expanding-window SD applies. Neither branch can incorporate a match that
  // has not been replayed yet.
  const seasonScoreSd =
    state.weekOne.frozen !== null
      ? state.weekOne.frozen.sd
      : standardDeviation(state.allianceScoreStats, EPA_FALLBACK_SCORE_SD);
  const scale = seasonScoreSd / (-EPA_K * Math.LN10);
  // The margin carries no foul term at all. `main.py:125-130` (reference
  // section 14) computes `norm_diff` and `win_prob` from the foul-free
  // scores, and only afterwards scales both published scores by
  // `(1 + foul_rate)`.
  const margin = redOffensiveTotal - blueOffensiveTotal;
  const pRedWin = 1 / (1 + Math.exp(-margin / scale));
  assertValidPRedWin(pRedWin, `epa.predict (${match.matchKey})`);

  // ONE foul rate for the whole match, multiplying BOTH published scores.
  // The order is the point: a positive scalar shared by both alliances
  // cannot change the sign of their difference, so fouls cannot move the
  // predicted winner or the win probability — they inflate two published
  // scores and nothing else (reference section 14; mechanism 5 of
  // `docs/models/epa-statbotics-gap.md`).
  const foulRate = foulRateFor(state);
  const redScore = redOffensiveTotal * (1 + foulRate);
  const blueScore = blueOffensiveTotal * (1 + foulRate);

  return {
    // Ties (margin === 0) give pRedWin exactly 0.5 via the logistic form
    // itself (exp(0) === 1), and `>= 0.5` resolves to "red" — matching
    // `opr.ts`'s tie convention so every algorithm agrees at the boundary.
    winner: pRedWin >= 0.5 ? "red" : "blue",
    pRedWin,
    redScore,
    blueScore,
    // UNSCALED, deliberately: `AlliancePred(red_score_with_fouls,
    // breakdowns[0], ...)` carries the SCALED score beside the UNSCALED
    // breakdown vector. The scalar is a property of the published total, not
    // of any component.
    redComponents,
    blueComponents,
  };
}

/**
 * The one rate this match's published scores are scaled by —
 * `year.get_foul_rate()`'s analogue.
 *
 * Reads the FROZEN week-1 record once the seal has happened, and the
 * SEASON-WIDE live pair before it, switching at exactly the match the SD
 * denominator's own switch happens. Both branches go through `foulRateFrom`,
 * the single divide and the single guard `epaWeekOne.ts` exports — this
 * function must never re-implement either, because two copies of the ratio
 * drifting apart would be invisible: two plausible rates, applied on opposite
 * sides of a seal.
 *
 * A refused rate (`null`) falls back to `EPA_FALLBACK_FOUL_RATE`, which
 * publishes each alliance's plain no-foul total rather than substituting a
 * denominator the way upstream's `(self.no_foul_mean or 1)` does.
 */
function foulRateFor(state: EpaState): number {
  if (state.weekOne.frozenFoul !== null) return state.weekOne.frozenFoul.rate;
  return foulRateFrom(state.allianceNoFoulStats.mean, state.allianceFoulStats.mean) ?? EPA_FALLBACK_FOUL_RATE;
}

/**
 * Attributes one alliance's observed component vector across its
 * rating-eligible teams by ERROR SPLIT — each teammate is credited
 * `currentMean + (allianceValue - predictedAllianceTotal) / n` (see the
 * file header's component-attribution note) — applying the two-stage EWMA.
 * `isElimination` changes exactly two things below: the outer EWMA weight
 * becomes `EPA_ELIM_WEIGHT` instead of full weight, and the per-team counter
 * is left untouched instead of incrementing — nothing else in this function
 * moves. Returns new maps; never mutates its inputs.
 *
 * The predicted total is computed ONCE per component, BEFORE the per-team
 * loop, from `teamComponents` — the pre-update snapshot. That ordering is
 * load-bearing, not stylistic: computing it inside the loop off the
 * progressively-updated `nextComponents` would attribute each teammate
 * against a prediction its predecessors had already moved, making the result
 * depend on the order `teams` happens to arrive in. Statbotics has the same
 * structure for the same reason — one `pred_bd` per alliance, then a loop
 * over teams.
 */
function applyComponentUpdate(
  teamComponents: ReadonlyMap<string, Readonly<Record<string, number>>>,
  teamMatchCounts: ReadonlyMap<string, number>,
  teams: readonly string[],
  observed: ParsedComponents,
  componentCount: number,
  isElimination: boolean
): {
  teamComponents: ReadonlyMap<string, Readonly<Record<string, number>>>;
  teamMatchCounts: ReadonlyMap<string, number>;
} {
  if (teams.length === 0) {
    // Every team on this alliance was a surrogate — nothing to attribute,
    // a genuine no-op (mirrors opr.ts's own empty-observation handling).
    return { teamComponents, teamMatchCounts };
  }

  const nextComponents = new Map(teamComponents);
  const nextCounts = new Map(teamMatchCounts);
  const coldStart = componentColdStartValue(componentCount);

  // One predicted-total pass per alliance-component, taken from the
  // PRE-update snapshot (`teamComponents`, not `nextComponents`) so every
  // teammate is attributed against the same prediction. The `?? coldStart`
  // fallback is character-for-character the one the per-team loop below
  // applies, so a team's own contribution to this sum is exactly the
  // `currentMean` it is later differenced against — if the two ever drifted
  // apart, an unobserved team would appear to have missed a prediction it was
  // never part of.
  const predictedAllianceTotals: Record<string, number> = {};
  for (const component of Object.keys(observed)) {
    // `ADJUST_COMPONENT` is a scorekeeper's ruling applied to an alliance
    // total, not a quantity any robot produces — there is no per-team share
    // of it to learn, so no predicted total is computed for it either. Its
    // per-team value is written directly as `0` in the loop below, never
    // derived from this total.
    if (component === ADJUST_COMPONENT) continue;
    let total = 0;
    for (const team of teams) {
      total += teamComponents.get(team)?.[component] ?? coldStart;
    }
    predictedAllianceTotals[component] = total;
  }

  for (const team of teams) {
    const matchCount = nextCounts.get(team) ?? 0;
    const percent = epaPercentFunc(matchCount);
    const currentComponents = nextComponents.get(team) ?? {};
    const updatedComponents: Record<string, number> = { ...currentComponents };
    // `adjust` is pinned at exactly `0` for every team on every update,
    // UNCONDITIONALLY — not merely "when this match's `observed` vector
    // happens to carry an `adjust` key". A fallback match's residual split
    // (`nonFoulsComponents`, above) deliberately excludes `ADJUST_COMPONENT`
    // entirely, so `observed` carries no `adjust` key at all on that path;
    // without this unconditional pin a cold-start team would leave `adjust`
    // undefined rather than the documented `0`. Never EWMA'd toward a
    // manufactured value: a nonzero per-team adjust estimate would be the
    // model fitting a scorekeeper's ruling.
    updatedComponents[ADJUST_COMPONENT] = 0;

    for (const [component, allianceValue] of Object.entries(observed)) {
      // Already pinned above — see the `predictedAllianceTotals` skip for
      // why no predicted total exists for it to attribute against.
      if (component === ADJUST_COMPONENT) continue;
      const currentMean = currentComponents[component] ?? coldStart;
      // Credit the alliance's ERROR, shared equally, on top of this team's
      // own level — Statbotics' `post_process_attrib`
      // (`err = observed - predicted`, `attrib = epa + err / n`). An
      // alliance scoring exactly its prediction is a genuine no-op here,
      // because `twoStageEwma(mean, mean, percent, 1) === mean`.
      const attributed = currentMean + (allianceValue - predictedAllianceTotals[component]!) / teams.length;
      // Statbotics' `update_team` outer EWMA weight — full weight (1) for a
      // qualification match, `EPA_ELIM_WEIGHT` (1/3) for an elimination match.
      updatedComponents[component] = twoStageEwma(currentMean, attributed, percent, isElimination ? EPA_ELIM_WEIGHT : 1);
    }

    nextComponents.set(team, updatedComponents);
    // `percent` above was already computed from this UN-incremented
    // `matchCount`, so an elimination match learns at the schedule position
    // it arrived at and leaves the schedule exactly where it found it — the
    // counter only advances for a qualification match.
    nextCounts.set(team, isElimination ? matchCount : matchCount + 1);
  }

  return { teamComponents: nextComponents, teamMatchCounts: nextCounts };
}

/**
 * The season-boundary scale anchor's write path: a carried team still
 * pending is materialized PERMANENTLY into the incoming season's point
 * units, and then the ordinary update runs on top.
 *
 * Every rating-eligible team in this match leaves `carryPending` whether or not
 * the ratio could be read. A team whose rescale was DEFERRED has already been
 * moved by this match's EWMA, and rescaling a blend of last season's units and
 * this season's observation later would be worse than not rescaling it at all.
 * That forfeit is the measured, reported cost of being walk-forward-legal — see
 * `epaCarryScale.ts`'s header and `docs/models/epa-divergences.md` §8.
 *
 * The ratio is read from the PRE-update accumulator, exactly as `predict` reads
 * it, so the two agree by construction rather than by coincidence.
 *
 * `componentMap` is the map for THIS MATCH'S OWN SEASON — deliberately a
 * different season from `carrySeason`'s own optional map, which is the
 * INCOMING season's. Conflating the two would rescale a carried rating into
 * the wrong units. Absent means resolve exactly as before
 * (`componentMapForSeason(season)` inside `updateCore`).
 */
function update(state: EpaState, result: MatchResult, componentMap?: SeasonComponentMap): EpaState {
  // Preseason Week 0 is predicted, never folded (`foldsIntoRatings`). First,
  // before the carry materializes: a Week 0 appearance must not be what
  // resolves a team's pending season carry either.
  if (!foldsIntoRatings(result.eventType)) return state;
  if (state.carryPending.size === 0) return updateCore(state, result, componentMap);
  const { ratio } = carryRescaleRatioFor(state);
  const teams = carryEligibleTeams(result);
  const { teamComponents, touched } = materializePendingTeams(
    state.teamComponents,
    teams,
    state.carryPending,
    ratio
  );
  const carryPending = new Set(state.carryPending);
  for (const team of teams) carryPending.delete(team);
  return updateCore(
    touched.length === 0 ? { ...state, carryPending } : { ...state, teamComponents, carryPending },
    result,
    componentMap
  );
}

/**
 * `componentMap`: the match's own season's map, or absent to resolve it
 * exactly as before. ONE resolved value governs BOTH the component LIST
 * (`componentCount`, `nonFoulsComponents`) and the PARSE
 * (`tryParseBreakdownPair`) below — those two used to resolve the map
 * independently, and an override that changed one without the other would
 * silently fold an observation vector into a mismatched component list.
 */
function updateCore(state: EpaState, result: MatchResult, componentMap?: SeasonComponentMap): EpaState {
  // A fully-demo alliance (`demoTeams.ts`) is a non-contest (a
  // forfeit/no-show playoff bucket or an offseason bracket bye) — the WHOLE
  // MATCH is skipped, both alliances, never just the demo side's own share.
  // Checked against the RAW (pre-remap) team lists. Unlike OPR, EPA folds
  // every comp level (at a discount for eliminations, never skipped), so
  // this is NOT a defensive no-op here — it is load-bearing for both the 36
  // real-event playoff matches and the 195 offseason `qm` rows this corpus
  // carries with a fully-demo alliance.
  if (isFullyDemoAlliance(result.redTeams) || isFullyDemoAlliance(result.blueTeams)) return state;

  const season = state.season ?? deriveSeasonFromEventKey(result.eventKey);

  const redTeams = ratingEligibleTeams(result.redTeams, result.redSurrogates);
  const blueTeams = ratingEligibleTeams(result.blueTeams, result.blueSurrogates);

  // The same "is this an elimination match" test `opr.ts`'s own `update`
  // already uses — `ef`/`qf`/`sf`/`f` are all eliminations, `qm` alone is a
  // qualification match. Threaded into both `applyComponentUpdate` calls
  // below, changing exactly the outer EWMA weight and the per-team counter
  // increment there — nothing else in this function reads it.
  const isElimination = result.compLevel !== "qm";

  const seasonMap = componentMap ?? componentMapForSeason(season);
  // `ADJUST_COMPONENT` is excluded from the cold-start divisor here and at
  // the carrySeason boundary below — it is never seeded (pinned at 0), so
  // counting it in the divisor would silently shrink every rookie's seeded
  // total below `EPA_INIT_COMPONENT_TOTAL`.
  const componentCount = seasonMap.components.filter((name) => name !== ADJUST_COMPONENT).length;

  const breakdownOutcome = tryParseBreakdownPair(season, result.scoreBreakdownRaw, seasonMap);
  const redParsed = breakdownOutcome.kind === "parsed" ? breakdownOutcome.red : null;
  const blueParsed = breakdownOutcome.kind === "parsed" ? breakdownOutcome.blue : null;

  // A match with no score_breakdown ("absent") OR a score_breakdown that IS
  // present but fails its season Zod schema ("malformed" — self-reported
  // offseason data; `tryParseBreakdownPair`, `breakdown/index.ts`) still
  // updates state. The residual is distributed across this alliance's own
  // OFFENSIVE components only (never FOULS_COMMITTED_COMPONENT — see
  // fallbackObserved), against the alliance's own actual score net of the
  // OPPONENT's currently-predicted foul contribution — mirroring predict()'s
  // own cross-alliance attribution. Never a silent drop, never a coerced zero.
  const breakdownParseFailureCount = state.breakdownParseFailureCount + (breakdownOutcome.kind === "malformed" ? 1 : 0);
  // The fallback split must also exclude `ADJUST_COMPONENT` — an imputed
  // observation routed to a pinned component would simply vanish and the
  // imputed total would no longer reconcile.
  const nonFoulsComponents = seasonMap.components.filter(
    (name) => name !== FOULS_COMMITTED_COMPONENT && name !== ADJUST_COMPONENT
  );
  const blueFoulsMean = predictedComponentTotals(state.teamComponents, blueTeams)[FOULS_COMMITTED_COMPONENT] ?? 0;
  const redFoulsMean = predictedComponentTotals(state.teamComponents, redTeams)[FOULS_COMMITTED_COMPONENT] ?? 0;

  const redObserved =
    redParsed ??
    fallbackObserved(state.teamComponents, redTeams, result.redScore, blueFoulsMean, nonFoulsComponents, componentCount);
  const blueObserved =
    blueParsed ??
    fallbackObserved(state.teamComponents, blueTeams, result.blueScore, redFoulsMean, nonFoulsComponents, componentCount);

  // Throw loudly rather than let a non-finite value (surviving the Zod parse
  // boundary, or produced by distributeResidual's degenerate branch off a
  // non-finite result.redScore/blueScore) silently poison this team's EWMA
  // state for the rest of the season.
  assertFiniteComponents(redObserved, `red observation, match ${result.matchKey}`);
  assertFiniteComponents(blueObserved, `blue observation, match ${result.matchKey}`);

  // An alliance whose recorded score is exactly 0 gets NO component update
  // at all when a scorekeeper's ruling — not real play — is what produced
  // that 0, however it was encoded. Two encodings, checked separately
  // (`dq.ts`'s own header): every rating-eligible team disqualified
  // (`isFullyDqZeroScoreAlliance`), OR the PARSED breakdown's own `adjust`
  // value is negative with no DQ flags at all (`isAdjustZeroedAlliance` — a
  // genuine ~456-point alliance zeroed by `adjustPoints: -456`, no DQ).
  // Combined into one per-alliance ruling-zero boolean and fed `[]` to
  // `applyComponentUpdate`, the same no-op input that function already
  // handles for an all-surrogate alliance. Checked per-alliance, NOT
  // per-match like `isFullyDemoAlliance` above: the opposing alliance's own
  // score is still a genuine observation of real robots and its own
  // component update proceeds unaffected.
  const redIsDqZero = isFullyDqZeroScoreAlliance(redTeams, result.redDqs, result.redScore);
  const blueIsDqZero = isFullyDqZeroScoreAlliance(blueTeams, result.blueDqs, result.blueScore);
  const redIsAdjustZero = isAdjustZeroedAlliance(redTeams, result.redScore, redParsed?.[ADJUST_COMPONENT]);
  const blueIsAdjustZero = isAdjustZeroedAlliance(blueTeams, result.blueScore, blueParsed?.[ADJUST_COMPONENT]);
  const redIsRulingZero = redIsDqZero || redIsAdjustZero;
  const blueIsRulingZero = blueIsDqZero || blueIsAdjustZero;

  const afterRed = applyComponentUpdate(
    state.teamComponents,
    state.teamMatchCounts,
    redIsRulingZero ? [] : redTeams,
    redObserved,
    componentCount,
    isElimination
  );
  const afterBlue = applyComponentUpdate(
    afterRed.teamComponents,
    afterRed.teamMatchCounts,
    blueIsRulingZero ? [] : blueTeams,
    blueObserved,
    componentCount,
    isElimination
  );

  // Fold each alliance's observed total into the expanding-window SD — the
  // score itself is always known, even when its breakdown is not (Pitfall
  // EPA-1: this must only ever incorporate matches already replayed) — EXCEPT
  // a ruling-zero (either encoding above), which is a scorekeeper's ruling,
  // not an observed score, and would otherwise pull this season SD toward
  // zero for no real reason.
  let allianceScoreStats = state.allianceScoreStats;
  if (!redIsRulingZero) allianceScoreStats = foldObservation(allianceScoreStats, result.redScore);
  if (!blueIsRulingZero) allianceScoreStats = foldObservation(allianceScoreStats, result.blueScore);

  // Seal FIRST, then fold: a match is either week 1 or past it, never both,
  // so the order cannot change the outcome for this match. It is fixed this
  // way only so the seal is read before any fold a future edit might make
  // conditional on it.
  //
  // The SAME ruling-zero exclusion the season-wide accumulator applies above
  // applies here, for the same reason: a scorekeeper's ruling is not an
  // observed score, and folding it would drag the frozen constant toward zero
  // for no on-field reason.
  let weekOne = sealWeekOneIfPast(state.weekOne, result.week);
  if (!redIsRulingZero) weekOne = foldWeekOneAllianceScore(weekOne, result.week, result.redScore);
  if (!blueIsRulingZero) weekOne = foldWeekOneAllianceScore(weekOne, result.week, result.blueScore);

  // THE NO-FOUL / FOUL SPLIT. Statbotics' shared cleaner, verbatim
  // (reference section 2):
  //
  //     foul_points = breakdown.get("foulPoints", 0) + breakdown.get("adjustPoints", 0)
  //     no_foul_points = score - foul_points
  //
  // An alliance's foul side is the points it RECEIVED from the opponent's
  // fouls plus its OWN `adjustPoints`; its no-foul side is the complement
  // taken from the score, so `noFoulMean + foulMean === scoreMean` holds by
  // construction and `(1 + rate) * noFoulMean` is exactly the inflation to a
  // real score.
  //
  // THE CROSS-SIDE DIRECTION IS THE EASIEST THING HERE TO GET BACKWARDS.
  // Every `breakdown/{year}.ts` sets `result[FOULS_COMMITTED_COMPONENT] =
  // opponent.foulPoints` ("points this alliance's fouls cost the OTHER
  // side"), so RED's own foul side is `blueParsed[FOULS_COMMITTED_COMPONENT]
  // + redParsed[ADJUST_COMPONENT]` — one value from the OPPONENT's record,
  // one from its own. Getting that backwards is silent: accumulators still
  // fill, the seal still fires, every shape-only test still passes, and
  // published scores are simply inflated by the wrong number — which is why
  // the direction has its own test with deliberately asymmetric foul values.
  //
  // Two exclusions: a ruling-zero alliance (as above), and an alliance whose
  // breakdown did NOT parse — the fallback path imputes that alliance's
  // components FROM the foul means these accumulators feed, so folding an
  // imputed value back in would be circular.
  let allianceNoFoulStats = state.allianceNoFoulStats;
  let allianceFoulStats = state.allianceFoulStats;
  if (redParsed !== null && blueParsed !== null) {
    const redFoulSide = (blueParsed[FOULS_COMMITTED_COMPONENT] ?? 0) + (redParsed[ADJUST_COMPONENT] ?? 0);
    const blueFoulSide = (redParsed[FOULS_COMMITTED_COMPONENT] ?? 0) + (blueParsed[ADJUST_COMPONENT] ?? 0);
    const redNoFoul = result.redScore - redFoulSide;
    const blueNoFoul = result.blueScore - blueFoulSide;
    if (!redIsRulingZero) {
      allianceNoFoulStats = foldObservation(allianceNoFoulStats, redNoFoul);
      allianceFoulStats = foldObservation(allianceFoulStats, redFoulSide);
      weekOne = foldWeekOneFoulSplit(weekOne, result.week, redNoFoul, redFoulSide);
    }
    if (!blueIsRulingZero) {
      allianceNoFoulStats = foldObservation(allianceNoFoulStats, blueNoFoul);
      allianceFoulStats = foldObservation(allianceFoulStats, blueFoulSide);
      weekOne = foldWeekOneFoulSplit(weekOne, result.week, blueNoFoul, blueFoulSide);
    }
  }

  return {
    season,
    teamComponents: afterBlue.teamComponents,
    teamMatchCounts: afterBlue.teamMatchCounts,
    allianceScoreStats,
    allianceNoFoulStats,
    allianceFoulStats,
    weekOne,
    // Carried forward UNCHANGED by an ordinary match update. `update` above
    // is the only thing that removes a team from `carryPending`, and
    // `carrySeason` is the only thing that sets either field.
    carrySeedMean: state.carrySeedMean,
    carryPending: state.carryPending,
    // Permanently zero (see EpaState's doc comment) — no code path below
    // this line increments it anymore.
    fallbackSkipped: state.fallbackSkipped,
    // Untouched by an ordinary match update — only carrySeason moves this
    // forward, at a season boundary.
    priorSeasonRatings: state.priorSeasonRatings,
    breakdownParseFailureCount,
  };
}

/**
 * Per team, one entry per learned component plus `TOTAL_METRIC_KEY`. No
 * `spread` — EPA carries a mean only, exactly as Statbotics' `EPARating`.
 *
 * `total` is the sum of every component EXCEPT `FOULS_COMMITTED_COMPONENT`
 * — this is the no-foul quantity Statbotics itself publishes as
 * `epa.total_points` (verified live: `frc254`/2024's `total_points` 51.71
 * reconciles against auto + teleop + endgame alone, with no foul term).
 * `foulsCommitted` is still published as its own entry below — it is
 * informative on its own (Statbotics publishes foul figures separately
 * too) — only its membership in `total` changes. A team's own fouls were
 * never that team's own scoring output: they are points its fouls cost the
 * OPPONENT (`predict()`'s cross-attribution, untouched by this).
 *
 * Also publishes `phaseAuto`/`phaseTeleop`/`phaseEndgame` — the three
 * season-declared component groups (`breakdown/groups.ts`) — as first-class,
 * value-only metrics. Publishing them here is what lets the existing
 * percentile/tier pass (`publish.ts`'s `withPercentiles`/`withPublishedTiers`
 * over `teamsThisSeason`, generic over metric NAMES) attach a season-wide
 * tier to them with zero harness changes — a client-side ranking would
 * render in the identical colour while meaning something else, which a
 * reader could never detect, so the tier must come from here.
 *
 * Reconciliation, EPA-specific and worth stating because it is NOT a general
 * property of the grouping: `phaseAuto + phaseTeleop + phaseEndgame +
 * adjust` equals `total` exactly, because `adjust` is pinned at exactly `0`
 * for every team and `total` already excludes `foulsCommitted` — the group
 * values plus the one remaining ungrouped, always-zero component partition
 * `total` completely.
 */
function teamMetrics(state: EpaState, teams?: readonly string[]): TeamMetrics {
  const requestedTeams = teams ?? [...state.teamComponents.keys()];
  const result: TeamMetrics = {};
  for (const team of requestedTeams) {
    const components = state.teamComponents.get(team);
    if (!components) continue;
    const perTeam: Record<string, { value: number }> = {};
    let total = 0;
    for (const [name, value] of Object.entries(components)) {
      perTeam[name] = { value };
      if (name !== FOULS_COMMITTED_COMPONENT) total += value;
    }
    perTeam[TOTAL_METRIC_KEY] = { value: total };

    // Phase groups (Auto/Teleop/Endgame), published as first-class metrics
    // (see this function's own doc comment above). Reads the SAME single
    // grouping source (`componentGroupsForSeason`)
    // `apps/web/src/lib/metricGroups.ts` already reads client-side for its
    // own stale-artifact derived fallback — that shared source is what makes
    // a published group value and the client's derived fallback value
    // identical BY CONSTRUCTION, not by two lists kept in step.
    const groups = state.season === undefined || state.season === null ? undefined : componentGroupsForSeason(state.season);
    if (groups !== undefined) {
      for (const groupId of COMPONENT_GROUP_IDS) {
        let groupValue = 0;
        let present = false;
        for (const name of groups[groupId]) {
          const value = components[name];
          if (value === undefined) continue;
          groupValue += value;
          present = true;
        }
        // A group whose components are all absent from this team's record
        // publishes nothing at all — never a fabricated zero, tracked with a
        // presence flag rather than inferred from a zero sum. Matches the
        // client's `withDerivedGroupMetrics`.
        if (!present) continue;
        perTeam[COMPONENT_GROUP_METRIC_KEYS[groupId]] = { value: groupValue };
      }
    }

    result[team] = perTeam;
  }
  return result;
}

/**
 * Carries every team's rating across a season boundary using
 * `carryover.ts`'s `epaCarryover` — this function's only job is reshaping
 * `EpaState`'s fields into and out of that pure calculation.
 *
 * `boundary.isColdStart === true` is a no-op: the cold-start season has no
 * `fromSeason` state to carry from, by definition, so `state` is returned
 * unchanged (the caller — the harness season loop — is not expected to call
 * this for the cold-start season at all, but this makes the contract safe
 * to call defensively regardless).
 *
 * `toSeasonMap` is the INCOMING season's map — `boundary.toSeason`, NOT the
 * season just played, and NOT the same season as `update`'s own optional
 * map. A reader who conflates the two would wire a measurement arm that
 * expresses carried ratings in the wrong season's units. Absent means
 * resolve exactly as before. `AlgorithmModule`'s declared
 * `carrySeason`/`update` signatures cannot see an optional third parameter
 * at all, so a caller that wants to pass a map must hold the concrete `epa`
 * object (this module's own export, typed by `satisfies`) rather than an
 * `AlgorithmModule` reference.
 *
 * `allianceScoreStats` is RE-SEEDED here, not carried whole: the
 * expanding-window score SD seeds "from the prior season's final value at
 * season start" rather than carrying the accumulator across the boundary
 * UNCHANGED — a seed fades as the new season's own data arrives, and it
 * cannot fade while the prior seasons' observation count comes with it. The
 * alternative was a win-probability denominator pooled across every season
 * replayed so far, against FRC point scales that move by 5x between
 * seasons. See `EPA_SCORE_SD_SEED_COUNT` for the measurement and the seed
 * strength.
 */
function carrySeason(state: EpaState, boundary: SeasonBoundary, toSeasonMap?: SeasonComponentMap): EpaState {
  if (boundary.isColdStart) return state;

  // Captured BEFORE delegating. `epaCarryover` converts BOTH directions with
  // the OUTGOING season's own distribution, so every carried total below
  // leaves this function expressed in THESE units. The value survives
  // `reseedFromPrior` and is recoverable afterwards, but capturing it here
  // is what makes `cleanSeasonMean`'s unwind correct by construction rather
  // than by a later re-derivation that could drift.
  const carrySeedMean = state.allianceScoreStats.mean;

  const teamTotals = new Map<string, number>();
  for (const [team, components] of state.teamComponents) {
    let total = 0;
    for (const value of Object.values(components)) total += value;
    teamTotals.set(team, total);
  }

  const carryResult = epaCarryover({ teamTotals, priorSeasonRatings: state.priorSeasonRatings });

  const toSeasonComponents = (toSeasonMap ?? componentMapForSeason(boundary.toSeason)).components;
  // `ADJUST_COMPONENT` is excluded from the carried-share divisor, exactly
  // like the cold-start divisor above — without this, every team's `adjust`
  // estimate would become nonzero again at every season boundary.
  const modeledToSeasonComponents = toSeasonComponents.filter((name) => name !== ADJUST_COMPONENT);
  const teamComponents = new Map<string, Readonly<Record<string, number>>>();
  const teamMatchCounts = new Map<string, number>();

  for (const [team, carriedTotal] of carryResult.teamPointTotals) {
    const share = modeledToSeasonComponents.length > 0 ? carriedTotal / modeledToSeasonComponents.length : 0;
    const record: Record<string, number> = {};
    for (const name of toSeasonComponents) {
      // `adjust`'s carried entry is pinned at exactly 0 — never a share of
      // the carried total.
      record[name] = name === ADJUST_COMPONENT ? 0 : share;
    }
    teamComponents.set(team, record);
    // A new season resets each team's match counter — the percent_func's
    // fast early learning rate applies fresh, exactly as it does for any
    // genuinely new team.
    teamMatchCounts.set(team, 0);
  }

  return {
    season: boundary.toSeason,
    teamComponents,
    teamMatchCounts,
    allianceScoreStats: reseedFromPrior(state.allianceScoreStats, EPA_SCORE_SD_SEED_COUNT),
    // RESET, not reseeded — deliberately UNLIKE `allianceScoreStats`
    // immediately above, and the difference is the point. A foul RATE is a
    // property of one season's own rule set and point values: the same
    // on-field contact is worth a different number of points from one
    // season to the next, and a rules change can move the rate outright.
    // Carrying last season's across the boundary would be a prior-season leak
    // into a constant Statbotics derives from the INCOMING season's own week 1
    // and nothing else (`avg.py`, reference section 21). The incoming season
    // therefore starts with no foul information at all and publishes plain
    // no-foul totals (`EPA_FALLBACK_FOUL_RATE`) until its own play supplies
    // some — which is the honest state, not a degradation.
    allianceNoFoulStats: emptyExpandingStats(),
    allianceFoulStats: emptyExpandingStats(),
    // A new season's week 1 has not happened yet, so the incoming season starts
    // UNFROZEN and UNSEALED with an empty accumulator. Deliberately NOT seeded
    // from the outgoing season the way `allianceScoreStats` is: a frozen
    // constant carried across a boundary would be last season's point scale
    // masquerading as this one's — the exact defect `reseedFromPrior` exists
    // to prevent.
    weekOne: emptyEpaWeekOneState(),
    carrySeedMean,
    // Exactly the carry-worthy teams: `teamComponents` above is a FRESH map
    // containing only `carryResult.teamPointTotals`. Each of these is still in
    // the outgoing season's point units until it is first seen.
    carryPending: new Set(teamComponents.keys()),
    fallbackSkipped: 0,
    priorSeasonRatings: carryResult.priorSeasonRatings,
    // Carried forward UNCHANGED, unlike the `fallbackSkipped` reset above —
    // see EpaState's doc comment for why the two counters diverge here.
    breakdownParseFailureCount: state.breakdownParseFailureCount,
  };
}

export const epa = {
  id: "epa",
  // `version` must carry the `{codeVersion}+{paramSetName}` shape —
  // publish.ts and manifests.ts both split on it and throw otherwise. EPA
  // has no separate tuned parameter set (frozen at Statbotics' own
  // published constants, never searched), so "baseline" is the honest,
  // single named set. Any change to `update`'s or `teamMetrics`'s
  // observable output requires a version bump.
  //
  // `carrySeason` receives the state as of the season's last OFFICIAL match
  // (via `carryFrom` below), not the season-final state — that would let
  // unofficial exhibition/preseason play seed the following season.
  // Implemented once, at the replay layer, in `WalkForwardSimulator.runAll`'s
  // `carryStates` (`packages/harness/replay.ts`).
  //
  // A carried rating enters the new season expressed in the INCOMING
  // season's point units (`epaCarryScale.ts`), an approximation: a
  // walk-forward replay must estimate the incoming scale from the incoming
  // season's own folded scores, and a team first seen before
  // `EPA_CARRY_RESCALE_MIN_OBS` of them exist forfeits its rescale
  // permanently. `teamMetrics` publishes a still-pending team's carried
  // rating in the OUTGOING season's units until it is first seen.
  //
  // 11.0.0 (quick task 260919-368): a preseason Week 0 match (TBA event type
  // 100) is predicted and never folded (`foldsIntoRatings`), so it no longer
  // moves a rating, the league score statistics or a pending season carry
  // before official week 1. Measured with the published scorer on the
  // identical 125,422 official qualification matches: pooled winner accuracy
  // 0.75127 to 0.75168 and Brier 0.16993 to 0.16977, accuracy better in 8
  // seasons and worse in 1 (2022), Brier better in 8 and worse in 2 (2022,
  // 2026). Accepted by Jacob 2026-09-19 as a correctness rule, not a tune.
  //
  // 12.0.0 (quick task 260920-qgg): TBA omits `adjustPoints` entirely at many
  // offseason events, which used to fail every season's `SideBreakdownSchema`
  // and route the match through `fallbackObserved`/`distributeResidual`
  // instead of its real components. It now defaults to 0 on absence only —
  // see `packages/core/algorithms/breakdown/constants.ts`'s
  // `ADJUST_POINTS_SCHEMA`. This is a DATA-SHAPE correction, not an accuracy
  // claim: a two-arm replay measured 0 / 18,372 official predictions and 0 /
  // 18,372 official metric rows changed in 2026, the one season with an
  // offseason event ahead of official play. Published COMPONENT values move
  // at offseason rows only (1,516 / 2,502 non-official 2026 rows, 5,079 /
  // 5,963 in 2025) — real components now flow instead of the proportional
  // fallback split. MAJOR because a published number moves.
  //
  // 13.0.0 (quick task 260923-3w8, 2026-09-23): nothing in this file changed.
  // The live folding tier widened from `spr` alone to all three published
  // algorithms (`LIVE_ALGORITHM_IDS` in `apps/worker/wrangler.toml`), so the
  // EPA ratings and components the site serves now advance match by match
  // during an event instead of standing still between manual re-baselines.
  // Same model, same inputs, same numbers for a finished event — but a
  // published rating that used to be a weekend-old constant is now a moving
  // value, and the project rule is that changed published numbers ship under a
  // new version rather than being overwritten in place. MAJOR for that reason
  // alone: no `predict`, `update`, `teamMetrics` or `carrySeason` behaviour is
  // different, which is why every `predictionStreamSha256` in
  // `data/baselines/level1-digest-2026-09.json` is byte-unchanged across this
  // bump. Jacob's decision, on `260923-1tu-FINDINGS.md` item C6: the free
  // plan's 50-subrequest cap and then its 10 ms CPU cap were what held the
  // tier at one algorithm, and Workers Paid (2026-09-22) retired both.
  version: "13.0.0+baseline",
  initState,
  predict,
  update,
  teamMetrics,
  carrySeason,
  // EPA is the only algorithm that declares this; OPR omits it and keeps
  // carrying from the season-final state.
  carryFrom: "last-official-match",
  // `satisfies`, not a type annotation. An annotation would WIDEN this object
  // to `AlgorithmModule<EpaState>`, whose declared `update`/`carrySeason` take
  // two parameters, and the optional component-map third parameter would
  // become invisible at every call site — including the measurement arm it
  // exists for. `satisfies` keeps the conformance check (this object still
  // has to be a valid `AlgorithmModule<EpaState>`) and keeps the concrete
  // signatures.
} satisfies AlgorithmModule<EpaState>;
