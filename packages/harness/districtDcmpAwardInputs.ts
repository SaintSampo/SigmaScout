/**
 * A district artifact's teams, as the DCMP award eligibility rule reads them
 * (quick task 261014-i8i).
 *
 * ONE CONVERSION FOR BOTH CALLERS. The browser (`dcmpAwardInputs.ts`) and the
 * publisher's bake (`publishDistricts.ts`) both turn a `DistrictArtifact` into
 * `dcmpAwardEligibility`'s input here, so the champ draws, the per event DCMP
 * run and a baked sidecar read the same teams, the same held awards and the
 * same district events.
 *
 * `districtEventKeys` is the union, by key, of the team's played and remaining
 * entries whose tier is `district`: the same set the web's
 * `tierEvents(team, "district")` yields. A DCMP tier entry is never one of
 * them, so a DCMP tier award never makes a team eligible.
 *
 * `districtEventWeeksFromArtifact` (quick task 261014-qje, Q-05) is the week
 * lookup the district event eligibility reads: a team that won Impact,
 * Engineering Inspiration or Rookie All Star at an EARLIER week's district
 * event cannot win it again. One conversion for the browser and the publisher,
 * as above.
 */
import type { DcmpEligibilityTeam } from "../core/districts/dcmpAwardEligibility.js";
import type { DistrictAwardProfile } from "../core/districts/ledgerSimulation.js";
import type { DistrictArtifact } from "./pageArtifacts.js";

type DistrictArtifactTeam = DistrictArtifact["teams"][number];

/** Every artifact team, in artifact order, as `dcmpAwardEligibility` reads it. `profileOf` decides the rookie flag. */
export function dcmpEligibilityTeamsFromArtifact(
  artifact: DistrictArtifact,
  profileOf: (team: DistrictArtifactTeam) => DistrictAwardProfile
): DcmpEligibilityTeam[] {
  return artifact.teams.map((team) => {
    const districtEventKeys = new Set<string>();
    for (const row of team.eventPoints) if (row.tier === "district") districtEventKeys.add(row.eventKey);
    for (const row of team.remainingEvents) if (row.tier === "district") districtEventKeys.add(row.eventKey);
    return {
      teamKey: team.teamKey,
      rookie: profileOf(team).rookieState === "rookie",
      heldAwards: team.qualifyingAwards.map((award) => ({ eventKey: award.eventKey, awardType: award.awardType })),
      districtEventKeys: [...districtEventKeys],
    };
  });
}

/**
 * Each event's TBA competition week, from the artifact's played and remaining
 * rows (both tiers), the first row met in team order. A `null` week stays
 * `null`: the district eligibility reads a null week as never earlier.
 */
export function districtEventWeeksFromArtifact(artifact: DistrictArtifact): Map<string, number | null> {
  const weeks = new Map<string, number | null>();
  for (const team of artifact.teams) {
    for (const row of [...team.eventPoints, ...team.remainingEvents]) {
      if (!weeks.has(row.eventKey)) weeks.set(row.eventKey, row.week);
    }
  }
  return weeks;
}
