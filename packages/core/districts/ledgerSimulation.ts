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
 *   - award point rates       -> `awardBaseRate` (`./awardBaseRates.js`)
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
import { playoffPoints, routeBracket, UnsupportedAllianceCountError } from "./bracket.js";
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

/** One team's award-profile selector: the two keys `awardBaseRate` looks a rate up by. */
export interface DistrictAwardProfile {
  readonly bucket: DecorationBucket;
  readonly rookieState: RookieState;
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
  /** Team key -> the award base-rate lookup's two keys. */
  readonly awardProfiles: ReadonlyMap<string, DistrictAwardProfile>;
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
   * own cell, a pooled bucket or the whole season.
   */
  readonly awardSources: ReadonlyMap<string, AwardBaseRateSource>;
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

/** Raised before any draw when a roster member has no award profile. */
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

  const teamCount = baselines.length;

  if (!Number.isInteger(fieldSize) || fieldSize < teamCount) {
    throw new InvalidFieldSizeError(
      `event ${eventKey}: fieldSize must be an integer at least as large as the ${teamCount}-team roster, got ${fieldSize}`
    );
  }
  if (allianceCount !== BRACKET_ALLIANCE_COUNT) {
    // Every regular district event since 2023 runs the eight-alliance bracket
    // without exception; the only non-eight 2023-plus district rows are the
    // divisioned district championship parents, whose own measured playoff
    // points come from `divisionedDcmpPlayoffPmf` rather than from any
    // bracket. That fallback path is not in this module yet, so an
    // unsupported count is REFUSED here rather than routed through a
    // fabricated bracket.
    throw new UnsupportedAllianceCountError(
      `event ${eventKey}: the district ledger routes the ${BRACKET_ALLIANCE_COUNT}-alliance bracket, got an alliance count of ${allianceCount}`
    );
  }
  if (teamCount < allianceCount * DRAFTED_ALLIANCE_SIZE) {
    throw new InsufficientRosterError(
      `event ${eventKey}: a ${teamCount}-team roster cannot fill ${allianceCount} ${DRAFTED_ALLIANCE_SIZE}-team alliances`
    );
  }

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

  const awardSources = new Map<string, AwardBaseRateSource>();
  const awardPmfByTeam: (readonly number[])[] = [];
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
      `event ${eventKey}: ${missingProfiles.length} roster team(s) have no award profile: ${missingProfiles.join(", ")}`
    );
  }

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

    for (let n = 0; n < allianceCount; n++) {
      const members = allianceMemberIndices[n]!;
      const rosterN = allianceRosters[n]!;
      const keysN = allianceTeamKeys[n]!;
      for (const teamI of members) {
        rosterN.push(roster[teamI]!);
        keysN.push(baselines[teamI]!.teamKey);
      }
    }

    // 3. The playoffs, through 10-01's ONE topology.
    for (let i = 0; i < teamCount; i++) elim[i] = 0;
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

    // 4. The awards, drawn per team in `baselines` order so the stream is
    //    pinned. INDEPENDENT of the on-field outcome: `awardBaseRates.ts`
    //    covers JUDGED awards only (Winner, Finalist and Highest Rookie Seed
    //    are excluded there), which makes independence a defensible modelling
    //    choice rather than a convenience — and a stated limitation for 10-08.
    for (let i = 0; i < teamCount; i++) {
      const index = drawCategorical(awardPmfByTeam[i]!, ledgerRng);
      // The top support entry means FIFTEEN OR MORE and is treated as exactly
      // fifteen at the district tier — which is also that tier's own declared
      // award ceiling, so the treatment is exact rather than a truncation.
      award[i] = AWARD_POINT_SUPPORT[index]! * weight;
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
  };
}
