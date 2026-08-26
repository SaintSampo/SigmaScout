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
  /**
   * D-06.1-A / F-06-3 (plan 06.1-03): a publish-time-only derived quantity —
   * no `AlgorithmModule` computes this. Ranks this history row's value
   * against the SEASON-FINAL distribution for this metric (D-06.1-A), never
   * the pool as of this row's own `matchIndex`. Present only for the metric
   * names in `packages/harness/percentiles.ts`'s `HISTORY_PERCENTILE_METRIC_KEYS`
   * — see that constant's own doc comment for the measured payload-budget
   * reason a wider allowlist is not published. Absence is a valid, expected
   * state — a not-yet-republished artifact, an algorithm with no pool for
   * this metric, or a metric outside the allowlist — and the client renders
   * no tier box for it, exactly as it does for `TeamMetricSchema.percentile`
   * in `pageArtifacts.ts` (the season-final counterpart this field mirrors).
   * Bounded to the closed interval [0, 100] so a pipeline defect fails
   * loudly at build time rather than reaching `tierForPercentile`, which
   * would otherwise return `undefined` and silently drop the tier box.
   */
  percentile: z.number().min(0).max(100).optional(),
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
