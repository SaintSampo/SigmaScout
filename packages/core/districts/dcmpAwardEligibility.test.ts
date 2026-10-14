/**
 * The one DCMP award eligibility rule (quick task 261014-i8i). Pure, synthetic,
 * no corpus.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  dcmpAwardEligibility,
  dcmpEligibilityChance,
  dcmpEntrantWeight,
  type DcmpEligibilityTeam,
} from "./dcmpAwardEligibility.js";
import { awardBaseRate, awardPointsBucketIndex } from "./awardBaseRates.js";
import { ZERO_AWARD_PROFILE, type DistrictAwardProfile } from "./ledgerSimulation.js";

const SEASON = 2026;

function team(teamKey: string, overrides: Partial<DcmpEligibilityTeam> = {}): DcmpEligibilityTeam {
  return { teamKey, rookie: false, heldAwards: [], districtEventKeys: [], ...overrides };
}

/**
 * frc1 holds Impact at a final event and an EI at a DCMP key (never in the
 * district set); frc2 is a rookie holding RAS; frc3 and frc4 are entered at
 * two open events.
 */
const TEAMS: readonly DcmpEligibilityTeam[] = [
  team("frc1", {
    heldAwards: [
      { eventKey: "2026wabon", awardType: 0 },
      { eventKey: "2026pncmp", awardType: 9 },
    ],
    districtEventKeys: ["2026wabon"],
  }),
  team("frc2", { rookie: true, heldAwards: [{ eventKey: "2026wabon", awardType: 10 }], districtEventKeys: ["2026wabon"] }),
  team("frc3", { districtEventKeys: ["2026wasno", "2026waaaa"] }),
  team("frc4", { districtEventKeys: ["2026waaaa", "2026wasno"] }),
];

const FINAL = new Set(["2026wabon", "2026pncmp"]);

describe("dcmpAwardEligibility", () => {
  const eligibility = dcmpAwardEligibility({
    teams: TEAMS,
    awardFinal: (key) => FINAL.has(key),
    weight: (entry, awardType) => (awardType === 10 ? (entry.rookie ? 1 : 0) : awardType === 9 ? (entry.rookie ? 0 : 1) : 1),
  });

  it("lists every award type in DCMP_DRAWN_AWARD_TYPES order", () => {
    expect(eligibility.map((entry) => entry.awardType)).toEqual([0, 9, 10]);
  });

  it("makes a team holding the award at a final district event a candidate, and never a DCMP tier award", () => {
    expect(eligibility[0]!.candidates).toEqual([{ teamKey: "frc1", weight: 1 }]);
    expect(eligibility[1]!.candidates).toEqual([]);
    expect(eligibility[2]!.candidates).toEqual([{ teamKey: "frc2", weight: 1 }]);
  });

  it("lists every open district event once, sorted, with its entrants in team order", () => {
    expect(eligibility[0]!.pendingEvents).toEqual([
      { eventKey: "2026waaaa", entrants: [{ teamKey: "frc3", weight: 1 }, { teamKey: "frc4", weight: 1 }] },
      { eventKey: "2026wasno", entrants: [{ teamKey: "frc3", weight: 1 }, { teamKey: "frc4", weight: 1 }] },
    ]);
    expect(eligibility[2]!.pendingEvents[0]!.entrants).toEqual([
      { teamKey: "frc3", weight: 0 },
      { teamKey: "frc4", weight: 0 },
    ]);
  });

  it("is plain data that survives a structured clone", () => {
    expect(structuredClone(eligibility)).toEqual(eligibility);
  });
});

describe("dcmpEligibilityChance", () => {
  const eligibility = [
    {
      awardType: 0 as const,
      candidates: [{ teamKey: "frcHeld", weight: 0.2 }],
      pendingEvents: [
        { eventKey: "e1", entrants: [{ teamKey: "frcA", weight: 1 }, { teamKey: "frcB", weight: 3 }] },
        { eventKey: "e2", entrants: [{ teamKey: "frcA", weight: 2 }, { teamKey: "frcC", weight: 2 }] },
        { eventKey: "e3", entrants: [{ teamKey: "frcZ", weight: 0 }] },
      ],
    },
    { awardType: 9 as const, candidates: [], pendingEvents: [] },
    { awardType: 10 as const, candidates: [], pendingEvents: [] },
  ];

  it("is 1 for a held team", () => {
    expect(dcmpEligibilityChance(eligibility, "frcHeld", 0)).toBe(1);
  });

  it("is 1 minus the product of (1 minus w over W) over the open events: 1/4 and 1/2 give 0.625", () => {
    expect(dcmpEligibilityChance(eligibility, "frcA", 0)).toBeCloseTo(0.625, 15);
    expect(dcmpEligibilityChance(eligibility, "frcB", 0)).toBeCloseTo(0.75, 15);
  });

  it("is 0 for anyone else, and 0 at an open event whose weights sum to 0", () => {
    expect(dcmpEligibilityChance(eligibility, "frcNobody", 0)).toBe(0);
    expect(dcmpEligibilityChance(eligibility, "frcZ", 0)).toBe(0);
    expect(dcmpEligibilityChance(eligibility, "frcA", 9)).toBe(0);
  });
});

describe("dcmpEntrantWeight", () => {
  const rookie: DistrictAwardProfile = { bucket: "none", rookieState: "rookie" };
  const veteran: DistrictAwardProfile = { bucket: "three-or-more", rookieState: "veteran" };

  it("applies eligibility first: Rookie All Star rookies only, Engineering Inspiration veterans only", () => {
    expect(dcmpEntrantWeight(veteran, 10, SEASON, "uniform")).toBe(0);
    expect(dcmpEntrantWeight(rookie, 9, SEASON, "uniform")).toBe(0);
    expect(dcmpEntrantWeight(rookie, 10, SEASON, "uniform")).toBe(1);
    expect(dcmpEntrantWeight(veteran, 9, SEASON, "uniform")).toBe(1);
    expect(dcmpEntrantWeight(ZERO_AWARD_PROFILE, 10, SEASON, "decoration")).toBe(0);
  });

  it("weights by the base rate pmf mass at the award's points under decoration", () => {
    const rate = awardBaseRate(SEASON, "three-or-more", "veteran");
    expect(dcmpEntrantWeight(veteran, 0, SEASON, "decoration")).toBe(rate.pmf[awardPointsBucketIndex(10)!]);
    expect(dcmpEntrantWeight(veteran, 9, SEASON, "decoration")).toBe(rate.pmf[awardPointsBucketIndex(8)!]);
  });

  it("falls back to 1 for a season with no table", () => {
    expect(dcmpEntrantWeight(veteran, 0, 1990, "decoration")).toBe(1);
  });
});

describe("dcmpAwardEligibility.ts imports", () => {
  it("imports nothing from locks.js: no award prediction may reach a Locked verdict", () => {
    const source = readFileSync(new URL("./dcmpAwardEligibility.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]!);
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.filter((specifier) => specifier.endsWith("locks.js"))).toEqual([]);
  });
});
