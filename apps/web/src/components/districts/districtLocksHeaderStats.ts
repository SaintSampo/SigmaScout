/**
 * Client-side aggregation for the District Locks / Champ Locks tabs' header
 * strip (revision R2, quick task 260905-lic Task R2b). The published
 * `DistrictArtifact` (`packages/harness/pageArtifacts.ts`) does NOT carry a
 * dedicated `preDcmp`/`pointsPool`/`champRemaining` aggregate on the wire —
 * R2a's own "REVISION R2a SCHEMA-VERSION NOTE" doc comment only names
 * `qualifyingAwards` and `allocationNote` as the fields that revision
 * actually added. This module derives the header figures this revision's
 * user decisions call for HERE, client-side, from the per-team `eventPoints`
 * and `remainingEvents` arrays every roster team already carries — no
 * `packages/`-side schema change, per this task's own file scope.
 *
 * Two arrays are the honest inputs at hand, per team:
 *   - `eventPoints[]` — one row per event a team has ALREADY PLAYED, with
 *     TBA's own reported point components (never that event's per-team
 *     ceiling).
 *   - `remainingEvents[]` — one row per event a team has NOT YET played,
 *     with its per-team ceiling (`maxPoints`) already computed by
 *     `packages/core/districts/pointModel.ts`.
 *
 * A single district event's per-team point ceiling is a SEASON CONSTANT —
 * every team's `remainingEvents` row for the same `eventKey` reports the
 * identical `maxPoints` (`pointModel.ts`'s own declared tier ceiling, never a
 * per-team quantity) — so `perEventMax` below is read off of ANY team's
 * `remainingEvents` row for this tier. Once every event of a tier has been
 * played by every team, there is no `remainingEvents` row left to read a
 * ceiling from at all; this module reports that honestly as `null` rather
 * than inventing a number.
 *
 * "Team count" for an event that has not yet happened is read as the number
 * of teams whose OWN `remainingEvents` array still lists that `eventKey` —
 * every team still counting an event ahead of it is, by construction, a team
 * registered to attend it that has not yet played it. This is the concrete
 * meaning behind the user's own "team count x the season's observed average
 * points-per-team at played district events" estimate formula.
 */
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";

type DistrictTeam = DistrictArtifact["teams"][number];
export type DistrictEventTier = DistrictTeam["eventPoints"][number]["tier"];

export interface DistrictScheduleEntry {
  eventKey: string;
  eventName: string;
  week: number | null;
  played: boolean;
  /** This tier's per-team point ceiling at this event — `null` when no roster row (played or upcoming) reports one for this event. */
  maxPoints: number | null;
  /** Teams that have played (played=true) or still count this event ahead of them (played=false) — see this module's own doc comment for the derivation. */
  teamCount: number;
}

export interface DistrictPointsPoolEntry {
  eventKey: string;
  played: boolean;
  /** Actual (played) or estimated (upcoming) points distributed at this event, summed across every team that played/counts it. */
  actualOrEstimate: number;
  isEstimate: boolean;
}

export interface DistrictPointsPool {
  distributed: number;
  /**
   * Sum of every upcoming event's estimated points — team count (see above)
   * times the season's observed average points-per-team at played events of
   * this tier. `0` when no event of this tier has been played yet anywhere
   * in the district, since there is no observed average to extrapolate from
   * (never a guessed non-zero number).
   */
  remainingEstimate: number;
  perEvent: DistrictPointsPoolEntry[];
}

export interface DistrictLocksHeaderStats {
  /** This tier's per-event point ceiling, or `null` if no roster row reports one. */
  perEventMax: number | null;
  /** The season's full per-team ceiling for this tier, across every distinct event this tier has ever had — `perEventMax * totalEventCount`, or `null` when `perEventMax` itself is unknown. */
  seasonCeilingTotal: number | null;
  totalEventCount: number;
  /** Every distinct event of this tier, played and upcoming alike, ordered by week (unknown week sorts last). */
  schedule: DistrictScheduleEntry[];
  pointsPool: DistrictPointsPool;
}

interface PlayedAccumulator {
  eventName: string;
  week: number | null;
  total: number;
  teamCount: number;
}

interface UpcomingAccumulator {
  eventName: string;
  week: number | null;
  maxPoints: number;
  teamCount: number;
}

function accumulateTierEntries(
  teams: readonly DistrictTeam[],
  tier: DistrictEventTier,
): { played: Map<string, PlayedAccumulator>; upcoming: Map<string, UpcomingAccumulator> } {
  const played = new Map<string, PlayedAccumulator>();
  const upcoming = new Map<string, UpcomingAccumulator>();

  for (const team of teams) {
    for (const eventPoint of team.eventPoints) {
      if (eventPoint.tier !== tier) continue;
      const existing = played.get(eventPoint.eventKey);
      if (existing) {
        existing.total += eventPoint.total;
        existing.teamCount += 1;
      } else {
        played.set(eventPoint.eventKey, { eventName: eventPoint.eventName, week: eventPoint.week, total: eventPoint.total, teamCount: 1 });
      }
    }
    for (const remaining of team.remainingEvents) {
      if (remaining.tier !== tier) continue;
      const existing = upcoming.get(remaining.eventKey);
      if (existing) {
        existing.teamCount += 1;
      } else {
        upcoming.set(remaining.eventKey, { eventName: remaining.eventName, week: remaining.week, maxPoints: remaining.maxPoints, teamCount: 1 });
      }
    }
  }

  return { played, upcoming };
}

/**
 * Builds `tier`'s header stats from the full team roster (this revision's
 * "district-wide points pool" + "per-team ceiling" + "schedule strip"
 * decisions). The District Locks tab calls this with `tier="district"`. The
 * Champ Locks header (per the user's own decision) also reads
 * `tier="district"` stats via `computeChampLocksHeaderStats` below —
 * "Remaining district points" is about pre-DCMP DISTRICT points, not DCMP-
 * tier points, even on the Champ Locks tab.
 */
export function computeDistrictLocksHeaderStats(teams: readonly DistrictTeam[], tier: DistrictEventTier): DistrictLocksHeaderStats {
  const { played, upcoming } = accumulateTierEntries(teams, tier);

  const firstUpcoming = upcoming.values().next();
  const perEventMax = firstUpcoming.done ? null : firstUpcoming.value.maxPoints;
  const totalEventCount = played.size + upcoming.size;
  const seasonCeilingTotal = perEventMax !== null ? perEventMax * totalEventCount : null;

  const distributed = [...played.values()].reduce((sum, entry) => sum + entry.total, 0);
  const playedTeamEventPairs = [...played.values()].reduce((sum, entry) => sum + entry.teamCount, 0);
  const averagePointsPerTeam = playedTeamEventPairs > 0 ? distributed / playedTeamEventPairs : 0;

  const perEvent: DistrictPointsPoolEntry[] = [];
  for (const [eventKey, entry] of played) {
    perEvent.push({ eventKey, played: true, actualOrEstimate: entry.total, isEstimate: false });
  }
  let remainingEstimate = 0;
  for (const [eventKey, entry] of upcoming) {
    const estimate = entry.teamCount * averagePointsPerTeam;
    remainingEstimate += estimate;
    perEvent.push({ eventKey, played: false, actualOrEstimate: estimate, isEstimate: true });
  }

  const schedule: DistrictScheduleEntry[] = [
    ...[...played.entries()].map(([eventKey, entry]) => ({
      eventKey,
      eventName: entry.eventName,
      week: entry.week,
      played: true,
      maxPoints: perEventMax,
      teamCount: entry.teamCount,
    })),
    ...[...upcoming.entries()].map(([eventKey, entry]) => ({
      eventKey,
      eventName: entry.eventName,
      week: entry.week,
      played: false,
      maxPoints: entry.maxPoints,
      teamCount: entry.teamCount,
    })),
  ].sort((a, b) => (a.week ?? Infinity) - (b.week ?? Infinity));

  return {
    perEventMax,
    seasonCeilingTotal,
    totalEventCount,
    schedule,
    pointsPool: { distributed, remainingEstimate, perEvent },
  };
}

export interface ChampLocksHeaderStats {
  /** `computeDistrictLocksHeaderStats(teams, "district").pointsPool.remainingEstimate` — see this module's own doc comment for why the Champ Locks header reads DISTRICT-tier stats. */
  remainingDistrictPoints: number;
  /** `computeDistrictLocksHeaderStats(teams, "district").seasonCeilingTotal`. */
  preDcmpCeiling: number | null;
}

/** The Champ Locks header's "Remaining district points: X / Y pre-DCMP" line (this revision's own decided copy). */
export function computeChampLocksHeaderStats(teams: readonly DistrictTeam[]): ChampLocksHeaderStats {
  const districtStats = computeDistrictLocksHeaderStats(teams, "district");
  return {
    remainingDistrictPoints: districtStats.pointsPool.remainingEstimate,
    preDcmpCeiling: districtStats.seasonCeilingTotal,
  };
}
