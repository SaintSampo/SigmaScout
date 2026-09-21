/**
 * Which events a robot page should ADD to the ones its published season file
 * names (quick task 260921-5qw). Pure: no React, no fetch, no clock of its own.
 *
 * Two questions, asked in order so the cheap one gates the expensive one:
 *   1. `windowsToCheck`: which live windows are open NOW, for THIS season, and
 *      not already among the team's events? Only those cost a roster fetch.
 *      Outside an event weekend the answer is empty and nothing is fetched.
 *   2. `discoveredTeamEvents`: of those, which rosters name this team? Each
 *      becomes a published-shaped event with NO matches of its own; the
 *      existing overlay fills them from the event's artifact, exactly as it
 *      does for a published live event.
 */
import type { LiveWindowEntry } from "../../../../packages/harness/manifestSchemas.js";
import type { LiveRoster } from "../../../../packages/harness/liveRoster.js";
import type { TeamSeasonEvent } from "../components/team/matchAxis.js";

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function windowsToCheck(params: {
  readonly windows: readonly LiveWindowEntry[];
  readonly season: number;
  readonly knownEventKeys: ReadonlySet<string>;
  readonly nowMs: number;
}): string[] {
  const { windows, season, knownEventKeys, nowMs } = params;
  return windows
    .filter((w) => w.season === season && nowMs >= w.startMs && nowMs <= w.endMs && !knownEventKeys.has(w.eventKey))
    .map((w) => w.eventKey)
    .sort(byString);
}

export function discoveredTeamEvents(params: {
  readonly teamKey: string;
  readonly knownEventKeys: ReadonlySet<string>;
  /** `null`/`undefined` for a roster that is absent, pending or failed: not discovered. */
  readonly rosters: readonly (LiveRoster | null | undefined)[];
}): TeamSeasonEvent[] {
  const { teamKey, knownEventKeys, rosters } = params;
  const events: TeamSeasonEvent[] = [];
  const seen = new Set<string>();
  for (const roster of rosters) {
    if (roster == null || knownEventKeys.has(roster.eventKey) || seen.has(roster.eventKey)) continue;
    if (!roster.teams.includes(teamKey)) continue;
    seen.add(roster.eventKey);
    events.push({ eventKey: roster.eventKey, eventName: roster.eventName ?? roster.eventKey, startDate: roster.startDate ?? "", matches: [] });
  }
  return events.sort((a, b) => byString(a.startDate, b.startDate) || byString(a.eventKey, b.eventKey));
}
