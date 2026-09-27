/**
 * THE PREDICTED CUTOFF: one number, computed once per tab, that both the stat
 * line and every grand total dashed rule read.
 *
 * Before this module the two surfaces printed DIFFERENT quantities and neither
 * of them sat between the teams the tab had just called In range and the teams
 * it had just called Out of range. The district tab's stat line was the
 * `dcmpSlots`-th highest EARNED district total over the unnarrowed field; the
 * champ tab's was `cutLinePointsWithQualifiers` over the FLOORS. Both are
 * honest numbers and neither is the line a reader is looking at, because the
 * table beside them is sorted by MEDIAN PROJECTION.
 *
 * THE RULE, once:
 *
 *   Let the pool be `pointsRaceSlots(<the tab's own sorted team keys>,
 *   capacity, qualifiers, reservedSlots).poolKeys` — the same narrowing the
 *   verdicts beside it used — and let `n` be that call's `pointsSlots`.
 *
 *   - Capacity is null                       -> `capacityUnknown`.
 *   - `n` is 0, or the pool holds `n` teams
 *     or fewer                               -> `absent`. No team is Out of
 *     range, so there is nothing between two groups to sit between.
 *   - Otherwise the boundary pair is the median predicted grand total of pool
 *     rank `n` (the last team In range) and of pool rank `n + 1` (the first
 *     team Out of range), and the cutoff is their midpoint as a whole number.
 *   - Every pool team settled                -> `final`: the same arithmetic,
 *     printed without the tilde and without a range.
 *
 * WHY `pointsSlots` AND NOT `lockSlots`. The reservation holds a slot back for
 * the `Locked` test alone; `cutLinePointsWithQualifiers` makes the same choice
 * for the same reason, which its own doc comment states. `reservedSlots` is
 * still passed through rather than hardcoded to zero, so a reader can see the
 * choice was made rather than overlooked.
 *
 * THE BETWEEN PROPERTY, which is the whole point of the change: every In range
 * team's median is at or above the cutoff and every Out of range team's is at
 * or below it. It follows from the tab's own sort — `teams` arrives in the
 * tab's sorted order, by descending median projection, so rank order IS value
 * order — and it holds under BOTH tabs' In range rules, the district tab's
 * `>=` cut line and the champ tab's pool rank, because both rules cut the same
 * sorted order at the same place.
 *
 * NO LOCK RULE OF ITS OWN, and no second convention: `pointsRaceSlots` owns the
 * pool and the slot count, `pointPercentiles` owns the percentile convention.
 * No React, no Worker type, nothing that is not a number in or out.
 */
import { pointsRaceSlots, type QualifierSets } from "../../../../../packages/core/districts/locks.js";
import { pointPercentiles, type PointPercentiles } from "../../../../../packages/core/districts/pointSummary.js";

/**
 * The MINIMUM the cutoff needs from one team's row: the median predicted grand
 * total it is ranked on, and whether anything is still open for it.
 *
 * Structural rather than a concrete row type, so the district tier's
 * `DistrictLedgerTeam` and the champ tier's `ChampLedgerTeam` both satisfy it
 * with no adapter — the same reason `ChanceRankingTeam` in
 * `districtLedgerChances.ts` is structural.
 */
export interface CutoffRankingTeam {
  readonly teamKey: string;
  /** The median predicted grand total: the quantity the tab's own sort ordered on. */
  readonly projection: number;
  readonly hasOpenCategory: boolean;
}

/** The two medians a cutoff was computed from, carried so a surface can show the pair rather than only their midpoint. */
export interface CutoffBoundary {
  /** The last team In range — pool rank `pointsSlots`. */
  readonly above: number;
  /** The first team Out of range — pool rank `pointsSlots + 1`. */
  readonly below: number;
}

/**
 * What a tab can print, as four arms rather than a number and a pile of flags.
 *
 * `absent` and `capacityUnknown` are DIFFERENT refusals and are kept apart on
 * purpose: one says the capacity was never published, the other says every
 * team in the pool is inside the slots, so there is no first team outside for a
 * line to sit above.
 */
export type PredictedCutoff =
  | { readonly kind: "capacityUnknown" }
  | { readonly kind: "absent" }
  | { readonly kind: "predicted"; readonly points: number; readonly boundary: CutoffBoundary }
  | { readonly kind: "final"; readonly points: number; readonly boundary: CutoffBoundary };

export interface PredictedCutoffOptions {
  /** The tab's OWN sorted rows, never re-sorted here. */
  readonly teams: readonly CutoffRankingTeam[];
  /** `dcmpSlots` at the district tier, `cmpSlots` at the champ tier. `null` is the honest unpublished capacity. */
  readonly capacity: number | null;
  /** The qualifier sets the verdicts beside this cutoff were computed with. */
  readonly qualifiers: QualifierSets;
  /** The reservation at this position — read by `pointsRaceSlots` and deliberately NOT by the cutoff; see this module's header. */
  readonly reservedSlots: number;
}

/**
 * The midpoint of the boundary pair, as a whole number.
 *
 * CLAMPED INTO THE PAIR whenever a whole number fits between them, so the
 * between property survives the rounding: with integer medians the clamp never
 * fires (the midpoint of two integers always rounds into their own interval),
 * and with continuous medians it is what stops `59.6` and `60.4` rounding out
 * to `60` when only `60` fits. Where the pair is so close that NO whole number
 * sits between them the nearest one stands, which is the only thing a whole
 * number can do there.
 */
function midpointOf(above: number, below: number): number {
  const rounded = Math.round((above + below) / 2);
  const lowest = Math.ceil(below);
  const highest = Math.floor(above);
  if (lowest > highest) return rounded;
  return Math.min(Math.max(rounded, lowest), highest);
}

/**
 * The cutoff at one position, on one tab.
 *
 * Moves no chip: it is DERIVED from the ranking the statuses already produced,
 * and nothing here reads or writes a verdict.
 */
export function predictedCutoff(options: PredictedCutoffOptions): PredictedCutoff {
  const { teams, capacity, qualifiers, reservedSlots } = options;
  if (capacity === null) return { kind: "capacityUnknown" };

  const narrowing = pointsRaceSlots(
    teams.map((team) => team.teamKey),
    capacity,
    qualifiers,
    reservedSlots
  );
  const poolKeys = new Set(narrowing.poolKeys);
  // The tab's own order, filtered — never a second sort.
  const pool = teams.filter((team) => poolKeys.has(team.teamKey));
  const slots = narrowing.pointsSlots;

  if (slots <= 0) return { kind: "absent" };
  if (pool.length <= slots) return { kind: "absent" };

  const above = pool[slots - 1]!.projection;
  const below = pool[slots]!.projection;
  const points = midpointOf(above, below);
  const boundary: CutoffBoundary = { above, below };
  const settled = pool.every((team) => !team.hasOpenCategory);
  return settled ? { kind: "final", points, boundary } : { kind: "predicted", points, boundary };
}

/** The 10th and 90th percentiles of where the simulated line landed across the runs. */
export interface SimulatedCutoffRange {
  readonly p10: number;
  readonly p90: number;
}

/**
 * The likely range, from the per run simulated line the advancement run keeps.
 *
 * ONE PERCENTILE CONVENTION on this site: the run cutoffs are counted into a
 * histogram whose INDEX IS THE POINT VALUE — `advancementChance.ts`'s own
 * representation — and handed to the shipped `pointPercentiles`, so this range
 * is the same continuous estimator every blue cell already prints.
 *
 * `undefined` — never a zero and never a stale pair — for an absent or empty
 * array, a non positive draw count, or a `draws` that disagrees with the
 * array's own length, since then neither number describes the run set.
 *
 * Imports nothing from the Worker layer: the array arrives as plain numbers.
 */
export function simulatedCutoffRange(
  cutoffByRun: ArrayLike<number> | undefined,
  draws: number
): SimulatedCutoffRange | undefined {
  const percentiles = runCutoffPercentiles(cutoffByRun, draws);
  return percentiles === undefined ? undefined : { p10: percentiles.p10, p90: percentiles.p90 };
}

/** The run cutoffs through the shipped `pointPercentiles`, on the one histogram convention; `undefined` on the same refusals as `simulatedCutoffRange`. */
function runCutoffPercentiles(cutoffByRun: ArrayLike<number> | undefined, draws: number): PointPercentiles | undefined {
  if (cutoffByRun === undefined) return undefined;
  if (cutoffByRun.length === 0) return undefined;
  if (!Number.isFinite(draws) || draws <= 0) return undefined;
  if (cutoffByRun.length !== draws) return undefined;

  let maxValue = 0;
  for (let i = 0; i < cutoffByRun.length; i++) {
    const value = cutoffByRun[i]!;
    if (!Number.isFinite(value)) return undefined;
    if (value > maxValue) maxValue = value;
  }

  const histogram = new Float64Array(Math.max(0, Math.round(maxValue)) + 1);
  for (let i = 0; i < cutoffByRun.length; i++) {
    const index = Math.max(0, Math.round(cutoffByRun[i]!));
    histogram[index] = histogram[index]! + 1;
  }

  return pointPercentiles(histogram, draws);
}

/** The champ tab's simulated line: its median as a whole number, and its 10 to 90 likely range from the same call. */
export interface SimulatedChampLine {
  readonly points: number;
  readonly likely: SimulatedCutoffRange;
}

/**
 * THE SIMULATED LINE (quick task 260927-6bf, decision L2): the median of the
 * per run line the champ run keeps, after each run's DCMP winning alliance and
 * drawn award winners have taken their slots, with its 10th to 90th
 * percentile range. ONE call yields both, on the same histogram convention as
 * `simulatedCutoffRange`, so the printed figure and its range cannot come from
 * two different derivations. `undefined` on that function's refusals.
 */
export function simulatedChampLine(cutoffByRun: ArrayLike<number> | undefined, draws: number): SimulatedChampLine | undefined {
  if (cutoffByRun === undefined || cutoffByRun.length !== draws) return undefined;
  // The champ run marks a run with NO line (its drawn winners and awards took
  // every slot) as NaN. The line is read CONDITIONAL ON ONE EXISTING, which is
  // the quantity a published cut line is.
  const withALine: number[] = [];
  for (let i = 0; i < cutoffByRun.length; i++) {
    const value = cutoffByRun[i]!;
    if (Number.isNaN(value)) continue;
    withALine.push(value);
  }
  const percentiles = runCutoffPercentiles(withALine, withALine.length);
  if (percentiles === undefined) return undefined;
  return { points: Math.round(percentiles.p50), likely: { p10: percentiles.p10, p90: percentiles.p90 } };
}

/**
 * Everything a surface needs to render the cutoff, in ONE object.
 *
 * Both the stat line and every grand total dashed rule take this same value, so
 * the two cannot print different numbers — which is the defect this module
 * exists to close.
 */
export interface LedgerCutoffView {
  readonly cutoff: PredictedCutoff;
  /** Absent while the run is in flight or suppressed, at a settled position, and at every arm but `predicted`. Never a zero. */
  readonly likely: SimulatedCutoffRange | undefined;
  /** The champ tab's pre registration window: the grand totals behind this cutoff are the district season alone. */
  readonly districtOnly: boolean;
}
