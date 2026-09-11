/**
 * Unit tests for `sigmaScore.ts`.
 *
 * The first describe block is the important one: it encodes the DEVELOPER'S TWO
 * REQUIREMENTS as executable assertions rather than leaving them as prose in a
 * header. If a future change breaks "a robot that breaks reads high" or "a robot
 * that repeats itself reads low", these fail — which is the whole reason the
 * metric exists and exactly the kind of claim this project's failure log says
 * goes stale when only documented.
 */
import { describe, expect, it } from "vitest";
import {
  SigmaScoreAccumulator,
  TALENT_FLOOR,
  DEFAULT_SIGMA_SCORE_OPTIONS,
  MIN_POPULATION_FOR_TALENT_PRIOR,
  PRIOR_SIGMA_MIN_RATIO,
  PRIOR_SIGMA_MAX_RATIO,
} from "./sigmaScore.js";

/**
 * An accumulator whose POPULATION has been observed enough times for the talent
 * prior to engage. Many assertions below are about talent scaling or the clamp,
 * and both are deliberately withheld until `MIN_POPULATION_FOR_TALENT_PRIOR`
 * observations exist — so a test that skips this is testing the fallback path
 * while believing it tests the talent path.
 */
function seededPopulation(options?: ConstructorParameters<typeof SigmaScoreAccumulator>[0]): SigmaScoreAccumulator {
  const accumulator = new SigmaScoreAccumulator(options);
  accumulator.observeTalent("frcSeed", 40);
  for (let i = 0; i < MIN_POPULATION_FOR_TALENT_PRIOR + 50; i++) {
    accumulator.fold("frcSeed", i % 2 === 0 ? 8 : -8);
  }
  return accumulator;
}

/** Folds a list of deviations for one team, returning the Sigma Score after each. */
function foldSeries(
  accumulator: SigmaScoreAccumulator,
  teamKey: string,
  deviations: readonly number[]
): number[] {
  const readings: number[] = [];
  for (const deviation of deviations) {
    accumulator.fold(teamKey, deviation);
    readings.push(accumulator.sigmaFor(teamKey));
  }
  return readings;
}

describe("THE DEVELOPER'S REQUIREMENTS", () => {
  it("REQUIREMENT 1: a robot that BREAKS reads HIGHER than one that carries on unchanged", () => {
    const steady = new SigmaScoreAccumulator();
    const breaks = new SigmaScoreAccumulator();
    steady.observeTalent("frc1", 50);
    breaks.observeTalent("frc1", 50);

    // Six matches of identical performance, then the robot keeps going...
    const history = [10, 10, 10, 10, 10, 10];
    foldSeries(steady, "frc1", [...history, 10, 10, 10]);
    // ...versus the robot breaking: it stops contributing entirely.
    foldSeries(breaks, "frc1", [...history, -40, -40, -40]);

    expect(breaks.sigmaFor("frc1")).toBeGreaterThan(steady.sigmaFor("frc1"));
  });

  it("REQUIREMENT 1: a robot that FINALLY STARTS WORKING also reads higher — the rise is not one-directional", () => {
    const steady = new SigmaScoreAccumulator();
    const improves = new SigmaScoreAccumulator();
    steady.observeTalent("frc1", 50);
    improves.observeTalent("frc1", 50);

    const history = [0, 0, 0, 0, 0, 0];
    foldSeries(steady, "frc1", [...history, 0, 0, 0]);
    foldSeries(improves, "frc1", [...history, 45, 45, 45]);

    expect(improves.sigmaFor("frc1")).toBeGreaterThan(steady.sigmaFor("frc1"));
  });

  it("REQUIREMENT 1: the break is still visible SEVERAL matches later, not absorbed immediately", () => {
    // This is the property a fast mean destroys, and the reason meanHalfLife is
    // a separate knob from varHalfLife. With mean and variance both on a 6-match
    // clock, the mean chases the new level and the signal fades fast.
    const slow = new SigmaScoreAccumulator({ meanHalfLife: 18, varHalfLife: 6 });
    const fast = new SigmaScoreAccumulator({ meanHalfLife: 6, varHalfLife: 6 });
    for (const accumulator of [slow, fast]) accumulator.observeTalent("frc1", 50);

    const before = [10, 10, 10, 10, 10, 10];
    const afterBreak = [-40, -40, -40];
    const slowReadings = foldSeries(slow, "frc1", [...before, ...afterBreak]);
    const fastReadings = foldSeries(fast, "frc1", [...before, ...afterBreak]);

    const slowBaseline = slowReadings[before.length - 1]!;
    const fastBaseline = fastReadings[before.length - 1]!;
    const slowRise = slowReadings[slowReadings.length - 1]! / slowBaseline;
    const fastRise = fastReadings[fastReadings.length - 1]! / fastBaseline;

    // Both must react; the slow mean must still be reporting MORE of the event
    // three matches on.
    expect(slowRise).toBeGreaterThan(1);
    expect(fastRise).toBeGreaterThan(1);
    expect(slowRise).toBeGreaterThan(fastRise);
  });

  it("REQUIREMENT 2: a robot that performs identically every match reads LOW", () => {
    const identical = new SigmaScoreAccumulator();
    const erratic = new SigmaScoreAccumulator();
    identical.observeTalent("frc1", 50);
    erratic.observeTalent("frc1", 50);

    foldSeries(identical, "frc1", Array.from({ length: 12 }, () => 7));
    foldSeries(erratic, "frc1", [40, -35, 30, -40, 45, -30, 38, -42, 33, -36, 41, -39]);

    expect(identical.sigmaFor("frc1")).toBeLessThan(erratic.sigmaFor("frc1"));
  });

  it("REQUIREMENT 2: an identical-performance robot converges DOWNWARD toward its floor, never to zero", () => {
    const accumulator = new SigmaScoreAccumulator();
    accumulator.observeTalent("frc1", 50);
    const readings = foldSeries(accumulator, "frc1", Array.from({ length: 30 }, () => 7));

    // Monotone decreasing after the first observation, and still strictly
    // positive — the near-zero tail that broke the incumbent cannot occur.
    expect(readings[readings.length - 1]!).toBeLessThan(readings[2]!);
    expect(readings[readings.length - 1]!).toBeGreaterThan(0);
  });
});

describe("the Bayesian prior", () => {
  it("gives a NEVER-SEEN team a usable figure from talent alone — Swing Factor has none at all here", () => {
    const accumulator = new SigmaScoreAccumulator();
    accumulator.observeTalent("frc1", 80);
    const sigma = accumulator.sigmaFor("frc1");
    expect(Number.isFinite(sigma)).toBe(true);
    expect(sigma).toBeGreaterThan(0);
  });

  it("scales the prior with talent — a stronger robot is expected to swing by more POINTS", () => {
    const accumulator = seededPopulation();
    accumulator.observeTalent("frcWeak", 10);
    accumulator.observeTalent("frcStrong", 100);
    expect(accumulator.sigmaFor("frcStrong")).toBeGreaterThan(accumulator.sigmaFor("frcWeak"));
  });

  it("WITHHOLDS talent scaling until the population is known — an unformed priorK must not scale anything", () => {
    // The other half of the 2026 blow-up fix: before MIN_POPULATION_FOR_TALENT_PRIOR
    // observations, priorK is not yet a real number, so every team falls back to
    // the flat population spread regardless of talent.
    const fresh = new SigmaScoreAccumulator();
    fresh.observeTalent("frcWeak", 10);
    fresh.observeTalent("frcStrong", 9310);
    expect(fresh.priorSigmaFor("frcStrong")).toBeCloseTo(fresh.priorSigmaFor("frcWeak"), 12);
    expect(fresh.priorSigmaFor("frcStrong")).toBeCloseTo(fresh.populationSigma(), 12);
  });

  it("with talentPrior FALSE, two teams of different talent share one prior — the control behaves as a control", () => {
    const accumulator = new SigmaScoreAccumulator({ talentPrior: false });
    accumulator.observeTalent("frcWeak", 10);
    accumulator.observeTalent("frcStrong", 100);
    expect(accumulator.sigmaFor("frcStrong")).toBeCloseTo(accumulator.sigmaFor("frcWeak"), 12);
  });

  it("floors talent so a zero or negative rating cannot produce a zero prior", () => {
    const accumulator = new SigmaScoreAccumulator();
    accumulator.observeTalent("frcZero", 0);
    accumulator.observeTalent("frcNegative", -25);
    expect(accumulator.sigmaFor("frcZero")).toBeGreaterThan(0);
    expect(accumulator.sigmaFor("frcNegative")).toBeGreaterThan(0);
    // Both floor to the same value, so they agree.
    expect(accumulator.sigmaFor("frcZero")).toBeCloseTo(accumulator.sigmaFor("frcNegative"), 12);
    expect(TALENT_FLOOR).toBeGreaterThan(0);
  });

  it("ignores a non-finite talent rather than poisoning every later prior for that team", () => {
    const accumulator = new SigmaScoreAccumulator();
    accumulator.observeTalent("frc1", 50);
    accumulator.observeTalent("frc1", Number.NaN);
    expect(Number.isFinite(accumulator.sigmaFor("frc1"))).toBe(true);
  });

  it("a STRONGER prior shrinks a thin-evidence team further toward its prior", () => {
    const weakPrior = new SigmaScoreAccumulator({ priorObs: 3 });
    const strongPrior = new SigmaScoreAccumulator({ priorObs: 20 });
    for (const accumulator of [weakPrior, strongPrior]) {
      accumulator.observeTalent("frc1", 50);
      // Two nearly identical observations — the case that produced the
      // incumbent's catastrophic near-zero tail.
      foldSeries(accumulator, "frc1", [12, 12.0001]);
    }
    // The strongly-shrunk one must sit closer to its prior, i.e. higher.
    expect(strongPrior.sigmaFor("frc1")).toBeGreaterThan(weakPrior.sigmaFor("frc1"));
  });

  it("priorObs does NOT move the metric's LEVEL — a never-seen team reads the same at any prior strength", () => {
    // The invariant behind `beta0 = (alpha0 - 1) * priorSigma^2`. Without it,
    // priorObs changed calibration and shrinkage at once and no sweep over it
    // could be attributed. A failing test is what surfaced this.
    const readings = [2.5, 4, 8, 20, 100].map((priorObs) => {
      const accumulator = new SigmaScoreAccumulator({ priorObs });
      accumulator.observeTalent("frc1", 60);
      return accumulator.sigmaFor("frc1");
    });
    for (const reading of readings) expect(reading).toBeCloseTo(readings[0]!, 10);
  });

  it("priorObs DOES control how fast evidence moves the reading off the prior", () => {
    const readings = [2.5, 4, 20].map((priorObs) => {
      const accumulator = new SigmaScoreAccumulator({ priorObs });
      accumulator.observeTalent("frc1", 60);
      const priorOnly = accumulator.sigmaFor("frc1");
      // One wildly erratic pair. A weak prior should move much further.
      foldSeries(accumulator, "frc1", [90, -90]);
      return accumulator.sigmaFor("frc1") / priorOnly;
    });
    // Weakest prior moves proportionally furthest, strongest least.
    expect(readings[0]!).toBeGreaterThan(readings[1]!);
    expect(readings[1]!).toBeGreaterThan(readings[2]!);
  });

  it("CLAMPS an absurd talent so the prior cannot assert a spread the population never shows", () => {
    // The regression test for the measured 2026 blow-up: an early under-
    // determined OPR solve produced a talent of 9,310 and the prior claimed a
    // 2,780-point swing for one robot.
    const accumulator = seededPopulation();
    accumulator.observeTalent("frcAbsurd", 9310);
    expect(accumulator.priorSigmaFor("frcAbsurd")).toBeLessThanOrEqual(
      PRIOR_SIGMA_MAX_RATIO * accumulator.populationSigma() * 1.0001
    );
  });

  it("CLAMPS from below too, so a near-zero talent cannot reintroduce the near-zero tail", () => {
    const accumulator = seededPopulation();
    accumulator.observeTalent("frcTiny", 0.0001);
    expect(accumulator.priorSigmaFor("frcTiny")).toBeGreaterThanOrEqual(
      PRIOR_SIGMA_MIN_RATIO * accumulator.populationSigma() * 0.9999
    );
  });

  it("leaves an ORDINARY talent untouched — the clamp bites only the pathological tail", () => {
    const accumulator = seededPopulation();
    accumulator.observeTalent("frcOrdinary", 45);
    const ordinary = accumulator.priorSigmaFor("frcOrdinary");
    expect(ordinary).toBeGreaterThan(PRIOR_SIGMA_MIN_RATIO * accumulator.populationSigma());
    expect(ordinary).toBeLessThan(PRIOR_SIGMA_MAX_RATIO * accumulator.populationSigma());
  });

  it("evidence eventually overwhelms the prior — a genuinely erratic team is not held down by it", () => {
    const accumulator = new SigmaScoreAccumulator({ priorObs: 4 });
    accumulator.observeTalent("frc1", 5); // small talent -> small prior
    const priorOnly = accumulator.sigmaFor("frc1");
    foldSeries(accumulator, "frc1", Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 60 : -60)));
    expect(accumulator.sigmaFor("frc1")).toBeGreaterThan(priorOnly * 3);
  });
});

describe("construction guards", () => {
  it("REJECTS priorObs <= 2, because the posterior predictive variance would not exist", () => {
    expect(() => new SigmaScoreAccumulator({ priorObs: 2 })).toThrow(/priorObs must exceed 2/);
    expect(() => new SigmaScoreAccumulator({ priorObs: 0 })).toThrow(/priorObs must exceed 2/);
  });

  it("REJECTS a non-positive half-life", () => {
    expect(() => new SigmaScoreAccumulator({ meanHalfLife: 0 })).toThrow(/half-lives must be positive/);
    expect(() => new SigmaScoreAccumulator({ varHalfLife: -1 })).toThrow(/half-lives must be positive/);
  });

  it("defaults separate the two half-lives — the mean is slower than the variance", () => {
    expect(DEFAULT_SIGMA_SCORE_OPTIONS.meanHalfLife).toBeGreaterThan(DEFAULT_SIGMA_SCORE_OPTIONS.varHalfLife);
  });

  it("defaults report an honest 1 sigma rather than the incumbent's 1.92 presentation multiplier", () => {
    expect(DEFAULT_SIGMA_SCORE_OPTIONS.scale).toBe(1);
  });
});

describe("fold hygiene", () => {
  it("ignores a non-finite deviation rather than corrupting the belief", () => {
    const accumulator = new SigmaScoreAccumulator();
    accumulator.observeTalent("frc1", 50);
    foldSeries(accumulator, "frc1", [10, 10]);
    const before = accumulator.sigmaFor("frc1");
    accumulator.fold("frc1", Number.NaN);
    accumulator.fold("frc1", Number.POSITIVE_INFINITY);
    expect(accumulator.sigmaFor("frc1")).toBe(before);
  });

  it("keeps teams independent", () => {
    const accumulator = new SigmaScoreAccumulator();
    accumulator.observeTalent("frcA", 50);
    accumulator.observeTalent("frcB", 50);
    foldSeries(accumulator, "frcA", [50, -50, 50, -50]);
    const quiet = accumulator.sigmaFor("frcB");
    foldSeries(accumulator, "frcB", [1, 1, 1, 1]);
    expect(accumulator.sigmaFor("frcB")).toBeLessThan(accumulator.sigmaFor("frcA"));
    expect(Number.isFinite(quiet)).toBe(true);
  });

  it("the bias term tracks a team's level, which is what makes the residual mean something", () => {
    const accumulator = new SigmaScoreAccumulator({ meanHalfLife: 4 });
    accumulator.observeTalent("frc1", 50);
    foldSeries(accumulator, "frc1", Array.from({ length: 20 }, () => 25));
    expect(accumulator.biasFor("frc1")).toBeGreaterThan(20);
    expect(accumulator.biasFor("frc1")).toBeLessThanOrEqual(25);
  });
});
