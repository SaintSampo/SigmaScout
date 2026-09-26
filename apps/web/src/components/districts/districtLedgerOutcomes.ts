/**
 * THE NAMED OUTCOMES of the Playoffs, Awards and Alliance selection cells, built
 * from the SAME runs the cell's own chance comes from.
 *
 * WHY A LIST AND NOT A HISTOGRAM (Jacob, 2026-09-25: "outcome lists instead of
 * histograms for playoffs and awards"). Both categories are LUMPY: a district
 * playoff pays exactly one of 30, 20, 13, 7 or 0, and a district award exactly
 * one of 10, 8, 5 or 0. A histogram over a 0-to-30 axis draws four bars and
 * twenty-six gaps, and the reader has to map each bar back onto a placement
 * from its x position. The outcomes have NAMES, so naming them is strictly more
 * information in less space. Qualification, the event total and the grand total
 * are genuinely spread and keep their plots.
 *
 * ALLIANCE SELECTION JOINED THEM IN 260925-w4y, on a different quantity. Its
 * points are not lumpy enough to name from the histogram alone, and worse, they
 * are AMBIGUOUS: a captain and a first pick earn the same points at one alliance
 * number, so no reading of that histogram can separate the two routes. The list
 * is built from the joint draw's own per-route counts instead, which is why the
 * selection helpers below take a route view rather than a distribution.
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
import type { DistrictPlayoffMilestone, DistrictPointDistribution, DistrictSelectionRouteView } from "./districtLedgerRows.js";

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

/**
 * Which cells render an outcome list instead of a histogram BY CATEGORY — the two
 * LUMPY, NAMED categories, and nothing else.
 *
 * The Alliance selection pane also renders a list, and deliberately is NOT named
 * here: it renders one exactly when the run reported its routes, which is a fact
 * about the DATA rather than about the category. A baked event's selection cell
 * has pmfs and no routes, so it keeps the histogram. See
 * `districtSelectionOutcomes`.
 */
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

// ---------------------------------------------------------------------------
// ALLIANCE SELECTION: the routes, as a headline and as a list (260925-w4y)
// ---------------------------------------------------------------------------

/**
 * The named routes onto (or off) a playoff alliance.
 *
 * `backup` is TBA's fourth pick slot. It cannot arise from a run whose draft was
 * SIMULATED, and a run whose draft was supplied has its alliances announced,
 * which renders the cell grey and never opens this drawer. It is carried anyway
 * so the rows account for every draw whatever a future caller hands in: a route
 * silently missing from the list is exactly the arithmetic
 * `districtSelectionUnaccountedMass` exists to catch.
 */
export type DistrictSelectionOutcomeId = "captain" | "firstPick" | "secondPick" | "backup" | "notSelected";

/** Which of TBA's own pick slots each drafted route is. The order is the render order, and it is also points descending. */
const SELECTION_ROUTE_SLOTS: readonly { readonly id: DistrictSelectionOutcomeId; readonly slot: number }[] = [
  { id: "captain", slot: 0 },
  { id: "firstPick", slot: 1 },
  { id: "secondPick", slot: 2 },
  { id: "backup", slot: 3 },
];

/**
 * One rendered selection route: its share of the runs, and the points it paid.
 *
 * `minPoints` and `maxPoints` are the range the RUNS produced where a run took
 * this route, and the range the route CAN pay at this event's alliance count
 * where none did. Both come from the joint draw's own observation object, so no
 * point value is computed here.
 */
export interface DistrictSelectionOutcomeRow {
  readonly id: DistrictSelectionOutcomeId;
  readonly chance: number;
  readonly minPoints: number;
  readonly maxPoints: number;
}

/** Thrown for a route view whose denominator cannot be divided by, rather than dividing by it and printing `Infinity%`. */
export class InvalidRouteDenominatorError extends Error {
  constructor(where: string, denominator: number) {
    super(`${where}: the route denominator must be a positive finite number, got ${String(denominator)}`);
    this.name = "InvalidRouteDenominatorError";
  }
}

function assertRouteDenominator(where: string, view: DistrictSelectionRouteView): void {
  if (!Number.isFinite(view.denominator) || view.denominator <= 0) throw new InvalidRouteDenominatorError(where, view.denominator);
}

/**
 * WHICH ROUTE THE BOLD LINE NAMES, and its chance.
 *
 * The comparison is captain against PICKED, where picked is the first pick plus
 * the second pick — the two routes a team reaches by being chosen rather than by
 * ranking high enough to choose. The larger of the two is the headline, and a tie
 * reads as picked, which is the shipped word.
 *
 * NOT THE SAME NUMBER THE SHIPPED CELL PRINTED. That was the chance of ANY
 * selection points, which is captain plus first pick plus second pick, printed
 * under the word "picked". A team that captains an alliance in 70 runs of a
 * hundred and is picked in 12 therefore read as "~82% picked", which is true of
 * nothing a reader would call being picked.
 */
export interface DistrictSelectionHeadline {
  readonly id: "captain" | "picked";
  readonly chance: number;
}

export function districtSelectionHeadline(view: DistrictSelectionRouteView): DistrictSelectionHeadline {
  assertRouteDenominator("districtSelectionHeadline", view);
  const bySlot = view.routes.bySlot;
  const captain = (bySlot[0]?.draws ?? 0) / view.denominator;
  const picked = ((bySlot[1]?.draws ?? 0) + (bySlot[2]?.draws ?? 0)) / view.denominator;
  return captain > picked ? { id: "captain", chance: captain } : { id: "picked", chance: picked };
}

/**
 * THE ONE ROUTE EVERY RUN AGREED ON, at one alliance number — and only where the
 * qualification RANKING IS FIXED.
 *
 * `undefined` in every other case, which is the point of the restriction. With
 * matches still to play, "every one of these 1,000 runs made this team alliance
 * 5's captain" is a prediction the cell already prints as a chance; with the
 * ranking fixed the draft is deterministic, so the same agreement is a fact about
 * the draft this site's model produces from a settled ranking, and it can be
 * stated as a caption rather than a percentage.
 *
 * Never `notSelected`: a team nobody took has no alliance number, and its cell
 * prints a zero chance rather than a settled route.
 */
export interface DistrictSelectionSettledRoute {
  readonly id: DistrictSelectionOutcomeId;
  readonly allianceNumber: number;
}

export function districtSelectionSettledRoute(view: DistrictSelectionRouteView): DistrictSelectionSettledRoute | undefined {
  assertRouteDenominator("districtSelectionSettledRoute", view);
  if (!view.rankingFixed) return undefined;
  for (const entry of SELECTION_ROUTE_SLOTS) {
    const observation = view.routes.bySlot[entry.slot];
    if (observation === undefined || observation.draws !== view.denominator) continue;
    if (observation.allianceNumber === undefined) return undefined;
    return { id: entry.id, allianceNumber: observation.allianceNumber };
  }
  return undefined;
}

/**
 * The Alliance selection drawer's outcome rows, in points descending order.
 *
 * RULED OUT MEANS RULED OUT BY THE RANKING, on exactly the terms
 * `districtPlayoffOutcomes` means ruled out by the bracket: with the ranking
 * fixed the draft is deterministic, so a route no run took CANNOT happen and the
 * row is omitted — which is why a non-captain carries no captain row once quals
 * are done. With matches still to play the same zero is merely "none of these
 * runs", the row stays, and the list's length does not move with the draws.
 *
 * A row's points are the range the runs produced, or the range the route can pay
 * where no run took it. Both are read off the joint draw's own observation.
 */
export function districtSelectionOutcomes(view: DistrictSelectionRouteView): readonly DistrictSelectionOutcomeRow[] {
  assertRouteDenominator("districtSelectionOutcomes", view);
  const rows: DistrictSelectionOutcomeRow[] = [];
  for (const entry of SELECTION_ROUTE_SLOTS) {
    const observation = view.routes.bySlot[entry.slot];
    if (observation === undefined) continue;
    // A BACKUP ROBOT IS A STRUCTURAL OMISSION, on the same terms as a veteran's
    // Rookie All Star row: the draft this site models fills three slots per
    // alliance and never a fourth, so a backup is not an outcome the runs can
    // produce and a 0% row would offer the reader one that cannot happen. A real
    // backup reaches this list only from a supplied alliance set, which is a fact
    // rather than a prediction, and then the row IS listed.
    if (entry.id === "backup" && observation.draws === 0) continue;
    if (view.rankingFixed && observation.draws === 0) continue;
    rows.push({
      id: entry.id,
      chance: observation.draws / view.denominator,
      minPoints: observation.minPoints ?? observation.possibleMinPoints,
      maxPoints: observation.maxPoints ?? observation.possibleMaxPoints,
    });
  }
  if (!view.rankingFixed || view.routes.notSelectedDraws > 0) {
    rows.push({ id: "notSelected", chance: view.routes.notSelectedDraws / view.denominator, minPoints: 0, maxPoints: 0 });
  }
  return rows;
}

/**
 * The share of the runs the rows do NOT account for — the same diagnostic
 * `districtOutcomeUnaccountedMass` is for the two lumpy categories, on the
 * quantity this list is built from.
 *
 * Exactly zero for every route set the joint draw can produce, INCLUDING one
 * whose draft was supplied, because every draw takes exactly one route. A
 * non-zero value means a route was dropped from the list or double counted.
 */
export function districtSelectionUnaccountedMass(view: DistrictSelectionRouteView, rows: readonly DistrictSelectionOutcomeRow[]): number {
  assertRouteDenominator("districtSelectionUnaccountedMass", view);
  const accounted = rows.reduce((sum, row) => sum + row.chance, 0);
  return 1 - accounted;
}
