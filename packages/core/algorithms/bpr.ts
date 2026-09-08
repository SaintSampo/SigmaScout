/**
 * BPR - Bayesian Power Rating.
 *
 * A per-team latent scoring contribution tracked by a Gaussian filter in
 * SCALE-FREE units: a rating of 1.0 is a league-average team, measured in
 * multiples of (average alliance output / 3). The season's point scale is
 * estimated online and cancels out of the win probability, which is what lets
 * one parameter set apply to a season whose scoring level was never observed
 * when the parameters were chosen.
 *
 * PROVENANCE. Structure and hyperparameters were selected using ONLY seasons
 * 2016-2022, then evaluated once on a sealed 2023-2026 holdout: 78.05% winner
 * accuracy over 69,511 matches (78.37% over qualification matches alone). The
 * research harness, the pre-committed selection rule and the single-shot
 * holdout run live in `packages/bpr/` and
 * `.planning/quick/260908-b4t-fresh-2023-blind-model/`. Re-tuning this model
 * against 2023 or later converts that holdout into a training set and voids
 * the number above.
 *
 * Four components earned their place on design-year evidence, each beating a
 * two-standard-error bar (0.31pp on 82,946 matches):
 *
 *   season carryover        +1.80pp
 *   two-timescale state     +1.05pp
 *   anti-additivity         +0.53pp
 *   foul-adjusted signal    +0.30pp
 *   online link calibration  0.00pp accuracy, log loss 0.557 -> 0.529
 *
 * Five further ideas were tried and REJECTED as inside noise, and are
 * deliberately absent here rather than present-but-disabled: a per-team
 * foul-conceded submodel, elimination down-weighting, defensive suppression,
 * Huber robustness, and a learned red-side bias. `packages/bpr/model.ts`
 * retains them behind inert defaults for future research.
 *
 * Like `opr.ts` and `epa.ts`, and unlike `vpr`, BPR carries no ranking-point
 * model, so it emits no `redRpPmf`/`blueRpPmf` and cannot drive the rank
 * simulation. That is a deliberate scope boundary, not an omission.
 */
import { TOTAL_METRIC_KEY, type AlgorithmModule, type MatchResult, type Prediction, type SeasonBoundary, type TeamMetrics, type UpcomingMatch } from "./types.js";

export interface BprParams {
  /** Observation noise sd on alliance output, normalized units. */
  readonly obsSd: number;
  /** Process noise (variance) added to the slow component per match played. */
  readonly qSlow: number;
  /** Mean-reversion factor for the fast component, per match played. */
  readonly rhoFast: number;
  /** Process noise (variance) for the fast component per match played. */
  readonly qFast: number;
  /** Prior variance for a team never seen before. */
  readonly priorVar: number;
  /** Prior variance of the fast component. */
  readonly fastPriorVar: number;
  /** Prior mean rating for a never-seen team (1.0 = league average). */
  readonly rookieMean: number;
  /** Shrink of the slow mean toward 1.0 at a season boundary; 1.0 = carry untouched. */
  readonly seasonShrink: number;
  /** Variance added to the slow component at a season boundary. */
  readonly seasonVar: number;
  /** Initial link temperature. */
  readonly tau0: number;
  /** Online learning rate for log-tau. */
  readonly tauLr: number;
  /** Adaptation floor for the online season-scale estimate. */
  readonly scaleMinLr: number;
  /** Anti-additivity weights for the 2nd and 3rd strongest team in an alliance. */
  readonly w2: number;
  readonly w3: number;
}

/**
 * Frozen 2026-09-08. Chosen on 2016-2022 alone by the pre-committed rule in
 * `.planning/quick/260908-b4t-fresh-2023-blind-model/DECISION.md`. Design-era
 * accuracy 73.081%; sealed holdout accuracy 78.05%.
 */
export const BPR_PARAMS: BprParams = {
  obsSd: 1,
  qSlow: 0.00002,
  rhoFast: 0.9,
  qFast: 0.015,
  priorVar: 0.1,
  fastPriorVar: 0.25,
  rookieMean: 0.55,
  seasonShrink: 1,
  seasonVar: 0.03,
  tau0: 1,
  tauLr: 0.005,
  scaleMinLr: 0.01,
  w2: 0.7,
  w3: 0.5,
};

/**
 * D-13 requires a `{codeVersion}+{paramSetName}` shape, because the paramSetName
 * half becomes part of every published artifact key. `baseline` is the same
 * suffix `opr` (4.0.0+baseline) and `epa` (5.0.0+baseline) carry, and it is the
 * honest one here: BPR has no tuned parameter file and is never touched by
 * `applyPromotedOverrides`. Its constants were frozen once, on 2016-2022
 * evidence, and are not re-tuned per season.
 */
export const BPR_VERSION = "1.0.0+baseline";

export interface BprTeamState {
  /** Slow "true talent" component. */
  readonly muL: number;
  readonly pL: number;
  /** Fast, mean-reverting "current form" component. */
  readonly muS: number;
  readonly pS: number;
}

export interface BprState {
  readonly season: number | null;
  readonly teams: ReadonlyMap<string, BprTeamState>;
  /** Log of the online link temperature. */
  readonly logTau: number;
  /** Online estimate of mean foul-adjusted alliance output, in points. */
  readonly scale: number;
  readonly scaleCount: number;
}

const SQRT2PI = Math.sqrt(2 * Math.PI);
const normPdf = (z: number): number => Math.exp(-0.5 * z * z) / SQRT2PI;

/** Abramowitz-Stegun 7.1.26; ~1e-7 absolute accuracy. */
function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-a * a);
  return s * y;
}
/**
 * Exact at z=0 by symmetry, special-cased because the A-S approximation above
 * returns +1.0e-9 rather than 0 there, making `normCdf(0)` come out as
 * 0.5000000005. That residual is numerically irrelevant to Brier or accuracy
 * (the `pRedWin >= 0.5` tiebreak already resolves an even matchup to red), but
 * it is NOT irrelevant to reporting: `packages/core/scoring/brier.ts` detects a
 * no-call by exact equality with 0.5, so without this line a genuinely even
 * prediction is silently recorded as a confident red pick. That hid all 275 of
 * BPR's dead-even cold-start matches (274 in 2016, 1 in 2017) from the
 * published no-call count. Mirrors the same guard `sigma1/linkFunctions.ts`
 * already applies to its own erf-based CDF.
 */
const normCdf = (z: number): number => (z === 0 ? 0.5 : 0.5 * (1 + erf(z / Math.SQRT2)));

function freshTeam(p: BprParams): BprTeamState {
  return { muL: p.rookieMean, pL: p.priorVar, muS: 0, pS: p.fastPriorVar };
}

/**
 * Foul points awarded TO an alliance are earned by the OPPONENT's fouls, so
 * they are opponent-attributable and are removed from the skill signal rather
 * than credited to the alliance that received them. `totalPoints` and
 * `foulPoints` were verified present in all ten seasons 2016-2026; no other
 * breakdown field is touched, deliberately, because field names are not stable
 * across seasons (2026 renamed `autoPoints` to `totalAutoPoints`).
 */
function foulPointsOf(raw: string | null, side: "red" | "blue"): number {
  if (raw === null) return 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 0;
  }
  if (parsed === null || typeof parsed !== "object") return 0;
  const alliance = (parsed as Record<string, unknown>)[side];
  if (alliance === null || typeof alliance !== "object") return 0;
  const fp = (alliance as Record<string, unknown>).foulPoints;
  return typeof fp === "number" && Number.isFinite(fp) ? fp : 0;
}

interface AllianceView {
  mu: number;
  pv: number;
  keys: string[];
  states: BprTeamState[];
  weights: number[];
}

/**
 * Anti-additivity: an FRC alliance shares one field and a finite supply of
 * game pieces, so three elite scorers do not add linearly. Teams are ranked
 * within their alliance and contribute with weights (1, w2, w3), renormalized
 * to sum to 3 so the scale-free property survives any alliance size.
 */
function viewOf(state: BprState, keys: readonly string[], p: BprParams): AllianceView {
  const states: BprTeamState[] = [];
  const mus: number[] = [];
  const kept: string[] = [];
  for (const k of keys) {
    const s = state.teams.get(k) ?? freshTeam(p);
    states.push(s);
    kept.push(k);
    mus.push(s.muL + s.muS);
  }
  const n = states.length;
  const base = [1, p.w2, p.w3];
  const order = mus.map((_, i) => i).sort((a, b) => (mus[b] ?? 0) - (mus[a] ?? 0) || a - b);
  let raw = 0;
  for (let rank = 0; rank < n; rank += 1) raw += base[Math.min(rank, base.length - 1)] ?? 1;
  const norm = raw > 0 ? 3 / raw : 1;

  const weights = new Array<number>(n).fill(1);
  for (let rank = 0; rank < n; rank += 1) {
    const idx = order[rank];
    if (idx === undefined) continue;
    weights[idx] = (base[Math.min(rank, base.length - 1)] ?? 1) * norm;
  }

  let mu = 0;
  let pv = 0;
  for (let i = 0; i < n; i += 1) {
    const s = states[i];
    const w = weights[i];
    if (s === undefined || w === undefined) continue;
    mu += w * (mus[i] ?? 0);
    pv += w * w * (s.pL + s.pS);
  }
  return { mu, pv, keys: kept, states, weights };
}

function initState(teams: string[]): BprState {
  const map = new Map<string, BprTeamState>();
  for (const t of teams) map.set(t, freshTeam(BPR_PARAMS));
  return { season: null, teams: map, logTau: Math.log(BPR_PARAMS.tau0), scale: 0, scaleCount: 0 };
}

function predict(state: BprState, match: UpcomingMatch): Prediction {
  const p = BPR_PARAMS;
  const red = viewOf(state, match.redTeams, p);
  const blue = viewOf(state, match.blueTeams, p);

  const d = red.mu - blue.mu;
  const v = red.pv + blue.pv + 2 * p.obsSd ** 2;
  const tau = Math.exp(state.logTau);
  const z = d / (tau * Math.sqrt(Math.max(v, 1e-9)));
  const pRedWin = Math.min(1 - 1e-6, Math.max(1e-6, normCdf(z)));

  // Ratings are scale-free; multiply back into points for display. Before any
  // match has been folded the scale is unknown, and 0 is the honest answer -
  // never a guessed constant.
  const unit = state.scale / 3;
  return {
    winner: pRedWin >= 0.5 ? "red" : "blue",
    pRedWin,
    redScore: red.mu * unit,
    blueScore: blue.mu * unit,
    variance: v * unit * unit,
    redScoreVarianceOwn: (red.pv + p.obsSd ** 2) * unit * unit,
    blueScoreVarianceOwn: (blue.pv + p.obsSd ** 2) * unit * unit,
  };
}

function update(state: BprState, result: MatchResult): BprState {
  const p = BPR_PARAMS;

  const redFoul = foulPointsOf(result.scoreBreakdownRaw, "red");
  const blueFoul = foulPointsOf(result.scoreBreakdownRaw, "blue");
  const redOut = result.redScore - redFoul;
  const blueOut = result.blueScore - blueFoul;

  // --- online season scale, in points ---
  const obsMean = (redOut + blueOut) / 2;
  const scaleCount = state.scaleCount + 1;
  const seed = state.scaleCount === 0 ? Math.max(obsMean, 1) : state.scale;
  const lr = Math.max(p.scaleMinLr, 1 / (scaleCount + 1));
  const scale = seed + lr * (obsMean - seed);
  const sc = Math.max(scale, 1e-6);

  const red = viewOf(state, result.redTeams, p);
  const blue = viewOf(state, result.blueTeams, p);

  // --- link temperature: online gradient descent on log loss ---
  const d = red.mu - blue.mu;
  const v = red.pv + blue.pv + 2 * p.obsSd ** 2;
  const tau = Math.exp(state.logTau);
  const z = d / (tau * Math.sqrt(Math.max(v, 1e-9)));
  const pRed = Math.min(1 - 1e-6, Math.max(1e-6, normCdf(z)));
  const outcome = result.winner === "red" ? 1 : result.winner === "blue" ? 0 : 0.5;
  const grad = ((pRed - outcome) * normPdf(z) * z) / Math.max(pRed * (1 - pRed), 1e-6);
  const logTau = Math.min(
    Math.log(5),
    Math.max(Math.log(0.2), state.logTau + p.tauLr * grad),
  );

  // --- rating update; both alliances scored against the PRE-match state, so
  // the two observations within one match cannot inform each other ---
  const next = new Map(state.teams);
  const corrections = new Map<string, BprTeamState>();

  for (const [side, out] of [
    [red, redOut],
    [blue, blueOut],
  ] as const) {
    const u = (3 * out) / sc;
    const innov = u - side.mu;
    const sTot = side.pv + p.obsSd ** 2;
    for (let i = 0; i < side.states.length; i += 1) {
      const s = side.states[i];
      const w = side.weights[i];
      const key = side.keys[i];
      if (s === undefined || w === undefined || key === undefined) continue;
      // Observation row is H_i = w, so the gain carries the same weight: a
      // team the model believes contributes less also absorbs less surprise.
      const kL = (w * s.pL) / sTot;
      const kS = (w * s.pS) / sTot;
      const prior = corrections.get(key) ?? s;
      corrections.set(key, {
        muL: prior.muL + kL * innov,
        muS: prior.muS + kS * innov,
        pL: Math.max(1e-6, prior.pL - kL * w * s.pL),
        pS: Math.max(1e-6, prior.pS - kS * w * s.pS),
      });
    }
  }

  // --- process noise, per match played ---
  for (const [key, s] of corrections) {
    next.set(key, {
      muL: s.muL,
      pL: s.pL + p.qSlow,
      muS: s.muS * p.rhoFast,
      pS: p.rhoFast ** 2 * s.pS + p.qFast,
    });
  }

  return { season: state.season, teams: next, logTau, scale, scaleCount };
}

/**
 * Season carryover, the single largest component of the model (+1.80pp on
 * design years). Measured persistence of team strength across a season
 * boundary is r = 0.62-0.81, and it did NOT decay across the two-year COVID
 * gap (2020->2022, r = 0.739, higher than any single-year transition before
 * it) - team strength in FRC behaves like a property of the program rather
 * than of the current student roster.
 */
function carrySeason(state: BprState, boundary: SeasonBoundary): BprState {
  const p = BPR_PARAMS;
  if (boundary.isColdStart) {
    return { season: boundary.toSeason, teams: new Map(), logTau: Math.log(p.tau0), scale: 0, scaleCount: 0 };
  }
  const carried = new Map<string, BprTeamState>();
  for (const [key, s] of state.teams) {
    carried.set(key, {
      muL: p.seasonShrink * s.muL + (1 - p.seasonShrink) * 1.0,
      pL: s.pL + p.seasonVar,
      muS: 0,
      pS: p.fastPriorVar,
    });
  }
  // The point scale carries too: a new season's scoring level is unknown until
  // its first matches land, and last season's level is the best available
  // starting guess.
  //
  // scaleCount deliberately does NOT reset. Resetting it would make the scale
  // re-adapt much faster at each boundary, which may well be better - but it
  // would be a DIFFERENT model from the one that was frozen on 2016-2022 and
  // measured at 78.05% on the sealed holdout, and that number is only
  // meaningful for the exact model that produced it. Changing this is a
  // research question for `packages/bpr/`, not a porting decision.
  return {
    season: boundary.toSeason,
    teams: carried,
    logTau: state.logTau,
    scale: state.scale,
    scaleCount: state.scaleCount,
  };
}

function teamMetrics(state: BprState, teams?: readonly string[]): TeamMetrics {
  const unit = state.scale / 3;
  const keys = teams ?? [...state.teams.keys()];
  const out: TeamMetrics = {};
  for (const key of keys) {
    const s = state.teams.get(key);
    if (s === undefined) continue;
    out[key] = {
      [TOTAL_METRIC_KEY]: {
        value: (s.muL + s.muS) * unit,
        spread: Math.sqrt(Math.max(s.pL + s.pS, 0)) * unit,
      },
    };
  }
  return out;
}

export const bpr: AlgorithmModule<BprState> = {
  id: "bpr",
  version: BPR_VERSION,
  initState,
  predict,
  update,
  teamMetrics,
  carrySeason,
};
