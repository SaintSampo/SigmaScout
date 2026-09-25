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
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { EmptyState } from "@/components/StateViews";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import {
  DISTRICT_LEDGER_CAPACITY_NOT_PUBLISHED,
  DISTRICT_LEDGER_CHANCE_WORDS,
  DISTRICT_LEDGER_COLUMN_LABELS,
  DISTRICT_LEDGER_LEGEND_EARNED,
  DISTRICT_LEDGER_LEGEND_EXPLAINER,
  DISTRICT_LEDGER_LEGEND_OPEN,
  DISTRICT_LEDGER_LIKELY_PREFIX,
  DISTRICT_LEDGER_NO_MATCHES,
  DISTRICT_LEDGER_SEARCH_LABEL,
  DISTRICT_LEDGER_SEARCH_PLACEHOLDER,
  DISTRICT_LEDGER_LOCKED_AWARD_LABEL,
  DISTRICT_LEDGER_STAGE_WORDS,
  DISTRICT_LEDGER_STATUS_DEFINITIONS,
  DISTRICT_LEDGER_STATUS_LABELS,
  DISTRICT_LEDGER_STAT_LINE_LABELS,
  DISTRICT_LEDGER_UNAVAILABLE_CELL,
} from "./districtLedgerCopy.js";
import {
  DISTRICT_LEDGER_STATUS_KEYS,
  computeDistrictLedgerStatuses,
  type DistrictLedgerStatusKey,
  type DistrictLedgerStatusResult,
} from "./districtLedgerStatus.js";
import {
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
import { useDistrictLedgerData } from "./useDistrictLedgerData.js";

/**
 * The open cell's own class lists, declared once here rather than as new CSS
 * classes, so this plan adds NO palette entry and NO stylesheet block.
 *
 * The blue is the SHIPPED `--lock-status-locked-award-*` pair. Reusing it here
 * is safe and deliberate: on THIS tab an award-locked team is rendered with the
 * locked GREEN pair (CONTEXT names the variant "Locked · award", a note on one
 * status rather than a second status), so the blue pair carries no status
 * meaning on this tab at all and is free to mean "still open, click for the
 * histogram" — the sketch's own blue.
 *
 * Written as PLAIN STRINGS, never passed through `cn()`: tailwind-merge drops a
 * `text-role-*` class sitting beside a `text-[var(...)]` one, and only a
 * screenshot catches it (project memory `project_cn_drops_text_role_classes`).
 */
const OPEN_CELL_CLASS =
  "flex w-full flex-col items-end rounded-sm px-[var(--spacing-xs)] py-[var(--spacing-xs)] text-[var(--lock-status-locked-award-fg)] hover:bg-[var(--lock-status-locked-award-bg)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]";
const OPEN_CELL_BOLD_CLASS = "font-semibold whitespace-nowrap";
const OPEN_CELL_SMALL_CLASS = "text-[11px] whitespace-nowrap text-[var(--lock-status-locked-award-fg)]";

/** The sticky first column — the shipped table wrapper scrolls horizontally inside its card, so the Team cell holds position. */
const TEAM_CELL_CLASS = "sticky left-0 z-10 bg-[var(--color-bg-surface)] align-top";

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

/** The Status cell: a chip for the five statuses, plain text with NO chip for the honest capacity-not-published state. */
function StatusCell({ status, rowSpan }: { status: DistrictLedgerStatusResult | undefined; rowSpan: number }) {
  if (status === undefined || status.status === "capacityUnknown") {
    return (
      <TableCell rowSpan={rowSpan} data-testid="district-ledger-status-cell" className="whitespace-nowrap align-top text-[var(--color-text-muted)]">
        {DISTRICT_LEDGER_CAPACITY_NOT_PUBLISHED}
      </TableCell>
    );
  }
  return (
    <TableCell rowSpan={rowSpan} data-testid="district-ledger-status-cell" data-status={status.status} className="whitespace-nowrap align-top">
      <span className={statusChipClass(status.status)}>
        {status.byAward ? DISTRICT_LEDGER_LOCKED_AWARD_LABEL : DISTRICT_LEDGER_STATUS_LABELS[status.status]}
      </span>
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
      <div className="flex flex-wrap gap-[var(--spacing-sm)]">
        {DISTRICT_LEDGER_STATUS_KEYS.map((status) => (
          <button
            key={status}
            type="button"
            data-testid="district-ledger-status-chip"
            data-status={status}
            aria-pressed={active.has(status)}
            aria-describedby={`district-ledger-status-definition-${status}`}
            onClick={() => onToggle(status)}
            className="tap-target"
          >
            <span className={statusChipClass(status)}>
              {DISTRICT_LEDGER_STATUS_LABELS[status]} {counts[status]}
            </span>
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-[var(--spacing-xs)]" data-testid="district-ledger-status-definitions">
        {DISTRICT_LEDGER_STATUS_KEYS.map((status) => (
          <span key={status} id={`district-ledger-status-definition-${status}`} className="text-[var(--color-text-muted)]">
            {DISTRICT_LEDGER_STATUS_LABELS[status]}: {DISTRICT_LEDGER_STATUS_DEFINITIONS[status]}
          </span>
        ))}
      </div>
    </div>
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

/** The two lines a blue cell prints, chosen by 10-04's form selector — this component renders the words, that module decides the form and the numbers. */
function openCellLines(cell: Extract<DistrictLedgerCell, { kind: "open" }>): { bold: string; small: string | undefined } {
  if (cell.summary.form === "median") {
    const { p10, p50, p90 } = cell.summary.percentiles;
    return { bold: String(Math.max(0, Math.round(p50))), small: likelyRangeText(Math.max(0, p10), Math.max(0, p90)) };
  }
  const words = chanceWordsFor(cell.cell);
  const bold = `${String(Math.round(cell.summary.chance * 100))}% ${words.bold}`;
  // NO FABRICATED ZERO: 10-04 returns `undefined` when all the mass sits at
  // zero, and a printed "~0" would assert a typical amount the draws never
  // produced.
  const small =
    cell.summary.conditionalMedian === undefined
      ? undefined
      : `~${String(Math.round(cell.summary.conditionalMedian))} ${words.conditional}`;
  return { bold, small };
}

function LedgerCell({ cell }: { cell: DistrictLedgerCell }) {
  if (cell.kind === "final") {
    return (
      <TableCell data-cell="final" data-cell-id={cell.id} className="numeric-cell text-[var(--color-text-muted)]">
        {String(Math.round(cell.earned))}
      </TableCell>
    );
  }
  if (cell.kind === "unavailable") {
    return (
      <TableCell data-cell="unavailable" data-cell-id={cell.id} className="numeric-cell text-[var(--color-text-muted)]">
        {DISTRICT_LEDGER_UNAVAILABLE_CELL}
      </TableCell>
    );
  }
  const lines = openCellLines(cell);
  return (
    <TableCell data-cell="open" data-cell-id={cell.id} className="numeric-cell">
      {/* A blue cell is a real <button>: focusable, two lines, never hue alone. */}
      <button type="button" className={OPEN_CELL_CLASS}>
        <span className={OPEN_CELL_BOLD_CLASS}>{lines.bold}</span>
        {lines.small !== undefined && <span className={OPEN_CELL_SMALL_CLASS}>{lines.small}</span>}
      </button>
    </TableCell>
  );
}

function EventCell({ row }: { row: DistrictLedgerEventRow }) {
  return (
    <TableCell data-testid="district-ledger-event-cell" className="whitespace-nowrap">
      <span>{row.eventName}</span>{" "}
      <span className="text-[var(--color-text-muted)]">
        {row.week === null ? "" : `Wk ${String(row.week)} · `}
        {stageWord(row.stage)}
      </span>
    </TableCell>
  );
}

function TeamCell({ team, season, algorithm }: { team: DistrictLedgerTeam; season: number; algorithm: PublishedAlgorithmId }) {
  return (
    <TableCell rowSpan={Math.max(team.rowCount, 1)} data-testid="district-ledger-team-cell" className={TEAM_CELL_CLASS}>
      <div className="flex flex-col">
        <span className="whitespace-nowrap">
          <span className="text-[var(--color-text-muted)]">{team.position}. </span>
          <Link to="/team/$teamNumber" params={{ teamNumber: String(team.teamNumber) }} search={{ year: season, algorithm, tab: "overview" }}>
            {team.teamNumber}
          </Link>
        </span>
        <span className="truncate text-[var(--color-text-muted)]">{team.nickname}</span>
        <span className="whitespace-nowrap text-[var(--color-text-muted)]">
          {String(Math.round(team.earnedDistrictTotal))} earned
          {team.hasOpenCategory ? ` · ${String(Math.round(team.projection))} projected` : ""}
        </span>
      </div>
    </TableCell>
  );
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
    <div className="data-card flex flex-col gap-[var(--spacing-md)] p-[var(--spacing-md)]" data-testid="district-ledger-controls">
      {children}
      <div className="flex flex-wrap items-end gap-[var(--spacing-lg)]">
        <label className="flex flex-col gap-[var(--spacing-xs)]">
          <span className="text-[var(--color-text-muted)]">{DISTRICT_LEDGER_SEARCH_LABEL}</span>
          <input
            type="text"
            inputMode="numeric"
            value={query}
            placeholder={DISTRICT_LEDGER_SEARCH_PLACEHOLDER}
            onChange={(event) => onQueryChange(event.target.value)}
            className="tap-target rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-[var(--spacing-sm)] py-[var(--spacing-xs)]"
          />
        </label>
        <div data-testid="district-ledger-stat-line" className="flex flex-wrap gap-[var(--spacing-lg)]">
          <div>
            <span className="block text-[var(--color-text-muted)]">
              {statLine.todaysLineFloor === null ? DISTRICT_LEDGER_STAT_LINE_LABELS.todaysLineUnknown : DISTRICT_LEDGER_STAT_LINE_LABELS.todaysLine}
            </span>
            <span className="font-semibold">{statLine.todaysLineFloor === null ? "—" : String(Math.round(statLine.todaysLineFloor))}</span>
          </div>
          <div>
            <span className="block text-[var(--color-text-muted)]">{DISTRICT_LEDGER_STAT_LINE_LABELS.openCells}</span>
            <span className="font-semibold">
              {String(statLine.openCells)} of {String(statLine.totalCells)}
            </span>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-[var(--spacing-md)]" data-testid="district-ledger-legend">
        <span className="text-[var(--color-text-muted)]">{DISTRICT_LEDGER_LEGEND_EARNED}</span>
        <span className="text-[var(--lock-status-locked-award-fg)]">{DISTRICT_LEDGER_LEGEND_OPEN}</span>
        <span className="text-[var(--color-text-muted)]">{DISTRICT_LEDGER_LEGEND_EXPLAINER}</span>
      </div>
    </div>
  );
}

export function DistrictLedger({ artifact, algorithm, season }: DistrictLedgerProps) {
  const activeEventKeys = useMemo(() => inProgressDistrictEventKeys(artifact), [artifact]);

  const stageByEvent = useMemo(() => {
    const map = new Map<string, DistrictStageFinality>();
    for (const team of artifact.teams) {
      for (const entry of districtTierEvents(team)) {
        if (map.has(entry.eventKey)) continue;
        map.set(entry.eventKey, deriveStageFromState(entry.state).final);
      }
    }
    return map;
  }, [artifact]);

  const [query, setQuery] = useState("");
  const [hiddenStatuses, setHiddenStatuses] = useState<ReadonlySet<DistrictLedgerStatusKey>>(() => new Set());

  const data = useDistrictLedgerData({ artifact, activeEventKeys, stageByEvent });

  const rows = useMemo(
    () =>
      buildDistrictLedgerRows({
        artifact,
        distributions: data.distributions,
        unavailableEvents: data.unavailableEvents,
        gaps: data.gaps,
      }),
    [artifact, data.distributions, data.unavailableEvents, data.gaps]
  );

  const statuses = useMemo(() => computeDistrictLedgerStatuses({ artifact, teams: rows.teams }), [artifact, rows.teams]);

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
        <StatusChips counts={statuses.counts} active={activeStatuses} onToggle={toggleStatus} />
      </ControlsCard>
      {visibleTeams.length === 0 && <p className="text-[var(--color-text-muted)]">{DISTRICT_LEDGER_NO_MATCHES}</p>}
      {/* The shipped table wrapper, verbatim, so the scroll arbitration this
          site already has an e2e suite around is inherited rather than rebuilt. */}
      <div className="data-card w-full min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
        <Table>
          <TableHeader>
            <TableRow>
              {DISTRICT_LEDGER_COLUMN_LABELS.map((label) => (
                <TableHead key={label}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleTeams.flatMap((team) =>
              team.rows.length === 0
                ? [
                    <TableRow key={team.teamKey} data-testid="district-ledger-row" data-team={team.teamKey}>
                      <TeamCell team={team} season={season} algorithm={algorithm} />
                      <StatusCell status={statuses.byTeam.get(team.teamKey)} rowSpan={1} />
                      <TableCell colSpan={DISTRICT_LEDGER_COLUMN_LABELS.length - 3} className="text-[var(--color-text-muted)]">
                        {DISTRICT_LEDGER_UNAVAILABLE_CELL}
                      </TableCell>
                      <LedgerCell cell={team.grandTotal} />
                    </TableRow>,
                  ]
                : team.rows.map((row, rowIndex) => (
                    <TableRow key={`${team.teamKey}-${row.eventKey}`} data-testid="district-ledger-row" data-team={team.teamKey}>
                      {rowIndex === 0 && <TeamCell team={team} season={season} algorithm={algorithm} />}
                      {rowIndex === 0 && <StatusCell status={statuses.byTeam.get(team.teamKey)} rowSpan={Math.max(team.rowCount, 1)} />}
                      <EventCell row={row} />
                      {row.cells.map((cell) => (
                        <LedgerCell key={cell.id} cell={cell} />
                      ))}
                      <LedgerCell cell={row.eventTotal} />
                      {rowIndex === 0 && (
                        <TableCell rowSpan={Math.max(team.rowCount, 1)} data-testid="district-ledger-grand-total" className="numeric-cell align-top">
                          <GrandTotalContent cell={team.grandTotal} />
                        </TableCell>
                      )}
                    </TableRow>
                  ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** The grand total's own content, rendered inside a cell that carries the team's row span rather than inside `LedgerCell`'s own `<td>`. */
function GrandTotalContent({ cell }: { cell: DistrictLedgerCell }) {
  if (cell.kind === "final") {
    return (
      <span data-cell="final" data-cell-id={cell.id} className="text-[var(--color-text-muted)]">
        {String(Math.round(cell.earned))}
      </span>
    );
  }
  if (cell.kind === "unavailable") {
    return (
      <span data-cell="unavailable" data-cell-id={cell.id} className="text-[var(--color-text-muted)]">
        {DISTRICT_LEDGER_UNAVAILABLE_CELL}
      </span>
    );
  }
  const lines = openCellLines(cell);
  return (
    <button type="button" data-cell="open" data-cell-id={cell.id} className={OPEN_CELL_CLASS}>
      <span className={OPEN_CELL_BOLD_CLASS}>{lines.bold}</span>
      {lines.small !== undefined && <span className={OPEN_CELL_SMALL_CLASS}>{lines.small}</span>}
    </button>
  );
}
