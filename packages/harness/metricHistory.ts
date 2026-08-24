/**
 * D-28: the per-match, per-algorithm team metric-history sidecar. After
 * every match, exactly the 6 teams named on that match's two alliances are
 * snapshotted — not every team in state — one snapshot set per algorithm
 * per match. This is what Phase 6's metric-history plot and Phase 7's
 * Breakdown tab need: a team's metric trajectory across the season, without
 * a second corpus pass to reconstruct it.
 *
 * Scale (for anyone tuning this run): roughly 6 teams x ~104,000 played
 * matches ~= 620,000 rows PER ALGORITHM across 2022-2026. Large but bounded
 * and streamable — and gitignored (D-26). This writer is optional
 * (`--metric-history`, default off in `cli.ts`) precisely because a run
 * that only wants scores should not pay that cost.
 *
 * Mirrors `predictions.ts`'s shape exactly: validate-then-append streaming
 * writer, same secret-scrub discipline, same truncate-on-open semantics (a
 * fresh replay produces a fresh sidecar, never a mix of two runs' rows).
 *
 * The schema itself (`MetricValueSchema`/`MetricHistoryRowSchema`/
 * `MetricHistoryRow`) lives in `./metricHistorySchema.js`, a Node-free leaf,
 * and is re-exported here unchanged — see that file's header for why
 * (plan 05-01 Task 3: this module's `node:fs`/`node:path` imports are
 * file-scoped and would otherwise reach any browser bundle that needs only
 * the schema).
 */
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import { MetricHistoryRowSchema, type MetricHistoryRow } from "./metricHistorySchema.js";

export { MetricValueSchema, MetricHistoryRowSchema, type MetricHistoryRow } from "./metricHistorySchema.js";

export interface MetricHistoryWriterHandle {
  readonly path: string;
  readonly fd: number;
  readonly secretToScrub?: string;
}

/**
 * Opens `{outDir}/metrics-{season}.jsonl` for writing, truncating any
 * existing file from a prior run. `secretToScrub` follows `predictions.ts`'s
 * same rule: pass `undefined` on a path with no secret in scope, and say
 * why at the call site.
 */
export function openMetricHistoryWriter(outDir: string, season: number, secretToScrub?: string): MetricHistoryWriterHandle {
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `metrics-${season}.jsonl`);
  const fd = openSync(path, "w");
  return { path, fd, secretToScrub };
}

/**
 * Validates each row against `MetricHistoryRowSchema`, serializes it to one
 * JSON line, runs the secret-scrub check, and appends it — throwing before
 * a bad row reaches disk, without disturbing rows already written by prior
 * calls on the same handle.
 */
export function writeMetricHistoryRows(handle: MetricHistoryWriterHandle, rows: readonly MetricHistoryRow[]): void {
  for (const row of rows) {
    const validated = MetricHistoryRowSchema.parse(row);
    const line = JSON.stringify(validated);
    if (handle.secretToScrub && line.includes(handle.secretToScrub)) {
      throw new Error("Refusing to write metric-history row: serialized output contains a secret value.");
    }
    writeSync(handle.fd, line + "\n");
  }
}

export function closeMetricHistoryWriter(handle: MetricHistoryWriterHandle): void {
  closeSync(handle.fd);
}
