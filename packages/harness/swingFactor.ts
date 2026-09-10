/**
 * SWING FACTOR — a SigmaScout-layer heuristic, computed identically for
 * every algorithm and, since quick task 260909-tgf, PUBLISHED as a
 * first-class metric (`SWING_METRIC_KEY`) rather than left as a bare
 * top-level field. THE ESTIMATOR ITSELF DID NOT CHANGE AND THE NUMBERS DID
 * NOT MOVE — this header edit is a framing correction for what became true
 * once Swing Factor started flowing through the percentile/tier machinery,
 * not a rewrite of the estimator's own documentation below.
 *
 * ---------------------------------------------------------------------------
 * THE TWO LEVELS, AND WHY THIS FILE IS NOT IN `packages/core/algorithms`
 * ---------------------------------------------------------------------------
 *
 * There are two layers in this project and they must not be confused:
 *
 *   1. THE ALGORITHM — OPR, EPA, BPR (and, until it retires, VPR). It predicts
 *      match scores. Some of them additionally model their own predictive
 *      variance and publish it as `Prediction.redScoreVarianceOwn`; OPR and EPA
 *      do not, and are under no obligation to.
 *
 *   2. SIGMASCOUT'S OWN SCOUTING FEATURES, built ON TOP of whatever the
 *      algorithm produced and computed identically for every one of them.
 *      Swing Factor and the match band live here. They are frankly
 *      HEURISTICS — their job is to give a scout a usable feel for how
 *      consistent a robot is, not to be a term in anybody's model.
 *
 * The whole point is that level 2 asks NOTHING of level 1 beyond a predicted
 * score and an actual score. That is why every algorithm gets these features
 * and why adding a fifth algorithm tomorrow gets them for free.
 *
 * A consequence worth stating plainly, because it is the entire reason this
 * module exists at publish time rather than in the browser: because this is
 * computed once, from one pass, and published, the SAME number appears on a
 * team page and on an event page for the same match. It cannot drift, because
 * there is only one of it.
 *
 * Promoting Swing Factor to a published metric (this quick task) does not
 * cross level 1/level 2 boundary in the other direction: it is INJECTED at
 * publish time as a synthetic metric entry under `SWING_METRIC_KEY` so it
 * inherits the percentile/tier/sort machinery every other metric already
 * has, while remaining outside every algorithm's own state and outside
 * `AlgorithmModule.teamMetrics` — no `AlgorithmModule` implementation
 * computes it or knows its name. `packages/harness/publish.ts` merges it in
 * once per `(algorithm, season)`, after `layerForAlgo.swingByTeam()` has
 * already run, exactly the same way it always has.
 *
 * ---------------------------------------------------------------------------
 * THE ESTIMATOR
 * ---------------------------------------------------------------------------
 *
 *     deviation for one team in one match = (actual − predicted) / rosterSize
 *
 * i.e. that team's even share of its alliance's residual. FRC publishes no
 * per-robot score (Assumption A1) — only alliance totals — so every per-robot
 * quantity in this system is inferred and absorbs its partners' variability.
 * That is a real limit and it is not papered over: measured walk-forward over
 * 275,172 team-matches, the best achievable correlation between any estimator
 * of this shape and a team's ACTUAL deviation in its next match is about 0.59.
 *
 * Swing Factor is then the recency-weighted spread of those deviations ABOUT
 * THE TEAM'S OWN MEAN, scaled to points. Centring is what makes it a statement
 * about the ROBOT rather than about the model: a weak algorithm that misses a
 * team by +230 every single match has produced no evidence of swing at all, and
 * squaring about zero would have reported that bias as though the robot were
 * wildly inconsistent. Measured on OPR before centring, one team's figure was
 * ±298.92 against a rating of 322.42, almost all of it Einstein bias.
 */

import { isFullyDemoAlliance } from "../core/algorithms/demoTeams.js";

/**
 * The published metric key Swing Factor is injected under at publish time
 * (quick task 260909-tgf). Declared ONCE, here — this module is already
 * imported by `apps/web/src/components/methodology/SwingPage.tsx`, so it is
 * proven browser-safe (no Node built-ins), which is what lets
 * `apps/web/src/components/teams-table/rowModel.ts` import the SAME
 * constant rather than retyping the literal `"swing"`. Every other file
 * (`metricDirection.ts`, `swingMetric.ts`, `publish.ts`, `rowModel.ts`)
 * imports this constant; grep for `SWING_METRIC_KEY *=` finds exactly one
 * declaration.
 */
export const SWING_METRIC_KEY = "swing";

/**
 * Half-life in matches: a deviation six matches old counts half as much as the
 * newest. MEASURED, not chosen — swept walk-forward over 275,172 team-matches
 * (2024-2026) against how well the estimate predicts a team's ACTUAL next-match
 * deviation. 6 sits at the top of a plateau spanning roughly 4–12, where decay
 * beats a flat average by 2.3%. A future re-measurement landing on 5 or 8 would
 * not contradict this one.
 */
export const SWING_FACTOR_HALF_LIFE_MATCHES = 6;

/**
 * Turns the weighted spread of even-split deviations into a points-readable
 * figure.
 *
 * Measured NON-CIRCULARLY on 86,844 alliance-observations: if `Y_i` really is
 * robot i's own swing then `√(Ya² + Yb² + Yc²)` should equal the ALLIANCE's
 * residual magnitude — and unlike any per-robot quantity, that IS observable.
 * Regressing observed alliance residual magnitude on the three robots' unscaled
 * RMS deviations gave 1.92. (The first attempt at this was circular — it
 * regressed a team's even-split deviation on its own past even-split deviations
 * and duly recovered ~1.0. Recorded so nobody repeats it.)
 *
 * RE-VALIDATED after centring, 2026-09-08: walk-forward over 31,142
 * alliance-observations of 2026, the scale that would make the band a textbook
 * 1σ is 1.99 for VPR and 2.06 for EPA. 1.92 sits inside that, so it carries
 * over rather than being re-fitted.
 *
 * KNOWN CONSERVATIVE, and stated rather than hidden: at 1.92 the resulting band
 * covers about 76% of actual scores for VPR/EPA and about 87% for OPR, where a
 * true 1σ Gaussian band covers 68.3%. A coverage-calibrated scale would be 1.68
 * / 1.71 / 1.13 respectively, and was deliberately NOT adopted — three
 * per-algorithm constants would need re-measuring on every model change, which
 * is exactly the kind of stale number this project's failure log is about.
 */
export const SWING_FACTOR_SCALE = 1.92;

/** The per-observation decay: an observation `age` folds back carries `decay ** age`. */
export function swingDecayFor(halfLifeMatches: number): number {
  return 0.5 ** (1 / halfLifeMatches);
}

const SWING_DECAY = swingDecayFor(SWING_FACTOR_HALF_LIFE_MATCHES);

/**
 * One team's running Swing Factor state — FOUR NUMBERS, no deviation list.
 *
 * This shape is the reason the live Worker can produce a band at all. The
 * Worker holds algorithm state and nothing else; it has no room to carry every
 * team's deviation history, and re-deriving one per tick is not affordable
 * against a 10 ms CPU budget. Four floats per team, updated in O(1) per match,
 * fit inside the team row it already reads and writes.
 *
 * `weightSquares` is carried solely for the effective-sample denominator that
 * makes a one-observation team return nothing rather than a fake `0`.
 */
export interface SwingBelief {
  /** Σ of decayed weights. */
  weight: number;
  /** Σ of decayed weights SQUARED — the effective-sample correction. */
  weightSquares: number;
  /** Weighted mean of the deviations so far. */
  mean: number;
  /** Weighted sum of squares about that running mean. */
  m2: number;
}

/** A team that has been seen zero times. */
export function emptySwingBelief(): SwingBelief {
  return { weight: 0, weightSquares: 0, mean: 0, m2: 0 };
}

/**
 * West's weighted incremental update, decaying every prior weight first.
 *
 * This is the ONE arithmetic path for Swing Factor — offline publish and live
 * Worker both run exactly this, which is what lets the live/offline replay
 * digest assert bit-equality on the band rather than merely intend it. Two
 * algebraically-equal-but-differently-rounded implementations would agree to
 * about twelve digits and disagree on the thirteenth, which is precisely what
 * that contract exists to catch.
 *
 * Numerically stable: it never subtracts two large nearly-equal numbers, which
 * is the failure the naive `E[x²] − E[x]²` form suffers exactly where this
 * estimator spends its time. A biased model's deviations are large and nearly
 * equal, so both terms are big and their difference is tiny — measured, five
 * identical deviations of 3 returned 9.05e-8 instead of 0 through that form.
 *
 * Identical deviations still return EXACTLY 0 here, not nearly 0: the running
 * mean lands exactly on the repeated value, so `delta` is exactly zero and `m2`
 * never leaves zero.
 */
export function foldSwingDeviation(belief: SwingBelief, deviation: number): void {
  const decayedWeight = SWING_DECAY * belief.weight;
  const decayedM2 = SWING_DECAY * belief.m2;
  const weight = decayedWeight + 1;
  const delta = deviation - belief.mean;
  const mean = belief.mean + delta / weight;
  belief.weight = weight;
  belief.weightSquares = SWING_DECAY * SWING_DECAY * belief.weightSquares + 1;
  belief.mean = mean;
  belief.m2 = decayedM2 + delta * (deviation - mean);
}

/**
 * A belief's Swing Factor, or `undefined` when it cannot honestly produce one.
 *
 * The effective-sample denominator `W − W2/W` is exactly 0 after a single
 * observation (`W = W2 = 1`), so the below-two-observations rule falls out of
 * the arithmetic rather than needing a separate counter.
 */
export function swingFactorFromBelief(belief: SwingBelief): number | undefined {
  if (belief.weight <= 0) return undefined;
  const denominator = belief.weight - belief.weightSquares / belief.weight;
  if (denominator <= 0) return undefined;
  return SWING_FACTOR_SCALE * Math.sqrt(Math.max(0, belief.m2 / denominator));
}

/**
 * Folds a chronologically ordered (oldest first) deviation list into one Swing
 * Factor, or `undefined` when it cannot honestly produce one.
 *
 * Returns `undefined` for FEWER THAN TWO observations. A single point cannot
 * separate model bias from robot swing — its spread about its own mean is
 * `0/0`, not zero — and publishing `0.00` there would assert perfect
 * consistency for a robot we have seen once. This is a deliberate, narrow
 * divergence from Sigma1's old never-blank rule (D-Y2), which governed a
 * quantity computed about zero where one observation genuinely did suffice.
 *
 * Identical deviations yield exactly `0`, and that is correct rather than a
 * degenerate case: a robot the model misses by a CONSTANT is perfectly
 * consistent, and the constant is the model's problem, not the robot's.
 *
 * A THIN WRAPPER over `foldSwingDeviation` since 2026-09-09, not an
 * independent implementation. It used to run its own exact two-pass pass over
 * the list; that was replaced when the live Worker needed the same estimator
 * from four running numbers, because two algebraically-equal implementations
 * would have agreed to about twelve digits and disagreed on the thirteenth —
 * and the live/offline contract is bit-equality. One arithmetic path, so there
 * is nothing to diverge. See `foldSwingDeviation` for the stability argument
 * that made this safe to collapse.
 *
 * Throws on a non-finite deviation rather than skipping or coercing it: that is
 * an upstream bug, and a coerced zero would publish "perfectly consistent" for
 * corrupt data. This is a deliberate contract difference from
 * `SwingFactorAccumulator.fold`, which ignores a malformed row — a caller
 * handing over an explicit list is asserting the list is good.
 */
export function swingFactorFromDeviations(deviations: readonly number[]): number | undefined {
  for (const deviation of deviations) {
    if (!Number.isFinite(deviation)) {
      throw new Error(
        `swingFactorFromDeviations: non-finite deviation ${deviation} — refusing to fold it into a published Swing Factor`
      );
    }
  }
  if (deviations.length < 2) return undefined;

  const belief = emptySwingBelief();
  for (const deviation of deviations) foldSwingDeviation(belief, deviation);
  return swingFactorFromBelief(belief);
}

/**
 * One alliance's band VARIANCE — the quadrature sum of its roster's Swing
 * Factors, or `undefined` if any member has none.
 *
 * All-or-nothing deliberately. Summing only the members we happen to know would
 * produce a systematically NARROWER band that reads as a confident prediction
 * rather than a partial one. That is the failure sketch 003 recorded, where a
 * band drawn from part of the variance put actual results 7–10σ outside it.
 * Better no band than a band that is too tight.
 *
 * Publishing the VARIANCE rather than the standard deviation matches the
 * existing `redScoreVarianceOwn` convention and keeps the summing-squares
 * relationship visible on the wire: an alliance's variance is the sum of its
 * teams' squared Swing Factors, so three robots at ±10 give ±17.32, never ±30.
 */
export function allianceSwingBandVariance(
  roster: readonly string[],
  swingByTeam: ReadonlyMap<string, number>
): number | undefined {
  if (roster.length === 0) return undefined;
  let variance = 0;
  for (const teamKey of roster) {
    const swing = swingByTeam.get(teamKey);
    if (swing === undefined) return undefined;
    variance += swing * swing;
  }
  return variance;
}

/**
 * A walk-forward accumulator: feed it matches in chronological order, asking
 * for a band BEFORE folding each match in.
 *
 * Predict-before-update is the project's standing methodology rule, and it is
 * not ceremony here — a band around a played match answers "how unsure were we
 * when we predicted this", so building it from later matches would describe the
 * past using the future. The published band for match N therefore uses only
 * matches 1..N−1, which is exactly what a reader looking at an upcoming match
 * would have had.
 *
 * Deliberately NOT reset between events: a team arriving at its second event
 * carries what it showed at its first, which is what a scout would expect and
 * what makes an early-event band possible at all.
 */
export class SwingFactorAccumulator {
  /**
   * Four running numbers per team, NOT a deviation list. Reading a team's Swing
   * Factor is now O(1) rather than O(its matches so far), which matters because
   * the publish path asks for one on every alliance of every match — but the
   * real reason for the shape is that the live Worker carries exactly this and
   * must produce bit-identical numbers from it.
   */
  private readonly beliefByTeam = new Map<string, SwingBelief>();

  /**
   * Resumes from persisted beliefs — the live Worker's entry point (shape 10).
   *
   * Copies each belief rather than aliasing it, so folding here cannot mutate
   * the caller's map. The resumed accumulator is indistinguishable from one
   * that folded the whole history itself, which is the entire point: a live
   * tick continues the offline publisher's accumulator rather than starting a
   * second, shorter one.
   */
  static fromBeliefs(beliefs: ReadonlyMap<string, SwingBelief>): SwingFactorAccumulator {
    const accumulator = new SwingFactorAccumulator();
    for (const [teamKey, belief] of beliefs) accumulator.beliefByTeam.set(teamKey, { ...belief });
    return accumulator;
  }

  /** This team's Swing Factor from everything folded so far, or `undefined` before two observations. */
  swingFor(teamKey: string): number | undefined {
    const belief = this.beliefByTeam.get(teamKey);
    return belief === undefined ? undefined : swingFactorFromBelief(belief);
  }

  /** This team's raw running state, for a caller that must persist it (the Worker). Undefined if the team has never been folded. */
  beliefFor(teamKey: string): SwingBelief | undefined {
    return this.beliefByTeam.get(teamKey);
  }

  /**
   * Every team's raw running state, for the D1 seed.
   *
   * Includes teams with a SINGLE observation, which `swingByTeam` deliberately
   * omits — that team has no publishable Swing Factor yet but does have
   * history, and dropping it from a seed would silently restart its
   * accumulator on the first live match.
   */
  beliefsByTeam(): ReadonlyMap<string, SwingBelief> {
    return new Map([...this.beliefByTeam].map(([teamKey, belief]) => [teamKey, { ...belief }]));
  }

  /** Every team with enough history to have one — the map `allianceSwingBandVariance` consumes. */
  swingByTeam(): ReadonlyMap<string, number> {
    const swings = new Map<string, number>();
    for (const teamKey of this.beliefByTeam.keys()) {
      const swing = this.swingFor(teamKey);
      if (swing !== undefined) swings.set(teamKey, swing);
    }
    return swings;
  }

  /** One alliance's band variance from history SO FAR — call before `fold`. */
  bandVarianceFor(roster: readonly string[]): number | undefined {
    if (roster.length === 0) return undefined;
    let variance = 0;
    for (const teamKey of roster) {
      const swing = this.swingFor(teamKey);
      if (swing === undefined) return undefined;
      variance += swing * swing;
    }
    return variance;
  }

  /**
   * Folds one alliance's observed residual into every team on that roster.
   * A non-finite or empty input is ignored rather than throwing — an unplayed
   * or malformed row simply contributes nothing and does not consume a decay
   * step.
   */
  /**
   * Folds a whole MATCH — both alliances — applying the fully-demo rule once.
   *
   * Every algorithm's `update` returns state unchanged when either alliance is
   * fully demo (`opr.ts:379`, `epa.ts:619`): a real alliance "beating" three
   * placeholders is not evidence of anything. A band is a claim about how
   * unsure we were, built from residuals, so a residual that is not evidence
   * about the robots must not widen or narrow it either.
   *
   * This lives here, at match level, rather than in each caller, because there
   * are two callers — the offline publisher and the live Worker — and a rule
   * applied in one and not the other is precisely how live and offline drift
   * apart while both look healthy.
   *
   * A MIXED alliance is folded normally, deliberately: a demo robot filling one
   * slot beside two real robots really did occupy that slot and really did
   * contribute to the observed score, so the residual is genuine evidence about
   * its teammates. That is the same split `demoTeams.ts` documents.
   */
  foldMatch(
    redTeams: readonly string[],
    redActual: number,
    redPredicted: number,
    blueTeams: readonly string[],
    blueActual: number,
    bluePredicted: number
  ): void {
    if (isFullyDemoAlliance(redTeams) || isFullyDemoAlliance(blueTeams)) return;
    this.fold(redTeams, redActual, redPredicted);
    this.fold(blueTeams, blueActual, bluePredicted);
  }

  fold(roster: readonly string[], actualScore: number, predictedScore: number): void {
    if (roster.length === 0) return;
    if (!Number.isFinite(actualScore) || !Number.isFinite(predictedScore)) return;
    const deviation = (actualScore - predictedScore) / roster.length;
    for (const teamKey of roster) {
      let belief = this.beliefByTeam.get(teamKey);
      if (belief === undefined) {
        belief = emptySwingBelief();
        this.beliefByTeam.set(teamKey, belief);
      }
      foldSwingDeviation(belief, deviation);
    }
  }
}
