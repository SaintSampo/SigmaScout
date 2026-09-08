/**
 * BPR - Bayesian Power Rating.
 *
 * Per-team latent scoring contribution tracked by a Gaussian filter, in
 * SCALE-FREE units: a team's rating is its contribution measured in multiples
 * of (average alliance output / 3), so r = 1 is a league-average team. The
 * season's point scale is estimated online and divides out of the win
 * probability entirely, which is what lets one hyperparameter set apply to a
 * season whose scoring level was never observed at design time.
 *
 * Two timescales: slow talent L (a robot's underlying quality) plus fast form S
 * (mean-reverting - captures a robot being repaired, upgraded, or breaking).
 *
 * Credit for an alliance's result is assigned to its three teams in proportion
 * to each team's posterior variance, so an uncertain team moves further than a
 * well-established one on the same evidence.
 */

export interface BprParams {
  /** Observation noise sd on alliance output, normalized units. */
  obsSd: number;
  /** Process noise (variance) added to slow component per match played. */
  qSlow: number;
  /** Mean-reversion factor for the fast component, per match played. */
  rhoFast: number;
  /** Process noise (variance) for the fast component per match played. */
  qFast: number;
  /** Prior variance for a team never seen before. */
  priorVar: number;
  /** Prior variance of the fast component. */
  fastPriorVar: number;
  /** Prior mean rating for a never-seen team (1.0 = league average). */
  rookieMean: number;
  /** Season carryover: shrink of slow mean toward 1.0 at a season boundary. */
  seasonShrink: number;
  /** Variance added to the slow component at a season boundary. */
  seasonVar: number;
  /** Initial link temperature. */
  tau0: number;
  /** Online learning rate for log-tau. */
  tauLr: number;
  /** Model per-team foul-conceded rates and fold them into the margin. */
  foulOn: boolean;
  foulObsSd: number;
  foulQ: number;
  foulPriorVar: number;
  /** Observation weight multiplier for elimination matches. */
  elimWeight: number;
  /** Adaptation floor for the online season-scale estimate. */
  scaleMinLr: number;
}

export const DEFAULTS: BprParams = {
  obsSd: 0.45,
  qSlow: 0.0015,
  rhoFast: 0.85,
  qFast: 0.01,
  priorVar: 0.5,
  fastPriorVar: 0.05,
  rookieMean: 0.75,
  seasonShrink: 0.7,
  seasonVar: 0.25,
  tau0: 1.0,
  tauLr: 0.02,
  foulOn: true,
  foulObsSd: 0.35,
  foulQ: 0.004,
  foulPriorVar: 0.15,
  elimWeight: 1.0,
  scaleMinLr: 0.01,
};

interface TeamState {
  muL: number;
  pL: number;
  muS: number;
  pS: number;
  /** Foul-conceded rate, normalized units. */
  muF: number;
  pF: number;
  lastYear: number;
}

const SQRT2PI = Math.sqrt(2 * Math.PI);
const normPdf = (z: number): number => Math.exp(-0.5 * z * z) / SQRT2PI;

/** Abramowitz-Stegun 7.1.26 error function; ~1e-7 absolute accuracy. */
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
const normCdf = (z: number): number => 0.5 * (1 + erf(z / Math.SQRT2));

export interface Prediction {
  /** P(red wins), in (0,1). */
  pRed: number;
  /** Predicted red-minus-blue margin in normalized units. */
  d: number;
  /** Total predictive variance of d, normalized units. */
  v: number;
  /** Predicted margin in points, using the current season-scale estimate. */
  marginPoints: number;
}

interface AllianceView {
  mu: number;
  pv: number;
  muF: number;
  pF: number;
  states: TeamState[];
}

export class BprModel {
  private readonly p: BprParams;
  private readonly teams = new Map<string, TeamState>();
  private logTau: number;
  /** Online estimate of mean alliance foul-adjusted output, in points. */
  private scale = 0;
  private scaleCount = 0;
  private year = -1;

  constructor(params: BprParams) {
    this.p = params;
    this.logTau = Math.log(params.tau0);
  }

  private state(key: string): TeamState {
    let s = this.teams.get(key);
    if (s === undefined) {
      s = {
        muL: this.p.rookieMean,
        pL: this.p.priorVar,
        muS: 0,
        pS: this.p.fastPriorVar,
        muF: 0,
        pF: this.p.foulPriorVar,
        lastYear: -1,
      };
      this.teams.set(key, s);
    }
    return s;
  }

  /**
   * Season carryover is applied lazily, per team, on first sight in a new
   * season. Doing it lazily rather than sweeping every team at the boundary
   * means a team that skips a season is aged exactly once, not once per season
   * missed - and, more importantly, it never touches a team before that team's
   * own next match, so no future information can reach a rating early.
   */
  private ageIntoSeason(s: TeamState, year: number): void {
    if (s.lastYear === year) return;
    if (s.lastYear >= 0) {
      s.muL = this.p.seasonShrink * s.muL + (1 - this.p.seasonShrink) * 1.0;
      s.pL += this.p.seasonVar;
      s.muS = 0;
      s.pS = this.p.fastPriorVar;
      s.pF += this.p.foulQ * 20;
    }
    s.lastYear = year;
  }

  private view(keys: readonly string[], year: number): AllianceView {
    let mu = 0;
    let pv = 0;
    let muF = 0;
    let pF = 0;
    const states: TeamState[] = [];
    for (const k of keys) {
      const s = this.state(k);
      this.ageIntoSeason(s, year);
      mu += s.muL + s.muS;
      pv += s.pL + s.pS;
      muF += s.muF;
      pF += s.pF;
      states.push(s);
    }
    return { mu, pv, muF, pF, states };
  }

  /** Predict without mutating any rating. Must be called before update(). */
  predict(
    redTeams: readonly string[],
    blueTeams: readonly string[],
    year: number,
  ): Prediction {
    const red = this.view(redTeams, year);
    const blue = this.view(blueTeams, year);

    // Red's foul points are conceded by blue, and vice versa.
    const foulTerm = this.p.foulOn ? blue.muF - red.muF : 0;
    const foulVar = this.p.foulOn ? red.pF + blue.pF + 2 * this.p.foulObsSd ** 2 : 0;

    const d = red.mu - blue.mu + foulTerm;
    const v = red.pv + blue.pv + 2 * this.p.obsSd ** 2 + foulVar;
    const tau = Math.exp(this.logTau);
    const z = d / (tau * Math.sqrt(Math.max(v, 1e-9)));
    const pRed = Math.min(1 - 1e-6, Math.max(1e-6, normCdf(z)));
    return { pRed, d, v, marginPoints: (d * this.scale) / 3 };
  }

  /**
   * Fold an observed result into the ratings. Both alliances are scored against
   * the pre-match state and their Kalman corrections applied afterwards, so the
   * two observations within one match cannot inform each other.
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
    pred: Prediction,
  ): void {
    this.year = year;

    // --- online season scale (mean foul-adjusted alliance output, points) ---
    const obsMean = (redOut + blueOut) / 2;
    if (this.scaleCount === 0) this.scale = Math.max(obsMean, 1);
    this.scaleCount += 1;
    const lr = Math.max(this.p.scaleMinLr, 1 / (this.scaleCount + 1));
    this.scale += lr * (obsMean - this.scale);
    const sc = Math.max(this.scale, 1e-6);

    // --- link temperature, online gradient descent on log loss ---
    const tau = Math.exp(this.logTau);
    const z = pred.d / (tau * Math.sqrt(Math.max(pred.v, 1e-9)));
    const p = pred.pRed;
    const grad = ((p - outcome) * normPdf(z) * z) / Math.max(p * (1 - p), 1e-6);
    this.logTau = Math.min(
      Math.log(5),
      Math.max(Math.log(0.2), this.logTau + this.p.tauLr * grad),
    );

    // --- rating update, both alliances against the pre-match state ---
    const w = isElim ? this.p.elimWeight : 1.0;
    const red = this.view(redTeams, year);
    const blue = this.view(blueTeams, year);
    const corr: Array<{ s: TeamState; dL: number; dS: number; dPL: number; dPS: number }> = [];

    const sides: Array<readonly [AllianceView, number]> = [
      [red, redOut],
      [blue, blueOut],
    ];
    for (const [side, out] of sides) {
      const u = (3 * out) / sc; // observed alliance output, normalized
      const innov = u - side.mu;
      const sTot = side.pv + this.p.obsSd ** 2 / Math.max(w, 1e-6);
      for (const s of side.states) {
        const kL = s.pL / sTot;
        const kS = s.pS / sTot;
        corr.push({ s, dL: kL * innov, dS: kS * innov, dPL: -kL * s.pL, dPS: -kS * s.pS });
      }
    }

    // --- foul-conceded update: red's foul points measure BLUE's fouling ---
    const foulCorr: Array<{ s: TeamState; dF: number; dPF: number }> = [];
    if (this.p.foulOn) {
      const concede: Array<readonly [AllianceView, number]> = [
        [blue, redFoul],
        [red, blueFoul],
      ];
      for (const [conceder, awarded] of concede) {
        const uf = (3 * awarded) / sc;
        const innovF = uf - conceder.muF;
        const sF = conceder.pF + this.p.foulObsSd ** 2;
        for (const s of conceder.states) {
          const kF = s.pF / sF;
          foulCorr.push({ s, dF: kF * innovF, dPF: -kF * s.pF });
        }
      }
    }

    for (const c of corr) {
      c.s.muL += c.dL;
      c.s.muS += c.dS;
      c.s.pL = Math.max(1e-6, c.s.pL + c.dPL);
      c.s.pS = Math.max(1e-6, c.s.pS + c.dPS);
    }
    for (const c of foulCorr) {
      c.s.muF += c.dF;
      c.s.pF = Math.max(1e-6, c.s.pF + c.dPF);
    }

    // --- process noise / time evolution, per match played ---
    const touched = new Set<TeamState>([...red.states, ...blue.states]);
    for (const s of touched) {
      s.pL += this.p.qSlow;
      s.muS *= this.p.rhoFast;
      s.pS = this.p.rhoFast ** 2 * s.pS + this.p.qFast;
      s.pF += this.p.foulQ;
    }
  }
}
