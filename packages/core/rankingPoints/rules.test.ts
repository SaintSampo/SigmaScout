/**
 * Pure unit tests for the RP leaf module and dispatch table (D-09, D-12) —
 * no corpus access, no `parse()` calls (the five season modules are Task 1
 * stubs whose `parse` throws; Task 2 fills in the real implementation and
 * `reconciliation.test.ts` exercises it corpus-wide).
 */
import { describe, expect, it } from "vitest";
import { eventTierFor } from "./constants.js";
import { RP_REGISTERED_SEASONS, RP_RULE_MODULES, resolveRpThreshold, rpRuleModuleForSeason, type BonusPredicate } from "./rules.js";

/**
 * Walks every `BonusPredicate` kind and collects the threshold-variable
 * names it reads — `variable`, `terms[].variable`, `clauses[].terms[].variable`,
 * `indicators[].terms[].variable`, and the `dataDependentMixture`'s three
 * clauses. Test-only (09-02 Task 3): used by the "every referenced variable
 * is declared" case below, not by the evaluator itself.
 */
function referencedVariableNames(predicate: BonusPredicate): string[] {
  switch (predicate.kind) {
    case "singleThreshold":
    case "nestedSameVariable":
      return [predicate.variable];
    case "linearCombination":
      return predicate.terms.map((t) => t.variable);
    case "conjunctionDistinct":
      return predicate.clauses.flatMap((c) => c.terms.map((t) => t.variable));
    case "countOfIndicators":
      return predicate.indicators.flatMap((c) => c.terms.map((t) => t.variable));
    case "dataDependentMixture":
      return [
        ...predicate.selector.terms.map((t) => t.variable),
        ...predicate.whenSelectorTrue.terms.map((t) => t.variable),
        ...predicate.whenSelectorFalse.terms.map((t) => t.variable),
      ];
    case "constant":
      return [];
  }
}

describe("rpRuleModuleForSeason", () => {
  it("throws for an unregistered season, naming every registered season (2021 stays absent — no standard season was played)", () => {
    expect(() => rpRuleModuleForSeason(2021)).toThrow(/2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026/);
  });

  it("returns the registered module for every season 2016-2020, 2022-2026", () => {
    for (const season of [2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026] as const) {
      expect(rpRuleModuleForSeason(season).season).toBe(season);
    }
  });
});

describe("RP_REGISTERED_SEASONS", () => {
  it("is the sorted tuple 2016-2020, 2022-2026 (2021 absent — no standard season was played)", () => {
    expect(RP_REGISTERED_SEASONS).toEqual([2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026]);
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

  // --- 09-02 Task 3: structural assertions over the declarative contract ---

  it("bonusNames is DERIVED from bonusPredicates (Pitfall 2) — one list, never two that can drift", () => {
    expect(module.bonusNames).toEqual(module.bonusPredicates.map((p) => p.name));
  });

  it("every threshold variable's marginalFamily is a member of the MarginalFamily union (per-season smoke check; the cross-season PINNED list lives in its own describe block below, 09-05 Task 3)", () => {
    for (const v of module.thresholdVariables) {
      expect(["gaussian", "negative-binomial"]).toContain(v.marginalFamily);
    }
  });

  it("every threshold variable referenced by a bonusPredicate is declared in thresholdVariables (a typo'd name would otherwise read as 0 forever and silently suppress a bonus)", () => {
    const declared = new Set(module.thresholdVariables.map((v) => v.name));
    const referenced = new Set(module.bonusPredicates.flatMap((p) => referencedVariableNames(p)));
    for (const name of referenced) {
      expect(declared.has(name)).toBe(true);
    }
  });

  it("nestedSameVariable groups are consistently ordered at every tier (D-07: supercharged implies energized at base, districtChampionship AND championship)", () => {
    const nested = module.bonusPredicates.filter((p): p is Extract<BonusPredicate, { kind: "nestedSameVariable" }> => p.kind === "nestedSameVariable");
    for (const predicate of nested) {
      for (const siblingName of predicate.nestedWith) {
        const sibling = nested.find((p) => p.name === siblingName);
        expect(sibling).toBeDefined();
        expect(sibling!.variable).toBe(predicate.variable);
        expect(sibling!.nestedWith).toContain(predicate.name);
      }
    }
    if (nested.length > 0) {
      const byVariable = new Map<string, typeof nested>();
      for (const p of nested) {
        const group = byVariable.get(p.variable) ?? [];
        group.push(p);
        byVariable.set(p.variable, group);
      }
      for (const group of byVariable.values()) {
        const sorted = [...group].sort(
          (a, b) => resolveRpThreshold(a.threshold, "base") - resolveRpThreshold(b.threshold, "base")
        );
        for (const tier of ["districtChampionship", "championship"] as const) {
          for (let i = 1; i < sorted.length; i++) {
            expect(resolveRpThreshold(sorted[i]!.threshold, tier)).toBeGreaterThanOrEqual(
              resolveRpThreshold(sorted[i - 1]!.threshold, tier)
            );
          }
        }
      }
    }
  });

  it("countOfIndicators.required never exceeds indicators.length, and is at least 1, at every tier", () => {
    const countPredicates = module.bonusPredicates.filter((p): p is Extract<BonusPredicate, { kind: "countOfIndicators" }> => p.kind === "countOfIndicators");
    for (const predicate of countPredicates) {
      for (const tier of ["base", "districtChampionship", "championship"] as const) {
        const required = resolveRpThreshold(predicate.required, tier);
        expect(required).toBeGreaterThanOrEqual(1);
        expect(required).toBeLessThanOrEqual(predicate.indicators.length);
      }
    }
  });

  it("bonus names are unique within the season, and none is the empty string", () => {
    expect(new Set(module.bonusNames).size).toBe(module.bonusNames.length);
    for (const name of module.bonusNames) {
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it("predictThresholds throws for an unmapped TBA event_type (99, offseason) before any comparison", () => {
    const zeroed: Record<string, number> = {};
    for (const v of module.thresholdVariables) zeroed[v.name] = 0;
    expect(() => module.predictThresholds(zeroed, 99)).toThrow(/unmapped TBA event_type 99/);
  });
});

/**
 * 09-05 Task 3 (D-01): the exact sorted `season:variableName` list per
 * declared family, pinned as a literal array — a new season, a renamed
 * variable or a silently flipped family fails this test with a readable
 * diff, which is the point: family choice is data entry and a new one must
 * be deliberate. As of this plan all 34 declarations name
 * `"gaussian"`. They briefly all named `"negative-binomial"`; that family was
 * measured against the unchanged Gaussian model on 2026-09-11 and REFUSED by
 * the pre-committed per-bonus bar (three cells improved, three regressed, and
 * the bar admits no regression), so every declaration was returned and the
 * family's fit was deleted. See `docs/models/rp-attribution.md`.
 *
 * The list below is the single source of truth this test checks against, kept
 * in the SAME order `RP_REGISTERED_SEASONS` iterates (ascending season,
 * declaration order within each season's own `THRESHOLD_VARIABLES` array). It
 * stays an exact sorted list rather than a count: a count would pass while a
 * variable was renamed or silently moved between seasons.
 */
describe("marginalFamily declarations — the exact pinned per-family list", () => {
  const GAUSSIAN_DECLARATIONS = [
    "2016:position1crossings",
    "2016:position2crossings",
    "2016:position3crossings",
    "2016:position4crossings",
    "2016:position5crossings",
    "2016:attackedTowerEndStrength",
    "2016:teleopChallengePoints",
    "2016:teleopScalePoints",
    "2017:autoFuelPoints",
    "2017:teleopFuelPoints",
    "2017:autoRotorPoints",
    "2017:teleopRotorPoints",
    "2018:autoRunPoints",
    "2018:autoSwitchOwnershipSec",
    "2018:endgamePoints",
    "2019:habClimbPoints",
    "2020:endgamePoints",
    "2022:matchCargoTotal",
    "2022:autoCargoTotal",
    "2022:endgamePoints",
    "2023:totalChargeStationPoints",
    "2023:linkPoints",
    "2024:noteCount",
    "2024:endGameTotalStagePoints",
    "2024:onStageRobotCount",
    "2025:trough",
    "2025:botRow",
    "2025:midRow",
    "2025:topRow",
    "2025:endGameBargePoints",
    "2025:autoLineCount",
    "2025:autoCoralCount",
    "2026:hubTotalCount",
    "2026:totalTowerPoints",
  ] as const;

  it("pins the exact set: 34 total declarations, every one \"gaussian\", none undefined", () => {
    const byFamily: Record<string, string[]> = { gaussian: [] };
    let total = 0;
    for (const season of RP_REGISTERED_SEASONS) {
      const module = RP_RULE_MODULES[season]!;
      for (const variable of module.thresholdVariables) {
        expect(
          variable.marginalFamily,
          `season ${season} variable "${variable.name}" has an unexpected marginalFamily "${String(variable.marginalFamily)}"`
        ).toBeDefined();
        const key = `${season}:${variable.name}`;
        (byFamily[variable.marginalFamily] ??= []).push(key);
        total += 1;
      }
    }
    expect(total).toBe(34);
    expect([...byFamily["gaussian"]!].sort()).toEqual([...GAUSSIAN_DECLARATIONS].sort());
  });
});

describe("bonusNames order is pinned per season (positional contract into published artifacts — an iterated loop would silently skip a newly-registered season; these are ten explicit equalities on purpose)", () => {
  it("2016: [breach, capture]", () => {
    expect(rpRuleModuleForSeason(2016).bonusNames).toEqual(["breach", "capture"]);
  });
  it("2017: [kPa, rotor]", () => {
    expect(rpRuleModuleForSeason(2017).bonusNames).toEqual(["kPa", "rotor"]);
  });
  it("2018: [autoQuest, faceTheBoss]", () => {
    expect(rpRuleModuleForSeason(2018).bonusNames).toEqual(["autoQuest", "faceTheBoss"]);
  });
  it("2019: [habDocking, completeRocket]", () => {
    expect(rpRuleModuleForSeason(2019).bonusNames).toEqual(["habDocking", "completeRocket"]);
  });
  it("2020: [shieldOperational]", () => {
    expect(rpRuleModuleForSeason(2020).bonusNames).toEqual(["shieldOperational"]);
  });
  it("2022: [cargoBonus, hangarBonus]", () => {
    expect(rpRuleModuleForSeason(2022).bonusNames).toEqual(["cargoBonus", "hangarBonus"]);
  });
  it("2023: [activationBonus, sustainabilityBonus]", () => {
    expect(rpRuleModuleForSeason(2023).bonusNames).toEqual(["activationBonus", "sustainabilityBonus"]);
  });
  it("2024: [melodyBonus, ensembleBonus]", () => {
    expect(rpRuleModuleForSeason(2024).bonusNames).toEqual(["melodyBonus", "ensembleBonus"]);
  });
  it("2025: [autoBonus, coralBonus, bargeBonus]", () => {
    expect(rpRuleModuleForSeason(2025).bonusNames).toEqual(["autoBonus", "coralBonus", "bargeBonus"]);
  });
  it("2026: [energized, supercharged, traversal]", () => {
    expect(rpRuleModuleForSeason(2026).bonusNames).toEqual(["energized", "supercharged", "traversal"]);
  });
});

describe("total bonus count across every registered season is 21 (moves if any season gains or loses a bonus for any reason)", () => {
  it("sums to 21", () => {
    const total = RP_REGISTERED_SEASONS.reduce((sum, season) => sum + RP_RULE_MODULES[season]!.bonusNames.length, 0);
    expect(total).toBe(21);
  });
});

describe("winRp per season (Pitfall 2)", () => {
  it("is 2 for 2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024", () => {
    expect(rpRuleModuleForSeason(2016).winRp).toBe(2);
    expect(rpRuleModuleForSeason(2017).winRp).toBe(2);
    expect(rpRuleModuleForSeason(2018).winRp).toBe(2);
    expect(rpRuleModuleForSeason(2019).winRp).toBe(2);
    expect(rpRuleModuleForSeason(2020).winRp).toBe(2);
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
  it("2018: both bonuses computable via the numeric fallback (D-4) — clears both at threshold, clears neither at zero", () => {
    const module = rpRuleModuleForSeason(2018);
    const cleared = module.predictThresholds({ autoRunPoints: 15, autoSwitchOwnershipSec: 1, endgamePoints: 90 }, 0);
    expect(cleared.bonusFlags.autoQuest).toBe(true);
    expect(cleared.bonusFlags.faceTheBoss).toBe(true);
    expect(cleared.totalRp).toBe(2);

    const zero = module.predictThresholds({ autoRunPoints: 0, autoSwitchOwnershipSec: 0, endgamePoints: 0 }, 0);
    expect(zero.bonusFlags.autoQuest).toBe(false);
    expect(zero.bonusFlags.faceTheBoss).toBe(false);
    expect(zero.totalRp).toBe(0);
  });

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

  // CORRECTED 2026-09-11 (plan 09-06; routed here by 09-02). This case was
  // titled "2025: autoBonus is always false (no threshold-variable-only
  // fallback exists)" and passed only because it supplied NEITHER auto
  // variable, so both defaulted to 0 and the conjunction came out false for a
  // reason that had nothing to do with the claim in its own title. The
  // 2026-09-09 tracking fix added `autoLineCount` and `autoCoralCount`
  // precisely so `autoBonus` COULD be predicted, so the old title asserted the
  // opposite of what the module now does. Both directions are now supplied and
  // asserted.
  it("2025: autoBonus IS computable from its two tracked auto variables — true when both thresholds are met", () => {
    const module = rpRuleModuleForSeason(2025);
    const result = module.predictThresholds(
      { trough: 10, botRow: 10, midRow: 10, topRow: 10, endGameBargePoints: 20, autoLineCount: 3, autoCoralCount: 1 },
      0
    );
    expect(result.bonusFlags.autoBonus).toBe(true);
    expect(result.bonusFlags.bargeBonus).toBe(true);
    expect(result.bonusFlags.coralBonus).toBe(true);
  });

  it("2025: autoBonus is false when EITHER auto threshold is missed — a conjunction over two distinct tracked counts, not a constant", () => {
    const module = rpRuleModuleForSeason(2025);
    const base = { trough: 10, botRow: 10, midRow: 10, topRow: 10, endGameBargePoints: 20 };
    // Two of three robots crossed the auto line; the coral requirement is met.
    expect(module.predictThresholds({ ...base, autoLineCount: 2, autoCoralCount: 1 }, 0).bonusFlags.autoBonus).toBe(false);
    // All three crossed, but no auto coral was scored.
    expect(module.predictThresholds({ ...base, autoLineCount: 3, autoCoralCount: 0 }, 0).bonusFlags.autoBonus).toBe(false);
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
