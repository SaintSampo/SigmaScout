import { describe, expect, it } from "vitest";
import { componentMapForSeason } from "../../../../packages/core/algorithms/breakdown/index.js";
import {
  componentsForGroup,
  groupableComponentsForSeason,
  groupedMetric,
  groupingForSeason,
  METRIC_GROUPS,
  UNGROUPED_COMPONENTS,
} from "./metricGroups.js";

const SEASONS = [2022, 2023, 2024, 2025, 2026];

describe("metric grouping covers every season's components exactly once", () => {
  for (const season of SEASONS) {
    it(`${season}: every component is grouped exactly once, or explicitly ungrouped`, () => {
      const declared = componentMapForSeason(season).components;
      const assigned = METRIC_GROUPS.flatMap((g) => componentsForGroup(season, g.id));

      expect(new Set(assigned).size, "a component may not appear in two groups").toBe(assigned.length);

      // Catches typos and keys carried over from another year.
      for (const key of assigned) {
        expect(declared, `${key} is not a ${season} component`).toContain(key);
      }

      // Nothing may be silently dropped: a component is grouped, or it is on
      // the explicit exclusion list. This is what forces a new season's
      // grouping to be decided rather than defaulted.
      const accounted = new Set([...assigned, ...UNGROUPED_COMPONENTS]);
      for (const key of declared) {
        expect(accounted.has(key), `${season} component "${key}" is neither grouped nor explicitly ungrouped`).toBe(true);
      }
    });
  }

  it("registers a grouping for every season the corpus declares", () => {
    for (const season of SEASONS) {
      expect(groupingForSeason(season), `${season} has no grouping`).toBeDefined();
    }
  });

  it("never displays adjust or foulsCommitted", () => {
    for (const season of SEASONS) {
      const assigned = METRIC_GROUPS.flatMap((g) => componentsForGroup(season, g.id));
      expect(assigned).not.toContain("adjust");
      expect(assigned).not.toContain("foulsCommitted");
      expect(groupableComponentsForSeason(season)).not.toContain("adjust");
    }
  });
});

describe("groupedMetric", () => {
  it("sums component values exactly", () => {
    const m = groupedMetric(2024, "auto", {
      autoLeave: { value: 2.04 },
      autoAmpNote: { value: 0.01 },
      autoSpeakerNote: { value: 14.37 },
    });
    expect(m?.value).toBeCloseTo(16.42, 5);
  });

  it("never invents a spread or a percentile — neither is derivable from published per-component data", () => {
    const m = groupedMetric(2024, "auto", {
      autoLeave: { value: 2 },
      autoAmpNote: { value: 1 },
      autoSpeakerNote: { value: 3 },
    });
    expect(m?.spread).toBeUndefined();
    expect(m?.percentile).toBeUndefined();
  });

  it("ignores absent components rather than treating them as present zeroes", () => {
    expect(groupedMetric(2024, "auto", { autoLeave: { value: 5 } })?.value).toBe(5);
    expect(groupedMetric(2024, "auto", {})).toBeUndefined();
  });

  it("returns undefined for an unregistered season", () => {
    expect(groupedMetric(1999, "auto", { anything: { value: 1 } })).toBeUndefined();
  });
});
