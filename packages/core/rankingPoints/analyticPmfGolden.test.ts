/**
 * Characterization oracle: replays the grid in `analyticPmfFixtures.ts`
 * against the live engine and asserts exact equality with the committed
 * `analyticPmfGolden.json` (every bonus probability, pmf entry and tally
 * count). Its values came from running the module, deliberately: it catches
 * "the engine no longer reproduces what shipped", while the hand-computed
 * `analyticPmf.test.ts` catches arithmetic that disagrees with the spec.
 *
 * Regenerate the JSON only when the grid itself changes (bumping
 * `GOLDEN_GRID_VERSION` in the same edit), never to turn a failing assertion
 * green. No tolerance anywhere: every numeric assertion is `toBe`.
 * Non-vacuity and non-saturation are asserted in the two blocks at the bottom.
 *
 * The grid runs against gaussian-declared variants of the real modules
 * (`gaussianDeclared`), since the JSON pins the Gaussian engine; lattice
 * arithmetic is covered by `analyticPmf.lattice.test.ts` and
 * `marginals.lattice.test.ts`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildBonusPmfGoldenRows,
  isNumericLadderPattern,
  GOLDEN_EVENT_TYPES,
  GOLDEN_GRID_VERSION,
  type BonusPmfGoldenRow,
} from "./analyticPmfFixtures.js";
import { RP_REGISTERED_SEASONS, rpRuleModuleForSeason, type RpRuleModule } from "./rules.js";

/** The real season module with every threshold variable declared `"gaussian"` — see this file's header. */
function gaussianDeclared(season: number): RpRuleModule {
  const ruleModule = rpRuleModuleForSeason(season);
  return { ...ruleModule, thresholdVariables: ruleModule.thresholdVariables.map((v) => ({ ...v, marginalFamily: "gaussian" as const })) };
}

interface GoldenFile {
  readonly gridVersion: number;
  readonly generatedFromCommit: string;
  readonly note: string;
  readonly cells: Record<string, readonly BonusPmfGoldenRow[]>;
}

const GOLDEN_PATH = new URL("./analyticPmfGolden.json", import.meta.url);
const golden: GoldenFile = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as GoldenFile;

const cellKey = (season: number, eventType: number): string => `${season}|${eventType}`;

describe("analyticPmfGolden — the oracle's own shape", () => {
  it("the committed oracle's gridVersion matches the live GOLDEN_GRID_VERSION (a changed grid must fail loudly, never silently compare apples to oranges)", () => {
    expect(golden.gridVersion).toBe(GOLDEN_GRID_VERSION);
  });

  it("names the commit it was captured from, so the claim 'captured before the change' is checkable against git rather than taken on trust", () => {
    expect(golden.generatedFromCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("covers exactly the full cross product of registered seasons and golden event types — a set equality, so a missing cell and a stray cell both fail readably", () => {
    const expected = new Set<string>();
    for (const season of RP_REGISTERED_SEASONS) {
      for (const eventType of GOLDEN_EVENT_TYPES) expected.add(cellKey(season, eventType));
    }
    expect(new Set(Object.keys(golden.cells))).toEqual(expected);
  });
});

describe.each(RP_REGISTERED_SEASONS)("analyticPmfGolden — season %i", (season) => {
  const ruleModule = gaussianDeclared(season);

  describe.each(GOLDEN_EVENT_TYPES)("event type %i", (eventType) => {
    const committed = golden.cells[cellKey(season, eventType)]!;
    const live = buildBonusPmfGoldenRows(ruleModule, eventType);

    it("produces the same patterns in the same order as the committed oracle", () => {
      expect(live.map((row) => row.pattern)).toEqual(committed.map((row) => row.pattern));
    });

    it.each(committed.map((row, index) => [row.pattern, index] as const))(
      "pattern %s reproduces the committed bonus probabilities, pmf and tally EXACTLY",
      (pattern, index) => {
        const expectedRow = committed[index]!;
        const actualRow = live[index]!;
        const where = `season ${season} eventType ${eventType} pattern ${pattern}`;

        expect(actualRow.pattern, `${where}: pattern label`).toBe(expectedRow.pattern);

        expect(actualRow.bonusProbabilities.length, `${where}: bonusProbabilities length`).toBe(
          expectedRow.bonusProbabilities.length
        );
        for (let i = 0; i < expectedRow.bonusProbabilities.length; i++) {
          expect(
            actualRow.bonusProbabilities[i],
            `${where}: bonusProbabilities[${i}] (bonus "${ruleModule.bonusNames[i]}")`
          ).toBe(expectedRow.bonusProbabilities[i]);
        }

        expect(actualRow.pmf.length, `${where}: pmf length`).toBe(expectedRow.pmf.length);
        for (let i = 0; i < expectedRow.pmf.length; i++) {
          expect(actualRow.pmf[i], `${where}: pmf[${i}]`).toBe(expectedRow.pmf[i]);
        }

        // Pinned per row: these counts rise if a clause-level combined fit is ever tallied.
        expect(actualRow.tally.gaussian, `${where}: tally.gaussian`).toBe(expectedRow.tally.gaussian);
        expect(actualRow.tally.degenerate, `${where}: tally.degenerate`).toBe(expectedRow.tally.degenerate);
        expect(actualRow.tally.fallbacks, `${where}: tally.fallbacks`).toBe(expectedRow.tally.fallbacks);
      }
    );
  });
});

describe("analyticPmfGolden — the oracle is sensitive to its own inputs (automated non-vacuity)", () => {
  // Perturbing every mean by 1.01x must move at least one bonus probability in
  // every season. Structural patterns are excluded (see `isNumericLadderPattern`).
  it.each(RP_REGISTERED_SEASONS)(
    "season %i: a 1.01x mean perturbation changes at least one committed bonus probability",
    (season) => {
      const committed = golden.cells[cellKey(season, 0)]!;
      const perturbed = buildBonusPmfGoldenRows(gaussianDeclared(season), 0, 1.01);
      const differing: string[] = [];
      for (let r = 0; r < committed.length; r++) {
        const row = committed[r]!;
        if (!isNumericLadderPattern(row.pattern)) continue;
        for (let i = 0; i < row.bonusProbabilities.length; i++) {
          if (perturbed[r]!.bonusProbabilities[i] !== row.bonusProbabilities[i]) {
            differing.push(`${row.pattern}[${i}]`);
          }
        }
      }
      expect(
        differing.length,
        `season ${season}: no bonus probability moved under a 1.01x mean perturbation — this grid cannot detect a change in the Gaussian fit and is therefore not an oracle for one`
      ).toBeGreaterThan(0);
    }
  );
});

describe("analyticPmfGolden — the oracle is not a wall of saturated 0s and 1s (automated non-saturation)", () => {
  // A grid of only 0s and 1s would replay perfectly while blind to any change in
  // a fit, so every season must put a probability strictly inside (0.001, 0.999).
  // No exception list; never relax the bound itself.
  it.each(RP_REGISTERED_SEASONS)(
    "season %i: at least one committed bonus probability lies strictly inside (0.001, 0.999)",
    (season) => {
      const unsaturated: number[] = [];
      for (const eventType of GOLDEN_EVENT_TYPES) {
        for (const row of golden.cells[cellKey(season, eventType)]!) {
          if (!isNumericLadderPattern(row.pattern)) continue;
          for (const p of row.bonusProbabilities) {
            if (p > 0.001 && p < 0.999) unsaturated.push(p);
          }
        }
      }
      expect(
        unsaturated.length,
        `season ${season}: every numeric-ladder bonus probability is saturated at or beyond 0.001/0.999 — this grid would replay identically under a changed marginal fit and proves nothing about one`
      ).toBeGreaterThan(0);
    }
  );
});
