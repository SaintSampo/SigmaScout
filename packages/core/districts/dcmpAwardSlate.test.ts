/**
 * The DCMP award slate (quick task 261014-i8i). Pure, synthetic, no corpus:
 * the corpus re measure of the literals lives in
 * `scripts/measureDcmpAwardSlate.test.ts`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dcmpAwardEligibility, type DcmpEligibilityTeam } from "./dcmpAwardEligibility.js";
import {
  buildDcmpAwardSlate,
  DCMP_AWARD_SLATE_SEASONS,
  DCMP_AWARD_SLATE_TABLES,
  dcmpAwardSlateTables,
  dcmpEventRoles,
  dcmpSlateAssignments,
  slateAwardOutcomeOdds,
  UnknownDcmpAwardSlateSeasonError,
  UnknownDcmpSlateTargetError,
  waterFill,
  type DcmpAwardSlateInput,
} from "./dcmpAwardSlate.js";
import { champCutoffTuning, dcmpAwardCountDistribution } from "./hypotheticalDcmp.js";
import type { DistrictAwardProfile } from "./ledgerSimulation.js";

const SEASON = 2026;

const meanOf = (weights: readonly number[]): number => weights.reduce((sum, weight, count) => sum + weight * count, 0) / weights.reduce((sum, weight) => sum + weight, 0);
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

describe("waterFill", () => {
  it("fills in proportion to the weights when no cap binds", () => {
    const filled = waterFill([1, 2, 1], [1, 1, 1], 1);
    expect(filled[0]).toBeCloseTo(0.25, 15);
    expect(filled[1]).toBeCloseTo(0.5, 15);
    expect(filled[2]).toBeCloseTo(0.25, 15);
  });

  it("caps a team at its cap and shares the rest: t_j = min(cap_j, lambda weight_j), summing to the total", () => {
    const weights = [10, 1, 1, 2];
    const caps = [0.5, 1, 1, 1];
    const total = 1.5;
    const filled = waterFill(weights, caps, total);
    expect(filled[0]).toBe(0.5);
    expect(sum(filled)).toBeCloseTo(total, 12);
    const lambda = filled[1]! / weights[1]!;
    for (let j = 1; j < weights.length; j++) expect(filled[j]).toBeCloseTo(Math.min(caps[j]!, lambda * weights[j]!), 12);
    for (let j = 0; j < weights.length; j++) expect(filled[j]!).toBeLessThanOrEqual(caps[j]! + 1e-15);
  });

  it("gives every cap when the caps sum below the total", () => {
    expect(waterFill([1, 3], [0.2, 0.3], 2)).toEqual([0.2, 0.3]);
  });

  it("is all zeros for a total of 0, and never gives mass to a zero weight or a zero cap", () => {
    expect(waterFill([1, 2], [1, 1], 0)).toEqual([0, 0]);
    const filled = waterFill([0, 1, 1], [1, 0, 1], 5);
    expect(filled).toEqual([0, 0, 1]);
    const share = waterFill([0, 1, 1], [1, 0, 1], 0.5);
    expect(share[0]).toBe(0);
    expect(share[1]).toBe(0);
    expect(share[2]).toBeCloseTo(0.5, 15);
  });
});

describe("dcmpEventRoles", () => {
  it("classifies divisions, finals and singles by key structure", () => {
    expect([...dcmpEventRoles(["2024micmp", "2024micmp1", "2024micmp2", "2024micmp3", "2024micmp4"])]).toEqual([
      ["2024micmp", "finals"],
      ["2024micmp1", "division"],
      ["2024micmp2", "division"],
      ["2024micmp3", "division"],
      ["2024micmp4", "division"],
    ]);
    // Two separate single championships in one district (2026 California).
    expect([...dcmpEventRoles(["2026cancmp", "2026cascmp"])]).toEqual([
      ["2026cancmp", "single"],
      ["2026cascmp", "single"],
    ]);
    // A key plus letters is not a division.
    expect(dcmpEventRoles(["2024txcmp", "2024txcmpx"]).get("2024txcmp")).toBe("single");
  });
});

describe("the committed tables", () => {
  it("are registered for 2023 to 2026, from the table's own keys", () => {
    expect(DCMP_AWARD_SLATE_SEASONS).toEqual([2023, 2024, 2025, 2026]);
    expect(Object.keys(DCMP_AWARD_SLATE_TABLES).map(Number)).toEqual([...DCMP_AWARD_SLATE_SEASONS]);
  });

  it("carry no lift class below 100 observations", () => {
    for (const season of DCMP_AWARD_SLATE_SEASONS) {
      const tables = dcmpAwardSlateTables(season);
      for (const record of [tables.impactLift, tables.engineeringInspirationLift, tables.judgedLiftCells, tables.judgedLiftBuckets]) {
        for (const lift of Object.values(record)) expect(lift!.n).toBeGreaterThanOrEqual(100);
      }
    }
  });

  it("throws for an unregistered season rather than borrowing one", () => {
    expect(() => dcmpAwardSlateTables(2019)).toThrow(UnknownDcmpAwardSlateSeasonError);
  });
});

// ---------------------------------------------------------------------------
// buildDcmpAwardSlate
// ---------------------------------------------------------------------------

function team(teamKey: string, overrides: Partial<DcmpEligibilityTeam> = {}): DcmpEligibilityTeam {
  return { teamKey, rookie: false, heldAwards: [], districtEventKeys: ["2026wabon"], ...overrides };
}

/** frc1 holds Impact, frc2 holds EI, frc3 holds RAS (a rookie), frc4 holds nothing; frc5 is entered at an open event. */
function eligibility() {
  return dcmpAwardEligibility({
    teams: [
      team("frc1", { heldAwards: [{ eventKey: "2026wabon", awardType: 0 }] }),
      team("frc2", { heldAwards: [{ eventKey: "2026wabon", awardType: 9 }] }),
      team("frc3", { rookie: true, heldAwards: [{ eventKey: "2026wabon", awardType: 10 }] }),
      team("frc4"),
      team("frc5", { districtEventKeys: ["2026wasno"] }),
      team("frc6", { districtEventKeys: ["2026wasno"] }),
    ],
    awardFinal: (key) => key === "2026wabon",
    weight: (entry, awardType) => (awardType === 10 ? (entry.rookie ? 1 : 0) : awardType === 9 ? (entry.rookie ? 0 : 1) : 1),
  });
}

const FIM_KEYS = ["2026micmp", "2026micmp1", "2026micmp2", "2026micmp3", "2026micmp4"];
const CA_KEYS = ["2026cancmp", "2026cascmp"];

describe("buildDcmpAwardSlate", () => {
  const setting = champCutoffTuning(SEASON).setting;
  const fim = dcmpAwardCountDistribution(SEASON, "2026fim", 83, setting.countMode);
  const ca = dcmpAwardCountDistribution(SEASON, "2026ca", 46, setting.countMode);
  const tables = dcmpAwardSlateTables(SEASON);

  it("gives a division judged awards only", () => {
    const slate = buildDcmpAwardSlate({ season: SEASON, districtKey: "2026fim", cmpSlots: 83, dcmpEventKeys: FIM_KEYS, target: { eventKey: "2026micmp2" }, eligibility: eligibility() });
    expect(slate.role).toBe("division");
    expect(slate.expected.impact).toBe(0);
    expect(slate.expected.engineeringInspiration).toBe(0);
    expect(slate.expected.rookieAllStar).toBe(0);
    expect(slate.expected.judged).toBe(tables.judgedAnchor.division.count);
    expect(slate.expected.judged).toBeGreaterThan(0);
  });

  it("gives a finals the champ count model's mean at its share, and its own judged anchor, which measures 0", () => {
    const slate = buildDcmpAwardSlate({ season: SEASON, districtKey: "2026fim", cmpSlots: 83, dcmpEventKeys: FIM_KEYS, target: { eventKey: "2026micmp" }, eligibility: eligibility() });
    expect(slate.role).toBe("finals");
    expect(slate.expected.impact).toBeCloseTo(meanOf(fim[0]), 12);
    expect(slate.expected.engineeringInspiration).toBeCloseTo(meanOf(fim[9]), 12);
    expect(slate.expected.rookieAllStar).toBeCloseTo(meanOf(fim[10]), 12);
    expect(slate.expected.judged).toBe(tables.judgedAnchor.finals.count);
    expect(slate.expected.judged).toBe(0);
  });

  it("splits a single championship's consuming counts by the district's championship count", () => {
    const slate = buildDcmpAwardSlate({ season: SEASON, districtKey: "2026ca", cmpSlots: 46, dcmpEventKeys: CA_KEYS, target: { eventKey: "2026cascmp" }, eligibility: eligibility() });
    expect(slate.role).toBe("single");
    expect(slate.expected.impact).toBeCloseTo(meanOf(ca[0]) / 2, 12);
    expect(slate.expected.engineeringInspiration).toBeCloseTo(meanOf(ca[9]) / 2, 12);
    expect(slate.expected.rookieAllStar).toBeCloseTo(meanOf(ca[10]) / 2, 12);
    expect(slate.expected.judged).toBe(tables.judgedAnchor.single.count);
  });

  it("prices a whole championship at the full share plus each single or division key's judged anchor", () => {
    const whole = buildDcmpAwardSlate({ season: SEASON, districtKey: "2026fim", cmpSlots: 83, dcmpEventKeys: FIM_KEYS, target: "wholeChampionship", eligibility: eligibility() });
    expect(whole.role).toBe("wholeChampionship");
    expect(whole.expected.impact).toBeCloseTo(meanOf(fim[0]), 12);
    expect(whole.expected.judged).toBeCloseTo(4 * tables.judgedAnchor.division.count, 12);
    // No key known yet: at least one single championship's judged anchor.
    const unknown = buildDcmpAwardSlate({ season: SEASON, districtKey: "2026fim", cmpSlots: 83, dcmpEventKeys: [], target: "wholeChampionship", eligibility: eligibility() });
    expect(unknown.expected.judged).toBe(tables.judgedAnchor.single.count);
    expect(unknown.expected.impact).toBeCloseTo(meanOf(fim[0]), 12);
  });

  it("lists only teams with a chance above 0, sorted by key, and names its sources", () => {
    const slate = buildDcmpAwardSlate({ season: SEASON, districtKey: "2026ca", cmpSlots: 46, dcmpEventKeys: CA_KEYS, target: { eventKey: "2026cancmp" }, eligibility: eligibility() });
    expect(slate.eligibility.map((entry) => entry.teamKey)).toEqual(["frc1", "frc2", "frc3", "frc5", "frc6"]);
    expect(slate.eligibility.find((entry) => entry.teamKey === "frc1")).toEqual({ teamKey: "frc1", impact: 1, engineeringInspiration: 0, rookieAllStar: 0 });
    expect(slate.eligibility.find((entry) => entry.teamKey === "frc5")).toEqual({ teamKey: "frc5", impact: 0.5, engineeringInspiration: 0.5, rookieAllStar: 0 });
    expect(slate.sources.judged).toBe("role");
    expect(["previousSeason", "sizeBand", "none"]).toContain(slate.sources.counts);
    expect(structuredClone(slate)).toEqual(slate);
  });

  it("throws for an unregistered season and for a target that is not one of the district's keys", () => {
    expect(() =>
      buildDcmpAwardSlate({ season: 2019, districtKey: "2019fim", cmpSlots: 80, dcmpEventKeys: ["2019micmp"], target: { eventKey: "2019micmp" }, eligibility: eligibility() })
    ).toThrow(UnknownDcmpAwardSlateSeasonError);
    expect(() =>
      buildDcmpAwardSlate({ season: SEASON, districtKey: "2026fim", cmpSlots: 83, dcmpEventKeys: FIM_KEYS, target: { eventKey: "2026necmp" }, eligibility: eligibility() })
    ).toThrow(UnknownDcmpSlateTargetError);
  });
});

// ---------------------------------------------------------------------------
// dcmpSlateAssignments
// ---------------------------------------------------------------------------

function profile(rookie: boolean, priorJudgedAwards: number, priorImpactWins: number): DistrictAwardProfile {
  return {
    bucket: priorJudgedAwards === 0 ? "none" : priorJudgedAwards <= 2 ? "one-or-two" : "three-or-more",
    rookieState: rookie ? "rookie" : "veteran",
    priorJudgedAwards,
    priorImpactWins,
  };
}

describe("dcmpSlateAssignments", () => {
  const field = Array.from({ length: 30 }, (_, i) => ({ teamKey: `frc${String(i + 1)}` }));
  const profiles = new Map<string, DistrictAwardProfile>(
    field.map((member, i) => [member.teamKey, profile(i >= 26, i < 26 ? (i * 7) % 9 : 0, i < 6 ? i % 4 : 0)] as const)
  );
  const slate: DcmpAwardSlateInput = {
    role: "single",
    expected: { impact: 2, engineeringInspiration: 1.5, rookieAllStar: 1, judged: 12 },
    sources: { counts: "previousSeason", judged: "role" },
    eligibility: [
      { teamKey: "frc1", impact: 1, engineeringInspiration: 1, rookieAllStar: 0 },
      { teamKey: "frc2", impact: 1, engineeringInspiration: 0, rookieAllStar: 0 },
      { teamKey: "frc3", impact: 0.5, engineeringInspiration: 0, rookieAllStar: 0 },
      { teamKey: "frc4", impact: 1, engineeringInspiration: 1, rookieAllStar: 0 },
      { teamKey: "frc5", impact: 0, engineeringInspiration: 1, rookieAllStar: 0 },
      { teamKey: "frc6", impact: 0, engineeringInspiration: 1, rookieAllStar: 0 },
      // A rookie with an EI chance on the slate still gets none: rookies never win EI.
      { teamKey: "frc27", impact: 0, engineeringInspiration: 1, rookieAllStar: 1 },
      { teamKey: "frc28", impact: 0, engineeringInspiration: 0, rookieAllStar: 1 },
      // A veteran with an RAS chance on the slate still gets none.
      { teamKey: "frc7", impact: 0, engineeringInspiration: 0, rookieAllStar: 1 },
    ].sort((a, b) => (a.teamKey < b.teamKey ? -1 : 1)),
  };
  const assignments = dcmpSlateAssignments(SEASON, field, profiles, slate);
  const byKey = new Map(assignments.map((assignment) => [assignment.teamKey, assignment] as const));
  const eligibleKeys = new Set(slate.eligibility.map((entry) => entry.teamKey));

  it("gives an ineligible team exactly 0 Impact and 0 for the 8 point award", () => {
    for (const member of field) {
      if (eligibleKeys.has(member.teamKey)) continue;
      expect(byKey.get(member.teamKey)!.impact, member.teamKey).toBe(0);
      expect(byKey.get(member.teamKey)!.eight, member.teamKey).toBe(0);
    }
    expect(byKey.get("frc5")!.impact).toBe(0);
  });

  it("gives a rookie no Engineering Inspiration and a veteran no Rookie All Star", () => {
    // frc27 is a rookie: its 8 point chance is Rookie All Star only.
    const rookieOnly = dcmpSlateAssignments(SEASON, field, profiles, { ...slate, expected: { ...slate.expected, rookieAllStar: 0 } });
    expect(rookieOnly.find((entry) => entry.teamKey === "frc27")!.eight).toBe(0);
    // frc7 is a veteran with no EI chance: its 8 point chance is 0 whatever the RAS count.
    expect(byKey.get("frc7")!.eight).toBe(0);
  });

  it("sums the Impact chances to the expected count when the caps allow, and never above a team's eligibility", () => {
    expect(sum(assignments.map((entry) => entry.impact))).toBeCloseTo(2, 12);
    expect(byKey.get("frc3")!.impact).toBeLessThanOrEqual(0.5);
    const rookieEight = assignments.filter((entry) => profiles.get(entry.teamKey)!.rookieState === "rookie").map((entry) => entry.eight);
    expect(sum(rookieEight)).toBeCloseTo(1, 12);
    const veteranEight = assignments.filter((entry) => profiles.get(entry.teamKey)!.rookieState !== "rookie").map((entry) => entry.eight);
    expect(sum(veteranEight)).toBeCloseTo(1.5, 12);
  });

  it("gives every eligible team its cap when the expected count exceeds the caps", () => {
    const heavy = dcmpSlateAssignments(SEASON, field, profiles, { ...slate, expected: { ...slate.expected, impact: 10 } });
    for (const entry of slate.eligibility) expect(heavy.find((assignment) => assignment.teamKey === entry.teamKey)!.impact).toBe(entry.impact);
  });

  it("makes the expected judged winners equal J, going to teams that won no consuming award", () => {
    const expectedJudged = sum(assignments.map((entry) => (1 - entry.impact) * (1 - entry.eight) * entry.judged));
    expect(expectedJudged).toBeCloseTo(12, 9);
    for (const entry of assignments) {
      expect(entry.judged).toBeGreaterThanOrEqual(0);
      expect(entry.judged).toBeLessThanOrEqual(1);
      const odds = slateAwardOutcomeOdds(entry);
      expect(odds.p10 + odds.p8 + odds.p5 + odds.p0).toBeCloseTo(1, 12);
      expect(odds.impact).toBe(entry.impact);
    }
    expect(assignments.every((entry) => entry.judgedSource === "cell")).toBe(true);
  });

  it("prices every team at lift 1 (season pooled) when any profile lacks a prior count", () => {
    const partial = new Map(profiles);
    partial.set("frc10", { bucket: "none", rookieState: "veteran" });
    const pooled = dcmpSlateAssignments(SEASON, field, partial, slate);
    expect(pooled.every((entry) => entry.judgedSource === "season-pooled")).toBe(true);
    // At lift 1 the Impact fill is proportional to eligibility alone.
    const impactOf = (key: string): number => pooled.find((entry) => entry.teamKey === key)!.impact;
    expect(impactOf("frc1")).toBeCloseTo(impactOf("frc2"), 12);
    expect(impactOf("frc3")).toBeCloseTo(impactOf("frc1") / 2, 12);
  });
});

describe("dcmpAwardSlate.ts imports", () => {
  it("imports nothing from locks.js: no award prediction may reach a Locked verdict", () => {
    const source = readFileSync(new URL("./dcmpAwardSlate.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]!);
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.filter((specifier) => specifier.endsWith("locks.js"))).toEqual([]);
  });
});
