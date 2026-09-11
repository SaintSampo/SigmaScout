/**
 * The all-season structural sweep — Task 2, plan 09-04. This file asks
 * questions "the contract between the declarations and the pmf layer has
 * drifted" would answer differently from `analyticPmf.test.ts`'s per-
 * mechanism arithmetic questions: is the computed grouping exactly what the
 * code claims, do the disjointness preconditions the exactness argument
 * rests on actually hold, does no mass ever fold, is every pmf normalized,
 * and does the zero-variance limit degenerate to exactly `predictThresholds`'
 * own boolean answer.
 *
 * The grouping and disjointness checks below are DELIBERATELY a SEPARATE,
 * independent re-implementation of the footprint/connected-components logic
 * `analyticPmf.ts` uses internally — reproduced here from the same public
 * `BonusPredicate` data every season module declares, never by calling into
 * `analyticPmf.ts`'s own (unexported) grouping function. Testing a module
 * against its own internals only proves it agrees with itself; D-07 exists
 * because that is not evidence.
 *
 * `buildRuleModuleMoments`, the ONE fixture builder both this file and
 * `analyticPmf.test.ts`'s six mechanism-class tests use, lives in the
 * sibling non-test module `analyticPmfFixtures.ts` — NOT in this file.
 * Importing a `.test.ts` module re-executes its top-level `describe()`
 * calls as a side effect of module evaluation (vitest's test-file glob is
 * `packages/**\/*.test.ts`), which would silently duplicate every sweep
 * test below inside `analyticPmf.test.ts`'s run. See `analyticPmfFixtures.ts`'s
 * own header for the full reasoning.
 */
import { describe, expect, it } from "vitest";
import { analyticRpPmf } from "./analyticPmf.js";
import { buildRuleModuleMoments } from "./analyticPmfFixtures.js";
import { RP_REGISTERED_SEASONS, RP_RULE_MODULES } from "./rules.js";
import type { BonusPredicate, EventTier, RpThresholdClause } from "./constants.js";

// ---------------------------------------------------------------------------
// Independent footprint/grouping re-implementation (test-only — see header).
// ---------------------------------------------------------------------------

function footprintOfClauseIndependent(clause: RpThresholdClause): Set<string> {
  return new Set(clause.terms.map((term) => term.variable));
}

function footprintOfIndependent(predicate: BonusPredicate): Set<string> {
  switch (predicate.kind) {
    case "singleThreshold":
    case "nestedSameVariable":
      return new Set([predicate.variable]);
    case "linearCombination":
      return new Set(predicate.terms.map((term) => term.variable));
    case "conjunctionDistinct":
      return new Set(predicate.clauses.flatMap((clause) => [...footprintOfClauseIndependent(clause)]));
    case "countOfIndicators":
      return new Set(predicate.indicators.flatMap((clause) => [...footprintOfClauseIndependent(clause)]));
    case "dataDependentMixture":
      return new Set([
        ...footprintOfClauseIndependent(predicate.selector),
        ...footprintOfClauseIndependent(predicate.whenSelectorTrue),
        ...footprintOfClauseIndependent(predicate.whenSelectorFalse),
      ]);
    case "constant":
      return new Set();
  }
}

function setsIntersect(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const value of a) if (b.has(value)) return true;
  return false;
}

/** Independent connected-components grouping over each predicate's footprint — see header. Returns groups as arrays of bonus NAMES. */
function groupByFootprintIndependent(predicates: readonly BonusPredicate[]): string[][] {
  const n = predicates.length;
  const footprints = predicates.map(footprintOfIndependent);
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (setsIntersect(footprints[i]!, footprints[j]!)) {
        const ri = find(i);
        const rj = find(j);
        if (ri !== rj) parent[ri] = rj;
      }
    }
  }
  const groups = new Map<number, string[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = groups.get(root);
    if (list === undefined) groups.set(root, [predicates[i]!.name]);
    else list.push(predicates[i]!.name);
  }
  return [...groups.values()];
}

function pairwiseDisjoint(footprints: readonly Set<string>[]): boolean {
  for (let i = 0; i < footprints.length; i++) {
    for (let j = i + 1; j < footprints.length; j++) {
      if (setsIntersect(footprints[i]!, footprints[j]!)) return false;
    }
  }
  return true;
}

const TIERS: readonly { eventType: number; tier: EventTier }[] = [
  { eventType: 0, tier: "base" },
  { eventType: 2, tier: "districtChampionship" },
  { eventType: 3, tier: "championship" },
];

describe("analyticRpPmf — structural sweep over RP_RULE_MODULES (Task 2, plan 09-04)", () => {
  it("grouping is exactly what the code claims — the only multi-bonus group in the whole registry is 2026's {energized, supercharged}", () => {
    let multiBonusGroupCount = 0;
    for (const season of RP_REGISTERED_SEASONS) {
      const ruleModule = RP_RULE_MODULES[season]!;
      const groups = groupByFootprintIndependent(ruleModule.bonusPredicates);
      const multiBonusGroups = groups.filter((g) => g.length > 1);
      if (season === 2026) {
        expect(multiBonusGroups, "2026 must have exactly one multi-bonus group").toHaveLength(1);
        expect(new Set(multiBonusGroups[0])).toEqual(new Set(["energized", "supercharged"]));
      } else {
        expect(multiBonusGroups, `season ${season} must have zero multi-bonus groups`).toHaveLength(0);
      }
      multiBonusGroupCount += multiBonusGroups.length;
    }
    expect(multiBonusGroupCount, "exactly one multi-bonus group across the whole registry").toBe(1);
  });

  it("footprint disjointness holds where the math requires it — conjunctionDistinct clauses, countOfIndicators indicators, dataDependentMixture selector-vs-branches", () => {
    for (const season of RP_REGISTERED_SEASONS) {
      const ruleModule = RP_RULE_MODULES[season]!;
      for (const predicate of ruleModule.bonusPredicates) {
        if (predicate.kind === "conjunctionDistinct") {
          const footprints = predicate.clauses.map(footprintOfClauseIndependent);
          expect(pairwiseDisjoint(footprints), `season ${season} bonus "${predicate.name}" conjunctionDistinct clauses must be pairwise disjoint`).toBe(true);
        }
        if (predicate.kind === "countOfIndicators") {
          const footprints = predicate.indicators.map(footprintOfClauseIndependent);
          expect(pairwiseDisjoint(footprints), `season ${season} bonus "${predicate.name}" countOfIndicators indicators must be pairwise disjoint`).toBe(true);
        }
        if (predicate.kind === "dataDependentMixture") {
          const selectorFootprint = footprintOfClauseIndependent(predicate.selector);
          const trueFootprint = footprintOfClauseIndependent(predicate.whenSelectorTrue);
          const falseFootprint = footprintOfClauseIndependent(predicate.whenSelectorFalse);
          expect(
            setsIntersect(selectorFootprint, trueFootprint),
            `season ${season} bonus "${predicate.name}" selector must be disjoint from whenSelectorTrue`
          ).toBe(false);
          expect(
            setsIntersect(selectorFootprint, falseFootprint),
            `season ${season} bonus "${predicate.name}" selector must be disjoint from whenSelectorFalse`
          ).toBe(false);
        }
      }
    }
  });

  it("no mass folds — maxRp === winRp + bonusNames.length and tieRp <= winRp for all ten seasons, every emitted pmf has length exactly maxRp + 1", () => {
    let assertionCount = 0;
    for (const season of RP_REGISTERED_SEASONS) {
      const ruleModule = RP_RULE_MODULES[season]!;
      expect(ruleModule.maxRp, `season ${season}: maxRp === winRp + bonusNames.length`).toBe(ruleModule.winRp + ruleModule.bonusNames.length);
      expect(ruleModule.tieRp, `season ${season}: tieRp <= winRp`).toBeLessThanOrEqual(ruleModule.winRp);
      assertionCount += 2;

      for (const { eventType } of TIERS) {
        const values: Record<string, { mean: number; variance: number }> = {};
        ruleModule.thresholdVariables.forEach((v) => (values[v.name] = { mean: 30, variance: 25 }));
        const moments = buildRuleModuleMoments(ruleModule, values);
        const result = analyticRpPmf({ red: moments, blue: moments, ruleModule, eventType, compLevel: "qm" });
        expect(result.redPmf, `season ${season} eventType ${eventType}: pmf length === maxRp + 1`).toHaveLength(ruleModule.maxRp + 1);
        assertionCount += 1;
      }
    }
    expect(assertionCount).toBeGreaterThan(0);
  });

  it("normalization — every pmf entry finite and in [0,1], summing to 1 within 1e-9, for every season at every tier", () => {
    for (const season of RP_REGISTERED_SEASONS) {
      const ruleModule = RP_RULE_MODULES[season]!;
      for (const { eventType } of TIERS) {
        const redValues: Record<string, { mean: number; variance: number }> = {};
        const blueValues: Record<string, { mean: number; variance: number }> = {};
        ruleModule.thresholdVariables.forEach((v, i) => {
          redValues[v.name] = { mean: 20 + i * 15, variance: 10 + i * 5 };
          blueValues[v.name] = { mean: 15 + i * 12, variance: 8 + i * 4 };
        });
        const red = buildRuleModuleMoments(ruleModule, redValues, 105, 40);
        const blue = buildRuleModuleMoments(ruleModule, blueValues, 95, 45);
        const result = analyticRpPmf({ red, blue, ruleModule, eventType, compLevel: "qm" });
        for (const pmf of [result.redPmf, result.bluePmf]) {
          let sum = 0;
          for (const p of pmf) {
            expect(Number.isFinite(p), `season ${season} eventType ${eventType}: pmf entry ${p} must be finite`).toBe(true);
            expect(p).toBeGreaterThanOrEqual(0);
            expect(p).toBeLessThanOrEqual(1);
            sum += p;
          }
          expect(Math.abs(sum - 1), `season ${season} eventType ${eventType}: pmf must sum to 1`).toBeLessThan(1e-9);
        }
      }
    }
  });

  it("the all-variance-zero equivalence — the structural bridge to predictThresholds' own boolean flags", () => {
    // A deterministic, per-variable value ladder — diverse enough to trip
    // both true and false across every season's declared thresholds without
    // needing to hand-tune a straddling value per bonus.
    const VALUE_LADDER = [0, 20, 60, 110, 250, 400, 600, 1200] as const;

    for (const season of RP_REGISTERED_SEASONS) {
      const ruleModule = RP_RULE_MODULES[season]!;
      const variableNames = ruleModule.thresholdVariables.map((v) => v.name);

      for (const { eventType } of TIERS) {
        for (let pattern = 0; pattern < 3; pattern++) {
          const redMeanVector = variableNames.map((_, i) => VALUE_LADDER[(i + pattern * 3) % VALUE_LADDER.length]!);
          const blueMeanVector = variableNames.map((_, i) => VALUE_LADDER[(i + pattern * 3 + 4) % VALUE_LADDER.length]!);

          const redValues: Record<string, { mean: number; variance: number }> = {};
          const blueValues: Record<string, { mean: number; variance: number }> = {};
          variableNames.forEach((name, i) => {
            redValues[name] = { mean: redMeanVector[i]!, variance: 0 };
            blueValues[name] = { mean: blueMeanVector[i]!, variance: 0 };
          });

          // Distinct, non-zero-variance score means so the outcome half is
          // never a tie (D-07/Step 6's continuous-equality branch gives
          // pTie === 0 whenever varianceD > 0 and meanD !== 0 regardless —
          // scoreVariance 0 here keeps the WHOLE prediction a point mass).
          const red = buildRuleModuleMoments(ruleModule, redValues, 110, 0);
          const blue = buildRuleModuleMoments(ruleModule, blueValues, 100, 0);

          const result = analyticRpPmf({ red, blue, ruleModule, eventType, compLevel: "qm" });

          const redRecord: Record<string, number> = {};
          const blueRecord: Record<string, number> = {};
          variableNames.forEach((name, i) => {
            redRecord[name] = redMeanVector[i]!;
            blueRecord[name] = blueMeanVector[i]!;
          });
          const redPrediction = ruleModule.predictThresholds(redRecord, eventType);
          const bluePrediction = ruleModule.predictThresholds(blueRecord, eventType);

          // Red's score mean (110) exceeds blue's (100), so red wins.
          const expectedRedIndex = ruleModule.winRp + redPrediction.totalRp;
          const expectedBlueIndex = bluePrediction.totalRp;

          result.redPmf.forEach((p, i) => {
            const expected = i === expectedRedIndex ? 1 : 0;
            expect(p, `season ${season} eventType ${eventType} pattern ${pattern}: red pmf[${i}] (expected point mass at ${expectedRedIndex})`).toBe(
              expected
            );
          });
          result.bluePmf.forEach((p, i) => {
            const expected = i === expectedBlueIndex ? 1 : 0;
            expect(p, `season ${season} eventType ${eventType} pattern ${pattern}: blue pmf[${i}] (expected point mass at ${expectedBlueIndex})`).toBe(
              expected
            );
          });

          expect(result.redBonusProbabilities).toBeDefined();
          expect(result.blueBonusProbabilities).toBeDefined();
          ruleModule.bonusNames.forEach((name, i) => {
            expect(
              result.redBonusProbabilities![i],
              `season ${season} eventType ${eventType} pattern ${pattern}: red bonus "${name}" must equal predictThresholds' own flag`
            ).toBe(redPrediction.bonusFlags[name] ? 1 : 0);
            expect(
              result.blueBonusProbabilities![i],
              `season ${season} eventType ${eventType} pattern ${pattern}: blue bonus "${name}" must equal predictThresholds' own flag`
            ).toBe(bluePrediction.bonusFlags[name] ? 1 : 0);
          });
        }
      }
    }
  });
});
