// The prediction core. This exact code runs offline (pipeline, to sanity-check
// and to precompute predictions for scheduled matches) and online (browser, for
// live what-if alliances). One source of truth.

import type {
  AlliancePrediction,
  ComponentId,
  MatchPrediction,
  MatchupInput,
  SeasonModel,
  SkillEstimate,
  TeamKey,
  TeamState,
} from "./types";
import { probAGreaterThanB } from "./stats";

/** Fast lookup wrapper around a season's team states. */
export class SeasonModelView {
  private readonly byTeam: Map<TeamKey, TeamState>;
  /** All teams in this season, as loaded (unsorted). */
  public readonly teamList: TeamState[];

  constructor(
    public readonly model: SeasonModel,
    teams: TeamState[],
  ) {
    this.teamList = teams;
    this.byTeam = new Map(teams.map((t) => [t.team, t]));
  }

  hasTeam(team: TeamKey): boolean {
    return this.byTeam.has(team);
  }

  /** Sum of a team's component means — a single "overall rating" scalar. */
  overallRating(team: TeamKey): number {
    return this.model.components.reduce(
      (sum, c) => sum + this.skillFor(team, c).mean,
      0,
    );
  }

  /**
   * Return a team's per-component skill, falling back to the season prior for
   * teams we've never seen (rookies, or teams missing from this shard). The
   * prior carries high variance, which correctly widens the prediction.
   */
  skillFor(team: TeamKey, component: ComponentId): SkillEstimate {
    const state = this.byTeam.get(team);
    const known = state?.components[component];
    if (known) return known;
    return {
      mean: this.model.hyper.priorMean[component] ?? 0,
      variance: this.model.hyper.priorVariance[component] ?? 1e6,
    };
  }

  /**
   * Predict one alliance's score distribution: for each component, sum the three
   * teams' mean contributions and their variances, then add the component's
   * irreducible per-alliance residual variance (contention, refs, luck).
   */
  predictAlliance(teams: TeamKey[]): AlliancePrediction {
    let mean = 0;
    let variance = 0;
    const byComponent: Record<ComponentId, number> = {};

    for (const component of this.model.components) {
      let compMean = 0;
      let compVar = 0;
      for (const team of teams) {
        const s = this.skillFor(team, component);
        compMean += s.mean;
        compVar += s.variance;
      }
      compVar += this.model.residualVariance[component] ?? 0;
      byComponent[component] = compMean;
      mean += compMean;
      variance += compVar;
    }

    return { mean, variance, byComponent };
  }

  /** Full head-to-head prediction with calibrated win probability. */
  predictMatch(input: MatchupInput): MatchPrediction {
    const red = this.predictAlliance(input.red);
    const blue = this.predictAlliance(input.blue);
    const missingTeams = [...input.red, ...input.blue].filter(
      (t) => !this.hasTeam(t),
    );

    return {
      red,
      blue,
      redWinProbability: probAGreaterThanB(
        red.mean,
        red.variance,
        blue.mean,
        blue.variance,
      ),
      predictedMargin: red.mean - blue.mean,
      missingTeams,
    };
  }
}
