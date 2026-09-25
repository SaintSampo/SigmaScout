/**
 * Republishes ONLY the live-windows manifest: one object, rebuilt from the
 * corpus by the same builder the full publish calls.
 *
 * WHY THIS SCRIPT EXISTS. At HEAD that manifest had exactly one writer, inside
 * the full `publishSeasons` run — about 109,000 R2 Class A writes over roughly
 * an hour and three quarters, an algorithm generation bump, a mandatory
 * four-file D1 seed (miss it and every tick refuses to fold with a
 * state-generation mismatch), and a prune owed for six hours afterwards. That
 * price is the whole reason 10-03's `districtKey` would otherwise sit in the
 * repository unreachable: a new entry field on this manifest had no path to
 * production a sane person would take. This script is the small path.
 *
 * WHAT IT WRITES: one object, the live-windows manifest key, rebuilt from the
 * corpus by `buildLiveWindowsManifest` — the same function
 * `packages/harness/publish.ts` calls, never a second manifest shape.
 *
 * WHAT IT WILL NOT DO. It never MINTS a generation: it reads the one already
 * on the live manifest and refuses to run if it cannot. It never touches any
 * other R2 key, never writes KV or D1, never emits a seed file, never bumps a
 * schema version, and never publishes an artifact. It refuses on a
 * schema-version disagreement and on a zero-window rebuild, because this one
 * object decides which events the Worker folds AT ALL — a bad overwrite
 * switches live folding off for every event, not just districts, and the
 * failure is silent until someone notices a stale score.
 *
 * Credentials never pass through this file: `putObject` reads `.env` inside
 * `packages/harness/r2Client.ts`. Run it through `--env-file`, like a publish.
 * No value from that file is ever read, printed or interpolated here.
 *
 *   npx tsx --env-file=.env scripts/publishLiveWindows.ts --dry-run
 *   npx tsx --env-file=.env scripts/publishLiveWindows.ts
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { openCorpusReadOnly, type Corpus } from "../packages/corpus/db.js";
import { buildLiveWindowsManifest } from "../packages/harness/manifests.js";
import { LiveWindowsManifestEnvelopeSchema, LiveWindowsManifestSchema, MANIFEST_SCHEMA_VERSION } from "../packages/harness/manifestSchemas.js";
import { putObject } from "../packages/harness/r2Client.js";
import { parseSeasonSpec } from "../packages/harness/seasonSpec.js";

const ORIGIN = "https://data.sigmascout.org";
const BUCKET = "sigmascout-artifacts";
/** Matches `packages/harness/publish.ts`'s own call exactly. A manifest written with different headers is a different object to the edge cache. */
const UPLOAD_HEADERS = { contentType: "application/json", cacheControl: "public, max-age=60" } as const;
/** The ONE key literal in this file. */
export const LIVE_WINDOWS_KEY = "v1/manifest/live-windows.json";
const CORPUS_PATH = join("data", "corpus.sqlite");

/**
 * The same season spec `publish:seasons` hardcodes in `package.json`.
 *
 * THE TWO MUST BE CHANGED TOGETHER. Publishing a different season list under
 * this one key changes which events can be live at all, so a drift between
 * them would quietly shrink or widen the Worker's whole fold population.
 */
export const DEFAULT_LIVE_WINDOWS_SEASONS: readonly number[] = parseSeasonSpec("2016-2020,2022-2026", "--seasons");

export interface PublishLiveWindowsOptions {
  readonly seasons?: readonly number[];
  readonly dryRun?: boolean;
  /** Write a zero-window manifest anyway. Explicit on purpose: a manifest with no windows switches live folding off for every event. */
  readonly allowEmpty?: boolean;
  /** The retention clock `buildLiveWindowsManifest` prunes against. Defaults to the fresh `computedAt`. */
  readonly nowMs?: number;
}

/**
 * The injectable seams.
 *
 * The injected form is what makes the dry-run pin a FACT rather than a reading
 * of the code: `publishLiveWindows.test.ts` drives the dry-run path with its
 * own `upload` and asserts a call count of exactly zero. A dry run that writes
 * is worse than no dry run, because an operator trusts it.
 */
export interface PublishLiveWindowsDeps {
  readonly readLiveManifest?: () => Promise<{ status: number; body: unknown }>;
  readonly upload?: (bucket: string, key: string, body: string, options: { contentType: string; cacheControl: string }) => Promise<void>;
  readonly openDb?: () => Corpus;
}

export interface LiveWindowsCensus {
  readonly generation: string;
  readonly computedAt: string;
  readonly rebuiltWindowCount: number;
  readonly liveWindowCount: number;
  readonly districtWindowCount: number;
  readonly nonDistrictWindowCount: number;
  readonly probeWindowCount: number;
  readonly wrote: boolean;
}

async function defaultReadLiveManifest(): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${ORIGIN}/${LIVE_WINDOWS_KEY}`, { headers: { Origin: "https://sigmascout.org" } });
  return { status: res.status, body: res.ok ? ((await res.json()) as unknown) : undefined };
}

/**
 * THE SEQUENCE IS THE SAFETY PROPERTY, so it is fixed:
 *
 * 1. Read the live manifest and refuse a non-200 BEFORE the corpus is opened.
 * 2. Refuse a `schemaVersion` disagreement, naming both values.
 * 3. Parse the envelope; take its `generation` verbatim, never mint one.
 * 4. Rebuild from the corpus with that generation and a fresh `computedAt`.
 * 5. Validate the rebuild through `LiveWindowsManifestSchema`.
 * 6. Refuse a zero-window rebuild unless `allowEmpty`.
 * 7. Only then, and only when this is not a dry run, upload once.
 */
export async function publishLiveWindows(options: PublishLiveWindowsOptions = {}, deps: PublishLiveWindowsDeps = {}): Promise<LiveWindowsCensus> {
  const seasons = options.seasons ?? DEFAULT_LIVE_WINDOWS_SEASONS;
  const dryRun = options.dryRun === true;
  const allowEmpty = options.allowEmpty === true;
  const readLiveManifest = deps.readLiveManifest ?? defaultReadLiveManifest;
  const upload = deps.upload ?? putObject;
  const openDb = deps.openDb ?? (() => openCorpusReadOnly(CORPUS_PATH));

  const live = await readLiveManifest();
  if (live.status !== 200) {
    throw new Error(
      `publishLiveWindows: the live ${LIVE_WINDOWS_KEY} answered ${live.status} — refusing to proceed. ` +
        `The generation on that object is the one this run must reuse; minting a generation for the object that carries the Worker's liveness is exactly the guess this project's honest-null discipline forbids.`
    );
  }

  // A plain field read, not a second manifest schema: the envelope's own
  // `z.literal` would reject a disagreement without ever naming BOTH values,
  // and both values are what an operator needs to see here.
  const liveSchemaVersion = (live.body as { schemaVersion?: unknown } | null | undefined)?.schemaVersion;
  if (liveSchemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `publishLiveWindows: the live ${LIVE_WINDOWS_KEY} carries schemaVersion ${String(liveSchemaVersion)}, this working tree carries MANIFEST_SCHEMA_VERSION ${MANIFEST_SCHEMA_VERSION} — ` +
        `refusing to overwrite. That disagreement means the deployed Worker and this working tree do not agree on the shape, and overwriting is how you take live folding down.`
    );
  }

  let envelope;
  try {
    envelope = LiveWindowsManifestEnvelopeSchema.parse(live.body);
  } catch (error) {
    throw new Error(`publishLiveWindows: the live ${LIVE_WINDOWS_KEY} answered ${live.status} but its body did not parse as a live-windows manifest envelope: ${error instanceof Error ? error.message : String(error)}`);
  }

  const generation = envelope.generation;
  const computedAt = new Date().toISOString();

  const db = openDb();
  let rebuilt;
  try {
    rebuilt = buildLiveWindowsManifest(db, { seasons, generation, computedAt, ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }) });
  } finally {
    db.close();
  }

  // The same validation the publish boundary applies. One shape, one parse.
  const manifest = LiveWindowsManifestSchema.parse(rebuilt);

  if (manifest.windows.length === 0 && !allowEmpty) {
    throw new Error(
      `publishLiveWindows: the rebuild produced 0 windows against the live manifest's ${envelope.windows.length} — refusing to write. ` +
        `A manifest with no windows switches live folding off for every event, so it is never the accidental outcome of a stale corpus. Pass --allow-empty if that is genuinely what you mean.`
    );
  }

  const districtWindowCount = manifest.windows.filter((window) => window.districtKey != null).length;
  const probeWindowCount = manifest.windows.filter((window) => window.inferred).length;

  if (!dryRun) await upload(BUCKET, LIVE_WINDOWS_KEY, JSON.stringify(manifest), UPLOAD_HEADERS);

  const census: LiveWindowsCensus = {
    generation,
    computedAt,
    rebuiltWindowCount: manifest.windows.length,
    liveWindowCount: envelope.windows.length,
    districtWindowCount,
    nonDistrictWindowCount: manifest.windows.length - districtWindowCount,
    probeWindowCount,
    wrote: !dryRun,
  };

  // A rebuilt count LOWER than the live count is expected, not a symptom:
  // `buildLiveWindowsManifest` deliberately drops a window already closed at
  // build time.
  console.log(
    `${dryRun ? "DRY RUN, would write" : "wrote"} ${LIVE_WINDOWS_KEY} reusing generation ${census.generation}, computedAt ${census.computedAt}\n` +
      `  ${census.rebuiltWindowCount} rebuilt window(s) against the live manifest's ${census.liveWindowCount}; ` +
      `${census.districtWindowCount} carry a districtKey, ${census.nonDistrictWindowCount} carry an explicit null, ${census.probeWindowCount} are probe windows`
  );

  return census;
}

async function main(argv: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      "dry-run": { type: "boolean", default: false },
      "allow-empty": { type: "boolean", default: false },
      seasons: { type: "string" },
    },
  });
  const seasons = values.seasons === undefined ? DEFAULT_LIVE_WINDOWS_SEASONS : parseSeasonSpec(values.seasons, "--seasons");
  await publishLiveWindows({ seasons, dryRun: values["dry-run"] === true, allowEmpty: values["allow-empty"] === true });
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  void main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
