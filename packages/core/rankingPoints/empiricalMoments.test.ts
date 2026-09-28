import { describe, expect, it } from "vitest";
import { RpMomentsAccumulator, type RpPopulationState } from "./empiricalMoments.js";
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
 * Pins the variance magnitude against the even-split shrinkage regression:
 * if an alliance's observations are all this module has seen, the reported
 * alliance variance must be the spread of those observations, not a third of it.
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
    // Only one of the priced alliance's three teams has a belief; its belief
    // already implies the whole alliance's spread, so it is not shrunk twice.
    const acc = new RpMomentsAccumulator(RULES_2026);
    const observed = [30, 90];
    for (const v of observed) acc.fold(RED, { [HUB]: v, [TOWER]: 30 });

    const oneKnown = [RED[0]!, "frc900", "frc901"];
    const reported = acc.momentsFor(oneKnown, 300, 900).varianceBlock[0]?.[0] as number;
    expect(reported).toBeCloseTo(weightedVarianceOf(observed), 6);
  });
});

// ──────── Seed round-trip ─────────────────────

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
    // The live Worker resumes, then continues: a round-trip that dropped
    // `weightSquares` or `m2` would fail here on the next fold.
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

// ──────── RP cold-team prior candidate ─────────────────────

/**
 * `.planning/quick/260928-n6i-fix-the-early-season-rp-bonus-cold-start/260928-n6i-PREREG.md`,
 * Candidate R items 1 to 4. Every expected value is computed here from the
 * observation lists, never by calling into the module under test.
 */
describe("RpMomentsAccumulator rpColdPrior (260928-n6i-PREREG.md)", () => {
  const BLUE = ["frc4", "frc5", "frc6"];
  const COLD = ["frc900", "frc901", "frc902"];

  function populationMean(values: readonly number[]): number {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  /** The unbiased sample variance, denominator n - 1. */
  function populationVariance(values: readonly number[]): number {
    const m = populationMean(values);
    return values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  }

  /** The decayed weighted mean `empiricalMoments.ts` keeps per team, derived here independently. */
  function weightedMeanOf(values: readonly number[]): number {
    const decay = 0.5 ** (1 / 6);
    const last = values.length - 1;
    const weights = values.map((_, i) => decay ** (last - i));
    const w = weights.reduce((a, b) => a + b, 0);
    return values.reduce((acc, v, i) => acc + weights[i]! * v, 0) / w;
  }

  /** The same decayed weighted variance as the describe block above, derived independently. */
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

  function on(): RpMomentsAccumulator {
    return new RpMomentsAccumulator(RULES_2026, { rpColdPrior: true });
  }

  /** A warm RED (two differing observations), a thin BLUE (one), and never-folded teams everywhere else. */
  function foldMixed(acc: RpMomentsAccumulator): void {
    acc.fold(RED, { [HUB]: 30, [TOWER]: 20 });
    acc.fold(RED, { [HUB]: 90, [TOWER]: 50 });
    acc.fold(BLUE, { [HUB]: 66, [TOWER]: 41 });
  }

  it("knob off is the incumbent: no options, undefined, an empty object and false all price identically, with today's cold behaviour", () => {
    const variants = [
      new RpMomentsAccumulator(RULES_2026),
      new RpMomentsAccumulator(RULES_2026, undefined),
      new RpMomentsAccumulator(RULES_2026, {}),
      new RpMomentsAccumulator(RULES_2026, { rpColdPrior: false }),
    ];
    for (const acc of variants) foldMixed(acc);
    const rosters = [COLD, BLUE, [RED[0]!, "frc900", "frc901"], RED, [RED[0]!, BLUE[0]!, "frc900"]];
    for (const roster of rosters) {
      const reference = variants[0]!.momentsFor(roster, 300, 900);
      for (const acc of variants.slice(1)) expect(acc.momentsFor(roster, 300, 900)).toStrictEqual(reference);
    }
    for (const acc of variants) {
      expect(acc.rpColdPrior).toBe(false);
      const cold = acc.momentsFor(COLD, 300, 900);
      expect(cold.meanVector).toEqual([0, 0]);
      expect(cold.varianceBlock).toEqual([
        [0, 0],
        [0, 0],
      ]);
      // The thin roster keeps today's zero variance.
      expect(acc.momentsFor(BLUE, 300, 900).varianceBlock[0]?.[0]).toBe(0);
    }
  });

  it("n = 0: a fresh accumulator with the knob on prices a fully cold roster exactly as off does", () => {
    const acc = on();
    expect(acc.rpColdPrior).toBe(true);
    expect(acc.momentsFor(COLD, 300, 900)).toStrictEqual(new RpMomentsAccumulator(RULES_2026).momentsFor(COLD, 300, 900));
  });

  it("n = 1: a fully cold roster's mean is the one alliance value seen, and its variance is 0", () => {
    const acc = on();
    acc.fold(RED, { [HUB]: 72, [TOWER]: 33 });
    const m = acc.momentsFor(COLD, 300, 900);
    expect(m.meanVector[0]).toBeCloseTo(72, 10);
    expect(m.meanVector[1]).toBeCloseTo(33, 10);
    expect(m.varianceBlock[0]?.[0]).toBe(0);
    expect(m.varianceBlock[1]?.[1]).toBe(0);
  });

  it("n >= 2: a fully cold 3-team roster prices the league's mean and unbiased variance of the alliance values", () => {
    const acc = on();
    const hub = [40, 95, 61, 120, 18];
    const tower = [10, 35, 22, 48, 30];
    hub.forEach((h, i) => acc.fold([`frc${10 + 3 * i}`, `frc${11 + 3 * i}`, `frc${12 + 3 * i}`], { [HUB]: h, [TOWER]: tower[i]! }));
    const m = acc.momentsFor(COLD, 300, 900);
    expect(m.meanVector[0]).toBeCloseTo(populationMean(hub), 8);
    expect(m.meanVector[1]).toBeCloseTo(populationMean(tower), 8);
    expect(m.varianceBlock[0]?.[0]).toBeCloseTo(populationVariance(hub), 6);
    expect(m.varianceBlock[1]?.[1]).toBeCloseTo(populationVariance(tower), 6);
    expect(m.varianceBlock[0]?.[1]).toBe(0);
  });

  it("n >= 2: a fully cold 2-team roster prices the same league moments, so the scale is the roster size and nothing hardcodes 3", () => {
    const acc = on();
    const hub = [20, 80, 50, 35];
    hub.forEach((h, i) => acc.fold([`frc${10 + 2 * i}`, `frc${11 + 2 * i}`], { [HUB]: h, [TOWER]: 5 + i }));
    const m = acc.momentsFor(["frc900", "frc901"], 300, 900);
    expect(m.meanVector[0]).toBeCloseTo(populationMean(hub), 8);
    expect(m.varianceBlock[0]?.[0]).toBeCloseTo(populationVariance(hub), 6);
  });

  it("partial roster: one warm team plus two cold ones adds 2m/3 to the mean and averages 2v/9 into the variance", () => {
    const acc = on();
    acc.fold(RED, { [HUB]: 30, [TOWER]: 20 });
    acc.fold(RED, { [HUB]: 90, [TOWER]: 50 });
    acc.fold(BLUE, { [HUB]: 60, [TOWER]: 44 });
    const hubValues = [30, 90, 60];
    const m = populationMean(hubValues);
    const v = populationVariance(hubValues);
    const warmShares = [30 / 3, 90 / 3];

    const priced = acc.momentsFor([RED[0]!, "frc900", "frc901"], 300, 900);
    expect(priced.meanVector[0]).toBeCloseTo(weightedMeanOf(warmShares) + (2 * m) / 3, 8);
    expect(priced.varianceBlock[0]?.[0]).toBeCloseTo(((weightedVarianceOf(warmShares) + (2 * v) / 9) * 9) / 3, 6);
  });

  it("thin team: a belief with an undefined variance takes v/r^2 instead of 0 once n >= 2", () => {
    const hub = [30, 90, 60];
    const tower = [12, 40, 25];
    const rosters = [RED, BLUE, ["frc7", "frc8", "frc9"]];
    const acc = on();
    const off = new RpMomentsAccumulator(RULES_2026);
    rosters.forEach((roster, i) => {
      acc.fold(roster, { [HUB]: hub[i]!, [TOWER]: tower[i]! });
      off.fold(roster, { [HUB]: hub[i]!, [TOWER]: tower[i]! });
    });
    const mixed = [RED[0]!, BLUE[0]!, "frc7"];
    const priced = acc.momentsFor(mixed, 300, 900);
    // Every team is thin: its mean is its one share.
    expect(priced.meanVector[0]).toBeCloseTo(hub.reduce((a, b) => a + b / 3, 0), 8);
    expect(priced.varianceBlock[0]?.[0]).toBeCloseTo(populationVariance(hub), 6);
    expect(priced.varianceBlock[1]?.[1]).toBeCloseTo(populationVariance(tower), 6);
    expect(off.momentsFor(mixed, 300, 900).varianceBlock[0]?.[0]).toBe(0);
  });

  it("the population summary is per variable: a non-finite value grows nothing, a finite one grows its own variable", () => {
    const acc = on();
    acc.fold(RED, { [HUB]: 40, [TOWER]: 10 });
    acc.fold(BLUE, { [HUB]: 80, [TOWER]: 30 });
    const before = acc.momentsFor(COLD, 300, 900);
    acc.fold(["frc7", "frc8", "frc9"], { [HUB]: Number.NaN, [TOWER]: 110 });
    const after = acc.momentsFor(COLD, 300, 900);
    expect(after.meanVector[0]).toBe(before.meanVector[0]);
    expect(after.varianceBlock[0]?.[0]).toBe(before.varianceBlock[0]?.[0]);
    expect(after.meanVector[1]).toBeCloseTo(populationMean([10, 30, 110]), 8);
    expect(after.meanVector[1]).not.toBeCloseTo(before.meanVector[1] as number, 4);
  });

  it("warm teams are untouched: a fully warm roster prices identically on and off, and hasHistory is unchanged", () => {
    const acc = on();
    const off = new RpMomentsAccumulator(RULES_2026);
    for (const a of [acc, off]) {
      foldMixed(a);
      a.fold(["frc900", "frc901", "frc903"], { [HUB]: 12, [TOWER]: 7 });
    }
    expect(acc.momentsFor(RED, 300, 900)).toStrictEqual(off.momentsFor(RED, 300, 900));
    expect(acc.hasHistory("frc999")).toBe(false);
    expect(acc.hasHistory(RED[0]!)).toBe(true);
    expect(acc.hasHistory(BLUE[0]!)).toBe(off.hasHistory(BLUE[0]!));
  });

  it("snapshotFor carries the knob and the population summary, and later live folds never reach the copy", () => {
    const acc = on();
    foldMixed(acc);
    acc.fold(["frc7", "frc8", "frc9"], { [HUB]: 25, [TOWER]: 70 });
    const roster = [RED[0]!, "frc900", BLUE[1]!];
    const snapshot = acc.snapshotFor([...roster, "frc901"]);
    expect(snapshot.rpColdPrior).toBe(true);
    const live = acc.momentsFor(roster, 300, 900);
    expect(snapshot.momentsFor(roster, 300, 900)).toStrictEqual(live);
    // The cold team really was priced from the summary (non-vacuity).
    const offCopy = new RpMomentsAccumulator(RULES_2026);
    foldMixed(offCopy);
    offCopy.fold(["frc7", "frc8", "frc9"], { [HUB]: 25, [TOWER]: 70 });
    expect(live.meanVector[0]).not.toBe(offCopy.momentsFor(roster, 300, 900).meanVector[0]);

    acc.fold(["frc30", "frc31", "frc32"], { [HUB]: 500, [TOWER]: 400 });
    acc.fold(RED, { [HUB]: 3, [TOWER]: 1 });
    expect(snapshot.momentsFor(roster, 300, 900)).toStrictEqual(live);
    expect(acc.momentsFor(roster, 300, 900)).not.toStrictEqual(live);
  });

  it("beliefsByTeam carries no summary, and fromBeliefs with no third argument rebuilds the pre-9.0.0 model", () => {
    const acc = on();
    const off = new RpMomentsAccumulator(RULES_2026);
    for (const a of [acc, off]) foldMixed(a);
    expect(acc.beliefsByTeam()).toStrictEqual(off.beliefsByTeam());
    const resumed = RpMomentsAccumulator.fromBeliefs(RULES_2026, acc.beliefsByTeam());
    expect(resumed.rpColdPrior).toBe(false);
    const cold = resumed.momentsFor(COLD, 300, 900);
    expect(cold.meanVector).toEqual([0, 0]);
    expect(cold.varianceBlock).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });
});

// ──────── RP population on the resume path (shape 17) ─────────────────────

/**
 * The live Worker resumes the RP cold-team prior from the league row's
 * population summary (SPR 9.0.0). A resumed accumulator must answer exactly
 * as the one that wrote the summary, before and after further folds.
 */
describe("RpMomentsAccumulator populationState/fromBeliefs population, the Worker's shape 17 resume path", () => {
  const BLUE = ["frc4", "frc5", "frc6"];
  const COLD = ["frc900", "frc901", "frc902"];
  const THIN = ["frc7", "frc900", "frc901"];

  /** Warm RED and BLUE (two observations each), a thin frc7 (one observation). */
  function source(): RpMomentsAccumulator {
    const acc = new RpMomentsAccumulator(RULES_2026, { rpColdPrior: true });
    acc.fold(RED, { [HUB]: 30, [TOWER]: 20 });
    acc.fold(BLUE, { [HUB]: 66, [TOWER]: 41 });
    acc.fold(RED, { [HUB]: 90, [TOWER]: 50 });
    acc.fold(BLUE, { [HUB]: 72, [TOWER]: 18 });
    acc.fold(["frc7", "frc8", "frc9"], { [HUB]: 54, [TOWER]: 27 });
    return acc;
  }

  function resume(src: RpMomentsAccumulator): RpMomentsAccumulator {
    return RpMomentsAccumulator.fromBeliefs(RULES_2026, src.beliefsByTeam(), { population: src.populationState() });
  }

  const ROSTERS: readonly (readonly string[])[] = [COLD, THIN, RED, [RED[0]!, BLUE[1]!, "frc900"]];

  it("populationState is undefined with the prior off", () => {
    const off = new RpMomentsAccumulator(RULES_2026);
    off.fold(RED, { [HUB]: 30, [TOWER]: 20 });
    expect(off.populationState()).toBeUndefined();
  });

  it("populationState carries the season and every declared variable, a never-observed one as zeros", () => {
    const fresh = new RpMomentsAccumulator(RULES_2026, { rpColdPrior: true });
    const empty = fresh.populationState()!;
    expect(empty.season).toBe(RULES_2026.season);
    expect(Object.keys(empty.variables)).toEqual(RULES_2026.thresholdVariables.map((v) => v.name));
    for (const entry of Object.values(empty.variables)) expect(entry).toEqual({ n: 0, mean: 0, m2: 0 });

    const acc = new RpMomentsAccumulator(RULES_2026, { rpColdPrior: true });
    acc.fold(RED, { [HUB]: 30 });
    acc.fold(BLUE, { [HUB]: 90 });
    const state = acc.populationState()!;
    expect(Object.keys(state.variables)).toEqual([HUB, TOWER]);
    expect(state.variables[HUB]!.n).toBe(2);
    expect(state.variables[HUB]!.mean).toBeCloseTo(60, 10);
    expect(state.variables[HUB]!.m2).toBeCloseTo(1800, 8);
    expect(state.variables[TOWER]).toEqual({ n: 0, mean: 0, m2: 0 });
  });

  it("a resumed accumulator runs the prior and answers momentsFor exactly as the source for cold, thin and warm rosters", () => {
    const src = source();
    const resumed = resume(src);
    expect(resumed.rpColdPrior).toBe(true);
    for (const roster of ROSTERS) expect(resumed.momentsFor(roster, 300, 900)).toEqual(src.momentsFor(roster, 300, 900));
    expect(resumed.populationState()).toEqual(src.populationState());
  });

  it("the source and the resumed accumulator stay identical after folding the same five further alliances", () => {
    const src = source();
    const resumed = resume(src);
    const further: readonly [readonly string[], Record<string, number>][] = [
      [COLD, { [HUB]: 44, [TOWER]: 12 }],
      [THIN, { [HUB]: 81, [TOWER]: 39 }],
      [RED, { [HUB]: 105, [TOWER]: 61 }],
      [["frc20", "frc21", "frc22"], { [HUB]: 8, [TOWER]: Number.NaN }],
      [BLUE, { [HUB]: 59, [TOWER]: 33 }],
    ];
    for (const [roster, observed] of further) {
      src.fold(roster, observed);
      resumed.fold(roster, observed);
    }
    for (const roster of [...ROSTERS, ["frc30", "frc31", "frc32"]]) {
      expect(resumed.momentsFor(roster, 300, 900)).toEqual(src.momentsFor(roster, 300, 900));
    }
    expect(resumed.populationState()).toEqual(src.populationState());
  });

  it("non-vacuity: resuming WITHOUT the population prices the cold and thin rosters differently", () => {
    const src = source();
    const withoutPopulation = RpMomentsAccumulator.fromBeliefs(RULES_2026, src.beliefsByTeam());
    expect(withoutPopulation.momentsFor(COLD, 300, 900)).not.toEqual(src.momentsFor(COLD, 300, 900));
    expect(withoutPopulation.momentsFor(THIN, 300, 900)).not.toEqual(src.momentsFor(THIN, 300, 900));
  });

  /** A resume whose population is empty: the prior is on, and a cold roster reads as a fresh knob-on accumulator. */
  function expectEmptyPopulation(resumed: RpMomentsAccumulator): void {
    expect(resumed.rpColdPrior).toBe(true);
    const fresh = new RpMomentsAccumulator(RULES_2026, { rpColdPrior: true });
    expect(resumed.momentsFor(COLD, 300, 900)).toEqual(fresh.momentsFor(COLD, 300, 900));
    expect(resumed.populationState()).toEqual(fresh.populationState());
  }

  it("another season's population and a missing population resume an EMPTY population with the prior on", () => {
    const src = source();
    const state = src.populationState()!;
    expectEmptyPopulation(
      RpMomentsAccumulator.fromBeliefs(RULES_2026, src.beliefsByTeam(), { population: { ...state, season: 2025 } })
    );
    expectEmptyPopulation(RpMomentsAccumulator.fromBeliefs(RULES_2026, src.beliefsByTeam(), { population: undefined }));
  });

  it("each malformed entry resumes an EMPTY population (all-or-nothing)", () => {
    const src = source();
    const state = src.populationState()!;
    const good = state.variables[TOWER]!;
    const defects: readonly unknown[] = [
      { ...good, n: 2.5 },
      { ...good, n: -1 },
      { ...good, n: Number.NaN },
      { ...good, mean: Number.POSITIVE_INFINITY },
      { ...good, mean: Number.NaN },
      { ...good, mean: "3" },
      { ...good, m2: -0.5 },
      { ...good, m2: Number.POSITIVE_INFINITY },
      { n: good.n, mean: good.mean },
      null,
      7,
      "entry",
    ];
    for (const defect of defects) {
      const population = { season: state.season, variables: { ...state.variables, [TOWER]: defect } } as unknown as RpPopulationState;
      expectEmptyPopulation(RpMomentsAccumulator.fromBeliefs(RULES_2026, src.beliefsByTeam(), { population }));
    }
    for (const variables of [null, 42, "variables", [state.variables[HUB]]]) {
      const population = { season: state.season, variables } as unknown as RpPopulationState;
      expectEmptyPopulation(RpMomentsAccumulator.fromBeliefs(RULES_2026, src.beliefsByTeam(), { population }));
    }
  });

  it("an unknown variable name is skipped and the rest restores", () => {
    const src = source();
    const state = src.populationState()!;
    const population: RpPopulationState = {
      season: state.season,
      variables: { ...state.variables, cargoBonus: { n: 40, mean: 999, m2: 12 } },
    };
    const resumed = RpMomentsAccumulator.fromBeliefs(RULES_2026, src.beliefsByTeam(), { population });
    expect(resumed.populationState()).toEqual(state);
    expect(resumed.momentsFor(COLD, 300, 900)).toEqual(src.momentsFor(COLD, 300, 900));
  });
});
