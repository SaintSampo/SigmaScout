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
  /**
   * Anti-additivity. OPR and EPA both treat an alliance as the plain sum of its
   * teams. An FRC alliance shares one field and a finite supply of game pieces,
   * so three elite scorers should not add linearly. Teams are ranked within
   * their alliance and contribute with weights (1, w2, w3), renormalized to sum
   * to 3 so the scale-free property is preserved.
   *
   * w2 = w3 = 1 reproduces plain additivity exactly, so this knob is inert at
   * its default and has to earn promotion on the design years.
   */
  w2: number;
  w3: number;
  /**
   * Defensive suppression. Each team carries a rating for how much it reduces
   * the opposing alliance's output, so a match is offense-vs-defense rather
   * than offense-vs-offense. Identifiable in principle because both alliances
   * are observed every match, but this is exactly the shape that produced the
   * project's historical "unidentifiable model" failure, so it stays hard
   * regularized and must earn promotion.
   *
   * defPriorVar = 0 pins every defense rating at 0 forever, reproducing the
   * no-defense model exactly, so this knob is inert at its default too.
   */
  defPriorVar: number;
  defQ: number;
  /**
   * Huber clip on the standardized innovation. A Gaussian filter treats a
   * blown-out residual as strong evidence, but in FRC the fat tail is mostly
   * mechanical: a robot loses comms, never leaves the wall, or tips over. Those
   * matches say little about a team's true scoring ability, and letting them
   * move a rating at full weight is how a good team gets wrongly downgraded.
   *
   * Innovations beyond huberK standard deviations are scaled back to huberK.
   * A very large value disables clipping, so this knob is inert at default.
   */
  huberK: number;
  /**
   * Online learning rate for a red-side margin bias, fitted separately for
   * qualification and elimination matches.
   *
   * Design-year evidence: quals are balanced (49.2-50.3% red across 2016-2022)
   * but eliminations run 63-78% red, because the higher-seeded alliance is
   * conventionally placed on red. Seeding therefore carries information beyond
   * what the ratings alone express. Learning the offset online, rather than
   * hardcoding "red is the better seed", means the model simply tracks whatever
   * the convention turns out to be - including it changing or disappearing.
   *
   * biasLr = 0 pins both offsets at zero, so this knob is inert at default.
   */
  biasLr: number;
  /**
   * Heteroscedastic observation noise. Observation sd becomes
   * `obsSd * (1 + obsSdSlope * (mu - 3) / 3)`, so a strong alliance is treated
   * as noisier than a weak one. At slope 0 this is exactly the constant-noise
   * model, so the knob is inert at default.
   *
   * Motivated by innovation diagnostics rather than by a search: sd(z) rises
   * monotonically with predicted alliance strength in every season measured
   * (2023 weeks 0-1: 0.543 -> 0.716 across quintiles; 2022: 0.547 -> 1.001).
   * A single constant obsSd cannot express that, which is why the model comes
   * out under-confident on even matchups and over-confident on lopsided ones.
   */
  obsSdSlope: number;
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
  w2: 1.0,
  w3: 1.0,
  defPriorVar: 0,
  defQ: 0,
  huberK: 1e9,
  biasLr: 0,
  obsSdSlope: 0,
};

interface TeamState {
  muL: number;
  pL: number;
  muS: number;
  pS: number;
  /** Foul-conceded rate, normalized units. */
  muF: number;
  pF: number;
  /** Defensive suppression applied to the opposing alliance, normalized units. */
  muD: number;
  pD: number;
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
  /** Summed defensive suppression this alliance applies to its opponent. */
  muD: number;
  pD: number;
  states: TeamState[];
  /** Contribution weight per team, aligned with `states`. */
  weights: number[];
}

export class BprModel {
  private readonly p: BprParams;
  private readonly teams = new Map<string, TeamState>();
  private logTau: number;
  /** Online estimate of mean alliance foul-adjusted output, in points. */
  private scale = 0;
  private scaleCount = 0;
  private year = -1;
  /** Red-side margin offsets, index 0 = qualification, 1 = elimination. */
  private readonly bias = [0, 0];

  constructor(params: BprParams) {
    this.p = params;
    this.logTau = Math.log(params.tau0);
  }

  /**
   * Diagnostic snapshot of every team's current point rating (slow + fast).
   * Used to measure how much team strength persists from one season to the
   * next; never consumed by prediction.
   */
  snapshot(): Map<string, number> {
    const out = new Map<string, number>();
    for (const [k, s] of this.teams) out.set(k, s.muL + s.muS);
    return out;
  }

  /** Observation variance for an alliance whose predicted output is `mu`. */
  private obsVar(mu: number): number {
    const s = this.p.obsSd * (1 + (this.p.obsSdSlope * (mu - 3)) / 3);
    return Math.max(0.05, s) ** 2;
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
        muD: 0,
        pD: this.p.defPriorVar,
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
      s.pD += this.p.defQ * 20;
    }
    s.lastYear = year;
  }

  private view(keys: readonly string[], year: number): AllianceView {
    const states: TeamState[] = [];
    const mus: number[] = [];
    for (const k of keys) {
      const s = this.state(k);
      this.ageIntoSeason(s, year);
      states.push(s);
      mus.push(s.muL + s.muS);
    }
    const n = states.length;

    // Rank teams within the alliance, strongest first, and hand out the
    // (1, w2, w3) contribution weights by rank. Weights are renormalized to
    // sum to 3 so that an average alliance still predicts the season scale
    // regardless of w2/w3 or of a non-standard alliance size.
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
    let muF = 0;
    let pF = 0;
    let muD = 0;
    let pD = 0;
    for (let i = 0; i < n; i += 1) {
      const s = states[i];
      const w = weights[i];
      if (s === undefined || w === undefined) continue;
      mu += w * (mus[i] ?? 0);
      pv += w * w * (s.pL + s.pS);
      muF += s.muF;
      pF += s.pF;
      muD += s.muD;
      pD += s.pD;
    }
    return { mu, pv, muF, pF, muD, pD, states, weights };
  }

  /**
   * Diagnostic hook: the model's forecast for ONE alliance, in normalized
   * units, plus the live season scale. Exposed so an analysis script can form
   * standardized innovations z = (observed - mu) / sqrt(v) and check whether
   * the filter's own variance claim is honest. sd(z) should be 1.
   *
   * Read-only in spirit; it shares view()'s lazy season transition and nothing
   * else. Must be called before update() for the same match.
   */
  forecast(keys: readonly string[], year: number): { mu: number; v: number; scale: number } {
    const a = this.view(keys, year);
    return { mu: a.mu, v: a.pv + this.obsVar(a.mu), scale: this.scale };
  }

  /**
   * Must be called before update() for the same match.
   *
   * This does touch state: it applies each team's lazy season transition and
   * materializes unseen teams. Neither step can leak, because both depend only
   * on the match's year and team list - information available before the match
   * is played - and never on its result. No rating is moved by evidence here.
   */
  predict(
    redTeams: readonly string[],
    blueTeams: readonly string[],
    year: number,
    isElim: boolean,
  ): Prediction {
    const red = this.view(redTeams, year);
    const blue = this.view(blueTeams, year);
    const bias = this.bias[isElim ? 1 : 0] ?? 0;

    // Red's foul points are conceded by blue, and vice versa.
    const foulTerm = this.p.foulOn ? blue.muF - red.muF : 0;
    const foulVar = this.p.foulOn ? red.pF + blue.pF + 2 * this.p.foulObsSd ** 2 : 0;

    // Each alliance's output is its own weighted offense minus the suppression
    // its opponent applies, so a defensive alliance gains margin twice over.
    const d = red.mu - blue.muD - (blue.mu - red.muD) + foulTerm + bias;
    const v =
      red.pv +
      blue.pD +
      blue.pv +
      red.pD +
      this.obsVar(red.mu) +
      this.obsVar(blue.mu) +
      foulVar;
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
    const dLdp = (p - outcome) / Math.max(p * (1 - p), 1e-6);
    const grad = dLdp * normPdf(z) * z;
    this.logTau = Math.min(
      Math.log(5),
      Math.max(Math.log(0.2), this.logTau + this.p.tauLr * grad),
    );

    // Red-side offset, same online log-loss gradient. dz/dbias = 1/(tau*sd).
    if (this.p.biasLr > 0) {
      const idx = isElim ? 1 : 0;
      const dz = 1 / (tau * Math.sqrt(Math.max(pred.v, 1e-9)));
      const gBias = dLdp * normPdf(z) * dz;
      this.bias[idx] = Math.min(3, Math.max(-3, (this.bias[idx] ?? 0) - this.p.biasLr * gBias));
    }

    // --- rating update, both alliances against the pre-match state ---
    const w = isElim ? this.p.elimWeight : 1.0;
    const red = this.view(redTeams, year);
    const blue = this.view(blueTeams, year);
    const corr: Array<{ s: TeamState; dL: number; dS: number; dPL: number; dPS: number }> = [];

    const defCorr: Array<{ s: TeamState; dD: number; dPD: number }> = [];
    const sides: Array<readonly [AllianceView, AllianceView, number]> = [
      [red, blue, redOut],
      [blue, red, blueOut],
    ];
    for (const [side, opp, out] of sides) {
      const u = (3 * out) / sc; // observed alliance output, normalized
      const sTot = side.pv + opp.pD + this.obsVar(side.mu) / Math.max(w, 1e-6);

      // Huber-clip the innovation so a mechanical blowout moves ratings like a
      // large-but-bounded surprise rather than like overwhelming evidence.
      const rawInnov = u - (side.mu - opp.muD);
      const zr = Math.abs(rawInnov) / Math.sqrt(Math.max(sTot, 1e-9));
      const innov = zr > this.p.huberK ? (rawInnov * this.p.huberK) / zr : rawInnov;

      // The opposing alliance's defenders sit on this observation with H = -1:
      // an alliance that outscored expectation means its opponents defended
      // worse than their ratings implied.
      for (const ds of opp.states) {
        const kD = ds.pD / sTot;
        defCorr.push({ s: ds, dD: -kD * innov, dPD: -kD * ds.pD });
      }

      for (let i = 0; i < side.states.length; i += 1) {
        const s = side.states[i];
        const wi = side.weights[i];
        if (s === undefined || wi === undefined) continue;
        // Observation row is H_i = wi, so the gain carries the same weight:
        // a team that the model believes contributes less also absorbs less
        // of the alliance's surprise.
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
    for (const c of defCorr) {
      c.s.muD += c.dD;
      c.s.pD = Math.max(0, c.s.pD + c.dPD);
    }

    // --- process noise / time evolution, per match played ---
    const touched = new Set<TeamState>([...red.states, ...blue.states]);
    for (const s of touched) {
      s.pL += this.p.qSlow;
      s.muS *= this.p.rhoFast;
      s.pS = this.p.rhoFast ** 2 * s.pS + this.p.qFast;
      s.pF += this.p.foulQ;
      s.pD += this.p.defQ;
    }
  }
}
