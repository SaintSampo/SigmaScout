import { tierForPercentile, type Tier } from "./tiers";
import { TOTAL_KEY } from "./metricKeys";
import type { EventArtifact } from "../../../../packages/harness/pageArtifacts.js";

/**
 * The 3x heuristic (07-UAT.md G-8, developer decision 2026-08-30): an
 * alliance's COMBINED three-team total has no published percentile of its
 * own to tier against. `apps/web/src/lib/metricGroups.ts`'s own header
 * states plainly why one cannot be derived for a sum: "nor can a percentile
 * be derived, since a sum's rank is not a function of its parts' ranks."
 * When the identical problem arose for the Auto/Teleop/Endgame phase tiles,
 * the pipeline was widened to compute a true quadratic-form percentile
 * there (`sigma1/index.ts`'s `teamMetrics`, via `covariance.ts`'s
 * `subsetVariance`). The developer chose the lighter client-side
 * APPROXIMATION here instead, accepting the trade rather than funding that
 * pipeline work for this one column — so this module's output is always an
 * ESTIMATE, never an exact rank, and every caller must surface it to the
 * reader as approximate (`AlliancesTab.tsx`'s marker does this).
 *
 * Method: divide the combined 3-team value by 3 to get a per-team
 * equivalent (dividing by 3 is the same operation as scaling a
 * SINGLE-team's percentile thresholds by 3, since D-15's combined value is
 * a plain sum of three same-shaped team totals), then look up where that
 * per-team equivalent falls among the EVENT's own published
 * `(total.value, total.percentile)` pairs by monotone linear interpolation,
 * clamping outside the observed range. This answers "roughly where would a
 * team with this average value rank at this event's season pool" — a
 * genuinely different question from "what is this alliance's true combined
 * percentile," which no published data can answer (see the paragraph
 * above).
 */

export interface TierApproximationPoint {
  /** A team's published `total.value` at this event. */
  value: number;
  /** That same team's published `total.percentile`, over the full season pool (never the event's own roster — `TeamMetricSchema.percentile`'s own definition). */
  percentile: number;
}

export interface AllianceApproxTier {
  tier: Tier;
  /** The interpolated percentile actually used to derive `tier` — always approximate, never a published value. */
  percentile: number;
}

/**
 * Every event team's `(total.value, total.percentile)` pair, sorted
 * ascending by value — `estimateCombinedTier`'s own contract requires this
 * ordering and does not re-sort defensively (see that function's doc
 * comment for why). Teams with no published `total` metric, or a `total`
 * with no published `percentile`, are SKIPPED entirely — never treated as a
 * value of 0, which would corrupt the interpolation with a fabricated
 * bottom-of-the-pool data point. An event roster is typically tens of
 * teams, so a handful of skips does not starve this of usable data.
 */
export function buildTeamValuePercentilePoints(teams: EventArtifact["teams"]): TierApproximationPoint[] {
  const points: TierApproximationPoint[] = [];
  for (const team of teams) {
    const total = team.metrics[TOTAL_KEY];
    if (total === undefined || total.percentile === undefined) continue;
    points.push({ value: total.value, percentile: total.percentile });
  }
  return points.sort((a, b) => a.value - b.value);
}

/**
 * The 3x heuristic itself (see this module's header comment for the full
 * method and why it exists). `points` MUST already be sorted ascending by
 * `value` — `buildTeamValuePercentilePoints`'s own contract — this function
 * does not re-sort: an unsorted input produces an obviously, immediately
 * wrong tier (easy to catch in review or a test) rather than paying an
 * O(n log n) re-sort on every render to defend against a caller bug.
 *
 * Values outside the observed range CLAMP to the nearest endpoint's own
 * percentile, rather than extrapolating past data that doesn't exist.
 * Returns `undefined` only when `points` is empty — nothing published to
 * interpolate against at all (e.g. an algorithm this event's percentile
 * pass has not been extended to cover).
 */
export function estimateCombinedTier(combinedValue: number, points: readonly TierApproximationPoint[]): AllianceApproxTier | undefined {
  if (points.length === 0) return undefined;
  const perTeamEquivalent = combinedValue / 3;

  const first = points[0]!;
  if (perTeamEquivalent <= first.value) {
    return { percentile: first.percentile, tier: tierForPercentile(first.percentile) ?? "common" };
  }
  const last = points[points.length - 1]!;
  if (perTeamEquivalent >= last.value) {
    return { percentile: last.percentile, tier: tierForPercentile(last.percentile) ?? "common" };
  }

  for (let i = 0; i < points.length - 1; i++) {
    const lo = points[i]!;
    const hi = points[i + 1]!;
    if (perTeamEquivalent >= lo.value && perTeamEquivalent <= hi.value) {
      const span = hi.value - lo.value;
      const t = span === 0 ? 0 : (perTeamEquivalent - lo.value) / span;
      const percentile = lo.percentile + t * (hi.percentile - lo.percentile);
      return { percentile, tier: tierForPercentile(percentile) ?? "common" };
    }
  }
  // Unreachable given the two clamp branches above (every real number either
  // clamps at an endpoint or falls inside exactly one bracket of a sorted
  // array) — kept so this function's return type is honestly total rather
  // than implicitly "possibly undefined by falling off the end of a loop".
  return undefined;
}
