/**
 * The Metric History tab's lazy boundary: a
 * `React.lazy(() => import("./MetricHistoryChart.js"))` inside a `Suspense`
 * whose fallback is a chart-shaped, text-free `Skeleton`, wrapped in an
 * error boundary whose fallback offers a Retry that re-attempts the
 * dynamic import — never a data refetch, since the metric-history array
 * already arrived with the page artifact.
 *
 * `loadChart` is an injectable seam (defaults to the real dynamic import):
 * production never passes it, tests substitute a controllable stub so
 * "Retry re-attempts the import" is asserted by a real call count rather
 * than by timing a real network chunk fetch.
 */
import { Component, lazy, Suspense, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import type { TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { MetricHistoryChartProps } from "./MetricHistoryChart.js";
import { drawsSigmaBand, METRIC_HISTORY_LEGEND_HEIGHT_PX } from "./metricHistorySeries.js";

export interface MetricHistoryTabProps {
  artifact: TeamSeasonArtifact;
  algorithmId: string;
  season: number;
  loadChart?: () => Promise<{ default: ComponentType<MetricHistoryChartProps> }>;
}

const defaultLoadChart = () => import("./MetricHistoryChart.js");

function eventNameByKeyFrom(artifact: TeamSeasonArtifact): Readonly<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const event of artifact.events) {
    map[event.eventKey] = event.eventName;
  }
  return map;
}

/**
 * Chart-shaped, text-free loading placeholder: covers both the
 * dynamic-import wait and any brief render delay once the chunk arrives.
 *
 * `drawsBand`: when true, reserves an extra text-free spacer sized to
 * `METRIC_HISTORY_LEGEND_HEIGHT_PX` — the SAME constant
 * `MetricHistoryChart.tsx`'s own legend reads — so the landed chart's
 * legend causes no layout shift below it. Absent (no spacer) for OPR, EPA,
 * or a not-yet-republished SPR artifact, matching the chart's own silence
 * in those cases.
 *
 * The spacer is a SIBLING after the fixed-height box, never a child of it: a
 * child of an `h-[280px]` box overflows rather than adding height, so it
 * would reserve nothing. The fragment mirrors the chart's own shape (its
 * 280px plot container, then its legend) element for element.
 */
function ChartSkeleton({ drawsBand }: { drawsBand: boolean }) {
  return (
    <>
      <div data-testid="metric-history-chart-skeleton" className="h-[280px] w-full p-[var(--spacing-md)]">
        <Skeleton className="h-full w-full" />
      </div>
      {drawsBand && <div data-testid="metric-history-legend-skeleton-spacer" style={{ height: METRIC_HISTORY_LEGEND_HEIGHT_PX }} />}
    </>
  );
}

interface ChartErrorBoundaryProps {
  children: ReactNode;
  onRetry: () => void;
}

interface ChartErrorBoundaryState {
  hasError: boolean;
}

/**
 * A minimal, file-scoped error boundary — React still requires a class
 * component for `getDerivedStateFromError` (no hook equivalent exists), and
 * this repo has no `react-error-boundary` dependency to reach for instead.
 * Catches ONLY the lazy chunk's import failure.
 */
class ChartErrorBoundary extends Component<ChartErrorBoundaryProps, ChartErrorBoundaryState> {
  state: ChartErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ChartErrorBoundaryState {
    return { hasError: true };
  }

  handleRetry = (): void => {
    this.setState({ hasError: false });
    this.props.onRetry();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center gap-[var(--spacing-sm)] px-[var(--spacing-lg)] py-[var(--spacing-2xl)] text-center">
          <p className="text-role-body text-destructive">Chart failed to load</p>
          <p className="text-role-body text-muted-foreground">Check your connection and try again.</p>
          <Button type="button" variant="outline" onClick={this.handleRetry} className="border-destructive text-destructive">
            Retry
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * `importKey` forces a brand-new `lazy()` wrapper (and therefore a brand-new
 * dynamic `import()` attempt) on every retry — a bare `key` change on the
 * SAME `lazy()` reference would not help, since React permanently caches a
 * rejected lazy-component promise inside that one `lazy()` instance forever.
 * `useMemo` keyed on `importKey` recreates the wrapper only on retry, never
 * on an unrelated re-render.
 */
export function MetricHistoryTab({ artifact, algorithmId, season, loadChart = defaultLoadChart }: MetricHistoryTabProps) {
  // The published array directly: since quick task 260923-3w7 the live tick
  // writes this artifact again, so a live event's matches are at the right-hand
  // end of the chart without the extension `useLiveTeamSeason` used to supply.
  const rows = artifact.metricHistory;
  const [importKey, setImportKey] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- importKey intentionally forces recreation on retry
  const ChartComponent = useMemo(() => lazy(loadChart), [importKey, loadChart]);
  // Imported from `metricHistorySeries.ts` only — this Tab must never
  // import `MetricHistoryChart.tsx` statically, since that would pull
  // Recharts into the eager bundle.
  const drawsBand = drawsSigmaBand(rows, algorithmId);

  return (
    <ChartErrorBoundary key={importKey} onRetry={() => setImportKey((key) => key + 1)}>
      <Suspense fallback={<ChartSkeleton drawsBand={drawsBand} />}>
        <ChartComponent rows={rows} algorithmId={algorithmId} season={season} eventNameByKey={eventNameByKeyFrom(artifact)} />
      </Suspense>
    </ChartErrorBoundary>
  );
}
