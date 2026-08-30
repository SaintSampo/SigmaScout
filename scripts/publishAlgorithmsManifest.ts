/**
 * The transitional-manifest tool (plan 07-17, PD-01). `v1/manifest/algorithms.json`
 * is one shared, algorithm-agnostic key — every other published page artifact
 * carries an algorithm segment in its own key and is therefore additive by
 * construction, but this one object is overwritten in place on every
 * `publishSeasons` run that does not pass `--skip-state`. During a rename
 * transition (07-16 renamed the published identity to `vpr`) that
 * single-key overwrite would strand one of two deployed readers no matter
 * which order (manifest write, client cutover) happens in — see
 * `07-17-PLAN.md`'s "The manifest problem, stated before it is solved" for
 * the full argument. This tool composes a manifest that names BOTH ids at
 * once, so neither the deployed browser (`useAlgorithmVersion`'s exact-id
 * `find`) nor the deployed Worker (`buildAlgorithmModules`'s exact-id filter
 * against `LIVE_ALGORITHM_IDS`) is ever left with an entry it does not carry.
 *
 * `ALGORITHMS_MANIFEST_KEY` is declared a third time here, deliberately, not
 * imported — `apps/worker/src/liveWindows.ts` and
 * `apps/web/src/lib/api/manifests.ts` each already declare the identical
 * literal for the same reason this file does: each is bundled for a
 * different runtime (the Worker's Cloudflare bundle, the browser's Vite
 * bundle, and this file's plain Node/tsx execution), and importing across
 * those boundaries would drag an incompatible module graph into a runtime
 * that cannot load it. All three must always read `"v1/manifest/algorithms.json"` —
 * `packages/harness/publish.ts`'s own literal is the fourth, and the one an
 * automated cross-check would compare all of these against.
 *
 * Standalone-script shape matching `scripts/replayRig.ts`: `parseArgs` from
 * `node:util`, deep relative imports with explicit `.js` extensions, a
 * `main()` guarded on being the process entry point, non-zero exit on
 * failure.
 *
 * Credential-free EXCEPT for the one real `putObject` call this tool exists
 * to make: `--dry-run` composes, validates and prints without ever touching
 * `r2Client.ts`'s `credentialsFromEnv`. This file never reads, prints or
 * interpolates `.env` or any value from it — `putObject` reads its own
 * credentials from `process.env`, exactly as `publish.ts` already does, and
 * this file never touches `process.env` directly.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  AlgorithmManifestEntrySchema,
  AlgorithmsManifestSchema,
  type AlgorithmManifestEntry,
  type AlgorithmsManifest,
} from "../packages/harness/manifestSchemas.js";
import { putObject } from "../packages/harness/r2Client.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** See this file's header for why this literal is declared a fourth time rather than imported. */
export const ALGORITHMS_MANIFEST_KEY = "v1/manifest/algorithms.json";

const DEFAULT_ORIGIN = "https://data.sigmascout.org";
const DEFAULT_BUCKET = "sigmascout-artifacts";

// ---------------------------------------------------------------------------
// composeManifest — the pure core, unit-testable, zero I/O
// ---------------------------------------------------------------------------

/** Thrown when `mutations.addEntry`'s id already appears in `source.algorithms` — a manifest with two entries for one id is a state no consumer's exact-id `find` can disambiguate. */
export class DuplicateAlgorithmIdError extends Error {
  constructor(id: string) {
    super(
      `composeManifest: source manifest already carries an entry for algorithm id "${id}" — ` +
        `adding a second entry for the same id would leave a state no consumer's exact-id ` +
        `lookup could disambiguate`
    );
    this.name = "DuplicateAlgorithmIdError";
  }
}

/** Thrown when the composed `algorithms` array would be empty — refusing to ever publish a manifest with no entries. */
export class EmptyManifestError extends Error {
  constructor() {
    super("composeManifest: composed manifest would carry zero algorithm entries — refusing to publish an empty manifest");
    this.name = "EmptyManifestError";
  }
}

/**
 * Thrown (WR-01, added retroactively by code review) when a post-write fetch of
 * `ALGORITHMS_MANIFEST_KEY` back through the public origin does not carry the same
 * `algorithms` entries this run just composed and PUT. This is the single shared,
 * algorithm-agnostic manifest every Worker cron tick and every browser page reads to
 * resolve which algorithms are live — a stale KV propagation racing the R2 write, a
 * truncated body, or a transient 5xx treated as success would otherwise degrade the
 * whole site silently, never surfacing here as a failure.
 */
export class ManifestReadBackMismatchError extends Error {
  constructor(expected: readonly AlgorithmManifestEntry[], observed: readonly AlgorithmManifestEntry[]) {
    super(
      `publishAlgorithmsManifest: FATAL — post-write read-back of "${ALGORITHMS_MANIFEST_KEY}" does not match what ` +
        `this run just composed and published. Expected ${expected.length} entries ` +
        `[${expected.map((e) => `${e.id}@${e.version}`).join(", ")}], observed ${observed.length} entries ` +
        `[${observed.map((e) => `${e.id}@${e.version}`).join(", ")}]. Every browser page and Worker cron tick reads ` +
        `this exact key — do not trust this write until this is resolved.`
    );
    this.name = "ManifestReadBackMismatchError";
  }
}

/**
 * Structural equality over an `algorithms` array — both sides are always the product of
 * `AlgorithmsManifestSchema.parse` (in `composeManifest` and in `fetchLiveManifest`
 * respectively), which builds its output in the schema's own declared key order
 * regardless of input order, so a plain `JSON.stringify` comparison is stable here
 * rather than a false-negative risk from key-order drift.
 */
function algorithmsMatch(expected: readonly AlgorithmManifestEntry[], observed: readonly AlgorithmManifestEntry[]): boolean {
  return JSON.stringify(expected) === JSON.stringify(observed);
}

export interface ComposeManifestMutations {
  /** Appended to the end of `source.algorithms` — a stable order, the added entry always last. */
  readonly addEntry?: AlgorithmManifestEntry;
  /** Every entry whose `id` matches is removed. */
  readonly dropId?: string;
}

/**
 * Pure function: returns a NEW manifest carrying `source`'s own
 * `schemaVersion`/`generation`/`computedAt` (this tool composes, it does not
 * originate a new publish run) and a mutated `algorithms` array — `addEntry`
 * applied first, `dropId` second, so a single call may both add and drop in
 * one composition. The result is always parsed through
 * `AlgorithmsManifestSchema` before being returned, so a caller can never
 * receive (or PUT) a shape the schema rejects.
 */
export function composeManifest(source: AlgorithmsManifest, mutations: ComposeManifestMutations): AlgorithmsManifest {
  let algorithms: AlgorithmManifestEntry[] = [...source.algorithms];

  if (mutations.addEntry !== undefined) {
    if (algorithms.some((entry) => entry.id === mutations.addEntry!.id)) {
      throw new DuplicateAlgorithmIdError(mutations.addEntry.id);
    }
    algorithms = [...algorithms, mutations.addEntry];
  }

  if (mutations.dropId !== undefined) {
    algorithms = algorithms.filter((entry) => entry.id !== mutations.dropId);
  }

  if (algorithms.length === 0) {
    throw new EmptyManifestError();
  }

  return AlgorithmsManifestSchema.parse({
    schemaVersion: source.schemaVersion,
    generation: source.generation,
    computedAt: source.computedAt,
    algorithms,
  });
}

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

interface SavedManifestFile {
  readonly schemaVersion: number;
  readonly generation: string;
  readonly computedAt: string;
  readonly algorithms: readonly unknown[];
}

function readManifestFile(path: string): SavedManifestFile {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  return raw as SavedManifestFile;
}

/** Fetches the live manifest from the public artifact origin — no credential involved, matches `scripts/verifySubsetPublish.ts`'s own cache-busting discipline. */
async function fetchLiveManifest(origin: string): Promise<AlgorithmsManifest> {
  const url = `${origin}/${ALGORITHMS_MANIFEST_KEY}?cb=${randomUUID()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`publishAlgorithmsManifest: GET ${url} -> HTTP ${res.status}`);
  }
  const body: unknown = await res.json();
  return AlgorithmsManifestSchema.parse(body);
}

/** Reads the entry named `id` out of a saved manifest file's `algorithms` array, verbatim (`params` included). Throws if the id is not present. */
function readEntryFromFile(path: string, id: string): AlgorithmManifestEntry {
  const saved = readManifestFile(path);
  const found = saved.algorithms.find((entry): entry is { id: string } => typeof entry === "object" && entry !== null && (entry as { id?: unknown }).id === id);
  if (found === undefined) {
    throw new Error(`publishAlgorithmsManifest: no entry with id "${id}" found in ${path}`);
  }
  return AlgorithmManifestEntrySchema.parse(found);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOptions {
  readonly fromLive: boolean;
  readonly fromFile: string | undefined;
  readonly addFrom: string | undefined;
  readonly addId: string | undefined;
  readonly dropId: string | undefined;
  readonly out: string | undefined;
  readonly dryRun: boolean;
  readonly bucket: string;
  readonly origin: string;
}

function parseOptions(argv: readonly string[]): CliOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      "from-live": { type: "boolean" },
      "from-file": { type: "string" },
      "add-from": { type: "string" },
      "add-id": { type: "string" },
      "drop-id": { type: "string" },
      out: { type: "string" },
      "dry-run": { type: "boolean" },
      bucket: { type: "string" },
      origin: { type: "string" },
    },
  });

  if (values["add-from"] !== undefined && values["add-id"] === undefined) {
    throw new Error("publishAlgorithmsManifest: --add-from requires --add-id");
  }
  if (values["add-id"] !== undefined && values["add-from"] === undefined) {
    throw new Error("publishAlgorithmsManifest: --add-id requires --add-from");
  }

  return {
    fromLive: values["from-file"] === undefined,
    fromFile: values["from-file"],
    addFrom: values["add-from"],
    addId: values["add-id"],
    dropId: values["drop-id"],
    out: values.out,
    dryRun: values["dry-run"] === true,
    bucket: values.bucket ?? DEFAULT_BUCKET,
    origin: values.origin ?? DEFAULT_ORIGIN,
  };
}

export async function run(options: CliOptions): Promise<AlgorithmsManifest> {
  const source: AlgorithmsManifest = options.fromFile !== undefined
    ? AlgorithmsManifestSchema.parse(readManifestFile(options.fromFile))
    : await fetchLiveManifest(options.origin);

  const addEntry = options.addFrom !== undefined && options.addId !== undefined ? readEntryFromFile(options.addFrom, options.addId) : undefined;

  const composed = composeManifest(source, { addEntry, dropId: options.dropId });

  const ids = composed.algorithms.map((a) => a.id);
  const body = JSON.stringify(composed);
  console.log(`publishAlgorithmsManifest: composed ${ids.length} entries [${ids.join(", ")}], ${body.length} bytes`);

  if (options.out !== undefined) {
    writeFileSync(options.out, JSON.stringify(composed, null, 2), "utf8");
    console.log(`publishAlgorithmsManifest: wrote ${options.out}`);
  }

  if (options.dryRun) {
    console.log("publishAlgorithmsManifest: --dry-run — nothing published.");
    return composed;
  }

  await putObject(options.bucket, ALGORITHMS_MANIFEST_KEY, body, {
    contentType: "application/json",
    cacheControl: "public, max-age=60",
  });
  console.log(`publishAlgorithmsManifest: published "${ALGORITHMS_MANIFEST_KEY}" to bucket "${options.bucket}" (${body.length} bytes).`);

  // WR-01: this object is the single, shared, algorithm-agnostic manifest every browser page and
  // every Worker cron tick reads — a bad or truncated write here degrades the whole site silently.
  // Re-fetch through the public origin (cache-busted, via the same `fetchLiveManifest` helper used
  // above) and assert the entries actually landed as composed before declaring success.
  const readBack = await fetchLiveManifest(options.origin);
  if (!algorithmsMatch(composed.algorithms, readBack.algorithms)) {
    throw new ManifestReadBackMismatchError(composed.algorithms, readBack.algorithms);
  }
  console.log(
    `publishAlgorithmsManifest: read-back verified — ${readBack.algorithms.length} entries [${readBack.algorithms.map((a) => a.id).join(", ")}] match what was just published.`
  );
  return composed;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  await run(options);
}

// Guard: only auto-run `main()` when this file is the process entry point.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("publishAlgorithmsManifest failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
