/**
 * The ledger's SHARED presentational parts: the class constants, the two cell
 * renderers, the Team and Status cells, the chips and the cell key, the cutoff
 * display, and the controls card.
 *
 * A MECHANICAL EXTRACTION from `DistrictLedger.tsx` with no behaviour change
 * (quick task 260925-xab). The Champ Locks tab is the same ledger with two rows
 * per team instead of one row per event, so every one of these parts is shared
 * rather than copied; `DistrictLedger.test.tsx`'s 1958-line suite passes
 * UNTOUCHED, which is the proof the District Locks tab's rendered
 * output did not move.
 *
 * `StatusCell` takes an `awardLabel`, so the champ tier can print
 * `Locked · winner` for the DCMP winning alliance. Absent keeps the shipped
 * `Locked · award`.
 *
 * THE DRAWER IS ONE VERDICT PANE (sketch 025 variant A, quick task 261006-lxp),
 * built in `ledgerVerdict.ts` and rendered by `LedgerVerdictDrawer.tsx`. Its
 * tier follows the row the clicked cell came from, so the DCMP's outcome lists
 * are priced at the 3x weight by the outcome builders themselves rather than by
 * a second table of point values.
 *
 * ONE CUTOFF FEEDS TWO SURFACES (quick task 260926-37q). `ControlsCard` and the
 * verdict drawer both take the SAME `LedgerCutoffView`, and both read it
 * through the one `ledgerCutoffDisplay` below, so the stat line's figure and
 * the grand total's dashed rule are one value rendered twice. They previously
 * printed two different quantities and neither of them sat between the teams
 * the tab had just called In range and Out of range. On BOTH tabs that view
 * and the chips beside it now come from one range state (`ledgerRangeState.ts`,
 * quick tasks 260927-6bf and 261004-uw4), so the withheld chip, the withheld
 * counts and the two non figure arms below are shared parts as well.
 *
 * Every `data-testid`, every class string and every text-role class is
 * unchanged, and every class list that mixes a `text-role-*` class with a
 * colour custom property stays a PLAIN STRING — tailwind-merge drops the role
 * class when such a list goes through `cn()` and only a screenshot catches it
 * (project memory `project_cn_drops_text_role_classes`).
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { TableCell } from "@/components/ui/table";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import {
  districtLedgerRookieBonusLine,
  DISTRICT_LEDGER_CAPACITY_NOT_PUBLISHED,
  DISTRICT_LEDGER_CHANCE_WORDS,
  DISTRICT_LEDGER_CUTOFF_LABELS,
  DISTRICT_LEDGER_LEGEND_EARNED,
  DISTRICT_LEDGER_LEGEND_EXPLAINER,
  DISTRICT_LEDGER_LEGEND_OPEN,
  DISTRICT_LEDGER_LIKELY_PREFIX,
  DISTRICT_LEDGER_SEARCH_LABEL,
  DISTRICT_LEDGER_SEARCH_PLACEHOLDER,
  DISTRICT_LEDGER_DECLINED_LABEL,
  DISTRICT_LEDGER_FIELD_STATUS_DEFINITIONS,
  DISTRICT_LEDGER_LOCKED_AWARD_LABEL,
  DISTRICT_LEDGER_STAGE_WORDS,
  DISTRICT_LEDGER_STATUS_DEFINITIONS,
  DISTRICT_LEDGER_STATUS_LABELS,
  DISTRICT_LEDGER_PLAYOFF_MILESTONE_WORDS,
  DISTRICT_LEDGER_SELECTION_ROUTE_WORDS,
  DISTRICT_LEDGER_UNAVAILABLE_CELL,
  CHAMP_LEDGER_CUTOFF_PENDING_FIGURE,
  CHAMP_LEDGER_NO_CALL_REASONS,
  CHAMP_LEDGER_RANGE_CALL_LABELS,
  CHAMP_LEDGER_RANGE_PENDING_DESCRIPTION,
  champLedgerNoCallDescription,
  districtLedgerCutoffFigure,
  districtLedgerCutoffLikelyText,
  districtLedgerPlacementLine,
  districtLedgerSelectionSettledLine,
} from "./districtLedgerCopy.js";
import { districtSelectionHeadline, districtSelectionSettledRoute } from "./districtLedgerOutcomes.js";
import type { DistrictLedgerStatusKey } from "./districtLedgerStatus.js";
import {
  DISTRICT_LEDGER_SHOWN_STATUS_KEYS,
  type DistrictLedgerShownCounts,
  type DistrictLedgerShownResult,
  type DistrictLedgerShownStatusKey,
} from "./districtFieldOverlay.js";
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
 * mean "still open, click to see".
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

/**
 * The first column. NOT PINNED since sketch 025 (Jacob, 2026-10-06): the Team
 * cell scrolls with the table's own horizontal scroller like every other cell.
 * It keeps the surface background and the vertical alignment.
 */
export const TEAM_CELL_CLASS = "bg-[var(--color-bg-surface)] align-middle";

/**
 * The chip modifier per status, in the shipped `statusChipClass` shape: a
 * `Record` lookup plus a base class. Every value is a CSS class bound to a
 * shipped custom property in `theme.css`; this file writes no colour at all.
 *
 * The status WORD always stays visible beside the colour — colour is never the
 * only encoding, which is the shipped champ tab's own stated rule.
 */
const STATUS_CHIP_MODIFIER: Record<DistrictLedgerShownStatusKey, string> = {
  prequalified: "lock-status-chip--prequalified",
  locked: "lock-status-chip--locked",
  // Drawn by the Out of range rule itself in `theme.css`: one declaration block, a second selector.
  declined: "lock-status-chip--declined",
  inRange: "lock-status-chip--in-range",
  outOfRange: "lock-status-chip--out-of-range",
  lockedOut: "lock-status-chip--locked-out",
};

export function statusChipClass(status: DistrictLedgerShownStatusKey): string {
  return `lock-status-chip ${STATUS_CHIP_MODIFIER[status]}`;
}

/**
 * The word a shown status prints. Declined (quick task 261005-04t, D-06) lives
 * beside the five labels rather than inside them, because tests iterate that
 * record's values and Declined is shown only on the Live view's field.
 */
function shownStatusLabel(status: DistrictLedgerShownStatusKey): string {
  return status === "declined" ? DISTRICT_LEDGER_DECLINED_LABEL : DISTRICT_LEDGER_STATUS_LABELS[status];
}

/** A withheld In range or Out of range call, on either tab, as `StatusCell` renders it: the neutral chip's word and its accessible description. */
export interface StatusPlaceholder {
  readonly kind: "pending" | "no-call";
  readonly label: string;
  readonly description: string;
}

/**
 * THE WITHHELD CHIP for one team, or `undefined` where its call is not
 * withheld. ONE mapping for both tabs (quick task 261004-uw4): `pending` is
 * the neutral word while the simulated line is still being computed, and
 * `noCall` names the terminal reason no line can be drawn.
 */
export function ledgerRangeCallChip(
  rangeCall: "pending" | "noCall" | undefined,
  noCallReason: keyof typeof CHAMP_LEDGER_NO_CALL_REASONS | undefined
): StatusPlaceholder | undefined {
  if (rangeCall === "pending") {
    return { kind: "pending", label: CHAMP_LEDGER_RANGE_CALL_LABELS.pending, description: CHAMP_LEDGER_RANGE_PENDING_DESCRIPTION };
  }
  if (rangeCall === "noCall" && noCallReason !== undefined) {
    return { kind: "no-call", label: CHAMP_LEDGER_RANGE_CALL_LABELS.noCall, description: champLedgerNoCallDescription(noCallReason) };
  }
  return undefined;
}

/** The two chips whose counts a withheld call replaces with an em dash. */
const WITHHELD_STATUS_KEYS: ReadonlySet<DistrictLedgerShownStatusKey> = new Set(["inRange", "outOfRange"]);

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
  status: DistrictLedgerShownResult | undefined;
  rowSpan: number;
  chanceLine: string | undefined;
  awardLabel?: string;
  /**
   * THE WITHHELD CALL (quick tasks 260927-6bf and 261004-uw4): a neutral chip
   * in place of In range or Out of range while the simulated line is pending,
   * or where no line can be drawn. It wins over `status` and carries no chance
   * line. Both tabs pass it, built by `ledgerRangeCallChip`.
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
          {status.byAward ? (awardLabel ?? DISTRICT_LEDGER_LOCKED_AWARD_LABEL) : shownStatusLabel(status.status)}
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
 * The five chips above the table, doubling as filters, and a sixth, Declined,
 * between Locked and In range ONLY where some team reads Declined (quick task
 * 261005-04t, D-06), so no season shows Declined 0. Its definition line follows
 * the same rule. While the Live view shows the District Championship field
 * (`fieldOverlay`), the In range and Out of range chips are dropped too: the
 * overlay reads every team as Locked, Declined or Locked out, so both would
 * print 0 on every finished season. Their definition lines go with them.
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
  fieldOverlay = false,
  definitions = DISTRICT_LEDGER_STATUS_DEFINITIONS,
}: {
  counts: DistrictLedgerShownCounts;
  active: ReadonlySet<DistrictLedgerShownStatusKey>;
  onToggle: (status: DistrictLedgerShownStatusKey) => void;
  /**
   * THE WITHHELD COUNTS (quick tasks 260927-6bf and 261004-uw4): while the In
   * range and Out of range calls are withheld, their two chips print an em
   * dash for the count, never a number the tab's verdict level rule produced.
   * Both tabs pass it.
   */
  withheld?: boolean;
  /** True while the Live view shows the District Championship field: the In range and Out of range chips are not drawn. Only the district tab passes it. */
  fieldOverlay?: boolean;
  /**
   * The line under each chip. The champ tab passes
   * `CHAMP_LEDGER_STATUS_DEFINITIONS`, whose In range cuts at the predicted
   * cutoff; the district tab passes its simulated set wherever its chips cut
   * at the predicted cutoff too, and this default where they cut at the
   * median projections, and its field set while the Live view shows the
   * District Championship field. Only that set carries a `declined` line.
   */
  definitions?: Readonly<Record<DistrictLedgerStatusKey, string>> & { readonly declined?: string };
}) {
  const shownKeys = DISTRICT_LEDGER_SHOWN_STATUS_KEYS.filter(
    (status) => (status !== "declined" || (counts.declined ?? 0) > 0) && !(fieldOverlay && WITHHELD_STATUS_KEYS.has(status))
  );
  const definitionOf = (status: DistrictLedgerShownStatusKey): string =>
    status === "declined" ? (definitions.declined ?? DISTRICT_LEDGER_FIELD_STATUS_DEFINITIONS.declined) : definitions[status];
  const countOf = (status: DistrictLedgerShownStatusKey): number => (status === "declined" ? (counts.declined ?? 0) : counts[status]);
  return (
    <div className="flex flex-col gap-[var(--spacing-sm)]" data-testid="district-ledger-status-chips">
      {/* The chips and the cell key share ONE wrapping row, the sketch's
          own legend line. */}
      <div className="flex flex-wrap items-center gap-x-[var(--spacing-md)] gap-y-[var(--spacing-xs)]">
        {shownKeys.map((status) => (
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
              {shownStatusLabel(status)} {withheld && WITHHELD_STATUS_KEYS.has(status) ? EM_DASH : countOf(status)}
            </span>
          </button>
        ))}
        <CellKey />
      </div>
      <div
        className="district-ledger-defs flex flex-wrap gap-x-[var(--spacing-md)] gap-y-[var(--spacing-xs)]"
        data-testid="district-ledger-status-definitions"
      >
        {shownKeys.map((status) => (
          <span key={status} id={`district-ledger-status-definition-${status}`}>
            <b>{shownStatusLabel(status)}</b> {definitionOf(status)}
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
      reason: undefined,
    };
  }
  if (cutoff.kind === "absent") {
    return {
      label: predictedLabel,
      figure: "—",
      likelyText: undefined,
      markedPosition: undefined,
      reason: undefined,
    };
  }
  // THE TWO NON FIGURES, on either tab (quick tasks 260927-6bf and
  // 261004-uw4): a line still being simulated prints a word and draws no rule,
  // and a line that cannot be drawn prints "not available" with its reason and
  // draws no rule. Neither ever prints the midpoint in the meantime.
  if (cutoff.kind === "pending") {
    return {
      label: DISTRICT_LEDGER_CUTOFF_LABELS.predicted,
      figure: CHAMP_LEDGER_CUTOFF_PENDING_FIGURE,
      likelyText: undefined,
      markedPosition: undefined,
      reason: undefined,
    };
  }
  if (cutoff.kind === "unavailable") {
    return {
      label: DISTRICT_LEDGER_CUTOFF_LABELS.predicted,
      figure: DISTRICT_LEDGER_UNAVAILABLE_CELL,
      likelyText: undefined,
      markedPosition: undefined,
      reason: CHAMP_LEDGER_NO_CALL_REASONS[cutoff.reason],
    };
  }
  const isFinal = cutoff.kind === "final";
  return {
    label: isFinal ? DISTRICT_LEDGER_CUTOFF_LABELS.settled : predictedLabel,
    figure: districtLedgerCutoffFigure(cutoff.points, isFinal),
    // A SETTLED CUTOFF CARRIES NO RANGE, whatever the caller passed: there is
    // nothing left to vary, and a range there would be stale by construction.
    likelyText: isFinal || likely === undefined ? undefined : districtLedgerCutoffLikelyText(likely.p10, likely.p90),
    markedPosition: cutoff.points,
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
      {/* Capped so the Team column stays narrow and the nine columns keep
          their room. The nickname truncates. */}
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

/** The narrow local cast this repo already uses for a control that does not own its route's search type. */
export type DistrictLedgerNavigate = (opts: {
  search: (prev: Record<string, unknown>) => Record<string, unknown>;
  replace?: boolean;
  /** Every ledger navigation is a control on a page the visitor has scrolled into; the router must NOT reset the scroll position (Jacob, 2026-09-25: a blue box click jumped the page to the top). */
  resetScroll?: boolean;
}) => Promise<void>;

/**
 * The ONE controls card: the team-number search, the stat line and the legend.
 * The Locks milestone picker joins this same card, as its first child, rather
 * than getting a second layout of its own.
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
