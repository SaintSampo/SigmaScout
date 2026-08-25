/**
 * The Metric History tab's lazy boundary (06-05-PLAN.md Task 2): a
 * `React.lazy(() => import("./MetricHistoryChart.js"))` inside a `Suspense`
 * whose fallback is a chart-shaped, text-free `Skeleton`, wrapped in an
 * error boundary whose fallback offers a Retry that re-attempts the
 * dynamic import — never a data refetch, since the metric-history array
 * already arrived with the page artifact (D-07: one artifact, whole page).
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
 * Chart-shaped, text-free loading placeholder (06-UI-SPEC.md Copywriting
 * Contract, "Chart tab — loading"): covers both the dynamic-import wait and
 * any brief render delay once the chunk arrives.
 */
function ChartSkeleton() {
  return (
    <div data-testid="metric-history-chart-skeleton" className="h-[280px] w-full p-[var(--spacing-md)]">
      <Skeleton className="h-full w-full" />
    </div>
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
 * Catches ONLY the lazy chunk's import failure (D-14/E9 error copy).
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
  const [importKey, setImportKey] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- importKey intentionally forces recreation on retry
  const ChartComponent = useMemo(() => lazy(loadChart), [importKey, loadChart]);

  return (
    <ChartErrorBoundary key={importKey} onRetry={() => setImportKey((key) => key + 1)}>
      <Suspense fallback={<ChartSkeleton />}>
        <ChartComponent rows={artifact.metricHistory} algorithmId={algorithmId} season={season} eventNameByKey={eventNameByKeyFrom(artifact)} />
      </Suspense>
    </ChartErrorBoundary>
  );
}
