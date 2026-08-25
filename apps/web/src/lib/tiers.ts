/**
 * D-04/D-17 (Phase 6, 06-07-PLAN.md Task 1): the rarity-tier band function —
 * maps a published per-metric percentile in the closed interval [0, 100]
 * (`TeamMetricSchema.percentile`, `packages/harness/pageArtifacts.ts`) to one
 * of the sketch-findings-sigmascout skill's four named tiers
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
 * confidently wrong colour (see this file's own STRIDE entry, T-06-02).
 */

export type Tier = "common" | "rare" | "epic" | "legendary";

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

export function tierForPercentile(percentile: number | undefined): Tier | undefined {
  if (percentile === undefined) return undefined;
  if (percentile < 0 || percentile > 100) return undefined;
  if (percentile >= 95) return "legendary";
  if (percentile >= 75) return "epic";
  if (percentile >= 50) return "rare";
  return "common";
}
