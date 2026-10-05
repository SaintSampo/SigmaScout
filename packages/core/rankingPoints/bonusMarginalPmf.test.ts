/**
 * `bonusMarginalRpPmf`: EPA's RP pmf from per-bonus marginals and a win
 * probability (quick task 260929-mat). Hand-computed pmfs, the binary outcome,
 * the 2026 nested interval enumeration and the refusal paths.
 */
import { describe, expect, it } from "vitest";
import { bonusMarginalRpPmf } from "./bonusMarginalPmf.js";
import { rpRuleModuleForSeason } from "./rules.js";

const RP_2024 = rpRuleModuleForSeason(2024);
const RP_2026 = rpRuleModuleForSeason(2026);

function sum(pmf: readonly number[]): number {
  return pmf.reduce((a, b) => a + b, 0);
}

function expectPmfClose(actual: readonly number[], expected: readonly number[]): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((p, i) => expect(p).toBeCloseTo(expected[i]!, 12));
}

describe("bonusMarginalRpPmf — independent bonuses (2024)", () => {
  it("convolves the binary outcome with independent Bernoullis, hand-computed", () => {
    const result = bonusMarginalRpPmf({
      redBonusProbabilities: [0.3, 0.5],
      blueBonusProbabilities: [0.1, 0.2],
      pRedWin: 0.6,
      ruleModule: RP_2024,
      eventType: 0,
      compLevel: "qm",
    });
    // Bonus-only red: [0.7*0.5, 0.3*0.5 + 0.7*0.5, 0.3*0.5] = [0.35, 0.5, 0.15].
    expectPmfClose(result.redBonusPmf!, [0.35, 0.5, 0.15]);
    // Outcome red, winRp 2, no tie: [0.4, 0, 0.6].
    expectPmfClose(result.redPmf, [0.14, 0.2, 0.27, 0.3, 0.09]);
    // Blue bonus [0.9*0.8, 0.1*0.8 + 0.9*0.2, 0.1*0.2] = [0.72, 0.26, 0.02]; outcome [0.6, 0, 0.4].
    expectPmfClose(result.bluePmf, [0.432, 0.156, 0.3, 0.104, 0.008]);
    expect(result.redPmf.length).toBe(RP_2024.maxRp + 1);
    expect(sum(result.redPmf)).toBeCloseTo(1, 12);
    expect(result.redBonusProbabilities).toEqual([0.3, 0.5]);
    expect(result.blueBonusProbabilities).toEqual([0.1, 0.2]);
    expect(result.outcome).toEqual({ pRedWin: 0.6, pTie: 0, pBlueWin: 1 - 0.6, winRp: RP_2024.winRp, tieRp: RP_2024.tieRp });
    expect(result.marginalResolution).toBeUndefined();
    expect(result.redMarginals).toBeUndefined();
  });

  it("short-circuits a non-qualification match to P(RP=0)=1 with nothing else", () => {
    for (const compLevel of ["qf", "sf", "f", "ef"] as const) {
      expect(
        bonusMarginalRpPmf({
          redBonusProbabilities: [0.3, 0.5],
          blueBonusProbabilities: [0.1, 0.2],
          pRedWin: 0.6,
          ruleModule: RP_2024,
          eventType: 0,
          compLevel,
        })
      ).toEqual({ redPmf: [1], bluePmf: [1] });
    }
  });

  it("refuses a non-finite or out-of-range probability, a wrong-length array and a bad pRedWin", () => {
    const base = { blueBonusProbabilities: [0.1, 0.2], pRedWin: 0.6, ruleModule: RP_2024, eventType: 0, compLevel: "qm" as const };
    expect(() => bonusMarginalRpPmf({ ...base, redBonusProbabilities: [Number.NaN, 0.5] })).toThrow(/non-finite or outside/);
    expect(() => bonusMarginalRpPmf({ ...base, redBonusProbabilities: [1.2, 0.5] })).toThrow(/non-finite or outside/);
    expect(() => bonusMarginalRpPmf({ ...base, redBonusProbabilities: [-0.1, 0.5] })).toThrow(/non-finite or outside/);
    expect(() => bonusMarginalRpPmf({ ...base, redBonusProbabilities: [0.5] })).toThrow(/expected 2/);
    expect(() => bonusMarginalRpPmf({ ...base, redBonusProbabilities: [0.3, 0.5], pRedWin: Number.NaN })).toThrow(/pRedWin/);
  });
});

describe("bonusMarginalRpPmf — 2026 nested energized and supercharged", () => {
  it("enumerates the nested pair by interval: [1 - qE, qE - qS, qS] convolved with traversal", () => {
    const result = bonusMarginalRpPmf({
      redBonusProbabilities: [0.6, 0.2, 0.5],
      blueBonusProbabilities: [0.6, 0.2, 0.5],
      pRedWin: 0.5,
      ruleModule: RP_2026,
      eventType: 0,
      compLevel: "qm",
    });
    // Group [0.4, 0.4, 0.2] * traversal [0.5, 0.5].
    expectPmfClose(result.redBonusPmf!, [0.2, 0.4, 0.3, 0.1]);
    expect(result.redPmf.length).toBe(RP_2026.maxRp + 1);
    expect(sum(result.redPmf)).toBeCloseTo(1, 12);
  });

  it("clamps supercharged to energized, so 'supercharged without energized' never carries mass, at every tier", () => {
    for (const eventType of [0, 1, 2, 3, 4, 5]) {
      const result = bonusMarginalRpPmf({
        redBonusProbabilities: [0.3, 0.5, 0],
        blueBonusProbabilities: [0.1, 0.9, 1],
        pRedWin: 0.5,
        ruleModule: RP_2026,
        eventType,
        compLevel: "qm",
      });
      // Published marginals: supercharged never exceeds energized.
      expect(result.redBonusProbabilities![1]!).toBeLessThanOrEqual(result.redBonusProbabilities![0]!);
      expect(result.redBonusProbabilities).toEqual([0.3, 0.3, 0]);
      expect(result.blueBonusProbabilities).toEqual([0.1, 0.1, 1]);
      // Red: exactly one nested bonus has zero mass (energized alone, qE - qS = 0).
      expectPmfClose(result.redBonusPmf!, [0.7, 0, 0.3, 0]);
      // Blue, traversal certain: [0, 0.9, 0, 0.1].
      expectPmfClose(result.blueBonusPmf!, [0, 0.9, 0, 0.1]);
    }
  });

  it("offseason (99) prices at the base tier: the same result as a regional for the same inputs", () => {
    const input = {
      redBonusProbabilities: [0.3, 0.2, 0.5],
      blueBonusProbabilities: [0.3, 0.2, 0.5],
      pRedWin: 0.5,
      ruleModule: RP_2026,
      compLevel: "qm" as const,
    };
    expect(bonusMarginalRpPmf({ ...input, eventType: 99 })).toEqual(bonusMarginalRpPmf({ ...input, eventType: 0 }));
  });

  it("throws for an unmapped event type (6, Festival of Champions) rather than guessing a tier", () => {
    expect(() =>
      bonusMarginalRpPmf({
        redBonusProbabilities: [0.3, 0.2, 0.5],
        blueBonusProbabilities: [0.3, 0.2, 0.5],
        pRedWin: 0.5,
        ruleModule: RP_2026,
        eventType: 6,
        compLevel: "qm",
      })
    ).toThrow(/unmapped TBA event_type 6/);
  });
});
