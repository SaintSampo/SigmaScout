/**
 * The Locks milestone picker (sketch 024 variant Q): pick an event, then one of
 * its eight milestones, instead of dragging through every match of the season.
 * Both the District Locks and the Champ Locks tab render this one component.
 *
 * THE URL IS THE ONLY SELECTION. The pressed stop, the pills, the arrows and
 * the Next text are all derived from `at` on every render; nothing here keeps a
 * selection of its own. The only local state is which event the menu shows,
 * because Season start and Live never move the menu (the sketch's behaviour).
 *
 * A CLICK COMMITS AT ONCE. Every control here is discrete, so the delayed
 * commit a dragged control needs has no job to do and is gone on purpose.
 *
 * Every class below is a plain string bound to the `.locks-picker*` rules in
 * `theme.css`, never passed through `cn()`, and this file writes no colour.
 */
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import {
  DISTRICT_LEDGER_MILESTONE_GROUPS,
  DISTRICT_LEDGER_MILESTONE_SUB_WORDS,
  LOCKS_PICKER_EVENT_LABEL,
  LOCKS_PICKER_LIVE,
  LOCKS_PICKER_NEXT_LABEL,
  LOCKS_PICKER_NOW_MARK,
  LOCKS_PICKER_PREV_LABEL,
  LOCKS_PICKER_SEASON_START,
  districtLedgerShortEventName,
  locksPickerGroupLabel,
  locksPickerLiveCaption,
  locksPickerMilestoneTitle,
  locksPickerNextText,
  locksPickerOptionLabel,
  locksPickerStopLabel,
  locksPickerUpCaption,
} from "./districtLedgerCopy.js";
import {
  buildDistrictMilestones,
  defaultMilestoneFocus,
  districtMilestoneSelection,
  milestoneFocusTarget,
  milestoneStopStates,
  milestoneWalkNeighbours,
  selectionEventKey,
  walkItemAtId,
  type DistrictMilestoneEvent,
  type DistrictMilestoneEventInput,
  type DistrictMilestoneEventStatus,
  type DistrictMilestoneWalkItem,
} from "./districtMilestones.js";
import { DISTRICT_TIMELINE_NOW_ID, DISTRICT_TIMELINE_SEASON_START_ID, type DistrictTimeline } from "./districtTimeline.js";

export interface LocksMilestonePickerProps {
  readonly timeline: DistrictTimeline;
  readonly events: readonly DistrictMilestoneEventInput[];
  readonly at: string | undefined;
  readonly positionIndex: number;
  readonly onAtChange: (id: string) => void;
}

/** The name the picker prints: the ledger's own short form of TBA's district event name, as the sketch's short names read. */
function displayName(eventName: string): string {
  return districtLedgerShortEventName(eventName);
}

function walkItemTitle(item: DistrictMilestoneWalkItem): string {
  if (item.kind === "start") return LOCKS_PICKER_SEASON_START;
  if (item.kind === "live") return LOCKS_PICKER_LIVE;
  return locksPickerMilestoneTitle(displayName(item.milestone.eventName), item.milestone.key);
}

interface MenuGroup {
  readonly id: string;
  readonly week: number | null;
  readonly isDcmp: boolean;
  readonly events: DistrictMilestoneEvent[];
}

/** Numeric weeks ascending, then a null week, then the DCMP tier; events inside a group keep model order. */
function menuGroups(events: readonly DistrictMilestoneEvent[]): MenuGroup[] {
  const byId = new Map<string, MenuGroup>();
  for (const event of events) {
    const { isDcmp, week } = event.input;
    const id = isDcmp ? "dcmp" : week === null ? "none" : `w${String(week)}`;
    let group = byId.get(id);
    if (group === undefined) {
      group = { id, week: isDcmp ? null : week, isDcmp, events: [] };
      byId.set(id, group);
    }
    group.events.push(event);
  }
  const rank = (group: MenuGroup) => (group.isDcmp ? 2 : group.week === null ? 1 : 0);
  return [...byId.values()].sort((a, b) => rank(a) - rank(b) || (a.week ?? 0) - (b.week ?? 0));
}

/** A group reads live while any event in it is live or the week is part played, done when every event is done, and not played yet when none has started. */
function groupStatus(group: MenuGroup): DistrictMilestoneEventStatus {
  const statuses = group.events.map((event) => event.status);
  if (statuses.every((status) => status === "done")) return "done";
  if (statuses.every((status) => status === "up")) return "up";
  return "live";
}

export function LocksMilestonePicker({ timeline, events, at, positionIndex, onAtChange }: LocksMilestonePickerProps) {
  const selectId = useId();
  const model = useMemo(() => buildDistrictMilestones(timeline, events), [timeline, events]);
  const selection = districtMilestoneSelection(model, timeline, at, positionIndex);
  const selectedEventKey = selectionEventKey(selection);

  // Which event the menu shows. A selection that carries an event moves it;
  // Season start and Live leave it where it was.
  const [focusState, setFocusState] = useState<string | undefined>(() => selectedEventKey ?? defaultMilestoneFocus(model));
  useEffect(() => {
    if (selectedEventKey !== null) setFocusState(selectedEventKey);
  }, [selectedEventKey]);
  const focusKey =
    selectedEventKey !== null && model.byEvent.has(selectedEventKey)
      ? selectedEventKey
      : focusState !== undefined && model.byEvent.has(focusState)
        ? focusState
        : defaultMilestoneFocus(model);
  const focused = focusKey === undefined ? undefined : model.byEvent.get(focusKey);
  const focusedName = focused === undefined ? "" : displayName(focused.input.eventName);

  const stops = milestoneStopStates(model, focusKey, selection);
  const { prev, next } = milestoneWalkNeighbours(model, selection);
  const groups = useMemo(() => menuGroups(model.events), [model]);

  function handleEventChange(eventKey: string): void {
    setFocusState(eventKey);
    const target = milestoneFocusTarget(model, eventKey, selection);
    if (target !== null) onAtChange(target);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const tag = (event.target as HTMLElement).tagName;
    if (tag === "SELECT" || tag === "INPUT") return;
    if (event.key === "ArrowLeft" && prev !== undefined) {
      event.preventDefault();
      onAtChange(walkItemAtId(prev));
    } else if (event.key === "ArrowRight" && next !== undefined) {
      event.preventDefault();
      onAtChange(walkItemAtId(next));
    } else if (event.key === "Home") {
      event.preventDefault();
      onAtChange(DISTRICT_TIMELINE_SEASON_START_ID);
    } else if (event.key === "End") {
      event.preventDefault();
      onAtChange(DISTRICT_TIMELINE_NOW_ID);
    }
  }

  const caption =
    focused?.status === "up" ? locksPickerUpCaption(focusedName) : focused?.status === "live" ? locksPickerLiveCaption(focusedName) : "";

  return (
    <div className="locks-picker" data-testid="district-ledger-rewind" onKeyDown={handleKeyDown}>
      <div className="locks-picker-row">
        <label className="locks-picker-lbl" htmlFor={selectId}>
          {LOCKS_PICKER_EVENT_LABEL}
        </label>
        <select
          id={selectId}
          className="locks-picker-select"
          data-testid="locks-picker-event"
          value={focusKey ?? ""}
          onChange={(event) => handleEventChange(event.target.value)}
        >
          {groups.map((group) => (
            <optgroup key={group.id} label={locksPickerGroupLabel(group, groupStatus(group))}>
              {group.events.map((event) => (
                <option key={event.input.eventKey} value={event.input.eventKey} disabled={event.status === "up"}>
                  {locksPickerOptionLabel(displayName(event.input.eventName), event.status === "live")}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="locks-picker-spacer" />
        <button
          type="button"
          className="locks-picker-pill"
          data-testid="locks-picker-season-start"
          aria-pressed={selection.kind === "start"}
          onClick={() => onAtChange(DISTRICT_TIMELINE_SEASON_START_ID)}
        >
          {LOCKS_PICKER_SEASON_START}
        </button>
        <button
          type="button"
          className="locks-picker-pill"
          data-testid="locks-picker-live"
          aria-pressed={selection.kind === "live"}
          onClick={() => onAtChange(DISTRICT_TIMELINE_NOW_ID)}
        >
          <span className="locks-picker-live-dot" />
          {LOCKS_PICKER_LIVE}
        </button>
      </div>
      <div className="locks-picker-stepper">
        <div className="locks-picker-groups">
          {DISTRICT_LEDGER_MILESTONE_GROUPS.map((group) => (
            <span key={group.label} style={{ gridColumn: `${String(group.from)} / ${String(group.to)}` }}>
              {group.label}
            </span>
          ))}
        </div>
        <div className="locks-picker-track">
          <div className="locks-picker-line">
            <span className="locks-picker-line-fill" style={{ width: `${String(stops.fillStop >= 0 ? (stops.fillStop / 7) * 100 : 0)}%` }} />
          </div>
          {(focused?.milestones ?? []).map((milestone, index) => (
            <button
              key={milestone.key}
              type="button"
              className={stops.done[index] === true ? "locks-picker-stop locks-picker-stop--done" : "locks-picker-stop"}
              aria-pressed={stops.pressed[index] === true}
              aria-label={locksPickerStopLabel(focusedName, milestone.key, milestone.happened)}
              disabled={!milestone.happened}
              data-milestone={milestone.key}
              onClick={() => onAtChange(milestone.atId)}
            >
              <span className="locks-picker-dot" />
              <span className="locks-picker-stop-label">{DISTRICT_LEDGER_MILESTONE_SUB_WORDS[milestone.key]}</span>
            </button>
          ))}
          <span
            className="locks-picker-now"
            data-testid="locks-picker-now"
            hidden={stops.nowBoundary === null}
            style={stops.nowBoundary === null ? undefined : { left: `calc(${String(stops.nowBoundary)} * 100% / 8)` }}
          >
            {LOCKS_PICKER_NOW_MARK}
          </span>
        </div>
        <p className="locks-picker-caption" data-testid="locks-picker-caption">
          {caption}
        </p>
      </div>
      <div className="locks-picker-row locks-picker-row--nav">
        <div className="locks-picker-nav">
          <button
            type="button"
            className="locks-picker-ibtn"
            data-testid="locks-picker-prev"
            aria-label={LOCKS_PICKER_PREV_LABEL}
            disabled={prev === undefined}
            onClick={() => {
              if (prev !== undefined) onAtChange(walkItemAtId(prev));
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M11 2v12L3 8z" />
            </svg>
          </button>
          <button
            type="button"
            className="locks-picker-ibtn"
            data-testid="locks-picker-next"
            aria-label={LOCKS_PICKER_NEXT_LABEL}
            disabled={next === undefined}
            onClick={() => {
              if (next !== undefined) onAtChange(walkItemAtId(next));
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M5 2v12l8-6z" />
            </svg>
          </button>
          <span className="locks-picker-next" data-testid="locks-picker-next-text">
            {locksPickerNextText(next === undefined ? undefined : walkItemTitle(next))}
          </span>
        </div>
      </div>
    </div>
  );
}
