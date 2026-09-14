import { cn } from "@/lib/utils";
import type { Tier } from "@/lib/tiers";

/**
 * The published `TeamMetric` shape: a required numeric value with an
 * optional numeric spread. `spread`'s optionality is a schema fact — OPR and
 * EPA rows carry no spread field at all, which is the normal case, not an
 * error.
 */
export interface DisplayMetric {
  value: number;
  /**
   * The ALGORITHM's own confidence in `value`. Present on the wire for the
   * algorithms that model it (SPR publishes one on `total` and all three
   * phase metrics).
   *
   * DELIBERATELY NOT READ BY THIS COMPONENT, and that is the whole point of
   * this field's presence in the type: spread must never reach the screen
   * in any form, including as a fallback. It is declared here only so a
   * reader who finds it on an artifact can see, in one place, that it is
   * knowingly ignored — deleting it from the type would just make the next
   * person wonder where it went.
   */
  spread?: number;
}

/**
 * The metric display primitive: the value to two decimals, or a blank cell
 * when no metric exists at all. It renders no plus-minus in any case.
 *
 * Both numbers arrive from the published artifact ALREADY rounded to two
 * decimals (`packages/harness/rounding.ts`'s `ROUNDING_RULE.metric`).
 * `toFixed(2)` here restores trailing zeros JSON serialization drops
 * (`88.2` -> `"88.20"`) — it is display-precision digit restoration, never a
 * second rounding pass. Do not add a rounding option to this component: the
 * pipeline already rounded once, and re-rounding or rescaling the value
 * here would make the site's number disagree with the harness's.
 *
 * `tier` is an optional presentation-only prop. `undefined` means no
 * percentile was published for this metric, and the cell renders with NO
 * wrapper class at all. `"common"` means a percentile WAS published and
 * landed below the 50th, and the cell renders the `.metric-tier--common`
 * hairline ring (no fill, no foreground change) — it does not render
 * identically to `undefined`. Any tier wraps the same value output in the
 * `.metric-tier`/`.metric-tier--{tier}` box (`theme.css`) via `cn()`,
 * changing only background/foreground/box-shadow/padding — never the type
 * scale, never a re-round of the number. The prop stays presentation-only
 * in every case — it may never change a digit.
 *
 * Wherever Sigma Score is published (SPR only), it renders as the right
 * half of `TotalSigmaValue`'s split pill, joined onto that surface's Total
 * cell — never through this component's own props. `TotalSigmaValue`
 * degrades to plain `MetricValue` (this component, unchanged) whenever no
 * Sigma entry exists, so every no-Sigma surface stays byte-identical to
 * what this component alone would have rendered.
 */
export function MetricValue({
  metric,
  tier,
  className,
}: {
  metric?: DisplayMetric;
  tier?: Tier;
  className?: string;
}) {
  if (metric === undefined) {
    // Blank, not an em-dash — no visible em-dashes anywhere on the site.
    // The span itself stays so the cell keeps its box and the column never
    // disappears.
    return <span className={cn("numeric-cell whitespace-nowrap", className)} />;
  }

  const valueText = metric.value.toFixed(2);
  const boxed = tier !== undefined;

  return (
    <span className={cn("numeric-cell whitespace-nowrap", boxed && "metric-tier", boxed && `metric-tier--${tier}`, className)}>
      <span className="text-role-body">{valueText}</span>
    </span>
  );
}
