import { cn } from "@/lib/utils";
import type { Tier } from "@/lib/tiers";

/**
 * The published `TeamMetric` shape (`packages/harness/pageArtifacts.ts`'s
 * `TeamMetricSchema`): a required numeric value with an optional numeric
 * spread. `spread`'s optionality is a schema fact — OPR and EPA rows carry
 * no spread field at all, which is the normal case, not an error (D-07).
 */
export interface DisplayMetric {
  value: number;
  /**
   * The ALGORITHM's own confidence in `value`. Present on the wire for the
   * algorithms that model it (SPR publishes one on `total` and all three
   * phase metrics).
   *
   * DELIBERATELY NOT READ BY THIS COMPONENT, and that is the whole point of
   * this field's presence in the type: spread must never reach the screen in
   * any form, including as a fallback (developer rule, 2026-09-09). It is
   * declared here only so a reader who finds it on an artifact can see, in one
   * place, that it is knowingly ignored — deleting it from the type would just
   * make the next person wonder where it went.
   */
  spread?: number;
}

/**
 * The D-07 metric display primitive: the value to two decimals, or a blank
 * cell when no metric exists at all (05-03-PLAN.md Task 3). It renders no
 * plus-minus in any case (quick task 260913-g66 removed the last one).
 *
 * Both numbers arrive from the published artifact ALREADY rounded to two
 * decimals (`packages/harness/rounding.ts`'s `ROUNDING_RULE.metric`).
 * `toFixed(2)` here restores trailing zeros JSON serialization drops
 * (`88.2` -> `"88.20"`) — it is display-precision digit restoration, never a
 * second rounding pass. Do not add a rounding option to this component: the
 * pipeline already rounded once, and re-rounding or rescaling the value
 * here would make the site's number disagree with the harness's, which is
 * the exact class of drift this project's failure log names.
 *
 * `tier` (D-17, 06-07-PLAN.md Task 1; widened quick task 260904-7rt, sketch
 * 008 winner C) is an optional presentation-only prop. The surviving
 * contract, post-260904-7rt: `undefined` means no percentile was published
 * for this metric, and the cell renders with NO wrapper class at all — that
 * promise (render exactly as before this prop existed) now belongs to
 * `undefined` alone. `"common"` means a percentile WAS published and landed
 * below the 50th, and the cell renders the `.metric-tier--common` hairline
 * ring (no fill, no foreground change) — it no longer renders identically to
 * `undefined`. Any tier wraps the same value output in the
 * `.metric-tier`/`.metric-tier--{tier}` box (`theme.css`) via `cn()`,
 * changing only background/foreground/box-shadow/padding — never the type
 * scale, never a re-round of the number. The prop stays
 * presentation-only in every case — it may never change a digit.
 *
 * Quick task 260913-g66 removed the optional per-cell plus-minus prop this
 * component used to carry, along with its superscript render branch: that
 * prop printed a per-team consistency figure beside a value, no production
 * caller passed it any more, and the site no longer names that figure
 * anywhere. A metric cell is now the value alone.
 *
 * Quick task 260913-jkp: wherever Sigma Score is published (SPR only), it
 * renders as the right half of `TotalSigmaValue`'s split pill, joined onto
 * that surface's Total cell — never through this component's own props.
 * `TotalSigmaValue` degrades to plain `MetricValue` (this component,
 * unchanged) whenever no Sigma entry exists, so every no-Sigma surface stays
 * byte-identical to what this component alone would have rendered.
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
    // Blank, not an em-dash (2026-09-01 user request: no visible em-dashes
    // anywhere on the site). The span itself stays so the cell keeps its
    // box and the column never disappears (D-17/E2).
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
