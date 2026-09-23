/**
 * The rarity-tier band function — maps a published per-metric percentile
 * in the closed interval [0, 100] (`TeamMetricSchema.percentile`,
 * `packages/harness/pageArtifacts.ts`) to one of the
 * sketch-findings-sigmascout skill's four named tiers
 * (`.claude/skills/sketch-findings-sigmascout/references/colour-and-tiers.md`).
 *
 * Boundary contract (locked, tested at every cut and one step either side in
 * `tiers.test.ts`): half-open on the low side, closed at the very top —
 * Common covers [0, 50), Rare [50, 75), Epic [75, 95), Legendary [95, 100].
 *
 * `undefined` in gives `undefined` out — no percentile was published for
 * this metric (a not-yet-percentile-passed algorithm, or a metric the
 * pipeline's percentile pass has not been extended to cover), so no box
 * renders. A value outside [0, 100] ALSO returns `undefined` rather than
 * clamping: the publish-side schema (`z.number().min(0).max(100)`) already
 * bounds every real value, so an out-of-range input here can only mean a
 * pipeline defect — clamping it would silently hide that defect behind a
 * confidently wrong colour.
 */

import { publishedTierForPercentile, type SeasonTierCuts } from "../../../../packages/harness/pageArtifacts.js";
import { tierFromCuts, type Tier } from "../../../../packages/harness/tierCuts.js";

export type { Tier };

export interface TierBand {
  tier: Tier;
  /** Inclusive lower percentile bound. */
  min: number;
  /** Upper percentile bound — exclusive for every band except Legendary's, which is inclusive (100). */
  max: number;
  /** Display name, per colour-and-tiers.md's key-row copy. */
  label: string;
}

/**
 * The four bands in ascending order, Common first — consumed by
 * `TierKeyRow.tsx` to render the key row once above the season-header
 * metric grid. This is the single source of the boundary numbers;
 * `tierForPercentile` below encodes the same cuts as explicit comparisons
 * rather than looping this array, so the hot per-cell path stays a handful
 * of comparisons instead of an array scan.
 */
export const TIER_BANDS: readonly TierBand[] = [
  { tier: "common", min: 0, max: 50, label: "Common" },
  { tier: "rare", min: 50, max: 75, label: "Rare" },
  { tier: "epic", min: 75, max: 95, label: "Epic" },
  { tier: "legendary", min: 95, max: 100, label: "Legendary" },
];

/**
  * Delegates the cuts to `publishedTierForPercentile`, the same function the
  * pipeline uses to stamp `tier` onto the teams artifact — so a tier derived
  * here from a percentile and a tier published there can never disagree.
  * The only difference is this one names Common explicitly, where the
  * published field omits it for payload-size reasons alone (see
  * `pageArtifacts.ts`'s `TeamMetricSchema.tier` doc) — that omission is a
  * wire-format fact, not a rendering one. Common is NOT rendered unboxed:
  * `MetricValue` draws the `.metric-tier--common` hairline ring for any
  * defined tier, Common included, so `tierForPercentile`'s explicit
  * `"common"` here (never `undefined`) is exactly what makes that ring
  * appear for every caller that derives a tier from a percentile.
  */
export function tierForPercentile(percentile: number | undefined): Tier | undefined {
  if (percentile === undefined) return undefined;
  if (percentile < 0 || percentile > 100) return undefined;
  return publishedTierForPercentile(percentile) ?? "common";
}

/**
 * Resolves a metric entry's rarity tier for surfaces that may hold a
 * live-folded row: prefers the published `percentile` (via
 * `tierForPercentile` above) when present, and falls back to the event
 * artifact's `tierCuts` block (via `tierFromCuts`,
 * `packages/harness/tierCuts.ts`) for that metric name when it is not.
 * Quick task 260920-qzf: a live tick's `touchedEventTeamMetrics`
 * (`apps/worker/src/artifactMerge.ts`) writes a fresh VALUE for a touched
 * team's other metrics but carries no percentile forward — this is what
 * gives that row a tier again instead of rendering unboxed until the next
 * offline publish.
 *
 * The published percentile ALWAYS wins, even when a cut entry exists and
 * would disagree — a percentile is the exact ground truth, a cut is a
 * reconstruction of it. A metric entry with a value, no percentile and no
 * cut entry for that name resolves to no tier, never a guess. An absent
 * metric entry resolves to no tier regardless of cuts.
 *
 * The percentile NUMBER is never synthesized from `tierCuts` — only the
 * tier box is recoverable this way; every surface that prints a percentile
 * number keeps rendering it absent for a live-folded row.
 */
export function resolveMetricTier(
  entry: { readonly value?: number; readonly percentile?: number } | undefined,
  metricName: string,
  tierCuts: SeasonTierCuts | undefined
): Tier | undefined {
  if (entry === undefined) return undefined;
  if (entry.percentile !== undefined) return tierForPercentile(entry.percentile);
  return tierFromCuts(tierCuts?.[metricName], entry.value);
}
