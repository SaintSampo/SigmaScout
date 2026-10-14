/**
 * The award model scorer's pure accumulators (quick task 261014-i8i), on hand
 * built fixtures. No corpus.
 */
import { describe, expect, it } from "vitest";
import type { AwardOutcomeOdds } from "../packages/core/districts/ledgerSimulation.js";
import {
  addBinary,
  anyAwardChance,
  brierOf,
  classLabel,
  dcmpRolesByEventType,
  districtOddsDigest,
  emptyBinary,
  expectedAwardPoints,
  flatBrierOf,
  SCORED_SEASONS,
  scoreTeamEvents,
  tierReportLines,
  type ScoredTeamEvent,
} from "./scoreAwardModel.js";

function odds(p10: number, p8: number, p5: number, impact = p10): AwardOutcomeOdds {
  return { p10, p8, p5, p0: 1 - p10 - p8 - p5, impact };
}

function row(overrides: Partial<ScoredTeamEvent> & { teamKey: string }): ScoredTeamEvent {
  return {
    season: 2026,
    tier: "district",
    eventKey: "2026wabon",
    bucket: "none",
    rookieState: "veteran",
    odds: odds(0.1, 0.1, 0.2),
    weight: 1,
    awardPoints: 0,
    wonImpact: false,
    wonEngineeringInspiration: false,
    wonRookieAllStar: false,
    ...overrides,
  };
}

describe("the scored population", () => {
  it("is exactly the review's seasons", () => {
    expect(SCORED_SEASONS).toEqual([2023, 2024, 2025, 2026]);
  });
});

describe("the binary accumulators", () => {
  it("score a two team event with known odds and outcomes", () => {
    const acc = emptyBinary();
    addBinary(acc, 0.8, 1);
    addBinary(acc, 0.3, 0);
    expect(acc.n).toBe(2);
    expect(brierOf(acc)).toBeCloseTo((0.2 ** 2 + 0.3 ** 2) / 2, 15);
    expect(acc.sumP / acc.n).toBeCloseTo(0.55, 15);
    expect(acc.sumY / acc.n).toBe(0.5);
  });

  it("give the flat guess at the observed rate as ybar (1 - ybar), the Brier of predicting the rows' own mean", () => {
    const outcomes: (0 | 1)[] = [1, 0, 0, 1, 0, 0, 0, 1, 0, 0];
    const acc = emptyBinary();
    for (const y of outcomes) addBinary(acc, 0.9, y);
    const ybar = 0.3;
    const flat = emptyBinary();
    for (const y of outcomes) addBinary(flat, ybar, y);
    expect(flatBrierOf(acc)).toBeCloseTo(ybar * (1 - ybar), 15);
    expect(flatBrierOf(acc)).toBeCloseTo(brierOf(flat), 15);
  });
});

describe("the per team readings", () => {
  it("reads any award as every outcome above 0 and expected points at the tier weight", () => {
    const o = odds(0.1, 0.2, 0.3);
    expect(anyAwardChance(o)).toBeCloseTo(0.6, 15);
    expect(expectedAwardPoints(o, 1)).toBeCloseTo(1 + 1.6 + 1.5, 12);
    expect(expectedAwardPoints(o, 3)).toBeCloseTo(3 * (1 + 1.6 + 1.5), 12);
  });

  it("labels the classes as the review does", () => {
    expect(classLabel("three-or-more", "veteran")).toBe("three or more");
    expect(classLabel("one-or-two", "veteran")).toBe("one or two");
    expect(classLabel("none", "veteran")).toBe("none");
    expect(classLabel("none", "rookie")).toBe("none rookie");
  });
});

describe("scoreTeamEvents", () => {
  it("scores a two team DCMP event, its audits included", () => {
    const eligibleNone = { impact: false, engineeringInspiration: false, rookieAllStar: false };
    const rows = [
      row({
        teamKey: "frc1",
        tier: "dcmp",
        role: "single",
        weight: 3,
        odds: odds(0.5, 0.2, 0.1, 0.4),
        awardPoints: 30,
        wonImpact: true,
        eligible: { impact: true, engineeringInspiration: true, rookieAllStar: false },
        eligibleAnyDistrict: { impact: true, engineeringInspiration: false, rookieAllStar: false },
      }),
      row({
        teamKey: "frc2",
        tier: "dcmp",
        role: "single",
        weight: 3,
        rookieState: "rookie",
        odds: odds(0.1, 0.3, 0.1, 0.1),
        awardPoints: 0,
        eligible: eligibleNone,
        eligibleAnyDistrict: eligibleNone,
      }),
    ];
    const report = scoreTeamEvents(rows).get("dcmp")!;
    expect(report.anyAward.n).toBe(2);
    expect(brierOf(report.anyAward)).toBeCloseTo(((0.8 - 1) ** 2 + (0.5 - 0) ** 2) / 2, 12);
    expect(report.byRole.get("single")!.n).toBe(2);
    expect(report.modelPoints).toBeCloseTo(3 * (5 + 1.6 + 0.5) + 3 * (1 + 2.4 + 0.5), 12);
    expect(report.realPoints).toBe(30);
    expect([...report.census]).toEqual([
      [30, 1],
      [0, 1],
    ]);
    expect(report.impact.expected).toBeCloseTo(0.5, 12);
    expect(report.impact.onIneligible).toBeCloseTo(0.1, 12);
    expect(report.impact.cellMassOnIneligible).toBeCloseTo(0.1, 12);
    expect(report.impact.realWinners).toBe(1);
    expect(report.impact.winnersIneligible).toBe(0);
    expect(report.impact.eligibleTeamEvents).toBe(1);
    // A veteran's 8 point mass is Engineering Inspiration, a rookie's is Rookie All Star.
    expect(report.engineeringInspiration.expected).toBeCloseTo(0.2, 12);
    expect(report.engineeringInspiration.disagreementsWithAnyDistrict).toBe(1);
    expect(report.rookieAllStar.expected).toBeCloseTo(0.3, 12);
    expect(report.rookieAllStar.cellMassOnIneligible).toBeCloseTo(0.3, 12);
    const printed = tierReportLines(report).join("\n");
    expect(printed).toContain("DCMP TIER: 2 team events at 1 events");
    expect(printed).toContain("any award, single:");
  });
});

describe("districtOddsDigest", () => {
  const rows = [
    row({ teamKey: "frc1", odds: odds(0.1, 0.2, 0.3) }),
    row({ teamKey: "frc2", odds: odds(0.05, 0, 0.25) }),
    row({ teamKey: "frc3", eventKey: "2026waaaa", odds: odds(0.2, 0.1, 0.1) }),
    row({ teamKey: "frc9", tier: "dcmp", odds: odds(0.4, 0.4, 0.1) }),
  ];

  it("is stable under the rows' order and ignores DCMP tier rows", () => {
    const forward = districtOddsDigest(rows);
    const reversed = districtOddsDigest([...rows].reverse());
    expect(reversed).toEqual(forward);
    expect(forward.lines).toBe(3);
    expect(districtOddsDigest(rows.slice(0, 3)).digest).toBe(forward.digest);
    expect(forward.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("moves when any district tier odd moves past 12 decimals, and not below", () => {
    const base = districtOddsDigest(rows).digest;
    const moved = rows.map((entry, i) => (i === 0 ? { ...entry, odds: odds(0.1 + 1e-10, 0.2, 0.3) } : entry));
    expect(districtOddsDigest(moved).digest).not.toBe(base);
    const noise = rows.map((entry, i) => (i === 0 ? { ...entry, odds: odds(0.1 + 1e-15, 0.2, 0.3) } : entry));
    expect(districtOddsDigest(noise).digest).toBe(base);
  });
});

describe("dcmpRolesByEventType", () => {
  it("reads 5 as a division, 2 with a division child as finals, 2 otherwise as single", () => {
    const types = new Map([
      ["2024micmp", 2],
      ["2024micmp1", 5],
      ["2024micmp2", 5],
      ["2024pncmp", 2],
      ["2024txcmpx", 5],
    ]);
    const roles = dcmpRolesByEventType(types, ["2024micmp", "2024micmp1", "2024micmp2", "2024pncmp"]);
    expect([...roles]).toEqual([
      ["2024micmp", "finals"],
      ["2024micmp1", "division"],
      ["2024micmp2", "division"],
      ["2024pncmp", "single"],
    ]);
  });
});
