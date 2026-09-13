/**
 * SIGMA SCORE — a Bayesian, talent-informed estimate of how widely a robot's
 * contribution might vary in its NEXT match.
 *
 * SHIPPED FOR BPR ONLY (quick task 260910-u7g measured it; the ship decision is
 * the developer's, 2026-09-10). `SIGMA_SCORE_ALGORITHM_IDS` is the single place
 * that scope is declared — OPR and EPA publish no consistency metric at all and,
 * since quick task 260913-g66, no match band either. Since quick task
 * 260913-it4 they also publish no ranking-point odds: the retired per-robot
 * consistency accumulator that used to supply their internal win-odds variance
 * was deleted outright (developer decision, 2026-09-13), with no replacement.
 * See `sigmaMatchBandVariance` and `publishesRankingPoints`.
 *
 * Consumers: `sigmaScoutLayer.ts` (bands and the per-team figure), `publish.ts`
 * (the published `sigma` metric). The head-to-head script that justified
 * shipping it was deleted by quick task 260913-it4 along with the retired
 * accumulator it compared against; it is restorable from git history.
 *
 * WHY BPR ONLY, since "better metric, ship it everywhere" is the obvious
 * alternative: measured over 110,232 rows per algorithm on 2026, Sigma beats
 * the retired per-robot consistency accumulator on calibration, on separating
 * steady robots from erratic ones, and on catastrophic-failure avoidance for
 * ALL THREE algorithms — but on volatility RANKING and trimmed likelihood it
 * wins for OPR and BPR and LOSES for EPA. It is scoped to the premier algorithm
 * rather than shipped where it is worse.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS FOR, WHICH DECIDES ITS SHAPE
 * ---------------------------------------------------------------------------
 *
 * From the developer, and every design choice below traces to one of these two
 * sentences:
 *
 *   (paraphrased) How widely might their performance vary next match? If a
 *   robot breaks, or finally starts working, Sigma Score captures that for a
 *   scout. Versus if they have performed the same every match, Sigma Score
 *   should be low.
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
 * The retired per-robot consistency accumulator centred squared residuals on a
 * recency-weighted mean with a SIX MATCH half-life — the same half-life it used
 * for the variance. That
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
 * Separating them is the whole idea. The retired accumulator was the special
 * case where both are 6, which is why it could not satisfy both requirements at
 * once.
 *
 * ---------------------------------------------------------------------------
 * THE BAYESIAN PART, AND THE THREE MEASURED DEFECTS IT EXISTS TO FIX
 * ---------------------------------------------------------------------------
 *
 * Quick task 260910-sz9 measured the shipped estimator over 297,854 team-matches
 * and found three things, all traceable to it being an unregularised sample
 * statistic over an effective sample of about nine:
 *
 *   1. A near-zero tail. 0.06-0.35% of rows carry a spread below 1 point (two
 *      near-identical deviations), and under a log score those few hundred rows
 *      carry 83-100% of the total loss. The site publishes "perfectly
 *      consistent" and the robot then misses by 40 points.
 *   2. Regression to the mean. The ratio of published spread to realized spread
 *      climbs monotonically 0.80 -> 1.94 across deciles: low-spread teams are
 *      badly under-estimated, high-spread teams about right.
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
 * Volatility is measured in POINTS, and a robot that scores more has more points
 * to vary by. Measured on BPR 2024-2026, mean spread runs 5.93 in the lowest decile
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
 * measured rather than assumed. The head-to-head that ran both was deleted by
 * quick task 260913-it4 and is restorable from git history.
 */

/**
 * The published metric key Sigma Score is injected under at publish time.
 *
 * A DISTINCT key from the retired per-robot consistency accumulator's old
 * metric key, not a replacement of its contents, and the distinction is what
 * keeps the UI free of algorithm-ID branching: the
 * Sigma column and tile render exactly when this key is present on the row, so
 * "which algorithms show a consistency number" is answered by the data rather
 * than by a hardcoded list in the browser. An algorithm that starts or stops
 * publishing Sigma needs no web change at all.
 */
export const SIGMA_METRIC_KEY = "sigma";

/**
 * The algorithms that publish Sigma Score.
 *
 * BPR ONLY, by developer decision (2026-09-10), on the measured result in quick
 * task 260910-u7g: Sigma beats the retired per-robot consistency accumulator on
 * calibration, separation and catastrophic-failure avoidance for all three
 * algorithms, but on volatility RANKING and trimmed likelihood it wins for OPR
 * and BPR and LOSES for EPA. Rather than ship a metric that is better on two
 * algorithms and worse on the third, the developer scoped it to the premier
 * algorithm.
 *
 * OPR and EPA therefore publish NO consistency metric at all and show no column
 * — also a developer decision, over the alternative of leaving the retired
 * accumulator's figure visible for them. Since quick task 260913-g66 they also
 * publish NO match band, and since quick task 260913-it4 NO ranking-point odds
 * (see `publishesRankingPoints`). The display band is Sigma-only, built by
 * `sigmaMatchBandVariance`.
 *
 * 260912-ivg (BPR -> SPR identifier cutover): Stages 1-4 held this as a
 * transitional two-member set — the deployed browser-READ tier's pre-rename
 * id, still live at the time, alongside `spr` (the publisher/Worker-WRITE
 * tier) — so the predicate answered identically for either name during the
 * split. Stage 5 (this edit) removes the retired pre-rename member in the
 * same commit that collapses `PUBLISHED_ALGORITHM_IDS` onto `spr`.
 */
export const SIGMA_SCORE_ALGORITHM_IDS: ReadonlySet<string> = new Set(["spr"]);

/** Whether this algorithm publishes Sigma Score. */
export function usesSigmaScore(algorithmId: string): boolean {
  return SIGMA_SCORE_ALGORITHM_IDS.has(algorithmId);
}

/**
 * Whether this algorithm publishes ranking-point odds (the RP pmfs, their
 * decomposition, the bonus-RP probabilities and the pre-schedule sidecars the
 * rank simulation draws from).
 *
 * Ranking-point odds need a per-robot score variance, and only Sigma algorithms
 * carry one. OPR and EPA publish none, by developer decision of 2026-09-13
 * (quick task 260913-it4): the retired per-robot consistency accumulator that
 * used to supply their variance was deleted with no replacement, so the rank
 * simulation works under Sigma algorithms (SPR) only.
 *
 * Declared as its own predicate, rather than every caller reusing
 * `usesSigmaScore`, so a reader of an RP gate sees which capability it is
 * asking about. Today the two answer identically.
 */
export function publishesRankingPoints(algorithmId: string): boolean {
  return usesSigmaScore(algorithmId);
}

/**
 * One alliance's score VARIANCE from a per-team consistency map — the
 * quadrature sum of its roster's figures, or `undefined` if any member has none.
 *
 * The upcoming-row and pre-schedule RP paths read this over
 * `SigmaScoutLayer.consistencyByTeam()`, and the Sigma methodology page's figure
 * uses it. It is NOT `SigmaScoreAccumulator.bandVarianceFor`, which prices a
 * never-seen team from its prior: this helper keeps the all-or-nothing gate over
 * the map, so a roster member absent from the map yields no variance at all.
 *
 * All-or-nothing deliberately. Summing only the members we happen to know would
 * produce a systematically NARROWER band that reads as a confident prediction
 * rather than a partial one. That is the failure sketch 003 recorded, where a
 * band drawn from part of the variance put actual results 7–10σ outside it.
 * Better no band than a band that is too tight.
 *
 * Returning the VARIANCE rather than the standard deviation matches the
 * existing `redScoreVarianceOwn` convention and keeps the summing-squares
 * relationship visible: an alliance's variance is the sum of its teams' squared
 * figures, so three robots at ±10 give ±17.32, never ±30.
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
 * variance (quick task 260913-g66). The single display-band helper: the
 * offline layer (`SigmaScoutLayer.foldPlayed` / `enrichUpcoming`), the live
 * Worker and the Sigma methodology page all call this one function.
 *
 * UNDO THE EVEN-SPLIT SHRINKAGE (measured 2026-09-12).
 *
 * A robot's Sigma Score is the 1 standard deviation of its EVEN-SPLIT SHARE of
 * the alliance's miss: `SigmaScoreAccumulator.foldMatch` folds
 * `(actual - predicted) / rosterSize` into every roster member. So the sum of
 * `rosterSize` shares' variances — `bandVarianceFor`, the win-odds variance —
 * estimates `Var(alliance) / rosterSize`, not `Var(alliance)`, and a band drawn
 * from it is `sqrt(rosterSize)` too narrow. Multiplying by `rosterSize` turns
 * the shares back into a whole alliance. The same shrinkage, and the same
 * correction, as `empiricalMoments.ts`'s RP variances.
 *
 * Measured by walk-forward replay through `SigmaScoutLayer.foldPlayed` over
 * 2024 to 2026 at alliance level: SPR's share of results inside 1 band was
 * 47.1% before this correction and 71.7% after (72.2% on warm rosters), against
 * a 68.3% target.
 *
 * DISPLAY ONLY. The win and tie spread keeps the UNCORRECTED sum on purpose:
 * widening it by the same factor worsened Brier from 0.1559 to 0.1631, because
 * red's and blue's misses in one match are correlated (+0.21 for SPR) and the
 * margin's variance is therefore smaller than the two alliance variances
 * added. So `#rpFieldsFor` and the Worker's `rpFieldsFor` keep receiving the
 * win-odds variance, and only the published band is corrected.
 *
 * OPR and EPA publish no display band at all, and since quick task 260913-it4
 * no win-odds variance either. Callers gate on `usesSigmaScore` before calling
 * this.
 *
 * Returns `undefined` when the win-odds variance is undefined, the roster is
 * empty, or either input is non-finite — no band rather than a wrong one.
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
 * Fallback `priorK` before the population has accumulated any evidence — the
 * ratio of residual spread to talent for a typical robot. Only ever used for the
 * first few matches of a season's replay, and deliberately NOT tuned: if this
 * value mattered to any reported result, the prior would be doing work the data
 * should be doing.
 */
export const INITIAL_PRIOR_K = 0.5;

/**
 * The structural slice of a match `foldMatch` needs. Deliberately NOT
 * `MatchResult` itself, so every real caller passes the object it already holds
 * (it is structurally assignable) and no positional argument can be
 * transposed, while a test can build a six-field literal. Both DQ fields are
 * REQUIRED, never optional: this is the mechanical enforcement of the
 * live/offline parity contract (`dq.ts`'s header, "D4") — a caller that omits
 * them must fail typecheck rather than silently fold a carded zero while
 * looking healthy.
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

/**
 * The belief returned for a team nobody has folded or observed. FROZEN so a
 * caller that mistakes a read for a write fails loudly instead of quietly
 * mutating every unseen team's shared state.
 */
const UNSEEN_BELIEF: SigmaBelief = Object.freeze({
  meanWeight: 0,
  mean: 0,
  varWeight: 0,
  sumSquares: 0,
  talent: TALENT_FLOOR,
});

/**
 * The population statistics the talent prior is built from. Persisted alongside
 * the per-team beliefs so a resumed accumulator computes the SAME prior the
 * offline publisher did — see `SigmaScoreAccumulator.fromBeliefs`.
 */
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

  /**
   * A team's belief WITHOUT creating one — the read path.
   *
   * Split from `#mutableBelief` because a getter that inserts makes results
   * ORDER-DEPENDENT, and that was not hypothetical: with a single
   * insert-on-read accessor, two orchestrations that wrote the same artifacts
   * produced different ranking-point pmfs for the same event (0.46525 against
   * 0.47), because merely PRICING a match created belief entries and
   * `scoreByTeam()` iterates exactly those keys. Whichever path happened to
   * read a team first changed what the other could see.
   *
   * Returns a frozen zero belief for an unseen team, so a read still yields the
   * prior-only Sigma Score without recording that the team was ever asked about.
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
   * Records a team's talent as of now. Call BEFORE folding the match it was read
   * from, so the prior a match is scored against never depends on that match.
   *
   * A non-finite talent is ignored rather than stored: some algorithms report no
   * rating for a team they have never seen, and a NaN would propagate into every
   * later prior for that team.
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

  /**
   * The prior spread for one team: its talent-implied typical variation.
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

    const talent = Math.max(this.#readBelief(teamKey).talent, TALENT_FLOOR);
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
    // a 2,780-point spread for a single robot.
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
   * deliberate divergence from the retired per-robot consistency accumulator's
   * below-two-observations `undefined`. The prior alone is a legitimate answer
   * to "how widely might this robot vary" — it is what a scout would assume
   * from the robot's talent before seeing it play — whereas the retired
   * accumulator had no prior and so genuinely had nothing to say. It also means
   * Sigma Score can price a band for every match including a team's first,
   * which the retired accumulator structurally could not.
   */
  sigmaFor(teamKey: string): number {
    const belief = this.#readBelief(teamKey);
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
    return this.#readBelief(teamKey).mean;
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
  /**
   * Resumes from persisted beliefs — the live Worker's entry point (shape 11).
   *
   * Copies each belief rather than aliasing it, so folding here cannot mutate
   * the caller's map. A resumed accumulator is indistinguishable from one that
   * folded the whole history itself, which is the entire point: a live tick
   * CONTINUES the offline publisher's accumulator rather than starting a
   * second, shorter one. Starting fresh would build a band from one event's
   * matches while the offline band came from the whole season, and both would
   * look healthy.
   *
   * `population` carries the population statistics the talent prior needs.
   * Without them a resumed accumulator would fall back to the flat prior (see
   * `MIN_POPULATION_FOR_TALENT_PRIOR`) and quietly compute different numbers
   * from the same beliefs.
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

  /**
   * The population statistics behind the talent prior, for persistence.
   *
   * THREE NUMBERS, not per team, so this belongs in the league row rather than
   * the team rows — it does not scale with team count, which is the rule
   * `MAX_LEAGUE_ROW_BYTES` enforces.
   */
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
   * One alliance's band variance — the quadrature sum of its roster's Sigma
   * Scores.
   *
   * This is the WIN-ODDS variance the ranking-point pmf reads, not the
   * published display band: the display band is
   * `sigmaMatchBandVariance(roster.length, this)`, which undoes the even-split
   * shrinkage (quick task 260913-g66).
   *
   * Unlike `allianceSigmaBandVariance`'s all-or-nothing rule there is no
   * undefined case here beyond an empty roster, because Sigma always has a
   * figure. The rule that helper enforces — better no band than one built from
   * part of the variance — does not arise: every roster member contributes a
   * real term, from its prior if it has no history of its own.
   *
   * A consequence worth stating: a BPR match whose roster is all debutants now
   * carries a band where the retired per-robot consistency accumulator produced
   * none. That is the intended behaviour,
   * not an accident, and it is what lets the rank simulation price matches that
   * previously had no pmf at all.
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
   * Folds a whole MATCH, applying the demo and full-DQ-zero rules.
   *
   * Every algorithm's `update` returns state unchanged when either alliance is
   * fully demo: a real alliance "beating" three placeholders is not evidence
   * about anybody, so its residual must not widen or narrow a band either. A
   * whole-alliance card ruling (`dq.ts`'s composition contract) is not evidence
   * about the three robots that were physically on the field, so a fully-DQ'd,
   * exactly-zero-scored alliance's own fold is skipped — only that alliance's,
   * never the opponent's genuine score. A partial DQ, or a whole-alliance DQ
   * with a non-zero recorded score, folds normally.
   *
   * This lives at match level, rather than in each caller, because there are
   * two callers — the offline publisher and the live Worker — and a rule applied
   * in one and not the other is precisely how live and offline drift apart
   * while both look healthy.
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
