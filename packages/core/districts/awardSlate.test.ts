/**
 * The one award slate (quick task 261014-qje). Pure, synthetic, no corpus:
 * the corpus re measure of the literals lives in
 * `scripts/measureAwardSlate.test.ts`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DISTRICT_POINT_AWARD_VALUES } from "./awardBaseRates.js";
import type { DcmpEligibilityTeam } from "./dcmpAwardEligibility.js";
import {
  AWARD_SLATE_TABLES,
  AWARD_SLOTS,
  awardSlateTables,
  buildDistrictAwardSlate,
  DCMP_TIER_AWARD_SLATE_SEASONS,
  declaredSlotCounts,
  DISTRICT_AWARD_SLATE_SEASONS,
  districtAwardEligibility,
  hasAwardSlateTables,
  highestAwardSlot,
  inSlotAudience,
  MissingSlateEligibilityError,
  MissingSlateProfileError,
  SEASON_AWARD_TYPES,
  seasonAwardTypes,
  slateAssignments,
  slateAwardOutcomeOdds,
  slateClassKeys,
  slateEntrantWeight,
  slateLift,
  SLOT_POINTS,
  TYPE_SLOT,
  UnknownAwardSlateSeasonError,
  UnknownSeasonAwardListError,
  UnslottedAwardTypeError,
  waterFill,
  type AwardSlateInput,
  type SlateEligibility,
} from "./awardSlate.js";
import { ZERO_AWARD_PROFILE, type DistrictAwardProfile } from "./ledgerSimulation.js";

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

describe("the slots (Q-02)", () => {
  it("are five, in pricing order, with their points", () => {
    expect([...AWARD_SLOTS]).toEqual(["impact", "engineeringInspiration", "rookieAllStar", "judgedRookie", "judged"]);
    expect(SLOT_POINTS).toEqual({ impact: 10, engineeringInspiration: 8, rookieAllStar: 8, judgedRookie: 5, judged: 5 });
  });

  it("TYPE_SLOT is the Q-02 map, its keys equal DISTRICT_POINT_AWARD_VALUES' keys and each type pays its slot's points", () => {
    expect([...TYPE_SLOT].sort((a, b) => a[0] - b[0])).toEqual([
      [0, "impact"],
      [9, "engineeringInspiration"],
      [10, "rookieAllStar"],
      [11, "judged"],
      [13, "judged"],
      [15, "judgedRookie"],
      [16, "judged"],
      [17, "judged"],
      [18, "judged"],
      [20, "judged"],
      [21, "judged"],
      [22, "judged"],
      [27, "judged"],
      [29, "judged"],
      [30, "judged"],
      [71, "judged"],
      [82, "judged"],
      [83, "judged"],
    ]);
    expect([...TYPE_SLOT.keys()].sort((a, b) => a - b)).toEqual([...DISTRICT_POINT_AWARD_VALUES.keys()].sort((a, b) => a - b));
    for (const [type, slot] of TYPE_SLOT) expect(SLOT_POINTS[slot], `type ${String(type)}`).toBe(DISTRICT_POINT_AWARD_VALUES.get(type));
  });

  it("audiences: veterans only for Engineering Inspiration, rookies only for Rookie All Star and judgedRookie; unknown counts as a veteran", () => {
    expect(inSlotAudience("engineeringInspiration", "rookie")).toBe(false);
    expect(inSlotAudience("engineeringInspiration", "unknown")).toBe(true);
    expect(inSlotAudience("rookieAllStar", "veteran")).toBe(false);
    expect(inSlotAudience("rookieAllStar", "unknown")).toBe(false);
    expect(inSlotAudience("judgedRookie", "rookie")).toBe(true);
    expect(inSlotAudience("impact", "rookie")).toBe(true);
    expect(inSlotAudience("judged", "unknown")).toBe(true);
  });

  it("the highest award slot follows pricing order and ignores non point types", () => {
    expect(highestAwardSlot([20, 0])).toBe("impact");
    expect(highestAwardSlot([15, 11])).toBe("judgedRookie");
    expect(highestAwardSlot([4, 1, 2])).toBeUndefined();
    expect(highestAwardSlot([])).toBeUndefined();
  });
});

describe("the declared season award lists (Q-03)", () => {
  it("cover exactly the award seasons", () => {
    expect(Object.keys(SEASON_AWARD_TYPES).map(Number)).toEqual([2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026]);
  });

  it("refuse an undeclared season, never default", () => {
    expect(() => seasonAwardTypes(2021)).toThrow(UnknownSeasonAwardListError);
    expect(() => seasonAwardTypes(2027)).toThrow(UnknownSeasonAwardListError);
  });

  it("refuse a declared type TYPE_SLOT does not map", () => {
    expect(() => seasonAwardTypes(2030, { 2030: [0, 99] })).toThrow(UnslottedAwardTypeError);
  });

  it("retire Rookie Inspiration after 2024 and add Rising All Star in 2025", () => {
    expect(seasonAwardTypes(2024)).toContain(15);
    expect(seasonAwardTypes(2025)).not.toContain(15);
    expect(seasonAwardTypes(2024)).not.toContain(83);
    expect(seasonAwardTypes(2025)).toContain(83);
  });
});

describe("the committed tables", () => {
  it("are registered for 2023 to 2026 at both tiers, from the tables' own keys", () => {
    expect([...DISTRICT_AWARD_SLATE_SEASONS]).toEqual([2023, 2024, 2025, 2026]);
    expect([...DCMP_TIER_AWARD_SLATE_SEASONS]).toEqual([2023, 2024, 2025, 2026]);
    expect(hasAwardSlateTables(2022, "district")).toBe(false);
    expect(() => awardSlateTables(2022, "district")).toThrow(UnknownAwardSlateSeasonError);
    expect(() => awardSlateTables(2022, "dcmp")).toThrow(/dcmp tier/);
  });

  it("carry no lift class below 100 observations", () => {
    for (const tier of ["district", "dcmp"] as const) {
      for (const tables of Object.values(AWARD_SLATE_TABLES[tier])) {
        for (const slot of AWARD_SLOTS) {
          for (const lift of [...Object.values(tables.lifts[slot].cells), ...Object.values(tables.lifts[slot].primary)]) expect(lift.n).toBeGreaterThanOrEqual(100);
        }
      }
    }
  });

  it("carry a count for every type each season declares, and no qualifying award count at the DCMP", () => {
    for (const season of DISTRICT_AWARD_SLATE_SEASONS) {
      const declared = seasonAwardTypes(season);
      expect(Object.keys(awardSlateTables(season, "district").counts.district!).map(Number)).toEqual([...declared]);
      for (const role of ["single", "division", "finals"] as const) {
        expect(Object.keys(awardSlateTables(season, "dcmp").counts[role]!).map(Number)).toEqual(declared.filter((type) => type !== 0 && type !== 9 && type !== 10));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// District eligibility (Q-05)
// ---------------------------------------------------------------------------

function team(teamKey: string, overrides: Partial<DcmpEligibilityTeam> = {}): DcmpEligibilityTeam {
  return { teamKey, rookie: false, heldAwards: [], districtEventKeys: [], ...overrides };
}

describe("districtAwardEligibility", () => {
  const WEEKS = new Map<string, number | null>([
    ["2026w1", 1],
    ["2026w1b", 1],
    ["2026w2", 2],
    ["2026w3", 3],
    ["2026wnull", null],
  ]);
  const weekOf = (key: string): number | null => WEEKS.get(key) ?? null;
  // 2019 has no slate tables at either tier, so every weight is the audience
  // weight (Q-11): 1 for a veteran's Impact, which is what these exact
  // pending chances read.
  const AUDIENCE_SEASON = 2019;

  it("a final earlier week Impact holder cannot win Impact again, and keeps Engineering Inspiration open", () => {
    const out = districtAwardEligibility({
      eventKey: "2026w3",
      teams: [team("frc1", { heldAwards: [{ eventKey: "2026w1", awardType: 0 }], districtEventKeys: ["2026w1", "2026w3"] })],
      weekOf,
      awardFinal: () => true,
      season: AUDIENCE_SEASON,
      profileOf: () => ZERO_AWARD_PROFILE,
    });
    expect(out).toEqual([{ teamKey: "frc1", impact: 0, engineeringInspiration: 1, rookieAllStar: 1 }]);
  });

  it("a later week, same week or null week Impact changes nothing", () => {
    for (const [held, priced] of [
      ["2026w3", "2026w1"],
      ["2026w1b", "2026w1"],
      ["2026wnull", "2026w3"],
      ["2026w1", "2026wnull"],
    ] as const) {
      const out = districtAwardEligibility({
        eventKey: priced,
        teams: [team("frc1", { heldAwards: [{ eventKey: held, awardType: 0 }], districtEventKeys: [held, priced] })],
        weekOf,
        awardFinal: () => true,
        season: AUDIENCE_SEASON,
        profileOf: () => ZERO_AWARD_PROFILE,
      });
      expect(out[0]!.impact, `${held} before ${priced}`).toBe(1);
    }
  });

  it("an open earlier event at weight 1 of 4 leaves 0.75; two open earlier events (1 of 4, 1 of 2) leave 0.375", () => {
    const others = (key: string, count: number): DcmpEligibilityTeam[] =>
      Array.from({ length: count }, (_, i) => team(`frc${key}${String(i)}`, { districtEventKeys: [key] }));
    const one = districtAwardEligibility({
      eventKey: "2026w3",
      teams: [team("frc1", { districtEventKeys: ["2026w1", "2026w3"] }), ...others("2026w1", 3)],
      weekOf,
      awardFinal: (key) => key !== "2026w1",
      season: AUDIENCE_SEASON,
      profileOf: () => ZERO_AWARD_PROFILE,
    });
    expect(one.find((entry) => entry.teamKey === "frc1")!.impact).toBeCloseTo(0.75, 15);
    const two = districtAwardEligibility({
      eventKey: "2026w3",
      teams: [team("frc1", { districtEventKeys: ["2026w1", "2026w2", "2026w3"] }), ...others("2026w1", 3), ...others("2026w2", 1)],
      weekOf,
      awardFinal: (key) => key === "2026w3",
      season: AUDIENCE_SEASON,
      profileOf: () => ZERO_AWARD_PROFILE,
    });
    expect(two.find((entry) => entry.teamKey === "frc1")!.impact).toBeCloseTo(0.375, 15);
  });

  it("weighs an open earlier event's entrants by their district tier class lift in a season with slate tables (Q-11)", () => {
    const decorated = profile(false, 5, 1);
    const plain = profile(false, 0, 0);
    const teams = [
      team("frc1", { districtEventKeys: ["2026w1", "2026w3"] }),
      team("frc2", { districtEventKeys: ["2026w1"] }),
    ];
    const profileOf = (key: string): DistrictAwardProfile => (key === "frc1" ? decorated : plain);
    const out = districtAwardEligibility({ season: 2026, eventKey: "2026w3", teams, weekOf, awardFinal: (key) => key !== "2026w1", profileOf });
    const w1 = slateEntrantWeight(2026, "district", 0, decorated);
    const w2 = slateEntrantWeight(2026, "district", 0, plain);
    expect(w1).not.toBe(w2);
    expect(out.find((entry) => entry.teamKey === "frc1")!.impact).toBeCloseTo(1 - w1 / (w1 + w2), 15);
  });
});

// ---------------------------------------------------------------------------
// The assignments (Q-08)
// ---------------------------------------------------------------------------

function profile(rookie: boolean, priorJudgedAwards: number, priorImpactWins: number): DistrictAwardProfile {
  return {
    bucket: priorJudgedAwards === 0 ? "none" : priorJudgedAwards <= 2 ? "one-or-two" : "three-or-more",
    rookieState: rookie ? "rookie" : "veteran",
    priorJudgedAwards,
    priorImpactWins,
  };
}

const FIELD = Array.from({ length: 30 }, (_, i) => ({ teamKey: `frc${String(i + 1)}` }));
/** Teams 27 to 30 are rookies; the rest veterans of varied decoration. */
const PROFILES = new Map<string, DistrictAwardProfile>(
  FIELD.map((member, i) => [member.teamKey, profile(i >= 26, i < 26 ? (i * 7) % 9 : 0, i < 6 ? i % 4 : 0)] as const)
);
const ALL_ELIGIBLE: SlateEligibility[] = FIELD.map((member) => ({ teamKey: member.teamKey, impact: 1, engineeringInspiration: 1, rookieAllStar: 1 })).sort((a, b) =>
  a.teamKey < b.teamKey ? -1 : 1
);

function districtSlate(overrides: Partial<AwardSlateInput["expected"]> = {}, eligibility: SlateEligibility[] = ALL_ELIGIBLE): AwardSlateInput {
  return {
    role: "district",
    expected: { impact: 1, engineeringInspiration: 1, rookieAllStar: 0.9, judgedRookie: 0.8, judged: 11, ...overrides },
    sources: { counts: "role", judged: "role" },
    eligibility,
  };
}

describe("slateAssignments", () => {
  const SEASON = 2026;
  const isRookie = (key: string): boolean => PROFILES.get(key)!.rookieState === "rookie";

  it("delivers each slot's count when the caps allow, and p10 + p8 + p5 + p0 = 1 for every team", () => {
    const slate = districtSlate();
    const assignments = slateAssignments(SEASON, FIELD, PROFILES, slate);
    const odds = assignments.map((entry) => ({ key: entry.teamKey, ...slateAwardOutcomeOdds(entry) }));
    expect(sum(odds.map((o) => o.p10))).toBeCloseTo(1, 12);
    expect(sum(odds.filter((o) => !isRookie(o.key)).map((o) => o.p8))).toBeCloseTo(1, 12);
    expect(sum(odds.filter((o) => isRookie(o.key)).map((o) => o.p8))).toBeCloseTo(0.9, 12);
    expect(sum(odds.map((o) => o.p5))).toBeCloseTo(0.8 + 11, 9);
    for (const o of odds) expect(o.p10 + o.p8 + o.p5 + o.p0, o.key).toBeCloseTo(1, 12);
  });

  it("gives a rookie no Engineering Inspiration, a veteran no Rookie All Star and no judgedRookie", () => {
    const eiOnly = slateAssignments(SEASON, FIELD, PROFILES, districtSlate({ impact: 0, rookieAllStar: 0, judgedRookie: 0, judged: 0 }));
    for (const entry of eiOnly) if (isRookie(entry.teamKey)) expect(entry.eight, entry.teamKey).toBe(0);
    const rasOnly = slateAssignments(SEASON, FIELD, PROFILES, districtSlate({ impact: 0, engineeringInspiration: 0, judgedRookie: 0, judged: 0 }));
    for (const entry of rasOnly) if (!isRookie(entry.teamKey)) expect(entry.eight, entry.teamKey).toBe(0);
    const rookieFive = slateAssignments(SEASON, FIELD, PROFILES, districtSlate({ impact: 0, engineeringInspiration: 0, rookieAllStar: 0, judged: 0 }));
    for (const entry of rookieFive) if (!isRookie(entry.teamKey)) expect(entry.judged, entry.teamKey).toBe(0);
    expect(sum(rookieFive.map((entry) => slateAwardOutcomeOdds(entry).p5))).toBeCloseTo(0.8, 12);
  });

  it("gives a team with Impact chance 0 by eligibility exactly 0 at 10", () => {
    const eligibility = ALL_ELIGIBLE.map((entry) => (entry.teamKey === "frc4" ? { ...entry, impact: 0 } : entry));
    const assignments = slateAssignments(SEASON, FIELD, PROFILES, districtSlate({}, eligibility));
    expect(slateAwardOutcomeOdds(assignments.find((entry) => entry.teamKey === "frc4")!).p10).toBe(0);
    expect(sum(assignments.map((entry) => entry.impact))).toBeCloseTo(1, 12);
  });

  it("a season list without type 15 gives judgedRookie count 0, so no rookie only 5 point mass", () => {
    const slate = buildDistrictAwardSlate({ season: 2025, awardField: FIELD, eligibility: ALL_ELIGIBLE });
    expect(slate.expected.judgedRookie).toBe(0);
    const withoutJudged = slateAssignments(2025, FIELD, PROFILES, { ...slate, expected: { ...slate.expected, judged: 0 } });
    for (const entry of withoutJudged) expect(slateAwardOutcomeOdds(entry).p5, entry.teamKey).toBe(0);
  });

  it("refuses a field member with no profile, and a district slate that does not list a member", () => {
    const missing = new Map(PROFILES);
    missing.delete("frc9");
    expect(() => slateAssignments(SEASON, FIELD, missing, districtSlate())).toThrow(MissingSlateProfileError);
    expect(() => slateAssignments(SEASON, FIELD, PROFILES, districtSlate({}, ALL_ELIGIBLE.slice(1)))).toThrow(MissingSlateEligibilityError);
  });

  it("prices every team at lift 1 (season pooled) when any profile lacks a count", () => {
    const partial = new Map(PROFILES);
    partial.set("frc10", { bucket: "none", rookieState: "veteran" });
    const pooled = slateAssignments(SEASON, FIELD, partial, districtSlate());
    expect(pooled.every((entry) => entry.judgedSource === "season-pooled")).toBe(true);
    const impacts = pooled.map((entry) => entry.impact);
    for (const value of impacts) expect(value).toBeCloseTo(1 / 30, 12);
  });

  it("weights Impact by the measured class lift", () => {
    const tables = awardSlateTables(SEASON, "district");
    const assignments = slateAssignments(SEASON, FIELD, PROFILES, districtSlate());
    const a = assignments.find((entry) => entry.teamKey === "frc4")!; // 3 prior Impact wins, decorated
    const b = assignments.find((entry) => entry.teamKey === "frc8")!; // no prior Impact win
    const liftA = slateLift(tables, "impact", { priorJudgedAwards: PROFILES.get("frc4")!.priorJudgedAwards!, priorImpactWins: 3, rookieState: "veteran" }).lift;
    const liftB = slateLift(tables, "impact", { priorJudgedAwards: PROFILES.get("frc8")!.priorJudgedAwards!, priorImpactWins: 0, rookieState: "veteran" }).lift;
    expect(a.impact / b.impact).toBeCloseTo(liftA / liftB, 9);
  });
});

/**
 * HEAD's 261014-i8i `dcmpSlateAssignments`, restated with lift 1 everywhere:
 * the reference the Q-08 room rule changes only where an 8 point candidate
 * also has an Impact chance.
 */
function legacyDcmpAssignmentsAtLiftOne(field: readonly { teamKey: string }[], rookies: ReadonlySet<string>, slate: AwardSlateInput): { impact: number; eight: number; judged: number }[] {
  const byTeam = new Map(slate.eligibility.map((entry) => [entry.teamKey, entry] as const));
  const qI = field.map((m) => byTeam.get(m.teamKey)?.impact ?? 0);
  const qE = field.map((m) => (rookies.has(m.teamKey) ? 0 : byTeam.get(m.teamKey)?.engineeringInspiration ?? 0));
  const qR = field.map((m) => (rookies.has(m.teamKey) ? byTeam.get(m.teamKey)?.rookieAllStar ?? 0 : 0));
  const impact = waterFill(qI, qI, slate.expected.impact);
  const ei = waterFill(qE, qE, slate.expected.engineeringInspiration);
  const ras = waterFill(qR, qR, slate.expected.rookieAllStar);
  const eight = field.map((m, j) => (rookies.has(m.teamKey) ? ras[j]! : ei[j]!));
  const free = field.map((_, j) => (1 - impact[j]!) * (1 - eight[j]!));
  const filled = waterFill(free, free, slate.expected.judged);
  return field.map((_, j) => ({ impact: impact[j]!, eight: eight[j]!, judged: free[j]! > 0 ? Math.min(1, filled[j]! / free[j]!) : 0 }));
}

describe("the DCMP slate against HEAD's dcmpSlateAssignments", () => {
  const partial = new Map(PROFILES);
  partial.set("frc30", { bucket: "none", rookieState: "rookie" }); // lift 1 everywhere: the old RAS fill had no lift
  const rookies = new Set(FIELD.filter((m) => PROFILES.get(m.teamKey)!.rookieState === "rookie").map((m) => m.teamKey));

  it("reproduces the old output within 1e-12 with judgedRookie 0 and no room effect", () => {
    // Impact candidates frc1 to frc3 hold no 8 point chance, so the Q-08 room rule changes nothing.
    const slate: AwardSlateInput = {
      role: "single",
      expected: { impact: 1.5, engineeringInspiration: 1.2, rookieAllStar: 1, judgedRookie: 0, judged: 12 },
      sources: { counts: "previousSeason", judged: "role" },
      eligibility: [
        { teamKey: "frc1", impact: 1, engineeringInspiration: 0, rookieAllStar: 0 },
        { teamKey: "frc2", impact: 0.5, engineeringInspiration: 0, rookieAllStar: 0 },
        { teamKey: "frc3", impact: 1, engineeringInspiration: 0, rookieAllStar: 0 },
        { teamKey: "frc5", impact: 0, engineeringInspiration: 1, rookieAllStar: 0 },
        { teamKey: "frc6", impact: 0, engineeringInspiration: 0.4, rookieAllStar: 0 },
        { teamKey: "frc7", impact: 0, engineeringInspiration: 1, rookieAllStar: 0 },
        { teamKey: "frc28", impact: 0, engineeringInspiration: 0, rookieAllStar: 1 },
        { teamKey: "frc29", impact: 0, engineeringInspiration: 0, rookieAllStar: 1 },
      ].sort((a, b) => (a.teamKey < b.teamKey ? -1 : 1)),
    };
    const fresh = slateAssignments(2026, FIELD, partial, slate);
    const old = legacyDcmpAssignmentsAtLiftOne(FIELD, rookies, slate);
    fresh.forEach((entry, j) => {
      expect(Math.abs(entry.impact - old[j]!.impact), entry.teamKey).toBeLessThan(1e-12);
      expect(Math.abs(entry.eight - old[j]!.eight), entry.teamKey).toBeLessThan(1e-12);
      expect(Math.abs(entry.judged - old[j]!.judged), entry.teamKey).toBeLessThan(1e-12);
    });
  });

  it("differs only where the Q-08 room rule applies: an Impact candidate's 8 point fill uses the room left after Impact", () => {
    const slate: AwardSlateInput = {
      role: "single",
      expected: { impact: 1, engineeringInspiration: 1, rookieAllStar: 0, judgedRookie: 0, judged: 0 },
      sources: { counts: "previousSeason", judged: "role" },
      eligibility: [
        { teamKey: "frc1", impact: 1, engineeringInspiration: 1, rookieAllStar: 0 },
        { teamKey: "frc2", impact: 0, engineeringInspiration: 1, rookieAllStar: 0 },
      ],
    };
    const fresh = slateAssignments(2026, FIELD, partial, slate);
    const odds = fresh.map((entry) => slateAwardOutcomeOdds(entry));
    // The one Impact goes to frc1; the one Engineering Inspiration can only go to frc2, delivered exactly.
    expect(odds[0]!.p10).toBeCloseTo(1, 12);
    expect(odds[0]!.p8).toBeCloseTo(0, 12);
    expect(odds[1]!.p8).toBeCloseTo(1, 12);
    const old = legacyDcmpAssignmentsAtLiftOne(FIELD, rookies, slate);
    // The old fill shared Engineering Inspiration half and half, then lost frc1's half under Impact.
    expect(old[0]!.eight).toBeCloseTo(0.5, 12);
    expect(old[1]!.eight).toBeCloseTo(0.5, 12);
  });
});

describe("buildDistrictAwardSlate", () => {
  it("sums each slot's declared type counts, and lists every field member", () => {
    for (const season of DISTRICT_AWARD_SLATE_SEASONS) {
      const slate = buildDistrictAwardSlate({ season, awardField: FIELD, eligibility: ALL_ELIGIBLE.slice(5) });
      const counts = awardSlateTables(season, "district").counts.district!;
      const declared = seasonAwardTypes(season);
      const of = (slot: string): number => sum(declared.filter((type) => TYPE_SLOT.get(type) === slot).map((type) => counts[type]!.count));
      expect(slate.role).toBe("district");
      expect(slate.expected.impact).toBeCloseTo(of("impact"), 12);
      expect(slate.expected.engineeringInspiration).toBeCloseTo(of("engineeringInspiration"), 12);
      expect(slate.expected.rookieAllStar).toBeCloseTo(of("rookieAllStar"), 12);
      expect(slate.expected.judgedRookie).toBeCloseTo(of("judgedRookie"), 12);
      expect(slate.expected.judged).toBeCloseTo(of("judged"), 12);
      expect(slate.eligibility.map((entry) => entry.teamKey)).toEqual(FIELD.map((m) => m.teamKey).sort());
      // A member the eligibility input does not list held nothing earlier.
      expect(slate.eligibility.find((entry) => entry.teamKey === "frc1")).toEqual({ teamKey: "frc1", impact: 1, engineeringInspiration: 1, rookieAllStar: 1 });
      expect(structuredClone(slate)).toEqual(slate);
    }
  });

  it("names the Q-10 new award prior for a first season type: 82 in 2023, 83 in 2025", () => {
    expect(buildDistrictAwardSlate({ season: 2023, awardField: FIELD, eligibility: ALL_ELIGIBLE }).sources).toEqual({ counts: "role", judged: "new-award", newAwardTypes: [82] });
    expect(buildDistrictAwardSlate({ season: 2024, awardField: FIELD, eligibility: ALL_ELIGIBLE }).sources).toEqual({ counts: "role", judged: "role" });
    expect(buildDistrictAwardSlate({ season: 2025, awardField: FIELD, eligibility: ALL_ELIGIBLE }).sources.newAwardTypes).toEqual([83]);
    const counts = awardSlateTables(2025, "district").counts.district!;
    const others = seasonAwardTypes(2025).filter((type) => type !== 83 && DISTRICT_POINT_AWARD_VALUES.get(type) === 5);
    expect(counts[83]!.count).toBeCloseTo(sum(others.map((type) => counts[type]!.count)) / others.length, 12);
  });

  it("throws for an unregistered season", () => {
    expect(() => buildDistrictAwardSlate({ season: 2022, awardField: FIELD, eligibility: ALL_ELIGIBLE })).toThrow(UnknownAwardSlateSeasonError);
    expect(() => declaredSlotCounts(2027, "district", "district", { skipQualifying: false })).toThrow(UnknownAwardSlateSeasonError);
  });
});

describe("slateEntrantWeight and the class keys (Q-06)", () => {
  it("is 0 outside the award's audience and the slot's class lift inside it", () => {
    const veteran = profile(false, 4, 2);
    const rookie = profile(true, 0, 0);
    expect(slateEntrantWeight(2026, "district", 10, veteran)).toBe(0);
    expect(slateEntrantWeight(2026, "district", 9, rookie)).toBe(0);
    const tables = awardSlateTables(2026, "district");
    expect(slateEntrantWeight(2026, "district", 0, veteran)).toBe(slateLift(tables, "impact", { priorJudgedAwards: 4, priorImpactWins: 2, rookieState: "veteran" }).lift);
    expect(slateEntrantWeight(2026, "dcmp", 9, veteran)).toBe(
      slateLift(awardSlateTables(2026, "dcmp"), "engineeringInspiration", { priorJudgedAwards: 4, priorImpactWins: 2, rookieState: "veteran" }).lift
    );
    // A profile lacking a count weighs lift 1 inside the audience.
    expect(slateEntrantWeight(2026, "district", 0, { bucket: "none", rookieState: "veteran" })).toBe(1);
    expect(() => slateEntrantWeight(2022, "district", 0, veteran)).toThrow(UnknownAwardSlateSeasonError);
  });

  it("keys Impact by prior Impact wins then decorations, every other slot by decorations and rookie state", () => {
    expect(slateClassKeys("impact", { priorJudgedAwards: 5, priorImpactWins: 1, rookieState: "veteran" })).toEqual({ cell: "one-or-two|three-or-more", primary: "one-or-two" });
    expect(slateClassKeys("judged", { priorJudgedAwards: 0, priorImpactWins: 0, rookieState: "rookie" })).toEqual({ cell: "none|rookie", primary: "none" });
  });
});

describe("awardSlate.ts imports", () => {
  it("imports nothing from locks.js: no award prediction may reach a Locked verdict", () => {
    const source = readFileSync(new URL("./awardSlate.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]!);
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.filter((specifier) => specifier.endsWith("locks.js"))).toEqual([]);
  });
});
