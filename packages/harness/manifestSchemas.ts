/**
 * The Worker-importable half of `packages/harness/manifests.ts` — the two
 * manifests' Zod schemas, `isLiveAt`, and the published-algorithm-id
 * constants, with NO Node-only imports at all (no `node:fs`, no `node:path`,
 * no `./cli.js`, no corpus). Extracted for the exact reason
 * `packages/core/algorithms/leakProof.ts`'s own header already documents
 * for the identical situation: `manifests.ts` imports
 * `readFileSync`/`join` from `node:fs`/`node:path` directly (used by
 * `buildAlgorithmsManifest`) — since ES module imports are FILE-scoped,
 * not export-scoped, importing even a single schema from `manifests.ts`
 * would drag that entire transitive graph into the Worker's bundle.
 * `apps/worker/src/liveWindows.ts` needs exactly these schemas: the
 * Worker validates the fetched manifests against these same schemas and
 * uses `isLiveAt` rather than writing its own inequality — this file is
 * what makes that safe. `manifests.ts` re-exports every symbol below
 * unchanged, so every existing call site (`publish.ts`, `manifests.test.ts`)
 * keeps working without modification.
 *
 * This module must stay importable unchanged by the Worker — same
 * constraint `packages/core/algorithms/types.ts`'s own header states.
 */
import { z } from "zod";

export { PUBLISHED_ALGORITHM_IDS, type PublishedAlgorithmId } from "./publishedAlgorithms.js";

/** Shared literal for both manifests — bumped whenever either shape changes in a way the Worker must know about. Independent of `pageArtifacts.ts`'s `PAGE_ARTIFACT_SCHEMA_VERSION` (different consumer, different evolution schedule). */
export const MANIFEST_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// The live-windows manifest
// ---------------------------------------------------------------------------

/** One hour of pad on each side of an event's own observed match timestamps. */
export const LIVE_WINDOW_PAD_MS = 60 * 60 * 1000;

export const LiveWindowEntrySchema = z.object({
  eventKey: z.string().min(1),
  season: z.number().int(),
  /** Integer epoch milliseconds — a numeric half-open interval, not a date string, so `isLiveAt` is an integer comparison, never a parse. */
  startMs: z.number().int(),
  endMs: z.number().int(),
  /**
   * True when this window was derived from `start_date` alone (the event has
   * no matches in the corpus yet) rather than from real observed match
   * timestamps. THE CONTRACT BOTH SIDES READ (quick task 260920-lny): `true`
   * means PROBE-ONLY — a reader must prove matches actually exist (one
   * cheap, conditional check) before entering the full live/fold path for
   * this entry. The offline builder (`manifests.ts`'s `buildLiveWindowsManifest`)
   * never marks a MEASURED window `true`; the Worker
   * (`apps/worker/src/scheduled.ts`'s `runProbes`) never folds a `true` entry
   * on the strength of the window alone.
   */
  inferred: z.boolean(),
});

export type LiveWindowEntry = z.infer<typeof LiveWindowEntrySchema>;

export const LiveWindowsManifestSchema = z.object({
  schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
  generation: z.string().min(1),
  computedAt: z.string().min(1),
  windows: z.array(LiveWindowEntrySchema),
});

export type LiveWindowsManifest = z.infer<typeof LiveWindowsManifestSchema>;

/**
 * The live-windows manifest's PREAMBLE only, with `windows` left as an
 * unvalidated array. Exists so the Worker's per-tick read path can prove it is
 * looking at a real, current-schema live-windows manifest *without* paying to
 * Zod-validate every entry in it — see `apps/worker/src/liveWindows.ts`'s
 * `loadLiveEventsAt` for the full rationale and the cost measurement that
 * motivated it. `windows: z.array(z.unknown())` still rejects a manifest whose
 * `windows` is missing or is not an array; it only defers the PER-ENTRY field
 * checks to the caller, which runs them on the entries it actually uses.
 *
 * Keep this in lockstep with `LiveWindowsManifestSchema` above: every preamble
 * field there must appear here identically. `manifests.test.ts` asserts
 * that, so the two cannot drift.
 */
export const LiveWindowsManifestEnvelopeSchema = z.object({
  schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
  generation: z.string().min(1),
  computedAt: z.string().min(1),
  windows: z.array(z.unknown()),
});

export type LiveWindowsManifestEnvelope = z.infer<typeof LiveWindowsManifestEnvelopeSchema>;

/**
 * The single liveness predicate — the offline builder and the Worker
 * share this one definition of "live" rather than each writing their own
 * inequality. Half-open: `[startMs, endMs)`.
 */
export function isLiveAt(window: Pick<LiveWindowEntry, "startMs" | "endMs">, epochMs: number): boolean {
  return window.startMs <= epochMs && epochMs < window.endMs;
}

// ---------------------------------------------------------------------------
// The algorithms manifest
// ---------------------------------------------------------------------------

export const AlgorithmManifestEntrySchema = z.object({
  id: z.string().min(1),
  /** `{codeVersion}+{paramSetName}` version identity. */
  version: z.string().min(1),
  codeVersion: z.string().min(1),
  paramSetName: z.string().min(1),
  /**
   * The season whose tuned parameter set an entry carried. OPTIONAL and
   * never written by any published algorithm today — no published
   * algorithm carries a tuned parameter set. The schema is non-strict, so
   * a legacy `params` key on an already-published manifest is stripped on
   * parse rather than rejected; no `MANIFEST_SCHEMA_VERSION` bump.
   */
  paramsSeason: z.number().int().optional(),
});

export type AlgorithmManifestEntry = z.infer<typeof AlgorithmManifestEntrySchema>;

export const AlgorithmsManifestSchema = z.object({
  schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
  generation: z.string().min(1),
  computedAt: z.string().min(1),
  algorithms: z.array(AlgorithmManifestEntrySchema),
});

export type AlgorithmsManifest = z.infer<typeof AlgorithmsManifestSchema>;

/** Thrown when an algorithm's `version` string does not carry the `{codeVersion}+{paramSetName}` shape — mirrors `pageArtifacts.ts`'s `MissingVersionSeparatorError` discipline. */
export class MissingManifestVersionSeparatorError extends Error {
  constructor(algorithmId: string, version: string) {
    super(
      `algorithm "${algorithmId}"'s version "${version}" does not carry the ` +
        `"{codeVersion}+{paramSetName}" shape (no "+" found)`
    );
    this.name = "MissingManifestVersionSeparatorError";
  }
}

export function splitManifestVersion(algorithmId: string, version: string): { codeVersion: string; paramSetName: string } {
  const separatorIndex = version.indexOf("+");
  if (separatorIndex === -1) {
    throw new MissingManifestVersionSeparatorError(algorithmId, version);
  }
  return {
    codeVersion: version.slice(0, separatorIndex),
    paramSetName: version.slice(separatorIndex + 1),
  };
}
