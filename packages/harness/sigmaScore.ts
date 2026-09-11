/**
 * SIGMA SCORE — a Bayesian, talent-informed estimate of how wildly a robot's
 * contribution might swing in its NEXT match.
 *
 * EXPERIMENTAL (quick task 260910-u7g). Nothing in the production publish path
 * imports this module, and nothing should until it wins its comparison against
 * the shipped Swing Factor. `scripts/compareSigmaScore.ts` is the only consumer.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS FOR, WHICH DECIDES ITS SHAPE
 * ---------------------------------------------------------------------------
 *
 * From the developer, and every design choice below traces to one of these two
 * sentences:
 *
 *   "How wildly might their performance swing next match? If a robot breaks, or
 *    finally starts working, Sigma Score captures that for a scout. VS if they
 *    have performed the same every match, Sigma Score should be low."
 *
 * So there are exactly two requirements, and they pull in opposite directions:
 *
 *   RESPONSIVENESS  a robot whose performance LEVEL shifts must read HIGH.
 *   QUIETNESS       a robot that repeats itself must read LOW.
 *
 * ---------------------------------------------------------------------------
 * WHY THE MEAN'S TRACKING SPEED IS THE CRUX, NOT AN INHERITED CONSTANT
 * ---------------------------------------------------------------------------
 *
 * The shipped Swing Factor centres squared residuals on a recency-weighted mean
 * with a SIX MATCH half-life — the same half-life it uses for the variance. That
 * is fine for quietness and actively hostile to responsiveness: when a robot
 * breaks, the fast mean chases the new (lower) level within a few matches, the
 * residuals about it shrink back toward normal, and the metric stops reporting
 * the very event the scout needed to see. The break is absorbed into the bias
 * term instead of surfacing as volatility.
 *
 * Sigma Score therefore carries TWO INDEPENDENT HALF-LIVES:
 *
 *   `meanHalfLife`  how fast the bias term chases the team's level. SLOW, so a
 *                   level shift stays visible in the residuals.
 *   `varHalfLife`   how fast the volatility estimate forgets old evidence. FAST,
 *                   so a break shows up promptly rather than being diluted.
 *
 * Separating them is the whole idea. Swing Factor is the special case where both
 * are 6, which is why it cannot satisfy both requirements at once.
 *
 * ---------------------------------------------------------------------------
 * THE BAYESIAN PART, AND THE THREE MEASURED DEFECTS IT EXISTS TO FIX
 * ---------------------------------------------------------------------------
 *
 * Quick task 260910-sz9 measured the shipped estimator over 297,854 team-matches
 * and found three things, all traceable to it being an unregularised sample
 * statistic over an effective sample of about nine:
 *
 *   1. A near-zero tail. 0.06-0.35% of rows carry a swing below 1 point (two
 *      near-identical deviations), and under a log score those few hundred rows
 *      carry 83-100% of the total loss. The site publishes "perfectly
 *      consistent" and the robot then misses by 40 points.
 *   2. Regression to the mean. The ratio of published swing to realized spread
 *      climbs monotonically 0.80 -> 1.94 across deciles: low-swing teams are
 *      badly under-estimated, high-swing teams about right.
 *   3. It does not beat a single population constant on median NLL for EPA
 *      (-0.015) or BPR (-0.006).
 *
 * A conjugate inverse-gamma prior on the variance fixes all three STRUCTURALLY
 * rather than by tuning:
 *
 *     prior      sigma^2 ~ InvGamma(a0, b0),  a0 = priorObs/2,
 *                                             b0 = (a0 - 1) * priorSigma^2
 *     posterior  a = a0 + W/2,   b = b0 + S/2
 *     report     SIGMA = scale * sqrt( b / (a - 1) )
 *
 * The `(a0 - 1)` in `b0` rather than the more obvious `a0` is deliberate and is
 * explained at the point of use in `sigmaFor` — it decouples the metric's LEVEL
 * from `priorObs` so that knob controls shrinkage strength and nothing else.
 *
 * where `W` is the recency-weighted observation count and `S` the recency-
 * weighted sum of squared residuals about the bias term.
 *
 * - The tail cannot happen: `b >= b0 > 0`, so a two-observation team is pulled
 *   toward its talent-implied prior instead of asserting near perfect
 *   consistency.
 * - Shrinkage is automatic and evidence-proportional: `W` small means the prior
 *   dominates, `W` large means the data does. No separate rule.
 * - `b/(a-1)` is the POSTERIOR PREDICTIVE variance, not a point estimate of
 *   sigma^2. Uncertainty ABOUT the volatility widens the reported answer rather
 *   than being silently dropped — which is the honest thing to report to a scout
 *   who is asking about one upcoming match.
 *
 * `a > 1` is required for the predictive variance to exist, so `priorObs > 2` is
 * enforced in the constructor rather than left to produce a silent Infinity.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PRIOR SCALES WITH TALENT
 * ---------------------------------------------------------------------------
 *
 * Swing is measured in POINTS, and a robot that scores more has more points to
 * swing by. Measured on BPR 2024-2026, mean swing runs 5.93 in the lowest decile
 * against 64.46 in the highest — better than a 10x range. A flat prior would
 * therefore drag strong robots down and weak robots up, which is the opposite of
 * shrinking toward a comparable peer group.
 *
 * `priorSigma = priorK * max(talent, TALENT_FLOOR)`, where `talent` is the
 * team's own rating from the algorithm's state as of BEFORE the match, and
 * `priorK` is ONE running population number, `sqrt(sum residual^2 / sum
 * talent^2)`. One number keeps it walk-forward and O(1); `TALENT_FLOOR` exists
 * because OPR ratings can be zero or negative and a prior of zero would
 * reintroduce the very tail this is built to remove.
 *
 * A talent-independent variant is deliberately testable via `talentPrior:
 * false`, because "the talent scaling earns its place" is a claim that should be
 * measured rather than assumed. `compareSigmaScore.ts` runs both.
 */

/** Floor applied to a team's talent before it scales the prior. OPR ratings can be <= 0. */
export const TALENT_FLOOR = 1;

/**
 * Fallback `priorK` before the population has accumulated any evidence — the
 * ratio of residual spread to talent for a typical robot. Only ever used for the
 * first few matches of a season's replay, and deliberately NOT tuned: if this
 * value mattered to any reported result, the prior would be doing work the data
 * should be doing.
 */
export const INITIAL_PRIOR_K = 0.5;

/**
 * Bounds on the talent-scaled prior, as multiples of the population's own RMS
 * residual. See `priorSigmaFor` for the measured blow-up these repair — they are
 * a correctness fix, not defensive padding, and they are deliberately wide
 * enough that a settled mid-season prior never touches them.
 */
export const PRIOR_SIGMA_MIN_RATIO = 0.25;
export const PRIOR_SIGMA_MAX_RATIO = 4;

/**
 * Population observations required before the prior scales with talent at all.
 * Below this the flat population spread is used instead — see `priorSigmaFor`.
 * A few hundred alliance-observations is a handful of matches into a season, so
 * this costs nothing real and removes the window where `priorK` is undefined in
 * all but name.
 */
export const MIN_POPULATION_FOR_TALENT_PRIOR = 200;

export interface SigmaScoreOptions {
  /**
   * Half-life, in a team's own matches, of the BIAS term that residuals are
   * measured about. SLOW on purpose — see this module's header. A large value
   * keeps a performance level-shift visible as volatility instead of absorbing
   * it into the mean.
   */
  readonly meanHalfLife: number;
  /** Half-life of the VOLATILITY evidence itself. Fast, so a break surfaces promptly. */
  readonly varHalfLife: number;
  /**
   * Prior strength in pseudo-observations. Must exceed 2 or the posterior
   * predictive variance does not exist.
   */
  readonly priorObs: number;
  /** Multiplier on the reported figure. 1 means "report an honest 1 sigma in points". */
  readonly scale: number;
  /** When false, the prior ignores talent — the control that tests whether talent scaling helps. */
  readonly talentPrior: boolean;
}

export const DEFAULT_SIGMA_SCORE_OPTIONS: SigmaScoreOptions = {
  meanHalfLife: 18,
  varHalfLife: 6,
  priorObs: 4,
  scale: 1,
  talentPrior: true,
};

/** One team's running state. Six numbers, all O(1) to update. */
interface SigmaBelief {
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
 * Walk-forward Sigma Score accumulator.
 *
 * Usage contract, and it is load-bearing: for each match in chronological order,
 * call `observeTalent` for the teams on it, READ `sigmaFor` for any team you want
 * a pre-match figure for, and only THEN `fold` the match's deviations. Reading
 * after folding would let a match inform its own estimate, which is the
 * predict-before-update rule the whole project runs on.
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

  #belief(teamKey: string): SigmaBelief {
    let belief = this.#beliefs.get(teamKey);
    if (belief === undefined) {
      belief = { meanWeight: 0, mean: 0, varWeight: 0, sumSquares: 0, talent: TALENT_FLOOR };
      this.#beliefs.set(teamKey, belief);
    }
    return belief;
  }

  /**
   * Records a team's talent as of now. Call BEFORE folding the match it was read
   * from, so the prior a match is scored against never depends on that match.
   *
   * A non-finite talent is ignored rather than stored: some algorithms report no
   * rating for a team they have never seen, and a NaN would propagate into every
   * later prior for that team.
   */
  observeTalent(teamKey: string, talent: number): void {
    if (!Number.isFinite(talent)) return;
    this.#belief(teamKey).talent = talent;
  }

  /** The population's running residual-to-talent ratio — the `priorK` of this module's header. */
  priorK(): number {
    if (this.#populationCount === 0 || this.#populationTalentSquares <= 0) return INITIAL_PRIOR_K;
    return Math.sqrt(this.#populationSumSquares / this.#populationTalentSquares);
  }

  /**
   * The prior spread for one team: its talent-implied typical swing.
   *
   * With `talentPrior: false` this collapses to the population's own RMS
   * residual, i.e. one number for every team regardless of strength — the
   * control described in this module's header.
   */
  /**
   * The population's own RMS residual — the flat prior, and the reference the
   * talent-scaled prior is clamped against.
   */
  populationSigma(): number {
    if (this.#populationCount === 0) return INITIAL_PRIOR_K;
    return Math.sqrt(this.#populationSumSquares / this.#populationCount);
  }

  priorSigmaFor(teamKey: string): number {
    const populationSigma = this.populationSigma();
    if (!this.#options.talentPrior) return populationSigma;

    // TALENT SCALING IS WITHHELD until the population has been observed enough
    // times for `priorK` to mean anything. Both halves of the talent prior —
    // the ratio and the band it is clamped to — are population statistics, and
    // early in a replay neither exists yet. Scaling by talent against an
    // unformed `priorK` is precisely how the measured 2026 blow-up started.
    if (this.#populationCount < MIN_POPULATION_FOR_TALENT_PRIOR) return populationSigma;

    const talent = Math.max(this.#belief(teamKey).talent, TALENT_FLOOR);
    const scaled = this.priorK() * talent;

    // CLAMPED to a band around the population's own spread, and this is not
    // defensive padding — it repairs a measured blow-up.
    //
    // `priorK` is `sqrt(sum residual^2 / sum talent^2)`, so early in a season,
    // when ratings are still near zero but residuals are already full-sized, its
    // denominator is tiny and it spikes. Measured on 2026: priorK peaks at 34.06
    // against a settled value of 0.33-0.75. Multiply that by an early OPR rating
    // (max observed talent: 9,310, because an under-determined least-squares
    // solve produces nonsense before it has enough matches) and the prior claimed
    // a 2,780-point swing for a single robot.
    //
    // The damage was real and the holdout is what caught it: 2024-2025 tuning
    // looked healthy, and the 2026 confirmation run showed trimmed-mean NLL at
    // 23.3 for the talent-prior variants against 4.99 for the flat-prior control
    // — the control being clean is what localised it to this line.
    //
    // A prior may refine WITHIN the range the population actually exhibits; it
    // may not assert a spread an order of magnitude outside it on the strength of
    // a rating the algorithm itself has not yet pinned down. The bounds are
    // deliberately wide — this bites only the pathological tail, and a settled
    // mid-season prior is nowhere near them.
    return Math.min(Math.max(scaled, PRIOR_SIGMA_MIN_RATIO * populationSigma), PRIOR_SIGMA_MAX_RATIO * populationSigma);
  }

  /**
   * This team's Sigma Score from everything folded so far.
   *
   * ALWAYS DEFINED, including for a team seen zero times, and that is a
   * deliberate divergence from Swing Factor's below-two-observations
   * `undefined`. The prior alone is a legitimate answer to "how wildly might
   * this robot swing" — it is what a scout would assume from the robot's talent
   * before seeing it play — whereas Swing Factor had no prior and so genuinely
   * had nothing to say. It also means Sigma Score can price a band for every
   * match including a team's first, which Swing Factor structurally cannot.
   */
  sigmaFor(teamKey: string): number {
    const belief = this.#belief(teamKey);
    const priorSigma = this.priorSigmaFor(teamKey);
    const alpha0 = this.#options.priorObs / 2;

    // beta0 = (alpha0 - 1) * priorSigma^2, NOT alpha0 * priorSigma^2.
    //
    // This parameterisation is load-bearing and was arrived at by a failing
    // test. With the natural-looking `alpha0 * priorSigma^2`, the PRIOR
    // PREDICTIVE variance comes out as priorSigma^2 * alpha0/(alpha0 - 1) —
    // so `priorObs` silently moved the whole metric's LEVEL as well as its
    // shrinkage strength. At priorObs 3 a never-seen team read 1.73x its
    // intended prior spread, at priorObs 20 only 1.05x, which makes any sweep
    // over priorObs uninterpretable: two candidates would differ in both
    // calibration and shrinkage at once with no way to attribute the result.
    //
    // Solving `beta0 / (alpha0 - 1) = priorSigma^2` instead makes the
    // prior-only reading EXACTLY priorSigma, whatever priorObs is. `priorObs`
    // then does one job only — how much evidence it takes to move off the
    // prior — which is the knob the comparison actually wants to vary.
    const beta0 = (alpha0 - 1) * priorSigma * priorSigma;

    const alpha = alpha0 + belief.varWeight / 2;
    const beta = beta0 + belief.sumSquares / 2;
    // alpha - 1 > 0 is guaranteed by the priorObs > 2 constructor check, and
    // varWeight only ever adds to it.
    return this.#options.scale * Math.sqrt(beta / (alpha - 1));
  }

  /** This team's current bias term — the location a predictive distribution is centred on. */
  biasFor(teamKey: string): number {
    return this.#belief(teamKey).mean;
  }

  /**
   * Folds one deviation into a team's belief.
   *
   * The residual is taken about the bias term BEFORE that bias absorbs this
   * observation. That ordering is what makes a level shift register: a robot that
   * just broke produces a large residual against where it USED to be, which is
   * precisely the signal a scout wants, and it would be partly cancelled if the
   * mean were updated first.
   */
  fold(teamKey: string, deviation: number): void {
    if (!Number.isFinite(deviation)) return;
    const belief = this.#belief(teamKey);

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
