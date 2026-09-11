/**
 * PCM -- Phase-Component Model. An EXPERIMENT, not a shipped algorithm.
 *
 * THE QUESTION. BPR filters one quantity per team: its contribution to the
 * alliance's foul-adjusted total. PCM filters three -- auto, teleop, endgame --
 * and predicts an alliance's output as their SUM. If a team's phases carry
 * information the total washes out (a specialist climber, a team whose teleop
 * is improving while its auto is flat), PCM should win. If the extra
 * parameters just split the same evidence three ways, it should lose.
 *
 * WHY THIS IS NOT A CHANGE TO BPR. `packages/core/algorithms/bpr.ts` already
 * runs three phase filters, but deliberately keeps them DISPLAY-ONLY and out of
 * `predict`, because a component split has to read per-season `score_breakdown`
 * field names and 2023-2026 was holdout schema. PCM is the same idea moved into
 * the predictor, built as a SEPARATE package so BPR's five sealed paths are
 * untouched and its sealed 78.05% keeps describing the shipped predictor. This
 * file imports from those paths and modifies none of them.
 *
 * THREE DESIGN CHOICES WORTH STATING, because they are where the idea can
 * quietly cheat or quietly break:
 *
 * 1. FALLBACK IS THE REAL BPR. PCM holds its own private `BprModel` instance,
 *    stepped on EVERY match with exactly the inputs the baseline arm sees. When
 *    a match has no parsed breakdown, PCM predicts from it. That instance is
 *    therefore a step-for-step duplicate of the baseline arm, which makes a
 *    sharp invariant: on any fallback match PCM's probability EQUALS the
 *    baseline's, exactly. `pcm.test.ts` pins it. The consequence is that PCM
 *    can only win or lose where breakdowns actually parse -- coverage holes
 *    cost it nothing and earn it nothing, so the measured difference is
 *    attributable to the component idea rather than to data availability.
 *
 * 2. PHASES ARE RANKED WITHIN THE PHASE. The best auto robot on an alliance is
 *    not necessarily its best robot overall, so reusing the total's ordering to
 *    hand out the (1, w2, w3) rank weights would misattribute a specialist --
 *    which is exactly the signal PCM exists to test for.
 *
 * 3. CROSS-PHASE COVARIANCE IS A KNOB, DEFAULTING TO INERT. Summing three
 *    independently-filtered variances assumes the phases are uncorrelated, and
 *    `breakdown/groups.ts` states plainly that they are not ("a team good at
 *    auto tends also to be good at teleop"). Ignoring that makes the alliance
 *    variance too SMALL and the model overconfident, which shows up in Brier
 *    long before it shows up in accuracy. `phaseCorr` models it as a single
 *    equicorrelation; at 0 it reproduces independence exactly, so the knob is
 *    inert at its default and has to earn promotion on the design years.
 */
import { BprModel, DEFAULTS as BPR_DEFAULTS, type BprParams, type Prediction } from "../bpr/model.js";
import {
  COMPONENT_GROUP_IDS,
  type ComponentGroupId,
} from "../core/algorithms/breakdown/groups.js";
import type { PhaseOutputs } from "./data.js";

export interface PcmParams {
  /** Observation noise sd on one phase's alliance output, normalized units. */
  obsSd: number;
  /** Process noise (variance) added to a phase's slow component per match. */
  qSlow: number;
  /** Mean-reversion factor for a phase's fast component, per match played. */
  rhoFast: number;
  /** Process noise (variance) for a phase's fast component per match played. */
  qFast: number;
  priorVar: number;
  fastPriorVar: number;
  rookieMean: number;
  /** Season carryover: shrink of a phase's slow mean toward 1.0 at a boundary. */
  seasonShrink: number;
  seasonVar: number;
  /** Adaptation floor for each phase's online point-scale estimate. */
  scaleMinLr: number;
  /** Rank weights within a phase. w2 = w3 = 1 is plain additivity. */
  w2: number;
  w3: number;
  /** Huber clip on the standardized innovation. Large value disables it. */
  huberK: number;
  /** Observation weight multiplier for elimination matches. */
  elimWeight: number;
  tau0: number;
  tauLr: number;
  /** Red-side margin offset learning rate. 0 pins both offsets at zero. */
  biasLr: number;
  /**
   * Equicorrelation between an alliance's three phase outputs. 0 reproduces the
   * independent sum exactly. See design note 3 in this file's header.
   */
  phaseCorr: number;
  /**
   * Parsed matches a phase's scale must have absorbed before PCM will predict
   * from components at all. Below this the model falls back, rather than
   * predicting off a point scale estimated from one or two matches.
   */
  minPhaseMatches: number;
  /**
   * What PCM does when a match carries no parsed breakdown. `"total"` predicts
   * from the private BPR instance (design note 1). `"noCall"` returns exactly
   * 0.5, which is scored as a miss and reported separately -- useful only for
   * measuring how much of PCM's score is actually carried by the fallback.
   */
  fallback: "total" | "noCall";
}

/**
 * Shared knobs take BPR's tuned values rather than fresh guesses, so a measured
 * difference between the arms is attributable to the COMPONENT SPLIT and not to
 * PCM having been handed worse constants. The two knobs BPR does not have --
 * `phaseCorr` and `minPhaseMatches` -- are set inert and conservative
 * respectively.
 */
export const PCM_DEFAULTS: PcmParams = {
  obsSd: BPR_DEFAULTS.obsSd,
  qSlow: BPR_DEFAULTS.qSlow,
  rhoFast: BPR_DEFAULTS.rhoFast,
  qFast: BPR_DEFAULTS.qFast,
  priorVar: BPR_DEFAULTS.priorVar,
  fastPriorVar: BPR_DEFAULTS.fastPriorVar,
  rookieMean: BPR_DEFAULTS.rookieMean,
  seasonShrink: BPR_DEFAULTS.seasonShrink,
  seasonVar: BPR_DEFAULTS.seasonVar,
  scaleMinLr: BPR_DEFAULTS.scaleMinLr,
  w2: BPR_DEFAULTS.w2,
  w3: BPR_DEFAULTS.w3,
  huberK: BPR_DEFAULTS.huberK,
  elimWeight: BPR_DEFAULTS.elimWeight,
  tau0: BPR_DEFAULTS.tau0,
  tauLr: BPR_DEFAULTS.tauLr,
  biasLr: BPR_DEFAULTS.biasLr,
  phaseCorr: 0,
  minPhaseMatches: 20,
  fallback: "total",
};

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
 * Exact at z = 0 by symmetry. The A-S approximation returns ~1e-9 there, which
 * is numerically irrelevant to Brier but NOT to reporting: a no-call is
 * detected by exact equality with 0.5, so without this guard a genuinely even
 * prediction is silently recorded as a confident red pick. Same guard, same
 * reason, as `packages/core/algorithms/bpr.ts`.
 */
const normCdf = (z: number): number => (z === 0 ? 0.5 : 0.5 * (1 + erf(z / Math.SQRT2)));

interface PhaseTeamState {
  muL: number;
  pL: number;
  muS: number;
  pS: number;
  lastYear: number;
}

interface PhaseView {
  /** Alliance rating in normalized units; 3.0 is a league-average alliance. */
  mu: number;
  pv: number;
  states: PhaseTeamState[];
  weights: number[];
}

export interface PcmPrediction {
  readonly pRed: number;
  /** Which path produced `pRed`. See design note 1. */
  readonly source: "component" | "total" | "noCall";
  /** Margin in NORMALIZED units (points divided by the combined unit). */
  readonly d: number;
  readonly v: number;
  readonly marginPoints: number;
  /**
   * The private BPR instance's own prediction for this match. Carried because
   * `BprModel.update` consumes the prediction it made -- passing PCM's instead
   * would corrupt the fallback filter's online tau and bias.
   */
  readonly total: Prediction;
}

export class PcmModel {
  private readonly p: PcmParams;
  /** Design note 1: a step-for-step duplicate of the baseline arm. */
  private readonly totalModel: BprModel;
  private readonly phases: Record<ComponentGroupId, Map<string, PhaseTeamState>>;
  private readonly scale: Record<ComponentGroupId, number>;
  private readonly scaleCount: Record<ComponentGroupId, number>;
  private logTau: number;
  /** Red-side margin offsets in normalized units, index 0 = quals, 1 = elims. */
  private readonly bias = [0, 0];

  constructor(params: PcmParams = PCM_DEFAULTS, bprParams: BprParams = BPR_DEFAULTS) {
    this.p = params;
    this.totalModel = new BprModel(bprParams);
    this.logTau = Math.log(params.tau0);
    this.phases = {
      auto: new Map(),
      teleop: new Map(),
      endgame: new Map(),
    };
    this.scale = { auto: 0, teleop: 0, endgame: 0 };
    this.scaleCount = { auto: 0, teleop: 0, endgame: 0 };
  }

  /** Points per normalized unit for one phase. */
  private unit(phase: ComponentGroupId): number {
    return this.scale[phase] / 3;
  }

  /** True once every phase has absorbed enough parsed matches to be trusted. */
  private componentsReady(): boolean {
    for (const phase of COMPONENT_GROUP_IDS) {
      if (this.scaleCount[phase] < this.p.minPhaseMatches) return false;
      if (this.scale[phase] <= 0) return false;
    }
    return true;
  }

  private state(phase: ComponentGroupId, key: string): PhaseTeamState {
    const map = this.phases[phase];
    let s = map.get(key);
    if (s === undefined) {
      s = {
        muL: this.p.rookieMean,
        pL: this.p.priorVar,
        muS: 0,
        pS: this.p.fastPriorVar,
        lastYear: -1,
      };
      map.set(key, s);
    }
    return s;
  }

  /**
   * Season carryover, applied lazily on a team's first sight in a new season --
   * the same rule and the same reason as `BprModel.ageIntoSeason`: a team that
   * skips a season is aged exactly once rather than once per season missed, and
   * no rating is ever touched before that team's own next match, so no future
   * information can reach it early.
   */
  private ageIntoSeason(s: PhaseTeamState, year: number): void {
    if (s.lastYear === year) return;
    if (s.lastYear >= 0) {
      s.muL = this.p.seasonShrink * s.muL + (1 - this.p.seasonShrink) * 1.0;
      s.pL += this.p.seasonVar;
      s.muS = 0;
      s.pS = this.p.fastPriorVar;
    }
    s.lastYear = year;
  }

  /**
   * One alliance's view of one phase. Teams are ranked WITHIN THE PHASE
   * (design note 2) and weighted (1, w2, w3) renormalized to sum to 3, so an
   * average alliance predicts the phase scale regardless of alliance size.
   */
  private view(phase: ComponentGroupId, keys: readonly string[], year: number): PhaseView {
    const states: PhaseTeamState[] = [];
    const mus: number[] = [];
    for (const k of keys) {
      const s = this.state(phase, k);
      this.ageIntoSeason(s, year);
      states.push(s);
      mus.push(s.muL + s.muS);
    }
    const n = states.length;

    const base = [1, this.p.w2, this.p.w3];
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
    return { mu, pv, states, weights };
  }

  /**
   * One alliance's predicted points and variance, summed across phases.
   *
   * Per-phase variance is `(pv + obsVar) * unit^2`. Observation noise is
   * proportional to the phase's own scale -- `obsSd` is in normalized units, so
   * multiplying by `unit` is what keeps a single constant applicable to a phase
   * whose point level was never observed at design time. Endgame in 2019 and
   * teleop in 2026 differ by an order of magnitude in raw points; they do not
   * differ in normalized noise.
   */
  private alliance(
    keys: readonly string[],
    year: number,
  ): { points: number; variance: number; views: Record<ComponentGroupId, PhaseView> } {
    const views = {} as Record<ComponentGroupId, PhaseView>;
    let points = 0;
    let variance = 0;
    const sds: number[] = [];

    for (const phase of COMPONENT_GROUP_IDS) {
      const v = this.view(phase, keys, year);
      views[phase] = v;
      const u = this.unit(phase);
      points += v.mu * u;
      const varP = (v.pv + this.p.obsSd ** 2) * u * u;
      variance += varP;
      sds.push(Math.sqrt(Math.max(varP, 0)));
    }

    // Equicorrelation across phases: Var(sum) = sum(Var) + 2*rho*sum_{p<q} sd_p*sd_q.
    // At rho = 0 this loop contributes nothing and the knob is exactly inert.
    if (this.p.phaseCorr !== 0) {
      for (let i = 0; i < sds.length; i += 1) {
        for (let j = i + 1; j < sds.length; j += 1) {
          variance += 2 * this.p.phaseCorr * (sds[i] ?? 0) * (sds[j] ?? 0);
        }
      }
    }

    return { points, variance, views };
  }

  /**
   * Must be called before `update` for the same match.
   *
   * Touches state only through the lazy season transition and the
   * materialization of unseen teams -- both depend on the match's year and team
   * list, information available before the match is played, and never on its
   * result. No rating is moved by evidence here.
   */
  predict(
    redTeams: readonly string[],
    blueTeams: readonly string[],
    year: number,
    isElim: boolean,
  ): PcmPrediction {
    // Always stepped, so the private BPR instance stays a faithful duplicate of
    // the baseline arm whether or not this match ends up using it.
    const total = this.totalModel.predict(redTeams, blueTeams, year, isElim);

    if (!this.componentsReady()) {
      if (this.p.fallback === "noCall") {
        return { pRed: 0.5, source: "noCall", d: 0, v: 1, marginPoints: 0, total };
      }
      return {
        pRed: total.pRed,
        source: "total",
        d: total.d,
        v: total.v,
        marginPoints: total.marginPoints,
        total,
      };
    }

    const red = this.alliance(redTeams, year);
    const blue = this.alliance(blueTeams, year);

    // Combined points-per-normalized-unit, used only to express the margin and
    // the red-side offset in normalized units. It divides out of `z` entirely,
    // so it cannot affect the probability -- it exists so `bias` carries BPR's
    // units and BPR's +/-3 clamp rather than a points-scale of its own.
    const u = this.unit("auto") + this.unit("teleop") + this.unit("endgame");
    const unit = Math.max(u, 1e-9);

    const bias = this.bias[isElim ? 1 : 0] ?? 0;
    const marginPoints = red.points - blue.points + bias * unit;
    // Alliance variances are summed. `packages/core/algorithms/bpr.ts` measured
    // corr(z_red, z_blue) = 0.011 on the design years, so independence between
    // the two alliances is the established assumption here, unlike independence
    // between PHASES, which is the thing `phaseCorr` exists to question.
    const variancePoints = red.variance + blue.variance;

    const d = marginPoints / unit;
    const v = variancePoints / (unit * unit);
    const tau = Math.exp(this.logTau);
    const z = d / (tau * Math.sqrt(Math.max(v, 1e-9)));
    const pRed = Math.min(1 - 1e-6, Math.max(1e-6, normCdf(z)));

    return { pRed, source: "component", d, v, marginPoints, total };
  }

  /**
   * Fold an observed result in.
   *
   * `redPhase`/`bluePhase` are `null` whenever the match carried no parsed
   * breakdown. In that case the phase filters are left UNTOUCHED rather than
   * folded with zeros -- a zero here would teach the model that every team
   * scores nothing in auto, which is a different and false claim from "not
   * measured". The private BPR instance is stepped either way, which is what
   * keeps the fallback path honest across a coverage hole.
   */
  update(
    redTeams: readonly string[],
    blueTeams: readonly string[],
    year: number,
    redOut: number,
    blueOut: number,
    redFoul: number,
    blueFoul: number,
    outcome: number,
    isElim: boolean,
    pred: PcmPrediction,
    redPhase: PhaseOutputs | null,
    bluePhase: PhaseOutputs | null,
  ): void {
    // --- the private BPR instance, stepped with ITS OWN prediction ---
    this.totalModel.update(
      redTeams,
      blueTeams,
      year,
      redOut,
      blueOut,
      redFoul,
      blueFoul,
      outcome,
      isElim,
      pred.total,
    );

    // --- PCM's own link, learned only from predictions PCM actually made ---
    if (pred.source === "component") {
      const tau = Math.exp(this.logTau);
      const z = pred.d / (tau * Math.sqrt(Math.max(pred.v, 1e-9)));
      const p = pred.pRed;
      const dLdp = (p - outcome) / Math.max(p * (1 - p), 1e-6);
      const grad = dLdp * normPdf(z) * z;
      this.logTau = Math.min(
        Math.log(5),
        Math.max(Math.log(0.2), this.logTau + this.p.tauLr * grad),
      );
      if (this.p.biasLr > 0) {
        const idx = isElim ? 1 : 0;
        const dz = 1 / (tau * Math.sqrt(Math.max(pred.v, 1e-9)));
        const gBias = dLdp * normPdf(z) * dz;
        this.bias[idx] = Math.min(3, Math.max(-3, (this.bias[idx] ?? 0) - this.p.biasLr * gBias));
      }
    }

    if (redPhase === null || bluePhase === null) return;

    // --- per-phase scale and Kalman fold ---
    const w = isElim ? this.p.elimWeight : 1.0;
    for (const phase of COMPONENT_GROUP_IDS) {
      const rOut = redPhase[phase];
      const bOut = bluePhase[phase];

      // Online phase scale, in points. Each phase carries its OWN: auto and
      // endgame are worth far fewer points than teleop, so a shared scale would
      // put two of the three filters on a wildly wrong normalization.
      const obsMean = (rOut + bOut) / 2;
      if (this.scaleCount[phase] === 0) this.scale[phase] = Math.max(obsMean, 1);
      this.scaleCount[phase] += 1;
      const lr = Math.max(this.p.scaleMinLr, 1 / (this.scaleCount[phase] + 1));
      this.scale[phase] += lr * (obsMean - this.scale[phase]);
      const sc = Math.max(this.scale[phase], 1e-6);

      // Both alliances are scored against the PRE-match state, so the two
      // observations within one match cannot inform each other.
      const red = this.view(phase, redTeams, year);
      const blue = this.view(phase, blueTeams, year);
      const corr: Array<{ s: PhaseTeamState; dL: number; dS: number; dPL: number; dPS: number }> =
        [];

      for (const [side, out] of [
        [red, rOut],
        [blue, bOut],
      ] as const) {
        const u = (3 * out) / sc;
        const sTot = side.pv + this.p.obsSd ** 2 / Math.max(w, 1e-6);
        const rawInnov = u - side.mu;
        const zr = Math.abs(rawInnov) / Math.sqrt(Math.max(sTot, 1e-9));
        const innov = zr > this.p.huberK ? (rawInnov * this.p.huberK) / zr : rawInnov;

        for (let i = 0; i < side.states.length; i += 1) {
          const s = side.states[i];
          const wi = side.weights[i];
          if (s === undefined || wi === undefined) continue;
          // Observation row is H_i = wi, so the gain carries the same weight: a
          // team the model believes contributes less to this phase also absorbs
          // less of the phase's surprise.
          const kL = (wi * s.pL) / sTot;
          const kS = (wi * s.pS) / sTot;
          corr.push({
            s,
            dL: kL * innov,
            dS: kS * innov,
            dPL: -kL * wi * s.pL,
            dPS: -kS * wi * s.pS,
          });
        }
      }

      for (const c of corr) {
        c.s.muL += c.dL;
        c.s.muS += c.dS;
        c.s.pL = Math.max(1e-6, c.s.pL + c.dPL);
        c.s.pS = Math.max(1e-6, c.s.pS + c.dPS);
      }

      // --- process noise, per match played ---
      const touched = new Set<PhaseTeamState>([...red.states, ...blue.states]);
      for (const s of touched) {
        s.pL += this.p.qSlow;
        s.muS *= this.p.rhoFast;
        s.pS = this.p.rhoFast ** 2 * s.pS + this.p.qFast;
      }
    }
  }

  /**
   * Diagnostic snapshot of one phase's per-team point rating. Never consumed by
   * prediction; exposed so an analysis can check whether a phase filter learned
   * anything a reader would recognize (elite climbers ranking top in endgame,
   * and so on).
   */
  snapshot(phase: ComponentGroupId): Map<string, number> {
    const out = new Map<string, number>();
    const u = this.unit(phase);
    for (const [k, s] of this.phases[phase]) out.set(k, (s.muL + s.muS) * u);
    return out;
  }

  /** Live per-phase point scales, for reporting. */
  scales(): Record<ComponentGroupId, number> {
    return { ...this.scale };
  }
}
