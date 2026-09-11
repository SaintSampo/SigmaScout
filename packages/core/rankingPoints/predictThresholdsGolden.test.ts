/**
 * The pre-rewrite behavior oracle's replay test (09-02 Task 1 Step 3; D-02,
 * D-07, Pitfall 4, T-09-02-01). Reads the committed
 * `predictThresholdsGolden.json` — captured from the code at HEAD BEFORE any
 * season module in this plan was touched — and re-runs the SAME grid
 * generator against the LIVE evaluator, asserting digest AND per-bonus fire
 * count equality for every registered season at every event tier. A digest
 * tells you something broke; a per-bonus fire count tells you which bonus,
 * at which tier — both are asserted, never just the digest.
 *
 * Deliberately corpus-free (unlike `reconciliation.test.ts`'s
 * `existsSync`-gated corpus dependency, see that file's `CORPUS_PATH`
 * convention) — the grid is pure and must run everywhere, including CI with
 * no corpus checked out.
 *
 * **Non-vacuity was proven once, by hand, and is recorded in
 * 09-02-SUMMARY.md**: with this test green, `2026.ts`'s
 * `TRAVERSAL_THRESHOLD.base` was temporarily changed from 50 to 51, this
 * test was re-run and failed naming season 2026, then the change was
 * reverted and the test confirmed green again. A characterization test that
 * has never been observed to fail is not evidence of anything.
 *
 * **Regeneration prohibition** (`scripts/rpPredictThresholdsGolden.ts`'s own
 * header): the golden file is regenerated ONLY when the grid itself
 * changes, never in response to a failing assertion here.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { RP_REGISTERED_SEASONS, rpRuleModuleForSeason } from "./rules.js";
import { buildGridRows, digestRows, GRID_EVENT_TYPES, GRID_VERSION, type GridRow } from "../../../scripts/rpPredictThresholdsGolden.js";

interface GoldenFile {
  readonly gridVersion: number;
  readonly generatedFromCommit: string;
  readonly rowsPerSeasonTier: number;
  readonly digests: Record<string, string>;
  readonly fireCounts: Record<string, number>;
}

const GOLDEN_PATH = new URL("./predictThresholdsGolden.json", import.meta.url);
const golden: GoldenFile = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as GoldenFile;

describe("predictThresholdsGolden — grid version", () => {
  it("the committed oracle's gridVersion matches the live grid generator's GRID_VERSION (regenerating with a changed grid must fail loudly, never silently compare apples to oranges)", () => {
    expect(golden.gridVersion).toBe(GRID_VERSION);
  });
});

describe.each(RP_REGISTERED_SEASONS)("predictThresholdsGolden — season %i", (season) => {
  const module = rpRuleModuleForSeason(season);

  describe.each(GRID_EVENT_TYPES)("event type %i", (eventType) => {
    let rows: GridRow[];

    beforeAll(() => {
      rows = buildGridRows(season, eventType);
    });

    it("digest matches the committed pre-rewrite oracle", () => {
      expect(digestRows(rows)).toBe(golden.digests[`${season}:${eventType}`]);
    });

    it.each(module.bonusNames)("fire count for bonus %s matches the committed pre-rewrite oracle", (bonusName) => {
      const fireCount = rows.filter((row) => row.bonusFlags[bonusName] === true).length;
      expect(fireCount).toBe(golden.fireCounts[`${season}:${eventType}:${bonusName}`]);
    });
  });
});
