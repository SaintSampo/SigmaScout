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
import { AlgorithmsManifestSchema, LiveWindowEntrySchema, LiveWindowsManifestEnvelopeSchema, LiveWindowsManifestSchema, isLiveAt, type AlgorithmsManifest, type LiveWindowEntry, type LiveWindowsManifest } from "../../../packages/harness/manifestSchemas.js";
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

/** Thrown when an entry's `startMs`/`endMs` are not usable finite numbers, so its liveness cannot be decided at all — see `loadLiveEventsAt`. Deliberately a `ManifestValidationError` subclass: this is still "refusing to use a partially-valid manifest", just reported with the offending index. */
export class LiveWindowShapeError extends ManifestValidationError {
  constructor(index: number, detail: string) {
    super("live-windows", `windows[${index}] ${detail} — liveness cannot be decided for this entry, so the whole manifest is refused rather than silently skipping it`);
    this.name = "LiveWindowShapeError";
  }
}

/**
 * The tick's hot path: "which events are live at `epochMs`?", answered by
 * reading the live-windows manifest and validating ONLY the entries that
 * actually turn out to be live.
 *
 * WHY THIS IS NOT `liveEventsAt(await loadLiveWindowsManifest(env), epochMs)`
 * ------------------------------------------------------------------------
 * It used to be exactly that, and that is what took the deployed Worker down
 * (see `.planning/debug/resolved/worker-tick-exceeds-cpu-budget.md`, cause A).
 * The composed form runs `LiveWindowsManifestSchema.parse` over EVERY window
 * before asking whether any of them is live. The published manifest carries one
 * window per corpus event across all covered seasons — 1,581 of them at the time
 * this was written, ~7,900 field validations, ~160 KB — and the overwhelming
 * majority belong to seasons that ended years ago and can never be live again.
 * Measured against the real deployed manifest: 3.39-3.85 ms COLD in Node/V8 on a
 * fast desktop, which corresponded to the 5-9 ms the deployed Worker itself
 * recorded for this same do-nothing path (docs/worker-operations.md, 2026-08-22
 * and 2026-08-23). A once-a-minute cron on the free plan lands on an evicted
 * isolate nearly every tick, so it always pays that cold price, never the ~0.9 ms
 * warm one. In other words the "nothing is live, exit immediately" tick was
 * already spending 50-90% of the entire 10 ms CPU budget validating data it was
 * about to throw away, leaving no headroom for the tick that DOES have work.
 *
 * The order here is: validate the preamble with Zod (so a wrong `schemaVersion`,
 * a missing `generation`, or a `windows` that is not an array is still a loud,
 * immediate failure); then a cheap structural + interval prefilter over the raw
 * entries; then the FULL `LiveWindowEntrySchema.parse` on the handful that
 * survive. Same A/B against the real manifest: 1.14-1.25 ms cold, and the
 * selected set is byte-identical to what the old path selected.
 *
 * WHAT WAS TRADED AWAY — READ THIS BEFORE "RESTORING" THE FULL PARSE
 * -----------------------------------------------------------------
 * This module's stated property was "refusing to use a partially-valid
 * manifest". That property is NARROWED, not abandoned:
 *
 *   - still enforced: the preamble, the presence and array-ness of `windows`,
 *     and every field of every entry that is actually live.
 *   - still enforced: an entry whose `startMs`/`endMs` are not finite numbers is
 *     a HARD failure (`LiveWindowShapeError`), not a silent skip. Liveness cannot
 *     be decided for such an entry, so it is never quietly dropped — that is the
 *     failure mode this ordering is specifically designed to avoid.
 *   - no longer enforced: the non-interval fields (`eventKey`, `season`,
 *     `inferred`, and integer-ness of the bounds) of entries that are NOT live.
 *     A corrupt-but-not-live entry is now tolerated where it used to fail the
 *     whole read.
 *
 * That last bullet is the deliberate, developer-accepted trade (2026-08-29): a
 * manifest is validated to the depth it is used. Do not undo it without first
 * re-measuring the cold cost of the whole-manifest parse against the CURRENT
 * manifest size and checking it against the 10 ms budget — this exact change
 * being absent is what caused a multi-hour production outage.
 *
 * `loadLiveWindowsManifest` (full validation, every entry) is unchanged and is
 * still the right call for any caller that genuinely needs the whole manifest.
 */
export async function loadLiveEventsAt(env: Env, epochMs: number): Promise<LiveWindowEntry[]> {
  const text = await readManifestText(env, "live-windows", LIVE_WINDOWS_MANIFEST_KEY);

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ManifestValidationError("live-windows", err);
  }

  let envelope: { windows: unknown[] };
  try {
    envelope = LiveWindowsManifestEnvelopeSchema.parse(raw);
  } catch (err) {
    throw new ManifestValidationError("live-windows", err);
  }

  const live: LiveWindowEntry[] = [];
  for (let index = 0; index < envelope.windows.length; index++) {
    const candidate = envelope.windows[index];
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new LiveWindowShapeError(index, "is not an object");
    }
    const { startMs, endMs } = candidate as { startMs?: unknown; endMs?: unknown };
    if (typeof startMs !== "number" || !Number.isFinite(startMs) || typeof endMs !== "number" || !Number.isFinite(endMs)) {
      throw new LiveWindowShapeError(index, "has a non-finite or non-numeric startMs/endMs");
    }
    // `isLiveAt` — D-18's ONE definition of live, shared with the offline
    // builder and never re-implemented here (same rule as `liveEventsAt`).
    if (!isLiveAt({ startMs, endMs }, epochMs)) continue;
    try {
      live.push(LiveWindowEntrySchema.parse(candidate));
    } catch (err) {
      throw new ManifestValidationError("live-windows", err);
    }
  }

  return live.sort((a, b) => (a.eventKey < b.eventKey ? -1 : a.eventKey > b.eventKey ? 1 : 0));
}
