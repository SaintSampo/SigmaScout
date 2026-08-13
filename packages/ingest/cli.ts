/**
 * Backfill entry point over a season range (DATA-01/DATA-02):
 *
 *   pnpm ingest --years 2022-2026
 *   pnpm ingest --year 2024
 *   pnpm ingest --event 2024casj
 *   pnpm ingest --years 2022-2026 --force   (bypass the ETag cache)
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
  upsertEvent,
  upsertMatch,
  upsertTeam,
  writeEtag,
  type Corpus,
} from "../corpus/db.js";
import { normalizeEvent, normalizeMatch } from "./normalize.js";
import {
  tbaEventListSchema,
  tbaEventSchema,
  tbaMatchListSchema,
  tbaStatusSchema,
  tbaTeamListSchema,
} from "./schemas.js";
import {
  fetchAllTeams,
  fetchEventDetail,
  fetchEventMatches,
  fetchEventsList,
  fetchStatus,
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
    },
  });

  if (values.event) {
    return { seasonStart: 0, seasonEnd: 0, eventKey: values.event, force: values.force ?? false };
  }
  if (values.years) {
    const [seasonStart, seasonEnd] = parseYearsRange(values.years);
    return { seasonStart, seasonEnd, eventKey: undefined, force: values.force ?? false };
  }
  if (values.year) {
    const year = Number(values.year);
    if (!Number.isInteger(year)) throw new Error(`--year must be an integer, got "${values.year}"`);
    return { seasonStart: year, seasonEnd: year, eventKey: undefined, force: values.force ?? false };
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
