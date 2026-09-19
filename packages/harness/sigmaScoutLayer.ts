/**
 * THE SIGMASCOUT LAYER — the level-2 features built on top of an algorithm.
 *
 * SigmaScout has two levels, and this module is the whole of the second one:
 *
 *   LEVEL 1  an ALGORITHM (OPR, EPA, SPR) predicts alliance scores. It knows
 *            nothing about anything below.
 *   LEVEL 2  SigmaScout features computed from predicted-vs-actual scores
 *            alone — Sigma Score, the Match Band and ranking-point odds. No
 *            algorithm models them and no algorithm may import them.
 *
 * All three are published for Sigma algorithms only (SPR), gated by
 * `usesSigmaScore` and `publishesRankingPoints`.
 *
 * Level-2 per-match math lives only here; adding a level-2 field in a caller's
 * loop instead creates a second write path that can drop it.
 *
 * PREDICT BEFORE UPDATE: `foldPlayed` reads this match's band and pmf from
 * history so far and only then folds the result, so a match never informs its
 * own band. Callers must drive one instance per algorithm with a chronological
 * match stream, or the guarantee is void.
 */

import type { CompLevel, MatchResult, Prediction, UpcomingMatch } from "../core/algorithms/types.js";
import { foldsIntoRatings } from "../core/algorithms/eventTypes.js";
import type { PredictionRecord } from "./replay.js";
import type { RpRuleModule } from "../core/rankingPoints/constants.js";
import { isRpEligibleEventType } from "../core/rankingPoints/constants.js";
import { RpMomentsAccumulator, type RpTeamBeliefs } from "../core/rankingPoints/empiricalMoments.js";
import { RpMeanShiftAccumulator, rosterIsFullyWarm, type RpMeanShiftState } from "../core/rankingPoints/meanShift.js";
import {
  analyticRpPmf,
  emptyMarginalResolutionTally,
  type MarginalResolutionTally,
} from "../core/rankingPoints/analyticPmf.js";
import {
  allianceSigmaBandVariance,
  publishesRankingPoints,
  SigmaScoreAccumulator,
  sigmaMatchBandVariance,
  usesSigmaScore,
  type SigmaBelief,
  type SigmaPopulation,
} from "./sigmaScore.js";

/**
 * A scheduled match with its level-2 fields attached. Structurally publish.ts's
 * `UpcomingPredictionRecord`, declared here so this module does not depend on
 * the CLI that drives it.
 */
export interface UpcomingLayerRecord {
  readonly match: UpcomingMatch;
  readonly prediction: Prediction;
  /** The PUBLISHED display band (`sigmaMatchBandVariance`), never the win-odds variance. Absent for non-Sigma algorithms. */
  readonly matchBand?: { red?: number; blue?: number };
}

/**
 * One algorithm's level-2 state for one season: drive it with that algorithm's
 * chronological played stream via `foldPlayed`, then read `sigmaScoreByTeam()`
 * and `rpAccumulator` for the not-yet-played work.
 */
export class SigmaScoutLayer {
  /** Present only for Sigma algorithms: the source of Sigma Score, the win-odds variance and the match band. */
  readonly #sigma: SigmaScoreAccumulator | undefined;
  readonly #rp: RpMomentsAccumulator | undefined;
  readonly #ruleModule: RpRuleModule | undefined;
  /**
   * Running resolved-family mix across every pmf this instance has built: how
   * often a marginal fit fell back from its declared family. In-memory only,
   * never written to any artifact.
   */
  readonly #rpMarginalResolutionTally: MarginalResolutionTally = emptyMarginalResolutionTally();
  /** The walk-forward RP mean shift (`meanShift.ts`), present whenever this layer publishes ranking points. */
  readonly #rpMeanShift: RpMeanShiftAccumulator | undefined;

  /**
   * `ruleModule` is the season's RP rules, or `undefined` for a season without
   * them (bands still work; RP simply does not appear). `algorithmId` opts in to
   * features: Sigma and the band need `usesSigmaScore`, the RP accumulator and
   * mean shift need `ruleModule` and `publishesRankingPoints`. With no id the
   * layer produces nothing.
   */
  constructor(ruleModule: RpRuleModule | undefined, algorithmId?: string) {
    const rankingPoints = algorithmId !== undefined && publishesRankingPoints(algorithmId);
    this.#ruleModule = rankingPoints ? ruleModule : undefined;
    this.#rp = rankingPoints && ruleModule !== undefined ? new RpMomentsAccumulator(ruleModule) : undefined;
    this.#rpMeanShift = rankingPoints && ruleModule !== undefined ? new RpMeanShiftAccumulator(ruleModule) : undefined;
    this.#sigma = algorithmId !== undefined && usesSigmaScore(algorithmId) ? new SigmaScoreAccumulator() : undefined;
  }

  /**
   * The mean shift's running state, or `undefined` when the layer publishes
   * no ranking points. A snapshot: mutating it never reaches the layer.
   */
  rpMeanShiftState(): RpMeanShiftState | undefined {
    return this.#rpMeanShift?.toState();
  }

  /** A fresh copy of the resolved-family tally, so a caller cannot mutate the running counts. */
  get rpMarginalResolutionTally(): MarginalResolutionTally {
    return { ...this.#rpMarginalResolutionTally };
  }

  /** True when this layer publishes Sigma Score. */
  get usesSigma(): boolean {
    return this.#sigma !== undefined;
  }

  /** Finished Sigma Scores for every team the layer has seen, or an empty map for a non-Sigma algorithm. Scores every team: never call it per match. */
  sigmaScoreByTeam(): ReadonlyMap<string, number> {
    if (this.#sigma === undefined) return new Map();
    return this.#sigma.scoreByTeam();
  }

  /**
   * One team's Sigma Score, read-only (never creates a belief, which would make
   * results order-dependent). Called right after `foldPlayed`, it is the "after
   * this match" figure a metric-history row publishes. `undefined` for a
   * non-Sigma layer.
   */
  sigmaFor(teamKey: string): number | undefined {
    return this.#sigma?.sigmaFor(teamKey);
  }

  /** One alliance's WIN-ODDS variance from history so far (what `#rpFieldsFor` reads), or `undefined` for a non-Sigma layer. */
  #bandVarianceFor(roster: readonly string[]): number | undefined {
    return this.#sigma?.bandVarianceFor(roster);
  }

  /**
   * Every team's RAW running RP state for the Worker's D1 seed, not a finished
   * figure: dropping even a single-observation team makes its first live match
   * diverge from the offline publisher. Empty when the layer publishes no
   * ranking points.
   */
  rpVariableBeliefs(): ReadonlyMap<string, RpTeamBeliefs> {
    return this.#rp?.beliefsByTeam() ?? new Map();
  }

  /**
   * Every team's RAW running Sigma state for the Worker's D1 seed (unlike the
   * finished `sigmaScoreByTeam()`), so live bands continue the season's history
   * instead of silently restarting from one event. Empty for a non-Sigma
   * algorithm, whose seed carries no Sigma key; `usesSigma` tells the cases apart.
   */
  sigmaBeliefs(): ReadonlyMap<string, SigmaBelief> {
    return this.#sigma?.beliefsByTeam() ?? new Map();
  }

  /**
   * The Sigma talent prior's population statistics for the LEAGUE row (a resumed
   * accumulator without them falls back to the flat prior). `undefined`, not a
   * zeroed triple, for a non-Sigma algorithm, so no seed claims an unfolded population.
   */
  sigmaPopulation(): SigmaPopulation | undefined {
    return this.#sigma?.population();
  }

  /** The RP beliefs learned so far, or `undefined` for a season with no registered rules or an algorithm that publishes no ranking points. */
  get rpAccumulator(): RpMomentsAccumulator | undefined {
    return this.#rp;
  }

  /** The season's RP rules, or `undefined` (including for an algorithm that publishes no ranking points). */
  get ruleModule(): RpRuleModule | undefined {
    return this.#ruleModule;
  }

  /**
   * Attaches this match's level-2 fields, THEN folds the match in. Call once per
   * played match, in order. Both the event and team artifact builders read the
   * returned record, so a match's band is byte-identical on both pages.
   */
  foldPlayed(
    match: MatchResult,
    prediction: Prediction,
    talentAfterMatch?: ReadonlyMap<string, number>
  ): PredictionRecord {
    const redBandVariance = this.#bandVarianceFor(match.redTeams);
    const blueBandVariance = this.#bandVarianceFor(match.blueTeams);
    // A preseason Week 0 match is PRICED and never FOLDED (`foldsIntoRatings`):
    // it gets its band and RP odds from unchanged beliefs, and teaches none of
    // them. `foldMatch` applies the same rule itself; the talent, the mean shift
    // and the threshold fold have no such gate of their own, so it is here.
    const folds = foldsIntoRatings(match.eventType);
    this.#sigma?.foldMatch(match, prediction);
    // Talent after the fold: it is read from post-match state, so applying it
    // first would let a match inform its own prior.
    if (folds && talentAfterMatch !== undefined && this.#sigma !== undefined) {
      for (const [teamKey, talent] of talentAfterMatch) this.#sigma.observeTalent(teamKey, talent);
    }

    // Win odds: the UNCORRECTED variance.
    const derivedRp = this.#rpFieldsFor(match, prediction, redBandVariance, blueBandVariance);
    // After this match's RP fields are read, before its thresholds are folded:
    // the residual is taken against the mean this match was priced from.
    if (folds && this.#rp !== undefined) this.#rpMeanShift?.observeMatch(this.#rp, match);
    if (folds) this.#foldObservedThresholds(match);

    return {
      match,
      // An algorithm that produced its own RP keeps it; ours fills the gap.
      prediction: prediction.redRpPmf !== undefined ? prediction : { ...prediction, ...derivedRp },
      ...this.#matchBandFields(match, redBandVariance, blueBandVariance),
    };
  }

  /** The published display band from the two win-odds variances. A non-Sigma layer returns no `matchBand` key. */
  #matchBandFields(
    match: { redTeams: readonly string[]; blueTeams: readonly string[] },
    redWinOddsVariance: number | undefined,
    blueWinOddsVariance: number | undefined
  ): { matchBand?: { red?: number; blue?: number } } {
    if (this.#sigma === undefined) return {};
    const red = sigmaMatchBandVariance(match.redTeams.length, redWinOddsVariance);
    const blue = sigmaMatchBandVariance(match.blueTeams.length, blueWinOddsVariance);
    if (red === undefined && blue === undefined) return {};
    return { matchBand: { ...(red !== undefined ? { red } : {}), ...(blue !== undefined ? { blue } : {}) } };
  }

  /**
   * Attaches level-2 fields to a NOT-YET-PLAYED match, reading only. The rank
   * simulation draws from these remaining-schedule pmfs.
   */
  enrichUpcoming(match: UpcomingMatch, prediction: Prediction): UpcomingLayerRecord {
    const sigmaScoreByTeam = this.sigmaScoreByTeam();
    const red = allianceSigmaBandVariance(match.redTeams, sigmaScoreByTeam);
    const blue = allianceSigmaBandVariance(match.blueTeams, sigmaScoreByTeam);
    const upcomingRp =
      prediction.redRpPmf === undefined ? this.#rpFieldsFor(match, prediction, red, blue) : {};

    return {
      match,
      prediction: { ...prediction, ...upcomingRp },
      ...this.#matchBandFields(match, red, blue),
    };
  }

  /**
   * The RP fields for one match, with each alliance's WIN-ODDS variance (never
   * the display band) as its score variance. Empty when the layer publishes no
   * ranking points, the event type awards none, or either variance is undefined
   * (no honest pmf without it).
   */
  #rpFieldsFor(
    match: { redTeams: readonly string[]; blueTeams: readonly string[]; eventType: number; matchKey: string; compLevel: CompLevel },
    prediction: Prediction,
    redBandVariance: number | undefined,
    blueBandVariance: number | undefined
  ): Partial<Prediction> {
    if (this.#rp === undefined || this.#ruleModule === undefined || this.#rpMeanShift === undefined) return {};
    if (!isRpEligibleEventType(match.eventType)) return {};
    if (redBandVariance === undefined || blueBandVariance === undefined) return {};

    const rp = this.#rp;
    const shift = this.#rpMeanShift;
    const red = rp.momentsFor(match.redTeams, prediction.redScore, redBandVariance);
    const blue = rp.momentsFor(match.blueTeams, prediction.blueScore, blueBandVariance);
    const pmf = analyticRpPmf({
      // The shift applies only to a fully-warm roster; otherwise `apply`
      // returns the very moments object it was given.
      red: shift.apply(red, rosterIsFullyWarm(rp, match.redTeams)),
      blue: shift.apply(blue, rosterIsFullyWarm(rp, match.blueTeams)),
      ruleModule: this.#ruleModule,
      eventType: match.eventType,
      compLevel: match.compLevel,
      tally: this.#rpMarginalResolutionTally,
      // The algorithm's published win probability is the outcome split's decisive share.
      pRedWin: prediction.pRedWin,
    });

    // The five decomposition fields the rank simulation's coupled draw consumes,
    // with the season's winRp/tieRp from the rule module (never hardcoded).
    // Absent as a set when the pmf has no decomposition (non-qualification).
    const decomposition: Partial<Prediction> =
      pmf.outcome !== undefined && pmf.redBonusPmf !== undefined && pmf.blueBonusPmf !== undefined
        ? {
            matchOutcomePmf: [pmf.outcome.pRedWin, pmf.outcome.pTie, pmf.outcome.pBlueWin],
            redOutcomeRp: [pmf.outcome.winRp, pmf.outcome.tieRp, 0],
            blueOutcomeRp: [0, pmf.outcome.tieRp, pmf.outcome.winRp],
            redBonusRpPmf: pmf.redBonusPmf,
            blueBonusRpPmf: pmf.blueBonusPmf,
          }
        : {};

    return {
      redRpPmf: pmf.redPmf,
      blueRpPmf: pmf.bluePmf,
      ...(pmf.redBonusProbabilities !== undefined ? { redBonusRp: pmf.redBonusProbabilities } : {}),
      ...(pmf.blueBonusProbabilities !== undefined ? { blueBonusRp: pmf.blueBonusProbabilities } : {}),
      ...decomposition,
    };
  }

  /** Folds this match's OBSERVED threshold variables into each alliance's teams. */
  #foldObservedThresholds(match: MatchResult): void {
    if (this.#rp === undefined || this.#ruleModule === undefined) return;
    if (!isRpEligibleEventType(match.eventType)) return;
    if (!match.hasScoreBreakdown || match.scoreBreakdownRaw === null) return;

    for (const side of ["red", "blue"] as const) {
      try {
        const parsed = this.#ruleModule.parse(JSON.parse(match.scoreBreakdownRaw), side, match.eventType);
        this.#rp.fold(side === "red" ? match.redTeams : match.blueTeams, parsed.thresholdVariables);
      } catch {
        // An unparseable breakdown contributes nothing rather than aborting the publish.
      }
    }
  }
}
