import { describe, expect, it } from "vitest";
import { RpMomentsAccumulator } from "./empiricalMoments.js";
import { rpRuleModuleForSeason } from "./rules.js";
import { rpPmfForMatch } from "./distribution.js";

const RULES_2026 = rpRuleModuleForSeason(2026)!;
const RED = ["frc1", "frc2", "frc3"];
const MC = { rpMonteCarloSeed: 4242, rpMonteCarloDraws: 4000 };

/** 2026 tracks exactly two threshold variables. */
const HUB = "hubTotalCount";
const TOWER = "totalTowerPoints";

describe("RpMomentsAccumulator — per-team beliefs with no algorithm involved", () => {
  it("tracks exactly the season's threshold variables, in rule-module order", () => {
    const acc = new RpMomentsAccumulator(RULES_2026);
    expect(acc.variableNames).toEqual(RULES_2026.thresholdVariables.map((v) => v.name));
    expect(acc.variableNames).toContain(HUB);
    expect(acc.variableNames).toContain(TOWER);
  });

  it("cold-starts at a zero mean with no variance rather than inventing a belief", () => {
    const acc = new RpMomentsAccumulator(RULES_2026);
    const m = acc.momentsFor(RED, 300, 900);
    expect(m.meanVector).toEqual([0, 0]);
    expect(m.varianceBlock).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(acc.hasHistory("frc1")).toBe(false);
  });

  it("splits an alliance observation evenly across the roster, so the alliance mean reconstructs the observation", () => {
    const acc = new RpMomentsAccumulator(RULES_2026);
    acc.fold(RED, { [HUB]: 60, [TOWER]: 30 });
    const m = acc.momentsFor(RED, 300, 900);
    // 60/3 per team, summed back over three teams = 60.
    expect(m.meanVector[0]).toBeCloseTo(60, 10);
    expect(m.meanVector[1]).toBeCloseTo(30, 10);
    expect(acc.hasHistory("frc1")).toBe(true);
  });

  it("gives ONE observation no variance — an effective sample of one cannot support one", () => {
    const acc = new RpMomentsAccumulator(RULES_2026);
    acc.fold(RED, { [HUB]: 60, [TOWER]: 30 });
    const m = acc.momentsFor(RED, 300, 900);
    expect(m.varianceBlock[0]?.[0]).toBe(0);
  });

  it("grows a variance once a team's observations actually differ, and keeps identical ones at zero", () => {
    const varying = new RpMomentsAccumulator(RULES_2026);
    varying.fold(RED, { [HUB]: 30, [TOWER]: 30 });
    varying.fold(RED, { [HUB]: 90, [TOWER]: 30 });

    const constant = new RpMomentsAccumulator(RULES_2026);
    constant.fold(RED, { [HUB]: 60, [TOWER]: 30 });
    constant.fold(RED, { [HUB]: 60, [TOWER]: 30 });

    expect(varying.momentsFor(RED, 300, 900).varianceBlock[0]?.[0]).toBeGreaterThan(0);
    expect(constant.momentsFor(RED, 300, 900).varianceBlock[0]?.[0]).toBeCloseTo(0, 8);
  });

  it("emits a DIAGONAL covariance block and a zero score cross-covariance — the documented, deliberate simplification", () => {
    const acc = new RpMomentsAccumulator(RULES_2026);
    acc.fold(RED, { [HUB]: 30, [TOWER]: 20 });
    acc.fold(RED, { [HUB]: 90, [TOWER]: 40 });
    const m = acc.momentsFor(RED, 300, 900);
    expect(m.varianceBlock[0]?.[1]).toBe(0);
    expect(m.varianceBlock[1]?.[0]).toBe(0);
    expect(m.scoreCrossCovariance).toEqual([0, 0]);
  });

  it("carries the algorithm's score mean and variance through untouched — it never estimates a score itself", () => {
    const acc = new RpMomentsAccumulator(RULES_2026);
    const m = acc.momentsFor(RED, 412.5, 1234.5);
    expect(m.scoreMean).toBe(412.5);
    expect(m.scoreVariance).toBe(1234.5);
  });

  it("weights recent observations more heavily", () => {
    const recentHigh = new RpMomentsAccumulator(RULES_2026);
    const recentLow = new RpMomentsAccumulator(RULES_2026);
    for (const v of [30, 30, 30, 300]) recentHigh.fold(RED, { [HUB]: v, [TOWER]: 30 });
    for (const v of [300, 30, 30, 30]) recentLow.fold(RED, { [HUB]: v, [TOWER]: 30 });
    expect(recentHigh.momentsFor(RED, 300, 900).meanVector[0] as number).toBeGreaterThan(
      recentLow.momentsFor(RED, 300, 900).meanVector[0] as number
    );
  });

  it("ignores a non-finite observation instead of corrupting the team's belief", () => {
    const acc = new RpMomentsAccumulator(RULES_2026);
    acc.fold(RED, { [HUB]: 60, [TOWER]: 30 });
    acc.fold(RED, { [HUB]: Number.NaN, [TOWER]: Number.POSITIVE_INFINITY });
    const m = acc.momentsFor(RED, 300, 900);
    expect(Number.isFinite(m.meanVector[0] as number)).toBe(true);
    expect(m.meanVector[0]).toBeCloseTo(60, 10);
  });

  it("keeps teams separate — an alliance's prediction depends on WHO is on it", () => {
    const acc = new RpMomentsAccumulator(RULES_2026);
    acc.fold(RED, { [HUB]: 90, [TOWER]: 30 });
    acc.fold(["frc7", "frc8", "frc9"], { [HUB]: 9, [TOWER]: 3 });
    const strong = acc.momentsFor(RED, 300, 900);
    const weak = acc.momentsFor(["frc7", "frc8", "frc9"], 300, 900);
    expect(strong.meanVector[0] as number).toBeGreaterThan(weak.meanVector[0] as number);
  });
});

describe("RpMomentsAccumulator feeding rpPmfForMatch — the end-to-end path RP needs", () => {
  function accWith(hub: number, tower: number): RpMomentsAccumulator {
    const acc = new RpMomentsAccumulator(RULES_2026);
    // Two differing observations so a real variance exists.
    acc.fold(RED, { [HUB]: hub * 0.9, [TOWER]: tower * 0.9 });
    acc.fold(RED, { [HUB]: hub * 1.1, [TOWER]: tower * 1.1 });
    return acc;
  }

  it("produces a valid pmf for an alliance built only from observed history", () => {
    const acc = accWith(60, 40);
    const moments = acc.momentsFor(RED, 300, 900);
    const result = rpPmfForMatch({
      red: moments,
      blue: moments,
      ruleModule: RULES_2026,
      eventType: 0,
      matchKey: "2026casj_qm1",
      compLevel: "qm",
      params: MC,
    });
    expect(result.redPmf.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(result.redBonusProbabilities).toHaveLength(RULES_2026.bonusNames.length);
  });

  it("an alliance far above the thresholds earns more expected RP than one far below", () => {
    const strong = accWith(1000, 1000).momentsFor(RED, 500, 900);
    const weak = accWith(1, 1).momentsFor(RED, 100, 900);
    const expected = (pmf: readonly number[]) => pmf.reduce((acc, p, rp) => acc + p * rp, 0);
    const run = rpPmfForMatch({
      red: strong,
      blue: weak,
      ruleModule: RULES_2026,
      eventType: 0,
      matchKey: "2026casj_qm2",
      compLevel: "qm",
      params: MC,
    });
    expect(expected(run.redPmf)).toBeGreaterThan(expected(run.bluePmf));
  });

  it("works for every registered season, not just 2026", () => {
    for (const season of [2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026]) {
      const rules = rpRuleModuleForSeason(season)!;
      const acc = new RpMomentsAccumulator(rules);
      const observation = Object.fromEntries(rules.thresholdVariables.map((v) => [v.name, 30]));
      const varied = Object.fromEntries(rules.thresholdVariables.map((v) => [v.name, 45]));
      acc.fold(RED, observation);
      acc.fold(RED, varied);
      const result = rpPmfForMatch({
        red: acc.momentsFor(RED, 300, 900),
        blue: acc.momentsFor(RED, 300, 900),
        ruleModule: rules,
        eventType: 0,
        matchKey: `${season}casj_qm1`,
        compLevel: "qm",
        params: MC,
      });
      expect(result.redPmf.reduce((a, b) => a + b, 0), `season ${season}`).toBeCloseTo(1, 6);
    }
  });
});
