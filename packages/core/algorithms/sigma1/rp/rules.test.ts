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
  it("throws for an unregistered season, naming every registered season (2021 stays absent — no standard season was played)", () => {
    expect(() => rpRuleModuleForSeason(2021)).toThrow(/2020, 2022, 2023, 2024, 2025, 2026/);
  });

  it("returns the registered module for every season 2020, 2022-2026", () => {
    for (const season of [2020, 2022, 2023, 2024, 2025, 2026] as const) {
      expect(rpRuleModuleForSeason(season).season).toBe(season);
    }
  });
});

describe("RP_REGISTERED_SEASONS", () => {
  it("is the sorted tuple 2020, 2022-2026 (2021 absent — no standard season was played)", () => {
    expect(RP_REGISTERED_SEASONS).toEqual([2020, 2022, 2023, 2024, 2025, 2026]);
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

describe("predictThresholds (plan 03-03) — evaluates bonuses from tracked threshold-variable values alone", () => {
  it("2022: reproduces cargoBonus/hangarBonus at a base-tier match clearing both", () => {
    const module = rpRuleModuleForSeason(2022);
    const result = module.predictThresholds({ matchCargoTotal: 25, autoCargoTotal: 2, endgamePoints: 20 }, 0);
    expect(result.bonusFlags.cargoBonus).toBe(true);
    expect(result.bonusFlags.hangarBonus).toBe(true);
    expect(result.totalRp).toBe(2);
  });

  it("2022: a clearly-below-threshold match clears neither bonus", () => {
    const module = rpRuleModuleForSeason(2022);
    const result = module.predictThresholds({ matchCargoTotal: 1, autoCargoTotal: 0, endgamePoints: 0 }, 0);
    expect(result.bonusFlags.cargoBonus).toBe(false);
    expect(result.bonusFlags.hangarBonus).toBe(false);
    expect(result.totalRp).toBe(0);
  });

  it("2023: sustainabilityBonus evaluates at the stricter non-coop threshold (conservative-gate convention)", () => {
    const module = rpRuleModuleForSeason(2023);
    // 4 links (20 linkPoints) clears the coop threshold (4) but not the non-coop threshold (5) at base tier.
    const result = module.predictThresholds({ totalChargeStationPoints: 0, linkPoints: 20 }, 0);
    expect(result.bonusFlags.sustainabilityBonus).toBe(false);
  });

  it("2024: ensembleBonus is fully computable and melodyBonus uses the non-coop threshold", () => {
    const module = rpRuleModuleForSeason(2024);
    const result = module.predictThresholds(
      { noteCount: 16, endGameTotalStagePoints: 10, onStageRobotCount: 2 },
      0
    );
    // 16 notes clears the coop threshold (15) but not the non-coop threshold (18) at base tier.
    expect(result.bonusFlags.melodyBonus).toBe(false);
    expect(result.bonusFlags.ensembleBonus).toBe(true);
  });

  it("2025: autoBonus is always false (no threshold-variable-only fallback exists), bargeBonus is fully computable", () => {
    const module = rpRuleModuleForSeason(2025);
    const result = module.predictThresholds(
      { trough: 10, botRow: 10, midRow: 10, topRow: 10, endGameBargePoints: 20 },
      0
    );
    expect(result.bonusFlags.autoBonus).toBe(false);
    expect(result.bonusFlags.bargeBonus).toBe(true);
    expect(result.bonusFlags.coralBonus).toBe(true);
  });

  it("2026: every bonus fully computable from tracked variables", () => {
    const module = rpRuleModuleForSeason(2026);
    const result = module.predictThresholds({ hubTotalCount: 150, totalTowerPoints: 60 }, 0);
    expect(result.bonusFlags.energized).toBe(true);
    expect(result.bonusFlags.supercharged).toBe(false);
    expect(result.bonusFlags.traversal).toBe(true);
    expect(result.totalRp).toBe(2);
  });

  it("every season: totalRp equals the count of true bonusFlags", () => {
    for (const season of RP_REGISTERED_SEASONS) {
      const module = RP_RULE_MODULES[season]!;
      const values: Record<string, number> = {};
      for (const v of module.thresholdVariables) values[v.name] = 0;
      const result = module.predictThresholds(values, 0);
      const trueCount = Object.values(result.bonusFlags).filter(Boolean).length;
      expect(result.totalRp).toBe(trueCount);
    }
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
