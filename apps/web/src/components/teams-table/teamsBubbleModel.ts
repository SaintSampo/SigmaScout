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
 *
 * Quick task 260909-v5v: this module also now serves pointer hit-testing —
 * `buildHitIndex`/`hitTestNearest` resolve a pointer position to the nearest
 * plotted point, and `tooltipAnchorFor` places the hover card. The hit test
 * lives HERE, in a pure module, rather than in the component, because jsdom
 * does no layout: a hit test written against live element geometry would be
 * untestable in this repo's test environment, while a pure function over
 * numbers is exhaustively testable.
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
  /**
   * Quick task 260909-v5v: the pointer-to-point distance inside which a
   * point counts as hit, AND the spatial grid's cell size (`buildHitIndex`).
   * These are DELIBERATELY the same number — the 3x3-neighbourhood scan
   * `hitTestNearest` runs is exhaustive only because the cell size is at
   * least the hit radius. Changing one without the other starts silently
   * missing points.
   */
  hitRadius: 12,
  /** The hover ring's radius — about 2.4x `dotRadius`, big enough to read against a dense cloud without hiding its neighbours. */
  highlightRadius: 6,
  /**
   * The tooltip card's declared geometry (chart-craft.md: "derive coupled
   * geometry; never hand-tune both ends"). `TeamsBubbleChart.tsx`'s inline
   * card width and `tooltipAnchorFor`'s flip arithmetic both read these same
   * fields, or the card will flip at the wrong moment.
   */
  tooltipWidth: 220,
  tooltipHeight: 96,
  tooltipOffset: 12,
});

/**
 * The per-team published number and the Y axis title — SigmaScout's own
 * heuristic for how much a robot's contribution varies match to match. NOT
 * Match Band (an unrelated term) and NEVER the algorithm's own internal
 * confidence field. The axis title and the tooltip's row label both read
 * this ONE constant, so "the same label the axis uses, never a re-typed
 * literal" (D-01, quick task 260909-v5v) is structural rather than a
 * convention two call sites could drift apart on.
 */
export const SWING_AXIS_LABEL = "Swing Score";

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
 * Rounds a projected coordinate to one decimal. Shared, rather than inline,
 * because `tonePathData` and `buildHitIndex` (quick task 260909-v5v) both
 * project the same points, and if the two rounded differently the highlight
 * ring would sit a fraction off the dot it claims to be marking. One helper
 * is the enforcement.
 */
function roundCoord(value: number): number {
  return Math.round(value * 10) / 10;
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
    const cx = roundCoord(projectX(point.x, x, plot));
    const cy = roundCoord(projectY(point.y, y, plot));
    subpaths.push(`M${cx},${cy}m-${r},0a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 -${2 * r},0`);
  }
  return subpaths.join("");
}

/**
 * A uniform-grid spatial index over a `BubbleModel`'s points, built once per
 * `[model, plot]` (quick task 260909-v5v). `cx`/`cy`/`teamNumbers` are
 * parallel typed arrays, one entry per `points[i]`. `teamNumbers` is
 * duplicated into the index rather than read back off `points` so
 * `hitTestNearest` needs no second argument and no property access in its
 * inner loop.
 *
 * `buckets` is a FLAT grid indexed `row * cols + col`, deliberately NOT a
 * `Map` with string keys: the lookup runs at pointer rate, and a string key
 * would allocate on every move.
 */
export interface BubbleHitIndex {
  cx: Float64Array;
  cy: Float64Array;
  teamNumbers: Int32Array;
  originX: number;
  originY: number;
  cellSize: number;
  cols: number;
  rows: number;
  buckets: readonly (readonly number[])[];
}

/**
 * Builds a `BubbleHitIndex` in one pass: project each point with
 * `projectX`/`projectY`, round with the same `roundCoord` `tonePathData`
 * uses, store into the typed arrays, and push its index into its bucket.
 * Grid origin is `plot.left`/`plot.top`; `cellSize` is
 * `BUBBLE_CHART.hitRadius`. `cols`/`rows` are always at least 1, so a
 * collapsed (zero width or height) plot rect still yields a usable 1x1 grid
 * rather than throwing or producing a zero-dimension grid.
 */
export function buildHitIndex(points: readonly BubblePoint[], x: BubbleAxis, y: BubbleAxis, plot: PlotRect): BubbleHitIndex {
  const cellSize = BUBBLE_CHART.hitRadius;
  const originX = plot.left;
  const originY = plot.top;
  const cols = Math.max(1, Math.ceil(plot.width / cellSize) + 1);
  const rows = Math.max(1, Math.ceil(plot.height / cellSize) + 1);

  const cx = new Float64Array(points.length);
  const cy = new Float64Array(points.length);
  const teamNumbers = new Int32Array(points.length);
  const buckets: number[][] = Array.from({ length: cols * rows }, () => []);

  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    const px = roundCoord(projectX(point.x, x, plot));
    const py = roundCoord(projectY(point.y, y, plot));
    cx[i] = px;
    cy[i] = py;
    teamNumbers[i] = point.teamNumber;

    let col = Math.floor((px - originX) / cellSize);
    let row = Math.floor((py - originY) / cellSize);
    if (col < 0) col = 0;
    else if (col >= cols) col = cols - 1;
    if (row < 0) row = 0;
    else if (row >= rows) row = rows - 1;
    buckets[row * cols + col]!.push(i);
  }

  return { cx, cy, teamNumbers, originX, originY, cellSize, cols, rows, buckets };
}

/**
 * Resolves a pointer position to the index of the nearest point within
 * `BUBBLE_CHART.hitRadius`, or `null` if none is that close. Computes the
 * pointer's grid cell, CLAMPS it into range, and scans the 3x3 neighbourhood
 * of cells around it — exhaustive because the grid's cell size equals the
 * hit radius, so a point within `hitRadius` of a pointer that sits outside
 * the grid must lie within `hitRadius` of the grid boundary too, hence in
 * the clamped boundary cell or its immediate neighbour, which the 3x3 scan
 * covers.
 *
 * Compares squared distance against squared `hitRadius`, never a square
 * root. Ties (an exactly equal squared distance) resolve to the LOWER
 * `teamNumbers` entry — D-03's determinism, written as an explicit branch
 * rather than left to iteration order, so the same pixel always yields the
 * same team regardless of point order in the model.
 *
 * Allocates nothing: no array, no object, no closure. Returns an index into
 * the points the index was built from, or `null`.
 */
export function hitTestNearest(index: BubbleHitIndex, px: number, py: number): number | null {
  const { cx, cy, teamNumbers, originX, originY, cellSize, cols, rows, buckets } = index;
  const radius = BUBBLE_CHART.hitRadius;
  const radiusSq = radius * radius;

  let pointerCol = Math.floor((px - originX) / cellSize);
  let pointerRow = Math.floor((py - originY) / cellSize);
  if (pointerCol < 0) pointerCol = 0;
  else if (pointerCol >= cols) pointerCol = cols - 1;
  if (pointerRow < 0) pointerRow = 0;
  else if (pointerRow >= rows) pointerRow = rows - 1;

  let best: number | null = null;
  let bestDistSq = Infinity;

  for (let row = Math.max(0, pointerRow - 1); row <= Math.min(rows - 1, pointerRow + 1); row++) {
    for (let col = Math.max(0, pointerCol - 1); col <= Math.min(cols - 1, pointerCol + 1); col++) {
      const bucket = buckets[row * cols + col]!;
      for (let k = 0; k < bucket.length; k++) {
        const i = bucket[k]!;
        const dx = cx[i]! - px;
        const dy = cy[i]! - py;
        const distSq = dx * dx + dy * dy;
        if (distSq > radiusSq) continue;
        if (
          distSq < bestDistSq ||
          (distSq === bestDistSq && best !== null && teamNumbers[i]! < teamNumbers[best]!)
        ) {
          best = i;
          bestDistSq = distSq;
        }
      }
    }
  }

  return best;
}

/**
 * Places the tooltip card down-and-right of the point by default, flipping
 * left when that would overflow the plot rect's right edge and up when it
 * would overflow the bottom edge. Clamps both `left`/`top` to at least 0, so
 * a flip near the top-left corner never positions the card off the
 * container. Pure — no DOM measurement — which is the whole reason the card
 * has a DECLARED width/height (`BUBBLE_CHART.tooltipWidth`/`tooltipHeight`)
 * rather than being measured: the flip behaviour is unit-testable without a
 * DOM.
 */
export function tooltipAnchorFor(cx: number, cy: number, plot: PlotRect): { left: number; top: number } {
  const { tooltipWidth, tooltipHeight, tooltipOffset } = BUBBLE_CHART;

  let left = cx + tooltipOffset;
  if (left + tooltipWidth > plot.left + plot.width) {
    left = cx - tooltipOffset - tooltipWidth;
  }

  let top = cy + tooltipOffset;
  if (top + tooltipHeight > plot.top + plot.height) {
    top = cy - tooltipOffset - tooltipHeight;
  }

  return { left: Math.max(0, left), top: Math.max(0, top) };
}
