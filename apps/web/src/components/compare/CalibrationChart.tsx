/**
 * The Compare page's demoted reliability diagram (08-10-PLAN.md Task 3) —
 * supporting evidence beneath `CalibrationSection.tsx`'s primary-content
 * sentence (sketch 006 winner C). Computes nothing of its own: every figure
 * plotted here comes from `calibrationSeries.ts` (Task 2). Default-exported
 * so `CalibrationSection.tsx` can reach it through a dynamic `import()`,
 * matching `MetricHistoryChart.tsx`/`MetricHistoryTab.tsx`'s established
 * split (D-14).
 *
 * Sizing: NOT `ResponsiveContainer` — same reason as `MetricHistoryChart.tsx`:
 * this repo's stubbed `ResizeObserver` (`src/test/setup.ts`) never calls
 * back under jsdom, so Recharts' auto-sizing never resolves and the
 * component test would render a zero-width chart. A `useLayoutEffect` reads
 * the container's real width where one exists (a real browser) and falls
 * back to `DEFAULT_CALIBRATION_CHART_WIDTH` where one does not (jsdom always
 * measures 0). Do not "simplify" this back to `ResponsiveContainer` — it is
 * the single most likely thing a later contributor tries.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis, type DotItemDotProps } from "recharts";
import { PUBLISHED_ALGORITHM_IDS, type PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import { algorithmDisplayLabel } from "../ribbon/AlgorithmSelect.js";
import {
  buildCalibrationRows,
  calibrationPointRadius,
  countStats,
  type AlgorithmPoints,
  type CalibrationChartRow,
  type CalibrationPoint,
  type CountStats,
} from "./calibrationSeries.js";

export interface CalibrationChartProps {
  /** Every algorithm's already-valid points for the selected year/compLevel (Task 2's `validCalibrationPoints`, never a raw bin). */
  readonly pointsByAlgorithm: AlgorithmPoints;
  /** The legend's currently-active algorithm — carried through as a data attribute for testability; the chart itself draws all three series regardless (D-09 "surfaces everything"). */
  readonly activeAlgorithmId: PublishedAlgorithmId;
  /** Fired from a point's hover, focus AND click alike — `CalibrationSection.tsx` uses this to swap its headline sentence. */
  readonly onPointSelect: (algorithmId: PublishedAlgorithmId, point: CalibrationPoint) => void;
  /**
   * Fired when a point's hover/focus ENDS (mouse leave or blur) — Rule 2
   * addition, folded into this task rather than left implicit: Task 4's own
   * "moving away restores the headline point" contract has no other place to
   * attach, since this component owns every dot's event wiring. Optional so
   * a caller uninterested in restoring a prior sentence (or an earlier test)
   * needs no change.
   */
  readonly onPointDeselect?: () => void;
}

export const DEFAULT_CALIBRATION_CHART_WIDTH = 560;
/** Meaningfully shorter than `MetricHistoryChart.tsx`'s 280px — the chart is supporting evidence, never the section's headline (Visual Hierarchy, UI-SPEC). */
export const CALIBRATION_CHART_HEIGHT = 220;
export const CALIBRATION_CHART_TESTID = "calibration-chart";
export const CALIBRATION_SIZE_KEY_TESTID = "calibration-chart-size-key";

/** `var(--compare-algo-*)` only — never a hex literal (Task 1's `comparePalette.test.ts` guard enforces this across the whole compare surface). */
const ALGORITHM_STROKE: Readonly<Record<PublishedAlgorithmId, string>> = {
  opr: "var(--compare-algo-opr)",
  epa: "var(--compare-algo-epa)",
  vpr: "var(--compare-algo-vpr)",
};

function formatPercentTick(value: number): string {
  return `${Math.round(value)}%`;
}

/**
 * A custom dot renderer, one per algorithm's `<Line>`. Recharts calls this
 * once per row REGARDLESS of which series that row belongs to (`payload` is
 * always the full merged `CalibrationChartRow`) — returning `null` for a row
 * whose OWN algorithm cell is null is what keeps a series from drawing a
 * mark on another series' point. Never filters a point out for being
 * sparse: every non-null cell renders, radius shrunk rather than hidden.
 */
function makeCalibrationDot(
  algorithmId: PublishedAlgorithmId,
  algorithmLabel: string,
  onPointSelect: CalibrationChartProps["onPointSelect"],
  onPointDeselect: CalibrationChartProps["onPointDeselect"],
) {
  return function CalibrationDot(props: DotItemDotProps): ReactNode {
    const { cx, cy, payload } = props;
    const row = payload as CalibrationChartRow;
    const cell = row[algorithmId];
    if (cell === null || cx === undefined || cy === undefined) return null;
    // 08-REVIEW WR-02: the point rides on its own cell — never recovered
    // through a float-keyed (`meanPredicted * 100`) lookup that two
    // different bins could theoretically collide on.
    const point = cell.point;

    const handleSelect = (): void => onPointSelect(algorithmId, point);
    const handleDeselect = (): void => onPointDeselect?.();
    const title = `${algorithmLabel}: predicted ${(point.meanPredicted * 100).toFixed(1)}%, observed ${(point.observedFrequency * 100).toFixed(1)}%, ${point.count.toLocaleString("en-US")} matches`;

    return (
      <g
        tabIndex={0}
        onMouseEnter={handleSelect}
        onFocus={handleSelect}
        onClick={handleSelect}
        onMouseLeave={handleDeselect}
        onBlur={handleDeselect}
        style={{ cursor: "pointer", outline: "none" }}
      >
        <title>{title}</title>
        <circle cx={cx} cy={cy} r={cell.radius} fill={ALGORITHM_STROKE[algorithmId]} fillOpacity={0.82} stroke="var(--color-bg-page)" strokeWidth={1} />
      </g>
    );
  };
}

/**
 * The size key beneath the plot: `count` -> mark size is otherwise invisible
 * information, so this row makes it legible. Every swatch reads the SAME
 * `calibrationPointRadius`/`maxCount` the marks above it read — the coupled-
 * geometry obligation made visible, so the key can never drift from the
 * marks (`chart-craft.md`). Text wears `--color-text-muted`, never a series
 * colour.
 */
function CalibrationSizeKey({ stats }: { readonly stats: CountStats | undefined }) {
  if (stats === undefined) return null;
  const entries: readonly (readonly [string, number])[] = [
    ["Fewest", stats.min],
    ["Typical", stats.median],
    ["Most", stats.max],
  ];
  return (
    <div data-testid={CALIBRATION_SIZE_KEY_TESTID} className="mt-[var(--spacing-xs)] flex flex-wrap items-center gap-[var(--spacing-md)] text-role-label text-[var(--color-text-muted)]">
      <span>Point size = matches in that bin:</span>
      {entries.map(([label, count]) => {
        const radius = calibrationPointRadius(count, stats.max);
        const diameter = Math.ceil(radius) * 2 + 4;
        return (
          <span key={label} className="inline-flex items-center gap-[var(--spacing-xs)]">
            <svg width={diameter} height={diameter} viewBox={`0 0 ${diameter} ${diameter}`} aria-hidden="true">
              <circle cx={diameter / 2} cy={diameter / 2} r={radius} fill="var(--color-text-muted)" fillOpacity={0.55} />
            </svg>
            <span className="numeric-cell">{count.toLocaleString("en-US")}</span>
          </span>
        );
      })}
    </div>
  );
}

export default function CalibrationChart({ pointsByAlgorithm, activeAlgorithmId, onPointSelect, onPointDeselect }: CalibrationChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(DEFAULT_CALIBRATION_CHART_WIDTH);

  useLayoutEffect(() => {
    const measure = (): void => {
      const el = containerRef.current;
      if (!el) return;
      const measured = el.getBoundingClientRect().width;
      setWidth(measured > 0 ? measured : DEFAULT_CALIBRATION_CHART_WIDTH);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const rows = buildCalibrationRows(pointsByAlgorithm);
  const stats = countStats(pointsByAlgorithm);

  return (
    <div ref={containerRef} className="w-full" data-testid={CALIBRATION_CHART_TESTID} data-active-algorithm-id={activeAlgorithmId}>
      <LineChart width={width} height={CALIBRATION_CHART_HEIGHT} data={rows} margin={{ top: 8, right: 12, bottom: 22, left: 8 }}>
        <CartesianGrid stroke="var(--color-border)" strokeOpacity={0.3} />
        <XAxis
          dataKey="x"
          type="number"
          domain={[0, 100]}
          tickFormatter={formatPercentTick}
          tick={{ fill: "var(--color-text-muted)", fontSize: 11 }}
          label={{ value: "Predicted win chance", position: "insideBottom", offset: -6, fill: "var(--color-text-muted)", fontSize: 11 }}
        />
        <YAxis
          type="number"
          domain={[0, 100]}
          width={36}
          tickFormatter={formatPercentTick}
          tick={{ fill: "var(--color-text-muted)", fontSize: 11 }}
          label={{ value: "Actually happened", angle: -90, position: "insideLeft", fill: "var(--color-text-muted)", fontSize: 11 }}
        />
        {/* Dashed perfect-calibration diagonal, drawn first so it sits behind every data mark. */}
        <ReferenceLine
          segment={[
            { x: 0, y: 0 },
            { x: 100, y: 100 },
          ]}
          stroke="var(--color-border)"
          strokeDasharray="4 4"
          ifOverflow="visible"
        />
        {PUBLISHED_ALGORITHM_IDS.map((algorithmId) => (
          <Line
            key={algorithmId}
            dataKey={(row: CalibrationChartRow) => row[algorithmId]?.y ?? null}
            stroke={ALGORITHM_STROKE[algorithmId]}
            strokeWidth={1.5}
            connectNulls
            isAnimationActive={false}
            activeDot={false}
            dot={makeCalibrationDot(algorithmId, algorithmDisplayLabel(algorithmId), onPointSelect, onPointDeselect)}
          />
        ))}
      </LineChart>
      <CalibrationSizeKey stats={stats} />
    </div>
  );
}
