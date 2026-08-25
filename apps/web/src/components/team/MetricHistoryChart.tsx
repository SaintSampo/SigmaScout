/**
 * The Metric History tab's Recharts chart (06-05-PLAN.md Task 1). Default
 * export — `MetricHistoryTab.tsx` (Task 2) dynamically `import()`s this
 * module so Recharts is never in the eager bundle (D-14).
 *
 * Plots ONLY `TOTAL_KEY` (D-11) — component metric trajectories are
 * deferred, not this chart's job. The variance band (an `Area`, drawn from
 * `value - spread` to `value + spread`) renders only when at least one point
 * in the series carries a `spread` — OPR (Total only, no spread) and EPA (no
 * spread on any metric) simply never show a band, and D-13 locks that as
 * silent: no explanatory text anywhere in this file.
 *
 * Sizing: NOT `ResponsiveContainer` — Recharts' own `ResizeObserver`-driven
 * auto-sizing never resolves under jsdom (this repo's stubbed
 * `ResizeObserver` never calls back, per `src/test/setup.ts`'s own comment),
 * exactly the problem `TeamsTable.tsx`'s `scrollHeight` state already solved
 * once. Mirrors that same measure-with-a-sane-fallback pattern: a
 * `useLayoutEffect` reads the container's real width where one exists (a
 * real browser) and falls back to `DEFAULT_CHART_WIDTH` where one does not
 * (jsdom always measures 0), so both environments render a real, non-zero
 * chart.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, XAxis, YAxis } from "recharts";
import { TOTAL_KEY } from "@/lib/metricKeys";
import type { MetricHistoryRow } from "../../../../../packages/harness/metricHistorySchema.js";
import { buildMetricSeries, detectEventBands } from "./metricHistorySeries.js";

export interface MetricHistoryChartProps {
  rows: readonly MetricHistoryRow[];
  algorithmId: string;
  season: number;
  /** Display name per event key — from `artifact.events`, since `metricHistory[]` rows carry only `eventKey` (grouping data), not a human-readable name. */
  eventNameByKey: Readonly<Record<string, string>>;
}

interface ChartDatum {
  x: number;
  value: number | null;
  band: [number, number] | null;
  matchKey: string;
  eventKey: string;
}

const DEFAULT_CHART_WIDTH = 640;
const CHART_HEIGHT = 280;
const MAX_EVENT_LABEL_CHARS = 18;

function truncateEventLabel(name: string): string {
  return name.length > MAX_EVENT_LABEL_CHARS ? `${name.slice(0, MAX_EVENT_LABEL_CHARS - 1)}…` : name;
}

/**
 * A custom Recharts label renderer (rather than a plain string `label`
 * prop) so the truncated on-chart text can carry a real accessible
 * full-text affordance: a native SVG `<title>` element, which browsers
 * surface as a hover tooltip and assistive tech reads as the element's
 * accessible name — the same job `title` does on the plain-HTML event
 * section headers, on the different rendering path Recharts requires.
 */
function eventBandLabel(fullName: string) {
  return function EventBandLabel(props: { viewBox?: { x: number; y: number; width: number; height: number } }) {
    const { viewBox } = props;
    if (viewBox === undefined) return null;
    const { x, y, width } = viewBox;
    return (
      <g>
        <title>{fullName}</title>
        <text x={x + width / 2} y={y + 14} textAnchor="middle" fontSize={12} fill="var(--color-text-muted)">
          {truncateEventLabel(fullName)}
        </text>
      </g>
    );
  };
}

/**
 * `MetricHistoryChart` — the Recharts `ComposedChart`: `ReferenceArea`
 * bands for alternating event blocks, an `Area` for the variance band, and
 * a `Line` for the value, in that order so later marks paint over earlier
 * ones. Zero points renders a plain labelled axis and no line (E9 empty);
 * exactly one point renders a single dot with no line segment (E9
 * zero-one-many) — Recharts' own default `Line` behavior for a one-point
 * series already produces exactly that (a single-command path, no `L`
 * segment), so no special-casing is needed beyond gating the `Line`/`Area`
 * on `points.length > 0`.
 */
export default function MetricHistoryChart({ rows, eventNameByKey }: MetricHistoryChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(DEFAULT_CHART_WIDTH);

  useLayoutEffect(() => {
    const measure = (): void => {
      const el = containerRef.current;
      if (!el) return;
      const measured = el.getBoundingClientRect().width;
      setWidth(measured > 0 ? measured : DEFAULT_CHART_WIDTH);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const points = buildMetricSeries(rows, TOTAL_KEY);
  const hasSpread = points.some((point) => point.spread !== undefined);
  const bands = detectEventBands(points);

  const data: ChartDatum[] = points.map((point) => ({
    x: point.x,
    value: point.value ?? null,
    band: point.spread !== undefined && point.value !== undefined ? [point.value - point.spread, point.value + point.spread] : null,
    matchKey: point.matchKey,
    eventKey: point.eventKey,
  }));

  const xDomain: [number, number] | [string, string] = points.length === 0 ? [0, 1] : ["dataMin", "dataMax"];

  return (
    <div ref={containerRef} className="h-[280px] w-full" data-testid="metric-history-chart">
      <ComposedChart width={width} height={CHART_HEIGHT} data={data} margin={{ top: 24, right: 16, bottom: 24, left: 8 }}>
        <CartesianGrid stroke="var(--color-border)" strokeOpacity={0.4} />
        {points.length > 0 &&
          bands.map((band, index) => (
            <ReferenceArea
              key={`${band.eventKey}-${band.index}`}
              x1={band.startX - 0.5}
              x2={band.endX + 0.5}
              ifOverflow="visible"
              fill={index % 2 === 1 ? "var(--color-bg-surface)" : "transparent"}
              fillOpacity={0.7}
              stroke="none"
              label={eventBandLabel(eventNameByKey[band.eventKey] ?? band.eventKey)}
            />
          ))}
        <XAxis
          dataKey="x"
          type="number"
          domain={xDomain}
          allowDecimals={false}
          tick={{ fill: "var(--color-text-muted)", fontSize: 12 }}
          label={{ value: "Match sequence", position: "insideBottom", offset: -8, fill: "var(--color-text-muted)", fontSize: 12 }}
        />
        <YAxis
          domain={points.length === 0 ? undefined : ["dataMin", "dataMax"]}
          tick={{ fill: "var(--color-text-muted)", fontSize: 12 }}
          label={{ value: "Total", angle: -90, position: "insideLeft", fill: "var(--color-text-muted)", fontSize: 12 }}
        />
        {hasSpread && <Area dataKey="band" stroke="none" fill="var(--color-accent)" fillOpacity={0.15} connectNulls={false} isAnimationActive={false} />}
        {points.length > 0 && <Line dataKey="value" stroke="var(--color-text-primary)" strokeWidth={2} connectNulls={false} isAnimationActive={false} />}
      </ComposedChart>
    </div>
  );
}
