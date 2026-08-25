import { cn } from "@/lib/utils";
import { TIER_BANDS } from "@/lib/tiers";

/**
 * D-17's tier key row (06-07-PLAN.md Task 1) — the four bands in order with
 * Common marked as unboxed, labelled with their percentile ranges and tier
 * names, using the same `.metric-tier`/`.metric-tier--{tier}` tokens
 * `MetricValue.tsx` applies to each grid cell (no independent colour
 * source). Rendered once above the season-header metric grid
 * (06-UI-SPEC.md's "Tier key row" Copywriting Contract row: "Key
 * (percentile)  [0–50 · no box]  [50–75]  [75–95]  [95–100]   Common · Rare
 * · Epic · Legendary").
 */
export function TierKeyRow() {
  return (
    <div data-testid="tier-key-row" className="flex flex-wrap items-center gap-[var(--spacing-sm)] text-role-label text-[var(--color-text-muted)]">
      <span>Key (percentile)</span>
      <span className="flex flex-wrap items-center gap-[var(--spacing-xs)]">
        {TIER_BANDS.map((band) => (
          <span key={band.tier} className={cn("metric-tier", band.tier !== "common" && `metric-tier--${band.tier}`)}>
            {`${band.min}–${band.max}${band.tier === "common" ? " · no box" : ""}`}
          </span>
        ))}
      </span>
      <span>{TIER_BANDS.map((band) => band.label).join(" · ")}</span>
    </div>
  );
}
