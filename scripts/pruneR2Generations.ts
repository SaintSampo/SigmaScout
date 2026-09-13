/**
 * Census-driven R2 generation prune (quick task 260912-tay, 2026-09-12).
 *
 * WHY THIS EXISTS. The prior tool (deleted in 260913-nvn) cleaned up by
 * enumerate-then-sample: it predicted a superset of keys from the corpus,
 * deleted them one by one, then censused a 60-key stratified sample. That
 * sample reported "nothing orphaned" on 2026-09-10 and again on 2026-09-11,
 * while a full bucket listing still showed 11,002 epa 5.0.0+baseline objects
 * and 214 epa 6.0.0+baseline objects. Enumerate-then-sample is structurally
 * blind to three things a listing sees trivially:
 *
 *   1. season slices a single-range `--seasons` argument skipped;
 *   2. corpus drift — a key published from a corpus that has since changed is
 *      no longer predictable from the corpus as it is today;
 *   3. superseded presim sidecars under a still-live algorithm id.
 *
 * WHAT THIS DOES INSTEAD. It lists the WHOLE bucket (`r2Client.listObjects`,
 * the only new R2 capability), classifies every key by the generation parsed
 * from its final path segment, and compares that against the live manifest
 * fetched fresh from the public origin. Default mode is a read-only census.
 * `--generation` (repeatable) previews a deletion; `--execute` performs it.
 * Deletion stays single-key through `r2Client.deleteObject`; there is no bulk
 * or prefix DELETE anywhere.
 *
 * THE PROOF. After an execute pass the tool ALWAYS re-lists the whole bucket
 * and builds a post-census: every requested generation must have 0 objects
 * left, and every live generation must have identical object and byte counts
 * to the pre-census. `ok` is true only when that holds. An exit code alone is
 * never evidence — read the report or a standalone census.
 *
 * FAIL CLOSED. Every guard below runs before the first DELETE and throws a
 * `PruneRefusalError` with a stable `code`:
 *
 *   - MANIFEST_UNAVAILABLE — the live manifest failed to fetch, was not 200,
 *     was not JSON, had no `algorithms` array, had an entry without string
 *     `id`/`version`, or had zero entries.
 *   - PUBLISHED_ID_NOT_IN_MANIFEST — some `PUBLISHED_ALGORITHM_IDS` member has
 *     no manifest entry (a second source disagrees with the first). A SURPLUS
 *     manifest id is simply treated as live, which is the safe direction.
 *   - MALFORMED_GENERATION_ARG — a requested value is not `id@version`, is
 *     duplicated, or the list is empty.
 *   - REQUESTED_IS_LIVE — a requested generation is named by the manifest.
 *   - NOT_IN_CENSUS — a requested generation has no objects in the fresh
 *     listing (the typo guard: a one-letter version slip must not "succeed").
 *   - LIVE_MISSING_FROM_CENSUS — a live generation is absent or has fewer
 *     than `minLiveGenerationObjects` objects; a broken pagination or parse
 *     yields at most one page, and a census that cannot see the live data
 *     cannot be trusted to call anything else orphaned.
 *   - RECENT_WRITE — a requested generation was written within
 *     `recentWriteRefusalHours`. A fresh generation the manifest does not name
 *     is the signature of another session's in-flight publish, and this
 *     checkout is shared. There is no bypass flag.
 *   - UNKNOWN_KEY_SHAPE / SELECTION_MISMATCH — re-asserted on every selected
 *     key: its kind must be a known page kind, and its independently re-parsed
 *     generation must be requested and not live; per-generation selection
 *     counts must equal the census counts.
 *
 * Selection is EXACT equality on the parsed final-segment generation string —
 * never a prefix or substring test — so `vpr@10.0.0+rolling-2026-09e` never
 * matches `...-09ee` or an `xvpr@...` key.
 *
 * Credentials never pass through this file: it does not read the environment
 * at all. They are read only inside `packages/harness/r2Client.ts`.
 *
 * Standalone-script shape: `parseArgs`, `async function main()`, an
 * entry-point guard — no corpus database import, since a list-based tool
 * must not depend on it.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { PUBLISHED_ALGORITHM_IDS } from "../packages/harness/publishedAlgorithms.js";
import { deleteObject, listObjects, type ListedObject } from "../packages/harness/r2Client.js";
import { ALGORITHMS_MANIFEST_KEY, DEFAULT_ARTIFACT_ORIGIN, fetchArtifactFresh } from "./verifySubsetPublish.js";

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

export type PruneRefusalCode =
  | "MANIFEST_UNAVAILABLE"
  | "PUBLISHED_ID_NOT_IN_MANIFEST"
  | "MALFORMED_GENERATION_ARG"
  | "REQUESTED_IS_LIVE"
  | "NOT_IN_CENSUS"
  | "LIVE_MISSING_FROM_CENSUS"
  | "RECENT_WRITE"
  | "UNKNOWN_KEY_SHAPE"
  | "SELECTION_MISMATCH";

export class PruneRefusalError extends Error {
  readonly code: PruneRefusalCode;

  constructor(code: PruneRefusalCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "PruneRefusalError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Key parsing
// ---------------------------------------------------------------------------

export type KeyKind = "teams" | "team" | "events" | "event" | "presim" | "other";

export interface ParsedGenerationKey {
  readonly generation: string;
  readonly algorithmId: string;
  readonly version: string;
  readonly kind: KeyKind;
}

/**
 * The final path segment of every generation-bearing key. Hyphens are allowed
 * in the id (a deviation from a plain `[a-z0-9]+`) so a harness-style hyphenated
 * id can never be silently filed as unversioned.
 */
const GENERATION_SEGMENT = /^([a-z0-9][a-z0-9-]*)@([^/@]+)\.json$/;

/** The shape a `--generation` value must have: the segment without `.json`. */
const GENERATION_ARG = /^[a-z0-9][a-z0-9-]*@[^/@]+$/;

// The team shape is anchored from the END (`/{year}/{final segment}`) rather than
// requiring a slash-free team-key segment: `artifactKey` does not validate
// `teamKey`, and the 2026-09-12 full listing found a real published team key with
// a trailing space and slash (`v1/team/frc58 //2019/...`) under every generation,
// live ones included. A slash-free pattern filed those as `other`, which made
// UNKNOWN_KEY_SHAPE refuse five otherwise-valid orphan generations. Selection is
// still exact generation equality; this only decides whether a selected key is a
// published shape.
const KIND_PREFIXES: ReadonlyArray<readonly [KeyKind, RegExp]> = [
  ["teams", /^v1\/teams\/\d{4}\//],
  ["team", /^v1\/team\/.+\/\d{4}\/[^/]+$/],
  ["events", /^v1\/events\/\d{4}\//],
  ["event", /^v1\/event\/[^/]+\//],
  ["presim", /^v1\/presim\/[^/]+\//],
];

/** The page kind a key's prefix names, or `other` when it matches none of the published shapes. */
export function pageKindOfKey(key: string): KeyKind {
  for (const [kind, re] of KIND_PREFIXES) {
    if (re.test(key)) return kind;
  }
  return "other";
}

/**
 * Parses `{prefix}/{algorithmId}@{version}.json`. The match is anchored to the
 * WHOLE final segment, so `.json.bak`, a missing `.json`, an `@` only in a
 * directory segment, or a second `@` all return null.
 */
export function parseGenerationKey(key: string): ParsedGenerationKey | null {
  const segment = key.slice(key.lastIndexOf("/") + 1);
  const match = GENERATION_SEGMENT.exec(segment);
  if (match === null) return null;
  const algorithmId = match[1]!;
  const version = match[2]!;
  return { generation: `${algorithmId}@${version}`, algorithmId, version, kind: pageKindOfKey(key) };
}

// ---------------------------------------------------------------------------
// Census
// ---------------------------------------------------------------------------

export interface CountAndBytes {
  objects: number;
  bytes: number;
}

export interface GenerationCensus {
  readonly generation: string;
  readonly algorithmId: string;
  readonly version: string;
  readonly status: "LIVE" | "ORPHAN";
  objects: number;
  bytes: number;
  byKind: Record<string, CountAndBytes>;
  newestLastModified: string;
}

export interface Census {
  readonly takenAt: string;
  readonly totals: CountAndBytes;
  readonly live: CountAndBytes & { generations: number };
  readonly orphan: CountAndBytes & { generations: number };
  readonly unversioned: CountAndBytes & { byPrefix: Record<string, CountAndBytes> };
  readonly anomalous: CountAndBytes & { sampleKeys: string[] };
  readonly generations: GenerationCensus[];
}

const ANOMALOUS_SAMPLE_CAP = 20;

function bump(target: CountAndBytes, size: number): void {
  target.objects += 1;
  target.bytes += size;
}

function timeOf(iso: string): number {
  return Date.parse(iso);
}

/**
 * Aggregates a full listing. Generation-bearing keys group by parsed
 * generation; keys with no `@` are unversioned (broken down by their first two
 * path segments); keys that contain `@` but fail the parse are anomalous.
 * `generations` is sorted by bytes, largest first.
 */
export function buildCensus(objects: readonly ListedObject[], liveGenerations: ReadonlySet<string>, takenAt: string): Census {
  const totals: CountAndBytes = { objects: 0, bytes: 0 };
  const unversioned = { objects: 0, bytes: 0, byPrefix: {} as Record<string, CountAndBytes> };
  const anomalous = { objects: 0, bytes: 0, sampleKeys: [] as string[] };
  const byGeneration = new Map<string, GenerationCensus>();

  for (const object of objects) {
    bump(totals, object.size);
    const parsed = parseGenerationKey(object.key);
    if (parsed === null) {
      if (object.key.includes("@")) {
        bump(anomalous, object.size);
        if (anomalous.sampleKeys.length < ANOMALOUS_SAMPLE_CAP) anomalous.sampleKeys.push(object.key);
      } else {
        bump(unversioned, object.size);
        const prefix = object.key.split("/").slice(0, 2).join("/");
        const slot = (unversioned.byPrefix[prefix] ??= { objects: 0, bytes: 0 });
        bump(slot, object.size);
      }
      continue;
    }

    let entry = byGeneration.get(parsed.generation);
    if (entry === undefined) {
      entry = {
        generation: parsed.generation,
        algorithmId: parsed.algorithmId,
        version: parsed.version,
        status: liveGenerations.has(parsed.generation) ? "LIVE" : "ORPHAN",
        objects: 0,
        bytes: 0,
        byKind: {},
        newestLastModified: object.lastModified,
      };
      byGeneration.set(parsed.generation, entry);
    }
    bump(entry, object.size);
    bump((entry.byKind[parsed.kind] ??= { objects: 0, bytes: 0 }), object.size);
    // An unparseable timestamp is kept (it wins) so RECENT_WRITE refuses it.
    const incoming = timeOf(object.lastModified);
    const current = timeOf(entry.newestLastModified);
    if (Number.isNaN(incoming) || (!Number.isNaN(current) && incoming > current)) {
      entry.newestLastModified = object.lastModified;
    }
  }

  const generations = [...byGeneration.values()].sort((a, b) => b.bytes - a.bytes || (a.generation < b.generation ? -1 : 1));
  const live = { generations: 0, objects: 0, bytes: 0 };
  const orphan = { generations: 0, objects: 0, bytes: 0 };
  for (const g of generations) {
    const bucket = g.status === "LIVE" ? live : orphan;
    bucket.generations += 1;
    bucket.objects += g.objects;
    bucket.bytes += g.bytes;
  }

  return { takenAt, totals, live, orphan, unversioned, anomalous, generations };
}

// ---------------------------------------------------------------------------
// Live manifest
// ---------------------------------------------------------------------------

export interface FreshFetch {
  readonly status: number;
  readonly bytes: number;
  readonly body: string | undefined;
}

export interface LiveGenerations {
  readonly live: Set<string>;
  readonly entries: Array<{ id: string; version: string }>;
}

/**
 * Fetches `v1/manifest/algorithms.json` fresh (cache-busted, no-store) and
 * returns its `id@version` set. Fails closed on every fetch, status, parse or
 * shape problem, and cross-checks `PUBLISHED_ALGORITHM_IDS` as a second source.
 */
export async function fetchLiveGenerations(
  origin: string,
  runId: string,
  deps: { fetchArtifactFresh: (origin: string, key: string, runId: string) => Promise<FreshFetch> }
): Promise<LiveGenerations> {
  let fetched: FreshFetch;
  try {
    fetched = await deps.fetchArtifactFresh(origin, ALGORITHMS_MANIFEST_KEY, runId);
  } catch (err) {
    throw new PruneRefusalError("MANIFEST_UNAVAILABLE", `fetching ${ALGORITHMS_MANIFEST_KEY} threw: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (fetched.status !== 200 || fetched.body === undefined) {
    throw new PruneRefusalError("MANIFEST_UNAVAILABLE", `${ALGORITHMS_MANIFEST_KEY} returned status ${fetched.status}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fetched.body);
  } catch {
    throw new PruneRefusalError("MANIFEST_UNAVAILABLE", `${ALGORITHMS_MANIFEST_KEY} is not valid JSON`);
  }

  const algorithms = typeof parsed === "object" && parsed !== null ? (parsed as { algorithms?: unknown }).algorithms : undefined;
  if (!Array.isArray(algorithms)) {
    throw new PruneRefusalError("MANIFEST_UNAVAILABLE", `${ALGORITHMS_MANIFEST_KEY} has no algorithms array`);
  }
  if (algorithms.length === 0) {
    throw new PruneRefusalError("MANIFEST_UNAVAILABLE", `${ALGORITHMS_MANIFEST_KEY} lists zero algorithms`);
  }

  const entries: Array<{ id: string; version: string }> = [];
  for (const [index, raw] of algorithms.entries()) {
    const id = typeof raw === "object" && raw !== null ? (raw as { id?: unknown }).id : undefined;
    const version = typeof raw === "object" && raw !== null ? (raw as { version?: unknown }).version : undefined;
    if (typeof id !== "string" || id === "" || typeof version !== "string" || version === "") {
      throw new PruneRefusalError("MANIFEST_UNAVAILABLE", `${ALGORITHMS_MANIFEST_KEY} entry #${index + 1} lacks a string id and version`);
    }
    entries.push({ id, version });
  }

  const ids = new Set(entries.map((e) => e.id));
  const missing = PUBLISHED_ALGORITHM_IDS.filter((id) => !ids.has(id));
  if (missing.length > 0) {
    throw new PruneRefusalError(
      "PUBLISHED_ID_NOT_IN_MANIFEST",
      `published algorithm id(s) ${missing.join(", ")} have no entry in the live manifest; refusing to classify anything as orphaned`
    );
  }

  return { live: new Set(entries.map((e) => `${e.id}@${e.version}`)), entries };
}

// ---------------------------------------------------------------------------
// Guards and selection
// ---------------------------------------------------------------------------

export const DEFAULT_MIN_LIVE_GENERATION_OBJECTS = 10_000;
export const DEFAULT_RECENT_WRITE_REFUSAL_HOURS = 6;
export const DEFAULT_MAX_DELETE_FAILURES = 25;

export interface SelectionGuardOptions {
  readonly minLiveGenerationObjects?: number;
  readonly recentWriteRefusalHours?: number;
  readonly now: Date;
}

/**
 * Enforces, in order: MALFORMED_GENERATION_ARG, REQUESTED_IS_LIVE,
 * NOT_IN_CENSUS, LIVE_MISSING_FROM_CENSUS, RECENT_WRITE. Throws on the first
 * failure; returns nothing when every guard passes.
 */
export function assertPruneSelection(
  census: Census,
  requested: readonly string[],
  live: ReadonlySet<string>,
  options: SelectionGuardOptions
): void {
  const minLive = options.minLiveGenerationObjects ?? DEFAULT_MIN_LIVE_GENERATION_OBJECTS;
  const recentHours = options.recentWriteRefusalHours ?? DEFAULT_RECENT_WRITE_REFUSAL_HOURS;

  if (requested.length === 0) {
    throw new PruneRefusalError("MALFORMED_GENERATION_ARG", "no generations were requested");
  }
  const seen = new Set<string>();
  for (const g of requested) {
    if (!GENERATION_ARG.test(g)) {
      throw new PruneRefusalError("MALFORMED_GENERATION_ARG", `"${g}" is not an id@version generation`);
    }
    if (seen.has(g)) {
      throw new PruneRefusalError("MALFORMED_GENERATION_ARG", `"${g}" was requested more than once`);
    }
    seen.add(g);
  }

  for (const g of requested) {
    if (live.has(g)) {
      throw new PruneRefusalError("REQUESTED_IS_LIVE", `"${g}" is named by the live manifest`);
    }
  }

  const byGeneration = new Map(census.generations.map((g) => [g.generation, g]));
  for (const g of requested) {
    const entry = byGeneration.get(g);
    if (entry === undefined || entry.objects === 0) {
      throw new PruneRefusalError("NOT_IN_CENSUS", `"${g}" has no objects in the fresh listing (typo, or already deleted)`);
    }
  }

  for (const g of live) {
    const entry = byGeneration.get(g);
    const objects = entry?.objects ?? 0;
    if (objects < minLive) {
      throw new PruneRefusalError(
        "LIVE_MISSING_FROM_CENSUS",
        `live generation "${g}" has ${objects} objects in the listing, below the floor of ${minLive}; the listing cannot be trusted`
      );
    }
  }

  const cutoff = options.now.getTime() - recentHours * 3_600_000;
  for (const g of requested) {
    const entry = byGeneration.get(g)!;
    const newest = timeOf(entry.newestLastModified);
    if (Number.isNaN(newest) || newest > cutoff) {
      throw new PruneRefusalError(
        "RECENT_WRITE",
        `"${g}" was last written at ${entry.newestLastModified}, within ${recentHours}h of ${options.now.toISOString()} (possible in-flight publish)`
      );
    }
  }
}

export interface Selection {
  readonly keys: ListedObject[];
  readonly byGeneration: Record<string, CountAndBytes>;
}

/**
 * Selects every key whose parsed generation EXACTLY equals a requested one.
 * Each selected key is then re-parsed independently and re-asserted: requested
 * and not live (else SELECTION_MISMATCH), and of a known kind (else
 * UNKNOWN_KEY_SHAPE).
 */
export function selectKeysForDeletion(
  objects: readonly ListedObject[],
  requested: readonly string[],
  live: ReadonlySet<string>
): Selection {
  const requestedSet = new Set(requested);
  const keys: ListedObject[] = [];
  const byGeneration: Record<string, CountAndBytes> = {};

  for (const object of objects) {
    const parsed = parseGenerationKey(object.key);
    if (parsed === null || !requestedSet.has(parsed.generation)) continue;
    keys.push(object);
  }

  for (const object of keys) {
    const reparsed = parseGenerationKey(object.key);
    if (reparsed === null || !requestedSet.has(reparsed.generation) || live.has(reparsed.generation)) {
      throw new PruneRefusalError("SELECTION_MISMATCH", `selected key "${object.key}" is not a requested, non-live generation`);
    }
    if (reparsed.kind === "other") {
      throw new PruneRefusalError("UNKNOWN_KEY_SHAPE", `selected key "${object.key}" does not match any published key shape`);
    }
    bump((byGeneration[reparsed.generation] ??= { objects: 0, bytes: 0 }), object.size);
  }

  return { keys, byGeneration };
}

// ---------------------------------------------------------------------------
// runPrune
// ---------------------------------------------------------------------------

export interface PruneDeps {
  listObjects: (bucket: string, options?: { prefix?: string; onPage?: (pagesSoFar: number, objectsSoFar: number) => void }) => Promise<ListedObject[]>;
  deleteObject: (bucket: string, key: string) => Promise<void>;
  fetchArtifactFresh: (origin: string, key: string, runId: string) => Promise<FreshFetch>;
  now: () => Date;
  log: (line: string) => void;
  writeFile: (path: string, contents: string) => void;
}

export interface PruneOptions {
  readonly bucket: string;
  readonly origin: string;
  readonly prefix?: string;
  readonly generations: readonly string[];
  readonly execute: boolean;
  readonly concurrency: number;
  readonly outPath?: string;
  readonly keysOutPath?: string;
  readonly minLiveGenerationObjects?: number;
  readonly recentWriteRefusalHours?: number;
  readonly maxDeleteFailures?: number;
  readonly runId?: string;
}

export interface LiveDiff {
  readonly generation: string;
  readonly before: CountAndBytes;
  readonly after: CountAndBytes;
}

export interface PruneReport {
  startedAt: string;
  finishedAt: string;
  execute: boolean;
  requested: string[];
  preCensus: Census | null;
  selectedByGeneration: Record<string, CountAndBytes> | null;
  deletes: { issued: number; succeeded: number; failed: number; failures: Array<{ key: string; message: string }> };
  postCensus: Census | null;
  postCensusError: string | null;
  remainingByGeneration: Record<string, number>;
  liveUnchanged: boolean | null;
  liveDiffs: LiveDiff[];
  ok: boolean;
  refused: { code: PruneRefusalCode; message: string } | null;
}

const FAILURES_KEPT = 50;
const PROGRESS_EVERY = 5_000;

function defaultWriteFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
}

const DEFAULT_DEPS: PruneDeps = {
  listObjects,
  deleteObject,
  fetchArtifactFresh,
  now: () => new Date(),
  log: (line: string) => {
    console.log(line);
  },
  writeFile: defaultWriteFile,
};

function gb(bytes: number): string {
  return (bytes / 1e9).toFixed(2);
}

function printCensus(census: Census, log: (line: string) => void): void {
  log(`Census taken ${census.takenAt}`);
  log("generation\tstatus\tobjects\tbytes\tGB\tkinds");
  for (const g of census.generations) {
    const kinds = Object.entries(g.byKind)
      .map(([kind, c]) => `${kind}:${c.objects}`)
      .join(",");
    log(`${g.generation}\t${g.status}\t${g.objects}\t${g.bytes}\t${gb(g.bytes)}\t${kinds}`);
  }
  log(`TOTAL bucket: ${census.totals.objects} objects, ${census.totals.bytes} bytes (${gb(census.totals.bytes)} GB)`);
  log(`  LIVE: ${census.live.generations} generations, ${census.live.objects} objects, ${gb(census.live.bytes)} GB`);
  log(`  ORPHAN: ${census.orphan.generations} generations, ${census.orphan.objects} objects, ${gb(census.orphan.bytes)} GB`);
  log(`  unversioned: ${census.unversioned.objects} objects, ${gb(census.unversioned.bytes)} GB`);
  for (const [prefix, c] of Object.entries(census.unversioned.byPrefix).sort((a, b) => b[1].bytes - a[1].bytes)) {
    log(`    ${prefix}: ${c.objects} objects, ${c.bytes} bytes`);
  }
  log(`  anomalous: ${census.anomalous.objects} objects, ${census.anomalous.bytes} bytes`);
  for (const key of census.anomalous.sampleKeys) log(`    sample: ${key}`);
  const orphans = census.generations.filter((g) => g.status === "ORPHAN");
  if (orphans.length === 0) {
    log("No ORPHAN generations.");
  } else {
    log("Copy-pasteable flags for every ORPHAN generation:");
    log(orphans.map((g) => `--generation ${g.generation}`).join(" "));
  }
}

function emptyReport(startedAt: string, options: PruneOptions): PruneReport {
  return {
    startedAt,
    finishedAt: startedAt,
    execute: options.execute,
    requested: [...options.generations],
    preCensus: null,
    selectedByGeneration: null,
    deletes: { issued: 0, succeeded: 0, failed: 0, failures: [] },
    postCensus: null,
    postCensusError: null,
    remainingByGeneration: {},
    liveUnchanged: null,
    liveDiffs: [],
    ok: false,
    refused: null,
  };
}

/**
 * Census (no generations), preview (generations, no execute) or execute. See
 * the file header for the flow and every guard. Refusals are rethrown after the
 * report (when `outPath` is set and generations were given) records them.
 */
export async function runPrune(options: PruneOptions, depsOverride: Partial<PruneDeps> = {}): Promise<{ ok: boolean }> {
  const deps: PruneDeps = { ...DEFAULT_DEPS, ...depsOverride };
  const log = deps.log;
  const hasGenerations = options.generations.length > 0;

  if (options.prefix !== undefined && (hasGenerations || options.execute)) {
    throw new Error("pruneR2Generations: --prefix is a read-only smoke test and cannot be combined with --generation or --execute");
  }
  if (options.execute && !hasGenerations) {
    throw new Error("pruneR2Generations: --execute requires at least one --generation");
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 64) {
    throw new Error("pruneR2Generations: concurrency must be an integer in 1..64");
  }

  const runId = options.runId ?? randomUUID();
  const report = emptyReport(deps.now().toISOString(), options);
  const writeReport = (): void => {
    if (options.outPath !== undefined && hasGenerations) {
      report.finishedAt = deps.now().toISOString();
      deps.writeFile(options.outPath, `${JSON.stringify(report, null, 2)}\n`);
    }
  };

  try {
    const { live, entries } = await fetchLiveGenerations(options.origin, runId, deps);
    log(`Live manifest: ${entries.map((e) => `${e.id}@${e.version}`).join(", ")}`);

    const listPrefix = options.prefix;
    log(`Listing bucket "${options.bucket}"${listPrefix === undefined ? " (whole bucket)" : ` under prefix "${listPrefix}"`}...`);
    const preObjects = await deps.listObjects(options.bucket, {
      ...(listPrefix === undefined ? {} : { prefix: listPrefix }),
      onPage: (pages, count) => {
        if (pages % 50 === 0) log(`  listed ${pages} pages, ${count} objects`);
      },
    });
    const preCensus = buildCensus(preObjects, live, deps.now().toISOString());
    report.preCensus = preCensus;
    printCensus(preCensus, log);

    if (options.keysOutPath !== undefined) {
      deps.writeFile(options.keysOutPath, preObjects.map((o) => `${o.key}\t${o.size}\t${o.lastModified}`).join("\n") + "\n");
      log(`Wrote ${preObjects.length} keys to ${options.keysOutPath}`);
    }

    if (!hasGenerations) {
      const minLive = options.minLiveGenerationObjects ?? DEFAULT_MIN_LIVE_GENERATION_OBJECTS;
      if (listPrefix === undefined) {
        for (const g of live) {
          const objects = preCensus.generations.find((c) => c.generation === g)?.objects ?? 0;
          if (objects < minLive) log(`WARNING: live generation ${g} has only ${objects} objects (floor ${minLive}); a prune would refuse`);
        }
      }
      if (options.outPath !== undefined) {
        deps.writeFile(options.outPath, `${JSON.stringify(preCensus, null, 2)}\n`);
        log(`Wrote census to ${options.outPath}`);
      }
      return { ok: true };
    }

    assertPruneSelection(preCensus, options.generations, live, {
      ...(options.minLiveGenerationObjects === undefined ? {} : { minLiveGenerationObjects: options.minLiveGenerationObjects }),
      ...(options.recentWriteRefusalHours === undefined ? {} : { recentWriteRefusalHours: options.recentWriteRefusalHours }),
      now: deps.now(),
    });
    const selection = selectKeysForDeletion(preObjects, options.generations, live);
    const censusByGeneration = new Map(preCensus.generations.map((g) => [g.generation, g]));
    for (const g of options.generations) {
      const selected = selection.byGeneration[g];
      const counted = censusByGeneration.get(g);
      if (selected === undefined || counted === undefined || selected.objects !== counted.objects || selected.bytes !== counted.bytes) {
        throw new PruneRefusalError("SELECTION_MISMATCH", `selection for "${g}" does not equal its census count`);
      }
    }
    report.selectedByGeneration = selection.byGeneration;

    log(options.execute ? "Selected for deletion:" : "PREVIEW (no --execute; nothing will be deleted). Selected:");
    for (const g of options.generations) {
      const c = selection.byGeneration[g]!;
      log(`  ${g}\t${c.objects} objects\t${c.bytes} bytes\t${gb(c.bytes)} GB`);
    }
    log(`  total: ${selection.keys.length} objects`);

    if (!options.execute) {
      report.ok = true;
      writeReport();
      return { ok: true };
    }

    // --- Execute: single-key deletes through a bounded worker pool. ---
    const maxFailures = options.maxDeleteFailures ?? DEFAULT_MAX_DELETE_FAILURES;
    const startedMs = deps.now().getTime();
    const failures: Array<{ key: string; message: string }> = [];
    let issued = 0;
    let succeeded = 0;
    let next = 0;
    let capHit = false;

    const worker = async (): Promise<void> => {
      for (;;) {
        if (failures.length > maxFailures) {
          capHit = true;
          return;
        }
        const index = next;
        if (index >= selection.keys.length) return;
        next += 1;
        const key = selection.keys[index]!.key;
        issued += 1;
        try {
          await deps.deleteObject(options.bucket, key);
          succeeded += 1;
        } catch (err) {
          failures.push({ key, message: err instanceof Error ? err.message : String(err) });
        }
        const done = succeeded + failures.length;
        if (done % PROGRESS_EVERY === 0) {
          log(`  progress: ${done}/${selection.keys.length} done, ${failures.length} failures`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(options.concurrency, Math.max(1, selection.keys.length)) }, () => worker()));

    const elapsedS = ((deps.now().getTime() - startedMs) / 1000).toFixed(1);
    log(`Deletes finished: ${succeeded} deleted, ${failures.length} failures, ${issued} issued of ${selection.keys.length}, ${elapsedS}s elapsed`);
    if (capHit) log(`STOPPED EARLY: failures exceeded the cap of ${maxFailures}`);
    report.deletes = { issued, succeeded, failed: failures.length, failures: failures.slice(0, FAILURES_KEPT) };

    // --- The proof: always re-list the whole bucket. ---
    log("Post-census: re-listing the whole bucket...");
    let postCensus: Census | null = null;
    try {
      const postObjects = await deps.listObjects(options.bucket, {
        onPage: (pages, count) => {
          if (pages % 50 === 0) log(`  listed ${pages} pages, ${count} objects`);
        },
      });
      postCensus = buildCensus(postObjects, live, deps.now().toISOString());
    } catch (err) {
      report.postCensusError = err instanceof Error ? err.message : String(err);
      log(`POST-CENSUS FAILED: ${report.postCensusError}`);
    }
    report.postCensus = postCensus;

    if (postCensus !== null) {
      const postByGeneration = new Map(postCensus.generations.map((g) => [g.generation, g]));
      for (const g of options.generations) report.remainingByGeneration[g] = postByGeneration.get(g)?.objects ?? 0;

      const liveNames = new Set<string>([
        ...preCensus.generations.filter((g) => g.status === "LIVE").map((g) => g.generation),
        ...postCensus.generations.filter((g) => g.status === "LIVE").map((g) => g.generation),
      ]);
      for (const name of [...liveNames].sort()) {
        const before = censusByGeneration.get(name);
        const after = postByGeneration.get(name);
        const b = { objects: before?.objects ?? 0, bytes: before?.bytes ?? 0 };
        const a = { objects: after?.objects ?? 0, bytes: after?.bytes ?? 0 };
        if (a.objects !== b.objects || a.bytes !== b.bytes) report.liveDiffs.push({ generation: name, before: b, after: a });
      }
      report.liveUnchanged = report.liveDiffs.length === 0;

      log("Post-census remaining per requested generation:");
      for (const g of options.generations) log(`  ${g}\t${report.remainingByGeneration[g]}`);
      log(`Live unchanged: ${report.liveUnchanged}${report.liveDiffs.length > 0 ? ` (${report.liveDiffs.map((d) => d.generation).join(", ")})` : ""}`);
      log(`Post-census total: ${postCensus.totals.objects} objects, ${gb(postCensus.totals.bytes)} GB`);
    }

    report.ok =
      postCensus !== null &&
      failures.length === 0 &&
      issued === selection.keys.length &&
      options.generations.every((g) => report.remainingByGeneration[g] === 0) &&
      report.liveUnchanged === true;
    log(`ok: ${report.ok}`);
    writeReport();
    return { ok: report.ok };
  } catch (err) {
    if (err instanceof PruneRefusalError) {
      report.refused = { code: err.code, message: err.message };
      report.ok = false;
      writeReport();
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface CliOptions {
  readonly bucket: string;
  readonly origin: string;
  readonly prefix?: string;
  readonly outPath?: string;
  readonly keysOutPath?: string;
  readonly generations: string[];
  readonly execute: boolean;
  readonly concurrency: number;
}

export function parseCliOptions(argv: readonly string[]): CliOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      bucket: { type: "string", default: "sigmascout-artifacts" },
      origin: { type: "string", default: DEFAULT_ARTIFACT_ORIGIN },
      prefix: { type: "string" },
      out: { type: "string" },
      "keys-out": { type: "string" },
      generation: { type: "string", multiple: true },
      execute: { type: "boolean", default: false },
      concurrency: { type: "string", default: "24" },
    },
    strict: true,
    allowPositionals: false,
  });

  const generations = values.generation ?? [];
  const execute = values.execute === true;

  if (execute && generations.length === 0) {
    throw new Error("--execute requires at least one --generation");
  }
  if (values.prefix !== undefined && (generations.length > 0 || execute)) {
    throw new Error("--prefix is a read-only smoke test and cannot be combined with --generation or --execute");
  }
  const rawConcurrency = values.concurrency ?? "24";
  if (!/^\d+$/.test(rawConcurrency)) throw new Error(`--concurrency must be an integer in 1..64, got "${rawConcurrency}"`);
  const concurrency = Number(rawConcurrency);
  if (concurrency < 1 || concurrency > 64) throw new Error(`--concurrency must be an integer in 1..64, got ${concurrency}`);

  return {
    bucket: values.bucket ?? "sigmascout-artifacts",
    origin: values.origin ?? DEFAULT_ARTIFACT_ORIGIN,
    ...(values.prefix === undefined ? {} : { prefix: values.prefix }),
    ...(values.out === undefined ? {} : { outPath: values.out }),
    ...(values["keys-out"] === undefined ? {} : { keysOutPath: values["keys-out"] }),
    generations,
    execute,
    concurrency,
  };
}

async function main(): Promise<void> {
  const cli = parseCliOptions(process.argv.slice(2));
  const { ok } = await runPrune({
    bucket: cli.bucket,
    origin: cli.origin,
    ...(cli.prefix === undefined ? {} : { prefix: cli.prefix }),
    generations: cli.generations,
    execute: cli.execute,
    concurrency: cli.concurrency,
    ...(cli.outPath === undefined ? {} : { outPath: cli.outPath }),
    ...(cli.keysOutPath === undefined ? {} : { keysOutPath: cli.keysOutPath }),
  });
  if (!ok) {
    console.error("pruneR2Generations: result is NOT ok (see the report and the post-census above)");
    process.exit(1);
  }
}

// Guard: only auto-run `main()` when this file is the process entry point.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    if (err instanceof PruneRefusalError) {
      console.error(`pruneR2Generations REFUSED (${err.code}): ${err.message}`);
    } else {
      console.error("pruneR2Generations failed:", err instanceof Error ? err.message : String(err));
    }
    process.exit(1);
  });
}
