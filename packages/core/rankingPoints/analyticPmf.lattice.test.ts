/**
 * The lattice family through `analyticPmf.ts`'s clause evaluation (quick task
 * 260914-01x, SD-02). Multi-term and divisor-bearing clauses are summed by
 * exact lattice convolution; each reference below enumerates term pmfs built
 * in this file, never by the code under test.
 */
import { describe, expect, it } from "vitest";
import { rp2016 } from "./2016.js";
import { rp2017 } from "./2017.js";
import { rp2023 } from "./2023.js";
import { allianceBonusRpPmf, analyticRpPmf, emptyMarginalResolutionTally } from "./analyticPmf.js";
import { buildBonusPmfGoldenRows, buildRuleModuleMoments, GOLDEN_EVENT_TYPES } from "./analyticPmfFixtures.js";
import { RP_REGISTERED_SEASONS, RP_RULE_MODULES, resolveRpThreshold, type MarginalFamily, type RpRuleModule } from "./rules.js";

function withFamily(ruleModule: RpRuleModule, family: MarginalFamily, only?: ReadonlySet<string>): RpRuleModule {
  return {
    ...ruleModule,
    thresholdVariables: ruleModule.thresholdVariables.map((v) => (only === undefined || only.has(v.name) ? { ...v, marginalFamily: family } : v)),
  };
}

function choose(n: number, k: number): number {
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return c;
}

function rising(a: number, k: number): number {
  let r = 1;
  for (let i = 0; i < k; i++) r *= a + i;
  return r;
}

/** The bounded form's reference: beta-binomial matched to mean and variance in step units on `n` steps (every case below is overdispersed and inside the support). */
function refBoundedPmf(mean: number, variance: number, step: number, max: number): number[] {
  const n = max / step;
  const m = mean / step;
  const v = variance / (step * step);
  const p = m / n;
  const bin = n * p * (1 - p);
  const rho = (v / bin - 1) / (n - 1);
  expect(rho > 0 && rho < 0.999).toBe(true);
  const alpha = p * (1 / rho - 1);
  const beta = (1 - p) * (1 / rho - 1);
  const raw = Array.from({ length: n + 1 }, (_, k) => (choose(n, k) * rising(alpha, k) * rising(beta, n - k)) / rising(alpha + beta, n));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((x) => x / sum);
}

function refPhi(z: number): number {
  const x = z / Math.SQRT2;
  let term = x;
  let sum = x;
  for (let n = 1; n < 400; n++) {
    term *= (-x * x) / n;
    const add = term / (2 * n + 1);
    sum += add;
    if (Math.abs(add) < 1e-20) break;
  }
  return 0.5 * (1 + (2 / Math.sqrt(Math.PI)) * sum);
}

function thresholdOf(ruleModule: RpRuleModule, bonusName: string): number {
  const predicate = ruleModule.bonusPredicates.find((p) => p.name === bonusName)!;
  if (predicate.kind !== "linearCombination") throw new Error(`test expects ${bonusName} to be a linearCombination`);
  return resolveRpThreshold(predicate.threshold, "base");
}

function bonusProbability(ruleModule: RpRuleModule, values: Record<string, { mean: number; variance: number }>, bonusName: string): number {
  const result = allianceBonusRpPmf(buildRuleModuleMoments(ruleModule, values), ruleModule, 0);
  return result.bonusProbabilities[ruleModule.bonusNames.indexOf(bonusName)]!;
}

describe("lattice clause sums match brute-force enumeration", () => {
  it("2017 rotor: autoRotorPoints / 60 + teleopRotorPoints / 40", () => {
    const lattice = withFamily(rp2017, "lattice");
    const values = {
      autoFuelPoints: { mean: 10, variance: 25 },
      teleopFuelPoints: { mean: 20, variance: 100 },
      autoRotorPoints: { mean: 70, variance: 1800 },
      teleopRotorPoints: { mean: 100, variance: 1600 },
    };
    const auto = refBoundedPmf(70, 1800, 60, 120);
    const teleop = refBoundedPmf(100, 1600, 40, 160);
    const threshold = thresholdOf(rp2017, "rotor");
    let expected = 0;
    auto.forEach((pa, i) => teleop.forEach((pt, j) => (i + j >= threshold ? (expected += pa * pt) : 0)));
    expect(expected).toBeGreaterThan(0.01);
    expect(Math.abs(bonusProbability(lattice, values, "rotor") - expected)).toBeLessThan(1e-12);
  });

  it("2016 capture: P(attackedTowerEndStrength <= 0) times P(teleopChallengePoints / 5 + teleopScalePoints / 15 >= 3)", () => {
    const lattice = withFamily(rp2016, "lattice");
    const values = {
      attackedTowerEndStrength: { mean: 1, variance: 4 },
      teleopChallengePoints: { mean: 7, variance: 30 },
      teleopScalePoints: { mean: 20, variance: 300 },
    };
    const challenge = refBoundedPmf(7, 30, 5, 15);
    const scale = refBoundedPmf(20, 300, 15, 45);
    let robots = 0;
    challenge.forEach((pc, i) => scale.forEach((ps, j) => (i + j >= 3 ? (robots += pc * ps) : 0)));
    const expected = refPhi((0.5 - 1) / 2) * robots;
    expect(Math.abs(bonusProbability(lattice, values, "capture") - expected)).toBeLessThan(1e-12);
  });

  it("2023 sustainabilityBonus: one term, divisor 5", () => {
    const lattice = withFamily(rp2023, "lattice");
    const values = { totalChargeStationPoints: { mean: 20, variance: 90 }, linkPoints: { mean: 20, variance: 150 } };
    const links = refBoundedPmf(20, 150, 5, 45);
    const threshold = thresholdOf(rp2023, "sustainabilityBonus");
    const expected = links.reduce((sum, p, k) => (k >= threshold ? sum + p : sum), 0);
    expect(Math.abs(bonusProbability(lattice, values, "sustainabilityBonus") - expected)).toBeLessThan(1e-12);
  });
});

describe("the lattice family evaluates every predicate shape without throwing", () => {
  it("2017 under negative binomial throws on its sums; under lattice it does not", () => {
    const moments = buildRuleModuleMoments(rp2017, {
      autoFuelPoints: { mean: 10, variance: 25 },
      teleopFuelPoints: { mean: 20, variance: 100 },
      autoRotorPoints: { mean: 70, variance: 1800 },
      teleopRotorPoints: { mean: 100, variance: 1600 },
    });
    expect(() => allianceBonusRpPmf(moments, withFamily(rp2017, "negative-binomial"), 0)).toThrow(/not closed under scaled addition/);
    expect(() => allianceBonusRpPmf(moments, withFamily(rp2017, "lattice"), 0)).not.toThrow();
  });

  it("every registered season's all-lattice variant over the golden moment patterns (out-of-support, zero-variance and non-finite included) yields normalized pmfs and probabilities in [0, 1]", () => {
    for (const season of RP_REGISTERED_SEASONS) {
      const lattice = withFamily(RP_RULE_MODULES[season]!, "lattice");
      for (const eventType of GOLDEN_EVENT_TYPES) {
        for (const scale of [1, 5, -3]) {
          const rows = buildBonusPmfGoldenRows(lattice, eventType, scale);
          for (const row of rows) {
            const sum = row.pmf.reduce((a, b) => a + b, 0);
            expect(Math.abs(sum - 1), `${season} ${eventType} ${row.pattern} x${scale}`).toBeLessThan(1e-9);
            expect(row.bonusProbabilities.every((p) => p >= 0 && p <= 1)).toBe(true);
          }
        }
      }
    }
  });

  it("mixed declared families within one clause still throw", () => {
    // 2026-09-14 (Task 5): rp2017 ships all-lattice now, so the mix is built
    // from a gaussian-declared base with one variable flipped back to lattice.
    const mixed = withFamily(withFamily(rp2017, "gaussian"), "lattice", new Set(["autoRotorPoints"]));
    const moments = buildRuleModuleMoments(mixed, {
      autoFuelPoints: { mean: 10, variance: 25 },
      teleopFuelPoints: { mean: 20, variance: 100 },
      autoRotorPoints: { mean: 70, variance: 1800 },
      teleopRotorPoints: { mean: 100, variance: 1600 },
    });
    expect(() => allianceBonusRpPmf(moments, mixed, 0)).toThrow(/distinct marginal families/);
  });

  it("the tally counts lattice resolutions on their own axis, in both the call tally and an external one", () => {
    const lattice = withFamily(rp2023, "lattice");
    const moments = buildRuleModuleMoments(lattice, { totalChargeStationPoints: { mean: 20, variance: 90 }, linkPoints: { mean: 20, variance: 150 } });
    const external = emptyMarginalResolutionTally();
    const result = analyticRpPmf({ red: moments, blue: moments, ruleModule: lattice, eventType: 0, compLevel: "qm", tally: external });
    expect(result.marginalResolution).toEqual({ negativeBinomial: 0, gaussian: 0, degenerate: 0, lattice: 4, fallbacks: 0 });
    expect(external).toEqual({ negativeBinomial: 0, gaussian: 0, degenerate: 0, lattice: 4, fallbacks: 0 });
  });
});
