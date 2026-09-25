/**
 * How many DCMP points slots are held back for Impact awards that have not
 * been handed out yet. Pure, no I/O, no zod, no React — so the browser's
 * status module and the harness's verdict pass call the SAME rule rather than
 * two derivations that can drift.
 *
 * ---------------------------------------------------------------------------
 * WHY A RESERVATION EXISTS AT ALL
 * ---------------------------------------------------------------------------
 *
 * The Impact award at a district event consumes a full DCMP slot. `locks.ts`'s
 * `qualifierPool` subtracts one slot per award-qualified team, which is right
 * once the award is POSTED and wrong before it: until then the slot sits back
 * in the points pool and the lock math is one slot too generous. Quick task
 * 260925-ma5 measured that gap over 921,658 team-positions and found it
 * breaking Jacob's first tenet — "no team that is ever displayed as Locked
 * should ever fail to qualify on points" — thirteen times, every one at a
 * position where an event's playoffs were decided but its Impact award was not
 * yet posted. `2025fnc` `frc3229`: `threatCount 34 < pointsSlots 35` reported
 * `locked`, and one step later the award posted, `pointsSlots` dropped to 34
 * and the same team was `eliminated`.
 *
 * So one slot is HELD BACK for every district-tier event whose Impact award is
 * still to come. This is the reservation the Liatys and Papa white paper
 * applies up front (`N = spots - events`), narrowed to the events that can
 * still award one.
 *
 * ---------------------------------------------------------------------------
 * A SLOT IS NEVER COUNTED TWICE
 * ---------------------------------------------------------------------------
 *
 * An event is either AWARDS POSTED — its winner is known, and `qualifierPool`
 * already consumes that team's slot — or PENDING, and reserves exactly one.
 * Never both: `awardFinalAtPosition` is the discriminator, and it is read at
 * the POSITION being evaluated, so the Road to District Champs rewind slider
 * moving an event's awards back to open turns that event from consuming into
 * reserving in the same step.
 *
 * ---------------------------------------------------------------------------
 * THE CANCELLED CARVE OUT
 * ---------------------------------------------------------------------------
 *
 * An event that will never happen must reserve nothing, or a district whose
 * season is over would hold a slot open forever and no team would ever lock.
 * `isNeverHappening` below is deliberately narrow, and every one of its three
 * clauses is load-bearing:
 *
 *   1. NOT STARTED at `now`. `districtEventStateStarted` counts `awardsPosted`
 *      as started, which is exactly what the 2020 cancellations need: those
 *      events played no matches at all and still posted their Chairman's
 *      awards, so they DID consume slots and must never be called cancelled.
 *   2. NO PUBLISHED QUALIFICATION SCHEDULE — `state` absent, or
 *      `qualMatchesTotal` null. A scheduled future event still reserves.
 *   3. EVERY OTHER district-tier event of the district is FINISHED at `now`.
 *      While any other event is still running the season is live, and a live
 *      season never calls anything cancelled. This is the clause that keeps
 *      the reservation conservative exactly when it matters.
 *
 * The three facts are read at `now` and never at the rewound position: whether
 * an event will ever happen is a property of the world, not of the slider.
 */

/** The four state facts the district artifact publishes per (team, event) cell, narrowed to what this module reads. */
export interface DistrictEventStateFacts {
  readonly qualMatchesPlayed: number;
  readonly qualMatchesTotal: number | null;
  readonly alliancesPicked: boolean;
  readonly playoffsDone: boolean;
  readonly awardsPosted: boolean;
}

/**
 * True once ANY of the four state facts shows the event has begun.
 *
 * Declared here rather than beside either consumer so the district ledger's
 * stage derivation, the browser's poll gate (which re-exports it from
 * `apps/web/src/lib/liveEvent.ts`) and the reservation rule below cannot drift
 * apart.
 */
export function districtEventStateStarted(state: DistrictEventStateFacts): boolean {
  return state.qualMatchesPlayed > 0 || state.alliancesPicked || state.playoffsDone || state.awardsPosted;
}

/**
 * True once all four categories are decided. A NULL `qualMatchesTotal` leaves
 * qualification open rather than guessing it finished: null is the honest
 * answer for an event whose schedule TBA has not published yet.
 */
export function districtEventStateFinished(state: DistrictEventStateFacts): boolean {
  return (
    state.qualMatchesTotal !== null &&
    state.qualMatchesPlayed === state.qualMatchesTotal &&
    state.alliancesPicked &&
    state.playoffsDone &&
    state.awardsPosted
  );
}

/** One district-tier event, as `reservedImpactSlots` needs to see it. */
export interface ReservedSlotEvent {
  readonly eventKey: string;
  /** The event's four state facts at the `now` position, or `undefined` when the artifact carries no `state` block for it. */
  readonly stateAtNow: DistrictEventStateFacts | undefined;
  /** Whether this event's AWARD category is final at the position being evaluated. A rewound position reopens it; `now` reads the `state` block's own `awardsPosted`. */
  readonly awardFinalAtPosition: boolean;
}

/** True when the event's awards are open at the position AND the event can still hand one out — see the header's carve out. */
function isNeverHappening(event: ReservedSlotEvent, all: readonly ReservedSlotEvent[]): boolean {
  const state = event.stateAtNow;
  if (state !== undefined && districtEventStateStarted(state)) return false;
  if (state !== undefined && state.qualMatchesTotal !== null) return false;
  return all.every((other) => other.eventKey === event.eventKey || (other.stateAtNow !== undefined && districtEventStateFinished(other.stateAtNow)));
}

/**
 * The number of points slots held back, one per district-tier event whose
 * Impact award is still to come. Pass ONLY district-tier events: the DCMP's
 * own consuming awards are a different tier with a different slot pool.
 *
 * A MISSING `state` BLOCK COUNTS AS PENDING. An artifact published before the
 * state blocks existed carries none, and the honest answer to "have this
 * event's awards been posted" is then "not known" — which on the conservative
 * side of a guarantee means the slot is held back. Every artifact published
 * since phase 10 carries a state block on every row, so this is a fallback
 * rather than a live path.
 */
export function reservedImpactSlots(events: readonly ReservedSlotEvent[]): number {
  let reserved = 0;
  for (const event of events) {
    if (event.awardFinalAtPosition) continue;
    if (isNeverHappening(event, events)) continue;
    reserved += 1;
  }
  return reserved;
}
