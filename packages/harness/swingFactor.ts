/**
 * SWING FACTOR — a SigmaScout-layer heuristic, deliberately NOT part of any
 * algorithm (developer framing, 2026-09-08).
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
 * TWO passes, not the algebraic `E[x²] − E[x]²` one-pass form, which cancels
 * catastrophically exactly where this estimator spends its time — a biased
 * model's deviations are large and nearly equal, so both terms are big and
 * their difference is tiny. Measured: five identical deviations of 3 returned
 * 9.05e-8 instead of 0 through the one-pass form.
 *
 * Throws on a non-finite deviation rather than skipping or coercing it: that is
 * an upstream bug, and a coerced zero would publish "perfectly consistent" for
 * corrupt data.
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

  const decay = swingDecayFor(SWING_FACTOR_HALF_LIFE_MATCHES);
  const lastIndex = deviations.length - 1;
  const weights = deviations.map((_, index) => decay ** (lastIndex - index));

  let weight = 0;
  let weightSquares = 0;
  let weightedSum = 0;
  for (const [index, w] of weights.entries()) {
    weight += w;
    weightSquares += w * w;
    weightedSum += w * (deviations[index] as number);
  }
  if (weight <= 0) return undefined;

  // Effective-sample-size denominator — exactly 0 at k = 1, which the guard
  // above has already handled, and positive thereafter.
  const denominator = weight - weightSquares / weight;
  if (denominator <= 0) return undefined;

  const mean = weightedSum / weight;
  let centredSumOfSquares = 0;
  for (const [index, w] of weights.entries()) {
    const centred = (deviations[index] as number) - mean;
    centredSumOfSquares += w * centred * centred;
  }
  return SWING_FACTOR_SCALE * Math.sqrt(centredSumOfSquares / denominator);
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
  private readonly deviationsByTeam = new Map<string, number[]>();

  /** This team's Swing Factor from everything folded so far, or `undefined` before two observations. */
  swingFor(teamKey: string): number | undefined {
    const deviations = this.deviationsByTeam.get(teamKey);
    return deviations === undefined ? undefined : swingFactorFromDeviations(deviations);
  }

  /** Every team with enough history to have one — the map `allianceSwingBandVariance` consumes. */
  swingByTeam(): ReadonlyMap<string, number> {
    const swings = new Map<string, number>();
    for (const teamKey of this.deviationsByTeam.keys()) {
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
  fold(roster: readonly string[], actualScore: number, predictedScore: number): void {
    if (roster.length === 0) return;
    if (!Number.isFinite(actualScore) || !Number.isFinite(predictedScore)) return;
    const deviation = (actualScore - predictedScore) / roster.length;
    for (const teamKey of roster) {
      const existing = this.deviationsByTeam.get(teamKey);
      if (existing === undefined) this.deviationsByTeam.set(teamKey, [deviation]);
      else existing.push(deviation);
    }
  }
}
