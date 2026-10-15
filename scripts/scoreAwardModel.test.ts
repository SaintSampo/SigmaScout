/**
 * The award model scorer's pure accumulators (quick task 261014-i8i), on hand
 * built fixtures. No corpus.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DISTRICT_POINT_AWARD_VALUES } from "../packages/core/districts/awardBaseRates.js";
import type { AwardOutcomeOdds } from "../packages/core/districts/ledgerSimulation.js";
import {
  acceptanceGates,
  addBinary,
  anyAwardChance,
  brierOf,
  chanceWobble,
  classLabel,
  dcmpRolesByEventType,
  districtOddsDigest,
  emptyBinary,
  expectedAwardPoints,
  flatBrierOf,
  gateLines,
  IMPACT_ROW_TOLERANCE,
  LEGACY_REVIEW_EXCLUDED_TYPES,
  legacyReviewClass,
  passBarGates,
  readScoreSnapshot,
  reliabilityBinIndex,
  REVIEW_CLASSES,
  SCORED_SEASONS,
  scoreSnapshot,
  scoreTeamEvents,
  tierReportLines,
  writeScoreSnapshot,
  type ScoredTeamEvent,
  type ScoreSnapshot,
} from "./scoreAwardModel.js";
import type { AwardInstance } from "./measureAwardSlate.js";

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
    reviewClass: "none",
    decorationClass: "none",
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

describe("the three acceptance gates (quick task 261014-i8i)", () => {
  const DIGEST = "a".repeat(64);
  const eligibleAll = { impact: true, engineeringInspiration: true, rookieAllStar: true };
  const eligibleNone = { impact: false, engineeringInspiration: false, rookieAllStar: false };
  /** Four DCMP team events: two winners priced high, two non winners priced low, so the Brier beats the flat guess. */
  function sharpRows(ineligibleOdds = odds(0, 0, 0.1)): ScoredTeamEvent[] {
    return [
      row({ teamKey: "frc1", tier: "dcmp", role: "single", weight: 3, odds: odds(0.6, 0.2, 0.1), awardPoints: 30, wonImpact: true, eligible: eligibleAll }),
      row({ teamKey: "frc2", tier: "dcmp", role: "single", weight: 3, odds: odds(0.1, 0.1, 0.6), awardPoints: 15, eligible: eligibleAll }),
      row({ teamKey: "frc3", tier: "dcmp", role: "single", weight: 3, odds: ineligibleOdds, awardPoints: 0, eligible: eligibleNone }),
      row({ teamKey: "frc4", tier: "dcmp", role: "single", weight: 3, odds: odds(0, 0, 0.1), awardPoints: 0, eligible: eligibleNone }),
    ];
  }

  it("passes all three when the DCMP beats its flat guess, no ineligible team carries mass and the digest matches", () => {
    const gates = acceptanceGates(scoreTeamEvents(sharpRows()).get("dcmp")!, DIGEST, DIGEST);
    expect(gates.map((gate) => gate.pass)).toEqual([true, true, true]);
    const lines = gateLines(gates);
    expect(lines).toHaveLength(3);
    expect(lines.every((line) => line.startsWith("GATE PASS: "))).toBe(true);
  });

  it("fails the Brier gate when the any award chance is worse than the flat guess", () => {
    const blunt = sharpRows().map((entry) => ({ ...entry, odds: entry.awardPoints > 0 ? odds(0, 0, 0.05) : odds(0, 0, 0.95) }));
    const gates = acceptanceGates(scoreTeamEvents(blunt).get("dcmp")!, DIGEST, DIGEST);
    expect(gates[0]!.pass).toBe(false);
    expect(gateLines(gates)[0]).toMatch(/^GATE FAIL: DCMP any award Brier/);
  });

  it("fails the zero mass gate on ANY Impact or 8 point mass on an ineligible team event, however small", () => {
    const impactLeak = acceptanceGates(scoreTeamEvents(sharpRows(odds(1e-12, 0, 0.1))).get("dcmp")!, DIGEST, DIGEST);
    expect(impactLeak[1]!.pass).toBe(false);
    const eightLeak = acceptanceGates(scoreTeamEvents(sharpRows(odds(0, 1e-12, 0.1))).get("dcmp")!, DIGEST, DIGEST);
    expect(eightLeak[1]!.pass).toBe(false);
    // Judged mass on an ineligible team is allowed: only the three consuming awards are gated.
    expect(acceptanceGates(scoreTeamEvents(sharpRows(odds(0, 0, 0.5))).get("dcmp")!, DIGEST, DIGEST)[1]!.pass).toBe(true);
  });

  it("fails the digest gate on a different digest and on a missing one", () => {
    const report = scoreTeamEvents(sharpRows()).get("dcmp")!;
    expect(acceptanceGates(report, DIGEST, "b".repeat(64))[2]!.pass).toBe(false);
    const missing = acceptanceGates(report, DIGEST, undefined);
    expect(missing[2]!.pass).toBe(false);
    expect(missing[2]!.detail).toContain("no --expect-district-digest given");
  });

  it("fails every scored gate over an empty DCMP block rather than passing vacuously", () => {
    const gates = acceptanceGates(scoreTeamEvents([]).get("dcmp")!, DIGEST, DIGEST);
    expect(gates[0]!.pass).toBe(false);
    expect(gates[1]!.pass).toBe(false);
  });
});

// ───────────────────────── quick task 261014-mii ─────────────────────────

describe("legacyReviewClass, the frozen review rule (M-09)", () => {
  it("excludes exactly Winner, Finalist and Highest Rookie Seed", () => {
    expect([...LEGACY_REVIEW_EXCLUDED_TYPES].sort((a, b) => a - b)).toEqual([1, 2, 14]);
  });

  it("counts every earlier corpus season, so a Dean's List win moves the legacy class while the M-01 list ignores it", () => {
    const instances: AwardInstance[] = [
      // A Dean's List Finalist row: an individual award, not on the M-01 list.
      { year: 2024, eventKey: "2024a", awardType: 4, teamKey: "frc1" },
      // On field results: excluded by both rules.
      { year: 2024, eventKey: "2024a", awardType: 1, teamKey: "frc1" },
      { year: 2024, eventKey: "2024b", awardType: 14, teamKey: "frc1" },
      // The season itself never counts.
      { year: 2026, eventKey: "2026a", awardType: 17, teamKey: "frc1" },
    ];
    expect(legacyReviewClass(instances, "frc1", 2026, "veteran")).toBe("one or two");
    const pointPaying = instances.filter((i) => i.year < 2026 && DISTRICT_POINT_AWARD_VALUES.has(i.awardType));
    expect(pointPaying).toEqual([]);
    expect(legacyReviewClass(instances, "frc1", 2026, "rookie")).toBe("one or two rookie");
    // A win nine seasons back still counts under the review's rule.
    const old: AwardInstance[] = [
      { year: 2016, eventKey: "2016a", awardType: 17, teamKey: "frc2" },
      { year: 2016, eventKey: "2016b", awardType: 20, teamKey: "frc2" },
      { year: 2017, eventKey: "2017a", awardType: 3, teamKey: "frc2" },
    ];
    expect(legacyReviewClass(old, "frc2", 2026, "veteran")).toBe("three or more");
    expect(legacyReviewClass(old, "frc3", 2026, "veteran")).toBe("none");
  });
});

describe("the reliability bins", () => {
  it("are ten equal width bins with 1 in the top bin", () => {
    expect(reliabilityBinIndex(0)).toBe(0);
    expect(reliabilityBinIndex(0.0999)).toBe(0);
    expect(reliabilityBinIndex(0.1)).toBe(1);
    expect(reliabilityBinIndex(0.95)).toBe(9);
    expect(reliabilityBinIndex(1)).toBe(9);
  });
});

describe("the snapshot", () => {
  it("round trips through a file, the 261014-qje fields included", () => {
    const snapshot = snapshotOf(barRows());
    expect(snapshot.district.decorationClasses).toBeDefined();
    expect(snapshot.district.rookieSeasons?.["2025"]).toBeDefined();
    expect(snapshot.district.heldEarlier).toBeDefined();
    expect(snapshot.dcmp.heldEarlier).toBeUndefined();
    const dir = mkdtempSync(join(tmpdir(), "score-award-model-"));
    try {
      const path = join(dir, "snapshot.json");
      writeScoreSnapshot(path, snapshot);
      expect(readScoreSnapshot(path)).toEqual(snapshot);
      writeFileSync(path, JSON.stringify({ ...snapshot, districtDigest: "not a digest" }), "utf8");
      expect(() => readScoreSnapshot(path)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still parses a snapshot written before the 261014-qje fields (261014-mii)", () => {
    const snapshot = snapshotOf(barRows());
    const strip = ({ decorationClasses: _a, seasons: _b, rookieSeasons: _c, impactWon: _d, heldEarlier: _e, slots: _f, ...rest }: ScoreSnapshot["district"]) => rest;
    const old = { ...snapshot, district: strip(snapshot.district), dcmp: strip(snapshot.dcmp) };
    const dir = mkdtempSync(join(tmpdir(), "score-award-model-"));
    try {
      const path = join(dir, "old.json");
      writeFileSync(path, JSON.stringify(old), "utf8");
      expect(readScoreSnapshot(path)).toEqual(old);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("carries the class maps, ten bins, the Impact row, per season and rookie lines, the Impact Brier and the slot audit", () => {
    const snapshot = snapshotOf(barRows());
    expect(snapshot.district.n).toBe(32);
    expect(Object.keys(snapshot.district.reviewClasses).sort()).toEqual([...REVIEW_CLASSES].sort());
    expect(Object.keys(snapshot.district.decorationClasses!).sort()).toEqual([...REVIEW_CLASSES].sort());
    expect(snapshot.district.reliability).toHaveLength(10);
    expect(Object.keys(snapshot.district.seasons!)).toEqual(["2025", "2026"]);
    expect(snapshot.district.rookieSeasons!["2026"]!.n).toBe(4);
    expect(snapshot.district.impactWon!.n).toBe(32);
    expect(snapshot.district.slots!.real.judged).toBe(16);
  });
});

/**
 * THE PASS BAR FIXTURE: per season and review class, `n` district team events
 * (the "none rookie" class rookies), the first `wins` of them won a 5 point
 * award, priced at chance `p` (all of it 5 point mass). The first team event of
 * "three or more" each season held Impact from an earlier week district event,
 * priced at `heldImpactMass` of Impact. Two DCMP team events, one ineligible
 * for every qualifying award, priced at `dcmpIneligibleMass` of Impact.
 */
interface BarSpec {
  readonly p?: number | Readonly<Record<string, number>>;
  readonly pBySeason?: Readonly<Record<number, Readonly<Record<string, number>>>>;
  readonly n?: number;
  readonly wins?: number;
  readonly seasons?: readonly number[];
  readonly impactShortfall?: number;
  readonly heldImpactMass?: number;
  readonly dcmpIneligibleMass?: number;
  readonly dcmpWinnerChance?: number;
}

function barRows(spec: BarSpec = {}): ScoredTeamEvent[] {
  const n = spec.n ?? 4;
  const wins = spec.wins ?? n / 2;
  const out: ScoredTeamEvent[] = [];
  const noneHeld = { impact: false, engineeringInspiration: false, rookieAllStar: false };
  for (const season of spec.seasons ?? [2025, 2026]) {
    for (const label of REVIEW_CLASSES) {
      const chance = spec.pBySeason?.[season]?.[label] ?? (typeof spec.p === "number" ? spec.p : spec.p?.[label] ?? 0.8);
      for (let k = 0; k < n; k++) {
        const held = label === "three or more" && k === 0;
        const p10 = held ? spec.heldImpactMass ?? 0 : 0;
        const won = k < wins;
        out.push(
          row({
            season,
            teamKey: `frc${String(out.length + 1)}`,
            reviewClass: label,
            decorationClass: label,
            rookieState: label === "none rookie" ? "rookie" : "veteran",
            odds: { p10, p8: 0, p5: chance - p10, p0: 1 - chance, impact: p10 - (spec.impactShortfall ?? 0) },
            awardPoints: won ? 5 : 0,
            heldEarlier: held ? { ...noneHeld, impact: true } : noneHeld,
            ...(won ? { realSlot: "judged" as const } : {}),
          })
        );
      }
    }
  }
  const eligibleAll = { impact: true, engineeringInspiration: true, rookieAllStar: true };
  const eligibleNone = { impact: false, engineeringInspiration: false, rookieAllStar: false };
  const winner = spec.dcmpWinnerChance ?? 0.6;
  out.push(
    row({ teamKey: "frc900", tier: "dcmp", role: "single", weight: 3, odds: odds(winner, 0, 0.1), awardPoints: 30, wonImpact: true, eligible: eligibleAll }),
    row({ teamKey: "frc901", tier: "dcmp", role: "single", weight: 3, odds: odds(spec.dcmpIneligibleMass ?? 0, 0, 0.1), awardPoints: 0, eligible: eligibleNone })
  );
  return out;
}

function snapshotOf(rows: readonly ScoredTeamEvent[], label = "BEFORE"): ScoreSnapshot {
  return scoreSnapshot(label, "2026-10-14T00:00:00.000Z", scoreTeamEvents(rows), districtOddsDigest(rows));
}

function gatesOf(before: ScoreSnapshot, rows: readonly ScoredTeamEvent[]) {
  const reports = scoreTeamEvents(rows);
  return passBarGates(before, reports.get("district")!, reports.get("dcmp")!);
}

describe("the pass bar (quick task 261014-qje)", () => {
  const before = snapshotOf(barRows());

  it("prints seven gates, numbered 1 to 7, and passes them all on a better model", () => {
    const gates = gatesOf(before, barRows({ p: 0.6, dcmpWinnerChance: 0.7 }));
    expect(gates.map((gate) => gate.name.slice(0, 2))).toEqual(["1 ", "2 ", "3 ", "4 ", "5 ", "6 ", "7 "]);
    expect(gates.map((gate) => gate.pass)).toEqual([true, true, true, true, true, true, true]);
    expect(gateLines(gates).every((line) => line.startsWith("GATE PASS: "))).toBe(true);
  });

  it("gate 1 is strict: an equal Brier fails", () => {
    expect(gatesOf(before, barRows())[0]!.pass).toBe(false);
  });

  it("gate 2 passes a class whose gap is exactly its chance wobble, even when wider than BEFORE", () => {
    // n = 4, happened 50%: wobble = 2 sqrt(0.25 / 4) = 0.5. BEFORE gap 0.3; AFTER said 100%, gap exactly 0.5.
    const one = snapshotOf(barRows({ seasons: [2026] }));
    const gate = gatesOf(one, barRows({ seasons: [2026], p: 1 }))[1]!;
    expect(chanceWobble(0.5, 4)).toBe(0.5);
    expect(gate.pass).toBe(true);
    expect(gate.detail).toContain("inside the wobble");
  });

  it("gate 2 fails a class whose gap equals the shipped gap and exceeds its wobble, and passes one strictly smaller", () => {
    // n = 100 per class: wobble 0.1. BEFORE gap 0.3.
    const big = snapshotOf(barRows({ seasons: [2026], n: 100 }));
    const equal = gatesOf(big, barRows({ seasons: [2026], n: 100, p: { "three or more": 0.8, "one or two": 0.55, none: 0.55, "none rookie": 0.55 } }))[1]!;
    expect(equal.pass).toBe(false);
    expect(equal.detail).toContain("three or more: AFTER gap 30.00 points, wobble 10.00, BEFORE gap 30.00 (n=100) FAILS");
    const smaller = gatesOf(big, barRows({ seasons: [2026], n: 100, p: { "three or more": 0.79, "one or two": 0.55, none: 0.55, "none rookie": 0.55 } }))[1]!;
    expect(smaller.pass).toBe(true);
    expect(smaller.detail).toContain("smaller than BEFORE");
  });

  it("gate 2 fails on a different n, and on a BEFORE snapshot without the Q-09 class view", () => {
    const rows = barRows({ p: 0.6 });
    const dropped = rows.filter((entry) => entry.teamKey !== "frc1");
    const mismatch = gatesOf(before, dropped)[1]!;
    expect(mismatch.pass).toBe(false);
    expect(mismatch.detail).toContain("n MISMATCH");
    const { decorationClasses: _drop, ...district } = before.district;
    const old = { ...before, district };
    const missing = gatesOf(old, rows)[1]!;
    expect(missing.pass).toBe(false);
    expect(missing.detail).toContain("Q-09 decoration count three or more: missing BEFORE");
  });

  it("gate 3 reads 2025 and 2026 each on its own: a worse gap in one season fails though the other improves", () => {
    const worse2026 = barRows({ pBySeason: { 2025: { "none rookie": 0.6 }, 2026: { "none rookie": 0.95 } }, p: 0.6 });
    const gate = gatesOf(before, worse2026)[2]!;
    expect(gate.pass).toBe(false);
    expect(gate.detail).toMatch(/2025: gap 30\.00 to 10\.00 points.*; 2026: gap 30\.00 to 45\.00 points.* FAILS/);
    // No worse is enough: an equal gap and Brier pass.
    expect(gatesOf(before, barRows({ p: { "three or more": 0.6, "one or two": 0.6, none: 0.6, "none rookie": 0.8 } }))[2]!.pass).toBe(true);
    // A BEFORE without a season's rookie line fails.
    const only2026 = snapshotOf(barRows({ seasons: [2026] }));
    expect(gatesOf(only2026, barRows({ seasons: [2026], p: 0.6 }))[2]!.pass).toBe(false);
  });

  it("gate 4 passes within 1e-9 and fails beyond it", () => {
    expect(gatesOf(before, barRows({ p: 0.6, impactShortfall: IMPACT_ROW_TOLERANCE / 100 }))[3]!.pass).toBe(true);
    expect(gatesOf(before, barRows({ p: 0.6, impactShortfall: 1e-6 }))[3]!.pass).toBe(false);
  });

  it("gate 5 passes an equal Impact Brier and fails a worse one", () => {
    expect(gatesOf(before, barRows({ p: 0.6 }))[4]!.pass).toBe(true);
    const worse = barRows({ p: 0.6 }).map((entry) => (entry.tier === "district" && entry.teamKey === "frc2" ? { ...entry, odds: { ...entry.odds, impact: 0.5, p10: 0.5, p5: entry.odds.p5 - 0.5 } } : entry));
    expect(gatesOf(before, worse)[4]!.pass).toBe(false);
  });

  it("gate 6 passes an equal DCMP Brier and fails a worse one", () => {
    expect(gatesOf(before, barRows({ p: 0.6 }))[5]!.pass).toBe(true);
    expect(gatesOf(before, barRows({ p: 0.6, dcmpWinnerChance: 0.5 }))[5]!.pass).toBe(false);
  });

  it("gate 7 fails on one unit of mass where an award cannot go, at either tier", () => {
    expect(gatesOf(before, barRows({ p: 0.6 }))[6]!.pass).toBe(true);
    expect(gatesOf(before, barRows({ p: 0.6, heldImpactMass: 1e-12 }))[6]!.pass).toBe(false);
    expect(gatesOf(before, barRows({ p: 0.6, dcmpIneligibleMass: 1e-12 }))[6]!.pass).toBe(false);
  });
});
