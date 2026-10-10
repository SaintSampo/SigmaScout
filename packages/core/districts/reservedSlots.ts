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
 * the POSITION being evaluated, so the District Locks rewind slider
 * moving an event's awards back to open turns that event from consuming into
 * reserving in the same step.
 *
 * THE PUBLISHED VERDICT FOLLOWS THE SAME RULE (quick task 261009-tx6). The
 * live Worker records an Impact winner as soon as TBA lists it, while the
 * event's flag still waits. Between quick tasks 261009-r9x and 261009-tx6
 * the PUBLISHED verdict (`packages/harness/districtRankingsMerge.ts`) read
 * that record at once and still reserved a slot for the event, so it held
 * the slot twice and could take back a Locked it had given on points a tick
 * earlier. It now reads a recorded winner only once the winner's own event
 * says the award is given, which is the fact this reservation reads, so
 * there too an event consumes or reserves and never both. The browser has
 * always done this: it gates each award on its own event's stage.
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
 *      the reservation conservative exactly when it matters. Since quick task
 *      261007-jvz's finality cascade, a cancelled but awarded event (the 2020
 *      shape) counts as finished here; clause 1 is unchanged, so that event
 *      itself is still never called cancelled.
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
 * Which of the four district point categories are FINAL at a position. `true`
 * means decided and already in a team's earned total; `false` means still open,
 * so its points are still to be handed out.
 *
 * Declared here rather than in either consumer because BOTH the browser's stage
 * derivation and `packages/core/districts/pointPool.ts`'s remaining-points pool
 * read the same four booleans, and a second copy of the qualification-is-final
 * rule is exactly the drift this module exists to prevent.
 */
export interface DistrictCategoryFinality {
  readonly qual: boolean;
  readonly alliance: boolean;
  readonly elim: boolean;
  readonly award: boolean;
}

/** Every category open — what an event with no observed `state` block reports. */
export const ALL_CATEGORIES_OPEN: DistrictCategoryFinality = { qual: false, alliance: false, elim: false, award: false };

/**
 * The four category finalities implied by one event's state facts.
 *
 * ---------------------------------------------------------------------------
 * FINALITY CASCADES FROM LATER STAGES (quick task 261007-jvz)
 * ---------------------------------------------------------------------------
 *
 * An event's stages happen in a fixed physical order. Alliance selection
 * cannot start before qualification ends, playoffs cannot finish before
 * alliances are picked, and awards are posted at the closing ceremony after
 * the playoffs. The Worker first requests `/event/{key}/awards` only once
 * `playoffsDone` is true (`apps/worker/src/districtRefresh.ts`). So a later
 * stage's fact closes every earlier category:
 *
 *   award    = awardsPosted
 *   elim     = playoffsDone OR award
 *   alliance = alliancesPicked OR elim
 *   qual     = (qualMatchesTotal not null AND every match played) OR alliance
 *
 * The cases the per fact rule read wrong:
 *
 *   - 2023nhgrs played 52 of its 78 scheduled qualification matches, then
 *     picked alliances, played its playoffs and posted its awards. A curtailed
 *     event: qualification never read final, so the event never read finished.
 *   - 2022gacar posted its awards, but one quarterfinal row was never played,
 *     so `playoffsDone` never turned true.
 *   - A divisioned DCMP parent has no qualification schedule of its own (a
 *     null total) and carries every later fact.
 *   - The 2020 cancellations played no match at all and posted their awards.
 *     They now read finished.
 *
 * THE GUARANTEE. Every category the cascade closes has already handed out all
 * of its points: no qualification point is earned once alliances are picked,
 * and no alliance or playoff point once the awards are posted. The remaining
 * points pool shrinks only by points nobody can still earn.
 *
 * AN ABSENT `state` REPORTS EVERY CATEGORY OPEN rather than guessing any of
 * them finished — the same honest-unknown rule `reservedImpactSlots` applies to
 * a missing state block, and on both sides of this module's use the open answer
 * is the conservative one (a bigger remaining-points pool, a held-back slot).
 *
 * A NULL `qualMatchesTotal` WITH NO LATER FACT TRUE likewise leaves
 * qualification open: null is the honest answer for an event whose schedule
 * TBA has not published yet, and reading it as finished would treat points
 * that have not been handed out as though they had been.
 *
 * THIS IS THE STATE'S OWN READING: WHAT HAS HAPPENED ON THE FIELD (quick task
 * 261009-vp9). It is the reading for history, for started and finished, and
 * for everything the simulation run conditions on (the published alliances,
 * the played bracket, the bracket facts, the timeline and the rail). It does
 * NOT say that a category's number is final at the live position: the state
 * comes from the match feed and the points from the district rankings, and
 * the second can lag the first. Whether a number is final there is
 * `corroboratedCategoryFinality` in `categoryCorroboration.ts`, which reads
 * this state AND the points that prove it. The two readings are never mixed.
 */
export function districtEventCategoryFinality(state: DistrictEventStateFacts | undefined): DistrictCategoryFinality {
  if (state === undefined) return ALL_CATEGORIES_OPEN;
  const award = state.awardsPosted;
  const elim = state.playoffsDone || award;
  const alliance = state.alliancesPicked || elim;
  const qual = (state.qualMatchesTotal !== null && state.qualMatchesPlayed === state.qualMatchesTotal) || alliance;
  return { qual, alliance, elim, award };
}

/**
 * True once all four categories are decided, under the cascade above. A NULL
 * `qualMatchesTotal` leaves qualification open only while no later fact is
 * true: null is then the honest answer for an event whose schedule TBA has not
 * published yet.
 */
export function districtEventStateFinished(state: DistrictEventStateFacts): boolean {
  // Derived from `districtEventCategoryFinality` rather than restating its four
  // conditions, so "finished" cannot drift from "every category final".
  const final = districtEventCategoryFinality(state);
  return final.qual && final.alliance && final.elim && final.award;
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
 * own consuming awards are a different tier with a different slot pool, and
 * `champReservedSlots.ts` beside this file holds THAT pool's slots back
 * (quick task 261006-3gg).
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
