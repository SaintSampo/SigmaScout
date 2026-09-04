import { describe, expect, it } from "vitest";
import { COMPONENT_GROUP_METRIC_KEYS } from "../../../../packages/core/algorithms/breakdown/index.js";
import { groupMetricKey, METRIC_GROUPS, withDerivedGroupMetrics } from "./metricGroups.js";

/**
 * The grouping itself is tested in core
 * (`packages/core/algorithms/breakdown/groups.test.ts`): season coverage,
 * no double-assignment, and no collision between a group metric key and a
 * component name. This file only checks the display adapter.
 */
describe("metricGroups display adapter", () => {
  it("exposes exactly the three phase groups, in auto/teleop/endgame order", () => {
    expect(METRIC_GROUPS.map((g) => g.id)).toEqual(["auto", "teleop", "endgame"]);
    expect(METRIC_GROUPS.map((g) => g.label)).toEqual(["Auto", "Teleop", "Endgame"]);
  });

  it("names the same published metric keys core emits — never a local copy", () => {
    for (const group of METRIC_GROUPS) {
      expect(group.metricKey).toBe(COMPONENT_GROUP_METRIC_KEYS[group.id]);
      expect(groupMetricKey(group.id)).toBe(COMPONENT_GROUP_METRIC_KEYS[group.id]);
    }
  });

  it("computes nothing — a group's value, spread and percentile all come from the artifact", () => {
    // Guards the regression this module was rewritten to remove: any local
    // summing would have to accept a `metrics` argument.
    for (const group of METRIC_GROUPS) {
      expect(Object.keys(group).sort()).toEqual(["id", "label", "metricKey"]);
    }
    expect(groupMetricKey.length).toBe(1);
  });
});

/**
 * `withDerivedGroupMetrics` (2026-09-04, quick task 260904-5zg): EPA's
 * teams artifact publishes components but not the group metrics VPR does,
 * so every surface reading `phaseAuto`/`phaseTeleop`/`phaseEndgame` renders
 * blank for EPA. This derivation fixes that with exact client-side
 * arithmetic over published component VALUES only — see this module's own
 * header comment for the full honesty argument (EPA publishes no spread
 * anywhere, so there is no spread to get wrong).
 */
describe("withDerivedGroupMetrics", () => {
  it("sums the present component values exactly — plain arithmetic, no rounding or rescaling", () => {
    const metrics = { autoTower: { value: 3 }, hubAuto: { value: 5 } };
    const result = withDerivedGroupMetrics(metrics, 2026);
    expect(result.phaseAuto).toEqual({ value: 8 });
  });

  it("a derived entry carries a value ONLY — no spread, no percentile, no tier", () => {
    const metrics = { autoTower: { value: 3 }, hubAuto: { value: 5 } };
    const result = withDerivedGroupMetrics(metrics, 2026);
    const entry = result.phaseAuto as { value: number; spread?: number; percentile?: number; tier?: string };
    expect(entry.spread).toBeUndefined();
    expect(entry.percentile).toBeUndefined();
    expect(entry.tier).toBeUndefined();
    expect(Object.keys(entry)).toEqual(["value"]);
  });

  it("a published group entry (the VPR case) survives byte-identical — derivation never overwrites publication", () => {
    const publishedPhaseAuto = { value: 42, spread: 2.1, percentile: 88, tier: "epic" as const };
    const metrics = { autoTower: { value: 3 }, hubAuto: { value: 5 }, phaseAuto: publishedPhaseAuto };
    const result = withDerivedGroupMetrics(metrics, 2026);
    expect(result.phaseAuto).toBe(publishedPhaseAuto);
  });

  it("a group whose components are all absent from the input yields NO entry — never a fabricated {value: 0}", () => {
    // Only a teleop component present — nothing in `auto`'s own component set.
    const metrics = { hubTransition: { value: 10 } };
    const result = withDerivedGroupMetrics(metrics, 2026);
    expect(result.phaseAuto).toBeUndefined();
    expect("phaseAuto" in result).toBe(false);
  });

  it("UNGROUPED_COMPONENTS (adjust, foulsCommitted) contribute to no group sum — the three groups sum to strictly less than total", () => {
    const metrics = {
      autoTower: { value: 10 },
      hubAuto: { value: 5 },
      hubTransition: { value: 8 },
      hubShift1: { value: 2 },
      hubShift2: { value: 2 },
      hubShift3: { value: 2 },
      hubShift4: { value: 2 },
      endGameTower: { value: 6 },
      hubEndgame: { value: 4 },
      adjust: { value: 1 },
      foulsCommitted: { value: 20 },
      total: { value: 62 },
    };
    const result = withDerivedGroupMetrics(metrics, 2026);
    const groupSum =
      (result.phaseAuto as { value: number }).value +
      (result.phaseTeleop as { value: number }).value +
      (result.phaseEndgame as { value: number }).value;
    expect(groupSum).toBeLessThan((result.total as { value: number }).value);
  });

  it("a season with no registered grouping returns the input unchanged rather than throwing", () => {
    const metrics = { total: { value: 10 } };
    expect(() => withDerivedGroupMetrics(metrics, 2021)).not.toThrow();
    expect(withDerivedGroupMetrics(metrics, 2021)).toBe(metrics);
  });
});
