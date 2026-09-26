/**
 * The Road to District Champs tab — the district tier's whole page.
 *
 * WHAT RENDERS WHERE, and WHICH NUMBERS COME FROM WHERE:
 *
 * - Every GREY cell is TBA's own number, read straight off the district
 *   artifact's `eventPoints[category]`. It is never a value derived from the
 *   simulation, because 10-04's ranking comparator's team-key tiebreak is not
 *   TBA's official tiebreak and a derived qualification-points value can
 *   honestly disagree with the earned one for tied teams.
 * - Every BLUE cell is a prediction from this site's own simulation: the joint
 *   `simulateDistrictEvent` run in a Web Worker for an event in progress, or
 *   10-06's baked marginals for an event that has not started. The words come
 *   from `districtLedgerCopy.ts`; the numbers and the FORM come from 10-04's
 *   `pointSummary.ts`.
 *
 * THE GREY/BLUE RULE IS NEVER HUE ALONE, per the sketch README's language
 * rules: a grey cell holds ONE integer and is not focusable; a blue cell holds
 * TWO lines and is a real `<button>`. `data-cell` carries the same distinction
 * for a test, so no assertion in this file's suite depends on a colour.
 *
 * Every colour reaches the page through a CSS custom property. Where a
 * `text-role-*` class sits beside a colour custom property the class list is
 * written as a PLAIN STRING rather than passed through `cn()` — tailwind-merge
 * drops the role class in that combination and only a screenshot catches it
 * (project memory `project_cn_drops_text_role_classes`).
 */
import { useRef, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { EmptyState } from "@/components/StateViews";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import { pointPercentiles } from "../../../../../packages/core/districts/pointSummary.js";
import { RANK_BAND_LABEL_PREFIX } from "../event/rankRows.js";
import { DistrictPointHistogram } from "./DistrictPointHistogram.js";
import {
  districtLedgerRookieBonusLine,
  districtLedgerRookieBonusCaption,
  DISTRICT_LEDGER_CAPACITY_NOT_PUBLISHED,
  DISTRICT_LEDGER_CAVEAT,
  DISTRICT_LEDGER_CHANCE_WORDS,
  DISTRICT_LEDGER_COLUMN_LABELS,
  DISTRICT_LEDGER_DRAWER_CELL_CAPTION,
  DISTRICT_LEDGER_DRAWER_CELL_PLOT_LABEL,
  DISTRICT_LEDGER_DRAWER_GRAND_PLOT_LABEL,
  DISTRICT_LEDGER_DRAWER_CHANCE_CAPTION,
  DISTRICT_LEDGER_DRAWER_LINE_CAPTION,
  DISTRICT_LEDGER_DRAWER_LINE_LABEL,
  DISTRICT_LEDGER_DRAWER_NO_LINE_CAPTION,
  DISTRICT_LEDGER_LEGEND_EARNED,
  DISTRICT_LEDGER_LEGEND_EXPLAINER,
  DISTRICT_LEDGER_LEGEND_OPEN,
  DISTRICT_LEDGER_LIKELY_PREFIX,
  DISTRICT_LEDGER_NO_MATCHES,
  DISTRICT_LEDGER_PROVENANCE,
  DISTRICT_LEDGER_REWIND_HINT,
  DISTRICT_LEDGER_REWIND_LABEL,
  DISTRICT_LEDGER_SEARCH_LABEL,
  DISTRICT_LEDGER_SEARCH_PLACEHOLDER,
  DISTRICT_LEDGER_LOCKED_AWARD_LABEL,
  DISTRICT_LEDGER_STAGE_WORDS,
  DISTRICT_LEDGER_STATUS_DEFINITIONS,
  DISTRICT_LEDGER_STATUS_LABELS,
  DISTRICT_LEDGER_STAT_LINE_LABELS,
  DISTRICT_LEDGER_TAB_LABEL,
  DISTRICT_LEDGER_TICK_NOW,
  DISTRICT_LEDGER_TICK_START,
  DISTRICT_LEDGER_PLAYOFF_MILESTONE_WORDS,
  DISTRICT_LEDGER_UNAVAILABLE_CELL,
  districtLedgerChanceLine,
  districtLedgerNoPointsCaption,
  districtLedgerPlacementLine,
  districtLedgerShortEventName,
  districtLedgerTickWeekLabel,
} from "./districtLedgerCopy.js";
import { buildAdvancementChanceRun, reconcileAdvancementChances } from "./districtLedgerChances.js";
import { useDistrictAdvancementChance } from "./useDistrictAdvancementChance.js";
import {
  DISTRICT_LEDGER_STATUS_KEYS,
  computeDistrictLedgerStatuses,
  type DistrictLedgerStatusKey,
  type DistrictLedgerStatusResult,
} from "./districtLedgerStatus.js";
import {
  DISTRICT_TIMELINE_NOW_ID,
  DISTRICT_TIMELINE_SEASON_START_ID,
  buildDistrictTimeline,
  districtStageAtPosition,
  resolveDistrictTimelinePosition,
  startMatchKeyAtPosition,
  type DistrictTimeline,
} from "./districtTimeline.js";
import {
  DISTRICT_CATEGORIES,
  buildDistrictLedgerRows,
  deriveStageFromState,
  districtLedgerStatLine,
  districtTierEvents,
  filterDistrictLedgerTeams,
  inProgressDistrictEventKeys,
  type DistrictCellKind,
  type DistrictEventStage,
  type DistrictLedgerCell,
  type DistrictLedgerEventRow,
  type DistrictLedgerTeam,
  type DistrictStageFinality,
} from "./districtLedgerRows.js";
import { useDistrictEventArtifacts, useDistrictLedgerData } from "./useDistrictLedgerData.js";

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
const FINAL_CELL_CLASS = "district-ledger-cell district-ledger-cell--final";
const OPEN_CELL_CLASS =
  "district-ledger-cell district-ledger-cell--open focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]";
const OPEN_CELL_BOLD_CLASS = "district-ledger-cell__figure whitespace-nowrap";
const OPEN_CELL_SMALL_CLASS = "district-ledger-cell__small";
const UNAVAILABLE_CELL_CLASS = "district-ledger-cell--unavailable";

/** The sticky first column — the shipped table wrapper scrolls horizontally inside its card, so the Team cell holds position. */
const TEAM_CELL_CLASS = "sticky left-0 z-10 bg-[var(--color-bg-surface)] align-middle";

/** The first three columns are words; every column after them is a number, and a number column is centred under a centred header. */
/** The three text columns (Team, Status, Event); every other header centres over its boxed cells. Jacob's order, 2026-09-25: Team, Status, Grand total, Event, Event total, then the four categories. */
const TEXT_COLUMN_INDEXES: ReadonlySet<number> = new Set([0, 1, 3]);

/** The rewind rail's own id, so its label can sit beside the position readout instead of wrapping the control. */
const REWIND_INPUT_ID = "district-ledger-rewind-input";

/** How long the hand must pause on the slider before its position is committed to the URL and the simulation. */
const REWIND_COMMIT_DELAY_MS = 160;

/** How far apart two tick labels must sit before both print. Measured at 390px, where the rail is about 340px and a "wk 0" label about 28px. */
const TICK_MIN_GAP_PERCENT = 10;

export interface DistrictLedgerProps {
  artifact: DistrictArtifact;
  algorithm: PublishedAlgorithmId;
  season: number;
}

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

function statusChipClass(status: DistrictLedgerStatusKey): string {
  return `lock-status-chip ${STATUS_CHIP_MODIFIER[status]}`;
}

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
 * The line wears the Team cell's own small muted meta class, as a PLAIN STRING
 * rather than through `cn()` — the recorded tailwind-merge trap.
 */
function StatusCell({
  status,
  rowSpan,
  chanceLine,
}: {
  status: DistrictLedgerStatusResult | undefined;
  rowSpan: number;
  chanceLine: string | undefined;
}) {
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
          {status.byAward ? DISTRICT_LEDGER_LOCKED_AWARD_LABEL : DISTRICT_LEDGER_STATUS_LABELS[status.status]}
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
function StatusChips({
  counts,
  active,
  onToggle,
}: {
  counts: Readonly<Record<DistrictLedgerStatusKey, number>>;
  active: ReadonlySet<DistrictLedgerStatusKey>;
  onToggle: (status: DistrictLedgerStatusKey) => void;
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
              {DISTRICT_LEDGER_STATUS_LABELS[status]} {counts[status]}
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
            <b>{DISTRICT_LEDGER_STATUS_LABELS[status]}</b> {DISTRICT_LEDGER_STATUS_DEFINITIONS[status]}
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
function CellKey() {
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

/** The stage WORD the Event cell prints: the earliest category still open, or "final". */
function stageWord(stage: DistrictEventStage): string {
  if (!stage.started && !stage.final.qual) return DISTRICT_LEDGER_STAGE_WORDS.unstarted;
  if (!stage.final.qual) return DISTRICT_LEDGER_STAGE_WORDS.quals;
  if (!stage.final.alliance) return DISTRICT_LEDGER_STAGE_WORDS.selection;
  if (!stage.final.elim) return DISTRICT_LEDGER_STAGE_WORDS.playoffs;
  if (!stage.final.award) return DISTRICT_LEDGER_STAGE_WORDS.awards;
  return DISTRICT_LEDGER_STAGE_WORDS.done;
}

/** A percentile range written out with an EN DASH and one decimal — never the plus-minus codepoint, which is reserved for exactly one standard deviation of full predictive variance. */
function likelyRangeText(p10: number, p90: number): string {
  return `${DISTRICT_LEDGER_LIKELY_PREFIX} ${p10.toFixed(1)}–${p90.toFixed(1)}`;
}

function chanceWordsFor(cell: DistrictCellKind): { bold: string; conditional: string } {
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
function openCellLines(cell: Extract<DistrictLedgerCell, { kind: "open" }>): { bold: string; small: string | undefined } {
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
  if (cell.summary.form === "median") {
    const { p10, p50, p90 } = cell.summary.percentiles;
    return { bold: `~${String(Math.max(0, Math.round(p50)))}`, small: likelyRangeText(Math.max(0, p10), Math.max(0, p90)) };
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

interface CellInteraction {
  readonly openCellId: string | undefined;
  readonly onToggle: (cellId: string) => void;
}

function LedgerCell({ cell, interaction, variant }: { cell: DistrictLedgerCell; interaction: CellInteraction; variant?: "total" }) {
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

function EventCell({ row }: { row: DistrictLedgerEventRow }) {
  return (
    <TableCell data-testid="district-ledger-event-cell" className="whitespace-nowrap align-middle">
      <span className="district-ledger-event-name">{districtLedgerShortEventName(row.eventName)}</span>
      {row.week !== null && <span className="district-ledger-event-week"> Wk {String(row.week + 1)}</span>}
      <span className="district-ledger-event-stage">{stageWord(row.stage)}</span>
    </TableCell>
  );
}

function TeamCell({ team, season, algorithm }: { team: DistrictLedgerTeam; season: number; algorithm: PublishedAlgorithmId }) {
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
          #{String(team.position)} · {String(Math.round(team.earnedDistrictTotal))} earned
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

/**
 * True when the visitor asked for reduced motion.
 *
 * A UI-SPEC BACKSTOP ROW. The committed test asserts the animation class is
 * absent under a `matchMedia` stub; the REAL verification is the UAT's manual
 * check, and `theme.css` carries a `prefers-reduced-motion` query as the
 * belt-and-braces half.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The explicit percentile label, built from the SHIPPED prefix and the same one-decimal en-dash discipline — never the plus-minus codepoint. */
function bandLabel(p10: number, p90: number): string {
  return `${RANK_BAND_LABEL_PREFIX}${Math.max(0, p10).toFixed(1)}–${Math.max(0, p90).toFixed(1)}`;
}

/**
 * ONE drawer row at a time across the whole table, spanning every column,
 * carrying the clicked cell's histogram beside the grand total's.
 */
function DrawerRow({
  cell,
  grandTotal,
  todaysLineFloor,
  columnCount,
  rookieBonus,
  chanceLine,
}: {
  cell: Extract<DistrictLedgerCell, { kind: "open" }>;
  grandTotal: DistrictLedgerCell;
  todaysLineFloor: number | null;
  columnCount: number;
  rookieBonus: number;
  /** This team's printed chance line, or `undefined` where no chance is printed — the caption follows the line rather than announcing one that is not there. */
  chanceLine: string | undefined;
}) {
  const cellPercentiles = pointPercentiles(cell.distribution.counts, cell.distribution.denominator);
  const noPointsChance = Math.round(((cell.distribution.counts[0] ?? 0) / cell.distribution.denominator) * 100);
  const animated = prefersReducedMotion() ? "" : " district-ledger-drawer--animated";
  return (
    <TableRow data-testid="district-ledger-drawer" data-drawer-cell={cell.id} className="district-ledger-row--drawer">
      <TableCell colSpan={columnCount}>
        <div className={`flex flex-wrap gap-[var(--spacing-lg)]${animated}`}>
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
            <span className="text-[var(--color-text-muted)]">{DISTRICT_LEDGER_DRAWER_CELL_CAPTION}</span>
            {noPointsChance > 0 && <span className="text-[var(--color-text-muted)]">{districtLedgerNoPointsCaption(noPointsChance)}</span>}
          </div>
          {grandTotal.kind === "open" && (
            <GrandTotalPlot cell={grandTotal} todaysLineFloor={todaysLineFloor} rookieBonus={rookieBonus} chanceLine={chanceLine} />
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function GrandTotalPlot({
  cell,
  todaysLineFloor,
  rookieBonus,
  chanceLine,
}: {
  cell: Extract<DistrictLedgerCell, { kind: "open" }>;
  todaysLineFloor: number | null;
  rookieBonus: number;
  chanceLine: string | undefined;
}) {
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
        {...(todaysLineFloor === null ? {} : { markedPosition: todaysLineFloor, markedLabel: DISTRICT_LEDGER_DRAWER_LINE_LABEL })}
        label={DISTRICT_LEDGER_DRAWER_GRAND_PLOT_LABEL}
      />
      <span className="text-[var(--color-text-muted)]">
        {todaysLineFloor === null ? DISTRICT_LEDGER_DRAWER_NO_LINE_CAPTION : DISTRICT_LEDGER_DRAWER_LINE_CAPTION}
      </span>
      {chanceLine !== undefined && (
        <span className="text-[var(--color-text-muted)]" data-testid="district-ledger-drawer-chance-caption">
          {DISTRICT_LEDGER_DRAWER_CHANCE_CAPTION}
        </span>
      )}
      {rookieBonus > 0 && (
        <span className="text-[var(--color-text-muted)]" data-testid="district-ledger-drawer-rookie-bonus">
          {districtLedgerRookieBonusCaption(Math.round(rookieBonus))}
        </span>
      )}
    </div>
  );
}

/** The narrow local cast this repo already uses for a control that does not own its route's search type. */
type DistrictLedgerNavigate = (opts: {
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
function RewindSlider({
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
          max={timeline.nowIndex}
          step={1}
          value={Math.min(thumb, timeline.nowIndex)}
          onChange={(event) => handleThumbChange(Number(event.target.value))}
          className="district-ledger-slider w-full"
        />
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
 * therefore gets two ticks, not five.
 */
function timelineTicks(timeline: DistrictTimeline): { id: string; label: string; percent: number; row: 0 | 1 }[] {
  const span = Math.max(timeline.nowIndex, 1);
  const all = timeline.chips.map((chip) => {
    const week = /^week-(\d+)$/.exec(chip.id);
    const label =
      chip.id === DISTRICT_TIMELINE_SEASON_START_ID
        ? DISTRICT_LEDGER_TICK_START
        : chip.id === DISTRICT_TIMELINE_NOW_ID
          ? DISTRICT_LEDGER_TICK_NOW
          : week === null
            ? chip.label
            : districtLedgerTickWeekLabel(Number(week[1]));
    return { id: chip.id, label, percent: Math.min(100, (chip.positionIndex / span) * 100), row: 0 as 0 | 1 };
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
 * The ONE controls card: the team-number search, the stat line and the legend.
 * The Rewind slider and its jump chips join this same card rather than getting
 * a second layout of their own.
 */
function ControlsCard({
  query,
  onQueryChange,
  statLine,
  children,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  statLine: ReturnType<typeof districtLedgerStatLine>;
  children?: ReactNode;
}) {
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
            {statLine.todaysLineFloor === null ? DISTRICT_LEDGER_STAT_LINE_LABELS.todaysLineUnknown : DISTRICT_LEDGER_STAT_LINE_LABELS.todaysLine}{" "}
            <b className="font-semibold text-[var(--color-text-primary)]">
              {statLine.todaysLineFloor === null ? "—" : String(Math.round(statLine.todaysLineFloor))}
            </b>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The exported tab is the IMPLEMENTATION WRAPPED IN A BOUNDARY, so every call
 * site gets the containment rather than whichever one remembered to ask for it
 * (phase 10 review, WR-09).
 *
 * `DistrictLedgerContent` below calls three functions that each document
 * themselves as refusing rather than fabricating — `convolveDistrictGrandTotal`
 * (`NegativeDistrictShiftError`), `maxEventPoints` (`UnknownDistrictSeasonError`)
 * and `pointCellSummary` (`EmptyDistributionError`) — from inside render-path
 * `useMemo`s. `buildDistrictLedgerRows` now degrades PER TEAM for the failures
 * it can attribute to one team; this boundary catches the rest, so a refusal
 * that applies to the whole table costs this tab and not the whole Locks page.
 *
 * `ErrorBoundary` renders a keyed Fragment, never a wrapper element, so this
 * indirection changes no rendered DOM on the ordinary path.
 */
export function DistrictLedger(props: DistrictLedgerProps) {
  return (
    <ErrorBoundary resource={`the ${DISTRICT_LEDGER_TAB_LABEL} tab`}>
      <DistrictLedgerContent {...props} />
    </ErrorBoundary>
  );
}

function DistrictLedgerContent({ artifact, algorithm, season }: DistrictLedgerProps) {
  // `strict: false` plus a narrow local cast — the documented escape hatch for
  // a control mounted inside a route whose search type it does not own.
  const search = useSearch({ strict: false }) as { at?: string; drawerTeam?: number; drawerCell?: string };
  const navigate = useNavigate() as unknown as DistrictLedgerNavigate;

  const [query, setQuery] = useState("");
  const [hiddenStatuses, setHiddenStatuses] = useState<ReadonlySet<DistrictLedgerStatusKey>>(() => new Set());

  /** The district's own district-tier events, deduplicated, in the order they were first seen. */
  const districtEvents = useMemo(() => {
    const byKey = new Map<string, { eventKey: string; eventName: string; week: number | null }>();
    for (const team of artifact.teams) {
      for (const entry of districtTierEvents(team)) {
        if (!byKey.has(entry.eventKey)) byKey.set(entry.eventKey, { eventKey: entry.eventKey, eventName: entry.eventName, week: entry.week });
      }
    }
    return [...byKey.values()];
  }, [artifact]);

  /** The "now" answer: 10-03's `state` blocks, and nothing else. */
  const nowStageByEvent = useMemo(() => {
    const map = new Map<string, DistrictStageFinality>();
    for (const team of artifact.teams) {
      for (const entry of districtTierEvents(team)) {
        if (map.has(entry.eventKey)) continue;
        map.set(entry.eventKey, deriveStageFromState(entry.state).final);
      }
    }
    return map;
  }, [artifact]);

  const inProgressKeys = useMemo(() => inProgressDistrictEventKeys(artifact), [artifact]);
  const startedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const team of artifact.teams) {
      for (const entry of districtTierEvents(team)) {
        if (deriveStageFromState(entry.state).started) keys.add(entry.eventKey);
      }
    }
    return [...keys].sort();
  }, [artifact]);

  // The FETCH set, decided from the raw search param rather than from the
  // resolved position, which is what keeps artifacts -> timeline -> stage
  // acyclic: a rewind widens it to every started district-tier event, because
  // the interleaved timeline is built from those artifacts' own schedules.
  // At "now" it is the in-progress events alone, so a finished or unstarted
  // district fetches nothing at all (SC-5).
  const rewinding = search.at !== undefined && search.at !== DISTRICT_TIMELINE_NOW_ID;
  const activeEventKeys = rewinding ? startedKeys : inProgressKeys;
  const artifacts = useDistrictEventArtifacts(activeEventKeys);

  const timeline = useMemo(
    () => buildDistrictTimeline({ events: districtEvents, eventArtifacts: artifacts.eventArtifacts }),
    [districtEvents, artifacts.eventArtifacts]
  );
  const positionIndex = resolveDistrictTimelinePosition(timeline, search.at);
  const atNow = positionIndex >= timeline.nowIndex;

  const stageByEvent = useMemo(
    () => districtStageAtPosition(timeline, positionIndex, nowStageByEvent),
    [timeline, positionIndex, nowStageByEvent]
  );
  // At "now" no override is supplied at all, so each event falls back to its
  // own first unplayed row — the honest live answer, which a rewound position
  // replaces with the first row strictly after the step.
  const startMatchKeyByEvent = useMemo(() => {
    if (atNow) return undefined;
    const map = new Map<string, string | null>();
    for (const event of districtEvents) map.set(event.eventKey, startMatchKeyAtPosition(timeline, positionIndex, event.eventKey));
    return map;
  }, [atNow, districtEvents, timeline, positionIndex]);

  /**
   * The drawer is driven by the two typed search params, so it is shareable and
   * survives a reload. An unknown team or cell id resolves to CLOSED, never to
   * a neighbouring cell — the same rule the timeline resolver follows.
   */
  function handleCellToggle(teamNumber: number, cellId: string): void {
    void navigate({
      search: (prev) => {
        const alreadyOpen = prev.drawerTeam === teamNumber && prev.drawerCell === cellId;
        return alreadyOpen
          ? { ...prev, drawerTeam: undefined, drawerCell: undefined }
          : { ...prev, drawerTeam: teamNumber, drawerCell: cellId };
      },
      resetScroll: false,
    });
  }

  function handlePositionChange(index: number): void {
    const id = timeline.positions[index]?.id ?? DISTRICT_TIMELINE_NOW_ID;
    // `replace`: a drag is one gesture, not a trail of history entries.
    void navigate({ search: (prev) => ({ ...prev, at: id === DISTRICT_TIMELINE_NOW_ID ? undefined : id }), replace: true, resetScroll: false });
  }

  const data = useDistrictLedgerData({
    artifact,
    activeEventKeys,
    eventArtifacts: artifacts.eventArtifacts,
    stageByEvent,
    startMatchKeyByEvent,
  });

  const rows = useMemo(
    () =>
      buildDistrictLedgerRows({
        artifact,
        distributions: data.distributions,
        stageByEvent: atNow ? undefined : stageByEvent,
        unavailableEvents: data.unavailableEvents,
        gaps: { ...data.gaps, missingEventArtifacts: artifacts.missingEventArtifacts },
      }),
    [artifact, data.distributions, atNow, stageByEvent, data.unavailableEvents, data.gaps, artifacts.missingEventArtifacts]
  );

  const statuses = useMemo(() => computeDistrictLedgerStatuses({ artifact, teams: rows.teams }), [artifact, rows.teams]);

  /**
   * THE ADVANCEMENT CHANCE, in three steps that each refuse rather than guess.
   *
   * `buildAdvancementChanceRun` decides whether there is anything to rank at
   * all (a published capacity, something still open, a run that is not in
   * flight, and a grand total for every single team); the hook runs it in the
   * district Worker, so the main thread never ranks a whole district a thousand
   * times; `reconcileAdvancementChances` narrows the raw run set to the teams
   * whose chip is allowed to carry a number.
   *
   * `runState.status === "complete"` carries the per-event run's exact
   * signature, and a `null` in its place suppresses the whole request: while
   * the run is in flight the grand totals are still being built. `"idle"` is
   * NOT in flight — it is the SC-5 case where there was nothing to simulate,
   * and the baked distributions are already in hand — so it passes an empty
   * signature rather than a null.
   */
  const chanceRun = useMemo(() => {
    const runSignature =
      data.runState.status === "complete" ? data.runState.signature : data.runState.status === "idle" ? "" : null;
    return buildAdvancementChanceRun({
      artifact,
      teams: rows.teams,
      statuses,
      runSignature,
      positionId: timeline.positions[positionIndex]?.id ?? DISTRICT_TIMELINE_NOW_ID,
    });
  }, [artifact, rows.teams, statuses, data.runState, timeline, positionIndex]);

  const chanceState = useDistrictAdvancementChance(chanceRun);
  const chances = useMemo(
    () => (chanceState.status === "complete" ? reconcileAdvancementChances(chanceState.chanceByTeam, statuses) : undefined),
    [chanceState, statuses]
  );
  /** One team's printed line, or `undefined` where nothing is printed — a pending run and a guaranteed status are the same absence here. */
  const chanceLineFor = (teamKey: string): string | undefined => {
    const chance = chances?.byTeam.get(teamKey);
    return chance === undefined ? undefined : districtLedgerChanceLine(chance);
  };

  // The stat line and the chip counts both describe the DISTRICT, not the
  // filtered view.
  const statLine = useMemo(() => districtLedgerStatLine(rows.teams, artifact.dcmpSlots), [rows.teams, artifact.dcmpSlots]);
  const activeStatuses = useMemo(
    () => new Set(DISTRICT_LEDGER_STATUS_KEYS.filter((status) => !hiddenStatuses.has(status))),
    [hiddenStatuses]
  );
  const visibleTeams = useMemo(() => {
    const searched = filterDistrictLedgerTeams(rows.teams, query);
    if (hiddenStatuses.size === 0) return searched;
    return searched.filter((team) => {
      const status = statuses.byTeam.get(team.teamKey)?.status;
      if (status === undefined || status === "capacityUnknown") return true;
      return !hiddenStatuses.has(status);
    });
  }, [rows.teams, query, hiddenStatuses, statuses]);

  /**
   * At most ONE drawer is open across the whole table. An unknown team number
   * or an unknown cell id resolves to closed rather than to a neighbouring
   * cell, which is why this is a lookup rather than an index.
   */
  const openDrawer = useMemo(() => {
    if (search.drawerTeam === undefined || search.drawerCell === undefined) return undefined;
    const team = rows.teams.find((entry) => entry.teamNumber === search.drawerTeam);
    if (team === undefined) return undefined;
    const candidates: DistrictLedgerCell[] = [
      ...team.rows.flatMap((row) => [...row.cells, row.eventTotal]),
      team.grandTotal,
    ];
    const cell = candidates.find((entry) => entry.id === search.drawerCell);
    if (cell === undefined || cell.kind !== "open") return undefined;
    return { team, cell };
  }, [rows.teams, search.drawerTeam, search.drawerCell]);

  function toggleStatus(status: DistrictLedgerStatusKey): void {
    setHiddenStatuses((previous) => {
      const next = new Set(previous);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  if (artifact.teams.length === 0) {
    return (
      <EmptyState
        heading={`No teams for ${artifact.displayName}`}
        body={`No district ranking data found for ${artifact.displayName}. Check back later.`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-[var(--spacing-md)]" data-testid="district-ledger-tab">
      <ControlsCard query={query} onQueryChange={setQuery} statLine={statLine}>
        <RewindSlider timeline={timeline} positionIndex={positionIndex} onPositionChange={handlePositionChange} />
        <StatusChips counts={statuses.counts} active={activeStatuses} onToggle={toggleStatus} />
      </ControlsCard>
      <p className="text-[var(--color-text-muted)]" data-testid="district-ledger-caveat">
        {DISTRICT_LEDGER_CAVEAT} {DISTRICT_LEDGER_PROVENANCE}
      </p>
      {visibleTeams.length === 0 && <p className="text-[var(--color-text-muted)]">{DISTRICT_LEDGER_NO_MATCHES}</p>}
      {/* The shipped table wrapper, verbatim, so the scroll arbitration this
          site already has an e2e suite around is inherited rather than rebuilt. */}
      <div className="data-card w-full min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
        <Table className="district-ledger-table">
          <TableHeader>
            <TableRow>
              {DISTRICT_LEDGER_COLUMN_LABELS.map((label, index) => (
                <TableHead key={label} className={TEXT_COLUMN_INDEXES.has(index) ? undefined : "text-center"}>
                  {label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleTeams.flatMap((team) => {
              const interaction: CellInteraction = {
                openCellId: openDrawer?.team.teamKey === team.teamKey ? openDrawer.cell.id : undefined,
                onToggle: (cellId) => handleCellToggle(team.teamNumber, cellId),
              };
              const dataRows =
                team.rows.length === 0
                  ? [
                      <TableRow
                        key={team.teamKey}
                        data-testid="district-ledger-row"
                        data-team={team.teamKey}
                        className="district-ledger-row--team-start"
                      >
                        <TeamCell team={team} season={season} algorithm={algorithm} />
                        <StatusCell status={statuses.byTeam.get(team.teamKey)} rowSpan={1} chanceLine={chanceLineFor(team.teamKey)} />
                        <LedgerCell cell={team.grandTotal} interaction={interaction} />
                        <TableCell colSpan={DISTRICT_LEDGER_COLUMN_LABELS.length - 3} className="text-[var(--color-text-muted)]">
                          {DISTRICT_LEDGER_UNAVAILABLE_CELL}
                        </TableCell>
                      </TableRow>,
                    ]
                  : team.rows.map((row, rowIndex) => (
                      <TableRow
                        key={`${team.teamKey}-${row.eventKey}`}
                        data-testid="district-ledger-row"
                        data-team={team.teamKey}
                        className={rowIndex === 0 ? "district-ledger-row--team-start" : "district-ledger-row--team-inner"}
                      >
                        {rowIndex === 0 && <TeamCell team={team} season={season} algorithm={algorithm} />}
                        {rowIndex === 0 && (
                          <StatusCell
                            status={statuses.byTeam.get(team.teamKey)}
                            rowSpan={Math.max(team.rowCount, 1)}
                            chanceLine={chanceLineFor(team.teamKey)}
                          />
                        )}
                        {rowIndex === 0 && (
                          <TableCell rowSpan={Math.max(team.rowCount, 1)} data-testid="district-ledger-grand-total" className="numeric-cell align-middle">
                            <GrandTotalContent cell={team.grandTotal} interaction={interaction} />
                          </TableCell>
                        )}
                        <EventCell row={row} />
                        <LedgerCell cell={row.eventTotal} interaction={interaction} variant="total" />
                        {row.cells.map((cell) => (
                          <LedgerCell key={cell.id} cell={cell} interaction={interaction} />
                        ))}
                      </TableRow>
                    ));
              if (openDrawer?.team.teamKey !== team.teamKey) return dataRows;
              return [
                ...dataRows,
                <DrawerRow
                  key={`${team.teamKey}-drawer`}
                  cell={openDrawer.cell}
                  grandTotal={team.grandTotal}
                  todaysLineFloor={statLine.todaysLineFloor}
                  columnCount={DISTRICT_LEDGER_COLUMN_LABELS.length}
                  rookieBonus={team.rookieBonus}
                  chanceLine={chanceLineFor(team.teamKey)}
                />,
              ];
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** The grand total's own content, rendered inside a cell that carries the team's row span rather than inside `LedgerCell`'s own `<td>`. */
function GrandTotalContent({ cell, interaction }: { cell: DistrictLedgerCell; interaction: CellInteraction }) {
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
