/**
 * THE PERMANENT GUARD (quick task 260902-varopr, D-V1/D-V2/D-V4).
 *
 * Three estimators of a robot's per-match consistency, measured against KNOWN
 * synthetic sigma on THE SAME generated data — the shared draw is the point,
 * since it removes the sampling difference from the comparison:
 *
 *   1. the DECOMPOSITION (`varianceOpr.ts`, what ships);
 *   2. EVEN-SPLIT CONTRIBUTION SD — the sample SD of `mean^pre + e_m/n`, i.e.
 *      commit 96e38754's retired fold. Implemented here rather than imported,
 *      because `contribution.ts` was deleted and THIS COMPARISON IS ITS ONLY
 *      REMAINING REASON TO EXIST. A three-way comparison is the test's whole
 *      job, so the test is the correct home for the arm it compares against.
 *   3. FILTER R — `max(0, e^2 - sumP) / n` folded per team, the same sample
 *      `applyAllianceUpdate` computes and `consistency.ts` folds. Averaged
 *      plainly rather than through the live EWMA: the EWMA changes the
 *      WEIGHTING of the samples, not their scale, and scale is what a slope
 *      measures.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TEST CANNOT BE DEFEATED BY WIDENING A TOLERANCE
 * ---------------------------------------------------------------------------
 *
 * The case for the decomposition is NOT that it ranks robots better — all
 * three correlate with truth equally, because the ranking information is
 * limited by the DATA. The case is that only the decomposition gets the SCALE
 * right: at slope 0.18 a true 3-to-25 point spread renders as a ~4-point band
 * and every robot looks equally consistent, which defeats the purpose of
 * publishing a `±` at all.
 *
 * So the incumbents are pinned BY RATIO against the shipped estimator, not
 * only by absolute bounds. A future revert to either one must fail this test,
 * and it must not be possible to make it pass by loosening a single number:
 * raising the decomposition's own lower bound only makes the ratios harder,
 * and raising an incumbent's absolute ceiling does not touch the ratio at all.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FIGURES ARE POOLED ACROSS SEEDS
 * ---------------------------------------------------------------------------
 *
 * Every arm is run at `SEEDS.length` independent seeds and asserted on the
 * MEAN. This is a STRENGTHENING, not a loosening, and the reason is measured:
 * one 60-team draw's correlation with truth ranges over roughly [0.66, 0.84]
 * across seeds at the full-season horizon, because `e^2` is a heavy-tailed
 * target. A single-seed assertion would be pinning one draw's sampling noise
 * rather than a property of the estimator, and would either be flaky or would
 * need a bound so wide it asserted nothing. The per-seed ranges are printed
 * beside every mean so a regression says which arm moved and by how much.
 *
 * ---------------------------------------------------------------------------
 * REPRODUCTION AGAINST CONTEXT.md's ORIGINAL MEASUREMENT
 * ---------------------------------------------------------------------------
 *
 * The harness that produced CONTEXT.md's table (`scratchpad/variance_opr.ts`)
 * does not exist in this tree; this file is written fresh from CONTEXT's
 * description and reproduces its two conclusions. Both directions are recorded
 * here rather than only the agreement:
 *
 *   full season (60 matches/team)   this file   CONTEXT.md
 *     even-split contribution SD    r 0.75      r 0.865
 *                                   slope 0.162 slope 0.179
 *     filter R                      r 0.75      r 0.867
 *                                   slope 0.281 slope 0.312
 *     variance-OPR, ridge 0         slope 0.917 slope 1.032
 *     variance-OPR, ridge 10        slope 0.788 slope 0.871
 *                                   RMSE best   RMSE best
 *
 * The SLOPES — the quantity this task turns on — agree closely, the ORDERING
 * is identical, and the decomposition again has the best RMSE at a full
 * season. The CORRELATIONS come out around 0.75 here against CONTEXT's 0.86,
 * equally across all three arms; that is a level difference in the generated
 * league (CONTEXT's own draw is not reproducible from its description alone),
 * not a difference between estimators, and CONTEXT's conclusion 1 — that all
 * three correlate EQUALLY — is what this file asserts and what reproduces.
 * Recorded as a finding rather than tuned away.
 */
import { describe, expect, it } from "vitest";
import {
  SIGMA1_VARIANCE_OPR_RIDGE,
  emptyEventVarianceAccumulator,
  foldVarianceObservation,
  solveEventVariance,
  vBarFor,
  type EventVarianceAccumulator,
} from "./varianceOpr.js";

// ---------------------------------------------------------------------------
// Deterministic randomness — never Math.random
// ---------------------------------------------------------------------------

/** mulberry32, copied with the citation `sigma1/rp/distribution.ts` and `packages/harness/identifiability.ts` both carry. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGaussian(rng: () => number): () => number {
  return () => {
    const u1 = 1 - rng();
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

// ---------------------------------------------------------------------------
// The synthetic league (CONTEXT.md's own description)
// ---------------------------------------------------------------------------

const TEAM_COUNT = 60;
const TRUE_SIGMA_MIN = 3;
const TRUE_SIGMA_MAX = 25;
const KEY = "total";

/**
 * The prior-variance sum the filter-R arm subtracts. A small FIXED value,
 * recorded so the arm is reproducible: on the real path `sumP` is the alliance's
 * summed posterior variance, which converges to something small relative to a
 * team's own match-to-match spread, and the arm's SCALE (the quantity a slope
 * measures) is insensitive to its exact value.
 */
const FILTER_R_SUM_P = 5;

/** Full season and one event — CONTEXT.md's two horizons. */
const FULL_SEASON_MATCHES_PER_TEAM = 60;
const ONE_EVENT_MATCHES_PER_TEAM = 12;

/**
 * Five independent leagues per horizon. See this file's header for why the
 * assertions are on the pooled mean.
 */
const SEEDS = [424242, 20260902, 7, 991, 31337] as const;

interface AllianceRow {
  readonly teams: readonly string[];
  /** SIGNED, because the even-split arm's SD needs the sign and squaring it first would silently measure |e| instead. */
  readonly residual: number;
}

/**
 * A league in which the decomposition's own model is literally true: each team
 * has a fixed per-match sigma, and an alliance's residual is a zero-mean
 * Gaussian whose variance is the SUM of its three teammates' variances
 * (D-V1's `E[e_m^2] = sum of sigma_i^2`, exactly).
 */
function generateLeague(seed: number, matchesPerTeam: number): {
  teams: string[];
  trueSigma: Map<string, number>;
  rows: AllianceRow[];
} {
  const rng = makeRng(seed);
  const gaussian = makeGaussian(rng);
  const teams = Array.from({ length: TEAM_COUNT }, (_, i) => `T${String(i).padStart(2, "0")}`);
  const trueSigma = new Map<string, number>();
  for (const team of teams) trueSigma.set(team, TRUE_SIGMA_MIN + (TRUE_SIGMA_MAX - TRUE_SIGMA_MIN) * rng());

  const rows: AllianceRow[] = [];
  for (let round = 0; round < matchesPerTeam; round++) {
    // Fisher-Yates on a copy: every team plays exactly once per round and
    // alliance composition keeps changing, which is what makes the system
    // identifiable at all.
    const shuffled = [...teams];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    for (let m = 0; m + 6 <= shuffled.length; m += 6) {
      for (const side of [shuffled.slice(m, m + 3), shuffled.slice(m + 3, m + 6)]) {
        const variance = side.reduce((sum, t) => sum + trueSigma.get(t)! ** 2, 0);
        rows.push({ teams: side, residual: gaussian() * Math.sqrt(variance) });
      }
    }
  }
  return { teams, trueSigma, rows };
}

// ---------------------------------------------------------------------------
// The comparison statistics
// ---------------------------------------------------------------------------

/**
 * SLOPE means the ordinary least-squares slope of ESTIMATE on TRUTH, WITH AN
 * INTERCEPT. Stated explicitly because a slope computed through the ORIGIN is
 * a different number and CONTEXT.md's table would not be comparable to it.
 * An ideal estimator has r = 1 and slope = 1.
 */
function olsSlopeAndR(truth: readonly number[], estimate: readonly number[]): { slope: number; r: number } {
  const n = truth.length;
  const meanT = truth.reduce((a, b) => a + b, 0) / n;
  const meanE = estimate.reduce((a, b) => a + b, 0) / n;
  let stt = 0;
  let see = 0;
  let ste = 0;
  for (let i = 0; i < n; i++) {
    const dt = truth[i]! - meanT;
    const de = estimate[i]! - meanE;
    stt += dt * dt;
    see += de * de;
    ste += dt * de;
  }
  return { slope: ste / stt, r: ste / Math.sqrt(stt * see) };
}

function rootMeanSquaredError(truth: readonly number[], estimate: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < truth.length; i++) sum += (truth[i]! - estimate[i]!) ** 2;
  return Math.sqrt(sum / truth.length);
}

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function sampleStandardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1));
}

interface ArmStats {
  readonly r: number;
  readonly slope: number;
  readonly rmse: number;
}

/** One league, every arm. All estimates are SIGMAS (SDs), so the slope is on the scale a reader sees. */
function measureLeague(
  seed: number,
  matchesPerTeam: number
): {
  arms: Record<string, ArmStats>;
  /** Median `1 - w_i`: the share of a team's estimate that comes from the league prior rather than from its own data. */
  effectiveLeagueShare: number;
  clampRate: number;
  vBar: number;
} {
  const { teams, trueSigma, rows } = generateLeague(seed, matchesPerTeam);

  let acc: EventVarianceAccumulator = emptyEventVarianceAccumulator();
  const evenSplitSeries = new Map<string, number[]>();
  const filterRSamples = new Map<string, number[]>();
  for (const row of rows) {
    const squared = row.residual * row.residual;
    acc = foldVarianceObservation(acc, row.teams, { [KEY]: squared });
    for (const team of row.teams) {
      // Arm 2: `mean^pre + innovation / n`. `mean^pre` is a per-team CONSTANT
      // in this synthetic league (there is no filter here), and a constant
      // shifts a standard deviation by exactly nothing — so the series' SD is
      // the SD of `e_m / n`, which is what the retired estimator published.
      if (!evenSplitSeries.has(team)) evenSplitSeries.set(team, []);
      evenSplitSeries.get(team)!.push(row.residual / row.teams.length);
      // Arm 3: the filter's own unbiased per-team variance sample.
      if (!filterRSamples.has(team)) filterRSamples.set(team, []);
      filterRSamples.get(team)!.push(Math.max(0, squared - FILTER_R_SUM_P) / row.teams.length);
    }
  }

  const truth = teams.map((t) => trueSigma.get(t)!);
  const arms: Record<string, ArmStats> = {};
  const statsFor = (estimate: readonly number[]): ArmStats => ({
    ...olsSlopeAndR(truth, estimate),
    rmse: rootMeanSquaredError(truth, estimate),
  });

  // The decomposition, at every lambda CONTEXT.md tabulates, plus the
  // ZERO-CENTRED negative control at lambda 100.
  for (const lambda of [0, 1, 10, 100, 1000]) {
    const solved = solveEventVariance(acc, lambda);
    arms[`varianceOpr@${lambda}`] = statsFor(teams.map((t) => Math.sqrt(solved.get(t)![KEY]!)));
  }
  const zeroCentred = solveEventVariance(acc, 100, { centreOnVBar: false });
  arms["zeroCentred@100"] = statsFor(teams.map((t) => Math.sqrt(zeroCentred.get(t)![KEY]!)));

  arms["evenSplitContributionSd"] = statsFor(teams.map((t) => sampleStandardDeviation(evenSplitSeries.get(t)!)));
  arms["filterR"] = statsFor(teams.map((t) => Math.sqrt(mean(filterRSamples.get(t)!))));

  // The effective LEAGUE WEIGHT the chosen lambda actually implies, per team:
  // `w_i = (est_i - vBar) / (est_i at lambda 0 - vBar)` is the weight on the
  // team's OWN data, so `1 - w_i` is the league prior's share. Teams whose
  // unridged estimate already sits at `vBar` are SKIPPED: the ratio is
  // undefined there, and dividing anyway would put garbage into the median.
  const vBar = vBarFor(acc, KEY);
  const unridged = solveEventVariance(acc, 0);
  const shipped = solveEventVariance(acc, SIGMA1_VARIANCE_OPR_RIDGE);
  const shares: number[] = [];
  for (const team of teams) {
    const denominator = unridged.get(team)![KEY]! - vBar;
    if (Math.abs(denominator) < 1e-9) continue;
    shares.push(1 - (shipped.get(team)![KEY]! - vBar) / denominator);
  }

  const clamped = teams.filter((t) => shipped.get(t)![KEY]! <= 0).length;

  return {
    arms,
    effectiveLeagueShare: median(shares),
    clampRate: clamped / teams.length,
    vBar,
  };
}

interface HorizonReport {
  readonly arms: Record<string, { mean: ArmStats; rRange: [number, number]; slopeRange: [number, number] }>;
  readonly effectiveLeagueShare: number;
  readonly effectiveLeagueShareRange: [number, number];
  readonly clampRate: number;
  readonly table: string;
}

function measureHorizon(matchesPerTeam: number, label: string): HorizonReport {
  const perSeed = SEEDS.map((seed) => measureLeague(seed, matchesPerTeam));
  const armNames = Object.keys(perSeed[0]!.arms);
  const arms: HorizonReport["arms"] = {};
  for (const name of armNames) {
    const rs = perSeed.map((p) => p.arms[name]!.r);
    const slopes = perSeed.map((p) => p.arms[name]!.slope);
    const rmses = perSeed.map((p) => p.arms[name]!.rmse);
    arms[name] = {
      mean: { r: mean(rs), slope: mean(slopes), rmse: mean(rmses) },
      rRange: [Math.min(...rs), Math.max(...rs)],
      slopeRange: [Math.min(...slopes), Math.max(...slopes)],
    };
  }
  const shares = perSeed.map((p) => p.effectiveLeagueShare);
  const lines = [
    `${label} (${matchesPerTeam} matches/team, ${SEEDS.length} seeds, means with per-seed ranges)`,
    "  estimator                   r      slope   RMSE",
  ];
  for (const name of armNames) {
    const a = arms[name]!;
    lines.push(
      `  ${name.padEnd(26)} ${a.mean.r.toFixed(3)}  ${a.mean.slope.toFixed(3)}  ${a.mean.rmse.toFixed(2)}` +
        `   slope range [${a.slopeRange[0].toFixed(3)}, ${a.slopeRange[1].toFixed(3)}]`
    );
  }
  lines.push(`  effective league share (median 1-w): ${mean(shares).toFixed(4)}`);
  lines.push(`  clamp rate at lambda ${SIGMA1_VARIANCE_OPR_RIDGE}: ${mean(perSeed.map((p) => p.clampRate)).toFixed(4)}`);

  return {
    arms,
    effectiveLeagueShare: mean(shares),
    effectiveLeagueShareRange: [Math.min(...shares), Math.max(...shares)],
    clampRate: mean(perSeed.map((p) => p.clampRate)),
    table: lines.join("\n"),
  };
}

const FULL_SEASON = measureHorizon(FULL_SEASON_MATCHES_PER_TEAM, "FULL SEASON");
const ONE_EVENT = measureHorizon(ONE_EVENT_MATCHES_PER_TEAM, "ONE EVENT");

/** Printed on any failure, so a regression names the arm that moved rather than only the bound that broke. */
function context(): string {
  return `\n${FULL_SEASON.table}\n\n${ONE_EVENT.table}\n`;
}

// The same tables on demand, so `docs/models/sigma1-variance-decomposition.md`
// is transcribed from a run of THIS FILE rather than retyped from memory:
//
//     SIGMA1_PRINT_RECOVERY_TABLE=1 pnpm vitest run \
//       packages/core/algorithms/sigma1/varianceOpr.recovery.test.ts
if (process.env["SIGMA1_PRINT_RECOVERY_TABLE"] === "1") {
  describe("measured tables", () => {
    it("prints both horizons", () => {
      console.log(context());
      expect(FULL_SEASON.table.length).toBeGreaterThan(0);
    });
  });
}

describe("variance decomposition — recovery against known sigma, full season (60 matches/team)", () => {
  const shipped = FULL_SEASON.arms[`varianceOpr@${SIGMA1_VARIANCE_OPR_RIDGE}`]!.mean;
  const evenSplit = FULL_SEASON.arms["evenSplitContributionSd"]!.mean;
  const filterR = FULL_SEASON.arms["filterR"]!.mean;

  it("the decomposition recovers the SCALE: slope against known sigma in [0.7, 1.2]", () => {
    expect(shipped.slope, context()).toBeGreaterThan(0.7);
    expect(shipped.slope, context()).toBeLessThan(1.2);
  });

  it("BOTH incumbents are measurably worse on slope, by RATIO as well as absolutely", () => {
    // The ratios are what make this un-defeatable: raising the decomposition's
    // own lower bound makes them HARDER, and raising an incumbent's ceiling
    // does not touch them at all.
    expect(shipped.slope, context()).toBeGreaterThan(2.0 * evenSplit.slope);
    expect(shipped.slope, context()).toBeGreaterThan(1.5 * filterR.slope);
    expect(evenSplit.slope, context()).toBeLessThan(0.35);
    expect(filterR.slope, context()).toBeLessThan(0.55);
  });

  it("all three correlate with truth EQUALLY — the win is scale, not ranking (CONTEXT conclusion 1)", () => {
    // This assertion is what stops the test being read as a claim that the
    // decomposition ranks robots better. It does not; the ranking information
    // is limited by the data.
    const rs = [shipped.r, evenSplit.r, filterR.r];
    for (const a of rs) for (const b of rs) expect(Math.abs(a - b), context()).toBeLessThan(0.05);
  });

  it("the decomposition also has the best RMSE at a full season", () => {
    expect(shipped.rmse, context()).toBeLessThan(evenSplit.rmse);
    expect(shipped.rmse, context()).toBeLessThan(filterR.rmse);
  });

  it("the ridge is MONOTONE in lambda and collapses the scale by 100 — which is why 10 is the operating point", () => {
    const at0 = FULL_SEASON.arms["varianceOpr@0"]!.mean.slope;
    const at10 = FULL_SEASON.arms["varianceOpr@10"]!.mean.slope;
    const at100 = FULL_SEASON.arms["varianceOpr@100"]!.mean.slope;
    const at1000 = FULL_SEASON.arms["varianceOpr@1000"]!.mean.slope;
    expect(at0, context()).toBeGreaterThan(at10);
    expect(at10, context()).toBeGreaterThan(at100);
    expect(at100, context()).toBeGreaterThan(at1000);
    // 100 already reintroduces exactly the league-blending the user rejected.
    expect(at100, context()).toBeLessThan(0.5);
  });

  it("NEGATIVE CONTROL (D-V2): a ZERO-centred ridge visibly wrecks the scale the vBar-centred one preserves", () => {
    // CONTEXT measured a zero-centred ridge at lambda 100 giving a mean
    // estimate of 6.2 against a true 11.6 — it drags every team toward
    // "perfectly consistent". Without this control the centring is untested,
    // and "shrink toward the league mean, not toward zero" would be a claim
    // rather than a result.
    const zeroCentred = FULL_SEASON.arms["zeroCentred@100"]!.mean;
    const vBarCentred = FULL_SEASON.arms["varianceOpr@100"]!.mean;
    expect(zeroCentred.rmse, context()).toBeGreaterThan(vBarCentred.rmse);
    // The zero-centred solve pulls every estimate DOWN, so its intercept is
    // lower and its residual error larger despite a nominally larger slope —
    // the RMSE comparison above is the honest summary, and the mean-preservation
    // claim itself is asserted directly below.
  });

  it("MEAN PRESERVATION (D-V2's whole justification): vBar-centring keeps the league mean, zero-centring does not", () => {
    // Asserted rather than trusted, and on the same generated league as every
    // other arm here.
    const { teams, trueSigma, rows } = generateLeague(SEEDS[0], FULL_SEASON_MATCHES_PER_TEAM);
    let acc: EventVarianceAccumulator = emptyEventVarianceAccumulator();
    for (const row of rows) {
      acc = foldVarianceObservation(acc, row.teams, { [KEY]: row.residual * row.residual });
    }
    const trueMeanVariance = mean(teams.map((t) => trueSigma.get(t)! ** 2));

    for (const lambda of [0, 1, 10, 100]) {
      const solved = solveEventVariance(acc, lambda);
      const meanVariance = mean(teams.map((t) => solved.get(t)![KEY]!));
      expect(
        Math.abs(meanVariance - trueMeanVariance) / trueMeanVariance,
        `vBar-centred lambda ${lambda}: mean ${meanVariance.toFixed(2)} against true ${trueMeanVariance.toFixed(2)}`
      ).toBeLessThan(0.1);
    }

    const zeroCentred = solveEventVariance(acc, 100, { centreOnVBar: false });
    const zeroCentredMean = mean(teams.map((t) => zeroCentred.get(t)![KEY]!));
    expect(
      zeroCentredMean,
      `zero-centred lambda 100 must visibly wreck the mean (true ${trueMeanVariance.toFixed(2)})`
    ).toBeLessThan(0.75 * trueMeanVariance);
  });

  it("is deterministic: two runs at the same seed produce bitwise identical slopes", () => {
    const a = measureLeague(SEEDS[0], FULL_SEASON_MATCHES_PER_TEAM);
    const b = measureLeague(SEEDS[0], FULL_SEASON_MATCHES_PER_TEAM);
    for (const name of Object.keys(a.arms)) {
      expect(b.arms[name]!.slope, name).toBe(a.arms[name]!.slope);
      expect(b.arms[name]!.r, name).toBe(a.arms[name]!.r);
    }
  });
});

describe("variance decomposition — recovery at ONE EVENT (12 matches/team), the realistic hard case", () => {
  const shipped = ONE_EVENT.arms[`varianceOpr@${SIGMA1_VARIANCE_OPR_RIDGE}`]!.mean;
  const evenSplit = ONE_EVENT.arms["evenSplitContributionSd"]!.mean;
  const filterR = ONE_EVENT.arms["filterR"]!.mean;

  it("slope against known sigma in [0.40, 0.75] — a genuinely partial recovery, honestly bounded", () => {
    expect(shipped.slope, context()).toBeGreaterThan(0.4);
    expect(shipped.slope, context()).toBeLessThan(0.75);
  });

  it("both ratio bounds still hold at one event", () => {
    expect(shipped.slope, context()).toBeGreaterThan(2.0 * evenSplit.slope);
    expect(shipped.slope, context()).toBeGreaterThan(1.5 * filterR.slope);
    expect(evenSplit.slope, context()).toBeLessThan(0.35);
    expect(filterR.slope, context()).toBeLessThan(0.55);
  });

  it("all three still correlate with truth equally", () => {
    const rs = [shipped.r, evenSplit.r, filterR.r];
    for (const a of rs) for (const b of rs) expect(Math.abs(a - b), context()).toBeLessThan(0.05);
  });
});

describe("the effective league weight lambda = 10 actually implies", () => {
  it("is finite and in [0, 1] at both horizons; the NUMBER is the deliverable, not the bound", () => {
    // CONTEXT requires this figure to EXIST so the claim "this is about this
    // robot" stays checkable rather than asserted. Only well-formedness is
    // gated here; the measured value goes in
    // `docs/models/sigma1-variance-decomposition.md`, compared numerically to
    // the retired display blend's `1 - 12/(12+8) = 0.40` at a 12-match team.
    for (const [label, report] of [
      ["full season", FULL_SEASON],
      ["one event", ONE_EVENT],
    ] as const) {
      expect(Number.isFinite(report.effectiveLeagueShare), label).toBe(true);
      expect(report.effectiveLeagueShare, label).toBeGreaterThanOrEqual(0);
      expect(report.effectiveLeagueShare, label).toBeLessThanOrEqual(1);
    }
  });

  it("MEASURED, printed, and NOT softened: the one-event figure is compared to the retired blend's 0.40", () => {
    // FINDING (2026-09-02, quick task 260902-varopr Task 3). At one event the
    // measured effective league share is ~0.44, which EXCEEDS the retired
    // `matchCount / (matchCount + 8)` blend's 0.40 at a 12-match team. CONTEXT
    // D-V2's phrasing — "a lambda-10 ridge on a 40-team event solve is FAR
    // LIGHTER" — is therefore FALSE at the one-event horizon, and that phrase
    // is deliberately not written anywhere in this codebase. At a full season
    // the figure is ~0.15, where the claim does hold.
    //
    // D-V2 is LOCKED, so lambda does not move on account of this; what changes
    // is what is written down. The assertion below pins the ORDER OF MAGNITUDE
    // of both figures so the doc's numbers cannot silently go stale.
    const RETIRED_BLEND_AT_12_MATCHES = 1 - 12 / (12 + 8);
    expect(RETIRED_BLEND_AT_12_MATCHES).toBeCloseTo(0.4, 12);

    const message =
      `effective league share — full season ${FULL_SEASON.effectiveLeagueShare.toFixed(4)} ` +
      `(range ${FULL_SEASON.effectiveLeagueShareRange.map((v) => v.toFixed(4)).join("..")}), ` +
      `one event ${ONE_EVENT.effectiveLeagueShare.toFixed(4)} ` +
      `(range ${ONE_EVENT.effectiveLeagueShareRange.map((v) => v.toFixed(4)).join("..")}), ` +
      `retired blend at 12 matches ${RETIRED_BLEND_AT_12_MATCHES.toFixed(4)}`;

    // Full season: genuinely far lighter than the retired blend.
    expect(FULL_SEASON.effectiveLeagueShare, message).toBeLessThan(0.5 * RETIRED_BLEND_AT_12_MATCHES);
    // One event: comparable to it, and measured ABOVE it. Pinned as a range
    // rather than an inequality in either direction, so a future change that
    // moved it materially — in EITHER direction — fails and gets documented.
    expect(ONE_EVENT.effectiveLeagueShare, message).toBeGreaterThan(0.3);
    expect(ONE_EVENT.effectiveLeagueShare, message).toBeLessThan(0.6);
  });

  it("RECORDED, NOT GATED: the one-event slope at lambda 0 beside lambda 10", () => {
    // CONTEXT's table has no one-event lambda-0 row and the number is free to
    // obtain here. It is an OBSERVATION for the doc, not an argument for
    // changing a locked decision.
    const at0 = ONE_EVENT.arms["varianceOpr@0"]!.mean.slope;
    const at10 = ONE_EVENT.arms[`varianceOpr@${SIGMA1_VARIANCE_OPR_RIDGE}`]!.mean.slope;
    expect(Number.isFinite(at0)).toBe(true);
    expect(Number.isFinite(at10)).toBe(true);
  });
});
