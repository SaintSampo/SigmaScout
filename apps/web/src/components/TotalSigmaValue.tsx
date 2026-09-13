import { cn } from "@/lib/utils";
import type { Tier } from "@/lib/tiers";
import { MetricValue, type DisplayMetric } from "./MetricValue";
import { usesSigmaScore } from "../../../../packages/harness/sigmaScore.js";

/**
 * Quick task 260913-jkp: the shared split-pill component. Sigma Score no
 * longer gets its own column or tile anywhere in the site — wherever a
 * Sigma-enabled algorithm's Total renders, it renders as ONE joined shape:
 * Total in Total's own tier colour, then a "±" and Sigma to two decimals in
 * Sigma's own tier colour (sketch 011 winner A, `.jA` rules). A team, tile
 * or cell with no published Sigma renders BYTE-IDENTICAL to plain
 * `MetricValue` — this component never invents a right half.
 *
 * `sigma`'s two shapes: `{ value, tier }` for a normal (inverted-residual)
 * Sigma tier, or `{ value, neutral: true }` for the Alliances Combined
 * Total's untiered band half — there is no percentile for a three-team
 * band, so it gets the neutral slate treatment rather than an invented tier.
 *
 * `total.spread` is NEVER read here, on purpose (developer rule 2026-09-09,
 * `DisplayMetric`'s own doc): the ± this component prints is always Sigma,
 * never the algorithm's own spread.
 *
 * No `aria-label` on the inner spans: a generic `<span>` silently drops an
 * `aria-label` (the CR-02 lesson recorded in `AlliancesTab.tsx`), and the
 * visible text — "425.67" then "±92.00" — already IS the accessible text.
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
 * Measurement block (planner, 2026-09-13; Playwright Chromium rig, live
 * spr@3.0.0+baseline artifacts across 2016-2020 and 2022-2026, 2,825
 * events):
 * - Worst-case Total: 6 characters ("425.67" event; "400.21"/"-41.67" season).
 * - Worst-case Sigma: 5 characters (max 92.00, 2026).
 * - Pill "425.67" | "±92.00": 130.31px (halves 64.16 + 66.16).
 * - Header "TOTAL ± SIGMA" (th-cell-label): 93.67px, 109.67 with 16px header padding.
 * TOTAL_SIGMA_COLUMN_WIDTH_PX = content 130.31 + 16px TableCell padding + 6px
 * hinting buffer = 152.31, rounded up to an even px = 154. The header
 * (109.67) fits inside it.
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
