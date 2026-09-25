/**
 * THE JOINT DISTRICT LEDGER SIMULATION — one Monte Carlo run over ONE district
 * event that yields a CORRELATED (qualification, alliance selection, playoff,
 * award) quadruple for every team on every draw, plus that draw's event total.
 *
 * THIS MODULE OWNS NO FORMULA. Every number it produces comes from a module
 * that measured it:
 *   - qualification points    -> `districtQualPoints` (`./qualPoints.js`)
 *   - the DCMP weight         -> `districtTierWeight` (`./qualPoints.js`), the
 *                                phase's single weight source
 *   - selection points        -> `districtSelectionPoints` (`./selectionPoints.js`)
 *   - the bracket topology    -> `routeBracket` / `BRACKET_SETS` (`./bracket.js`)
 *   - placement points        -> `playoffPoints` (`./bracket.js`)
 *   - the non-eight fallback  -> `divisionedDcmpPlayoffPmf` (`./bracket.js`)
 *   - award point rates       -> `awardBaseRate` (`./awardBaseRates.js`)
 *   - the award orderings     -> `impactOrderingProbability` /
 *                                `rookieAllStarOrderingProbability` /
 *                                `awardResidualRate` / `orderFieldByDecoration`
 *                                (`./awardOrderingTables.js`)
 *   - the alliance win odds   -> `allianceWinProbability`
 *                                (`../algorithms/simulation/allianceWinProbability.js`)
 *   - the ranking itself      -> `simulateRanks`
 *                                (`../algorithms/simulation/rankSimulation.js`)
 *   - every point ceiling     -> `maxEventPoints` (`./pointModel.js`)
 * What lands HERE is the composition, which is where a plausible-but-wrong
 * number gets made. There is no second bracket, no second pricer, no second
 * weight, no second ceiling table and no numeric literal standing in for any
 * of them.
 *
 * TWO CALLERS, ONE IMPLEMENTATION: a browser Web Worker (10-07, every event in
 * progress and every slider move) and the offline publisher (10-06, the baked
 * pmfs for unstarted events). One implementation is what makes a published
 * baked pmf and a live browser run the same quantity rather than two numbers
 * that happen to look alike.
 *
 * ---------------------------------------------------------------------------
 * WHY ONE JOINT DRAW
 * ---------------------------------------------------------------------------
 *
 * A team's qualification points, alliance-selection points and playoff points
 * are all functions of ONE simulated event's finishing order. They are
 * strongly coupled through it. `simulateRanks`'s returned `rankHistograms` are
 * aggregates and carry NO correlation whatsoever: nothing in them says "this
 * team finished first on the same draw that team finished eighth". Convolving
 * four independently-produced marginals therefore overstates the spread AND
 * puts mass on combinations the sport cannot produce — a team ranked 20th
 * holding a first pick's 16 points. There is no way to reconstruct the
 * correlation after the fact; it has to be produced inside the draw. That is
 * what `simulateRanks`'s `onDraw` hook exists for and what this module does
 * with it. `ledgerSimulation.test.ts`'s correlation proof asserts it PER DRAW,
 * because a comparison of marginals cannot detect a broken join.
 *
 * ---------------------------------------------------------------------------
 * CAPTAINS FOLLOW THE PROGRESSIVE RULE, MEASURED
 * ---------------------------------------------------------------------------
 *
 * Captains are NOT the top eight by qualification ranking. Measured against
 * every 2023-plus eight-alliance district event in `data/corpus.sqlite` while
 * planning 10-04: the captain set equals ranks 1 through 8 at only 3 of 491
 * events, and the worst captain's qualification rank is typically 12 or 13.
 * The reason is the real mechanic — a top seed accepted as a higher alliance's
 * FIRST PICK is removed from the captain pool, and the next-highest unallied
 * seed moves up into the vacated slot.
 *
 * The PROGRESSIVE rule — at alliance n's turn, the captain is the highest-
 * ranked team not yet allied — reproduces the real captain at 3,879 of 3,880
 * slots across 485 usable events, with 484 of 485 events perfect. The single
 * miss is `2026milac` alliance 8, where the rule expected `frc6087` (rank 13)
 * and the real captain was `frc7768` (rank 14) — one decline, one event.
 * `selectionModel.reconciliation.test.ts` is the proof and it scores the naive
 * top-eight rule beside it, so a future "simplify the walk into a slice" edit
 * turns the suite red rather than silently shipping the wrong rule.
 *
 * DECLINES ARE NOT MODELLED. That single miss is the measured size of the
 * resulting error: one captain slot in 3,880.
 *
 * ---------------------------------------------------------------------------
 * THE DRAFT ORDER IS SERPENTINE, AND IT WAS MEASURED
 * ---------------------------------------------------------------------------
 *
 * Round one runs alliance 1 through N; round two runs N back down to 1. The
 * evidence is a gradient, not the game manual: the mean qualification rank of
 * the real SECOND pick falls monotonically from 24.83 at alliance 1 to 20.10
 * at alliance 8 across all 491 events. Alliance 8's second pick is the
 * STRONGER one, which is only possible if alliance 8 picks first in round two.
 * A straight 1-through-N round two would run the gradient the other way.
 *
 * ---------------------------------------------------------------------------
 * EVERY STAGE IS AN INPUT, NOT A BRANCH THAT GUESSES
 * ---------------------------------------------------------------------------
 *
 * Alliances announced, playoffs done and awards posted are each an OPTIONAL
 * input meaning "this stage's outcome is already known; simulate only what is
 * left". There is deliberately NO "quals known" flag: a finished qualification
 * stage is expressed by handing this function zero remaining matches, which
 * `simulateRanks` documents as a valid input in which every team keeps its
 * baseline average and ranks identically in every draw. A fifth flag would be
 * a second way to express one state, and two ways to express one state is how
 * the two drift apart. The near-certain captain floor CONTEXT calls for
 * therefore falls out of the same code path the fully-open case takes.
 *
 * A known stage's work is SKIPPED, not routed and discarded. Routing a bracket
 * whose result is then thrown away would consume the ledger stream and
 * silently change every subsequent draw, so the skip is a correctness
 * requirement rather than an optimisation — which is why the ledger stream's
 * consumed count is stage-dependent BY DESIGN and why the determinism tests
 * pin that count per stage rather than once.
 *
 * A SUPPLIED ALLIANCE SET IS VALIDATED, NOT TRUSTED. See
 * `InvalidAllianceSetError`.
 *
 * THE SLIDER'S REWIND NEEDS NO INPUT OF ITS OWN EITHER. Rewinding is the
 * CALLER handing back played rows as remaining, exactly as
 * `apps/web/src/lib/simulationInputs.ts` already does per event through
 * `findStartIndex` and `isRewindStart`. This module simulates every row it is
 * handed and owns no row-selection rule, mirroring `simulateRanks`'s own
 * stated division of responsibility. 10-07 builds the district assembly the
 * same way rather than inventing a second rewind concept.
 *
 * ---------------------------------------------------------------------------
 * THE NON-EIGHT-ALLIANCE FALLBACK, AND ITS SCOPE
 * ---------------------------------------------------------------------------
 *
 * Every regular district event since 2023 runs the eight-alliance bracket,
 * without exception. The only non-eight 2023-plus district rows are the
 * DIVISIONED DISTRICT CHAMPIONSHIP PARENTS — `micmp` at four alliances and
 * `necmp`/`oncmp`/`txcmp` at two, sixteen events in all. Their own playoff
 * points come from a different table than the eight-alliance one: base 0, 10
 * and 20, values absent from the eight-alliance set. That is exactly why a
 * fabricated bracket for these events would be wrong, and why this module
 * draws their elim points from `divisionedDcmpPlayoffPmf` and never calls
 * `routeBracket` for them. The DRAFT still runs over that many alliances —
 * round one 1 through N, round two N down to 1 — so the fallback pmf is keyed
 * by an alliance number the model actually assigned rather than a guess.
 *
 * The whole module is scoped to 2023 and later: `assertBracketSeason` runs in
 * the up-front validation, so an earlier season is refused rather than having
 * the 2023-plus topology routed over a format it did not use.
 *
 * ---------------------------------------------------------------------------
 * THE TIE CAVEAT — WHERE THIS MODULE CAN HONESTLY DISAGREE WITH A PUBLISHED
 * NUMBER, AND A NAMED HANDOFF TO 10-07
 * ---------------------------------------------------------------------------
 *
 * `simulateRanks`'s comparator breaks a tie on average ranking points by team
 * key, because TBA's own season-specific tiebreakers are discarded at ingest
 * and no data exists in this pipeline to back a real secondary ordering. For a
 * FINISHED event that means the qualification points DERIVED here can differ
 * from the value the team actually earned, for teams tied on average ranking
 * points. 10-07 must print the EARNED grey number for a finished event; this
 * module's output is for OPEN cells only.
 *
 * The second named handoff: 10-07 catches `UnratedTeamError` and renders that
 * event's open cells as unavailable. This module deliberately does not make
 * that decision — see that error's own doc comment.
 *
 * ---------------------------------------------------------------------------
 * BROWSER-SAFE LEAF
 * ---------------------------------------------------------------------------
 *
 * Every runtime import resolves to a sibling under `packages/core/`. No
 * `packages/harness`, no `apps/`, no `node:` built-in and no npm package.
 * Registered as an entry point in `packages/harness/browserSafeSchemas.test.ts`
 * so that is a machine-checked fact rather than a claim in a comment. Nothing
 * here imports `locks.ts`, computes a status or exports a verdict: a Locked
 * verdict stays a guarantee and no simulated number may reach it. That guard
 * is structural — read the import list.
 */
import {
  allianceWinProbability,
  type AllianceMemberRating,
} from "../algorithms/simulation/allianceWinProbability.js";
import {
  drawCategorical,
  mulberry32,
  simulateRanks,
  type SimMatchInput,
  type SimTeamBaseline,
} from "../algorithms/simulation/rankSimulation.js";
import {
  AWARD_POINT_SUPPORT,
  awardBaseRate,
  type AwardBaseRateSource,
  type DecorationBucket,
  type RookieState,
} from "./awardBaseRates.js";
import {
  awardResidualRate,
  hasAwardOrderingTables,
  IMPACT_AWARD_POINTS,
  impactOrderingProbability,
  orderFieldByDecoration,
  ROOKIE_ALL_STAR_AWARD_POINTS,
  rookieAllStarOrderingProbability,
} from "./awardOrderingTables.js";
import { assertBracketSeason, divisionedDcmpPlayoffPmf, playoffPoints, routeBracket } from "./bracket.js";
import { maxEventPoints, type DistrictTier } from "./pointModel.js";
import { districtQualPoints, districtTierWeight } from "./qualPoints.js";
import { districtSelectionPoints } from "./selectionPoints.js";

// ---------------------------------------------------------------------------
// The two random streams
// ---------------------------------------------------------------------------

/**
 * XORed into the caller's seed to build the LEDGER stage generator, which is a
 * second, independent `mulberry32` stream beside the rank simulation's own.
 *
 * THIS IS A REAL DECISION, NOT A DETAIL. `simulateRanks`'s `onDraw` hook runs
 * inside the draw loop; a hook drawing from the RANK stream would advance it
 * and change the rank histograms relative to an unhooked run under the same
 * seed. With two streams, this tab's qualification marginal reproduces the
 * event page's Simulation tab for the same seed EXACTLY, so a disagreement
 * between the two surfaces is a real bug rather than an artifact of two
 * interleaved consumers of one generator. `ledgerSimulation.test.ts`'s
 * non-perturbation pin — exact integer equality against a bare four-argument
 * `simulateRanks` run pushed through `districtQualPoints` — is what enforces
 * it.
 *
 * The two streams must never be interleaved into one. Changing this salt
 * changes every seeded output of this module.
 */
export const LEDGER_STREAM_SALT = 0x5d15_7c17;

// ---------------------------------------------------------------------------
// Input and output shapes
//
// BOTH CROSS A `postMessage` STRUCTURED-CLONE BOUNDARY in 10-07, so every
// field is a structured-cloneable value and NOTHING is a function, a class
// instance or a closure. A callback in the input shape would fail at runtime
// in the one place it matters — inside the Worker — and pass every test on the
// UI thread, which is the worst possible combination.
// ---------------------------------------------------------------------------

/**
 * One team's award-profile selector: the two keys `awardBaseRate` looks a rate
 * up by, plus the raw count `awardOrderingTables` orders a whole field on.
 *
 * `priorJudgedAwards` is OPTIONAL and its absence is meaningful rather than a
 * zero: every artifact published before the field existed carries none, and a
 * team treated as undecorated because its count was missing would be sorted to
 * the BOTTOM of its field and priced at the tail. The rule is therefore
 * all-or-nothing per event — see `awardOrderingApplied`.
 */
export interface DistrictAwardProfile {
  readonly bucket: DecorationBucket;
  readonly rookieState: RookieState;
  /** Judged awards won in seasons strictly before this event's own. Absent means this field cannot be ordered. */
  readonly priorJudgedAwards?: number;
}

/**
 * Which award pricing one run used.
 *
 *   `"posted"`                — the awards are already known, so nothing was
 *                               drawn and no table was consulted at all.
 *   `"applied"`               — the ordering tables priced every team: Impact
 *                               from its position in the field's
 *                               most-decorated ordering, Rookie All Star from
 *                               its position among the rookies, and the rest
 *                               from the residual table.
 *   `"no-table"`              — the season has no ordering table, so the run
 *                               kept the `awardBaseRate` path unchanged.
 *   `"incomplete-profiles"`   — at least one roster team carries no
 *                               `priorJudgedAwards`, so the field cannot be
 *                               ordered and the run kept the base-rate path.
 *
 * THE LAST ONE IS ALL-OR-NOTHING BY DESIGN. A team with no count treated as
 * zero would sort to the BOTTOM of its field and be priced at the tail, which
 * is a confident, plausible-looking, wrong number — the same reason
 * `UnratedTeamError` refuses to price the teams it can and drop the rest. So
 * one missing count takes the WHOLE event back to the base rate, which is
 * exactly the price the artifact was published at before the ordering existed.
 */
export type AwardOrderingDisposition = "posted" | "applied" | "no-table" | "incomplete-profiles";

/**
 * One team's ordering-derived award parameters. A TEST SEAM AND A CONTRACT:
 * exported so `ledgerSimulation.test.ts` can assert that the most decorated
 * team's Impact chance IS the table's position-1 value, exactly, rather than
 * inferring it from a Monte Carlo frequency.
 */
export interface AwardOrderingAssignment {
  readonly teamKey: string;
  /** 1-based position in the whole field's most-decorated ordering. */
  readonly impactPosition: number;
  /** 1-based position among the field's ROOKIES, or 0 for a team that is not one. */
  readonly rookieAllStarPosition: number;
  readonly impactProbability: number;
  /** 0 for a non-rookie — a veteran cannot win Rookie All Star, and no randomness is consumed for it. */
  readonly rookieAllStarProbability: number;
  /** The residual pmf over `AWARD_POINT_SUPPORT` this team's remaining judged awards are drawn from. */
  readonly residualPmf: readonly number[];
  /** Which rung of the residual table's fallback hierarchy this team's pmf came from. */
  readonly residualSource: AwardBaseRateSource;
}

/**
 * Every team's ordering-derived award parameters, or `undefined` when the
 * ordering does not apply to this event at all.
 *
 * `undefined` has exactly two causes and they are both stated in
 * `AwardOrderingDisposition`: no table for the season, or any roster team
 * missing `priorJudgedAwards`. The caller keeps the base-rate path in both
 * cases, and the result reports which one it was.
 *
 * The orderings themselves come from `orderFieldByDecoration`, imported rather
 * than restated, so the field the ledger prices is ordered by the same rule the
 * tables were measured under. A second comparator here would be a second rule.
 */
export function awardOrderingAssignments(
  season: number,
  baselines: readonly SimTeamBaseline[],
  awardProfiles: ReadonlyMap<string, DistrictAwardProfile>
): readonly AwardOrderingAssignment[] | undefined {
  if (!hasAwardOrderingTables(season)) return undefined;

  const entries: { teamKey: string; priorJudgedAwards: number }[] = [];
  for (const baseline of baselines) {
    const profile = awardProfiles.get(baseline.teamKey);
    if (profile?.priorJudgedAwards === undefined) return undefined;
    entries.push({ teamKey: baseline.teamKey, priorJudgedAwards: profile.priorJudgedAwards });
  }

  const positionByTeam = new Map<string, number>();
  orderFieldByDecoration(entries).forEach((teamKey, index) => positionByTeam.set(teamKey, index + 1));

  // The rookie block is ranked on its OWN length. No tail of veterans is
  // invented below it, matching how the table was measured.
  const rookiePositionByTeam = new Map<string, number>();
  orderFieldByDecoration(
    entries.filter((entry) => awardProfiles.get(entry.teamKey)!.rookieState === "rookie")
  ).forEach((teamKey, index) => rookiePositionByTeam.set(teamKey, index + 1));

  return baselines.map((baseline) => {
    const profile = awardProfiles.get(baseline.teamKey)!;
    const impactPosition = positionByTeam.get(baseline.teamKey)!;
    const rookieAllStarPosition = rookiePositionByTeam.get(baseline.teamKey) ?? 0;
    const residual = awardResidualRate(season, profile.bucket, profile.rookieState);
    return {
      teamKey: baseline.teamKey,
      impactPosition,
      rookieAllStarPosition,
      impactProbability: impactOrderingProbability(season, impactPosition).p,
      rookieAllStarProbability:
        rookieAllStarPosition === 0 ? 0 : rookieAllStarOrderingProbability(season, rookieAllStarPosition).p,
      residualPmf: residual.pmf,
      residualSource: residual.source,
    };
  });
}

/**
 * One AWARD-ORDERING draw's composed point value, at BASE scale.
 *
 * Impact and Rookie All Star are drawn INDEPENDENTLY, which allows the pair —
 * a rookie winning Impact is rare but not impossible, and refusing it would be
 * a rule the corpus does not support. The sum can therefore exceed the tier's
 * award ceiling, so the caller clamps; see the draw step for why the clamp is a
 * correctness requirement rather than a tidy-up.
 */
export function composeOrderedAwardPoints(impactWon: boolean, rookieAllStarWon: boolean, residualPoints: number): number {
  return (impactWon ? IMPACT_AWARD_POINTS : 0) + (rookieAllStarWon ? ROOKIE_ALL_STAR_AWARD_POINTS : 0) + residualPoints;
}

/**
 * One alliance as TBA reports it, for the stage where alliances are already
 * announced. `picks` is TBA's own `event_alliances.picks` array: index 0 is
 * the captain, 1 the first pick, 2 the second pick and 3 a backup robot where
 * one exists. A backup robot REPLACES a robot rather than adding one, so the
 * roster the bracket is priced from is the first three picks; the backup still
 * receives the alliance's placement points and its own slot-3 selection value
 * of zero.
 */
export interface SuppliedAlliance {
  readonly allianceNumber: number;
  readonly picks: readonly string[];
}

/** The per-event input to one joint district ledger run. */
export interface DistrictLedgerEventInput {
  readonly eventKey: string;
  readonly season: number;
  readonly tier: DistrictTier;
  /**
   * The OFFICIAL qualification field size the qualification formula divides
   * by — `event_rankings.total_teams`, passed explicitly rather than inferred
   * from `baselines.length`, because an event artifact's team count and TBA's
   * reported field size are two different facts that can legitimately differ
   * (a team that registered and never played appears in one and not the
   * other). The offline publisher (10-06) should pass
   * `event_rankings.total_teams`; the browser (10-07) should pass the event
   * artifact's own reported field size where it has one and its roster size
   * otherwise. Resolving a discrepancy between the two is the CALLER's
   * decision, not this module's — this module only rejects a field size
   * smaller than the roster it was handed, which cannot describe a real
   * ranking.
   */
  readonly fieldSize: number;
  readonly allianceCount: number;
  readonly remainingMatches: readonly SimMatchInput[];
  readonly baselines: readonly SimTeamBaseline[];
  /**
   * Team key -> the published SPR pair the bracket is priced from. The value
   * type is `allianceWinProbability`'s OWN roster-member input type, imported
   * rather than restated, so no second shape can drift from the pricer's.
   */
  readonly ratings: ReadonlyMap<string, AllianceMemberRating>;
  /** Team key -> the award base-rate lookup's two keys. Not required when `knownAwardPoints` is supplied. */
  readonly awardProfiles: ReadonlyMap<string, DistrictAwardProfile>;
  /**
   * STAGE INPUT — alliances announced. Present means the draft is NOT
   * simulated: selection points come from each team's real slot and the
   * bracket is seeded from these rosters. Validated, never trusted.
   */
  readonly knownAlliances?: readonly SuppliedAlliance[];
  /**
   * STAGE INPUT — playoffs done. Present means the bracket is NOT routed at
   * all. Routing and discarding would consume the ledger stream and silently
   * change every subsequent draw, so this skip is a correctness requirement
   * rather than an optimisation. A team absent from the map scores 0.
   */
  readonly knownElimPoints?: ReadonlyMap<string, number>;
  /**
   * STAGE INPUT — awards posted. Present means no award is drawn, no
   * randomness is consumed for awards, and an award PROFILE is not required:
   * a posted award needs no base rate. A team absent from the map scores 0.
   */
  readonly knownAwardPoints?: ReadonlyMap<string, number>;
}

/**
 * The complete output of one joint run.
 *
 * THE INDEXING CONTRACT, stated once and in one place: in EVERY histogram
 * below, **index `i` holds the DRAW COUNT for exactly `i` points**. Offset
 * zero, value equals index, never a probability. This differs by one from the
 * rank convention `continuousQuantile` was written for (there index `i` holds
 * the count for rank `i + 1`), and that difference is handled in exactly ONE
 * place — `pointSummary.ts`'s points-axis wrapper, which delegates to the
 * estimator and subtracts one. Offset zero was chosen over an offset encoding
 * because it removes a whole class of off-by-one, at the cost of a few leading
 * zeros that the publish-boundary encoder trims anyway.
 *
 * Every array's length is `maxEventPoints(season, tier)`'s value for that
 * category plus one; the event total's length is the sum of all four plus one.
 * `Map` and `Int32Array` are both structured-cloneable, so a Web Worker can
 * `postMessage` this as-is.
 */
export interface DistrictLedgerResult {
  readonly eventKey: string;
  readonly draws: number;
  readonly qualPoints: ReadonlyMap<string, Int32Array>;
  readonly selectionPoints: ReadonlyMap<string, Int32Array>;
  readonly elimPoints: ReadonlyMap<string, Int32Array>;
  readonly awardPoints: ReadonlyMap<string, Int32Array>;
  readonly eventTotal: ReadonlyMap<string, Int32Array>;
  /**
   * Team key -> which rung of `awardBaseRate`'s fallback hierarchy that team's
   * lookup landed on, so 10-07's drawer can say whether a cell rests on its
   * own cell, a pooled bucket or the whole season. EMPTY when
   * `knownAwardPoints` was supplied, because no lookup ran.
   */
  readonly awardSources: ReadonlyMap<string, AwardBaseRateSource>;
  /**
   * Which award pricing this run actually used, so a caller never has to infer
   * it from the numbers. See `AwardOrderingDisposition`.
   */
  readonly awardOrdering: AwardOrderingDisposition;
}

/**
 * ONE draw's complete state, handed to the optional observer.
 *
 * A TEST SEAM. It must not be sent across a Worker boundary, it is not part of
 * the structured-cloneable input object, it consumes no randomness and it
 * changes no output. Every array on it is an INTERNAL BUFFER, reused and
 * overwritten on the next draw — an observer that needs to keep one must copy
 * it, exactly as `SimDrawHook`'s own contract states for `order`.
 *
 * Per-team arrays are indexed by position in `baselines`. `alliances`'s entry
 * at index `n - 1` is alliance `n`'s roster in pick-slot order.
 */
export interface DistrictDrawObservation {
  readonly draw: number;
  readonly order: readonly number[];
  readonly alliances: readonly (readonly string[])[];
  readonly qual: readonly number[];
  readonly selection: readonly number[];
  readonly elim: readonly number[];
  readonly award: readonly number[];
  readonly total: readonly number[];
  /** The bracket set identifiers the decider was asked about, in request order. Empty when no bracket was routed. */
  readonly bracketSetIds: readonly string[];
  /** How many values this draw consumed from the LEDGER stream. */
  readonly ledgerDraws: number;
}

/** See `DistrictDrawObservation` — a test seam, never a Worker-crossing value. */
export type DistrictDrawObserver = (observation: DistrictDrawObservation) => void;

// ---------------------------------------------------------------------------
// Typed errors. Every one names EVERY offender, not the first.
// ---------------------------------------------------------------------------

/**
 * Raised before any draw when a roster member's published SPR pair cannot
 * price an alliance: an absent or non-finite `total`, or an absent,
 * non-finite or non-positive `sigma`.
 *
 * A ZERO-SPREAD ROSTER IS AN ABSENCE OF INFORMATION ABOUT SPREAD, NOT A
 * CERTAINTY — the same rule `allianceSigmaBandVariance` states as "better no
 * band than a tight one", and the reason `allianceWinProbability` returns
 * `undefined` for a non-positive combined variance. Requiring a strictly
 * positive sigma here is what makes that `undefined` branch unreachable
 * downstream.
 *
 * THE HANDOFF, stated rather than left to be found: the CALLER (10-07)
 * catches this and renders that event's open cells as unavailable. This module
 * deliberately does not decide that, and deliberately does not price the teams
 * it can and drop the rest — a partial result is a complete,
 * plausible-looking, WRONG distribution, which is the same reason
 * `UnknownTeamKeyError` throws rather than dropping.
 */
export class UnratedTeamError extends Error {
  constructor(message: string) {
    super(`simulateDistrictEvent: ${message}`);
    this.name = "UnratedTeamError";
  }
}

/** Raised before any draw when a roster member has no award profile and no known award points were supplied. */
export class MissingAwardProfileError extends Error {
  constructor(message: string) {
    super(`simulateDistrictEvent: ${message}`);
    this.name = "MissingAwardProfileError";
  }
}

/**
 * Raised when `fieldSize` is not an integer at least as large as the roster.
 * The qualification formula rejects a rank above its field size, and a
 * silently clamped rank would publish a wrong point value.
 */
export class InvalidFieldSizeError extends Error {
  constructor(message: string) {
    super(`simulateDistrictEvent: ${message}`);
    this.name = "InvalidFieldSizeError";
  }
}

/** Raised when the roster cannot fill `allianceCount` three-team alliances. */
export class InsufficientRosterError extends Error {
  constructor(message: string) {
    super(`simulateDistrictEvent: ${message}`);
    this.name = "InsufficientRosterError";
  }
}

/**
 * Raised when a SUPPLIED alliance set is malformed: a team on two alliances,
 * an alliance number outside the range, a duplicate or missing alliance
 * number, an empty pick list, a pick list longer than TBA's own maximum of
 * four, or a pick naming a team absent from the roster.
 *
 * A malformed set that reached the draw loop would produce a complete,
 * plausible-looking, WRONG selection distribution — the same failure
 * `UnknownTeamKeyError` exists to prevent, which is why a supplied set is
 * validated rather than trusted. Every offending alliance and team is named,
 * not the first.
 */
export class InvalidAllianceSetError extends Error {
  constructor(message: string) {
    super(`simulateDistrictEvent: ${message}`);
    this.name = "InvalidAllianceSetError";
  }
}

/**
 * Raised when `allianceWinProbability` returns `undefined` for a pair the
 * up-front validation should have made impossible. Thrown rather than coerced
 * to a coin: a coin flip here is a fabricated number wearing a measured
 * function's name.
 */
export class AlliancePricingError extends Error {
  constructor(message: string) {
    super(`simulateDistrictEvent: ${message}`);
    this.name = "AlliancePricingError";
  }
}

/**
 * Raised before any draw when a KNOWN-STAGE point value cannot be a histogram
 * index for this event: not an integer, below zero, or above that category's
 * own ceiling from `maxEventPoints(season, tier)`.
 *
 * WHY THIS IS FATAL RATHER THAN CLAMPED. Each accumulator is an `Int32Array`
 * sized to the category ceiling plus one, and a TypedArray write outside its
 * range — or at a fractional index — is a SILENT NO-OP. No throw, no
 * `undefined`, no `NaN`: the draw simply vanishes. A single out-of-range value
 * therefore empties that team's whole category histogram, and
 * `pointSummary.chanceOfAnyPoints` then computes `1 - 0/draws` and reports a
 * 100% chance of earning points over a distribution with no mass in it. A
 * clamp would be worse, not better: it would publish a point value the event
 * cannot produce while looking entirely healthy.
 *
 * The values come from TBA's own published `event_points` components, which
 * this module does not control — `awardBaseRates.pointsToSupportIndex` already
 * treats an award value above 15 as possible. The refusal matches the publish
 * boundary's: `encodeDistrictPointPmf` throws `EmptyHistogramError` on the same
 * input, so the offline and live halves of one module agree.
 *
 * THE HANDOFF: `apps/web/src/workers/districtSimulationProtocol.ts` converts
 * any typed throw from this function into a per-event `unavailable` entry, the
 * same path `UnratedTeamError` takes, so that event's cells render as
 * unavailable rather than as a fabricated number. Every offender is named, not
 * the first.
 */
export class InvalidKnownPointsError extends Error {
  constructor(message: string) {
    super(`simulateDistrictEvent: ${message}`);
    this.name = "InvalidKnownPointsError";
  }
}

/** Raised by the grand-total convolution for a non-integer addend, a non-positive denominator, or a combined shift below zero. */
export class NegativeDistrictShiftError extends Error {
  constructor(message: string) {
    super(`convolveDistrictGrandTotal: ${message}`);
    this.name = "NegativeDistrictShiftError";
  }
}

/** Raised by the publish-boundary encoder for an all-zero histogram or a non-positive draw count. */
export class EmptyHistogramError extends Error {
  constructor(message: string) {
    super(`encodeDistrictPointPmf: ${message}`);
    this.name = "EmptyHistogramError";
  }
}

// ---------------------------------------------------------------------------
// The bracket decider's pricing step, exported so its refusal branch is
// directly testable.
// ---------------------------------------------------------------------------

/**
 * Prices one bracket match and turns the probability into a winner with ONE
 * `rng()` draw and nothing else.
 *
 * The FIRST-named alliance is treated as red. The assignment is immaterial to
 * the distribution — `allianceWinProbability`'s exact symmetry is pinned by
 * 10-02's own tests — and is fixed here only so a seed reproduces.
 *
 * Throws `AlliancePricingError` rather than coercing when the measured pricer
 * declines to answer. `simulateDistrictEvent`'s up-front validation makes that
 * branch unreachable through the public entry point; this function is exported
 * so a test can reach it anyway and prove the refusal exists.
 */
export function decideBracketMatch(
  allianceA: number,
  allianceB: number,
  rosterA: readonly AllianceMemberRating[],
  rosterB: readonly AllianceMemberRating[],
  setId: string,
  rng: () => number
): number {
  const pWinsA = allianceWinProbability(rosterA, rosterB);
  if (pWinsA === undefined) {
    throw new AlliancePricingError(
      `set ${setId}: allianceWinProbability declined to price alliance ${allianceA} against alliance ${allianceB} — refusing to coerce an unpriceable pair into a coin flip`
    );
  }
  return rng() < pWinsA ? allianceA : allianceB;
}

// ---------------------------------------------------------------------------
// The joint run
// ---------------------------------------------------------------------------

/** The number of robots a simulated alliance drafts: a captain, a first pick and a second pick. */
const DRAFTED_ALLIANCE_SIZE = 3;
/** TBA's `picks` array never holds more than four entries; index 3 is a backup robot. */
const MAX_PICK_SLOTS = 4;
/** The playoff field this module routes a bracket for. */
const BRACKET_ALLIANCE_COUNT = 8;

/**
 * Validates one known-stage map against the category ceiling its histogram is
 * sized to, naming EVERY offender rather than the first — the same discipline
 * the unrated-team and alliance-set passes follow, so one run tells a caller
 * everything that is wrong. An absent map is a valid input and passes.
 *
 * See `InvalidKnownPointsError` for why an out-of-range value is fatal here
 * rather than clamped or absorbed.
 */
function assertKnownPointsInRange(
  eventKey: string,
  category: "elim" | "award",
  known: ReadonlyMap<string, number> | undefined,
  ceiling: number
): void {
  if (known === undefined) return;
  const offenders: string[] = [];
  for (const [teamKey, value] of known) {
    if (!Number.isInteger(value) || value < 0 || value > ceiling) offenders.push(`${teamKey}=${String(value)}`);
  }
  if (offenders.length > 0) {
    throw new InvalidKnownPointsError(
      `event ${eventKey}: ${String(offenders.length)} known ${category} value(s) are not whole point counts within 0 through ${String(ceiling)}, ` +
        `which is this event's own ${category} ceiling from maxEventPoints — refusing to index a histogram with them: ${offenders.join(", ")}`
    );
  }
}

/**
 * Runs `draws` joint simulations of one district event and returns the five
 * per-team marginal histograms, every one a marginal of the SAME runs.
 *
 * Determinism: `seed` fixes both streams. Two runs at one seed are
 * byte-identical.
 *
 * `observer` is a test seam — see `DistrictDrawObservation`.
 */
export function simulateDistrictEvent(
  input: DistrictLedgerEventInput,
  draws: number,
  seed: number,
  observer?: DistrictDrawObserver
): DistrictLedgerResult {
  const { eventKey, season, tier, fieldSize, allianceCount, baselines, ratings, awardProfiles } = input;

  // -------------------------------------------------------------------------
  // VALIDATE BEFORE THE LOOP, once, the way `simulateRanks` does — O(teams)
  // rather than O(draws x teams), and every offender named rather than the
  // first, so one run tells a caller everything that is wrong.
  // -------------------------------------------------------------------------

  // `maxEventPoints` raises `UnknownDistrictSeasonError` for an unregistered
  // season; it is allowed to propagate untouched rather than wrapped.
  const ceilings = maxEventPoints(season, tier);
  const weight = districtTierWeight(season, tier);
  // The whole module is scoped to the 2023-plus format — see the header.
  assertBracketSeason(season);

  const teamCount = baselines.length;

  if (!Number.isInteger(fieldSize) || fieldSize < teamCount) {
    throw new InvalidFieldSizeError(
      `event ${eventKey}: fieldSize must be an integer at least as large as the ${teamCount}-team roster, got ${fieldSize}`
    );
  }
  if (!Number.isInteger(allianceCount) || allianceCount < 1) {
    throw new InsufficientRosterError(`event ${eventKey}: allianceCount must be a positive integer, got ${allianceCount}`);
  }
  const usesEightAllianceBracket = allianceCount === BRACKET_ALLIANCE_COUNT;
  const elimIsKnown = input.knownElimPoints !== undefined;
  if (!usesEightAllianceBracket && !elimIsKnown) {
    // An alliance count the measured fallback table has no population for
    // raises `UnsupportedAllianceCountError` from `bracket.ts`, HERE, before
    // any draw — never a fabricated bracket and never a smoothed guess.
    for (let allianceNumber = 1; allianceNumber <= allianceCount; allianceNumber++) {
      divisionedDcmpPlayoffPmf(allianceCount, allianceNumber);
    }
  }
  if (teamCount < allianceCount * DRAFTED_ALLIANCE_SIZE) {
    throw new InsufficientRosterError(
      `event ${eventKey}: a ${teamCount}-team roster cannot fill ${allianceCount} ${DRAFTED_ALLIANCE_SIZE}-team alliances`
    );
  }

  // A KNOWN STAGE'S VALUES ARE HISTOGRAM INDICES, so they are validated here
  // and never trusted. Every accumulator below is an `Int32Array` sized to this
  // event's own ceiling, and an out-of-range or fractional write on a TypedArray
  // is a SILENT NO-OP — one third-party value of 20 against a district award
  // ceiling of 15 drops all of that category's mass, after which
  // `pointSummary.chanceOfAnyPoints` reads `1 - 0/draws` and a cell prints a
  // confident 100% over an empty distribution. Refusing matches the publish
  // boundary: `encodeDistrictPointPmf` already throws `EmptyHistogramError` on
  // the same input, and the two halves of this module must not disagree about
  // whether an input is fatal. `districtSimulationProtocol.ts` turns this typed
  // throw into a per-event `unavailable` entry, exactly as it does
  // `UnratedTeamError`, so the cell reads "unavailable" rather than wrong.
  assertKnownPointsInRange(eventKey, "elim", input.knownElimPoints, ceilings.elim);
  assertKnownPointsInRange(eventKey, "award", input.knownAwardPoints, ceilings.award);

  const unrated: string[] = [];
  const roster: AllianceMemberRating[] = [];
  for (const baseline of baselines) {
    const rating = ratings.get(baseline.teamKey);
    const total = rating?.total;
    const sigma = rating?.sigma;
    if (
      typeof total !== "number" ||
      !Number.isFinite(total) ||
      typeof sigma !== "number" ||
      !Number.isFinite(sigma) ||
      sigma <= 0
    ) {
      unrated.push(baseline.teamKey);
      roster.push({ teamKey: baseline.teamKey, total: undefined, sigma: undefined });
      continue;
    }
    roster.push({ teamKey: baseline.teamKey, total, sigma });
  }
  if (unrated.length > 0) {
    throw new UnratedTeamError(
      `event ${eventKey}: ${unrated.length} roster team(s) carry an absent, non-finite or non-positive published SPR pair and cannot be priced: ${unrated.join(", ")}`
    );
  }

  const awardIsKnown = input.knownAwardPoints !== undefined;
  const awardSources = new Map<string, AwardBaseRateSource>();
  const awardPmfByTeam: (readonly number[])[] = [];
  let orderingAssignments: readonly AwardOrderingAssignment[] | undefined;
  let awardOrdering: AwardOrderingDisposition = "posted";
  if (!awardIsKnown) {
    // A POSTED award needs no base rate, which is why this whole block — the
    // lookup and its missing-profile refusal alike — is skipped when the award
    // outcome is already known. That is what genuinely distinguishes the two
    // stages rather than merely short-circuiting one of them.
    const missingProfiles: string[] = [];
    for (const baseline of baselines) {
      const profile = awardProfiles.get(baseline.teamKey);
      if (profile === undefined) {
        missingProfiles.push(baseline.teamKey);
        awardPmfByTeam.push([]);
        continue;
      }
      // Looked up ONCE per team, outside the draw loop. The rung travels back
      // on the result so 10-07's drawer can say which one a cell rests on.
      const rate = awardBaseRate(season, profile.bucket, profile.rookieState);
      awardSources.set(baseline.teamKey, rate.source);
      awardPmfByTeam.push(rate.pmf);
    }
    if (missingProfiles.length > 0) {
      throw new MissingAwardProfileError(
        `event ${eventKey}: ${missingProfiles.length} roster team(s) have no award profile and no known award points were supplied: ${missingProfiles.join(", ")}`
      );
    }

    // THE ORDERING LAYER, resolved ONCE per event outside the draw loop. When it
    // applies it REPLACES the base-rate pmf rather than adding to it: the
    // residual table is the same population with the Impact and Rookie All Star
    // mass carved out, so drawing from both would count those two awards twice.
    orderingAssignments = awardOrderingAssignments(season, baselines, awardProfiles);
    if (orderingAssignments !== undefined) {
      awardOrdering = "applied";
      // The reported rung becomes the RESIDUAL table's, because that is the
      // table this run's points were actually drawn from. Reporting the
      // base-rate rung would name a table the run did not use.
      for (const assignment of orderingAssignments) awardSources.set(assignment.teamKey, assignment.residualSource);
    } else {
      awardOrdering = hasAwardOrderingTables(season) ? "incomplete-profiles" : "no-table";
    }
  }

  const teamIndex = new Map<string, number>(baselines.map((baseline, i) => [baseline.teamKey, i]));
  const suppliedAlliances = validateSuppliedAlliances(input, teamIndex, allianceCount);

  // -------------------------------------------------------------------------
  // Accumulators, buffers and every per-rank/per-team constant: allocated ONCE
  // outside the draw loop and reset in place, following `rankSimulation.ts`'s
  // accumulator discipline. 1,000 draws must stay comfortably inside a Web
  // Worker frame budget, and per-draw allocation is what makes that untrue.
  // -------------------------------------------------------------------------

  const qualLength = ceilings.qual + 1;
  const allianceLength = ceilings.alliance + 1;
  const elimLength = ceilings.elim + 1;
  const awardLength = ceilings.award + 1;
  const totalLength = ceilings.qual + ceilings.alliance + ceilings.elim + ceilings.award + 1;

  const qualHistograms = new Map<string, Int32Array>();
  const selectionHistograms = new Map<string, Int32Array>();
  const elimHistograms = new Map<string, Int32Array>();
  const awardHistograms = new Map<string, Int32Array>();
  const totalHistograms = new Map<string, Int32Array>();
  for (const baseline of baselines) {
    qualHistograms.set(baseline.teamKey, new Int32Array(qualLength));
    selectionHistograms.set(baseline.teamKey, new Int32Array(allianceLength));
    elimHistograms.set(baseline.teamKey, new Int32Array(elimLength));
    awardHistograms.set(baseline.teamKey, new Int32Array(awardLength));
    totalHistograms.set(baseline.teamKey, new Int32Array(totalLength));
  }
  // Histogram references in baseline order, so the draw body indexes rather
  // than hashes a team key five times per team per draw.
  const qualByIndex = baselines.map((b) => qualHistograms.get(b.teamKey)!);
  const selectionByIndex = baselines.map((b) => selectionHistograms.get(b.teamKey)!);
  const elimByIndex = baselines.map((b) => elimHistograms.get(b.teamKey)!);
  const awardByIndex = baselines.map((b) => awardHistograms.get(b.teamKey)!);
  const totalByIndex = baselines.map((b) => totalHistograms.get(b.teamKey)!);

  // Qualification points are a pure function of rank, so the whole rank-to-
  // points table is computed once rather than `teamCount x draws` times.
  const qualPointsByRank = new Array<number>(teamCount);
  for (let rank = 1; rank <= teamCount; rank++) {
    qualPointsByRank[rank - 1] = districtQualPoints(season, tier, rank, fieldSize);
  }

  // Selection points are a pure function of (pick slot, alliance number).
  const selectionPointsBySlotAndAlliance: number[][] = [];
  for (let slot = 0; slot < MAX_PICK_SLOTS; slot++) {
    const row = new Array<number>(allianceCount + 1).fill(0);
    for (let allianceNumber = 1; allianceNumber <= allianceCount; allianceNumber++) {
      row[allianceNumber] = districtSelectionPoints(season, tier, slot, allianceNumber);
    }
    selectionPointsBySlotAndAlliance.push(row);
  }

  // The greedy-by-SPR pick order, computed ONCE: the draft consumes no
  // randomness and the ratings do not change between draws, so the order teams
  // are picked in is fixed. Ties on `total` break by team key, for the same
  // reproducibility reason `compareByAvgRpDesc` breaks its own.
  //
  // GREEDY BY PUBLISHED SPR MEAN is the selection model CONTEXT settles on.
  // `total` is the published SPR mean, never a band or a spread. The model's
  // agreement with real pick order is measured in 10-02 and stated on the
  // methodology page in 10-08.
  const pickOrder = baselines.map((_, i) => i);
  pickOrder.sort((a, b) => {
    const totalA = roster[a]!.total!;
    const totalB = roster[b]!.total!;
    if (totalA !== totalB) return totalB - totalA;
    const keyA = baselines[a]!.teamKey;
    const keyB = baselines[b]!.teamKey;
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  // The measured non-eight fallback's pmfs and point values, resolved once per
  // alliance number. `drawCategorical` takes a bare probability array, so the
  // two halves of each entry are split here rather than inside the draw loop.
  const fallbackProbabilities: number[][] = [];
  const fallbackPointValues: number[][] = [];
  if (!usesEightAllianceBracket && !elimIsKnown) {
    for (let allianceNumber = 1; allianceNumber <= allianceCount; allianceNumber++) {
      const pmf = divisionedDcmpPlayoffPmf(allianceCount, allianceNumber);
      fallbackProbabilities.push(pmf.map((entry) => entry.probability));
      // The table stores BASE point values; the tier weight is applied here,
      // from the phase's single weight source.
      fallbackPointValues.push(pmf.map((entry) => entry.points * weight));
    }
  }

  const allied = new Uint8Array(teamCount);
  const allianceMemberIndices: number[][] = [];
  const allianceRosters: AllianceMemberRating[][] = [];
  const allianceTeamKeys: string[][] = [];
  for (let n = 0; n < allianceCount; n++) {
    allianceMemberIndices.push([]);
    allianceRosters.push([]);
    allianceTeamKeys.push([]);
  }

  const qual = new Array<number>(teamCount).fill(0);
  const selection = new Array<number>(teamCount).fill(0);
  const elim = new Array<number>(teamCount).fill(0);
  const award = new Array<number>(teamCount).fill(0);
  const total = new Array<number>(teamCount).fill(0);
  const bracketSetIds: string[] = [];

  // The two draft cursors and their claim helpers live OUTSIDE the draw loop
  // and are reset in place at the top of each draw, so no closure is allocated
  // per draw. See the draft step for what each cursor means.
  let captainCursor = 0;
  let pickCursor = 0;
  let orderBuffer: readonly number[] = [];
  const claimNextByRank = (): number => {
    while (allied[orderBuffer[captainCursor]!] === 1) captainCursor++;
    const teamI = orderBuffer[captainCursor]!;
    allied[teamI] = 1;
    return teamI;
  };
  const claimNextByTotal = (): number => {
    while (allied[pickOrder[pickCursor]!] === 1) pickCursor++;
    const teamI = pickOrder[pickCursor]!;
    allied[teamI] = 1;
    return teamI;
  };

  // Two streams from one seed — see `LEDGER_STREAM_SALT`.
  const rankRng = mulberry32(seed);
  const rawLedgerRng = mulberry32(seed ^ LEDGER_STREAM_SALT);
  let ledgerDrawCount = 0;
  const ledgerRng = (): number => {
    ledgerDrawCount++;
    return rawLedgerRng();
  };

  let drawIndex = 0;

  simulateRanks(input.remainingMatches, baselines, draws, rankRng, (order) => {
    // THE DRAW BODY. The order below is pinned because it DEFINES the ledger
    // stream: the draft (no randomness), then the bracket, then the awards.
    // Changing it silently changes every seeded output.
    const ledgerDrawsBefore = ledgerDrawCount;
    bracketSetIds.length = 0;

    // 1. The finishing order, read IN PLACE from `simulateRanks`'s own reused
    //    buffer. Nothing is copied: every step below consumes it before this
    //    callback returns, which is exactly the contract `SimDrawHook` states.
    for (let rank = 0; rank < teamCount; rank++) {
      qual[order[rank]!] = qualPointsByRank[rank]!;
    }

    // 2. The draft. DETERMINISTIC given the ranking and the ratings — it
    //    consumes no randomness at all, because declines are not modelled.
    //    A reader will look for a decline draw; there is none, and the
    //    measured size of that omission is one captain slot in 3,880.
    for (let n = 0; n < allianceCount; n++) {
      allianceMemberIndices[n]!.length = 0;
      allianceRosters[n]!.length = 0;
      allianceTeamKeys[n]!.length = 0;
    }
    for (let i = 0; i < teamCount; i++) {
      allied[i] = 0;
      selection[i] = 0;
    }

    if (suppliedAlliances !== undefined) {
      // ALLIANCES ANNOUNCED: the draft does not run. Selection points come
      // from each team's REAL slot, and the bracket is seeded from the
      // supplied rosters rather than from a simulated draft.
      for (const alliance of suppliedAlliances) {
        const n = alliance.allianceNumber - 1;
        alliance.memberIndices.forEach((teamI, slot) => {
          allied[teamI] = 1;
          allianceMemberIndices[n]!.push(teamI);
          selection[teamI] = selectionPointsBySlotAndAlliance[slot]![alliance.allianceNumber]!;
        });
      }
    } else {
      // THE PROGRESSIVE CAPTAIN RULE. `captainCursor` walks the finishing order
      // and never rewinds, which is exactly the rule: at alliance n's turn the
      // captain is the highest-ranked team NOT YET ALLIED, and a team before the
      // cursor is always already allied. A precomputed top-eight captain list is
      // the WRONG rule — measured correct at 3 of 491 events.
      orderBuffer = order;
      captainCursor = 0;
      pickCursor = 0;

      // Round one: alliance 1 through N, captain then first pick.
      for (let allianceNumber = 1; allianceNumber <= allianceCount; allianceNumber++) {
        const n = allianceNumber - 1;
        const captain = claimNextByRank();
        allianceMemberIndices[n]!.push(captain);
        selection[captain] = selectionPointsBySlotAndAlliance[0]![allianceNumber]!;
        const firstPick = claimNextByTotal();
        allianceMemberIndices[n]!.push(firstPick);
        selection[firstPick] = selectionPointsBySlotAndAlliance[1]![allianceNumber]!;
      }
      // Round two: alliance N back down to 1. SERPENTINE, measured — see this
      // file's header for the second-pick rank gradient that proves it.
      for (let allianceNumber = allianceCount; allianceNumber >= 1; allianceNumber--) {
        const n = allianceNumber - 1;
        const secondPick = claimNextByTotal();
        allianceMemberIndices[n]!.push(secondPick);
        selection[secondPick] = selectionPointsBySlotAndAlliance[2]![allianceNumber]!;
      }
    }

    for (let n = 0; n < allianceCount; n++) {
      const members = allianceMemberIndices[n]!;
      const rosterN = allianceRosters[n]!;
      const keysN = allianceTeamKeys[n]!;
      members.forEach((teamI, slot) => {
        // A backup robot REPLACES a robot rather than adding one, so only the
        // first three picks enter the roster the pricer sees. Including a
        // fourth would inflate the alliance mean by a whole robot.
        if (slot < DRAFTED_ALLIANCE_SIZE) rosterN.push(roster[teamI]!);
        keysN.push(baselines[teamI]!.teamKey);
      });
    }

    // 3. The playoffs.
    for (let i = 0; i < teamCount; i++) elim[i] = 0;
    if (input.knownElimPoints !== undefined) {
      // PLAYOFFS DONE: the bracket is NOT routed. Routing and discarding would
      // consume the ledger stream and silently change every later draw.
      const known = input.knownElimPoints;
      for (let i = 0; i < teamCount; i++) elim[i] = known.get(baselines[i]!.teamKey) ?? 0;
    } else if (usesEightAllianceBracket) {
      const routed = routeBracket((allianceA, allianceB, setId) => {
        bracketSetIds.push(setId);
        // The measured pricer is called with the ROSTER ARRAYS rather than a
        // cached mean-and-variance pair. The redundant additions are a few dozen
        // per draw, and reusing the ONE measured pricer is worth more than the
        // arithmetic. The final's matches are independent draws: there is no
        // within-series momentum in this model.
        return decideBracketMatch(
          allianceA,
          allianceB,
          allianceRosters[allianceA - 1]!,
          allianceRosters[allianceB - 1]!,
          setId,
          ledgerRng
        );
      });
      for (let allianceNumber = 1; allianceNumber <= allianceCount; allianceNumber++) {
        const placement = routed.placementByAlliance.get(allianceNumber)!;
        const points = playoffPoints(season, tier, placement);
        for (const teamI of allianceMemberIndices[allianceNumber - 1]!) elim[teamI] = points;
      }
    } else {
      // THE MEASURED NON-EIGHT FALLBACK — the divisioned district championship
      // parent, and never a fabricated bracket. See this file's header.
      for (let allianceNumber = 1; allianceNumber <= allianceCount; allianceNumber++) {
        const n = allianceNumber - 1;
        const index = drawCategorical(fallbackProbabilities[n]!, ledgerRng);
        const points = fallbackPointValues[n]![index]!;
        for (const teamI of allianceMemberIndices[n]!) elim[teamI] = points;
      }
    }

    // 4. The awards, drawn per team in `baselines` order so the stream is
    //    pinned. INDEPENDENT of the on-field outcome: `awardBaseRates.ts`
    //    covers JUDGED awards only (Winner, Finalist and Highest Rookie Seed
    //    are excluded there), which makes independence a defensible modelling
    //    choice rather than a convenience — and a stated limitation for 10-08.
    //
    //    THREE PATHS, and exactly one runs: posted (nothing drawn), the
    //    ORDERING path (Impact and Rookie All Star priced by position in the
    //    field, the rest from the residual table), or the base-rate path. The
    //    ordering path is chosen once before the loop — see
    //    `AwardOrderingDisposition` for when and why.
    if (input.knownAwardPoints !== undefined) {
      // AWARDS POSTED: nothing is drawn and no randomness is consumed.
      const known = input.knownAwardPoints;
      for (let i = 0; i < teamCount; i++) award[i] = known.get(baselines[i]!.teamKey) ?? 0;
    } else if (orderingAssignments !== undefined) {
      // THE ORDERING PATH. Three consumptions per team, in this pinned order:
      // Impact, then Rookie All Star (only for a team that can win it), then the
      // residual. This path consumes MORE of the ledger stream per team than the
      // base-rate path below, so an event that switches between them produces a
      // different seeded output BY DESIGN — the two are different models, not
      // two spellings of one.
      for (let i = 0; i < teamCount; i++) {
        const assignment = orderingAssignments[i]!;
        const impactWon = ledgerRng() < assignment.impactProbability;
        // No randomness for a team whose Rookie All Star chance is structurally
        // zero: a veteran cannot win it, and drawing-then-discarding would make
        // every later draw depend on the roster's rookie count for no reason.
        const rookieAllStarWon =
          assignment.rookieAllStarProbability > 0 ? ledgerRng() < assignment.rookieAllStarProbability : false;
        const residualIndex = drawCategorical(assignment.residualPmf, ledgerRng);
        const composed =
          composeOrderedAwardPoints(impactWon, rookieAllStarWon, AWARD_POINT_SUPPORT[residualIndex]!) * weight;
        // THE CLAMP IS A CORRECTNESS REQUIREMENT, not a tidy-up. Impact and
        // Rookie All Star are drawn independently, so their sum plus a residual
        // can exceed this tier's declared award ceiling (10 plus 8 plus 13 is 31
        // against a district ceiling of 15). An out-of-range write to the
        // Int32Array accumulator below is a SILENT NO-OP that would drop that
        // draw's mass entirely, after which `chanceOfAnyPoints` reads a
        // confident percentage over an incomplete distribution. The ceiling is
        // `maxEventPoints`' own value for this event, never a literal.
        award[i] = composed > ceilings.award ? ceilings.award : composed;
      }
    } else {
      for (let i = 0; i < teamCount; i++) {
        const index = drawCategorical(awardPmfByTeam[i]!, ledgerRng);
        // The top support entry means FIFTEEN OR MORE and is treated as exactly
        // fifteen at the district tier — which is also that tier's own declared
        // award ceiling, so the treatment is exact rather than a truncation.
        award[i] = AWARD_POINT_SUPPORT[index]! * weight;
      }
    }

    // 5. Accumulate. Every histogram is a marginal of THESE runs, and the
    //    per-draw quadruple sums to this draw's event total by construction.
    for (let i = 0; i < teamCount; i++) {
      const sum = qual[i]! + selection[i]! + elim[i]! + award[i]!;
      total[i] = sum;
      qualByIndex[i]![qual[i]!]! += 1;
      selectionByIndex[i]![selection[i]!]! += 1;
      elimByIndex[i]![elim[i]!]! += 1;
      awardByIndex[i]![award[i]!]! += 1;
      totalByIndex[i]![sum]! += 1;
    }

    if (observer !== undefined) {
      observer({
        draw: drawIndex,
        order,
        alliances: allianceTeamKeys,
        qual,
        selection,
        elim,
        award,
        total,
        bracketSetIds,
        ledgerDraws: ledgerDrawCount - ledgerDrawsBefore,
      });
    }
    drawIndex++;
  });

  return {
    eventKey,
    draws,
    qualPoints: qualHistograms,
    selectionPoints: selectionHistograms,
    elimPoints: elimHistograms,
    awardPoints: awardHistograms,
    eventTotal: totalHistograms,
    awardSources,
    awardOrdering,
  };
}

interface ResolvedSuppliedAlliance {
  readonly allianceNumber: number;
  readonly memberIndices: readonly number[];
}

/**
 * Validates a SUPPLIED alliance set rather than trusting it, collecting EVERY
 * problem before throwing so one run tells a caller everything that is wrong.
 * See `InvalidAllianceSetError` for why this exists at all.
 */
function validateSuppliedAlliances(
  input: DistrictLedgerEventInput,
  teamIndex: ReadonlyMap<string, number>,
  allianceCount: number
): readonly ResolvedSuppliedAlliance[] | undefined {
  const supplied = input.knownAlliances;
  if (supplied === undefined) return undefined;

  const problems: string[] = [];
  const seenNumbers = new Set<number>();
  const allianceOfTeam = new Map<string, number>();
  const resolved: ResolvedSuppliedAlliance[] = [];

  for (const alliance of supplied) {
    const n = alliance.allianceNumber;
    if (!Number.isInteger(n) || n < 1 || n > allianceCount) {
      problems.push(`alliance number ${n} is outside 1 through ${allianceCount}`);
      continue;
    }
    if (seenNumbers.has(n)) {
      problems.push(`alliance number ${n} appears more than once`);
      continue;
    }
    seenNumbers.add(n);
    if (alliance.picks.length === 0) {
      problems.push(`alliance ${n} carries an empty pick list`);
      continue;
    }
    if (alliance.picks.length > MAX_PICK_SLOTS) {
      problems.push(`alliance ${n} carries ${alliance.picks.length} picks, above TBA's own maximum of ${MAX_PICK_SLOTS}`);
      continue;
    }
    const memberIndices: number[] = [];
    for (const key of alliance.picks) {
      const index = teamIndex.get(key);
      if (index === undefined) {
        problems.push(`alliance ${n} names team ${key}, which is absent from the roster`);
        continue;
      }
      const priorAlliance = allianceOfTeam.get(key);
      if (priorAlliance !== undefined) {
        problems.push(`team ${key} appears on alliance ${priorAlliance} and alliance ${n}`);
        continue;
      }
      allianceOfTeam.set(key, n);
      memberIndices.push(index);
    }
    resolved.push({ allianceNumber: n, memberIndices });
  }

  for (let n = 1; n <= allianceCount; n++) {
    if (!seenNumbers.has(n)) problems.push(`alliance number ${n} is missing from the supplied set`);
  }

  if (problems.length > 0) {
    throw new InvalidAllianceSetError(
      `event ${input.eventKey}: the supplied alliance set is malformed — ${problems.join("; ")}`
    );
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// The grand total, and the publish-boundary encoder
// ---------------------------------------------------------------------------

/** One event's total-point distribution as an input to the grand-total convolution. */
export interface DistrictEventTotalInput {
  /** Index `i` is the count, or probability, of exactly `i` points — the same offset-zero contract `DistrictLedgerResult` states. */
  readonly counts: ArrayLike<number>;
  /** What `counts` sums to: the draw count for a live histogram, or 1 for a baked pmf. */
  readonly denominator: number;
}

/**
 * The EXACT convolution of a team's event totals plus its rookie bonus and
 * adjustments, returned as a `Float64Array` whose index is again the point
 * value at offset zero.
 *
 * EXACT, AND THE PRECISE SCOPE OF THAT CLAIM. The convolution is exact because
 * a team's events share no matches, so no match's outcome appears in two of
 * the distributions — the sketch README's own reasoning. The half the README
 * does NOT say, and the half a later reader has to be told rather than left to
 * discover: the model holds the team's SPR rating FIXED across its events
 * rather than resampling it, so the events are independent CONDITIONAL on that
 * rating. A team whose true strength is genuinely uncertain has correlated
 * event totals in reality, and this convolution does not carry that
 * correlation. An honest limitation stated here is worth more than an
 * unqualified "exact" a reader has to find the edge of.
 *
 * A team plays 0 TO 4 district events, not two: counting `event_points_raw`
 * array lengths over all 16,345 corpus `district_rankings` rows gives 708 rows
 * at zero events, 1,334 at one, 7,858 at two, 6,200 at three and 245 at four.
 * ZERO EVENTS IS A REAL STATE, not an error — it returns a point mass at the
 * combined shift.
 *
 * THERE IS DELIBERATELY NO PUBLISH-BOUNDARY ENCODER FOR THIS VALUE.
 * `district_rankings.point_total` reaches 445 in the corpus while 10-03's
 * `DistrictPointPmfSchema` caps a pmf at 256 entries, on the stated basis that
 * a dcmp-tier EVENT total spans 0 to 249. The grand total is computed in the
 * browser and is never a published field, so the absence is the mitigation.
 */
export function convolveDistrictGrandTotal(
  eventTotals: readonly DistrictEventTotalInput[],
  rookieBonus: number,
  adjustments: number
): Float64Array {
  if (!Number.isInteger(rookieBonus)) {
    throw new NegativeDistrictShiftError(`rookieBonus must be an integer, got ${rookieBonus}`);
  }
  if (!Number.isInteger(adjustments)) {
    throw new NegativeDistrictShiftError(`adjustments must be an integer, got ${adjustments}`);
  }
  const shift = rookieBonus + adjustments;
  if (shift < 0) {
    // `adjustments` is 0 in every one of the 16,345 corpus `district_rankings`
    // rows — minimum 0, maximum 0, zero negative rows — so a negative shift has
    // never been observed. Clamping one to zero would be a FABRICATED value
    // rather than a fallback, which is why this throws.
    throw new NegativeDistrictShiftError(
      `rookieBonus ${rookieBonus} plus adjustments ${adjustments} gives a combined shift of ${shift}, below zero — refusing to clamp a never-observed negative shift into a fabricated value`
    );
  }

  let current = new Float64Array(1);
  current[0] = 1;
  for (const eventTotal of eventTotals) {
    const { counts, denominator } = eventTotal;
    if (!Number.isFinite(denominator) || denominator <= 0) {
      throw new NegativeDistrictShiftError(`an event total carries a non-positive or non-finite denominator (${denominator})`);
    }
    if (counts.length === 0) {
      throw new NegativeDistrictShiftError("an event total carries an empty distribution");
    }
    const next = new Float64Array(current.length + counts.length - 1);
    for (let i = 0; i < current.length; i++) {
      const left = current[i]!;
      if (left === 0) continue;
      for (let j = 0; j < counts.length; j++) {
        const right = counts[j]!;
        if (right === 0) continue;
        next[i + j]! += left * (right / denominator);
      }
    }
    current = next;
  }

  if (shift === 0) return current;
  const shifted = new Float64Array(current.length + shift);
  shifted.set(current, shift);
  return shifted;
}

/** 10-03's offset encoding: `p[i]` is the probability of exactly `offset + i` points. */
export interface DistrictPointPmfEncoding {
  readonly offset: number;
  readonly p: readonly number[];
}

/**
 * Encodes ONE EVENT-LEVEL histogram into 10-03's offset encoding: leading
 * zeros become the offset, trailing zeros are trimmed off the array, and entry
 * `i` is the probability of exactly `offset + i` points — matching
 * `DistrictPointPmfSchema`'s own contract.
 *
 * THE PRODUCER MUST PASS `p` THROUGH `packages/harness/rounding.ts`'s
 * `roundPmf` at the publish boundary. This module deliberately does not import
 * it: this is a `packages/core` leaf and `rounding.ts` is a `packages/harness`
 * module, and the sum-to-1 tolerance belongs to the schema rather than to a
 * producer. That is exactly the division of responsibility `rankSimulation.ts`
 * states for `isValidPmf` — duplicating a numeric tolerance in two places is
 * how two tolerances drift apart.
 *
 * EVENT LEVEL ONLY. See `convolveDistrictGrandTotal` for why no grand-total
 * encoder exists.
 */
export function encodeDistrictPointPmf(histogram: ArrayLike<number>, draws: number): DistrictPointPmfEncoding {
  if (!Number.isFinite(draws) || draws <= 0) {
    throw new EmptyHistogramError(`draws must be a positive finite number, got ${draws}`);
  }
  let first = -1;
  let last = -1;
  for (let i = 0; i < histogram.length; i++) {
    const value = histogram[i]!;
    if (value === 0) continue;
    if (first === -1) first = i;
    last = i;
  }
  if (first === -1) {
    throw new EmptyHistogramError("the histogram carries no mass at all — refusing to encode an empty distribution");
  }
  const p: number[] = [];
  for (let i = first; i <= last; i++) p.push(histogram[i]! / draws);
  return { offset: first, p };
}
