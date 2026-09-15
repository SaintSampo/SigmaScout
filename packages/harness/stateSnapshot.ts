/**
 * The offline-to-online state handoff: a shipped algorithm's in-memory state
 * to a flat array of `StateRow`s a Worker reads slices of from D1, and back,
 * losslessly (proven by a continuation-replay digest in `stateSnapshot.test.ts`).
 *
 * `scopeKind` exists because the algorithms do not share a granularity: EPA and
 * SPR accumulate per TEAM, event-scoped OPR per EVENT (season-pooled OPR's
 * per-team state would exceed a Worker's memory).
 *
 * Every `Map` is written as a key-sorted `[key, value]` array (`JSON.stringify`
 * silently turns a `Map` into `{}`) and every object with sorted keys
 * (`canonicalize`), so re-serializing an unchanged team yields byte-identical
 * `stateJson` and a Worker tick can skip its D1 write.
 *
 * The D1 bulk seed emitter (`emitSeedSql`) lives in `seedSql.ts`, the only
 * Node-bound part of the handoff. This module must stay browser-safe: the
 * browser pricer reads rows through it (`eventStatePricing.browserSafe.test.ts`).
 */
import { z } from "zod";
import type { EpaState } from "../core/algorithms/epa.js";
import type { SprPhaseRecord, SprState, SprTeamState } from "../core/algorithms/spr.js";
import { COMPONENT_GROUP_IDS, type ComponentGroupId } from "../core/algorithms/breakdown/index.js";
import type { OprObservation, OprState } from "../core/algorithms/opr.js";
import type { ExpandingStats } from "../core/scoring/expandingStats.js";
import type { SigmaBelief, SigmaPopulation } from "./sigmaScore.js";
import type { RpTeamBeliefs, RpVariableBelief } from "../core/rankingPoints/empiricalMoments.js";
import type { RpMeanShiftState, RpMeanShiftVariableState } from "../core/rankingPoints/meanShift.js";

// ---------------------------------------------------------------------------
// The row shape
// ---------------------------------------------------------------------------

/** The granularities the shipped algorithms accumulate at. */
export const STATE_ROW_SCOPE_KINDS = ["team", "event", "league"] as const;
export type StateRowScopeKind = (typeof STATE_ROW_SCOPE_KINDS)[number];

export const StateRowSchema = z.object({
  algorithmId: z.string().min(1),
  algorithmVersion: z.string().min(1),
  scopeKind: z.enum(STATE_ROW_SCOPE_KINDS),
  scopeKey: z.string().min(1),
  stateJson: z.string(),
  /** A short opaque string identifying the publish run that produced this row. */
  generation: z.string().min(1),
  /** ISO timestamp of when this row was computed. */
  computedAt: z.string().min(1),
});

export type StateRow = z.infer<typeof StateRowSchema>;

/** The publish stamp, passed explicitly and never defaulted, like every other publish-path stamp. */
export interface StateStamp {
  readonly generation: string;
  readonly computedAt: string;
}

/** Thrown when `deserializeState` gets no league row: a load without league aggregates would silently cold-start every metric. */
export class MissingLeagueRowError extends Error {
  constructor(algorithmId: string) {
    super(
      `deserializeState: no scopeKind:"league" row present for algorithm "${algorithmId}" — a partial load ` +
        `with no league aggregates would silently cold-start every metric instead of failing loudly`
    );
    this.name = "MissingLeagueRowError";
  }
}

/** Thrown when `serializeState` or `deserializeState` is given an algorithm id with no branch of its own. */
export class UnknownStateAlgorithmError extends Error {
  constructor(algorithmId: string) {
    super(`serializeState/deserializeState: unknown algorithm id "${algorithmId}" (known: opr, epa, spr)`);
    this.name = "UnknownStateAlgorithmError";
  }
}

/**
 * The shape every league payload must declare (`snapshotShapeVersion`) so
 * `deserializeState` refuses anything stale.
 *
 * Bump it whenever a league OR team row's fields change shape, including an
 * added passenger key: the Worker's `readScopedState` filters by `algorithm_id`
 * only, so this check is the only thing that stops a stale seeded row
 * deserializing a new field as `undefined` (a row without the RP mean shift
 * would resume a fresh shift and silently misprice live matches). Every bump
 * needs a Worker re-seed from a fresh publish: seed first, deploy second.
 *
 * Removing a field needs no bump: deserializers read named fields and ignore
 * extras.
 */
export const STATE_SNAPSHOT_SHAPE_VERSION = 16;

/** Thrown when the league row's `snapshotShapeVersion` is absent or not `STATE_SNAPSHOT_SHAPE_VERSION`, instead of misreading its fields. */
export class LeagueRowShapeVersionError extends Error {
  constructor(algorithmId: string, found: unknown) {
    super(
      `deserializeState: algorithm "${algorithmId}" league row does not declare snapshotShapeVersion ` +
        `${STATE_SNAPSHOT_SHAPE_VERSION} (found ${JSON.stringify(found)}) — this is either a retired-shape row ` +
        `(per-team data stored inside the league row) or a stale version, and reading it as the ` +
        `current shape would silently misinterpret or drop data rather than fail loudly. Re-seed this algorithm ` +
        `from a fresh publish run.`
    );
    this.name = "LeagueRowShapeVersionError";
  }
}

/**
 * A league row's `stateJson` must never grow with team count; it holds only
 * league-wide aggregates. 16 KB leaves headroom for more components while
 * staying about 6x under D1's 100,000-byte statement limit. Asserted by tests,
 * not thrown by `serializeState`.
 */
export const MAX_LEAGUE_ROW_BYTES = 16384;

// ---------------------------------------------------------------------------
// Stable serialization helpers
// ---------------------------------------------------------------------------

/** Recursively sorts plain objects' keys (arrays keep their order), so equal values stringify identically regardless of insertion order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) result[key] = canonicalize(record[key]);
    return result;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** A map as a key-sorted `[key, value]` array, the one shape every `Map` is serialized through. */
function sortedEntries<V>(map: ReadonlyMap<string, V>): [string, V][] {
  return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function makeRow(
  algorithmId: string,
  algorithmVersion: string,
  scopeKind: StateRowScopeKind,
  scopeKey: string,
  payload: unknown,
  stamp: StateStamp
): StateRow {
  return {
    algorithmId,
    algorithmVersion,
    scopeKind,
    scopeKey,
    stateJson: stableStringify(payload),
    generation: stamp.generation,
    computedAt: stamp.computedAt,
  };
}

// ---------------------------------------------------------------------------
// EPA
// ---------------------------------------------------------------------------

interface SerializedEpaTeamState {
  components: Record<string, number>;
  matchCount: number;
}

interface SerializedEpaLeague {
  snapshotShapeVersion: number;
  season: number | null;
  allianceScoreStats: ExpandingStats;
  /** The season-wide pair behind the live, pre-seal foul rate. Independent accumulators, so flat fields are safe. */
  allianceNoFoulStats: ExpandingStats;
  allianceFoulStats: ExpandingStats;
  /** The outgoing season's alliance-score mean. `null` on the wire stands for `NaN` ("no boundary crossed yet"), since JSON has no NaN. */
  carrySeedMean: number | null;
  /** EPA's week-1 calibration state, nested so its fields can never be partially present. */
  weekOne: SerializedEpaWeekOne;
  fallbackSkipped: number;
  breakdownParseFailureCount: number;
}

/** The wire form of `EpaWeekOneState`; already plain JSON, so no NaN handling. */
interface SerializedEpaWeekOne {
  stats: ExpandingStats;
  frozen: { mean: number; sd: number } | null;
  /** The week-1-only no-foul/foul accumulators the frozen rate is sealed from. */
  noFoulStats: ExpandingStats;
  foulStats: ExpandingStats;
  /** The frozen `get_foul_rate()` record, or `null` when the seal refused a degenerate rate. */
  frozenFoul: { rate: number; noFoulMean: number } | null;
  sealed: boolean;
}

/** An EPA team row: current-season state, prior-season ratings, or both. Absent parts are omitted, never placeholders. */
interface SerializedEpaTeamRow {
  current?: SerializedEpaTeamState;
  priorSeasonLastSeason?: number;
  priorSeasonYearBefore?: number;
  /** Carried across the latest season boundary but not yet rescaled to the new season's points. Omitted when false, so ordinary rows stay byte-identical. */
  carryPending?: true;
}

function serializeEpaState(algorithmId: string, algorithmVersion: string, state: EpaState, stamp: StateStamp): StateRow[] {
  const leagueJson: SerializedEpaLeague = {
    snapshotShapeVersion: STATE_SNAPSHOT_SHAPE_VERSION,
    season: state.season,
    allianceScoreStats: state.allianceScoreStats,
    allianceNoFoulStats: state.allianceNoFoulStats,
    allianceFoulStats: state.allianceFoulStats,
    carrySeedMean: Number.isFinite(state.carrySeedMean) ? state.carrySeedMean : null,
    weekOne: {
      stats: state.weekOne.stats,
      frozen: state.weekOne.frozen === null ? null : { mean: state.weekOne.frozen.mean, sd: state.weekOne.frozen.sd },
      noFoulStats: state.weekOne.noFoulStats,
      foulStats: state.weekOne.foulStats,
      frozenFoul:
        state.weekOne.frozenFoul === null
          ? null
          : { rate: state.weekOne.frozenFoul.rate, noFoulMean: state.weekOne.frozenFoul.noFoulMean },
      sealed: state.weekOne.sealed,
    },
    fallbackSkipped: state.fallbackSkipped,
    breakdownParseFailureCount: state.breakdownParseFailureCount,
  };

  const rows: StateRow[] = [makeRow(algorithmId, algorithmVersion, "league", "league", leagueJson, stamp)];

  // The union of every map's keys, so a team present in only one still gets a row.
  const teamKeys = new Set<string>([
    ...state.teamComponents.keys(),
    ...state.teamMatchCounts.keys(),
    ...state.priorSeasonRatings.lastSeason.keys(),
    ...state.priorSeasonRatings.yearBefore.keys(),
    // Redundant today (pending teams come from `teamComponents`), but keeps the
    // flag if that ever stops being true.
    ...state.carryPending,
  ]);
  for (const teamKey of [...teamKeys].sort()) {
    const components = state.teamComponents.get(teamKey);
    const matchCount = state.teamMatchCounts.get(teamKey);
    const hasCurrent = components !== undefined || matchCount !== undefined;
    const priorSeasonLastSeason = state.priorSeasonRatings.lastSeason.get(teamKey);
    const priorSeasonYearBefore = state.priorSeasonRatings.yearBefore.get(teamKey);
    const teamJson: SerializedEpaTeamRow = {
      ...(hasCurrent ? { current: { components: components ?? {}, matchCount: matchCount ?? 0 } } : {}),
      ...(priorSeasonLastSeason !== undefined ? { priorSeasonLastSeason } : {}),
      ...(priorSeasonYearBefore !== undefined ? { priorSeasonYearBefore } : {}),
      ...(state.carryPending.has(teamKey) ? { carryPending: true as const } : {}),
    };
    rows.push(makeRow(algorithmId, algorithmVersion, "team", teamKey, teamJson, stamp));
  }
  return rows;
}

function deserializeEpaState(algorithmId: string, rows: readonly StateRow[]): EpaState {
  const leagueRow = rows.find((r) => r.scopeKind === "league");
  if (!leagueRow) throw new MissingLeagueRowError(algorithmId);
  const leagueJson = JSON.parse(leagueRow.stateJson) as SerializedEpaLeague;
  if (leagueJson.snapshotShapeVersion !== STATE_SNAPSHOT_SHAPE_VERSION) {
    throw new LeagueRowShapeVersionError(algorithmId, leagueJson.snapshotShapeVersion);
  }

  const teamComponents = new Map<string, Readonly<Record<string, number>>>();
  const teamMatchCounts = new Map<string, number>();
  const lastSeason = new Map<string, number>();
  const yearBefore = new Map<string, number>();
  const carryPending = new Set<string>();
  for (const row of rows) {
    if (row.scopeKind !== "team") continue;
    const teamJson = JSON.parse(row.stateJson) as SerializedEpaTeamRow;
    if (teamJson.carryPending === true) carryPending.add(row.scopeKey);
    if (teamJson.current !== undefined) {
      teamComponents.set(row.scopeKey, teamJson.current.components);
      teamMatchCounts.set(row.scopeKey, teamJson.current.matchCount);
    }
    if (teamJson.priorSeasonLastSeason !== undefined) lastSeason.set(row.scopeKey, teamJson.priorSeasonLastSeason);
    if (teamJson.priorSeasonYearBefore !== undefined) yearBefore.set(row.scopeKey, teamJson.priorSeasonYearBefore);
  }

  return {
    season: leagueJson.season,
    teamComponents,
    teamMatchCounts,
    allianceScoreStats: leagueJson.allianceScoreStats,
    // No `??` default: the shape gate guarantees presence, and a default would
    // silently pin the Worker at a legal-looking zero foul rate.
    allianceNoFoulStats: leagueJson.allianceNoFoulStats,
    allianceFoulStats: leagueJson.allianceFoulStats,
    carrySeedMean: leagueJson.carrySeedMean === null ? Number.NaN : leagueJson.carrySeedMean,
    carryPending,
    // No `??` default: one would leave the Worker on the live week-1 estimate
    // while the publisher uses the frozen constant.
    weekOne: {
      stats: leagueJson.weekOne.stats,
      frozen: leagueJson.weekOne.frozen === null ? null : { mean: leagueJson.weekOne.frozen.mean, sd: leagueJson.weekOne.frozen.sd },
      noFoulStats: leagueJson.weekOne.noFoulStats,
      foulStats: leagueJson.weekOne.foulStats,
      frozenFoul:
        leagueJson.weekOne.frozenFoul === null
          ? null
          : { rate: leagueJson.weekOne.frozenFoul.rate, noFoulMean: leagueJson.weekOne.frozenFoul.noFoulMean },
      sealed: leagueJson.weekOne.sealed,
    },
    fallbackSkipped: leagueJson.fallbackSkipped,
    priorSeasonRatings: { lastSeason, yearBefore },
    breakdownParseFailureCount: leagueJson.breakdownParseFailureCount,
  };
}

// ---------------------------------------------------------------------------
// OPR (event-scoped — rows keyed by EVENT, never team)
// ---------------------------------------------------------------------------

interface SerializedOprEventState {
  observations: { teams: string[]; allianceScore: number }[];
  ratings: [string, number][];
}

interface SerializedOprLeague {
  snapshotShapeVersion: number;
  /** The season-wide expanding alliance-score accumulator behind OPR's logistic scale. League-scoped, like every other algorithm's own `allianceScoreStats`. */
  allianceScoreStats: ExpandingStats;
}

/** `lastEventByTeam`'s entry, in its own team row: the league row must stay flat in team count, and an event row is ambiguous under interleaved events. */
interface SerializedOprTeamRow {
  lastEventKey: string;
}

function serializeOprState(algorithmId: string, algorithmVersion: string, state: OprState, stamp: StateStamp): StateRow[] {
  const leagueJson: SerializedOprLeague = {
    snapshotShapeVersion: STATE_SNAPSHOT_SHAPE_VERSION,
    allianceScoreStats: state.allianceScoreStats,
  };

  const rows: StateRow[] = [makeRow(algorithmId, algorithmVersion, "league", "league", leagueJson, stamp)];

  for (const [teamKey, lastEventKey] of sortedEntries(state.lastEventByTeam)) {
    const teamJson: SerializedOprTeamRow = { lastEventKey };
    rows.push(makeRow(algorithmId, algorithmVersion, "team", teamKey, teamJson, stamp));
  }

  for (const [eventKey, eventState] of sortedEntries(state.perEvent)) {
    const eventJson: SerializedOprEventState = {
      observations: eventState.observations.map((observation) => ({
        teams: [...observation.teams],
        allianceScore: observation.allianceScore,
      })),
      ratings: sortedEntries(eventState.ratings),
    };
    rows.push(makeRow(algorithmId, algorithmVersion, "event", eventKey, eventJson, stamp));
  }
  return rows;
}

function deserializeOprState(algorithmId: string, rows: readonly StateRow[]): OprState {
  const leagueRow = rows.find((r) => r.scopeKind === "league");
  if (!leagueRow) throw new MissingLeagueRowError(algorithmId);
  const leagueJson = JSON.parse(leagueRow.stateJson) as SerializedOprLeague;
  if (leagueJson.snapshotShapeVersion !== STATE_SNAPSHOT_SHAPE_VERSION) {
    throw new LeagueRowShapeVersionError(algorithmId, leagueJson.snapshotShapeVersion);
  }

  const perEvent = new Map<string, { observations: OprObservation[]; ratings: Map<string, number> }>();
  const lastEventByTeam = new Map<string, string>();
  for (const row of rows) {
    if (row.scopeKind === "event") {
      const eventJson = JSON.parse(row.stateJson) as SerializedOprEventState;
      perEvent.set(row.scopeKey, {
        observations: eventJson.observations,
        ratings: new Map(eventJson.ratings),
      });
    } else if (row.scopeKind === "team") {
      const teamJson = JSON.parse(row.stateJson) as SerializedOprTeamRow;
      lastEventByTeam.set(row.scopeKey, teamJson.lastEventKey);
    }
  }

  return { perEvent, lastEventByTeam, allianceScoreStats: leagueJson.allianceScoreStats };
}

// ---------------------------------------------------------------------------
// SPR
// ---------------------------------------------------------------------------

interface SerializedSprLeague {
  snapshotShapeVersion: number;
  season: number | null;
  logTau: number;
  scale: number;
  scaleCount: number;
  /** Display-only per-phase point scales, keyed by group id. */
  phaseScale: Record<string, number>;
  phaseScaleCount: Record<string, number>;
}

/** One team's whole SPR state: slow talent (L) and fast form (S), each a mean and a variance. */
interface SerializedSprTeamRow {
  muL: number;
  pL: number;
  muS: number;
  pS: number;
  /** Display-only per-phase filters, keyed by group id. A missing entry restores as a fresh phase filter; the predictor fields above resume exactly. */
  phases?: Record<string, SerializedSprPhase>;
}

interface SerializedSprPhase {
  muL: number;
  pL: number;
  muS: number;
  pS: number;
}

function serializeSprState(algorithmId: string, algorithmVersion: string, state: SprState, stamp: StateStamp): StateRow[] {
  const leagueJson: SerializedSprLeague = {
    snapshotShapeVersion: STATE_SNAPSHOT_SHAPE_VERSION,
    season: state.season,
    // Real league state, not derived: logTau is the online link temperature,
    // scale is a trailing online estimate of the point level (not a season
    // constant), and scaleCount pins its learning rate at the `scaleMinLr`
    // floor. Dropping any of them silently resets a resumed model.
    logTau: state.logTau,
    scale: state.scale,
    scaleCount: state.scaleCount,
    phaseScale: { ...state.phaseScale },
    phaseScaleCount: { ...state.phaseScaleCount },
  };

  const rows: StateRow[] = [makeRow(algorithmId, algorithmVersion, "league", "league", leagueJson, stamp)];
  for (const teamKey of [...state.teams.keys()].sort()) {
    const team = state.teams.get(teamKey);
    if (team === undefined) continue;
    const phases: Record<string, SerializedSprPhase> = {};
    for (const phase of COMPONENT_GROUP_IDS) {
      const ps = state.phaseTeams[phase].get(teamKey);
      if (ps === undefined) continue;
      phases[phase] = { muL: ps.muL, pL: ps.pL, muS: ps.muS, pS: ps.pS };
    }
    const teamJson: SerializedSprTeamRow = { muL: team.muL, pL: team.pL, muS: team.muS, pS: team.pS, phases };
    rows.push(makeRow(algorithmId, algorithmVersion, "team", teamKey, teamJson, stamp));
  }
  return rows;
}

function deserializeSprState(algorithmId: string, rows: readonly StateRow[]): SprState {
  const leagueRow = rows.find((r) => r.scopeKind === "league");
  if (!leagueRow) throw new MissingLeagueRowError(algorithmId);
  const leagueJson = JSON.parse(leagueRow.stateJson) as SerializedSprLeague;
  if (leagueJson.snapshotShapeVersion !== STATE_SNAPSHOT_SHAPE_VERSION) {
    throw new LeagueRowShapeVersionError(algorithmId, leagueJson.snapshotShapeVersion);
  }

  const teams = new Map<string, SprTeamState>();
  const phaseTeams: Record<ComponentGroupId, Map<string, SprTeamState>> = {
    auto: new Map(),
    teleop: new Map(),
    endgame: new Map(),
  };
  for (const row of rows) {
    if (row.scopeKind !== "team") continue;
    const t = JSON.parse(row.stateJson) as SerializedSprTeamRow;
    teams.set(row.scopeKey, { muL: t.muL, pL: t.pL, muS: t.muS, pS: t.pS });
    for (const phase of COMPONENT_GROUP_IDS) {
      const ps = t.phases?.[phase];
      if (ps === undefined) continue;
      phaseTeams[phase].set(row.scopeKey, { muL: ps.muL, pL: ps.pL, muS: ps.muS, pS: ps.pS });
    }
  }

  const phaseNumbers = (source: Record<string, number> | undefined): SprPhaseRecord<number> => ({
    auto: source?.auto ?? 0,
    teleop: source?.teleop ?? 0,
    endgame: source?.endgame ?? 0,
  });

  return {
    season: leagueJson.season,
    teams,
    logTau: leagueJson.logTau,
    scale: leagueJson.scale,
    scaleCount: leagueJson.scaleCount,
    phaseTeams,
    phaseScale: phaseNumbers(leagueJson.phaseScale),
    phaseScaleCount: phaseNumbers(leagueJson.phaseScaleCount),
  };
}

// ---------------------------------------------------------------------------
// The SigmaScout-layer passengers
// ---------------------------------------------------------------------------
//
// Level-2 passengers ride in level-1 rows under `sigmascout{Feature}` keys,
// written and read only by the helpers below; they are not algorithm state, and
// every per-algorithm deserializer ignores them. Per-team beliefs go in team
// rows only, because nothing in the league row may scale with team count.

const SIGMA_BELIEF_KEY = "sigmascoutSigma";
const SIGMA_POPULATION_KEY = "sigmascoutSigmaPopulation";

/**
 * The inverse of `withSigmaBeliefs`. A belief missing any field is skipped, not
 * part-filled: a partial belief gives a plausible wrong band, which is far
 * harder to notice than no band.
 */
export function readSigmaBeliefs(rows: readonly StateRow[]): Map<string, SigmaBelief> {
  const beliefs = new Map<string, SigmaBelief>();
  for (const row of rows) {
    if (row.scopeKind !== "team") continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.stateJson) as Record<string, unknown>;
    } catch {
      continue;
    }
    const raw = parsed[SIGMA_BELIEF_KEY] as Partial<SigmaBelief> | undefined;
    if (raw === undefined) continue;
    const { meanWeight, mean, varWeight, sumSquares, talent } = raw;
    if (![meanWeight, mean, varWeight, sumSquares, talent].every((v) => typeof v === "number" && Number.isFinite(v))) {
      continue;
    }
    beliefs.set(row.scopeKey, {
      meanWeight: meanWeight!,
      mean: mean!,
      varWeight: varWeight!,
      sumSquares: sumSquares!,
      talent: talent!,
    });
  }
  return beliefs;
}

/** Injects each team's Sigma belief into the TEAM rows, returning new rows rather than mutating them. */
export function withSigmaBeliefs(rows: readonly StateRow[], beliefs: ReadonlyMap<string, SigmaBelief>): StateRow[] {
  return rows.map((row) => {
    if (row.scopeKind !== "team") return row;
    const belief = beliefs.get(row.scopeKey);
    if (belief === undefined) return row;
    const parsed = JSON.parse(row.stateJson) as Record<string, unknown>;
    return { ...row, stateJson: JSON.stringify({ ...parsed, [SIGMA_BELIEF_KEY]: belief }) };
  });
}

/** The Sigma population statistics from the LEAGUE row, or `undefined` (a real answer: the caller uses the flat prior). */
export function readSigmaPopulation(rows: readonly StateRow[]): SigmaPopulation | undefined {
  for (const row of rows) {
    if (row.scopeKind !== "league") continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.stateJson) as Record<string, unknown>;
    } catch {
      return undefined;
    }
    const raw = parsed[SIGMA_POPULATION_KEY] as Partial<SigmaPopulation> | undefined;
    if (raw === undefined) return undefined;
    const { sumSquares, talentSquares, count } = raw;
    if (![sumSquares, talentSquares, count].every((v) => typeof v === "number" && Number.isFinite(v))) return undefined;
    return { sumSquares: sumSquares!, talentSquares: talentSquares!, count: count! };
  }
  return undefined;
}

/** Injects the Sigma population statistics into the LEAGUE row. Three numbers, so this cannot scale with team count. */
export function withSigmaPopulation(rows: readonly StateRow[], population: SigmaPopulation): StateRow[] {
  return rows.map((row) => {
    if (row.scopeKind !== "league") return row;
    const parsed = JSON.parse(row.stateJson) as Record<string, unknown>;
    return { ...row, stateJson: JSON.stringify({ ...parsed, [SIGMA_POPULATION_KEY]: population }) };
  });
}

/** The team-row key for ranking-point beliefs. */
const RP_BELIEF_KEY = "sigmascoutRp";

/**
 * The inverse of `withRpBeliefs`. All-or-nothing per team: if any variable entry
 * is missing a field or non-finite, the whole team is skipped, because
 * `momentsFor` silently sums whatever it finds and a half-filled record yields
 * a narrower, overconfident pmf. A team with no key means "no history".
 */
export function readRpBeliefs(rows: readonly StateRow[]): Map<string, RpTeamBeliefs> {
  const beliefs = new Map<string, RpTeamBeliefs>();
  for (const row of rows) {
    if (row.scopeKind !== "team") continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.stateJson) as Record<string, unknown>;
    } catch {
      continue;
    }
    const raw = parsed[RP_BELIEF_KEY] as Record<string, Partial<RpVariableBelief>> | undefined;
    if (raw === undefined || typeof raw !== "object" || raw === null) continue;
    const entries = Object.entries(raw);
    if (entries.length === 0) continue;
    const record: Record<string, RpVariableBelief> = {};
    let usable = true;
    for (const [name, belief] of entries) {
      if (belief === null || typeof belief !== "object") {
        usable = false;
        break;
      }
      const { weight, weightSquares, mean, m2 } = belief;
      if (![weight, weightSquares, mean, m2].every((v) => typeof v === "number" && Number.isFinite(v))) {
        usable = false;
        break;
      }
      record[name] = { weight: weight!, weightSquares: weightSquares!, mean: mean!, m2: m2! };
    }
    if (!usable) continue;
    beliefs.set(row.scopeKey, record);
  }
  return beliefs;
}

/** Injects each team's RP beliefs into the TEAM rows, returning new rows. A team with no belief gets no key. */
export function withRpBeliefs(rows: readonly StateRow[], beliefs: ReadonlyMap<string, RpTeamBeliefs>): StateRow[] {
  return rows.map((row) => {
    if (row.scopeKind !== "team") return row;
    const belief = beliefs.get(row.scopeKey);
    if (belief === undefined) return row;
    const parsed = JSON.parse(row.stateJson) as Record<string, unknown>;
    return { ...row, stateJson: JSON.stringify({ ...parsed, [RP_BELIEF_KEY]: belief }) };
  });
}

/** The league-row key for the ranking-point mean shift (`meanShift.ts`). */
const RP_MEAN_SHIFT_KEY = "sigmascoutRpMeanShift";

/**
 * The inverse of `withRpMeanShift`, or `undefined` (the caller starts a fresh
 * accumulator). All-or-nothing: any malformed field makes the whole state
 * `undefined`, since a half-read shift would move some variables and not others.
 */
export function readRpMeanShift(rows: readonly StateRow[]): RpMeanShiftState | undefined {
  for (const row of rows) {
    if (row.scopeKind !== "league") continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.stateJson) as Record<string, unknown>;
    } catch {
      return undefined;
    }
    const raw = parsed[RP_MEAN_SHIFT_KEY];
    if (raw === null || typeof raw !== "object") return undefined;
    const { season, variables } = raw as { season?: unknown; variables?: unknown };
    if (typeof season !== "number" || !Number.isInteger(season)) return undefined;
    if (variables === null || typeof variables !== "object" || Array.isArray(variables)) return undefined;
    const out: Record<string, RpMeanShiftVariableState> = {};
    for (const [name, entry] of Object.entries(variables as Record<string, unknown>)) {
      if (entry === null || typeof entry !== "object") return undefined;
      const { count, sum } = entry as { count?: unknown; sum?: unknown };
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0) return undefined;
      if (typeof sum !== "number" || !Number.isFinite(sum)) return undefined;
      out[name] = { count, sum };
    }
    return { season, variables: out };
  }
  return undefined;
}

/** Injects the mean shift into the LEAGUE row, returning new rows. A count and sum per variable, so it cannot scale with team count. */
export function withRpMeanShift(rows: readonly StateRow[], state: RpMeanShiftState): StateRow[] {
  return rows.map((row) => {
    if (row.scopeKind !== "league") return row;
    const parsed = JSON.parse(row.stateJson) as Record<string, unknown>;
    return { ...row, stateJson: JSON.stringify({ ...parsed, [RP_MEAN_SHIFT_KEY]: state }) };
  });
}

// ---------------------------------------------------------------------------
// Public dispatch
// ---------------------------------------------------------------------------

/** One algorithm's state as `StateRow`s for a D1 seed. Any unbranched id throws rather than falling into another model's serializer. */
export function serializeState(
  algorithmId: string,
  algorithmVersion: string,
  state: EpaState | OprState | SprState,
  stamp: StateStamp
): StateRow[] {
  if (algorithmId === "opr") return serializeOprState(algorithmId, algorithmVersion, state as OprState, stamp);
  if (algorithmId === "epa") return serializeEpaState(algorithmId, algorithmVersion, state as EpaState, stamp);
  if (algorithmId === "spr") return serializeSprState(algorithmId, algorithmVersion, state as SprState, stamp);
  throw new UnknownStateAlgorithmError(algorithmId);
}

/** The inverse of `serializeState`, for a matching (possibly partial) set of rows. Throws `MissingLeagueRowError` without a league row. */
export function deserializeState(algorithmId: string, rows: readonly StateRow[]): EpaState | OprState | SprState {
  if (algorithmId === "opr") return deserializeOprState(algorithmId, rows);
  if (algorithmId === "epa") return deserializeEpaState(algorithmId, rows);
  if (algorithmId === "spr") return deserializeSprState(algorithmId, rows);
  throw new UnknownStateAlgorithmError(algorithmId);
}
