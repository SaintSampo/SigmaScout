/**
 * The narrow client-side algorithms-manifest fetcher (Task 3,
 * 05-05-PLAN.md).
 *
 * `AlgorithmsManifestClientSchema` deliberately declares its OWN narrow
 * schema rather than importing the harness's own full manifest-schema
 * module's `AlgorithmsManifestSchema`: that module imports `Sigma1ParamsSchema` from
 * the Sigma1 algorithm barrel, which transitively reaches the whole Sigma1
 * implementation (including its matrix-library dependency) — fine for
 * `apps/worker` (already pays that cost), wrong for a browser bundle that
 * only needs three id strings and their version labels. This file declares
 * only the preamble fields plus an array of entries carrying `id`,
 * `version`, `codeVersion` and `paramSetName`; any other key on a real
 * manifest entry (e.g. the real schema's optional `params`) is silently
 * stripped by Zod's default object mode, never validated — this client has
 * no use for it and must never import a schema that requires it. This is
 * this plan's `<threat_model>` T-05-04 mitigation and its own `<prohibitions>`
 * entry ("The client must NOT import the harness manifest schema module").
 *
 * The fetch/parse/error shape mirrors `apps/worker/src/liveWindows.ts`'s
 * parse-or-throw discipline (05-PATTERNS.md) and `lib/api/teams.ts`'s
 * (05-01) named-error convention — every thrown error here is a named
 * `class X extends Error`, never a bare `throw new Error(...)`.
 */
import { z } from "zod";
import { artifactUrl } from "../artifactOrigin.js";

/** Must match `apps/worker/src/liveWindows.ts`'s `ALGORITHMS_MANIFEST_KEY` and `packages/harness/publish.ts`'s own manifest upload key exactly. */
export const ALGORITHMS_MANIFEST_KEY = "v1/manifest/algorithms.json";

const AlgorithmManifestEntryClientSchema = z.object({
  id: z.string().min(1),
  /** `{codeVersion}+{paramSetName}` — D-13's version identity. */
  version: z.string().min(1),
  codeVersion: z.string().min(1),
  paramSetName: z.string().min(1),
});

export const AlgorithmsManifestClientSchema = z.object({
  schemaVersion: z.number().int(),
  generation: z.string().min(1),
  computedAt: z.string().min(1),
  algorithms: z.array(AlgorithmManifestEntryClientSchema),
});

export type AlgorithmsManifestClient = z.infer<typeof AlgorithmsManifestClientSchema>;

export class AlgorithmsManifestFetchError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`fetchAlgorithmsManifest: failed with HTTP ${status}`);
    this.name = "AlgorithmsManifestFetchError";
    this.status = status;
  }
}

export class AlgorithmsManifestValidationError extends Error {
  constructor(cause: unknown) {
    super(`fetchAlgorithmsManifest: failed schema validation: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "AlgorithmsManifestValidationError";
  }
}

export async function fetchAlgorithmsManifest(): Promise<AlgorithmsManifestClient> {
  const res = await fetch(artifactUrl(ALGORITHMS_MANIFEST_KEY));
  if (!res.ok) {
    throw new AlgorithmsManifestFetchError(res.status);
  }
  const body: unknown = await res.json();
  try {
    return AlgorithmsManifestClientSchema.parse(body);
  } catch (err) {
    throw new AlgorithmsManifestValidationError(err);
  }
}

/**
 * The manifest changes only at a publish (05-UI-SPEC.md's "Algorithm
 * dropdown" populated row) — a long `staleTime` is correct: this is low-
 * stakes UI chrome, not a value that needs to track a live event tick.
 */
const ALGORITHMS_MANIFEST_STALE_TIME_MS = 30 * 60 * 1000;

export function algorithmsManifestQueryOptions() {
  return {
    queryKey: ["algorithms-manifest"] as const,
    queryFn: fetchAlgorithmsManifest,
    staleTime: ALGORITHMS_MANIFEST_STALE_TIME_MS,
    // On failure the dropdown silently keeps the build-time list with no
    // version suffix (05-UI-SPEC.md "Algorithm dropdown" error backstop) —
    // a retry storm against a down/misconfigured manifest endpoint would be
    // wasted work for chrome nobody is blocked on.
    retry: 1,
  };
}
