/**
 * The artifact-to-inputs adapter for the pooled remaining-points lock: it turns
 * one district's per-team, per-event view at a position into the two facts
 * `locks.ts` needs — how many district points the whole district still has to
 * hand out, and which teams can still collect any of them.
 *
 * ONE ADAPTER, THREE CALLERS, exactly as `reservedSlots.ts` beside it: the
 * browser's District Locks tab at every rewind position, the offline
 * publisher at "now", and the live Worker through the shared verdict pass. A
 * second derivation of "how much is left" in any of the three is how the
 * browser and the published artifact come to disagree about a guarantee.
 *
 * STRUCTURAL INPUTS, NOT THE ARTIFACT TYPE. This module takes plain arrays of
 * event keys and four booleans rather than importing `DistrictArtifact`, which
 * is the same choice `reservedSlots.ts` makes and for the same two reasons:
 * `packages/core` must not depend on `packages/harness`, and the browser reads
 * its finalities from a REWOUND position rather than from the artifact's own
 * `state` blocks, so an artifact-shaped input would not fit that caller at all.
 *
 * DISTRICT-TIER EVENTS ONLY. Every caller filters to the regular tier before
 * calling; the DCMP slot race this pool feeds is decided by `maxRemainingDistrict`,
 * which is regular-tier points alone.
 *
 * THE PLAYOFF POINTS ALREADY IN FLOORS COME OFF THE POOL (quick task
 * 261009-uhb). The optional second input is, per event, the playoff points
 * that event has ALREADY handed out and that are counted in team floors at
 * the position.
 *
 * The defect it removes. Quick task 261008-26o settles a knocked out
 * alliance's exact playoff points into its teams' floors while the event's
 * Playoffs category is still open. Without the netting the same points sat in
 * rivals' floors and in the pool at once, so the pooled test got harder
 * exactly when information arrived, and a lock shown at Alliances final was
 * withdrawn at Round 4 or Round 5: 41 team stops over 21 events of 2023 to
 * 2026. Every one of those teams did qualify, so no lock was false, but a
 * shown lock was taken back.
 *
 * Why it is sound. `PLAYOFF_POOL` is an upper bound on ALL the playoff points
 * an event hands out (the measured maximum, `pointPool.ts`). The total is
 * what has been handed out plus what remains, so what remains is at most the
 * pool minus what has been handed out. Points handed to teams outside the
 * district are not known and are not subtracted, which only leaves the pool
 * larger: the conservative side.
 *
 * Why no lock is taken back. In the pooled test each rival's cost falls by at
 * most the points it banked, and the pool falls by the sum of everything
 * banked, so any way to unseat a team after the banking is also a way to
 * unseat it before. A pooled lock that held before the points were banked
 * still holds after.
 *
 * Three bounds, each of which leaves the pool LARGER:
 *   1. Only the playoff pool is netted. At most `PLAYOFF_POOL` comes off an
 *      event, so its qualification, selection and award pools are never
 *      reduced and no event's pool goes below zero.
 *   2. Only while the event's Playoffs category is open at the position.
 *      Once it is final the whole playoff pool has already left the
 *      remaining pool and nothing is netted.
 *   3. An amount that is absent, not finite or not above zero subtracts
 *      nothing, and nothing is thrown.
 *
 * ONLY THE BROWSER HAS BRACKET FACTS. The offline publisher and the live
 * Worker pass no second argument and get exactly the results they got before
 * the input existed.
 *
 * A browser-safe leaf module: its only runtime imports are the `./pointPool.js`
 * and `./reservedSlots.js` siblings.
 */
import { PLAYOFF_POOL, eventHasOpenCategory, eventRemainingPool } from "./pointPool.js";
import type { PooledRemainingPoints } from "./locks.js";
import type { DistrictCategoryFinality } from "./reservedSlots.js";

/** One district-tier event on one team's card, at the position being evaluated. */
export interface PooledTeamEvent {
  readonly eventKey: string;
  /** Which of the four categories are FINAL here — `districtEventCategoryFinality` at "now", the rewound stage at a rewound position. */
  readonly final: DistrictCategoryFinality;
}

/** One team's district-tier entry list, as `pooledLockInputs` needs to see it. */
export interface PooledTeamEntry {
  readonly teamKey: string;
  /**
   * Whether this team is in its rookie season.
   *
   * AN UNKNOWN ROOKIE STATUS MUST BE PASSED AS `true`. A rookie WIDENS the
   * award pool (`awardPool` pays 8 more for the first and 5 more for the
   * second), and a wider pool makes the pooled lock fire less often. On a
   * guarantee the unknown side is the conservative side, which is the same rule
   * `reservedImpactSlots` applies to a missing state block. Every district
   * artifact published since phase 10 carries an `awardProfile` for nearly every
   * team, so this is a fallback rather than a live path.
   */
  readonly rookie: boolean;
  readonly events: readonly PooledTeamEvent[];
}

/** One event's contribution, exposed so a caller or a test can see WHICH events the total came from rather than only its size. */
export interface PooledEventContribution {
  readonly eventKey: string;
  /** How many teams the input showed attending. */
  readonly fieldSize: number;
  readonly rookieCount: number;
  /**
   * `eventRemainingPool` at this event's open categories, less the playoff
   * points the event has already handed out and that are counted in team
   * floors (quick task 261009-uhb; nothing is taken off for a caller that
   * passes no such points). Zero for a finished event.
   */
  readonly points: number;
}

/** What `pooledLockInputs` produces: `locks.ts`'s two pooled facts, plus the per-event breakdown they were summed from. */
export interface PooledLockInputsResult extends PooledRemainingPoints {
  readonly byEvent: readonly PooledEventContribution[];
}

/**
 * The district's remaining points at this position, and the set of teams that
 * can still collect any of them.
 *
 * FIRST FINALITY SEEN WINS per event, matching every other per-event derivation
 * in this codebase (`reservedSlotsAtPosition`, `reservedDistrictSlots`,
 * `DistrictLedger.tsx`'s own `nowStageByEvent` memo). Every team's card for one
 * event carries the same event state and the same position override, so the
 * choice cannot matter except for an input whose rows disagree, and then the
 * component's answer is the one to reproduce.
 *
 * A TEAM IS IN `hasRemainingEvent` WHEN ANY of its district-tier events has ANY
 * open category. That is exactly the set of teams that can still gain points,
 * and `locks.ts` skips every rival outside it when it counts the cost of
 * eliminating a team — a rival who cannot score again can never pass anybody.
 *
 * A district whose every event is finished returns `remainingPoints: 0` and an
 * empty `hasRemainingEvent`, which is every finished season in the corpus.
 *
 * `playoffPointsInFloorsByEvent` (quick task 261009-uhb) maps an event key to
 * the playoff points that event has already handed out and that are counted
 * in team floors at this position. Each event's pool is reduced by its
 * amount under the three bounds of the module header: never more than
 * `PLAYOFF_POOL`, only while that event's Playoffs category is open, and
 * nothing for an amount that is absent, not finite or not above zero. With
 * the argument absent, as for the publisher and the Worker, nothing is
 * subtracted and every result is what it was before the parameter existed.
 */
export function pooledLockInputs(
  teams: readonly PooledTeamEntry[],
  playoffPointsInFloorsByEvent?: ReadonlyMap<string, number>
): PooledLockInputsResult {
  const finalByEvent = new Map<string, DistrictCategoryFinality>();
  const attendeesByEvent = new Map<string, Set<string>>();
  const rookiesByEvent = new Map<string, number>();
  const hasRemainingEvent = new Set<string>();

  for (const team of teams) {
    for (const entry of team.events) {
      if (!finalByEvent.has(entry.eventKey)) finalByEvent.set(entry.eventKey, entry.final);
      let attendees = attendeesByEvent.get(entry.eventKey);
      if (attendees === undefined) {
        attendees = new Set<string>();
        attendeesByEvent.set(entry.eventKey, attendees);
        rookiesByEvent.set(entry.eventKey, 0);
      }
      if (!attendees.has(team.teamKey)) {
        attendees.add(team.teamKey);
        if (team.rookie) rookiesByEvent.set(entry.eventKey, (rookiesByEvent.get(entry.eventKey) ?? 0) + 1);
      }
      if (eventHasOpenCategory(finalByEvent.get(entry.eventKey)!)) hasRemainingEvent.add(team.teamKey);
    }
  }

  const byEvent: PooledEventContribution[] = [];
  let remainingPoints = 0;
  for (const [eventKey, final] of finalByEvent) {
    const fieldSize = attendeesByEvent.get(eventKey)?.size ?? 0;
    const rookieCount = rookiesByEvent.get(eventKey) ?? 0;
    // A field of zero cannot arise (an event is only in the map because a team
    // carried it), but `qualificationPool` refuses a zero field size and this
    // module must never be the reason a verdict pass throws.
    const wholePool = fieldSize === 0 ? 0 : eventRemainingPool({ fieldSize, rookieCount, final });
    // Quick task 261009-uhb: the playoff points this event has already handed
    // out and that sit in team floors come off its playoff pool. Never more
    // than the playoff pool, only while the Playoffs category is open (so the
    // playoff pool is inside `wholePool` and the result cannot go below zero),
    // and a bad amount subtracts nothing rather than throwing.
    const inFloors = playoffPointsInFloorsByEvent?.get(eventKey);
    const netted =
      fieldSize === 0 || final.elim || inFloors === undefined || !Number.isFinite(inFloors) || inFloors <= 0 ? 0 : Math.min(inFloors, PLAYOFF_POOL);
    const points = wholePool - netted;
    byEvent.push({ eventKey, fieldSize, rookieCount, points });
    remainingPoints += points;
  }

  return { remainingPoints, hasRemainingEvent, byEvent };
}
