/**
 * `loadRpRuleModule` must hand back the very object `RP_RULE_MODULES` holds for
 * every registered season, and `undefined` for every other season, so a browser
 * that loads one season's rules prices exactly what the Node publisher prices.
 */
import { describe, expect, it } from "vitest";
import { RP_REGISTERED_SEASONS, RP_RULE_MODULES } from "./rules.js";
import { loadRpRuleModule, RP_LOADABLE_SEASONS } from "./rulesLoader.js";

describe("loadRpRuleModule", () => {
  it("RP_LOADABLE_SEASONS equals RP_REGISTERED_SEASONS (an equality pin: a new season cannot be silently skipped)", () => {
    expect(RP_LOADABLE_SEASONS).toEqual(RP_REGISTERED_SEASONS);
  });

  it("resolves to the identical RP_RULE_MODULES object for every registered season", async () => {
    expect(RP_REGISTERED_SEASONS.length).toBeGreaterThan(0);
    for (const season of RP_REGISTERED_SEASONS) {
      expect(await loadRpRuleModule(season), String(season)).toBe(RP_RULE_MODULES[season]);
    }
  });

  it("agrees with RP_RULE_MODULES for every integer season 2000-2040, undefined when unregistered", async () => {
    let unregistered = 0;
    for (let season = 2000; season <= 2040; season++) {
      const loaded = await loadRpRuleModule(season);
      expect(loaded, String(season)).toBe(RP_RULE_MODULES[season]);
      if (RP_RULE_MODULES[season] === undefined) {
        expect(loaded, String(season)).toBeUndefined();
        unregistered++;
      }
    }
    // 2021 (no season) and the years outside the registry are real negatives.
    expect(unregistered).toBeGreaterThan(0);
  });
});
