import { tierForPercentile, type Tier } from "./tiers";
import { TOTAL_KEY } from "./metricKeys";
import type { EventArtifact } from "../../../../packages/harness/pageArtifacts.js";

/**
 * An alliance's COMBINED three-team total has no published percentile of
 * its own to tier against — a sum's rank is not a function of its parts'
 * ranks, so this module's output is always an ESTIMATE, never an exact
 * rank, and every caller must surface it to the reader as approximate
 * (`AlliancesTab.tsx`'s marker does this).
 *
 * Method: divide the combined 3-team value by 3 to get a per-team
 * equivalent (equivalent to scaling a SINGLE team's percentile thresholds
 * by 3, since the combined value is a plain sum of three same-shaped team
 * totals), then look up where that per-team equivalent falls among the
 * EVENT's own published `(total.value, total.percentile)` pairs by monotone
 * linear interpolation, clamping outside the observed range. This answers
 * "roughly where would a team with this average value rank at this event's
 * season pool" — a different question from "what is this alliance's true
 * combined percentile," which no published data can answer.
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
 * ordering and does not re-sort defensively. Teams with no published
 * `total` metric, or a `total` with no published `percentile`, are SKIPPED
 * entirely — never treated as a value of 0, which would corrupt the
 * interpolation with a fabricated bottom-of-the-pool data point.
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
 * method). `points` MUST already be sorted ascending by `value` —
 * `buildTeamValuePercentilePoints`'s own contract — this function does not
 * re-sort.
 *
 * Values outside the observed range CLAMP to the nearest endpoint's own
 * percentile, rather than extrapolating past data that doesn't exist.
 * Returns `undefined` only when `points` is empty — nothing published to
 * interpolate against at all.
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
  // Unreachable given the two clamp branches above; kept so this function's
  // return type is honestly total.
  return undefined;
}
