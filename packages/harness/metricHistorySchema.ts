/**
 * Node-free leaf carrying the metric-history row schema, split out of
 * `metricHistory.ts` for exactly the reason `manifestSchemas.ts`'s own
 * header documents for `manifests.ts` (plan 05-01 Task 3): `metricHistory.ts`
 * imports `node:fs`/`node:path` at module top level for its streaming
 * writer, and ES module imports are file-scoped — importing even a single
 * schema from that module would drag those Node built-ins into any browser
 * bundle that needs `MetricHistoryRowSchema` (via `pageArtifacts.ts`'s
 * `TeamSeasonArtifactSchema.metricHistory` field). This file has zero
 * Node-only imports, only `zod`, so it is safe on the browser's import
 * graph. `metricHistory.ts` re-exports everything below unchanged, so every
 * existing call site keeps working without modification.
 */
import { z } from "zod";

export const MetricValueSchema = z.object({
  value: z.number(),
  /** Present only for algorithms that model uncertainty (Sigma1) — omitted entirely, never `0`, for algorithms that do not (OPR). */
  spread: z.number().optional(),
});

export const MetricHistoryRowSchema = z.object({
  matchKey: z.string().min(1),
  season: z.number().int(),
  eventKey: z.string().min(1),
  algorithmId: z.string().min(1),
  teamKey: z.string().min(1),
  /** This team's position in the season's chronological match stream — the same total order `buildSeasonStream` produces, not a per-team match count. */
  matchIndex: z.number().int().nonnegative(),
  /** Component name -> that team's metric after this match, per `AlgorithmModule.teamMetrics`. */
  metrics: z.record(z.string(), MetricValueSchema),
});

export type MetricHistoryRow = z.infer<typeof MetricHistoryRowSchema>;
