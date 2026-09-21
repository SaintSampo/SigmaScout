/**
 * THE LIVE ROSTER (quick task 260921-5qw): one tiny object per live event,
 * naming the teams on it, so a robot page can find an event its own published
 * season file has never heard of.
 *
 * WHY IT EXISTS. The robot page learns a team's events from that team's
 * published season artifact. Since 260920-lny the Worker promotes a zero-match
 * event to live folding once TBA shows matches, and TBA publishes no team list
 * for an offseason event in advance, so no team file can name it. Without this
 * object such an event is live on its own page and invisible on every robot
 * page until an operator ingests and republishes, which is exactly the manual
 * step this task removes.
 *
 * WHO WRITES IT. The live Worker, in Phase B, and only when the event's roster
 * GREW since the artifact it just read: the first fold, and any later tick
 * that adds a team. Never once per tick. It is algorithm-independent, so it is
 * written once per event however many algorithms fold.
 *
 * WHO READS IT. The robot page, for each live window that is open NOW and is
 * not already among the team's events. A 404 is the ordinary answer: the event
 * has not been promoted yet.
 *
 * ZOD ONLY, no Node and no Worker API: it sits on the browser's import graph
 * and the Worker's. The key has ONE spelling, here, imported by both sides.
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

/**
 * True when the merged artifact names a team the existing one did not. Rosters
 * only grow during an event, so a count comparison is exact, and both inputs
 * are already in the tick's hands: deciding costs no read.
 */
export function rosterGrew(existing: RosterSource | undefined, merged: RosterSource): boolean {
  return rosterTeamKeys(merged).length > rosterTeamKeys(existing).length;
}

export function buildLiveRoster(params: {
  readonly eventKey: string;
  readonly season: number;
  readonly eventName?: string;
  readonly startDate?: string;
  readonly source: RosterSource;
  readonly computedAt: string;
}): LiveRoster {
  return LiveRosterSchema.parse({
    schemaVersion: LIVE_ROSTER_SCHEMA_VERSION,
    eventKey: params.eventKey,
    season: params.season,
    ...(params.eventName !== undefined ? { eventName: params.eventName } : {}),
    ...(params.startDate !== undefined ? { startDate: params.startDate } : {}),
    teams: rosterTeamKeys(params.source),
    computedAt: params.computedAt,
  });
}
