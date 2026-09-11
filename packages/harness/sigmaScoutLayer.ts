/**
 * THE SIGMASCOUT LAYER — the level-2 features every algorithm gets for free.
 *
 * SigmaScout has two levels, and this module is the whole of the second one:
 *
 *   LEVEL 1  an ALGORITHM (OPR, EPA, BPR) predicts alliance scores. It knows
 *            nothing about anything below.
 *   LEVEL 2  SigmaScout features computed from predicted-vs-actual scores
 *            alone — the Match Band and ranking points. No algorithm models
 *            them, no algorithm may import them, and every algorithm has them
 *            identically. OPR models no uncertainty whatsoever and still gets
 *            a band and a working rank simulation.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A MODULE AND NOT A LOOP BODY
 * ---------------------------------------------------------------------------
 *
 * `publish.ts` has TWO orchestrations that write the same artifacts:
 * `publishSeasons` (the full multi-season path) and `runEventMode` (`--event`,
 * the single-event republish path). Both replay a whole season; both emit
 * event artifacts and presim sidecars.
 *
 * When the band landed on 2026-09-08 and ranking points on 2026-09-09, both
 * went into `publishSeasons`'s loop only. `--event` kept mirroring the *old*
 * orchestration, so running it on an event silently STRIPPED that event's
 * bands and RP until the next full publish — the identical defect shape as the
 * Worker's lossy merge: a second write path that reconstructs rows field by
 * field and therefore drops whatever the primary path learned to emit.
 *
 * This module exists so that cannot happen a third time. The per-match math
 * lives in exactly one place and both orchestrations call it. Adding a level-2
 * field here reaches every write path at once; adding one in a caller's loop
 * is the bug this file was extracted to prevent.
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
import {
  analyticRpPmf,
  emptyMarginalResolutionTally,
  type MarginalResolutionTally,
} from "../core/rankingPoints/analyticPmf.js";
import { allianceSwingBandVariance, SwingFactorAccumulator, type SwingBelief } from "./swingFactor.js";
import { SigmaScoreAccumulator, usesSigmaScore } from "./sigmaScore.js";

/**
 * A scheduled match with its level-2 fields attached. Structurally the
 * `UpcomingPredictionRecord` `publish.ts` exports — declared here rather than
 * imported so this module has no dependency back on the CLI that drives it.
 */
export interface UpcomingLayerRecord {
  readonly match: UpcomingMatch;
  readonly prediction: Prediction;
  readonly swingBand?: { red?: number; blue?: number };
}

/**
 * One algorithm's level-2 state for one season.
 *
 * Construct one per algorithm, drive it with that algorithm's chronological
 * played stream via `foldPlayed`, then read `swingByTeam()` and
 * `rpAccumulator` for the not-yet-played work.
 */
export class SigmaScoutLayer {
  readonly #swing = new SwingFactorAccumulator();
  /**
   * Present ONLY for an algorithm in `SIGMA_SCORE_ALGORITHM_IDS` (BPR today).
   * When present it is the source of this algorithm's per-team consistency
   * figure AND of its match bands; `#swing` is then still folded, but only so
   * the D1 seed's shape stays uniform across algorithms.
   */
  readonly #sigma: SigmaScoreAccumulator | undefined;
  readonly #rp: RpMomentsAccumulator | undefined;
  readonly #ruleModule: RpRuleModule | undefined;
  /**
   * Running resolved-family mix (09-05 Task 3, D-01) across every pmf this
   * layer instance has built. IN-MEMORY ONLY — never put on `Prediction`,
   * never written to any artifact. 09-06 reads it after a run to report
   * what share of the `"negative-binomial"` arm actually resolved to
   * negative binomial rather than silently falling back to Gaussian. D-06
   * A permanent diagnostic of the fallback ladder: it says how often a fit
   * resolved to something other than what its variable declared.
   */
  readonly #rpMarginalResolutionTally: MarginalResolutionTally = emptyMarginalResolutionTally();

  /**
   * `ruleModule` is the season's RP rules, or `undefined` for a season with no
   * registered rules (2021, and any season before the vocabulary starts). A
   * season without rules still gets bands — the two features are independent,
   * and RP simply does not appear.
   *
   * `algorithmId` decides whether this layer produces Sigma Score or Swing
   * Factor. It is OPTIONAL and defaults to Swing so that every pre-existing
   * caller and test keeps its current behaviour without edit — the Sigma path
   * is opt-in by id, never the silent default.
   *
   * There is no third parameter. The RP layer had a temporary selectable
   * config during phase 9; plan 09-06 measured every combination, the
   * pre-committed bar accepted none of them, and the whole surface was
   * deleted with the branches it selected between.
   */
  constructor(ruleModule: RpRuleModule | undefined, algorithmId?: string) {
    this.#ruleModule = ruleModule;
    this.#rp = ruleModule !== undefined ? new RpMomentsAccumulator(ruleModule) : undefined;
    this.#sigma = algorithmId !== undefined && usesSigmaScore(algorithmId) ? new SigmaScoreAccumulator() : undefined;
  }

  /**
   * The resolved-family mix (09-05 Task 3, D-01) accumulated across every
   * `#rpFieldsFor` call this layer instance has made so far. Read-only:
   * reading it never mutates it. Returns a fresh copy each read, so a
   * caller cannot accidentally mutate this layer's own running counts.
   * In-memory only — see this field's own doc comment.
   */
  get rpMarginalResolutionTally(): MarginalResolutionTally {
    return { ...this.#rpMarginalResolutionTally };
  }

  /** True when this layer publishes Sigma Score in place of a Swing Factor. */
  get usesSigma(): boolean {
    return this.#sigma !== undefined;
  }

  /**
   * This algorithm's per-team consistency figure — Sigma Score where enabled,
   * Swing Factor otherwise.
   *
   * The two differ in COVERAGE as well as in value, and callers must not assume
   * the Swing shape: Swing omits any team below two played matches, while Sigma
   * always has a figure (its prior is a legitimate answer before any evidence).
   * So a Sigma layer returns an entry for every team it has ever seen.
   */
  consistencyByTeam(): ReadonlyMap<string, number> {
    if (this.#sigma === undefined) return this.#swing.swingByTeam();
    return this.#sigma.scoreByTeam();
  }

  /** One alliance's band variance from history so far, in whichever metric this layer publishes. */
  #bandVarianceFor(roster: readonly string[]): number | undefined {
    if (this.#sigma === undefined) return this.#swing.bandVarianceFor(roster);
    return this.#sigma.bandVarianceFor(roster);
  }

  /** This algorithm's Swing Factors from every match folded so far. Omits any team below two played matches. */
  swingByTeam(): ReadonlyMap<string, number> {
    return this.#swing.swingByTeam();
  }

  /**
   * Every team's RAW running Swing state, for the D1 seed the live Worker
   * resumes from (shape 10).
   *
   * Distinct from `swingByTeam()` and not interchangeable with it: that
   * returns finished Swing Factors and DROPS any team below two observations,
   * which is right for publishing and wrong for seeding. A team with exactly
   * one observation must carry that observation forward, or its first live
   * match would fold against an empty belief and the live band would diverge
   * from what the offline publisher would have produced.
   */
  swingBeliefs(): ReadonlyMap<string, SwingBelief> {
    return this.#swing.beliefsByTeam();
  }

  /**
   * Every team's RAW running RP state, for the D1 seed the live Worker
   * resumes from (shape 15, plan 09-08).
   *
   * The exact counterpart of `swingBeliefs()` above and distinct from
   * anything the publisher renders, for the same reason: this is raw running
   * state, not a finished figure. Dropping a single-observation team from a
   * seed would make its first live match fold against an empty belief and
   * diverge from what the offline publisher would have produced — silently,
   * because the resulting pmf is still a valid distribution.
   *
   * Empty for a season that registers no RP rules, which is the honest answer
   * rather than an error: the feature is ABSENT for that season, not empty.
   */
  rpVariableBeliefs(): ReadonlyMap<string, RpTeamBeliefs> {
    return this.#rp?.beliefsByTeam() ?? new Map();
  }

  /** The RP beliefs learned so far, or `undefined` for a season with no registered rules. */
  get rpAccumulator(): RpMomentsAccumulator | undefined {
    return this.#rp;
  }

  /** The season's RP rules, or `undefined`. */
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
    this.#swing.foldMatch(match, prediction);
    this.#sigma?.foldMatch(match, prediction);
    // Talent is applied AFTER the fold, on purpose: `talentAfterMatch` is read
    // from the algorithm's state as of AFTER this match, so it is admissible
    // evidence for the team's NEXT match and not for this one. Applying it
    // before the fold would let a match inform its own prior.
    if (talentAfterMatch !== undefined && this.#sigma !== undefined) {
      for (const [teamKey, talent] of talentAfterMatch) this.#sigma.observeTalent(teamKey, talent);
    }

    const derivedRp = this.#rpFieldsFor(match, prediction, redBandVariance, blueBandVariance);
    this.#foldObservedThresholds(match);

    return {
      match,
      // An algorithm that produced its own RP keeps it; ours fills the gap.
      prediction: prediction.redRpPmf !== undefined ? prediction : { ...prediction, ...derivedRp },
      ...(redBandVariance !== undefined || blueBandVariance !== undefined
        ? {
            swingBand: {
              ...(redBandVariance !== undefined ? { red: redBandVariance } : {}),
              ...(blueBandVariance !== undefined ? { blue: blueBandVariance } : {}),
            },
          }
        : {}),
    };
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
    const red = allianceSwingBandVariance(match.redTeams, consistencyByTeam);
    const blue = allianceSwingBandVariance(match.blueTeams, consistencyByTeam);
    const upcomingRp =
      prediction.redRpPmf === undefined ? this.#rpFieldsFor(match, prediction, red, blue) : {};

    return {
      match,
      prediction: { ...prediction, ...upcomingRp },
      ...(red !== undefined || blue !== undefined
        ? { swingBand: { ...(red !== undefined ? { red } : {}), ...(blue !== undefined ? { blue } : {}) } }
        : {}),
    };
  }

  /**
   * The RP fields for one match, given each alliance's band as its score
   * variance. Empty when this season registers no rules, when the event type
   * awards no RP, or when either band is undefined — a band is undefined only
   * when a rostered team has too little play to have a Swing Factor, and an
   * alliance whose score variance is unknown has no honest pmf.
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

    const pmf = analyticRpPmf({
      red: this.#rp.momentsFor(match.redTeams, prediction.redScore, redBandVariance),
      blue: this.#rp.momentsFor(match.blueTeams, prediction.blueScore, blueBandVariance),
      ruleModule: this.#ruleModule,
      eventType: match.eventType,
      compLevel: match.compLevel,
      // D-01 (09-05 Task 3): the layer's own running accumulator, folded
      // into by every call. In-memory only — see rpMarginalResolutionTally's
      // own doc comment.
      tally: this.#rpMarginalResolutionTally,
    });

    // D-15 (plan 09-07): compose the five decomposition fields the rank
    // simulation's coupled draw consumes, from 09-04's exported halves
    // (`pmf.outcome`, `pmf.redBonusPmf`/`pmf.blueBonusPmf`) plus this
    // season's own winRp/tieRp constants — read from `#ruleModule`, never
    // hardcoded (2/1 in 2016-2024, 3/1 in 2025-2026). This function is the
    // ONE place in the pipeline that knows both the decomposition and the
    // season's RP constants, which is why the outcome-RP vectors are
    // composed here rather than in either transport. Gated on `pmf.outcome`
    // actually being present (absent only for the non-qualification
    // short-circuit, which fits no marginal at all) — an algorithm or
    // configuration that produces no decomposition keeps every one of these
    // five keys absent rather than empty.
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
