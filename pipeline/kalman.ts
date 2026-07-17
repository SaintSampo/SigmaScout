// Time-varying skill model: a per-team, per-component Kalman filter.
//
// Each team's latent skill on a component random-walks over time (process noise
// Q = "how fast the model learns"). Each alliance score is a noisy observation
// of the SUM of that alliance's three teammates' skills (measurement noise R).
// We keep only per-team mean+variance (diagonal / assumed-density approximation
// of the true joint covariance) — the standard, tractable simplification that
// makes n>3000 teams stream in O(1) per team per match.
//
// The measurement update for a 3-team alliance observation y is the H=[1,1,1]
// Kalman update:
//     S      = v_a + v_b + v_c + R
//     m_i   += (v_i / S) * (y - (m_a + m_b + m_c))
//     v_i   -= v_i^2 / S            (for each team i on the alliance)
// Between a team's appearances we inflate its variance by Q (plus an extra kick
// across event boundaries — weeks of rebuilds cause bigger jumps than the gap
// between two qual matches).

import type {
  ComponentId,
  HyperParameters,
  Season,
  SeasonStateFile,
  TeamState,
} from "../src/core/types";
import type { ObservedMatch } from "./fetch";

/** A per-team starting prior (from cross-season carryover). */
export interface TeamPrior {
  mean: Record<ComponentId, number>;
  variance: Record<ComponentId, number>;
}

export interface KalmanConfig {
  components: ComponentId[];
  /** Default prior mean per component for an unseen team (rookie / league mean). */
  priorMean: Record<ComponentId, number>;
  /** Default prior variance per component (rookie cold-start uncertainty). */
  priorVariance: Record<ComponentId, number>;
  /**
   * Optional per-team starting priors (returning teams, seeded from last
   * season's normalized strength). Teams absent here fall back to the defaults
   * above — which is exactly right for rookies.
   */
  teamPriors?: Map<number, TeamPrior>;
  /** Measurement noise per component (irreducible per-alliance residual). */
  measurementNoise: Record<ComponentId, number>;
  /** Process noise per component per appearance ("learning rate"). */
  processNoise: Record<ComponentId, number>;
  /** Extra process-noise multiplier applied on a team's first match at a new event. */
  eventGapInflation: number;
  /**
   * Adaptive-gain strength (kappa). 0 = off (pure fixed-rate filter). When > 0,
   * a team whose recent corrections run consistently one direction (a genuine
   * change, not a one-off outlier) gets its process noise boosted so it relearns
   * faster. See `adaptDecay`.
   */
  adaptStrength: number;
  /** EWMA decay (lambda) for the per-team signed-innovation tracker. */
  adaptDecay: number;
}

interface TeamEntry {
  mean: Record<ComponentId, number>;
  variance: Record<ComponentId, number>;
  /** EWMA of recent signed corrections per component — the drift detector. */
  drift: Record<ComponentId, number>;
  lastEvent: string;
  games: number;
  lastPlayed: string;
}

/** One alliance's predicted score distribution (summed across components). */
export interface AlliancePred {
  mean: number;
  variance: number;
}

export class KalmanModel {
  private readonly teams = new Map<number, TeamEntry>();

  constructor(private readonly cfg: KalmanConfig) {}

  private ensure(team: number): TeamEntry {
    let e = this.teams.get(team);
    if (!e) {
      const drift: Record<ComponentId, number> = {};
      for (const c of this.cfg.components) drift[c] = 0;
      const seed = this.cfg.teamPriors?.get(team);
      e = {
        mean: { ...(seed?.mean ?? this.cfg.priorMean) },
        variance: { ...(seed?.variance ?? this.cfg.priorVariance) },
        drift,
        lastEvent: "",
        games: 0,
        lastPlayed: "",
      };
      this.teams.set(team, e);
    }
    return e;
  }

  /**
   * Time update: inflate a team's variance for the gap before this match.
   * Process noise = base Q, times an event-boundary factor, times an adaptive
   * boost driven by whether the team's recent corrections have been running one
   * direction (excess drift beyond the baseline learning rate).
   */
  private advance(team: number, eventKey: string): void {
    const e = this.ensure(team);
    const boundary = e.lastEvent !== "" && e.lastEvent !== eventKey;
    const eventFactor = 1 + (boundary ? this.cfg.eventGapInflation : 0);
    for (const c of this.cfg.components) {
      const qBase = this.cfg.processNoise[c];
      let boost = 1;
      if (this.cfg.adaptStrength > 0 && qBase > 0) {
        // z = recent signed drift measured in units of the baseline per-match
        // drift std. Only EXCESS drift (z^2 > 1) boosts, so ordinary noise —
        // and single outliers, which the EWMA quickly decays — don't.
        const z = e.drift[c] / Math.sqrt(qBase);
        boost = 1 + this.cfg.adaptStrength * Math.max(0, z * z - 1);
      }
      e.variance[c] += qBase * eventFactor * boost;
    }
  }

  /** Predict an alliance's total score distribution from current state. */
  predictAlliance(teams: number[]): AlliancePred {
    let mean = 0;
    let variance = 0;
    for (const c of this.cfg.components) {
      for (const t of teams) {
        const e = this.ensure(t);
        mean += e.mean[c];
        variance += e.variance[c];
      }
      variance += this.cfg.measurementNoise[c];
    }
    return { mean, variance };
  }

  /** Measurement update: fold one alliance's observed component scores in. */
  private observe(
    teams: number[],
    scoreByComponent: Record<ComponentId, number>,
    playedAt: string,
    eventKey: string,
  ): void {
    for (const c of this.cfg.components) {
      const entries = teams.map((t) => this.ensure(t));
      const S =
        entries.reduce((s, e) => s + e.variance[c], 0) +
        this.cfg.measurementNoise[c];
      const predicted = entries.reduce((s, e) => s + e.mean[c], 0);
      const innovation = (scoreByComponent[c] ?? 0) - predicted;
      const lambda = this.cfg.adaptDecay;
      for (const e of entries) {
        const gain = e.variance[c] / S;
        const correction = gain * innovation;
        e.mean[c] += correction;
        e.variance[c] -= (e.variance[c] * e.variance[c]) / S;
        // Track the signed correction: a run of same-sign corrections signals a
        // real skill change; zero-mean noise averages out here.
        e.drift[c] = lambda * e.drift[c] + (1 - lambda) * correction;
      }
    }
    for (const t of teams) {
      const e = this.ensure(t);
      e.games += 1;
      e.lastEvent = eventKey;
      if (playedAt > e.lastPlayed) e.lastPlayed = playedAt;
    }
  }

  /** Time update for both alliances (call BEFORE predicting the match). */
  advanceMatch(m: ObservedMatch): void {
    for (const t of m.redTeams) this.advance(t, m.eventKey);
    for (const t of m.blueTeams) this.advance(t, m.eventKey);
  }

  /** Measurement update for both alliances (call AFTER predicting the match). */
  observeMatch(m: ObservedMatch): void {
    this.observe(m.redTeams, m.redByComponent, m.playedAt, m.eventKey);
    this.observe(m.blueTeams, m.blueByComponent, m.playedAt, m.eventKey);
  }

  /** Convenience for offline fitting: advance then observe in one call. */
  step(m: ObservedMatch): void {
    this.advanceMatch(m);
    this.observeMatch(m);
  }

  /** Snapshot current state into the shippable season artifact. */
  toStateFile(season: Season): SeasonStateFile {
    const hyper: HyperParameters = {
      processNoise: this.cfg.processNoise,
      priorVariance: this.cfg.priorVariance,
      priorMean: this.cfg.priorMean,
      eventGapInflation: this.cfg.eventGapInflation,
    };
    const teams: TeamState[] = [];
    for (const [team, e] of this.teams) {
      const components: TeamState["components"] = {};
      for (const c of this.cfg.components) {
        components[c] = { mean: e.mean[c], variance: e.variance[c] };
      }
      teams.push({
        team,
        components,
        matchesPlayed: e.games,
        lastUpdated: e.lastPlayed || `${season}-01-01T00:00:00.000Z`,
      });
    }
    teams.sort((a, b) => a.team - b.team);
    return {
      model: {
        season,
        components: this.cfg.components,
        residualVariance: this.cfg.measurementNoise,
        hyper,
      },
      teams,
    };
  }
}
