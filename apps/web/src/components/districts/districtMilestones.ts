/**
 * The Locks milestone picker's pure model (sketch 024 variant Q): the thirteen
 * milestones of every event, which of them have happened, what the URL's `at`
 * selects, which stops read as done at that selection, the walk the arrows
 * follow, and which event the event menu focuses.
 *
 * THIRTEEN STOPS (quick task 261007-3g2): Schedule, three quartiles, Quals
 * done, Alliances done, FIRST's five playoff rounds (Round 1 to Round 5), Finals
 * and Awards. Sketch 024 Q's nine stop design with its Playoffs half stop is
 * superseded by the five rounds; Finals is the old Playoffs stop renamed, with
 * the same `playoffsDone` fact and the same `<eventKey>:playoffs` id, so every
 * shared link keeps working.
 *
 * One pure module, no React.
 *
 * THREE DECISIONS SHAPE IT:
 *
 * 1. HAPPENED READS THE STATE BLOCKS, NOT THE TIMELINE. Every event contributes
 *    its four stage steps to the timeline whether or not it has started, and a
 *    future event's stage steps sort BEFORE the now position. "Its position
 *    exists and sits before now" would therefore call a future event's Awards
 *    happened. The artifact's own state facts are the only honest answer. A
 *    ROUND reads the state block (a finished bracket played every round) or the
 *    loaded artifact's own decided rows (`DistrictTimeline.playoffRoundsDecided`,
 *    a live bracket), never a step's position.
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
import { BRACKET_REGISTERED_SEASONS } from "../../../../../packages/core/districts/bracket.js";
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
  districtRoundMilestoneId,
  districtScheduleMilestoneId,
  type DistrictTimeline,
} from "./districtTimeline.js";

/**
 * The thirteen milestones of one event, in order (quick task 261007-3g2).
 * `playoffs` is the Finals stop: the old Playoffs stop renamed, key and id kept.
 */
export const DISTRICT_MILESTONE_KEYS = [
  "schedule",
  "q1",
  "q2",
  "q3",
  "qualsDone",
  "alliance",
  "round1",
  "round2",
  "round3",
  "round4",
  "round5",
  "playoffs",
  "awards",
] as const;

export type DistrictMilestoneKey = (typeof DISTRICT_MILESTONE_KEYS)[number];

/** The share of qualification each quartile stop marks. */
export const DISTRICT_MILESTONE_QUAL_FRACTIONS = { q1: 0.25, q2: 0.5, q3: 0.75 } as const;

/** The FIRST round number each round stop marks (`BRACKET_ROUNDS` in `packages/core/districts/bracket.ts`). */
export const DISTRICT_MILESTONE_ROUNDS = { round1: 1, round2: 2, round3: 3, round4: 4, round5: 5 } as const;

type DistrictRoundMilestoneKey = keyof typeof DISTRICT_MILESTONE_ROUNDS;

function isRoundKey(key: DistrictMilestoneKey): key is DistrictRoundMilestoneKey {
  return key in DISTRICT_MILESTONE_ROUNDS;
}

/** One event as the picker needs to see it. */
export interface DistrictMilestoneEventInput {
  readonly eventKey: string;
  readonly eventName: string;
  readonly week: number | null;
  readonly isDcmp: boolean;
  readonly state: DistrictEventStateFacts | undefined;
  /**
   * Whether the event's season plays the eight alliance double elimination
   * bracket the round stops name (2023 and later, `BRACKET_REGISTERED_SEASONS`).
   * `false` means no round stop ever happens: an earlier season's bracket had
   * no such rounds, and naming them would fabricate one. `districtMilestoneEvents`
   * always sets it; absent reads as true.
   */
  readonly playoffRounds?: boolean;
}

/**
 * The district's events at the given tiers, one entry per event key, from every
 * team's `tierEvents` union. The first entry seen wins, except that a missing
 * state block is filled from a later team that carries one.
 */
export function districtMilestoneEvents(artifact: DistrictArtifact, tiers: readonly DistrictTier[]): DistrictMilestoneEventInput[] {
  const byKey = new Map<string, DistrictMilestoneEventInput>();
  const playoffRounds = BRACKET_REGISTERED_SEASONS.includes(artifact.year);
  for (const tier of tiers) {
    for (const team of artifact.teams) {
      for (const entry of tierEvents(team, tier)) {
        const existing = byKey.get(entry.eventKey);
        if (existing === undefined) {
          byKey.set(entry.eventKey, {
            eventKey: entry.eventKey,
            eventName: entry.eventName,
            week: entry.week,
            isDcmp: tier === "dcmp",
            state: entry.state,
            playoffRounds,
          });
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
 * THE TIE-BREAKS ABOVE THE STOP INDEXES (0 to 12), in walk order at one
 * position: a RESOLVED Schedule stop, then a bare position selection, then
 * Live. Derived from the key count, so they always sit above every stop index:
 * the old literals 8, 9 and 10 collide with the Round 3, 4 and 5 indexes once
 * there are thirteen stops (quick task 261007-3g2).
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
const ORDER_TIE_SCHEDULE_RESOLVED = DISTRICT_MILESTONE_KEYS.length;
const ORDER_TIE_POSITION = DISTRICT_MILESTONE_KEYS.length + 1;
const ORDER_TIE_LIVE = DISTRICT_MILESTONE_KEYS.length + 2;

export interface DistrictMilestone {
  readonly eventKey: string;
  readonly eventName: string;
  readonly key: DistrictMilestoneKey;
  /** 0 to 12, the stop's column. */
  readonly index: number;
  /** What `?at=` stores for this stop. */
  readonly atId: string;
  /** The stop's position in the current timeline, or `null` when its step is not in it (its event's artifact is not loaded). */
  readonly positionIndex: number | null;
  readonly happened: boolean;
  /**
   * `[positionIndex, index]` when resolved (a resolved Schedule takes `ORDER_TIE_SCHEDULE_RESOLVED`, after every stop at that position).
   * Unresolved: `[the event's quals done position, index]`, so the stop sorts just before its own Quals Done; an unresolved ROUND stop
   * takes `[the event's Finals position, index]` instead, so it sorts after Alliances done and before Finals.
   */
  readonly order: DistrictMilestoneOrder;
}

export interface DistrictMilestoneEvent {
  readonly input: DistrictMilestoneEventInput;
  readonly status: DistrictMilestoneEventStatus;
  /** Always thirteen, in `DISTRICT_MILESTONE_KEYS` order. */
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

/**
 * Whether one stop has happened. `roundsDecided` is the event's leading decided
 * round count from its loaded artifact (0 without one).
 *
 * A ROUND has happened when the state block exists and either the bracket is
 * finished (`playoffsDone`) on an event with its own qualification schedule, or
 * the loaded artifact decides every set of that round and every round before
 * it. The `qualMatchesTotal` guard keeps a divisioned DCMP parent out: it has
 * no qualification schedule of its own (measured), runs a 2 or 4 alliance
 * bracket rather than this one, and so never gets a round stop. Every other
 * finished event keeps decision 2 above: every stop solid at Live with no
 * artifact loaded.
 */
function milestoneHappened(
  key: DistrictMilestoneKey,
  state: DistrictEventStateFacts | undefined,
  roundsDecided: number,
  playoffRounds: boolean
): boolean {
  if (state === undefined) return false;
  if (isRoundKey(key)) {
    if (!playoffRounds) return false;
    return (state.playoffsDone && state.qualMatchesTotal !== null) || roundsDecided >= DISTRICT_MILESTONE_ROUNDS[key];
  }
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
  if (isRoundKey(key)) return districtRoundMilestoneId(eventKey, DISTRICT_MILESTONE_ROUNDS[key]);
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
    const finalsIndex = indexOf(`${input.eventKey}:playoffs`) ?? nowIndex;
    const firstStep = positions.findIndex((position) => position.step?.eventKey === input.eventKey);
    const roundsDecided = timeline.playoffRoundsDecided.get(input.eventKey) ?? 0;
    const playoffRounds = input.playoffRounds !== false;
    const milestones = DISTRICT_MILESTONE_KEYS.map((key, index): DistrictMilestone => {
      const atId = milestoneAtId(key, input);
      const positionIndex = key === "schedule" ? (firstMatch === -1 ? null : firstMatch - 1) : indexOf(atId);
      // An unresolved round stop sorts after Alliances done and before Finals:
      // the quals done fallback the other stops use would put it before Alliances.
      const unresolvedAt = isRoundKey(key) ? finalsIndex : qualsDoneIndex;
      return {
        eventKey: input.eventKey,
        eventName: input.eventName,
        key,
        index,
        atId,
        positionIndex,
        happened: milestoneHappened(key, input.state, roundsDecided, playoffRounds),
        order: positionIndex === null ? [unresolvedAt, index] : [positionIndex, key === "schedule" ? ORDER_TIE_SCHEDULE_RESOLVED : index],
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

/** The event a milestone or position selection carries, or `null` for Live and Start. */
function selectionEventKey(selection: DistrictMilestoneSelection): string | null {
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

/**
 * The event the menu shows at Live: the first live event in model order;
 * failing that, the started event that sorts last; failing that, the first event.
 */
export function defaultMilestoneFocus(model: DistrictMilestoneModel): string | undefined {
  const live = model.events.find((event) => event.status === "live");
  if (live !== undefined) return live.input.eventKey;
  const started = model.events.filter((event) => event.status !== "up");
  if (started.length > 0) return started[started.length - 1]!.input.eventKey;
  return model.events[0]?.input.eventKey;
}

/**
 * The event the menu shows at a selection, computed on every render (quick task
 * 261007-3ik). Three cases: a milestone or position selection shows its own
 * event when the model knows it; Season start shows the event of the first
 * milestone in the walk, the one its Next text names; Live, a position with no
 * known event, and a Season start with nothing happened yet show
 * `defaultMilestoneFocus`.
 *
 * Sketch 024 left the menu where it was on Season start and Live. On a finished
 * district that left the menu on the last event while every dot hollowed and
 * the Next text named the first one, which Jacob reported on 2026-10-07 as "the
 * event does not update". Deriving the menu from the selection is what makes
 * Season start and Live move it.
 */
export function milestoneFocusKey(model: DistrictMilestoneModel, selection: DistrictMilestoneSelection): string | undefined {
  const own = selectionEventKey(selection);
  if (own !== null && model.byEvent.has(own)) return own;
  if (selection.kind === "start") {
    const first = model.walk.find((item) => item.kind === "milestone");
    if (first?.kind === "milestone") return first.milestone.eventKey;
  }
  return defaultMilestoneFocus(model);
}

/**
 * Where choosing an event in the menu navigates, as sketch Q's `focusEvent`:
 * the same stop in the chosen event when the selection is a milestone and that
 * stop has happened there; otherwise the chosen event's latest happened stop;
 * otherwise `null`. The menu is derived from the selection (`milestoneFocusKey`),
 * so a null target means the picker does nothing and the menu stays where the
 * selection puts it.
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
    const delta = compareOrder(selectionKey(model, item), key);
    if (delta < 0) prev = item;
    else if (delta > 0 && next === undefined) next = item;
  }
  return { prev, next };
}

export interface DistrictMilestoneStopStates {
  readonly happened: readonly boolean[];
  readonly done: readonly boolean[];
  readonly pressed: readonly boolean[];
  /** The last done stop, or -1 when the first stop is not done: sketch Q's `a[0].t <= t ? done / 8 : 0`, now over the thirteen stops (the picker divides by the key count less one). */
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
