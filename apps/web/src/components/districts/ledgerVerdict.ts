/**
 * THE VERDICT DRAWER'S MODEL (sketch 025 variant A, quick task 261006-lxp).
 *
 * A blue cell on either Locks tab opens one pane that reads top down as an
 * answer: an eyebrow naming the cell and the team, one headline sentence, two or
 * three figure tiles, the note line, one chart and, on a total, one source line.
 * This module decides every word and number in that pane; `LedgerVerdictDrawer.tsx`
 * only renders what it returns.
 *
 * Pure: no React import. It reads the cutoff through `ledgerCutoffDisplay` and a
 * category chip through `openCellLines`, so the drawer's cutoff figure is the stat
 * line's own and a chip prints exactly what the table cell prints. That import is
 * one way: `LedgerParts.tsx` never imports this module.
 */
import { pointPercentiles } from "../../../../../packages/core/districts/pointSummary.js";
import type { DistrictTier } from "../../../../../packages/core/districts/pointModel.js";
import {
  CHAMP_LEDGER_VERDICT_SOURCE_WORDS,
  DISTRICT_LEDGER_AWARD_OUTCOME_LABELS,
  DISTRICT_LEDGER_DRAWER_CELL_PLOT_LABEL,
  DISTRICT_LEDGER_DRAWER_GRAND_PLOT_LABEL,
  DISTRICT_LEDGER_OUTCOME_LIST_LABELS,
  DISTRICT_LEDGER_PLAYOFF_OUTCOME_LABELS,
  DISTRICT_LEDGER_SELECTION_OUTCOME_LABELS,
  DISTRICT_LEDGER_VERDICT_CHIP_LABELS,
  DISTRICT_LEDGER_VERDICT_CUTOFF_TILE_WORDS,
  DISTRICT_LEDGER_VERDICT_POINT_NOUNS,
  DISTRICT_LEDGER_VERDICT_TILE_LABELS,
  champLedgerVerdictFieldSuffix,
  districtLedgerRookieBonusLine,
  districtLedgerVerdictCapHeadline,
  districtLedgerVerdictCapLabel,
  districtLedgerVerdictChanceOfPoints,
  districtLedgerFinalFigure,
  districtLedgerVerdictCutoffLabel,
  districtLedgerVerdictEarnedAt,
  districtLedgerVerdictEventTotalHeadline,
  districtLedgerVerdictEyebrow,
  districtLedgerVerdictFieldHeadline,
  districtLedgerVerdictGrandHeadline,
  districtLedgerVerdictLikelyHeadline,
  districtLedgerVerdictLikelyRange,
  districtLedgerVerdictMedian,
  districtLedgerVerdictOutcomeHeadline,
  districtLedgerVerdictPredictedAt,
  type LedgerGrandVerdict,
} from "./districtLedgerCopy.js";
import {
  districtAwardOutcomes,
  districtCellRendersOutcomeList,
  districtPlayoffOutcomes,
  districtSelectionOutcomes,
  type DistrictCellPricing,
} from "./districtLedgerOutcomes.js";
import { ledgerCutoffDisplay, openCellLines } from "./LedgerParts.js";
import type { DistrictLedgerShownState } from "./districtFieldOverlay.js";
import type { DistrictEventContribution, DistrictLedgerCell } from "./districtLedgerRows.js";
import type { ChampContribution, ChampFieldMembership, ChampLedgerCell } from "./champLedgerRows.js";
import type { LedgerCutoffView, SimulatedCutoffRange } from "./predictedCutoff.js";

/** An open cell, the only kind a drawer opens on. */
export type VerdictOpenCell = Extract<DistrictLedgerCell, { kind: "open" }>;

/** One named outcome row. Rows arrive points descending, so an earlier row always pays at least as much. */
export interface VerdictOutcomeRow {
  readonly key: string;
  readonly label: string;
  readonly points: number;
  /** The high end of a row whose points are a range: the alliance selection routes. */
  readonly pointsHigh?: number;
  readonly chance: number;
}

export interface VerdictTile {
  readonly key: "median" | "likely" | "cutoff" | "mostLikely" | "chanceOfPoints";
  readonly label: string;
  readonly value: string;
}

/** One piece of a total's source line. */
export type VerdictSourceChip =
  | { readonly kind: "earned"; readonly figure: string; readonly text: string }
  | { readonly kind: "predicted"; readonly figure: string; readonly text: string }
  | { readonly kind: "note"; readonly text: string }
  | { readonly kind: "category"; readonly label: string; readonly figure: string; readonly small: string | undefined; readonly open: boolean };

export interface VerdictHistogramChart {
  readonly kind: "histogram";
  readonly testId: "district-ledger-drawer-grand-plot" | "district-ledger-drawer-cell-plot";
  readonly label: string;
  readonly counts: ArrayLike<number>;
  readonly denominator: number;
  readonly maxPoints: number;
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
  readonly cutoff: { readonly position: number; readonly label: string; readonly zone: SimulatedCutoffRange | undefined } | undefined;
  readonly capLabel: string | undefined;
}

export interface VerdictOutcomeChart {
  readonly kind: "outcomes";
  readonly label: string;
  readonly rows: readonly VerdictOutcomeRow[];
}

export interface VerdictModel {
  readonly eyebrow: string;
  readonly headline: string;
  readonly tiles: readonly VerdictTile[];
  readonly chart: VerdictHistogramChart | VerdictOutcomeChart;
  readonly sourceChips: readonly VerdictSourceChip[];
}

/** Which total an event total cell is: a District tab event, or one of the Champ tab's two subtotals. */
export type VerdictTotalContext =
  | { readonly kind: "event"; readonly eventName: string }
  | { readonly kind: "district" }
  | { readonly kind: "dcmp"; readonly fieldChance: number | undefined };

/** Thrown where a grand total cell arrives without its grand verdict and cutoff. */
export class MissingGrandVerdictError extends Error {
  constructor(cellId: string) {
    super(`buildVerdictModel: the grand total cell ${cellId} needs its grand verdict and cutoff`);
    this.name = "MissingGrandVerdictError";
  }
}

/** Thrown where an event total cell arrives without saying which total it is. */
export class MissingTotalContextError extends Error {
  constructor(cellId: string) {
    super(`buildVerdictModel: the event total cell ${cellId} needs its total context`);
    this.name = "MissingTotalContextError";
  }
}

/**
 * The named outcome rows a cell prices instead of drawing a histogram, or
 * `undefined` where it draws one (an empty row list included). Every row comes
 * back, the implicit zero point row too, because the headline and the tiles
 * read it; `buildVerdictModel` drops that row from the rendered Playoffs and
 * Awards lists (261007-3ik).
 *
 * THE ALLIANCE SELECTION LIST is chosen by DATA, not by category: a run that
 * reported its routes can name them, and a baked event's pmf cannot. Playoffs
 * and Awards list their outcomes by category, priced at the tier's own weight.
 * `namedOutcomes` is false on the Champ tab's District points row, whose cells
 * are sums over several events that no placement or award names.
 */
export function verdictOutcomeRows(
  cell: VerdictOpenCell,
  season: number,
  tier: DistrictTier,
  isRookie: boolean,
  namedOutcomes: boolean
): { readonly label: string; readonly rows: readonly VerdictOutcomeRow[] } | undefined {
  if (!namedOutcomes) return undefined;
  if (cell.cell === "alliance" && cell.selection !== undefined) {
    const rows = districtSelectionOutcomes(cell.selection).map((row) => ({
      key: row.id,
      label: DISTRICT_LEDGER_SELECTION_OUTCOME_LABELS[row.id],
      points: row.minPoints,
      pointsHigh: row.maxPoints,
      chance: row.chance,
    }));
    return rows.length === 0 ? undefined : { label: DISTRICT_LEDGER_OUTCOME_LIST_LABELS.alliance, rows };
  }
  if (districtCellRendersOutcomeList(cell.cell)) {
    const rows: VerdictOutcomeRow[] =
      cell.cell === "elim"
        ? districtPlayoffOutcomes(season, tier, cell.distribution, cell.playoffMilestone).map((row) => ({
            key: row.id,
            label: DISTRICT_LEDGER_PLAYOFF_OUTCOME_LABELS[row.id],
            points: row.points,
            chance: row.chance,
          }))
        : districtAwardOutcomes(season, tier, cell.distribution, isRookie).map((row) => ({
            key: row.id,
            label: DISTRICT_LEDGER_AWARD_OUTCOME_LABELS[row.id],
            points: row.points,
            chance: row.chance,
          }));
    return rows.length === 0 ? undefined : { label: DISTRICT_LEDGER_OUTCOME_LIST_LABELS[cell.cell], rows };
  }
  return undefined;
}

/**
 * What a grand total headline answers. A withheld call wins first, exactly as
 * the Status cell's withheld chip wins over the status beneath it: a withheld
 * team carries the status `capacityUnknown` beside its range call. A printed
 * chance comes next, then the three guarantees and the field's Declined.
 * Anything else, an In range team whose chance has not landed or an unpublished
 * capacity, is open.
 */
export function ledgerGrandVerdict(input: {
  readonly statusKey: DistrictLedgerShownState | undefined;
  readonly rangeCall: "pending" | "noCall" | undefined;
  readonly chance: number | undefined;
}): LedgerGrandVerdict {
  if (input.rangeCall === "pending") return { kind: "pending" };
  if (input.rangeCall === "noCall") return { kind: "noCall" };
  if (input.chance !== undefined) return { kind: "chance", chance: input.chance };
  switch (input.statusKey) {
    case "locked":
    case "prequalified":
      return { kind: "qualified" };
    case "lockedOut":
      return { kind: "lockedOut" };
    case "declined":
      return { kind: "declined" };
    default:
      return { kind: "open" };
  }
}

export interface BuildVerdictModelInput {
  readonly cell: VerdictOpenCell;
  /** The eyebrow's title: the column title, or its per event or per subtotal form. */
  readonly cellTitle: string;
  readonly teamNumber: number;
  readonly nickname: string;
  readonly season: number;
  readonly isRookie: boolean;
  readonly tier: DistrictTier;
  readonly namedOutcomes: boolean;
  /** Required on the grand total. */
  readonly grand?: { readonly verdict: LedgerGrandVerdict; readonly cutoff: LedgerCutoffView };
  /** Required on an event total or subtotal. */
  readonly total?: VerdictTotalContext;
  readonly sourceChips?: readonly VerdictSourceChip[];
}

function tile(key: VerdictTile["key"], value: string): VerdictTile {
  return { key, label: DISTRICT_LEDGER_VERDICT_TILE_LABELS[key], value };
}

/** Builds the whole pane for one open cell. */
export function buildVerdictModel(input: BuildVerdictModelInput): VerdictModel {
  const { cell } = input;
  const eyebrow = districtLedgerVerdictEyebrow(input.cellTitle, input.teamNumber, input.nickname);
  const sourceChips = input.sourceChips ?? [];

  const outcomes = verdictOutcomeRows(cell, input.season, input.tier, input.isRookie, input.namedOutcomes);
  if (outcomes !== undefined) {
    // The likeliest row; on an exact tie the EARLIER row, which pays more.
    let top = outcomes.rows[0]!;
    for (const row of outcomes.rows) if (row.chance > top.chance) top = row;
    const chanceOfPoints = outcomes.rows.reduce((sum, row) => ((row.pointsHigh ?? row.points) > 0 ? sum + row.chance : sum), 0);
    // The "Out before the top four" and "No award" rows are implicit, and Jacob
    // asked for them gone from the drawer list (quick task 261007-3ik,
    // 2026-10-07). The headline and both tiles still read them, which is why
    // this filter runs after `top` and `chanceOfPoints`. It tests the cell kind,
    // so the Alliance selection list keeps its Not selected row by construction.
    // A list holding only the implicit row would render zero rows, and
    // `DistrictOutcomeList` draws nothing for that. No cell reaches here in that
    // state today: an alliance placed fifth to eighth is a settled grey cell
    // (quick task 261008-26o), not an open one with a drawer.
    const shownRows = cell.cell === "elim" || cell.cell === "award" ? outcomes.rows.filter((row) => row.key !== "none") : outcomes.rows;
    return {
      eyebrow,
      headline: districtLedgerVerdictOutcomeHeadline(top.label, top.chance),
      tiles: [tile("mostLikely", top.label), tile("chanceOfPoints", districtLedgerVerdictChanceOfPoints(chanceOfPoints))],
      chart: { kind: "outcomes", label: outcomes.label, rows: shownRows },
      sourceChips,
    };
  }

  const { counts, denominator } = cell.distribution;
  const { p10, p50, p90 } = pointPercentiles(counts, denominator);
  const medianTile = tile("median", districtLedgerVerdictMedian(p50));
  const likelyTile = tile("likely", districtLedgerVerdictLikelyRange(p10, p90));
  const histogram = {
    kind: "histogram" as const,
    counts,
    denominator,
    maxPoints: cell.ceiling,
    p10,
    p50,
    p90,
  };

  if (cell.cell === "grandTotal") {
    if (input.grand === undefined) throw new MissingGrandVerdictError(cell.id);
    const view = input.grand.cutoff;
    const display = ledgerCutoffDisplay(view);
    const kind = view.cutoff.kind;
    const cutoffValue =
      kind === "capacityUnknown" || kind === "absent" ? DISTRICT_LEDGER_VERDICT_CUTOFF_TILE_WORDS[kind] : display.figure;
    return {
      eyebrow,
      headline: districtLedgerVerdictGrandHeadline(input.grand.verdict, p10, p90),
      tiles: [medianTile, likelyTile, tile("cutoff", cutoffValue)],
      chart: {
        ...histogram,
        testId: "district-ledger-drawer-grand-plot",
        label: DISTRICT_LEDGER_DRAWER_GRAND_PLOT_LABEL,
        cutoff:
          display.markedPosition === undefined
            ? undefined
            : {
                position: display.markedPosition,
                label: districtLedgerVerdictCutoffLabel(display.figure),
                zone: display.likelyText === undefined ? undefined : view.likely,
              },
        capLabel: undefined,
      },
      sourceChips,
    };
  }

  let headline: string;
  if (cell.cell === "eventTotal") {
    const total = input.total;
    if (total === undefined) throw new MissingTotalContextError(cell.id);
    if (total.kind === "event") headline = districtLedgerVerdictEventTotalHeadline(p10, p90, total.eventName);
    else if (total.kind === "district") headline = districtLedgerVerdictLikelyHeadline(p10, p90, DISTRICT_LEDGER_VERDICT_POINT_NOUNS.district);
    else if (total.fieldChance !== undefined && total.fieldChance < 1) headline = districtLedgerVerdictFieldHeadline(total.fieldChance, p50);
    else headline = districtLedgerVerdictLikelyHeadline(p10, p90, DISTRICT_LEDGER_VERDICT_POINT_NOUNS.dcmp);
  } else if (cell.cell === "qual") {
    const ceiling = cell.ceiling;
    if (p50 >= ceiling - 0.5) {
      const mass = (counts[Math.round(ceiling)] ?? 0) / denominator;
      headline = districtLedgerVerdictCapHeadline(ceiling, mass);
    } else {
      headline = districtLedgerVerdictLikelyHeadline(p10, p90, DISTRICT_LEDGER_VERDICT_POINT_NOUNS.qual);
    }
  } else {
    headline = districtLedgerVerdictLikelyHeadline(p10, p90, DISTRICT_LEDGER_VERDICT_POINT_NOUNS[cell.cell]);
  }

  return {
    eyebrow,
    headline,
    tiles: [medianTile, likelyTile],
    chart: {
      ...histogram,
      testId: "district-ledger-drawer-cell-plot",
      label: DISTRICT_LEDGER_DRAWER_CELL_PLOT_LABEL,
      cutoff: undefined,
      capLabel: cell.cell === "qual" ? districtLedgerVerdictCapLabel(cell.ceiling) : undefined,
    },
    sourceChips,
  };
}

/**
 * The District grand total's source line: every settled event summed into ONE
 * earned chip naming them in row order, a predicted chip per open event, and the
 * rookie bonus where there is one.
 */
export function districtGrandSourceChips(contributions: readonly DistrictEventContribution[], rookieBonus: number): VerdictSourceChip[] {
  const chips: VerdictSourceChip[] = [];
  const settled = contributions.filter((entry) => entry.open === undefined);
  if (settled.length > 0) {
    const earned = settled.reduce((sum, entry) => sum + (entry.earned ?? 0), 0);
    chips.push({
      kind: "earned",
      figure: String(Math.round(earned)),
      text: districtLedgerVerdictEarnedAt(settled.map((entry) => entry.eventName)),
    });
  }
  for (const entry of contributions) {
    if (entry.open === undefined) continue;
    chips.push({ kind: "predicted", figure: districtLedgerVerdictMedian(entry.open.p50), text: districtLedgerVerdictPredictedAt(entry.eventName) });
  }
  if (rookieBonus > 0) chips.push({ kind: "note", text: districtLedgerRookieBonusLine(Math.round(rookieBonus)) });
  return chips;
}

/**
 * The Champ grand total's source line: the district row, then the DCMP row, then
 * the rookie bonus. The DCMP row reads "district points only" wherever it adds
 * nothing to the figure: a team out of the field, a district only grand total,
 * or a championship not yet priced.
 */
export function champGrandSourceChips(
  contributions: readonly ChampContribution[],
  team: { readonly membership: ChampFieldMembership; readonly grandTotalIsDistrictOnly: boolean; readonly rookieBonus: number }
): VerdictSourceChip[] {
  const chips: VerdictSourceChip[] = [];
  const district = contributions.find((entry) => entry.row === "district");
  if (district !== undefined) {
    if (district.earned !== undefined) {
      chips.push({ kind: "earned", figure: String(Math.round(district.earned)), text: CHAMP_LEDGER_VERDICT_SOURCE_WORDS.districtEarned });
    } else if (district.open !== undefined) {
      chips.push({ kind: "predicted", figure: districtLedgerVerdictMedian(district.open.p50), text: CHAMP_LEDGER_VERDICT_SOURCE_WORDS.districtPredicted });
    }
  }
  const dcmp = contributions.find((entry) => entry.row === "dcmp");
  if (dcmp !== undefined) {
    const addsNothing =
      team.membership === "out" || team.grandTotalIsDistrictOnly || dcmp.notYetPriced || (dcmp.earned === undefined && dcmp.open === undefined);
    if (addsNothing) {
      chips.push({ kind: "note", text: CHAMP_LEDGER_VERDICT_SOURCE_WORDS.districtOnly });
    } else if (dcmp.earned !== undefined) {
      chips.push({ kind: "earned", figure: String(Math.round(dcmp.earned)), text: CHAMP_LEDGER_VERDICT_SOURCE_WORDS.dcmpEarned });
    } else if (dcmp.open !== undefined) {
      const suffix = dcmp.fieldChance !== undefined && dcmp.fieldChance < 1 ? champLedgerVerdictFieldSuffix(dcmp.fieldChance) : "";
      chips.push({
        kind: "predicted",
        figure: districtLedgerVerdictMedian(dcmp.open.p50),
        text: `${CHAMP_LEDGER_VERDICT_SOURCE_WORDS.dcmpPredicted}${suffix}`,
      });
    }
  }
  if (team.rookieBonus > 0) chips.push({ kind: "note", text: districtLedgerRookieBonusLine(Math.round(team.rookieBonus)) });
  return chips;
}

const CATEGORY_CHIP_CELLS = ["qual", "alliance", "elim", "award"] as const;

/**
 * A total's source line: one chip per category, settled ones as their earned
 * figure and open ones as exactly what the table cell prints. Any other cell
 * kind (unavailable, not in the field, not yet priced) is skipped.
 *
 * `pricing` is the SAME value the table cell receives, so a chip prints the
 * same pays line the cell does (quick task 261008-3il).
 */
export function verdictCategoryChips(cells: readonly ChampLedgerCell[], pricing?: DistrictCellPricing): VerdictSourceChip[] {
  const chips: VerdictSourceChip[] = [];
  for (const cell of cells) {
    const category = CATEGORY_CHIP_CELLS.find((kind) => kind === cell.cell);
    if (category === undefined) continue;
    const label = DISTRICT_LEDGER_VERDICT_CHIP_LABELS[category];
    if (cell.kind === "final") {
      // A settled Playoffs value that is not TBA's own number yet reads "up to N" here as in the table (quick task 261010-66y, D6).
      chips.push({ kind: "category", label, figure: districtLedgerFinalFigure(cell.earned, cell.upTo === true), small: undefined, open: false });
    } else if (cell.kind === "open") {
      const lines = openCellLines(cell, pricing);
      chips.push({ kind: "category", label, figure: lines.bold, small: lines.small, open: true });
    }
  }
  return chips;
}
