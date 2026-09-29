/**
 * Cleans already-published cancelled events out of R2 without a republish
 * (quick task 260929-mcf).
 *
 * WHY THIS EXISTS. The publisher now drops cancelled events at the source
 * (`isCancelledEvent`: zero played matches and `start_date` 7+ days before the
 * reference instant), but that only takes effect at the next full publish, and
 * a full `pnpm publish:seasons` is about 109,000 R2 writes. This script is at
 * most 30 PUTs (one events list per season per algorithm) plus free DELETEs.
 *
 * WHAT IT DOES. For every season in `SEASONS` and every algorithm in the live
 * manifest it reads the published events list, drops the rows the shared
 * predicate judges cancelled AT THE LIST'S OWN `computedAt` (a projection of
 * the published list, never a recompute, so the generation and every stamp
 * survive), and rewrites the list. Only after EVERY list is processed does it
 * delete the per-event artifact and the presim sidecar of each dropped event,
 * so no rewritten list ever links to an object that is already gone.
 *
 * KEY FACT. R2 keys are not generation-scoped (`event/{key}/{id}@{version}.json`
 * is overwritten in place), so `pnpm cleanup:r2-generations` can never remove
 * these objects: they belong to the LIVE generation.
 *
 * GUARDS.
 *   - Dry run unless `--execute` is passed.
 *   - A list whose `generation` differs from the live manifest's is skipped, not
 *     rewritten: it signals a concurrent publish, and this checkout is shared.
 *   - Every read is a fresh, cache-busted GET (`fetchArtifactFresh`).
 *   - An event artifact that carries a played match, or that does not parse, is
 *     never deleted: a played match means the live Worker folded something
 *     there. A status other than 200 or 404 also refuses (not provably absent).
 *   - Deletes are single-key, only for keys derived from rows the predicate dropped.
 *   - Any refusal sets `process.exitCode = 1`.
 *
 * NOT TOUCHED (residual until the next full rebaseline). Team-season artifacts
 * and Teams-list rows that still carry never-scored schedules, and the district
 * pipeline.
 *
 * Credentials never pass through this file: it does not read the environment at
 * all. They are read only inside `packages/harness/r2Client.ts`, through
 * `--env-file`.
 *
 *   pnpm prune:cancelled-events              (dry run)
 *   pnpm prune:cancelled-events --execute
 *
 * Standalone-script shape: `parseArgs`, `async function main()`, an entry-point guard.
 */
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { isCancelledEvent } from "../packages/core/algorithms/cancelledEvent.js";
import { artifactKey, EventsArtifactSchema, preScheduleKey, type EventsArtifact } from "../packages/harness/pageArtifacts.js";
import { deleteObject, putObject } from "../packages/harness/r2Client.js";
import { DEFAULT_LIVE_WINDOWS_SEASONS } from "./publishLiveWindows.js";
import { ALGORITHMS_MANIFEST_KEY, DEFAULT_ARTIFACT_ORIGIN, fetchArtifactFresh } from "./verifySubsetPublish.js";

const BUCKET = "sigmascout-artifacts";
const UPLOAD_HEADERS = { contentType: "application/json", cacheControl: "public, max-age=60" } as const;

/** The one season list: the same array `publishLiveWindows` exports, which its test pins to `publish:seasons`. */
export const SEASONS = DEFAULT_LIVE_WINDOWS_SEASONS;

/**
 * The published events list with every row cancelled at the list's OWN `computedAt` removed. Keeps the
 * generation, `computedAt`, algorithm stamps and season, and the surviving rows in order.
 */
export function projectEventsList(artifact: EventsArtifact): { artifact: EventsArtifact; droppedEventKeys: string[] } {
  const publishedAtMs = Date.parse(artifact.computedAt);
  const kept: EventsArtifact["events"] = [];
  const droppedEventKeys: string[] = [];
  for (const row of artifact.events) {
    if (isCancelledEvent(row, publishedAtMs)) droppedEventKeys.push(row.eventKey);
    else kept.push(row);
  }
  return { artifact: EventsArtifactSchema.parse({ ...artifact, events: kept }), droppedEventKeys };
}

/** The per-event artifact key then the presim sidecar key, for each event key, in input order. */
export function cancelledArtifactKeys(eventKeys: readonly string[], algorithm: { readonly id: string; readonly version: string }): string[] {
  return eventKeys.flatMap((eventKey) => [
    artifactKey({ page: "event", eventKey, algorithmId: algorithm.id, version: algorithm.version }),
    preScheduleKey({ eventKey, algorithmId: algorithm.id, version: algorithm.version }),
  ]);
}

/**
 * Why an event artifact body must NOT be deleted, or `undefined` when it is safe: it does not parse as
 * JSON, or its `matches` array is non-empty (a played match means the live Worker folded something there).
 */
export function refusalReason(body: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return "body is not valid JSON";
  }
  const matches = typeof parsed === "object" && parsed !== null ? (parsed as { matches?: unknown }).matches : undefined;
  if (!Array.isArray(matches)) return "body has no matches array";
  if (matches.length > 0) return `carries ${matches.length} played match(es)`;
  return undefined;
}

interface AlgorithmEntry {
  readonly id: string;
  readonly version: string;
}

interface Tally {
  season: number;
  algorithmId: string;
  dropped: number;
  list: "yes" | "no" | "skipped";
  deleted: number;
  absent: number;
  refused: number;
  droppedEventKeys: string[];
}

export async function main(argv: readonly string[]): Promise<void> {
  const { values } = parseArgs({ args: [...argv], options: { execute: { type: "boolean", default: false }, origin: { type: "string" } } });
  const execute = values.execute === true;
  const origin = values.origin ?? DEFAULT_ARTIFACT_ORIGIN;
  const runId = randomUUID();

  const manifestRes = await fetchArtifactFresh(origin, ALGORITHMS_MANIFEST_KEY, runId);
  if (manifestRes.status !== 200 || manifestRes.body === undefined) {
    console.error(`refusing: the live algorithms manifest answered ${manifestRes.status}`);
    process.exitCode = 1;
    return;
  }
  const manifest = JSON.parse(manifestRes.body) as { generation?: unknown; algorithms?: unknown };
  const algorithms = manifest.algorithms;
  if (typeof manifest.generation !== "string" || !Array.isArray(algorithms) || algorithms.length === 0) {
    console.error("refusing: the live algorithms manifest has no generation or no algorithms");
    process.exitCode = 1;
    return;
  }

  const tallies: Tally[] = [];

  // Phase 1: every events list, rewritten before anything is deleted.
  for (const season of SEASONS) {
    for (const algorithm of algorithms as AlgorithmEntry[]) {
      const tally: Tally = { season, algorithmId: algorithm.id, dropped: 0, list: "no", deleted: 0, absent: 0, refused: 0, droppedEventKeys: [] };
      tallies.push(tally);
      const key = artifactKey({ page: "events", year: season, algorithmId: algorithm.id, version: algorithm.version });
      const res = await fetchArtifactFresh(origin, key, runId);
      if (res.status === 404 || res.body === undefined) {
        console.log(`skip ${key}: origin answered ${res.status}`);
        tally.list = "skipped";
        continue;
      }
      const parsed = EventsArtifactSchema.safeParse(JSON.parse(res.body));
      if (!parsed.success) {
        console.log(`skip ${key}: the list does not parse`);
        tally.list = "skipped";
        continue;
      }
      if (parsed.data.generation !== manifest.generation) {
        console.log(`skip ${key}: generation ${parsed.data.generation} differs from the manifest's ${manifest.generation} (a concurrent publish?)`);
        tally.list = "skipped";
        continue;
      }
      const projected = projectEventsList(parsed.data);
      tally.dropped = projected.droppedEventKeys.length;
      if (tally.dropped === 0) continue;
      tally.droppedEventKeys = projected.droppedEventKeys;
      tally.list = "yes";
      if (execute) await putObject(BUCKET, key, JSON.stringify(projected.artifact), UPLOAD_HEADERS);
    }
  }

  // Phase 2: only now the per-event artifacts and presim sidecars of the dropped events.
  for (const tally of tallies) {
    if (tally.list !== "yes") continue;
    const algorithm = (algorithms as AlgorithmEntry[]).find((a) => a.id === tally.algorithmId)!;
    for (const eventKey of tally.droppedEventKeys) {
      const [eventObjectKey, presimKey] = cancelledArtifactKeys([eventKey], algorithm) as [string, string];
      const eventRes = await fetchArtifactFresh(origin, eventObjectKey, runId);
      if (eventRes.status === 404) {
        tally.absent += 1;
      } else if (eventRes.status !== 200 || eventRes.body === undefined) {
        tally.refused += 1;
        console.error(`refuse ${eventObjectKey}: origin answered ${eventRes.status}, not provably absent`);
        continue;
      } else {
        const reason = refusalReason(eventRes.body);
        if (reason !== undefined) {
          tally.refused += 1;
          console.error(`refuse ${eventObjectKey}: ${reason}`);
          continue;
        }
        if (execute) await deleteObject(BUCKET, eventObjectKey);
        tally.deleted += 1;
      }
      // The presim sidecar: a 404 is normal (only spr publishes them) and counts as absent.
      const presimRes = await fetchArtifactFresh(origin, presimKey, runId);
      if (presimRes.status === 404) {
        tally.absent += 1;
      } else if (presimRes.status === 200) {
        if (execute) await deleteObject(BUCKET, presimKey);
        tally.deleted += 1;
      } else {
        tally.refused += 1;
        console.error(`refuse ${presimKey}: origin answered ${presimRes.status}, not provably absent`);
      }
    }
  }

  console.log("season algorithm dropped list deleted absent refused");
  let totalDropped = 0;
  let totalLists = 0;
  let totalDeleted = 0;
  let totalRefused = 0;
  for (const t of tallies) {
    console.log(`${t.season} ${t.algorithmId} ${t.dropped} ${t.list} ${t.deleted} ${t.absent} ${t.refused}`);
    totalDropped += t.dropped;
    totalLists += t.list === "yes" ? 1 : 0;
    totalDeleted += t.deleted;
    totalRefused += t.refused;
  }
  console.log(`${execute ? "" : "DRY RUN, would "}rewrite ${totalLists} list(s) (${totalDropped} row(s) dropped) and delete ${totalDeleted} object(s); ${totalRefused} refused`);
  if (totalRefused > 0) process.exitCode = 1;
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  void main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
