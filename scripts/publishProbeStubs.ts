/**
 * Publishes ONLY the probe-window STUB event artifacts (quick task 260921-5qw):
 * about 120 small objects, where a full `pnpm publish:seasons` to get the same
 * stubs out would rewrite about 109,000 against R2's 1,000,000 a month free
 * tier. A stub needs no replay: it is identity plus the season's `tierCuts`,
 * and `publish.test.ts` pins `buildProbeStubArtifact` byte-equal to what the
 * season loop emits, so the next full republish overwrites each stub with the
 * same body under a new generation stamp.
 *
 * WHAT IT WILL NOT DO. It never overwrites: an event that already has an
 * artifact on the public origin is SKIPPED, whether that artifact came from a
 * publish or from a live Worker that has already promoted the event. It reads
 * the algorithm versions and the generation from the LIVE manifest, never from
 * the working tree, so it cannot publish under a version that is not live. It
 * copies `tierCuts` from a live, played event of the same season and
 * algorithm, and refuses an algorithm it cannot find one for.
 *
 * Credentials never pass through this file: `putObject` reads `.env` inside
 * `packages/harness/r2Client.ts`. Run it through `--env-file`, like a publish.
 *
 *   npx tsx --env-file=.env scripts/publishProbeStubs.ts --dry-run
 *   npx tsx --env-file=.env scripts/publishProbeStubs.ts
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { openCorpusReadOnly, type Corpus } from "../packages/corpus/db.js";
import { artifactKey, EventArtifactSchema } from "../packages/harness/pageArtifacts.js";
import { probeWindowFor } from "../packages/harness/manifests.js";
import { buildProbeStubArtifact } from "../packages/harness/publish.js";
import { putObject } from "../packages/harness/r2Client.js";

const CORPUS_PATH = join("data", "corpus.sqlite");
const ORIGIN = "https://data.sigmascout.org";
const BUCKET = "sigmascout-artifacts";
const UPLOAD_HEADERS = { contentType: "application/json", cacheControl: "public, max-age=60" } as const;

export interface StubEventRow {
  readonly event_key: string;
  readonly event_type: number;
  readonly start_date: string;
  readonly name: string;
  readonly week: number | null;
  readonly country: string | null;
  readonly state_prov: string | null;
}

/**
 * The events that get a stub: no match of any kind, no registered roster, and a
 * probe window still open at `nowMs`. The same three conditions under which the
 * season loop reaches its stub branch, with `probeWindowFor` shared by name.
 */
export function selectStubEvents(db: Corpus, season: number, nowMs: number): StubEventRow[] {
  const rows = db
    .prepare(
      `SELECT e.event_key, e.event_type, e.start_date, e.name, e.week, e.country, e.state_prov
       FROM events e
       WHERE e.year = ?
         AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.event_key = e.event_key)
         AND NOT EXISTS (SELECT 1 FROM event_teams t WHERE t.event_key = e.event_key)
       ORDER BY e.event_key ASC`
    )
    .all(season) as StubEventRow[];
  return rows.filter((row) => probeWindowFor(row.start_date, nowMs) !== undefined);
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { headers: { Origin: "https://sigmascout.org" } });
  return { status: res.status, body: res.ok ? ((await res.json()) as unknown) : undefined };
}

async function main(argv: readonly string[]): Promise<void> {
  const { values } = parseArgs({ args: [...argv], options: { "dry-run": { type: "boolean", default: false }, season: { type: "string" } } });
  const dryRun = values["dry-run"] === true;
  const season = values.season !== undefined ? Number(values.season) : new Date().getUTCFullYear();
  if (!Number.isInteger(season)) throw new Error(`--season must be an integer, got "${values.season}"`);

  const manifest = await getJson(`${ORIGIN}/v1/manifest/algorithms.json`);
  if (manifest.status !== 200) throw new Error(`the live algorithms manifest answered ${manifest.status}`);
  const { generation, algorithms } = manifest.body as { generation: string; algorithms: { id: string; version: string }[] };
  const computedAt = new Date().toISOString();

  const db = openCorpusReadOnly(CORPUS_PATH);
  let events: StubEventRow[];
  let donorKeys: string[];
  try {
    events = selectStubEvents(db, season, Date.parse(computedAt));
    // Played events of the season, most matches first: the donors `tierCuts` is copied from.
    donorKeys = (
      db
        .prepare(
          `SELECT e.event_key FROM events e JOIN matches m ON m.event_key = e.event_key
           WHERE e.year = ? AND m.red_score >= 0 GROUP BY e.event_key ORDER BY COUNT(*) DESC LIMIT 5`
        )
        .all(season) as { event_key: string }[]
    ).map((row) => row.event_key);
  } finally {
    db.close();
  }
  console.log(`season ${season}, live generation ${generation}: ${events.length} probe-window event(s) with no artifact data, ${algorithms.length} algorithm(s)`);

  let written = 0;
  let skipped = 0;
  for (const algorithm of algorithms) {
    let tierCuts: unknown;
    for (const donor of donorKeys) {
      const got = await getJson(`${ORIGIN}/${artifactKey({ page: "event", eventKey: donor, algorithmId: algorithm.id, version: algorithm.version })}`);
      const cuts = got.status === 200 ? (got.body as { tierCuts?: unknown }).tierCuts : undefined;
      if (cuts !== undefined) {
        tierCuts = cuts;
        break;
      }
    }
    if (tierCuts === undefined) throw new Error(`no live ${season} event carries tierCuts for ${algorithm.id}@${algorithm.version}; refusing to publish stubs without them`);

    for (const event of events) {
      const key = artifactKey({ page: "event", eventKey: event.event_key, algorithmId: algorithm.id, version: algorithm.version });
      const existing = await fetch(`${ORIGIN}/${key}`, { method: "HEAD", headers: { Origin: "https://sigmascout.org" } });
      if (existing.status !== 404) {
        // 200: published, or already promoted by the live Worker. Anything else: not provably absent.
        skipped++;
        console.log(`  skip ${key} (origin answered ${existing.status})`);
        continue;
      }
      const stub = EventArtifactSchema.parse(
        buildProbeStubArtifact({ event, season, algorithmId: algorithm.id, algorithmVersion: algorithm.version, generation, computedAt, tierCuts: tierCuts as never })
      );
      if (!dryRun) await putObject(BUCKET, key, JSON.stringify(stub), UPLOAD_HEADERS);
      written++;
    }
  }
  console.log(`${dryRun ? "DRY RUN, would write" : "wrote"} ${written} stub(s), skipped ${skipped} that already exist`);
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  void main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
