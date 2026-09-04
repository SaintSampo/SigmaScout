import { describe, expect, it } from "vitest";
import { hasGroupedTeamsView, metricKeysFor, publishesGroupMetrics, teamsSortKeyUniverse, TOTAL_KEY } from "./metricKeys.js";
import { CURRENT_SEASON, FIRST_SEASON, SEASONS } from "./seasons.js";
import { componentMapForSeason } from "../../../../packages/core/algorithms/breakdown/index.js";

describe("metricKeysFor", () => {
  it("OPR returns exactly one key, the total key", () => {
    expect(metricKeysFor("opr", 2024)).toEqual([TOTAL_KEY]);
  });

  it("EPA and VPR return identical arrays for the same season, since both derive from the same season component map", () => {
    expect(metricKeysFor("epa", 2022)).toEqual(metricKeysFor("vpr", 2022));
  });

  it("EPA 2026 returns strictly more keys than EPA 2022, matching the researched 2026-versus-2022 component counts", () => {
    const keys2022 = metricKeysFor("epa", 2022);
    const keys2026 = metricKeysFor("epa", 2026);
    expect(keys2026.length).toBeGreaterThan(keys2022.length);
  });

  it("every returned array LEADS with the total key (D-5) and contains it exactly once", () => {
    for (const [algorithmId, season] of [
      ["opr", 2024],
      ["epa", 2022],
      ["epa", 2026],
      ["vpr", 2024],
    ] as const) {
      const keys = metricKeysFor(algorithmId, season);
      expect(keys[0]).toBe(TOTAL_KEY);
      expect(keys.filter((key) => key === TOTAL_KEY)).toHaveLength(1);
    }
  });

  it("surfaces the underlying named error for a season with no registered component map, rather than returning an empty array", () => {
    expect(() => metricKeysFor("epa", 2021)).toThrow();
    expect(() => metricKeysFor("epa", 2021)).toThrow(/no component map registered/);
  });
});

describe("publishesGroupMetrics / hasGroupedTeamsView (D-2, 260904-5zg)", () => {
  it("publishesGroupMetrics is true for vpr only", () => {
    expect(publishesGroupMetrics("vpr")).toBe(true);
    expect(publishesGroupMetrics("epa")).toBe(false);
    expect(publishesGroupMetrics("opr")).toBe(false);
  });

  it("hasGroupedTeamsView is true for vpr AND epa, false for opr", () => {
    expect(hasGroupedTeamsView("vpr")).toBe(true);
    expect(hasGroupedTeamsView("epa")).toBe(true);
    expect(hasGroupedTeamsView("opr")).toBe(false);
  });

  it("teamsSortKeyUniverse('epa', 2026) contains phaseAuto now that EPA has a grouped view", () => {
    expect(teamsSortKeyUniverse("epa", 2026)).toContain("phaseAuto");
  });
});

describe("SEASONS", () => {
  it("is in descending order, starts at the current season, and ends at the first season", () => {
    expect(SEASONS[0]).toBe(CURRENT_SEASON);
    expect(SEASONS.at(-1)).toBe(FIRST_SEASON);
    const pairs = SEASONS.slice(1).map((season, index) => [SEASONS[index], season] as const);
    for (const [prev, curr] of pairs) {
      expect(curr).toBe((prev as number) - 1);
    }
  });

  it("every element has a registered component map — the year dropdown and the algorithms' own season registry cannot silently disagree", () => {
    for (const season of SEASONS) {
      expect(() => componentMapForSeason(season)).not.toThrow();
    }
  });
});
