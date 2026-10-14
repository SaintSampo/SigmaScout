/**
 * DCMP AWARD SLATE MEASUREMENT (quick task 261014-i8i): the census of what
 * District Championships actually give, and the walk forward tables
 * `packages/core/districts/dcmpAwardSlate.ts` prices DCMP awards from.
 *
 *     npx tsx scripts/measureDcmpAwardSlate.ts        (or pnpm measure:dcmp-award-slate)
 *
 * ---------------------------------------------------------------------------
 * THE CENSUS (every season 2016 onward)
 * ---------------------------------------------------------------------------
 *
 * Every DCMP tier event (a `district_rankings` entry whose own `district_cmp`
 * is true): its TBA event_type, its role by key structure (`dcmpEventRoles`)
 * and by event_type (5 is a division; 2 with a type 5 child is a finals; 2
 * otherwise is a single), its field, its Impact, Engineering Inspiration and
 * Rookie All Star winners and how many were eligible, and its judged winning
 * team count (teams with award points above 0 that won no consuming award
 * there). Per championship, the consuming counts beside the mean of
 * `dcmpAwardCountDistribution`. Plus the rookie Engineering Inspiration census
 * at both tiers, every ineligible winner, and the championships the
 * degenerate filter removed.
 *
 * A CHAMPIONSHIP is a single key, or a finals key plus its divisions. It is
 * MEASURED only when the union of its keys' fields holds at least 11 teams and
 * its award points total above 0. That removes 2020, when every championship
 * listed one to five teams, all award winners, without a season list.
 *
 * ---------------------------------------------------------------------------
 * THE TABLES (each registered season Y)
 * ---------------------------------------------------------------------------
 *
 * From measured championships of seasons STRICTLY BEFORE Y only:
 *  - the judged anchor per role: the mean judged winning teams per event of
 *    that role in the most recent earlier season holding the role, else the
 *    pooled single plus division mean of the most recent earlier season
 *    holding either;
 *  - the Impact lift per decorationBucket(prior Impact wins), over each
 *    championship's Impact eligible teams;
 *  - the Engineering Inspiration lift per decorationBucket(prior judged
 *    awards), over each championship's eligible veterans;
 *  - the judged lift per cellKey(decorationBucket(prior judged awards), rookie
 *    state), plus bucket pooled rows, over each single or division event's
 *    teams that won no consuming award there.
 *
 * A LIFT is won over expected: for each team event in a pool, e is the pool's
 * actual winner count over the pool's size and y is whether it won; the lift
 * of a class is sum y over sum e. The winner count is the winners INSIDE the
 * pool, so an ineligible winner (one in the corpus) raises no eligible team's
 * expectation. A class below 100 observations prints CANNOT BE SCORED and is
 * omitted: it falls to the pooled rung, lift 1.
 *
 * ELIGIBILITY is the ONE core helper (`dcmpAwardEligibility`) with the
 * district's own district tier events and every award final, the situation at
 * DCMP week. A team's prior counts read seasons strictly before its own.
 *
 * Read only corpus, no network request, no environment variable.
 */
import { pathToFileURL } from "node:url";
import {
  openCorpusReadOnly,
  selectDistrictRankings,
  selectDistrictsForYear,
  type Corpus,
} from "../packages/corpus/db.js";
import {
  cellKey,
  decorationBucket,
  DECORATION_BUCKETS,
  rookieStateFor,
  type DecorationBucket,
  type RookieState,
} from "../packages/core/districts/awardBaseRates.js";
import { BRACKET_REGISTERED_SEASONS } from "../packages/core/districts/bracket.js";
import {
  dcmpAwardEligibility,
  dcmpEligibilityChance,
  type DcmpEligibilityTeam,
} from "../packages/core/districts/dcmpAwardEligibility.js";
import {
  dcmpEventRoles,
  type DcmpAwardSlateSeasonTables,
  type DcmpEventRole,
  type DcmpJudgedAnchor,
  type DcmpSlateLift,
} from "../packages/core/districts/dcmpAwardSlate.js";
import { champCutoffTuning, dcmpAwardCountDistribution } from "../packages/core/districts/hypotheticalDcmp.js";
import { priorImpactWinCount } from "./measureAwardOrderingTables.js";
import { loadAwardInstances, loadRookieYears, priorJudgedAwardCount, type AwardInstance } from "./measureDistrictAwardBaseRates.js";

const CORPUS_PATH = "data/corpus.sqlite";

export const MEASURED_COMMAND = "npx tsx scripts/measureDcmpAwardSlate.ts";
export const MEASURED_DATE = "2026-10-14";

/** The first census season: the corpus's award rows begin in 2016. */
export const FIRST_CENSUS_SEASON = 2016;

/** The seasons the slate is registered for: the bracket's own, pinned equal by a test. */
export const SLATE_REGISTERED_SEASONS: readonly number[] = [2023, 2024, 2025, 2026];

/** The fewest observations a lift class needs before it is stated. */
export const MIN_SLATE_LIFT_OBSERVATIONS = 100;

/** The smallest championship (union of its keys' fields) that is measured. */
export const MIN_CHAMPIONSHIP_FIELD = 11;

export const IMPACT_AWARD_TYPE = 0;
export const ENGINEERING_INSPIRATION_AWARD_TYPE = 9;
export const ROOKIE_ALL_STAR_AWARD_TYPE = 10;
const CONSUMING_AWARD_TYPES: readonly number[] = [IMPACT_AWARD_TYPE, ENGINEERING_INSPIRATION_AWARD_TYPE, ROOKIE_ALL_STAR_AWARD_TYPE];

// ───────────────────────────── shapes ─────────────────────────────

/** One team at one DCMP tier event. */
export interface MeasuredTeamEvent {
  readonly teamKey: string;
  readonly awardPoints: number;
  readonly rookieState: RookieState;
  /** Judged awards won in seasons strictly before the championship's own. */
  readonly priorJudgedAwards: number;
  /** Impact wins in seasons strictly before the championship's own. */
  readonly priorImpactWins: number;
  /** Every award type the team won AT THIS KEY. */
  readonly wonTypes: ReadonlySet<number>;
  readonly eligible: { readonly impact: boolean; readonly engineeringInspiration: boolean; readonly rookieAllStar: boolean };
}

/** One DCMP tier event. */
export interface MeasuredDcmpEvent {
  readonly season: number;
  readonly districtKey: string;
  readonly eventKey: string;
  readonly eventType: number | undefined;
  /** By key structure, `dcmpEventRoles`. */
  readonly role: DcmpEventRole;
  /** By TBA event_type. */
  readonly roleByType: DcmpEventRole | undefined;
  readonly field: readonly MeasuredTeamEvent[];
}

/** One championship: a single key, or a finals key plus its divisions. */
export interface MeasuredChampionship {
  readonly season: number;
  readonly districtKey: string;
  /** The single or finals key. */
  readonly key: string;
  readonly events: readonly MeasuredDcmpEvent[];
  /** Whether it passes the degenerate filter. */
  readonly measured: boolean;
  readonly reason?: string;
}

/** One lift accumulator: won, expected, observations. */
export interface LiftAccumulator {
  y: number;
  e: number;
  n: number;
}

export interface SeasonSlateMeasurement {
  readonly season: number;
  readonly priorSeasons: readonly number[];
  readonly registered: boolean;
  readonly registrationReason?: string;
  readonly judgedAnchor: Partial<Record<DcmpEventRole, DcmpJudgedAnchor>>;
  readonly impact: Map<DecorationBucket, LiftAccumulator>;
  readonly engineeringInspiration: Map<DecorationBucket, LiftAccumulator>;
  readonly judgedCells: Map<string, LiftAccumulator>;
  readonly judgedBuckets: Map<DecorationBucket, LiftAccumulator>;
}

// ───────────────────────────── pure functions ─────────────────────────────

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

/** A team's walk forward profile counts at `season`: only seasons strictly before it are read. */
export function priorCountsAt(instances: readonly AwardInstance[], teamKey: string, season: number): { priorJudgedAwards: number; priorImpactWins: number } {
  return {
    priorJudgedAwards: priorJudgedAwardCount(instances, teamKey, season),
    priorImpactWins: priorImpactWinCount(instances, teamKey, season),
  };
}

/** Whether a team won any consuming award (Impact, Engineering Inspiration, Rookie All Star) at a key. */
export function wonConsuming(team: MeasuredTeamEvent): boolean {
  return CONSUMING_AWARD_TYPES.some((type) => team.wonTypes.has(type));
}

/** A judged winner at a key: award points above 0 and no consuming award there. */
export function wonJudged(team: MeasuredTeamEvent): boolean {
  return team.awardPoints > 0 && !wonConsuming(team);
}

/** The judged winning team count of one event. */
export function judgedWinnerCount(event: MeasuredDcmpEvent): number {
  return event.field.filter(wonJudged).length;
}

/**
 * Groups one district season's DCMP tier events into championships, by key
 * structure, and applies the degenerate filter.
 */
export function groupChampionships(events: readonly MeasuredDcmpEvent[]): MeasuredChampionship[] {
  const out: MeasuredChampionship[] = [];
  const byDistrict = new Map<string, MeasuredDcmpEvent[]>();
  for (const event of events) {
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
      const measured = teams.size >= MIN_CHAMPIONSHIP_FIELD && points > 0;
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

function accumulate<K>(map: Map<K, LiftAccumulator>, key: K, y: number, e: number): void {
  let acc = map.get(key);
  if (acc === undefined) {
    acc = { y: 0, e: 0, n: 0 };
    map.set(key, acc);
  }
  acc.y += y;
  acc.e += e;
  acc.n += 1;
}

/** Adds one pool to a lift map: each member's expectation is the pool's winner count over its size. */
function addPool<K>(map: Map<K, LiftAccumulator>, pool: readonly { key: K; won: boolean }[]): void {
  if (pool.length === 0) return;
  const winners = pool.filter((member) => member.won).length;
  const e = winners / pool.length;
  for (const member of pool) accumulate(map, member.key, member.won ? 1 : 0, e);
}

/** The union of a championship's teams, first appearance kept, each with whether it won `awardType` at any of its keys. */
function championshipTeams(championship: MeasuredChampionship, awardType: number): { team: MeasuredTeamEvent; won: boolean }[] {
  const byTeam = new Map<string, { team: MeasuredTeamEvent; won: boolean }>();
  for (const event of championship.events) {
    for (const team of event.field) {
      const existing = byTeam.get(team.teamKey);
      const won = team.wonTypes.has(awardType);
      if (existing === undefined) byTeam.set(team.teamKey, { team, won });
      else if (won) existing.won = true;
    }
  }
  return [...byTeam.values()];
}

/**
 * One season's slate measurement, from championships of seasons STRICTLY
 * BEFORE `season` that pass the degenerate filter. Reversing that is the leak.
 */
export function measureSeasonSlate(season: number, championships: readonly MeasuredChampionship[]): SeasonSlateMeasurement {
  const prior = championships.filter((championship) => championship.season < season && championship.measured);
  const priorSeasons = [...new Set(prior.map((championship) => championship.season))].sort((a, b) => a - b);

  const eventsByRoleSeason = new Map<DcmpEventRole, Map<number, MeasuredDcmpEvent[]>>();
  for (const championship of prior) {
    for (const event of championship.events) {
      let bySeason = eventsByRoleSeason.get(event.role);
      if (bySeason === undefined) {
        bySeason = new Map();
        eventsByRoleSeason.set(event.role, bySeason);
      }
      const list = bySeason.get(event.season);
      if (list === undefined) bySeason.set(event.season, [event]);
      else list.push(event);
    }
  }
  const meanJudged = (events: readonly MeasuredDcmpEvent[]): number => events.reduce((sum, event) => sum + judgedWinnerCount(event), 0) / events.length;

  // The pooled rung: single plus division, most recent earlier season holding either.
  const pooledSeasons = [...new Set([...(eventsByRoleSeason.get("single")?.keys() ?? []), ...(eventsByRoleSeason.get("division")?.keys() ?? [])])].sort((a, b) => b - a);
  const pooledSeason = pooledSeasons[0];
  const pooled: DcmpJudgedAnchor | undefined =
    pooledSeason === undefined
      ? undefined
      : (() => {
          const events = [...(eventsByRoleSeason.get("single")?.get(pooledSeason) ?? []), ...(eventsByRoleSeason.get("division")?.get(pooledSeason) ?? [])];
          return { count: meanJudged(events), source: "pooled" as const, fromSeason: pooledSeason, events: events.length };
        })();

  const judgedAnchor: Partial<Record<DcmpEventRole, DcmpJudgedAnchor>> = {};
  for (const role of ["single", "division", "finals"] as const) {
    const bySeason = eventsByRoleSeason.get(role);
    const latest = bySeason === undefined ? undefined : [...bySeason.keys()].sort((a, b) => b - a)[0];
    if (latest !== undefined) {
      const events = bySeason!.get(latest)!;
      judgedAnchor[role] = { count: meanJudged(events), source: "role", fromSeason: latest, events: events.length };
    } else if (pooled !== undefined) {
      judgedAnchor[role] = pooled;
    }
  }

  const impact = new Map<DecorationBucket, LiftAccumulator>();
  const engineeringInspiration = new Map<DecorationBucket, LiftAccumulator>();
  const judgedCells = new Map<string, LiftAccumulator>();
  const judgedBuckets = new Map<DecorationBucket, LiftAccumulator>();
  for (const championship of prior) {
    addPool(
      impact,
      championshipTeams(championship, IMPACT_AWARD_TYPE)
        .filter(({ team }) => team.eligible.impact)
        .map(({ team, won }) => ({ key: decorationBucket(team.priorImpactWins), won }))
    );
    addPool(
      engineeringInspiration,
      championshipTeams(championship, ENGINEERING_INSPIRATION_AWARD_TYPE)
        .filter(({ team }) => team.eligible.engineeringInspiration && team.rookieState !== "rookie")
        .map(({ team, won }) => ({ key: decorationBucket(team.priorJudgedAwards), won }))
    );
    for (const event of championship.events) {
      if (event.role === "finals") continue;
      const pool = event.field.filter((team) => !wonConsuming(team));
      addPool(
        judgedCells,
        pool.map((team) => ({ key: cellKey(decorationBucket(team.priorJudgedAwards), team.rookieState), won: wonJudged(team) }))
      );
      addPool(
        judgedBuckets,
        pool.map((team) => ({ key: decorationBucket(team.priorJudgedAwards), won: wonJudged(team) }))
      );
    }
  }

  const missing = (["single", "division", "finals"] as const).filter((role) => judgedAnchor[role] === undefined);
  const registered = missing.length === 0;
  return {
    season,
    priorSeasons,
    registered,
    ...(registered ? {} : { registrationReason: `no judged anchor for ${missing.join(", ")}` }),
    judgedAnchor,
    impact,
    engineeringInspiration,
    judgedCells,
    judgedBuckets,
  };
}

/** A lift accumulator as a stated lift, or `undefined` below the observation bar. */
export function toLift(acc: LiftAccumulator | undefined): DcmpSlateLift | undefined {
  if (acc === undefined || acc.n < MIN_SLATE_LIFT_OBSERVATIONS || !(acc.e > 0)) return undefined;
  return { lift: acc.y / acc.e, n: acc.n };
}

function liftRecord<K extends string>(map: ReadonlyMap<K, LiftAccumulator>): Partial<Record<K, DcmpSlateLift>> {
  const out: Partial<Record<K, DcmpSlateLift>> = {};
  for (const key of [...map.keys()].sort()) {
    const lift = toLift(map.get(key));
    if (lift !== undefined) out[key] = lift;
  }
  return out;
}

/** One registered season's measurement as the committed table shape. */
export function toSlateTables(measurement: SeasonSlateMeasurement): DcmpAwardSlateSeasonTables {
  if (!measurement.registered) throw new Error(`season ${String(measurement.season)} is not registered: ${measurement.registrationReason ?? ""}`);
  return {
    judgedAnchor: {
      single: measurement.judgedAnchor.single!,
      division: measurement.judgedAnchor.division!,
      finals: measurement.judgedAnchor.finals!,
    },
    impactLift: liftRecord(measurement.impact),
    engineeringInspirationLift: liftRecord(measurement.engineeringInspiration),
    judgedLiftCells: liftRecord(measurement.judgedCells) as Record<string, DcmpSlateLift>,
    judgedLiftBuckets: liftRecord(measurement.judgedBuckets),
  };
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

/** Everything one season's census and measurement read, beyond the measured events. */
export interface SeasonCensus {
  readonly season: number;
  readonly events: MeasuredDcmpEvent[];
  readonly cmpSlotsByDistrict: Map<string, number | null>;
  /** District tier Engineering Inspiration winners, and how many were rookies. */
  readonly districtTierEi: { winners: number; rookies: number };
  readonly dcmpTierEi: { winners: number; rookies: number };
  /** Per team, the district tier events it won any award at and the types. */
  readonly districtWinsByTeam: Map<string, string[]>;
  readonly duplicateFieldRows: number;
}

export interface SlateCorpusLoad {
  readonly seasons: SeasonCensus[];
  readonly championships: MeasuredChampionship[];
}

export function loadSlateCorpus(db: Corpus): SlateCorpusLoad {
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

  const seasons: SeasonCensus[] = [];
  const allEvents: MeasuredDcmpEvent[] = [];
  for (const season of districtSeasons) {
    const seasonInstances = instancesBySeason.get(season) ?? [];
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
    const rows = loadRankingRows(db, season);
    const eventTypes = new Map(
      (db.prepare(`SELECT event_key, event_type FROM events WHERE year = ?`).all(season) as { event_key: string; event_type: number }[]).map((row) => [
        row.event_key,
        row.event_type,
      ])
    );
    const cmpSlotsByDistrict = new Map(selectDistrictsForYear(db, season).map((district) => [district.districtKey, district.cmpSlots]));

    const districtTierKeys = new Set(rows.filter((row) => row.district).map((row) => row.eventKey));
    const dcmpTierKeys = new Set(rows.filter((row) => !row.district).map((row) => row.eventKey));
    const eiCensus = (keys: ReadonlySet<string>): { winners: number; rookies: number } => {
      let winners = 0;
      let rookies = 0;
      for (const instance of seasonInstances) {
        if (instance.teamKey === null || instance.awardType !== ENGINEERING_INSPIRATION_AWARD_TYPE || !keys.has(instance.eventKey)) continue;
        winners++;
        if (rookieState(instance.teamKey) === "rookie") rookies++;
      }
      return { winners, rookies };
    };
    const districtWinsByTeam = new Map<string, string[]>();
    for (const instance of seasonInstances) {
      if (instance.teamKey === null || !districtTierKeys.has(instance.eventKey)) continue;
      const list = districtWinsByTeam.get(instance.teamKey) ?? [];
      list.push(`${instance.eventKey}:${String(instance.awardType)}`);
      districtWinsByTeam.set(instance.teamKey, list);
    }

    const rowsByDistrict = new Map<string, RankingRow[]>();
    for (const row of rows) {
      const list = rowsByDistrict.get(row.districtKey);
      if (list === undefined) rowsByDistrict.set(row.districtKey, [row]);
      else list.push(row);
    }
    let duplicateFieldRows = 0;
    const events: MeasuredDcmpEvent[] = [];
    for (const [districtKey, districtRows] of [...rowsByDistrict].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const teamOrder: string[] = [];
      const districtEvents = new Map<string, Set<string>>();
      for (const row of districtRows) {
        if (!districtEvents.has(row.teamKey)) {
          districtEvents.set(row.teamKey, new Set());
          teamOrder.push(row.teamKey);
        }
        if (row.district) districtEvents.get(row.teamKey)!.add(row.eventKey);
      }
      const teams: DcmpEligibilityTeam[] = teamOrder.map((teamKey) => ({
        teamKey,
        rookie: rookieState(teamKey) === "rookie",
        heldAwards: (seasonByTeam.get(teamKey) ?? []).map((instance) => ({ eventKey: instance.eventKey, awardType: instance.awardType })),
        districtEventKeys: [...districtEvents.get(teamKey)!],
      }));
      const eligibility = dcmpAwardEligibility({ teams, awardFinal: () => true, weight: () => 1 });

      const dcmpKeys = [...new Set(districtRows.filter((row) => !row.district).map((row) => row.eventKey))].sort();
      const roles = dcmpEventRoles(dcmpKeys);
      const typeRoles = rolesByEventType(eventTypes, dcmpKeys);
      for (const eventKey of dcmpKeys) {
        const seen = new Set<string>();
        const field: MeasuredTeamEvent[] = [];
        for (const row of districtRows) {
          if (row.district || row.eventKey !== eventKey) continue;
          if (seen.has(row.teamKey)) {
            duplicateFieldRows++;
            continue;
          }
          seen.add(row.teamKey);
          const prior = priorCountsAt(instancesByTeam.get(row.teamKey) ?? [], row.teamKey, season);
          field.push({
            teamKey: row.teamKey,
            awardPoints: row.awardPoints,
            rookieState: rookieState(row.teamKey),
            priorJudgedAwards: prior.priorJudgedAwards,
            priorImpactWins: prior.priorImpactWins,
            wonTypes: wonAt.get(`${eventKey}|${row.teamKey}`) ?? new Set<number>(),
            eligible: {
              impact: dcmpEligibilityChance(eligibility, row.teamKey, 0) > 0,
              engineeringInspiration: dcmpEligibilityChance(eligibility, row.teamKey, 9) > 0,
              rookieAllStar: dcmpEligibilityChance(eligibility, row.teamKey, 10) > 0,
            },
          });
        }
        events.push({ season, districtKey, eventKey, eventType: eventTypes.get(eventKey), role: roles.get(eventKey)!, roleByType: typeRoles.get(eventKey), field });
      }
    }
    allEvents.push(...events);
    seasons.push({
      season,
      events,
      cmpSlotsByDistrict,
      districtTierEi: eiCensus(districtTierKeys),
      dcmpTierEi: eiCensus(dcmpTierKeys),
      districtWinsByTeam,
      duplicateFieldRows,
    });
  }
  return { seasons, championships: groupChampionships(allEvents) };
}

// ───────────────────────────── reporting ─────────────────────────────

function liftLine(label: string, acc: LiftAccumulator | undefined): string {
  if (acc === undefined) return `      ${label}: no observations`;
  const stated = toLift(acc);
  if (stated === undefined) return `      ${label}: n=${String(acc.n)} won ${String(acc.y)} expected ${acc.e.toFixed(3)}  CANNOT BE SCORED (below ${String(MIN_SLATE_LIFT_OBSERVATIONS)}), falls to the pooled rung, lift 1`;
  return `      ${label}: n=${String(acc.n)} won ${String(acc.y)} expected ${acc.e.toFixed(3)} lift ${stated.lift.toFixed(4)}`;
}

function reportCensus(load: SlateCorpusLoad): void {
  console.log(`CENSUS: every DCMP tier event, ${String(FIRST_CENSUS_SEASON)} onward`);
  let disagreements = 0;
  let total = 0;
  for (const census of load.seasons) {
    console.log(``);
    console.log(`SEASON ${String(census.season)}${census.duplicateFieldRows > 0 ? ` (${String(census.duplicateFieldRows)} duplicate field row(s) dropped)` : ""}`);
    for (const event of census.events) {
      total++;
      const agree = event.role === event.roleByType;
      if (!agree) disagreements++;
      const count = (type: number): string => {
        const winners = event.field.filter((team) => team.wonTypes.has(type));
        const eligibleOf = winners.filter((team) =>
          type === IMPACT_AWARD_TYPE ? team.eligible.impact : type === ENGINEERING_INSPIRATION_AWARD_TYPE ? team.eligible.engineeringInspiration : team.eligible.rookieAllStar
        ).length;
        return `${String(winners.length)} (${String(eligibleOf)} eligible)`;
      };
      console.log(
        `   ${event.eventKey.padEnd(13)} type ${String(event.eventType ?? "?")} role ${event.role.padEnd(8)} by type ${String(event.roleByType ?? "?").padEnd(8)}${agree ? "" : " DISAGREE"} ` +
          `field ${String(event.field.length).padStart(3)}  Impact ${count(IMPACT_AWARD_TYPE)}  EI ${count(ENGINEERING_INSPIRATION_AWARD_TYPE)}  RAS ${count(ROOKIE_ALL_STAR_AWARD_TYPE)}  judged winners ${String(judgedWinnerCount(event))}`
      );
    }
    const setting = champCutoffTuning(census.season).setting;
    for (const championship of load.championships.filter((entry) => entry.season === census.season)) {
      const winners = (type: number): number => championship.events.reduce((sum, event) => sum + event.field.filter((team) => team.wonTypes.has(type)).length, 0);
      const cmpSlots = census.cmpSlotsByDistrict.get(championship.districtKey) ?? null;
      const distribution = dcmpAwardCountDistribution(census.season, championship.districtKey, cmpSlots ?? 0, setting.countMode);
      const mean = (weights: readonly number[]): string => weights.reduce((sum, w, count) => sum + w * count, 0).toFixed(2);
      console.log(
        `   championship ${championship.key} (${championship.districtKey}, ${String(championship.events.length)} key(s)${championship.measured ? "" : `, NOT MEASURED: ${championship.reason ?? ""}`}): ` +
          `Impact ${String(winners(IMPACT_AWARD_TYPE))} vs model mean ${mean(distribution[0])}, EI ${String(winners(ENGINEERING_INSPIRATION_AWARD_TYPE))} vs ${mean(distribution[9])}, ` +
          `RAS ${String(winners(ROOKIE_ALL_STAR_AWARD_TYPE))} vs ${mean(distribution[10])} (cmpSlots ${String(cmpSlots)}, countMode ${setting.countMode})`
      );
    }
  }
  console.log(``);
  console.log(`ROLE AGREEMENT: key structure and event_type agree on ${String(total - disagreements)} of ${String(total)} DCMP tier events; ${String(disagreements)} disagree.`);
  console.log(``);
  console.log(`ROOKIE ENGINEERING INSPIRATION CENSUS (winners, rookies among them):`);
  for (const census of load.seasons) {
    console.log(
      `   ${String(census.season)}: district tier ${String(census.districtTierEi.winners)} winners, ${String(census.districtTierEi.rookies)} rookie(s); DCMP tier ${String(census.dcmpTierEi.winners)} winners, ${String(census.dcmpTierEi.rookies)} rookie(s)`
    );
  }
  console.log(``);
  console.log(`INELIGIBLE CONSUMING AWARD WINNERS at the DCMP tier (eligibility: the one core helper, the district's own district tier events):`);
  let ineligible = 0;
  for (const census of load.seasons) {
    for (const event of census.events) {
      for (const team of event.field) {
        for (const [type, name, eligible] of [
          [IMPACT_AWARD_TYPE, "Impact", team.eligible.impact],
          [ENGINEERING_INSPIRATION_AWARD_TYPE, "Engineering Inspiration", team.eligible.engineeringInspiration],
          [ROOKIE_ALL_STAR_AWARD_TYPE, "Rookie All Star", team.eligible.rookieAllStar],
        ] as const) {
          if (!team.wonTypes.has(type) || eligible) continue;
          ineligible++;
          console.log(`   ${String(census.season)} ${event.eventKey} ${team.teamKey} won ${name}; its district tier wins: ${(census.districtWinsByTeam.get(team.teamKey) ?? []).join(", ") || "none"}`);
        }
      }
    }
  }
  if (ineligible === 0) console.log(`   none`);
  console.log(``);
  console.log(`DEGENERATE FILTER (union field at least ${String(MIN_CHAMPIONSHIP_FIELD)} teams and award points above 0) removed:`);
  const removed = load.championships.filter((championship) => !championship.measured);
  for (const championship of removed) console.log(`   ${String(championship.season)} ${championship.key}: ${championship.reason ?? ""}`);
  if (removed.length === 0) console.log(`   none`);
}

function reportSeason(measurement: SeasonSlateMeasurement): void {
  console.log(`SEASON ${String(measurement.season)}: from championships of ${measurement.priorSeasons.join(", ")}${measurement.registered ? "" : `  NOT REGISTERED: ${measurement.registrationReason ?? ""}`}`);
  console.log(`   judged anchor per role:`);
  for (const role of ["single", "division", "finals"] as const) {
    const anchor = measurement.judgedAnchor[role];
    console.log(
      anchor === undefined
        ? `      ${role}: none`
        : `      ${role}: ${anchor.count.toFixed(4)} judged winning teams per event (${anchor.source}, ${String(anchor.fromSeason)}, ${String(anchor.events)} event(s))`
    );
  }
  console.log(`   Impact lift by decorationBucket(prior Impact wins), Impact eligible teams:`);
  for (const bucket of DECORATION_BUCKETS) console.log(liftLine(bucket, measurement.impact.get(bucket)));
  console.log(`   Engineering Inspiration lift by decorationBucket(prior judged awards), eligible veterans:`);
  for (const bucket of DECORATION_BUCKETS) console.log(liftLine(bucket, measurement.engineeringInspiration.get(bucket)));
  console.log(`   judged lift by cell, teams with no consuming award at a single or division event:`);
  for (const key of [...measurement.judgedCells.keys()].sort()) console.log(liftLine(key, measurement.judgedCells.get(key)));
  console.log(`   judged lift by bucket, pooled over rookie state:`);
  for (const bucket of DECORATION_BUCKETS) console.log(liftLine(bucket, measurement.judgedBuckets.get(bucket)));
}

function literalLift(lift: DcmpSlateLift): string {
  return `{ lift: ${String(lift.lift)}, n: ${String(lift.n)} }`;
}

function literalRecord(record: Readonly<Record<string, DcmpSlateLift | undefined>>): string {
  const entries = Object.entries(record).filter((entry): entry is [string, DcmpSlateLift] => entry[1] !== undefined);
  if (entries.length === 0) return `{}`;
  return `{ ${entries.map(([key, lift]) => `${JSON.stringify(key)}: ${literalLift(lift)}`).join(", ")} }`;
}

/** The committed literal block, copied into `dcmpAwardSlate.ts`. */
export function literalBlock(tablesBySeason: ReadonlyMap<number, DcmpAwardSlateSeasonTables>): string {
  const lines: string[] = [`export const DCMP_AWARD_SLATE_TABLES: Readonly<Record<number, DcmpAwardSlateSeasonTables>> = {`];
  for (const [season, tables] of [...tablesBySeason].sort((a, b) => a[0] - b[0])) {
    lines.push(`  ${String(season)}: {`);
    lines.push(`    judgedAnchor: {`);
    for (const role of ["single", "division", "finals"] as const) {
      const anchor = tables.judgedAnchor[role];
      lines.push(`      ${role}: { count: ${String(anchor.count)}, source: "${anchor.source}", fromSeason: ${String(anchor.fromSeason)}, events: ${String(anchor.events)} },`);
    }
    lines.push(`    },`);
    lines.push(`    impactLift: ${literalRecord(tables.impactLift)},`);
    lines.push(`    engineeringInspirationLift: ${literalRecord(tables.engineeringInspirationLift)},`);
    lines.push(`    judgedLiftCells: ${literalRecord(tables.judgedLiftCells)},`);
    lines.push(`    judgedLiftBuckets: ${literalRecord(tables.judgedLiftBuckets)},`);
    lines.push(`  },`);
  }
  lines.push(`};`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  console.log(`DCMP AWARD SLATE: census of real DCMP results, and the walk forward slate tables.`);
  console.log(`command:    ${MEASURED_COMMAND}`);
  console.log(`registered: ${SLATE_REGISTERED_SEASONS.join(", ")}`);
  console.log(`bar:        ${String(MIN_SLATE_LIFT_OBSERVATIONS)} observations per lift class; championships of at least ${String(MIN_CHAMPIONSHIP_FIELD)} teams with award points above 0`);
  console.log(`credential: none. Read only corpus, no network request, no environment variable.`);
  console.log(``);
  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    const load = loadSlateCorpus(db);
    reportCensus(load);
    console.log(``);
    const tables = new Map<number, DcmpAwardSlateSeasonTables>();
    for (const season of SLATE_REGISTERED_SEASONS) {
      const measurement = measureSeasonSlate(season, load.championships);
      reportSeason(measurement);
      console.log(``);
      if (measurement.registered) tables.set(season, toSlateTables(measurement));
    }
    console.log(`LITERAL BLOCK (copy into packages/core/districts/dcmpAwardSlate.ts):`);
    console.log(literalBlock(tables));
  } finally {
    db.close();
  }
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("measure:dcmp-award-slate failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
