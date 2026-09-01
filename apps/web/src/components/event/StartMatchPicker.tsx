import { useState } from "react";
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

/**
 * `SimulationTabSkeleton`'s placeholder footprint (08-09) is grounded in the
 * same geometry this real picker renders at. 2026-09-01: the picker is no
 * longer a bounded 320px scrolling list of every qualification match — it is
 * a slider plus a typed match number plus one summary of the selected match
 * (user request), which is far shorter, so this height came down with it.
 */
export const START_MATCH_PICKER_MAX_H_PX = 132;

export const START_MATCH_PICKER_TESTID = "start-match-picker";
/**
 * Identifies the ONE match the picker is currently showing. Before
 * 2026-09-01 the picker rendered every match as its own row and this prefix
 * appeared once per match; it now appears exactly once, on the selected
 * match's summary — the same identity, on the only row that still exists.
 */
export const START_MATCH_ROW_TESTID_PREFIX = "start-match-row-";
export const START_MATCH_SLIDER_TESTID = "start-match-slider";
export const START_MATCH_NUMBER_INPUT_TESTID = "start-match-number";
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

/**
 * The selected match, spelled out: its label, both alliances' team numbers,
 * its played/upcoming status and its scheduled time — the same four facts
 * the old per-match rows carried, now shown once for the one match the
 * slider is pointing at.
 */
function StartMatchSummary({ row }: { row: EventMatchRow }) {
  return (
    <div
      data-testid={`${START_MATCH_ROW_TESTID_PREFIX}${row.matchKey}`}
      data-selected="true"
      className="flex items-center justify-between gap-[var(--spacing-sm)] border-l-[3px] border-l-[var(--color-accent)] bg-[var(--sim-picker-selected-bg)] px-[var(--spacing-sm)] py-[var(--spacing-xs)]"
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
    </div>
  );
}

/**
 * The chronological picker (UI-SPEC's Simulation Tab Contract, "1.
 * Start-match picker"). Renders, top to bottom: the hint line when nothing
 * is selected, or the minted scope line when something is; then a SLIDER
 * across the event's qualification schedule paired with a typed match
 * number; then a summary of the one match the slider currently points at.
 *
 * 2026-09-01 (user request): this replaced a bounded, 320px scrolling list
 * of every qualification match. A real event runs 80-140 quals, so choosing
 * a start match meant scrolling a long list inside a short window — the
 * slider reaches any match in one gesture, and the number input reaches an
 * exact one without any gesture at all. The FACTS shown are unchanged;
 * they are simply shown for the selected match rather than for all of them.
 *
 * The number input is typed against a match's own `matchNumber` (what a
 * reader would say out loud — "Qual 47"), not the slider's array index,
 * with a local draft so a half-typed value never snaps out from under the
 * keyboard; the draft is dropped on blur so the field always returns to
 * showing the real selection.
 */
export function StartMatchPicker({ rows, selectedMatchKey, onSelect, inputs, startLabel, disabled }: StartMatchPickerProps) {
  const disclosureText = inputs !== null && startLabel !== null ? simulationScopeText(inputs, startLabel) : START_MATCH_PICKER_HINT;
  const [draft, setDraft] = useState<string | null>(null);

  const selectedIndex = rows.findIndex((row) => row.matchKey === selectedMatchKey);
  const activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const activeRow = rows[activeIndex];

  // PD-09's guard lives in the HANDLERS, not only on the controls. `inert`
  // and `disabled` are presentation-layer defences that a programmatic
  // change event walks straight past (measured: a `fireEvent.change` on the
  // disabled number input still moved the selection mid-run), and PD-09's
  // whole point is that a running simulation's start match cannot move.
  function selectIndex(oneBased: number): void {
    if (disabled) return;
    setDraft(null);
    const row = rows[oneBased - 1];
    if (row) onSelect(row.matchKey);
  }

  function typeMatchNumber(text: string): void {
    if (disabled) return;
    setDraft(text);
    const parsed = Number.parseInt(text, 10);
    if (Number.isNaN(parsed)) return;
    // Looked up by the match's OWN number rather than by position: a schedule
    // with a gap would otherwise send "Qual 40" to whatever sits fortieth.
    const row = rows.find((candidate) => candidate.matchNumber === parsed);
    if (row) onSelect(row.matchKey);
  }

  return (
    <div className="flex flex-col gap-[var(--spacing-xs)]">
      <p data-testid={START_MATCH_SCOPE_TESTID} className="text-role-body text-muted-foreground">
        {disclosureText}
      </p>
      <div
        data-testid={START_MATCH_PICKER_TESTID}
        inert={disabled ? true : undefined}
        className={cn("flex flex-col gap-[var(--spacing-sm)]", disabled && "pointer-events-none opacity-60")}
      >
        {activeRow !== undefined && (
          <>
            <div className="flex items-center gap-[var(--spacing-md)]">
              <input
                type="range"
                data-testid={START_MATCH_SLIDER_TESTID}
                aria-label="Start match"
                min={1}
                max={rows.length}
                step={1}
                value={activeIndex + 1}
                disabled={disabled}
                onChange={(event) => selectIndex(Number(event.target.value))}
                className="min-w-0 flex-1 accent-[var(--color-accent)]"
              />
              <label className="text-role-label flex shrink-0 items-center gap-[var(--spacing-xs)] text-[var(--color-text-muted)]">
                Match
                <input
                  type="number"
                  data-testid={START_MATCH_NUMBER_INPUT_TESTID}
                  min={1}
                  value={draft ?? String(activeRow.matchNumber)}
                  disabled={disabled}
                  onChange={(event) => typeMatchNumber(event.target.value)}
                  onBlur={() => setDraft(null)}
                  className="numeric-cell text-role-body w-[5rem] rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-[var(--spacing-xs)] py-[2px] text-[var(--color-text-primary)]"
                />
              </label>
            </div>
            <StartMatchSummary row={activeRow} />
          </>
        )}
      </div>
    </div>
  );
}
