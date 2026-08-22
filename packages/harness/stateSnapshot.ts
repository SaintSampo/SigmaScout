/**
 * D-12/D-13's offline-to-online state handoff (plan 04-03 Task 2/3): turns a
 * shipped algorithm's in-memory state into a flat array of `StateRow`s a
 * Worker can read a slice of from D1, and back again — losslessly, proven by
 * a continuation-replay digest match rather than a structural deep-equal
 * (see `stateSnapshot.test.ts`).
 *
 * `scopeKind` exists because the three shipped algorithms do not share a
 * granularity, and pretending they do would be the failure (D-09): Sigma1
 * and EPA accumulate per TEAM, event-scoped OPR accumulates per EVENT
 * (`OprState.perEvent`, keyed by `eventKey` — Phase 3.2's whole reason for
 * existing was that season-pooled OPR's per-team state exceeded a Worker's
 * memory outright). A `team_state` table would have forced OPR's
 * event-shaped state into a per-team column; the table and this serializer
 * both say `scope` instead.
 *
 * Every `Map` member of every algorithm's state is converted explicitly to a
 * KEY-SORTED array of `[key, value]` pairs on the way out (`JSON.stringify`
 * turns a `Map` into `{}` with no error) and rebuilt with `new Map()` on the
 * way in. Every plain object is also serialized with its keys sorted
 * (`canonicalize` below) — together these two disciplines are what let
 * re-serializing an UNCHANGED team produce the byte-identical `stateJson`
 * string, which is what lets a real Worker tick skip a D1 write for a team
 * that did not move (a direct saving against DATA-05's write-volume cap).
 *
 * `emitSeedSql` (Task 3) turns `serializeState`'s row output into a `.sql`
 * file `wrangler d1 execute --file` can import — the bulk-seed path that
 * fills `apps/worker/migrations/0001_algorithm_state.sql`'s `algorithm_state`
 * table from a real offline replay.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { EpaState } from "../core/algorithms/epa.js";
import type { OprObservation, OprState } from "../core/algorithms/opr.js";
import type { Sigma1League, Sigma1State, Sigma1TeamState } from "../core/algorithms/sigma1/index.js";
import type { ExpandingStats } from "../core/scoring/expandingStats.js";

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
// Sigma1 (and its four harness-only link-mode/adaptation siblings, which
// share IDENTICAL Sigma1State shape — makeSigma1's prebuilt modules differ
// only in predict()'s link mode, never in what update() accumulates)
// ---------------------------------------------------------------------------

interface SerializedSigma1TeamState {
  beliefs: Sigma1TeamState["beliefs"];
  covariance: number[][];
  consistency: Record<string, number>;
  matchCount: number;
  lastEventKey: string | null;
  innovationStats: Sigma1TeamState["innovationStats"];
  rpBeliefs: Sigma1TeamState["rpBeliefs"];
  rpCovariance: number[][];
  rpCrossCovariance: number[][];
}

interface SerializedSigma1League {
  season: number | null;
  componentOrder: string[];
  league: {
    componentMean: Sigma1League["componentMean"];
    componentConsistency: Sigma1League["componentConsistency"];
    rpVariableMean: Sigma1League["rpVariableMean"];
  };
  allianceScoreStats: ExpandingStats;
  priorSeasonRatings: {
    lastSeason: [string, number][];
    yearBefore: [string, number][];
  };
  rpSkippedMatchCount: number;
  breakdownParseFailureCount: number;
}

function sigma1TeamStateToJson(team: Sigma1TeamState): SerializedSigma1TeamState {
  return {
    beliefs: team.beliefs,
    covariance: team.covariance,
    consistency: team.consistency,
    matchCount: team.matchCount,
    lastEventKey: team.lastEventKey,
    innovationStats: team.innovationStats,
    rpBeliefs: team.rpBeliefs,
    rpCovariance: team.rpCovariance,
    rpCrossCovariance: team.rpCrossCovariance,
  };
}

function serializeSigma1State(algorithmId: string, algorithmVersion: string, state: Sigma1State, stamp: StateStamp): StateRow[] {
  const leagueJson: SerializedSigma1League = {
    season: state.season,
    componentOrder: [...state.componentOrder],
    league: {
      componentMean: state.league.componentMean,
      componentConsistency: state.league.componentConsistency,
      rpVariableMean: state.league.rpVariableMean,
    },
    allianceScoreStats: state.allianceScoreStats,
    priorSeasonRatings: {
      lastSeason: sortedEntries(state.priorSeasonRatings.lastSeason),
      yearBefore: sortedEntries(state.priorSeasonRatings.yearBefore),
    },
    rpSkippedMatchCount: state.rpSkippedMatchCount,
    breakdownParseFailureCount: state.breakdownParseFailureCount,
  };

  const rows: StateRow[] = [makeRow(algorithmId, algorithmVersion, "league", "league", leagueJson, stamp)];
  for (const [teamKey, teamState] of sortedEntries(state.teams)) {
    rows.push(makeRow(algorithmId, algorithmVersion, "team", teamKey, sigma1TeamStateToJson(teamState), stamp));
  }
  return rows;
}

function deserializeSigma1State(algorithmId: string, rows: readonly StateRow[]): Sigma1State {
  const leagueRow = rows.find((r) => r.scopeKind === "league");
  if (!leagueRow) throw new MissingLeagueRowError(algorithmId);
  const leagueJson = JSON.parse(leagueRow.stateJson) as SerializedSigma1League;

  const teams = new Map<string, Sigma1TeamState>();
  for (const row of rows) {
    if (row.scopeKind !== "team") continue;
    const teamJson = JSON.parse(row.stateJson) as SerializedSigma1TeamState;
    teams.set(row.scopeKey, teamJson);
  }

  return {
    season: leagueJson.season,
    componentOrder: leagueJson.componentOrder,
    teams,
    league: leagueJson.league,
    allianceScoreStats: leagueJson.allianceScoreStats,
    priorSeasonRatings: {
      lastSeason: new Map(leagueJson.priorSeasonRatings.lastSeason),
      yearBefore: new Map(leagueJson.priorSeasonRatings.yearBefore),
    },
    rpSkippedMatchCount: leagueJson.rpSkippedMatchCount,
    breakdownParseFailureCount: leagueJson.breakdownParseFailureCount,
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
  season: number | null;
  allianceScoreStats: ExpandingStats;
  fallbackSkipped: number;
  priorSeasonRatings: {
    lastSeason: [string, number][];
    yearBefore: [string, number][];
  };
  breakdownParseFailureCount: number;
}

function serializeEpaState(algorithmId: string, algorithmVersion: string, state: EpaState, stamp: StateStamp): StateRow[] {
  const leagueJson: SerializedEpaLeague = {
    season: state.season,
    allianceScoreStats: state.allianceScoreStats,
    fallbackSkipped: state.fallbackSkipped,
    priorSeasonRatings: {
      lastSeason: sortedEntries(state.priorSeasonRatings.lastSeason),
      yearBefore: sortedEntries(state.priorSeasonRatings.yearBefore),
    },
    breakdownParseFailureCount: state.breakdownParseFailureCount,
  };

  const rows: StateRow[] = [makeRow(algorithmId, algorithmVersion, "league", "league", leagueJson, stamp)];

  // Union of both maps' keys (defensive: `teamComponents`/`teamMatchCounts`
  // are expected to share a keyset by construction, but a serializer must
  // not silently drop a team present in only one of the two).
  const teamKeys = new Set<string>([...state.teamComponents.keys(), ...state.teamMatchCounts.keys()]);
  for (const teamKey of [...teamKeys].sort()) {
    const teamJson: SerializedEpaTeamState = {
      components: state.teamComponents.get(teamKey) ?? {},
      matchCount: state.teamMatchCounts.get(teamKey) ?? 0,
    };
    rows.push(makeRow(algorithmId, algorithmVersion, "team", teamKey, teamJson, stamp));
  }
  return rows;
}

function deserializeEpaState(algorithmId: string, rows: readonly StateRow[]): EpaState {
  const leagueRow = rows.find((r) => r.scopeKind === "league");
  if (!leagueRow) throw new MissingLeagueRowError(algorithmId);
  const leagueJson = JSON.parse(leagueRow.stateJson) as SerializedEpaLeague;

  const teamComponents = new Map<string, Readonly<Record<string, number>>>();
  const teamMatchCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.scopeKind !== "team") continue;
    const teamJson = JSON.parse(row.stateJson) as SerializedEpaTeamState;
    teamComponents.set(row.scopeKey, teamJson.components);
    teamMatchCounts.set(row.scopeKey, teamJson.matchCount);
  }

  return {
    season: leagueJson.season,
    teamComponents,
    teamMatchCounts,
    allianceScoreStats: leagueJson.allianceScoreStats,
    fallbackSkipped: leagueJson.fallbackSkipped,
    priorSeasonRatings: {
      lastSeason: new Map(leagueJson.priorSeasonRatings.lastSeason),
      yearBefore: new Map(leagueJson.priorSeasonRatings.yearBefore),
    },
    breakdownParseFailureCount: leagueJson.breakdownParseFailureCount,
  };
}

// ---------------------------------------------------------------------------
// OPR (D-09: event-scoped, post-Phase-3.2 — rows keyed by EVENT, never team)
// ---------------------------------------------------------------------------

interface SerializedOprEventState {
  observations: { teams: string[]; allianceScore: number }[];
  ratings: [string, number][];
}

interface SerializedOprLeague {
  lastEventByTeam: [string, string][];
}

function serializeOprState(algorithmId: string, algorithmVersion: string, state: OprState, stamp: StateStamp): StateRow[] {
  const leagueJson: SerializedOprLeague = {
    lastEventByTeam: sortedEntries(state.lastEventByTeam),
  };

  const rows: StateRow[] = [makeRow(algorithmId, algorithmVersion, "league", "league", leagueJson, stamp)];

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

  const perEvent = new Map<string, { observations: OprObservation[]; ratings: Map<string, number> }>();
  for (const row of rows) {
    if (row.scopeKind !== "event") continue;
    const eventJson = JSON.parse(row.stateJson) as SerializedOprEventState;
    perEvent.set(row.scopeKey, {
      observations: eventJson.observations,
      ratings: new Map(eventJson.ratings),
    });
  }

  return {
    perEvent,
    lastEventByTeam: new Map(leagueJson.lastEventByTeam),
  };
}

// ---------------------------------------------------------------------------
// Public dispatch
// ---------------------------------------------------------------------------

/**
 * D-12/D-13: converts one algorithm's in-memory state into `StateRow`s ready
 * for a D1 seed (`emitSeedSql`). Dispatches on `algorithmId`: `"opr"` is
 * event-scoped (D-09), `"epa"` is team-scoped, and every other id (`sigma1`
 * and its four harness-only siblings) shares Sigma1State's exact shape.
 */
export function serializeState(
  algorithmId: string,
  algorithmVersion: string,
  state: Sigma1State | EpaState | OprState,
  stamp: StateStamp
): StateRow[] {
  if (algorithmId === "opr") return serializeOprState(algorithmId, algorithmVersion, state as OprState, stamp);
  if (algorithmId === "epa") return serializeEpaState(algorithmId, algorithmVersion, state as EpaState, stamp);
  return serializeSigma1State(algorithmId, algorithmVersion, state as Sigma1State, stamp);
}

/** The inverse of `serializeState` — reconstructs a state whose `predict()`/`update()` behavior is identical to the state it came from, for a matching (possibly partial, D-13) set of rows. Throws `MissingLeagueRowError` when no `scopeKind: "league"` row is present. */
export function deserializeState(algorithmId: string, rows: readonly StateRow[]): Sigma1State | EpaState | OprState {
  if (algorithmId === "opr") return deserializeOprState(algorithmId, rows);
  if (algorithmId === "epa") return deserializeEpaState(algorithmId, rows);
  return deserializeSigma1State(algorithmId, rows);
}

// ---------------------------------------------------------------------------
// Task 3: the D1 bulk seed emitter
// ---------------------------------------------------------------------------

/** Every string field going into a SQL string literal is escaped by doubling its single quotes — the `state_json` blobs are arbitrary JSON text (T-04-14), and the other string fields (event/team keys, generation, ids) are treated with the same discipline defensively. */
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
 * any single statement exceeds it.
 *
 * This was previously 4,000,000, citing 04-RESEARCH.md's "~7.5 MB practical
 * breaking point" — 40x over the real limit. Every seed this project has ever
 * emitted was therefore unimportable, and nobody noticed because no plan in
 * Phase 4 ever ran the import: 04-03 wrote this emitter, 04-04 generated the
 * files, 04-05 built the reader and 04-06 built the tick, while
 * `docs/publish-budget.md` documented the re-baseline procedure as if it
 * worked. Measured failure (plan 04-07, 2026-08-22): opr 2.14 MB longest
 * statement, epa 0.48 MB, sigma1 2.24 MB — all rejected.
 *
 * 90,000 leaves ~10 KB of headroom under the cap for the `INSERT INTO ... VALUES`
 * prefix and the trailing semicolon, so a statement assembled right at the
 * budget still lands comfortably inside D1's limit.
 */
const DEFAULT_MAX_STATEMENT_LENGTH = 90_000;

/** D1's documented hard limit, for the error message that fires when a single row cannot be split to fit. */
const D1_STATEMENT_LIMIT = 100_000;
/** A conservative starting cap on value-tuples per `INSERT`, independent of the character-length cap above — either limit reaching first triggers a new statement. */
const DEFAULT_MAX_ROWS_PER_INSERT = 500;

/**
 * Thrown when one `StateRow`'s own value tuple exceeds `maxStatementLength`.
 *
 * Batching cannot help: a single row is the smallest thing an `INSERT` can
 * carry, so no chunking strategy makes an over-limit row fit. Before this
 * threw, the emitter's `currentTuples.length > 0` guard meant such a row was
 * simply written out as its own over-limit statement — producing a `.sql`
 * file that looked fine and failed only at import time, far from the code
 * that caused it.
 *
 * Hitting this means per-key data is being stored in a row that should hold
 * aggregates. The two known cases, both measured in plan 04-07, are sigma1's
 * `priorSeasonRatings` (245.8 KB of a 253.1 KB `league` row) and opr's
 * `lastEventByTeam` — per-team maps living in a `scopeKind: "league"` row.
 * The fix is to move that data into `scopeKind: "team"` rows, which is also
 * what D-13 requires so a tick reads only the keys it is folding rather than
 * parsing the whole league every minute.
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
  /** The algorithm this seed is for — becomes the `DELETE FROM algorithm_state WHERE algorithm_id = '<id>'` re-baseline guard (D-12: a re-baseline overwrites in place, it does not merge). */
  readonly algorithmId: string;
  /** Output `.sql` file path. */
  readonly out: string;
  /** Overrides `DEFAULT_MAX_ROWS_PER_INSERT`. */
  readonly maxRowsPerInsert?: number;
  /** Overrides `DEFAULT_MAX_STATEMENT_LENGTH`. */
  readonly maxStatementLength?: number;
}

/**
 * D-12: turns `serializeState`'s row output into a `.sql` file `wrangler d1
 * execute --file` can import: a leading `DELETE FROM algorithm_state WHERE
 * algorithm_id = '<id>';` guard (a re-baseline is an overwrite, per D-12 —
 * the offline run is the authority, so it replaces rather than merges),
 * then batched multi-row `INSERT INTO algorithm_state (...) VALUES
 * (...),(...),...;` statements, each capped at BOTH `maxRowsPerInsert`
 * value tuples (default 500) AND `maxStatementLength` characters (default a
 * bound well under D1 import's real ~7.5 MB failure point) — whichever
 * limit is reached first starts a new statement. Single quotes in every
 * string field are escaped by doubling. Performs exactly ONE terminal file
 * write, after every statement is assembled in memory — an interrupted
 * emit leaves no half-file, the same discipline `baselineFingerprint.ts`
 * already uses for its own committed output.
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
