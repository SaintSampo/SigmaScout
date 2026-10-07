/**
 * The district's INTERLEAVED timeline: every district-tier event's
 * qualification rows in one `sortTime` order, with four stage steps per event,
 * up to five playoff ROUND steps per event, plus the per-event stage at any
 * position.
 * The Locks milestone picker (`districtMilestones.ts`) exposes a handful of
 * these positions per event; the ledger itself still steps by match.
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
 *
 * ROUND STEPS (quick task 261007-3g2). FIRST's five playoff rounds
 * (`BRACKET_ROUNDS`) each get one step, anchored on the round's LAST PLAYED
 * row, so the Locks picker can stop between Alliances done and Finals. A round
 * step exists only for an event whose LOADED artifact publishes the
 * eight-alliance bracket and only once the round has a played row: an event
 * with no artifact, or an unstarted bracket, adds exactly the steps it did
 * before, and a divisioned DCMP parent (2 or 4 alliances, never this topology)
 * never gets one, so no bracket is ever fabricated. Playoff rows never become
 * `match` steps: every remaining-rows helper below counts qualification rows.
 */
import { BRACKET_REGISTERED_SEASONS, BRACKET_ROUNDS, bracketRoundOfSet, bracketSetIdFor } from "../../../../../packages/core/districts/bracket.js";
import { sortTimeToEpochMs } from "../../lib/liveEvent.js";
import { buildQualRows } from "../../lib/simulationInputs.js";
import type { EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { DISTRICT_CATEGORIES, type DistrictCategory, type DistrictStageFinality } from "./districtLedgerRows.js";

/** The kinds of step, in the order they occur within one event. The ordinal doubles as the within-instant tie-break. */
export const DISTRICT_STEP_KINDS = ["match", "qualsDone", "alliance", "round", "playoffs", "awards"] as const;

export type DistrictStepKind = (typeof DISTRICT_STEP_KINDS)[number];

/**
 * Which CATEGORY each stage step decides. A match step decides nothing on its own — qualification is decided by the quals-done step.
 * A round step decides nothing either: the playoff category closes at the Playoffs (Finals) step.
 */
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
  /** A round step's FIRST round number, 1 to 5 (`BRACKET_ROUNDS`). Absent on every other kind. */
  readonly round?: number;
  /** The step's published instant in epoch MILLISECONDS, through `sortTimeToEpochMs`. `null` when no row in this event carries one. */
  readonly sortMs: number | null;
  /**
   * THE ROW THIS STEP'S INSTANT IS TAKEN FROM (quick task 261005-5g0): a match
   * step's own row, a Quals done or Alliance selection step's last
   * qualification row, a round step's last played row among that round's sets
   * (quick task 261007-3g2; a round step exists only once it has one), a
   * Playoffs or Awards step's last played playoff row (or
   * the last qualification row where it fell back to that instant). A rewound
   * view cuts the as-of state at this row (`cutAtPosition`). `undefined` for
   * an event with no loaded artifact, or for a stage step placed after every
   * timed step because its playoffs have not been played.
   */
  readonly anchor: DistrictTimelineAnchor | undefined;
}

/** One step's anchor row: its match key, and whether that match has been played (folded) yet. */
export interface DistrictTimelineAnchor {
  readonly matchKey: string;
  readonly played: boolean;
}

/**
 * One timeline position. `positions[0]` is season start, `positions[last]` is
 * now, and everything between is a step — so a position is an index into ONE
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

export interface DistrictTimelineGaps {
  /** Events with no loaded artifact: they contribute their four stage steps but no match steps, so the timeline still spans the season honestly. */
  readonly eventsWithoutArtifact: readonly string[];
  /** Events with at least one qualification row carrying no published `sortTime` — those rows order by match key after the timed ones. */
  readonly eventsWithUntimedRows: readonly string[];
}

export interface DistrictTimeline {
  readonly positions: readonly DistrictTimelinePosition[];
  readonly nowIndex: number;
  readonly gaps: DistrictTimelineGaps;
  /**
   * Per event with a LOADED eight-alliance artifact: how many LEADING rounds
   * (Round 1, then Round 2, ...) have every set decided by a played row whose
   * winner is red or blue. A tie decides nothing; its replay does. The
   * milestone picker reads this for a live event's round stops, since only
   * a finished event's state block can say a round is over without an
   * artifact. An event without such an artifact has no entry.
   */
  readonly playoffRoundsDecided: ReadonlyMap<string, number>;
}

export interface BuildDistrictTimelineOptions {
  /**
   * The district's own district-tier events, in any order.
   *
   * `playoffsDone` is the event's own `state.playoffsDone` where the caller
   * has one. It decides only where an event's Playoffs and Awards steps sit
   * when its loaded artifact carries no played playoff row: `false` places
   * them after every timed step (the playoffs are still ahead), anything else
   * keeps the last qualification instant. See `buildDistrictTimeline`.
   */
  readonly events: readonly {
    readonly eventKey: string;
    readonly eventName: string;
    readonly week: number | null;
    readonly playoffsDone?: boolean;
  }[];
  readonly eventArtifacts: ReadonlyMap<string, EventArtifact>;
}

/**
 * The timeline's event list with each event's `playoffsDone` read from the
 * caller's state facts (the milestone picker's own per event list, which
 * already fills a missing state block from a later team). An event with no
 * state stays without the field.
 */
export function timelineEventsOf<T extends { readonly eventKey: string }>(
  events: readonly T[],
  states: readonly { readonly eventKey: string; readonly state: { readonly playoffsDone: boolean } | undefined }[]
): (T & { readonly playoffsDone?: boolean })[] {
  const byKey = new Map(states.map((entry) => [entry.eventKey, entry.state] as const));
  return events.map((event) => {
    const state = byKey.get(event.eventKey);
    return state === undefined ? event : { ...event, playoffsDone: state.playoffsDone };
  });
}

/**
 * The instant of a Playoffs or Awards step whose playoffs are still ahead:
 * after every timed step. Two such steps compare equal on it and fall through
 * to the week, event key and ordinal tie-breaks like any other equal instant.
 */
const PLAYOFFS_AHEAD_MS = Number.POSITIVE_INFINITY;

function stepOrdinal(kind: DistrictStepKind): number {
  return DISTRICT_STEP_KINDS.indexOf(kind);
}

/**
 * The id of one event's round step and of its Locks milestone:
 * `<eventKey>:round:<n>`. The ONE spelling; `districtMilestones.ts` builds the
 * milestone's `atId` through it so the two can never disagree. An id naming a
 * round the timeline holds no step for (round 6, or a round not played yet)
 * resolves to now like any unknown id.
 */
export function districtRoundMilestoneId(eventKey: string, round: number): string {
  return `${eventKey}:round:${String(round)}`;
}

function stepId(step: DistrictTimelineStep): string {
  if (step.kind === "match") return `${step.eventKey}:m:${step.matchKey ?? ""}`;
  if (step.kind === "round") return districtRoundMilestoneId(step.eventKey, step.round ?? 0);
  return `${step.eventKey}:${step.kind}`;
}

function stepLabel(step: DistrictTimelineStep): string {
  if (step.kind === "match") return `${step.eventName} ${step.matchKey ?? ""}`;
  if (step.kind === "qualsDone") return `${step.eventName} quals done`;
  if (step.kind === "alliance") return `${step.eventName} alliance selection`;
  if (step.kind === "round") return `${step.eventName} round ${String(step.round ?? 0)}`;
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
 * past a live WEEK 3 event's matches, so the end of week 1 landed near the end
 * of the season. A missing artifact must SHORTEN PRECISION, never reorder the
 * season.
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
  // Two rounds at one instant keep round order.
  const roundDelta = (a.round ?? 0) - (b.round ?? 0);
  if (roundDelta !== 0) return roundDelta;
  const aMatch = a.matchKey ?? "";
  const bMatch = b.matchKey ?? "";
  return aMatch < bMatch ? -1 : aMatch > bMatch ? 1 : 0;
}

export function buildDistrictTimeline(options: BuildDistrictTimelineOptions): DistrictTimeline {
  const { events, eventArtifacts } = options;
  const steps: DistrictTimelineStep[] = [];
  const eventsWithoutArtifact: string[] = [];
  const eventsWithUntimedRows: string[] = [];
  const playoffRoundsDecided = new Map<string, number>();

  for (const event of events) {
    const artifact = eventArtifacts.get(event.eventKey);
    let lastQualMs: number | null = null;
    let lastQual: DistrictTimelineAnchor | undefined;
    let playoffMs: number | null = null;
    let playoffAnchor: DistrictTimelineAnchor | undefined;
    if (artifact === undefined) {
      // An event whose artifact is NOT loaded still contributes its four stage
      // steps. Dropping it would silently shorten the timeline and misrepresent
      // where the season is.
      eventsWithoutArtifact.push(event.eventKey);
    } else {
      const rows = buildQualRows(artifact);
      let sawUntimed = false;
      for (const row of rows) {
        const sortMs = row.sortTime === undefined ? null : sortTimeToEpochMs(row.sortTime);
        if (sortMs === null) sawUntimed = true;
        // `>=`: of two rows at one instant, the later one in row order anchors.
        else if (lastQualMs === null || sortMs >= lastQualMs) {
          lastQualMs = sortMs;
          lastQual = { matchKey: row.matchKey, played: row.played };
        }
        steps.push({
          kind: "match",
          eventKey: event.eventKey,
          eventName: event.eventName,
          week: event.week,
          matchKey: row.matchKey,
          sortMs,
          anchor: { matchKey: row.matchKey, played: row.played },
        });
      }
      if (sawUntimed) eventsWithUntimedRows.push(event.eventKey);
      // THE LAST PLAYED PLAYOFF ROW. Every `matches[]` row is played; a row
      // with no published time cannot place a step and is skipped.
      for (const match of artifact.matches) {
        if (match.compLevel === "qm" || match.sortTime === undefined) continue;
        const sortMs = sortTimeToEpochMs(match.sortTime);
        if (playoffMs === null || sortMs >= playoffMs) {
          playoffMs = sortMs;
          playoffAnchor = { matchKey: match.matchKey, played: true };
        }
      }
      // ROUND STEPS, ONLY FOR THE EIGHT-ALLIANCE BRACKET (quick task
      // 261007-3g2). A divisioned DCMP parent publishes 2 or 4 alliances and
      // runs no `BRACKET_SETS` bracket, so reading its sf rows as rounds would
      // fabricate one, and so would a season before 2023, whose sf rows were a
      // different bracket. A round with no played, timed row gets no step at all.
      if (artifact.alliances?.length === 8 && BRACKET_REGISTERED_SEASONS.includes(artifact.season)) {
        const lastByRound = new Map<number, { sortMs: number; matchKey: string }>();
        const decidedSets = new Set<string>();
        for (const match of artifact.matches) {
          const setId = bracketSetIdFor(match.compLevel, match.setNumber);
          if (setId === undefined) continue;
          const round = bracketRoundOfSet(setId);
          if (round === undefined) continue;
          // A tie decides nothing; its replay, a later row of the same set, does.
          if (match.actualWinner === "red" || match.actualWinner === "blue") decidedSets.add(setId);
          if (match.sortTime === undefined) continue;
          const sortMs = sortTimeToEpochMs(match.sortTime);
          const prior = lastByRound.get(round);
          // `>=`: the same tie rule as the Playoffs anchor above.
          if (prior === undefined || sortMs >= prior.sortMs) lastByRound.set(round, { sortMs, matchKey: match.matchKey });
        }
        for (const [round, last] of lastByRound) {
          steps.push({
            kind: "round",
            eventKey: event.eventKey,
            eventName: event.eventName,
            week: event.week,
            matchKey: undefined,
            round,
            sortMs: last.sortMs,
            anchor: { matchKey: last.matchKey, played: true },
          });
        }
        let decidedRounds = 0;
        for (const setIds of BRACKET_ROUNDS) {
          if (!setIds.every((setId) => decidedSets.has(setId))) break;
          decidedRounds++;
        }
        playoffRoundsDecided.set(event.eventKey, decidedRounds);
      }
    }
    // WHERE THE STAGE STEPS SIT (quick task 261005-5g0). Quals done and
    // Alliance selection share the event's LAST QUALIFICATION instant, so they
    // sit immediately after its own matches while still interleaving correctly
    // with a later event's. Playoffs and Awards sit at the event's LAST PLAYED
    // PLAYOFF row: a stop is a cut in the as-of state, and with all four at the
    // last qualification instant a concurrent event's later matches still
    // counted as remaining at `E:awards` while E's playoff points were already
    // final, so that stop had no one instant to rebuild the model at.
    //
    // With no played playoff row, an event whose playoffs are still ahead
    // (`playoffsDone === false`) places both after every timed step, so no stop
    // reads its playoff points as final before they are played. Otherwise (an
    // artifact that records no playoff row, or a caller with no state) both
    // fall back to the last qualification instant.
    const playoffsAhead = artifact !== undefined && playoffMs === null && event.playoffsDone === false;
    const late: { sortMs: number | null; anchor: DistrictTimelineAnchor | undefined } =
      playoffMs !== null
        ? { sortMs: playoffMs, anchor: playoffAnchor }
        : playoffsAhead
          ? { sortMs: PLAYOFFS_AHEAD_MS, anchor: undefined }
          : { sortMs: lastQualMs, anchor: lastQual };
    for (const kind of ["qualsDone", "alliance", "playoffs", "awards"] as const) {
      const placement = kind === "qualsDone" || kind === "alliance" ? { sortMs: lastQualMs, anchor: lastQual } : late;
      steps.push({
        kind,
        eventKey: event.eventKey,
        eventName: event.eventName,
        week: event.week,
        matchKey: undefined,
        sortMs: placement.sortMs,
        anchor: placement.anchor,
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

  return {
    positions,
    nowIndex,
    gaps: { eventsWithoutArtifact: [...eventsWithoutArtifact].sort(), eventsWithUntimedRows: [...eventsWithUntimedRows].sort() },
    playoffRoundsDecided,
  };
}

/** The suffix of the Schedule milestone's alias id. No step id ends in it, so the alias can never shadow a real step. */
const SCHEDULE_ALIAS_SUFFIX = ":schedule";

/**
 * The id the Locks milestone picker stores in `?at=` for one event's Schedule
 * stop: `<eventKey>:schedule`, an ALIAS rather than a step id. See
 * `resolveDistrictTimelinePosition` for how it resolves and why it exists.
 */
export function districtScheduleMilestoneId(eventKey: string): string {
  return `${eventKey}${SCHEDULE_ALIAS_SUFFIX}`;
}

/**
 * Resolves an arbitrary string to a position index, or to the "now" index.
 *
 * A HAND-EDITED OR STALE ID RESOLVES TO NOW, never to a neighbouring step: a
 * neighbour would render a position the reader did not ask for while the URL
 * claimed otherwise.
 *
 * AN EXACT POSITION ID ALWAYS WINS FIRST, so no existing id changes meaning.
 * After that, `<eventKey>:schedule` resolves to the position just before that
 * event's FIRST match step. Schedule needs its own alias because that position
 * is some OTHER step (another event's match, or season start), so storing its
 * id would reopen a shared Schedule link as a different event, and it cannot be
 * computed at all while the event's own artifact is not loaded. An alias whose
 * event has no match step in the timeline falls under the rule above and
 * resolves to now, exactly as a match step id does while artifacts load.
 */
export function resolveDistrictTimelinePosition(timeline: DistrictTimeline, id: string | undefined): number {
  if (id === undefined) return timeline.nowIndex;
  const index = timeline.positions.findIndex((position) => position.id === id);
  if (index !== -1) return index;
  if (id.endsWith(SCHEDULE_ALIAS_SUFFIX)) {
    const eventKey = id.slice(0, -SCHEDULE_ALIAS_SUFFIX.length);
    const firstMatch = timeline.positions.findIndex((position) => position.step?.kind === "match" && position.step.eventKey === eventKey);
    if (firstMatch !== -1) return firstMatch - 1;
  }
  return timeline.nowIndex;
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
  // A CATEGORY OPEN AT "NOW" IS NEVER FINAL AT AN EARLIER STOP. The steps
  // above place an event's Playoffs and Awards at its last PLAYED playoff row,
  // which for a bracket still in progress (or finished, with awards not yet
  // posted) is not where the category closes: every stop after that row would
  // read the event's partial playoff points or zero award points as final,
  // more settled than the live view. Intersecting with the live answer keeps
  // a rewound stop at most as settled as now.
  const out = new Map<string, DistrictStageFinality>();
  for (const [eventKey, record] of final) {
    const now = nowStageByEvent.get(eventKey);
    if (now !== undefined) for (const category of DISTRICT_CATEGORIES) record[category] = record[category] && now[category];
    out.set(eventKey, { ...record });
  }
  return out;
}

/**
 * The as-of cut a position names (quick task 261005-5g0): the season start, or
 * the row its step is anchored on (`DistrictTimelineStep.anchor`) with the
 * event it belongs to. The row's `[t, i]` is not known here: it comes from that
 * event's INDEX `m` list, which `asOfRewind.ts` reads.
 *
 * `stage` is true for a stage step, whose cut also takes every later row of the
 * same event at the same instant (`asOfRewind.ts`), so a stage final at the stop
 * never leaves one of its own rows after the cut.
 *
 * `null` for a position with no anchor of its own: an event with no loaded
 * artifact, or a step placed after every timed step. The caller walks back to
 * the nearest earlier position that has one.
 */
export type DistrictTimelineCut =
  | { readonly kind: "seasonStart" }
  | { readonly kind: "row"; readonly eventKey: string; readonly matchKey: string; readonly played: boolean; readonly stage: boolean };

export function cutAtPosition(timeline: DistrictTimeline, positionIndex: number): DistrictTimelineCut | null {
  if (positionIndex <= 0) return { kind: "seasonStart" };
  const step = timeline.positions[positionIndex]?.step;
  if (step === undefined || step.anchor === undefined) return null;
  return { kind: "row", eventKey: step.eventKey, matchKey: step.anchor.matchKey, played: step.anchor.played, stage: step.kind !== "match" };
}

/** The position index of one event's first match step, or -1 when the timeline holds none. */
export function firstMatchPositionIndex(timeline: DistrictTimeline, eventKey: string): number {
  return timeline.positions.findIndex((position) => position.step?.kind === "match" && position.step.eventKey === eventKey);
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
 *
 * Since quick task 261005-5g0 no tab reads this or `remainingQualRowsAtPosition`
 * (a rewound stop splits rows at its as-of cut, `asOfRewind.ts`); only
 * `scripts/measureChampCutoff.ts`, which measures the retired stored odds
 * rewind, and tests do.
 */
export function startMatchKeyAtPosition(timeline: DistrictTimeline, positionIndex: number, eventKey: string): string | null {
  return remainingQualRowsAtPosition(timeline, positionIndex, eventKey)[0] ?? null;
}

/**
 * Whether one event has STARTED at a position: whether any of its own steps
 * sits at or before the position.
 *
 * FOR A REWOUND POSITION ONLY. At the live index the honest answer is the
 * artifact's own `state` block, not this rail: the tab fetches an artifact
 * only for an event that is in progress, so a FINISHED event contributes no
 * steps at all at "now" and this function would read it as unstarted. A
 * caller at the live position must read `deriveStageFromState(...).started`
 * instead, exactly as `champLedgerRows.ts`'s own "now" helper does.
 *
 * The Champ Locks tab reads this for one question: whether the District
 * Championship field is a fact yet at the position the ledger is at
 * (quick task 260925-xab).
 */
export function eventStartedAtPosition(timeline: DistrictTimeline, positionIndex: number, eventKey: string): boolean {
  const last = Math.min(positionIndex, timeline.positions.length - 1);
  for (let i = 1; i <= last; i++) {
    if (timeline.positions[i]?.step?.eventKey === eventKey) return true;
  }
  return false;
}

/** Every district-tier event with at least one OPEN category at a position — the superset the fetch and simulation gates narrow from. */
export function eventsWithOpenCategoriesAt(stageByEvent: ReadonlyMap<string, DistrictStageFinality>): string[] {
  const out: string[] = [];
  for (const [eventKey, final] of stageByEvent) {
    if (DISTRICT_CATEGORIES.some((category) => !final[category])) out.push(eventKey);
  }
  return out.sort();
}
