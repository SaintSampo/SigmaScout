/**
 * The offline-to-online state handoff: turns a shipped algorithm's
 * in-memory state into a flat array of `StateRow`s a Worker can read a
 * slice of from D1, and back again — losslessly, proven by a
 * continuation-replay digest match rather than a structural deep-equal
 * (see `stateSnapshot.test.ts`).
 *
 * `scopeKind` exists because the three shipped algorithms do not share a
 * granularity: EPA and SPR accumulate per TEAM, event-scoped OPR
 * accumulates per EVENT (`OprState.perEvent`, keyed by `eventKey` — because
 * season-pooled OPR's per-team state exceeds a Worker's memory outright). A
 * `team_state` table would have forced OPR's event-shaped state into a
 * per-team column; the table and this serializer both say `scope` instead.
 *
 * Every `Map` member of every algorithm's state is converted explicitly to a
 * KEY-SORTED array of `[key, value]` pairs on the way out (`JSON.stringify`
 * turns a `Map` into `{}` with no error) and rebuilt with `new Map()` on the
 * way in. Every plain object is also serialized with its keys sorted
 * (`canonicalize` below) — together these two disciplines are what let
 * re-serializing an UNCHANGED team produce the byte-identical `stateJson`
 * string, which is what lets a real Worker tick skip a D1 write for a team
 * that did not move.
 *
 * `emitSeedSql` (below) turns `serializeState`'s row output into a `.sql`
 * file `wrangler d1 execute --file` can import — the bulk-seed path that
 * fills `apps/worker/migrations/0001_algorithm_state.sql`'s `algorithm_state`
 * table from a real offline replay.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
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

/** D-09: the three granularities the shipped algorithms actually accumulate at — never a single assumed shape. */
export const STATE_ROW_SCOPE_KINDS = ["team", "event", "league"] as const;
export type StateRowScopeKind = (typeof STATE_ROW_SCOPE_KINDS)[number];

export const StateRowSchema = z.object({
  algorithmId: z.string().min(1),
  algorithmVersion: z.string().min(1),
  scopeKind: z.enum(STATE_ROW_SCOPE_KINDS),
  scopeKey: z.string().min(1),
  stateJson: z.string(),
  /** D-04: a short opaque string identifying the publish run that produced this row. */
  generation: z.string().min(1),
  /** D-04: ISO timestamp of when this row was computed. */
  computedAt: z.string().min(1),
});

export type StateRow = z.infer<typeof StateRowSchema>;

/** D-04's stamp, threaded through `serializeState` explicitly — never defaulted implicitly, matching every other publish-path stamp in this codebase (`pageArtifacts.ts`'s `buildEventArtifact`). */
export interface StateStamp {
  readonly generation: string;
  readonly computedAt: string;
}

/** Thrown when `deserializeState` is given rows with no `scopeKind: "league"` entry — a partial load with no league aggregates would silently cold-start every metric rather than failing loudly. */
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
 * The current shape every `scopeKind: "league"` payload must declare
 * (`snapshotShapeVersion`) so `deserializeState` can refuse anything stale.
 * A retired-shape row (per-team maps living inside the league row) has no
 * `snapshotShapeVersion` field at all, so it always fails this check too.
 *
 * Bump this whenever a league OR team row's FIELDS change shape.
 * `apps/worker/src/stateStore.ts`'s `readScopedState` filters rows by
 * `algorithm_id` ONLY, never by `algorithm_version`, so a version bump alone
 * does not make a stale seeded row unreachable — only this shape check does,
 * by throwing `LeagueRowShapeVersionError` instead of silently deserializing
 * a new field as `undefined` (or a dropped one as an ignored extra). Every
 * bump costs a Worker re-seed from a fresh publish run; seed first, deploy
 * second.
 *
 * A field CAN be removed without a bump: every per-algorithm deserializer
 * reads named fields and ignores extras, so a stale row still carrying a
 * retired passenger key reads identically (`stateSnapshot.test.ts` pins this
 * with an unknown passenger key).
 */
export const STATE_SNAPSHOT_SHAPE_VERSION = 15;

/**
 * Thrown when `deserializeState`'s league row does not declare the current
 * `STATE_SNAPSHOT_SHAPE_VERSION` — either absent (the retired pre-04-08
 * shape, which stored per-team data inside the league row) or a stale
 * numeric value from some future re-shape. Reading either silently would
 * either drop per-team data that isn't there to find (retired shape) or
 * misinterpret fields against the wrong version's meaning — this makes that
 * failure loud instead, mirroring `MissingLeagueRowError`'s own reasoning
 * and message style.
 */
export class LeagueRowShapeVersionError extends Error {
  constructor(algorithmId: string, found: unknown) {
    super(
      `deserializeState: algorithm "${algorithmId}" league row does not declare snapshotShapeVersion ` +
        `${STATE_SNAPSHOT_SHAPE_VERSION} (found ${JSON.stringify(found)}) — this is either a retired-shape row ` +
        `(per-team data stored inside the league row, pre plan-04-08) or a stale version, and reading it as the ` +
        `current shape would silently misinterpret or drop data rather than fail loudly. Re-seed this algorithm ` +
        `from a fresh publish run.`
    );
    this.name = "LeagueRowShapeVersionError";
  }
}

/**
 * A `scopeKind: "league"` row's `stateJson` byte length must never grow with
 * the number of teams in the season — it holds only genuinely league-wide
 * aggregates. 16384 (16 KB) leaves headroom above measured genuine-aggregate
 * size for a season with more components, while staying roughly 6x under
 * D1's real 100,000-byte per-statement limit. `serializeState` does NOT
 * throw when a league row exceeds this — the constant exists so tests (and
 * `docs/publish-budget.md`) can assert against it; a hard throw here would
 * make a legitimate future aggregate a harder failure than a red test.
 */
export const MAX_LEAGUE_ROW_BYTES = 16384;

// ---------------------------------------------------------------------------
// Stable serialization helpers
// ---------------------------------------------------------------------------

/** Recursively sorts every plain object's keys (arrays keep their own order) so two structurally-identical values always produce the identical JSON string, regardless of property insertion order. */
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

/** A `ReadonlyMap` converted to a key-sorted array of `[key, value]` pairs — the one shape every `Map` member in this file is serialized through. */
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
  /**
   * `EpaState.allianceNoFoulStats` / `.allianceFoulStats` — the SEASON-WIDE
   * pair backing the live, pre-seal foul rate. Flat sibling fields rather
   * than a nested object, deliberately unlike `weekOne` below: these two are
   * independent accumulators with no third field whose partial presence
   * could represent an impossible state.
   */
  allianceNoFoulStats: ExpandingStats;
  allianceFoulStats: ExpandingStats;
  /**
   * `EpaState.carrySeedMean`, the outgoing season's alliance-score mean.
   * `null` ON THE WIRE stands for `Number.NaN` ("no boundary crossed yet")
   * — JSON has no NaN, so writing it naively yields `null` but reads back
   * as a value that is NOT NaN, silently turning "unreadable" into something
   * `carryRescaleRatio` would have to guess about.
   */
  carrySeedMean: number | null;
  /**
   * `EpaState.weekOne`, EPA's week-1 calibration state — the week-1-only
   * accumulator, the frozen `{mean, sd}` aggregate (or `null` while week 1
   * is still running, or when the seal found too little data), and whether
   * the seal has already been attempted.
   *
   * Written as a plain object rather than flattened into three sibling fields
   * so the three cannot be partially present: a row carrying `frozen` without
   * `sealed` would be a state `epaWeekOne.ts` can never produce, and the
   * nested shape makes that unrepresentable instead of merely unlikely.
   */
  weekOne: SerializedEpaWeekOne;
  fallbackSkipped: number;
  breakdownParseFailureCount: number;
}

/** The wire form of `EpaWeekOneState`. `ExpandingStats` and a nullable record are both plain JSON already, so no NaN-to-null dance is needed here (contrast `carrySeedMean` above). */
interface SerializedEpaWeekOne {
  stats: ExpandingStats;
  frozen: { mean: number; sd: number } | null;
  /** The week-1-only no-foul/foul accumulators the frozen rate is sealed from. */
  noFoulStats: ExpandingStats;
  foulStats: ExpandingStats;
  /** The frozen `get_foul_rate()` record, or `null` when the seal refused a degenerate rate. Nested here rather than beside `frozen` at the league level so the whole week-1 state stays one object that cannot be partially present. */
  frozenFoul: { rate: number; noFoulMean: number } | null;
  sealed: boolean;
}

/**
 * A `scopeKind: "team"` row's payload for epa is a UNION — a team may have
 * current-season state, a prior-season rating (from
 * `priorSeasonRatings.lastSeason`/`.yearBefore`), or both. `current` is
 * omitted entirely for a team with no current-season entry (a team known
 * only via a prior-season rating) — never a placeholder/empty object, so the
 * shape a reader sees on the wire matches exactly what was actually there.
 */
interface SerializedEpaTeamRow {
  current?: SerializedEpaTeamState;
  priorSeasonLastSeason?: number;
  priorSeasonYearBefore?: number;
  /**
   * This team is carried across the most recent boundary and has NOT yet
   * been materialized into the incoming season's point units. OMITTED when
   * false, so an ordinary team's row stays byte-identical and publish-time
   * byte budgets are unchanged.
   */
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

  // The UNION of every map's keys — `teamComponents`/`teamMatchCounts`
  // (current-season) and `priorSeasonRatings.lastSeason`/`.yearBefore`
  // (prior-season). A team present in only one must still get its own row,
  // never silently dropped.
  const teamKeys = new Set<string>([
    ...state.teamComponents.keys(),
    ...state.teamMatchCounts.keys(),
    ...state.priorSeasonRatings.lastSeason.keys(),
    ...state.priorSeasonRatings.yearBefore.keys(),
    // A pending team always has a `teamComponents` entry today (`carrySeason`
    // builds the pending set FROM those keys), so this term adds nothing
    // right now. It is here so that if that ever stops being true, the team
    // still gets a row and keeps its flag rather than silently losing its
    // rescale.
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
    // Read straight through, with deliberately NO `??` default: the shape
    // gate above guarantees presence, and a default here would silently pin
    // the Worker at a zero foul rate — a LEGAL-looking rate nothing
    // downstream can flag.
    allianceNoFoulStats: leagueJson.allianceNoFoulStats,
    allianceFoulStats: leagueJson.allianceFoulStats,
    // `null` on the wire IS `NaN` — see SerializedEpaLeague.carrySeedMean.
    carrySeedMean: leagueJson.carrySeedMean === null ? Number.NaN : leagueJson.carrySeedMean,
    carryPending,
    // Read straight through: the shape-version gate above guarantees the
    // field is present, so there is deliberately NO `??` default here — a
    // default would be a Worker quietly running the live estimate all season
    // while the publisher runs the frozen constant.
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

/** `lastEventByTeam`'s per-team entry lives in its own team row rather than the league row, to keep the league row flat in team count. One row per team, never folded into that team's most-recent EVENT row — ambiguous under interleaved events. */
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
  /**
   * Display-only per-phase filters, keyed by group id. Absent on an older
   * row, which `deserializeSprState` restores as a fresh phase filter rather
   * than throwing — a resumed pre-existing snapshot loses only the phase
   * history it never had, and the PREDICTOR half above resumes exactly.
   */
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
    // All three are genuine league-level state, not derived: logTau is the
    // online link temperature, and scale/scaleCount are the online estimate
    // of the point level SPR's scale-free ratings are denominated against —
    // a ~100-match trailing EWMA over the globally interleaved stream, NOT a
    // season-level constant (see `packages/core/algorithms/spr.ts`'s
    // header). `scaleCount` is what pins that learning rate at its
    // `scaleMinLr` floor, so it is load-bearing state and not a diagnostic
    // counter. Dropping any of them would silently reset a resumed model.
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
// Level-2 passengers ride in level-1 rows but are written and read by the
// helpers below rather than by any algorithm's serializer. Deliberately
// standalone rather than folded into `deserializeState`: this is NOT algorithm
// state, and every per-algorithm deserializer ignores these keys entirely —
// each parses its own named fields and an extra property is invisible to it —
// which is exactly the separation this project's two-level split asks for.
//
// Only `scopeKind: "team"` rows carry per-team beliefs. The league row is left
// alone on purpose — `MAX_LEAGUE_ROW_BYTES` caps it at 16 KB precisely because
// nothing in it may scale with team count.

const SIGMA_BELIEF_KEY = "sigmascoutSigma";
const SIGMA_POPULATION_KEY = "sigmascoutSigmaPopulation";

/**
 * Reads each team's Sigma Score belief back out of the rows. The exact inverse
 * of `withSigmaBeliefs`.
 *
 * A belief missing any field is SKIPPED ENTIRELY rather than part-filled, the
 * same all-or-nothing rule `readRpBeliefs` applies: a partially written
 * belief would produce a plausible but wrong band rather than no band, and a
 * wrong band is far harder to notice than an absent one.
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

/**
 * Reads the Sigma talent prior's population statistics out of the LEAGUE row,
 * or `undefined` when absent.
 *
 * `undefined` is a real answer and not an error: a pre shape 11 row, or a
 * league that has folded nothing, legitimately has none. The caller must then
 * accept the flat prior rather than fabricate a population.
 */
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

/**
 * The key every `scopeKind: "team"` row carries its RANKING-POINT beliefs
 * under. `sigmascoutRp`, following `sigmascoutSigma`: the
 * `sigmascout{Feature}` prefix says out loud that this is a level-2 passenger
 * rather than part of any model.
 */
const RP_BELIEF_KEY = "sigmascoutRp";

/**
 * Reads every team's RP beliefs back out of the rows. The exact inverse of
 * `withRpBeliefs`.
 *
 * ALL-OR-NOTHING, AT TEAM GRANULARITY. Every variable entry in a team's
 * record is checked, and if ANY of them is missing a field or holds a
 * non-finite value the WHOLE TEAM is skipped rather than part-filled. The
 * reasoning `readSigmaBeliefs` records applies here and then some: a
 * partially-written belief produces a plausible but WRONG pmf rather than no
 * pmf, and a wrong one is far harder to notice than an absent one. It is
 * strictly worse for RP than for a band, because `momentsFor` sums silently
 * over whatever beliefs it finds and reports nothing when it finds fewer than
 * it should — a half-filled record yields a narrower, more confident
 * distribution with nothing anywhere flagging a problem.
 *
 * ABSENT IS A REAL ANSWER. A team row with no key yields no entry, and the
 * caller must treat that as "no history" and accept a cold start — never
 * fabricate one.
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

/**
 * Injects each team's RP beliefs into the TEAM rows, returning NEW rows
 * rather than mutating them.
 *
 * Only `scopeKind: "team"` rows are touched. The league row is left alone on
 * purpose — `MAX_LEAGUE_ROW_BYTES` caps it precisely because nothing in it
 * may scale with team count, and a per-team belief is the definition of
 * something that does.
 *
 * A team with no belief gets no key, which round-trips through
 * `readRpBeliefs` as "no history".
 */
export function withRpBeliefs(rows: readonly StateRow[], beliefs: ReadonlyMap<string, RpTeamBeliefs>): StateRow[] {
  return rows.map((row) => {
    if (row.scopeKind !== "team") return row;
    const belief = beliefs.get(row.scopeKey);
    if (belief === undefined) return row;
    const parsed = JSON.parse(row.stateJson) as Record<string, unknown>;
    return { ...row, stateJson: JSON.stringify({ ...parsed, [RP_BELIEF_KEY]: belief }) };
  });
}

/**
 * The key the LEAGUE row carries the ranking-point mean shift under
 * (`meanShift.ts`), in the `sigmascout{Feature}` passenger style.
 */
const RP_MEAN_SHIFT_KEY = "sigmascoutRpMeanShift";

/**
 * Reads the ranking-point mean shift out of the LEAGUE row, or `undefined`.
 * The exact inverse of `withRpMeanShift`. Team rows are ignored.
 *
 * ALL-OR-NOTHING. A missing or non-integer season, a variables entry that is
 * not an object, a count that is not a non-negative integer, or a non-finite
 * sum reads the WHOLE state as `undefined`: a half-read shift would move some
 * variables and not others, which is plausible and wrong. `undefined` is a
 * real answer, and the caller starts a fresh accumulator from it.
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

/**
 * Injects the ranking-point mean shift into the LEAGUE row, returning new rows
 * rather than mutating them. A count and a sum per threshold variable, so it
 * cannot scale with team count and stays far inside `MAX_LEAGUE_ROW_BYTES`.
 */
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

/**
 * Converts one algorithm's in-memory state into `StateRow`s ready for a D1
 * seed (`emitSeedSql`). Dispatches on `algorithmId`: `"opr"` is
 * event-scoped, `"epa"` and `"spr"` are team-scoped.
 *
 * Any other id throws `UnknownStateAlgorithmError`, because a silent default
 * branch once reinterpreted an unbranched algorithm's state as another model's
 * shape and crashed deep inside the wrong serializer instead of naming the id.
 */
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

/** The inverse of `serializeState` — reconstructs a state whose `predict()`/`update()` behavior is identical to the state it came from, for a matching (possibly partial) set of rows. Throws `MissingLeagueRowError` when no `scopeKind: "league"` row is present. */
export function deserializeState(algorithmId: string, rows: readonly StateRow[]): EpaState | OprState | SprState {
  if (algorithmId === "opr") return deserializeOprState(algorithmId, rows);
  if (algorithmId === "epa") return deserializeEpaState(algorithmId, rows);
  if (algorithmId === "spr") return deserializeSprState(algorithmId, rows);
  throw new UnknownStateAlgorithmError(algorithmId);
}

// ---------------------------------------------------------------------------
// The D1 bulk seed emitter
// ---------------------------------------------------------------------------

/** Every string field going into a SQL string literal is escaped by doubling its single quotes — the `state_json` blobs are arbitrary JSON text, and the other string fields (event/team keys, generation, ids) are treated with the same discipline defensively. */
function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

const INSERT_COLUMNS = "(algorithm_id, algorithm_version, scope_kind, scope_key, state_json, generation, computed_at)";

function sqlRowTuple(row: StateRow): string {
  return (
    `('${escapeSqlString(row.algorithmId)}', '${escapeSqlString(row.algorithmVersion)}', ` +
    `'${escapeSqlString(row.scopeKind)}', '${escapeSqlString(row.scopeKey)}', ` +
    `'${escapeSqlString(row.stateJson)}', '${escapeSqlString(row.generation)}', '${escapeSqlString(row.computedAt)}')`
  );
}

/**
 * D1's hard per-statement cap is **100,000 bytes**, and `wrangler d1 execute
 * --file` fails the whole import with `statement too long: SQLITE_TOOBIG` if
 * any single statement exceeds it. 90,000 leaves ~10 KB of headroom under
 * the cap for the `INSERT INTO ... VALUES` prefix and the trailing
 * semicolon, so a statement assembled right at the budget still lands
 * comfortably inside D1's limit.
 */
export const DEFAULT_MAX_STATEMENT_LENGTH = 90_000;

/** D1's documented hard limit, for the error message that fires when a single row cannot be split to fit. */
const D1_STATEMENT_LIMIT = 100_000;
/** A conservative starting cap on value-tuples per `INSERT`, independent of the character-length cap above — either limit reaching first triggers a new statement. */
const DEFAULT_MAX_ROWS_PER_INSERT = 500;

/**
 * Thrown when one `StateRow`'s own value tuple exceeds `maxStatementLength`.
 *
 * Batching cannot help: a single row is the smallest thing an `INSERT` can
 * carry, so no chunking strategy makes an over-limit row fit. Hitting this
 * means per-key data is being stored in a row that should hold aggregates
 * (e.g. a per-team map living in a `scopeKind: "league"` row) — the fix is
 * to move that data into `scopeKind: "team"` rows, so a tick reads only the
 * keys it is folding rather than parsing the whole league every minute.
 */
export class SeedRowTooLargeError extends Error {
  constructor(
    readonly algorithmId: string,
    readonly scopeKind: string,
    readonly scopeKey: string,
    readonly tupleLength: number,
    readonly maxStatementLength: number
  ) {
    super(
      `emitSeedSql: algorithm "${algorithmId}" row (scopeKind="${scopeKind}", scopeKey="${scopeKey}") is ${tupleLength} bytes as a single ` +
        `INSERT tuple, over the ${maxStatementLength}-byte per-statement budget (D1's hard limit is ${D1_STATEMENT_LIMIT}). ` +
        `A single row cannot be split across statements, so this cannot be fixed by batching — it means per-key data is being ` +
        `stored in a row meant for aggregates. Move it into scopeKind:"team" rows (D-13).`
    );
    this.name = "SeedRowTooLargeError";
  }
}

export interface EmitSeedSqlOptions {
  /** The algorithm this seed is for — becomes the `DELETE FROM algorithm_state WHERE algorithm_id = '<id>'` re-baseline guard (a re-baseline overwrites in place, it does not merge). */
  readonly algorithmId: string;
  /** Output `.sql` file path. */
  readonly out: string;
  /** Overrides `DEFAULT_MAX_ROWS_PER_INSERT`. */
  readonly maxRowsPerInsert?: number;
  /** Overrides `DEFAULT_MAX_STATEMENT_LENGTH`. */
  readonly maxStatementLength?: number;
}

/**
 * Turns `serializeState`'s row output into a `.sql` file `wrangler d1
 * execute --file` can import: a leading `DELETE FROM algorithm_state WHERE
 * algorithm_id = '<id>';` guard (a re-baseline is an overwrite — the offline
 * run is the authority, so it replaces rather than merges), then batched
 * multi-row `INSERT INTO algorithm_state (...) VALUES (...),(...),...;`
 * statements, each capped at BOTH `maxRowsPerInsert` value tuples (default
 * 500) AND `maxStatementLength` characters — whichever limit is reached
 * first starts a new statement. Single quotes in every string field are
 * escaped by doubling. Performs exactly ONE terminal file write, after every
 * statement is assembled in memory — an interrupted emit leaves no
 * half-file.
 */
export function emitSeedSql(rows: readonly StateRow[], options: EmitSeedSqlOptions): void {
  const { algorithmId, out } = options;
  const maxRowsPerInsert = options.maxRowsPerInsert ?? DEFAULT_MAX_ROWS_PER_INSERT;
  const maxStatementLength = options.maxStatementLength ?? DEFAULT_MAX_STATEMENT_LENGTH;

  const statements: string[] = [`DELETE FROM algorithm_state WHERE algorithm_id = '${escapeSqlString(algorithmId)}';`];

  let currentTuples: string[] = [];
  let currentLength = 0;

  const flush = (): void => {
    if (currentTuples.length === 0) return;
    statements.push(`INSERT INTO algorithm_state ${INSERT_COLUMNS} VALUES ${currentTuples.join(",")};`);
    currentTuples = [];
    currentLength = 0;
  };

  for (const row of rows) {
    const tuple = sqlRowTuple(row);
    // Fail loudly BEFORE batching: a tuple over the budget on its own can
    // never be made to fit, and the old `currentTuples.length > 0` guard
    // silently emitted it as its own over-limit statement instead.
    if (tuple.length + 1 > maxStatementLength) {
      throw new SeedRowTooLargeError(algorithmId, row.scopeKind, row.scopeKey, tuple.length, maxStatementLength);
    }
    const wouldExceedLength = currentTuples.length > 0 && currentLength + tuple.length + 1 > maxStatementLength;
    const wouldExceedCount = currentTuples.length >= maxRowsPerInsert;
    if (wouldExceedLength || wouldExceedCount) flush();
    currentTuples.push(tuple);
    currentLength += tuple.length + 1;
  }
  flush();

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${statements.join("\n")}\n`, "utf8");
}
