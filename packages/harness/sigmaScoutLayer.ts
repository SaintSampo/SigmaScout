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
 * All three level-2 features are published for SIGMA algorithms only (SPR
 * today). OPR and EPA get none of the three: no Sigma Score, no Match Band,
 * and no ranking-point odds — they have no per-robot score variance to build
 * RP odds from. Gated by `usesSigmaScore` and `publishesRankingPoints`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A MODULE AND NOT A LOOP BODY
 * ---------------------------------------------------------------------------
 *
 * Level-2 per-match math lives only here, and `publishSeasons` calls it.
 * Adding a level-2 field in a caller's loop instead recreates the
 * drop-a-field defect a second write path once caused.
 *
 * ---------------------------------------------------------------------------
 * PREDICT BEFORE UPDATE
 * ---------------------------------------------------------------------------
 *
 * `foldPlayed` READS this match's band and pmf from history so far and only
 * then folds this match's own result in. A match never informs its own band.
 * That is the project's walk-forward rule generally, and it is load-bearing
 * here specifically: a band answers "how unsure were we when we predicted
 * this", and a later match is not an admissible answer to that question.
 *
 * The caller's obligation is therefore ORDER. Drive this with a chronological
 * match stream and one instance per algorithm, or the guarantee is void.
 */

import type { CompLevel, MatchResult, Prediction, UpcomingMatch } from "../core/algorithms/types.js";
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
 * A scheduled match with its level-2 fields attached. Structurally the
 * `UpcomingPredictionRecord` `publish.ts` exports — declared here rather than
 * imported so this module has no dependency back on the CLI that drives it.
 */
export interface UpcomingLayerRecord {
  readonly match: UpcomingMatch;
  readonly prediction: Prediction;
  /**
   * The PUBLISHED display band: each alliance's `sigmaMatchBandVariance`.
   * Sigma algorithms only — absent for OPR and EPA. Never the win-odds
   * variance the ranking-point pmf reads.
   */
  readonly matchBand?: { red?: number; blue?: number };
}

/**
 * One algorithm's level-2 state for one season.
 *
 * Construct one per algorithm, drive it with that algorithm's chronological
 * played stream via `foldPlayed`, then read `consistencyByTeam()` and
 * `rpAccumulator` for the not-yet-played work.
 */
export class SigmaScoutLayer {
  /**
   * Present ONLY for an algorithm in `SIGMA_SCORE_ALGORITHM_IDS` (SPR today).
   * When present it is the source of this algorithm's per-team consistency
   * figure, its win-odds variance AND its published match band. When absent
   * (OPR, EPA) the layer publishes no consistency figure, no match band and no
   * ranking-point odds.
   */
  readonly #sigma: SigmaScoreAccumulator | undefined;
  readonly #rp: RpMomentsAccumulator | undefined;
  readonly #ruleModule: RpRuleModule | undefined;
  /**
   * Running resolved-family mix across every pmf this layer instance has
   * built. IN-MEMORY ONLY — never put on `Prediction`, never written to any
   * artifact. A permanent diagnostic of the fallback ladder: it says how
   * often a fit resolved to something other than what its variable
   * declared, e.g. how much of a `"negative-binomial"` arm actually
   * resolved to negative binomial rather than silently falling back to
   * Gaussian.
   */
  readonly #rpMarginalResolutionTally: MarginalResolutionTally = emptyMarginalResolutionTally();
  /**
   * The walk-forward mean shift, present ONLY when the measurement arm asks
   * for it AND this layer publishes ranking points. See `measurementArms`.
   */
  readonly #rpMeanShift: RpMeanShiftAccumulator | undefined;

  /**
   * `ruleModule` is the season's RP rules, or `undefined` for a season with no
   * registered rules (2021, and any season before the vocabulary starts). A
   * season without rules still gets bands — the two features are independent,
   * and RP simply does not appear.
   *
   * `algorithmId` decides which level-2 features this layer produces. Sigma
   * Score and the Match Band need `usesSigmaScore`; the RP accumulator is
   * constructed only when `ruleModule` is defined AND
   * `publishesRankingPoints(algorithmId)`. It is OPTIONAL: with no algorithm id
   * the layer has no Sigma, no RP and no band — every feature is opt-in by id,
   * never the silent default.
   *
   * `measurementArms` is MEASUREMENT-ONLY, for quick task 260914-01x's
   * bonus-arm measurement. No publisher passes it, and it is deleted at ship
   * time: whichever arm the bar accepts becomes unconditional, and the rest
   * goes. `rpMeanShift: true` turns on the walk-forward mean shift
   * (`meanShift.ts`). Absent, no accumulator is built and no code path changes.
   */
  constructor(
    ruleModule: RpRuleModule | undefined,
    algorithmId?: string,
    measurementArms?: { readonly rpMeanShift?: boolean }
  ) {
    const rankingPoints = algorithmId !== undefined && publishesRankingPoints(algorithmId);
    this.#ruleModule = rankingPoints ? ruleModule : undefined;
    this.#rp = rankingPoints && ruleModule !== undefined ? new RpMomentsAccumulator(ruleModule) : undefined;
    this.#rpMeanShift =
      measurementArms?.rpMeanShift === true && this.#rp !== undefined && ruleModule !== undefined
        ? new RpMeanShiftAccumulator(ruleModule)
        : undefined;
    this.#sigma = algorithmId !== undefined && usesSigmaScore(algorithmId) ? new SigmaScoreAccumulator() : undefined;
  }

  /**
   * The mean shift's running state, or `undefined` when the knob is off (or
   * the layer publishes no ranking points). A snapshot: mutating it never
   * reaches the layer.
   */
  rpMeanShiftState(): RpMeanShiftState | undefined {
    return this.#rpMeanShift?.toState();
  }

  /**
   * The resolved-family mix accumulated across every `#rpFieldsFor` call
   * this layer instance has made so far. Read-only:
   * reading it never mutates it. Returns a fresh copy each read, so a
   * caller cannot accidentally mutate this layer's own running counts.
   * In-memory only — see this field's own doc comment.
   */
  get rpMarginalResolutionTally(): MarginalResolutionTally {
    return { ...this.#rpMarginalResolutionTally };
  }

  /** True when this layer publishes Sigma Score. */
  get usesSigma(): boolean {
    return this.#sigma !== undefined;
  }

  /**
   * This algorithm's per-team consistency figure — Sigma Score where enabled,
   * an EMPTY map otherwise.
   *
   * Sigma always has a figure (its prior is a legitimate answer before any
   * evidence), so a Sigma layer returns an entry for every team it has ever
   * seen.
   */
  consistencyByTeam(): ReadonlyMap<string, number> {
    if (this.#sigma === undefined) return new Map();
    return this.#sigma.scoreByTeam();
  }

  /**
   * This team's Sigma Score, READ-ONLY — never creates a belief. Delegates
   * to `SigmaScoreAccumulator.sigmaFor`, which goes through `#readBelief`
   * rather than `#mutableBelief` (see that method's own doc comment for the
   * real order-dependence bug a single insert-on-read accessor once caused:
   * two orchestrations that wrote the same artifacts produced different
   * ranking-point pmfs for the same event because merely reading a team
   * created a belief entry, and whichever path read a team first changed
   * what the other could see).
   *
   * Costs ONE team, unlike `consistencyByTeam()` above, which scores EVERY
   * team the layer has ever seen and must NEVER be called once per match.
   *
   * Call this right after `foldPlayed` for a match: the value it returns at
   * that instant is this team's Sigma Score "after this match", the same
   * "after this match" meaning every other metric a metric-history row
   * already publishes.
   *
   * `undefined` for a layer with no Sigma accumulator (an algorithm outside
   * `SIGMA_SCORE_ALGORITHM_IDS`) — the same absent-key convention every
   * other Sigma-only field on this layer uses.
   */
  sigmaFor(teamKey: string): number | undefined {
    return this.#sigma?.sigmaFor(teamKey);
  }

  /**
   * One alliance's WIN-ODDS variance from history so far, from the Sigma
   * accumulator, or `undefined` for a layer without one. This is what
   * `#rpFieldsFor` reads; the published display band is derived from it by
   * `#matchBandFields`.
   */
  #bandVarianceFor(roster: readonly string[]): number | undefined {
    return this.#sigma?.bandVarianceFor(roster);
  }

  /**
   * Every team's RAW running RP state, for the D1 seed the live Worker
   * resumes from (shape 15).
   *
   * Distinct from anything the publisher renders: this is raw running
   * state, not a finished figure. Dropping a single-observation team from a
   * seed would make its first live match fold against an empty belief and
   * diverge from what the offline publisher would have produced — silently,
   * because the resulting pmf is still a valid distribution.
   *
   * Empty for a season that registers no RP rules, or for an algorithm that
   * publishes no ranking points, which is the honest answer rather than an
   * error: the feature is ABSENT there, not empty.
   */
  rpVariableBeliefs(): ReadonlyMap<string, RpTeamBeliefs> {
    return this.#rp?.beliefsByTeam() ?? new Map();
  }

  /**
   * Every team's RAW running Sigma Score state, for the D1 seed the live
   * Worker resumes from (shape 11).
   *
   * The counterpart of `rpVariableBeliefs()` above and distinct from
   * `consistencyByTeam()`, which returns finished Sigma Scores: this is the
   * raw running state a resumed accumulator needs to CONTINUE this
   * publisher's history rather than start a second, shorter one. Seed a
   * Worker without it and every band it computes live is built from one
   * event's matches while the artifacts it serves carry the whole season's —
   * both sides look healthy and only the numbers differ.
   *
   * EMPTY for an algorithm outside `SIGMA_SCORE_ALGORITHM_IDS`, which is the
   * honest answer rather than an error: such an algorithm has no Sigma
   * accumulator at all, so its seed must carry no Sigma key rather than an
   * empty one. `usesSigma` is the gate for a caller that needs to know which
   * case it is in.
   */
  sigmaBeliefs(): ReadonlyMap<string, SigmaBelief> {
    return this.#sigma?.beliefsByTeam() ?? new Map();
  }

  /**
   * The Sigma talent prior's population statistics, or `undefined` for an
   * algorithm that publishes no Sigma Score.
   *
   * THREE NUMBERS, not per team, so this rides the LEAGUE row rather than the
   * team rows `sigmaBeliefs()` feeds — see `withSigmaPopulation`. It is not
   * optional decoration: a resumed accumulator handed beliefs but no
   * population falls back to the flat prior (`MIN_POPULATION_FOR_TALENT_PRIOR`)
   * and computes different numbers from the same beliefs.
   *
   * `undefined` rather than a zeroed triple on purpose, so a caller cannot
   * seed a league row claiming a population that was never folded.
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
   * Attaches this match's level-2 fields, THEN folds the match in.
   *
   * Call once per played match, in chronological order. The returned record is
   * the ONE object both the event-artifact builder and the team-artifact
   * builder should read, which is what makes a match's band byte-identical on
   * an event page and a team page rather than merely intended to be.
   */
  foldPlayed(
    match: MatchResult,
    prediction: Prediction,
    talentAfterMatch?: ReadonlyMap<string, number>
  ): PredictionRecord {
    const redBandVariance = this.#bandVarianceFor(match.redTeams);
    const blueBandVariance = this.#bandVarianceFor(match.blueTeams);
    this.#sigma?.foldMatch(match, prediction);
    // Talent is applied AFTER the fold, on purpose: `talentAfterMatch` is read
    // from the algorithm's state as of AFTER this match, so it is admissible
    // evidence for the team's NEXT match and not for this one. Applying it
    // before the fold would let a match inform its own prior.
    if (talentAfterMatch !== undefined && this.#sigma !== undefined) {
      for (const [teamKey, talent] of talentAfterMatch) this.#sigma.observeTalent(teamKey, talent);
    }

    // Win odds: the UNCORRECTED variance.
    const derivedRp = this.#rpFieldsFor(match, prediction, redBandVariance, blueBandVariance);
    // After this match's RP fields are read, before its thresholds are folded:
    // the residual is taken against the mean this match was priced from.
    if (this.#rp !== undefined) this.#rpMeanShift?.observeMatch(this.#rp, match);
    this.#foldObservedThresholds(match);

    return {
      match,
      // An algorithm that produced its own RP keeps it; ours fills the gap.
      prediction: prediction.redRpPmf !== undefined ? prediction : { ...prediction, ...derivedRp },
      ...this.#matchBandFields(match, redBandVariance, blueBandVariance),
    };
  }

  /**
   * The published display band for one match, derived from the two win-odds
   * variances. Sigma layers only: an OPR or EPA layer returns no `matchBand`
   * key at all, the same absent-key convention the band has always used for
   * "nothing to draw".
   */
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
   * Attaches level-2 fields to a NOT-YET-PLAYED match. Reads only — a match
   * that has not happened has no result to fold.
   *
   * This is the case the rank simulation actually consumes: it simulates the
   * REMAINING schedule, so a pmf on played rows alone would enable the
   * Simulation tab and then give it nothing to draw.
   */
  enrichUpcoming(match: UpcomingMatch, prediction: Prediction): UpcomingLayerRecord {
    const consistencyByTeam = this.consistencyByTeam();
    const red = allianceSigmaBandVariance(match.redTeams, consistencyByTeam);
    const blue = allianceSigmaBandVariance(match.blueTeams, consistencyByTeam);
    const upcomingRp =
      prediction.redRpPmf === undefined ? this.#rpFieldsFor(match, prediction, red, blue) : {};

    return {
      match,
      prediction: { ...prediction, ...upcomingRp },
      ...this.#matchBandFields(match, red, blue),
    };
  }

  /**
   * The RP fields for one match, given each alliance's band as its score
   * variance. The band arguments are the WIN-ODDS variance (the uncorrected
   * sum), never the published display band.
   * Empty when this layer publishes no ranking points (no rules for the
   * season, or an algorithm without a Sigma Score), when the event type awards
   * no RP, or when either band is undefined — an upcoming band is undefined
   * when a rostered team has no Sigma Score yet, and an alliance whose score
   * variance is unknown has no honest pmf.
   */
  #rpFieldsFor(
    match: { redTeams: readonly string[]; blueTeams: readonly string[]; eventType: number; matchKey: string; compLevel: CompLevel },
    prediction: Prediction,
    redBandVariance: number | undefined,
    blueBandVariance: number | undefined
  ): Partial<Prediction> {
    if (this.#rp === undefined || this.#ruleModule === undefined) return {};
    if (!isRpEligibleEventType(match.eventType)) return {};
    if (redBandVariance === undefined || blueBandVariance === undefined) return {};

    const rp = this.#rp;
    const shift = this.#rpMeanShift;
    const red = rp.momentsFor(match.redTeams, prediction.redScore, redBandVariance);
    const blue = rp.momentsFor(match.blueTeams, prediction.blueScore, blueBandVariance);
    const pmf = analyticRpPmf({
      red: shift === undefined ? red : shift.apply(red, rosterIsFullyWarm(rp, match.redTeams)),
      blue: shift === undefined ? blue : shift.apply(blue, rosterIsFullyWarm(rp, match.blueTeams)),
      ruleModule: this.#ruleModule,
      eventType: match.eventType,
      compLevel: match.compLevel,
      // The layer's own running accumulator, folded into by every call.
      // In-memory only — see rpMarginalResolutionTally's own doc comment.
      tally: this.#rpMarginalResolutionTally,
      // The algorithm's own published win probability is the outcome split's
      // decisive share. See `analyticPmf.ts`'s `RpOutcomeInput.pRedWin` doc
      // comment.
      pRedWin: prediction.pRedWin,
    });

    // Composes the five decomposition fields the rank simulation's coupled
    // draw consumes, from the exported halves (`pmf.outcome`,
    // `pmf.redBonusPmf`/`pmf.blueBonusPmf`) plus this season's own
    // winRp/tieRp constants — read from `#ruleModule`, never hardcoded (2/1
    // in 2016-2024, 3/1 in 2025-2026). This function is the ONE place in the
    // pipeline that knows both the decomposition and the season's RP
    // constants, which is why the outcome-RP vectors are composed here
    // rather than in either transport. Gated on `pmf.outcome` actually being
    // present (absent only for the non-qualification short-circuit, which
    // fits no marginal at all) — an algorithm or configuration that produces
    // no decomposition keeps every one of these five keys absent rather than
    // empty.
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
        // A breakdown this season's module cannot parse contributes nothing
        // rather than aborting the publish — the same degrade-to-a-counted-skip
        // discipline `parseBreakdown` uses.
      }
    }
  }
}
