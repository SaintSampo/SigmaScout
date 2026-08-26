import { describe, expect, it } from "vitest";
import { RP_RULE_MODULES } from "../../../../packages/core/algorithms/sigma1/rp/rules.js";
import { BONUS_RP_BY_SEASON, bonusRpForSeason } from "./bonusRp.js";

/**
 * `bonusRp.ts` copies each season's BONUS_NAMES rather than importing the
 * rule modules (which would drag the whole Sigma1 RP implementation into the
 * client bundle). This pins the copy: a season added, removed or renamed in
 * core fails here instead of silently rendering the wrong letters.
 */
describe("bonusRp table matches the core RP rule modules", () => {
  it("covers exactly the seasons core registers", () => {
    expect(Object.keys(BONUS_RP_BY_SEASON).sort()).toEqual(Object.keys(RP_RULE_MODULES).sort());
  });

  for (const [season, module] of Object.entries(RP_RULE_MODULES)) {
    it(`${season}: bonus keys and order match core exactly`, () => {
      expect(bonusRpForSeason(Number(season)).map((b) => b.key)).toEqual([...module.bonusNames]);
    });
  }

  it("every letter is a single character, unique within its own season", () => {
    for (const [season, bonuses] of Object.entries(BONUS_RP_BY_SEASON)) {
      const letters = bonuses.map((b) => b.letter);
      expect(letters.every((l) => l.length === 1), `${season} letters must be single characters`).toBe(true);
      expect(new Set(letters).size, `${season} letters must be unique`).toBe(letters.length);
    }
  });

  it("returns an empty list for an unregistered season rather than throwing", () => {
    expect(bonusRpForSeason(1999)).toEqual([]);
  });
});
