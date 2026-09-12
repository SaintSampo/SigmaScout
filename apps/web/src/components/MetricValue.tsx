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
 * `tier` (D-17, 06-07-PLAN.md Task 1; widened quick task 260904-7rt, sketch
 * 008 winner C) is an optional presentation-only prop. The surviving
 * contract, post-260904-7rt: `undefined` means no percentile was published
 * for this metric, and the cell renders with NO wrapper class at all — that
 * promise (render exactly as before this prop existed) now belongs to
 * `undefined` alone. `"common"` means a percentile WAS published and landed
 * below the 50th, and the cell renders the `.metric-tier--common` hairline
 * ring (no fill, no foreground change) — it no longer renders identically to
 * `undefined`. Any tier wraps the same value/spread output in the
 * `.metric-tier`/`.metric-tier--{tier}` box (`theme.css`) via `cn()`,
 * changing only background/foreground/box-shadow/padding — never the type
 * scale, never a re-round of either number. The prop stays
 * presentation-only in every case — it may never change a digit.
 *
 * The ± glyph and spread number render through `.metric-spread-superscript`
 * (07-UAT.md G-10, the developer's own design direction) — smaller, grey,
 * and raised beside the value like an exponent, top-aligned with it. The
 * VALUE itself is untouched: same `.text-role-body` size/weight, same
 * `toFixed(2)` digits, same DOM text content and order as before — this is
 * a presentation-only change over the identical " ± {spread}" string
 * `.text-role-spread-suffix` used to render, so the accessible name/text
 * content read by assistive tech is byte-identical to before this change.
 * Swing Score is a permanent part of the site (2026-09-09): the ribbon's
 * `±` toggle and the `displaySettings` store behind it are gone, so a
 * `swingScore` reaching this component ALWAYS renders — there is no longer
 * any state in which the spread span is suppressed. See
 * `theme.css`'s own doc comment on `.metric-spread-superscript` for why
 * this is a NEW class rather than a redefinition of `.text-role-spread-suffix`
 * (that class is also consumed by two match-table surfaces outside this
 * fix's scope).
 */
export function MetricValue({
  metric,
  tier,
  className,
  swingScore,
}: {
  metric?: DisplayMetric;
  tier?: Tier;
  className?: string;
  /**
   * The SWING SCORE for this cell — SigmaScout's own heuristic for how much
   * this robot's contribution varies match to match. The ONLY quantity this
   * component will render as a `±`.
   *
   * Passed EXPLICITLY by each caller rather than read off `metric`, so that
   * showing a `±` is always a deliberate act. Before 2026-09-09 this component
   * rendered `metric.spread`, which meant every one of its ten call sites
   * displayed the algorithm's internal confidence without ever asking to —
   * a leak that was systemic precisely because it lived here rather than at
   * any one call site.
   */
  swingScore?: number;
}) {
  if (metric === undefined) {
    // Blank, not an em-dash (2026-09-01 user request: no visible em-dashes
    // anywhere on the site). The span itself stays so the cell keeps its
    // box and the column never disappears (D-17/E2).
    return <span className={cn("numeric-cell whitespace-nowrap", className)} />;
  }

  const valueText = metric.value.toFixed(2);
  const hasSwingScore = swingScore !== undefined;
  const boxed = tier !== undefined;

  return (
    <span className={cn("numeric-cell whitespace-nowrap", boxed && "metric-tier", boxed && `metric-tier--${tier}`, className)}>
      <span className="text-role-body">{valueText}</span>
      {hasSwingScore && (
        <span className="metric-spread-superscript text-muted-foreground">{` ± ${swingScore.toFixed(2)}`}</span>
      )}
    </span>
  );
}
