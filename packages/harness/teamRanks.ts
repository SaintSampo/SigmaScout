/**
 * The single home for two related rules that must never drift apart —
 * which team keys are real, and how teams are ranked and scoped into
 * World/Country/District/State pools for the per-team rank cards. This
 * module is dependency-free (no Node built-ins, no `better-sqlite3`, no
 * `zod`) so BOTH the offline pipeline (`packages/harness/publish.ts`, which
 * publishes the World/Country/District/State ranks onto each team's
 * artifact) and the browser bundle
 * (`apps/web/src/components/teams-table/rowModel.ts`, which ranks the same
 * pool client-side for the Teams table) import the exact same
 * implementation. A single shared home is what makes "the World rank on a
 * team's page" and "that team's row in the Teams table" incapable of
 * disagreeing, by construction rather than by convention.
 *
 * It imports only `isOfficialEventType`/`OFFSEASON_EVENT_TYPE`/
 * `PRESEASON_EVENT_TYPE` from `../core/algorithms/eventTypes.js`,
 * `TOTAL_METRIC_KEY` from `../core/algorithms/types.js`, and
 * `roundTo`/`ROUNDING_RULE` from `./rounding.js` — all three files are
 * themselves import-nothing/framework-agnostic leaves (see their own
 * header comments), so this module stays safe to bundle into the browser.
 * `packages/harness/browserSafeSchemas.test.ts` enforces this with a
 * static import-graph scan.
 */
import { isOfficialEventType, OFFSEASON_EVENT_TYPE, PRESEASON_EVENT_TYPE } from "../core/algorithms/eventTypes.js";
import { TOTAL_METRIC_KEY } from "../core/algorithms/types.js";
import { roundTo, ROUNDING_RULE } from "./rounding.js";

// Re-exported so a caller that only needs the event-type constants this
// module already depends on does not need a second import line. Not part of
// this module's own contract otherwise.
export { OFFSEASON_EVENT_TYPE, PRESEASON_EVENT_TYPE };

const TEAM_KEY_PATTERN = /^frc(\d+)$/;

/**
 * Whether a corpus team key names a REAL, competing FRC team registration.
 * Two published key shapes are not real teams and are excluded from every
 * MODEL-DERIVED ranking surface — the Teams list, the team page's own rank
 * cards, and every ranking pool below:
 *
 * 1. LETTER-SUFFIXED keys (`frc5199B`, `frc1165C`) — a team's second robot,
 *    entered at offseason events only. TBA publishes no nickname for them,
 *    and `teamNumber` is the PARENT's number, so they render as a nameless
 *    duplicate of a real team. A letter-suffixed key can rank ahead of real
 *    teams with far more official matches if left in a pool.
 * 2. `frc0` — a zero-numbered row carrying no matches and no `total` metric
 *    at all. FRC team numbers start at 1.
 */
export function isRealPublishedTeamKey(teamKey: string): boolean {
  const match = TEAM_KEY_PATTERN.exec(teamKey);
  if (match === null) return false; // letter-suffixed or otherwise non-canonical
  return Number.parseInt(match[1]!, 10) > 0;
}

/** The structural shape `compareTeamsByTotal` needs — deliberately loose so both the pipeline's own row assembly and the web app's `TeamRow` (widened by `withDerivedGroupMetrics`) satisfy it without a cast. */
export interface RankableTeam {
  teamNumber: number;
  metrics: Readonly<Record<string, { value: number } | undefined>>;
}

/**
 * The one World-ranking comparator: higher `metrics.total.value` sorts
 * first; a missing `total` entry sorts last regardless of team number; equal
 * totals (including two rows both missing `total`) break by ascending
 * `teamNumber`, producing a strict total order that never depends on the
 * engine's sort-stability guarantee. Reproduces
 * `apps/web/src/components/teams-table/rowModel.ts`'s pre-existing
 * `buildTeamRows` sort body exactly. Group-metric derivation
 * (`withDerivedGroupMetrics`) never touches `TOTAL_METRIC_KEY`, so that
 * widening is invisible here.
 */
export function compareTeamsByTotal(a: RankableTeam, b: RankableTeam): number {
  const totalA = a.metrics[TOTAL_METRIC_KEY]?.value;
  const totalB = b.metrics[TOTAL_METRIC_KEY]?.value;
  if (totalA === undefined && totalB === undefined) return a.teamNumber - b.teamNumber;
  if (totalA === undefined) return 1;
  if (totalB === undefined) return -1;
  if (totalA !== totalB) return totalB - totalA;
  return a.teamNumber - b.teamNumber;
}

/** One event row this module needs to derive a team's home region — the season's event geo data, keyed by `eventKey`. */
export interface SeasonEventGeoRow {
  eventKey: string;
  eventType: number;
  /** ISO `YYYY-MM-DD` — sortable lexically, matching every other date string this repo carries from TBA. */
  startDate: string;
  country: string | null;
  stateProv: string | null;
  districtKey: string | null;
}

export interface DeriveTeamRegionsParams {
  /** Each team's attended event keys for the season — membership only, no order implied. */
  teamEventKeys: ReadonlyMap<string, ReadonlySet<string>>;
  /** The season's own event rows, geo fields included. */
  events: readonly SeasonEventGeoRow[];
}

/** A team's inferred home region. A field is present only when at least one eligible event carried a non-null value for it — absence means "not derivable", never "none", and is never coerced to an empty string. */
export interface TeamRegion {
  country?: string;
  stateProv?: string;
  districtKey?: string;
}

// Neutral-site championship event types (TBA `event_type`): Championship
// Division (3), Championship Finals (4), Festival of Champions (6). A team
// playing at Worlds says nothing about where it is FROM — these are
// deliberately excluded from the geo vote below so a Houston or Festival
// appearance cannot relocate a team that otherwise plays a full district
// season at home.
const CHAMPIONSHIP_DIVISION_EVENT_TYPE = 3;
const CHAMPIONSHIP_FINALS_EVENT_TYPE = 4;
const FESTIVAL_OF_CHAMPIONS_EVENT_TYPE = 6;
const NEUTRAL_SITE_EVENT_TYPES: ReadonlySet<number> = new Set([
  CHAMPIONSHIP_DIVISION_EVENT_TYPE,
  CHAMPIONSHIP_FINALS_EVENT_TYPE,
  FESTIVAL_OF_CHAMPIONS_EVENT_TYPE,
]);

/** True for an event eligible to vote on a team's home region: official play (not offseason/preseason, `isOfficialEventType`) and not one of the neutral-site championship types above. */
function isRegionEligibleEvent(event: SeasonEventGeoRow): boolean {
  return isOfficialEventType(event.eventType) && !NEUTRAL_SITE_EVENT_TYPES.has(event.eventType);
}

/** Ordering used to break a frequency tie: earliest `startDate`, then ascending `eventKey` — deterministic regardless of input order. */
function isEarlier(startDateA: string, eventKeyA: string, startDateB: string, eventKeyB: string): boolean {
  if (startDateA !== startDateB) return startDateA < startDateB;
  return eventKeyA < eventKeyB;
}

interface ValueStats {
  count: number;
  earliestStartDate: string;
  earliestEventKey: string;
}

/**
 * Picks the most frequent non-null value `selector` returns across `events`,
 * breaking a frequency tie by the earliest-starting (then lowest-keyed)
 * event that carried a tied value. Returns `undefined` when no eligible
 * event carries a non-null value for this field at all.
 */
function pickMostFrequentValue(events: readonly SeasonEventGeoRow[], selector: (event: SeasonEventGeoRow) => string | null): string | undefined {
  const stats = new Map<string, ValueStats>();
  for (const event of events) {
    const value = selector(event);
    if (value === null) continue;
    const existing = stats.get(value);
    if (existing === undefined) {
      stats.set(value, { count: 1, earliestStartDate: event.startDate, earliestEventKey: event.eventKey });
    } else {
      existing.count += 1;
      if (isEarlier(event.startDate, event.eventKey, existing.earliestStartDate, existing.earliestEventKey)) {
        existing.earliestStartDate = event.startDate;
        existing.earliestEventKey = event.eventKey;
      }
    }
  }

  let winnerValue: string | undefined;
  let winnerStats: ValueStats | undefined;
  for (const [value, candidateStats] of stats) {
    const isFirstCandidate = winnerStats === undefined;
    const isMoreFrequent = winnerStats !== undefined && candidateStats.count > winnerStats.count;
    const isTiedButEarlier =
      winnerStats !== undefined &&
      candidateStats.count === winnerStats.count &&
      isEarlier(candidateStats.earliestStartDate, candidateStats.earliestEventKey, winnerStats.earliestStartDate, winnerStats.earliestEventKey);
    if (isFirstCandidate || isMoreFrequent || isTiedButEarlier) {
      winnerValue = value;
      winnerStats = candidateStats;
    }
  }
  return winnerValue;
}

/**
 * Derives each team's home region purely from where it competed this season
 * — an explicit honesty note: the corpus's `teams` table carries only key,
 * number and nickname, no home address, so a team's region is INFERRED, and
 * this function is the one place that inference lives. Each of
 * `country`/`stateProv`/`districtKey` is derived independently: the most
 * frequent non-null value across the team's region-eligible events, tied
 * frequencies broken by earliest `startDate` then ascending `eventKey`, so
 * the result never depends on input ordering. A field with no non-null value
 * anywhere in a team's eligible events is omitted from that team's result
 * entirely.
 */
export function deriveTeamRegions(params: DeriveTeamRegionsParams): Map<string, TeamRegion> {
  const eligibleEvents = params.events.filter(isRegionEligibleEvent);

  const regions = new Map<string, TeamRegion>();
  for (const [teamKey, attendedKeys] of params.teamEventKeys) {
    const teamEligibleEvents = eligibleEvents.filter((event) => attendedKeys.has(event.eventKey));

    const region: TeamRegion = {};
    const country = pickMostFrequentValue(teamEligibleEvents, (event) => event.country);
    if (country !== undefined) region.country = country;
    const stateProv = pickMostFrequentValue(teamEligibleEvents, (event) => event.stateProv);
    if (stateProv !== undefined) region.stateProv = stateProv;
    const districtKey = pickMostFrequentValue(teamEligibleEvents, (event) => event.districtKey);
    if (districtKey !== undefined) region.districtKey = districtKey;

    regions.set(teamKey, region);
  }
  return regions;
}

/** The literal country string TBA publishes for United States events, and the one this repo already asserts against elsewhere (`EventFilters.test.tsx`). Named here so this module and every UI test that gates on "is this a US team" spell it identically. */
export const USA_COUNTRY_VALUE = "USA";

export type RankScope = "world" | "country" | "district" | "state";

/** One rank card's worth of data. `value` is the RAW published scope value (country string, district abbreviation, state-prov abbreviation) — omitted for `world`. Reader-facing label formatting (e.g. `districtDisplayName`) is the client's job, not this module's. */
export interface TeamRankScope {
  scope: RankScope;
  value?: string;
  /** The target's 1-based position within this scope's pool. */
  rank: number;
  /** This scope's pool size. */
  total: number;
}

/** One row `buildTeamRankScopes` ranks over — a rankable team plus its (optional) derived region fields. */
export interface RankableTeamRow extends RankableTeam {
  teamKey: string;
  country?: string;
  stateProv?: string;
  districtKey?: string;
}

export interface BuildTeamRankScopesParams {
  /** The season's rankable team rows for one algorithm/year — every row real and non-real alike; non-real keys are filtered out internally before any pool is built. */
  rows: readonly RankableTeamRow[];
  /** The team to compute scopes for. */
  teamKey: string;
}

/**
 * The rank-to-percentile rule a rank card's tier colour is derived from —
 * `((total - rank) + 0.5) / total * 100`.
 *
 * This is `percentiles.ts`'s `percentileRanks` mid-rank formula
 * (`((countStrictlyBelow + 0.5 * countEqual) / n) * 100`) specialised to a
 * strict total order: a member at 1-based rank r has exactly `total - r`
 * members strictly below it and exactly one member equal to it (itself).
 * `compareTeamsByTotal` produces a strict total order by construction (its
 * team-number tie-break guarantees it), so that specialisation is exact, not
 * approximate. The site already has exactly one percentile convention
 * (`percentileRanks`); this function joins it rather than opening a second
 * one — a rank card tinted by a different convention than the metric tile
 * beside it would be the same class of drift this project's failure log
 * names.
 *
 * Rounded to `ROUNDING_RULE.percentile`, exactly as
 * `percentileRanks` rounds, so a regional card resolves a borderline position
 * exactly as a metric tile does — rank 126 of 2,500 is 94.98 raw, 95.0
 * rounded, and Legendary on both. It now agrees EXACTLY with
 * `percentileRanks` for the r-th-best member of a strictly ordered pool.
 * `./rounding.js` has no imports of its own, so the module stays
 * browser-safe (`browserSafeSchemas.test.ts` checks it for Node built-ins).
 *
 * Serves the REGIONAL scopes only (country, district, state). The World card
 * is tiered by the team's published Total percentile instead
 * (`RankCards.tsx`), because the whole season field already has one.
 *
 * One residual, recorded honestly: rank pools strictly order equal totals by
 * team number (`compareTeamsByTotal`), so two tied teams in one region get
 * adjacent percentiles where mid-rank would give them one. That matches the
 * distinct ranks the cards print. A row without a Total cannot enter a
 * regional pool at all, because `deriveTeamRegions` votes only official
 * events and every algorithm guarantees a Total for a team with official play.
 */
export function percentileForRank(rank: number, total: number): number {
  return roundTo(((total - rank + 0.5) / total) * 100, ROUNDING_RULE.percentile);
}

/**
 * Builds the ordered (world, country, district, state) rank-scope array for
 * EVERY row in `rows` at once, keyed by team key. Pool membership: world is
 * every real team; country is every real team sharing the target's
 * `country`; district is every real team sharing the target's `districtKey`;
 * state is every real team sharing both the target's `country` AND
 * `stateProv`, emitted ONLY when the target's country is the literal
 * `USA_COUNTRY_VALUE` (no state card outside the USA). A scope whose gating
 * field is absent on the target is not emitted — the array shrinks rather
 * than carrying a placeholder. A row with no `total` metric, or a non-real
 * team key, maps to an EMPTY array: a team with no published value has no
 * honest rank, and does not get placed last and shown anyway.
 *
 * Each pool is sorted ONCE (world once, each
 * country/district/state group once) and every member's rank is read from
 * an index map, instead of copying and re-sorting the pool per team. Every
 * group keeps the real rows' iteration order before sorting and
 * `Array.prototype.sort` is stable, so a pool's sorted order — and therefore
 * every rank — is exactly what a per-team copy-and-sort produced. When a team
 * key repeats, its first occurrence is the one ranked and emitted.
 */
export function buildTeamRankScopesByTeam(rows: readonly RankableTeamRow[]): Map<string, TeamRankScope[]> {
  const realRows = rows.filter((row) => isRealPublishedTeamKey(row.teamKey));

  const countryGroups = new Map<string, RankableTeamRow[]>();
  const districtGroups = new Map<string, RankableTeamRow[]>();
  const stateGroups = new Map<string, RankableTeamRow[]>();
  const pushTo = (groups: Map<string, RankableTeamRow[]>, value: string, row: RankableTeamRow): void => {
    const group = groups.get(value);
    if (group === undefined) groups.set(value, [row]);
    else group.push(row);
  };
  for (const row of realRows) {
    if (row.country !== undefined) pushTo(countryGroups, row.country, row);
    if (row.districtKey !== undefined) pushTo(districtGroups, row.districtKey, row);
    if (row.country === USA_COUNTRY_VALUE && row.stateProv !== undefined) pushTo(stateGroups, row.stateProv, row);
  }

  /** Sorts `pool` once and returns teamKey -> 1-based rank (first occurrence wins) plus the pool size. */
  const rankIndex = (pool: readonly RankableTeamRow[]): { ranks: Map<string, number>; total: number } => {
    const sorted = [...pool].sort(compareTeamsByTotal);
    const ranks = new Map<string, number>();
    sorted.forEach((row, index) => {
      if (!ranks.has(row.teamKey)) ranks.set(row.teamKey, index + 1);
    });
    return { ranks, total: sorted.length };
  };
  const indexGroups = (groups: Map<string, RankableTeamRow[]>) => new Map(Array.from(groups, ([value, pool]) => [value, rankIndex(pool)]));

  const world = rankIndex(realRows);
  const countryIndex = indexGroups(countryGroups);
  const districtIndex = indexGroups(districtGroups);
  const stateIndex = indexGroups(stateGroups);

  const result = new Map<string, TeamRankScope[]>();
  for (const row of rows) {
    if (result.has(row.teamKey)) continue;
    // The first REAL occurrence of a key is its target; a non-real key never has one.
    const target = isRealPublishedTeamKey(row.teamKey) ? row : undefined;
    if (target === undefined || target.metrics[TOTAL_METRIC_KEY]?.value === undefined) {
      result.set(row.teamKey, []);
      continue;
    }

    const scopes: TeamRankScope[] = [];
    scopes.push({ scope: "world", rank: world.ranks.get(target.teamKey)!, total: world.total });
    if (target.country !== undefined) {
      const pool = countryIndex.get(target.country)!;
      scopes.push({ scope: "country", value: target.country, rank: pool.ranks.get(target.teamKey)!, total: pool.total });
    }
    if (target.districtKey !== undefined) {
      const pool = districtIndex.get(target.districtKey)!;
      scopes.push({ scope: "district", value: target.districtKey, rank: pool.ranks.get(target.teamKey)!, total: pool.total });
    }
    if (target.country === USA_COUNTRY_VALUE && target.stateProv !== undefined) {
      const pool = stateIndex.get(target.stateProv)!;
      scopes.push({ scope: "state", value: target.stateProv, rank: pool.ranks.get(target.teamKey)!, total: pool.total });
    }
    result.set(row.teamKey, scopes);
  }
  return result;
}

/**
 * The single-team form of `buildTeamRankScopesByTeam`: the ordered rank-scope
 * array for `params.teamKey`, or an EMPTY array when that key is absent from
 * `rows`, is not a real team key, or carries no `total` metric.
 */
export function buildTeamRankScopes(params: BuildTeamRankScopesParams): TeamRankScope[] {
  return buildTeamRankScopesByTeam(params.rows).get(params.teamKey) ?? [];
}
