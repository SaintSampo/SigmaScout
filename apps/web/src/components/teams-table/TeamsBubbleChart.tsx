/**
 * The Teams page's bubble-chart view — a hand-rolled SVG scatter of the
 * currently filtered teams, X = Total, Y = Sigma Score, and point COLOUR is
 * a selectable rarity tier: Total by default, Sigma Score when the
 * "Colour by" control's `colorBy` prop says so. The route owns the actual
 * selection (it lives in the `tint` search param), which is why this
 * component's own `colorBy` state is fully controlled — see the
 * `onSelectTeam` doc below for the same navigation split applied to clicks.
 *
 * Sigma Score is published for SPR only. When no row carries one (every OPR
 * and EPA row set) the component renders a plain no-Sigma state instead of an
 * axis: no svg, no key, just one sentence pointing the reader at SPR. That
 * branch keys off the data (`model.hasAnySigma`), never off an algorithm id,
 * the same way the Teams table's Total column keys its split pill's right
 * half off `row.sigmaScore` presence.
 *
 * Not Recharts — a deliberate departure from this project's default charting
 * library. Recharts' `<Scatter>` mounts one React component and one SVG node
 * per point. At real field sizes (thousands of teams) that is thousands of
 * components rebuilt on every filter change and resize, on the page whose
 * stated top priority is load and interaction speed. `MetricHistoryChart.tsx`
 * correctly stays on Recharts because it plots one team's season — tens to
 * low hundreds of points, not thousands.
 *
 * Instead, the whole point cloud is drawn as at most four SVG `<path>` nodes
 * (`teamsBubbleModel.ts`'s `tonePathData`, one per non-empty tone). That
 * property is unchanged by hover/click and is still the reason Recharts is
 * not used here.
 *
 * A named export, statically imported — unlike `MetricHistoryChart`, which is
 * dynamically imported to keep Recharts out of the eager bundle. This
 * component pulls in no charting library at all, so a static import is
 * right: there is nothing to keep out of the eager bundle.
 *
 * Hover and click arrive by pointer hit-testing against a uniform-grid
 * spatial index (`teamsBubbleModel.ts`'s `buildHitIndex`/`hitTestNearest`),
 * not by per-point DOM. The whole interaction costs at most two additional
 * nodes at any team count: one highlight ring and one tooltip card.
 *
 * The invariant a future editor must not break: the tone-path memo
 * (`pathByTone`, below) is keyed on `[model, plot]` and must never gain hover
 * state as a dependency. Hover state entering that dependency list would
 * rebuild thousands of path strings on every mouse move, which is strictly
 * worse than the per-point DOM this whole design exists to avoid.
 *
 * The honest limit: `onSelectTeam` navigates programmatically (the route
 * owns the actual `navigate` call), so a chart point has no `href` and
 * therefore no middle-click, no cmd-click-to-new-tab, no right-click-copy-link
 * and no status-bar preview. The table's rows carry real anchors and remain
 * the route for all of that — an anchor per point is a DOM node per point.
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
import { algorithmDisplayLabel } from "@/components/ribbon/AlgorithmSelect";
import { Button } from "@/components/ui/button";
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
  SIGMA_AXIS_LABEL,
  type BubbleColorBy,
  type BubblePoint,
  type BubbleTone,
} from "./teamsBubbleModel.js";

export interface TeamsBubbleChartProps {
  rows: readonly TeamRow[];
  /**
   * This component imports nothing from `@tanstack/react-router` and stays a
   * pure presentational unit — the route owns the actual navigate call. That
   * is what lets this file's tests render the component bare, with no
   * `RouterProvider`.
   */
  onSelectTeam?: (point: BubblePoint) => void;
  /** Which published rarity tier tints the point cloud. Defaults to `"total"`, matching `buildBubbleModel`'s own default. */
  colorBy?: BubbleColorBy;
  /**
   * Fired when the "Colour by" control's active segment changes. Optional,
   * mirroring `onSelectTeam` — a bare render (as in most of this file's
   * existing tests) shows the control with Total pressed and clicking it is
   * inert, exactly like `onSelectTeam`'s existing bare-render behaviour.
   */
  onColorByChange?: (next: BubbleColorBy) => void;
}

/** The visible label and accessible name for the "Colour by" control's labelling span. */
const COLOR_BY_LABEL = "Colour by";

/** Key-row labels, in `BUBBLE_TONE_DRAW_ORDER`. The first is deliberately not "Common": the wire cannot distinguish an unranked Total from a Common one, and the key must not claim it can. */
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

export function TeamsBubbleChart({ rows, onSelectTeam, colorBy = "total", onColorByChange }: TeamsBubbleChartProps) {
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
    // The cached svg rect below is invalidated, not re-measured, on scroll.
    // Re-measuring eagerly on scroll would reintroduce exactly the layout
    // cost the cache exists to avoid.
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

  const model = useMemo(() => buildBubbleModel(rows, colorBy), [rows, colorBy]);
  const plot = useMemo(() => plotRectFor(width), [width]);

  // At large team counts the `d` strings are the only real work this
  // component does; grouping and path-building are memoized on
  // `[model, plot]` so an unrelated re-render never rebuilds them. This
  // dependency list must never gain hover state — see the file header
  // comment.
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

  // The spatial index for pointer hit-testing, kept on the same dependency
  // list as `pathByTone` for the same reason — it depends only on the data
  // and the geometry, never on the pointer.
  const hitIndex = useMemo(() => buildHitIndex(model.points, model.x, model.y, plot), [model, plot]);

  // An INDEX into `model.points`, not a point object, so the "did the
  // resolved point change" comparison below is a cheap number compare.
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // The svg's bounding rect, cached rather than measured per pointer move
  // (measuring immediately after a commit that moved the highlight would
  // force a synchronous layout flush — the classic layout-thrash pattern, and
  // it would run at pointer rate). Filled lazily on first use; invalidated to
  // `null` (which costs nothing) by the resize/scroll listeners above and by
  // pointer-leave.
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

  /** The control's two segments, in display order. Labels are imported constants — never re-typed literals, per D-03. */
  const colorByOptions: readonly { value: BubbleColorBy; label: string }[] = [
    { value: "total", label: totalLabel },
    { value: "sigma", label: SIGMA_AXIS_LABEL },
  ];

  // The no-Sigma state. Placed after every hook above so the hook order
  // never changes between renders. The label for SPR is the one the ribbon's
  // algorithm menu shows, read through `algorithmDisplayLabel` rather than
  // re-typed.
  //
  // Gated on `rows.length > 0` so a filter that matches nothing keeps the
  // ordinary empty state below. The copy is deliberately true in both cases
  // that reach this branch, because it cannot tell them apart without an
  // algorithm id: OPR and EPA (never any Sigma Score), and SPR before any team
  // has played this season (a fresh Sigma layer per season, so no entries
  // yet). "Choose SPR" would be wrong for the second, so it is not said.
  if (rows.length > 0 && !model.hasAnySigma) {
    const sprLabel = algorithmDisplayLabel("spr");
    return (
      <div data-testid="teams-bubble-chart" className="flex flex-col gap-[var(--spacing-md)]">
        <p data-testid="bubble-chart-no-sigma" className="text-role-body text-[var(--color-text-muted)]">
          {`No team here has a ${SIGMA_AXIS_LABEL} to plot. ${SIGMA_AXIS_LABEL} is published for ${sprLabel} only, and a team gets one after it plays its first match of the season.`}
        </p>
      </div>
    );
  }

  const omissionNotes: string[] = [];
  if (model.omittedNoSigma > 0) {
    // A Sigma entry is absent only when the SigmaScout layer never folded a
    // match for that team (`SigmaScoreAccumulator.scoreByTeam` lists exactly
    // the teams it has folded), but a fold can also be skipped for a fully
    // demo or fully disqualified alliance, so "has not played" is not always
    // literally true. This wording is true in every case.
    omissionNotes.push(omissionNote(model.omittedNoSigma, `they have no ${SIGMA_AXIS_LABEL} for this season.`));
  }
  if (model.omittedNoTotal > 0) {
    omissionNotes.push(omissionNote(model.omittedNoTotal, `they carry no ${totalLabel} for this algorithm.`));
  }

  const hoveredPoint = hoveredIndex !== null ? model.points[hoveredIndex] : undefined;
  const tooltipAnchor =
    hoveredIndex !== null ? tooltipAnchorFor(hitIndex.cx[hoveredIndex]!, hitIndex.cy[hoveredIndex]!, plot) : null;

  return (
    <div data-testid="teams-bubble-chart" className="flex flex-col gap-[var(--spacing-md)]">
      {/*
        The key row and the "Colour by" control share one flex row, the
        control at its right end. They stay two SIBLINGS, never one nested
        inside the other: `bubble-chart-key`'s four-children assertion in
        `TeamsBubbleChart.test.tsx` pins its children by equality, and a
        fifth child (the control) would break that pin.
      */}
      <div className="flex flex-wrap items-center justify-between gap-[var(--spacing-sm)]">
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
          The "Colour by" control. `aria-labelledby` rather than
          `aria-label` so the visible "Colour by" span IS the accessible
          name — a screen reader is not told the label twice. A static id is
          safe because this chart renders once per page.
        */}
        <div className="flex items-center gap-[var(--spacing-xs)] text-role-label text-[var(--color-text-muted)]">
          <span id="bubble-chart-color-by-label">{COLOR_BY_LABEL}</span>
          <div
            role="group"
            aria-labelledby="bubble-chart-color-by-label"
            data-testid="bubble-chart-color-by"
            className="inline-flex gap-[var(--spacing-xs)]"
          >
            {colorByOptions.map((option) => {
              const isActive = option.value === colorBy;
              return (
                <Button
                  key={option.value}
                  type="button"
                  variant={isActive ? "default" : "ghost"}
                  size="sm"
                  aria-pressed={isActive}
                  data-testid={`bubble-chart-color-by-${option.value}`}
                  onClick={() => onColorByChange?.(option.value)}
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
        </div>
      </div>

      {/*
        This sentence names the pointer affordance honestly rather than
        claiming keyboard operability the chart does not have. Real DOM text,
        so it reaches a screen reader too. The svg's axis titles and the
        "Colour by" control's segment labels now both carry "Total" and
        "Sigma Score" on screen, so `TeamsBubbleChart.test.tsx` asserts those
        two exact strings SCOPED to `within(screen.getByRole("img"))` rather
        than with an unscoped single-match `getByText` — a second on-screen
        occurrence of either word is fine, as long as the axis title inside
        the chart still carries it.
      */}
      <p className="text-role-label text-[var(--color-text-muted)]">
        Hover a point for its team; click to open that team's page.
      </p>

      <div ref={containerRef} className="relative w-full">
        {model.points.length === 0 ? (
          <p data-testid="bubble-chart-empty" className="text-role-body text-[var(--color-text-muted)]">
            No teams have both a {totalLabel} value and a {SIGMA_AXIS_LABEL} to plot.
          </p>
        ) : (
          <svg
            role="img"
            aria-label={`${model.points.length} teams plotted. Horizontal axis: ${totalLabel}. Vertical axis: ${SIGMA_AXIS_LABEL}.`}
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

            {/* Axis titles. X: the Total column's own label, never a re-typed literal. Y: SIGMA_AXIS_LABEL, the full name, per the recorded vocabulary rule, even though the table column abbreviates it to fit. */}
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
              {SIGMA_AXIS_LABEL}
            </text>

            {/*
              The highlight ring, the last child so it draws on top of the
              tone paths. Reads its own coordinates off `hitIndex` (not off
              `model.points` reprojected) — that is what guarantees the ring
              is centred on the drawn dot. `pointerEvents` off so it can never
              itself become a hit target. No `data-tone` attribute: that
              attribute is the node-count invariant's own selector, and adding
              it here would corrupt the measurement it exists to take. The ink
              token, not a tier colour: the ring says which one, the fill
              underneath still says which tier.
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
          The tooltip card. `pointer-events-none` is load-bearing, not
          cosmetic: without it the card would intercept the pointer, the svg
          would fire `pointerleave`, the card would unmount, the pointer would
          land back over the svg, and the tooltip would flicker in an infinite
          loop. `aria-hidden`: this is a transient, pointer-only duplicate of
          a table row — an ARIA live region would fire at pointer-move rate
          and interrupt the user continuously, and leaving it exposed but
          silent would put a node in the accessibility tree that appears and
          vanishes under a pointer the AT user is not driving.
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
              <span className="text-role-label text-[var(--color-text-muted)]">{SIGMA_AXIS_LABEL}</span>
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
