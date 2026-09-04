/**
 * The Worker-importable half of `packages/harness/manifests.ts` — the two
 * manifests' Zod schemas, `isLiveAt`, and the published-algorithm-id
 * constants, with NO Node-only imports at all (no `node:fs`, no `node:path`,
 * no `./cli.js`, no corpus). Extracted (plan 04-06 Task 1, Rule 3 blocking
 * fix) for the exact reason `packages/core/algorithms/leakProof.ts`'s own
 * header already documents for the identical situation: `manifests.ts`
 * imports `readFileSync`/`join` from `node:fs`/`node:path` directly (used by
 * `buildAlgorithmsManifest`) AND imports `warnIfNewerPromotedVpr` (plan
 * 07-16's rename of `warnIfNewerPromotedSigma1`) from `./cli.js`, which
 * itself imports the corpus (`better-sqlite3`) at module top level — since
 * ES module imports are FILE-scoped, not export-scoped, importing even a
 * single schema from `manifests.ts` would drag that entire transitive graph
 * into the Worker's bundle. `apps/worker/src/liveWindows.ts`
 * needs exactly these schemas (per this plan's own read_first/key_links: "the
 * Worker validates the fetched manifests against these same schemas ... uses
 * isLiveAt rather than writing its own inequality") — this file is what makes
 * that safe. `manifests.ts` re-exports every symbol below unchanged, so
 * every existing call site (`publish.ts`, `manifests.test.ts`) keeps working
 * without modification.
 *
 * This module must stay importable unchanged by the Phase 4 Worker — same
 * constraint `packages/core/algorithms/types.ts`'s own header states.
 */
import { z } from "zod";
import { Sigma1ParamsSchema } from "../core/algorithms/sigma1/index.js";

export { PUBLISHED_ALGORITHM_IDS, type PublishedAlgorithmId } from "./publishedAlgorithms.js";

/** Shared literal for both manifests — bumped whenever either shape changes in a way the Worker must know about. Independent of `pageArtifacts.ts`'s `PAGE_ARTIFACT_SCHEMA_VERSION` and `artifact.ts`'s `ARTIFACT_SCHEMA_VERSION` (different consumer, different evolution schedule). */
export const MANIFEST_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// D-18: the live-windows manifest
// ---------------------------------------------------------------------------

/** D-18/D-15: one hour of pad on each side of an event's own observed match timestamps. */
export const LIVE_WINDOW_PAD_MS = 60 * 60 * 1000;

export const LiveWindowEntrySchema = z.object({
  eventKey: z.string().min(1),
  season: z.number().int(),
  /** Integer epoch milliseconds — a numeric half-open interval, not a date string, so `isLiveAt` is an integer comparison, never a parse. */
  startMs: z.number().int(),
  endMs: z.number().int(),
  /** D-18: true when this window was derived from `start_date` alone (the event has no matches in the corpus yet) rather than from real observed match timestamps. */
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
 * D-18's single liveness predicate — the offline builder and the Worker
 * share this one definition of "live" rather than each writing their own
 * inequality. Half-open: `[startMs, endMs)`.
 */
export function isLiveAt(window: Pick<LiveWindowEntry, "startMs" | "endMs">, epochMs: number): boolean {
  return window.startMs <= epochMs && epochMs < window.endMs;
}

// ---------------------------------------------------------------------------
// D-03: the algorithms manifest
// ---------------------------------------------------------------------------

/** D-03: the four Phase-2/Phase-3 experiment ids that exist to answer harness questions and must never appear in a user-facing manifest. Renamed with the published algorithm (plan 07-16, D-04/D-05/PD-03) so the registry never carries two names for one model — every membership test below is EXACT string equality (`Set.has`), never a prefix/substring test, which is what keeps `vpr` itself from being swept into this set by its own name. */
export const HARNESS_ONLY_ALGORITHM_IDS = new Set(["vpr-defaults", "vpr-seasonsd", "vpr-normalcdf", "vpr-adapt"]);

export const AlgorithmManifestEntrySchema = z.object({
  id: z.string().min(1),
  /** `{codeVersion}+{paramSetName}` — D-13's version identity. */
  version: z.string().min(1),
  codeVersion: z.string().min(1),
  paramSetName: z.string().min(1),
  /** Present only for the VPR entry (`Sigma1ParamsSchema` — the implementation's own parameter type, not renamed per PD-02) — a Worker rebuilds the module with `makeSigma1({ params, ... })`; OPR/EPA carry no tunable parameter set. */
  params: Sigma1ParamsSchema.optional(),
  /**
   * D-2 (quick task 260904-100): the season whose set `params` carries.
   * OPTIONAL so every already-published manifest keeps validating — added
   * additively, no `MANIFEST_SCHEMA_VERSION` bump, since the Worker only
   * ever runs the LIVE season and needs exactly one season's set (never the
   * full `paramSetsBySeason` map, which would widen the published manifest
   * shape for no gain). Present whenever `params` is.
   */
  paramsSeason: z.number().int().optional(),
});

export type AlgorithmManifestEntry = z.infer<typeof AlgorithmManifestEntrySchema>;

export const AlgorithmsManifestSchema = z
  .object({
    schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
    generation: z.string().min(1),
    computedAt: z.string().min(1),
    algorithms: z.array(AlgorithmManifestEntrySchema),
  })
  .check((ctx) => {
    for (const entry of ctx.value.algorithms) {
      if (HARNESS_ONLY_ALGORITHM_IDS.has(entry.id)) {
        ctx.issues.push({
          code: "custom",
          message:
            `D-03: algorithm id "${entry.id}" is harness-only (one of vpr-defaults/vpr-seasonsd/` +
            `vpr-normalcdf/vpr-adapt) and must never appear in the published algorithms manifest — ` +
            `it exists to answer a Phase 2/3 harness question, not a Phase 5 dropdown choice`,
          path: ["algorithms"],
          input: ctx.value,
        });
      }
    }
  });

export type AlgorithmsManifest = z.infer<typeof AlgorithmsManifestSchema>;

/** Thrown when an algorithm's `version` string does not carry D-13's `{codeVersion}+{paramSetName}` shape — mirrors `pageArtifacts.ts`'s `MissingVersionSeparatorError` discipline. */
export class MissingManifestVersionSeparatorError extends Error {
  constructor(algorithmId: string, version: string) {
    super(
      `algorithm "${algorithmId}"'s version "${version}" does not carry D-13's ` +
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
