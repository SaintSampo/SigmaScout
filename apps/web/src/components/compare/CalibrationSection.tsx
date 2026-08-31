/**
 * The Compare page's Calibration section (08-10-PLAN.md Task 4), mounted
 * beneath the methodology note — sentence-first (sketch 006 winner C): the
 * plain-language sentence is the section's primary content, the OPR/EPA/VPR
 * legend doubles as the sentence's algorithm switcher, a local year `Select`
 * re-reads the five already-fetched artifacts (no request of its own), and
 * the demoted chart mounts through a lazy boundary that degrades to
 * sentence-plus-retry if its chunk fails to load.
 *
 * Consumes 08-06's single `compLevelView` state as a PROP and declares no
 * compLevel state of its own — one state, two consumers (D-09's obligation,
 * mirrored from `AccuracyTable.tsx`).
 */
import { Component, lazy, Suspense, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { algorithmDisplayLabel } from "../ribbon/AlgorithmSelect.js";
import { COMPARE_SEASONS, type CompareCompLevelView } from "../../lib/api/compare.js";
import { PUBLISHED_ALGORITHM_IDS, type PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import {
  formatCalibrationSentence,
  NO_USABLE_BINS_SENTENCE,
  selectHeadlinePoint,
  validCalibrationPoints,
  type AlgorithmPoints,
  type CalibrationPoint,
} from "./calibrationSeries.js";
import type { CalibrationChartProps } from "./CalibrationChart.js";
import type { CompareArtifact } from "../../../../../packages/harness/pageArtifacts.js";

export const CALIBRATION_SECTION_TESTID = "compare-calibration-section";
export const CALIBRATION_SENTENCE_TESTID = "compare-calibration-sentence";
export const CALIBRATION_LEGEND_TESTID = "compare-calibration-legend";
export const CALIBRATION_YEAR_SELECT_TESTID = "compare-calibration-year-select";
export const CALIBRATION_CHART_SKELETON_TESTID = "compare-calibration-chart-skeleton";

/** Defaults to the most recent year, per the Copywriting Contract's year-selector row. */
export const DEFAULT_CALIBRATION_YEAR = 2026;
/** Defaults to VPR — "the algorithm most readers arrive already curious about" (08-UI-SPEC.md). */
export const DEFAULT_CALIBRATION_ALGORITHM: PublishedAlgorithmId = "vpr";

/**
 * The Copywriting Contract's concept explainer, with Decision 2's ONE
 * correction: the UI-SPEC's own row has the diagonal orientation inverted.
 * Its own worked case — OPR predicted 85.3%, observed 52.8% — plots BELOW
 * the diagonal (observed < predicted) and that same document calls it "a
 * 32.5pp overconfidence gap," so BELOW must be the more-confident clause and
 * ABOVE must be the too-cautious one. Every other word is the approved copy,
 * unchanged.
 */
export const CALIBRATION_EXPLAINER =
  "This chart shows how well each algorithm's confidence matches reality. Predictions are grouped by how confident the model was (for example, '70% sure Red wins'), then checked against how often Red actually won in that group. A perfectly calibrated line would run along the dashed diagonal — say 70%, be right 70% of the time. A line below the diagonal means the algorithm was more confident than it should have been; a line above means it was too cautious.";

export interface CalibrationSectionProps {
  readonly artifactsByYear: ReadonlyMap<number, CompareArtifact>;
  /** 08-06's single compLevelView state, read here as a prop — declared nowhere in this file as its own state. */
  readonly compLevelView: CompareCompLevelView;
  /** Injectable seam for tests (mirrors `MetricHistoryTab.tsx`) — production never passes it. */
  readonly loadChart?: () => Promise<{ default: ComponentType<CalibrationChartProps> }>;
}

const defaultLoadChart = () => import("./CalibrationChart.js");

/** Every algorithm's valid points for one (year, compLevel) selection — the shape `CalibrationChart.tsx` and `selectHeadlinePoint` both consume. Season is matched alongside algorithmId/compLevelView, mirroring `AccuracyTable.tsx`'s own `buildAccuracyRows` selection discipline. */
function pointsByAlgorithmFor(artifact: CompareArtifact | undefined, year: number, compLevelView: CompareCompLevelView): AlgorithmPoints {
  const entries = PUBLISHED_ALGORITHM_IDS.map((id): [PublishedAlgorithmId, readonly CalibrationPoint[]] => {
    const slice = artifact?.slices.find(
      (candidate) => candidate.algorithmId === id && candidate.season === year && candidate.compLevelView === compLevelView,
    );
    return [id, slice === undefined ? [] : validCalibrationPoints(slice)];
  });
  return Object.fromEntries(entries) as AlgorithmPoints;
}

interface SelectedChartPoint {
  readonly algorithmId: PublishedAlgorithmId;
  readonly point: CalibrationPoint;
}

/** Chart-shaped, text-free loading placeholder — same convention as `MetricHistoryTab.tsx`'s `ChartSkeleton`. */
function ChartSkeleton() {
  return (
    <div data-testid={CALIBRATION_CHART_SKELETON_TESTID} className="h-[220px] w-full p-[var(--spacing-md)]">
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
 * A minimal, file-scoped error boundary catching ONLY the lazy chunk's
 * import failure — copied in shape from `MetricHistoryTab.tsx`'s own
 * `ChartErrorBoundary` (D-14 precedent). The heading, the year `Select`, the
 * sentence, the explainer and the legend all live OUTSIDE this boundary, so
 * a chunk failure degrades to sentence-plus-retry, never a blank section.
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
        <div className="flex flex-col items-center gap-[var(--spacing-sm)] px-[var(--spacing-lg)] py-[var(--spacing-lg)] text-center">
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
 * dynamic `import()` attempt) on every retry — same reasoning as
 * `MetricHistoryTab.tsx`'s identical pattern: a bare `key` change on the same
 * `lazy()` reference would not help, since React permanently caches a
 * rejected lazy-component promise inside that one `lazy()` instance forever.
 */
export function CalibrationSection({ artifactsByYear, compLevelView, loadChart = defaultLoadChart }: CalibrationSectionProps) {
  const [year, setYear] = useState<number>(DEFAULT_CALIBRATION_YEAR);
  const [algorithmId, setAlgorithmId] = useState<PublishedAlgorithmId>(DEFAULT_CALIBRATION_ALGORITHM);
  const [chartPoint, setChartPoint] = useState<SelectedChartPoint | undefined>(undefined);
  const [importKey, setImportKey] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- importKey intentionally forces recreation on retry
  const ChartComponent = useMemo(() => lazy(loadChart), [importKey, loadChart]);

  const artifact = artifactsByYear.get(year);
  const pointsByAlgorithm = pointsByAlgorithmFor(artifact, year, compLevelView);
  const headlinePoint = selectHeadlinePoint(pointsByAlgorithm[algorithmId]);
  const hasUsablePoint = headlinePoint !== undefined;

  // A hovered/focused/clicked point from a PRIOR year/algorithm/compLevel
  // selection is invalidated the moment that selection changes — a cheap
  // pure-lookup check, never a re-fetch — so a stale chart point can never
  // print a sentence that no longer matches what the chart shows.
  const isChartPointFresh =
    chartPoint !== undefined &&
    pointsByAlgorithm[chartPoint.algorithmId].some(
      (p) => p.binStart === chartPoint.point.binStart && p.meanPredicted === chartPoint.point.meanPredicted,
    );

  const activePoint: SelectedChartPoint | undefined = !hasUsablePoint
    ? undefined
    : isChartPointFresh
      ? chartPoint
      : { algorithmId, point: headlinePoint! };

  const sentence =
    activePoint === undefined ? NO_USABLE_BINS_SENTENCE : formatCalibrationSentence(algorithmDisplayLabel(activePoint.algorithmId), activePoint.point);

  return (
    <div data-testid={CALIBRATION_SECTION_TESTID} className="mt-[var(--spacing-xl)]">
      <div className="mb-[var(--spacing-md)] flex flex-wrap items-center justify-between gap-[var(--spacing-md)]">
        <h2 className="text-role-heading">Calibration</h2>
        <div className="flex items-center gap-[var(--spacing-sm)]">
          <span className="text-role-label text-[var(--color-text-muted)]">Year</span>
          <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}>
            <SelectTrigger data-testid={CALIBRATION_YEAR_SELECT_TESTID} aria-label="Year" className="tap-target w-[5.5rem]">
              <SelectValue>{year}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {COMPARE_SEASONS.map((season) => (
                <SelectItem key={season} value={String(season)}>
                  {season}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p data-testid={CALIBRATION_SENTENCE_TESTID} className="text-role-body numeric-cell text-[var(--color-text-primary)]">
        {sentence}
      </p>

      <p className="mt-[var(--spacing-xs)] text-role-body text-[var(--color-text-muted)]">{CALIBRATION_EXPLAINER}</p>

      {/*
        The legend IS the sentence's algorithm switcher — no second control
        (08-UI-SPEC.md Compare Page Contract). Each entry is a 44x44px tap
        target (`.tap-target`); the active entry is marked by `aria-pressed`
        PLUS the Button's own visible variant swap, never colour alone.
      */}
      <div data-testid={CALIBRATION_LEGEND_TESTID} role="group" aria-label="Algorithm" className="mt-[var(--spacing-md)] flex flex-wrap gap-[var(--spacing-xs)]">
        {PUBLISHED_ALGORITHM_IDS.map((id) => {
          const isActive = id === algorithmId;
          return (
            <Button
              key={id}
              type="button"
              variant={isActive ? "default" : "ghost"}
              aria-pressed={isActive}
              className="tap-target"
              onClick={() => setAlgorithmId(id)}
            >
              {algorithmDisplayLabel(id)}
            </Button>
          );
        })}
      </div>

      {hasUsablePoint && (
        <div className="mt-[var(--spacing-sm)]">
          <ChartErrorBoundary key={importKey} onRetry={() => setImportKey((key) => key + 1)}>
            <Suspense fallback={<ChartSkeleton />}>
              <ChartComponent
                pointsByAlgorithm={pointsByAlgorithm}
                activeAlgorithmId={algorithmId}
                onPointSelect={(selectedAlgorithmId, point) => setChartPoint({ algorithmId: selectedAlgorithmId, point })}
                onPointDeselect={() => setChartPoint(undefined)}
              />
            </Suspense>
          </ChartErrorBoundary>
        </div>
      )}
    </div>
  );
}
