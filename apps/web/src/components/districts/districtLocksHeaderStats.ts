/**
 * Client-side aggregation for the District Locks / Champ Locks tabs' header
 * strip. The published `DistrictArtifact` does NOT carry a dedicated
 * `preDcmp`/`pointsPool`/`champRemaining` aggregate on the wire, so this
 * module derives the header figures HERE, client-side, from the per-team
 * `eventPoints` and `remainingEvents` arrays every roster team already
 * carries, plus the declared point-model ceilings in
 * `packages/core/districts/pointModel.ts`.
 *
 * `perEventMax` comes from `pointModel.ts`'s `maxEventPoints` (keyed on
 * `artifact.year` + tier), the SAME source `packages/core/districts/
 * locks.ts` itself uses to build `remainingEvents[].maxPoints` — reading the
 * declared ceiling directly rather than a roster team's `remainingEvents`
 * row, which vanishes once every event of the season has been played (a
 * fully-played district would otherwise show "Not yet known" for a
 * still-computable ceiling). It is `null` only for a season this repo has
 * no declared ceiling for at all.
 *
 * The per-team pre-DCMP ceiling (`perTeamCeiling` below) is `perEventMax`
 * times exactly TWO events, never the district-wide `totalEventCount`: a
 * team earns district ranking points at its first two home district events
 * only, regardless of how many events the district itself runs that season.
 *
 * Two per-team roster fields are the honest inputs for how much of that
 * fixed ceiling remains reachable RIGHT NOW: `team.maxRemainingDistrict`
 * (pre-DCMP) and `team.maxRemainingChamp` (champ-tier, already folding in
 * the DCMP 3x weight when a team's DCMP is still ahead). Both are per-team
 * and vary by team — the header shows the MAXIMUM across the roster (the
 * team closest to its own ceiling), never a single "the" team's figure,
 * since neither tab lets the reader pick one team.
 */
import { maxEventPoints, UnknownDistrictSeasonError, type DistrictTier } from "../../../../../packages/core/districts/pointModel.js";
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";

type DistrictTeam = DistrictArtifact["teams"][number];
export type DistrictEventTier = DistrictTeam["eventPoints"][number]["tier"];

/**
 * A team earns district ranking points at its first TWO home district
 * events only, per the FIRST district ranking rule. This is a FIXED
 * per-team event count, independent of how many district events the
 * district as a whole runs in a season — it is what makes the per-team
 * pre-DCMP ceiling `perEventMax * TEAM_HOME_DISTRICT_EVENT_COUNT`, never
 * `perEventMax * totalEventCount`.
 */
const TEAM_HOME_DISTRICT_EVENT_COUNT = 2;

export interface DistrictScheduleEntry {
  eventKey: string;
  eventName: string;
  week: number | null;
  played: boolean;
  /** This tier's per-team point ceiling at this event, from `pointModel.ts` — `null` only when the season itself has no declared ceiling. */
  maxPoints: number | null;
  /** Teams that have played (played=true) or still count this event ahead of them (played=false) — see this module's own doc comment for the derivation. */
  teamCount: number;
}

export interface DistrictPointsPoolEntry {
  eventKey: string;
  played: boolean;
  /**
   * Actual (played) or estimated (upcoming) points distributed at this
   * event, summed across every team that played/counts it — UNROUNDED. An
   * upcoming event's estimate is a team-count x average-points-per-team
   * product and is frequently fractional; rounding is a DISPLAY concern
   * (`Math.round` at the render call site, `DistrictLocksTab.tsx`), not
   * something this module bakes into the value it returns, so a consumer
   * that wants full precision (e.g. summing many of these) never loses it.
   */
  actualOrEstimate: number;
  isEstimate: boolean;
}

export interface DistrictPointsPool {
  /** UNROUNDED — see `DistrictPointsPoolEntry.actualOrEstimate`'s doc comment on why rounding is a display concern. */
  distributed: number;
  /**
   * Sum of every upcoming event's estimated points — team count (see above)
   * times the season's observed average points-per-team at played events of
   * this tier. `0` when no event of this tier has been played yet anywhere
   * in the district, since there is no observed average to extrapolate from
   * (never a guessed non-zero number). UNROUNDED — see
   * `DistrictPointsPoolEntry.actualOrEstimate`'s doc comment.
   */
  remainingEstimate: number;
  perEvent: DistrictPointsPoolEntry[];
}

export interface DistrictLocksHeaderStats {
  /** This tier's per-event point ceiling for `season`, from `pointModel.ts`'s declared maxima — `null` only when `season` is not one of `pointModel.ts`'s registered district seasons. */
  perEventMax: number | null;
  /** The FIXED per-team pre-DCMP ceiling — `perEventMax * TEAM_HOME_DISTRICT_EVENT_COUNT` (a team earns district points at its first two home events only, regardless of how many events the district itself runs) — or `null` when `perEventMax` is `null`. */
  perTeamCeiling: number | null;
  /** The maximum, across the whole roster, of each team's own remaining-ceiling field for this tier (`maxRemainingDistrict` for the district tier) — the team closest to its own ceiling, not "the" team. `0` for an empty roster. */
  maxRemainingAcrossRoster: number;
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
 * `pointModel.ts`'s declared per-event ceiling for `season`/`tier`, summed
 * across its four components — the SAME source `packages/core/districts/
 * locks.ts` reads to build `remainingEvents[].maxPoints` in the first place.
 * Returns `null` (never throws, never guesses) for a season this repo has no
 * declared ceiling for at all (`UnknownDistrictSeasonError` — an unregistered
 * season, not a "no data yet" case).
 */
function perEventMaxForSeason(season: number, tier: DistrictTier): number | null {
  try {
    const maxima = maxEventPoints(season, tier);
    return maxima.qual + maxima.alliance + maxima.elim + maxima.award;
  } catch (err) {
    if (err instanceof UnknownDistrictSeasonError) return null;
    throw err;
  }
}

/**
 * Builds `tier`'s header stats for `season` from the full team roster: a
 * district-wide points pool, a per-team ceiling, and a schedule strip. The
 * District Locks tab calls this with `tier="district"`. The Champ Locks
 * header also reads `tier="district"` stats via
 * `computeChampLocksHeaderStats` below — "Remaining district points" is
 * about pre-DCMP DISTRICT points, not DCMP-tier points, even on the Champ
 * Locks tab.
 */
export function computeDistrictLocksHeaderStats(teams: readonly DistrictTeam[], tier: DistrictEventTier, season: number): DistrictLocksHeaderStats {
  const { played, upcoming } = accumulateTierEntries(teams, tier);

  const perEventMax = perEventMaxForSeason(season, tier);
  const totalEventCount = played.size + upcoming.size;
  const perTeamCeiling = perEventMax !== null ? perEventMax * TEAM_HOME_DISTRICT_EVENT_COUNT : null;
  const maxRemainingAcrossRoster = teams.reduce((max, team) => Math.max(max, tier === "district" ? team.maxRemainingDistrict : team.maxRemainingChamp), 0);

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
      // Prefers the season-derived ceiling (available even once every event
      // is played elsewhere in the district); falls back to this event's own
      // wire-reported ceiling only if the season itself is unregistered.
      maxPoints: perEventMax ?? entry.maxPoints,
      teamCount: entry.teamCount,
    })),
  ].sort((a, b) => (a.week ?? Infinity) - (b.week ?? Infinity));

  return {
    perEventMax,
    perTeamCeiling,
    maxRemainingAcrossRoster,
    totalEventCount,
    schedule,
    pointsPool: { distributed, remainingEstimate, perEvent },
  };
}

export interface ChampLocksHeaderStats {
  /** The maximum, across the whole roster, of each team's own `maxRemainingChamp` — the team closest to locking champ, not "the" team. `0` for an empty roster. */
  maxRemainingAcrossRoster: number;
  /** `computeDistrictLocksHeaderStats(teams, "district", season).perTeamCeiling` — the SAME fixed 2-event pre-DCMP ceiling the District Locks tab shows. */
  preDcmpCeiling: number | null;
}

/** The Champ Locks header's "Remaining district points: X / Y pre-DCMP" line — X and Y are both per-team figures, never district-wide totals. */
export function computeChampLocksHeaderStats(teams: readonly DistrictTeam[], season: number): ChampLocksHeaderStats {
  const districtStats = computeDistrictLocksHeaderStats(teams, "district", season);
  const maxRemainingAcrossRoster = teams.reduce((max, team) => Math.max(max, team.maxRemainingChamp), 0);
  return {
    maxRemainingAcrossRoster,
    preDcmpCeiling: districtStats.perTeamCeiling,
  };
}
