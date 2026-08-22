/**
 * D-18/Pattern 2: reads the two offline-published manifests (live windows,
 * algorithms) the tick needs every invocation, and answers "what is live
 * right now" from them. Neither manifest is computed here — both are built
 * offline by `packages/harness/manifests.ts` and published as small JSON
 * objects; this module only reads and validates what the publish pipeline
 * already produced.
 *
 * Binding choice (documented per the plan's own instruction): **KV is
 * primary, R2 is the fallback.** Both manifests are small and read every
 * single tick (Pattern 2), which is precisely the shape KV's edge-cached,
 * very-fast-read tier is good at — unlike D-25's "no compute in the read
 * path" argument (that's about the BROWSER's read path; this is the Worker's
 * own tick, a different consumer with a different cost model). The R2
 * fallback exists only for the case KV has not yet been populated/propagated
 * (KV writes are NOT strongly consistent — ~60s global propagation) — R2 is
 * the durable source of truth the offline publisher always writes to.
 *
 * `loadLiveWindowsManifest`/`loadAlgorithmsManifest` are exported separately
 * (not just the combined `loadManifests`) because `scheduled.ts`'s D-18 early
 * exit reads ONLY the live-windows manifest before deciding whether anything
 * is live — the algorithms manifest is never needed to answer that question,
 * and reading it unconditionally on every idle tick (the overwhelmingly
 * common case, ~10 months of the year) would cost a wasted binding call. This
 * is exactly Pattern 2's own framing: "The Worker's first action every tick
 * is reading this ONE object; if nothing is live, it exits before spending
 * any TBA subrequest." `loadManifests` is kept for callers (and tests) that
 * want both unconditionally, and is implemented in terms of the two granular
 * functions so there is exactly one place each manifest's read logic lives.
 */
// Imports from `manifestSchemas.js` directly — NEVER from `manifests.js`.
// `manifests.js` imports `node:fs`/`node:path` and `./cli.js` (which pulls in
// the corpus/`better-sqlite3`) at module top level; `manifestSchemas.js` is
// the Worker-importable extraction with none of that (see its own header).
import { AlgorithmsManifestSchema, LiveWindowsManifestSchema, isLiveAt, type AlgorithmsManifest, type LiveWindowEntry, type LiveWindowsManifest } from "../../../packages/harness/manifestSchemas.js";
import type { Env } from "./env.js";

/** Must match `packages/harness/publish.ts`'s own manifest upload key exactly — the offline publisher and this Worker read/write the SAME two objects. */
export const LIVE_WINDOWS_MANIFEST_KEY = "v1/manifest/live-windows.json";
export const ALGORITHMS_MANIFEST_KEY = "v1/manifest/algorithms.json";

export class ManifestReadError extends Error {
  constructor(name: string, key: string) {
    super(`loadManifests: "${name}" manifest not found at KV or R2 key "${key}" — has the offline publish step run yet?`);
    this.name = "ManifestReadError";
  }
}

export class ManifestValidationError extends Error {
  constructor(name: string, cause: unknown) {
    super(`loadManifests: "${name}" manifest failed schema validation — refusing to use a partially-valid manifest: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ManifestValidationError";
  }
}

/** KV first (one call), R2 only when KV has no value yet (one more call) — see this module's header for why KV is primary. */
async function readManifestText(env: Env, name: string, key: string): Promise<string> {
  const kvValue = await env.MANIFEST.get(key);
  if (kvValue !== null) return kvValue;
  const r2Object = await env.ARTIFACTS.get(key);
  if (r2Object === null) throw new ManifestReadError(name, key);
  return r2Object.text();
}

function parseManifest<T>(name: string, schema: { parse(input: unknown): T }, text: string): T {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ManifestValidationError(name, err);
  }
  try {
    return schema.parse(raw);
  } catch (err) {
    throw new ManifestValidationError(name, err);
  }
}

/** Reads and validates ONLY the live-windows manifest — the one object `scheduled.ts`'s early exit needs. One KV/R2 call in the common (KV-hit) case. */
export async function loadLiveWindowsManifest(env: Env): Promise<LiveWindowsManifest> {
  const text = await readManifestText(env, "live-windows", LIVE_WINDOWS_MANIFEST_KEY);
  return parseManifest("live-windows", LiveWindowsManifestSchema, text);
}

/** Reads and validates ONLY the algorithms manifest. One KV/R2 call in the common (KV-hit) case. */
export async function loadAlgorithmsManifest(env: Env): Promise<AlgorithmsManifest> {
  const text = await readManifestText(env, "algorithms", ALGORITHMS_MANIFEST_KEY);
  return parseManifest("algorithms", AlgorithmsManifestSchema, text);
}

export interface Manifests {
  readonly liveWindows: LiveWindowsManifest;
  readonly algorithms: AlgorithmsManifest;
}

/** Both manifests, unconditionally — one binding call each in the common case. Prefer `loadLiveWindowsManifest` alone when only the liveness question is being asked (see this module's header). */
export async function loadManifests(env: Env): Promise<Manifests> {
  const [liveWindows, algorithms] = await Promise.all([loadLiveWindowsManifest(env), loadAlgorithmsManifest(env)]);
  return { liveWindows, algorithms };
}

/**
 * D-18: the entries of `manifest` that are live at `epochMs`, in event-key
 * order. Uses `isLiveAt` (`packages/harness/manifests.ts`) unchanged — the
 * half-open `[startMs, endMs)` liveness contract is defined once, there,
 * never re-implemented here.
 */
export function liveEventsAt(manifest: LiveWindowsManifest, epochMs: number): LiveWindowEntry[] {
  return manifest.windows.filter((window) => isLiveAt(window, epochMs)).sort((a, b) => (a.eventKey < b.eventKey ? -1 : a.eventKey > b.eventKey ? 1 : 0));
}
