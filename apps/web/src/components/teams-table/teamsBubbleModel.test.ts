/**
 * Coverage for `teamsBubbleModel.ts` (Task 1, 260909-tom-PLAN.md) — the nine
 * behaviors listed in the plan's `<behavior>` block, one test each.
 */
import { describe, expect, it } from "vitest";
import { TOTAL_KEY } from "../../lib/metricKeys.js";
import type { TeamRow } from "./rowModel.js";
import { BUBBLE_CHART, BUBBLE_TONE_DRAW_ORDER, buildBubbleModel, niceAxis, plotRectFor, projectX, projectY, tonePathData } from "./teamsBubbleModel.js";

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
