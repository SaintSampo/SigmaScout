/**
 * The district bake: one unstarted district event's five per-team point
 * distributions, pooled across synthetic qualification schedules and encoded
 * into the wire's own pmf shape.
 *
 * PURITY CONTRACT, in `preSchedule.ts`'s own voice: no corpus read, no R2
 * call, no filesystem access, no wall-clock read and no `process.env`. Every
 * value that varies between runs is passed in or derived from a pure hash, so
 * republishing the same corpus twice produces byte-identical baked pmfs.
 *
 * THIS MODULE HOLDS NO PRICING MATH AND NO POINT FORMULA. It calls the
 * caller's bound `predict` (already bound to the right walk-forward state) and
 * `packages/core/districts/ledgerSimulation.ts`'s `simulateDistrictEvent`, and
 * it owns exactly three things:
 *
 *   1. the pooling of per-team category histograms ACROSS schedules,
 *   2. the encode-round-trim order at the publish boundary, and
 *   3. the all-or-nothing roster decision.
 *
 * Everything else is somebody else's: 10-01 owns the formulas, 10-02 the
 * alliance pricer and the award base rates, 10-03 the schemas, 10-04 the
 * simulation and the event-level encoder, and `preSchedule.ts` the one
 * priced-synthetic-schedule builder both this module and the presim rank
 * sidecar call.
 *
 * NO GRAND TOTAL. `convolveDistrictGrandTotal` is deliberately not imported:
 * a season `point_total` reaches 445 in the corpus while
 * `DistrictPointPmfSchema` caps `p` at 256 entries, and the grand total is a
 * browser-side quantity with no published field at all (10-04 Fact 5). The
 * five values this module produces are all EVENT-level.
 */
import {
  simulateDistrictEvent,
  encodeDistrictPointPmf,
  type DistrictAwardProfile,
  type DistrictLedgerEventInput,
  type DistrictLedgerResult,
} from "../core/districts/ledgerSimulation.js";
import { maxEventPoints, type DistrictTier } from "../core/districts/pointModel.js";
import type { AwardBaseRateSource } from "../core/districts/awardBaseRates.js";
import type { AllianceMemberRating } from "../core/algorithms/simulation/allianceWinProbability.js";
import type { SimTeamBaseline } from "../core/algorithms/simulation/rankSimulation.js";
import type { Prediction, UpcomingMatch } from "../core/algorithms/types.js";
import { MAX_SCHEDULE_TEAMS, MIN_SCHEDULE_TEAMS } from "./generatedSchedules.js";
import { buildPricedSyntheticSchedules } from "./preSchedule.js";
import { DistrictPointPmfSchema, type DistrictPointPmf } from "./pageArtifacts.js";
import { roundPmf } from "./rounding.js";

/** The number of robots a drafted alliance carries — the roster floor `allianceCount` implies. */
const DRAFTED_ALLIANCE_SIZE = 3;

/**
 * How many distinct synthetic qualification schedules one district event is
 * baked over, and how many joint draws each of them contributes.
 *
 * THE TRADE, stated at the constants rather than left implicit. The presim
 * RANK sidecar uses 1,000 schedules by 50 draws because its support is
 * roster-wide: every team's distribution spans every rank, so the number of
 * cells it has to resolve grows with the square of the roster. A district
 * bake's support is four coarse point categories plus their sum — tens of
 * cells per team, not thousands. 4,000 pooled draws put the sampling error on
 * a probability near one half at roughly eight thousandths
 * (`sqrt(0.25 / 4000)`), which is the real resolution of a number the wire
 * stores at `ROUNDING_RULE.pmf`'s five decimals anyway.
 *
 * That figure is MEASURED and recorded, never asserted against a bar:
 * `project_worker_cputime_not_reproducible` and ordinary sampling noise both
 * manufacture flakes out of absolute bars, so `districtBake.test.ts` prints
 * the seed-to-seed spread and asserts only schema validity.
 */
export const DISTRICT_BAKE_SCHEDULE_COUNT = 40;
/** See `DISTRICT_BAKE_SCHEDULE_COUNT`. */
export const DISTRICT_BAKE_DRAWS_PER_SCHEDULE = 100;

/**
 * XORed into each schedule's own shuffle seed to build that schedule's district
 * draw seed, in `LEDGER_STREAM_SALT`'s style.
 *
 * WHY A SALT AT ALL: `preSchedule.ts` derives its shuffle stream from
 * `...|shuffle|{k}` and its baked rank stream from `...|baked|{k}`. Reusing a
 * schedule's shuffle seed directly here would alias the district draw stream
 * onto the shuffle stream, so the draft order and the point draws would share
 * a generator. Changing this salt changes EVERY baked number this module has
 * ever produced.
 */
export const DISTRICT_BAKE_DRAW_SALT = 0x44_15_7c_a7;

/** Every reason a district event is refused a bake, each carrying its own offenders. */
export type DistrictBakeSkipReason =
  | "unrated-teams"
  | "missing-award-profiles"
  | "roster-out-of-generator-range"
  | "roster-too-small-for-alliances"
  | "rp-less-algorithm";

/** One roster team's five baked category distributions for one event. */
export interface DistrictBakeRow {
  /** Zero-based position in the outcome's own `roster`. */
  readonly t: number;
  readonly teamKey: string;
  readonly qual: DistrictPointPmf;
  readonly alliance: DistrictPointPmf;
  readonly elim: DistrictPointPmf;
  readonly award: DistrictPointPmf;
  readonly total: DistrictPointPmf;
}

/** A baked event: the sorted roster that indexes every row, the pooled draw count, and the per-team award-lookup rung. */
export interface DistrictBakeBaked {
  readonly status: "baked";
  readonly eventKey: string;
  /** Ascending and duplicate-free — the index space for every row's `t`. */
  readonly roster: readonly string[];
  /** `scheduleCount * drawsPerSchedule`, the pooled total. */
  readonly draws: number;
  readonly rows: readonly DistrictBakeRow[];
  /** Team key -> which rung of `awardBaseRate`'s fallback hierarchy that team's award cell rests on, so 10-07's drawer can say so. */
  readonly awardSources: ReadonlyMap<string, AwardBaseRateSource>;
}

/** A refused event: the reason and EVERY offender, never the first. */
export interface DistrictBakeSkipped {
  readonly status: "skipped";
  readonly eventKey: string;
  readonly reason: DistrictBakeSkipReason;
  /** A one-line, log-ready explanation naming the offenders. */
  readonly detail: string;
  /** The offending team keys, or `[]` for a reason that has none. */
  readonly offenders: readonly string[];
}

export type DistrictBakeOutcome = DistrictBakeBaked | DistrictBakeSkipped;

/** Raised for an input this module refuses to interpret rather than half-bake. */
export class DistrictBakeError extends Error {
  constructor(message: string) {
    super(`bakeDistrictEvent: ${message}`);
    this.name = "DistrictBakeError";
  }
}

export interface DistrictBakeParams {
  readonly districtKey: string;
  readonly eventKey: string;
  readonly season: number;
  readonly tier: DistrictTier;
  /** TBA `event_type`, carried through to every synthetic `UpcomingMatch` — load-bearing: the RP fold gates pmf production on it. */
  readonly eventType: number;
  /** The real event's TBA week, 0-indexed as the corpus stores it, or `null`. Never defaulted to `0`, which is a real week. */
  readonly week: number | null;
  /** The event's registered roster. Sorted internally; row order in is irrelevant. */
  readonly roster: readonly string[];
  readonly allianceCount: number;
  /** The qualification field size the point formula divides by — the CALLER's decision, see `DistrictLedgerEventInput.fieldSize`. */
  readonly fieldSize: number;
  /** Team key -> the published SPR pair, typed by the PRICER's own input type so no second shape can drift from it. */
  readonly ratings: ReadonlyMap<string, AllianceMemberRating>;
  /** Team key -> 10-02's own two award-lookup keys, typed by 10-04's re-export of them. */
  readonly awardProfiles: ReadonlyMap<string, DistrictAwardProfile>;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  readonly matchesPerTeam: number;
  /** Defaults to `DISTRICT_BAKE_SCHEDULE_COUNT`. */
  readonly scheduleCount?: number;
  /** Defaults to `DISTRICT_BAKE_DRAWS_PER_SCHEDULE`. */
  readonly drawsPerSchedule?: number;
  /** Already bound to the right walk-forward state by the caller; pure, so calling it is side-effect-free. */
  readonly predict: (match: UpcomingMatch) => Prediction;
}

/**
 * Encodes one pooled histogram at the publish boundary.
 *
 * THE ORDER IS ENCODE, ROUND, THEN TRIM, and it is that order on purpose.
 * `roundPmf` RENORMALISES — it pushes the residual onto the largest entry — so
 * trimming exact zeros AFTER it removes only entries that are exactly zero and
 * cannot disturb the sum. Trimming first and rounding second can reintroduce a
 * leading exact zero (an entry rounded down to zero at the low end), which the
 * schema tolerates but which no reader should have to explain.
 *
 * The leading trimmed count folds into the offset, so `p[0]` is always the
 * lowest point value carrying mass.
 */
function encodeAndRound(histogram: ArrayLike<number>, draws: number): DistrictPointPmf {
  const encoded = encodeDistrictPointPmf(histogram, draws);
  const rounded = roundPmf(encoded.p);

  let first = 0;
  while (first < rounded.length - 1 && rounded[first] === 0) first++;
  let last = rounded.length - 1;
  while (last > first && rounded[last] === 0) last--;

  return DistrictPointPmfSchema.parse({ o: encoded.offset + first, p: rounded.slice(first, last + 1) });
}

/** Accumulates `source` into `into`, entry by entry. Lengths are the declared ceilings', so they always agree. */
function accumulate(into: Float64Array, source: ArrayLike<number>, eventKey: string, label: string): void {
  if (source.length !== into.length) {
    throw new DistrictBakeError(
      `event ${eventKey}: the ${label} histogram came back ${source.length} entries long but the declared ceiling allocates ${into.length} — refusing to pool two different supports`
    );
  }
  for (let i = 0; i < into.length; i++) into[i]! += source[i]!;
}

/**
 * Bakes one district event's five per-team point distributions, or returns a
 * typed skip naming every offender.
 *
 * THE ROSTER DECISION IS MADE ONCE, FOR THE WHOLE EVENT, which is
 * `makeRankingPointFiller`'s own stated rule and its own stated reason:
 * schedules shuffle alliances, so deciding per match lets a later unpriceable
 * match throw as corruption and take the whole publish down. A partial result
 * would be worse still — a complete, plausible-looking, WRONG distribution.
 *
 * AN ERROR FROM `simulateDistrictEvent` PROPAGATES UNTOUCHED. It is never
 * caught and downgraded into a `skipped` outcome: the up-front validation makes
 * the simulation's own refusals unreachable through this entry point, so one
 * arriving anyway is corruption, and a caught-and-downgraded simulation error
 * is how a publish silently loses a whole district's predictions.
 */
export function bakeDistrictEvent(params: DistrictBakeParams): DistrictBakeOutcome {
  const { eventKey, season, tier, allianceCount } = params;
  const scheduleCount = params.scheduleCount ?? DISTRICT_BAKE_SCHEDULE_COUNT;
  const drawsPerSchedule = params.drawsPerSchedule ?? DISTRICT_BAKE_DRAWS_PER_SCHEDULE;
  if (!Number.isInteger(scheduleCount) || scheduleCount < 1) {
    throw new DistrictBakeError(`event ${eventKey}: scheduleCount must be a positive integer, got ${String(scheduleCount)}`);
  }
  if (!Number.isInteger(drawsPerSchedule) || drawsPerSchedule < 1) {
    throw new DistrictBakeError(`event ${eventKey}: drawsPerSchedule must be a positive integer, got ${String(drawsPerSchedule)}`);
  }

  const sortedRoster = [...new Set(params.roster)].sort();

  // ---------------------------------------------------------------------
  // The all-or-nothing roster check, every offender named rather than the
  // first. Ordered cheapest-shape-first so a structurally impossible roster
  // never reaches the per-team scan.
  // ---------------------------------------------------------------------
  if (sortedRoster.length < MIN_SCHEDULE_TEAMS || sortedRoster.length > MAX_SCHEDULE_TEAMS) {
    return {
      status: "skipped",
      eventKey,
      reason: "roster-out-of-generator-range",
      detail: `roster has ${sortedRoster.length} team(s), outside the generator's ${MIN_SCHEDULE_TEAMS}..${MAX_SCHEDULE_TEAMS}-team range`,
      offenders: [],
    };
  }
  if (sortedRoster.length < allianceCount * DRAFTED_ALLIANCE_SIZE) {
    return {
      status: "skipped",
      eventKey,
      reason: "roster-too-small-for-alliances",
      detail: `a ${sortedRoster.length}-team roster cannot fill ${allianceCount} ${DRAFTED_ALLIANCE_SIZE}-team alliances`,
      offenders: [],
    };
  }

  const unrated: string[] = [];
  const unprofiled: string[] = [];
  for (const teamKey of sortedRoster) {
    const rating = params.ratings.get(teamKey);
    const total = rating?.total;
    const sigma = rating?.sigma;
    // A ZERO-SPREAD ROSTER IS AN ABSENCE OF INFORMATION ABOUT SPREAD, NOT A
    // CERTAINTY — `UnratedTeamError`'s own rule, reproduced here so the refusal
    // is a typed skip the publisher can log rather than a throw mid-bake.
    if (
      typeof total !== "number" ||
      !Number.isFinite(total) ||
      typeof sigma !== "number" ||
      !Number.isFinite(sigma) ||
      sigma <= 0
    ) {
      unrated.push(teamKey);
    }
    if (!params.awardProfiles.has(teamKey)) unprofiled.push(teamKey);
  }
  if (unrated.length > 0) {
    return {
      status: "skipped",
      eventKey,
      reason: "unrated-teams",
      detail: `${unrated.length} of ${sortedRoster.length} roster team(s) carry an absent, non-finite or non-positive published SPR pair: ${unrated.join(", ")}`,
      offenders: unrated,
    };
  }
  if (unprofiled.length > 0) {
    return {
      status: "skipped",
      eventKey,
      reason: "missing-award-profiles",
      detail: `${unprofiled.length} of ${sortedRoster.length} roster team(s) carry no award profile: ${unprofiled.join(", ")}`,
      offenders: unprofiled,
    };
  }

  // ---------------------------------------------------------------------
  // The one priced-synthetic-schedule builder, shared with the presim rank
  // sidecar. `null` is the ordinary "this algorithm models no ranking points"
  // answer, not an error.
  // ---------------------------------------------------------------------
  const priced = buildPricedSyntheticSchedules({
    eventKey,
    season,
    eventType: params.eventType,
    week: params.week,
    algorithmId: params.algorithmId,
    algorithmVersion: params.algorithmVersion,
    roster: sortedRoster,
    matchesPerTeam: params.matchesPerTeam,
    // A district bake only ever runs for an event nobody has played, so its
    // pricing source is the current walk-forward state — the same value
    // `buildPreScheduleSidecarForEvent` stamps for an event with no completed
    // matches. It is carried on the artifact, not decided here.
    pricedFrom: "current-state",
    scheduleCount,
    drawsPerSchedule,
    // Never read by the schedule builder; present because the params type is
    // shared verbatim rather than restated.
    generation: "",
    computedAt: "",
    predict: params.predict,
  });
  if (priced === null) {
    return {
      status: "skipped",
      eventKey,
      reason: "rp-less-algorithm",
      detail: `algorithm ${params.algorithmId}@${params.algorithmVersion} returned no ranking-point pmf for the first synthetic match`,
      offenders: [],
    };
  }

  // ---------------------------------------------------------------------
  // Pooling. Every accumulator is allocated ONCE, outside the schedule loop,
  // at the length 10-04's result shape declares: `maxEventPoints(season, tier)`
  // per category plus one, and the sum of all four plus one for the event
  // total. No numeric ceiling literal appears anywhere in this module.
  // ---------------------------------------------------------------------
  const ceilings = maxEventPoints(season, tier);
  const totalCeiling = ceilings.qual + ceilings.alliance + ceilings.elim + ceilings.award;
  const alloc = (length: number): Float64Array[] => sortedRoster.map(() => new Float64Array(length));
  const pooled = {
    qual: alloc(ceilings.qual + 1),
    alliance: alloc(ceilings.alliance + 1),
    elim: alloc(ceilings.elim + 1),
    award: alloc(ceilings.award + 1),
    total: alloc(totalCeiling + 1),
  };

  const baselines: SimTeamBaseline[] = sortedRoster.map((teamKey) => ({ teamKey, earnedRpSum: 0, matchesPlayed: 0 }));
  let awardSources: ReadonlyMap<string, AwardBaseRateSource> = new Map();

  for (let k = 0; k < scheduleCount; k++) {
    const input: DistrictLedgerEventInput = {
      eventKey,
      season,
      tier,
      fieldSize: params.fieldSize,
      allianceCount,
      remainingMatches: priced.simInputsBySchedule[k]!,
      baselines,
      ratings: params.ratings,
      awardProfiles: params.awardProfiles,
    };
    // This schedule's own published seed XORed with the district salt: the
    // district draw stream can never alias the shuffle stream or the presim
    // baked rank stream.
    const seed = (priced.schedules[k]!.seed ^ DISTRICT_BAKE_DRAW_SALT) >>> 0;
    const result: DistrictLedgerResult = simulateDistrictEvent(input, drawsPerSchedule, seed);
    if (k === 0) awardSources = result.awardSources;
    for (let t = 0; t < sortedRoster.length; t++) {
      const teamKey = sortedRoster[t]!;
      accumulate(pooled.qual[t]!, result.qualPoints.get(teamKey)!, eventKey, "qual");
      accumulate(pooled.alliance[t]!, result.selectionPoints.get(teamKey)!, eventKey, "alliance");
      accumulate(pooled.elim[t]!, result.elimPoints.get(teamKey)!, eventKey, "elim");
      accumulate(pooled.award[t]!, result.awardPoints.get(teamKey)!, eventKey, "award");
      accumulate(pooled.total[t]!, result.eventTotal.get(teamKey)!, eventKey, "event total");
    }
  }

  const draws = scheduleCount * drawsPerSchedule;
  const rows: DistrictBakeRow[] = sortedRoster.map((teamKey, t) => ({
    t,
    teamKey,
    qual: encodeAndRound(pooled.qual[t]!, draws),
    alliance: encodeAndRound(pooled.alliance[t]!, draws),
    elim: encodeAndRound(pooled.elim[t]!, draws),
    award: encodeAndRound(pooled.award[t]!, draws),
    total: encodeAndRound(pooled.total[t]!, draws),
  }));

  return { status: "baked", eventKey, roster: sortedRoster, draws, rows, awardSources };
}
