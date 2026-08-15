/**
 * Pure unit tests for the RP leaf module and dispatch table (D-09, D-12) —
 * no corpus access, no `parse()` calls (the five season modules are Task 1
 * stubs whose `parse` throws; Task 2 fills in the real implementation and
 * `reconciliation.test.ts` exercises it corpus-wide).
 */
import { describe, expect, it } from "vitest";
import { eventTierFor } from "./constants.js";
import { RP_REGISTERED_SEASONS, RP_RULE_MODULES, rpRuleModuleForSeason } from "./rules.js";

describe("rpRuleModuleForSeason", () => {
  it("throws for an unregistered season, naming 2022-2026", () => {
    expect(() => rpRuleModuleForSeason(2021)).toThrow(/2022, 2023, 2024, 2025, 2026/);
  });

  it("returns the registered module for every season 2022-2026", () => {
    for (const season of [2022, 2023, 2024, 2025, 2026] as const) {
      expect(rpRuleModuleForSeason(season).season).toBe(season);
    }
  });
});

describe("RP_REGISTERED_SEASONS", () => {
  it("is the sorted tuple 2022-2026", () => {
    expect(RP_REGISTERED_SEASONS).toEqual([2022, 2023, 2024, 2025, 2026]);
  });
});

describe.each(RP_REGISTERED_SEASONS)("season %i RP rule module shape", (season) => {
  const module = RP_RULE_MODULES[season]!;

  it("maxRp === winRp + bonusNames.length", () => {
    expect(module.maxRp).toBe(module.winRp + module.bonusNames.length);
  });

  it("tieRp is 1", () => {
    expect(module.tieRp).toBe(1);
  });

  it("threshold variable names are unique within the module", () => {
    const names = module.thresholdVariables.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every threshold variable's unit is 'count' or 'points'", () => {
    for (const v of module.thresholdVariables) {
      expect(["count", "points"]).toContain(v.unit);
    }
  });
});

describe("winRp per season (Pitfall 2)", () => {
  it("is 2 for 2022, 2023, 2024", () => {
    expect(rpRuleModuleForSeason(2022).winRp).toBe(2);
    expect(rpRuleModuleForSeason(2023).winRp).toBe(2);
    expect(rpRuleModuleForSeason(2024).winRp).toBe(2);
  });

  it("is 3 for 2025, 2026", () => {
    expect(rpRuleModuleForSeason(2025).winRp).toBe(3);
    expect(rpRuleModuleForSeason(2026).winRp).toBe(3);
  });
});

describe("eventTierFor", () => {
  it("maps 0, 1, 100 to base", () => {
    expect(eventTierFor(0)).toBe("base");
    expect(eventTierFor(1)).toBe("base");
    expect(eventTierFor(100)).toBe("base");
  });

  it("maps 2, 5 to districtChampionship", () => {
    expect(eventTierFor(2)).toBe("districtChampionship");
    expect(eventTierFor(5)).toBe("districtChampionship");
  });

  it("maps 3, 4 to championship", () => {
    expect(eventTierFor(3)).toBe("championship");
    expect(eventTierFor(4)).toBe("championship");
  });

  it("throws for 99 (offseason) rather than defaulting to base", () => {
    expect(() => eventTierFor(99)).toThrow();
  });

  it("throws for an unknown event_type value", () => {
    expect(() => eventTierFor(-1)).toThrow();
    expect(() => eventTierFor(6)).toThrow();
  });
});
