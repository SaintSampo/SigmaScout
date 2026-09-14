/**
 * Replays the grid generator against the live `predictThresholds` evaluators
 * and asserts digest and per-bonus fire-count equality with the committed
 * `predictThresholdsGolden.json`, for every season and event tier. The digest
 * says something broke; the fire count says which bonus, at which tier.
 *
 * Corpus-free: the grid is pure and must run everywhere, including CI.
 *
 * Regenerate the golden file only when the grid itself changes, never in
 * response to a failing assertion here.
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
