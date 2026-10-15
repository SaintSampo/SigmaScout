/**
 * THE AWARD POINT CONSTANTS AND THE STACK FOLD (quick task 260925-uf8):
 * Impact's and Rookie All Star's award types and district points, and the
 * fold that keeps two awards from ever being a predicted outcome. The drawer's
 * outcome list and the Champ Locks DCMP estimates read these.
 *
 * WHAT THIS FILE NO LONGER HOLDS. Until quick task 261014-qje it carried the
 * per season Impact and Rookie All Star ORDERING tables, the residual
 * award point table they were layered on, their lookups and the field
 * orderings. Those were replaced by the one award slate (`awardSlate.ts`),
 * which prices district events and District Championships alike; the tables,
 * the lookups and `scripts/measureAwardOrderingTables.ts` were deleted then.
 * The file keeps its name because `hypotheticalDcmp.ts` (in the Worker's
 * import graph) imports its two point constants.
 *
 * NO AWARD PREDICTION EVER REACHES `locks.ts`. Nothing here imports
 * `locks.ts` and nothing here exports a verdict.
 */

import { AWARD_POINT_SUPPORT } from "./awardBaseRates.js";

/** TBA's award type for the Impact award (Chairman's Award before 2022). */
export const IMPACT_AWARD_TYPE = 0;

/** TBA's award type for the Rookie All Star award. */
export const ROOKIE_ALL_STAR_AWARD_TYPE = 10;

/**
 * District points for the Impact award, and for Rookie All Star, equal to
 * their `DISTRICT_POINT_AWARD_VALUES` entries (quick task 261014-mii, M-01),
 * whose census in `scripts/measureAwardSlate.ts` checks every listed type
 * against the points TBA recorded.
 */
export const IMPACT_AWARD_POINTS = 10;
/** See `IMPACT_AWARD_POINTS`. */
export const ROOKIE_ALL_STAR_AWARD_POINTS = 8;

// ---------------------------------------------------------------------------
// TWO AWARDS ARE NEVER A PREDICTION (quick task 260925-uf8)
// ---------------------------------------------------------------------------

/**
 * The stacked support values, and the single award each folds onto.
 *
 * WHAT WAS MEASURED, AND WHAT JACOB RULED OUT. `AWARD_POINT_SUPPORT` is
 * `[0, 5, 8, 10, 13, 15]`, and the top two bins are real: a team-event at 13
 * won Rookie All Star (8) AND a judged award (5), and one at 15 or above won
 * Impact (10) and at least one more. Those stacks HAPPENED — the base-rate
 * tables of the time measured them, and nothing here says they did not. What changed on
 * 2026-09-25 is what the site is willing to PREDICT: Jacob's rule is that two
 * awards are never a predicted possibility, so their mass is folded onto the
 * highest single award of the stack rather than being shown as an outcome a
 * reader is invited to plan around.
 *
 * The fold is stated as a table rather than as arithmetic on the values,
 * because it is a claim about WHICH awards each bin contains and that claim is
 * a measurement, not a subtraction. 13 folds to Rookie All Star's 8; 15 and
 * above fold to Impact's 10.
 *
 * WHAT IS LOST, stated rather than left to be discovered: the mean of a folded
 * pmf is strictly lower than the measured one, by the mass in those two bins
 * times the points the fold gives up. Across the 2026 season-pooled row that
 * is (0.00155 x 5) + (0.00109 x 5), about 0.013 of a point — the price of the
 * rule, and a small one.
 */
const STACKED_AWARD_FOLD: readonly { readonly from: number; readonly to: number }[] = [
  { from: 13, to: ROOKIE_ALL_STAR_AWARD_POINTS },
  { from: 15, to: IMPACT_AWARD_POINTS },
];

/** The highest point value a single award is worth. Nothing this module folds ever lands above it. */
export const SINGLE_AWARD_POINT_CEILING = IMPACT_AWARD_POINTS;

/**
 * One award point value with any stack folded onto its highest single award.
 *
 * Takes a value rather than a support index so it can also be applied to a
 * COMPOSED value: a sum of two or three awards is a stack. Anything at or
 * above Impact's own value therefore folds to Impact, which is the highest
 * single award that exists.
 */
export function foldStackedAwardPoints(points: number): number {
  // THE TABLE FIRST, and the order matters: 13 is above Impact's own 10 and
  // folds to Rookie All Star's 8, not to Impact. A clamp applied first would
  // promote a Rookie All Star stack into an Impact prediction.
  const entry = STACKED_AWARD_FOLD.find((candidate) => candidate.from === points);
  if (entry !== undefined) return entry.to;
  // Anything else at or above Impact's own value is a composed sum of two or
  // three awards, and Impact is the highest single award that exists.
  return points >= IMPACT_AWARD_POINTS ? IMPACT_AWARD_POINTS : points;
}

/**
 * A pmf over `AWARD_POINT_SUPPORT` with every stacked bin's mass moved onto the
 * bin of its highest single award.
 *
 * The array keeps its length and its support positions, so every caller that
 * indexes `AWARD_POINT_SUPPORT` keeps working and the pmf still sums to one:
 * the mass is MOVED, never dropped. The two folded bins come out at exactly
 * zero, which is what makes "no drawn award pmf has mass above 10" a property a
 * test can assert on the pmf itself rather than on a Monte Carlo frequency.
 */
export function foldStackedAwardPmf(pmf: readonly number[]): readonly number[] {
  const folded = AWARD_POINT_SUPPORT.map((_, index) => pmf[index] ?? 0);
  for (let index = 0; index < AWARD_POINT_SUPPORT.length; index++) {
    const points = AWARD_POINT_SUPPORT[index]!;
    const target = foldStackedAwardPoints(points);
    if (target === points) continue;
    const targetIndex = AWARD_POINT_SUPPORT.indexOf(target);
    // A fold target absent from the support would silently drop mass, so it is
    // a refusal rather than a skip.
    if (targetIndex === -1) {
      throw new Error(
        `foldStackedAwardPmf: the fold target ${String(target)} for ${String(points)} points is absent from AWARD_POINT_SUPPORT — refusing to drop mass`
      );
    }
    folded[targetIndex] = folded[targetIndex]! + folded[index]!;
    folded[index] = 0;
  }
  return folded;
}
