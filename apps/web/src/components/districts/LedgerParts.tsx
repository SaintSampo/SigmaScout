/**
 * The ledger's SHARED presentational parts: the class constants, the two cell
 * renderers, the Team and Status cells, the chips and the cell key, the drawer
 * panes, the Rewind slider and its tick rail, and the controls card.
 *
 * A MECHANICAL EXTRACTION from `DistrictLedger.tsx` with no behaviour change
 * (quick task 260925-xab). The Champ Locks tab is the same ledger with two rows
 * per team instead of one row per event, so every one of these parts is shared
 * rather than copied; `DistrictLedger.test.tsx`'s 1958-line suite passes
 * UNTOUCHED, which is the proof the District Locks tab's rendered
 * output did not move.
 *
 * TWO PARAMETERIZATIONS, both with the district default:
 *
 * - `StatusCell` takes an `awardLabel`, so the champ tier can print
 *   `Locked · winner` for the DCMP winning alliance. Absent keeps the shipped
 *   `Locked · award`.
 * - `DrawerCellPane` takes a `tier`, so the DCMP's outcome lists are priced at
 *   the 3x weight by `districtPlayoffOutcomes`/`districtAwardOutcomes`
 *   themselves rather than by a second table of point values here.
 *
 * ONE CUTOFF FEEDS TWO SURFACES (quick task 260926-37q). `ControlsCard` and
 * `GrandTotalPlot` both take the SAME `LedgerCutoffView`, and both read it
 * through the one `ledgerCutoffDisplay` below, so the stat line's figure and
 * the grand total's dashed rule are one value rendered twice. They previously
 * printed two different quantities and neither of them sat between the teams
 * the tab had just called In range and Out of range.
 *
 * Every `data-testid`, every class string and every text-role class is
 * unchanged, and every class list that mixes a `text-role-*` class with a
 * colour custom property stays a PLAIN STRING — tailwind-merge drops the role
 * class when such a list goes through `cn()` and only a screenshot catches it
 * (project memory `project_cn_drops_text_role_classes`).
 */
import { useRef, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { TableCell } from "@/components/ui/table";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import { pointPercentiles } from "../../../../../packages/core/districts/pointSummary.js";
import type { DistrictTier } from "../../../../../packages/core/districts/pointModel.js";
import { RANK_BAND_LABEL_PREFIX } from "../event/rankRows.js";
import { DistrictPointHistogram } from "./DistrictPointHistogram.js";
import { DistrictOutcomeList } from "./DistrictOutcomeList.js";
import {
  districtLedgerRookieBonusLine,
  districtLedgerRookieBonusCaption,
  DISTRICT_LEDGER_CAPACITY_NOT_PUBLISHED,
  DISTRICT_LEDGER_CHANCE_WORDS,
  DISTRICT_LEDGER_DRAWER_CELL_CAPTION,
  DISTRICT_LEDGER_DRAWER_CELL_PLOT_LABEL,
  DISTRICT_LEDGER_DRAWER_GRAND_PLOT_LABEL,
  DISTRICT_LEDGER_DRAWER_CHANCE_CAPTION,
  DISTRICT_LEDGER_CUTOFF_LABELS,
  DISTRICT_LEDGER_DRAWER_CUTOFF_CAPTION,
  DISTRICT_LEDGER_DRAWER_NO_CUTOFF_CAPTION,
  DISTRICT_LEDGER_DRAWER_NO_LINE_CAPTION,
  DISTRICT_LEDGER_LEGEND_EARNED,
  DISTRICT_LEDGER_LEGEND_EXPLAINER,
  DISTRICT_LEDGER_LEGEND_OPEN,
  DISTRICT_LEDGER_LIKELY_PREFIX,
  DISTRICT_LEDGER_REWIND_HINT,
  DISTRICT_LEDGER_REWIND_LABEL,
  DISTRICT_LEDGER_SEARCH_LABEL,
  DISTRICT_LEDGER_SEARCH_PLACEHOLDER,
  DISTRICT_LEDGER_LOCKED_AWARD_LABEL,
  DISTRICT_LEDGER_STAGE_WORDS,
  DISTRICT_LEDGER_STATUS_DEFINITIONS,
  DISTRICT_LEDGER_STATUS_LABELS,
  DISTRICT_LEDGER_TICK_NOW,
  DISTRICT_LEDGER_TICK_START,
  DISTRICT_LEDGER_AWARD_OUTCOME_LABELS,
  DISTRICT_LEDGER_OUTCOME_CAPTIONS,
  DISTRICT_LEDGER_OUTCOME_LIST_LABELS,
  DISTRICT_LEDGER_PLAYOFF_MILESTONE_WORDS,
  DISTRICT_LEDGER_PLAYOFF_OUTCOME_LABELS,
  DISTRICT_LEDGER_SELECTION_OUTCOME_LABELS,
  DISTRICT_LEDGER_SELECTION_ROUTE_WORDS,
  DISTRICT_LEDGER_UNAVAILABLE_CELL,
  CHAMP_LEDGER_CUTOFF_PENDING_FIGURE,
  CHAMP_LEDGER_DRAWER_PENDING_CAPTION,
  CHAMP_LEDGER_DRAWER_SIMULATED_CUTOFF_CAPTION,
  CHAMP_LEDGER_NO_CALL_REASONS,
  champLedgerDrawerNoCallCaption,
  districtLedgerCutoffFigure,
  districtLedgerCutoffLikelyText,
  districtLedgerNoPointsCaption,
  districtLedgerPlacementLine,
  districtLedgerSelectionSettledLine,
  districtLedgerTickWeekLabel,
} from "./districtLedgerCopy.js";
import {
  districtAwardOutcomes,
  districtCellRendersOutcomeList,
  districtPlayoffOutcomes,
  districtSelectionHeadline,
  districtSelectionOutcomes,
  districtSelectionSettledRoute,
} from "./districtLedgerOutcomes.js";
import {
  DISTRICT_LEDGER_STATUS_KEYS,
  type DistrictLedgerStatusKey,
  type DistrictLedgerStatusResult,
} from "./districtLedgerStatus.js";
import { DISTRICT_TIMELINE_NOW_ID, DISTRICT_TIMELINE_SEASON_START_ID, type DistrictTimeline } from "./districtTimeline.js";
import type { DistrictCellKind, DistrictEventStage, DistrictLedgerCell } from "./districtLedgerRows.js";
import type { LedgerCutoffView } from "./predictedCutoff.js";

/**
 * THE BOXED CELL (sketch 021 variant A, restyled 2026-09-25 by 260925-hr9).
 *
 * Both fills live in `theme.css` under `.district-ledger-cell*`, which adds NO
 * palette entry: the grey is `--color-bg-inset` under `--color-text-muted`, and
 * the blue is the SHIPPED SKY rare pair. Sky rather than the
 * `--lock-status-locked-award-*` blue this cell wore before: the sketch's blue
 * is sky, and the tier palette's own note makes sky load-bearing against the
 * epic purple under deuteranopia. On THIS tab the rare pair carries no tier
 * meaning (an award-locked team wears the locked GREEN pair), so it is free to
 * mean "still open, click for the histogram".
 *
 * Written as PLAIN STRINGS, never passed through `cn()`: tailwind-merge drops a
 * `text-role-*` class sitting beside a `text-[var(...)]` one, and only a
 * screenshot catches it (project memory `project_cn_drops_text_role_classes`).
 */
export const FINAL_CELL_CLASS = "district-ledger-cell district-ledger-cell--final";
export const OPEN_CELL_CLASS =
  "district-ledger-cell district-ledger-cell--open focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]";
export const OPEN_CELL_BOLD_CLASS = "district-ledger-cell__figure whitespace-nowrap";
export const OPEN_CELL_SMALL_CLASS = "district-ledger-cell__small";
export const UNAVAILABLE_CELL_CLASS = "district-ledger-cell--unavailable";

/** The sticky first column — the shipped table wrapper scrolls horizontally inside its card, so the Team cell holds position. */
export const TEAM_CELL_CLASS = "sticky left-0 z-10 bg-[var(--color-bg-surface)] align-middle";

/** The rewind rail's own id, so its label can sit beside the position readout instead of wrapping the control. */
export const REWIND_INPUT_ID = "district-ledger-rewind-input";

/** The rail's tick-mark datalist id: the browser draws a mark at each anchor and pulls a nearby drag onto it. */
export const REWIND_TICKS_ID = "district-ledger-rewind-ticks";

/** How long the hand must pause on the slider before its position is committed to the URL and the simulation. */
export const REWIND_COMMIT_DELAY_MS = 160;

/** The rail's own resolution: the range input runs from 0 to this, and every move snaps to the nearest timeline position. */
export const REWIND_RAIL_MAX = 1000;

/** How far apart two tick labels must sit before both print. Measured at 390px, where the rail is about 340px and a "wk 0" label about 28px. */
export const TICK_MIN_GAP_PERCENT = 10;

/**
 * The chip modifier per status, in the shipped `statusChipClass` shape: a
 * `Record` lookup plus a base class. Every value is a CSS class bound to a
 * shipped custom property in `theme.css`; this file writes no colour at all.
 *
 * The status WORD always stays visible beside the colour — colour is never the
 * only encoding, which is the shipped champ tab's own stated rule.
 */
const STATUS_CHIP_MODIFIER: Record<DistrictLedgerStatusKey, string> = {
  prequalified: "lock-status-chip--prequalified",
  locked: "lock-status-chip--locked",
  inRange: "lock-status-chip--in-range",
  outOfRange: "lock-status-chip--out-of-range",
  lockedOut: "lock-status-chip--locked-out",
};

export function statusChipClass(status: DistrictLedgerStatusKey): string {
  return `lock-status-chip ${STATUS_CHIP_MODIFIER[status]}`;
}

/** A withheld champ call, as `StatusCell` renders it: the neutral chip's word and its accessible description. */
export interface StatusPlaceholder {
  readonly kind: "pending" | "no-call";
  readonly label: string;
  readonly description: string;
}

/** The two chips whose counts a withheld champ call replaces with an em dash. */
const WITHHELD_STATUS_KEYS: ReadonlySet<DistrictLedgerStatusKey> = new Set(["inRange", "outOfRange"]);

/** The em dash, built from its codepoint so this file never types the glyph. */
const EM_DASH = String.fromCharCode(0x2014);

/**
 * The Status cell: a chip for the five statuses, plain text with NO chip for
 * the honest capacity-not-published state, and — for an In range or Out of
 * range team alone — one line underneath carrying its chance of qualifying on
 * district points.
 *
 * THE CHANCE LINE IS PASSED IN ALREADY DECIDED. Whether a status prints one at
 * all is `districtLedgerChances.ts`'s call and the wording is
 * `districtLedgerCopy.ts`'s; this component neither compares a status nor
 * formats a percentage, so the rule that a guarantee never carries a number
 * beside it lives in one tested place rather than in a JSX condition.
 *
 * `awardLabel` NAMES THE KIND OF AWARD. Absent it reads the shipped
 * `Locked · award`, which is the only variant the district tier has; the champ
 * tier supplies `Locked · winner` for the DCMP winning alliance.
 *
 * The line wears the Team cell's own small muted meta class, as a PLAIN STRING
 * rather than through `cn()` — the recorded tailwind-merge trap.
 */
export function StatusCell({
  status,
  rowSpan,
  chanceLine,
  awardLabel,
  placeholder,
}: {
  status: DistrictLedgerStatusResult | undefined;
  rowSpan: number;
  chanceLine: string | undefined;
  awardLabel?: string;
  /**
   * THE CHAMP TAB'S WITHHELD CALL (quick task 260927-6bf): a neutral chip in
   * place of In range or Out of range while the simulated line is pending, or
   * where no line can be drawn. It wins over `status` and carries no chance
   * line. The district tab never passes it.
   */
  placeholder?: StatusPlaceholder;
}) {
  if (placeholder !== undefined) {
    return (
      <TableCell rowSpan={rowSpan} data-testid="district-ledger-status-cell" data-status={placeholder.kind} className="whitespace-nowrap align-middle">
        <div className="flex flex-col items-start gap-[var(--spacing-xs)]">
          <span className="lock-status-chip lock-status-chip--withheld" title={placeholder.description}>
            {placeholder.label}
            <span className="sr-only">. {placeholder.description}</span>
          </span>
        </div>
      </TableCell>
    );
  }
  if (status === undefined || status.status === "capacityUnknown") {
    return (
      <TableCell rowSpan={rowSpan} data-testid="district-ledger-status-cell" className="whitespace-nowrap align-middle text-[var(--color-text-muted)]">
        {DISTRICT_LEDGER_CAPACITY_NOT_PUBLISHED}
      </TableCell>
    );
  }
  return (
    <TableCell rowSpan={rowSpan} data-testid="district-ledger-status-cell" data-status={status.status} className="whitespace-nowrap align-middle">
      <div className="flex flex-col items-start gap-[var(--spacing-xs)]">
        <span className={statusChipClass(status.status)}>
          {status.byAward ? (awardLabel ?? DISTRICT_LEDGER_LOCKED_AWARD_LABEL) : DISTRICT_LEDGER_STATUS_LABELS[status.status]}
        </span>
        {chanceLine !== undefined && (
          <span className="district-ledger-team-meta whitespace-nowrap" data-testid="district-ledger-chance">
            {chanceLine}
          </span>
        )}
      </div>
    </TableCell>
  );
}

/**
 * The five chips above the table, doubling as filters.
 *
 * A CHIP'S COUNT DESCRIBES THE DISTRICT, NOT THE FILTERED VIEW. Recomputing a
 * count over the visible rows is the obvious-looking bug, and it would make
 * every count read 0 the moment its own chip was switched off.
 */
export function StatusChips({
  counts,
  active,
  onToggle,
  withheld = false,
  definitions = DISTRICT_LEDGER_STATUS_DEFINITIONS,
}: {
  counts: Readonly<Record<DistrictLedgerStatusKey, number>>;
  active: ReadonlySet<DistrictLedgerStatusKey>;
  onToggle: (status: DistrictLedgerStatusKey) => void;
  /**
   * THE CHAMP TAB'S WITHHELD COUNTS (quick task 260927-6bf): while the In range
   * and Out of range calls are withheld, their two chips print an em dash for
   * the count, never a number the rank rule produced. The district tab never
   * passes it.
   */
  withheld?: boolean;
  /** The line under each chip. The champ tab passes `CHAMP_LEDGER_STATUS_DEFINITIONS`, whose In range cuts at the predicted cutoff. */
  definitions?: Readonly<Record<DistrictLedgerStatusKey, string>>;
}) {
  return (
    <div className="flex flex-col gap-[var(--spacing-sm)]" data-testid="district-ledger-status-chips">
      {/* The five chips and the cell key share ONE wrapping row, the sketch's
          own legend line. */}
      <div className="flex flex-wrap items-center gap-x-[var(--spacing-md)] gap-y-[var(--spacing-xs)]">
        {DISTRICT_LEDGER_STATUS_KEYS.map((status) => (
          <button
            key={status}
            type="button"
            data-testid="district-ledger-status-chip"
            data-status={status}
            aria-pressed={active.has(status)}
            aria-describedby={`district-ledger-status-definition-${status}`}
            onClick={() => onToggle(status)}
            className="district-ledger-chip-button"
          >
            <span className={statusChipClass(status)}>
              {DISTRICT_LEDGER_STATUS_LABELS[status]} {withheld && WITHHELD_STATUS_KEYS.has(status) ? EM_DASH : counts[status]}
            </span>
          </button>
        ))}
        <CellKey />
      </div>
      <div
        className="district-ledger-defs flex flex-wrap gap-x-[var(--spacing-md)] gap-y-[var(--spacing-xs)]"
        data-testid="district-ledger-status-definitions"
      >
        {DISTRICT_LEDGER_STATUS_KEYS.map((status) => (
          <span key={status} id={`district-ledger-status-definition-${status}`}>
            <b>{DISTRICT_LEDGER_STATUS_LABELS[status]}</b> {definitions[status]}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The cell key: the two fills as swatches beside their words, plus the
 * likely/tilde explainer. The swatches are drawn from the same two classes the
 * cells wear, so the key cannot drift away from the table.
 */
export function CellKey() {
  return (
    <span className="district-ledger-defs flex flex-wrap items-center gap-x-[var(--spacing-md)] gap-y-[var(--spacing-xs)]" data-testid="district-ledger-legend">
      <span className="whitespace-nowrap">
        <span className="district-ledger-swatch district-ledger-swatch--final" aria-hidden="true" />
        {DISTRICT_LEDGER_LEGEND_EARNED}
      </span>
      <span className="whitespace-nowrap">
        <span className="district-ledger-swatch district-ledger-swatch--open" aria-hidden="true" />
        {DISTRICT_LEDGER_LEGEND_OPEN}
      </span>
      <span>{DISTRICT_LEDGER_LEGEND_EXPLAINER}</span>
    </span>
  );
}

/**
 * WHICH stage word a row prints: the earliest category still open, or "final".
 *
 * The KEY rather than the word, so a caller that needs the key itself — the
 * champ tab's District points row folds several events' stages into one small
 * line through `champLedgerDistrictSourceLine`, which looks the word up in
 * `DISTRICT_LEDGER_STAGE_WORDS` itself — reads this rule rather than copying
 * its five branches (quick task 260925-xab).
 */
export function stageWordKey(stage: DistrictEventStage): keyof typeof DISTRICT_LEDGER_STAGE_WORDS {
  if (!stage.started && !stage.final.qual) return "unstarted";
  if (!stage.final.qual) return "quals";
  if (!stage.final.alliance) return "selection";
  if (!stage.final.elim) return "playoffs";
  if (!stage.final.award) return "awards";
  return "done";
}

/** The stage WORD the Event cell prints: the earliest category still open, or "final". */
export function stageWord(stage: DistrictEventStage): string {
  return DISTRICT_LEDGER_STAGE_WORDS[stageWordKey(stage)];
}

/** A percentile range written out with an EN DASH and one decimal — never the plus-minus codepoint, which is reserved for exactly one standard deviation of full predictive variance. */
export function likelyRangeText(p10: number, p90: number): string {
  return `${DISTRICT_LEDGER_LIKELY_PREFIX} ${p10.toFixed(1)}–${p90.toFixed(1)}`;
}

/** What one `LedgerCutoffView` puts on a screen: the same four strings on the stat line and on the grand total plot, derived ONCE. */
export interface LedgerCutoffDisplay {
  readonly label: string;
  /** The tilde prefixed figure, the bare integer, or the em dash where there is no cutoff. */
  readonly figure: string;
  /** The likely range, or `undefined` while the run is in flight, at a settled or absent cutoff, and where the two rounded ends coincide. */
  readonly likelyText: string | undefined;
  /** Where the dashed rule is drawn, or `undefined` where none is drawn at all. */
  readonly markedPosition: number | undefined;
  /** The grand total plot's caption for this arm. */
  readonly caption: string;
  /** The stat line's small text naming why no cutoff can be drawn, for the `unavailable` arm alone. */
  readonly reason: string | undefined;
}

/**
 * The ONE derivation both surfaces read.
 *
 * The stat line and the dashed rule cannot print different words or different
 * numbers, because there is one function and one input — which is the whole
 * point of `LedgerCutoffView` (quick task 260926-37q).
 */
export function ledgerCutoffDisplay(view: LedgerCutoffView): LedgerCutoffDisplay {
  const { cutoff, likely, districtOnly } = view;
  const predictedLabel = districtOnly ? DISTRICT_LEDGER_CUTOFF_LABELS.predictedDistrictOnly : DISTRICT_LEDGER_CUTOFF_LABELS.predicted;
  if (cutoff.kind === "capacityUnknown") {
    return {
      label: DISTRICT_LEDGER_CUTOFF_LABELS.capacityUnknown,
      figure: "—",
      likelyText: undefined,
      markedPosition: undefined,
      caption: DISTRICT_LEDGER_DRAWER_NO_LINE_CAPTION,
      reason: undefined,
    };
  }
  if (cutoff.kind === "absent") {
    return {
      label: predictedLabel,
      figure: "—",
      likelyText: undefined,
      markedPosition: undefined,
      caption: DISTRICT_LEDGER_DRAWER_NO_CUTOFF_CAPTION,
      reason: undefined,
    };
  }
  // THE CHAMP TAB'S TWO NON FIGURES (quick task 260927-6bf): a line still
  // being simulated prints a word and draws no rule, and a line that cannot be
  // drawn prints "not available" with its reason and draws no rule. Neither
  // ever prints the midpoint in the meantime.
  if (cutoff.kind === "pending") {
    return {
      label: DISTRICT_LEDGER_CUTOFF_LABELS.predicted,
      figure: CHAMP_LEDGER_CUTOFF_PENDING_FIGURE,
      likelyText: undefined,
      markedPosition: undefined,
      caption: CHAMP_LEDGER_DRAWER_PENDING_CAPTION,
      reason: undefined,
    };
  }
  if (cutoff.kind === "unavailable") {
    return {
      label: DISTRICT_LEDGER_CUTOFF_LABELS.predicted,
      figure: DISTRICT_LEDGER_UNAVAILABLE_CELL,
      likelyText: undefined,
      markedPosition: undefined,
      caption: champLedgerDrawerNoCallCaption(cutoff.reason),
      reason: CHAMP_LEDGER_NO_CALL_REASONS[cutoff.reason],
    };
  }
  const isFinal = cutoff.kind === "final";
  const simulated = cutoff.kind === "predicted" && cutoff.source === "simulated";
  return {
    label: isFinal ? DISTRICT_LEDGER_CUTOFF_LABELS.settled : predictedLabel,
    figure: districtLedgerCutoffFigure(cutoff.points, isFinal),
    // A SETTLED CUTOFF CARRIES NO RANGE, whatever the caller passed: there is
    // nothing left to vary, and a range there would be stale by construction.
    likelyText: isFinal || likely === undefined ? undefined : districtLedgerCutoffLikelyText(likely.p10, likely.p90),
    markedPosition: cutoff.points,
    caption: simulated ? CHAMP_LEDGER_DRAWER_SIMULATED_CUTOFF_CAPTION : DISTRICT_LEDGER_DRAWER_CUTOFF_CAPTION,
    reason: undefined,
  };
}

export function chanceWordsFor(cell: DistrictCellKind): { bold: string; conditional: string } {
  if (cell === "alliance") return DISTRICT_LEDGER_CHANCE_WORDS.alliance;
  if (cell === "elim") return DISTRICT_LEDGER_CHANCE_WORDS.elim;
  return DISTRICT_LEDGER_CHANCE_WORDS.award;
}

/**
 * The two lines a blue cell prints, chosen by 10-04's form selector — this
 * component renders the words, that module decides the form and the numbers.
 *
 * THE PLAYOFFS CELL TAKES ITS MILESTONE FIRST, where the bracket has already
 * moved past the top four: `districtLedgerRows.ts` puts the milestone and its
 * two threshold-conditioned numbers on the cell, and the shipped chance form is
 * what an alliance still short of a top-four finish prints. See
 * `DistrictPlayoffMilestone`.
 */
export function openCellLines(cell: Extract<DistrictLedgerCell, { kind: "open" }>): { bold: string; small: string | undefined } {
  const milestone = cell.playoffMilestone;
  if (milestone !== undefined) {
    if (milestone.kind === "placed") {
      // The placement is settled, so there is no chance left to print: the
      // points follow from it, and the small line names the placement.
      return { bold: `~${String(Math.round(milestone.points))}`, small: districtLedgerPlacementLine(milestone.placement) };
    }
    const words = DISTRICT_LEDGER_PLAYOFF_MILESTONE_WORDS[milestone.kind];
    return {
      bold: `${words.bold} ~${String(Math.round(milestone.chance * 100))}%`,
      // NO FABRICATED ZERO, on the same terms as the chance form below.
      small:
        milestone.conditionalMedian === undefined
          ? undefined
          : `~${String(Math.round(milestone.conditionalMedian))} ${words.conditional}`,
    };
  }
  // THE ALLIANCE SELECTION CELL'S ROUTES, where the run reported them. A baked
  // event reports none and falls through to the shipped chance form below.
  const selection = cell.cell === "alliance" ? cell.selection : undefined;
  if (cell.summary.form === "median") {
    const { p10, p50, p90 } = cell.summary.percentiles;
    const bold = `~${String(Math.max(0, Math.round(p50)))}`;
    // ONCE THE RANKING IS FIXED the draft is determined, so a cell whose points
    // are a point mass can say WHICH route earned them instead of printing a
    // percentile range whose two ends are the same number.
    const settled = selection === undefined ? undefined : districtSelectionSettledRoute(selection);
    if (settled !== undefined) {
      return { bold, small: districtLedgerSelectionSettledLine(settled.id, settled.allianceNumber) };
    }
    return { bold, small: likelyRangeText(Math.max(0, p10), Math.max(0, p90)) };
  }
  if (selection !== undefined) {
    // THE LIKELIER ROUTE, named and put first, exactly as the playoff milestone
    // is. The small line is the typical amount given ANY selection points, which
    // is the same conditional median the shipped cell printed — only its clause
    // changes, because the bold line no longer covers both routes.
    const headline = districtSelectionHeadline(selection);
    const routeWords = DISTRICT_LEDGER_SELECTION_ROUTE_WORDS[headline.id];
    return {
      bold: `${routeWords.bold} ~${String(Math.round(headline.chance * 100))}%`,
      small:
        cell.summary.conditionalMedian === undefined
          ? undefined
          : `~${String(Math.round(cell.summary.conditionalMedian))} ${routeWords.conditional}`,
    };
  }
  const words = chanceWordsFor(cell.cell);
  // Every blue figure carries the tilde (Jacob, 2026-09-25): it is this site's
  // prediction, never a number TBA published.
  //
  // THE PLAYOFFS CELL PUTS THE MILESTONE FIRST — `top 4 ~66%` rather than
  // `~66% top 4` — so the three milestone headlines read the same way round as
  // each other. The other two categories keep the shipped order.
  const bold =
    cell.cell === "elim"
      ? `${words.bold} ~${String(Math.round(cell.summary.chance * 100))}%`
      : `~${String(Math.round(cell.summary.chance * 100))}% ${words.bold}`;
  // NO FABRICATED ZERO: 10-04 returns `undefined` when all the mass sits at
  // zero, and a printed "~0" would assert a typical amount the draws never
  // produced.
  const small =
    cell.summary.conditionalMedian === undefined
      ? undefined
      : `~${String(Math.round(cell.summary.conditionalMedian))} ${words.conditional}`;
  return { bold, small };
}

export interface CellInteraction {
  readonly openCellId: string | undefined;
  readonly onToggle: (cellId: string) => void;
}

export function LedgerCell({ cell, interaction, variant }: { cell: DistrictLedgerCell; interaction: CellInteraction; variant?: "total" }) {
  const box = variant === "total" ? ` district-ledger-cell--${variant}` : "";
  if (cell.kind === "final") {
    return (
      <TableCell data-cell="final" data-cell-id={cell.id} className="numeric-cell">
        <div className={`${FINAL_CELL_CLASS}${box}`}>{String(Math.round(cell.earned))}</div>
      </TableCell>
    );
  }
  if (cell.kind === "unavailable") {
    return (
      <TableCell data-cell="unavailable" data-cell-id={cell.id} className="numeric-cell">
        <span className={UNAVAILABLE_CELL_CLASS}>{DISTRICT_LEDGER_UNAVAILABLE_CELL}</span>
      </TableCell>
    );
  }
  const lines = openCellLines(cell);
  return (
    <TableCell data-cell="open" data-cell-id={cell.id} className="numeric-cell">
      {/* A blue cell is a real <button>: focusable, two lines, never hue alone. */}
      <button
        type="button"
        aria-expanded={interaction.openCellId === cell.id}
        onClick={() => interaction.onToggle(cell.id)}
        className={`${OPEN_CELL_CLASS}${box}`}
      >
        <span className={OPEN_CELL_BOLD_CLASS}>{lines.bold}</span>
        {lines.small !== undefined && <span className={OPEN_CELL_SMALL_CLASS}>{lines.small}</span>}
      </button>
    </TableCell>
  );
}

/**
 * THE MINIMUM the Team cell reads off a row model.
 *
 * Structural rather than the concrete `DistrictLedgerTeam`, for the same reason
 * `prepareChanceRanking`'s own input is: the champ tier's row model carries two
 * rows per team and an all-tier earned total rather than one row per event, and
 * one shared cell is what keeps the two tabs' team meta line from drifting
 * (quick task 260925-xab). `DistrictLedgerTeam` satisfies it unchanged.
 */
export interface LedgerTeamCellTeam {
  readonly teamNumber: number;
  readonly nickname: string;
  /** How many table rows this team spans — the district tier's event count, the champ tier's fixed two. */
  readonly rowCount: number;
  readonly position: number;
  /**
   * The EARNED total the meta line prints AT THE POSITION: district-tier only
   * on the district tab, all tiers on the champ tab. At "now" it is the
   * published total; rewound, only what was final there (quick task
   * 260927-6bf, finding 4).
   */
  readonly earnedAtPosition: number;
  readonly hasOpenCategory: boolean;
  readonly projection: number;
  readonly rookieBonus: number;
}

export function TeamCell({ team, season, algorithm }: { team: LedgerTeamCellTeam; season: number; algorithm: PublishedAlgorithmId }) {
  return (
    <TableCell rowSpan={Math.max(team.rowCount, 1)} data-testid="district-ledger-team-cell" className={TEAM_CELL_CLASS}>
      {/* Capped so the sticky cell always fits inside the table's scrollport:
          a sticky box wider than its scrollport is aligned by its far edge
          instead of holding at left 0 (measured live at 390px, 2026-09-25: a
          360px cell in a 340px wrapper slid 21px). The nickname truncates. */}
      <div className="flex min-w-0 max-w-[min(56vw,176px)] flex-col">
        <span className="district-ledger-team-number whitespace-nowrap">
          <Link to="/team/$teamNumber" params={{ teamNumber: String(team.teamNumber) }} search={{ year: season, algorithm, tab: "overview" }}>
            {team.teamNumber}
          </Link>
        </span>
        <span className="district-ledger-team-name truncate">{team.nickname}</span>
        <span className="district-ledger-team-meta whitespace-nowrap">
          #{String(team.position)} · {String(Math.round(team.earnedAtPosition))} earned
          {team.hasOpenCategory ? ` · median ${String(Math.round(team.projection))}` : ""}
        </span>
        {team.rookieBonus > 0 && (
          <span className="district-ledger-team-meta whitespace-nowrap" data-testid="district-ledger-rookie-bonus">
            {districtLedgerRookieBonusLine(Math.round(team.rookieBonus))}
          </span>
        )}
      </div>
    </TableCell>
  );
}

/** The explicit percentile label, built from the SHIPPED prefix and the same one-decimal en-dash discipline — never the plus-minus codepoint. */
export function bandLabel(p10: number, p90: number): string {
  return `${RANK_BAND_LABEL_PREFIX}${Math.max(0, p10).toFixed(1)}–${Math.max(0, p90).toFixed(1)}`;
}

/**
 * The clicked cell's own pane: an OUTCOME LIST for the two lumpy, named
 * categories and the shipped histogram for everything else.
 *
 * The split is `districtCellRendersOutcomeList`'s, which names the two cells
 * rather than testing for a shape, so the Qualification, Alliance selection and
 * event total panes are byte for byte what they were.
 *
 * `tier` DEFAULTS TO `"district"`. The champ tab supplies `"dcmp"` for the
 * District Championship row, which prices the playoff and award outcome lists
 * at the 3x weight through the phase's single weight source rather than through
 * a second table of point values here.
 */
export function DrawerCellPane({
  cell,
  season,
  isRookie,
  tier = "district",
  namedOutcomes = true,
}: {
  cell: Extract<DistrictLedgerCell, { kind: "open" }>;
  season: number;
  isRookie: boolean;
  tier?: DistrictTier;
  /**
   * Whether this cell's support can be described by NAMED OUTCOMES at all.
   * Defaults to true, which is every per-event cell either tab renders.
   *
   * The Champ Locks tab's District points row passes false: its cells are sums
   * over several events, and no placement or award names an outcome of two
   * events added together. The histogram is the honest pane there, so
   * `districtCellRendersOutcomeList` is not consulted for those cells at all
   * (quick task 260925-xab).
   */
  namedOutcomes?: boolean;
}) {
  // THE ALLIANCE SELECTION LIST is chosen by DATA, not by category: a run that
  // reported its routes can name them, and a baked event's pmf cannot, so that
  // one keeps the histogram.
  if (namedOutcomes && cell.cell === "alliance" && cell.selection !== undefined) {
    const selectionRows = districtSelectionOutcomes(cell.selection).map((row) => ({
      key: row.id,
      label: DISTRICT_LEDGER_SELECTION_OUTCOME_LABELS[row.id],
      points: row.minPoints,
      pointsHigh: row.maxPoints,
      chance: row.chance,
    }));
    return (
      <DistrictOutcomeList
        testId="district-ledger-drawer-outcomes"
        rows={selectionRows}
        label={DISTRICT_LEDGER_OUTCOME_LIST_LABELS.alliance}
        caption={DISTRICT_LEDGER_OUTCOME_CAPTIONS.alliance}
      />
    );
  }
  if (namedOutcomes && districtCellRendersOutcomeList(cell.cell)) {
    const rows =
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
    return (
      <DistrictOutcomeList
        testId="district-ledger-drawer-outcomes"
        rows={rows}
        label={DISTRICT_LEDGER_OUTCOME_LIST_LABELS[cell.cell]}
        caption={DISTRICT_LEDGER_OUTCOME_CAPTIONS[cell.cell]}
      />
    );
  }
  const cellPercentiles = pointPercentiles(cell.distribution.counts, cell.distribution.denominator);
  const noPointsChance = Math.round(((cell.distribution.counts[0] ?? 0) / cell.distribution.denominator) * 100);
  return (
    <div className="flex flex-col gap-[var(--spacing-xs)]">
      <DistrictPointHistogram
        testId="district-ledger-drawer-cell-plot"
        counts={cell.distribution.counts}
        denominator={cell.distribution.denominator}
        maxPoints={cell.ceiling}
        p10={cellPercentiles.p10}
        p50={cellPercentiles.p50}
        p90={cellPercentiles.p90}
        label={DISTRICT_LEDGER_DRAWER_CELL_PLOT_LABEL}
      />
      <span data-testid="district-ledger-drawer-band-label">{bandLabel(cellPercentiles.p10, cellPercentiles.p90)}</span>
      <span className="district-ledger-pane-caption">{DISTRICT_LEDGER_DRAWER_CELL_CAPTION}</span>
      {noPointsChance > 0 && <span className="district-ledger-pane-caption">{districtLedgerNoPointsCaption(noPointsChance)}</span>}
    </div>
  );
}

/**
 * The grand total histogram, with the PREDICTED CUTOFF drawn on it.
 *
 * Takes the SAME `LedgerCutoffView` the stat line above it takes, so the
 * dashed rule and the printed figure are one value rendered twice rather than
 * two quantities that happen to look alike (quick task 260926-37q).
 */
export function GrandTotalPlot({
  cell,
  cutoff,
  rookieBonus,
  chanceLine,
}: {
  cell: Extract<DistrictLedgerCell, { kind: "open" }>;
  cutoff: LedgerCutoffView;
  rookieBonus: number;
  chanceLine: string | undefined;
}) {
  const display = ledgerCutoffDisplay(cutoff);
  const percentiles = pointPercentiles(cell.distribution.counts, cell.distribution.denominator);
  return (
    <div className="flex flex-col gap-[var(--spacing-xs)]">
      <DistrictPointHistogram
        testId="district-ledger-drawer-grand-plot"
        counts={cell.distribution.counts}
        denominator={cell.distribution.denominator}
        maxPoints={cell.ceiling}
        p10={percentiles.p10}
        p50={percentiles.p50}
        p90={percentiles.p90}
        {...(display.markedPosition === undefined ? {} : { markedPosition: display.markedPosition, markedLabel: display.label })}
        label={DISTRICT_LEDGER_DRAWER_GRAND_PLOT_LABEL}
      />
      <span className="district-ledger-pane-caption">{display.caption}</span>
      {chanceLine !== undefined && (
        <span className="district-ledger-pane-caption" data-testid="district-ledger-drawer-chance-caption">
          {DISTRICT_LEDGER_DRAWER_CHANCE_CAPTION}
        </span>
      )}
      {rookieBonus > 0 && (
        <span className="district-ledger-pane-caption" data-testid="district-ledger-drawer-rookie-bonus">
          {districtLedgerRookieBonusCaption(Math.round(rookieBonus))}
        </span>
      )}
    </div>
  );
}

/** The narrow local cast this repo already uses for a control that does not own its route's search type. */
export type DistrictLedgerNavigate = (opts: {
  search: (prev: Record<string, unknown>) => Record<string, unknown>;
  replace?: boolean;
  /** Every ledger navigation is a control on a page the visitor has scrolled into; the router must NOT reset the scroll position (Jacob, 2026-09-25: a blue box click jumped the page to the top). */
  resetScroll?: boolean;
}) => Promise<void>;

/**
 * The Rewind slider and its DERIVED jump chips.
 *
 * Every move navigates with the search-updater form, preserving every other
 * param — the pattern every other control in this app uses. The position
 * readout is deliberately not animated.
 */
export function RewindSlider({
  timeline,
  positionIndex,
  onPositionChange,
}: {
  timeline: DistrictTimeline;
  positionIndex: number;
  onPositionChange: (index: number) => void;
}) {
  const position = timeline.positions[positionIndex] ?? timeline.positions[timeline.nowIndex]!;
  const ticks = timelineTicks(timeline);
  // The thumb is LOCAL state while a hand is on it (Jacob, 2026-09-25: "the
  // slider is glitchy"). Every input event used to navigate at once, so a drag
  // pushed one history entry per step, re-ran the simulation per step, and the
  // controlled value fought the pointer whenever a render landed mid-drag.
  // Now the thumb follows the hand immediately, and ONE commit fires after the
  // hand pauses; the URL and the simulation follow that commit alone.
  const [thumb, setThumb] = useState(positionIndex);
  const dragging = useRef(false);
  const commitTimer = useRef<number | undefined>(undefined);
  const fractions = useMemo(() => timelineRailFractions(timeline), [timeline]);
  const thumbIndex = Math.min(thumb, timeline.nowIndex);
  useEffect(() => {
    if (!dragging.current) setThumb(positionIndex);
  }, [positionIndex]);
  useEffect(() => () => window.clearTimeout(commitTimer.current), []);
  function handleThumbChange(next: number): void {
    setThumb(next);
    dragging.current = true;
    window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => {
      dragging.current = false;
      onPositionChange(next);
    }, REWIND_COMMIT_DELAY_MS);
  }
  // The rail's native arrow step is one thousandth, which usually snaps back
  // to the same position; an arrow key moves one timeline step instead.
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    const delta = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    handleThumbChange(Math.max(0, Math.min(timeline.nowIndex, thumbIndex + delta)));
  }
  return (
    <div className="flex flex-col gap-[var(--spacing-sm)]" data-testid="district-ledger-rewind">
      {/* The label, the readout and the rail are ONE block; the jump chips sit
          beside it on a wide screen and wrap under it on a phone. */}
      <div className="flex flex-col gap-[var(--spacing-xs)]">
        {/* The label is `htmlFor` rather than a wrapper, so the readout can sit
            beside it on the same line without joining the control's own
            accessible name. */}
        <span className="flex flex-wrap items-baseline gap-[var(--spacing-sm)]">
          <label htmlFor={REWIND_INPUT_ID} className="th-cell-label">
            {DISTRICT_LEDGER_REWIND_LABEL}
          </label>
          <span data-testid="district-ledger-rewind-readout" className="font-semibold">
            {position.label}
          </span>
        </span>
        <input
          id={REWIND_INPUT_ID}
          type="range"
          min={0}
          max={REWIND_RAIL_MAX}
          step={1}
          value={Math.round((fractions[thumbIndex] ?? 1) * REWIND_RAIL_MAX)}
          aria-valuetext={timeline.positions[thumbIndex]?.label}
          data-now-index={timeline.nowIndex}
          list={REWIND_TICKS_ID}
          onChange={(event) => handleThumbChange(nearestRailPosition(fractions, Number(event.target.value) / REWIND_RAIL_MAX))}
          onKeyDown={handleKeyDown}
          className="district-ledger-slider w-full"
        />
        {/* Tick marks on the track itself, one per jump chip, at the same
            fixed anchors the labels below use (Jacob, 2026-09-27: ticks make
            the slider easier to use). The browser also pulls a drag that ends
            near a mark onto it, so landing exactly on a week is easy. */}
        <datalist id={REWIND_TICKS_ID}>
          {ticks.map((tick) => (
            <option key={tick.id} value={Math.round((tick.percent / 100) * REWIND_RAIL_MAX)} />
          ))}
        </datalist>
      </div>
      <div className="district-ledger-ticks" data-testid="district-ledger-ticks" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick.id} data-row={tick.row} style={{ left: `${tick.percent.toFixed(1)}%` }}>
            {tick.label}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-[var(--spacing-xs)]" data-testid="district-ledger-jump-chips">
        {timeline.chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            data-testid="district-ledger-jump-chip"
            data-chip={chip.id}
            aria-pressed={chip.positionIndex === positionIndex}
            onClick={() => onPositionChange(chip.positionIndex)}
            className="district-ledger-pill"
          >
            {chip.label}
          </button>
        ))}
      </div>
      <span className="district-ledger-note">{DISTRICT_LEDGER_REWIND_HINT}</span>
    </div>
  );
}

/**
 * The rail's tick labels, DERIVED from the same jump chips rather than from a
 * hardcoded week list: the first chip prints "start", each per-week chip prints
 * its own short "wk N", and the last prints "now". A district with one week
 * therefore gets two ticks, not five. Each tick sits at its chip's fixed
 * anchor on the rail (see `timelineRailFractions`), never at its index.
 */
export function timelineTicks(timeline: DistrictTimeline): { id: string; label: string; percent: number; row: 0 | 1 }[] {
  const segments = Math.max(timeline.chips.length - 1, 1);
  const all = timeline.chips.map((chip, chipIndex) => {
    const week = /^week-(\d+)$/.exec(chip.id);
    const label =
      chip.id === DISTRICT_TIMELINE_SEASON_START_ID
        ? DISTRICT_LEDGER_TICK_START
        : chip.id === DISTRICT_TIMELINE_NOW_ID
          ? DISTRICT_LEDGER_TICK_NOW
          : week === null
            ? chip.label
            : districtLedgerTickWeekLabel(Number(week[1]));
    return { id: chip.id, label, percent: (chipIndex / segments) * 100, row: 0 as 0 | 1 };
  });
  // EVERY week prints (Jacob, 2026-09-25: a district has more weeks than
  // four and the rail must adapt). A label that would land on top of its
  // printed neighbour is staggered onto a second row rather than dropped, so
  // no week disappears from the rail and no two labels overprint.
  let lastOnRow: [number, number] = [-Infinity, -Infinity];
  for (const tick of all) {
    const row: 0 | 1 = tick.percent - lastOnRow[0] < TICK_MIN_GAP_PERCENT && tick.percent - lastOnRow[1] >= TICK_MIN_GAP_PERCENT ? 1 : 0;
    tick.row = row;
    lastOnRow[row] = tick.percent;
  }
  return all;
}

/**
 * Where each timeline position sits on the rail, as a fraction from 0 to 1.
 *
 * THE JUMP CHIPS ARE FIXED, EVENLY SPACED ANCHORS: start, one per week, now.
 * Positions between two anchors spread linearly by index. The anchors depend
 * only on which weeks the district has, never on which event artifacts have
 * loaded (Jacob, 2026-09-27: the week ticks moved as the slider moved, and they
 * should never move). A rewind widens the fetch set, the timeline grows from
 * stage steps to one step per match, and ticks placed by index all slid while
 * the hand was on the rail; "now", one step past the last week, also sat alone
 * on the second row.
 */
export function timelineRailFractions(timeline: DistrictTimeline): number[] {
  const segments = Math.max(timeline.chips.length - 1, 1);
  // Clamped non decreasing, so an out of order chip can never fold the rail back on itself.
  const anchors: number[] = [];
  for (const chip of timeline.chips) anchors.push(Math.max(anchors[anchors.length - 1] ?? 0, chip.positionIndex));
  const fractions: number[] = [];
  let segment = 0;
  for (let index = 0; index <= timeline.nowIndex; index++) {
    while (segment < anchors.length - 2 && index >= anchors[segment + 1]!) segment++;
    const from = anchors[segment]!;
    const to = anchors[segment + 1] ?? from;
    const within = to > from ? Math.min(1, (index - from) / (to - from)) : 1;
    fractions.push(Math.min(1, (segment + within) / segments));
  }
  return fractions;
}

/** The position whose rail fraction sits nearest `fraction`; a tie goes to the earlier position. */
export function nearestRailPosition(fractions: readonly number[], fraction: number): number {
  let best = 0;
  for (let index = 1; index < fractions.length; index++) {
    if (Math.abs(fractions[index]! - fraction) < Math.abs(fractions[best]! - fraction)) best = index;
  }
  return best;
}

/**
 * The ONE controls card: the team-number search, the stat line and the legend.
 * The Rewind slider and its jump chips join this same card rather than getting
 * a second layout of their own.
 */
export function ControlsCard({
  query,
  onQueryChange,
  cutoff,
  children,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  cutoff: LedgerCutoffView;
  children?: ReactNode;
}) {
  const display = ledgerCutoffDisplay(cutoff);
  return (
    <div className="data-card flex flex-col gap-[var(--spacing-sm)] p-[var(--spacing-md)]" data-testid="district-ledger-controls">
      {children}
      {/* The search box and the stat line share ONE row, the sketch's last
          control line. */}
      <div className="flex flex-wrap items-center gap-x-[var(--spacing-lg)] gap-y-[var(--spacing-sm)]">
        <label className="flex items-center gap-[var(--spacing-sm)]">
          <span className="th-cell-label">{DISTRICT_LEDGER_SEARCH_LABEL}</span>
          <input
            type="text"
            inputMode="numeric"
            value={query}
            placeholder={DISTRICT_LEDGER_SEARCH_PLACEHOLDER}
            onChange={(event) => onQueryChange(event.target.value)}
            className="min-h-[32px] w-[150px] rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-[var(--spacing-sm)] py-[var(--spacing-xs)]"
          />
        </label>
        <div data-testid="district-ledger-stat-line" className="district-ledger-note flex flex-wrap gap-x-[var(--spacing-lg)] gap-y-[var(--spacing-xs)]">
          <span>
            {display.label}{" "}
            <b className="font-semibold text-[var(--color-text-primary)]">{display.figure}</b>
            {display.likelyText !== undefined && (
              <span data-testid="district-ledger-cutoff-likely"> · {display.likelyText}</span>
            )}
            {display.reason !== undefined && (
              <span className="district-ledger-team-meta" data-testid="district-ledger-cutoff-reason">
                {" "}
                · {display.reason}
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

/** The grand total's own content, rendered inside a cell that carries the team's row span rather than inside `LedgerCell`'s own `<td>`. */
export function GrandTotalContent({ cell, interaction }: { cell: DistrictLedgerCell; interaction: CellInteraction }) {
  if (cell.kind === "final") {
    return (
      <span data-cell="final" data-cell-id={cell.id} className={`${FINAL_CELL_CLASS} district-ledger-cell--grand`}>
        {String(Math.round(cell.earned))}
      </span>
    );
  }
  if (cell.kind === "unavailable") {
    return (
      <span data-cell="unavailable" data-cell-id={cell.id} className={UNAVAILABLE_CELL_CLASS}>
        {DISTRICT_LEDGER_UNAVAILABLE_CELL}
      </span>
    );
  }
  const lines = openCellLines(cell);
  return (
    <button
      type="button"
      data-cell="open"
      data-cell-id={cell.id}
      aria-expanded={interaction.openCellId === cell.id}
      onClick={() => interaction.onToggle(cell.id)}
      className={`${OPEN_CELL_CLASS} district-ledger-cell--grand`}
    >
      <span className={OPEN_CELL_BOLD_CLASS}>{lines.bold}</span>
      {lines.small !== undefined && <span className={OPEN_CELL_SMALL_CLASS}>{lines.small}</span>}
    </button>
  );
}
