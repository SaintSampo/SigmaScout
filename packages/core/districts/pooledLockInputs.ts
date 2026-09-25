/**
 * The artifact-to-inputs adapter for the pooled remaining-points lock: it turns
 * one district's per-team, per-event view at a position into the two facts
 * `locks.ts` needs — how many district points the whole district still has to
 * hand out, and which teams can still collect any of them.
 *
 * ONE ADAPTER, THREE CALLERS, exactly as `reservedSlots.ts` beside it: the
 * browser's Road to District Champs tab at every rewind position, the offline
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
 * A browser-safe leaf module: its only runtime imports are the `./pointPool.js`
 * and `./reservedSlots.js` siblings.
 */
import { eventHasOpenCategory, eventRemainingPool } from "./pointPool.js";
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
  /** `eventRemainingPool` at this event's open categories. Zero for a finished event. */
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
 */
export function pooledLockInputs(teams: readonly PooledTeamEntry[]): PooledLockInputsResult {
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
    const points = fieldSize === 0 ? 0 : eventRemainingPool({ fieldSize, rookieCount, final });
    byEvent.push({ eventKey, fieldSize, rookieCount, points });
    remainingPoints += points;
  }

  return { remainingPoints, hasRemainingEvent, byEvent };
}
