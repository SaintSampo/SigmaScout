/**
 * THE ONE UPCOMING-MATCH PRICER. Everything that prices a not-yet-played match
 * outside the offline publisher calls `priceUpcomingRows` below, so the live
 * Worker cannot drift from `SigmaScoutLayer.enrichUpcoming`.
 *
 * WHY IT IS ITS OWN MODULE (quick task 260923-3w6, narrowed by 260923-3w7).
 * This was the body of `eventStatePricing.ts`'s `priceUpcomingFromState`, which
 * took an `EventStateBlock` — a wire copy of D1 rows — because the BROWSER was
 * the only thing pricing upcoming matches (260915-isq, a 10 ms CPU workaround).
 * The Worker prices them again, and it holds its state IN MEMORY: the
 * accumulators Phase A just folded, never a serialized block. So the loop is
 * parameterized by an in-memory `UpcomingPricingModel`. 260923-3w7 then deleted
 * the browser path and `eventStatePricing.ts` with it, leaving this the only
 * non-publisher pricer there is.
 *
 * THE EQUIVALENCE PROOF MOVED HERE WITH IT. `upcomingPricing.test.ts` is the old
 * `eventStatePricing.parity.test.ts`, every arm re-pointed from the block path to
 * this in-memory one: the full gating matrix, the unseen-team rule, the playoff
 * rows, the RP-ineligible event type, the mean-shift non-vacuity, the rounding
 * check and the demo-key probe all still compare against `buildEventArtifact`
 * and `buildTeamSeasonArtifact`. That comparison is the thing that must never be
 * lost — it is what makes "the tick publishes what the publisher would" a test
 * rather than a claim.
 *
 * WHAT IT SHARES. Every primitive is the shared function: the algorithm's own
 * `predict`, `allianceSigmaBandVariance`, `sigmaMatchBandVariance`,
 * `RpMomentsAccumulator.momentsFor`, `RpMeanShiftAccumulator.apply`,
 * `rosterIsFullyWarm`, `analyticRpPmf`, and the row builders in
 * `publishedRows.ts`.
 *
 * WHAT IT MIRRORS. The level-2 read path below (the alliance band and the RP
 * fields) mirrors `SigmaScoutLayer.enrichUpcoming`, `#matchBandFields` and
 * `#rpFieldsFor` statement for statement. It is not extracted from there
 * because `sigmaScoutLayer.bandGuard.test.ts` pins `#rpFieldsFor`'s guard as
 * source text inside `sigmaScoutLayer.ts`. `upcomingPricing.test.ts` fails on
 * any drift between the two.
 *
 * UNSEEN TEAMS FOLLOW THE OFFLINE RULE: a roster team with no Sigma Score gives
 * its alliance no band, and the match no RP (both variances are needed). NEVER
 * the Worker's own price-from-prior (`SigmaScoreAccumulator.bandVarianceFor`),
 * which is a PLAYED-row quantity — a caller passes `scoreByTeam()`, so the rule
 * is structural here rather than a thing each caller has to remember.
 *
 * WORKER-SAFE: never import `publish.ts`, `rules.ts`, a per-season RP file,
 * `sigmaScoutLayer.ts`, `replay.ts`, a Node built-in or anything under
 * `packages/corpus`. The RP rule module is injected.
 * `upcomingPricing.workerSafe.test.ts` walks this module's import graph and
 * fails on any of them. (The constraint was called BROWSER-safe until quick task
 * 260923-3w7; the browser no longer imports it, the Worker still bundles it, and
 * the forbidden set is identical either way.)
 */
import type { AlgorithmModule, CompLevel, Prediction, UpcomingMatch } from "../core/algorithms/types.js";
import { isRpEligibleEventType, type RpRuleModule } from "../core/rankingPoints/constants.js";
import type { RpMomentsAccumulator } from "../core/rankingPoints/empiricalMoments.js";
import { rosterIsFullyWarm, type RpMeanShiftAccumulator } from "../core/rankingPoints/meanShift.js";
import { analyticRpPmf } from "../core/rankingPoints/analyticPmf.js";
import { allianceSigmaBandVariance, sigmaMatchBandVariance } from "./sigmaScore.js";
import { EventUpcomingMatchSchema, TeamSeasonMatchSchema, type EventUpcomingMatch, type TeamSeasonMatch } from "./pageArtifacts.js";
import { eventUpcomingRow, teamSeasonMatchRow } from "./publishedRows.js";

/**
 * Thrown when the injected RP rule module is for another season:
 * `RpMeanShiftAccumulator.fromState` would silently discard the shift, so a
 * mismatch has to be loud rather than quietly unshifted.
 *
 * Lived in `eventStatePricing.ts` until quick task 260923-3w7 deleted it. Moved
 * rather than dropped, and moved INTO the pricer rather than left at a caller:
 * the browser was the only caller that could get the season wrong (it loaded one
 * season's module at a time), but that is an argument for checking the invariant
 * where it is depended on, not for deleting the check with the caller. It is
 * inert for the live tick, which indexes `RP_RULE_MODULES` by the event's own
 * season.
 */
export class RpRuleModuleSeasonMismatchError extends Error {
  constructor(
    readonly moduleSeason: number,
    readonly season: number
  ) {
    super(`priceUpcomingRows: RP rule module is for season ${moduleSeason}, but the event is season ${season}`);
    this.name = "RpRuleModuleSeasonMismatchError";
  }
}

/** One not-yet-played match, schedule fields only: nothing a pricer could leak an outcome through. */
export interface ScheduledMatchInput {
  readonly matchKey: string;
  readonly compLevel: CompLevel;
  readonly setNumber: number;
  readonly matchNumber: number;
  readonly sortTime?: number;
  readonly redTeams: readonly string[];
  readonly blueTeams: readonly string[];
}

/**
 * Everything a pricer needs about the model's state, as the caller already
 * holds it. Each optional member is "this algorithm publishes none of that":
 * OPR and EPA pass `undefined` for all four level-2 members and get exactly the
 * rows the offline publisher gives them.
 */
export interface UpcomingPricingModel {
  /** The module whose `predict` prices each match, and whose id/version stamp the team rows. */
  readonly algorithm: Pick<AlgorithmModule<any>, "id" | "version" | "predict">;
  /** That algorithm's own state object, as of the instant the caller wants matches priced from. */
  readonly state: unknown;
  /**
   * Sigma Score per team — `SigmaScoreAccumulator.scoreByTeam()`, never
   * `bandVarianceFor`. `undefined` for an algorithm that publishes no Sigma
   * Score; a team absent from the map has no belief and follows the offline
   * unseen-team rule.
   */
  readonly sigmaScores: ReadonlyMap<string, number> | undefined;
  /** The event's season's RP rules, or `undefined` for a season/algorithm without them. */
  readonly ruleModule: RpRuleModule | undefined;
  readonly rp: RpMomentsAccumulator | undefined;
  readonly shift: RpMeanShiftAccumulator | undefined;
}

export interface PriceUpcomingRowsInput {
  readonly model: UpcomingPricingModel;
  readonly eventKey: string;
  readonly season: number;
  /** TBA's `event_type` for the event; it gates RP eligibility. */
  readonly eventType: number;
  readonly upcoming: readonly ScheduledMatchInput[];
}

export interface PriceUpcomingResult {
  /** `EventArtifact.upcoming` rows, in input order. */
  readonly event: EventUpcomingMatch[];
  /** `TeamSeasonArtifact` match rows, in input order; `team[i]` and `event[i]` are built from the same record. */
  readonly team: TeamSeasonMatch[];
}

/**
 * Prices every match in `upcoming` from `model`, returning the rows the offline
 * publisher would publish for the same state. Pure: no I/O, no clock, no
 * mutation of the model (the RP accumulator is read through `momentsFor`, never
 * folded).
 *
 * Throws `RpRuleModuleSeasonMismatchError` for a rule module from another
 * season — see that class for why the check lives here.
 */
export function priceUpcomingRows(input: PriceUpcomingRowsInput): PriceUpcomingResult {
  const { model, eventKey, season, eventType } = input;
  const { algorithm, state, sigmaScores, ruleModule, rp, shift } = model;
  if (ruleModule !== undefined && ruleModule.season !== season) {
    throw new RpRuleModuleSeasonMismatchError(ruleModule.season, season);
  }

  const event: EventUpcomingMatch[] = [];
  const team: TeamSeasonMatch[] = [];
  for (const scheduled of input.upcoming) {
    // No pricing path reads `week` or the surrogates; the parity test's offline arm uses the real values.
    const match: UpcomingMatch = {
      matchKey: scheduled.matchKey,
      eventKey,
      compLevel: scheduled.compLevel,
      setNumber: scheduled.setNumber,
      matchNumber: scheduled.matchNumber,
      redTeams: scheduled.redTeams,
      blueTeams: scheduled.blueTeams,
      redSurrogates: [],
      blueSurrogates: [],
      eventType,
      week: null,
    };
    const prediction = algorithm.predict(state, match);

    // --- MIRROR of SigmaScoutLayer.enrichUpcoming ---
    const redVariance = sigmaScores === undefined ? undefined : allianceSigmaBandVariance(match.redTeams, sigmaScores);
    const blueVariance = sigmaScores === undefined ? undefined : allianceSigmaBandVariance(match.blueTeams, sigmaScores);

    // --- MIRROR of SigmaScoutLayer.#rpFieldsFor ---
    let rpFields: Partial<Prediction> = {};
    if (
      prediction.redRpPmf === undefined &&
      rp !== undefined &&
      ruleModule !== undefined &&
      shift !== undefined &&
      isRpEligibleEventType(match.eventType) &&
      redVariance !== undefined &&
      blueVariance !== undefined
    ) {
      const red = rp.momentsFor(match.redTeams, prediction.redScore, redVariance);
      const blue = rp.momentsFor(match.blueTeams, prediction.blueScore, blueVariance);
      const pmf = analyticRpPmf({
        red: shift.apply(red, rosterIsFullyWarm(rp, match.redTeams)),
        blue: shift.apply(blue, rosterIsFullyWarm(rp, match.blueTeams)),
        ruleModule,
        eventType: match.eventType,
        compLevel: match.compLevel,
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
      rpFields = {
        redRpPmf: pmf.redPmf,
        blueRpPmf: pmf.bluePmf,
        ...(pmf.redBonusProbabilities !== undefined ? { redBonusRp: pmf.redBonusProbabilities } : {}),
        ...(pmf.blueBonusProbabilities !== undefined ? { blueBonusRp: pmf.blueBonusProbabilities } : {}),
        ...decomposition,
      };
    }

    // --- MIRROR of SigmaScoutLayer.#matchBandFields ---
    let matchBand: { red?: number; blue?: number } | undefined;
    if (sigmaScores !== undefined) {
      const red = sigmaMatchBandVariance(match.redTeams.length, redVariance);
      const blue = sigmaMatchBandVariance(match.blueTeams.length, blueVariance);
      if (red !== undefined || blue !== undefined) {
        matchBand = { ...(red !== undefined ? { red } : {}), ...(blue !== undefined ? { blue } : {}) };
      }
    }

    const record = {
      match,
      prediction: { ...prediction, ...rpFields },
      ...(matchBand !== undefined ? { matchBand } : {}),
    };
    event.push(EventUpcomingMatchSchema.parse(eventUpcomingRow(record, scheduled.sortTime)));
    // The corpus has no video for an unplayed match, so none is passed.
    team.push(
      TeamSeasonMatchSchema.parse(
        teamSeasonMatchRow(record, {
          season,
          algorithmId: algorithm.id,
          algorithmVersion: algorithm.version,
          sortTime: scheduled.sortTime,
          video: undefined,
        })
      )
    );
  }
  return { event, team };
}
