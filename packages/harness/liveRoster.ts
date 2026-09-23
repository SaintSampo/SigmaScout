/**
 * THE LIVE ROSTER (quick task 260921-5qw): one tiny object per live event,
 * naming the teams on it, so a robot page could find an event its own published
 * season file had never heard of.
 *
 * NOBODY WRITES IT ANY MORE, and the reason it existed is gone (quick task
 * 260923-3w6). The gap it filled was this: the robot page learns a team's events
 * from that team's published season artifact, and between 260917-jr4 and
 * 260923-3w6 the live tick wrote NO team artifact — so an event the Worker
 * promoted to live folding, which TBA publishes no advance team list for, could
 * not appear in any team's file until an operator republished. The tick writes
 * the team artifact itself again, naming the event, so a promoted event reaches
 * every robot page through the file that page already fetches.
 *
 * WHAT IS LEFT, and for whom. `liveRosterKey` and `LiveRosterSchema` are still
 * imported by the WEB's discovery fetcher, which treats a 404 as the ordinary
 * answer and resolves to "nothing discovered" — so the web is already correct
 * against a bucket with no roster objects in it. Quick task 260923-3w7 deletes
 * that fetcher and this file with it. Stale roster objects written by earlier
 * ticks stay in R2 until a prune; they are read-only and harmless.
 *
 * `buildLiveRoster` and `rosterGrew` were the Worker's half and are DELETED with
 * the write. `rosterTeamKeys` stays as `LiveRosterSchema`'s companion.
 *
 * ZOD ONLY, no Node and no Worker API: it sits on the browser's import graph.
 * The key has ONE spelling, here.
 */
import { z } from "zod";
import { isDemoTeamKey } from "../core/algorithms/demoTeams.js";

export const LIVE_ROSTER_SCHEMA_VERSION = 1;

/** `v1/live-roster/{eventKey}.json`. No `@`, so the R2 census files it as unversioned, never as a generation. */
export function liveRosterKey(eventKey: string): string {
  return `v1/live-roster/${eventKey}.json`;
}

export const LiveRosterSchema = z.object({
  schemaVersion: z.literal(LIVE_ROSTER_SCHEMA_VERSION),
  eventKey: z.string().min(1),
  season: z.number().int(),
  /** The event's display name and start date when the Worker knew them (from the published stub). The robot page falls back to the key. */
  eventName: z.string().optional(),
  startDate: z.string().optional(),
  /** Real team keys, ascending, no demo robots: a demo key has no robot page. */
  teams: z.array(z.string().min(1)),
  computedAt: z.string().min(1),
});

export type LiveRoster = z.infer<typeof LiveRosterSchema>;

/** The slice of an event artifact a roster is read off: standings plus anything still on the schedule. */
export interface RosterSource {
  readonly teams?: readonly { readonly teamKey: string }[];
  readonly upcoming?: readonly { readonly redTeams: readonly string[]; readonly blueTeams: readonly string[] }[];
}

/**
 * Every REAL team on the event: its standings plus every team still on the
 * schedule, so a robot page shows the event before that team's first match.
 * Sorted and de-duplicated; `undefined` reads as no teams.
 */
export function rosterTeamKeys(source: RosterSource | undefined): string[] {
  const keys = new Set<string>();
  for (const team of source?.teams ?? []) keys.add(team.teamKey);
  for (const match of source?.upcoming ?? []) for (const teamKey of [...match.redTeams, ...match.blueTeams]) keys.add(teamKey);
  return [...keys].filter((teamKey) => !isDemoTeamKey(teamKey)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// `rosterGrew` and `buildLiveRoster` lived here until quick task 260923-3w6.
// They were the Worker's half — "has this event's roster grown since the artifact
// I just read, and if so what does the roster object say" — and they went with
// the write itself. Nothing else ever called either.
