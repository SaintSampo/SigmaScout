/**
 * Client-side aggregation for the Champ Locks tab's header strip. The
 * published `DistrictArtifact` does NOT carry a dedicated `champRemaining`
 * aggregate on the wire, so this module derives the header figure HERE,
 * client-side, from the per-team fields every roster team already carries plus
 * the declared point-model ceilings in
 * `packages/core/districts/pointModel.ts`.
 *
 * NARROWED TO THE CHAMP TIER, 2026-09-25 (quick task 260925-ots). This module
 * also carried `computeDistrictLocksHeaderStats` — a district-wide points pool,
 * a played/upcoming schedule strip and a per-tier ceiling — for the District
 * Locks tab's header card. Phase 10 replaced that tab with the Road to District
 * Champs ledger, which computes its own stat line from its own row model
 * (`districtLedgerStatLine`), so the district arm lost its last production call
 * site. It is deleted rather than kept warm: an aggregation nothing renders is
 * an aggregation nothing checks. The champ figures are unchanged, down to the
 * arithmetic.
 *
 * `perEventMax` comes from `pointModel.ts`'s `maxEventPoints` (keyed on
 * `artifact.year` + tier), the SAME source `packages/core/districts/locks.ts`
 * itself uses to build `remainingEvents[].maxPoints` — reading the declared
 * ceiling directly rather than a roster team's `remainingEvents` row, which
 * vanishes once every event of the season has been played (a fully-played
 * district would otherwise show "Not yet known" for a still-computable
 * ceiling). It is `null` only for a season this repo has no declared ceiling
 * for at all.
 *
 * The per-team pre-DCMP ceiling is `perEventMax` times exactly TWO events,
 * never a district-wide event count: a team earns district ranking points at
 * its first two home district events only, regardless of how many events the
 * district itself runs that season.
 *
 * `team.maxRemainingChamp` is the honest per-team input for how much of that
 * ceiling remains reachable RIGHT NOW (it already folds in the DCMP 3x weight
 * when a team's DCMP is still ahead). It is per team and varies by team — the
 * header shows the MAXIMUM across the roster (the team closest to its own
 * ceiling), never a single "the" team's figure, since the tab does not let the
 * reader pick one team.
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

export interface ChampLocksHeaderStats {
  /** The maximum, across the whole roster, of each team's own `maxRemainingChamp` — the team closest to locking champ, not "the" team. `0` for an empty roster. */
  maxRemainingAcrossRoster: number;
  /** The FIXED per-team season ceiling `maxRemainingChamp` counts down from: the 2-event pre-DCMP ceiling plus one DCMP at its 3x weight — or `null` for an unregistered season. */
  seasonCeiling: number | null;
}

/**
 * The Champ Locks header's "Remaining district points: X / Y per team" line —
 * X and Y are both per-team figures, never district-wide totals.
 *
 * The pre-DCMP half of `seasonCeiling` used to be read back off
 * `computeDistrictLocksHeaderStats(teams, "district", season).perTeamCeiling`.
 * That function's own ceiling was `perEventMaxForSeason(season, "district") *
 * TEAM_HOME_DISTRICT_EVENT_COUNT` and nothing else — it depended on no team
 * field at all — so computing it directly here is the same number by a shorter
 * route, not a re-derivation.
 */
export function computeChampLocksHeaderStats(teams: readonly DistrictTeam[], season: number): ChampLocksHeaderStats {
  const districtMax = perEventMaxForSeason(season, "district");
  const preDcmpCeiling = districtMax !== null ? districtMax * TEAM_HOME_DISTRICT_EVENT_COUNT : null;
  const dcmpMax = perEventMaxForSeason(season, "dcmp");
  const maxRemainingAcrossRoster = teams.reduce((max, team) => Math.max(max, team.maxRemainingChamp), 0);
  return {
    maxRemainingAcrossRoster,
    seasonCeiling: preDcmpCeiling !== null && dcmpMax !== null ? preDcmpCeiling + dcmpMax : null,
  };
}
