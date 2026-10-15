/**
 * AWARD SLATE MEASUREMENT (quick task 261014-qje): the one measurement script
 * for both tiers of the one award model (`packages/core/districts/awardSlate.ts`).
 *
 *     npx tsx scripts/measureAwardSlate.ts
 *
 * ---------------------------------------------------------------------------
 * THE EVENTS
 * ---------------------------------------------------------------------------
 *
 * DISTRICT TIER: `district_rankings` entries whose OWN `district_cmp` is false,
 * at events carrying at least one award row, fields of at least 11 teams (the
 * scorer's population rule). Each event's TBA week from the corpus `events`
 * table. Eligibility with every award final, through the shipped helper
 * `districtAwardEligibility` (Q-05): a team that already won Impact,
 * Engineering Inspiration or Rookie All Star at an earlier week district event
 * that season cannot win that same award there.
 *
 * DCMP TIER: every `district_rankings` entry whose own `district_cmp` is true,
 * grouped into championships (a single key, or a finals key plus its
 * divisions) by key structure, measured when the union of its keys' fields
 * holds at least 11 teams with award points above 0 (the 261014-i8i
 * degenerate filter, which removes 2020). Eligibility through
 * `dcmpAwardEligibility` with the district's own district tier events and every
 * award final, as 261014-i8i measured it.
 *
 * ---------------------------------------------------------------------------
 * THE TABLES (each registered season Y, each tier)
 * ---------------------------------------------------------------------------
 *
 * COUNTS (Q-04, Q-10). For each award type Y's census list declares (the DCMP
 * tier leaves out the three qualifying awards, whose counts come from the
 * champ draws' count model): the mean number of distinct winners of that type
 * per event, counting only winners inside the type's audience who were
 * eligible there, over the events whose field holds at least one eligible
 * audience member, in the most recent earlier season whose list declares the
 * type and that holds such events of the tier and role (`role`). At the DCMP,
 * a role with no such season reads the pooled single plus division events of
 * the most recent earlier season holding either (`pooled`). A type no earlier
 * season declared takes the mean count of Y's other declared types with the
 * same points at that tier and role (`new-award`).
 *
 * LIFTS (Q-06, Q-07). From every earlier season S that holds measured events
 * of the tier and has at least three award seasons in the corpus before it.
 * Pools: district tier, one per event; DCMP qualifying slots, one per
 * championship; DCMP 5 point slots, one per single or division key. A pool
 * holds the slot's eligible audience minus every team that won an award of an
 * earlier slot there; y is "won any type of the slot there"; e is the pool's
 * winners over its size; a class's lift is sum y over sum e. A class below 100
 * observations prints CANNOT BE SCORED and is left out.
 *
 * WALK FORWARD IN BOTH HALVES. Season Y's tables read only seasons strictly
 * before Y, and each team's counts read only seasons strictly before its own.
 *
 * Read only corpus, no network request, no environment variable.
 */
import { pathToFileURL } from "node:url";
import {
  openCorpusReadOnly,
  selectDistrictRankings,
  selectDistrictsForYear,
  selectEventAwardsAllForYear,
  type Corpus,
} from "../packages/corpus/db.js";
import { DISTRICT_REGISTERED_SEASONS } from "../packages/core/districts/pointModel.js";
import { DISTRICT_POINT_AWARD_VALUES, MIN_CELL_OBSERVATIONS, rookieStateFor, type RookieState } from "../packages/core/districts/awardBaseRates.js";
import {
  AWARD_SLOTS,
  districtAwardEligibility,
  inSlotAudience,
  QUALIFYING_SLOT_TYPE,
  slateClassKeys,
  TYPE_SLOT,
  type AwardSlateCountRole,
  type AwardSlateSeasonTables,
  type AwardSlateTier,
  type AwardSlot,
  type AwardTypeCount,
  type SlateLift,
  type SlateSlotLifts,
} from "../packages/core/districts/awardSlate.js";
import { dcmpAwardEligibility, dcmpEligibilityChance, type DcmpEligibilityTeam } from "../packages/core/districts/dcmpAwardEligibility.js";
import { dcmpEventRoles, type DcmpEventRole } from "../packages/core/districts/dcmpAwardSlate.js";
import { ZERO_AWARD_PROFILE } from "../packages/core/districts/ledgerSimulation.js";

const CORPUS_PATH = "data/corpus.sqlite";

/**
 * A season needs at least this many PRIOR award seasons in the corpus before
 * its lifts are measured (Q-07) and before the publisher publishes its
 * profiles (Q-12). Moved here from the deleted
 * `scripts/measureDistrictAwardBaseRates.ts` (quick task 261014-qje).
 */
export const MIN_PRIOR_DISTRICT_SEASONS = 3;

// ───────────────────── corpus helpers (moved, quick task 261014-qje) ─────────────────────
// `loadAwardInstances`, `loadRookieYears`, `priorAwardTypeCount`,
// `priorImpactWinCount` and the district point award census moved here
// unchanged from `scripts/measureDistrictAwardBaseRates.ts` and
// `scripts/measureAwardOrderingTables.ts`, which Task 2 deleted (Q-12).

/** One award instance as this script reads it. `teamKey` is null for a person-only award. */
export interface AwardInstance {
  readonly year: number;
  readonly eventKey: string;
  readonly awardType: number;
  readonly teamKey: string | null;
}

/** Every award instance for one season, as this script's `AwardInstance` shape. */
export function loadAwardInstances(db: Corpus, season: number): AwardInstance[] {
  return selectEventAwardsAllForYear(db, season).map((row) => ({
    year: row.year,
    eventKey: row.eventKey,
    awardType: row.awardType,
    teamKey: row.teamKey,
  }));
}

interface TeamRookieYearRow {
  team_key: string;
  rookie_year: number | null;
}

/** teamKey to `rookie_year`, NON-NULL ROWS ONLY. An absent key is the `"unknown"` rookie state. */
export function loadRookieYears(db: Corpus): Map<string, number> {
  const rows = db.prepare(`SELECT team_key, rookie_year FROM teams`).all() as TeamRookieYearRow[];
  const out = new Map<string, number>();
  for (const row of rows) {
    if (row.rookie_year === null || !Number.isFinite(row.rookie_year)) continue;
    out.set(row.team_key, row.rookie_year);
  }
  return out;
}

/**
 * How many DISTINCT `(year, eventKey)` wins of one award type a team had
 * before `beforeYear`. Distinct because `event_awards_all`'s primary key is
 * POSITIONAL: a multi-recipient award is several rows at one event.
 * `beforeYear` is strict.
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
 * A team's prior IMPACT wins before `beforeYear`: `priorAwardTypeCount` for
 * award type 0. THE ONE COUNTING RULE for the Impact class's first key. This
 * script measures the lifts with it and `scripts/publishDistricts.ts`
 * publishes `priorImpactWins` with it, imported rather than restated.
 */
export function priorImpactWinCount(instances: readonly AwardInstance[], teamKey: string, beforeYear: number): number {
  return priorAwardTypeCount(instances, teamKey, 0, beforeYear);
}

/** One district tier team-event outcome: what a team scored in award points at one regular district event. */
export interface TeamEventOutcome {
  readonly season: number;
  readonly teamKey: string;
  readonly eventKey: string;
  readonly awardPoints: number;
}

/**
 * Every district-tier team-event outcome for one season: an
 * `event_points_raw` entry whose OWN `district_cmp` is false. Never joined to
 * `events`.
 */
export function loadDistrictTierOutcomes(db: Corpus, season: number): TeamEventOutcome[] {
  const out: TeamEventOutcome[] = [];
  for (const district of selectDistrictsForYear(db, season)) {
    for (const ranking of selectDistrictRankings(db, district.districtKey)) {
      let entries: unknown;
      try {
        entries = JSON.parse(ranking.eventPointsRaw);
      } catch {
        continue;
      }
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (typeof entry !== "object" || entry === null) continue;
        const record = entry as Record<string, unknown>;
        // The same field set publishDistricts.ts's EventPointsEntrySchema declares.
        if (typeof record["event_key"] !== "string") continue;
        if (typeof record["district_cmp"] !== "boolean") continue;
        if (typeof record["award_points"] !== "number") continue;
        if (record["district_cmp"] === true) continue;
        out.push({
          season,
          teamKey: ranking.teamKey,
          eventKey: record["event_key"],
          awardPoints: record["award_points"],
        });
      }
    }
  }
  return out;
}

/** One district tier team event whose summed point values disagree with the recorded `award_points`. */
export interface DistrictPointAwardMismatch {
  readonly season: number;
  readonly eventKey: string;
  readonly teamKey: string;
  readonly awardTypes: readonly number[];
  readonly recorded: number;
  readonly summed: number;
}

/** What one award type paid when it was a team's ONLY award at a district tier event. */
export interface SoleAwardTally {
  /** award_points value to the number of team events that recorded it. */
  readonly values: Map<number, number>;
  firstSeason: number;
  lastSeason: number;
}

/** The district point award census (quick task 261014-mii, decision M-01). */
export interface DistrictPointAwardCensus {
  /** District tier team events checked: those at events carrying at least one award row. */
  teamEvents: number;
  /** District tier team events at events with NO award rows: excluded from the check, censused. */
  teamEventsWithoutAwardRows: number;
  readonly mismatches: DistrictPointAwardMismatch[];
  /** Award type to its tally as a team's only award. */
  readonly soleAward: Map<number, SoleAwardTally>;
}

export function emptyDistrictPointAwardCensus(): DistrictPointAwardCensus {
  return { teamEvents: 0, teamEventsWithoutAwardRows: 0, mismatches: [], soleAward: new Map() };
}

/**
 * Folds one season into the census: for every district tier team event at an
 * event with award rows, the summed `DISTRICT_POINT_AWARD_VALUES` of the team's
 * DISTINCT award types at that event against the recorded `award_points`, and,
 * when the team won exactly one award type there, what that type paid alone.
 * Pure: the caller supplies the season's outcomes and award instances.
 */
export function addSeasonToDistrictPointAwardCensus(
  census: DistrictPointAwardCensus,
  outcomes: readonly TeamEventOutcome[],
  instances: readonly AwardInstance[]
): void {
  const eventsWithAwardRows = new Set(instances.map((instance) => instance.eventKey));
  const typesAt = new Map<string, Set<number>>();
  for (const instance of instances) {
    if (instance.teamKey === null) continue;
    const key = `${instance.eventKey}|${instance.teamKey}`;
    const set = typesAt.get(key);
    if (set === undefined) typesAt.set(key, new Set([instance.awardType]));
    else set.add(instance.awardType);
  }
  for (const outcome of outcomes) {
    if (!eventsWithAwardRows.has(outcome.eventKey)) {
      census.teamEventsWithoutAwardRows++;
      continue;
    }
    census.teamEvents++;
    const types = [...(typesAt.get(`${outcome.eventKey}|${outcome.teamKey}`) ?? [])].sort((a, b) => a - b);
    let summed = 0;
    for (const type of types) summed += DISTRICT_POINT_AWARD_VALUES.get(type) ?? 0;
    if (summed !== outcome.awardPoints) {
      census.mismatches.push({ season: outcome.season, eventKey: outcome.eventKey, teamKey: outcome.teamKey, awardTypes: types, recorded: outcome.awardPoints, summed });
    }
    if (types.length === 1) {
      const type = types[0]!;
      let tally = census.soleAward.get(type);
      if (tally === undefined) {
        tally = { values: new Map(), firstSeason: outcome.season, lastSeason: outcome.season };
        census.soleAward.set(type, tally);
      }
      tally.values.set(outcome.awardPoints, (tally.values.get(outcome.awardPoints) ?? 0) + 1);
      tally.firstSeason = Math.min(tally.firstSeason, outcome.season);
      tally.lastSeason = Math.max(tally.lastSeason, outcome.season);
    }
  }
}

/**
 * The district point award census over `seasons` (default: every award
 * season), read from the corpus: see `addSeasonToDistrictPointAwardCensus`.
 */
export function districtPointAwardCensus(db: Corpus, seasons: readonly number[] = DISTRICT_REGISTERED_SEASONS): DistrictPointAwardCensus {
  const census = emptyDistrictPointAwardCensus();
  for (const season of seasons) addSeasonToDistrictPointAwardCensus(census, loadDistrictTierOutcomes(db, season), loadAwardInstances(db, season));
  return census;
}

/** The printed DISTRICT POINT AWARD CENSUS block. */
export function districtPointAwardCensusLines(census: DistrictPointAwardCensus): string[] {
  const lines: string[] = [];
  lines.push(`── DISTRICT POINT AWARD CENSUS ── the M-01 values summed over each district tier team event's distinct award types, against the recorded award_points`);
  lines.push(`   team events checked: ${census.teamEvents}; at events with no award rows (excluded): ${census.teamEventsWithoutAwardRows}`);
  lines.push(`   MISMATCHES: ${census.mismatches.length}`);
  for (const m of census.mismatches.slice(0, 20)) {
    lines.push(`     ${m.season} ${m.eventKey} ${m.teamKey}: types [${m.awardTypes.join(", ")}] sum ${m.summed}, recorded ${m.recorded}`);
  }
  if (census.mismatches.length > 20) lines.push(`     ... and ${census.mismatches.length - 20} more`);
  lines.push(`   sole award values (a team's only award at the event): type, M-01 value, recorded values, seasons`);
  for (const [type, tally] of [...census.soleAward].sort((a, b) => a[0] - b[0])) {
    const listed = DISTRICT_POINT_AWARD_VALUES.get(type);
    const values = [...tally.values]
      .sort((a, b) => a[0] - b[0])
      .map(([points, count]) => `${points} x${count}`)
      .join(", ");
    lines.push(`     ${String(type).padStart(3)}  ${(listed === undefined ? "not listed" : `${listed} pts`).padEnd(10)}  ${values}  (${tally.firstSeason} to ${tally.lastSeason})`);
  }
  return lines;
}

export const MEASURED_COMMAND = "npx tsx scripts/measureAwardSlate.ts";
export const MEASURED_DATE = "2026-10-14";

/** The first census season: the corpus's award rows begin in 2016. */
export const FIRST_CENSUS_SEASON = 2016;

/** The seasons the slate is registered for at both tiers. Pinned by equality. */
export const SLATE_REGISTERED_SEASONS: readonly number[] = [2023, 2024, 2025, 2026];

/** The fewest observations a lift class needs before it is stated (Q-06). */
export const MIN_SLATE_LIFT_OBSERVATIONS = MIN_CELL_OBSERVATIONS;

/** A training season needs at least this many award seasons in the corpus before it (Q-07). */
export const MIN_PRIOR_AWARD_SEASONS = MIN_PRIOR_DISTRICT_SEASONS;

/** The smallest field measured: a district event's field, a DCMP championship's union. */
export const MIN_MEASURED_FIELD = 11;

export const IMPACT_AWARD_TYPE = 0;
export const ENGINEERING_INSPIRATION_AWARD_TYPE = 9;
export const ROOKIE_ALL_STAR_AWARD_TYPE = 10;
const QUALIFYING_TYPES: readonly number[] = [IMPACT_AWARD_TYPE, ENGINEERING_INSPIRATION_AWARD_TYPE, ROOKIE_ALL_STAR_AWARD_TYPE];

// ───────────────────────────── the decoration count (Q-09) ─────────────────────────────

/**
 * A TEAM'S DECORATION COUNT for season `season` (Q-09): distinct
 * `(season, event, type)` wins of the 18 point paying team award types
 * (`DISTRICT_POINT_AWARD_VALUES`) at any event, over EVERY award season
 * strictly before `season`. No window. Dean's List, Woodie Flowers,
 * Volunteer, Wildcard and Impact Finalist never count; a win in the priced
 * season never counts. Published under the wire name `priorJudgedAwards`; the
 * measurement, the scorer and the publisher all read this one helper.
 */
export function priorDecorationCount(instances: readonly AwardInstance[], teamKey: string, season: number): number {
  const seen = new Set<string>();
  for (const instance of instances) {
    if (instance.teamKey !== teamKey || instance.year >= season) continue;
    if (!DISTRICT_POINT_AWARD_VALUES.has(instance.awardType)) continue;
    seen.add(`${String(instance.year)}|${instance.eventKey}|${String(instance.awardType)}`);
  }
  return seen.size;
}

// ───────────────────────────── shapes ─────────────────────────────

/** One team at one measured event. */
export interface SlateTeamEvent {
  readonly teamKey: string;
  readonly awardPoints: number;
  readonly rookieState: RookieState;
  /** `priorDecorationCount` at the event's season. */
  readonly priorDecorations: number;
  /** `priorImpactWinCount` at the event's season. */
  readonly priorImpactWins: number;
  /** Every award type the team won AT THIS KEY. */
  readonly wonTypes: ReadonlySet<number>;
  /** Whether the team may win each qualifying award here (district: Q-05; DCMP: `dcmpAwardEligibility`). */
  readonly eligible: { readonly impact: boolean; readonly engineeringInspiration: boolean; readonly rookieAllStar: boolean };
}

/** One measured event of either tier. */
export interface SlateEvent {
  readonly season: number;
  readonly tier: AwardSlateTier;
  readonly districtKey: string;
  readonly eventKey: string;
  readonly week: number | null;
  /** `district` at the district tier; the key structure role at the DCMP tier. */
  readonly role: AwardSlateCountRole;
  /** DCMP tier only: the role by TBA event_type. */
  readonly roleByType?: DcmpEventRole | undefined;
  readonly eventType?: number | undefined;
  readonly field: readonly SlateTeamEvent[];
}

/** One DCMP championship: a single key, or a finals key plus its divisions. */
export interface SlateChampionship {
  readonly season: number;
  readonly districtKey: string;
  readonly key: string;
  readonly events: readonly SlateEvent[];
  readonly measured: boolean;
  readonly reason?: string;
}

/** One lift accumulator: won, expected, observations. */
export interface LiftAccumulator {
  y: number;
  e: number;
  n: number;
}

export interface SlotAccumulators {
  readonly cells: Map<string, LiftAccumulator>;
  readonly primary: Map<string, LiftAccumulator>;
}

// ───────────────────────────── pure rules ─────────────────────────────

/** Whether a team may win award `type` at its event: the qualifying awards read its eligibility, every other type is open. */
export function eligibleForType(team: SlateTeamEvent, type: number): boolean {
  if (type === IMPACT_AWARD_TYPE) return team.eligible.impact;
  if (type === ENGINEERING_INSPIRATION_AWARD_TYPE) return team.eligible.engineeringInspiration;
  if (type === ROOKIE_ALL_STAR_AWARD_TYPE) return team.eligible.rookieAllStar;
  return true;
}

/** Whether a team is in award `type`'s audience. An unslotted type has none. */
export function inTypeAudience(team: SlateTeamEvent, type: number): boolean {
  const slot = TYPE_SLOT.get(type);
  return slot !== undefined && inSlotAudience(slot, team.rookieState);
}

/** Whether a team may win in `slot` at its event: its eligibility for the slot's qualifying award, or open. */
export function eligibleForSlot(team: SlateTeamEvent, slot: AwardSlot): boolean {
  const type = QUALIFYING_SLOT_TYPE[slot];
  return type === undefined ? true : eligibleForType(team, type);
}

/** Whether a team won any type of `slot` at its event. */
export function wonSlot(wonTypes: ReadonlySet<number>, slot: AwardSlot): boolean {
  for (const type of wonTypes) if (TYPE_SLOT.get(type) === slot) return true;
  return false;
}

/** Whether a team won any type of a slot EARLIER in the pricing order than `slot` at its event. */
export function wonEarlierSlot(wonTypes: ReadonlySet<number>, slot: AwardSlot): boolean {
  const index = AWARD_SLOTS.indexOf(slot);
  for (const type of wonTypes) {
    const other = TYPE_SLOT.get(type);
    if (other !== undefined && AWARD_SLOTS.indexOf(other) < index) return true;
  }
  return false;
}

/** One event's count of award `type` (Q-04): distinct winners inside the audience who were eligible there. */
export function typeWinnerCount(event: SlateEvent, type: number): number {
  return event.field.filter((team) => team.wonTypes.has(type) && inTypeAudience(team, type) && eligibleForType(team, type)).length;
}

/** Whether an event's field holds at least one eligible audience member for `type`. */
export function hasEligibleAudience(event: SlateEvent, type: number): boolean {
  return event.field.some((team) => inTypeAudience(team, type) && eligibleForType(team, type));
}

/** The mean count of `type` over the events holding an eligible audience member, or undefined when none does. */
export function meanTypeCount(events: readonly SlateEvent[], type: number): { count: number; events: number } | undefined {
  const counted = events.filter((event) => hasEligibleAudience(event, type));
  if (counted.length === 0) return undefined;
  return { count: counted.reduce((sum, event) => sum + typeWinnerCount(event, type), 0) / counted.length, events: counted.length };
}

/** The roles a tier measures counts at. */
export function countRolesOf(tier: AwardSlateTier): readonly AwardSlateCountRole[] {
  return tier === "district" ? ["district"] : ["single", "division", "finals"];
}

/**
 * THE TRAINING SEASONS of season `season` at a tier (Q-07): every earlier
 * season that holds measured events of the tier and has at least three award
 * seasons in the corpus before it.
 */
export function trainingSeasonsFor(season: number, measuredSeasons: readonly number[], awardSeasons: readonly number[]): number[] {
  return [...new Set(measuredSeasons)]
    .filter((s) => s < season && awardSeasons.filter((a) => a < s).length >= MIN_PRIOR_AWARD_SEASONS)
    .sort((a, b) => a - b);
}

/** Thrown when a declared type was declared earlier but no earlier season holds an event to count it at. */
export class UncountableAwardTypeError extends Error {
  constructor(season: number, tier: AwardSlateTier, role: AwardSlateCountRole, type: number) {
    super(`measureAwardSlate: season ${String(season)} ${tier} ${role}: award type ${String(type)} was declared before but no earlier season holds an event to count it at`);
    this.name = "UncountableAwardTypeError";
  }
}

/**
 * Every declared type's count at each role of a tier, for priced season
 * `season` (Q-04, Q-10). `events` are the tier's MEASURED events; only seasons
 * strictly before `season` are read.
 */
export function measureTypeCounts(
  season: number,
  tier: AwardSlateTier,
  events: readonly SlateEvent[],
  lists: Readonly<Record<number, readonly number[]>>
): Partial<Record<AwardSlateCountRole, Record<number, AwardTypeCount>>> {
  const declared = lists[season] ?? [];
  const prior = events.filter((event) => event.tier === tier && event.season < season);
  const seasonsDesc = [...new Set(prior.map((event) => event.season))].sort((a, b) => b - a);
  const declares = (s: number, type: number): boolean => (lists[s] ?? []).includes(type);
  const out: Partial<Record<AwardSlateCountRole, Record<number, AwardTypeCount>>> = {};
  for (const role of countRolesOf(tier)) {
    const counts: Record<number, AwardTypeCount> = {};
    const fresh: number[] = [];
    for (const type of declared) {
      if (tier === "dcmp" && QUALIFYING_TYPES.includes(type)) continue;
      const declaredBefore = Object.keys(lists)
        .map(Number)
        .some((s) => s < season && declares(s, type));
      if (!declaredBefore) {
        fresh.push(type);
        continue;
      }
      let found: AwardTypeCount | undefined;
      for (const s of seasonsDesc) {
        if (!declares(s, type)) continue;
        const mean = meanTypeCount(
          prior.filter((event) => event.season === s && event.role === role),
          type
        );
        if (mean !== undefined) {
          found = { count: mean.count, source: "role", fromSeason: s, events: mean.events };
          break;
        }
      }
      if (found === undefined && tier === "dcmp") {
        for (const s of seasonsDesc) {
          if (!declares(s, type)) continue;
          const mean = meanTypeCount(
            prior.filter((event) => event.season === s && (event.role === "single" || event.role === "division")),
            type
          );
          if (mean !== undefined) {
            found = { count: mean.count, source: "pooled", fromSeason: s, events: mean.events };
            break;
          }
        }
      }
      if (found === undefined) throw new UncountableAwardTypeError(season, tier, role, type);
      counts[type] = found;
    }
    // THE NEW AWARD PRIOR (Q-10): the mean of the season's other declared
    // types with the same points at this tier and role.
    for (const type of fresh) {
      const points = DISTRICT_POINT_AWARD_VALUES.get(type);
      const same = Object.entries(counts)
        .map(([key, value]) => [Number(key), value] as const)
        .filter(([other]) => DISTRICT_POINT_AWARD_VALUES.get(other) === points);
      if (same.length === 0) throw new UncountableAwardTypeError(season, tier, role, type);
      counts[type] = {
        count: same.reduce((sum, [, value]) => sum + value.count, 0) / same.length,
        source: "new-award",
        fromSeason: Math.max(...same.map(([, value]) => value.fromSeason)),
        events: same.length,
      };
    }
    const sorted: Record<number, AwardTypeCount> = {};
    for (const key of Object.keys(counts).map(Number).sort((a, b) => a - b)) sorted[key] = counts[key]!;
    out[role] = sorted;
  }
  return out;
}

function accumulate(map: Map<string, LiftAccumulator>, key: string, y: number, e: number): void {
  let acc = map.get(key);
  if (acc === undefined) {
    acc = { y: 0, e: 0, n: 0 };
    map.set(key, acc);
  }
  acc.y += y;
  acc.e += e;
  acc.n += 1;
}

/** Adds one pool of one slot: each member's expectation is the pool's winner count over its size. */
export function addSlotPool(accumulators: SlotAccumulators, slot: AwardSlot, pool: readonly { team: SlateTeamEvent; wonTypes: ReadonlySet<number> }[]): void {
  if (pool.length === 0) return;
  const winners = pool.filter((member) => wonSlot(member.wonTypes, slot)).length;
  const e = winners / pool.length;
  for (const member of pool) {
    const keys = slateClassKeys(slot, { priorJudgedAwards: member.team.priorDecorations, priorImpactWins: member.team.priorImpactWins, rookieState: member.team.rookieState });
    const y = wonSlot(member.wonTypes, slot) ? 1 : 0;
    accumulate(accumulators.cells, keys.cell, y, e);
    accumulate(accumulators.primary, keys.primary, y, e);
  }
}

/** A slot's pool over a set of teams (Q-06): its eligible audience minus every team that won an award of an earlier slot there. */
export function slotPool(members: readonly { team: SlateTeamEvent; wonTypes: ReadonlySet<number> }[], slot: AwardSlot): { team: SlateTeamEvent; wonTypes: ReadonlySet<number> }[] {
  return members.filter(
    (member) => inSlotAudience(slot, member.team.rookieState) && eligibleForSlot(member.team, slot) && !wonEarlierSlot(member.wonTypes, slot)
  );
}

function emptySlotAccumulators(): Record<AwardSlot, SlotAccumulators> {
  const out = {} as Record<AwardSlot, SlotAccumulators>;
  for (const slot of AWARD_SLOTS) out[slot] = { cells: new Map(), primary: new Map() };
  return out;
}

/** The union of a championship's teams, first appearance kept, with every type won at any of its keys. */
export function championshipMembers(championship: SlateChampionship): { team: SlateTeamEvent; wonTypes: Set<number> }[] {
  const byTeam = new Map<string, { team: SlateTeamEvent; wonTypes: Set<number> }>();
  for (const event of championship.events) {
    for (const team of event.field) {
      const existing = byTeam.get(team.teamKey);
      if (existing === undefined) byTeam.set(team.teamKey, { team, wonTypes: new Set(team.wonTypes) });
      else for (const type of team.wonTypes) existing.wonTypes.add(type);
    }
  }
  return [...byTeam.values()];
}

/** Every slot's lift accumulators at a tier over the training seasons (Q-06, Q-07). */
export function measureSlotLifts(
  tier: AwardSlateTier,
  trainingSeasons: readonly number[],
  events: readonly SlateEvent[],
  championships: readonly SlateChampionship[]
): Record<AwardSlot, SlotAccumulators> {
  const out = emptySlotAccumulators();
  const training = new Set(trainingSeasons);
  if (tier === "district") {
    for (const event of events) {
      if (event.tier !== "district" || !training.has(event.season)) continue;
      const members = event.field.map((team) => ({ team, wonTypes: team.wonTypes }));
      for (const slot of AWARD_SLOTS) addSlotPool(out[slot], slot, slotPool(members, slot));
    }
    return out;
  }
  for (const championship of championships) {
    if (!championship.measured || !training.has(championship.season)) continue;
    const members = championshipMembers(championship);
    for (const slot of AWARD_SLOTS) {
      if (QUALIFYING_SLOT_TYPE[slot] === undefined) continue;
      addSlotPool(out[slot], slot, slotPool(members, slot));
    }
    for (const event of championship.events) {
      if (event.role === "finals") continue;
      const keyMembers = event.field.map((team) => ({ team, wonTypes: team.wonTypes }));
      for (const slot of AWARD_SLOTS) {
        if (QUALIFYING_SLOT_TYPE[slot] !== undefined) continue;
        addSlotPool(out[slot], slot, slotPool(keyMembers, slot));
      }
    }
  }
  return out;
}

/** A lift accumulator as a stated lift, or `undefined` below the observation bar. */
export function toLift(acc: LiftAccumulator | undefined): SlateLift | undefined {
  if (acc === undefined || acc.n < MIN_SLATE_LIFT_OBSERVATIONS || !(acc.e > 0)) return undefined;
  return { lift: acc.y / acc.e, n: acc.n };
}

function liftRecord(map: ReadonlyMap<string, LiftAccumulator>): Record<string, SlateLift> {
  const out: Record<string, SlateLift> = {};
  for (const key of [...map.keys()].sort()) {
    const lift = toLift(map.get(key));
    if (lift !== undefined) out[key] = lift;
  }
  return out;
}

/** One season's measurement at one tier, before it becomes a committed literal. */
export interface TierSeasonMeasurement {
  readonly season: number;
  readonly tier: AwardSlateTier;
  readonly trainingSeasons: readonly number[];
  readonly counts: Partial<Record<AwardSlateCountRole, Record<number, AwardTypeCount>>>;
  readonly lifts: Record<AwardSlot, SlotAccumulators>;
  readonly registered: boolean;
  readonly registrationReason?: string;
}

/** What one tier season's measurement reads. */
export interface SlateMeasurementInput {
  /** Measured events of both tiers. */
  readonly events: readonly SlateEvent[];
  /** DCMP championships, measured or not. */
  readonly championships: readonly SlateChampionship[];
  /** The corpus's award seasons. */
  readonly awardSeasons: readonly number[];
  /** The census season award lists. */
  readonly lists: Readonly<Record<number, readonly number[]>>;
}

export function measureTierSeason(season: number, tier: AwardSlateTier, input: SlateMeasurementInput): TierSeasonMeasurement {
  const measuredSeasons = input.events.filter((event) => event.tier === tier).map((event) => event.season);
  const trainingSeasons = trainingSeasonsFor(season, measuredSeasons, input.awardSeasons);
  let counts: Partial<Record<AwardSlateCountRole, Record<number, AwardTypeCount>>> = {};
  let reason: string | undefined;
  try {
    counts = measureTypeCounts(season, tier, input.events, input.lists);
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err);
  }
  if (input.lists[season] === undefined) reason = `no census award list for ${String(season)}`;
  if (trainingSeasons.length === 0) reason = reason ?? "no training season";
  const lifts = measureSlotLifts(tier, trainingSeasons, input.events, input.championships);
  return { season, tier, trainingSeasons, counts, lifts, registered: reason === undefined, ...(reason === undefined ? {} : { registrationReason: reason }) };
}

/** One registered measurement as the committed table shape. */
export function toSeasonTables(measurement: TierSeasonMeasurement): AwardSlateSeasonTables {
  if (!measurement.registered) throw new Error(`${measurement.tier} ${String(measurement.season)} is not registered: ${measurement.registrationReason ?? ""}`);
  const lifts = {} as Record<AwardSlot, SlateSlotLifts>;
  for (const slot of AWARD_SLOTS) lifts[slot] = { cells: liftRecord(measurement.lifts[slot].cells), primary: liftRecord(measurement.lifts[slot].primary) };
  return { trainingSeasons: [...measurement.trainingSeasons], counts: measurement.counts, lifts };
}

/** Groups one district season's DCMP tier events into championships by key structure, and applies the degenerate filter. */
export function groupChampionships(events: readonly SlateEvent[]): SlateChampionship[] {
  const out: SlateChampionship[] = [];
  const byDistrict = new Map<string, SlateEvent[]>();
  for (const event of events) {
    if (event.tier !== "dcmp") continue;
    const key = `${String(event.season)}|${event.districtKey}`;
    const list = byDistrict.get(key);
    if (list === undefined) byDistrict.set(key, [event]);
    else list.push(event);
  }
  for (const list of byDistrict.values()) {
    const parents = list.filter((event) => event.role !== "division");
    for (const parent of parents) {
      const members = [parent, ...list.filter((event) => event.role === "division" && event.eventKey.startsWith(parent.eventKey))];
      const teams = new Set(members.flatMap((event) => event.field.map((team) => team.teamKey)));
      const points = members.reduce((sum, event) => sum + event.field.reduce((inner, team) => inner + team.awardPoints, 0), 0);
      const measured = teams.size >= MIN_MEASURED_FIELD && points > 0;
      out.push({
        season: parent.season,
        districtKey: parent.districtKey,
        key: parent.eventKey,
        events: members,
        measured,
        ...(measured ? {} : { reason: `${String(teams.size)} team(s) across its keys, ${String(points)} award points` }),
      });
    }
  }
  return out.sort((a, b) => a.season - b.season || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** TBA event_type roles: 5 is a division; 2 with a type 5 child (its key plus digits) is a finals; 2 otherwise a single. */
export function rolesByEventType(eventTypes: ReadonlyMap<string, number>, keys: readonly string[]): Map<string, DcmpEventRole | undefined> {
  const divisions = [...eventTypes].filter(([, type]) => type === 5).map(([key]) => key);
  const out = new Map<string, DcmpEventRole | undefined>();
  for (const key of keys) {
    const type = eventTypes.get(key);
    if (type === 5) out.set(key, "division");
    else if (type === 2) {
      const hasChild = divisions.some((division) => division.length > key.length && division.startsWith(key) && /^\d+$/.test(division.slice(key.length)));
      out.set(key, hasChild ? "finals" : "single");
    } else out.set(key, undefined);
  }
  return out;
}

// ───────────────────────────── corpus reads ─────────────────────────────

interface RankingRow {
  readonly districtKey: string;
  readonly district: boolean;
  readonly eventKey: string;
  readonly teamKey: string;
  readonly awardPoints: number;
}

function loadRankingRows(db: Corpus, season: number): RankingRow[] {
  const out: RankingRow[] = [];
  for (const district of selectDistrictsForYear(db, season)) {
    for (const ranking of selectDistrictRankings(db, district.districtKey)) {
      let entries: unknown;
      try {
        entries = JSON.parse(ranking.eventPointsRaw);
      } catch {
        continue;
      }
      if (!Array.isArray(entries)) continue;
      for (const entry of entries as Record<string, unknown>[]) {
        if (typeof entry !== "object" || entry === null) continue;
        if (typeof entry["event_key"] !== "string" || typeof entry["award_points"] !== "number" || typeof entry["district_cmp"] !== "boolean") continue;
        out.push({
          districtKey: district.districtKey,
          district: !entry["district_cmp"],
          eventKey: entry["event_key"],
          teamKey: ranking.teamKey,
          awardPoints: entry["award_points"],
        });
      }
    }
  }
  return out;
}

/** One season's census, beyond its measured events. */
export interface SlateSeasonCensus {
  readonly season: number;
  /** Point paying types won at district tier events, and at DCMP tier events, that season. */
  readonly districtTierTypes: readonly number[];
  readonly dcmpTierTypes: readonly number[];
  /** Teams winning the same qualifying award at two or more district tier events, per type. */
  readonly repeatWinners: Readonly<Record<number, number>>;
  /** Teams winning Impact at one district tier event and Engineering Inspiration at another. */
  readonly crossImpactEi: number;
  /** Measured district tier team events touching a null week (their own or another of the team's district events). */
  readonly nullWeekTeamEvents: number;
  readonly duplicateFieldRows: number;
  /** District tier events dropped: no award rows, or a field below 11. */
  readonly droppedDistrictEvents: { readonly noAwardRows: number; readonly smallField: number };
}

export interface AwardSlateCorpusLoad {
  readonly awardSeasons: readonly number[];
  readonly seasons: readonly SlateSeasonCensus[];
  /** Measured district tier events, plus every DCMP tier event (measured or not: see `championships`). */
  readonly districtEvents: readonly SlateEvent[];
  readonly dcmpEvents: readonly SlateEvent[];
  readonly championships: readonly SlateChampionship[];
}

/** The census lists: point paying types won at district tier events, per season. */
export function censusLists(load: AwardSlateCorpusLoad): Record<number, readonly number[]> {
  const out: Record<number, readonly number[]> = {};
  for (const census of load.seasons) if (census.districtTierTypes.length > 0) out[census.season] = census.districtTierTypes;
  return out;
}

/** The measurement input over a corpus load: measured district events and the DCMP events of measured championships. */
export function measurementInput(load: AwardSlateCorpusLoad, lists: Readonly<Record<number, readonly number[]>> = censusLists(load)): SlateMeasurementInput {
  const measuredDcmp = load.championships.filter((championship) => championship.measured).flatMap((championship) => championship.events);
  return { events: [...load.districtEvents, ...measuredDcmp], championships: load.championships, awardSeasons: load.awardSeasons, lists };
}

export function loadAwardSlateCorpus(db: Corpus): AwardSlateCorpusLoad {
  const rookieYears = loadRookieYears(db);
  const awardSeasons = (db.prepare(`SELECT DISTINCT year FROM event_awards_all ORDER BY year`).all() as { year: number }[]).map((row) => row.year);
  const instancesByTeam = new Map<string, AwardInstance[]>();
  const instancesBySeason = new Map<number, AwardInstance[]>();
  for (const year of awardSeasons) {
    const instances = loadAwardInstances(db, year);
    instancesBySeason.set(year, instances);
    for (const instance of instances) {
      if (instance.teamKey === null) continue;
      const list = instancesByTeam.get(instance.teamKey);
      if (list === undefined) instancesByTeam.set(instance.teamKey, [instance]);
      else list.push(instance);
    }
  }
  const districtSeasons = (db.prepare(`SELECT DISTINCT year FROM districts ORDER BY year`).all() as { year: number }[])
    .map((row) => row.year)
    .filter((year) => year >= FIRST_CENSUS_SEASON);

  const seasons: SlateSeasonCensus[] = [];
  const districtEvents: SlateEvent[] = [];
  const dcmpEvents: SlateEvent[] = [];
  for (const season of districtSeasons) {
    const seasonInstances = instancesBySeason.get(season) ?? [];
    const eventsWithAwardRows = new Set(seasonInstances.map((instance) => instance.eventKey));
    const wonAt = new Map<string, Set<number>>();
    const seasonByTeam = new Map<string, AwardInstance[]>();
    for (const instance of seasonInstances) {
      if (instance.teamKey === null) continue;
      const key = `${instance.eventKey}|${instance.teamKey}`;
      const set = wonAt.get(key);
      if (set === undefined) wonAt.set(key, new Set([instance.awardType]));
      else set.add(instance.awardType);
      const list = seasonByTeam.get(instance.teamKey);
      if (list === undefined) seasonByTeam.set(instance.teamKey, [instance]);
      else list.push(instance);
    }
    const rookieState = (teamKey: string): RookieState => rookieStateFor(rookieYears.get(teamKey) ?? null, season);
    const priorCounts = (teamKey: string): { priorDecorations: number; priorImpactWins: number } => {
      const instances = instancesByTeam.get(teamKey) ?? [];
      return { priorDecorations: priorDecorationCount(instances, teamKey, season), priorImpactWins: priorImpactWinCount(instances, teamKey, season) };
    };
    const rows = loadRankingRows(db, season);
    const eventRows = db.prepare(`SELECT event_key, event_type, week FROM events WHERE year = ?`).all(season) as { event_key: string; event_type: number; week: number | null }[];
    const eventTypes = new Map(eventRows.map((row) => [row.event_key, row.event_type]));
    const weeks = new Map(eventRows.map((row) => [row.event_key, row.week]));

    const districtTierKeys = new Set(rows.filter((row) => row.district).map((row) => row.eventKey));
    const dcmpTierKeys = new Set(rows.filter((row) => !row.district).map((row) => row.eventKey));
    const typesAt = (keys: ReadonlySet<string>): number[] =>
      [...new Set(seasonInstances.filter((instance) => instance.teamKey !== null && keys.has(instance.eventKey) && DISTRICT_POINT_AWARD_VALUES.has(instance.awardType)).map((instance) => instance.awardType))].sort(
        (a, b) => a - b
      );

    // Repeat and cross winners at the district tier.
    const districtWins = new Map<string, Map<number, Set<string>>>();
    for (const instance of seasonInstances) {
      if (instance.teamKey === null || !districtTierKeys.has(instance.eventKey)) continue;
      let byType = districtWins.get(instance.teamKey);
      if (byType === undefined) {
        byType = new Map();
        districtWins.set(instance.teamKey, byType);
      }
      const events = byType.get(instance.awardType) ?? new Set<string>();
      events.add(instance.eventKey);
      byType.set(instance.awardType, events);
    }
    const repeatWinners: Record<number, number> = {};
    for (const type of QUALIFYING_TYPES) repeatWinners[type] = [...districtWins.values()].filter((byType) => (byType.get(type)?.size ?? 0) >= 2).length;
    const crossImpactEi = [...districtWins.values()].filter((byType) => {
      const impact = byType.get(IMPACT_AWARD_TYPE);
      const ei = byType.get(ENGINEERING_INSPIRATION_AWARD_TYPE);
      return impact !== undefined && ei !== undefined && [...impact].some((key) => !ei.has(key));
    }).length;

    const rowsByDistrict = new Map<string, RankingRow[]>();
    for (const row of rows) {
      const list = rowsByDistrict.get(row.districtKey);
      if (list === undefined) rowsByDistrict.set(row.districtKey, [row]);
      else list.push(row);
    }
    // Each district's eligibility teams: its teams, their district tier events, their held awards.
    const teamsByDistrict = new Map<string, DcmpEligibilityTeam[]>();
    for (const [districtKey, districtRows] of rowsByDistrict) {
      const order: string[] = [];
      const events = new Map<string, Set<string>>();
      for (const row of districtRows) {
        if (!events.has(row.teamKey)) {
          events.set(row.teamKey, new Set());
          order.push(row.teamKey);
        }
        if (row.district) events.get(row.teamKey)!.add(row.eventKey);
      }
      teamsByDistrict.set(
        districtKey,
        order.map((teamKey) => ({
          teamKey,
          rookie: rookieState(teamKey) === "rookie",
          heldAwards: (seasonByTeam.get(teamKey) ?? []).map((instance) => ({ eventKey: instance.eventKey, awardType: instance.awardType })),
          districtEventKeys: [...events.get(teamKey)!],
        }))
      );
    }

    // DISTRICT TIER: measured events, eligibility through the shipped helper.
    let duplicateFieldRows = 0;
    let nullWeekTeamEvents = 0;
    let noAwardRows = 0;
    let smallField = 0;
    const districtEligibility = new Map<string, Map<string, { impact: number; engineeringInspiration: number; rookieAllStar: number }>>();
    const districtEligibilityAt = (districtKey: string, eventKey: string): Map<string, { impact: number; engineeringInspiration: number; rookieAllStar: number }> => {
      const key = `${districtKey}|${eventKey}`;
      let cached = districtEligibility.get(key);
      if (cached === undefined) {
        // Every award is final, so no open event exists and no weight is read:
        // the zero profile stands in for every team.
        const list = districtAwardEligibility({
          season,
          eventKey,
          teams: teamsByDistrict.get(districtKey) ?? [],
          weekOf: (other) => weeks.get(other) ?? null,
          awardFinal: () => true,
          profileOf: () => ZERO_AWARD_PROFILE,
        });
        cached = new Map(list.map((entry) => [entry.teamKey, entry] as const));
        districtEligibility.set(key, cached);
      }
      return cached;
    };
    const districtRowsByEvent = new Map<string, RankingRow[]>();
    for (const row of rows) {
      if (!row.district) continue;
      const list = districtRowsByEvent.get(row.eventKey);
      if (list === undefined) districtRowsByEvent.set(row.eventKey, [row]);
      else list.push(row);
    }
    for (const [eventKey, eventRowList] of [...districtRowsByEvent].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (!eventsWithAwardRows.has(eventKey)) {
        noAwardRows++;
        continue;
      }
      const seen = new Set<string>();
      const field: SlateTeamEvent[] = [];
      for (const row of eventRowList) {
        if (seen.has(row.teamKey)) {
          duplicateFieldRows++;
          continue;
        }
        seen.add(row.teamKey);
        const eligibility = districtEligibilityAt(row.districtKey, eventKey).get(row.teamKey);
        const ownEvents = teamsByDistrict.get(row.districtKey)?.find((team) => team.teamKey === row.teamKey)?.districtEventKeys ?? [];
        if (weeks.get(eventKey) == null || ownEvents.some((other) => weeks.get(other) == null)) nullWeekTeamEvents++;
        field.push({
          teamKey: row.teamKey,
          awardPoints: row.awardPoints,
          rookieState: rookieState(row.teamKey),
          ...priorCounts(row.teamKey),
          wonTypes: wonAt.get(`${eventKey}|${row.teamKey}`) ?? new Set<number>(),
          eligible: {
            impact: (eligibility?.impact ?? 1) > 0,
            engineeringInspiration: (eligibility?.engineeringInspiration ?? 1) > 0,
            rookieAllStar: (eligibility?.rookieAllStar ?? 1) > 0,
          },
        });
      }
      if (field.length < MIN_MEASURED_FIELD) {
        smallField++;
        continue;
      }
      districtEvents.push({ season, tier: "district", districtKey: eventRowList[0]!.districtKey, eventKey, week: weeks.get(eventKey) ?? null, role: "district", field });
    }

    // DCMP TIER: every event, eligibility through dcmpAwardEligibility (261014-i8i).
    for (const [districtKey, districtRows] of [...rowsByDistrict].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      // Every award is final: no weight is read (see the district tier above).
      const eligibility = dcmpAwardEligibility({ season, teams: teamsByDistrict.get(districtKey) ?? [], awardFinal: () => true, profileOf: () => ZERO_AWARD_PROFILE });
      const dcmpKeys = [...new Set(districtRows.filter((row) => !row.district).map((row) => row.eventKey))].sort();
      const roles = dcmpEventRoles(dcmpKeys);
      const typeRoles = rolesByEventType(eventTypes, dcmpKeys);
      for (const eventKey of dcmpKeys) {
        const seen = new Set<string>();
        const field: SlateTeamEvent[] = [];
        for (const row of districtRows) {
          if (row.district || row.eventKey !== eventKey) continue;
          if (seen.has(row.teamKey)) {
            duplicateFieldRows++;
            continue;
          }
          seen.add(row.teamKey);
          field.push({
            teamKey: row.teamKey,
            awardPoints: row.awardPoints,
            rookieState: rookieState(row.teamKey),
            ...priorCounts(row.teamKey),
            wonTypes: wonAt.get(`${eventKey}|${row.teamKey}`) ?? new Set<number>(),
            eligible: {
              impact: dcmpEligibilityChance(eligibility, row.teamKey, 0) > 0,
              engineeringInspiration: dcmpEligibilityChance(eligibility, row.teamKey, 9) > 0,
              rookieAllStar: dcmpEligibilityChance(eligibility, row.teamKey, 10) > 0,
            },
          });
        }
        dcmpEvents.push({
          season,
          tier: "dcmp",
          districtKey,
          eventKey,
          week: weeks.get(eventKey) ?? null,
          role: roles.get(eventKey)!,
          roleByType: typeRoles.get(eventKey),
          eventType: eventTypes.get(eventKey),
          field,
        });
      }
    }

    seasons.push({
      season,
      districtTierTypes: typesAt(districtTierKeys),
      dcmpTierTypes: typesAt(dcmpTierKeys),
      repeatWinners,
      crossImpactEi,
      nullWeekTeamEvents,
      duplicateFieldRows,
      droppedDistrictEvents: { noAwardRows, smallField },
    });
  }
  return { awardSeasons, seasons, districtEvents, dcmpEvents, championships: groupChampionships(dcmpEvents) };
}

// ───────────────────────────── the audience census ─────────────────────────────

/** Per type and tier: winners by rookie state, and every veteran winner of a rookie only type. */
export interface AudienceCensus {
  readonly byTier: Record<AwardSlateTier, Map<number, { rookie: number; veteran: number; unknown: number }>>;
  readonly outsideAudience: { tier: AwardSlateTier; season: number; eventKey: string; teamKey: string; type: number; rookieState: RookieState }[];
}

export function audienceCensus(input: SlateMeasurementInput): AudienceCensus {
  const byTier: Record<AwardSlateTier, Map<number, { rookie: number; veteran: number; unknown: number }>> = { district: new Map(), dcmp: new Map() };
  const outsideAudience: AudienceCensus["outsideAudience"] = [];
  for (const event of input.events) {
    for (const team of event.field) {
      for (const type of team.wonTypes) {
        if (!TYPE_SLOT.has(type)) continue;
        const tally = byTier[event.tier].get(type) ?? { rookie: 0, veteran: 0, unknown: 0 };
        tally[team.rookieState]++;
        byTier[event.tier].set(type, tally);
        if (!inTypeAudience(team, type)) outsideAudience.push({ tier: event.tier, season: event.season, eventKey: event.eventKey, teamKey: team.teamKey, type, rookieState: team.rookieState });
      }
    }
  }
  return { byTier, outsideAudience };
}

// ───────────────────────────── reporting ─────────────────────────────

function liftLine(label: string, acc: LiftAccumulator | undefined): string {
  if (acc === undefined) return `         ${label}: no observations`;
  const stated = toLift(acc);
  if (stated === undefined)
    return `         ${label}: n=${String(acc.n)} won ${String(acc.y)} expected ${acc.e.toFixed(3)}  CANNOT BE SCORED (below ${String(MIN_SLATE_LIFT_OBSERVATIONS)})`;
  return `         ${label}: n=${String(acc.n)} won ${String(acc.y)} expected ${acc.e.toFixed(3)} lift ${stated.lift.toFixed(4)}`;
}

function reportCensus(load: AwardSlateCorpusLoad, input: SlateMeasurementInput, db: Corpus): void {
  console.log(`── POINT VALUE CROSS CHECK ──`);
  for (const line of districtPointAwardCensusLines(districtPointAwardCensus(db))) console.log(line);
  console.log(``);
  console.log(`── SEASON AWARD LIST CENSUS ── point paying types won per season, district tier (SEASON_AWARD_TYPES must equal it) and DCMP tier`);
  let previous: readonly number[] | undefined;
  for (const census of load.seasons) {
    if (census.districtTierTypes.length === 0) {
      console.log(`   ${String(census.season)}: no district tier award rows`);
      continue;
    }
    const added = previous === undefined ? [] : census.districtTierTypes.filter((type) => !previous!.includes(type));
    const dropped = previous === undefined ? [] : previous.filter((type) => !census.districtTierTypes.includes(type));
    console.log(
      `   SEASON TYPES ${String(census.season)}: ${census.districtTierTypes.join(", ")}   (added ${added.join(", ") || "none"}; dropped ${dropped.join(", ") || "none"})`
    );
    const dcmpOnly = census.dcmpTierTypes.filter((type) => !census.districtTierTypes.includes(type));
    const dcmpMissing = census.districtTierTypes.filter((type) => !census.dcmpTierTypes.includes(type));
    console.log(`      DCMP tier ${String(census.season)}: ${census.dcmpTierTypes.join(", ") || "none"}   (not on the district list: ${dcmpOnly.join(", ") || "none"}; not given at the DCMP: ${dcmpMissing.join(", ") || "none"})`);
    previous = census.districtTierTypes;
  }
  console.log(``);
  const audience = audienceCensus(input);
  console.log(`── AUDIENCE CENSUS ── winners per type by rookie state, measured events (rookie / veteran / unknown)`);
  for (const tier of ["district", "dcmp"] as const) {
    const entries = [...audience.byTier[tier]].sort((a, b) => a[0] - b[0]);
    console.log(`   ${tier}: ${entries.map(([type, t]) => `${String(type)} (${TYPE_SLOT.get(type)!}) ${String(t.rookie)}/${String(t.veteran)}/${String(t.unknown)}`).join("; ")}`);
  }
  console.log(`   winners outside their type's audience (listed, left out of counts and pools): ${String(audience.outsideAudience.length)}`);
  for (const entry of audience.outsideAudience) {
    console.log(`      ${entry.tier} ${String(entry.season)} ${entry.eventKey} ${entry.teamKey} won type ${String(entry.type)} as ${entry.rookieState}`);
  }
  console.log(``);
  console.log(`── REPEAT WINNER CENSUS ── teams winning the SAME award at two or more district tier events in one season`);
  for (const census of load.seasons) {
    console.log(
      `   ${String(census.season)}: Impact ${String(census.repeatWinners[IMPACT_AWARD_TYPE] ?? 0)}, Engineering Inspiration ${String(census.repeatWinners[ENGINEERING_INSPIRATION_AWARD_TYPE] ?? 0)}, Rookie All Star ${String(census.repeatWinners[ROOKIE_ALL_STAR_AWARD_TYPE] ?? 0)}; cross (Impact at one, Engineering Inspiration at another) ${String(census.crossImpactEi)}`
    );
  }
  console.log(``);
  console.log(`── NULL WEEK CENSUS ── measured district tier team events touching a null week (never earlier, Q-05)`);
  console.log(`   ${load.seasons.map((census) => `${String(census.season)} ${String(census.nullWeekTeamEvents)}`).join(", ")}`);
  console.log(``);
  console.log(`── EVENT CENSUS ──`);
  for (const census of load.seasons) {
    const district = load.districtEvents.filter((event) => event.season === census.season);
    const championships = load.championships.filter((championship) => championship.season === census.season);
    console.log(
      `   ${String(census.season)}: district tier ${String(district.length)} measured events, ${String(district.reduce((sum, event) => sum + event.field.length, 0))} team events ` +
        `(dropped ${String(census.droppedDistrictEvents.noAwardRows)} with no award rows, ${String(census.droppedDistrictEvents.smallField)} below ${String(MIN_MEASURED_FIELD)} teams); ` +
        `DCMP ${String(championships.filter((c) => c.measured).length)} measured championship(s) of ${String(championships.length)}${census.duplicateFieldRows > 0 ? `; ${String(census.duplicateFieldRows)} duplicate field row(s) dropped` : ""}`
    );
  }
  const disagreements = load.dcmpEvents.filter((event) => event.role !== event.roleByType);
  console.log(`   DCMP role agreement: key structure and event_type agree on ${String(load.dcmpEvents.length - disagreements.length)} of ${String(load.dcmpEvents.length)} DCMP tier events`);
  const removed = load.championships.filter((championship) => !championship.measured);
  console.log(`   DCMP degenerate filter removed: ${removed.map((c) => `${String(c.season)} ${c.key} (${c.reason ?? ""})`).join("; ") || "none"}`);
}

function reportTierSeason(measurement: TierSeasonMeasurement): void {
  console.log(
    `${measurement.tier.toUpperCase()} TIER ${String(measurement.season)}: training seasons ${measurement.trainingSeasons.join(", ") || "none"}${measurement.registered ? "" : `  NOT REGISTERED: ${measurement.registrationReason ?? ""}`}`
  );
  for (const role of countRolesOf(measurement.tier)) {
    const counts = measurement.counts[role];
    if (counts === undefined) continue;
    const slotSums: Partial<Record<AwardSlot, number>> = {};
    for (const [type, entry] of Object.entries(counts)) {
      const slot = TYPE_SLOT.get(Number(type))!;
      slotSums[slot] = (slotSums[slot] ?? 0) + entry.count;
    }
    console.log(`   counts, ${role}: ${AWARD_SLOTS.filter((slot) => slotSums[slot] !== undefined).map((slot) => `${slot} ${slotSums[slot]!.toFixed(4)}`).join(", ")}`);
    for (const [type, entry] of Object.entries(counts)) {
      console.log(
        `      type ${type.padStart(2)} (${TYPE_SLOT.get(Number(type))!}): ${entry.count.toFixed(4)} per event (${entry.source}, ${String(entry.fromSeason)}, ${entry.source === "new-award" ? `mean of ${String(entry.events)} same point type(s)` : `${String(entry.events)} event(s)`})`
      );
    }
  }
  for (const slot of AWARD_SLOTS) {
    const acc = measurement.lifts[slot];
    console.log(`   ${slot} lifts by cell:`);
    for (const key of [...acc.cells.keys()].sort()) console.log(liftLine(key, acc.cells.get(key)));
    console.log(`   ${slot} lifts by primary key, pooled:`);
    for (const key of [...acc.primary.keys()].sort()) console.log(liftLine(key, acc.primary.get(key)));
  }
}

function literalLift(lift: SlateLift): string {
  return `{ lift: ${String(lift.lift)}, n: ${String(lift.n)} }`;
}

function literalLiftRecord(record: Readonly<Record<string, SlateLift>>): string {
  const entries = Object.entries(record);
  if (entries.length === 0) return `{}`;
  return `{ ${entries.map(([key, lift]) => `${JSON.stringify(key)}: ${literalLift(lift)}`).join(", ")} }`;
}

function literalTables(tables: AwardSlateSeasonTables, tier: AwardSlateTier, indent: string): string[] {
  const lines: string[] = [];
  lines.push(`${indent}trainingSeasons: [${tables.trainingSeasons.join(", ")}],`);
  lines.push(`${indent}counts: {`);
  for (const role of countRolesOf(tier)) {
    const counts = tables.counts[role];
    if (counts === undefined) continue;
    lines.push(`${indent}  ${role}: {`);
    for (const [type, entry] of Object.entries(counts)) {
      lines.push(`${indent}    ${type}: { count: ${String(entry.count)}, source: "${entry.source}", fromSeason: ${String(entry.fromSeason)}, events: ${String(entry.events)} },`);
    }
    lines.push(`${indent}  },`);
  }
  lines.push(`${indent}},`);
  lines.push(`${indent}lifts: {`);
  for (const slot of AWARD_SLOTS) {
    lines.push(`${indent}  ${slot}: {`);
    lines.push(`${indent}    cells: ${literalLiftRecord(tables.lifts[slot].cells)},`);
    lines.push(`${indent}    primary: ${literalLiftRecord(tables.lifts[slot].primary)},`);
    lines.push(`${indent}  },`);
  }
  lines.push(`${indent}},`);
  return lines;
}

/** The committed literal block, between the GENERATED markers of `awardSlate.ts`. */
export function literalBlock(lists: Readonly<Record<number, readonly number[]>>, tables: Readonly<Record<AwardSlateTier, ReadonlyMap<number, AwardSlateSeasonTables>>>): string {
  const lines: string[] = [`// BEGIN GENERATED: measureAwardSlate`];
  lines.push(`export const SEASON_AWARD_TYPES: Readonly<Record<number, readonly number[]>> = {`);
  for (const season of Object.keys(lists).map(Number).sort((a, b) => a - b)) lines.push(`  ${String(season)}: [${lists[season]!.join(", ")}],`);
  lines.push(`};`);
  lines.push(``);
  lines.push(`export const AWARD_SLATE_TABLES: AwardSlateTables = {`);
  for (const tier of ["district", "dcmp"] as const) {
    lines.push(`  ${tier}: {`);
    for (const [season, seasonTables] of [...tables[tier]].sort((a, b) => a[0] - b[0])) {
      lines.push(`    ${String(season)}: {`);
      lines.push(...literalTables(seasonTables, tier, "      "));
      lines.push(`    },`);
    }
    lines.push(`  },`);
  }
  lines.push(`};`);
  lines.push(`// END GENERATED: measureAwardSlate`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  console.log(`AWARD SLATE: census of real district event and DCMP results, and the walk forward slate tables for both tiers.`);
  console.log(`command:    ${MEASURED_COMMAND}`);
  console.log(`registered: ${SLATE_REGISTERED_SEASONS.join(", ")} at both tiers`);
  console.log(
    `bar:        ${String(MIN_SLATE_LIFT_OBSERVATIONS)} observations per lift class; fields of at least ${String(MIN_MEASURED_FIELD)}; training seasons need ${String(MIN_PRIOR_AWARD_SEASONS)} award seasons before them`
  );
  console.log(`credential: none. Read only corpus, no network request, no environment variable.`);
  console.log(``);
  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    const load = loadAwardSlateCorpus(db);
    const lists = censusLists(load);
    const input = measurementInput(load, lists);
    reportCensus(load, input, db);
    console.log(``);
    const tables: Record<AwardSlateTier, Map<number, AwardSlateSeasonTables>> = { district: new Map(), dcmp: new Map() };
    for (const tier of ["district", "dcmp"] as const) {
      for (const season of SLATE_REGISTERED_SEASONS) {
        const measurement = measureTierSeason(season, tier, input);
        reportTierSeason(measurement);
        console.log(``);
        if (measurement.registered) tables[tier].set(season, toSeasonTables(measurement));
      }
    }
    console.log(`LITERAL BLOCK (written into packages/core/districts/awardSlate.ts between the GENERATED markers):`);
    console.log(literalBlock(lists, tables));
  } finally {
    db.close();
  }
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("measure:award-slate failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
