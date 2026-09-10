/**
 * The Teams page's bubble-chart view (quick task 260909-tom) — a hand-rolled
 * SVG scatter of the currently filtered teams, X = Total, Y = Swing Score.
 *
 * NOT Recharts — a deliberate departure from this project's default
 * charting library (260909-tom-PLAN.md `rendering_decision`). Recharts'
 * `<Scatter>` mounts one React component and one SVG node per point. At the
 * real 2026 field size (~3,700 teams, `colour-and-tiers.md`'s measured
 * distribution) that is thousands of components rebuilt on every filter
 * change and resize, on the page whose stated top priority is load and
 * interaction speed. `MetricHistoryChart.tsx` correctly stays on Recharts
 * because it plots one team's season — tens to low hundreds of points, not
 * thousands.
 *
 * Instead, the whole point cloud is drawn as at most four SVG `<path>`
 * nodes (`teamsBubbleModel.ts`'s `tonePathData`, one per non-empty tone).
 *
 * A named export, statically imported — unlike `MetricHistoryChart`, which
 * is dynamically imported to keep Recharts out of the eager bundle. This
 * component pulls in no charting library at all, so a static import is
 * right: there is nothing to keep out of the eager bundle.
 *
 * No tooltip and no per-point hover — that is the whole reason the point
 * cloud costs four DOM nodes. This is a decision, not an omission: D-01's
 * own rationale is that clutter is the enemy at this density, and the
 * table, with its per-team rows and links, is one click away.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { metricDisplayLabel } from "@/lib/metricLabels";
import { TOTAL_KEY } from "@/lib/metricKeys";
import type { TeamRow } from "./rowModel.js";
import {
  BUBBLE_CHART,
  BUBBLE_TONE_DRAW_ORDER,
  buildBubbleModel,
  plotRectFor,
  projectX,
  projectY,
  tonePathData,
  type BubblePoint,
  type BubbleTone,
} from "./teamsBubbleModel.js";

export interface TeamsBubbleChartProps {
  rows: readonly TeamRow[];
}

/** Key-row labels, in `BUBBLE_TONE_DRAW_ORDER`. The first is deliberately not "Common" — see 260909-tom-PLAN.md's `colour_decision`: the wire cannot distinguish an unranked Total from a Common one, and the key must not claim it can. */
const TONE_KEY_LABEL: Readonly<Record<BubbleTone, string>> = {
  neutral: "Common / unranked",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

function omissionNote(count: number, reason: string): string {
  const subject = count === 1 ? "team is" : "teams are";
  return `${count} ${subject} not plotted: ${reason}`;
}

export function TeamsBubbleChart({ rows }: TeamsBubbleChartProps) {
  // Sizing: copies `MetricHistoryChart.tsx`'s measure-with-a-sane-fallback
  // pattern verbatim — a `useLayoutEffect` reads the container's real width
  // where one exists (a real browser) and falls back to
  // `BUBBLE_CHART.fallbackWidth` where one does not (jsdom always measures
  // 0), so both environments render a real, non-zero chart.
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(BUBBLE_CHART.fallbackWidth);

  useLayoutEffect(() => {
    const measure = (): void => {
      const el = containerRef.current;
      if (!el) return;
      const measured = el.getBoundingClientRect().width;
      setWidth(measured > 0 ? measured : BUBBLE_CHART.fallbackWidth);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const model = useMemo(() => buildBubbleModel(rows), [rows]);
  const plot = useMemo(() => plotRectFor(width), [width]);

  // At ~4000 points the `d` strings are the only real work this component
  // does; grouping and path-building are memoized on `[model, plot]` so an
  // unrelated re-render never rebuilds them.
  const pathByTone = useMemo(() => {
    const groups = new Map<BubbleTone, BubblePoint[]>();
    for (const tone of BUBBLE_TONE_DRAW_ORDER) groups.set(tone, []);
    for (const point of model.points) {
      groups.get(point.tone)!.push(point);
    }
    const paths = new Map<BubbleTone, string>();
    for (const tone of BUBBLE_TONE_DRAW_ORDER) {
      paths.set(tone, tonePathData(groups.get(tone) ?? [], model.x, model.y, plot));
    }
    return paths;
  }, [model, plot]);

  const totalLabel = metricDisplayLabel(TOTAL_KEY);

  const omissionNotes: string[] = [];
  if (model.omittedNoSwing > 0) {
    omissionNotes.push(
      omissionNote(model.omittedNoSwing, "they have played fewer than two matches, so they have no Swing Score."),
    );
  }
  if (model.omittedNoTotal > 0) {
    omissionNotes.push(omissionNote(model.omittedNoTotal, `they carry no ${totalLabel} for this algorithm.`));
  }

  return (
    <div data-testid="teams-bubble-chart" className="flex flex-col gap-[var(--spacing-md)]">
      {/* The key row, ordinary HTML above the svg, not inside it. */}
      <div
        data-testid="bubble-chart-key"
        className="flex flex-wrap items-center gap-[var(--spacing-sm)] text-role-label text-[var(--color-text-muted)]"
      >
        {BUBBLE_TONE_DRAW_ORDER.map((tone) => (
          <span key={tone} className="flex items-center gap-[var(--spacing-xs)]">
            <span aria-hidden="true" className={cn("bubble-tone", `bubble-tone--${tone}`, "inline-block h-3 w-3 rounded-full")} />
            {TONE_KEY_LABEL[tone]}
          </span>
        ))}
      </div>

      <div ref={containerRef} className="w-full">
        {model.points.length === 0 ? (
          <p data-testid="bubble-chart-empty" className="text-role-body text-[var(--color-text-muted)]">
            No teams have both a {totalLabel} value and a Swing Score to plot.
          </p>
        ) : (
          <svg
            role="img"
            aria-label={`${model.points.length} teams plotted. Horizontal axis: ${totalLabel}. Vertical axis: Swing Score.`}
            width={width}
            height={BUBBLE_CHART.height}
            viewBox={`0 0 ${width} ${BUBBLE_CHART.height}`}
          >
            {/* Gridlines and tick labels — every coordinate derives from `plot`, `model.x`/`model.y` and `BUBBLE_CHART`, no literal offsets. */}
            {model.x.ticks.map((tick) => {
              const tx = projectX(tick, model.x, plot);
              return (
                <g key={`x-${tick}`}>
                  <line x1={tx} y1={plot.top} x2={tx} y2={plot.top + plot.height} stroke="var(--color-border)" />
                  <text x={tx} y={plot.top + plot.height + 16} textAnchor="middle" fontSize={11} fill="var(--color-text-muted)">
                    {tick.toFixed(model.x.decimals)}
                  </text>
                </g>
              );
            })}
            {model.y.ticks.map((tick) => {
              const ty = projectY(tick, model.y, plot);
              return (
                <g key={`y-${tick}`}>
                  <line x1={plot.left} y1={ty} x2={plot.left + plot.width} y2={ty} stroke="var(--color-border)" />
                  <text x={plot.left - 8} y={ty + 3} textAnchor="end" fontSize={11} fill="var(--color-text-muted)">
                    {tick.toFixed(model.y.decimals)}
                  </text>
                </g>
              );
            })}

            {/* Tone paths, in BUBBLE_TONE_DRAW_ORDER, skipping empty groups — at most four DOM nodes regardless of team count. */}
            {BUBBLE_TONE_DRAW_ORDER.map((tone) => {
              const d = pathByTone.get(tone);
              if (!d) return null;
              return <path key={tone} data-tone={tone} className={cn("bubble-tone", `bubble-tone--${tone}`)} d={d} />;
            })}

            {/* Axis titles. X: the Total column's own label, never a re-typed literal. Y: the literal string "Swing Score" — the full name, per the recorded vocabulary rule, even though the table column abbreviates it to fit. */}
            <text x={plot.left + plot.width / 2} y={BUBBLE_CHART.height - 6} textAnchor="middle" fontSize={12} fill="var(--color-text-muted)">
              {totalLabel}
            </text>
            <text
              x={16}
              y={plot.top + plot.height / 2}
              textAnchor="middle"
              fontSize={12}
              fill="var(--color-text-muted)"
              transform={`rotate(-90, 16, ${plot.top + plot.height / 2})`}
            >
              Swing Score
            </text>
          </svg>
        )}
      </div>

      {omissionNotes.map((note) => (
        <p key={note} className="text-role-label text-[var(--color-text-muted)]">
          {note}
        </p>
      ))}
    </div>
  );
}
