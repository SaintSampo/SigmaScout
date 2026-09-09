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
import { RpMomentsAccumulator } from "../core/rankingPoints/empiricalMoments.js";
import { rpPmfForMatch } from "../core/rankingPoints/distribution.js";
import { allianceSwingBandVariance, SwingFactorAccumulator } from "./swingFactor.js";

/**
 * Monte Carlo settings for the level-2 RP draw. Explicit here rather than
 * inherited from any algorithm's tuned parameter set — `moments.ts` requires a
 * caller to choose its own. 4000 draws over ~19k qualification matches per
 * season is cheap offline and well inside pmf rounding.
 */
export const RP_MONTE_CARLO = { rpMonteCarloSeed: 0x5163_5f52, rpMonteCarloDraws: 4000 } as const;

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
  readonly #rp: RpMomentsAccumulator | undefined;
  readonly #ruleModule: RpRuleModule | undefined;

  /**
   * `ruleModule` is the season's RP rules, or `undefined` for a season with no
   * registered rules (2021, and any season before the vocabulary starts). A
   * season without rules still gets bands — the two features are independent,
   * and RP simply does not appear.
   */
  constructor(ruleModule: RpRuleModule | undefined) {
    this.#ruleModule = ruleModule;
    this.#rp = ruleModule !== undefined ? new RpMomentsAccumulator(ruleModule) : undefined;
  }

  /** This algorithm's Swing Factors from every match folded so far. Omits any team below two played matches. */
  swingByTeam(): ReadonlyMap<string, number> {
    return this.#swing.swingByTeam();
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
  foldPlayed(match: MatchResult, prediction: Prediction): PredictionRecord {
    const redBandVariance = this.#swing.bandVarianceFor(match.redTeams);
    const blueBandVariance = this.#swing.bandVarianceFor(match.blueTeams);
    this.#swing.fold(match.redTeams, match.redScore, prediction.redScore);
    this.#swing.fold(match.blueTeams, match.blueScore, prediction.blueScore);

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
    const swingByTeam = this.swingByTeam();
    const red = allianceSwingBandVariance(match.redTeams, swingByTeam);
    const blue = allianceSwingBandVariance(match.blueTeams, swingByTeam);
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

    const pmf = rpPmfForMatch({
      red: this.#rp.momentsFor(match.redTeams, prediction.redScore, redBandVariance),
      blue: this.#rp.momentsFor(match.blueTeams, prediction.blueScore, blueBandVariance),
      ruleModule: this.#ruleModule,
      eventType: match.eventType,
      matchKey: match.matchKey,
      compLevel: match.compLevel,
      params: RP_MONTE_CARLO,
    });

    return {
      redRpPmf: pmf.redPmf,
      blueRpPmf: pmf.bluePmf,
      ...(pmf.redBonusProbabilities !== undefined ? { redBonusRp: pmf.redBonusProbabilities } : {}),
      ...(pmf.blueBonusProbabilities !== undefined ? { blueBonusRp: pmf.blueBonusProbabilities } : {}),
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
