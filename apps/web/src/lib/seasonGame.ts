/**
 * The web side of a ROSTER-ONLY SEASON (quick task 261024-lfa): a season the site lists for its events
 * and rosters before its game rules exist (2027 until kickoff in January 2027). The predicate lives in
 * `packages/harness/rosterOnlySeason.ts` (Node-free; it imports only the breakdown registry, which the
 * web bundle already carries through `metricKeys.ts`) and is re-exported here so every web call site
 * and test imports it from one place.
 *
 * The plain copy every roster-only state shows also lives here, so components and tests share one
 * source. Copy rule: very plain words, short sentences, no hyphens or dashes.
 */
export { isRosterOnlySeason } from "../../../../packages/harness/rosterOnlySeason.js";

/** The heading of every tab or page that needs the game. */
export function gameNotOutHeading(season: number): string {
  return `The ${season} game is not out yet`;
}

export const GAME_NOT_OUT_SIMULATION_BODY = "Simulations start after the game comes out in January.";

export const GAME_NOT_OUT_MATCHES_BODY = "Match predictions start after the game comes out in January.";

export const GAME_NOT_OUT_LOCKS_BODY = "District and championship locks start after the game comes out in January.";

export function gameNotOutTeamsBody(season: number): string {
  return `Team ratings start after the first ${season} matches.`;
}

/** The banner above a roster-only event's team list. */
export function rosterOnlyTeamsBanner(season: number): string {
  return `The ${season} game is not out yet, so these teams have no ratings. This list shows the teams signed up so far.`;
}

export const NO_TEAMS_SIGNED_UP_HEADING = "No teams signed up yet";

export function noTeamsSignedUpBody(eventName: string): string {
  return `No teams have signed up for ${eventName} yet. Check back later.`;
}
