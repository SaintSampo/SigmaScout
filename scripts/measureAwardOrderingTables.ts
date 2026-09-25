/**
 * Measures the IMPACT AND ROOKIE ALL STAR ORDERING TABLES that
 * `packages/core/districts/awardOrderingTables.ts` ships, together with the
 * RESIDUAL award-point table those two probabilities are layered on.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE TABLES ARE FOR
 * ---------------------------------------------------------------------------
 *
 * Quick tasks `260912-5n8` and `260912-l8t` measured that the best available
 * predictor of Impact is the SORT "most decorated team present" and of Rookie
 * All Star the SORT "most decorated rookie present", both beating a fitted
 * conditional logit. Their stated limitation was that a sort EMITS NO
 * PROBABILITY. This script turns the sort's POSITION into the lookup key and
 * the measured win rate at that position into the probability, so the ledger's
 * award cell can price the most decorated team in a field from what the corpus
 * says about that position rather than from its decoration bucket's average.
 *
 * ---------------------------------------------------------------------------
 * THE DECOMPOSITION IS MEASURED, NOT SUBTRACTED
 * ---------------------------------------------------------------------------
 *
 *     award_points = 10 x [won Impact] + 8 x [won Rookie All Star] + residual
 *
 * The residual is computed PER TEAM-EVENT by that subtraction and then binned,
 * rather than derived by removing an aggregate share from an aggregate pmf.
 * Once awards stack (15 is 10 plus 5, 13 is 8 plus 5) an aggregate subtraction
 * has no unique answer and can go negative, and a negative is not a
 * distribution. A residual that lands outside the six-bin support — which a
 * disagreement between `district_rankings` and `event_awards_all` can produce —
 * is censused as UNMODELLED and never rounded into a neighbouring bin.
 *
 * The two point values are measured here too, and printed: the AWARD POINT
 * VALUES block tabulates `award_points` over team-events whose ONLY judged
 * award was Impact (and likewise Rookie All Star). The module's constants are
 * written from that census and a corpus-guarded test re-asserts it.
 *
 * ---------------------------------------------------------------------------
 * THE BOUNDARY IS WALK-FORWARD IN BOTH HALVES
 * ---------------------------------------------------------------------------
 *
 *   HALF ONE, THE FEATURE. A team's prior judged award count at a season-S
 *   event counts only judged awards from seasons strictly before S. That rule
 *   is 10-02's `priorJudgedAwardCount`, IMPORTED rather than restated, so the
 *   published `priorJudgedAwards` field and the ordering measured here cannot
 *   disagree about what a decoration is.
 *
 *   HALF TWO, THE TABLES. The tables registered for season Y are fit only on
 *   district-tier events from seasons strictly before Y.
 *
 * Both halves carry their own leak test, on fixtures chosen so a leak CHANGES
 * the answer.
 *
 * ---------------------------------------------------------------------------
 * THE POPULATION, AND THE EVENT FILTER THAT PROTECTS IT
 * ---------------------------------------------------------------------------
 *
 * District-tier team-events only: an `event_points_raw` entry whose OWN
 * `district_cmp` boolean is false, exactly as
 * `scripts/measureDistrictAwardBaseRates.ts` selects them and for the same
 * stated reason (joining to `events` and testing `event_type == 2` yields the
 * dcmp figure wearing the district tier's name).
 *
 * RESTRICTED TO EVENTS THAT CARRY AT LEAST ONE `event_awards_all` ROW. An
 * event whose awards were never ingested would contribute a full field of
 * attendees, every one of them counted as a non-winner, and would deflate
 * every probability in the table while looking like more data. The excluded
 * count is printed rather than absorbed.
 *
 * AND RESTRICTED TO EVENTS WITH AT LEAST `MIN_ORDERED_FIELD_SIZE` ATTENDEES.
 * See that constant: 72 corpus events sit below it, 70 of them with a single
 * attendee, and an attendee won Impact at all 72. A one-attendee field is the
 * Impact winner's points row and nothing else, so including them hands
 * position 1 seventy guaranteed wins.
 *
 * ---------------------------------------------------------------------------
 * CREDENTIAL-FREE AND OFFLINE
 * ---------------------------------------------------------------------------
 *
 * Read-only corpus, no network request, no environment variable, no
 * credential. Its `package.json` entry (`measure:award-ordering-tables`)
 * deliberately omits the `--env-file=.env` flag that `ingest:*` and `publish:*`
 * carry.
 *
 * `event_awards_all` is GITIGNORED and does not travel via git, so another
 * checkout runs `pnpm ingest:awards-all` first. The corpus-guarded tests skip
 * cleanly where it is absent, which is CI.
 *
 * NO AWARD PREDICTION EVER REACHES `locks.ts`. A Locked verdict stays a
 * guarantee.
 *
 * Usage:
 *   npx tsx scripts/measureAwardOrderingTables.ts [--seasons 2019,2026] [--json]
 *   pnpm measure:award-ordering-tables
 */

import { pathToFileURL } from "node:url";
import {
  openCorpusReadOnly,
  type Corpus,
} from "../packages/corpus/db.js";
import {
  AWARD_POINT_SUPPORT,
  cellKey,
  DECORATION_BUCKETS,
  decorationBucket,
  MIN_CELL_OBSERVATIONS,
  NON_JUDGED_AWARD_TYPES,
  ROOKIE_STATES,
  rookieStateFor,
  type AwardPointDistribution,
  type DecorationBucket,
  type RookieState,
} from "../packages/core/districts/awardBaseRates.js";
import {
  IMPACT_AWARD_POINTS,
  IMPACT_AWARD_TYPE,
  MAX_IMPACT_POSITION,
  MAX_ROOKIE_ALL_STAR_POSITION,
  MIN_ORDERED_FIELD_SIZE,
  MIN_POSITION_OBSERVATIONS,
  orderFieldByDecoration,
  ROOKIE_ALL_STAR_AWARD_POINTS,
  ROOKIE_ALL_STAR_AWARD_TYPE,
  teamNumberFromKey,
  type OrderingPositionRate,
  type SeasonAwardOrderingTables,
} from "../packages/core/districts/awardOrderingTables.js";
import { DISTRICT_REGISTERED_SEASONS } from "../packages/core/districts/pointModel.js";
import {
  clearsCellBar,
  emptyCell,
  foldOutcome,
  loadAwardInstances,
  loadDistrictTierOutcomes,
  loadRookieYears,
  MIN_PRIOR_DISTRICT_SEASONS,
  poolCells,
  priorJudgedAwardCount,
  toDistribution,
  type AwardInstance,
  type CellAccumulator,
} from "./measureDistrictAwardBaseRates.js";
import { parseSeasons } from "./scriptHelpers.js";

const CORPUS_PATH = "data/corpus.sqlite";

/** The default window: every season `pointModel.ts` carries a district point ceiling for. */
export const DEFAULT_SEASON_SPEC = DISTRICT_REGISTERED_SEASONS.join(",");

/** How many positions the REFERENCE-ONLY award-type-first ordering is scored at. Three: enough to see the gradient, never shipped. */
export const REFERENCE_IMPACT_POSITIONS = 3;

/** The exact command that produced the tables committed in `awardOrderingTables.ts`. */
export const MEASURED_COMMAND = "npx tsx scripts/measureAwardOrderingTables.ts";
/** The date that command was run. */
export const MEASURED_DATE = "2026-09-25";

// ───────────────────────────── pure helpers ─────────────────────────────
// Everything in this section is pure and unit-tested in
// measureAwardOrderingTables.test.ts.

/** One district-tier attendee of one event, with everything the tables need about it. */
export interface AttendeeOutcome {
  readonly teamKey: string;
  /** Judged awards won in seasons STRICTLY BEFORE this event's own season — leak half one. */
  readonly priorJudgedAwards: number;
  readonly rookieState: RookieState;
  /** The `award_points` component of this team's `event_points_raw` entry for this event. */
  readonly awardPoints: number;
  readonly wonImpact: boolean;
  readonly wonRookieAllStar: boolean;
  /** How many DISTINCT judged award types this team won at this event — the AWARD POINT VALUES census's selector. */
  readonly judgedAwardTypesWon: number;
  /**
   * Prior IMPACT wins alone, for the REFERENCE-ONLY ordering below. NOT part of
   * the shipped ordering and NOT published on any artifact — it exists so the
   * script can print how much the shipped one-number ordering leaves on the
   * table, rather than leaving that an open question.
   */
  readonly priorImpactWins: number;
}

/** One district-tier event's whole attending field. */
export interface EventField {
  readonly season: number;
  readonly eventKey: string;
  readonly attendees: readonly AttendeeOutcome[];
}

/** A running position cell: how many times that position was occupied, and how often it won. */
export interface PositionAccumulator {
  n: number;
  wins: number;
}

export function emptyPosition(): PositionAccumulator {
  return { n: 0, wins: 0 };
}

/** Normalizes a position cell. `undefined` for an empty one — never a zero probability standing in for no data. */
export function toPositionRate(cell: PositionAccumulator): OrderingPositionRate | undefined {
  if (cell.n === 0) return undefined;
  return { n: cell.n, p: cell.wins / cell.n };
}

/** Whether a position cell clears the stated bar. A cell AT the bar is present; below it falls to the tail. */
export function clearsPositionBar(cell: PositionAccumulator): boolean {
  return cell.n >= MIN_POSITION_OBSERVATIONS;
}

/**
 * The RESIDUAL award points for one attendee: what is left after the Impact
 * and Rookie All Star point values are removed.
 *
 * Can be negative when `district_rankings` and `event_awards_all` disagree
 * about an event — a real possibility with two third-party tables. A negative
 * falls outside `AWARD_POINT_SUPPORT` and is censused as UNMODELLED by
 * `foldOutcome`, which is the honest outcome rather than a clamp at zero.
 */
export function residualAwardPoints(attendee: AttendeeOutcome): number {
  return (
    attendee.awardPoints -
    (attendee.wonImpact ? IMPACT_AWARD_POINTS : 0) -
    (attendee.wonRookieAllStar ? ROOKIE_ALL_STAR_AWARD_POINTS : 0)
  );
}

/**
 * How many DISTINCT prior wins of ONE award type a team holds. Distinct on
 * `(year, eventKey)` for the same positional-primary-key reason
 * `priorJudgedAwardCount` is distinct on `(year, eventKey, awardType)`.
 *
 * REFERENCE ONLY. Nothing shipped reads this.
 */
export function priorAwardTypeCount(
  instances: readonly AwardInstance[],
  teamKey: string,
  awardType: number,
  beforeYear: number
): number {
  const seen = new Set<string>();
  for (const instance of instances) {
    if (instance.teamKey !== teamKey) continue;
    if (instance.year >= beforeYear) continue;
    if (instance.awardType !== awardType) continue;
    seen.add(`${instance.year}|${instance.eventKey}`);
  }
  return seen.size;
}

/**
 * THE REFERENCE ORDERING, NOT SHIPPED: prior IMPACT wins descending, then
 * prior judged awards descending, then ascending team number. This is
 * `scripts/measureAwardPredictability.ts`'s own `compareDecoration` for award
 * type 0, and measuring it beside the shipped ordering is what turns "the
 * one-number ordering might be leaving something on the table" from a worry
 * into a number.
 *
 * It is not shipped because it needs a SECOND per-team count on every district
 * artifact, and that trade is Jacob's to make with the gap in front of him.
 */
export function orderFieldByImpactHistory(attendees: readonly AttendeeOutcome[]): string[] {
  return [...attendees]
    .sort((a, b) => {
      if (a.priorImpactWins !== b.priorImpactWins) return b.priorImpactWins - a.priorImpactWins;
      if (a.priorJudgedAwards !== b.priorJudgedAwards) return b.priorJudgedAwards - a.priorJudgedAwards;
      const na = teamNumberFromKey(a.teamKey);
      const nb = teamNumberFromKey(b.teamKey);
      if (na !== nb) return na < nb ? -1 : 1;
      return a.teamKey < b.teamKey ? -1 : a.teamKey > b.teamKey ? 1 : 0;
    })
    .map((attendee) => attendee.teamKey);
}

/** One season's measured result, before it becomes a committed literal. */
export interface SeasonOrderingMeasurement {
  readonly season: number;
  readonly priorSeasons: number[];
  readonly eventCount: number;
  readonly attendeeCount: number;
  /** Index `k - 1` is Impact position `k`. */
  readonly impact: PositionAccumulator[];
  readonly impactTail: PositionAccumulator;
  /** Index `j - 1` is rookie position `j`. */
  readonly rookieAllStar: PositionAccumulator[];
  readonly rookieAllStarTail: PositionAccumulator;
  /** REFERENCE ONLY, never shipped: Impact positions 1 to 3 under `orderFieldByImpactHistory`. */
  readonly referenceImpact: PositionAccumulator[];
  readonly residualCells: Map<string, CellAccumulator>;
  readonly residualBucketPooled: Map<DecorationBucket, CellAccumulator>;
  readonly residualSeasonPooled: CellAccumulator;
  /** `award_points` census over team-events whose ONLY judged award was Impact. */
  readonly soleImpactPoints: Map<number, number>;
  /** `award_points` census over team-events whose ONLY judged award was Rookie All Star. */
  readonly soleRookieAllStarPoints: Map<number, number>;
  readonly registered: boolean;
  readonly registrationReason: string;
}

/** The modal key of a census, or `undefined` for an empty one. Ties go to the SMALLER value, which never overstates. */
export function modalValue(census: ReadonlyMap<number, number>): number | undefined {
  let best: number | undefined;
  let bestCount = -1;
  for (const value of [...census.keys()].sort((a, b) => a - b)) {
    const count = census.get(value)!;
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** The total observations in a census. */
export function censusTotal(census: ReadonlyMap<number, number>): number {
  let total = 0;
  for (const count of census.values()) total += count;
  return total;
}

/**
 * Builds one season's tables from a PRIOR event-field set. The caller supplies
 * it and it must already be restricted to seasons strictly before `season` —
 * which is exactly what leak half two's test drives directly.
 */
export function buildSeasonOrderingTables(
  season: number,
  priorFields: readonly EventField[]
): SeasonOrderingMeasurement {
  const impact = Array.from({ length: MAX_IMPACT_POSITION }, emptyPosition);
  const impactTail = emptyPosition();
  const rookieAllStar = Array.from({ length: MAX_ROOKIE_ALL_STAR_POSITION }, emptyPosition);
  const rookieAllStarTail = emptyPosition();
  const referenceImpact = Array.from({ length: REFERENCE_IMPACT_POSITIONS }, emptyPosition);

  const residualCells = new Map<string, CellAccumulator>();
  for (const bucket of DECORATION_BUCKETS) {
    for (const state of ROOKIE_STATES) residualCells.set(cellKey(bucket, state), emptyCell());
  }

  const soleImpactPoints = new Map<number, number>();
  const soleRookieAllStarPoints = new Map<number, number>();

  let attendeeCount = 0;

  for (const field of priorFields) {
    const byKey = new Map(field.attendees.map((attendee) => [attendee.teamKey, attendee] as const));

    // The whole-field Impact ordering.
    const ordered = orderFieldByDecoration(field.attendees);
    ordered.forEach((teamKey, index) => {
      const attendee = byKey.get(teamKey)!;
      const cell = index < MAX_IMPACT_POSITION ? impact[index]! : impactTail;
      cell.n++;
      if (attendee.wonImpact) cell.wins++;
    });

    // REFERENCE ONLY, never shipped — see `orderFieldByImpactHistory`.
    orderFieldByImpactHistory(field.attendees)
      .slice(0, REFERENCE_IMPACT_POSITIONS)
      .forEach((teamKey, index) => {
        const attendee = byKey.get(teamKey)!;
        referenceImpact[index]!.n++;
        if (attendee.wonImpact) referenceImpact[index]!.wins++;
      });

    // The rookie-block Rookie All Star ordering. Its length is the BLOCK SIZE,
    // never the field size — no tail of veterans is invented below the rookies,
    // following `measureAwardPredictability.ts`'s RB1 exactly.
    const rookieOrdered = orderFieldByDecoration(field.attendees.filter((a) => a.rookieState === "rookie"));
    rookieOrdered.forEach((teamKey, index) => {
      const attendee = byKey.get(teamKey)!;
      const cell = index < MAX_ROOKIE_ALL_STAR_POSITION ? rookieAllStar[index]! : rookieAllStarTail;
      cell.n++;
      if (attendee.wonRookieAllStar) cell.wins++;
    });

    for (const attendee of field.attendees) {
      attendeeCount++;
      const bucket = decorationBucket(attendee.priorJudgedAwards);
      foldOutcome(residualCells.get(cellKey(bucket, attendee.rookieState))!, residualAwardPoints(attendee));
      if (attendee.judgedAwardTypesWon === 1) {
        if (attendee.wonImpact) soleImpactPoints.set(attendee.awardPoints, (soleImpactPoints.get(attendee.awardPoints) ?? 0) + 1);
        if (attendee.wonRookieAllStar) {
          soleRookieAllStarPoints.set(attendee.awardPoints, (soleRookieAllStarPoints.get(attendee.awardPoints) ?? 0) + 1);
        }
      }
    }
  }

  const residualBucketPooled = new Map<DecorationBucket, CellAccumulator>();
  for (const bucket of DECORATION_BUCKETS) {
    residualBucketPooled.set(
      bucket,
      poolCells(ROOKIE_STATES.map((state) => residualCells.get(cellKey(bucket, state))!))
    );
  }
  const residualSeasonPooled = poolCells([...residualCells.values()]);

  const priorSeasons = [...new Set(priorFields.map((f) => f.season))].sort((a, b) => a - b);

  let registered = true;
  let registrationReason = "registered";
  if (priorSeasons.length < MIN_PRIOR_DISTRICT_SEASONS) {
    registered = false;
    registrationReason = `only ${priorSeasons.length} prior district season(s) of data, below the ${MIN_PRIOR_DISTRICT_SEASONS} required`;
  } else if (!clearsPositionBar(impact[0]!)) {
    registered = false;
    registrationReason = `Impact position 1 rests on n=${impact[0]!.n}, below the ${MIN_POSITION_OBSERVATIONS} minimum`;
  } else if (residualSeasonPooled.n < MIN_CELL_OBSERVATIONS) {
    registered = false;
    registrationReason = `the pooled residual rests on n=${residualSeasonPooled.n}, below the ${MIN_CELL_OBSERVATIONS} minimum`;
  }

  return {
    season,
    priorSeasons,
    eventCount: priorFields.length,
    attendeeCount,
    impact,
    impactTail,
    rookieAllStar,
    rookieAllStarTail,
    referenceImpact,
    residualCells,
    residualBucketPooled,
    residualSeasonPooled,
    soleImpactPoints,
    soleRookieAllStarPoints,
    registered,
    registrationReason,
  };
}

/** The committed-literal shape for one registered season. A thin position is `null`, never zeroed. */
export function toSeasonOrderingTables(measurement: SeasonOrderingMeasurement): SeasonAwardOrderingTables {
  const positions = (cells: readonly PositionAccumulator[]): (OrderingPositionRate | null)[] =>
    cells.map((cell) => (clearsPositionBar(cell) ? (toPositionRate(cell) ?? null) : null));

  const residualCells: Record<string, AwardPointDistribution> = {};
  for (const [key, cell] of measurement.residualCells) {
    if (!clearsCellBar(cell)) continue;
    const distribution = toDistribution(cell);
    if (distribution !== undefined) residualCells[key] = distribution;
  }
  const residualBucketPooled: Record<string, AwardPointDistribution> = {};
  for (const [bucket, cell] of measurement.residualBucketPooled) {
    const distribution = toDistribution(cell);
    if (distribution !== undefined) residualBucketPooled[bucket] = distribution;
  }

  return {
    impact: positions(measurement.impact),
    impactTail: toPositionRate(measurement.impactTail) ?? { n: 0, p: 0 },
    rookieAllStar: positions(measurement.rookieAllStar),
    rookieAllStarTail: toPositionRate(measurement.rookieAllStarTail) ?? { n: 0, p: 0 },
    residualCells,
    residualBucketPooled,
    residualSeasonPooled: toDistribution(measurement.residualSeasonPooled)!,
  };
}

// ───────────────────────────── corpus reads ─────────────────────────────

/** What one season's award rows say about each `(eventKey, teamKey)` pair. */
export interface SeasonAwardIndex {
  /** Every event key that carries at least one `event_awards_all` row. */
  readonly eventsWithAwardRows: ReadonlySet<string>;
  /** `${eventKey}|${teamKey}` -> the DISTINCT judged award types that team won at that event. */
  readonly judgedByTeamEvent: ReadonlyMap<string, ReadonlySet<number>>;
}

/** Indexes one season's award instances by event and team. Judged types only — the non-judged three never count. */
export function indexSeasonAwards(instances: readonly AwardInstance[]): SeasonAwardIndex {
  const eventsWithAwardRows = new Set<string>();
  const judgedByTeamEvent = new Map<string, Set<number>>();
  for (const instance of instances) {
    eventsWithAwardRows.add(instance.eventKey);
    if (instance.teamKey === null) continue;
    if (NON_JUDGED_AWARD_TYPES.has(instance.awardType)) continue;
    const key = `${instance.eventKey}|${instance.teamKey}`;
    const set = judgedByTeamEvent.get(key);
    if (set === undefined) judgedByTeamEvent.set(key, new Set([instance.awardType]));
    else set.add(instance.awardType);
  }
  return { eventsWithAwardRows, judgedByTeamEvent };
}

/** One season's load: the event fields it contributes, and each reason an event was excluded. */
export interface SeasonFieldLoad {
  readonly fields: EventField[];
  readonly eventsWithoutAwardRows: string[];
  /** Events below `MIN_ORDERED_FIELD_SIZE` — see that constant for the measured artifact this removes. */
  readonly eventsBelowFieldSizeBar: string[];
}

/**
 * Builds one season's event fields from its district-tier outcomes and its own
 * award rows.
 *
 * `priorCountFor` is injected rather than computed here so the leak boundary is
 * the CALLER's explicit choice and the test can drive it directly.
 */
export function buildSeasonFields(
  season: number,
  outcomes: readonly { teamKey: string; eventKey: string; awardPoints: number }[],
  awards: SeasonAwardIndex,
  rookieYears: ReadonlyMap<string, number>,
  priorCountFor: (teamKey: string) => number,
  priorImpactCountFor: (teamKey: string) => number
): SeasonFieldLoad {
  const byEvent = new Map<string, { teamKey: string; awardPoints: number }[]>();
  for (const outcome of outcomes) {
    const list = byEvent.get(outcome.eventKey);
    if (list === undefined) byEvent.set(outcome.eventKey, [{ teamKey: outcome.teamKey, awardPoints: outcome.awardPoints }]);
    else list.push({ teamKey: outcome.teamKey, awardPoints: outcome.awardPoints });
  }

  const fields: EventField[] = [];
  const eventsWithoutAwardRows: string[] = [];
  const eventsBelowFieldSizeBar: string[] = [];
  for (const eventKey of [...byEvent.keys()].sort()) {
    if (!awards.eventsWithAwardRows.has(eventKey)) {
      eventsWithoutAwardRows.push(eventKey);
      continue;
    }
    if (byEvent.get(eventKey)!.length < MIN_ORDERED_FIELD_SIZE) {
      eventsBelowFieldSizeBar.push(eventKey);
      continue;
    }
    const attendees: AttendeeOutcome[] = byEvent
      .get(eventKey)!
      .map((row) => {
        const judged = awards.judgedByTeamEvent.get(`${eventKey}|${row.teamKey}`);
        return {
          teamKey: row.teamKey,
          priorJudgedAwards: priorCountFor(row.teamKey),
          rookieState: rookieStateFor(rookieYears.get(row.teamKey) ?? null, season),
          awardPoints: row.awardPoints,
          wonImpact: judged?.has(IMPACT_AWARD_TYPE) ?? false,
          wonRookieAllStar: judged?.has(ROOKIE_ALL_STAR_AWARD_TYPE) ?? false,
          judgedAwardTypesWon: judged?.size ?? 0,
          priorImpactWins: priorImpactCountFor(row.teamKey),
        };
      })
      .sort((a, b) => (a.teamKey < b.teamKey ? -1 : a.teamKey > b.teamKey ? 1 : 0));
    fields.push({ season, eventKey, attendees });
  }
  return { fields, eventsWithoutAwardRows, eventsBelowFieldSizeBar };
}

// ───────────────────────────── the measurement ─────────────────────────────

export interface OrderingMeasurementResult {
  readonly bySeason: Map<number, SeasonOrderingMeasurement>;
  readonly registeredSeasons: number[];
  readonly eventsWithoutAwardRows: Map<number, string[]>;
  readonly eventsBelowFieldSizeBar: Map<number, string[]>;
  readonly fieldsBySeason: Map<number, EventField[]>;
}

/**
 * Measures every season in `seasons`. For each, the prior event-field set is
 * built from DISTRICT-REGISTERED seasons STRICTLY BEFORE it — reversing that is
 * the leak.
 *
 * The prior-award index is built ONCE over every registered season and the
 * `year < beforeYear` filter inside `priorJudgedAwardCount` is what makes each
 * season's feature honest, so there is no second accumulation rule that could
 * drift from that function's.
 */
export function measureAwardOrderingTables(db: Corpus, seasons: readonly number[]): OrderingMeasurementResult {
  const ordered = [...seasons].sort((a, b) => a - b);
  const rookieYears = loadRookieYears(db);

  const instancesByTeam = new Map<string, AwardInstance[]>();
  const awardsBySeason = new Map<number, SeasonAwardIndex>();
  for (const season of DISTRICT_REGISTERED_SEASONS) {
    const instances = loadAwardInstances(db, season);
    awardsBySeason.set(season, indexSeasonAwards(instances));
    for (const instance of instances) {
      if (instance.teamKey === null) continue;
      const list = instancesByTeam.get(instance.teamKey);
      if (list === undefined) instancesByTeam.set(instance.teamKey, [instance]);
      else list.push(instance);
    }
  }

  const fieldsBySeason = new Map<number, EventField[]>();
  const eventsWithoutAwardRows = new Map<number, string[]>();
  const eventsBelowFieldSizeBar = new Map<number, string[]>();
  for (const season of DISTRICT_REGISTERED_SEASONS) {
    const priorCache = new Map<string, number>();
    const priorCountFor = (teamKey: string): number => {
      let cached = priorCache.get(teamKey);
      if (cached === undefined) {
        cached = priorJudgedAwardCount(instancesByTeam.get(teamKey) ?? [], teamKey, season);
        priorCache.set(teamKey, cached);
      }
      return cached;
    };
    const impactCache = new Map<string, number>();
    const priorImpactCountFor = (teamKey: string): number => {
      let cached = impactCache.get(teamKey);
      if (cached === undefined) {
        cached = priorAwardTypeCount(instancesByTeam.get(teamKey) ?? [], teamKey, IMPACT_AWARD_TYPE, season);
        impactCache.set(teamKey, cached);
      }
      return cached;
    };
    const load = buildSeasonFields(
      season,
      loadDistrictTierOutcomes(db, season),
      awardsBySeason.get(season)!,
      rookieYears,
      priorCountFor,
      priorImpactCountFor
    );
    fieldsBySeason.set(season, load.fields);
    eventsWithoutAwardRows.set(season, load.eventsWithoutAwardRows);
    eventsBelowFieldSizeBar.set(season, load.eventsBelowFieldSizeBar);
  }

  const bySeason = new Map<number, SeasonOrderingMeasurement>();
  const registeredSeasons: number[] = [];
  for (const season of ordered) {
    const priorFields: EventField[] = [];
    for (const prior of DISTRICT_REGISTERED_SEASONS.filter((s) => s < season)) {
      priorFields.push(...(fieldsBySeason.get(prior) ?? []));
    }
    const measurement = buildSeasonOrderingTables(season, priorFields);
    bySeason.set(season, measurement);
    if (measurement.registered) registeredSeasons.push(season);
  }

  return { bySeason, registeredSeasons, eventsWithoutAwardRows, eventsBelowFieldSizeBar, fieldsBySeason };
}

// ───────────────────────────── reporting ─────────────────────────────

function rateString(cell: PositionAccumulator): string {
  const rate = toPositionRate(cell);
  if (rate === undefined) return "CANNOT BE SCORED (n=0)";
  const thin = clearsPositionBar(cell) ? "" : `  THIN (n < ${MIN_POSITION_OBSERVATIONS}, falls to the tail)`;
  return `${(rate.p * 100).toFixed(2).padStart(6)}%   wins ${String(cell.wins).padStart(5)} of ${String(cell.n).padStart(6)}${thin}`;
}

function pmfString(cell: CellAccumulator): string {
  const distribution = toDistribution(cell);
  if (distribution === undefined) return "CANNOT BE SCORED (n=0)";
  return distribution.pmf.map((p) => p.toFixed(4)).join("  ");
}

function censusString(census: ReadonlyMap<number, number>): string {
  const entries = [...census.entries()].sort((a, b) => a[0] - b[0]);
  if (entries.length === 0) return "none";
  return entries.map(([value, count]) => `${value} x${count}`).join(", ");
}

function reportSeason(measurement: SeasonOrderingMeasurement): void {
  console.log(
    `── ${measurement.season} ── fit on seasons ${measurement.priorSeasons.join(", ") || "none"} (${measurement.eventCount} events, ${measurement.attendeeCount} team-events)`
  );
  console.log(`   IMPACT by position in the most-decorated ordering`);
  for (let k = 1; k <= MAX_IMPACT_POSITION; k++) {
    console.log(`     position ${String(k).padStart(2)}   ${rateString(measurement.impact[k - 1]!)}`);
  }
  console.log(`     tail ${String(MAX_IMPACT_POSITION + 1).padStart(2)}+     ${rateString(measurement.impactTail)}`);
  console.log(`   ROOKIE ALL STAR by position among the event's rookies`);
  for (let j = 1; j <= MAX_ROOKIE_ALL_STAR_POSITION; j++) {
    console.log(`     position ${String(j).padStart(2)}   ${rateString(measurement.rookieAllStar[j - 1]!)}`);
  }
  console.log(`     tail ${String(MAX_ROOKIE_ALL_STAR_POSITION + 1).padStart(2)}+     ${rateString(measurement.rookieAllStarTail)}`);

  const supportHeader = AWARD_POINT_SUPPORT.map((v, i) =>
    (i === AWARD_POINT_SUPPORT.length - 1 ? `${v}+` : String(v)).padStart(6)
  ).join("");
  console.log(`   RESIDUAL award points (Impact and Rookie All Star removed)`);
  console.log(`     cell                              n   ${supportHeader}`);
  for (const bucket of DECORATION_BUCKETS) {
    for (const state of ROOKIE_STATES) {
      const key = cellKey(bucket, state);
      const cell = measurement.residualCells.get(key)!;
      console.log(
        `     ${key.padEnd(30)} ${String(cell.n).padStart(6)}   ` +
          (clearsCellBar(cell) ? pmfString(cell) : `CANNOT BE SCORED (n < ${MIN_CELL_OBSERVATIONS})`)
      );
    }
  }
  for (const bucket of DECORATION_BUCKETS) {
    const cell = measurement.residualBucketPooled.get(bucket)!;
    console.log(`     POOLED ${bucket.padEnd(23)} ${String(cell.n).padStart(6)}   ${pmfString(cell)}`);
  }
  console.log(
    `     POOLED season                  ${String(measurement.residualSeasonPooled.n).padStart(6)}   ${pmfString(measurement.residualSeasonPooled)}`
  );
  const census = [...measurement.residualSeasonPooled.unmodelled.entries()].sort((a, b) => a[0] - b[0]);
  console.log(
    `     UNMODELLED RESIDUALS: ${census.length === 0 ? "none" : census.map(([value, count]) => `${value} x${count}`).join(", ")}`
  );
  console.log(`   REFERENCE ONLY, NOT SHIPPED — Impact by position under the award-type-first ordering`);
  console.log(`     (prior Impact wins, then prior judged awards, then ascending team number)`);
  for (let k = 1; k <= REFERENCE_IMPACT_POSITIONS; k++) {
    console.log(`     position ${String(k).padStart(2)}   ${rateString(measurement.referenceImpact[k - 1]!)}`);
  }
  console.log(
    `   AWARD POINT VALUES, measured over team-events whose ONLY judged award was that one:\n` +
      `     Impact only:          ${censusString(measurement.soleImpactPoints)}  (modal ${String(modalValue(measurement.soleImpactPoints) ?? "n/a")}, committed ${IMPACT_AWARD_POINTS})\n` +
      `     Rookie All Star only: ${censusString(measurement.soleRookieAllStarPoints)}  (modal ${String(modalValue(measurement.soleRookieAllStarPoints) ?? "n/a")}, committed ${ROOKIE_ALL_STAR_AWARD_POINTS})`
  );
  console.log(`   ${measurement.registered ? "REGISTERED" : "NOT REGISTERED"}: ${measurement.registrationReason}`);
  console.log("");
}

function reportPracticalAnswer(result: OrderingMeasurementResult): void {
  const seasons = result.registeredSeasons;
  if (seasons.length === 0) {
    console.log(`── PRACTICAL ANSWER ──\n   No season cleared the registration bar. Nothing to state.\n`);
    return;
  }
  const latest = result.bySeason.get(seasons[seasons.length - 1]!)!;
  const pct = (cell: PositionAccumulator): string => {
    const rate = toPositionRate(cell);
    return rate === undefined ? "n/a" : `${(rate.p * 100).toFixed(1)}%`;
  };
  console.log(`── PRACTICAL ANSWER ──`);
  console.log(
    `   At a regular district event, the single most decorated team in the field wins Impact about\n` +
      `   ${pct(latest.impact[0]!)} of the time. The second most decorated: ${pct(latest.impact[1]!)}. The third: ${pct(latest.impact[2]!)}. Everything from\n` +
      `   position ${MAX_IMPACT_POSITION + 1} down shares ${pct(latest.impactTail)}. The lowest-numbered rookie in the field wins Rookie All Star\n` +
      `   ${pct(latest.rookieAllStar[0]!)} of the time, the second ${pct(latest.rookieAllStar[1]!)}. Every true rookie has no prior judged award, so the\n` +
      `   rookie ordering is ascending team number and those two numbers are mostly the answer to\n` +
      `   "one of the k rookies here". Figures above are season ${latest.season}'s tables, fit on seasons\n` +
      `   ${latest.priorSeasons.join(", ")}, and every one of them is reported in whichever direction it came out.`
  );
  console.log("");
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasons = parseSeasons(flagValue(args, "--seasons") ?? DEFAULT_SEASON_SPEC);
  const asJson = args.includes("--json");

  if (!asJson) {
    console.log(`IMPACT AND ROOKIE ALL STAR ORDERING TABLES — walk-forward, district tier only, by position in the most-decorated ordering.`);
    console.log(`seasons:    ${seasons.join(", ")}`);
    console.log(`ordering:   prior judged award count descending, ties by ASCENDING TEAM NUMBER`);
    console.log(`positions:  Impact 1 to ${MAX_IMPACT_POSITION} then a pooled tail; Rookie All Star 1 to ${MAX_ROOKIE_ALL_STAR_POSITION} then a pooled tail`);
    console.log(`bar:        ${MIN_POSITION_OBSERVATIONS} observations per position, ${MIN_CELL_OBSERVATIONS} per residual cell`);
    console.log(`population: district-tier team-events at events carrying at least one event_awards_all row`);
    console.log(`credential: none. Read-only corpus, no network request, no environment variable.`);
    console.log(``);
  }

  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    const result = measureAwardOrderingTables(db, seasons);

    if (asJson) {
      console.log(
        JSON.stringify(
          {
            command: MEASURED_COMMAND,
            date: MEASURED_DATE,
            registeredSeasons: result.registeredSeasons,
            seasons: [...result.bySeason.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([season, measurement]) => ({
                season,
                priorSeasons: measurement.priorSeasons,
                registered: measurement.registered,
                registrationReason: measurement.registrationReason,
                tables: measurement.registered ? toSeasonOrderingTables(measurement) : null,
              })),
          },
          null,
          2
        )
      );
      return;
    }

    let noAwardRows = 0;
    for (const keys of result.eventsWithoutAwardRows.values()) noAwardRows += keys.length;
    let belowBar = 0;
    for (const keys of result.eventsBelowFieldSizeBar.values()) belowBar += keys.length;
    let included = 0;
    for (const fields of result.fieldsBySeason.values()) included += fields.length;
    console.log(
      `EVENT FILTER: ${included} district-tier event(s) included. EXCLUDED: ${noAwardRows} carrying no event_awards_all row ` +
        `(counting them would deflate every rate), ${belowBar} below the ${MIN_ORDERED_FIELD_SIZE}-attendee field-size bar ` +
        `(a one-attendee field is the Impact winner's points row and nothing else, and counting them inflates position 1).`
    );
    console.log(``);

    for (const season of [...result.bySeason.keys()].sort((a, b) => a - b)) {
      reportSeason(result.bySeason.get(season)!);
    }
    console.log(`REGISTERED SEASONS: ${result.registeredSeasons.join(", ") || "none"}`);
    for (const season of [...result.bySeason.keys()].sort((a, b) => a - b)) {
      const measurement = result.bySeason.get(season)!;
      if (!measurement.registered) console.log(`   NOT ${season}: ${measurement.registrationReason}`);
    }
    console.log("");
    reportPracticalAnswer(result);
  } finally {
    db.close();
  }
}

// Guard: only auto-run `main()` when this file is the process entry point, so
// the pure helpers above can be imported by the test file without opening a
// corpus.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("measure:award-ordering-tables failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
