/**
 * SIGMA SCORE: a Bayesian, talent-informed estimate of how widely a robot's
 * contribution might vary in its NEXT match. A robot whose performance level
 * shifts must read high; a robot that repeats itself must read low.
 *
 * SPR ONLY (`SIGMA_SCORE_ALGORITHM_IDS`). OPR and EPA publish no Sigma metric,
 * no match band and no ranking-point odds.
 *
 * TWO INDEPENDENT HALF-LIVES. With one shared half-life, a robot that breaks
 * has its new level absorbed by a fast mean and the residuals shrink back, so
 * the break never surfaces as volatility. So:
 *
 *   `meanHalfLife`  how fast the bias term chases the team's level. SLOW, so a
 *                   level shift stays visible in the residuals.
 *   `varHalfLife`   how fast the volatility estimate forgets old evidence. FAST,
 *                   so a break shows up promptly.
 *
 * INVERSE-GAMMA PRIOR on the variance, so a team with two near-identical
 * deviations is not reported as perfectly consistent:
 *
 *     prior      sigma^2 ~ InvGamma(a0, b0),  a0 = priorObs/2,
 *                                             b0 = (a0 - 1) * priorSigma^2
 *     posterior  a = a0 + W/2,   b = b0 + S/2
 *     report     SIGMA = sqrt( b / (a - 1) )
 *
 * where `W` is the recency-weighted observation count and `S` the recency-
 * weighted sum of squared residuals about the bias term. `b >= b0 > 0` rules
 * out the near-zero tail; small `W` lets the prior dominate. `b/(a-1)` is the
 * POSTERIOR PREDICTIVE variance, so uncertainty about the volatility widens the
 * answer. It needs `a > 1`, hence the constructor's `priorObs > 2` check. The
 * `(a0 - 1)` in `b0` is explained in `sigmaFor`.
 *
 * TALENT-SCALED PRIOR. Volatility is measured in points and stronger robots have
 * more points to vary by, so a flat prior would drag strong robots down and weak
 * ones up. `priorSigma = priorK * max(talent, TALENT_FLOOR)`, with `talent` the
 * team's pre-match rating and `priorK = sqrt(sum residual^2 / sum talent^2)`
 * one running population number (walk-forward, O(1)). `TALENT_FLOOR` exists
 * because OPR ratings can be zero or negative, and a zero prior reintroduces
 * the tail.
 */

/**
 * The published metric key Sigma Score is injected under. The web renders the
 * Sigma column and tile exactly when this key is on the row, so it never
 * branches on algorithm id.
 */
export const SIGMA_METRIC_KEY = "sigma";

/**
 * The algorithms that publish Sigma Score. SPR only: measured across all three
 * algorithms, Sigma applied to EPA loses on volatility ranking and trimmed
 * likelihood, so it is scoped to the premier algorithm rather than shipped where
 * it is worse.
 */
export const SIGMA_SCORE_ALGORITHM_IDS: ReadonlySet<string> = new Set(["spr"]);

/** Whether this algorithm publishes Sigma Score. */
export function usesSigmaScore(algorithmId: string): boolean {
  return SIGMA_SCORE_ALGORITHM_IDS.has(algorithmId);
}

/**
 * Whether this algorithm publishes ranking-point odds (RP pmfs, their
 * decomposition, bonus-RP probabilities and pre-schedule sidecars). They need a
 * per-robot score variance, which only Sigma algorithms carry. Kept separate
 * from `usesSigmaScore` so an RP gate names the capability it asks about.
 */
export function publishesRankingPoints(algorithmId: string): boolean {
  return usesSigmaScore(algorithmId);
}

/**
 * One alliance's score VARIANCE from a per-team Sigma map: the sum of its
 * roster's squared figures (three robots at ±10 give ±17.32, never ±30), or
 * `undefined` if any member is missing from the map.
 *
 * Unlike `SigmaScoreAccumulator.bandVarianceFor`, which prices a never-seen team
 * from its prior, this is all-or-nothing: summing only the known members gives
 * a band too narrow that reads as confident. Better no band than a tight one.
 */
export function allianceSigmaBandVariance(
  roster: readonly string[],
  sigmaByTeam: ReadonlyMap<string, number>
): number | undefined {
  if (roster.length === 0) return undefined;
  let variance = 0;
  for (const teamKey of roster) {
    const sigma = sigmaByTeam.get(teamKey);
    if (sigma === undefined) return undefined;
    variance += sigma * sigma;
  }
  return variance;
}

/**
 * The PUBLISHED Match Band variance for one alliance, from its win-odds
 * variance; the one display-band helper for the offline layer, the live Worker
 * and the methodology page. Callers gate on `usesSigmaScore` first.
 *
 * Sigma folds each robot's even-split share `(actual - predicted) / rosterSize`,
 * so the win-odds variance estimates `Var(alliance) / rosterSize`; multiplying
 * by `rosterSize` undoes that shrinkage (band = sqrt(rosterSize x sum Sigma^2)).
 *
 * DISPLAY ONLY. Win and tie odds keep the uncorrected variance: red's and blue's
 * misses are correlated, so widening it worsens Brier.
 *
 * `undefined` for an undefined variance, an empty roster or a non-finite input.
 */
export function sigmaMatchBandVariance(rosterSize: number, winOddsVariance: number | undefined): number | undefined {
  if (winOddsVariance === undefined) return undefined;
  if (!Number.isFinite(rosterSize) || !Number.isFinite(winOddsVariance)) return undefined;
  if (rosterSize < 1) return undefined;
  return rosterSize * winOddsVariance;
}

import { isFullyDemoAlliance } from "../core/algorithms/demoTeams.js";
import { isFullyDqZeroScoreAlliance } from "../core/algorithms/dq.js";

/** Floor applied to a team's talent before it scales the prior. OPR ratings can be <= 0. */
export const TALENT_FLOOR = 1;

/**
 * Fallback `priorK` before the population has any evidence. Used only for the
 * first few matches of a season, and deliberately not fitted: if it mattered to
 * a reported result, the prior would be doing the data's work.
 */
export const INITIAL_PRIOR_K = 0.5;

/**
 * The structural slice of a match `foldMatch` needs; `MatchResult` is
 * assignable. Both DQ fields are REQUIRED so a caller that omits them fails
 * typecheck instead of silently folding a carded zero (the live/offline DQ
 * parity contract in `dq.ts`).
 */
export interface SigmaFoldMatch {
  readonly redTeams: readonly string[];
  readonly redScore: number;
  readonly redDqs: readonly string[];
  readonly blueTeams: readonly string[];
  readonly blueScore: number;
  readonly blueDqs: readonly string[];
}

/**
 * Bounds on the talent-scaled prior, as multiples of the population's RMS
 * residual (see `priorSigmaFor`). Wide enough that a settled mid-season prior
 * never touches them.
 */
export const PRIOR_SIGMA_MIN_RATIO = 0.25;
export const PRIOR_SIGMA_MAX_RATIO = 4;

/**
 * Population observations required before the prior scales with talent; below
 * this the flat population spread is used. A handful of matches into a season.
 */
export const MIN_POPULATION_FOR_TALENT_PRIOR = 200;

export interface SigmaScoreOptions {
  /** Half-life, in a team's own matches, of the bias term residuals are measured about. Slow on purpose (see the module header). */
  readonly meanHalfLife: number;
  /** Half-life of the volatility evidence. Fast, so a break surfaces promptly. */
  readonly varHalfLife: number;
  /** Prior strength in pseudo-observations. Must exceed 2 or the posterior predictive variance does not exist. */
  readonly priorObs: number;
}

export const DEFAULT_SIGMA_SCORE_OPTIONS: SigmaScoreOptions = {
  meanHalfLife: 18,
  varHalfLife: 6,
  priorObs: 4,
};

/** The belief read for an unseen team. Frozen, so mistaking a read for a write fails loudly. */
const UNSEEN_BELIEF: SigmaBelief = Object.freeze({
  meanWeight: 0,
  mean: 0,
  varWeight: 0,
  sumSquares: 0,
  talent: TALENT_FLOOR,
});

/** The population statistics behind the talent prior, persisted so a resumed accumulator computes the same prior (`fromBeliefs`). */
export interface SigmaPopulation {
  sumSquares: number;
  talentSquares: number;
  count: number;
}

/** One team's running state. Five numbers, all O(1) to update. */
export interface SigmaBelief {
  /** Recency-weighted observation count for the BIAS term. */
  meanWeight: number;
  /** The bias term itself — recency-weighted mean deviation. */
  mean: number;
  /** Recency-weighted observation count for the VOLATILITY term. */
  varWeight: number;
  /** Recency-weighted sum of squared residuals about `mean`. */
  sumSquares: number;
  /** Most recent talent reading for this team, used to build its prior. */
  talent: number;
}

function decayFor(halfLife: number): number {
  return 0.5 ** (1 / halfLife);
}

/**
 * Walk-forward Sigma Score accumulator. For each match in chronological order:
 * `observeTalent` for its teams, READ `sigmaFor`, and only THEN fold the match
 * (predict-before-update; reading after folding lets a match inform its own
 * estimate).
 */
export class SigmaScoreAccumulator {
  readonly #options: SigmaScoreOptions;
  readonly #meanDecay: number;
  readonly #varDecay: number;
  readonly #beliefs = new Map<string, SigmaBelief>();

  /** Population accumulators behind `priorK`. Walk-forward: they only ever see folded matches. */
  #populationSumSquares = 0;
  #populationTalentSquares = 0;
  #populationCount = 0;

  constructor(options: Partial<SigmaScoreOptions> = {}) {
    const merged = { ...DEFAULT_SIGMA_SCORE_OPTIONS, ...options };
    if (!(merged.priorObs > 2)) {
      throw new Error(
        `SigmaScoreAccumulator: priorObs must exceed 2 so the posterior predictive variance exists, got ${merged.priorObs}`
      );
    }
    if (!(merged.meanHalfLife > 0) || !(merged.varHalfLife > 0)) {
      throw new Error(
        `SigmaScoreAccumulator: half-lives must be positive, got mean=${merged.meanHalfLife} var=${merged.varHalfLife}`
      );
    }
    this.#options = merged;
    this.#meanDecay = decayFor(merged.meanHalfLife);
    this.#varDecay = decayFor(merged.varHalfLife);
  }

  /**
   * A team's belief WITHOUT creating one. A read that inserts would make results
   * order-dependent, because `scoreByTeam()` iterates exactly the stored keys.
   * An unseen team gets a frozen zero belief, i.e. the prior-only Sigma Score.
   */
  #readBelief(teamKey: string): SigmaBelief {
    return this.#beliefs.get(teamKey) ?? UNSEEN_BELIEF;
  }

  /** A team's belief, CREATING one if absent. Only the write paths may use this. */
  #mutableBelief(teamKey: string): SigmaBelief {
    let belief = this.#beliefs.get(teamKey);
    if (belief === undefined) {
      belief = { meanWeight: 0, mean: 0, varWeight: 0, sumSquares: 0, talent: TALENT_FLOOR };
      this.#beliefs.set(teamKey, belief);
    }
    return belief;
  }

  /**
   * Records a team's talent as of now; call BEFORE folding the match it was read
   * from. A non-finite talent (no rating for an unseen team) is ignored so a NaN
   * never reaches later priors.
   */
  observeTalent(teamKey: string, talent: number): void {
    if (!Number.isFinite(talent)) return;
    this.#mutableBelief(teamKey).talent = talent;
  }

  /** The population's running residual-to-talent ratio — the `priorK` of this module's header. */
  priorK(): number {
    if (this.#populationCount === 0 || this.#populationTalentSquares <= 0) return INITIAL_PRIOR_K;
    return Math.sqrt(this.#populationSumSquares / this.#populationTalentSquares);
  }

  /** The population's RMS residual: the flat prior, and the reference the talent-scaled prior is clamped against. */
  populationSigma(): number {
    if (this.#populationCount === 0) return INITIAL_PRIOR_K;
    return Math.sqrt(this.#populationSumSquares / this.#populationCount);
  }

  /** The prior spread for one team: its talent-implied typical variation. */
  priorSigmaFor(teamKey: string): number {
    const populationSigma = this.populationSigma();

    // Talent scaling waits until `priorK` and the clamp band, both population
    // statistics, have enough observations to mean anything.
    if (this.#populationCount < MIN_POPULATION_FOR_TALENT_PRIOR) return populationSigma;

    const talent = Math.max(this.#readBelief(teamKey).talent, TALENT_FLOOR);
    const scaled = this.priorK() * talent;

    // Clamped around the population's own spread. Early in a season ratings are
    // near zero while residuals are full-sized, so `priorK` spikes, and an early
    // under-determined OPR rating can then claim a wildly oversized spread.
    return Math.min(Math.max(scaled, PRIOR_SIGMA_MIN_RATIO * populationSigma), PRIOR_SIGMA_MAX_RATIO * populationSigma);
  }

  /**
   * This team's Sigma Score from everything folded so far. Always defined: for
   * a team never seen, the talent prior alone is the answer, so every match can
   * carry a band.
   */
  sigmaFor(teamKey: string): number {
    const belief = this.#readBelief(teamKey);
    const priorSigma = this.priorSigmaFor(teamKey);
    const alpha0 = this.#options.priorObs / 2;

    // (alpha0 - 1), not alpha0: this makes the prior-only reading exactly
    // priorSigma, so `priorObs` sets shrinkage strength without moving the
    // metric's level (with alpha0, priorObs 3 read 1.73x the intended spread).
    const beta0 = (alpha0 - 1) * priorSigma * priorSigma;

    const alpha = alpha0 + belief.varWeight / 2;
    const beta = beta0 + belief.sumSquares / 2;
    // alpha - 1 > 0 by the constructor's priorObs > 2 check.
    return Math.sqrt(beta / (alpha - 1));
  }

  /** This team's current bias term — the location a predictive distribution is centred on. */
  biasFor(teamKey: string): number {
    return this.#readBelief(teamKey).mean;
  }

  /**
   * Resumes from persisted beliefs, the live Worker's entry point. Copies each
   * belief, so folding cannot mutate the caller's map. A live tick must continue
   * the offline publisher's season-long accumulator, not start a one-event one.
   * Without `population` it would fall back to the flat prior and silently
   * compute different numbers from the same beliefs.
   */
  static fromBeliefs(
    beliefs: ReadonlyMap<string, SigmaBelief>,
    population: SigmaPopulation | undefined,
    options: Partial<SigmaScoreOptions> = {}
  ): SigmaScoreAccumulator {
    const accumulator = new SigmaScoreAccumulator(options);
    for (const [teamKey, belief] of beliefs) accumulator.#beliefs.set(teamKey, { ...belief });
    if (population !== undefined) {
      accumulator.#populationSumSquares = population.sumSquares;
      accumulator.#populationTalentSquares = population.talentSquares;
      accumulator.#populationCount = population.count;
    }
    return accumulator;
  }

  /** Every team's RAW running state, for a caller that must persist it (the Worker's D1 rows, and the seed). */
  beliefsByTeam(): ReadonlyMap<string, SigmaBelief> {
    return new Map([...this.#beliefs].map(([teamKey, belief]) => [teamKey, { ...belief }]));
  }

  /** The talent prior's population statistics, for persistence. Three numbers that do not scale with team count, so they live in the league row. */
  population(): SigmaPopulation {
    return {
      sumSquares: this.#populationSumSquares,
      talentSquares: this.#populationTalentSquares,
      count: this.#populationCount,
    };
  }

  /** Every team this accumulator has seen, with its current Sigma Score. */
  scoreByTeam(): ReadonlyMap<string, number> {
    const scores = new Map<string, number>();
    for (const teamKey of this.#beliefs.keys()) scores.set(teamKey, this.sigmaFor(teamKey));
    return scores;
  }

  /**
   * One alliance's WIN-ODDS variance, the sum of its roster's squared Sigma
   * Scores; the display band is `sigmaMatchBandVariance(roster.length, this)`.
   * Undefined only for an empty roster: every member contributes a real term,
   * from its prior if it has no history, so an all-debutant match still prices.
   */
  bandVarianceFor(roster: readonly string[]): number | undefined {
    if (roster.length === 0) return undefined;
    let variance = 0;
    for (const teamKey of roster) {
      const sigma = this.sigmaFor(teamKey);
      variance += sigma * sigma;
    }
    return variance;
  }

  /**
   * Folds a whole MATCH, applying the demo and full-DQ-zero rules. A match with a
   * fully demo alliance is not evidence about anybody, so nothing folds. A
   * fully-DQ'd, exactly-zero-scored alliance's own fold is skipped (a card ruling
   * says nothing about the robots), never the opponent's; a partial DQ or a
   * non-zero score folds normally. Lives here, not in the offline and live
   * callers, so the two cannot drift apart.
   */
  foldMatch(match: SigmaFoldMatch, prediction: { readonly redScore: number; readonly blueScore: number }): void {
    if (isFullyDemoAlliance(match.redTeams) || isFullyDemoAlliance(match.blueTeams)) return;
    if (!isFullyDqZeroScoreAlliance(match.redTeams, match.redDqs, match.redScore)) {
      this.foldAlliance(match.redTeams, match.redScore, prediction.redScore);
    }
    if (!isFullyDqZeroScoreAlliance(match.blueTeams, match.blueDqs, match.blueScore)) {
      this.foldAlliance(match.blueTeams, match.blueScore, prediction.blueScore);
    }
  }

  /** Folds one alliance's even-split deviation into each of its teams. */
  foldAlliance(roster: readonly string[], actualScore: number, predictedScore: number): void {
    if (roster.length === 0) return;
    if (!Number.isFinite(actualScore) || !Number.isFinite(predictedScore)) return;
    const deviation = (actualScore - predictedScore) / roster.length;
    for (const teamKey of roster) this.fold(teamKey, deviation);
  }

  /**
   * Folds one deviation into a team's belief. The residual is taken about the
   * bias term BEFORE it absorbs this observation, so a robot that just broke
   * registers a large residual against where it used to be.
   */
  fold(teamKey: string, deviation: number): void {
    if (!Number.isFinite(deviation)) return;
    const belief = this.#mutableBelief(teamKey);

    const residual = deviation - belief.mean;

    // Volatility evidence, decayed then incremented.
    belief.varWeight = this.#varDecay * belief.varWeight + 1;
    belief.sumSquares = this.#varDecay * belief.sumSquares + residual * residual;

    // The bias term chases the level on its OWN, slower clock.
    belief.meanWeight = this.#meanDecay * belief.meanWeight + 1;
    belief.mean = belief.mean + (deviation - belief.mean) / belief.meanWeight;

    // Population evidence for the prior. Uses the same residual, so the prior is
    // an estimate of the same quantity each team's posterior is about.
    const talent = Math.max(belief.talent, TALENT_FLOOR);
    this.#populationSumSquares += residual * residual;
    this.#populationTalentSquares += talent * talent;
    this.#populationCount += 1;
  }
}
