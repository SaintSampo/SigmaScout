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
 *     request per event, not per team; includes offseason events (PD-01).
 *     Also fills record_wins/record_losses/record_ties and ranking_score
 *     (D-18.6, plan 07-04) with TBA's own reported record and ranking-score
 *     value.)
 *   pnpm ingest:rankings --years 2022-2026 --force   (D-18.6, plan 07-04:
 *     the flag is REQUIRED to backfill record_wins/record_losses/
 *     record_ties/ranking_score onto an already-ingested season — an
 *     un-forced re-run's cached-ETag 304s carry no body, so the four
 *     columns stay NULL otherwise.)
 *   pnpm ingest:alliances --years 2022-2026   (EVNT-05, D-18.7, plan 07-03:
 *     resolves each event's playoff alliance selection via
 *     /event/{key}/alliances, one request per event, and stores the result
 *     in event_alliances. Includes offseason events, matching PD-01.)
 *   pnpm ingest:districts --years 2022-2026   (quick task 260905-lic Task 1;
 *     widened by revision R2a to also fetch awards: resolves each season's
 *     district point data -- capacity, per-team rankings, event registration
 *     and award recipients -- via /districts/{year}, /district/{key}/rankings,
 *     /district/{key}/events/keys, /event/{key}/teams/keys and
 *     /event/{key}/awards, and stores the result in
 *     districts/district_rankings/event_teams/event_awards. Same --force
 *     caching rule as --rankings-only: an already-ingested season's cached
 *     ETags 304 with no body, so a re-run needs --force to get real rows
 *     again. --years only accepts one contiguous range; a gap season like
 *     2021 requires a separate invocation.)
 *   pnpm ingest:event-teams --years 2026-2026   (quick task 260905-tll Task 3,
 *     C-16: resolves registered teams for EVERY official event of a season —
 *     not just district events the way --districts-only does — via
 *     /event/{key}/teams/keys, one request per event, storing the result in
 *     event_teams. Standalone: reads the official-event-key set from the
 *     corpus's own `events` table rather than re-fetching /events/{year}.
 *     Same --force caching rule as every other *-only mode: a re-run over an
 *     already-ingested season needs --force, because a cached-ETag 304
 *     carries no body.)
 *   pnpm ingest:awards --years 2022-2026   (revision R2a: resolves ONLY award
 *     recipients for one season via /event/{key}/awards, one request per
 *     district event, and stores the result in event_awards. Standalone:
 *     reads the district-event-key set from the corpus's OWN `events` table
 *     (district_key IS NOT NULL, already filled by a prior --districts-only
 *     or plain ingest run) rather than re-fetching /districts/{year} or
 *     /district/{key}/rankings the way --districts-only does -- so an
 *     already-ingested season can be backfilled with award data without
 *     needing --force, which would otherwise force a needless re-fetch and
 *     re-parse of every ranking row's event_points_raw. Same --force caching
 *     rule as every other *-only mode applies to the awards endpoint itself.)
 *   pnpm ingest:awards-all --years 2022-2026   (quick task 260912-5n8 T1:
 *     the WIDE award backfill, additive to --awards-only above and no
 *     replacement for it. Fetches the same /event/{key}/awards endpoint but
 *     for EVERY event of the season (regionals, championships, offseason and
 *     preseason included) and keeps EVERY award type and EVERY recipient,
 *     storing into event_awards_all. --awards-only stays deliberately narrow
 *     -- four award types, district events -- because
 *     packages/core/districts/qualification.ts throws on any other type and
 *     is a shipped surface. Uses its OWN ETag namespace
 *     (/event/{key}/awards#all) so a key already cached by --awards-only
 *     cannot 304 this mode into storing nothing. Reads the event-key set
 *     from the corpus's own `events` table; never re-fetches /events/{year}.)
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
  replaceEventAwardsAll,
  selectDistrictsForYear,
  selectTeamKeysForYear,
  selectTeamMediaForYear,
  upsertDistrict,
  upsertDistrictRanking,
  upsertEvent,
  upsertEventAlliance,
  upsertEventAward,
  upsertEventRanking,
  upsertEventTeam,
  upsertMatch,
  upsertTeam,
  upsertTeamMedia,
  writeEtag,
  type Corpus,
} from "../corpus/db.js";
import { normalizeEventAlliances } from "./alliances.js";
import { eventAwardsAllEtagKey, normalizeEventAwardsAll, selectAllEventKeysForYear } from "./awardsAll.js";
import { eventTeamsUrlFor, selectOfficialEventKeysForYear } from "./eventTeams.js";
import { normalizeDistricts, normalizeDistrictRankings, normalizeEventAwards } from "./districts.js";
import { pickRobotPhotoUrl } from "./media.js";
import { normalizeEvent, normalizeMatch } from "./normalize.js";
import { normalizeEventRankings } from "./rankings.js";
import {
  tbaAllianceResponseSchema,
  tbaDistrictListSchema,
  tbaDistrictRankingsResponseSchema,
  tbaEventAwardsResponseSchema,
  tbaEventListSchema,
  tbaEventRankingsResponseSchema,
  tbaEventSchema,
  tbaKeysResponseSchema,
  tbaMatchListSchema,
  tbaMediaListSchema,
  tbaStatusSchema,
  tbaTeamListSchema,
} from "./schemas.js";
import {
  fetchAllTeams,
  fetchDistrictEventKeys,
  fetchDistrictRankings,
  fetchDistrictsList,
  fetchEventAlliances,
  fetchEventAwards,
  fetchEventDetail,
  fetchEventMatches,
  fetchEventRankings,
  fetchEventsList,
  fetchEventTeamKeys,
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
  /** quick task 260905-lic Task 1: resolve/refresh only districts/district_rankings/event_teams for the requested season range. Revision R2a: this mode ALSO now fetches award recipients for every district event. */
  districtsOnly: boolean;
  /** revision R2a: resolve/refresh ONLY event_awards for the requested season range, reading the district-event-key set from the corpus's own events table rather than re-fetching /districts/{year} or /district/{key}/rankings. */
  awardsOnly: boolean;
  /** quick task 260905-tll Task 3 (C-16): resolve/refresh ONLY event_teams for the requested season range, for EVERY official event — the districts loop populated it for district events alone, which left regionals/championships with no registered-team roster and made the pre-schedule (scheduleless-event) publish path nearly inert. */
  eventTeamsOnly: boolean;
  /** quick task 260912-5n8 T1: resolve/refresh ONLY event_awards_all — EVERY award type at EVERY event (including offseason/preseason) — for the requested season range. Additive to --awards-only, which stays narrow (four award types, district events) because packages/core/districts/qualification.ts throws on any other type. */
  awardsAllOnly: boolean;
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
      "districts-only": { type: "boolean", default: false },
      "awards-only": { type: "boolean", default: false },
      "event-teams-only": { type: "boolean", default: false },
      "awards-all-only": { type: "boolean", default: false },
    },
  });
  const eventsOnly = values["events-only"] ?? false;
  const mediaOnly = values["media-only"] ?? false;
  const rankingsOnly = values["rankings-only"] ?? false;
  const alliancesOnly = values["alliances-only"] ?? false;
  const districtsOnly = values["districts-only"] ?? false;
  const awardsOnly = values["awards-only"] ?? false;
  const eventTeamsOnly = values["event-teams-only"] ?? false;
  const awardsAllOnly = values["awards-all-only"] ?? false;

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
      districtsOnly,
      awardsOnly,
      eventTeamsOnly,
      awardsAllOnly,
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
      districtsOnly,
      awardsOnly,
      eventTeamsOnly,
      awardsAllOnly,
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
      districtsOnly,
      awardsOnly,
      eventTeamsOnly,
      awardsAllOnly,
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
 *
 * D-18.6 (plan 07-04): also persists TBA's own authoritative `record`
 * (wins/losses/ties) and the position-0 ranking-score value alongside
 * `rank`/`totalTeams`, both read from `normalizeEventRankings`'s widened
 * result. Both come from TBA's own computation, never a tally this
 * pipeline derives from `matches` — TBA's record accounts for
 * disqualifications and surrogate appearances that a match-derived count
 * would misreport. `nullRankingScoreCount` tallies rows whose
 * `rankingScore` is `null` (an absent or empty `sort_orders`); there is no
 * corresponding counter for the sort-order-drift case, because drift
 * throws — `RankingScoreSortOrderError` from `normalizeEventRankings` is
 * deliberately NOT caught here. It propagates out of this function and
 * aborts the season so a human sees the vocabulary drift, and a resumed
 * run stays cheap: the failing event's own ETag was never written, so it
 * is re-fetched (not re-walked from event 1) on the next attempt.
 *
 * WARNING — the single most likely way these four columns ship empty: a
 * run WITHOUT `--force` writes nothing for any event whose cached ETag is
 * still current, since a 304 carries no body and the 304 branch below
 * `continue`s before any upsert. Backfilling these columns onto an
 * already-ingested season therefore REQUIRES `--force`; 06.1-04 already
 * measured all 324 of 2024's requests returning 304 on exactly such a
 * re-run with no `--force`.
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
  // D-18.6 (plan 07-04): tallies rows stored with a null ranking_score (an
  // absent or empty sort_orders). RESEARCH.md Question 1 found sort_orders
  // non-null in every sampled populated row — this counter is how that
  // expectation gets measured on the real corpus rather than assumed. No
  // counter exists for the drift case: drift throws, it is never counted.
  let nullRankingScoreCount = 0;

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

    const normalized = normalizeEventRankings(parsed, eventKey);
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
      if (ranking.rankingScore === null) nullRankingScoreCount++;
      upsertEventRanking(db, {
        eventKey,
        teamKey: ranking.teamKey,
        rank: ranking.rank,
        totalTeams: ranking.totalTeams,
        fetchedAt,
        recordWins: ranking.recordWins,
        recordLosses: ranking.recordLosses,
        recordTies: ranking.recordTies,
        rankingScore: ranking.rankingScore,
      });
    }
    if (result.etag) writeEtag(db, rankingsUrl, result.etag);
  }

  console.log(
    `Season ${year}: ${eventKeys.length} events (${populatedCount} populated, ${nullBodyCount} null-body, ` +
      `${emptyRankingsCount} empty-rankings, ${cacheHitCount} cache hits this run, ` +
      `${unknownTeamCount} rows skipped for an unregistered team key, ` +
      `${nullRankingScoreCount} rows stored with a null ranking score)`
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

/**
 * quick task 260905-lic Task 1: resolves a season's district point data --
 * every active district's capacity/metadata, each team's district ranking,
 * and event registration for every event in each district's authoritative
 * membership list -- via TBA's `/districts/{year}`,
 * `/district/{key}/rankings`, `/district/{key}/events/keys` and
 * `/event/{key}/teams/keys`, storing the result in
 * districts/district_rankings/event_teams.
 *
 * Widened by revision R2a: for every district event key (regular AND DCMP --
 * both come from the same `/district/{key}/events/keys` list, no separate
 * membership call), also fetches `/event/{key}/awards` and stores the
 * qualification-relevant recipients in `event_awards`. This is the same
 * per-event loop that already fetches `/event/{key}/teams/keys` -- the
 * awards fetch is appended alongside it, not a second pass over the event
 * list.
 *
 * Carries forward `ingestSeasonRankingsOnly`'s caching rule verbatim: a
 * re-run over an already-ingested season needs `--force`, because a
 * cached-ETag 304 carries no body. On a 304 for the top-level districts
 * list, the district-key list is re-derived from the corpus's own
 * `districts` table (mirroring `ingestSeason`'s events-304 fallback, not
 * `ingestSeasonRankingsOnly`'s per-event skip) since every subsequent step
 * needs that list to iterate over; a 304 on a per-district rankings or
 * events-keys call is simply skipped for that district, same as
 * `ingestSeasonAlliancesOnly`'s per-event 304 branch.
 *
 * `event_teams.event_key REFERENCES events(event_key)` (schema.sql) -- a
 * district event key TBA reports that this corpus has never ingested (an
 * out-of-range or otherwise un-ingested event) cannot be inserted and is
 * logged separately by name, never silently dropped, per this task's done
 * criteria. `event_awards.event_key` carries the identical constraint, so
 * the same missing-event-key guard covers both.
 */
async function ingestSeasonDistrictsOnly(db: Corpus, ctx: TbaClientContext, year: number, force: boolean): Promise<void> {
  const districtsUrl = `/districts/${year}`;
  const districtsResult = await fetchDistrictsList(ctx, year, cachedEtagFor(db, districtsUrl, force));
  let districtKeys: string[];
  if (districtsResult.status === 304) {
    console.log(`  ${districtsUrl}: 304 Not Modified`);
    districtKeys = selectDistrictsForYear(db, year).map((d) => d.districtKey);
  } else {
    console.log(`  ${districtsUrl}: 200 OK`);
    const rawDistricts = tbaDistrictListSchema.parse(districtsResult.body);
    const fetchedAt = new Date().toISOString();
    for (const normalized of normalizeDistricts(rawDistricts)) {
      upsertDistrict(db, { ...normalized, fetchedAt });
    }
    if (districtsResult.etag) writeEtag(db, districtsUrl, districtsResult.etag);
    districtKeys = (rawDistricts ?? []).map((d) => d.key);
  }

  const knownEventKeys = new Set(
    (db.prepare(`SELECT event_key FROM events WHERE year = ?`).all(year) as { event_key: string }[]).map(
      (r) => r.event_key
    )
  );

  let rankingRowCount = 0;
  let districtEventCount = 0;
  let registrationRowCount = 0;
  let awardRowCount = 0;
  const missingEventKeys: string[] = [];

  for (const districtKey of districtKeys) {
    // Step 1: district rankings.
    const rankingsUrl = `/district/${districtKey}/rankings`;
    const rankingsResult = await fetchDistrictRankings(ctx, districtKey, cachedEtagFor(db, rankingsUrl, force));
    if (rankingsResult.status === 304) {
      console.log(`  ${rankingsUrl}: 304 Not Modified`);
    } else {
      console.log(`  ${rankingsUrl}: 200 OK`);
      const parsedRankings = tbaDistrictRankingsResponseSchema.parse(rankingsResult.body);
      const fetchedAt = new Date().toISOString();
      for (const ranking of normalizeDistrictRankings(parsedRankings)) {
        upsertDistrictRanking(db, { districtKey, ...ranking, fetchedAt });
        rankingRowCount++;
      }
      if (rankingsResult.etag) writeEtag(db, rankingsUrl, rankingsResult.etag);
    }

    // Step 2: authoritative event membership for this district, then
    // per-event registration.
    const eventKeysUrl = `/district/${districtKey}/events/keys`;
    const eventKeysResult = await fetchDistrictEventKeys(ctx, districtKey, cachedEtagFor(db, eventKeysUrl, force));
    if (eventKeysResult.status === 304) {
      console.log(`  ${eventKeysUrl}: 304 Not Modified`);
      continue;
    }
    console.log(`  ${eventKeysUrl}: 200 OK`);
    const districtEventKeys = tbaKeysResponseSchema.parse(eventKeysResult.body) ?? [];
    districtEventCount += districtEventKeys.length;
    if (eventKeysResult.etag) writeEtag(db, eventKeysUrl, eventKeysResult.etag);

    for (const eventKey of districtEventKeys) {
      if (!knownEventKeys.has(eventKey)) {
        // event_teams.event_key REFERENCES events(event_key) -- cannot
        // insert without a corpus events row. Log by name rather than
        // silently dropping (this task's done criteria).
        missingEventKeys.push(eventKey);
        continue;
      }

      // Registration and awards are two INDEPENDENT fetches for the same
      // event -- each has its own try/catch/continue, so a 404 or 304 on
      // one never skips the other (unlike this loop's single earlier
      // knownEventKeys check, which does legitimately skip both: neither
      // can be inserted without a corpus events row).
      const teamsUrl = `/event/${eventKey}/teams/keys`;
      let teamsResult: Awaited<ReturnType<typeof fetchEventTeamKeys>> | undefined;
      try {
        teamsResult = await fetchEventTeamKeys(ctx, eventKey, cachedEtagFor(db, teamsUrl, force));
      } catch (err) {
        // Mirrors ingestSeasonMediaOnly's/ingestSeasonAlliancesOnly's 404
        // handling: a placeholder/unregistered event key 404ing is an
        // honest "nothing to fetch" for this event, not TBA schema drift.
        if (err instanceof Error && /HTTP 404/.test(err.message)) {
          console.log(`  ${teamsUrl}: 404 Not Found, skipping`);
        } else {
          throw err;
        }
      }
      if (teamsResult !== undefined && teamsResult.status === 200) {
        const teamKeys = tbaKeysResponseSchema.parse(teamsResult.body) ?? [];
        const fetchedAt = new Date().toISOString();
        for (const teamKey of teamKeys) {
          upsertEventTeam(db, { eventKey, teamKey, fetchedAt });
          registrationRowCount++;
        }
        if (teamsResult.etag) writeEtag(db, teamsUrl, teamsResult.etag);
      } else if (teamsResult !== undefined) {
        console.log(`  ${teamsUrl}: 304 Not Modified`);
      }

      // revision R2a: award recipients for this same district event
      // (regular or DCMP -- both are members of districtEventKeys above).
      const awardsUrl = `/event/${eventKey}/awards`;
      let awardsResult: Awaited<ReturnType<typeof fetchEventAwards>> | undefined;
      try {
        awardsResult = await fetchEventAwards(ctx, eventKey, cachedEtagFor(db, awardsUrl, force));
      } catch (err) {
        if (err instanceof Error && /HTTP 404/.test(err.message)) {
          console.log(`  ${awardsUrl}: 404 Not Found, skipping`);
        } else {
          throw err;
        }
      }
      if (awardsResult !== undefined && awardsResult.status === 200) {
        const parsedAwards = tbaEventAwardsResponseSchema.parse(awardsResult.body);
        const fetchedAt = new Date().toISOString();
        for (const award of normalizeEventAwards(parsedAwards)) {
          upsertEventAward(db, { eventKey, awardType: award.awardType, teamKey: award.teamKey, year, fetchedAt });
          awardRowCount++;
        }
        if (awardsResult.etag) writeEtag(db, awardsUrl, awardsResult.etag);
      } else if (awardsResult !== undefined) {
        console.log(`  ${awardsUrl}: 304 Not Modified`);
      }
    }
  }

  console.log(
    `Season ${year}: ${districtKeys.length} districts, ${rankingRowCount} ranking rows, ` +
      `${districtEventCount} district events, ${registrationRowCount} registration rows, ` +
      `${awardRowCount} award recipient rows` +
      (missingEventKeys.length > 0
        ? `, ${missingEventKeys.length} district event key(s) absent from corpus events: ${missingEventKeys.join(", ")}`
        : "")
  );
}

/**
 * revision R2a: resolves ONLY award recipients for one season via TBA's
 * `/event/{key}/awards`, one request per district event, and stores the
 * result in `event_awards`. Runs standalone over an ALREADY-INGESTED season
 * -- it reads the district-event-key set from the corpus's OWN `events`
 * table (`district_key IS NOT NULL`, already filled by a prior
 * `--districts-only` or plain ingest run), never re-fetching
 * `/districts/{year}` or `/district/{key}/rankings` the way
 * `ingestSeasonDistrictsOnly` does. This is deliberately a NARROWER,
 * standalone mode so the orchestrator can backfill award data onto a corpus
 * that already has real district rankings without needing `--force` (which
 * would re-fetch and re-parse every ranking row's `event_points_raw` for no
 * reason).
 *
 * Same caching rule as every other `*-only` mode: a re-run over an
 * already-ingested season needs `--force`, because a cached-ETag 304 carries
 * no body.
 */
async function ingestSeasonAwardsOnly(db: Corpus, ctx: TbaClientContext, year: number, force: boolean): Promise<void> {
  const districtEventKeys = (
    db
      .prepare(`SELECT event_key FROM events WHERE year = ? AND district_key IS NOT NULL ORDER BY event_key ASC`)
      .all(year) as { event_key: string }[]
  ).map((r) => r.event_key);

  let populatedCount = 0;
  let nullBodyCount = 0;
  let emptyAwardsCount = 0;
  let cacheHitCount = 0;
  let notFoundCount = 0;
  let recipientRowCount = 0;

  for (const eventKey of districtEventKeys) {
    const awardsUrl = `/event/${eventKey}/awards`;
    let result: Awaited<ReturnType<typeof fetchEventAwards>>;
    try {
      result = await fetchEventAwards(ctx, eventKey, cachedEtagFor(db, awardsUrl, force));
    } catch (err) {
      // Mirrors ingestSeasonMediaOnly's/ingestSeasonAlliancesOnly's 404
      // handling: a placeholder/unregistered event key 404ing is an honest
      // "nothing to fetch" for this event, not TBA schema drift.
      if (err instanceof Error && /HTTP 404/.test(err.message)) {
        notFoundCount++;
        console.log(`  ${awardsUrl}: 404 Not Found, skipping`);
        continue;
      }
      throw err;
    }
    if (result.status === 304) {
      cacheHitCount++;
      continue;
    }

    const parsed = tbaEventAwardsResponseSchema.parse(result.body);
    if (parsed === null) {
      nullBodyCount++;
    } else if (parsed.length === 0) {
      emptyAwardsCount++;
    } else {
      populatedCount++;
    }

    const normalized = normalizeEventAwards(parsed);
    const fetchedAt = new Date().toISOString();
    for (const award of normalized) {
      upsertEventAward(db, { eventKey, awardType: award.awardType, teamKey: award.teamKey, year, fetchedAt });
      recipientRowCount++;
    }
    if (result.etag) writeEtag(db, awardsUrl, result.etag);
  }

  console.log(
    `Season ${year}: ${districtEventKeys.length} district events (${populatedCount} populated, ${nullBodyCount} null-body, ` +
      `${emptyAwardsCount} empty-awards, ${cacheHitCount} cache hits this run, ${notFoundCount} not-found), ` +
      `${recipientRowCount} award recipient rows stored`
  );
}

/**
 * quick task 260905-tll Task 3 (C-16): resolves registered teams for EVERY
 * official event of one season via TBA's `/event/{key}/teams/keys`, one
 * request per event, and stores the result in `event_teams`. Before this
 * mode, `event_teams` was populated only inside `ingestSeasonDistrictsOnly`'s
 * per-district-event loop, covering 150 of 2026's 310 events and ZERO
 * regionals, championships, preseason or offseason events — which left the
 * scheduleless-event publish path (`packages/harness/publish.ts`'s roster
 * fallback) with almost nothing to publish.
 *
 * Runs standalone over an ALREADY-INGESTED season: the official-event-key
 * set comes from the corpus's OWN `events` table
 * (`selectOfficialEventKeysForYear`, gated on the shared
 * `isOfficialEventType` predicate), never a re-fetch of `/events/{year}` —
 * mirroring `ingestSeasonAwardsOnly`'s narrower-standalone-mode shape
 * directly above.
 *
 * Same caching rule as every other `*-only` mode: a re-run over an
 * already-ingested season needs `--force`, because a cached-ETag 304 carries
 * no body.
 */
async function ingestSeasonEventTeamsOnly(db: Corpus, ctx: TbaClientContext, year: number, force: boolean): Promise<void> {
  const eventKeys = selectOfficialEventKeysForYear(db, year);

  let populatedCount = 0;
  let nullBodyCount = 0;
  let emptyRosterCount = 0;
  let cacheHitCount = 0;
  let notFoundCount = 0;
  let registrationRowCount = 0;

  for (const eventKey of eventKeys) {
    const teamsUrl = eventTeamsUrlFor(eventKey);
    let result: Awaited<ReturnType<typeof fetchEventTeamKeys>>;
    try {
      result = await fetchEventTeamKeys(ctx, eventKey, cachedEtagFor(db, teamsUrl, force));
    } catch (err) {
      // Mirrors ingestSeasonAwardsOnly's 404 handling: a placeholder/
      // unregistered event key 404ing is an honest "nothing to fetch" for
      // this event, not TBA schema drift — logged and skipped, never a
      // thrown run failure.
      if (err instanceof Error && /HTTP 404/.test(err.message)) {
        notFoundCount++;
        console.log(`  ${teamsUrl}: 404 Not Found, skipping`);
        continue;
      }
      throw err;
    }
    if (result.status === 304) {
      cacheHitCount++;
      continue;
    }

    const teamKeys = tbaKeysResponseSchema.parse(result.body);
    if (teamKeys === null) {
      nullBodyCount++;
    } else if (teamKeys.length === 0) {
      emptyRosterCount++;
    } else {
      populatedCount++;
    }

    const fetchedAt = new Date().toISOString();
    for (const teamKey of teamKeys ?? []) {
      upsertEventTeam(db, { eventKey, teamKey, fetchedAt });
      registrationRowCount++;
    }
    if (result.etag) writeEtag(db, teamsUrl, result.etag);
  }

  console.log(
    `Season ${year}: ${eventKeys.length} official events (${populatedCount} populated, ${nullBodyCount} null-body, ` +
      `${emptyRosterCount} empty-roster, ${cacheHitCount} cache hits this run, ${notFoundCount} not-found), ` +
      `${registrationRowCount} registration rows stored`
  );
}

/**
 * quick task 260912-5n8 T1: resolves EVERY award of EVERY type at EVERY
 * event of one season via `/event/{key}/awards`, one request per event, and
 * stores the result in `event_awards_all` — the research table that lives
 * alongside `event_awards` without replacing it.
 *
 * The difference from `ingestSeasonAwardsOnly` above is entirely in what is
 * KEPT, not in how it is fetched — same endpoint, same throttle, same 404
 * handling:
 *
 *   * Every event, not just district events (`selectAllEventKeysForYear`),
 *     and offseason/preseason events included on purpose.
 *   * Every award type and every recipient (`normalizeEventAwardsAll`),
 *     including person-only recipients with a null team_key.
 *   * Delete-then-insert per event (`replaceEventAwardsAll`), because the
 *     new table's key is positional and a shrinking award list must not
 *     leave stale rows behind.
 *   * A SEPARATE ETag namespace (`eventAwardsAllEtagKey` → `...#all`). This
 *     is the mode's single most important detail: `--awards-only` has
 *     already cached the bare `/event/{key}/awards` key for every district
 *     event, so reusing it would 304-with-no-body on precisely the events
 *     that have awards and store nothing while looking successful. That is
 *     also why the summary line below prints the 304 count FIRST — a run
 *     that 304s everything is the one failure mode that otherwise reads as
 *     a clean success.
 */
async function ingestSeasonAwardsAllOnly(
  db: Corpus,
  ctx: TbaClientContext,
  year: number,
  force: boolean
): Promise<void> {
  const eventKeys = selectAllEventKeysForYear(db, year);

  let populatedCount = 0;
  let nullBodyCount = 0;
  let emptyAwardsCount = 0;
  let cacheHitCount = 0;
  let notFoundCount = 0;
  let recipientRowCount = 0;
  const awardTypesSeen = new Set<number>();

  for (const eventKey of eventKeys) {
    const etagKey = eventAwardsAllEtagKey(eventKey);
    let result: Awaited<ReturnType<typeof fetchEventAwards>>;
    try {
      result = await fetchEventAwards(ctx, eventKey, cachedEtagFor(db, etagKey, force));
    } catch (err) {
      // Mirrors ingestSeasonAwardsOnly's/ingestSeasonEventTeamsOnly's 404
      // handling: a placeholder/unregistered event key 404ing is an honest
      // "nothing to fetch" for this event, not TBA schema drift.
      if (err instanceof Error && /HTTP 404/.test(err.message)) {
        notFoundCount++;
        console.log(`  ${etagKey}: 404 Not Found, skipping`);
        continue;
      }
      throw err;
    }
    if (result.status === 304) {
      cacheHitCount++;
      continue;
    }

    const parsed = tbaEventAwardsResponseSchema.parse(result.body);
    if (parsed === null) {
      nullBodyCount++;
    } else if (parsed.length === 0) {
      emptyAwardsCount++;
    } else {
      populatedCount++;
    }

    const normalized = normalizeEventAwardsAll(parsed);
    const fetchedAt = new Date().toISOString();
    // Unconditional, including when `normalized` is empty: an event whose
    // awards were REMOVED upstream must end with zero stored rows, not with
    // its previous rows preserved by a skipped write.
    replaceEventAwardsAll(
      db,
      eventKey,
      normalized.map((award) => ({
        awardType: award.awardType,
        awardIndex: award.awardIndex,
        recipientIndex: award.recipientIndex,
        teamKey: award.teamKey,
        awardee: award.awardee,
        name: award.name,
        year,
        fetchedAt,
      }))
    );
    recipientRowCount += normalized.length;
    for (const award of normalized) awardTypesSeen.add(award.awardType);

    // writeEtag runs AFTER the replace, deliberately — an interrupted run
    // must never leave a cached ETag whose body was never stored, because
    // the next un-forced run would then 304 past it forever.
    if (result.etag) writeEtag(db, etagKey, result.etag);
  }

  console.log(
    `Season ${year}: ${cacheHitCount} CACHE HITS / 304s (no body, nothing stored) of ${eventKeys.length} events — ` +
      `${populatedCount} populated, ${nullBodyCount} null-body, ${emptyAwardsCount} empty-awards, ` +
      `${notFoundCount} not-found; ${recipientRowCount} recipient rows stored across ` +
      `${awardTypesSeen.size} distinct award types`
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
    } else if (options.districtsOnly) {
      for (let year = options.seasonStart; year <= options.seasonEnd; year++) {
        await ingestSeasonDistrictsOnly(db, ctx, year, options.force);
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
    } else if (options.awardsOnly) {
      for (let year = options.seasonStart; year <= options.seasonEnd; year++) {
        await ingestSeasonAwardsOnly(db, ctx, year, options.force);
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
    } else if (options.awardsAllOnly) {
      for (let year = options.seasonStart; year <= options.seasonEnd; year++) {
        await ingestSeasonAwardsAllOnly(db, ctx, year, options.force);
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
    } else if (options.eventTeamsOnly) {
      for (let year = options.seasonStart; year <= options.seasonEnd; year++) {
        await ingestSeasonEventTeamsOnly(db, ctx, year, options.force);
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
