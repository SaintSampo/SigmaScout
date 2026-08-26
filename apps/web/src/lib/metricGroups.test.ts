import { describe, expect, it } from "vitest";
import { COMPONENT_GROUP_METRIC_KEYS } from "../../../../packages/core/algorithms/breakdown/index.js";
import { groupMetricKey, METRIC_GROUPS } from "./metricGroups.js";

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
