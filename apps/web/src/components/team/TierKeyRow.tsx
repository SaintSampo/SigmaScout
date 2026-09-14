import { cn } from "@/lib/utils";
import { TIER_BANDS } from "@/lib/tiers";

/**
 * The tier key row: the four bands in order, ALL FOUR boxed (Common draws
 * the hairline ring, no fill), labelled with their percentile ranges and
 * tier names, using the same `.metric-tier`/`.metric-tier--{tier}` tokens
 * `MetricValue.tsx` applies to each grid cell (no independent colour
 * source). Rendered once above the season-header metric grid.
 */
export function TierKeyRow() {
  return (
    <div data-testid="tier-key-row" className="flex flex-wrap items-center gap-[var(--spacing-sm)] text-role-label text-[var(--color-text-muted)]">
      <span>Key (percentile)</span>
      <span className="flex flex-wrap items-center gap-[var(--spacing-xs)]">
        {TIER_BANDS.map((band) => (
          <span key={band.tier} className={cn("metric-tier", `metric-tier--${band.tier}`)}>
            {`${band.min}–${band.max}`}
          </span>
        ))}
      </span>
    </div>
  );
}
