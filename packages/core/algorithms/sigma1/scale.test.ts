/**
 * D-T1's verification bar, stated as tests rather than argued in prose:
 * the filter is SCALE-EQUIVARIANT, the resolve is leak-free, the ONE linear
 * scaling is distinguishable from the four squared ones, and a relative field
 * is UNREADABLE from inside a helper.
 */
import { describe, expect, it } from "vitest";
import { makeSigma1 } from "./index.js";
import { DEFAULT_SIGMA1_PARAMS, type Sigma1Params } from "./params.js";
import { resolveSigma1Params, type Sigma1ResolvedParams } from "./scale.js";
import { emptyExpandingStats, foldObservation } from "../../scoring/expandingStats.js";
import type { MatchResult, Prediction, UpcomingMatch } from "../types.js";

/**
 * THE factor, and it is not arbitrary. 4 is a power of two, so multiplying a
 * double by it is EXACT in IEEE-754: every intermediate product, sum, quotient
 * and square root in the filter scales exactly, with no rounding introduced
 * anywhere. That is what turns the equivariance claim below into an EQUALITY
 * assertion rather than a tolerance. A future maintainer who "simplifies" this
 * to 1.7 will get a mysterious near-miss failure — the model will still be
 * equivariant, the arithmetic just will not be exact.
 */
const SCALE = 4;

const TEAMS = ["frcA", "frcB", "frcC", "frcD", "frcE", "frcF"] as const;

/**
 * Matches with NO score breakdown, so `update()` takes the D-05 fallback path
 * (`fallbackObserved` -> `distributeResidual`) and every observation is
 * derived from `redScore`/`blueScore` alone. That is deliberate: the fallback
 * path is the one whose observation is a pure function of the alliance SCORE,
 * so scaling the scores scales the whole observation vector exactly. A real
 * breakdown would need every one of its ~13 raw point fields scaled too,
 * which tests the breakdown parser rather than the filter's equivariance.
 */
function stream(scale: number): MatchResult[] {
  const rows: readonly (readonly [string, string, number, number])[] = [
    ["2024eva_qm1", "2024eva", 61, 43],
    ["2024eva_qm2", "2024eva", 58, 72],
    ["2024eva_qm3", "2024eva", 90, 55],
    ["2024eva_qm4", "2024eva", 37, 41],
    ["2024evb_qm1", "2024evb", 105, 66],
    ["2024evb_qm2", "2024evb", 48, 93],
  ];
  return rows.map(([matchKey, eventKey, red, blue]) => ({
    matchKey,
    eventKey,
    compLevel: "qm" as const,
    setNumber: 1,
    matchNumber: 1,
    redTeams: [TEAMS[0], TEAMS[1], TEAMS[2]],
    blueTeams: [TEAMS[3], TEAMS[4], TEAMS[5]],
    redSurrogates: [],
    blueSurrogates: [],
    redDqs: [],
    blueDqs: [],
    winner: red > blue ? ("red" as const) : ("blue" as const),
    redScore: red * scale,
    blueScore: blue * scale,
    redRpEarned: null,
    blueRpEarned: null,
    hasScoreBreakdown: false,
    scoreBreakdownRaw: null,
    eventType: 0,
  }));
}

function toUpcoming(m: MatchResult): UpcomingMatch {
  return {
    matchKey: m.matchKey,
    eventKey: m.eventKey,
    compLevel: m.compLevel,
    setNumber: m.setNumber,
    matchNumber: m.matchNumber,
    redTeams: m.redTeams,
    blueTeams: m.blueTeams,
    redSurrogates: m.redSurrogates,
    blueSurrogates: m.blueSurrogates,
    eventType: m.eventType,
  };
}

/** Walk-forward replay: predict from the pre-match state, then update. */
function replay(params: Sigma1Params, scale: number): Prediction[] {
  const algorithm = makeSigma1({ id: "scale-test", linkMode: "predictive-variance", params });
  let state = algorithm.initState([...TEAMS]);
  const predictions: Prediction[] = [];
  for (const m of stream(scale)) {
    predictions.push(algorithm.predict(state, toUpcoming(m)));
    state = algorithm.update(state, m);
  }
  return predictions;
}

describe("scale equivariance (D-T1's named verification bar)", () => {
  it("multiplying every alliance score AND fallbackScoreSd by 4 leaves every pRedWin BITWISE identical and every predicted score exactly 4x", () => {
    // `rpMonteCarloDraws: 0` short-circuits the RP joint model. The RP
    // subsystem is deliberately NOT scale-relative (F3: threshold variables
    // are counts, not points), so it is not equivariant and has no business
    // in an equivariance test — excluding it is the honest scope, not a
    // convenience.
    const base: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, rpMonteCarloDraws: 0 };
    const scaled: Sigma1Params = { ...base, fallbackScoreSd: base.fallbackScoreSd * SCALE };

    const runA = replay(base, 1);
    const runB = replay(scaled, SCALE);

    expect(runA).toHaveLength(runB.length);
    for (let i = 0; i < runA.length; i++) {
      const a = runA[i]!;
      const b = runB[i]!;
      // BITWISE, not `toBeCloseTo`: a win probability is a dimensionless
      // ratio of two quantities that scale identically, so at a power-of-two
      // factor it must come out as the very same double.
      expect(b.pRedWin, `match ${i}: pRedWin must be bitwise identical`).toBe(a.pRedWin);
      expect(b.redScore, `match ${i}: predicted red score must be exactly ${SCALE}x`).toBe(a.redScore * SCALE);
      expect(b.blueScore, `match ${i}: predicted blue score must be exactly ${SCALE}x`).toBe(a.blueScore * SCALE);
      // Variance is a squared quantity, so it scales by the SQUARE of the
      // factor — asserting this alongside the linear one is what distinguishes
      // genuine equivariance from a coincidence in the probability alone.
      expect(b.variance, `match ${i}: predictive variance must be exactly ${SCALE ** 2}x`).toBe(a.variance! * SCALE ** 2);
    }

    // Non-vacuity: the fixture must actually exercise the filter. A stream
    // whose every prediction was 0.5 would satisfy everything above while
    // proving nothing.
    expect(new Set(runA.map((p) => p.pRedWin)).size).toBeGreaterThan(1);
    expect(runA.some((p) => p.redScore !== 0)).toBe(true);
  });
});

describe("resolveSigma1Params", () => {
  it("resolves at the documented COLD-START scale before any alliance score has been folded", () => {
    const resolved = resolveSigma1Params(DEFAULT_SIGMA1_PARAMS, emptyExpandingStats());

    // `standardDeviation`'s own `count < 2` contract: the fallback SD stands
    // in for a scale that does not exist yet.
    expect(resolved.scoreSd).toBe(DEFAULT_SIGMA1_PARAMS.fallbackScoreSd);
    expect(resolved.scoreVariance).toBe(DEFAULT_SIGMA1_PARAMS.fallbackScoreSd ** 2);

    expect(resolved.processNoiseWithinEvent).toBe(DEFAULT_SIGMA1_PARAMS.processNoiseWithinEventRel * resolved.scoreVariance);
    expect(resolved.processNoiseEventBoundary).toBe(DEFAULT_SIGMA1_PARAMS.processNoiseEventBoundaryRel * resolved.scoreVariance);
    expect(resolved.minConsistencyVariance).toBe(DEFAULT_SIGMA1_PARAMS.minConsistencyVarianceRel * resolved.scoreVariance);
    expect(resolved.coldStartConsistencyVariance).toBe(
      DEFAULT_SIGMA1_PARAMS.coldStartConsistencyVarianceRel * resolved.scoreVariance
    );
  });

  it("scales coldStartTeamTotal LINEARLY by sigma, not by sigma squared", () => {
    // The two scalings are one character apart in `scale.ts`. Fold a set of
    // observations with a KNOWN spread so `scoreSd` is a real measured value
    // rather than the fallback, then check the linear field against `scoreSd`
    // and — as the control that makes the assertion sharp — against
    // `scoreVariance` too.
    let stats = emptyExpandingStats();
    for (const x of [40, 60, 40, 60]) stats = foldObservation(stats, x);
    const resolved = resolveSigma1Params(DEFAULT_SIGMA1_PARAMS, stats);

    expect(resolved.scoreSd).toBe(10); // population SD of {40,60,40,60}
    expect(resolved.scoreVariance).toBe(100);
    expect(resolved.coldStartTeamTotal).toBe(DEFAULT_SIGMA1_PARAMS.coldStartTeamTotalRel * resolved.scoreSd);
    expect(resolved.coldStartTeamTotal).not.toBe(DEFAULT_SIGMA1_PARAMS.coldStartTeamTotalRel * resolved.scoreVariance);
  });

  it("falls back rather than resolving a scale of ZERO when every folded observation is identical", () => {
    // `standardDeviation` returns a real 0 here — mathematically correct, and
    // catastrophic as a scale: it would zero the process noise, the cold-start
    // consistency AND the variance floor at once, giving a team P = R = 0 and
    // therefore a permanently zero Kalman gain (see `scale.ts`'s header, and
    // `index.ts`'s `seedConsistencyFor` for the same failure one level down).
    let stats = emptyExpandingStats();
    for (const x of [50, 50, 50]) stats = foldObservation(stats, x);

    const resolved = resolveSigma1Params(DEFAULT_SIGMA1_PARAMS, stats);
    expect(resolved.scoreSd).toBe(DEFAULT_SIGMA1_PARAMS.fallbackScoreSd);
    expect(resolved.minConsistencyVariance).toBeGreaterThan(0);
    expect(resolved.processNoiseWithinEvent).toBeGreaterThan(0);
  });

  it("is leak-free: resolving, folding one more observation, and resolving again leaves the FIRST result untouched", () => {
    let stats = emptyExpandingStats();
    for (const x of [40, 60, 55]) stats = foldObservation(stats, x);

    const before = resolveSigma1Params(DEFAULT_SIGMA1_PARAMS, stats);
    const beforeSd = before.scoreSd;
    const beforeNoise = before.processNoiseWithinEvent;

    const after = resolveSigma1Params(DEFAULT_SIGMA1_PARAMS, foldObservation(stats, 200));

    // The first result cannot have moved (this is the property Pitfall EPA-1
    // is about), and the second MUST have — otherwise the test would pass
    // against a resolve that ignores its statistic entirely.
    expect(before.scoreSd).toBe(beforeSd);
    expect(before.processNoiseWithinEvent).toBe(beforeNoise);
    expect(after.scoreSd).not.toBe(beforeSd);
    expect(after.processNoiseWithinEvent).not.toBe(beforeNoise);
  });

  it("makes a scale-relative field UNREADABLE from a helper that takes the resolved type (checked by the compiler, not believed)", () => {
    const helper = (p: Sigma1ResolvedParams): number =>
      // @ts-expect-error — the `Omit` in `Sigma1ResolvedParams` removes every
      // relative field, so "resolve once, at a leak-free point" is a fact
      // about the type system rather than a convention a future edit can
      // quietly break. If this line ever compiles, that guarantee is gone and
      // `@ts-expect-error` turns THIS test red — which is the point.
      p.processNoiseWithinEventRel;
    expect(typeof helper(resolveSigma1Params(DEFAULT_SIGMA1_PARAMS, emptyExpandingStats()))).toBe("undefined");
  });
});
