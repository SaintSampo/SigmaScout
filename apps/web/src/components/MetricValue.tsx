import { cn } from "@/lib/utils";

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
 */
export function MetricValue({ metric, className }: { metric?: DisplayMetric; className?: string }) {
  if (metric === undefined) {
    return <span className={cn("numeric-cell whitespace-nowrap", className)}>{"—"}</span>;
  }

  const valueText = metric.value.toFixed(2);
  const hasSpread = metric.spread !== undefined;

  return (
    <span className={cn("numeric-cell whitespace-nowrap", className)}>
      <span className="text-role-body">{valueText}</span>
      {hasSpread && (
        <span className="text-role-spread-suffix text-muted-foreground">{` ± ${metric.spread?.toFixed(2)}`}</span>
      )}
    </span>
  );
}
