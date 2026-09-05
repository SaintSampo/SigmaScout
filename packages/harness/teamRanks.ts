/**
 * Quick task 260905-ldu: the single home for two related rules that must
 * never drift apart — which team keys are real, and how teams are ranked and
 * scoped into World/Country/District/State pools for the per-team rank
 * cards. This module is dependency-free (no Node built-ins, no
 * `better-sqlite3`, no `zod`) so BOTH the offline pipeline
 * (`packages/harness/publish.ts`, which publishes the World/Country/
 * District/State ranks onto each team's artifact) and the browser bundle
 * (`apps/web/src/components/teams-table/rowModel.ts`, which ranks the same
 * pool client-side for the Teams table) import the exact same
 * implementation. Before this module existed, `rowModel.ts` carried its own
 * copy of the ranking rule and `apps/web/src/lib/teamKey.ts` carried its own
 * copy of the real-team-key rule; a single shared home is what makes "the
 * World rank on a team's page" and "that team's row in the Teams table"
 * incapable of disagreeing, by construction rather than by convention.
 *
 * It imports only `isOfficialEventType`/`OFFSEASON_EVENT_TYPE`/
 * `PRESEASON_EVENT_TYPE` from `../core/algorithms/eventTypes.js` and
 * `TOTAL_METRIC_KEY` from `../core/algorithms/types.js` — both of those
 * files are themselves import-nothing/framework-agnostic leaves (see their
 * own header comments), so this module stays safe to bundle into the
 * browser. `packages/harness/browserSafeSchemas.test.ts` enforces this with
 * a static import-graph scan.
 */
import { isOfficialEventType, OFFSEASON_EVENT_TYPE, PRESEASON_EVENT_TYPE } from "../core/algorithms/eventTypes.js";
import { TOTAL_METRIC_KEY } from "../core/algorithms/types.js";

// Re-exported so a caller that only needs the event-type constants this
// module already depends on does not need a second import line. Not part of
// this module's own contract otherwise.
export { OFFSEASON_EVENT_TYPE, PRESEASON_EVENT_TYPE };

const TEAM_KEY_PATTERN = /^frc(\d+)$/;

/**
 * Whether a corpus team key names a REAL, competing FRC team registration
 * (originally `apps/web/src/lib/teamKey.ts`'s `isRealTeamKey`, 2026-09-01
 * user report: "long names like 5199 don't show up in the teams list"). Two
 * published key shapes are not real teams and are excluded from every
 * MODEL-DERIVED ranking surface — the Teams list, the team page's own rank
 * cards, and (per the "Off-Season Demo Team" decision already recorded in
 * `.planning/todos/completed/exclude-offseason-demo-teams.md`) every ranking
 * pool below:
 *
 * 1. LETTER-SUFFIXED keys (`frc5199B`, `frc1165C`) — a team's second robot,
 *    entered at offseason events only. TBA publishes no nickname for them,
 *    and `teamNumber` is the PARENT's number, so they render as a nameless
 *    duplicate of a real team. Measured across the published artifacts:
 *    43-54 such rows per season. The concrete report that surfaced this:
 *    `frc5199B` sat at RANK 3 of all 2024 on 15 offseason matches at one
 *    event (Tidal Tumble, `eventType` 99), directly above real teams with
 *    ninety-plus official matches.
 * 2. `frc0` — a zero-numbered row carrying no matches and no `total` metric
 *    at all (present in 2024 only). FRC team numbers start at 1.
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

/** Sorts `pool` by `compareTeamsByTotal` and returns the target's 1-based rank and the pool's total size, or `undefined` when the target is not a member of `pool`. */
function rankWithin(pool: readonly RankableTeamRow[], teamKey: string): { rank: number; total: number } | undefined {
  const sorted = [...pool].sort(compareTeamsByTotal);
  const index = sorted.findIndex((row) => row.teamKey === teamKey);
  if (index === -1) return undefined;
  return { rank: index + 1, total: sorted.length };
}

/**
 * Builds the ordered (world, country, district, state) rank-scope array for
 * one team. Pool membership: world is every real team; country is every
 * real team sharing the target's `country`; district is every real team
 * sharing the target's `districtKey`; state is every real team sharing both
 * the target's `country` AND `stateProv`, emitted ONLY when the target's
 * country is the literal `USA_COUNTRY_VALUE` (no state card outside the
 * USA). A scope whose gating field is absent on the target is not emitted —
 * the array shrinks rather than carrying a placeholder. A target with no
 * `total` metric, or a `teamKey` absent from `rows` entirely, yields an
 * EMPTY array: a team with no published value has no honest rank, and does
 * not get placed last and shown anyway.
 */
export function buildTeamRankScopes(params: BuildTeamRankScopesParams): TeamRankScope[] {
  const realRows = params.rows.filter((row) => isRealPublishedTeamKey(row.teamKey));
  const target = realRows.find((row) => row.teamKey === params.teamKey);
  if (target === undefined) return [];
  if (target.metrics[TOTAL_METRIC_KEY]?.value === undefined) return [];

  const scopes: TeamRankScope[] = [];

  const worldRank = rankWithin(realRows, params.teamKey);
  if (worldRank !== undefined) {
    scopes.push({ scope: "world", rank: worldRank.rank, total: worldRank.total });
  }

  if (target.country !== undefined) {
    const countryPool = realRows.filter((row) => row.country === target.country);
    const countryRank = rankWithin(countryPool, params.teamKey);
    if (countryRank !== undefined) {
      scopes.push({ scope: "country", value: target.country, rank: countryRank.rank, total: countryRank.total });
    }
  }

  if (target.districtKey !== undefined) {
    const districtPool = realRows.filter((row) => row.districtKey === target.districtKey);
    const districtRank = rankWithin(districtPool, params.teamKey);
    if (districtRank !== undefined) {
      scopes.push({ scope: "district", value: target.districtKey, rank: districtRank.rank, total: districtRank.total });
    }
  }

  if (target.country === USA_COUNTRY_VALUE && target.stateProv !== undefined) {
    const statePool = realRows.filter((row) => row.country === USA_COUNTRY_VALUE && row.stateProv === target.stateProv);
    const stateRank = rankWithin(statePool, params.teamKey);
    if (stateRank !== undefined) {
      scopes.push({ scope: "state", value: target.stateProv, rank: stateRank.rank, total: stateRank.total });
    }
  }

  return scopes;
}
