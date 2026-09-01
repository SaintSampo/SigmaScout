/**
 * Decision T1 (2026-09-01 redesign): the grouped-by-default Teams table.
 * Pins the view-to-column-set derivation and the friendly-label rule so a
 * future season/algorithm change cannot silently regress either.
 */
import { describe, expect, it } from "vitest";
import { displayedMetricKeys, sortableColumnIds } from "./columns";
import { metricDisplayLabel } from "@/lib/metricLabels";
import { GROUP_METRIC_KEYS, metricKeysFor, TOTAL_KEY } from "@/lib/metricKeys";

describe("displayedMetricKeys (decision T1)", () => {
  it("VPR grouped view shows exactly Auto/Teleop/Endgame then Total", () => {
    expect(displayedMetricKeys("vpr", 2026, "grouped")).toEqual([...GROUP_METRIC_KEYS, TOTAL_KEY]);
  });

  it("VPR components view shows the full declared component set", () => {
    expect(displayedMetricKeys("vpr", 2026, "components")).toEqual(metricKeysFor("vpr", 2026));
  });

  it("EPA has no phase metrics in its teams artifact, so BOTH views resolve to components", () => {
    expect(displayedMetricKeys("epa", 2026, "grouped")).toEqual(metricKeysFor("epa", 2026));
  });

  it("OPR stays Total-only on both views", () => {
    expect(displayedMetricKeys("opr", 2026, "grouped")).toEqual([TOTAL_KEY]);
    expect(displayedMetricKeys("opr", 2026, "components")).toEqual([TOTAL_KEY]);
  });

  it("sortable ids track the DISPLAYED view, so a grouped sort key is never offered while components are shown", () => {
    expect(sortableColumnIds("vpr", 2026, "grouped")).toContain("phaseAuto");
    expect(sortableColumnIds("vpr", 2026, "components")).not.toContain("phaseAuto");
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
