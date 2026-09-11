import { describe, expect, it } from "vitest";
import { RpMomentsAccumulator } from "./empiricalMoments.js";
import { rpRuleModuleForSeason } from "./rules.js";
import { analyticRpPmf } from "./analyticPmf.js";

const RULES_2026 = rpRuleModuleForSeason(2026)!;
const RED = ["frc1", "frc2", "frc3"];

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

describe("RpMomentsAccumulator feeding analyticRpPmf — the end-to-end path RP needs", () => {
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
    const result = analyticRpPmf({
      red: moments,
      blue: moments,
      ruleModule: RULES_2026,
      eventType: 0,
      compLevel: "qm",
    });
    expect(result.redPmf.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(result.redBonusProbabilities).toHaveLength(RULES_2026.bonusNames.length);
  });

  it("an alliance far above the thresholds earns more expected RP than one far below", () => {
    const strong = accWith(1000, 1000).momentsFor(RED, 500, 900);
    const weak = accWith(1, 1).momentsFor(RED, 100, 900);
    const expected = (pmf: readonly number[]) => pmf.reduce((acc, p, rp) => acc + p * rp, 0);
    const run = analyticRpPmf({
      red: strong,
      blue: weak,
      ruleModule: RULES_2026,
      eventType: 0,
      compLevel: "qm",
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
      const result = analyticRpPmf({
        red: acc.momentsFor(RED, 300, 900),
        blue: acc.momentsFor(RED, 300, 900),
        ruleModule: rules,
        eventType: 0,
        compLevel: "qm",
      });
      expect(result.redPmf.reduce((a, b) => a + b, 0), `season ${season}`).toBeCloseTo(1, 6);
    }
  });
});

/**
 * The even-split shrinkage regression (fixed 2026-09-09).
 *
 * Every test above pins the SHAPE of the variance — zero at one observation,
 * positive once observations differ, diagonal — and not one pins its
 * MAGNITUDE. That is exactly how the bug survived: a belief folded from
 * `allianceValue / rosterSize` estimates `Var(A)/rosterSize²`, so summing the
 * roster landed on `Var(A)/rosterSize` and every published bonus probability
 * came out of a distribution too narrow by that factor.
 *
 * The property below is the one that could have caught it, and it is worth
 * stating in its own right: if an alliance's observations are all this module
 * has seen, the alliance variance it reports back must BE the spread of those
 * observations — not a third of it.
 */
describe("RpMomentsAccumulator — alliance variance reconstructs the alliance's own spread", () => {
  /** The same decayed weighted variance `empiricalMoments.ts` computes, derived here independently from the observation list. */
  function weightedVarianceOf(values: readonly number[]): number {
    const decay = 0.5 ** (1 / 6);
    const last = values.length - 1;
    const weights = values.map((_, i) => decay ** (last - i));
    const w = weights.reduce((a, b) => a + b, 0);
    const w2 = weights.reduce((a, b) => a + b * b, 0);
    const mean = values.reduce((acc, v, i) => acc + weights[i]! * v, 0) / w;
    const ss = values.reduce((acc, v, i) => acc + weights[i]! * (v - mean) ** 2, 0);
    return ss / (w - w2 / w);
  }

  it("a three-team alliance reports the spread of the alliance values it saw, not a third of it", () => {
    const acc = new RpMomentsAccumulator(RULES_2026);
    const observed = [30, 90, 60, 120];
    for (const v of observed) acc.fold(RED, { [HUB]: v, [TOWER]: 30 });

    const reported = acc.momentsFor(RED, 300, 900).varianceBlock[0]?.[0] as number;
    const expected = weightedVarianceOf(observed);

    expect(reported).toBeCloseTo(expected, 6);
    // The pre-fix value, named so a regression is unmistakable rather than
    // merely a failed closeness check.
    expect(reported).not.toBeCloseTo(expected / RED.length, 6);
  });

  it("holds for a TWO-team alliance too — the correction is rosterSize, not a hardcoded 3", () => {
    const pair = ["frc1", "frc2"];
    const acc = new RpMomentsAccumulator(RULES_2026);
    const observed = [20, 80, 50];
    for (const v of observed) acc.fold(pair, { [HUB]: v, [TOWER]: 10 });

    expect(acc.momentsFor(pair, 300, 900).varianceBlock[0]?.[0] as number).toBeCloseTo(weightedVarianceOf(observed), 6);
  });

  it("degrades on a PARTIAL roster instead of under-counting twice", () => {
    // Beliefs are built the way they always are in practice — from three-team
    // alliances — and only ONE of the three teams in the alliance being priced
    // has any. That one team's belief already implies the whole alliance's
    // spread, so the estimate is its implication rather than a third of it:
    // noisy, which is honest for a roster we mostly have not seen, but not
    // shrunk twice over (once for the missing teammates, once for the split).
    const acc = new RpMomentsAccumulator(RULES_2026);
    const observed = [30, 90];
    for (const v of observed) acc.fold(RED, { [HUB]: v, [TOWER]: 30 });

    const oneKnown = [RED[0]!, "frc900", "frc901"];
    const reported = acc.momentsFor(oneKnown, 300, 900).varianceBlock[0]?.[0] as number;
    expect(reported).toBeCloseTo(weightedVarianceOf(observed), 6);
  });
});

// ──────── Seed round-trip, shape 15 (plan 09-08, D-21) ─────────────────────

describe("RpMomentsAccumulator — beliefsByTeam/fromBeliefs, the live Worker's resume path", () => {
  const BLUE = ["frc4", "frc5", "frc6"];

  /** A few matches folded, so every team carries real running state rather than a cold start. */
  function foldedAccumulator(): RpMomentsAccumulator {
    const acc = new RpMomentsAccumulator(RULES_2026);
    acc.fold(RED, { [HUB]: 120, [TOWER]: 40 });
    acc.fold(BLUE, { [HUB]: 95, [TOWER]: 55 });
    acc.fold(RED, { [HUB]: 150, [TOWER]: 35 });
    acc.fold(BLUE, { [HUB]: 88, [TOWER]: 62 });
    return acc;
  }

  it("a round-tripped accumulator produces momentsFor output IDENTICAL to the original, varianceBlock included", () => {
    const original = foldedAccumulator();
    const restored = RpMomentsAccumulator.fromBeliefs(RULES_2026, original.beliefsByTeam());
    // The WHOLE returned object, not just meanVector: the variance block is
    // where the even-split-shrinkage correction lives, and a round-trip that
    // lost `weightSquares` would still get the means exactly right.
    expect(restored.momentsFor(RED, 130, 400)).toEqual(original.momentsFor(RED, 130, 400));
    expect(restored.momentsFor(BLUE, 91, 380)).toEqual(original.momentsFor(BLUE, 91, 380));
  });

  it("beliefsByTeam() on a fresh accumulator is empty, and fromBeliefs(empty) behaves like a fresh one", () => {
    const fresh = new RpMomentsAccumulator(RULES_2026);
    expect(fresh.beliefsByTeam().size).toBe(0);
    const fromEmpty = RpMomentsAccumulator.fromBeliefs(RULES_2026, new Map());
    expect(fromEmpty.momentsFor(RED, 100, 300)).toEqual(fresh.momentsFor(RED, 100, 300));
    expect(fromEmpty.hasHistory("frc1")).toBe(false);
  });

  it("a RESTORED accumulator folded further matches one that folded the whole stream without a round-trip", () => {
    // This is the property the live Worker actually depends on: resume, then
    // continue. A round-trip that dropped `weightSquares` or `m2` would pass
    // the identity test above and fail here on the very next fold.
    const straightThrough = foldedAccumulator();
    const resumed = RpMomentsAccumulator.fromBeliefs(RULES_2026, foldedAccumulator().beliefsByTeam());

    straightThrough.fold(RED, { [HUB]: 175, [TOWER]: 48 });
    resumed.fold(RED, { [HUB]: 175, [TOWER]: 48 });

    expect(resumed.momentsFor(RED, 140, 420)).toEqual(straightThrough.momentsFor(RED, 140, 420));
  });

  it("the exported records are COPIES -- mutating one cannot reach back into the accumulator", () => {
    const acc = foldedAccumulator();
    const before = acc.momentsFor(RED, 130, 400);
    const exported = acc.beliefsByTeam();
    (exported.get("frc1") as Record<string, { mean: number }>)[HUB]!.mean = 9999;
    expect(acc.momentsFor(RED, 130, 400)).toEqual(before);
  });

  it("fromBeliefs DROPS a variable name this season's rule module does not declare", () => {
    const acc = foldedAccumulator();
    const smuggled = new Map(acc.beliefsByTeam());
    smuggled.set("frc1", {
      ...smuggled.get("frc1")!,
      cargoBonus: { weight: 5, weightSquares: 3, mean: 999, m2: 100 },
    });
    const restored = RpMomentsAccumulator.fromBeliefs(RULES_2026, smuggled);
    // A seed written under a different season's rules cannot smuggle a stale
    // variable into a new season's accumulator.
    expect(Object.keys(restored.beliefsByTeam().get("frc1")!)).toEqual([HUB, TOWER]);
    expect(restored.momentsFor(RED, 130, 400)).toEqual(acc.momentsFor(RED, 130, 400));
  });
});
