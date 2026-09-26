/**
 * THE NAMED OUTCOMES of the Playoffs and Awards cells, built from the SAME
 * distribution the cell's own chance comes from.
 *
 * WHY A LIST AND NOT A HISTOGRAM (Jacob, 2026-09-25: "outcome lists instead of
 * histograms for playoffs and awards"). Both categories are LUMPY: a district
 * playoff pays exactly one of 30, 20, 13, 7 or 0, and a district award exactly
 * one of 10, 8, 5 or 0. A histogram over a 0-to-30 axis draws four bars and
 * twenty-six gaps, and the reader has to map each bar back onto a placement
 * from its x position. The outcomes have NAMES, so naming them is strictly more
 * information in less space. Qualification, alliance selection, the event total
 * and the grand total are genuinely spread and keep their plots.
 *
 * EVERY POINT VALUE COMES FROM A MEASURED MODULE: the placements from
 * `playoffPoints` (10-01's own table, tier weight applied by the phase's single
 * weight source) and the award values from `IMPACT_AWARD_POINTS` /
 * `ROOKIE_ALL_STAR_AWARD_POINTS` / `AWARD_POINT_SUPPORT`. There is no numeric
 * literal for a point value anywhere in this file.
 *
 * EVERY CHANCE IS THE MASS AT THAT EXACT POINT VALUE, divided by the
 * distribution's own denominator. Not a re-derivation and not a second
 * estimator: a lumpy distribution puts all of its mass on the support, so the
 * mass at a value IS the chance of that outcome, and the list therefore cannot
 * disagree with the headline built from the same array.
 *
 * A pure module: no React, no JSX, and no formatting — `districtLedgerCopy.ts`
 * owns every string and `DistrictOutcomeList.tsx` owns every mark.
 */
import { PLAYOFF_PLACEMENT_POINTS, playoffPoints } from "../../../../../packages/core/districts/bracket.js";
import { AWARD_POINT_SUPPORT } from "../../../../../packages/core/districts/awardBaseRates.js";
import {
  IMPACT_AWARD_POINTS,
  ROOKIE_ALL_STAR_AWARD_POINTS,
} from "../../../../../packages/core/districts/awardOrderingTables.js";
import { districtTierWeight } from "../../../../../packages/core/districts/qualPoints.js";
import type { DistrictTier } from "../../../../../packages/core/districts/pointModel.js";
import type { DistrictPlayoffMilestone, DistrictPointDistribution } from "./districtLedgerRows.js";

/** The outcome identifiers, so a caller names an outcome rather than matching its label. */
export type DistrictPlayoffOutcomeId = "winner" | "finalist" | "third" | "fourth" | "none";
export type DistrictAwardOutcomeId = "impact" | "rookieAllStar" | "judged" | "none";

/** One rendered outcome row. `chance` is in `[0, 1]`; the list is ordered by `points` descending. */
export interface DistrictOutcomeRow<Id extends string> {
  readonly id: Id;
  readonly points: number;
  readonly chance: number;
}

/**
 * The mass at exactly `points`, as a share of the distribution's denominator.
 *
 * A point value outside the array is 0 rather than an error: a distribution
 * whose support stops below an outcome's value is a distribution in which that
 * outcome never happened, which is exactly 0.
 */
function chanceAt(distribution: DistrictPointDistribution, points: number): number {
  const index = Math.round(points);
  if (index < 0 || index >= distribution.counts.length) return 0;
  return (distribution.counts[index] ?? 0) / distribution.denominator;
}

/** The placement each named playoff outcome is, so the point values come from `playoffPoints` rather than from a second table. */
const PLAYOFF_OUTCOME_PLACEMENTS: readonly { readonly id: DistrictPlayoffOutcomeId; readonly placement: number }[] = [
  { id: "winner", placement: 1 },
  { id: "finalist", placement: 2 },
  { id: "third", placement: 3 },
  { id: "fourth", placement: 4 },
  // Fifth through eighth all pay nothing and are one outcome to a reader: the
  // alliance did not reach the top four. Fifth stands for the group, and
  // `PLAYOFF_PLACEMENT_POINTS` is asserted to pay zero for all four.
  { id: "none", placement: 5 },
];

/**
 * The Playoffs cell's outcome rows, with the ones the bracket has RULED OUT
 * omitted.
 *
 * The omission is driven by the cell's own milestone and by nothing else, so the
 * list and the headline are ruled out by one fact: a secured top-four finish
 * removes "did not reach the top four", a place in the final removes third and
 * fourth as well, and a decided placement leaves exactly one row.
 *
 * ZERO-CHANCE ROWS THAT ARE NOT RULED OUT STAY. "The winner, in none of the
 * runs" is a real reading of a long shot, and dropping it would make a list
 * whose length moved with the draws.
 */
export function districtPlayoffOutcomes(
  season: number,
  tier: DistrictTier,
  distribution: DistrictPointDistribution,
  milestone: DistrictPlayoffMilestone | undefined
): readonly DistrictOutcomeRow<DistrictPlayoffOutcomeId>[] {
  const rows = PLAYOFF_OUTCOME_PLACEMENTS.map((entry) => {
    const points = playoffPoints(season, tier, entry.placement);
    return { id: entry.id, points, chance: chanceAt(distribution, points) };
  });
  if (milestone === undefined) return rows;
  if (milestone.kind === "placed") {
    // One row, and which one follows from the placement: fifth through eighth
    // are the same outcome to a reader.
    const id: DistrictPlayoffOutcomeId =
      milestone.placement === 1 ? "winner" : milestone.placement === 2 ? "finalist" : milestone.placement === 3 ? "third" : milestone.placement === 4 ? "fourth" : "none";
    return rows.filter((row) => row.id === id);
  }
  // A secured top-four finish rules out the nothing row; a place in the final
  // rules out third and fourth as well.
  const ruledOut: ReadonlySet<DistrictPlayoffOutcomeId> =
    milestone.kind === "winner" ? new Set<DistrictPlayoffOutcomeId>(["none", "third", "fourth"]) : new Set<DistrictPlayoffOutcomeId>(["none"]);
  return rows.filter((row) => !ruledOut.has(row.id));
}

/** The base point value each named award outcome is worth, before the tier weight. `judged` is `AWARD_POINT_SUPPORT`'s one-judged-award bin. */
const ONE_JUDGED_AWARD_POINTS = AWARD_POINT_SUPPORT[1]!;

/**
 * The Awards cell's outcome rows.
 *
 * ROOKIE ALL STAR IS OMITTED FOR A VETERAN, which is the one structural
 * omission here: a veteran cannot win it, and `ledgerSimulation.ts` consumes no
 * randomness for it at all. `isRookie` is the artifact's own `awardProfile.rookie`
 * flag; where the artifact publishes no profile the caller passes `false`, and
 * the row is omitted — an outcome the tab cannot establish is not an outcome to
 * offer.
 *
 * NOTHING ABOVE IMPACT APPEARS, because nothing above Impact is a prediction any
 * more: quick task 260925-uf8 folds every stacked bin onto its highest single
 * award, so the support the draw can land on is exactly these four values.
 */
export function districtAwardOutcomes(
  season: number,
  tier: DistrictTier,
  distribution: DistrictPointDistribution,
  isRookie: boolean
): readonly DistrictOutcomeRow<DistrictAwardOutcomeId>[] {
  const weight = districtTierWeight(season, tier);
  const rows: DistrictOutcomeRow<DistrictAwardOutcomeId>[] = [
    { id: "impact", points: IMPACT_AWARD_POINTS * weight, chance: 0 },
    { id: "rookieAllStar", points: ROOKIE_ALL_STAR_AWARD_POINTS * weight, chance: 0 },
    { id: "judged", points: ONE_JUDGED_AWARD_POINTS * weight, chance: 0 },
    { id: "none", points: 0, chance: 0 },
  ];
  return rows
    .filter((row) => row.id !== "rookieAllStar" || isRookie)
    .map((row) => ({ ...row, chance: chanceAt(distribution, row.points) }));
}

/** Which cells render an outcome list instead of a histogram — the two LUMPY, NAMED categories, and nothing else. */
export function districtCellRendersOutcomeList(cell: string): cell is "elim" | "award" {
  return cell === "elim" || cell === "award";
}

/**
 * The share of the distribution's mass the rows do NOT account for.
 *
 * A DIAGNOSTIC, not decoration: it is exactly zero for every distribution these
 * two categories can produce, so a non-zero value means mass has landed on a
 * point value no named outcome covers — a stacked award that escaped the fold, or
 * a placement table that changed. `districtLedgerOutcomes.test.ts` asserts it is
 * zero rather than leaving that to be noticed on a screenshot.
 */
export function districtOutcomeUnaccountedMass<Id extends string>(
  distribution: DistrictPointDistribution,
  rows: readonly DistrictOutcomeRow<Id>[]
): number {
  let total = 0;
  for (let i = 0; i < distribution.counts.length; i++) total += distribution.counts[i] ?? 0;
  const accounted = rows.reduce((sum, row) => sum + (distribution.counts[Math.round(row.points)] ?? 0), 0);
  return (total - accounted) / distribution.denominator;
}

/** Fifth through eighth all pay nothing — the premise `PLAYOFF_OUTCOME_PLACEMENTS`' single `none` row rests on, asserted rather than assumed. */
export const PLAYOFF_ZERO_PLACEMENTS: readonly number[] = PLAYOFF_PLACEMENT_POINTS.map((points, index) => (points === 0 ? index + 1 : 0)).filter(
  (placement) => placement > 0
);
