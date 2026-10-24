/**
 * A ROSTER-ONLY SEASON (quick task 261024-lfa) is a season the site lists for its events and rosters
 * before its game rules exist: 2027 from its event release until kickoff in January 2027. It has no
 * score-breakdown component map, no RP rule module and no matches, so it gets no algorithm replay, no
 * season carry, no presim sidecar, no as-of object, no compare file, no team page and no D1 seed. The
 * publisher writes only its events lists, empty teams lists and roster event pages.
 *
 * The registries are NOT loosened: `componentMapForSeason` and the RP rule registry still throw for such
 * a season. This predicate is how call sites avoid reaching them.
 *
 * It lifts itself the day the season's component map is registered (January 2027 for 2027): the season
 * is then a game season like any other. From that day a rebaseline must seed the season into D1 before
 * any live-windows manifest lists its windows, because `buildLiveWindowsManifest` stops dropping them.
 *
 * Node-free on purpose: the web bundle imports it, and the breakdown registry is already bundled there.
 */
import { BREAKDOWN_REGISTERED_SEASONS } from "../core/algorithms/breakdown/index.js";

/** The newest season with a registered component map, the last season the publisher can replay. */
export const NEWEST_GAME_SEASON: number = BREAKDOWN_REGISTERED_SEASONS[BREAKDOWN_REGISTERED_SEASONS.length - 1]!;

/**
 * True for an integer season newer than every registered game season. Gaps inside the registered range
 * (2021, the remote season) are NOT roster-only: that exclusion is permanent and keeps throwing where it
 * always did.
 */
export function isRosterOnlySeason(season: number): boolean {
  return Number.isInteger(season) && season > NEWEST_GAME_SEASON;
}

/** The roster-only seasons of `seasons`, in their given order. */
export function selectRosterOnlySeasons(seasons: readonly number[]): number[] {
  return seasons.filter(isRosterOnlySeason);
}
