/**
 * The pre-change behaviour oracle's replay test (quick task 260911-w7k Task 1).
 * Reads the committed `analyticPmfGolden.json` — captured from
 * `analyticPmf.ts` UNMODIFIED at the commit the file itself names, BEFORE that
 * task rewrote `clauseProbability` — and re-runs the SAME grid builder against
 * the LIVE engine, asserting EXACT equality of every bonus probability, every
 * pmf entry and all three resolved-family tally counts.
 *
 * ---------------------------------------------------------------------------
 * THIS FILE'S VALUES WERE PRODUCED BY RUNNING THE MODULE. THAT IS DELIBERATE.
 * ---------------------------------------------------------------------------
 *
 * Its sibling `analyticPmf.test.ts` owes D-07's hand-computed test debt: every
 * expected value in THAT file was computed from the specification at planning
 * time and none was produced by running `analyticPmf.ts`. This file is the
 * opposite by design, and the two therefore fail for different reasons:
 * `analyticPmf.test.ts` fails when "this mechanism's arithmetic disagrees with
 * the specification", and this file fails when "today's engine no longer
 * reproduces the engine that shipped". A characterization oracle cannot answer
 * the first question and a hand-computed test cannot answer the second, so
 * neither replaces the other.
 *
 * **Regeneration prohibition** (`scripts/rpPredictThresholdsGolden.ts`'s own
 * header, applied here verbatim in spirit): the golden file is regenerated
 * ONLY when the GRID itself changes — the pattern set, the scale ladder or the
 * event types in `analyticPmfFixtures.ts`, with `GOLDEN_GRID_VERSION` bumped in
 * the same edit — and NEVER in response to a failing assertion below.
 * Regenerating to make this test green launders a behavior regression into the
 * oracle that exists to catch exactly that. If it goes red and the cause is not
 * an obvious, nameable transcription slip, stop and report.
 *
 * **No tolerance anywhere.** Every numeric assertion is `toBe`. A tolerance
 * would hide precisely the mistake this file exists to catch: quick task
 * 260911-w7k's whole premise is that deriving a clause's marginal family from
 * its terms' declarations moves NO number, and a comparison that tolerated a
 * small drift could not tell that premise from its failure.
 *
 * **Non-vacuity and non-saturation are asserted, not argued** (the two
 * `describe` blocks at the bottom). 09-02's `predictThresholdsGolden.test.ts`
 * proved its own non-vacuity by a manual perturb-and-revert recorded in a
 * SUMMARY; this file automates the equivalent, so the evidence re-runs on every
 * CI pass instead of living in a document.
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
import { RP_REGISTERED_SEASONS, rpRuleModuleForSeason } from "./rules.js";

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
  const ruleModule = rpRuleModuleForSeason(season);

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

        // The tally is pinned per row for one specific reason: it is the
        // evidence that `clauseProbability`'s combined fit is not, and never
        // was, fed to `accumulateMarginalResolution`. If a future edit started
        // tallying the clause-level fit, these counts would rise and this
        // assertion would name the row it happened in.
        expect(actualRow.tally.gaussian, `${where}: tally.gaussian`).toBe(expectedRow.tally.gaussian);
        expect(actualRow.tally.degenerate, `${where}: tally.degenerate`).toBe(expectedRow.tally.degenerate);
        expect(actualRow.tally.fallbacks, `${where}: tally.fallbacks`).toBe(expectedRow.tally.fallbacks);
      }
    );
  });
});

describe("analyticPmfGolden — the oracle is sensitive to its own inputs (automated non-vacuity)", () => {
  // A characterization test that has never been observed to respond to a
  // changed input is evidence of nothing. Perturbing every mean by 1.01x must
  // move at least one bonus probability in every season, in a row whose
  // numbers move continuously with their inputs. The structural patterns
  // (`zero-variance`, `non-finite`) are excluded on purpose — see
  // `isNumericLadderPattern`'s own doc comment for why asserting this over
  // them would be asserting the wrong thing.
  it.each(RP_REGISTERED_SEASONS)(
    "season %i: a 1.01x mean perturbation changes at least one committed bonus probability",
    (season) => {
      const committed = golden.cells[cellKey(season, 0)]!;
      const perturbed = buildBonusPmfGoldenRows(rpRuleModuleForSeason(season), 0, 1.01);
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
  // A grid of nothing but exact 0s and 1s would replay perfectly while being
  // blind to any change in a Gaussian fit — every probability would be pinned
  // by a comparison's sign rather than by the distribution's shape. Every
  // season must put at least one probability strictly inside (0.001, 0.999).
  //
  // There is deliberately NO exception list here: all ten registered seasons
  // satisfy this bound as captured, so adding a `STRUCTURALLY_SATURATED` escape
  // hatch before one is needed would just be a pre-built place to hide a future
  // regression. If a future season genuinely cannot satisfy it, add that season
  // with a one-line reason and assert the list is exactly that set — never
  // relax the bound itself.
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
