/**
 * THE GATE that proves plan 09-05 shipped nothing (D-05/D-06, T-09-05-01,
 * T-09-05-02). Rebuilds the EXACT inputs `scripts/rpLayerInertnessGolden.ts`
 * captured before this plan's first edit to `analyticPmf.ts` — reusing that
 * script's own exported `buildGoldenCases`/`buildAllianceMoments` builders,
 * never a second copy of them — and asserts the replay reproduces the
 * committed `rpLayerInertness.json` under exact float equality (`toEqual`,
 * no tolerance). This file is NOT modified after plan 09-05's Task 1 Commit
 * 1 — see `rpLayerInertnessGolden.ts`'s own header for why an extra
 * `pRedWin` property on the case-building call already makes it compile
 * unchanged once `AnalyticRpPmfInput.pRedWin` becomes required, and why
 * that call is still evaluated against the CURRENTLY exported production
 * default, not a copy of it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGoldenCases, type GoldenCase } from "../../../scripts/rpLayerInertnessGolden.js";
import { RP_LAYER_CONFIG_DEFAULT } from "./analyticPmf.js";
import { RP_REGISTERED_SEASONS } from "./rules.js";

interface GoldenFile {
  readonly capturedAt: string;
  readonly capturedFrom: string;
  readonly defaultConfig: typeof RP_LAYER_CONFIG_DEFAULT;
  readonly cases: readonly GoldenCase[];
}

const GOLDEN_JSON_PATH = join(fileURLToPath(new URL(".", import.meta.url)), "rpLayerInertness.json");

function loadGolden(): GoldenFile {
  return JSON.parse(readFileSync(GOLDEN_JSON_PATH, "utf8")) as GoldenFile;
}

describe("rpLayerInertness — the production default is provably unmoved (D-05)", () => {
  it("the golden is non-vacuous: case count matches the declared grid (10 seasons x 3 event types x 3 pRedWin values + 1 degenerate case) and covers exactly 10 distinct seasons", () => {
    const golden = loadGolden();
    const expectedCount = RP_REGISTERED_SEASONS.length * 3 * 3 + 1;
    expect(golden.cases.length).toBe(expectedCount);
    expect(golden.cases.length).toBeGreaterThan(0);
    expect(new Set(golden.cases.map((c) => c.season)).size).toBe(10);
  });

  it("the golden's recorded defaultConfig deep-equals the CURRENTLY exported RP_LAYER_CONFIG_DEFAULT — a default flipped anywhere fails HERE first", () => {
    const golden = loadGolden();
    expect(golden.defaultConfig).toEqual(RP_LAYER_CONFIG_DEFAULT);
  });

  it("replaying every golden case through the CURRENT analyticRpPmf, under the CURRENT default config, reproduces the committed pmfs and bonus probabilities EXACTLY (toEqual, no tolerance)", () => {
    const golden = loadGolden();
    const replayed = buildGoldenCases(RP_LAYER_CONFIG_DEFAULT);
    expect(replayed.length).toBe(golden.cases.length);
    for (let i = 0; i < golden.cases.length; i++) {
      const expectedCase = golden.cases[i]!;
      const actualCase = replayed[i]!;
      expect(actualCase.season).toBe(expectedCase.season);
      expect(actualCase.eventType).toBe(expectedCase.eventType);
      expect(actualCase.compLevel).toBe(expectedCase.compLevel);
      expect(actualCase.redPmf).toEqual(expectedCase.redPmf);
      expect(actualCase.bluePmf).toEqual(expectedCase.bluePmf);
      expect(actualCase.redBonusProbabilities).toEqual(expectedCase.redBonusProbabilities);
      expect(actualCase.blueBonusProbabilities).toEqual(expectedCase.blueBonusProbabilities);
    }
  });

  it("capturedFrom names a real, findable commit hash (provenance, not a claim to be re-verified by this test)", () => {
    const golden = loadGolden();
    expect(golden.capturedFrom).toMatch(/^[0-9a-f]{40}$/);
  });
});
