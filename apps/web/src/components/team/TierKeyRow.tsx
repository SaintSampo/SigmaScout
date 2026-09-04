import { cn } from "@/lib/utils";
import { TIER_BANDS } from "@/lib/tiers";

/**
 * D-17's tier key row (06-07-PLAN.md Task 1; Common boxed quick task
 * 260904-7rt, sketch 008 winner C) — the four bands in order, ALL FOUR now
 * boxed (Common draws the hairline ring, no fill), labelled with their
 * percentile ranges and tier names, using the same
 * `.metric-tier`/`.metric-tier--{tier}` tokens `MetricValue.tsx` applies to
 * each grid cell (no independent colour source). Rendered once above the
 * season-header metric grid (06-UI-SPEC.md's "Tier key row" Copywriting
 * Contract row, pre-260904-7rt wording: "Key (percentile)  [0–50 · no box]
 * [50–75]  [75–95]  [95–100]   Common · Rare · Epic · Legendary" — the "no
 * box" callout is stale post-260904-7rt; Common now draws the same class
 * pair every other band does).
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
