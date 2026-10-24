/**
 * Reads a roster-only season back from the live origin and checks it by content (quick task 261024-lfa).
 *
 * WHY THIS SCRIPT EXISTS. `pnpm publish:roster-seasons` writes a roster-only season (2027 until its game
 * rules are registered) without rewriting any manifest. The site finds those objects only because their
 * keys carry the algorithm versions the LIVE algorithms manifest already names. So the run can succeed,
 * every upload can return 200, and the site can still read nothing, if this checkout's versions differ
 * from the live manifest's. This script is the proof step that closes that gap before anyone moves
 * `CURRENT_SEASON` (publish-then-reveal).
 *
 * WHAT IT CHECKS, per roster-only season in `--seasons`:
 *
 * 1. The live algorithms manifest names, for every published algorithm, the exact version this checkout
 *    publishes. A mismatch is reported FIRST, and that algorithm's pages are not fetched: the run wrote
 *    keys the site does not read, so there is nothing meaningful to compare.
 * 2. The events list answers 200, parses through the publisher's own `EventsArtifactSchema`, and lists
 *    exactly the corpus's events for the season (minus the ones `isCancelledEvent` judges cancelled),
 *    each with the registered roster's size as `teamCount` (demo keys excluded) and zero matches.
 * 3. The teams list answers 200 and holds zero teams.
 * 4. The event page of the event with the largest roster answers 200, parses through
 *    `EventArtifactSchema`, and carries exactly that roster, no matches, no upcoming matches and the
 *    corpus name.
 *
 * It prints VERIFIED and the one-line reveal, or every problem and exits 1.
 *
 * This script needs NO credential of any kind, exactly like `scripts/verifySubsetPublish.ts`: it reads no
 * environment variable, signs no request, and never imports `packages/harness/r2Client.ts`. It also never
 * imports `packages/harness/publish.ts`, whose import graph reaches that client; the expected event list
 * comes from a small query of its own, fed through the same `isCancelledEvent` predicate the publisher
 * applies. Every fetch carries a per-run cache-busting query and `cache: "no-store"`.
 *
 *   npx tsx scripts/verifyRosterSeason.ts --seasons 2016-2020,2022-2027
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { openCorpusReadOnly, selectEventTeamsForEvents, type Corpus } from "../packages/corpus/db.js";
import { isCancelledEvent } from "../packages/core/algorithms/cancelledEvent.js";
import { isDemoTeamKey } from "../packages/core/algorithms/demoTeams.js";
import { PUBLISHED_ALGORITHM_MODULES } from "../packages/harness/manifests.js";
import { AlgorithmsManifestSchema } from "../packages/harness/manifestSchemas.js";
import { artifactKey, EventArtifactSchema, EventsArtifactSchema } from "../packages/harness/pageArtifacts.js";
import { selectRosterOnlySeasons } from "../packages/harness/rosterOnlySeason.js";
import { parseSeasonSpec } from "../packages/harness/seasonSpec.js";
import { ALGORITHMS_MANIFEST_KEY, DEFAULT_ARTIFACT_ORIGIN, fetchArtifactFresh, type FreshFetchResult } from "./verifySubsetPublish.js";

const CORPUS_PATH = join("data", "corpus.sqlite");

// ---------------------------------------------------------------------------
// Expected, from the corpus
// ---------------------------------------------------------------------------

export interface ExpectedRosterEvent {
  readonly eventKey: string;
  /** The events list row's name: the corpus name, or the event key when it has none. */
  readonly listName: string;
  /** The event page's name: the corpus name, or the event key when it is null or empty. */
  readonly pageName: string;
  /** The registered roster minus demo keys, sorted. Empty when the roster is unknown. */
  readonly teamKeys: readonly string[];
}

export interface ExpectedRosterSeason {
  readonly season: number;
  /** Sorted by event key, the order the publisher lists them in. */
  readonly events: readonly ExpectedRosterEvent[];
}

interface EventRow {
  event_key: string;
  name: string | null;
  start_date: string;
}

/**
 * The season's events as the publisher would write them at `nowMs`: every corpus event minus those
 * `isCancelledEvent` judges cancelled (zero played matches and a start date long past), each with its
 * registered roster minus demo keys.
 */
export function expectedRosterSeason(db: Corpus, season: number, nowMs: number): ExpectedRosterSeason {
  const rows = db.prepare(`SELECT event_key, name, start_date FROM events WHERE year = ? ORDER BY event_key ASC`).all(season) as EventRow[];
  const played = new Map(
    (
      db
        .prepare(
          `SELECT m.event_key AS event_key, COUNT(*) AS played
           FROM matches m JOIN events e ON e.event_key = m.event_key
           WHERE e.year = ? AND m.winner IS NOT NULL
           GROUP BY m.event_key`
        )
        .all(season) as { event_key: string; played: number }[]
    ).map((r) => [r.event_key, r.played])
  );
  const kept = rows.filter((r) => !isCancelledEvent({ startDate: r.start_date, playedMatchCount: played.get(r.event_key) ?? 0 }, nowMs));
  const rosters = selectEventTeamsForEvents(
    db,
    kept.map((r) => r.event_key)
  );
  return {
    season,
    events: kept.map((r) => ({
      eventKey: r.event_key,
      listName: r.name ?? r.event_key,
      pageName: r.name !== null && r.name.length > 0 ? r.name : r.event_key,
      teamKeys: (rosters.get(r.event_key) ?? []).filter((k) => !isDemoTeamKey(k)).sort(),
    })),
  };
}

/** The event with the largest roster; ties go to the smallest event key. `undefined` for a season with no events. */
export function largestRosterEvent(expected: ExpectedRosterSeason): ExpectedRosterEvent | undefined {
  let best: ExpectedRosterEvent | undefined;
  for (const e of expected.events) {
    if (best === undefined || e.teamKeys.length > best.teamKeys.length || (e.teamKeys.length === best.teamKeys.length && e.eventKey < best.eventKey)) {
      best = e;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The pure comparison
// ---------------------------------------------------------------------------

export interface ObservedObject {
  readonly key: string;
  readonly status: number;
  readonly body: string | undefined;
}

export interface ObservedRosterAlgorithm {
  readonly algorithmId: string;
  readonly version: string;
  readonly eventsList: ObservedObject;
  readonly teamsList: ObservedObject;
  /** The largest roster event's page. Absent only when the season has no events. */
  readonly eventPage?: ObservedObject;
}

function parseBody(obj: ObservedObject, problems: string[]): unknown {
  if (obj.status !== 200 || obj.body === undefined) {
    problems.push(`${obj.key} answered ${obj.status}, expected 200`);
    return undefined;
  }
  try {
    return JSON.parse(obj.body) as unknown;
  } catch {
    problems.push(`${obj.key} is not valid JSON`);
    return undefined;
  }
}

/** Every way one algorithm's roster-season objects differ from the corpus, one string per problem. Empty means it matches. */
export function compareRosterSeason(expected: ExpectedRosterSeason, observed: ObservedRosterAlgorithm): string[] {
  const problems: string[] = [];
  const { season } = expected;

  // The events list.
  const eventsRaw = parseBody(observed.eventsList, problems);
  if (eventsRaw !== undefined) {
    const parsed = EventsArtifactSchema.safeParse(eventsRaw);
    if (!parsed.success) {
      problems.push(`${observed.eventsList.key} does not parse as an events list: ${parsed.error.message}`);
    } else {
      const list = parsed.data;
      if (list.season !== season) problems.push(`${observed.eventsList.key} carries season ${list.season}, expected ${season}`);
      const expectedByKey = new Map(expected.events.map((e) => [e.eventKey, e]));
      const observedKeys = new Set(list.events.map((e) => e.eventKey));
      const missing = expected.events.filter((e) => !observedKeys.has(e.eventKey)).map((e) => e.eventKey);
      const extra = list.events.filter((e) => !expectedByKey.has(e.eventKey)).map((e) => e.eventKey);
      if (missing.length > 0) problems.push(`${observed.eventsList.key} is missing ${missing.length} corpus event(s): ${missing.join(", ")}`);
      if (extra.length > 0) problems.push(`${observed.eventsList.key} lists ${extra.length} event(s) the corpus does not expect: ${extra.join(", ")}`);
      for (const row of list.events) {
        const want = expectedByKey.get(row.eventKey);
        if (want === undefined) continue;
        if (row.teamCount !== want.teamKeys.length) {
          problems.push(`${observed.eventsList.key}: ${row.eventKey} has teamCount ${row.teamCount}, the corpus roster has ${want.teamKeys.length}`);
        }
        if (row.matchCount !== 0 || row.playedMatchCount !== 0) {
          problems.push(`${observed.eventsList.key}: ${row.eventKey} has matchCount ${row.matchCount} and playedMatchCount ${row.playedMatchCount}, expected 0 and 0`);
        }
        if (row.name !== want.listName) problems.push(`${observed.eventsList.key}: ${row.eventKey} is named "${row.name}", the corpus says "${want.listName}"`);
      }
    }
  }

  // The teams list. A plain field read: the wire form packs metrics positionally, and only the row count matters here.
  const teamsRaw = parseBody(observed.teamsList, problems);
  if (teamsRaw !== undefined) {
    const teams = (teamsRaw as { teams?: unknown }).teams;
    if (!Array.isArray(teams)) problems.push(`${observed.teamsList.key} carries no "teams" array`);
    else if (teams.length !== 0) problems.push(`${observed.teamsList.key} holds ${teams.length} team(s), expected 0 for a roster-only season`);
  }

  // The largest roster event's page.
  const target = largestRosterEvent(expected);
  if (target === undefined) {
    problems.push(`the corpus holds no ${season} events: run the ingest before verifying`);
  } else if (observed.eventPage === undefined) {
    problems.push(`no event page was read for ${target.eventKey}`);
  } else {
    const pageRaw = parseBody(observed.eventPage, problems);
    if (pageRaw !== undefined) {
      const parsed = EventArtifactSchema.safeParse(pageRaw);
      if (!parsed.success) {
        problems.push(`${observed.eventPage.key} does not parse as an event page: ${parsed.error.message}`);
      } else {
        const page = parsed.data;
        const observedTeams = page.teams.map((t) => t.teamKey).sort();
        const same = observedTeams.length === target.teamKeys.length && observedTeams.every((k, i) => k === target.teamKeys[i]);
        if (!same) {
          problems.push(
            `${observed.eventPage.key}: ${target.eventKey} lists ${observedTeams.length} team(s), the corpus roster has ${target.teamKeys.length}` +
              ` (missing: ${target.teamKeys.filter((k) => !observedTeams.includes(k)).join(", ") || "none"};` +
              ` extra: ${observedTeams.filter((k) => !target.teamKeys.includes(k)).join(", ") || "none"})`
          );
        }
        if (page.matches.length !== 0 || page.upcoming.length !== 0) {
          problems.push(`${observed.eventPage.key}: ${target.eventKey} carries ${page.matches.length} match(es) and ${page.upcoming.length} upcoming, expected none`);
        }
        if (page.name !== target.pageName) problems.push(`${observed.eventPage.key}: ${target.eventKey} is named "${page.name ?? "(none)"}", the corpus says "${target.pageName}"`);
      }
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export interface VerifyRosterSeasonsOptions {
  readonly seasons: readonly number[];
}

export interface VerifyRosterSeasonsDeps {
  readonly fetchFresh?: (key: string) => Promise<FreshFetchResult>;
  /** Opens the corpus. The verifier closes it. */
  readonly openDb?: () => Corpus;
  readonly nowMs?: number;
  readonly log?: (line: string) => void;
}

export interface VerifyRosterSeasonsResult {
  readonly rosterSeasons: readonly number[];
  readonly problems: readonly string[];
  readonly lines: readonly string[];
}

export async function verifyRosterSeasons(options: VerifyRosterSeasonsOptions, deps: VerifyRosterSeasonsDeps = {}): Promise<VerifyRosterSeasonsResult> {
  const rosterSeasons = selectRosterOnlySeasons(options.seasons);
  if (rosterSeasons.length === 0) {
    throw new Error(
      `verifyRosterSeason: --seasons names no roster-only season (${options.seasons.join(", ")}). ` +
        `Every season in it has registered game rules, so there is nothing roster-only to read back.`
    );
  }
  const runId = randomUUID();
  const fetchFresh = deps.fetchFresh ?? ((key: string) => fetchArtifactFresh(DEFAULT_ARTIFACT_ORIGIN, key, runId));
  const openDb = deps.openDb ?? (() => openCorpusReadOnly(CORPUS_PATH));
  const nowMs = deps.nowMs ?? Date.now();
  const lines: string[] = [];
  const problems: string[] = [];
  const log = (line: string): void => {
    lines.push(line);
    (deps.log ?? console.log)(line);
  };

  // 1. The live algorithms manifest against this checkout.
  const manifestObj = await fetchFresh(ALGORITHMS_MANIFEST_KEY);
  const manifestProblems: string[] = [];
  const manifestRaw = parseBody({ key: ALGORITHMS_MANIFEST_KEY, ...manifestObj }, manifestProblems);
  const okAlgorithms: { id: string; version: string }[] = [];
  if (manifestRaw !== undefined) {
    const parsed = AlgorithmsManifestSchema.safeParse(manifestRaw);
    if (!parsed.success) {
      manifestProblems.push(`${ALGORITHMS_MANIFEST_KEY} does not parse as the algorithms manifest: ${parsed.error.message}`);
    } else {
      const liveById = new Map(parsed.data.algorithms.map((a) => [a.id, a.version]));
      for (const a of parsed.data.algorithms) {
        if (PUBLISHED_ALGORITHM_MODULES[a.id] === undefined) {
          manifestProblems.push(`the live manifest names ${a.id}@${a.version}, which this checkout does not publish`);
        }
      }
      for (const [id, mod] of Object.entries(PUBLISHED_ALGORITHM_MODULES)) {
        const live = liveById.get(id);
        if (live === undefined) {
          manifestProblems.push(`the live manifest does not name ${id}, which this checkout publishes as ${id}@${mod.version}: the site will not read it`);
        } else if (live !== mod.version) {
          manifestProblems.push(
            `the live manifest names ${id}@${live}, this checkout publishes ${id}@${mod.version}: the roster publish wrote keys the site does not read; do not reveal`
          );
        } else {
          okAlgorithms.push({ id, version: live });
        }
      }
    }
  }
  for (const p of manifestProblems) log(`PROBLEM: ${p}`);
  problems.push(...manifestProblems);

  // 2. Expected, from the corpus.
  const db = openDb();
  let expectedBySeason: ExpectedRosterSeason[];
  try {
    expectedBySeason = rosterSeasons.map((season) => expectedRosterSeason(db, season, nowMs));
  } finally {
    db.close();
  }

  // 3. Each season and algorithm, read back.
  for (const expected of expectedBySeason) {
    const target = largestRosterEvent(expected);
    for (const { id, version } of okAlgorithms) {
      const fetchObj = async (key: string): Promise<ObservedObject> => ({ key, ...(await fetchFresh(key)) });
      const eventsKey = artifactKey({ page: "events", year: expected.season, algorithmId: id, version });
      const teamsKey = artifactKey({ page: "teams", year: expected.season, algorithmId: id, version });
      const observed: ObservedRosterAlgorithm = {
        algorithmId: id,
        version,
        eventsList: await fetchObj(eventsKey),
        teamsList: await fetchObj(teamsKey),
        ...(target !== undefined ? { eventPage: await fetchObj(artifactKey({ page: "event", eventKey: target.eventKey, algorithmId: id, version })) } : {}),
      };
      const found = compareRosterSeason(expected, observed);
      const rostered = expected.events.filter((e) => e.teamKeys.length > 0).length;
      log(
        `${expected.season} ${id}@${version}: ${found.length === 0 ? "ok" : `${found.length} problem(s)`}` +
          ` (${expected.events.length} events, ${rostered} with a roster${target !== undefined ? `, page ${target.eventKey} with ${target.teamKeys.length} teams` : ""})`
      );
      for (const p of found) log(`PROBLEM: ${p}`);
      problems.push(...found);
    }
  }

  if (problems.length === 0) {
    const ids = okAlgorithms.map((a) => a.id).join(", ");
    for (const season of rosterSeasons) {
      log(`VERIFIED: ${season} events list, teams list and event pages are live for ${ids}.`);
      log(`Reveal: set CURRENT_SEASON = ${season} in apps/web/src/lib/seasons.ts, run npx vitest run apps/web from the repo root, commit and push.`);
    }
  } else {
    log(`NOT VERIFIED: ${problems.length} problem(s) above. Do not reveal.`);
  }

  return { rosterSeasons, problems, lines };
}

async function main(argv: readonly string[]): Promise<void> {
  const { values } = parseArgs({ args: [...argv], options: { seasons: { type: "string" } } });
  if (values.seasons === undefined) throw new Error("verifyRosterSeason: --seasons <spec> is required, e.g. --seasons 2016-2020,2022-2027");
  const result = await verifyRosterSeasons({ seasons: parseSeasonSpec(values.seasons, "--seasons") });
  if (result.problems.length > 0) process.exitCode = 1;
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  void main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
