/**
 * The live Worker's events-list patch (quick task 261024-jdz).
 *
 * WHY THIS EXISTS. The events list (`v1/events/{year}/{algorithmId}@{version}.json`)
 * is publisher-built, and until this task the live tick never rewrote it. It wrote
 * the `event`, `team` and `teams` artifacts and left the list alone, so the Events
 * page "Matches" column (`playedMatchCount/matchCount`) froze at its publish-time
 * value for the whole of a live event. This module closes that: each fold or
 * schedule-only pricing records its event's CURRENT counts into a per-tick feed,
 * and one rebuild after the event loop patches them into the existing rows.
 *
 * It mirrors `runGlobalRebuild`'s shape (a per-tick feed, one write per
 * algorithm-season after every event has settled) and differs on three points,
 * each deliberate:
 *
 * (a) NO OFFICIALNESS GATE, unlike the `teams/{year}` feed. Offseason and
 *     preseason rows are displayed on the Events page, so their Matches column
 *     has to move too.
 *
 * (b) CONCURRENCY. The rebuild runs once per tick, after every event has settled,
 *     so nothing races within one invocation. Across two overlapping invocations
 *     the exposure is the gap between one R2 read and one put. The rows carry
 *     ABSOLUTE counts, so the next tick that touches the event rewrites its true
 *     count. That is the same exposure `runGlobalRebuild` has, and it carries
 *     deltas, which this does not.
 *
 * (c) THE CANCELLED-ROW GUARD. The browser's events fetcher drops rows that
 *     `isCancelledEvent` flags at the list's own `computedAt`, and a Worker
 *     re-stamp moves that instant to the tick. The rows it newly hides have zero
 *     played matches and a start date at least a week past, which is the
 *     publisher's own rule at that instant. Every event the Worker folds or
 *     prices gets its real count, so a live event stays visible. Residual: an
 *     event that ran after the last publish but before this change deployed keeps
 *     a zero played count and can be hidden once the list is re-stamped. An
 *     unofficial one is already hidden by `isDisplayableEvent`, and the next
 *     publish restores any official one. That is acceptable, and the no-change
 *     skip keeps re-stamps to ticks that actually moved a count.
 *
 * WHAT IT NEVER DOES: add a row, create a missing list, touch a row of an event
 * it did not process, or drop a publisher-owned field. It NEVER throws, so a list
 * failure cannot cost the district pass, the live event pass or `writeTickMeta`.
 *
 * Warn lines carry ids, keys and a truncated message only, never an artifact body
 * or an env value (the rule every warn line in `scheduled.ts` follows).
 */
import { z } from "zod";
import { artifactKey, EventsArtifactSchema } from "../../../packages/harness/pageArtifacts.js";
import type { AlgorithmModule } from "../../../packages/core/algorithms/types.js";
import { readArtifactObject, writeArtifactObject } from "./artifactWriter.js";
import type { Stamp } from "./artifactMerge.js";
import type { SubrequestCounter } from "./subrequestCounter.js";
import type { Env } from "./env.js";

/** Same bound as `WRITE_RETRY_ERROR_MESSAGE_MAX` in `scheduled.ts`, which this module cannot import without a cycle. */
const ERROR_MESSAGE_MAX = 300;

/** The three numbers an events-list row carries about its event's schedule. */
export interface EventsListCounts {
  readonly matchCount: number;
  readonly playedMatchCount: number;
  readonly teamCount: number;
}

/** The narrow slice of an event artifact the counts are read from. */
const CountsSourceSchema = z.object({
  matches: z.array(z.object({ redTeams: z.array(z.string()), blueTeams: z.array(z.string()) })),
  upcoming: z.array(z.object({ redTeams: z.array(z.string()), blueTeams: z.array(z.string()) })),
});

/**
 * The counts an event artifact implies. The same three-part rule as
 * `computeEventCounts` in `packages/harness/publish.ts`, so a patched row and the
 * next published row agree: every `matches` row is played (`EventMatchSchema`
 * requires `actualWinner`) and adds to both counts, an `upcoming` row adds to
 * `matchCount` only, and `teamCount` is the union of red and blue keys over both.
 * `undefined` when the value is not an event-shaped object.
 */
export function eventsListCountsOf(written: unknown): EventsListCounts | undefined {
  const parsed = CountsSourceSchema.safeParse(written);
  if (!parsed.success) return undefined;
  const { matches, upcoming } = parsed.data;
  const teams = new Set<string>();
  for (const m of [...matches, ...upcoming]) {
    for (const t of m.redTeams) teams.add(t);
    for (const t of m.blueTeams) teams.add(t);
  }
  return { playedMatchCount: matches.length, matchCount: matches.length + upcoming.length, teamCount: teams.size };
}

/** One algorithm-season's fed counts. `algorithmId` and `season` ride the value so the rebuild never re-parses the composite key. */
export interface EventsListFeedEntry {
  readonly algorithmId: string;
  readonly season: number;
  readonly counts: Map<string, EventsListCounts>;
}

/** The tick's feed, keyed by the same composite key `touchedTeamsByAlgorithm` uses. */
export type EventsListFeed = Map<string, EventsListFeedEntry>;

/**
 * SYNCHRONOUS by construction, so events folding concurrently (quick task
 * 261018-3ju) cannot drop each other's entries. Each event writes only its own
 * key, and the counts are absolute, so a later record for the same event replaces.
 */
export function recordEventsListCounts(feed: EventsListFeed, compositeKey: string, algorithmId: string, season: number, eventKey: string, counts: EventsListCounts): void {
  let entry = feed.get(compositeKey);
  if (entry === undefined) {
    entry = { algorithmId, season, counts: new Map() };
    feed.set(compositeKey, entry);
  }
  entry.counts.set(eventKey, counts);
}

interface CountedRow {
  readonly eventKey: string;
  readonly matchCount: number;
  readonly playedMatchCount: number;
  readonly teamCount: number;
}

/**
 * A fed row becomes a leading spread of the prior row followed by the three
 * counts; the spread keeps the publisher-owned fields (name, eventType,
 * isOffseason, startDate, week, country, stateProv, districtKey). An unfed row is
 * returned as the same object. `changed` is true only when one of the three
 * numbers differs. It never appends a row: a fed key with no row is reported in
 * `missingEventKeys` (sorted) and nothing else.
 */
export function patchEventsListRows<R extends CountedRow>(rows: readonly R[], counts: ReadonlyMap<string, EventsListCounts>): { rows: R[]; changed: boolean; missingEventKeys: string[] } {
  let changed = false;
  const seen = new Set<string>();
  const patched = rows.map((prior) => {
    const fed = counts.get(prior.eventKey);
    if (fed === undefined) return prior;
    seen.add(prior.eventKey);
    if (prior.matchCount !== fed.matchCount || prior.playedMatchCount !== fed.playedMatchCount || prior.teamCount !== fed.teamCount) changed = true;
    return { ...prior, matchCount: fed.matchCount, playedMatchCount: fed.playedMatchCount, teamCount: fed.teamCount };
  });
  const missingEventKeys = [...counts.keys()].filter((key) => !seen.has(key)).sort();
  return { rows: patched, changed, missingEventKeys };
}

/**
 * The once-per-tick patch. Returns before any read when the feed is empty (zero
 * subrequests, so idle and 304 ticks stay byte-identical). Cost otherwise: one R2
 * read per algorithm-season that wrote an event artifact, plus one put only when a
 * count changed. Never throws; each algorithm-season runs in its own try/catch.
 */
export async function runEventsListRebuild(
  env: Env,
  counter: SubrequestCounter,
  algorithmModules: ReadonlyMap<string, AlgorithmModule<any>>,
  feed: EventsListFeed,
  stamp: Stamp
): Promise<void> {
  if (feed.size === 0) return;

  for (const { algorithmId, season, counts } of feed.values()) {
    const algorithm = algorithmModules.get(algorithmId);
    if (!algorithm) continue;
    try {
      const params = { page: "events" as const, year: season, algorithmId, version: algorithm.version };
      const text = await readArtifactObject(env, counter, artifactKey(params));
      if (text === undefined) {
        // Never invent a list: the publisher owns its creation.
        console.warn(JSON.stringify({ msg: "events-list-missing", algorithmId, season }));
        continue;
      }
      const existing = EventsArtifactSchema.parse(JSON.parse(text));
      const patched = patchEventsListRows(existing.events, counts);
      if (patched.missingEventKeys.length > 0) {
        console.warn(JSON.stringify({ msg: "events-list-row-missing", algorithmId, season, eventKeys: patched.missingEventKeys }));
      }
      if (!patched.changed) continue; // nothing moved: write nothing and do not re-stamp
      const candidate = { ...existing, generation: stamp.generation, computedAt: stamp.computedAt, events: patched.rows };
      await writeArtifactObject(env, counter, "events", params, candidate);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(JSON.stringify({ msg: "events-list-rebuild-failed", algorithmId, season, error: message.slice(0, ERROR_MESSAGE_MAX) }));
    }
  }
}
