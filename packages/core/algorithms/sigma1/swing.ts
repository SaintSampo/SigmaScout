/**
 * D-Y1/D-Y2/D-Y3 (quick task 260903-750): RECENCY-WEIGHTED ROBOT CONSISTENCY —
 * the estimator behind every published `±`.
 *
 * A team's published spread is
 *
 *     Y = SIGMA1_SWING_SCALE * sqrt( recency-weighted mean of that team's past
 *                                    squared per-match contribution deviations )
 *
 * where a per-match contribution deviation is the team's share of its
 * alliance's residual, `(observed - predicted) / n` — the quantity
 * `sigma1/index.ts`'s `applyAllianceUpdate` already computes as the innovation,
 * divided by the alliance's own slot count.
 *
 * ---------------------------------------------------------------------------
 * WHAT Y IS FOR, WHICH IS WHAT DECIDES ITS SHAPE
 * ---------------------------------------------------------------------------
 *
 * Three user stories, from the developer, and every property below follows
 * from one of them:
 *
 *   1. ALLIANCE SELECTION, TOP SEED. Two robots, same X. Alliance 1 picks the
 *      LOWER Y — it needs a robot that turns up the same every match.
 *   2. ALLIANCE SELECTION, LOW SEED. Two robots, same X. Alliance 8 picks the
 *      HIGHER Y — it needs variance to have any shot at Alliance 1.
 *   3. MID-QUALS. Team A must judge whether its partner will score reliably
 *      (so A can chase a bonus objective) or cannot be relied on (so A must
 *      maximise points).
 *
 * Those settle three things that the retired estimators got wrong:
 *
 *   - Y is about THE ROBOT'S OWN MATCH-TO-MATCH SWING, not the model's
 *     confidence in its rating. `P` — the Kalman posterior variance — is the
 *     latter, and it is nowhere in this file.
 *   - A BLANK Y IS USELESS. Story 2 needs a high Y to be VISIBLE; an omitted
 *     cell serves nobody, and it is precisely the low-consistency robots the
 *     retired decomposition blanked most often. See D-Y2 below.
 *   - Y must be COMPARABLE between two robots and READABLE IN POINTS.
 *
 * The developer explicitly allows Y to be a HEURISTIC, and asked that recent
 * matches count for more than old ones. This module is that heuristic. It is
 * not a solve, it has no ridge, no active set and no failure mode — it is one
 * running number per team per metric key, updated in O(1) per match.
 *
 * ---------------------------------------------------------------------------
 * BOTH CONSTANTS WERE MEASURED, NOT CHOSEN
 * ---------------------------------------------------------------------------
 *
 * See `SIGMA1_SWING_HALF_LIFE_MATCHES` and `SIGMA1_SWING_SCALE` for the two
 * measurements. Neither is a taste call, and the scale's FIRST attempt was
 * circular and is recorded as such so nobody re-derives it and believes it.
 *
 * ---------------------------------------------------------------------------
 * A WEIGHTED RMS ABOUT ZERO — NOT A SAMPLE STANDARD DEVIATION
 * ---------------------------------------------------------------------------
 *
 * Deviations are RESIDUALS, so they are already centred: their expectation is
 * 0 by construction of the filter that produced them. The estimator is
 * therefore the weighted mean of `dev^2` ABOUT ZERO, and NO RUNNING MEAN IS
 * SUBTRACTED. That is not a simplification — subtracting a running mean of a
 * quantity whose true mean is 0 would subtract noise, biasing Y downward by
 * exactly the amount of the sampling error, and would additionally make a
 * one-observation Y undefined (`0/0`) for no reason.
 *
 * This is the whole reason D-Y2's never-blank rule is honest rather than
 * forced: ONE centred observation is already a valid, noisy estimate of
 * `E[dev^2]`. A sample standard deviation over one point genuinely does not
 * exist; this does.
 *
 * ---------------------------------------------------------------------------
 * THE HONEST CEILING
 * ---------------------------------------------------------------------------
 *
 * Measured walk-forward over 275,172 team-matches (2024-2026), the best
 * achievable correlation between ANY estimator of this shape and a team's
 * ACTUAL deviation in its NEXT match is `r ~= 0.59`. THAT IS THE DATA'S LIMIT,
 * NOT THIS HEURISTIC'S SHORTFALL. FRC records no individual robot's score
 * (this project's Assumption A1) — TBA publishes alliance totals and
 * alliance-level breakdowns only — so every per-robot deviation anywhere in
 * this system is MODEL-INFERRED and absorbs its partners' variability. Y is a
 * genuinely noisy estimate of a robot's consistency, and this comment says so
 * rather than implying a precision the data cannot support.
 *
 * `e_m` also carries MEAN-MODEL ERROR as well as robot noise, so Y absorbs
 * some of the filter's own inaccuracy — carried forward from the retired
 * decomposition's own caveat list, because it did not stop being true.
 */

/**
 * The per-observation decay's HALF-LIFE, in matches: a deviation six matches
 * old counts half as much as the newest one.
 *
 * MEASURED, not chosen. Swept against how well Y predicts a team's ACTUAL
 * deviation in its NEXT match — walk-forward, with Y built only from strictly
 * earlier matches — over 275,172 team-matches spanning 2024-2026:
 *
 *     half-life   1.5     2      3      4      6      8      12     20    flat
 *     corr        .5694  .5788  .5876  .5911  .5930  .5927  .5909  .5879  .5794
 *
 * 6 wins. Record the size of the win honestly: DECAY BEATS A FLAT AVERAGE BY
 * 2.3%. That is real and it is MODEST. The curve is also flat between 4 and
 * 12, so 6 is the top of a plateau rather than a sharp optimum — a future
 * re-measurement landing on 5 or 8 would not be a contradiction of this one.
 *
 * The whole column is bounded above by ~0.59 for every half-life including
 * "flat", which is the ceiling this module's header states: the choice of
 * decay is a 2.3% refinement inside a limit set by the data.
 */
export const SIGMA1_SWING_HALF_LIFE_MATCHES = 6;

/**
 * The multiplier that turns a team's weighted-RMS deviation into a published,
 * points-readable `±`.
 *
 * MEASURED NON-CIRCULARLY on 86,844 alliance-observations. The instrument: IF
 * `Y_i` is really robot i's own swing, THEN `sqrt(Ya^2 + Yb^2 + Yc^2)` should
 * equal the ALLIANCE's residual magnitude — and the alliance residual IS
 * observable, unlike any per-robot quantity. Regressing the observed alliance
 * residual magnitude on the three robots' unscaled root-mean-square
 * deviations gives 1.92.
 *
 * THE FIRST ATTEMPT AT THIS WAS CIRCULAR AND IS RECORDED SO NOBODY REPEATS IT.
 * It regressed a team's even-split deviation on its own PAST even-split
 * deviations and returned ~1.0. That predicts a quantity from past values of
 * THE SAME quantity, so it can only ever recover the identity — it measured
 * the estimator against itself and would have shipped a scale of 1 with a
 * clean-looking regression behind it.
 *
 * WHY 1.92 AND NOT `sqrt(3) = 1.73`. Under D-06's independent-teams
 * assumption three independent robots' variances add, so the alliance's swing
 * would be exactly `sqrt(3)` times a single robot's. The measured excess is
 * that assumption FAILING: teammates' performances correlate (a good alliance
 * amplifies its members, a bad field suppresses them), so an alliance swings
 * MORE than three independent robots would. The measured constant ABSORBS
 * that correlation instead of assuming it away — which is why it is measured
 * at all rather than derived.
 *
 * A VERSIONED, NEVER-SEARCHED value: see `params.ts`'s `swingScale` and
 * `searchSpace.ts`'s `SEARCH_EXCLUSIONS` entry for why a display quantity is
 * not tunable by a Brier objective that is structurally blind to it.
 *
 * KNOWN STALE-ISH, and worth stating: both constants were measured against
 * `reports/is2-full` predictions, produced by an earlier model version.
 * Re-measure after the rolling-origin re-tune lands. The half-life is unlikely
 * to move much (it sits on a plateau); the scale may.
 */
export const SIGMA1_SWING_SCALE = 1.92;

/**
 * One metric key's running recency-weighted accumulator for one team.
 *
 *   - `weightedSquares` — `sum over past observations of w^age * dev^2`.
 *   - `weight`          — `sum over past observations of w^age`.
 *
 * The estimator is their RATIO, which is the weighted mean about zero exactly.
 * Carrying the denominator explicitly (rather than folding
 * `running = w*running + (1-w)*dev^2` and seeding `running` at the first
 * `dev^2`) is what makes a one-observation Y equal to `dev^2` EXACTLY and a
 * k-observation Y a true weighted mean at every k — the seeded form piles the
 * residual weight `w^(k-1)` onto the OLDEST observation, which is the one
 * place a recency-weighted estimator should least want it.
 *
 * Two numbers rather than one, and that is a deliberate cost: it is the
 * difference between "a weighted mean" and "something that converges to a
 * weighted mean", and D-Y2's never-blank guarantee lives at k = 1 where the
 * two differ most.
 */
export interface SwingAccumulator {
  readonly weightedSquares: number;
  readonly weight: number;
}

/** One team's swing state: metric key -> accumulator. A key absent means this team has never had that key folded — i.e. it has played no matches yet. */
export type TeamSwing = Readonly<Record<string, SwingAccumulator>>;

/** A team that has never been observed. NOT a zero-valued accumulator: "no observation" and "an observed deviation of zero" are different claims, and only the first may publish nothing. */
export function emptyTeamSwing(): TeamSwing {
  return {};
}

/**
 * The per-observation decay `w = 0.5 ** (1 / halfLifeMatches)`.
 *
 * Derived from the half-life rather than stored as a decay, because the
 * half-life is the quantity that was MEASURED and the quantity a reader can
 * reason about ("six matches"). A stored decay of 0.8908987181403393 would be
 * the same number with its provenance filed off.
 */
export function swingDecayFor(halfLifeMatches: number): number {
  return 0.5 ** (1 / halfLifeMatches);
}

/**
 * Folds ONE match's per-key squared deviations into a team's swing state.
 * Returns a NEW object; never mutates. O(1) per key — no history is retained
 * and nothing is re-derived from past matches.
 *
 *     weightedSquares' = w * weightedSquares + dev^2
 *     weight'          = w * weight          + 1
 *
 * A key not yet present starts from `{0, 0}`, so its first fold lands on
 * exactly `{dev^2, 1}` and its Y is exactly `SCALE * |dev|`. That is D-Y2's
 * never-blank rule falling out of the algebra rather than being special-cased
 * into it — there is no `if (first)` branch here and none may be added.
 *
 * Refuses a non-finite `dev^2` by throwing, never a silent skip or a coerced
 * zero — the same discipline `adaptation.ts`'s `foldInnovation` establishes,
 * and for the same reason: `sigma1/index.ts` already refuses non-finite
 * observed components upstream (T-02-01), so a non-finite value reaching here
 * is a genuine upstream bug rather than an input this function should paper
 * over. A coerced zero would be the worst possible repair — it would publish
 * "perfectly consistent" for a robot whose data was corrupt.
 */
export function foldSwingObservation(
  swing: TeamSwing,
  squaredDeviationByKey: Readonly<Record<string, number>>,
  halfLifeMatches: number
): TeamSwing {
  const w = swingDecayFor(halfLifeMatches);
  const next: Record<string, SwingAccumulator> = { ...swing };
  for (const [metricKey, squaredDeviation] of Object.entries(squaredDeviationByKey)) {
    if (!Number.isFinite(squaredDeviation)) {
      throw new Error(
        `foldSwingObservation: non-finite squared deviation ${squaredDeviation} for metric key "${metricKey}" — ` +
          `refusing to fold it into the published consistency estimate`
      );
    }
    const prior = swing[metricKey] ?? { weightedSquares: 0, weight: 0 };
    next[metricKey] = {
      weightedSquares: w * prior.weightedSquares + squaredDeviation,
      weight: w * prior.weight + 1,
    };
  }
  return next;
}

/**
 * The PUBLISHED `±` for one metric key: `scale * sqrt(weightedSquares / weight)`.
 *
 * Returns `undefined` in EXACTLY ONE case — the key has never been folded for
 * this team, i.e. the team has played no matches at all. That is a DOMAIN
 * CHECK (there is no observation to summarise), never a threshold: a team with
 * ONE match publishes a Y, and D-Y2 forbids adding any floor, minimum-match
 * rule or coverage-driven omission on top of it. The retired decomposition
 * blanked 40.2% of published cells; this returns a number for every cell a
 * played team has.
 *
 * AN EXACT `0` IS PUBLISHED, not omitted, and the distinction from the retired
 * estimator matters. There, a `0` meant "the constrained fit could not support
 * a positive variance for this team" — a statement about the SOLVE, which is
 * why publishing it as `0 ±` would have been a false claim of perfect
 * consistency. Here a `0` can only arise if EVERY observed deviation was
 * exactly `0.0`, which is a statement about the DATA: this robot's alliance
 * was predicted exactly right, every match. Publishing that is honest. (It
 * does not occur in real data and is not engineered for; it occurs in tests
 * built from perfectly uniform observations.)
 */
export function swingSpread(swing: TeamSwing, metricKey: string, scale: number): number | undefined {
  const accumulator = swing[metricKey];
  if (accumulator === undefined || accumulator.weight <= 0) return undefined;
  return scale * Math.sqrt(accumulator.weightedSquares / accumulator.weight);
}
