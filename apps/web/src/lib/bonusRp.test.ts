import { describe, expect, it } from "vitest";
import { RP_RULE_MODULES } from "../../../../packages/core/algorithms/sigma1/rp/rules.js";
import {
  BONUS_RP_BY_SEASON,
  bonusDotLabel,
  bonusRpForSeason,
  bonusStatesFromFlags,
  bonusStatesFromProbabilities,
  PREDICTED_BONUS_THRESHOLD,
} from "./bonusRp.js";

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

/**
 * Plan 06.1-06, Task 1: the published-data-to-dot-state mapping. Three
 * published states — a probability, a boolean, and absence — each map to
 * exactly one `BonusRpState`, with the threshold boundary and the
 * null-is-not-missed rule pinned by their own dedicated cases.
 */
describe("bonusStatesFromProbabilities", () => {
  it("maps a probability at or above the threshold to earned", () => {
    expect(bonusStatesFromProbabilities([0.7, 0.9], 2)).toEqual(["earned", "earned"]);
  });

  it("maps a probability below the threshold to missed", () => {
    expect(bonusStatesFromProbabilities([0.1, 0.3], 2)).toEqual(["missed", "missed"]);
  });

  // Load-bearing boundary: three separate, adjacent cases rather than one
  // parameterised sweep, so a boundary regression names itself.
  it("maps a probability of 0.4999 (just below the threshold) to missed", () => {
    expect(bonusStatesFromProbabilities([0.4999], 1)).toEqual(["missed"]);
  });

  it("maps a probability of exactly 0.5 (the threshold) to earned (PD-11)", () => {
    expect(bonusStatesFromProbabilities([0.5], 1)).toEqual(["earned"]);
  });

  it("maps a probability of 0.5001 (just above the threshold) to earned", () => {
    expect(bonusStatesFromProbabilities([0.5001], 1)).toEqual(["earned"]);
  });

  it("maps every position to unknown when the probabilities array is undefined", () => {
    expect(bonusStatesFromProbabilities(undefined, 3)).toEqual(["unknown", "unknown", "unknown"]);
  });

  it("maps the missing trailing positions of a shorter-than-count array to unknown, never missed", () => {
    expect(bonusStatesFromProbabilities([0.9], 3)).toEqual(["earned", "unknown", "unknown"]);
  });

  it("always returns exactly count entries regardless of input length", () => {
    expect(bonusStatesFromProbabilities([0.9, 0.1, 0.5, 0.2], 2)).toHaveLength(2);
  });
});

describe("bonusStatesFromFlags", () => {
  it("maps true to earned and false to missed", () => {
    expect(bonusStatesFromFlags([true, false], 2)).toEqual(["earned", "missed"]);
  });

  it("maps a null flag array to every position unknown — asserted against null specifically, not undefined", () => {
    expect(bonusStatesFromFlags(null, 3)).toEqual(["unknown", "unknown", "unknown"]);
  });

  it("maps an undefined flag array to every position unknown", () => {
    expect(bonusStatesFromFlags(undefined, 3)).toEqual(["unknown", "unknown", "unknown"]);
  });

  it("maps the missing trailing positions of a shorter-than-count array to unknown", () => {
    expect(bonusStatesFromFlags([true], 3)).toEqual(["earned", "unknown", "unknown"]);
  });

  it("always returns exactly count entries regardless of input length", () => {
    expect(bonusStatesFromFlags([true, false, true], 2)).toHaveLength(2);
  });
});

describe("bonusDotLabel", () => {
  it("returns 'no data published' text for an unknown state, regardless of kind", () => {
    expect(bonusDotLabel("Melody", "unknown", "predicted")).toContain("no data published");
    expect(bonusDotLabel("Melody", "unknown", "actual")).toContain("no data published");
  });

  it("carries the probability as a whole-number percentage for a predicted dot with a defined probability", () => {
    const label = bonusDotLabel("Melody", "earned", "predicted", 0.72);
    expect(label).toContain("72%");
  });

  it("rounds the predicted percentage to the nearest whole number", () => {
    expect(bonusDotLabel("Melody", "earned", "predicted", 0.505)).toContain("51%");
  });

  it("returns distinct text for an actual earned dot", () => {
    expect(bonusDotLabel("Melody", "earned", "actual")).toContain("earned");
    expect(bonusDotLabel("Melody", "earned", "actual")).not.toContain("not earned");
  });

  it("returns distinct text for an actual missed dot", () => {
    expect(bonusDotLabel("Melody", "missed", "actual")).toContain("not earned");
  });

  it("returns distinct text for a predicted dot with no probability, carrying the state word", () => {
    const earnedLabel = bonusDotLabel("Melody", "earned", "predicted");
    const missedLabel = bonusDotLabel("Melody", "missed", "predicted");
    expect(earnedLabel).not.toBe(missedLabel);
    expect(earnedLabel).toContain("earned");
    expect(missedLabel).toContain("missed");
  });

  it("every label starts with the bonus label and a colon", () => {
    expect(bonusDotLabel("Melody", "earned", "actual").startsWith("Melody:")).toBe(true);
  });
});

describe("PREDICTED_BONUS_THRESHOLD", () => {
  it("is exported and equals one half (PD-11)", () => {
    expect(PREDICTED_BONUS_THRESHOLD).toBe(0.5);
  });
});
