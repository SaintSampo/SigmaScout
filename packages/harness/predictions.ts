/**
 * D-23/D-24/D-25: the per-match, per-algorithm prediction sidecar. This is
 * what makes SC-4's claim ("every match has a predicted winner, win
 * probability, and predicted alliance scores for each algorithm, with
 * Sigma1's carrying variance") checkable rather than asserted — the record
 * exists on disk, one JSONL line per (match, algorithm).
 *
 * Streaming, not buffered (D-25): `openPredictionsWriter` opens a file
 * handle once, `writePredictionLine` validates-then-appends ONE line at a
 * time, and `closePredictionsWriter` closes it. A run interrupted after N of
 * M intended records leaves a file whose N lines all parse — a single
 * end-of-run `JSON.stringify` + one write could not deliver that property.
 *
 * D-23: this file lives beside `artifact.json` under the run's `--out` (or
 * `--predictions-out`) directory — never inside the corpus. `runSeasonsMode`
 * (packages/harness/cli.ts) keeps reading the corpus via
 * `openCorpusReadOnly`, so a scoring run still cannot mutate the data it
 * scores (Phase 1 T-01-13, preserved).
 *
 * Naming note: `replay.ts` already exports an in-memory `PredictionRecord`
 * with a different field set (a `{ match, prediction }` pair built during a
 * single-algorithm replay). This module's persisted shape is named
 * `PersistedPredictionRecord` deliberately, so an import cannot silently
 * pick the wrong one.
 */
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/** Bumped whenever this file's on-disk shape changes in a way a consumer (Phase 6's metric-history plot, Phase 7's Breakdown tab) must know about. */
export const PREDICTIONS_SCHEMA_VERSION = 1;

/**
 * D-24: one component's predicted contribution to an alliance's score.
 * `variance` is present only for algorithms that model uncertainty
 * (Sigma1) — omitted entirely (never `0`) for algorithms that do not
 * (OPR, EPA), matching `packages/core/algorithms/types.ts`'s
 * `ComponentPrediction`.
 */
const ComponentPredictionSchema = z.object({
  mean: z.number(),
  variance: z.number().optional(),
});

export const PredictionRecordSchema = z.object({
  matchKey: z.string().min(1),
  season: z.number().int(),
  eventKey: z.string().min(1),
  compLevel: z.enum(["qm", "ef", "qf", "sf", "f"]),
  algorithmId: z.string().min(1),
  algorithmVersion: z.string().min(1),
  predictedWinner: z.enum(["red", "blue"]),
  pRedWin: z.number(),
  predictedRedScore: z.number(),
  predictedBlueScore: z.number(),
  /** D-24: full component vectors, not a totals-only summary — present for every algorithm, empty `{}` for one (like OPR) that does not decompose its prediction. */
  redComponents: z.record(z.string(), ComponentPredictionSchema),
  blueComponents: z.record(z.string(), ComponentPredictionSchema),
  /** Alliance-total predictive variance (D-10). Present only for algorithms that model it (Sigma1) — omitted entirely, never `0`, for OPR/EPA. */
  variance: z.number().optional(),
  actualWinner: z.enum(["red", "blue", "tie"]),
  actualRedScore: z.number(),
  actualBlueScore: z.number(),
});

/** The persisted, on-disk shape — distinct from `replay.ts`'s in-memory `PredictionRecord` (see file header). */
export type PersistedPredictionRecord = z.infer<typeof PredictionRecordSchema>;

export interface PredictionsWriterHandle {
  readonly path: string;
  readonly fd: number;
  readonly secretToScrub?: string;
}

/**
 * Opens `{outDir}/predictions-{season}.jsonl` for writing, truncating any
 * existing file from a prior run (a fresh replay produces a fresh sidecar,
 * never a mix of two runs' lines). `secretToScrub`, when supplied, is
 * checked against every serialized line before it reaches disk (T-02-02);
 * pass `undefined` on a path with no secret in scope (e.g. the read-only
 * season/seasons path, which never touches the TBA API key) and say so at
 * the call site.
 */
export function openPredictionsWriter(outDir: string, season: number, secretToScrub?: string): PredictionsWriterHandle {
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `predictions-${season}.jsonl`);
  const fd = openSync(path, "w");
  return { path, fd, secretToScrub };
}

/**
 * Validates `record` against `PredictionRecordSchema`, serializes it to one
 * JSON line, runs the secret-scrub check, and appends it — throwing (via
 * Zod, or the secret check) before anything reaches disk for THIS record,
 * without disturbing lines already written by prior calls on the same
 * handle (D-25's interrupted-run property).
 */
export function writePredictionLine(handle: PredictionsWriterHandle, record: PersistedPredictionRecord): void {
  const validated = PredictionRecordSchema.parse(record);
  const line = JSON.stringify(validated);
  if (handle.secretToScrub && line.includes(handle.secretToScrub)) {
    throw new Error("Refusing to write prediction record: serialized output contains a secret value.");
  }
  writeSync(handle.fd, line + "\n");
}

export function closePredictionsWriter(handle: PredictionsWriterHandle): void {
  closeSync(handle.fd);
}
