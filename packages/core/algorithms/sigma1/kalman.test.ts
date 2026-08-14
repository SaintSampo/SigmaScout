/**
 * Synthetic-fixture tests for Sigma1's alliance-sum Kalman core (D-07,
 * T-02-10), matching `opr.test.ts`'s "known answer or provable structural
 * property" convention.
 */
import { describe, expect, it } from "vitest";
import {
  SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY,
  SIGMA1_PROCESS_NOISE_WITHIN_EVENT,
  applyProcessNoise,
  updateAllianceSum,
  type TeamComponentBelief,
} from "./kalman.js";

describe("SIGMA1_PROCESS_NOISE_WITHIN_EVENT / SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY", () => {
  it("are exported positive constants, boundary strictly larger than within-event", () => {
    expect(SIGMA1_PROCESS_NOISE_WITHIN_EVENT).toBeGreaterThan(0);
    expect(SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY).toBeGreaterThan(0);
    expect(SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY).toBeGreaterThan(SIGMA1_PROCESS_NOISE_WITHIN_EVENT);
  });
});

describe("applyProcessNoise", () => {
  it("inflates variance by exactly q and leaves mean untouched", () => {
    const belief: TeamComponentBelief = { mean: 12, variance: 4 };
    const next = applyProcessNoise(belief, 3);
    expect(next.mean).toBe(12);
    expect(next.variance).toBe(7);
  });

  it("with the event-boundary magnitude increases variance strictly more than with the within-event magnitude", () => {
    const belief: TeamComponentBelief = { mean: 5, variance: 2 };
    const withinEvent = applyProcessNoise(belief, SIGMA1_PROCESS_NOISE_WITHIN_EVENT);
    const boundary = applyProcessNoise(belief, SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY);
    expect(boundary.variance).toBeGreaterThan(withinEvent.variance);
  });
});

describe("updateAllianceSum — gain distribution", () => {
  it("with three teammates of equal variance, splits the innovation equally", () => {
    const teammates: TeamComponentBelief[] = [
      { mean: 10, variance: 4 },
      { mean: 10, variance: 4 },
      { mean: 10, variance: 4 },
    ];
    const updated = updateAllianceSum(teammates, 36, 0); // predicted 30, innovation 6
    for (const belief of updated) {
      expect(belief.mean).toBeCloseTo(12, 9); // 10 + (4/12)*6 = 12
    }
  });

  it("with unequal variances, the teammate with the larger variance absorbs proportionally more of the innovation", () => {
    const teammates: TeamComponentBelief[] = [
      { mean: 10, variance: 1 },
      { mean: 10, variance: 9 },
    ];
    const updated = updateAllianceSum(teammates, 30, 0); // predicted 20, innovation 10
    const gainedFirst = updated[0]!.mean - 10;
    const gainedSecond = updated[1]!.mean - 10;
    expect(gainedSecond).toBeGreaterThan(gainedFirst);
  });
});

describe("updateAllianceSum — posterior variance shrinks", () => {
  it("every teammate's posterior variance is strictly smaller after an update than before, equal to gain * priorVariance reduction", () => {
    const teammates: TeamComponentBelief[] = [
      { mean: 8, variance: 5 },
      { mean: 8, variance: 5 },
      { mean: 8, variance: 5 },
    ];
    const measurementNoise = 2;
    const updated = updateAllianceSum(teammates, 30, measurementNoise);
    const pooled = teammates.reduce((s, t) => s + t.variance, 0) + measurementNoise;
    teammates.forEach((prior, i) => {
      const gain = prior.variance / pooled;
      const expectedVariance = prior.variance - gain * prior.variance;
      expect(updated[i]!.variance).toBeLessThan(prior.variance);
      expect(updated[i]!.variance).toBeCloseTo(expectedVariance, 9);
    });
  });

  it("posterior variance decreases monotonically over at least 10 repeated observations for a team with a fixed measurement noise", () => {
    let belief: TeamComponentBelief = { mean: 0, variance: 100 };
    const variances: number[] = [belief.variance];
    for (let i = 0; i < 10; i++) {
      const updated = updateAllianceSum([belief], 20, 5);
      belief = updated[0]!;
      variances.push(belief.variance);
    }
    for (let i = 1; i < variances.length; i++) {
      expect(variances[i]!).toBeLessThan(variances[i - 1]!);
    }
  });
});

describe("updateAllianceSum — synthetic strength recovery", () => {
  it("recovers known synthetic team strengths within a documented tolerance over many varying, overlapping alliances (the same identifiability shape opr.test.ts's ridge-solve fixture uses — a single repeated alliance composition cannot identify individual strengths, only their sum)", () => {
    const trueStrengths: Record<string, number> = {
      T1: 20,
      T2: 15,
      T3: 30,
      T4: 10,
      T5: 25,
      T6: 18,
    };
    const teams = Object.keys(trueStrengths);
    const beliefs: Record<string, TeamComponentBelief> = Object.fromEntries(
      teams.map((t) => [t, { mean: 0, variance: 100 }])
    );

    // Every 3-team combination among 6 teams (20 alliances), scored as an
    // exact sum of the true strengths (no noise), replayed for several
    // passes so the filter sees each overlapping alliance many times —
    // enough independent, overlapping observations for individual
    // strengths to become identifiable (opr.test.ts's own reasoning for
    // using every combination rather than one fixed alliance).
    function combinations(items: readonly string[], k: number): string[][] {
      if (k === 0) return [[]];
      if (items.length < k) return [];
      const [first, ...rest] = items;
      const withFirst = combinations(rest, k - 1).map((combo) => [first!, ...combo]);
      const withoutFirst = combinations(rest, k);
      return [...withFirst, ...withoutFirst];
    }
    const alliances = combinations(teams, 3);

    for (let pass = 0; pass < 40; pass++) {
      for (const allianceTeams of alliances) {
        const teammates = allianceTeams.map((t) => beliefs[t]!);
        const observedSum = allianceTeams.reduce((s, t) => s + trueStrengths[t]!, 0);
        const updated = updateAllianceSum(teammates, observedSum, 0.1);
        allianceTeams.forEach((t, idx) => {
          beliefs[t] = updated[idx]!;
        });
      }
    }

    for (const team of teams) {
      expect(Math.abs(beliefs[team]!.mean - trueStrengths[team]!)).toBeLessThan(1);
    }
  });
});

describe("updateAllianceSum — degenerate branches (T-02-10)", () => {
  it("with pooledVariance + measurementNoise exactly 0, returns every teammate's belief unchanged and no value is NaN", () => {
    const teammates: TeamComponentBelief[] = [
      { mean: 10, variance: 0 },
      { mean: 12, variance: 0 },
    ];
    const updated = updateAllianceSum(teammates, 999, 0);
    expect(updated).toEqual(teammates);
    for (const belief of updated) {
      expect(Number.isNaN(belief.mean)).toBe(false);
      expect(Number.isNaN(belief.variance)).toBe(false);
    }
  });

  it("with an empty teammate list, returns an empty array and does not throw", () => {
    expect(() => updateAllianceSum([], 50, 3)).not.toThrow();
    expect(updateAllianceSum([], 50, 3)).toEqual([]);
  });
});
