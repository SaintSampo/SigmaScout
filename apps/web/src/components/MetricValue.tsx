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
  spread?: number;
}

/**
 * The D-07 value-and-spread display primitive: `{value} ± {spread}`, or the
 * bare value when no spread is published, or a single em-dash when no
 * metric exists at all (05-03-PLAN.md Task 3).
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
 * `tier` (D-17, 06-07-PLAN.md Task 1) is an optional presentation-only prop:
 * `undefined` or `"common"` render EXACTLY as before this prop existed — no
 * `.metric-tier` wrapper, no digit change. Any other tier wraps the same
 * value/spread output in the `.metric-tier`/`.metric-tier--{tier}` box
 * (`theme.css`) via `cn()`, changing only background/foreground/padding —
 * never the type scale, never a re-round of either number.
 *
 * The ± glyph and spread number render through `.metric-spread-superscript`
 * (07-UAT.md G-10, the developer's own design direction) — smaller, grey,
 * and raised beside the value like an exponent, top-aligned with it. The
 * VALUE itself is untouched: same `.text-role-body` size/weight, same
 * `toFixed(2)` digits, same DOM text content and order as before — this is
 * a presentation-only change over the identical " ± {spread}" string
 * `.text-role-spread-suffix` used to render, so the accessible name/text
 * content read by assistive tech is byte-identical to before this change.
 * See `theme.css`'s own doc comment on `.metric-spread-superscript` for why
 * this is a NEW class rather than a redefinition of `.text-role-spread-suffix`
 * (that class is also consumed by two match-table surfaces outside this
 * fix's scope).
 */
export function MetricValue({ metric, tier, className }: { metric?: DisplayMetric; tier?: Tier; className?: string }) {
  if (metric === undefined) {
    return <span className={cn("numeric-cell whitespace-nowrap", className)}>{"—"}</span>;
  }

  const valueText = metric.value.toFixed(2);
  const hasSpread = metric.spread !== undefined;
  const boxed = tier !== undefined && tier !== "common";

  return (
    <span className={cn("numeric-cell whitespace-nowrap", boxed && "metric-tier", boxed && `metric-tier--${tier}`, className)}>
      <span className="text-role-body">{valueText}</span>
      {hasSpread && (
        <span className="metric-spread-superscript text-muted-foreground">{` ± ${metric.spread?.toFixed(2)}`}</span>
      )}
    </span>
  );
}
