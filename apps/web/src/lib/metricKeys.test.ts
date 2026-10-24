import { describe, expect, it } from "vitest";
import { hasGroupedTeamsView, metricKeysFor, teamsSortKeyUniverse, TOTAL_KEY } from "./metricKeys.js";
import { CURRENT_SEASON, DEFAULT_SEASON, EXCLUDED_SEASONS, FIRST_SEASON, SEASONS } from "./seasons.js";
import { componentMapForSeason } from "../../../../packages/core/algorithms/breakdown/index.js";
import { NEWEST_GAME_SEASON } from "../../../../packages/harness/rosterOnlySeason.js";
import { isRosterOnlySeason } from "./seasonGame.js";

describe("metricKeysFor", () => {
  it("OPR returns exactly one key, the total key", () => {
    expect(metricKeysFor("opr", 2024)).toEqual([TOTAL_KEY]);
  });

  it("EPA and VPR return identical arrays for the same season, since both derive from the same season component map", () => {
    expect(metricKeysFor("epa", 2022)).toEqual(metricKeysFor("spr", 2022));
  });

  it("EPA 2026 returns strictly more keys than EPA 2022, matching the researched 2026-versus-2022 component counts", () => {
    const keys2022 = metricKeysFor("epa", 2022);
    const keys2026 = metricKeysFor("epa", 2026);
    expect(keys2026.length).toBeGreaterThan(keys2022.length);
  });

  it("every returned array LEADS with the total key and contains it exactly once", () => {
    for (const [algorithmId, season] of [
      ["opr", 2024],
      ["epa", 2022],
      ["epa", 2026],
      ["spr", 2024],
    ] as const) {
      const keys = metricKeysFor(algorithmId, season);
      expect(keys[0]).toBe(TOTAL_KEY);
      expect(keys.filter((key) => key === TOTAL_KEY)).toHaveLength(1);
    }
  });

  it("never returns the adjust component for any algorithm or season — it is a scorekeeper correction, not a column", () => {
    for (const algorithmId of ["opr", "epa", "spr"] as const) {
      for (const season of SEASONS) {
        expect(metricKeysFor(algorithmId, season)).not.toContain("adjust");
      }
    }
  });

  it("surfaces the underlying named error for a season with no registered component map, rather than returning an empty array", () => {
    expect(() => metricKeysFor("epa", 2021)).toThrow();
    expect(() => metricKeysFor("epa", 2021)).toThrow(/no component map registered/);
  });

  it("answers the Total key alone for a roster-only season, while componentMapForSeason still throws for it", () => {
    const rosterSeason = NEWEST_GAME_SEASON + 1;
    expect(metricKeysFor("epa", rosterSeason)).toEqual([TOTAL_KEY]);
    expect(metricKeysFor("spr", rosterSeason)).toEqual([TOTAL_KEY]);
    expect(() => componentMapForSeason(rosterSeason)).toThrow(/no component map registered/);
  });
});

describe("hasGroupedTeamsView", () => {
  it("hasGroupedTeamsView is true for vpr AND epa, false for opr", () => {
    expect(hasGroupedTeamsView("spr")).toBe(true);
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
  });

  it("every consecutive descending pair differs by exactly 1, or by more with every skipped year present in EXCLUDED_SEASONS (the gapped seven-season corpus)", () => {
    const pairs = SEASONS.slice(1).map((season, index) => [SEASONS[index], season] as const);
    for (const [prev, curr] of pairs) {
      const gap = (prev as number) - curr;
      expect(gap).toBeGreaterThanOrEqual(1);
      for (let skipped = curr + 1; skipped < (prev as number); skipped++) {
        expect(EXCLUDED_SEASONS).toContain(skipped);
      }
    }
  });

  it("contains 2019 and 2020; never contains 2021", () => {
    expect(SEASONS).toContain(2019);
    expect(SEASONS).toContain(2020);
    expect(SEASONS).not.toContain(2021);
  });

  it("every element either has a registered component map or is a roster-only season — the year dropdown and the algorithms' own season registry cannot silently disagree", () => {
    for (const season of SEASONS) {
      if (isRosterOnlySeason(season)) {
        continue;
      }
      expect(() => componentMapForSeason(season)).not.toThrow();
    }
  });

  it("DEFAULT_SEASON is listed and is never a roster-only season — the site never opens on a season without its game", () => {
    expect(SEASONS).toContain(DEFAULT_SEASON);
    expect(isRosterOnlySeason(DEFAULT_SEASON)).toBe(false);
    expect(() => componentMapForSeason(DEFAULT_SEASON)).not.toThrow();
  });

  it("every EXCLUDED_SEASONS member THROWS through componentMapForSeason — the exclusion tracks the algorithms' own registry, not an arbitrary hole. The day a 2021 component map is registered, this assertion goes red and forces the exclusion to be revisited deliberately.", () => {
    for (const season of EXCLUDED_SEASONS) {
      expect(() => componentMapForSeason(season)).toThrow();
    }
  });
});
