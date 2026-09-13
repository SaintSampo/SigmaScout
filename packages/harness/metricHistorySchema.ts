/**
 * Node-free home of the metric-history row schema (plan 05-01 Task 3),
 * split off for the same reason `manifestSchemas.ts` is split from
 * `manifests.ts`: this file has zero Node-only imports, only `zod`, so it is
 * safe on the browser's import graph — anything that needs
 * `MetricHistoryRowSchema` (`pageArtifacts.ts`'s
 * `TeamSeasonArtifactSchema.metricHistory` field, `publish.ts`'s
 * `MetricHistoryRow` type) imports from here directly rather than pulling in
 * a module with a Node-only streaming writer.
 */
import { z } from "zod";

export const MetricValueSchema = z.object({
  value: z.number(),
  /**
   * The algorithm's OWN confidence in its own rating — never SigmaScout's
   * Sigma Score, and never displayed anywhere on the site (developer rule,
   * 2026-09-09; the retired Sigma1 core's own uncertainty modelling was
   * deleted by quick task 260913-it4). Web readers must not read this field
   * at all; see `SIGMA_METRIC_KEY` below for the one quantity the site does
   * draw a `±` from.
   */
  spread: z.number().optional(),
  /**
   * D-06.1-A / F-06-3 (plan 06.1-03): a publish-time-only derived quantity —
   * no `AlgorithmModule` computes this. Ranks this history row's value
   * against THE season ranking pool for this metric — every team's value as
   * of its last official match (quick task 260912-tnk; before it, the
   * season-final distribution) — never the pool as of this row's own
   * `matchIndex`. Present only for the metric
   * names in `packages/harness/percentiles.ts`'s `HISTORY_PERCENTILE_METRIC_KEYS`
   * — see that constant's own doc comment for the measured payload-budget
   * reason a wider allowlist is not published. Absence is a valid, expected
   * state — a not-yet-republished artifact, an algorithm with no pool for
   * this metric, or a metric outside the allowlist — and the client renders
   * no tier box for it, exactly as it does for `TeamMetricSchema.percentile`
   * in `pageArtifacts.ts` (the same-pool counterpart this field mirrors, so
   * an equal value carries an equal percentile on both).
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
  /**
   * Component name -> that team's metric after this match, per
   * `AlgorithmModule.teamMetrics`.
   *
   * Quick task 260913-m45: for a Sigma-enabled algorithm (SPR today) this
   * record ALSO carries a `SIGMA_METRIC_KEY` ("sigma") entry — `{ value }`
   * only, no `percentile` (a per-match ranking pool has no meaning, and the
   * chart needs no tier) and no `spread` — the team's Sigma Score AS OF
   * AFTER THIS MATCH: read right after the offline pipeline's fold for this
   * match, or as of the end of the live Worker tick that folded it. No
   * ranking pool, no Teams row and no `seasonStats` entry ever reads this
   * per-match value; only `apps/web/src/components/team/metricHistorySeries.ts`'s
   * `buildMetricSeries` does, to draw the Metric History chart's Total ±
   * Sigma band. OPR and EPA rows, and any row from before the republish that
   * added this field, carry no `sigma` key at all.
   */
  metrics: z.record(z.string(), MetricValueSchema),
});

export type MetricHistoryRow = z.infer<typeof MetricHistoryRowSchema>;
