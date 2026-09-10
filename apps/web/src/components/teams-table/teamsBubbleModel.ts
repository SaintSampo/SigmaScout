/**
 * Pure projection for the Teams page's bubble-chart view (quick task
 * 260909-tom). No React import, no TanStack import, no DOM access — the
 * same discipline `rowModel.ts` keeps.
 *
 * D-01 — bubble size is UNIFORM: this module emits no size channel at all.
 * `BubblePoint` carries no radius field; `BUBBLE_CHART.dotRadius` is the one
 * constant every rendered dot shares, cited again on that field below.
 *
 * D-02 — colour is the rarity tier of the TOTAL metric: `tone` comes from
 * `row.metrics[TOTAL_KEY].tier`, with a `"neutral"` fallback for a Total
 * metric that carries no tier — never coerced to `"common"` (see
 * `colour_decision` in 260909-tom-PLAN.md for why the chart resolves the
 * common/unranked ambiguity differently from the table). Per D-02, this
 * module never imports `tiers.ts`'s `tierForPercentile`: the teams artifact
 * publishes `tier` directly on the metric entry, and there is no percentile
 * on this row to derive one from.
 *
 * D-03 — same filtered set, no re-filter: `rows` arrive already filtered
 * (by the route's own filter model) and are neither re-filtered nor
 * reordered here. `buildBubbleModel` makes a single pass over `rows` in the
 * order given.
 */
import type { TeamRow } from "./rowModel.js";
import { TOTAL_KEY } from "../../lib/metricKeys.js";

export type BubbleTone = "neutral" | "rare" | "epic" | "legendary";

/**
 * Draw order for the tone paths — neutral first, legendary last — and the
 * order the key row lists its four entries in. Load-bearing, not cosmetic:
 * at the real 2026 field size Legendary is 186 teams against 1,856 Common
 * (colour-and-tiers.md's measured distribution), so painting neutral first
 * and legendary last is what keeps the rare tiers visible on top of the
 * neutral mass rather than buried under it.
 */
export const BUBBLE_TONE_DRAW_ORDER: readonly BubbleTone[] = ["neutral", "rare", "epic", "legendary"];

/**
 * One plotted team. `x` is the Total metric value; `y` is the published
 * Swing Score. The algorithm's own confidence field on the source metric
 * entry is deliberately never copied onto this object — that absence is
 * what makes the never-render rule structural rather than a convention a
 * future edit could break.
 */
export interface BubblePoint {
  teamKey: string;
  teamNumber: number;
  nickname: string;
  x: number;
  y: number;
  tone: BubbleTone;
}

export interface BubbleAxis {
  domain: readonly [number, number];
  ticks: readonly number[];
  /** The one source every tick label on this axis formats with. */
  decimals: number;
}

export interface BubbleModel {
  points: readonly BubblePoint[];
  /** Rows omitted for lacking a Swing Score (fewer than two played matches). */
  omittedNoSwing: number;
  /** Rows omitted for lacking a Total metric entirely. */
  omittedNoTotal: number;
  x: BubbleAxis;
  y: BubbleAxis;
}

export interface PlotRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Every geometric number the chart component uses comes from here.
 * chart-craft.md: "derive coupled geometry; never hand-tune both ends" — the
 * plot rect, the tick positions and the dot positions must all descend from
 * this one object or they will drift.
 */
export const BUBBLE_CHART = Object.freeze({
  height: 420,
  fallbackWidth: 880,
  marginTop: 12,
  marginRight: 16,
  marginBottom: 48,
  marginLeft: 64,
  /** D-01: uniform by decision, not oversight — ~4000 teams at full filter width make a size channel pure clutter. */
  dotRadius: 2.5,
  targetTickCount: 6,
});

/** Derives the plot rect from `width` and `BUBBLE_CHART`. Clamps both dimensions to a non-negative minimum so a collapsed container cannot produce negative geometry. */
export function plotRectFor(width: number): PlotRect {
  const safeWidth = Math.max(0, width);
  return {
    left: BUBBLE_CHART.marginLeft,
    top: BUBBLE_CHART.marginTop,
    width: Math.max(0, safeWidth - BUBBLE_CHART.marginLeft - BUBBLE_CHART.marginRight),
    height: Math.max(0, BUBBLE_CHART.height - BUBBLE_CHART.marginTop - BUBBLE_CHART.marginBottom),
  };
}

const STEP_FRACTIONS = [1, 2, 5] as const;

/** The smallest 1/2/5×10^k step at or above `rawStep`. */
function niceStep(rawStep: number): number {
  if (rawStep <= 0) return 1;
  const exponent = Math.floor(Math.log10(rawStep));
  const base = 10 ** exponent;
  for (const fraction of STEP_FRACTIONS) {
    const candidate = fraction * base;
    if (candidate >= rawStep) return candidate;
  }
  // Next decade's leading 1 — equivalent to 10 * 10^exponent.
  return 10 * base;
}

/**
 * 1/2/5×10^k axis-tick selection. `min === max` (every value identical,
 * including all-zero) is widened to `[min - 0.5, min + 0.5]` BEFORE step
 * selection, so this never returns a degenerate `[v, v]` domain. `domain` is
 * always `[ticks[0], ticks[ticks.length - 1]]` — both computed from the same
 * unrounded raw bounds as the rest of the tick array, so the domain edges
 * and the first/last ticks can never drift apart under floating-point
 * rounding.
 */
export function niceAxis(min: number, max: number, targetTickCount: number): BubbleAxis {
  const widenedMin = min === max ? min - 0.5 : min;
  const widenedMax = min === max ? max + 0.5 : max;
  const rawStep = (widenedMax - widenedMin) / targetTickCount;
  const step = niceStep(rawStep);
  const decimals = Math.min(2, Math.max(0, -Math.floor(Math.log10(step))));
  const roundTo = (value: number): number => Number(value.toFixed(decimals));

  const rawLo = Math.floor(widenedMin / step) * step;
  const rawHi = Math.ceil(widenedMax / step) * step;
  const tickCount = Math.round((rawHi - rawLo) / step) + 1;
  const ticks = Array.from({ length: tickCount }, (_, index) => roundTo(rawLo + index * step));

  return {
    domain: [ticks[0]!, ticks[ticks.length - 1]!],
    ticks,
    decimals,
  };
}

/** Projects a value on `axis` to an SVG x coordinate inside `plot`. */
export function projectX(value: number, axis: BubbleAxis, plot: PlotRect): number {
  const [lo, hi] = axis.domain;
  const span = hi - lo;
  const fraction = span === 0 ? 0 : (value - lo) / span;
  return plot.left + fraction * plot.width;
}

/**
 * Projects a value on `axis` to an SVG y coordinate inside `plot`. Y is
 * INVERTED in SVG coordinates: the domain minimum lands at the plot's
 * bottom (largest screen y), the maximum at the plot's top (smallest screen
 * y).
 */
export function projectY(value: number, axis: BubbleAxis, plot: PlotRect): number {
  const [lo, hi] = axis.domain;
  const span = hi - lo;
  const fraction = span === 0 ? 0 : (value - lo) / span;
  return plot.top + plot.height - fraction * plot.height;
}

/**
 * Single pass over `rows` in the order given — no sort, no filter beyond
 * the two omission cases (D-03). Axes are built from the SURVIVING points
 * only; with zero points, both axes fall back to `niceAxis(0, 1, ...)` so
 * the caller never has to special-case an undefined axis.
 */
export function buildBubbleModel(rows: readonly TeamRow[]): BubbleModel {
  const points: BubblePoint[] = [];
  let omittedNoSwing = 0;
  let omittedNoTotal = 0;

  for (const row of rows) {
    const total = row.metrics[TOTAL_KEY];
    if (total === undefined) {
      omittedNoTotal += 1;
      continue;
    }
    if (row.swingScore === undefined) {
      omittedNoSwing += 1;
      continue;
    }
    points.push({
      teamKey: row.teamKey,
      teamNumber: row.teamNumber,
      nickname: row.nickname,
      x: total.value,
      y: row.swingScore,
      tone: total.tier ?? "neutral",
    });
  }

  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  const x =
    points.length === 0
      ? niceAxis(0, 1, BUBBLE_CHART.targetTickCount)
      : niceAxis(Math.min(...xValues), Math.max(...xValues), BUBBLE_CHART.targetTickCount);
  const y =
    points.length === 0
      ? niceAxis(0, 1, BUBBLE_CHART.targetTickCount)
      : niceAxis(Math.min(...yValues), Math.max(...yValues), BUBBLE_CHART.targetTickCount);

  return { points, omittedNoSwing, omittedNoTotal, x, y };
}

/**
 * Concatenates one arc-pair circle subpath per point into a single `d`
 * string for one tone — the whole reason the point cloud costs at most four
 * DOM nodes regardless of team count (see 260909-tom-PLAN.md's
 * `rendering_decision`). Coordinates are rounded to one decimal to keep the
 * string tight. Returns `""` for an empty input.
 *
 * Uses the DEFAULT fill-rule (nonzero), never `evenodd`: two overlapping
 * dots inside one path would punch a hole under `evenodd`, since all
 * subpaths here wind the same direction and nonzero unions them instead.
 */
export function tonePathData(points: readonly BubblePoint[], x: BubbleAxis, y: BubbleAxis, plot: PlotRect): string {
  const r = BUBBLE_CHART.dotRadius;
  const subpaths: string[] = [];
  for (const point of points) {
    const cx = Math.round(projectX(point.x, x, plot) * 10) / 10;
    const cy = Math.round(projectY(point.y, y, plot) * 10) / 10;
    subpaths.push(`M${cx},${cy}m-${r},0a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 -${2 * r},0`);
  }
  return subpaths.join("");
}
