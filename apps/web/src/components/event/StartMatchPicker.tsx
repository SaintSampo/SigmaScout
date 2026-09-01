import { cn } from "@/lib/utils";
import { formatScheduledTime, matchLabel } from "../team/MatchTable.js";
import { teamNumberFromKey } from "../../lib/teamKey.js";
import { SIMULATION_DRAWS, type SimulationInputs } from "../../lib/simulationInputs.js";
import type { EventMatchRow } from "./eventMatchAxis.js";

/**
 * The start-match picker (08-11-PLAN.md Task 2, EVNT-07, D-01/D-13). A
 * compact, terser sibling of `EventMatchTable` — it reuses that table's
 * row-identity vocabulary (`matchLabel`, `formatScheduledTime`, the roster
 * number degrade) but deliberately carries none of its band/tick/dot plot,
 * because a picker whose only job is "which match" gains nothing from the
 * model's opinion of the outcome. Consumed by `SimulationTab.tsx` (Task 3),
 * whose selected `matchKey` state this component reports through but never
 * owns, and by 08-13 (the run control) and 08-14 (the rank table), both of
 * which read the same selection back out of `SimulationTab`.
 *
 * This component constructs no Web Worker, imports nothing from
 * `apps/web/src/workers/`, and calls `simulateRanks` nowhere.
 */

/** 08-UI-SPEC.md's Copywriting Contract, verbatim — never paraphrased. The literal draw count is guarded against `SIMULATION_DRAWS` by a test so the two cannot drift apart. One imprecision is shipped knowingly: the contract says "matches after it," while D-13 simulates the chosen match and everything after it; `simulationScopeText` below states the scope exactly once a match is chosen, and deviating from an approved copy row silently would be worse than this small imprecision in a pre-selection hint. */
export const START_MATCH_PICKER_HINT = `Pick a match to simulate from. Matches after it are simulated ${SIMULATION_DRAWS}×.`;

/** 08-UI-SPEC.md's Copywriting Contract, verbatim. */
export const START_MATCH_STATUS_PLAYED = "Played";
/** 08-UI-SPEC.md's Copywriting Contract, verbatim. */
export const START_MATCH_STATUS_UPCOMING = "Upcoming";

/** 08-UI-SPEC.md's Copywriting Contract, verbatim — sentence one of the rewind-honesty caption, split out so all three verdict branches in `rewindCaptionText` share it byte-for-byte. */
export const REWIND_CAPTION_LEAD =
  "Rewind simulation: this start match already happened, so predictions after it already reflect results the simulation is pretending haven't occurred.";

/** UI-SPEC's Simulation Tab Contract layout list — the picker's declared bounded-panel height, named here (not hand-picked) so `SimulationTabSkeleton`'s placeholder footprint (08-09) is grounded in the same geometry this real picker renders at. */
export const START_MATCH_PICKER_MAX_H_PX = 320;

export const START_MATCH_PICKER_TESTID = "start-match-picker";
export const START_MATCH_ROW_TESTID_PREFIX = "start-match-row-";
export const REWIND_CAPTION_TESTID = "rewind-caption";
/** The hint/scope disclosure line's testid — not independently exported (no other plan mounts a child there), so it is a literal string rather than a fifth constant. */
const START_MATCH_SCOPE_TESTID = "start-match-scope";

/**
 * The minted line that replaces the hint once a start match is selected
 * (flagged planner assumption 3, 08-11-PLAN.md — no Copywriting Contract row
 * existed for this state). Names the simulated match count, the start
 * match's own label and the shared draw count, then discloses D-12's two
 * honesty gaps — the excluded-match count and the incomplete-baseline-team
 * count — each omitted entirely when its own count is zero, because a
 * disclosure that always renders teaches a reader to stop reading it. This
 * is the ONLY surface on this site that discloses either count.
 */
export function simulationScopeText(inputs: SimulationInputs, startLabel: string): string {
  const matchCount = inputs.remainingMatches.length;
  const matchNoun = matchCount === 1 ? "match" : "matches";
  let text = `Simulating ${matchCount} qualification ${matchNoun} from ${startLabel} onward, ${SIMULATION_DRAWS} draws.`;

  if (inputs.excludedMatchKeys.length > 0) {
    text += ` ${inputs.excludedMatchKeys.length} further qualification match(es) carry no predicted ranking-point distribution and are not simulated.`;
  }

  if (inputs.incompleteBaselineTeamKeys.length > 0) {
    text += ` ${inputs.incompleteBaselineTeamKeys.length} team(s) have an earlier match with no recorded ranking points, so their starting totals are incomplete.`;
  }

  return text;
}

/**
 * The rewind-honesty caption's text builder (D-02). Always begins with
 * `REWIND_CAPTION_LEAD`, then branches on `verdict` — imported from
 * `apps/web/src/lib/rewindGap.ts` alongside `percent`, never presupposed —
 * so this sentence can never claim a narrowing the underlying measurement
 * did not find. The magnitude is rendered as `Math.abs(percent)`, one
 * decimal place: the direction comes from `verdict` alone, so a negative
 * measured percent can never surface as a minus sign inside a sentence that
 * already names a direction in words. Never rounds, adjusts or tidies the
 * imported figure beyond formatting it for display.
 */
export function rewindCaptionText(percent: number, verdict: "narrower" | "wider" | "indistinguishable"): string {
  const magnitude = Math.abs(percent).toFixed(1);
  if (verdict === "narrower") {
    return `${REWIND_CAPTION_LEAD} Rank spreads here run about ${magnitude}% narrower than a true from-here forecast.`;
  }
  if (verdict === "wider") {
    return `${REWIND_CAPTION_LEAD} Rank spreads here run about ${magnitude}% wider than a true from-here forecast.`;
  }
  return `${REWIND_CAPTION_LEAD} The measured difference in rank spread was inside the measurement's own noise, so this measurement can't say how much that changes the rank spread here.`;
}

/** A team key's displayed number, degrading identically to `EventMatchTable.tsx`'s module-private `rosterNumberLabel` (not imported — that helper is not exported and this plan does not modify that file) — the same `teamNumberFromKey` call, the same try/catch fallback to the raw key string. */
function rosterNumberLabel(rosterKey: string): string {
  try {
    return `${teamNumberFromKey(rosterKey)}`;
  } catch {
    return rosterKey;
  }
}

export interface StartMatchPickerProps {
  /** Every qualification row at the event, already ordered by the caller (`simulationInputs.ts`'s `buildQualRows`). */
  rows: readonly EventMatchRow[];
  selectedMatchKey: string | null;
  onSelect: (matchKey: string) => void;
  /** The assembled `SimulationInputs` for the CURRENT selection, or `null` when nothing is selected. */
  inputs: SimulationInputs | null;
  /** The selected row's `matchLabel` output, or `null` when nothing is selected. */
  startLabel: string | null;
  /** PD-09: inert for the duration of a run, so a mid-run click cannot change the start match under a running simulation (08-13 wires the real value; `SimulationTab` passes `false` until then). Named for the effect, not for its one known cause — a caller freezing the picker for a different reason needs no new prop. Rows stay READABLE while inert: their labels and team numbers remain in the document so a reader can still see which match a running simulation started from. */
  disabled: boolean;
}

function StartMatchRow({
  row,
  selected,
  disabled,
  onSelect,
}: {
  row: EventMatchRow;
  selected: boolean;
  disabled: boolean;
  onSelect: (matchKey: string) => void;
}) {
  return (
    <button
      type="button"
      data-testid={`${START_MATCH_ROW_TESTID_PREFIX}${row.matchKey}`}
      data-selected={selected ? "true" : undefined}
      onClick={disabled ? undefined : () => onSelect(row.matchKey)}
      className={cn(
        // `shrink-0` is load-bearing (mobile overlap bug, 2026-09-01): rows
        // are flex items of the bounded overflow-y-auto column, and default
        // flex-shrink compressed every row to tap-target's 44px min-height
        // floor while content measures 51px — the 7px excess painted over
        // the next row (measured live at 390px). Rows must never shrink;
        // the panel scrolls instead.
        "tap-target flex w-full shrink-0 items-center justify-between gap-[var(--spacing-sm)] border-l-[3px] px-[var(--spacing-sm)] py-[var(--spacing-xs)] text-left",
        selected ? "border-l-[var(--color-accent)] bg-[var(--sim-picker-selected-bg)]" : "border-l-transparent"
      )}
    >
      <span className="flex min-w-0 flex-col gap-[1px]">
        <span className="text-role-label text-[var(--color-text-primary)]">{matchLabel(row)}</span>
        <span className="numeric-cell text-role-body whitespace-nowrap text-[var(--color-text-primary)]">
          {row.redTeams.map((key, index) => (
            <span key={key}>
              {index > 0 ? " " : ""}
              {rosterNumberLabel(key)}
            </span>
          ))}
        </span>
        <span className="numeric-cell text-role-body whitespace-nowrap text-[var(--color-text-primary)]">
          {row.blueTeams.map((key, index) => (
            <span key={key}>
              {index > 0 ? " " : ""}
              {rosterNumberLabel(key)}
            </span>
          ))}
        </span>
      </span>
      <span className="flex flex-col items-end gap-[1px]">
        <span className="text-role-label text-[var(--color-text-muted)]">{row.played ? START_MATCH_STATUS_PLAYED : START_MATCH_STATUS_UPCOMING}</span>
        <span className="numeric-cell text-role-body whitespace-nowrap text-[var(--color-text-muted)]">
          {row.sortTime !== undefined ? formatScheduledTime(row.sortTime) : ""}
        </span>
      </span>
    </button>
  );
}

/**
 * The bounded-height chronological picker (UI-SPEC's Simulation Tab
 * Contract, "1. Start-match picker"). Renders, top to bottom: the hint line
 * when nothing is selected, or the minted scope line when something is;
 * then the bounded panel (`overflow-y-auto`, `overscroll-behavior:
 * contain`, so the panel's own scroll and the page's stay sibling regions);
 * then one row per entry of `rows`.
 */
export function StartMatchPicker({ rows, selectedMatchKey, onSelect, inputs, startLabel, disabled }: StartMatchPickerProps) {
  const disclosureText = inputs !== null && startLabel !== null ? simulationScopeText(inputs, startLabel) : START_MATCH_PICKER_HINT;

  return (
    <div className="flex flex-col gap-[var(--spacing-xs)]">
      <p data-testid={START_MATCH_SCOPE_TESTID} className="text-role-body text-muted-foreground">
        {disclosureText}
      </p>
      <div
        data-testid={START_MATCH_PICKER_TESTID}
        inert={disabled ? true : undefined}
        className={cn("flex flex-col divide-y divide-[var(--color-border)] overflow-y-auto overscroll-y-contain", disabled && "pointer-events-none opacity-60")}
        style={{ maxHeight: `${START_MATCH_PICKER_MAX_H_PX}px` }}
      >
        {rows.map((row) => (
          <StartMatchRow key={row.matchKey} row={row} selected={row.matchKey === selectedMatchKey} disabled={disabled} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}
