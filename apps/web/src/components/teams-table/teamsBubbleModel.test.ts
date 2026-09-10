/**
 * Coverage for `teamsBubbleModel.ts` (Task 1, 260909-tom-PLAN.md and Task 1,
 * 260909-v5v-PLAN.md) — the nine original behaviors plus the twelve hit-test
 * / tooltip-anchor behaviors listed in 260909-v5v-PLAN.md's `<behavior>`
 * block, one test each.
 */
import { describe, expect, it } from "vitest";
import { TOTAL_KEY } from "../../lib/metricKeys.js";
import type { TeamRow } from "./rowModel.js";
import {
  BUBBLE_CHART,
  BUBBLE_TONE_DRAW_ORDER,
  buildBubbleModel,
  buildHitIndex,
  hitTestNearest,
  niceAxis,
  plotRectFor,
  projectX,
  projectY,
  tonePathData,
  tooltipAnchorFor,
  type BubblePoint,
} from "./teamsBubbleModel.js";

function makeRow(overrides: Partial<TeamRow> & Pick<TeamRow, "teamKey" | "teamNumber">): TeamRow {
  return {
    teamKey: overrides.teamKey,
    teamNumber: overrides.teamNumber,
    nickname: overrides.nickname ?? `Team ${overrides.teamNumber}`,
    record: overrides.record ?? { wins: 0, losses: 0, ties: 0 },
    winRate: overrides.winRate ?? null,
    metrics: overrides.metrics ?? {},
    swingScore: overrides.swingScore,
    swingTier: overrides.swingTier,
    rank: overrides.rank ?? overrides.teamNumber,
  };
}

describe("teamsBubbleModel", () => {
  it("returns one point per row with BOTH a Total value and a Swing Score, in input order", () => {
    const rows: TeamRow[] = [
      makeRow({ teamKey: "frc2", teamNumber: 2, metrics: { [TOTAL_KEY]: { value: 20 } }, swingScore: 4 }),
      makeRow({ teamKey: "frc1", teamNumber: 1, metrics: { [TOTAL_KEY]: { value: 10 } }, swingScore: 2 }),
    ];
    const model = buildBubbleModel(rows);
    expect(model.points.map((point) => point.teamKey)).toEqual(["frc2", "frc1"]);
    expect(model.points).toHaveLength(2);
  });

  it("omits a row with swingScore undefined, incrementing omittedNoSwing, and never emits a y === 0 point for it", () => {
    const rows: TeamRow[] = [makeRow({ teamKey: "frc1", teamNumber: 1, metrics: { [TOTAL_KEY]: { value: 10 } }, swingScore: undefined })];
    const model = buildBubbleModel(rows);
    expect(model.points).toHaveLength(0);
    expect(model.omittedNoSwing).toBe(1);
    expect(model.omittedNoTotal).toBe(0);
    expect(model.points.some((point) => point.teamKey === "frc1")).toBe(false);
  });

  it("omits a row whose metrics[TOTAL_KEY] is absent, incrementing omittedNoTotal", () => {
    const rows: TeamRow[] = [makeRow({ teamKey: "frc1", teamNumber: 1, metrics: {}, swingScore: 4 })];
    const model = buildBubbleModel(rows);
    expect(model.points).toHaveLength(0);
    expect(model.omittedNoTotal).toBe(1);
    expect(model.omittedNoSwing).toBe(0);
  });

  it("tone is the published tier for rows that have one; a Total metric with no tier yields 'neutral', never 'common'", () => {
    const rows: TeamRow[] = [
      makeRow({ teamKey: "frc1", teamNumber: 1, metrics: { [TOTAL_KEY]: { value: 10, tier: "epic" } }, swingScore: 1 }),
      makeRow({ teamKey: "frc2", teamNumber: 2, metrics: { [TOTAL_KEY]: { value: 5 } }, swingScore: 1 }),
    ];
    const model = buildBubbleModel(rows);
    expect(model.points[0]?.tone).toBe("epic");
    expect(model.points[1]?.tone).toBe("neutral");
    expect(model.points[1]?.tone).not.toBe("common");
  });

  it("never copies the algorithm's own confidence field onto the built point object", () => {
    const rows: TeamRow[] = [
      makeRow({ teamKey: "frc1", teamNumber: 1, metrics: { [TOTAL_KEY]: { value: 10, spread: 3.5, tier: "rare" } }, swingScore: 1 }),
    ];
    const model = buildBubbleModel(rows);
    expect(Object.keys(model.points[0]!)).not.toContain("spread");
  });

  it("niceAxis returns a domain whose first and last ticks ARE the domain edges, with at least two ticks", () => {
    const axis = niceAxis(3, 47, 6);
    expect(axis.ticks.length).toBeGreaterThanOrEqual(2);
    expect(axis.domain[0]).toBe(axis.ticks[0]);
    expect(axis.domain[1]).toBe(axis.ticks[axis.ticks.length - 1]);
  });

  it("niceAxis on a zero-width range (all values identical, including all-zero) returns a usable, non-degenerate domain", () => {
    const axis = niceAxis(0, 0, 6);
    expect(axis.domain[0]).not.toBe(axis.domain[1]);
    expect(axis.ticks.length).toBeGreaterThanOrEqual(2);
  });

  it("tonePathData emits exactly one M command per point, and the empty string for an empty group", () => {
    const axis = niceAxis(0, 10, 6);
    const plot = plotRectFor(BUBBLE_CHART.fallbackWidth);
    const points = [
      { teamKey: "frc1", teamNumber: 1, nickname: "A", x: 0, y: 0, tone: "neutral" as const },
      { teamKey: "frc2", teamNumber: 2, nickname: "B", x: 10, y: 10, tone: "neutral" as const },
    ];
    const d = tonePathData(points, axis, axis, plot);
    expect((d.match(/M/g) ?? []).length).toBe(2);
    expect(tonePathData([], axis, axis, plot)).toBe("");
  });

  it("projects a point at the domain minimum to the plot rect's left/bottom edge, and the maximum to the right/top edge", () => {
    const axis = niceAxis(0, 10, 6);
    const plot = plotRectFor(BUBBLE_CHART.fallbackWidth);
    expect(projectX(axis.domain[0], axis, plot)).toBe(plot.left);
    expect(projectX(axis.domain[1], axis, plot)).toBe(plot.left + plot.width);
    expect(projectY(axis.domain[0], axis, plot)).toBe(plot.top + plot.height);
    expect(projectY(axis.domain[1], axis, plot)).toBe(plot.top);
  });

  it("BUBBLE_TONE_DRAW_ORDER is neutral first, legendary last", () => {
    expect(BUBBLE_TONE_DRAW_ORDER).toEqual(["neutral", "rare", "epic", "legendary"]);
  });
});

/** A small helper point-maker for the hit-test/tooltip-anchor tests below. */
function makePoint(overrides: Partial<BubblePoint> & Pick<BubblePoint, "teamNumber">): BubblePoint {
  return {
    teamKey: `frc${overrides.teamNumber}`,
    teamNumber: overrides.teamNumber,
    nickname: `Team ${overrides.teamNumber}`,
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    tone: overrides.tone ?? "neutral",
  };
}

/** mulberry32 — a tiny, seeded, deterministic PRNG. No dependency; about six lines. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Reference "nearest within radius, ties to lowest team number" search,
 * implemented as a naive full linear scan. Reads coordinates OFF THE INDEX
 * (not off the source points), so a mismatch between this and
 * `hitTestNearest` isolates the search algorithm from the projection step.
 */
function naiveNearest(index: ReturnType<typeof buildHitIndex>, px: number, py: number): number | null {
  const radius = BUBBLE_CHART.hitRadius;
  const radiusSq = radius * radius;
  let best: number | null = null;
  let bestDistSq = Infinity;
  for (let i = 0; i < index.cx.length; i++) {
    const dx = index.cx[i]! - px;
    const dy = index.cy[i]! - py;
    const distSq = dx * dx + dy * dy;
    if (distSq > radiusSq) continue;
    if (distSq < bestDistSq || (distSq === bestDistSq && best !== null && index.teamNumbers[i]! < index.teamNumbers[best]!)) {
      best = i;
      bestDistSq = distSq;
    }
  }
  return best;
}

describe("buildHitIndex / hitTestNearest", () => {
  const axis = niceAxis(0, 100, 6);
  const plot = plotRectFor(BUBBLE_CHART.fallbackWidth);

  it("returns the index of the nearest point when the pointer is inside its hit radius", () => {
    const points = [makePoint({ teamNumber: 1, x: 50, y: 50 })];
    const index = buildHitIndex(points, axis, axis, plot);
    const px = projectX(50, axis, plot);
    const py = projectY(50, axis, plot);
    const result = hitTestNearest(index, px + 3, py - 3);
    expect(result).toBe(0);
  });

  it("returns null when the pointer is further than the hit radius from every point", () => {
    const points = [makePoint({ teamNumber: 1, x: 50, y: 50 })];
    const index = buildHitIndex(points, axis, axis, plot);
    const px = projectX(50, axis, plot);
    const py = projectY(50, axis, plot);
    const result = hitTestNearest(index, px + BUBBLE_CHART.hitRadius * 5, py);
    expect(result).toBeNull();
  });

  it("two points projected to the SAME pixel resolve to the one with the lower team number, on every call, regardless of model order", () => {
    const points = [makePoint({ teamNumber: 9, x: 50, y: 50 }), makePoint({ teamNumber: 3, x: 50, y: 50 })];
    const reversed = [points[1]!, points[0]!];
    const indexA = buildHitIndex(points, axis, axis, plot);
    const indexB = buildHitIndex(reversed, axis, axis, plot);
    const px = projectX(50, axis, plot);
    const py = projectY(50, axis, plot);

    const resultA = hitTestNearest(indexA, px, py);
    const resultB = hitTestNearest(indexB, px, py);
    expect(indexA.teamNumbers[resultA!]).toBe(3);
    expect(indexB.teamNumbers[resultB!]).toBe(3);
  });

  it("two points at equal distance either side of the pointer resolve to the lower team number", () => {
    // x values close enough together that their midpoint is within hitRadius of both projected points.
    const points = [makePoint({ teamNumber: 7, x: 49, y: 50 }), makePoint({ teamNumber: 2, x: 51, y: 50 })];
    const index = buildHitIndex(points, axis, axis, plot);
    const pxLeft = projectX(49, axis, plot);
    const pxRight = projectX(51, axis, plot);
    const py = projectY(50, axis, plot);
    const midX = (pxLeft + pxRight) / 2;
    const result = hitTestNearest(index, midX, py);
    expect(result).not.toBeNull();
    expect(index.teamNumbers[result!]).toBe(2);
  });

  it("matches a naive full scan for 'nearest within radius, ties to lowest team number' across a few hundred pseudo-random points and pointer positions", () => {
    const rand = mulberry32(1234567);
    const points: BubblePoint[] = Array.from({ length: 300 }, (_, i) =>
      makePoint({ teamNumber: i + 1, x: rand() * 100, y: rand() * 100 }),
    );
    const index = buildHitIndex(points, axis, axis, plot);

    for (let trial = 0; trial < 300; trial++) {
      // Some pointer positions land inside the plot rect, some well outside every margin.
      const px = (rand() - 0.25) * (plot.width * 1.5);
      const py = (rand() - 0.25) * (plot.height * 1.5);
      const expected = naiveNearest(index, px, py);
      const actual = hitTestNearest(index, px, py);
      expect(actual).toBe(expected);
    }
  });

  it("a pointer well outside the plot rect but within the hit radius of an edge point still resolves to that point", () => {
    const points = [makePoint({ teamNumber: 1, x: 0, y: 0 })]; // domain minimum -> plot's left/bottom edge
    const index = buildHitIndex(points, axis, axis, plot);
    const edgeX = projectX(0, axis, plot);
    const edgeY = projectY(0, axis, plot);
    // Just outside the plot rect (below the bottom edge, i.e. larger y) but within hitRadius of the point.
    const result = hitTestNearest(index, edgeX, edgeY + BUBBLE_CHART.hitRadius - 1);
    expect(result).toBe(0);
  });

  it("on an empty point list, hitTestNearest returns null for any pointer", () => {
    const index = buildHitIndex([], axis, axis, plot);
    expect(hitTestNearest(index, 0, 0)).toBeNull();
    expect(hitTestNearest(index, plot.left + plot.width / 2, plot.top + plot.height / 2)).toBeNull();
  });

  it("on a collapsed plot rect (zero width or height), buildHitIndex does not throw and does not produce a zero-column or zero-row grid", () => {
    const collapsedWidth = { left: 0, top: 0, width: 0, height: 100 };
    const collapsedHeight = { left: 0, top: 0, width: 100, height: 0 };
    const points = [makePoint({ teamNumber: 1, x: 50, y: 50 })];
    expect(() => buildHitIndex(points, axis, axis, collapsedWidth)).not.toThrow();
    expect(() => buildHitIndex(points, axis, axis, collapsedHeight)).not.toThrow();
    const indexA = buildHitIndex(points, axis, axis, collapsedWidth);
    const indexB = buildHitIndex(points, axis, axis, collapsedHeight);
    expect(indexA.cols).toBeGreaterThan(0);
    expect(indexA.rows).toBeGreaterThan(0);
    expect(indexB.cols).toBeGreaterThan(0);
    expect(indexB.rows).toBeGreaterThan(0);
  });

  it("the index's projected coordinates are byte-identical to the coordinates tonePathData writes for the same point", () => {
    const points = [makePoint({ teamNumber: 1, x: 12.34, y: 56.78 }), makePoint({ teamNumber: 2, x: 90, y: 3 })];
    const index = buildHitIndex(points, axis, axis, plot);
    const d = tonePathData(points, axis, axis, plot);
    const matches = Array.from(d.matchAll(/M([\d.-]+),([\d.-]+)/g));
    expect(matches).toHaveLength(points.length);
    matches.forEach((match, i) => {
      expect(index.cx[i]).toBe(Number(match[1]));
      expect(index.cy[i]).toBe(Number(match[2]));
    });
  });
});

describe("tooltipAnchorFor", () => {
  const plot = plotRectFor(BUBBLE_CHART.fallbackWidth);

  it("places the tooltip down-and-right of the point by default", () => {
    const cx = plot.left + 50;
    const cy = plot.top + 50;
    const anchor = tooltipAnchorFor(cx, cy, plot);
    expect(anchor.left).toBe(cx + BUBBLE_CHART.tooltipOffset);
    expect(anchor.top).toBe(cy + BUBBLE_CHART.tooltipOffset);
  });

  it("flips left when the default placement would overflow the plot rect's right edge, and up when it would overflow the bottom edge", () => {
    const cx = plot.left + plot.width - 5; // near right edge
    const cy = plot.top + plot.height - 5; // near bottom edge
    const anchor = tooltipAnchorFor(cx, cy, plot);
    expect(anchor.left).toBe(cx - BUBBLE_CHART.tooltipOffset - BUBBLE_CHART.tooltipWidth);
    expect(anchor.top).toBe(cy - BUBBLE_CHART.tooltipOffset - BUBBLE_CHART.tooltipHeight);
  });

  it("clamps to a non-negative left and top, so a flip near the top-left corner never positions the card off the container", () => {
    const nearOriginPlot = { left: 0, top: 0, width: 30, height: 30 };
    const anchor = tooltipAnchorFor(28, 28, nearOriginPlot);
    expect(anchor.left).toBeGreaterThanOrEqual(0);
    expect(anchor.top).toBeGreaterThanOrEqual(0);
  });
});
