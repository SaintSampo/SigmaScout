/**
 * The district's INTERLEAVED timeline: every district-tier event's
 * qualification rows in one `sortTime` order, with four stage steps after each
 * event's last qualification row, plus the derived jump chips and the per-event
 * stage at any position.
 *
 * One pure module, no React.
 *
 * STEPS BY MATCH, NOT BY WEEK. The sketch's week granularity is explicitly a
 * simplification for the sketch's own size; CONTEXT is explicit that the real
 * page steps by match across the district's interleaved timeline sorted by
 * `sortTime`, with alliance selection, playoffs and awards as stages after each
 * event's last qualification match.
 *
 * ORDER IS `sortTime`, THEN EVENT KEY, THEN MATCH KEY, and all three are
 * needed: two events genuinely can have matches at the same instant, and a
 * stable total order is what makes a step id shareable.
 *
 * A POSITION IS A STEP THAT HAS ALREADY HAPPENED. Being at step S means S is
 * done and everything after it is not, so a category is FINAL at S exactly when
 * its own stage step sits at or before S, and the remaining qualification rows
 * are the ones strictly after S. Rewinding into a finished event therefore
 * reopens its later categories BY CONSTRUCTION rather than by a special case.
 *
 * THE STEP ID SET IS DATA-DEPENDENT, which is exactly why `searchParams.ts`
 * types the rewind param as a plain string with a runtime resolver — the same
 * reason that module's own header gives for typing `sort` that way. An
 * unrecognised id resolves to the "now" position rather than to a neighbouring
 * step.
 */
import { sortTimeToEpochMs } from "../../lib/liveEvent.js";
import { buildQualRows } from "../../lib/simulationInputs.js";
import type { EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { DISTRICT_CATEGORIES, type DistrictCategory, type DistrictStageFinality } from "./districtLedgerRows.js";

/** The kinds of step, in the order they occur within one event. The ordinal doubles as the within-instant tie-break. */
export const DISTRICT_STEP_KINDS = ["match", "qualsDone", "alliance", "playoffs", "awards"] as const;

export type DistrictStepKind = (typeof DISTRICT_STEP_KINDS)[number];

/** Which CATEGORY each stage step decides. A match step decides nothing on its own — qualification is decided by the quals-done step. */
const CATEGORY_BY_STEP_KIND: Partial<Record<DistrictStepKind, DistrictCategory>> = {
  qualsDone: "qual",
  alliance: "alliance",
  playoffs: "elim",
  awards: "award",
};

/** The reserved id of the position before anything has happened. */
export const DISTRICT_TIMELINE_SEASON_START_ID = "season-start";

/** The reserved id of the live "now" position — the artifact's own `state` blocks, not a step. */
export const DISTRICT_TIMELINE_NOW_ID = "now";

export interface DistrictTimelineStep {
  readonly kind: DistrictStepKind;
  readonly eventKey: string;
  readonly eventName: string;
  readonly week: number | null;
  readonly matchKey: string | undefined;
  /** The step's published instant in epoch MILLISECONDS, through `sortTimeToEpochMs`. `null` when no row in this event carries one. */
  readonly sortMs: number | null;
}

/**
 * One slider position. `positions[0]` is season start, `positions[last]` is
 * now, and everything between is a step — so the slider is an index into ONE
 * array rather than a step id plus two special cases.
 */
export interface DistrictTimelinePosition {
  /** A stable, self-describing id built from the event key and either the match key or the stage name. */
  readonly id: string;
  readonly label: string;
  readonly week: number | null;
  /** `undefined` for the two reserved positions. */
  readonly step: DistrictTimelineStep | undefined;
}

/** A derived jump chip. Never a hardcoded week list — the sketch's eight chips are its own fixture's shape. */
export interface DistrictTimelineChip {
  readonly id: string;
  readonly label: string;
  readonly positionIndex: number;
}

export interface DistrictTimelineGaps {
  /** Events with no loaded artifact: they contribute their four stage steps but no match steps, so the slider still spans the season honestly. */
  readonly eventsWithoutArtifact: readonly string[];
  /** Events with at least one qualification row carrying no published `sortTime` — those rows order by match key after the timed ones. */
  readonly eventsWithUntimedRows: readonly string[];
}

export interface DistrictTimeline {
  readonly positions: readonly DistrictTimelinePosition[];
  readonly chips: readonly DistrictTimelineChip[];
  readonly nowIndex: number;
  readonly gaps: DistrictTimelineGaps;
}

export interface BuildDistrictTimelineOptions {
  /** The district's own district-tier events, in any order. */
  readonly events: readonly { readonly eventKey: string; readonly eventName: string; readonly week: number | null }[];
  readonly eventArtifacts: ReadonlyMap<string, EventArtifact>;
}

function stepOrdinal(kind: DistrictStepKind): number {
  return DISTRICT_STEP_KINDS.indexOf(kind);
}

function stepId(step: DistrictTimelineStep): string {
  return step.kind === "match" ? `${step.eventKey}:m:${step.matchKey ?? ""}` : `${step.eventKey}:${step.kind}`;
}

function stepLabel(step: DistrictTimelineStep): string {
  if (step.kind === "match") return `${step.eventName} ${step.matchKey ?? ""}`;
  if (step.kind === "qualsDone") return `${step.eventName} quals done`;
  if (step.kind === "alliance") return `${step.eventName} alliance selection`;
  if (step.kind === "playoffs") return `${step.eventName} playoffs`;
  return `${step.eventName} awards`;
}

/** Week ordering, a null week last. Returns 0 when the two weeks are equal, including two nulls. */
function compareWeeks(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/**
 * THE WEEK DECIDES FIRST WHENEVER EITHER SIDE IS UNTIMED, and only then does
 * an untimed step fall behind a timed one.
 *
 * WHY THAT ORDER AND NOT THE OTHER. `sortMs` is `null` for an event whose
 * artifact has not loaded — which is the ordinary FIRST-PAINT state, since the
 * event list is the fetch set — and for a qualification row TBA published no
 * time for. A blanket "every untimed step after every timed one" therefore
 * pushed a finished WEEK 1 event's alliance-selection, playoff and awards steps
 * past a live WEEK 3 event's matches, and the derived chips inherited it:
 * `lastIndexByWeek` takes the highest index carrying each week, so "After week
 * 1" jumped to near the end of the slider. A missing artifact must SHORTEN
 * PRECISION, never reorder the season.
 *
 * Within one week the old rule still holds — an untimed step sorts after the
 * timed ones rather than at the epoch, so it never jumps to the front.
 *
 * Two timed steps are still compared by instant alone, so nothing about the
 * interleaving of two loaded events changes.
 */
function compareSteps(a: DistrictTimelineStep, b: DistrictTimelineStep): number {
  const aTimed = a.sortMs !== null;
  const bTimed = b.sortMs !== null;

  if (aTimed && bTimed) {
    if (a.sortMs !== b.sortMs) return a.sortMs! - b.sortMs!;
  } else {
    const weekDelta = compareWeeks(a.week, b.week);
    if (weekDelta !== 0) return weekDelta;
    if (aTimed !== bTimed) return aTimed ? -1 : 1;
  }

  const weekDelta = compareWeeks(a.week, b.week);
  if (weekDelta !== 0) return weekDelta;
  if (a.eventKey !== b.eventKey) return a.eventKey < b.eventKey ? -1 : 1;
  const ordinalDelta = stepOrdinal(a.kind) - stepOrdinal(b.kind);
  if (ordinalDelta !== 0) return ordinalDelta;
  const aMatch = a.matchKey ?? "";
  const bMatch = b.matchKey ?? "";
  return aMatch < bMatch ? -1 : aMatch > bMatch ? 1 : 0;
}

export function buildDistrictTimeline(options: BuildDistrictTimelineOptions): DistrictTimeline {
  const { events, eventArtifacts } = options;
  const steps: DistrictTimelineStep[] = [];
  const eventsWithoutArtifact: string[] = [];
  const eventsWithUntimedRows: string[] = [];

  for (const event of events) {
    const artifact = eventArtifacts.get(event.eventKey);
    let lastQualMs: number | null = null;
    if (artifact === undefined) {
      // An event whose artifact is NOT loaded still contributes its four stage
      // steps. Dropping it would silently shorten the slider and misrepresent
      // where the season is.
      eventsWithoutArtifact.push(event.eventKey);
    } else {
      const rows = buildQualRows(artifact);
      let sawUntimed = false;
      for (const row of rows) {
        const sortMs = row.sortTime === undefined ? null : sortTimeToEpochMs(row.sortTime);
        if (sortMs === null) sawUntimed = true;
        else if (lastQualMs === null || sortMs > lastQualMs) lastQualMs = sortMs;
        steps.push({
          kind: "match",
          eventKey: event.eventKey,
          eventName: event.eventName,
          week: event.week,
          matchKey: row.matchKey,
          sortMs,
        });
      }
      if (sawUntimed) eventsWithUntimedRows.push(event.eventKey);
    }
    for (const kind of ["qualsDone", "alliance", "playoffs", "awards"] as const) {
      steps.push({
        kind,
        eventKey: event.eventKey,
        eventName: event.eventName,
        week: event.week,
        matchKey: undefined,
        // The stage steps share the event's LAST qualification instant, so they
        // sit immediately after that event's own matches while still
        // interleaving correctly with a later event's.
        sortMs: lastQualMs,
      });
    }
  }

  steps.sort(compareSteps);

  const positions: DistrictTimelinePosition[] = [
    { id: DISTRICT_TIMELINE_SEASON_START_ID, label: "Season start", week: null, step: undefined },
    ...steps.map((step) => ({ id: stepId(step), label: stepLabel(step), week: step.week, step })),
    { id: DISTRICT_TIMELINE_NOW_ID, label: "Now", week: null, step: undefined },
  ];
  const nowIndex = positions.length - 1;

  // The chips are DERIVED: season start, one after each distinct week present,
  // and now.
  const chips: DistrictTimelineChip[] = [{ id: DISTRICT_TIMELINE_SEASON_START_ID, label: "Season start", positionIndex: 0 }];
  const lastIndexByWeek = new Map<number, number>();
  positions.forEach((position, index) => {
    if (position.step === undefined || position.week === null) return;
    lastIndexByWeek.set(position.week, index);
  });
  for (const week of [...lastIndexByWeek.keys()].sort((a, b) => a - b)) {
    // TBA weeks are zero indexed; the site prints them one based everywhere
    // (`Week ${week + 1}` in EventHeader and the events list). The id keeps the
    // raw week so a shared URL never shifts.
    chips.push({ id: `week-${String(week)}`, label: `After week ${String(week + 1)}`, positionIndex: lastIndexByWeek.get(week)! });
  }
  chips.push({ id: DISTRICT_TIMELINE_NOW_ID, label: "Now", positionIndex: nowIndex });

  return {
    positions,
    chips,
    nowIndex,
    gaps: { eventsWithoutArtifact: [...eventsWithoutArtifact].sort(), eventsWithUntimedRows: [...eventsWithUntimedRows].sort() },
  };
}

/**
 * Resolves an arbitrary string to a position index, or to the "now" index.
 *
 * A HAND-EDITED OR STALE ID RESOLVES TO NOW, never to a neighbouring step: a
 * neighbour would render a position the reader did not ask for while the URL
 * claimed otherwise.
 */
export function resolveDistrictTimelinePosition(timeline: DistrictTimeline, id: string | undefined): number {
  if (id === undefined) return timeline.nowIndex;
  const index = timeline.positions.findIndex((position) => position.id === id);
  return index === -1 ? timeline.nowIndex : index;
}

/**
 * The per-event category finality at a position.
 *
 * At the "now" index this returns `nowStageByEvent` UNCHANGED — the artifact's
 * own `state` blocks — so the timeline reduces to the state block's answer
 * exactly, which a test asserts rather than a comment claiming it.
 */
export function districtStageAtPosition(
  timeline: DistrictTimeline,
  positionIndex: number,
  nowStageByEvent: ReadonlyMap<string, DistrictStageFinality>
): Map<string, DistrictStageFinality> {
  if (positionIndex >= timeline.nowIndex) return new Map(nowStageByEvent);

  const final = new Map<string, Record<DistrictCategory, boolean>>();
  for (const eventKey of nowStageByEvent.keys()) {
    final.set(eventKey, { qual: false, alliance: false, elim: false, award: false });
  }
  for (let i = 1; i <= positionIndex; i++) {
    const step = timeline.positions[i]?.step;
    if (step === undefined) continue;
    const category = CATEGORY_BY_STEP_KIND[step.kind];
    if (category === undefined) continue;
    let record = final.get(step.eventKey);
    if (record === undefined) {
      record = { qual: false, alliance: false, elim: false, award: false };
      final.set(step.eventKey, record);
    }
    record[category] = true;
  }
  const out = new Map<string, DistrictStageFinality>();
  for (const [eventKey, record] of final) out.set(eventKey, { ...record });
  return out;
}

/** How many of one event's qualification rows lie STRICTLY AFTER a position — the rows the rewind hands back as remaining. */
export function remainingQualRowsAtPosition(timeline: DistrictTimeline, positionIndex: number, eventKey: string): string[] {
  const out: string[] = [];
  for (let i = Math.max(positionIndex + 1, 1); i < timeline.nowIndex; i++) {
    const step = timeline.positions[i]?.step;
    if (step === undefined || step.kind !== "match" || step.eventKey !== eventKey) continue;
    if (step.matchKey !== undefined) out.push(step.matchKey);
  }
  return out;
}

/**
 * The start match key one event's rewound simulation input takes at a position:
 * the FIRST qualification row strictly after it, or `null` when qualification
 * is already finished there.
 *
 * `null` is 10-04's own expression of a finished qualification stage — ZERO
 * remaining matches, never a fifth flag.
 */
export function startMatchKeyAtPosition(timeline: DistrictTimeline, positionIndex: number, eventKey: string): string | null {
  return remainingQualRowsAtPosition(timeline, positionIndex, eventKey)[0] ?? null;
}

/** Every district-tier event with at least one OPEN category at a position — the superset the fetch and simulation gates narrow from. */
export function eventsWithOpenCategoriesAt(stageByEvent: ReadonlyMap<string, DistrictStageFinality>): string[] {
  const out: string[] = [];
  for (const [eventKey, final] of stageByEvent) {
    if (DISTRICT_CATEGORIES.some((category) => !final[category])) out.push(eventKey);
  }
  return out.sort();
}
