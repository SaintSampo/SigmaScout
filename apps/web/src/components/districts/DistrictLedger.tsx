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
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { EmptyState } from "@/components/StateViews";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import {
  DISTRICT_LEDGER_CHANCE_WORDS,
  DISTRICT_LEDGER_COLUMN_LABELS,
  DISTRICT_LEDGER_LIKELY_PREFIX,
  DISTRICT_LEDGER_STAGE_WORDS,
  DISTRICT_LEDGER_UNAVAILABLE_CELL,
} from "./districtLedgerCopy.js";
import {
  buildDistrictLedgerRows,
  deriveStageFromState,
  districtTierEvents,
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
            {rows.teams.flatMap((team) =>
              team.rows.length === 0
                ? [
                    <TableRow key={team.teamKey} data-testid="district-ledger-row" data-team={team.teamKey}>
                      <TeamCell team={team} season={season} algorithm={algorithm} />
                      <TableCell colSpan={DISTRICT_LEDGER_COLUMN_LABELS.length - 2} className="text-[var(--color-text-muted)]">
                        {DISTRICT_LEDGER_UNAVAILABLE_CELL}
                      </TableCell>
                      <LedgerCell cell={team.grandTotal} />
                    </TableRow>,
                  ]
                : team.rows.map((row, rowIndex) => (
                    <TableRow key={`${team.teamKey}-${row.eventKey}`} data-testid="district-ledger-row" data-team={team.teamKey}>
                      {rowIndex === 0 && <TeamCell team={team} season={season} algorithm={algorithm} />}
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
