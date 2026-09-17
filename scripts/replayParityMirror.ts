/**
 * THE RESUMABLE FOLD MIRROR (quick task 260917-mwu). Measurement scaffolding
 * only: nothing imports this from the app, the Worker or the publisher, and it
 * ships in no artifact.
 *
 * WHY IT EXISTS. `SigmaScoutLayer` has no resume-from-state constructor. It is
 * always cold-started and driven over a whole season's chronological stream;
 * its three accumulators are `#private`, so they cannot be seeded from outside
 * and no subclass can reach them. A one-event replay starting from a pre-event
 * state block therefore cannot use the real layer at all. That is a fact about
 * today's API, not a defect this task fixes — a relay would need such a
 * constructor, and naming that requirement is part of this measurement's output.
 *
 * WHAT IT IS. A statement-for-statement mirror of `SigmaScoutLayer.foldPlayed`,
 * `#matchBandFields`, `#rpFieldsFor` and `#foldObservedThresholds`, plus the
 * resume path `eventStatePricing.ts` and `apps/worker/src/scheduled.ts` already
 * use (`SigmaScoreAccumulator.fromBeliefs`, `RpMomentsAccumulator.fromBeliefs`,
 * `RpMeanShiftAccumulator.fromState`). It re-implements NO math: every
 * primitive below is the shared, shipped function. The same mirroring
 * arrangement `eventStatePricing.ts` already documents for `enrichUpcoming`,
 * for the same reason — `sigmaScoutLayer.bandGuard.test.ts` pins that guard as
 * source text inside `sigmaScoutLayer.ts`, so it cannot be extracted.
 *
 * WHY A MIRROR IS ALLOWED TO CARRY A MEASUREMENT. Because it is gated. Arm M of
 * `measureReplayParity.ts` drives THIS class cold-started over a whole season
 * and requires it to reproduce the publisher's rows exactly, field for field.
 * Until that gate passes, no arm-R number is read. A mirror that silently
 * differed from the real layer would fail arm M loudly rather than masquerade
 * as an architectural finding.
 *
 * ONE DELIBERATE SHAPE DIFFERENCE, and why it is not a difference in behaviour:
 * `SigmaScoutLayer.foldPlayed` takes `talentAfterMatch` as an argument and
 * applies it inside, between the Sigma fold and the RP read. Here `foldPlayed`
 * takes no talent and the caller calls `observeTalent` immediately after. The
 * two are equivalent because nothing between those two points reads Sigma:
 * `#rpFieldsFor` uses the band variances captured BEFORE the fold, and
 * `observeMatch`/`#foldObservedThresholds` touch only the RP accumulators. The
 * split exists because a one-event replay does not have the post-update metrics
 * until after `spr.update`, and arm M uses the identical split so the gate
 * covers exactly the path arm R runs.
 *
 * BROWSER-SAFE: imports only `packages/core/*` and the browser-safe
 * `packages/harness/{sigmaScore,stateSnapshot}.ts`. Never `publish.ts`,
 * `replay.ts`, `sigmaScoutLayer.ts` or anything under `packages/corpus` — the
 * cross-engine harness bundles this file for a real browser page.
 */
import type { CompLevel, MatchResult, Prediction } from "../packages/core/algorithms/types.js";
import type { RpRuleModule } from "../packages/core/rankingPoints/constants.js";
import { isRpEligibleEventType } from "../packages/core/rankingPoints/constants.js";
import { RpMomentsAccumulator } from "../packages/core/rankingPoints/empiricalMoments.js";
import { RpMeanShiftAccumulator, rosterIsFullyWarm } from "../packages/core/rankingPoints/meanShift.js";
import {
  analyticRpPmf,
  emptyMarginalResolutionTally,
  type MarginalResolutionTally,
} from "../packages/core/rankingPoints/analyticPmf.js";
import {
  publishesRankingPoints,
  SigmaScoreAccumulator,
  sigmaMatchBandVariance,
  usesSigmaScore,
} from "../packages/harness/sigmaScore.js";
import {
  deserializeState,
  readRpBeliefs,
  readRpMeanShift,
  readSigmaBeliefs,
  readSigmaPopulation,
  type StateRow,
} from "../packages/harness/stateSnapshot.js";
import { spr, type SprState } from "../packages/core/algorithms/spr.js";

/** The distinctive marker the cross-engine bundle asserts, so a tree-shaken bundle fails loudly instead of measuring nothing. */
export const MIRROR_FOLD_MARKER = "replay-parity-mirror-fold-260917-mwu";

/** `foldPlayed`'s return: the published record, plus the unrounded intermediates the cross-engine digest hashes. */
export interface FoldOutput {
  readonly record: { match: MatchResult; prediction: Prediction; matchBand?: { red?: number; blue?: number } };
  /** The two WIN-ODDS variances read before the fold — never the display band. */
  readonly redWinOddsVariance: number | undefined;
  readonly blueWinOddsVariance: number | undefined;
}

export class MirrorFold {
  readonly #sigma: SigmaScoreAccumulator | undefined;
  readonly #rp: RpMomentsAccumulator | undefined;
  readonly #ruleModule: RpRuleModule | undefined;
  readonly #tally: MarginalResolutionTally = emptyMarginalResolutionTally();
  readonly #rpMeanShift: RpMeanShiftAccumulator | undefined;

  /** Cold start, matching `new SigmaScoutLayer(ruleModule, algorithmId)` exactly. */
  constructor(ruleModule: RpRuleModule | undefined, algorithmId?: string) {
    const rankingPoints = algorithmId !== undefined && publishesRankingPoints(algorithmId);
    this.#ruleModule = rankingPoints ? ruleModule : undefined;
    this.#rp = rankingPoints && ruleModule !== undefined ? new RpMomentsAccumulator(ruleModule) : undefined;
    this.#rpMeanShift = rankingPoints && ruleModule !== undefined ? new RpMeanShiftAccumulator(ruleModule) : undefined;
    this.#sigma = algorithmId !== undefined && usesSigmaScore(algorithmId) ? new SigmaScoreAccumulator() : undefined;
  }

  /**
   * The resume path, exactly as `eventStatePricing.ts` and the live Worker
   * resume: every accumulator from the SAME rows, never a fresh one. A resume
   * that dropped the population or the mean shift would silently compute
   * different numbers from the same beliefs.
   */
  static fromRows(ruleModule: RpRuleModule | undefined, algorithmId: string, rows: readonly StateRow[]): MirrorFold {
    const mirror = new MirrorFold(ruleModule, algorithmId);
    if (usesSigmaScore(algorithmId)) {
      mirror.#resumeSigma(SigmaScoreAccumulator.fromBeliefs(readSigmaBeliefs(rows), readSigmaPopulation(rows)));
    }
    if (publishesRankingPoints(algorithmId) && ruleModule !== undefined) {
      mirror.#resumeRp(
        RpMomentsAccumulator.fromBeliefs(ruleModule, readRpBeliefs(rows)),
        RpMeanShiftAccumulator.fromState(ruleModule, readRpMeanShift(rows))
      );
    }
    return mirror;
  }

  // The three accumulators are readonly fields so a caller cannot swap one
  // mid-stream; `fromRows` reaches them through these two private seams, which
  // exist only for it.
  #resumedSigma: SigmaScoreAccumulator | undefined;
  #resumedRp: RpMomentsAccumulator | undefined;
  #resumedShift: RpMeanShiftAccumulator | undefined;

  #resumeSigma(accumulator: SigmaScoreAccumulator): void {
    this.#resumedSigma = accumulator;
  }

  #resumeRp(rp: RpMomentsAccumulator, shift: RpMeanShiftAccumulator): void {
    this.#resumedRp = rp;
    this.#resumedShift = shift;
  }

  get #sigmaLive(): SigmaScoreAccumulator | undefined {
    return this.#resumedSigma ?? this.#sigma;
  }

  get #rpLive(): RpMomentsAccumulator | undefined {
    return this.#resumedRp ?? this.#rp;
  }

  get #shiftLive(): RpMeanShiftAccumulator | undefined {
    return this.#resumedShift ?? this.#rpMeanShift;
  }

  /** `deserializeState` for SPR, kept here so the browser bundle reaches it through one entry point. */
  deserializedState(rows: readonly StateRow[]): SprState {
    return deserializeState(spr.id, rows) as SprState;
  }

  /** One team's Sigma Score, read-only. Mirrors `SigmaScoutLayer.sigmaFor`. */
  sigmaFor(teamKey: string): number | undefined {
    return this.#sigmaLive?.sigmaFor(teamKey);
  }

  /** The talent prior, applied after the fold — see this file's header for why the split is behaviour-preserving. */
  observeTalent(talentAfterMatch: ReadonlyMap<string, number> | undefined): void {
    const sigma = this.#sigmaLive;
    if (talentAfterMatch === undefined || sigma === undefined) return;
    for (const [teamKey, talent] of talentAfterMatch) sigma.observeTalent(teamKey, talent);
  }

  /** MIRROR of `SigmaScoutLayer.foldPlayed`: attaches this match's level-2 fields, THEN folds the match in. */
  foldPlayed(match: MatchResult, prediction: Prediction): FoldOutput {
    const sigma = this.#sigmaLive;
    const redBandVariance = sigma?.bandVarianceFor(match.redTeams);
    const blueBandVariance = sigma?.bandVarianceFor(match.blueTeams);
    sigma?.foldMatch(match, prediction);

    // Win odds: the UNCORRECTED variance.
    const derivedRp = this.#rpFieldsFor(match, prediction, redBandVariance, blueBandVariance);
    // After this match's RP fields are read, before its thresholds are folded.
    const rp = this.#rpLive;
    if (rp !== undefined) this.#shiftLive?.observeMatch(rp, match);
    this.#foldObservedThresholds(match);

    return {
      record: {
        match,
        prediction: prediction.redRpPmf !== undefined ? prediction : { ...prediction, ...derivedRp },
        ...this.#matchBandFields(match, redBandVariance, blueBandVariance),
      },
      redWinOddsVariance: redBandVariance,
      blueWinOddsVariance: blueBandVariance,
    };
  }

  /** MIRROR of `SigmaScoutLayer.#matchBandFields`. */
  #matchBandFields(
    match: { redTeams: readonly string[]; blueTeams: readonly string[] },
    redWinOddsVariance: number | undefined,
    blueWinOddsVariance: number | undefined
  ): { matchBand?: { red?: number; blue?: number } } {
    if (this.#sigmaLive === undefined) return {};
    const red = sigmaMatchBandVariance(match.redTeams.length, redWinOddsVariance);
    const blue = sigmaMatchBandVariance(match.blueTeams.length, blueWinOddsVariance);
    if (red === undefined && blue === undefined) return {};
    return { matchBand: { ...(red !== undefined ? { red } : {}), ...(blue !== undefined ? { blue } : {}) } };
  }

  /** MIRROR of `SigmaScoutLayer.#rpFieldsFor`. */
  #rpFieldsFor(
    match: { redTeams: readonly string[]; blueTeams: readonly string[]; eventType: number; matchKey: string; compLevel: CompLevel },
    prediction: Prediction,
    redBandVariance: number | undefined,
    blueBandVariance: number | undefined
  ): Partial<Prediction> {
    const rp = this.#rpLive;
    const shift = this.#shiftLive;
    if (rp === undefined || this.#ruleModule === undefined || shift === undefined) return {};
    if (!isRpEligibleEventType(match.eventType)) return {};
    if (redBandVariance === undefined || blueBandVariance === undefined) return {};

    const red = rp.momentsFor(match.redTeams, prediction.redScore, redBandVariance);
    const blue = rp.momentsFor(match.blueTeams, prediction.blueScore, blueBandVariance);
    const pmf = analyticRpPmf({
      red: shift.apply(red, rosterIsFullyWarm(rp, match.redTeams)),
      blue: shift.apply(blue, rosterIsFullyWarm(rp, match.blueTeams)),
      ruleModule: this.#ruleModule,
      eventType: match.eventType,
      compLevel: match.compLevel,
      tally: this.#tally,
      pRedWin: prediction.pRedWin,
    });

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

  /** MIRROR of `SigmaScoutLayer.#foldObservedThresholds`. */
  #foldObservedThresholds(match: MatchResult): void {
    const rp = this.#rpLive;
    if (rp === undefined || this.#ruleModule === undefined) return;
    if (!isRpEligibleEventType(match.eventType)) return;
    if (!match.hasScoreBreakdown || match.scoreBreakdownRaw === null) return;

    for (const side of ["red", "blue"] as const) {
      try {
        const parsed = this.#ruleModule.parse(JSON.parse(match.scoreBreakdownRaw), side, match.eventType);
        rp.fold(side === "red" ? match.redTeams : match.blueTeams, parsed.thresholdVariables);
      } catch {
        // An unparseable breakdown contributes nothing rather than aborting.
      }
    }
  }
}
