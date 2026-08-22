/**
 * The Worker-importable half of `packages/harness/manifests.ts` — the two
 * manifests' Zod schemas, `isLiveAt`, and the published-algorithm-id
 * constants, with NO Node-only imports at all (no `node:fs`, no `node:path`,
 * no `./cli.js`, no corpus). Extracted (plan 04-06 Task 1, Rule 3 blocking
 * fix) for the exact reason `packages/core/algorithms/leakProof.ts`'s own
 * header already documents for the identical situation: `manifests.ts`
 * imports `readFileSync`/`join` from `node:fs`/`node:path` directly (used by
 * `buildAlgorithmsManifest`) AND imports `warnIfNewerPromotedSigma1` from
 * `./cli.js`, which itself imports the corpus (`better-sqlite3`) at module
 * top level — since ES module imports are FILE-scoped, not export-scoped,
 * importing even a single schema from `manifests.ts` would drag that entire
 * transitive graph into the Worker's bundle. `apps/worker/src/liveWindows.ts`
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

/** D-03: the four Phase-2/Phase-3 experiment ids that exist to answer harness questions and must never appear in a user-facing manifest. */
export const HARNESS_ONLY_ALGORITHM_IDS = new Set(["sigma1-defaults", "sigma1-seasonsd", "sigma1-normalcdf", "sigma1-adapt"]);

/** D-03: the published set is exactly these three ids, in this order. */
export const PUBLISHED_ALGORITHM_IDS = ["opr", "epa", "sigma1"] as const;

export const AlgorithmManifestEntrySchema = z.object({
  id: z.string().min(1),
  /** `{codeVersion}+{paramSetName}` — D-13's version identity. */
  version: z.string().min(1),
  codeVersion: z.string().min(1),
  paramSetName: z.string().min(1),
  /** Present only for the Sigma1 entry — a Worker rebuilds the module with `makeSigma1({ params, ... })`; OPR/EPA carry no tunable parameter set. */
  params: Sigma1ParamsSchema.optional(),
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
            `D-03: algorithm id "${entry.id}" is harness-only (one of sigma1-defaults/sigma1-seasonsd/` +
            `sigma1-normalcdf/sigma1-adapt) and must never appear in the published algorithms manifest — ` +
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
