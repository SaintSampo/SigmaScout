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
 * That property is UNCHANGED by hover/click (quick task 260909-v5v) and is
 * still the reason Recharts is not used here.
 *
 * A named export, statically imported — unlike `MetricHistoryChart`, which
 * is dynamically imported to keep Recharts out of the eager bundle. This
 * component pulls in no charting library at all, so a static import is
 * right: there is nothing to keep out of the eager bundle.
 *
 * Hover and click (quick task 260909-v5v) arrive by POINTER HIT-TESTING
 * against a uniform-grid spatial index (`teamsBubbleModel.ts`'s
 * `buildHitIndex`/`hitTestNearest`), NOT by per-point DOM. The whole
 * interaction costs at most two additional nodes at any team count: one
 * highlight ring and one tooltip card. Why that combination: a DOM node per
 * point at ~3,700 teams was the rejected option (the same reasoning as
 * above), and a hit test recovers the same affordance — "which team is
 * this?" — at bounded per-move cost instead.
 *
 * THE INVARIANT A FUTURE EDITOR MUST NOT BREAK: the tone-path memo
 * (`pathByTone`, below) is keyed on `[model, plot]` and must NEVER gain
 * hover state as a dependency. Hover state entering that dependency list
 * would rebuild ~3,700-point path strings on every mouse move, which is
 * strictly worse than the per-point DOM this whole design exists to avoid.
 *
 * THE HONEST LIMIT: `onSelectTeam` navigates programmatically (the route
 * owns the actual `navigate` call — see `<navigation_decision>` in
 * 260909-v5v-PLAN.md), so a chart point has no `href` and therefore no
 * middle-click, no cmd-click-to-new-tab, no right-click-copy-link and no
 * status-bar preview. The table's rows carry real anchors and remain the
 * route for all of that — the same tradeoff D-04's accessibility decision
 * makes, and for the same reason: an anchor per point is a DOM node per
 * point.
 *
 * This supersedes quick task 260909-tom's `rendering_decision` in exactly
 * one respect: that decision's no-tooltip, no-hover clause is reversed
 * here. The four-DOM-node property it was protecting survives intact — see
 * above.
 */
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { cn } from "@/lib/utils";
import { metricDisplayLabel } from "@/lib/metricLabels";
import { TOTAL_KEY } from "@/lib/metricKeys";
import { MetricValue } from "@/components/MetricValue";
import type { TeamRow } from "./rowModel.js";
import {
  BUBBLE_CHART,
  BUBBLE_TONE_DRAW_ORDER,
  buildBubbleModel,
  buildHitIndex,
  hitTestNearest,
  plotRectFor,
  projectX,
  projectY,
  tonePathData,
  tooltipAnchorFor,
  SWING_AXIS_LABEL,
  type BubblePoint,
  type BubbleTone,
} from "./teamsBubbleModel.js";

export interface TeamsBubbleChartProps {
  rows: readonly TeamRow[];
  /**
   * Quick task 260909-v5v (D-02, `<navigation_decision>`). This component
   * imports nothing from `@tanstack/react-router` and stays a pure
   * presentational unit — the ROUTE owns the actual navigate call. That is
   * what lets this file's tests render the component bare, with no
   * `RouterProvider`.
   */
  onSelectTeam?: (point: BubblePoint) => void;
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

export function TeamsBubbleChart({ rows, onSelectTeam }: TeamsBubbleChartProps) {
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
    // Quick task 260909-v5v (`<performance_decision>` rule 3): the cached
    // svg rect below is invalidated, not re-measured, on scroll. Re-measuring
    // eagerly on scroll would reintroduce exactly the layout cost the cache
    // exists to avoid.
    const invalidateRect = (): void => {
      rectRef.current = null;
    };
    window.addEventListener("scroll", invalidateRect, { capture: true, passive: true });
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", invalidateRect, { capture: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rectRef is a ref, stable across renders.
  }, []);

  const model = useMemo(() => buildBubbleModel(rows), [rows]);
  const plot = useMemo(() => plotRectFor(width), [width]);

  // At ~4000 points the `d` strings are the only real work this component
  // does; grouping and path-building are memoized on `[model, plot]` so an
  // unrelated re-render never rebuilds them. THIS DEPENDENCY LIST MUST NEVER
  // GAIN HOVER STATE — see the file header comment.
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

  // Quick task 260909-v5v: the spatial index for pointer hit-testing, kept
  // on the SAME dependency list as `pathByTone` for the same reason — it
  // depends only on the data and the geometry, never on the pointer.
  const hitIndex = useMemo(() => buildHitIndex(model.points, model.x, model.y, plot), [model, plot]);

  // An INDEX into `model.points`, not a point object, so the "did the
  // resolved point change" comparison below is a cheap number compare.
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // `<performance_decision>` rule 3: the svg's bounding rect, cached rather
  // than measured per pointer move (measuring immediately after a commit
  // that moved the highlight would force a synchronous layout flush — the
  // classic layout-thrash pattern, and it would run at pointer rate). Filled
  // lazily on first use; invalidated to `null` (which costs nothing) by the
  // resize/scroll listeners above and by pointer-leave.
  const rectRef = useRef<DOMRect | null>(null);

  const resolveHit = useCallback(
    (event: { currentTarget: SVGSVGElement; clientX: number; clientY: number }): number | null => {
      rectRef.current ??= event.currentTarget.getBoundingClientRect();
      const rect = rectRef.current;
      // jsdom's unstubbed rect is all zeros; the guard keeps `scale` finite
      // rather than producing `Infinity` from a zero divisor.
      const scale = rect.width > 0 ? width / rect.width : 1;
      const px = (event.clientX - rect.left) * scale;
      const py = (event.clientY - rect.top) * scale;
      return hitTestNearest(hitIndex, px, py);
    },
    [hitIndex, width],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const hit = resolveHit(event);
      // No setState when the resolved point is unchanged — sliding the
      // pointer across a single dot's hit disc causes no re-render at all.
      setHoveredIndex((current) => (current === hit ? current : hit));
    },
    [resolveHit],
  );

  const handlePointerLeave = useCallback(() => {
    setHoveredIndex(null);
    rectRef.current = null;
  }, []);

  const handleClick = useCallback(
    (event: ReactMouseEvent<SVGSVGElement>) => {
      // Recomputed from the click's OWN coordinates rather than reading
      // `hoveredIndex`: a touch tap fires `click` with no preceding
      // `pointermove`, so a click that trusted hover state would silently do
      // nothing on touch.
      const hit = resolveHit(event);
      if (hit === null) return; // A click on empty plot area must never navigate.
      onSelectTeam?.(model.points[hit]!);
    },
    [resolveHit, onSelectTeam, model.points],
  );

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

  const hoveredPoint = hoveredIndex !== null ? model.points[hoveredIndex] : undefined;
  const tooltipAnchor =
    hoveredIndex !== null ? tooltipAnchorFor(hitIndex.cx[hoveredIndex]!, hitIndex.cy[hoveredIndex]!, plot) : null;

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

      {/*
        Quick task 260909-v5v: this sentence names the pointer affordance
        honestly (D-04, `<accessibility_decision>`) rather than claiming
        keyboard operability the chart does not have. Real DOM text, so it
        reaches a screen reader too. It must contain neither "Total" nor
        "Swing Score" — both strings are asserted by existing single-match
        `getByText` calls elsewhere in this component, and a second match
        would make those throw.
      */}
      <p className="text-role-label text-[var(--color-text-muted)]">
        Hover a point for its team; click to open that team's page.
      </p>

      <div ref={containerRef} className="relative w-full">
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
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
            onClick={handleClick}
            className={cn(onSelectTeam !== undefined && hoveredIndex !== null && "cursor-pointer")}
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

            {/* Axis titles. X: the Total column's own label, never a re-typed literal. Y: SWING_AXIS_LABEL — the full name, per the recorded vocabulary rule, even though the table column abbreviates it to fit. */}
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
              {SWING_AXIS_LABEL}
            </text>

            {/*
              Quick task 260909-v5v: the highlight ring, the LAST child so it
              draws on top of the tone paths. Reads ITS OWN coordinates off
              `hitIndex` (not off `model.points` reprojected) — that is what
              guarantees the ring is centred on the drawn dot. `pointerEvents`
              off so it can never itself become a hit target. No `data-tone`
              attribute: that attribute is the node-count invariant's own
              selector, and adding it here would corrupt the measurement it
              exists to take. The ink token, not a tier colour — chart-craft.md's
              "text wears text tokens, never the series colour" applied to a
              focus mark: the ring says WHICH ONE, the fill underneath still
              says WHICH TIER.
            */}
            {hoveredIndex !== null && (
              <circle
                data-testid="bubble-chart-highlight"
                cx={hitIndex.cx[hoveredIndex]}
                cy={hitIndex.cy[hoveredIndex]}
                r={BUBBLE_CHART.highlightRadius}
                fill="none"
                stroke="var(--color-text-primary)"
                strokeWidth={1.5}
                pointerEvents="none"
              />
            )}
          </svg>
        )}

        {/*
          Quick task 260909-v5v: the tooltip card. `pointer-events-none` is
          LOAD-BEARING, not cosmetic: without it the card would intercept the
          pointer, the svg would fire `pointerleave`, the card would unmount,
          the pointer would land back over the svg, and the tooltip would
          flicker in an infinite loop. `aria-hidden` per `<accessibility_decision>`:
          this is a transient, pointer-only duplicate of a table row — an ARIA
          live region would fire at pointer-move rate and interrupt the user
          continuously, and leaving it exposed but silent would put a node in
          the accessibility tree that appears and vanishes under a pointer the
          AT user is not driving.
        */}
        {hoveredPoint && tooltipAnchor && (
          <div
            data-testid="bubble-chart-tooltip"
            aria-hidden="true"
            style={{ left: tooltipAnchor.left, top: tooltipAnchor.top, width: BUBBLE_CHART.tooltipWidth }}
            className="pointer-events-none absolute rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-[var(--spacing-sm)] py-[var(--spacing-xs)]"
          >
            <p className="text-role-heading text-[var(--color-text-primary)]">{hoveredPoint.teamNumber}</p>
            <p className="text-role-label text-[var(--color-text-muted)] truncate">{hoveredPoint.nickname}</p>
            <div className="flex items-center justify-between gap-[var(--spacing-sm)]">
              <span className="text-role-label text-[var(--color-text-muted)]">{totalLabel}</span>
              <MetricValue metric={{ value: hoveredPoint.x }} />
            </div>
            <div className="flex items-center justify-between gap-[var(--spacing-sm)]">
              <span className="text-role-label text-[var(--color-text-muted)]">{SWING_AXIS_LABEL}</span>
              <MetricValue metric={{ value: hoveredPoint.y }} />
            </div>
          </div>
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
