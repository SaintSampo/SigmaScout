import { cn } from "@/lib/utils";
import type { Tier } from "@/lib/tiers";
import { MetricValue, type DisplayMetric } from "./MetricValue";
import { usesSigmaScore } from "../../../../packages/harness/sigmaScore.js";

/**
 * The shared split-pill component. Sigma Score no longer gets its own
 * column or tile anywhere in the site — wherever a Sigma-enabled
 * algorithm's Total renders, it renders as ONE joined shape: Total in
 * Total's own tier colour, then a "±" and Sigma to two decimals in Sigma's
 * own tier colour. A team, tile or cell with no published Sigma renders
 * BYTE-IDENTICAL to plain `MetricValue` — this component never invents a
 * right half.
 *
 * `sigma`'s two shapes: `{ value, tier }` for a normal (inverted-residual)
 * Sigma tier, or `{ value, neutral: true }` for the Alliances Combined
 * Total's untiered band half — there is no percentile for a three-team
 * band, so it gets the neutral slate treatment rather than an invented tier.
 *
 * `total.spread` is NEVER read here, on purpose (see `DisplayMetric`'s own
 * doc): the ± this component prints is always Sigma, never the algorithm's
 * own spread.
 *
 * No `aria-label` on the inner spans: a generic `<span>` silently drops an
 * `aria-label`, and the visible text — "425.67" then "±92.00" — already IS
 * the accessible text.
 */
export interface TotalSigmaValueSigma {
  value: number;
  tier?: Tier;
  neutral?: boolean;
}

export function TotalSigmaValue({
  total,
  totalTier,
  sigma,
  className,
}: {
  total?: DisplayMetric;
  totalTier?: Tier;
  sigma?: TotalSigmaValueSigma;
  className?: string;
}) {
  if (total === undefined) {
    // A Sigma value never renders without its Total — the blank cell wins.
    return <MetricValue className={className} />;
  }

  if (sigma === undefined) {
    // Byte-identical to today: every no-Sigma surface (OPR, EPA, a team with
    // no sigma entry, a pre-republish artifact) is unaffected by this
    // component's existence.
    return <MetricValue metric={total} tier={totalTier} className={className} />;
  }

  const sigmaModifier = sigma.neutral === true ? "metric-pill__sigma--neutral" : sigma.tier !== undefined ? `metric-tier--${sigma.tier}` : undefined;

  return (
    <span className={cn("numeric-cell whitespace-nowrap metric-pill", className)} data-testid="total-sigma-pill">
      <span className={cn("metric-pill__total", totalTier !== undefined && `metric-tier--${totalTier}`)}>
        <span className="text-role-body">{total.value.toFixed(2)}</span>
      </span>
      <span className={cn("metric-pill__sigma", sigmaModifier)}>
        <span className="text-role-body">
          <span className="metric-pill__pm">±</span>
          {sigma.value.toFixed(2)}
        </span>
      </span>
    </span>
  );
}

/**
 * Measured worst-case column width: Total up to 6 characters ("425.67"
 * event; "400.21"/"-41.67" season), Sigma up to 5 characters (max 92.00,
 * 2026). The pill "425.67" | "±92.00" measures 130.31px;
 * `TOTAL_SIGMA_COLUMN_WIDTH_PX` is that content width plus 16px TableCell
 * padding plus a 6px hinting buffer, rounded up to an even px. The header
 * ("TOTAL ± SIGMA") fits inside it.
 */
export const TOTAL_SIGMA_COLUMN_WIDTH_PX = 154;

/** "Total ± Sigma" for a Sigma-enabled algorithm, "Total" otherwise. */
export function totalColumnHeader(algorithmId: string): string {
  return usesSigmaScore(algorithmId) ? "Total ± Sigma" : "Total";
}

/** {@link TOTAL_SIGMA_COLUMN_WIDTH_PX} for a Sigma-enabled algorithm, `otherwiseWidth` otherwise. */
export function totalColumnWidth(algorithmId: string, otherwiseWidth: number): number {
  return usesSigmaScore(algorithmId) ? TOTAL_SIGMA_COLUMN_WIDTH_PX : otherwiseWidth;
}
