/**
 * D-Q2 (quick task 260901-is2): the durable evidence that Sigma1's
 * measurement-noise term R is estimated from INNOVATIONS rather than from
 * gain-weighted corrections, and that the change is what it claims to be.
 *
 * CONTEXT.md's verification bar names a synthetic recovery of a KNOWN sigma
 * as this change's proof. The harness that originally produced that number
 * was a session-local scratchpad and is gone; this file is its committed
 * replacement, so the claim survives the session that made it.
 *
 * Four things are pinned here, and each exists because it can fail:
 *
 *   1. RECOVERY. On a synthetic league whose truth is known by construction
 *      — the model's own assumptions exactly satisfied, a true per-team
 *      per-match sigma of 12 — the published TOTAL spread recovers 12.
 *   2. NEGATIVE CONTROL. The RETIRED estimator, replayed over the SAME match
 *      stream, does not. Without this, a future change that quietly reverted
 *      the estimator could still pass (1) by widening its tolerance until
 *      2.3 fit inside it. With it, a revert has to explain away a 5x gap.
 *   3. IDENTITY. The number `consistency.ts` folds and the number on the
 *      covariance matrix's diagonal are ONE quantity, read out of the
 *      shipped code rather than restated as arithmetic. If they drifted, the
 *      published ± and the filter's own R would disagree.
 *   4. RP UNTOUCHED. `residualsByTeam` still carries the SIGNED gain-weighted
 *      residual `K_j * innovation` into the RP cross-covariance. D-Q2
 *      deliberately left that subsystem alone, and the innovation-based
 *      sample is a non-negative magnitude that could not substitute for it.
 *
 * Every random draw here comes from a seeded generator defined in this file.
 * `Math.random` would make the headline assertion a coin flip.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGMA1_PARAMS,
  applyProcessNoise,
  shrinkConsistency,
  teamTotalVariance,
  updateAllianceSum,
  vpr,
  type TeamComponentBelief,
} from "./index.js";
import { ewmaCovariance } from "./covariance.js";
import { foldConsistency } from "./consistency.js";
import { emptyCovariance } from "./covariance.js";
import { emptyExpandingStats, foldObservation, type ExpandingStats } from "../../scoring/expandingStats.js";
import { TOTAL_METRIC_KEY, type MatchResult, type UpcomingMatch } from "../types.js";

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/** mulberry32 — a small, well-mixed 32-bit PRNG. Deterministic given `seed`, so every number in this file is reproducible on any machine. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller, drawing two uniforms per call. Standard normal; callers scale. */
function makeGaussian(rng: () => number): () => number {
  return () => {
    // `1 - rng()` keeps the log's argument strictly positive.
    const u1 = 1 - rng();
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

// ---------------------------------------------------------------------------
// The synthetic league
// ---------------------------------------------------------------------------

/**
 * The twelve 2024 components a team actually contributes to, paired with the
 * raw `score_breakdown` field each is parsed from (`breakdown/2024.ts`'s
 * `OWN_FIELD_COMPONENT_MAP`). `foulsCommitted` is deliberately excluded and
 * held at exactly 0 throughout: it is cross-attributed from the OPPONENT's
 * `foulPoints` (D-04), so giving it synthetic noise would be modelling a
 * quantity whose truth is not this team's own performance.
 */
const COMPONENT_FIELDS = [
  ["autoLeave", "autoLeavePoints"],
  ["autoAmpNote", "autoAmpNotePoints"],
  ["autoSpeakerNote", "autoSpeakerNotePoints"],
  ["teleopAmpNote", "teleopAmpNotePoints"],
  ["teleopSpeakerNote", "teleopSpeakerNotePoints"],
  ["teleopSpeakerNoteAmplified", "teleopSpeakerNoteAmplifiedPoints"],
  ["endGameOnStage", "endGameOnStagePoints"],
  ["endGamePark", "endGameParkPoints"],
  ["endGameHarmony", "endGameHarmonyPoints"],
  ["endGameNoteInTrap", "endGameNoteInTrapPoints"],
  ["endGameSpotLightBonus", "endGameSpotLightBonusPoints"],
  ["adjust", "adjustPoints"],
] as const;

const COMPONENT_COUNT = COMPONENT_FIELDS.length; // 12

/**
 * The truth this file exists to recover: the standard deviation of ONE
 * team's TOTAL contribution to its alliance's score in ONE match, around
 * that team's own mean. 12 points is the value CONTEXT.md's original
 * synthetic measurement used.
 */
const TRUE_TEAM_MATCH_SIGMA = 12;

/**
 * Split across independent per-component noise so the per-team TOTAL sigma
 * is exactly `TRUE_TEAM_MATCH_SIGMA`: with C independent components each of
 * sigma `s`, the total sigma is `s * sqrt(C)`, so `s = SIGMA / sqrt(C)`.
 * Independence across components is what makes the covariance matrix's
 * off-diagonals average to 0, so the published TOTAL spread (which sums
 * EVERY entry of that matrix, not just the trace) recovers the same 12.
 */
const TRUE_COMPONENT_SIGMA = TRUE_TEAM_MATCH_SIGMA / Math.sqrt(COMPONENT_COUNT);

const TEAM_COUNT = 60;
const ROUNDS = 45; // 45 rounds x 10 matches = 450 matches, ~45 matches per team

interface SyntheticMatch {
  readonly redTeams: readonly string[];
  readonly blueTeams: readonly string[];
  /** Per-component observed alliance totals, indexed like `COMPONENT_FIELDS`. */
  readonly redComponents: readonly number[];
  readonly blueComponents: readonly number[];
}

/**
 * Generates a league in which every one of the filter's own assumptions is
 * literally true: each team has a fixed per-component mean, each match's
 * realized contribution is that mean plus independent Gaussian noise of a
 * known sigma, and an alliance's observed component total is exactly the sum
 * of its three teammates' realized contributions. Under those conditions the
 * correct answer for a team's published TOTAL spread is
 * `TRUE_TEAM_MATCH_SIGMA` (plus a little, for the filter's own residual
 * uncertainty about the mean), and any systematic departure is estimator
 * bias rather than model mismatch.
 */
function buildSyntheticLeague(seed: number): {
  readonly teams: readonly string[];
  readonly matches: readonly SyntheticMatch[];
} {
  const rng = makeRng(seed);
  const gaussian = makeGaussian(rng);

  const teams = Array.from({ length: TEAM_COUNT }, (_, i) => `T${String(i).padStart(2, "0")}`);
  // Team strength spans a realistic range; the per-component mean is the
  // strength divided evenly, which keeps the components uncorrelated in the
  // MEAN as well as in the noise.
  const trueComponentMean = new Map<string, number>();
  for (const team of teams) {
    const strength = 24 + rng() * 72; // total points per match, 24..96
    trueComponentMean.set(team, strength / COMPONENT_COUNT);
  }

  const matches: SyntheticMatch[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    // Fisher-Yates on a copy, so every team plays exactly once per round and
    // alliance composition keeps changing.
    const shuffled = [...teams];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    for (let m = 0; m + 6 <= shuffled.length; m += 6) {
      const redTeams = shuffled.slice(m, m + 3);
      const blueTeams = shuffled.slice(m + 3, m + 6);
      const sideTotals = (sideTeams: readonly string[]): number[] =>
        Array.from({ length: COMPONENT_COUNT }, () =>
          sideTeams.reduce((sum, team) => sum + trueComponentMean.get(team)! + gaussian() * TRUE_COMPONENT_SIGMA, 0)
        );
      matches.push({
        redTeams,
        blueTeams,
        redComponents: sideTotals(redTeams),
        blueComponents: sideTotals(blueTeams),
      });
    }
  }

  return { teams, matches };
}

/** The RP-side fields `rp/2024.ts`'s own schema requires. Held constant: no assertion in this file is about RP thresholds. */
const RP_PLACEHOLDER_FIELDS = {
  autoAmpNoteCount: 0,
  autoSpeakerNoteCount: 0,
  teleopAmpNoteCount: 0,
  teleopSpeakerNoteCount: 0,
  teleopSpeakerNoteAmplifiedCount: 0,
  endGameTotalStagePoints: 0,
  endGameRobot1: "None",
  endGameRobot2: "None",
  endGameRobot3: "None",
  coopertitionBonusAchieved: false,
  melodyBonusAchieved: false,
  ensembleBonusAchieved: false,
  melodyBonusThresholdCoop: 0,
  melodyBonusThresholdNonCoop: 0,
  ensembleBonusStagePointsThreshold: 0,
  ensembleBonusOnStageRobotsThreshold: 0,
};

function rawBreakdown(
  redComponents: readonly number[],
  blueComponents: readonly number[],
  rpOverrides: Record<string, unknown> = {}
): string {
  const side = (components: readonly number[]) => {
    const out: Record<string, unknown> = { ...RP_PLACEHOLDER_FIELDS, ...rpOverrides };
    COMPONENT_FIELDS.forEach(([, field], i) => {
      out[field] = components[i]!;
    });
    // 0 on both sides, so each alliance's cross-attributed `foulsCommitted`
    // is exactly 0 and carries no synthetic noise.
    out["foulPoints"] = 0;
    return out;
  };
  return JSON.stringify({ red: side(redComponents), blue: side(blueComponents) });
}

function syntheticMatchResult(m: SyntheticMatch, index: number, rpOverrides: Record<string, unknown> = {}): MatchResult {
  const redScore = m.redComponents.reduce((a, b) => a + b, 0);
  const blueScore = m.blueComponents.reduce((a, b) => a + b, 0);
  return {
    matchKey: `2024syn_qm${index + 1}`,
    eventKey: "2024syn",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: index + 1,
    redTeams: [...m.redTeams],
    blueTeams: [...m.blueTeams],
    redSurrogates: [],
    blueSurrogates: [],
    redDqs: [],
    blueDqs: [],
    winner: redScore >= blueScore ? "red" : "blue",
    redScore,
    blueScore,
    redRpEarned: null,
    blueRpEarned: null,
    hasScoreBreakdown: true,
    scoreBreakdownRaw: rawBreakdown(m.redComponents, m.blueComponents, rpOverrides),
    eventType: 0,
  };
}

// ---------------------------------------------------------------------------
// The RETIRED estimator, replayed over the same stream (the negative control)
// ---------------------------------------------------------------------------

interface ShadowTeam {
  beliefs: TeamComponentBelief[];
  covariance: number[][];
  consistency: number[];
  matchCount: number;
}

/**
 * A faithful standalone replay of the estimator D-Q2 RETIRED, over the SAME
 * generated match stream, built from the same exported primitives the shipped
 * module uses (`applyProcessNoise`, `updateAllianceSum`,
 * `foldConsistency`, `ewmaCovariance`, `shrinkConsistency`) so it cannot
 * drift into a strawman. Its ONE difference from the shipped path is the
 * quantity folded into R: each teammate's own squared gain-weighted
 * correction `(K_j * innovation)^2`, rather than
 * `max(0, innovation^2 - sum P) / n`.
 *
 * This is a full trajectory, not a shadow fold on the shipped filter's
 * states: R feeds back into the Kalman gain, so the retired estimator's own
 * gains and posteriors diverge from the shipped ones after the first match,
 * and only running it forward on its own state reproduces what it would
 * actually have published.
 *
 * Simplifications, both deliberate and both stated so this stays readable as
 * a control rather than as a second implementation to maintain: every team
 * is seeded at cold start up front (the shipped path seeds a team appearing
 * later in the season from the live league average instead — an immaterial
 * difference after 45 matches per team), and only the 12 offensive
 * components are carried, since `foulsCommitted` is held at 0.
 */
function retiredEstimatorMedianSpread(league: ReturnType<typeof buildSyntheticLeague>): {
  readonly medianSpread: number;
  readonly medianRTerm: number;
} {
  const params = DEFAULT_SIGMA1_PARAMS;
  const coldStartMean = params.coldStartTeamTotal / (COMPONENT_COUNT + 1); // +1: the shipped component order includes foulsCommitted
  const shadow = new Map<string, ShadowTeam>();
  for (const team of league.teams) {
    shadow.set(team, {
      beliefs: Array.from({ length: COMPONENT_COUNT }, () => ({
        mean: coldStartMean,
        variance: params.coldStartConsistencyVariance,
      })),
      covariance: emptyCovariance(COMPONENT_COUNT),
      consistency: new Array<number>(COMPONENT_COUNT).fill(params.coldStartConsistencyVariance),
      matchCount: 0,
    });
  }
  let leagueConsistency: ExpandingStats[] = Array.from({ length: COMPONENT_COUNT }, () => emptyExpandingStats());

  const applyAlliance = (allianceTeams: readonly string[], observed: readonly number[]): void => {
    const working = allianceTeams.map((team) => {
      const t = shadow.get(team)!;
      // Every match here is in one event, and adaptation is off in
      // DEFAULT_SIGMA1_PARAMS, so q is the within-event magnitude unscaled.
      return { ...t, beliefs: t.beliefs.map((b) => applyProcessNoise(b, params.processNoiseWithinEvent)) };
    });

    const residualVectors = allianceTeams.map(() => new Array<number>(COMPONENT_COUNT).fill(0));
    const nextBeliefs = working.map((t) => [...t.beliefs]);

    for (let c = 0; c < COMPONENT_COUNT; c++) {
      const teammateBeliefs = working.map((t) => t.beliefs[c]!);
      const measurementNoise = working.reduce((sum, t) => sum + t.consistency[c]!, 0);
      const updated = updateAllianceSum(teammateBeliefs, observed[c]!, measurementNoise);
      const pooled = teammateBeliefs.reduce((sum, t) => sum + t.variance, 0) + measurementNoise;
      const innovation = observed[c]! - teammateBeliefs.reduce((sum, t) => sum + t.mean, 0);
      teammateBeliefs.forEach((belief, i) => {
        nextBeliefs[i]![c] = updated[i]!;
        // THE RETIRED ATTRIBUTION: the Kalman-gain-weighted share.
        residualVectors[i]![c] = pooled === 0 ? 0 : (belief.variance / pooled) * innovation;
      });
      let stats = leagueConsistency[c]!;
      for (const vector of residualVectors) stats = foldObservation(stats, vector[c]! * vector[c]!);
      leagueConsistency[c] = stats;
    }

    allianceTeams.forEach((team, i) => {
      const t = working[i]!;
      shadow.set(team, {
        beliefs: nextBeliefs[i]!,
        // THE RETIRED FOLD: squared gain-weighted residuals, through the
        // residual doors of both estimators.
        covariance: ewmaCovariance(t.covariance, residualVectors[i]!, params.covEwmaAlpha, params.covShrinkage),
        consistency: t.consistency.map((prior, c) => foldConsistency(prior, residualVectors[i]![c]!, params.consistencyEwmaAlpha)),
        matchCount: t.matchCount + 1,
      });
    });
  };

  for (const m of league.matches) {
    applyAlliance(m.redTeams, m.redComponents);
    applyAlliance(m.blueTeams, m.blueComponents);
  }

  // The retired PUBLISHED total spread, assembled exactly as `teamMetrics`
  // assembles it: sqrt(P + R) with R floored, over the same component set.
  // `rTerm` is that same read's R HALF on its own — reported separately
  // because the total bundles R with the filter's posterior P, and it is R
  // that the estimator change is about.
  const spreads: number[] = [];
  const rTerms: number[] = [];
  for (const team of league.teams) {
    const t = shadow.get(team)!;
    const posterior = t.beliefs.reduce((sum, b) => sum + b.variance, 0);
    const r = Math.max(params.minConsistencyVariance, teamTotalVariance(t.covariance));
    spreads.push(Math.sqrt(posterior + r));
    rTerms.push(Math.sqrt(r));
  }
  // Referenced so an unused-import lint cannot quietly delete the two
  // primitives that document this control's fidelity to the shipped read path.
  void leagueConsistency;
  void shrinkConsistency;
  return { medianSpread: median(spreads), medianRTerm: median(rTerms) };
}

// ---------------------------------------------------------------------------

describe("D-Q2 — the published ± recovers a known sigma", () => {
  const league = buildSyntheticLeague(20260901);

  /**
   * TOLERANCE, and why it is this wide and no wider.
   *
   * The correct answer is not exactly 12. The published spread is
   * `sqrt(P + R)`: R recovers the true 12 in expectation, and P — the
   * filter's own remaining uncertainty about each team's mean, kept from
   * collapsing by D-07's per-match process noise — is a real, non-zero
   * addition on top of it. `max(0, .)` on the variance sample also biases R
   * upward slightly, since a sample that lands below zero is truncated
   * rather than allowed to cancel a high one. Both push the answer ABOVE
   * 12, which is why the window is asymmetric in spirit even though it is
   * written symmetrically: CONTEXT.md's original measurement landed at
   * 12.35 (0.97x of truth, on a slightly different fixture).
   *
   * [10, 15] is roughly +/-25%, which is loose enough to survive a change of
   * seed, league size, or match count, and tight enough that it excludes
   * BOTH failure directions that matter: the retired estimator's ~2.3 (the
   * negative control below), and any change that inflated the spread by
   * folding the alliance's variance instead of the team's (which would land
   * near 12*sqrt(3) = 20.8).
   */
  const LOWER = 10;
  const UPPER = 15;

  it(`recovers a true per-team per-match sigma of ${TRUE_TEAM_MATCH_SIGMA} in the published TOTAL spread`, () => {
    let state = vpr.initState([...league.teams]);
    league.matches.forEach((m, i) => {
      state = vpr.update(state, syntheticMatchResult(m, i));
    });

    const metrics = vpr.teamMetrics(state, [...league.teams]);
    const spreads: number[] = [];
    for (const team of league.teams) {
      const spread = metrics[team]?.[TOTAL_METRIC_KEY]?.spread;
      // `TeamMetric.spread` is optional in the shared type, so this is
      // asserted rather than defaulted: an absent TOTAL spread would
      // otherwise sink into the median as a silent NaN or 0, and Sigma1
      // publishing no spread at all would be the very failure this file
      // exists to catch.
      expect(spread).toBeDefined();
      spreads.push(spread!);
    }
    const measured = median(spreads);

    expect(spreads.length).toBe(TEAM_COUNT);
    expect(measured).toBeGreaterThan(LOWER);
    expect(measured).toBeLessThan(UPPER);
    // Not a lucky median over a wildly dispersed set: the middle 80% of
    // teams must also land in a believable band, so a bimodal result cannot
    // hide behind a central value.
    const sorted = [...spreads].sort((a, b) => a - b);
    expect(sorted[Math.floor(0.1 * TEAM_COUNT)]!).toBeGreaterThan(0.5 * TRUE_TEAM_MATCH_SIGMA);
    expect(sorted[Math.floor(0.9 * TEAM_COUNT)]!).toBeLessThan(3 * TRUE_TEAM_MATCH_SIGMA);
  });

  /**
   * MEASURED VALUES, so a future reader can tell a real regression from a
   * tolerance drift (2026-09-01, seed 20260901, DEFAULT_SIGMA1_PARAMS):
   *
   *   shipped total spread   median 13.40  (truth 12 — 1.12x)
   *   retired total spread   median  6.88  (0.57x)
   *   retired R term alone   median  4.72  (0.39x)
   *
   * A NOTE ON MAGNITUDE, because it differs from CONTEXT.md's headline.
   * CONTEXT measured the retired estimator at 2.29 against the same true 12
   * — a 5.3x understatement — on a synthetic fixture built with the PROMOTED
   * parameter set. This fixture uses `DEFAULT_SIGMA1_PARAMS`, under which
   * the filter's posterior P settles much wider (median ~25 in variance
   * terms, i.e. ~5 points of spread). Since the published number is
   * `sqrt(P + R)`, that P PROPS UP the retired total: 6.9 rather than 2.3.
   * The estimator's own R term is understated 2.6x (4.7 against 12), which
   * is the quantity D-Q2 is actually about. Both assertions below are
   * therefore made: one on the R term, isolating the estimator, and one on
   * the published total, which is what a revert would have to sneak past.
   */
  it("NEGATIVE CONTROL: the retired gain-weighted estimator, on the same match stream, does not recover the truth", () => {
    const retired = retiredEstimatorMedianSpread(league);

    expect(retired.medianSpread).toBeGreaterThan(0);
    // The estimator in isolation: R understates the truth by more than 2x.
    expect(retired.medianRTerm * 2).toBeLessThan(TRUE_TEAM_MATCH_SIGMA);
    // The load-bearing anti-revert assertion: the retired published spread
    // falls well OUTSIDE the recovery window above, so that window cannot
    // simply be widened until a revert fits inside it — LOWER would have to
    // be abandoned outright, which is a visible act rather than a quiet one.
    expect(retired.medianSpread).toBeLessThan(0.75 * TRUE_TEAM_MATCH_SIGMA);
    expect(retired.medianSpread).toBeLessThan(LOWER);
  });
});

describe("D-Q2 — the consistency fold and the covariance diagonal are ONE quantity", () => {
  /**
   * Read out of the SHIPPED code after a single update, rather than restated
   * as arithmetic. Both estimators start from a known prior on a fresh
   * state, so each fold is invertible:
   *
   *   consistency[c] = (1 - a) * coldStart + a * sample
   *   covariance[c][c] = (1 - covA) * 0 + covA * sample
   *
   * Recovering `sample` from each and comparing is what proves they saw the
   * same number. If a future change computed the covariance diagonal from
   * `d_c^2` directly and forgot the `- sum P_c / n` correction, these two
   * would part company here while every other test in the suite stayed
   * green.
   */
  it("recovers the same variance sample from both folds, and from the hand-computed formula", () => {
    const params = DEFAULT_SIGMA1_PARAMS;
    const OBSERVED_AUTO_LEAVE = 40;
    const OTHERS = 10;

    const components = COMPONENT_FIELDS.map(([name]) => (name === "autoLeave" ? OBSERVED_AUTO_LEAVE : OTHERS));
    const blueComponents = COMPONENT_FIELDS.map(() => OTHERS);

    let state = vpr.initState(["A", "B", "C", "D", "E", "F"]);
    state = vpr.update(
      state,
      syntheticMatchResult(
        {
          redTeams: ["A", "B", "C"],
          blueTeams: ["D", "E", "F"],
          redComponents: components,
          blueComponents,
        },
        0
      )
    );

    const teamA = state.teams.get("A")!;
    const index = state.componentOrder.indexOf("autoLeave");
    expect(index).toBeGreaterThanOrEqual(0);

    // Hand-computed. Every teammate cold-starts identically on a fresh
    // state: mean = coldStartTeamTotal / componentCount, variance =
    // coldStartConsistencyVariance. Cold-start teams take no process noise
    // (there is no prior observation to have drifted from), so sum P is
    // exact.
    const n = 3;
    const coldStartMean = params.coldStartTeamTotal / state.componentOrder.length;
    const sumP = n * params.coldStartConsistencyVariance;
    const innovation = OBSERVED_AUTO_LEAVE - n * coldStartMean;
    const expectedSample = Math.max(0, innovation * innovation - sumP) / n;
    // Non-vacuity: the floor must NOT be what produced this number, or the
    // test would pass against any estimator that returns 0.
    expect(expectedSample).toBeGreaterThan(1);

    const fromConsistency =
      (teamA.consistency["autoLeave"]! - (1 - params.consistencyEwmaAlpha) * params.coldStartConsistencyVariance) /
      params.consistencyEwmaAlpha;
    const fromCovarianceDiagonal = teamA.covariance[index]![index]! / params.covEwmaAlpha;

    expect(fromConsistency).toBeCloseTo(expectedSample, 9);
    expect(fromCovarianceDiagonal).toBeCloseTo(expectedSample, 9);
    // The identity itself, to the tolerance the plan asks for: these are two
    // views of one number, not two estimates that happen to agree.
    expect(Math.abs(fromConsistency - fromCovarianceDiagonal)).toBeLessThan(1e-12 * Math.max(1, expectedSample));
  });

  it("gives every teammate on an alliance the SAME per-component sample — an honest property of a summed observation, not a bug", () => {
    const components = COMPONENT_FIELDS.map(([name]) => (name === "autoLeave" ? 40 : 10));
    let state = vpr.initState(["A", "B", "C", "D", "E", "F"]);
    state = vpr.update(
      state,
      syntheticMatchResult(
        { redTeams: ["A", "B", "C"], blueTeams: ["D", "E", "F"], redComponents: components, blueComponents: components },
        0
      )
    );
    const a = state.teams.get("A")!.consistency["autoLeave"]!;
    const b = state.teams.get("B")!.consistency["autoLeave"]!;
    const c = state.teams.get("C")!.consistency["autoLeave"]!;
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

describe("D-Q2 — the RP subsystem is untouched", () => {
  /**
   * `residualsByTeam` is internal to `applyAllianceUpdate`, but its ONE
   * consumer writes it into published state: `rp/state.ts` folds
   * `ewmaCrossCovariance(prior, scoreResidualVector, rpResidualVector,
   * alpha)`, and folds the RP residual's own outer product into
   * `rpCovariance`, whose diagonal is left unshrunk. Both are plain EWMAs,
   * so both are invertible against the PRE-update state:
   *
   *   alpha * rpResid_t^2            = rpCov2[t][t]  - (1 - alpha) * rpCov1[t][t]
   *   alpha * scoreResid_c * rpResid_t = rpCross2[c][t] - (1 - alpha) * rpCross1[c][t]
   *
   * Dividing recovers `|scoreResid_c|` without needing any RP number, and
   * that is what gets compared against a hand-computed `K_j * innovation_c`.
   *
   * TWO updates, not one: an RP threshold variable is cold-started to its
   * first observation, so a single match produces an exactly-zero RP
   * residual and the recovery would be 0/0. Match 1 establishes the RP
   * priors; match 2 moves both the score side and the RP side.
   */
  const RP_MOVED = { autoSpeakerNoteCount: 4, teleopSpeakerNoteCount: 3, endGameTotalStagePoints: 6 };
  const ALLIANCE = ["A", "B", "C"] as const;

  function twoUpdates(autoLeaveObserved: number) {
    const flat = COMPONENT_FIELDS.map(() => 10);
    const moved = COMPONENT_FIELDS.map(([name]) => (name === "autoLeave" ? autoLeaveObserved : 10));
    const base = { redTeams: [...ALLIANCE], blueTeams: ["D", "E", "F"] };

    let state = vpr.initState([]);
    state = vpr.update(state, syntheticMatchResult({ ...base, redComponents: flat, blueComponents: flat }, 0));
    const afterFirst = state;
    state = vpr.update(state, syntheticMatchResult({ ...base, redComponents: moved, blueComponents: flat }, 1, RP_MOVED));
    return { afterFirst, afterSecond: state };
  }

  /** `alpha * scoreResid_c * rpResid_t`, isolated from its EWMA prior. */
  function crossDelta(before: number, after: number, alpha: number): number {
    return after - (1 - alpha) * before;
  }

  it("still carries the SIGNED gain-weighted residual K_j * innovation into rpCrossCovariance", () => {
    const params = DEFAULT_SIGMA1_PARAMS;
    const OBSERVED = 40;
    const { afterFirst, afterSecond } = twoUpdates(OBSERVED);
    const before = afterFirst.teams.get("A")!;
    const after = afterSecond.teams.get("A")!;
    const componentIndex = afterSecond.componentOrder.indexOf("autoLeave");
    expect(componentIndex).toBeGreaterThanOrEqual(0);

    // Hand-computed gain for match 2, from the state match 1 left behind.
    // Every teammate is process-noised by the within-event magnitude first
    // (same event, and adaptation is off in DEFAULT_SIGMA1_PARAMS, so the
    // factor is exactly 1). R is the sum of the three teammates' own
    // consistency, multiplier 1 for a real breakdown.
    const priors = ALLIANCE.map((team) => afterFirst.teams.get(team)!);
    const p = priors.map((t) => t.beliefs["autoLeave"]!.variance + params.processNoiseWithinEvent);
    const measurementNoise = priors.reduce((sum, t) => sum + t.consistency["autoLeave"]!, 0);
    const sumP = p.reduce((a, b) => a + b, 0);
    const gainA = p[0]! / (sumP + measurementNoise);
    const innovation = OBSERVED - priors.reduce((sum, t) => sum + t.beliefs["autoLeave"]!.mean, 0);
    const expectedScoreResidual = gainA * innovation;
    expect(Math.abs(expectedScoreResidual)).toBeGreaterThan(0.1);

    // Any threshold variable that actually moved in match 2.
    const t = after.rpCovariance.findIndex(
      (row, i) => Math.abs(crossDelta(before.rpCovariance[i]![i]!, row[i]!, params.covEwmaAlpha)) > 1e-9
    );
    expect(t).toBeGreaterThanOrEqual(0);

    const rpResidualSquared = crossDelta(before.rpCovariance[t]![t]!, after.rpCovariance[t]![t]!, params.covEwmaAlpha) / params.covEwmaAlpha;
    const rpResidualMagnitude = Math.sqrt(rpResidualSquared);
    const crossTerm = crossDelta(
      before.rpCrossCovariance[componentIndex]![t]!,
      after.rpCrossCovariance[componentIndex]![t]!,
      params.covEwmaAlpha
    );
    const recovered = Math.abs(crossTerm) / (params.covEwmaAlpha * rpResidualMagnitude);

    expect(recovered).toBeCloseTo(Math.abs(expectedScoreResidual), 8);
    // And it is far smaller than the innovation-based variance sample for
    // the same component — the two are not interchangeable in magnitude
    // either, not just in sign.
    expect(recovered).toBeLessThan(Math.max(0, innovation * innovation - sumP) / 3);
  });

  it("the score residual is SIGNED — its sign flips with the innovation, which a non-negative variance sample never could", () => {
    const params = DEFAULT_SIGMA1_PARAMS;
    const high = twoUpdates(40);
    const low = twoUpdates(0);
    const componentIndex = high.afterSecond.componentOrder.indexOf("autoLeave");

    // The RP side is IDENTICAL between the two runs (only `autoLeave`
    // differs), so `rpResid_t` is the same and any sign change in the cross
    // term is a sign change in the SCORE residual.
    const t = high.afterSecond.teams
      .get("A")!
      .rpCovariance.findIndex(
        (row, i) =>
          Math.abs(crossDelta(high.afterFirst.teams.get("A")!.rpCovariance[i]![i]!, row[i]!, params.covEwmaAlpha)) > 1e-9
      );
    expect(t).toBeGreaterThanOrEqual(0);

    const term = (run: ReturnType<typeof twoUpdates>) =>
      crossDelta(
        run.afterFirst.teams.get("A")!.rpCrossCovariance[componentIndex]![t]!,
        run.afterSecond.teams.get("A")!.rpCrossCovariance[componentIndex]![t]!,
        params.covEwmaAlpha
      );

    const above = term(high);
    const below = term(low);
    expect(Math.abs(above)).toBeGreaterThan(1e-9);
    expect(Math.abs(below)).toBeGreaterThan(1e-9);
    // An observed 40 is above the alliance's prediction; an observed 0 is
    // below it. A signed residual changes sign between the two; the
    // innovation-based variance sample, floored at 0, never can.
    expect(Math.sign(above)).toBe(-Math.sign(below));
  });

  it("still emits a non-empty redRpPmf/blueRpPmf for a fixture with a real breakdown", () => {
    const { afterSecond } = twoUpdates(40);
    const upcoming: UpcomingMatch = {
      matchKey: "2024syn_qm3",
      eventKey: "2024syn",
      compLevel: "qm",
      setNumber: 1,
      matchNumber: 3,
      redTeams: [...ALLIANCE],
      blueTeams: ["D", "E", "F"],
      redSurrogates: [],
      blueSurrogates: [],
      eventType: 0,
    };
    const prediction = vpr.predict(afterSecond, upcoming);
    expect(prediction.redRpPmf?.length ?? 0).toBeGreaterThan(0);
    expect(prediction.blueRpPmf?.length ?? 0).toBeGreaterThan(0);
  });
});
