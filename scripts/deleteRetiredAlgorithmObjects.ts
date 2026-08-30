/**
 * The one-off retired-algorithm-id cleanup tool (plan 07-19, D-06). Reproduces
 * `packages/harness/publish.ts`'s `publishSeasons` own deterministic key
 * construction — always through `artifactKey`, never a hand-built string —
 * as a deliberate SUPERSET over an offseason-INCLUSIVE corpus walk, then
 * deletes each enumerated key through the shared `r2Client.deleteObject`.
 * `deleteObject`'s DELETE is idempotent by S3 contract (a 404 counts as
 * success), which is exactly what makes an over-enumerated key cost one
 * cheap request rather than a wrong result, and exactly what makes this
 * tool structurally unable to testify about its own effect from its exit
 * code alone — see `docs/publish-budget.md`'s delete-pass section and this
 * plan's own `must_haves.truths` for the census-based evidence this
 * limitation requires instead.
 *
 * Three mechanical guards make this tool structurally unable to run against
 * the wrong scope, or to run destructively at all without explicit intent:
 *
 *   - `RefusedLiveAlgorithmIdError` — `--retired-id` is required with no
 *     default, and any value that is a member of the currently PUBLISHED
 *     `PUBLISHED_ALGORITHM_IDS` set is refused before enumeration begins.
 *     The retired and renamed segments are one character class apart
 *     (`sigma1` / `vpr`), which is exactly the typo class this guards.
 *   - `EnumerationOutOfBoundsError` — a corpus that failed to open, a
 *     `--seasons` range that parsed wrong, or a query that returned nothing
 *     produces a small, plausible-looking key count and a fast, clean,
 *     entirely wrong run. `RETIRED_KEY_COUNT_BOUNDS` turns that into a loud
 *     abort instead.
 *   - `--execute` (CR-01, added retroactively by code review) — destruction
 *     is opt-in, matching `scripts/deleteOrphanedDemoTeamObjects.ts`'s own
 *     convention. The default (no flags at all) runs the census-only path
 *     and deletes nothing; `--retired-id`/`--version` alone, however
 *     plausible a first invocation, are scope guards, not an intent gate,
 *     and no longer trigger a real delete pass on their own. `--dry-run`/
 *     `--census-only` remain accepted and still mean "delete nothing," now
 *     redundant with omitting `--execute` but never an error, for backwards
 *     compatibility with every caller already passing them.
 *
 * Every selection in this file is EXACT — `artifactKey`'s own
 * `{algorithmId}@{version}` segment construction, an `includes` membership
 * check against the imported live-id array, never a prefix or substring
 * comparison anywhere (D-05's adjacency claim, deletion-level half).
 *
 * No bulk or prefix delete capability is added anywhere — `r2Client.ts`
 * has none and this file does not build one (RESEARCH.md's Don't-Hand-Roll
 * table). Every credentialed call goes through `putObject`/`deleteObject`
 * from `packages/harness/r2Client.ts`; this file never reads `.env` itself,
 * never reads `process.env` directly, and never prints, logs, or
 * interpolates a credential value.
 *
 * Standalone-script shape matching `scripts/replayRig.ts`: `parseArgs` from
 * `node:util`, deep relative imports with explicit `.js` extensions, a
 * `main()` guarded on being the process entry point, non-zero exit on
 * failure.
 */
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { openCorpusReadOnly, selectTeamKeysForYear, selectScheduledMatches, type Corpus } from "../packages/corpus/db.js";
import { PUBLISHED_ALGORITHM_IDS } from "../packages/harness/publishedAlgorithms.js";
import { artifactKey } from "../packages/harness/pageArtifacts.js";
import { deleteObject, putObject } from "../packages/harness/r2Client.js";
import { DEFAULT_ARTIFACT_ORIGIN, fetchArtifactFresh } from "./verifySubsetPublish.js";

const CORPUS_PATH = "data/corpus.sqlite";
const DEFAULT_BUCKET = "sigmascout-artifacts";
const PROBE_EVENT_KEY = "__07-19-delete-probe__";

// ---------------------------------------------------------------------------
// Bounds and error classes (PD-04)
// ---------------------------------------------------------------------------

/**
 * The hard band the real enumeration is checked against before anything is
 * deleted. RESEARCH.md Question 4 projects ~19,261 keys (5 `teams` + 5
 * `events` + 1,581 event rows + 17,670 team-season pairs, all
 * offseason-inclusive, this plan's own corpus-measured baseline) against an
 * independently-derived ≈18,222 objects RESEARCH.md expects to actually
 * exist under the retired prefix (narrower, since a handful of historical
 * runs wrote under an offseason-EXCLUDED scope — the gap between the two
 * figures is the expected 404 count this plan's own dry-run names before
 * the real pass, never explains away after it). The band exists because a
 * corpus that failed to open, or a `--seasons` range that parsed wrong,
 * produces a small, plausible-looking key count and a fast, clean, entirely
 * wrong run — this is what turns that into a loud abort instead.
 */
export const RETIRED_KEY_COUNT_BOUNDS = { min: 15_000, max: 25_000 } as const;

export class RefusedLiveAlgorithmIdError extends Error {
  constructor(retiredId: string, liveIds: readonly string[]) {
    super(
      `deleteRetiredAlgorithmObjects: refusing to treat "${retiredId}" as retired — it is a member of the ` +
        `currently PUBLISHED (live) algorithm set [${liveIds.join(", ")}]. This tool structurally cannot be ` +
        `pointed at live data; pass the actual retired id.`
    );
    this.name = "RefusedLiveAlgorithmIdError";
  }
}

export class EnumerationOutOfBoundsError extends Error {
  constructor(observedCount: number, bounds: { readonly min: number; readonly max: number }) {
    super(
      `deleteRetiredAlgorithmObjects: enumerated ${observedCount} keys, outside the expected band ` +
        `[${bounds.min}, ${bounds.max}]. A count outside this band usually means the corpus failed to open, ` +
        `the --seasons range parsed wrong, or a query returned nothing — aborting before any delete rather ` +
        `than proceeding on a plausible-looking but wrong count.`
    );
    this.name = "EnumerationOutOfBoundsError";
  }
}

export class KeySegmentMismatchError extends Error {
  constructor(key: string, retiredId: string) {
    super(
      `deleteRetiredAlgorithmObjects: enumerated key "${key}" does not carry the retired id "${retiredId}" ` +
        `immediately followed by "@" — refusing to include it in the delete set (a prefix/substring bug here ` +
        `would risk deleting live data).`
    );
    this.name = "KeySegmentMismatchError";
  }
}

/** Asserts `key` carries `retiredId` immediately followed by `@` — the one mechanical check every enumerated key passes through before it is trusted (D-05's adjacency claim, deletion-level half). Exported so it can be exercised directly against a deliberately corrupted key, independent of a full enumeration. */
export function assertKeySegment(key: string, retiredId: string): void {
  if (!key.includes(`${retiredId}@`)) {
    throw new KeySegmentMismatchError(key, retiredId);
  }
}

// ---------------------------------------------------------------------------
// enumerateRetiredKeys — the deliberate superset (PD-03)
// ---------------------------------------------------------------------------

interface EventKeyRow {
  event_key: string;
}

/**
 * Mirrors `packages/harness/publish.ts`'s private `selectEventMeta` query
 * exactly (same `WHERE`/`ORDER BY`), narrowed to the one column this tool
 * needs — `event_key`. Every key built from a row here still goes through
 * `artifactKey`, never a hand-built string.
 */
function selectEventKeysForSeason(db: Corpus, season: number): string[] {
  const rows = db.prepare(`SELECT event_key FROM events WHERE year = ? ORDER BY event_key ASC`).all(season) as EventKeyRow[];
  return rows.map((row) => row.event_key);
}

export interface EnumerateRetiredKeysOptions {
  readonly retiredId: string;
  readonly versions: readonly string[];
  readonly seasons: readonly number[];
  /**
   * Test-only override of `RETIRED_KEY_COUNT_BOUNDS` — the real CLI never
   * sets this, and every production invocation is checked against the real
   * exported constant. Exists so a unit test can inspect a small seeded
   * corpus's returned key SHAPE (Tests 6/7) or exercise the max-bound branch
   * (Test 5) without needing a corpus sized to ~19,261 real keys.
   */
  readonly bounds?: { readonly min: number; readonly max: number };
}

/**
 * Builds the full retired-id key set over `seasons` × `versions`, in this
 * order (PD-04): refuse a live id, build the superset (`teams`/`events`
 * once per season, `event` once per event row INCLUDING offseason, `team`
 * once per (team, season) pair over the UNION of every match's roster and
 * every scheduled match's roster, offseason INCLUDED in both), assert every
 * key carries the retired segment, then check the total against the bounds.
 * Never enumerates the `compare` page kind (D-02's documented
 * algorithm-agnostic exception) or the manifest key.
 */
export function enumerateRetiredKeys(db: Corpus, options: EnumerateRetiredKeysOptions): string[] {
  const { retiredId, versions, seasons } = options;
  const bounds = options.bounds ?? RETIRED_KEY_COUNT_BOUNDS;

  if ((PUBLISHED_ALGORITHM_IDS as readonly string[]).includes(retiredId)) {
    throw new RefusedLiveAlgorithmIdError(retiredId, PUBLISHED_ALGORITHM_IDS);
  }

  const keys: string[] = [];
  for (const season of seasons) {
    const eventKeysThisSeason = selectEventKeysForSeason(db, season);
    const teamKeysThisSeason = new Set<string>([
      ...selectTeamKeysForYear(db, season, { excludeOffseason: false }),
      ...selectScheduledMatches(db, { year: season, excludeOffseason: false }).flatMap((m) => [...m.redTeams, ...m.blueTeams]),
    ]);

    for (const version of versions) {
      keys.push(artifactKey({ page: "teams", year: season, algorithmId: retiredId, version }));
      keys.push(artifactKey({ page: "events", year: season, algorithmId: retiredId, version }));
      for (const eventKey of eventKeysThisSeason) {
        keys.push(artifactKey({ page: "event", eventKey, algorithmId: retiredId, version }));
      }
      for (const teamKey of teamKeysThisSeason) {
        keys.push(artifactKey({ page: "team", teamKey, year: season, algorithmId: retiredId, version }));
      }
    }
  }

  for (const key of keys) {
    assertKeySegment(key, retiredId);
  }

  if (keys.length < bounds.min || keys.length > bounds.max) {
    throw new EnumerationOutOfBoundsError(keys.length, bounds);
  }

  return keys;
}

// ---------------------------------------------------------------------------
// Stratified census sampling
// ---------------------------------------------------------------------------

function pageKindOfKey(key: string): string {
  const match = /^v1\/([a-z]+)\//.exec(key);
  return match ? match[1]! : "unknown";
}

/**
 * Water-filling allocation: distributes `total` units across `capacities`
 * as evenly as possible, WITHOUT losing budget to a kind that runs out of
 * room early. A naive even split (`total / kindCount`) undershoots the
 * requested total whenever a kind's own capacity (`teams`/`events`: exactly
 * 5 keys each, one per season) is smaller than its even share — the leftover
 * must roll over to the kinds that still have room (`event`/`team`) rather
 * than simply being dropped.
 */
function allocateStratified(capacities: ReadonlyMap<string, number>, total: number): Map<string, number> {
  const allocation = new Map<string, number>([...capacities.keys()].map((k) => [k, 0]));
  let remaining = Math.min(total, [...capacities.values()].reduce((a, b) => a + b, 0));
  let active = new Set(capacities.keys());
  while (remaining > 0 && active.size > 0) {
    const share = Math.max(1, Math.ceil(remaining / active.size));
    for (const kind of [...active]) {
      if (remaining <= 0) break;
      const cap = capacities.get(kind)!;
      const cur = allocation.get(kind)!;
      const give = Math.min(share, cap - cur, remaining);
      allocation.set(kind, cur + give);
      remaining -= give;
      if (cur + give >= cap) active.delete(kind);
    }
  }
  return allocation;
}

/** Stratified sampling within each page kind, water-filled (see `allocateStratified`) so a fixed-size sample reaches its requested count and spans all four algorithm-scoped page kinds and (by construction, since keys are pushed season-major) every season, rather than clustering inside whichever kind happens to sort first or undershooting when a small kind is capped. */
export function stratifiedSample(keys: readonly string[], sampleSize: number): string[] {
  if (sampleSize >= keys.length) return [...keys];
  const byKind = new Map<string, string[]>();
  for (const key of keys) {
    const kind = pageKindOfKey(key);
    const arr = byKind.get(kind) ?? [];
    arr.push(key);
    byKind.set(kind, arr);
  }
  const capacities = new Map([...byKind.entries()].map(([k, arr]) => [k, arr.length] as const));
  const allocation = allocateStratified(capacities, sampleSize);

  const sample: string[] = [];
  for (const [kind, want] of allocation) {
    if (want <= 0) continue;
    const arr = byKind.get(kind)!;
    const stride = Math.max(1, Math.floor(arr.length / want));
    let taken = 0;
    for (let i = 0; i < arr.length && taken < want; i += stride) {
      sample.push(arr[i]!);
      taken++;
    }
  }
  return sample;
}

interface CensusRow {
  readonly key: string;
  readonly status: number;
  readonly generation?: string;
}

async function censusKeys(origin: string, keys: readonly string[], runId: string): Promise<CensusRow[]> {
  const rows: CensusRow[] = [];
  for (const key of keys) {
    const fetched = await fetchArtifactFresh(origin, key, runId);
    let generation: string | undefined;
    if (fetched.status === 200 && fetched.body !== undefined) {
      try {
        generation = (JSON.parse(fetched.body) as { generation?: string }).generation;
      } catch {
        generation = undefined;
      }
    }
    rows.push({ key, status: fetched.status, generation });
    console.log(`  census: ${key} -> ${fetched.status}${generation ? ` generation=${generation}` : ""}`);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Bounded-concurrency delete pass (Task 3 only — never invoked by Task 1)
// ---------------------------------------------------------------------------

async function deleteKeys(bucket: string, keys: readonly string[], concurrency: number, logPath: string): Promise<void> {
  mkdirSync(dirname(logPath), { recursive: true });
  const logStream = createWriteStream(logPath, { flags: "a" });
  const tally = new Map<string, number>();
  let completed = 0;
  let active = 0;
  const queue: (() => void)[] = [];

  async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      const next = queue.shift();
      if (next) next();
    }
  }

  await Promise.all(
    keys.map((key) =>
      withSlot(async () => {
        await deleteObject(bucket, key);
        const kind = pageKindOfKey(key);
        tally.set(kind, (tally.get(kind) ?? 0) + 1);
        completed++;
        logStream.write(`DELETE ${key} -> ok\n`);
        if (completed % 1000 === 0) {
          const progress = `deleteRetiredAlgorithmObjects: ${completed}/${keys.length} deleted`;
          console.log(progress);
          logStream.write(progress + "\n");
        }
      })
    )
  );

  await new Promise<void>((resolve) => logStream.end(resolve));
  console.log(`deleteRetiredAlgorithmObjects: DONE — ${completed} deletes issued`);
  for (const [kind, count] of tally) console.log(`  ${kind}: ${count}`);
}

// ---------------------------------------------------------------------------
// Probe mode (PD-07) — proves the whole delete path end to end on a
// throwaway object this task also removes.
// ---------------------------------------------------------------------------

async function runProbe(options: { bucket: string; retiredId: string; version: string; origin: string }): Promise<void> {
  const key = `v1/event/${PROBE_EVENT_KEY}/${options.retiredId}@${options.version}.json`;
  assertKeySegment(key, options.retiredId);

  const body = JSON.stringify({ probe: true, createdAt: new Date().toISOString() });
  console.log(`probe: PUT ${key}`);
  await putObject(options.bucket, key, body, { contentType: "application/json", cacheControl: "public, max-age=60" });

  const runId = randomUUID();
  const afterPut = await fetchArtifactFresh(options.origin, key, runId);
  console.log(`probe: census after PUT -> status=${afterPut.status}`);
  if (afterPut.status !== 200) {
    throw new Error(`probe: FATAL — expected 200 immediately after PUT, observed ${afterPut.status}`);
  }

  console.log(`probe: DELETE ${key}`);
  await deleteObject(options.bucket, key);

  const afterDelete1 = await fetchArtifactFresh(options.origin, key, `${runId}-2`);
  console.log(`probe: census after DELETE (1st fresh read) -> status=${afterDelete1.status}`);
  if (afterDelete1.status === 200) {
    throw new Error(
      "probe: FATAL — post-delete census returned 200. The census is not observing the origin; every absence proof in this plan is worthless until this is fixed."
    );
  }

  const afterDelete2 = await fetchArtifactFresh(options.origin, key, `${runId}-3`);
  console.log(`probe: census after DELETE (2nd fresh read) -> status=${afterDelete2.status}`);
  if (afterDelete2.status === 200) {
    throw new Error("probe: FATAL — second post-delete census returned 200.");
  }

  console.log(
    `probe: PASSED — 200 (PUT) -> ${afterDelete1.status} -> ${afterDelete2.status}. Bucket is byte-identical to how this task found it.`
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface CliOptions {
  readonly retiredId: string;
  readonly versions: readonly string[];
  readonly seasons: string;
  readonly execute: boolean;
  readonly dryRun: boolean;
  readonly census: number;
  readonly censusOnly: boolean;
  readonly probe: boolean;
  readonly concurrency: number;
  readonly bucket: string;
}

/**
 * Parses and validates CLI flags. `--retired-id`/`--version` have no default and throw when absent
 * — an ops tool whose destructive target has a default is a footgun (PD-04).
 *
 * `--execute` (CR-01) has NO default and defaults to `false`, matching
 * `scripts/deleteOrphanedDemoTeamObjects.ts`'s own convention: destruction is opt-in. Omitting it
 * always runs the census-only path below, no matter what else is passed — including the previously
 * execute-by-default combination of `--retired-id`/`--version` alone. `--dry-run` and `--census-only`
 * remain accepted and still mean "delete nothing" (now redundant with omitting `--execute`, but kept
 * for backwards compatibility with every existing caller — `docs/publish-budget.md`, prior plan/summary
 * invocations — that already passes `--dry-run` expecting that exact behavior).
 */
export function parseCliOptions(argv: readonly string[]): CliOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      "retired-id": { type: "string" },
      version: { type: "string", multiple: true },
      seasons: { type: "string" },
      execute: { type: "boolean" },
      "dry-run": { type: "boolean" },
      census: { type: "string" },
      "census-only": { type: "boolean" },
      probe: { type: "boolean" },
      concurrency: { type: "string" },
      bucket: { type: "string" },
    },
  });

  if (values["retired-id"] === undefined) {
    throw new Error("--retired-id is required (no default) — this is a destructive tool and must never guess its target");
  }
  const versions = values.version ?? [];
  if (versions.length === 0) {
    throw new Error("--version is required (at least one) — e.g. --version 2.0.0+tuned-2026-08");
  }

  return {
    retiredId: values["retired-id"],
    versions,
    seasons: values.seasons ?? "2022-2026",
    execute: values.execute === true,
    dryRun: values["dry-run"] === true,
    census: values.census !== undefined ? Number.parseInt(values.census, 10) : 60,
    censusOnly: values["census-only"] === true,
    probe: values.probe === true,
    concurrency: values.concurrency !== undefined ? Number.parseInt(values.concurrency, 10) : 16,
    bucket: values.bucket ?? DEFAULT_BUCKET,
  };
}

/** Mirrors `packages/harness/publish.ts`'s private `parseSeasonsRange` — a single year or a "2022-2026" range — deliberately re-implemented rather than imported since the source is module-private. */
function parseSeasonsRange(spec: string): number[] {
  const singleMatch = /^(\d{4})$/.exec(spec);
  if (singleMatch) return [Number.parseInt(singleMatch[1]!, 10)];
  const rangeMatch = /^(\d{4})-(\d{4})$/.exec(spec);
  if (!rangeMatch) {
    throw new Error(`--seasons must be a single year like "2026" or a range like "2022-2026", got "${spec}"`);
  }
  const start = Number.parseInt(rangeMatch[1]!, 10);
  const end = Number.parseInt(rangeMatch[2]!, 10);
  if (end < start) throw new Error(`--seasons range end (${end}) must be >= start (${start})`);
  const seasons: number[] = [];
  for (let year = start; year <= end; year++) seasons.push(year);
  return seasons;
}

async function runDeletePass(options: {
  retiredId: string;
  versions: readonly string[];
  seasonsSpec: string;
  execute: boolean;
  dryRun: boolean;
  censusSize: number;
  censusOnly: boolean;
  concurrency: number;
  bucket: string;
  origin: string;
}): Promise<void> {
  const seasons = parseSeasonsRange(options.seasonsSpec);
  const db = openCorpusReadOnly(CORPUS_PATH);
  let keys: string[];
  try {
    keys = enumerateRetiredKeys(db, { retiredId: options.retiredId, versions: options.versions, seasons });
  } finally {
    db.close();
  }

  const tallyByKind = new Map<string, number>();
  for (const key of keys) {
    const kind = pageKindOfKey(key);
    tallyByKind.set(kind, (tallyByKind.get(kind) ?? 0) + 1);
  }
  console.log(
    `deleteRetiredAlgorithmObjects: enumerated ${keys.length} keys (band [${RETIRED_KEY_COUNT_BOUNDS.min}, ${RETIRED_KEY_COUNT_BOUNDS.max}])`
  );
  for (const [kind, count] of tallyByKind) console.log(`  ${kind}: ${count}`);

  // CR-01: destruction is opt-in. `--execute` must be explicitly passed, independent of whether
  // `--dry-run`/`--census-only` were passed — mirroring `deleteOrphanedDemoTeamObjects.ts`'s
  // `--execute`-gated shape. `--dry-run`/`--census-only` remain accepted and still mean "delete
  // nothing" for every existing caller that already passes them expecting that behavior; they are
  // now redundant with omitting `--execute`, never an error.
  if (!options.execute || options.dryRun || options.censusOnly) {
    const runId = randomUUID();
    const sample = stratifiedSample(keys, options.censusSize);
    console.log(`deleteRetiredAlgorithmObjects: censusing ${sample.length} of ${keys.length} keys against ${options.origin}`);
    const rows = await censusKeys(options.origin, sample, runId);
    const present = rows.filter((r) => r.status === 200).length;
    const absent = rows.length - present;
    console.log(`deleteRetiredAlgorithmObjects: census result — ${present} present (200), ${absent} absent (404/other) of ${rows.length} sampled`);

    mkdirSync("reports/publish", { recursive: true });
    const outPath = options.dryRun ? "reports/publish/07-19-census-before.json" : "reports/publish/07-19-census-manual.json";
    writeFileSync(
      outPath,
      JSON.stringify({ enumeratedTotal: keys.length, tallyByKind: Object.fromEntries(tallyByKind), sampled: rows.length, present, absent, rows }, null, 2)
    );
    console.log(`deleteRetiredAlgorithmObjects: census saved to ${outPath}`);

    const reason = !options.execute ? "--execute not passed" : options.dryRun ? "--dry-run" : "--census-only";
    console.log(`deleteRetiredAlgorithmObjects: ${reason} — deleting nothing. Pass --execute (with neither --dry-run nor --census-only) to actually delete.`);
    return;
  }

  await deleteKeys(options.bucket, keys, options.concurrency, "reports/publish/07-19-delete.log");
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));

  if (options.probe) {
    await runProbe({ bucket: options.bucket, retiredId: options.retiredId, version: options.versions[0]!, origin: DEFAULT_ARTIFACT_ORIGIN });
    return;
  }

  await runDeletePass({
    retiredId: options.retiredId,
    versions: options.versions,
    seasonsSpec: options.seasons,
    execute: options.execute,
    dryRun: options.dryRun,
    censusSize: options.census,
    censusOnly: options.censusOnly,
    concurrency: options.concurrency,
    bucket: options.bucket,
    origin: DEFAULT_ARTIFACT_ORIGIN,
  });
}

// Guard: only auto-run `main()` when this file is the process entry point.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("cleanup:retired-objects failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
