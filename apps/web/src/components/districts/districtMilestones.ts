/**
 * The Locks milestone picker's pure model (sketch 024 variant Q): the eight
 * milestones of every event, which of them have happened, what the URL's `at`
 * selects, which stops read as done at that selection, the walk the arrows
 * follow, and which event the event menu focuses.
 *
 * One pure module, no React.
 *
 * THREE DECISIONS SHAPE IT:
 *
 * 1. HAPPENED READS THE STATE BLOCKS, NOT THE TIMELINE. Every event contributes
 *    its four stage steps to the timeline whether or not it has started, and a
 *    future event's stage steps sort BEFORE the now position. "Its position
 *    exists and sits before now" would therefore call a future event's Awards
 *    happened. The artifact's own state facts are the only honest answer.
 * 2. THE QUARTILE IDS ARE QUALIFICATION MATCH NUMBERS. Quals ¼ is qualification
 *    match `max(1, round(total x 0.25))`, stored as the existing match step id
 *    `<eventKey>:m:<eventKey>_qm<k>`. That id can be BUILT with no artifact
 *    loaded, which matters because at now on a finished district no event
 *    artifact is fetched, yet every stop of a finished event must be solid and
 *    clickable. The id resolves to its position once the rewind loads the
 *    artifact.
 * 3. SCHEDULE USES THE `<eventKey>:schedule` ALIAS. "Just before the event's
 *    first match" is some OTHER step's position, so storing that step's id would
 *    reopen a shared Schedule link as a different event with no stop pressed;
 *    see `resolveDistrictTimelinePosition`.
 */
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { DistrictTier } from "../../../../../packages/core/districts/pointModel.js";
import {
  districtEventCategoryFinality,
  districtEventStateFinished,
  districtEventStateStarted,
  type DistrictEventStateFacts,
} from "../../../../../packages/core/districts/reservedSlots.js";
import { tierEvents } from "./districtLedgerRows.js";
import {
  DISTRICT_TIMELINE_NOW_ID,
  DISTRICT_TIMELINE_SEASON_START_ID,
  districtScheduleMilestoneId,
  type DistrictTimeline,
} from "./districtTimeline.js";

/** The eight milestones of one event, in order. Sketch 024 Q has nine; its Playoffs half stop is not modelled yet. */
export const DISTRICT_MILESTONE_KEYS = ["schedule", "q1", "q2", "q3", "qualsDone", "alliance", "playoffs", "awards"] as const;

export type DistrictMilestoneKey = (typeof DISTRICT_MILESTONE_KEYS)[number];

/** The share of qualification each quartile stop marks. */
export const DISTRICT_MILESTONE_QUAL_FRACTIONS = { q1: 0.25, q2: 0.5, q3: 0.75 } as const;

/** One event as the picker needs to see it. */
export interface DistrictMilestoneEventInput {
  readonly eventKey: string;
  readonly eventName: string;
  readonly week: number | null;
  readonly isDcmp: boolean;
  readonly state: DistrictEventStateFacts | undefined;
}

/**
 * The district's events at the given tiers, one entry per event key, from every
 * team's `tierEvents` union. The first entry seen wins, except that a missing
 * state block is filled from a later team that carries one.
 */
export function districtMilestoneEvents(artifact: DistrictArtifact, tiers: readonly DistrictTier[]): DistrictMilestoneEventInput[] {
  const byKey = new Map<string, DistrictMilestoneEventInput>();
  for (const tier of tiers) {
    for (const team of artifact.teams) {
      for (const entry of tierEvents(team, tier)) {
        const existing = byKey.get(entry.eventKey);
        if (existing === undefined) {
          byKey.set(entry.eventKey, { eventKey: entry.eventKey, eventName: entry.eventName, week: entry.week, isDcmp: tier === "dcmp", state: entry.state });
        } else if (existing.state === undefined && entry.state !== undefined) {
          byKey.set(entry.eventKey, { ...existing, state: entry.state });
        }
      }
    }
  }
  return [...byKey.values()];
}

export type DistrictMilestoneEventStatus = "done" | "live" | "up";

/** Done when every category is final, live when started and not finished, up otherwise (including no state block). */
export function districtMilestoneEventStatus(state: DistrictEventStateFacts | undefined): DistrictMilestoneEventStatus {
  if (state === undefined) return "up";
  if (districtEventStateFinished(state)) return "done";
  return districtEventStateStarted(state) ? "live" : "up";
}

/** A comparison key: a position index, then a tie-break. Two keys compare lexicographically. */
export type DistrictMilestoneOrder = readonly [number, number];

/**
 * THE TIE-BREAKS ABOVE THE EIGHT STOP INDEXES (0 to 7), in walk order at one
 * position: a RESOLVED Schedule stop, then a bare position selection, then
 * Live.
 *
 * A resolved Schedule stop's position is the step just before its event's
 * first match, which is some OTHER event's step (or season start), and being
 * at a position means that step is done. With its own stop index (0) the
 * Schedule stop sorted BEFORE that step's stop, so on every week boundary the
 * arrows ran Playoffs, next event's Schedule, previous event's Awards, next
 * event's Quals ¼: the Next arrow stepped backwards onto the event the reader
 * had just left (seen on 2026fnc and 2026fim, 2026-10-06). An UNRESOLVED
 * Schedule stop keeps index 0, since it sorts against its own event's stops
 * at the quals-done fallback, not against another event's.
 */
const ORDER_TIE_SCHEDULE_RESOLVED = 8;
const ORDER_TIE_POSITION = 9;
const ORDER_TIE_LIVE = 10;

export interface DistrictMilestone {
  readonly eventKey: string;
  readonly eventName: string;
  readonly key: DistrictMilestoneKey;
  /** 0 to 7, the stop's column. */
  readonly index: number;
  /** What `?at=` stores for this stop. */
  readonly atId: string;
  /** The stop's position in the current timeline, or `null` when its step is not in it (its event's artifact is not loaded). */
  readonly positionIndex: number | null;
  readonly happened: boolean;
  /** `[positionIndex, index]` when resolved (a resolved Schedule takes `ORDER_TIE_SCHEDULE_RESOLVED`, after every stop at that position), else `[the event's quals done position, index]`, so an unresolved stop sorts just before its own Quals Done. */
  readonly order: DistrictMilestoneOrder;
}

export interface DistrictMilestoneEvent {
  readonly input: DistrictMilestoneEventInput;
  readonly status: DistrictMilestoneEventStatus;
  /** Always eight, in `DISTRICT_MILESTONE_KEYS` order. */
  readonly milestones: readonly DistrictMilestone[];
  /** The index of the event's first step in `positions`, which orders the events. */
  readonly firstIndex: number;
}

export type DistrictMilestoneWalkItem = { readonly kind: "start" } | { readonly kind: "live" } | { readonly kind: "milestone"; readonly milestone: DistrictMilestone };

export interface DistrictMilestoneModel {
  /** Sorted by `firstIndex`, then event name. */
  readonly events: readonly DistrictMilestoneEvent[];
  readonly byEvent: ReadonlyMap<string, DistrictMilestoneEvent>;
  /** Season start, every happened milestone of every event in timeline order, then Live. */
  readonly walk: readonly DistrictMilestoneWalkItem[];
  readonly nowIndex: number;
}

export type DistrictMilestoneSelection =
  | { readonly kind: "live" }
  | { readonly kind: "start" }
  | { readonly kind: "milestone"; readonly milestone: DistrictMilestone }
  | { readonly kind: "position"; readonly eventKey: string | null; readonly positionIndex: number };

/** The at id a walk item navigates to. */
export function walkItemAtId(item: DistrictMilestoneWalkItem): string {
  if (item.kind === "start") return DISTRICT_TIMELINE_SEASON_START_ID;
  if (item.kind === "live") return DISTRICT_TIMELINE_NOW_ID;
  return item.milestone.atId;
}

function compareOrder(a: DistrictMilestoneOrder, b: DistrictMilestoneOrder): number {
  return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1];
}

/** Qualification match NUMBER `k` for a quartile stop; a null total builds a placeholder that never happens. */
function quartileMatchNumber(total: number | null, fraction: number): number {
  return Math.max(1, Math.round((total ?? 0) * fraction));
}

function milestoneHappened(key: DistrictMilestoneKey, state: DistrictEventStateFacts | undefined): boolean {
  if (state === undefined) return false;
  switch (key) {
    case "schedule":
      return districtEventStateStarted(state);
    case "q1":
    case "q2":
    case "q3":
      return state.qualMatchesTotal !== null && state.qualMatchesPlayed >= quartileMatchNumber(state.qualMatchesTotal, DISTRICT_MILESTONE_QUAL_FRACTIONS[key]);
    case "qualsDone":
      return districtEventCategoryFinality(state).qual;
    case "alliance":
      return state.alliancesPicked;
    case "playoffs":
      return state.playoffsDone;
    case "awards":
      return state.awardsPosted;
  }
}

function milestoneAtId(key: DistrictMilestoneKey, input: DistrictMilestoneEventInput): string {
  const eventKey = input.eventKey;
  if (key === "schedule") return districtScheduleMilestoneId(eventKey);
  if (key === "q1" || key === "q2" || key === "q3") {
    const k = quartileMatchNumber(input.state?.qualMatchesTotal ?? null, DISTRICT_MILESTONE_QUAL_FRACTIONS[key]);
    return `${eventKey}:m:${eventKey}_qm${String(k)}`;
  }
  return `${eventKey}:${key}`;
}

export function buildDistrictMilestones(timeline: DistrictTimeline, inputs: readonly DistrictMilestoneEventInput[]): DistrictMilestoneModel {
  const { positions, nowIndex } = timeline;
  const events: DistrictMilestoneEvent[] = [];
  for (const input of inputs) {
    const indexOf = (id: string): number | null => {
      const index = positions.findIndex((position) => position.id === id);
      return index === -1 ? null : index;
    };
    const firstMatch = positions.findIndex((position) => position.step?.kind === "match" && position.step.eventKey === input.eventKey);
    const qualsDoneIndex = indexOf(`${input.eventKey}:qualsDone`) ?? nowIndex;
    const firstStep = positions.findIndex((position) => position.step?.eventKey === input.eventKey);
    const milestones = DISTRICT_MILESTONE_KEYS.map((key, index): DistrictMilestone => {
      const atId = milestoneAtId(key, input);
      const positionIndex = key === "schedule" ? (firstMatch === -1 ? null : firstMatch - 1) : indexOf(atId);
      return {
        eventKey: input.eventKey,
        eventName: input.eventName,
        key,
        index,
        atId,
        positionIndex,
        happened: milestoneHappened(key, input.state),
        order: positionIndex === null ? [qualsDoneIndex, index] : [positionIndex, key === "schedule" ? ORDER_TIE_SCHEDULE_RESOLVED : index],
      };
    });
    events.push({ input, status: districtMilestoneEventStatus(input.state), milestones, firstIndex: firstStep === -1 ? nowIndex : firstStep });
  }
  events.sort((a, b) => a.firstIndex - b.firstIndex || a.input.eventName.localeCompare(b.input.eventName));

  const happened = events
    .flatMap((event) => event.milestones.filter((milestone) => milestone.happened))
    .sort((a, b) => compareOrder(a.order, b.order) || (a.eventKey < b.eventKey ? -1 : a.eventKey > b.eventKey ? 1 : 0));
  const walk: DistrictMilestoneWalkItem[] = [
    { kind: "start" },
    ...happened.map((milestone) => ({ kind: "milestone" as const, milestone })),
    { kind: "live" },
  ];
  return { events, byEvent: new Map(events.map((event) => [event.input.eventKey, event])), walk, nowIndex };
}

/**
 * What the URL's `at` selects, in this order: Live for no `at` or `now`; Start
 * for `season-start`; a milestone whose id matches and which HAS happened, even
 * while its step is unresolved, so the pressed stop shows the reader's choice
 * at once; a position for any other id that resolves to a step (an old
 * non-milestone link, or a hand-edited link to a milestone that has not
 * happened), with no stop pressed; and Live for anything else, which matches the
 * resolver sending unknown ids to now.
 */
export function districtMilestoneSelection(
  model: DistrictMilestoneModel,
  timeline: DistrictTimeline,
  at: string | undefined,
  positionIndex: number
): DistrictMilestoneSelection {
  if (at === undefined || at === DISTRICT_TIMELINE_NOW_ID) return { kind: "live" };
  if (at === DISTRICT_TIMELINE_SEASON_START_ID) return { kind: "start" };
  for (const event of model.events) {
    const milestone = event.milestones.find((candidate) => candidate.happened && candidate.atId === at);
    if (milestone !== undefined) return { kind: "milestone", milestone };
  }
  if (positionIndex > 0 && positionIndex < timeline.nowIndex) {
    return { kind: "position", eventKey: timeline.positions[positionIndex]?.step?.eventKey ?? null, positionIndex };
  }
  return { kind: "live" };
}

/** The event key a selection carries, or `null` for Live and Start (which never move the event menu). */
export function selectionEventKey(selection: DistrictMilestoneSelection): string | null {
  if (selection.kind === "milestone") return selection.milestone.eventKey;
  if (selection.kind === "position") return selection.eventKey;
  return null;
}

function selectionKey(model: DistrictMilestoneModel, selection: DistrictMilestoneSelection): DistrictMilestoneOrder {
  if (selection.kind === "start") return [0, -1];
  if (selection.kind === "live") return [model.nowIndex, ORDER_TIE_LIVE];
  if (selection.kind === "milestone") return selection.milestone.order;
  return [selection.positionIndex, ORDER_TIE_POSITION];
}

function walkKey(model: DistrictMilestoneModel, item: DistrictMilestoneWalkItem): DistrictMilestoneOrder {
  return selectionKey(model, item);
}

/**
 * The event the menu opens on: the first live event in model order; failing
 * that, the started event that sorts last; failing that, the first event.
 */
export function defaultMilestoneFocus(model: DistrictMilestoneModel): string | undefined {
  const live = model.events.find((event) => event.status === "live");
  if (live !== undefined) return live.input.eventKey;
  const started = model.events.filter((event) => event.status !== "up");
  if (started.length > 0) return started[started.length - 1]!.input.eventKey;
  return model.events[0]?.input.eventKey;
}

/**
 * Where choosing an event in the menu navigates, as sketch Q's `focusEvent`:
 * the same stop in the chosen event when the selection is a milestone and that
 * stop has happened there; otherwise the chosen event's latest happened stop;
 * otherwise `null`, which moves the focus only.
 */
export function milestoneFocusTarget(model: DistrictMilestoneModel, eventKey: string, selection: DistrictMilestoneSelection): string | null {
  const event = model.byEvent.get(eventKey);
  if (event === undefined) return null;
  if (selection.kind === "milestone") {
    const same = event.milestones[selection.milestone.index];
    if (same !== undefined && same.happened) return same.atId;
  }
  for (let i = event.milestones.length - 1; i >= 0; i--) {
    if (event.milestones[i]!.happened) return event.milestones[i]!.atId;
  }
  return null;
}

function sameWalkItem(item: DistrictMilestoneWalkItem, selection: DistrictMilestoneSelection): boolean {
  if (item.kind === "milestone") {
    return selection.kind === "milestone" && item.milestone.eventKey === selection.milestone.eventKey && item.milestone.key === selection.milestone.key;
  }
  return item.kind === selection.kind;
}

/** The walk items either side of a selection. A position selection sits between the last item below it and the first above it. */
export function milestoneWalkNeighbours(
  model: DistrictMilestoneModel,
  selection: DistrictMilestoneSelection
): { prev: DistrictMilestoneWalkItem | undefined; next: DistrictMilestoneWalkItem | undefined } {
  const { walk } = model;
  if (selection.kind !== "position") {
    const index = walk.findIndex((item) => sameWalkItem(item, selection));
    if (index !== -1) return { prev: walk[index - 1], next: walk[index + 1] };
  }
  const key = selectionKey(model, selection);
  let prev: DistrictMilestoneWalkItem | undefined;
  let next: DistrictMilestoneWalkItem | undefined;
  for (const item of walk) {
    const delta = compareOrder(walkKey(model, item), key);
    if (delta < 0) prev = item;
    else if (delta > 0 && next === undefined) next = item;
  }
  return { prev, next };
}

export interface DistrictMilestoneStopStates {
  readonly happened: readonly boolean[];
  readonly done: readonly boolean[];
  readonly pressed: readonly boolean[];
  /** The last done stop, or -1 when the first stop is not done: sketch Q's `a[0].t <= t ? done / 8 : 0`. */
  readonly fillStop: number;
  /** The number of happened stops when the event is live, which is where the red now line sits; `null` otherwise. */
  readonly nowBoundary: number | null;
}

/** Every stop's state for one event at a selection. A stop is done when it has happened and sits at or before the selection. */
export function milestoneStopStates(model: DistrictMilestoneModel, eventKey: string | undefined, selection: DistrictMilestoneSelection): DistrictMilestoneStopStates {
  const event = eventKey === undefined ? undefined : model.byEvent.get(eventKey);
  if (event === undefined) {
    const none = DISTRICT_MILESTONE_KEYS.map(() => false);
    return { happened: none, done: none, pressed: none, fillStop: -1, nowBoundary: null };
  }
  const key = selectionKey(model, selection);
  const happened = event.milestones.map((milestone) => milestone.happened);
  const done = event.milestones.map((milestone) => milestone.happened && compareOrder(milestone.order, key) <= 0);
  const pressed = event.milestones.map(
    (milestone) => selection.kind === "milestone" && selection.milestone.eventKey === milestone.eventKey && selection.milestone.key === milestone.key
  );
  const fillStop = done[0] === true ? done.lastIndexOf(true) : -1;
  const nowBoundary = event.status === "live" ? happened.filter(Boolean).length : null;
  return { happened, done, pressed, fillStop, nowBoundary };
}
