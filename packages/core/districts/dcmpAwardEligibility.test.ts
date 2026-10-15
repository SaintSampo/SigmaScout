/**
 * The one DCMP award eligibility rule (quick task 261014-i8i) and its weights
 * from the one award model (quick task 261014-qje, Q-11). Pure, synthetic, no
 * corpus.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  dcmpAwardEligibility,
  dcmpEligibilityChance,
  eligibilityWeight,
  type DcmpEligibilityTeam,
} from "./dcmpAwardEligibility.js";
import { hasAwardSlateTables, slateEntrantWeight } from "./awardSlate.js";
import { ZERO_AWARD_PROFILE, type DistrictAwardProfile } from "./ledgerSimulation.js";

/** A season with slate tables at both tiers: weights are class lifts. */
const SEASON = 2026;
/** A season with no slate tables at either tier: weights are the audience (1 or 0). */
const AUDIENCE_SEASON = 2019;

const ROOKIE: DistrictAwardProfile = { bucket: "none", rookieState: "rookie", priorJudgedAwards: 0, priorImpactWins: 0 };

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
    season: AUDIENCE_SEASON,
    teams: TEAMS,
    awardFinal: (key) => FINAL.has(key),
    profileOf: (teamKey) => (teamKey === "frc2" ? ROOKIE : ZERO_AWARD_PROFILE),
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

describe("the weights come from the one award model (quick task 261014-qje, Q-11)", () => {
  const decorated: DistrictAwardProfile = { bucket: "three-or-more", rookieState: "veteran", priorJudgedAwards: 6, priorImpactWins: 1 };
  const plain: DistrictAwardProfile = { bucket: "none", rookieState: "veteran", priorJudgedAwards: 0, priorImpactWins: 0 };
  const profiles = new Map<string, DistrictAwardProfile>([
    ["frcHeld", decorated],
    ["frcA", decorated],
    ["frcB", plain],
    ["frcR", ROOKIE],
  ]);
  const teams: DcmpEligibilityTeam[] = [
    team("frcHeld", { heldAwards: [{ eventKey: "2026wfin", awardType: 0 }], districtEventKeys: ["2026wfin", "2026wopn"] }),
    team("frcA", { districtEventKeys: ["2026wopn"] }),
    team("frcB", { districtEventKeys: ["2026wopn"] }),
    team("frcR", { rookie: true, districtEventKeys: ["2026wopn"] }),
  ];
  const run = (season: number) =>
    dcmpAwardEligibility({ season, teams, awardFinal: (key) => key === "2026wfin", profileOf: (key) => profiles.get(key)! });

  it("a held candidate weighs its DCMP tier class lift, an open event's entrant its district tier class lift", () => {
    expect(hasAwardSlateTables(SEASON, "dcmp")).toBe(true);
    expect(hasAwardSlateTables(SEASON, "district")).toBe(true);
    const impact = run(SEASON)[0]!;
    expect(impact.candidates).toEqual([{ teamKey: "frcHeld", weight: slateEntrantWeight(SEASON, "dcmp", 0, decorated) }]);
    const entrants = new Map(impact.pendingEvents[0]!.entrants.map((entrant) => [entrant.teamKey, entrant.weight] as const));
    expect(entrants.get("frcA")).toBe(slateEntrantWeight(SEASON, "district", 0, decorated));
    expect(entrants.get("frcB")).toBe(slateEntrantWeight(SEASON, "district", 0, plain));
    expect(entrants.get("frcA")).not.toBe(entrants.get("frcB"));
  });

  it("an entrant already holding that award at a final district event weighs 0 at the open event; a cross award stays open", () => {
    const [impact, engineeringInspiration] = run(SEASON);
    expect(impact!.pendingEvents[0]!.entrants.find((entrant) => entrant.teamKey === "frcHeld")!.weight).toBe(0);
    expect(engineeringInspiration!.pendingEvents[0]!.entrants.find((entrant) => entrant.teamKey === "frcHeld")!.weight).toBe(
      slateEntrantWeight(SEASON, "district", 9, decorated)
    );
  });

  it("a season with no slate tables weighs the audience: 1 inside it, 0 outside it", () => {
    expect(hasAwardSlateTables(AUDIENCE_SEASON, "dcmp")).toBe(false);
    expect(hasAwardSlateTables(AUDIENCE_SEASON, "district")).toBe(false);
    const [impact, engineeringInspiration, rookieAllStar] = run(AUDIENCE_SEASON);
    expect(impact!.candidates).toEqual([{ teamKey: "frcHeld", weight: 1 }]);
    expect(impact!.pendingEvents[0]!.entrants).toEqual([
      { teamKey: "frcHeld", weight: 0 },
      { teamKey: "frcA", weight: 1 },
      { teamKey: "frcB", weight: 1 },
      { teamKey: "frcR", weight: 1 },
    ]);
    expect(engineeringInspiration!.pendingEvents[0]!.entrants.find((entrant) => entrant.teamKey === "frcR")!.weight).toBe(0);
    expect(rookieAllStar!.pendingEvents[0]!.entrants.map((entrant) => entrant.weight)).toEqual([0, 0, 0, 1]);
  });

  it("eligibilityWeight applies the audience first at either tier: Rookie All Star rookies only, Engineering Inspiration veterans only", () => {
    for (const season of [SEASON, AUDIENCE_SEASON]) {
      for (const tier of ["district", "dcmp"] as const) {
        expect(eligibilityWeight(season, tier, 10, ZERO_AWARD_PROFILE)).toBe(0);
        expect(eligibilityWeight(season, tier, 9, ROOKIE)).toBe(0);
        expect(eligibilityWeight(season, tier, 10, ROOKIE)).toBeGreaterThan(0);
        expect(eligibilityWeight(season, tier, 0, ROOKIE)).toBeGreaterThan(0);
      }
    }
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
