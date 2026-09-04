/**
 * Decision T1 (2026-09-01 redesign): the grouped-by-default Teams table.
 * Pins the view-to-column-set derivation and the friendly-label rule so a
 * future season/algorithm change cannot silently regress either.
 */
import { describe, expect, it } from "vitest";
import { displayedMetricKeys, sortableColumnIds } from "./columns";
import { metricDisplayLabel } from "@/lib/metricLabels";
import { GROUP_METRIC_KEYS, metricKeysFor, TOTAL_KEY } from "@/lib/metricKeys";

describe("displayedMetricKeys (decision T1, D-5 Total-leads order per 260904-5zg)", () => {
  it("VPR grouped view shows exactly Total then Auto/Teleop/Endgame", () => {
    expect(displayedMetricKeys("vpr", 2026, "grouped")).toEqual([TOTAL_KEY, ...GROUP_METRIC_KEYS]);
  });

  it("VPR components view shows the full declared component set", () => {
    expect(displayedMetricKeys("vpr", 2026, "components")).toEqual(metricKeysFor("vpr", 2026));
  });

  it("EPA now has a real grouped view too (D-2, 260904-5zg): Total then Auto/Teleop/Endgame, derived from published components", () => {
    expect(displayedMetricKeys("epa", 2026, "grouped")).toEqual([TOTAL_KEY, ...GROUP_METRIC_KEYS]);
  });

  it("EPA components view is unchanged — the full declared component set, Total leading (D-5)", () => {
    expect(displayedMetricKeys("epa", 2026, "components")).toEqual(metricKeysFor("epa", 2026));
  });

  it("OPR stays Total-only on both views", () => {
    expect(displayedMetricKeys("opr", 2026, "grouped")).toEqual([TOTAL_KEY]);
    expect(displayedMetricKeys("opr", 2026, "components")).toEqual([TOTAL_KEY]);
  });

  it("sortable ids track the DISPLAYED view, so a grouped sort key is never offered while components are shown", () => {
    expect(sortableColumnIds("vpr", 2026, "grouped")).toContain("phaseAuto");
    expect(sortableColumnIds("vpr", 2026, "components")).not.toContain("phaseAuto");
  });

  it("EPA's grouped sortable ids also contain phaseAuto now that EPA has a grouped view", () => {
    expect(sortableColumnIds("epa", 2026, "grouped")).toContain("phaseAuto");
  });
});

describe("metricDisplayLabel", () => {
  it("group keys wear the team page's own phase labels", () => {
    expect(metricDisplayLabel("phaseAuto")).toBe("Auto");
    expect(metricDisplayLabel("phaseTeleop")).toBe("Teleop");
    expect(metricDisplayLabel("phaseEndgame")).toBe("Endgame");
  });

  it("raw component keys become spaced Title Case, never shown verbatim", () => {
    expect(metricDisplayLabel("hubShift2")).toBe("Hub Shift 2");
    expect(metricDisplayLabel("foulsCommitted")).toBe("Fouls Committed");
    expect(metricDisplayLabel("autoTower")).toBe("Auto Tower");
  });

  it("the guaranteed key is Total", () => {
    expect(metricDisplayLabel(TOTAL_KEY)).toBe("Total");
  });
});
