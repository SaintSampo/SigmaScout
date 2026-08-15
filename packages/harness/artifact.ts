/**
 * The versioned, Zod-validated canonical JSON artifact (D-02, D-03, D-20,
 * D-21). Per D-02 this JSON is canonical and the HTML report (Task 3)
 * renders from it, never the reverse — the Phase 8 Compare page reads this
 * exact shape, so it is a contract from today. `HarnessArtifactSchema` is
 * the executable specification: validating on write is the guard against
 * the failure this project has already recorded once (documentation
 * describing a model that no longer exists) — a schema that fails a test
 * the moment the shipped shape drifts cannot go stale quietly.
 *
 * D-20 (schema v2): one artifact now holds MANY algorithms' results from a
 * single shared-stream run (D-22) — `algorithms[]` replaces the old
 * per-run `provenance.algorithmId`/`algorithmVersion` scalar pair, and
 * every `ScoreSlice` carries its own `algorithmId` so slices from different
 * algorithms can coexist in one `slices[]` array. D-21: the artifact stores
 * raw numbers only (each algorithm's own Brier/accuracy/calibration) — no
 * precomputed deltas, no significance tests, no "algorithm X beats Y"
 * field anywhere in this schema. Any such comparison is computed by
 * whatever renders it, so there is exactly one place a comparison can be
 * wrong.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { ScoreSlice } from "./score.js";
import type { StatboticsReference } from "./statbotics.js";

/** Bumped whenever the artifact's shape changes in a way a consumer (Phase 8's Compare page) must know about. Plan 03-03 (v2 -> v3): `AlgorithmDescriptorSchema` gains D-13's `codeVersion`/`paramSetName` identity halves. */
export const ARTIFACT_SCHEMA_VERSION = 3;

const CalibrationBinSchema = z.object({
  binStart: z.number(),
  binEnd: z.number(),
  meanPredicted: z.number().nullable(),
  observedFrequency: z.number().nullable(),
  count: z.number().int().nonnegative(),
});

const ExclusionCountsSchema = z.object({
  offseason: z.number().int().nonnegative(),
  surrogateAffected: z.number().int().nonnegative(),
  missingResult: z.number().int().nonnegative(),
});

const ScoreSliceSchema = z.object({
  /** D-20: which algorithm this slice's metrics belong to. */
  algorithmId: z.string().min(1),
  season: z.number().int(),
  seasonLabel: z.enum(["tune", "holdout"]),
  /** D-09's discipline made structural: derived from `seasonLabel`, never set independently. */
  headlineEligible: z.boolean(),
  compLevelView: z.enum(["qualification", "elimination", "combined"]),
  /** Unrounded — rounding happens only when the HTML report renders a value. */
  brierScore: z.number().nullable(),
  winnerAccuracy: z.number().nullable(),
  scoredCount: z.number().int().nonnegative(),
  tieCount: z.number().int().nonnegative(),
  noCallCount: z.number().int().nonnegative(),
  exclusionCounts: ExclusionCountsSchema,
  candidateCount: z.number().int().nonnegative(),
  calibrationBins: z.array(CalibrationBinSchema),
});

const StatboticsReferenceSchema = z.object({
  season: z.number().int(),
  value: z.number(),
  sourceLabel: z.string().min(1),
  matchPopulation: z.string().min(1),
  capturedAt: z.string().min(1),
  fetched: z.boolean(),
});

const ProvenanceSchema = z.object({
  /** Identifies which corpus this run read (e.g. a file path or content hash) — a published figure must trace back to what produced it. */
  corpusIdentity: z.string().min(1),
  runTimestamp: z.string().min(1),
  seasonsCovered: z.array(z.number().int()),
});

/**
 * D-20/D-13 (plan 03-03, artifact schema v3): one entry per algorithm run
 * in this artifact — id and version, nothing computed from another
 * algorithm's results. `version` remains the composed
 * `{codeVersion}+{paramSetName}` string so an existing reader that only
 * knows `{id, version}` keeps working; `codeVersion`/`paramSetName` are the
 * SAME identity split into its two halves as separate REQUIRED fields, so
 * Phase 5's algorithm-version dropdown and Phase 8's Compare page can key
 * on them without string-splitting a format they would then silently
 * depend on.
 */
const AlgorithmDescriptorSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  codeVersion: z.string().min(1),
  paramSetName: z.string().min(1),
});

export const HarnessArtifactSchema = z.object({
  schemaVersion: z.number().int(),
  provenance: ProvenanceSchema,
  /** D-20: every algorithm scored in this run, stated once at the top level. */
  algorithms: z.array(AlgorithmDescriptorSchema).min(1),
  slices: z.array(ScoreSliceSchema),
  statboticsReferences: z.array(StatboticsReferenceSchema),
});

export type HarnessArtifact = z.infer<typeof HarnessArtifactSchema>;

export interface BuildArtifactParams {
  /** D-20: every algorithm scored in this run. `version` is split into `codeVersion`/`paramSetName` below (D-13). */
  algorithms: readonly { id: string; version: string }[];
  corpusIdentity: string;
  /** Defaults to `new Date().toISOString()` — overridable for deterministic tests. */
  runTimestamp?: string;
  slices: readonly ScoreSlice[];
  statboticsReferences: readonly StatboticsReference[];
}

/**
 * D-13/plan 03-03: splits a module's own `version` string
 * (`{codeVersion}+{paramSetName}`) into its two halves on the FIRST `+`.
 * Throws if the string does not carry that shape — a module that has not
 * adopted D-13's identity scheme must fail loudly at artifact-build time
 * rather than produce a descriptor with an invented `paramSetName` (T-03-11).
 */
function splitAlgorithmVersion(id: string, version: string): { codeVersion: string; paramSetName: string } {
  const separatorIndex = version.indexOf("+");
  if (separatorIndex === -1) {
    throw new Error(
      `buildArtifact: algorithm "${id}"'s version "${version}" does not carry D-13's "{codeVersion}+{paramSetName}" shape (no "+" found)`
    );
  }
  const codeVersion = version.slice(0, separatorIndex);
  const paramSetName = version.slice(separatorIndex + 1);
  if (codeVersion.length === 0 || paramSetName.length === 0) {
    throw new Error(
      `buildArtifact: algorithm "${id}"'s version "${version}" has an empty codeVersion or paramSetName half`
    );
  }
  return { codeVersion, paramSetName };
}

/**
 * Assembles and validates a `HarnessArtifact`. Throws (via Zod) rather than
 * returning a malformed object — an artifact that fails its own schema
 * cannot become a published claim.
 */
export function buildArtifact(params: BuildArtifactParams): HarnessArtifact {
  const seasonsCovered = Array.from(new Set(params.slices.map((slice) => slice.season))).sort((a, b) => a - b);

  const candidate = {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    provenance: {
      corpusIdentity: params.corpusIdentity,
      runTimestamp: params.runTimestamp ?? new Date().toISOString(),
      seasonsCovered,
    },
    algorithms: params.algorithms.map((algorithm) => ({
      id: algorithm.id,
      version: algorithm.version,
      ...splitAlgorithmVersion(algorithm.id, algorithm.version),
    })),
    slices: params.slices,
    statboticsReferences: params.statboticsReferences,
  };

  return HarnessArtifactSchema.parse(candidate);
}

/**
 * Validates `artifact` against `HarnessArtifactSchema` and, only if valid,
 * writes it to `{outDir}/artifact.json`. Re-validates independently of
 * `buildArtifact` (defense in depth: a hand-constructed or mutated artifact
 * must fail the same way). `secretToScrub`, when supplied (e.g. the TBA API
 * key), causes the write to throw rather than persist the value (T-01-11).
 */
export function writeArtifact(outDir: string, artifact: HarnessArtifact, secretToScrub?: string): string {
  const validated = HarnessArtifactSchema.parse(artifact);
  const serialized = JSON.stringify(validated, null, 2);
  if (secretToScrub && serialized.includes(secretToScrub)) {
    throw new Error("Refusing to write harness artifact: serialized output contains a secret value.");
  }
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, "artifact.json");
  writeFileSync(path, serialized, "utf8");
  return path;
}
