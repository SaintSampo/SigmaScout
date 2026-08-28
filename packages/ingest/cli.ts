/**
 * Backfill entry point over a season range (DATA-01/DATA-02):
 *
 *   pnpm ingest --years 2022-2026
 *   pnpm ingest --year 2024
 *   pnpm ingest --event 2024casj
 *   pnpm ingest --years 2022-2026 --force   (bypass the ETag cache)
 *   pnpm ingest --years 2022-2026 --events-only   (EVNT-01, plan 05-02: refresh
 *     only /events/{year} for the requested range — no teams, no per-event
 *     matches. Always bypasses the ETag cache, the same way --force does,
 *     because a 304 carries no body and a body is exactly what's needed to
 *     fill the new name/week/country/stateProv/districtKey columns.)
 *   pnpm ingest:media --years 2022-2026   (TEAM-02, plan 06-03: resolves each
 *     team's robot photo via /team/{key}/media/{year} and stores the result
 *     in team_media. Uses the corpus's existing ETag cache, so a repeat run
 *     costs the same request count but less bandwidth.)
 *   pnpm ingest:rankings --year 2024   (TEAM-04/F-06-3, plan 06.1-01: resolves
 *     every team's standing at each of the season's events via
 *     /event/{key}/rankings and stores the result in event_rankings. One
 *     request per event, not per team; includes offseason events (PD-01).)
 *   pnpm ingest:alliances --years 2022-2026   (EVNT-05, D-18.7, plan 07-03:
 *     resolves each event's playoff alliance selection via
 *     /event/{key}/alliances, one request per event, and stores the result
 *     in event_alliances. Includes offseason events, matching PD-01.)
 *
 * Drives the Task 2 client's capability helpers through the corpus:
 * checks TBA's status once, fetches each season's teams and events, then
 * each event's matches, normalizing and upserting as it goes (D-05
 * through D-08). Progress is durable per-write (better-sqlite3 commits
 * each statement immediately) and `ingest_runs` records total/304 request
 * counts so a repeat run's conditional-request savings are measurable.
 */
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import {
  findIncompleteIngestRuns,
  openCorpus,
  readEtag,
  recordIngestRun,
  selectTeamKeysForYear,
  selectTeamMediaForYear,
  upsertEvent,
  upsertEventAlliance,
  upsertEventRanking,
  upsertMatch,
  upsertTeam,
  upsertTeamMedia,
  writeEtag,
  type Corpus,
} from "../corpus/db.js";
import { normalizeEventAlliances } from "./alliances.js";
import { pickRobotPhotoUrl } from "./media.js";
import { normalizeEvent, normalizeMatch } from "./normalize.js";
import { normalizeEventRankings } from "./rankings.js";
import {
  tbaAllianceResponseSchema,
  tbaEventListSchema,
  tbaEventRankingsResponseSchema,
  tbaEventSchema,
  tbaMatchListSchema,
  tbaMediaListSchema,
  tbaStatusSchema,
  tbaTeamListSchema,
} from "./schemas.js";
import {
  fetchAllTeams,
  fetchEventAlliances,
  fetchEventDetail,
  fetchEventMatches,
  fetchEventRankings,
  fetchEventsList,
  fetchStatus,
  fetchTeamMedia,
  TbaRequestCounter,
  type TbaClientContext,
} from "./tbaClient.js";

const CORPUS_PATH = "data/corpus.sqlite";

function tbaApiKey(): string {
  const key = process.env["TBA_API_KEY"];
  if (!key) {
    throw new Error("TBA_API_KEY is not set in the environment. Populate .env from .env.example.");
  }
  return key;
}

interface CliOptions {
  seasonStart: number;
  seasonEnd: number;
  eventKey: string | undefined;
  force: boolean;
  /** EVNT-01 (plan 05-02): refresh only /events/{year} for the requested season range. */
  eventsOnly: boolean;
  /** TEAM-02 (plan 06-03): resolve/refresh only team_media for the requested season range. */
  mediaOnly: boolean;
  /** TEAM-04/F-06-3 (plan 06.1-01): resolve/refresh only event_rankings for the requested season range. */
  rankingsOnly: boolean;
  /** EVNT-05, D-18.7 (plan 07-03): resolve/refresh only event_alliances for the requested season range. */
  alliancesOnly: boolean;
}

function parseYearsRange(spec: string): [number, number] {
  const match = /^(\d{4})-(\d{4})$/.exec(spec.trim());
  if (!match) {
    throw new Error(`--years must look like "2022-2026", got "${spec}"`);
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start > end) {
    throw new Error(`--years range start (${start}) must not be after end (${end})`);
  }
  return [start, end];
}

function parseCliOptions(): CliOptions {
  const { values } = parseArgs({
    options: {
      years: { type: "string" },
      year: { type: "string" },
      event: { type: "string" },
      force: { type: "boolean", default: false },
      "events-only": { type: "boolean", default: false },
      "media-only": { type: "boolean", default: false },
      "rankings-only": { type: "boolean", default: false },
      "alliances-only": { type: "boolean", default: false },
    },
  });
  const eventsOnly = values["events-only"] ?? false;
  const mediaOnly = values["media-only"] ?? false;
  const rankingsOnly = values["rankings-only"] ?? false;
  const alliancesOnly = values["alliances-only"] ?? false;

  if (values.event) {
    return {
      seasonStart: 0,
      seasonEnd: 0,
      eventKey: values.event,
      force: values.force ?? false,
      eventsOnly,
      mediaOnly,
      rankingsOnly,
      alliancesOnly,
    };
  }
  if (values.years) {
    const [seasonStart, seasonEnd] = parseYearsRange(values.years);
    return {
      seasonStart,
      seasonEnd,
      eventKey: undefined,
      force: values.force ?? false,
      eventsOnly,
      mediaOnly,
      rankingsOnly,
      alliancesOnly,
    };
  }
  if (values.year) {
    const year = Number(values.year);
    if (!Number.isInteger(year)) throw new Error(`--year must be an integer, got "${values.year}"`);
    return {
      seasonStart: year,
      seasonEnd: year,
      eventKey: undefined,
      force: values.force ?? false,
      eventsOnly,
      mediaOnly,
      rankingsOnly,
      alliancesOnly,
    };
  }
  throw new Error("One of --years, --year, or --event is required");
}

/** Reads a cached ETag unless --force was given (which bypasses the cache entirely). */
function cachedEtagFor(db: Corpus, url: string, force: boolean): string | undefined {
  return force ? undefined : readEtag(db, url);
}

async function ingestEvent(
  db: Corpus,
  ctx: TbaClientContext,
  eventKey: string,
  force: boolean
): Promise<void> {
  const matchesUrl = `/event/${eventKey}/matches`;
  const result = await fetchEventMatches(ctx, eventKey, cachedEtagFor(db, matchesUrl, force));
  if (result.status === 304) {
    console.log(`  ${matchesUrl}: 304 Not Modified`);
    return;
  }

  console.log(`  ${matchesUrl}: 200 OK`);
  const rawMatches = tbaMatchListSchema.parse(result.body);
  const eventRow = db
    .prepare("SELECT start_date FROM events WHERE event_key = ?")
    .get(eventKey) as { start_date: string } | undefined;
  const startDate = eventRow?.start_date ?? new Date().toISOString();

  for (const rawMatch of rawMatches) {
    upsertMatch(db, normalizeMatch(rawMatch, startDate));
  }
  if (result.etag) writeEtag(db, matchesUrl, result.etag);
}

async function ingestSeason(
  db: Corpus,
  ctx: TbaClientContext,
  year: number,
  force: boolean
): Promise<void> {
  console.log(`Season ${year}: fetching teams...`);
  const teamPages = await fetchAllTeams(ctx, year);
  for (const page of teamPages) {
    const rawTeams = tbaTeamListSchema.parse(page.body);
    for (const rawTeam of rawTeams) {
      upsertTeam(db, { teamKey: rawTeam.key, teamNumber: rawTeam.team_number, nickname: rawTeam.nickname });
    }
  }
  console.log(`Season ${year}: ${teamPages.reduce((n, p) => n + p.body.length, 0)} teams upserted`);

  const eventsUrl = `/events/${year}`;
  const eventsResult = await fetchEventsList(ctx, year, cachedEtagFor(db, eventsUrl, force));
  let eventKeys: string[];
  if (eventsResult.status === 304) {
    console.log(`  ${eventsUrl}: 304 Not Modified`);
    eventKeys = (
      db.prepare("SELECT event_key FROM events WHERE year = ?").all(year) as { event_key: string }[]
    ).map((r) => r.event_key);
  } else {
    console.log(`  ${eventsUrl}: 200 OK`);
    const rawEvents = tbaEventListSchema.parse(eventsResult.body);
    for (const rawEvent of rawEvents) {
      upsertEvent(db, normalizeEvent(rawEvent));
    }
    if (eventsResult.etag) writeEtag(db, eventsUrl, eventsResult.etag);
    eventKeys = rawEvents.map((e) => e.key);
  }

  console.log(`Season ${year}: ${eventKeys.length} events`);
  for (const eventKey of eventKeys) {
    await ingestEvent(db, ctx, eventKey, force);
  }
}

/**
 * EVNT-01 (plan 05-02): refreshes only `/events/{year}` for one season — no
 * teams, no per-event matches — so filling the five new location/calendar
 * columns costs roughly one request per season rather than a full
 * multi-season match re-ingest. Always bypasses the ETag cache (the same
 * bypass `--force` performs in `ingestSeason`): a cached 304 carries no
 * body, and a body is exactly what's needed to read the new fields.
 */
async function ingestSeasonEventsOnly(db: Corpus, ctx: TbaClientContext, year: number): Promise<void> {
  const eventsUrl = `/events/${year}`;
  const eventsResult = await fetchEventsList(ctx, year, undefined);
  if (eventsResult.status !== 200) {
    // Unreachable: an undefined cachedEtag can only ever resolve 200 or throw.
    throw new Error(`Unexpected non-200 status while refreshing events metadata for ${year}`);
  }
  console.log(`  ${eventsUrl}: 200 OK`);
  const rawEvents = tbaEventListSchema.parse(eventsResult.body);
  for (const rawEvent of rawEvents) {
    upsertEvent(db, normalizeEvent(rawEvent));
  }
  if (eventsResult.etag) writeEtag(db, eventsUrl, eventsResult.etag);
  console.log(`Season ${year}: ${rawEvents.length} events (events-only refresh)`);
}

/**
 * TEAM-02 (plan 06-03): resolves each team's robot photo for one season via
 * TBA's `/team/{key}/media/{year}`, offline, and stores the result — a URL
 * or an honest null — in `team_media`. Scope matches
 * `selectTeamKeysForYear`'s own `excludeOffseason` default so the media
 * pass and the publish pass agree on which teams count. Uses the corpus's
 * existing generic `http_cache` ETag table (`readEtag`/`writeEtag`) — no
 * new caching mechanism.
 */
async function ingestSeasonMediaOnly(db: Corpus, ctx: TbaClientContext, year: number, force: boolean): Promise<void> {
  const teamKeys = selectTeamKeysForYear(db, year, { excludeOffseason: true });
  let freshCount = 0;
  let cacheHitCount = 0;
  let notFoundCount = 0;

  for (const teamKey of teamKeys) {
    const mediaUrl = `/team/${teamKey}/media/${year}`;
    let result: Awaited<ReturnType<typeof fetchTeamMedia>>;
    try {
      result = await fetchTeamMedia(ctx, teamKey, year, cachedEtagFor(db, mediaUrl, force));
    } catch (err) {
      // A placeholder/unregistered alliance slot (e.g. TBA's own "frc0"
      // stand-in on an event with an unresolved playoff bracket match) 404s
      // against a real team key. Treat this as "no media for this team-year"
      // and continue the season rather than aborting the whole run on one
      // team the corpus has no `teams` row for — a genuine 404 here is not
      // TBA schema drift, it's an honest "nothing to fetch" answer.
      if (err instanceof Error && /HTTP 404/.test(err.message)) {
        notFoundCount++;
        console.log(`  ${mediaUrl}: 404 Not Found, skipping (no corpus teams row for this key)`);
        continue;
      }
      throw err;
    }
    if (result.status === 304) {
      cacheHitCount++;
      continue;
    }

    freshCount++;
    const rawMedia = tbaMediaListSchema.parse(result.body);
    const picked = pickRobotPhotoUrl(rawMedia);
    upsertTeamMedia(db, {
      teamKey,
      year,
      imageUrl: picked?.imageUrl ?? null,
      mediaType: picked?.mediaType ?? null,
      fetchedAt: new Date().toISOString(),
    });
    if (result.etag) writeEtag(db, mediaUrl, result.etag);
  }

  // Read the true resolved-photo state back from the corpus rather than
  // reporting resolvedCount/freshCount alone: an interrupted-then-resumed
  // season (T-01-06) mixes 304 cache hits (already resolved by an earlier
  // partial run, not counted by resolvedCount above) with this run's fresh
  // 200s, so only a fresh read of every stored row for the season gives an
  // accurate rate — this run's own in-memory tally would silently
  // under-report on any resume.
  const storedMedia = selectTeamMediaForYear(db, year);
  const totalStored = storedMedia.size;
  const totalWithPhoto = [...storedMedia.values()].filter((m) => m.imageUrl !== null).length;

  console.log(
    `Season ${year}: ${teamKeys.length} teams (${notFoundCount} 404s skipped), ` +
      `${freshCount} fresh / ${cacheHitCount} cache hits this run, ` +
      `${totalWithPhoto}/${totalStored} resolved photos in corpus ` +
      `(${totalStored > 0 ? ((totalWithPhoto / totalStored) * 100).toFixed(1) : "0.0"}%)`
  );
}

/**
 * TEAM-04/F-06-3 (plan 06.1-01): resolves every team's standing for one
 * season via TBA's `/event/{key}/rankings`, one request per event (Pitfall
 * 5 — never a per-team loop), and stores the result in `event_rankings`.
 * Iterates the corpus's OWN `events` table for the season — the
 * `ingestSeasonEventsOnly` iteration shape, not `ingestSeasonMediaOnly`'s
 * team-key loop — and deliberately does NOT filter offseason events (PD-01):
 * TBA computes rankings for offseason events too, and TEAM-04's "attended...
 * event" is not scoped to in-season only. Tallies four separate counts
 * (populated / null-body / empty-rankings / cache hits this run) so a null
 * TBA response body stays distinguishable from a genuine empty rankings
 * array at the layer where that distinction is actionable (PD-02).
 *
 * Rule 1 fix (discovered running the real `pnpm ingest:rankings --year
 * 2024` command against the live corpus): some multi-robot remote-league
 * events (e.g. `2024azrl1`..`5`) report a ranking for a synthetic
 * second-robot team key (`frc1165B`, `frc1165C`, ...) that has no
 * corresponding `/team/{key}` record at all (confirmed live: 404) and
 * therefore no row in this corpus's `teams` table — `event_rankings.
 * team_key REFERENCES teams(team_key)` would otherwise fail the whole
 * event's upsert on a single unregistered slot, mirroring
 * `ingestSeasonMediaOnly`'s existing "frc0"/placeholder-slot 404 precedent.
 * Rather than fabricating a `teams` row for an entity this corpus has no
 * real record of, that one team's ranking row is skipped and counted
 * separately (`unknownTeamCount`) — `totalTeams` on every OTHER team's row
 * for that event is unaffected, since it is `response.rankings.length`,
 * the true pool size TBA reported, not a count of rows this corpus chose
 * to store.
 */
async function ingestSeasonRankingsOnly(db: Corpus, ctx: TbaClientContext, year: number, force: boolean): Promise<void> {
  const eventKeys = (
    db.prepare(`SELECT event_key FROM events WHERE year = ?`).all(year) as { event_key: string }[]
  ).map((r) => r.event_key);
  const knownTeamKeys = new Set(
    (db.prepare(`SELECT team_key FROM teams`).all() as { team_key: string }[]).map((r) => r.team_key)
  );

  let populatedCount = 0;
  let nullBodyCount = 0;
  let emptyRankingsCount = 0;
  let cacheHitCount = 0;
  let unknownTeamCount = 0;

  for (const eventKey of eventKeys) {
    const rankingsUrl = `/event/${eventKey}/rankings`;
    let result: Awaited<ReturnType<typeof fetchEventRankings>>;
    try {
      result = await fetchEventRankings(ctx, eventKey, cachedEtagFor(db, rankingsUrl, force));
    } catch (err) {
      // Mirrors ingestSeasonMediaOnly's 404 handling: a placeholder/
      // unregistered event key 404ing is an honest "nothing to fetch" for
      // this event, not TBA schema drift — skip and continue the season.
      if (err instanceof Error && /HTTP 404/.test(err.message)) {
        console.log(`  ${rankingsUrl}: 404 Not Found, skipping`);
        continue;
      }
      throw err;
    }
    if (result.status === 304) {
      cacheHitCount++;
      continue;
    }

    const parsed = tbaEventRankingsResponseSchema.parse(result.body);
    if (parsed === null) {
      nullBodyCount++;
    } else if (parsed.rankings.length === 0) {
      emptyRankingsCount++;
    } else {
      populatedCount++;
    }

    const normalized = normalizeEventRankings(parsed);
    const fetchedAt = new Date().toISOString();
    for (const ranking of normalized) {
      if (!knownTeamKeys.has(ranking.teamKey)) {
        // See this function's header comment (Rule 1 fix) — a real TBA
        // ranking entry for a team key this corpus has no /team/{key}
        // record for. Skip this one row rather than fail the whole event's
        // upsert or fabricate a teams row.
        unknownTeamCount++;
        continue;
      }
      upsertEventRanking(db, {
        eventKey,
        teamKey: ranking.teamKey,
        rank: ranking.rank,
        totalTeams: ranking.totalTeams,
        fetchedAt,
      });
    }
    if (result.etag) writeEtag(db, rankingsUrl, result.etag);
  }

  console.log(
    `Season ${year}: ${eventKeys.length} events (${populatedCount} populated, ${nullBodyCount} null-body, ` +
      `${emptyRankingsCount} empty-rankings, ${cacheHitCount} cache hits this run, ` +
      `${unknownTeamCount} rows skipped for an unregistered team key)`
  );
}

/**
 * EVNT-05/D-18.7 (plan 07-03): resolves every event's playoff alliance
 * selection for one season via TBA's `/event/{key}/alliances`, one request
 * per event, and stores the result in `event_alliances`. Structurally
 * identical to `ingestSeasonRankingsOnly` above — iterates the corpus's OWN
 * `events` table for the season, deliberately does NOT filter offseason
 * events (PD-01 remains in force here too — RESEARCH.md Q2's live probe
 * found offseason events are exactly where the two empty-array cases live,
 * so excluding them would hide the absent-data case D-17 is designed
 * around), and tallies the same tri-state parse-result split.
 *
 * Two deliberate divergences from `ingestSeasonRankingsOnly`, stated here
 * so a reader does not assume they were forgotten:
 *
 * 1. There is no unknown-team guard and no `unknownTeamCount`.
 *    `ingestSeasonRankingsOnly` needs one because `event_rankings.
 *    team_key REFERENCES teams(team_key)`, and TBA reports rankings for
 *    synthetic second-robot keys such as `frc1165B` at `2024azrl1`..`5`
 *    that TBA's own `/team/{key}` 404s on. `event_alliances` stores
 *    `picks` as a JSON array with no team-key foreign key — 07-02's
 *    explicit decision, taken because of that very incident — so a
 *    synthetic key inside `picks` is harmless here and must not be
 *    filtered out. Filtering it would silently drop a real team from a
 *    real alliance.
 * 2. There IS a `notFoundCount`, mirroring `ingestSeasonMediaOnly`'s
 *    rather than `ingestSeasonRankingsOnly`'s bare log line. With it, the
 *    five counters — `populatedCount`, `nullBodyCount`,
 *    `emptyAlliancesCount`, `cacheHitCount`, `notFoundCount` — sum exactly
 *    to the season's event count, which turns the tally from a log line
 *    into a closed invariant a reader can falsify. Every event takes
 *    exactly one of the five paths.
 */
async function ingestSeasonAlliancesOnly(db: Corpus, ctx: TbaClientContext, year: number, force: boolean): Promise<void> {
  const eventKeys = (
    db.prepare(`SELECT event_key FROM events WHERE year = ?`).all(year) as { event_key: string }[]
  ).map((r) => r.event_key);

  let populatedCount = 0;
  let nullBodyCount = 0;
  let emptyAlliancesCount = 0;
  let cacheHitCount = 0;
  let notFoundCount = 0;

  for (const eventKey of eventKeys) {
    const alliancesUrl = `/event/${eventKey}/alliances`;
    let result: Awaited<ReturnType<typeof fetchEventAlliances>>;
    try {
      result = await fetchEventAlliances(ctx, eventKey, cachedEtagFor(db, alliancesUrl, force));
    } catch (err) {
      // Mirrors ingestSeasonMediaOnly's 404 handling: a placeholder/
      // unregistered event key 404ing is an honest "nothing to fetch" for
      // this event, not TBA schema drift — skip and continue the season.
      if (err instanceof Error && /HTTP 404/.test(err.message)) {
        notFoundCount++;
        console.log(`  ${alliancesUrl}: 404 Not Found, skipping`);
        continue;
      }
      throw err;
    }
    if (result.status === 304) {
      cacheHitCount++;
      continue;
    }

    const parsed = tbaAllianceResponseSchema.parse(result.body);
    if (parsed === null) {
      nullBodyCount++;
    } else if (parsed.length === 0) {
      emptyAlliancesCount++;
    } else {
      populatedCount++;
    }

    const normalized = normalizeEventAlliances(parsed);
    const fetchedAt = new Date().toISOString();
    for (const alliance of normalized) {
      upsertEventAlliance(db, { eventKey, ...alliance, fetchedAt });
    }
    // writeEtag runs AFTER the upsert loop, deliberately — an interrupted
    // event has no cached ETag and is re-fetched on the next run rather
    // than skipped as a 304 whose rows never landed.
    if (result.etag) writeEtag(db, alliancesUrl, result.etag);
  }

  console.log(
    `Season ${year}: ${eventKeys.length} events (${populatedCount} populated, ${nullBodyCount} null-body, ` +
      `${emptyAlliancesCount} empty-alliances, ${cacheHitCount} cache hits this run, ` +
      `${notFoundCount} not-found)`
  );
}

async function main(): Promise<void> {
  const options = parseCliOptions();
  const apiKey = tbaApiKey();
  const db = openCorpus(CORPUS_PATH);

  try {
    const incomplete = findIncompleteIngestRuns(db);
    for (const run of incomplete) {
      console.log(
        `Note: a prior run (${run.runId}, started ${run.startedAt}) never completed — ` +
          `continuing from cached ETags, which by construction skip everything already current.`
      );
    }

    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const counter = new TbaRequestCounter();
    const ctx: TbaClientContext = { apiKey, counter };

    recordIngestRun(db, {
      runId,
      startedAt,
      finishedAt: null,
      seasonStart: options.seasonStart,
      seasonEnd: options.seasonEnd,
      requestCount: 0,
      cacheHitCount: 0,
      completed: false,
    });

    // Check the datafeed's own health once, before writing anything —
    // never write a run's worth of partial/stale data if TBA reports
    // itself down.
    const statusResult = await fetchStatus(ctx);
    if (statusResult.status === 200) {
      const status = tbaStatusSchema.parse(statusResult.body);
      if (status.is_datafeed_down) {
        throw new Error("TBA datafeed is reported down (status.is_datafeed_down = true); aborting run.");
      }
    }

    if (options.eventKey) {
      const eventUrl = `/event/${options.eventKey}`;
      const eventResult = await fetchEventDetail(
        ctx,
        options.eventKey,
        cachedEtagFor(db, eventUrl, options.force)
      );
      if (eventResult.status === 200) {
        console.log(`${eventUrl}: 200 OK`);
        upsertEvent(db, normalizeEvent(tbaEventSchema.parse(eventResult.body)));
        if (eventResult.etag) writeEtag(db, eventUrl, eventResult.etag);
      } else {
        console.log(`${eventUrl}: 304 Not Modified`);
      }
      await ingestEvent(db, ctx, options.eventKey, options.force);
    } else if (options.eventsOnly) {
      for (let year = options.seasonStart; year <= options.seasonEnd; year++) {
        await ingestSeasonEventsOnly(db, ctx, year);
        recordIngestRun(db, {
          runId,
          startedAt,
          finishedAt: null,
          seasonStart: options.seasonStart,
          seasonEnd: options.seasonEnd,
          requestCount: counter.total,
          cacheHitCount: counter.cacheHits,
          completed: false,
        });
      }
    } else if (options.mediaOnly) {
      for (let year = options.seasonStart; year <= options.seasonEnd; year++) {
        await ingestSeasonMediaOnly(db, ctx, year, options.force);
        recordIngestRun(db, {
          runId,
          startedAt,
          finishedAt: null,
          seasonStart: options.seasonStart,
          seasonEnd: options.seasonEnd,
          requestCount: counter.total,
          cacheHitCount: counter.cacheHits,
          completed: false,
        });
      }
    } else if (options.rankingsOnly) {
      for (let year = options.seasonStart; year <= options.seasonEnd; year++) {
        await ingestSeasonRankingsOnly(db, ctx, year, options.force);
        recordIngestRun(db, {
          runId,
          startedAt,
          finishedAt: null,
          seasonStart: options.seasonStart,
          seasonEnd: options.seasonEnd,
          requestCount: counter.total,
          cacheHitCount: counter.cacheHits,
          completed: false,
        });
      }
    } else if (options.alliancesOnly) {
      for (let year = options.seasonStart; year <= options.seasonEnd; year++) {
        await ingestSeasonAlliancesOnly(db, ctx, year, options.force);
        recordIngestRun(db, {
          runId,
          startedAt,
          finishedAt: null,
          seasonStart: options.seasonStart,
          seasonEnd: options.seasonEnd,
          requestCount: counter.total,
          cacheHitCount: counter.cacheHits,
          completed: false,
        });
      }
    } else {
      for (let year = options.seasonStart; year <= options.seasonEnd; year++) {
        await ingestSeason(db, ctx, year, options.force);
        recordIngestRun(db, {
          runId,
          startedAt,
          finishedAt: null,
          seasonStart: options.seasonStart,
          seasonEnd: options.seasonEnd,
          requestCount: counter.total,
          cacheHitCount: counter.cacheHits,
          completed: false,
        });
      }
    }

    recordIngestRun(db, {
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      seasonStart: options.seasonStart,
      seasonEnd: options.seasonEnd,
      requestCount: counter.total,
      cacheHitCount: counter.cacheHits,
      completed: true,
    });

    console.log(
      `Ingestion run ${runId} complete: ${counter.total} requests (${counter.cacheHits} cache hits / 304s, ${counter.fresh} fresh / 200s)`
    );
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error("ingest failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
