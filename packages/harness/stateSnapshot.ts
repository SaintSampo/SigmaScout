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
import type { BprPhaseRecord, BprState, BprTeamState } from "../core/algorithms/bpr.js";
import { COMPONENT_GROUP_IDS, type ComponentGroupId } from "../core/algorithms/breakdown/index.js";
import type { OprObservation, OprState } from "../core/algorithms/opr.js";
import type { ElimScoreOffset, Sigma1League, Sigma1State, Sigma1TeamState } from "../core/algorithms/sigma1/index.js";
import type { ExpandingStats } from "../core/scoring/expandingStats.js";
import type { SwingBelief } from "./swingFactor.js";
import type { SigmaBelief, SigmaPopulation } from "./sigmaScore.js";

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

/**
 * Plan 04-08 (D-13): the current shape every `scopeKind: "league"` payload
 * must declare (`snapshotShapeVersion`). Bumped whenever a league payload's
 * FIELDS change shape — in particular, this version's introduction is what
 * makes the RETIRED shape (per-team maps such as `priorSeasonRatings`/
 * `lastEventByTeam` living inside the league row) unreadable rather than
 * silently parsed with those per-team maps discarded. A retired-shape row
 * has no `snapshotShapeVersion` field at all, so it always fails this check.
 *
 * Bumped 2 -> 3 (D-Q4, quick task 260901-is2): OPR's league payload gained
 * `allianceScoreStats`, the expanding-window accumulator feeding its logistic
 * scale. This bump is load-bearing, not ceremony. `apps/worker/src/
 * stateStore.ts`'s `readScopedState` filters rows by `algorithm_id` ONLY and
 * never by `algorithm_version`, so bumping `opr.version` to 4.0.0 does NOT by
 * itself make a stale seeded row unreachable — a shape-2 OPR league row
 * written before this change is still selected and parsed. Without this bump
 * it would deserialize with `allianceScoreStats` as `undefined`, and
 * `standardDeviation(undefined, ...)` would throw or silently fall back deep
 * inside `predict` on live traffic. The shape check is the only thing that
 * turns that into a loud `LeagueRowShapeVersionError` at load time, naming the
 * re-seed as the fix.
 *
 * Bumped 3 -> 4 (quick task 260902-disp, commit 96e38754): every Sigma1 team
 * payload gained `contributionStats` and `lastContribution`, a per-match
 * inferred contribution series (`sigma1/contribution.ts`).
 *
 * WHAT SHAPE 4 ACTUALLY SHIPPED — corrected here rather than deleted, because
 * a reader tracing a shape-4 seed row needs this sentence to exist. This
 * paragraph originally said that series "IS the published `±` from this
 * version on." That was never true of any shipped code. Quick task 260902-disp
 * was HALTED after its Task 1 (the fold) landed and before its Task 2 (publish
 * it) ever ran: `teamMetrics` continued to return `sqrt(P + R)` and never read
 * the accumulator. So shape 4 stored, in every D1 seed row and every snapshot,
 * a quantity nothing anywhere published.
 *
 * Bumped 4 -> 5 (D-V1..D-V4, quick task 260902-varopr): `contributionStats` and
 * `lastContribution` are REMOVED. Their estimator — the even-split contribution
 * standard deviation — was measured against known synthetic sigma at slope
 * 0.179, the worst of the three candidates and the one the variance
 * decomposition exists to replace, so it is retired rather than left sitting
 * alongside a second published-`±` mechanism. The team payload's field set
 * genuinely SHRANK, which is why this is a bump and not a no-op:
 * `apps/worker/src/stateStore.ts`'s `readScopedState` filters rows by
 * `algorithm_id` ONLY and never by `algorithm_version`, so a shape-4 row seeded
 * before this change is still selected and would deserialize carrying two
 * fields that no longer exist in `Sigma1TeamState` at all. The shape check is
 * the only thing that turns that into a loud `LeagueRowShapeVersionError` at
 * load time, naming the re-seed as the fix.
 *
 * Bumped 5 -> 6 (D-V1/D-V3, quick task 260902-varopr): Sigma1 emitted
 * `scopeKind: "event"` rows of its own — one per event, carrying that event's
 * variance-decomposition normal equations (`{ rowCount, teamOrder, gram,
 * targets, vBarSums }`, the since-deleted `sigma1/varianceOpr.ts`). Until that
 * version only OPR had event-scoped state.
 *
 * The load-bearing reason, which is the same one both bumps above give and is
 * SHARPER here: a shape-5 row deserializes with `perEventVariance` as an empty
 * map, and `teamMetrics` would then publish NO SPREAD AT ALL on live traffic —
 * silently, because omission is a legal shape for a team the decomposition
 * cannot speak to. The shape check is the only thing that turns that into a
 * loud `LeagueRowShapeVersionError` naming the re-seed as the fix, rather than
 * a site that quietly stops showing `±`.
 *
 * Bumped 6 -> 7 (D-Y1/D-Y3, quick task 260903-750): that event row is GONE
 * again, one version after arriving, and each TEAM row gains a `swing` object —
 * the recency-weighted accumulator (`{ weightedSquares, weight }` per metric
 * key, `sigma1/swing.ts`) that replaced the decomposition as the source of
 * every published `±`. Sigma1 is team-scoped only once more, and
 * `apps/worker/src/scheduled.ts`'s `EVENT_SCOPED_ALGORITHM_IDS` dropped "vpr"
 * in the same task.
 *
 * The load-bearing reason is the SHARPEST of the four, because at shape 7 the
 * failure is indistinguishable from correct behaviour: a shape-6 team row
 * carries no `swing` at all, and D-Y2 makes "this key was never folded" a
 * LEGAL, publishable-as-nothing state meaning "a team that has not played yet".
 * A stale row would therefore deserialize into a team that looks brand new
 * rather than into anything that looks broken — every `±` on the site quietly
 * absent, with no error, no NaN and no malformed row anywhere to find. The
 * shape check is the only thing standing between that and a live tick.
 *
 * Bumped 7 -> 8 (ELIM-OFF, quick task 260904-v9n): the league row gains
 * `elimScoreOffset` (`{ value, count }`, `sigma1/elim.ts`), the within-season
 * learned additive elim score correction's EWMA accumulator.
 *
 * BE HONEST ABOUT HOW THIS BUMP DIFFERS FROM THE FOUR ABOVE IT, in this same
 * register: each of those prevented a LIVE failure on data already flowing
 * through a shipped, enabled mechanism. This one does not — the field is
 * default-inert (`elimScoreOffsetEnabled: false`), so nothing reads
 * `elimScoreOffset` on any currently-promoted parameter set today. This bump
 * is PRECAUTIONARY: it arms the day the flag is flipped, at which point a
 * stale shape-7 league row would deserialize `elimScoreOffset` as `undefined`
 * (`readScopedState` filters rows by `algorithm_id` ONLY, never by version —
 * the identical fact every bump above already names), and the first fold
 * (`(1 - alpha) * undefined.value + ...`) would throw immediately rather than
 * silently propagate a NaN, which is at least an improvement on the failure
 * mode this shape check exists to prevent — but only if the shape check
 * itself is current. Bumping now, while the mechanism is still off, is what
 * keeps that guarantee true from day one of enabling it rather than from
 * whichever day someone remembers to also bump the shape version.
 *
 * The bump costs a Worker re-seed from a fresh publish run, exactly like
 * every bump above it — `readScopedState`'s version-blindness makes that
 * true regardless of whether the shape change itself was urgent.
 *
 * ## 8 -> 9 (quick task 260907-v1s, SIGMA1_CODE_VERSION 11.0.0)
 *
 * A REMOVAL, the first one here: `innovationStats` is gone from
 * `Sigma1TeamState` because the whole adaptive-process-noise mechanism was
 * deleted after measuring it inert (at most 0.0013 accuracy across its entire
 * bound on 2026 while ENABLED, and <=1.0 sigma to remove on every origin that
 * shipped it on).
 *
 * The hazard this bump exists to stop runs in the opposite direction from
 * every bump above. Those guarded against a stale row LACKING a newly-added
 * field; this one guards against a stale row CARRYING a field the current
 * shape no longer declares. `readScopedState` is version-blind, so without
 * the bump a live row written at shape 8 would deserialize into a
 * `Sigma1TeamState` with an extra property that nothing reads and no
 * validator rejects — silent, and therefore worse than a throw.
 *
 * Costs a Worker re-seed from a fresh publish run, exactly like every bump
 * above it.
 *
 * ## 9 -> 10 (2026-09-09, the live Swing Factor)
 *
 * Every `scopeKind: "team"` row gains `sigmascoutSwing` — four running numbers
 * (`weight`, `weightSquares`, `mean`, `m2`) carrying that team's Swing Factor
 * belief under `swingFactor.ts`'s incremental estimator.
 *
 * This bump guards the SAME failure mode as 6 -> 7, and it is worth naming
 * because that one is described above as the sharpest of its group: a stale
 * row simply has no `sigmascoutSwing`, and "never folded" is a LEGAL state
 * meaning "a team with too little play to have a Swing Factor". So a shape-9
 * row read under shape 10 would deserialize into a team that looks brand new
 * rather than into anything that looks broken — every band quietly narrower or
 * absent, no error, no NaN, no malformed row to find. Worse here than in the
 * 6 -> 7 case, because the offline publisher WOULD have a band for those same
 * matches, so live and offline would disagree while both looked healthy.
 *
 * Note what this field is NOT: it is not algorithm state. It is a level-2
 * SigmaScout quantity riding in a level-1 row, and it is written and read by
 * `withSwingBeliefs`/`readSwingBeliefs` below rather than by any algorithm's
 * serializer, so no algorithm knows it exists. It lives here anyway because
 * `state_json` is the only per-team row the Worker reads and writes, and it
 * does so in ONE subrequest each way regardless of payload — a separate table
 * would double the subrequest cost of every tick against a budget where three
 * algorithms already overflow. The key is deliberately `sigmascoutSwing` and
 * not `swing`, both to read as a passenger and to avoid colliding with the
 * unrelated `swing` key in Sigma1's own team state.
 *
 * Costs a Worker re-seed from a fresh publish run, exactly like every bump
 * above it. Seed first, deploy second: a deploy carrying shape 10 against
 * un-re-seeded rows takes live folding down until the seed runs.
 *
 * ---------------------------------------------------------------------------
 * 10 -> 11 (2026-09-10): SIGMA SCORE BELIEFS
 * ---------------------------------------------------------------------------
 *
 * Sigma Score shipped for BPR and drives its match bands, and BPR is the LIVE
 * TIER. Without this bump the Worker would keep folding Swing Factors into
 * live bands while the offline publisher wrote Sigma ones for the same
 * algorithm, so a match touched during an event would read roughly twice as
 * wide as its untouched neighbours (Swing prints 1.92 sigma, Sigma an honest
 * 1 sigma). The same silent class of divergence the 9 -> 10 bump above was
 * written about, with a bigger visible gap.
 *
 * Two things are added, and they live in DIFFERENT rows on purpose:
 *
 *   - the per-team belief, under `sigmascoutSigma` in each TEAM row, for the
 *     same reason its Swing sibling lives there;
 *   - the population statistics behind the talent prior, under
 *     `sigmascoutSigmaPopulation` in the LEAGUE row, because they are THREE
 *     NUMBERS TOTAL and do not scale with team count. Putting them per team
 *     would duplicate one global fact across thousands of rows; putting the
 *     per-team beliefs in the league row would breach `MAX_LEAGUE_ROW_BYTES`.
 *     That split is the rule, not a preference.
 *
 * The population half is load bearing rather than an optimisation: the talent
 * prior is deliberately withheld until the population is known
 * (`MIN_POPULATION_FOR_TALENT_PRIOR`), so a Worker that resumed beliefs without
 * it would silently compute every band from the FLAT prior instead of the
 * talent scaled one, and disagree with the publisher while looking healthy.
 */
export const STATE_SNAPSHOT_SHAPE_VERSION = 11;

/**
 * Thrown when `deserializeState`'s league row does not declare the current
 * `STATE_SNAPSHOT_SHAPE_VERSION` — either absent (the retired pre-04-08
 * shape, which stored per-team data inside the league row) or a stale
 * numeric value from some future re-shape. Reading either silently would
 * either drop per-team data that isn't there to find (retired shape) or
 * misinterpret fields against the wrong version's meaning — this makes that
 * failure loud instead, mirroring `MissingLeagueRowError`'s own reasoning
 * and message style (D-13).
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
 * D-13: a `scopeKind: "league"` row's `stateJson` byte length must never
 * grow with the number of teams in the season — it holds only genuinely
 * league-wide aggregates. 16384 (16 KB) is set well above sigma1's measured
 * genuine-aggregate size (7.1 KB, 2026-08-22 corpus) to leave headroom for a
 * season with more components, while staying roughly 6x under D1's real
 * 100,000-byte per-statement limit. `serializeState` does NOT throw when a
 * league row exceeds this — the constant exists so tests (and `docs/publish-
 * budget.md`) can assert against it; a hard throw here would make a
 * legitimate future aggregate a harder failure than a red test.
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
// Sigma1 (and its four harness-only link-mode/adaptation siblings, which
// share IDENTICAL Sigma1State shape — makeSigma1's prebuilt modules differ
// only in predict()'s link mode, never in what update() accumulates)
// ---------------------------------------------------------------------------

/**
 * Restores a component-keyed record to the runtime's canonical key order.
 *
 * `makeRow` writes every payload with `stableStringify`, so a row's JSON has
 * ALPHABETICAL keys by design — that canonical form is what makes a snapshot
 * byte-comparable. The runtime's own order is different: sigma1 builds every
 * component-keyed record by iterating `componentOrder`. Reading a snapshot
 * back therefore used to hand the algorithm records in a different key order
 * than the live state had, and since floating-point addition is not
 * associative, an alliance total summed over those keys differed in its last
 * bits — enough to change `pRedWin` and break the continuation-replay digest
 * equality `stateSnapshot.test.ts` asserts.
 *
 * Keys absent from `componentOrder` are appended in sorted order rather than
 * dropped, so this can never silently lose a field. Quick task 260910-5ym.
 */
function inComponentOrder<T>(record: Readonly<Record<string, T>>, componentOrder: readonly string[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const name of componentOrder) {
    if (Object.prototype.hasOwnProperty.call(record, name)) out[name] = record[name]!;
  }
  for (const name of Object.keys(record).sort()) {
    if (!Object.prototype.hasOwnProperty.call(out, name)) out[name] = record[name]!;
  }
  return out;
}

interface SerializedSigma1TeamState {
  beliefs: Sigma1TeamState["beliefs"];
  covariance: number[][];
  consistency: Record<string, number>;
  matchCount: number;
  lastEventKey: string | null;
  rpBeliefs: Sigma1TeamState["rpBeliefs"];
  rpCovariance: number[][];
  rpCrossCovariance: number[][];
  /** D-Y3 (quick task 260903-750): the recency-weighted swing behind the published `±`. It rides the TEAM row because it is a property of the robot; the `scopeKind: "event"` rows the retired decomposition needed are gone. */
  swing: Sigma1TeamState["swing"];
}

interface SerializedSigma1League {
  snapshotShapeVersion: number;
  season: number | null;
  componentOrder: string[];
  league: {
    componentMean: Sigma1League["componentMean"];
    componentConsistency: Sigma1League["componentConsistency"];
    rpVariableMean: Sigma1League["rpVariableMean"];
  };
  allianceScoreStats: ExpandingStats;
  rpSkippedMatchCount: number;
  breakdownParseFailureCount: number;
  /** ELIM-OFF (quick task 260904-v9n): the league-level learned elim score offset's EWMA accumulator — shape 8. */
  elimScoreOffset: ElimScoreOffset;
}

/**
 * Plan 04-08 (D-13): a `scopeKind: "team"` row's payload for sigma1/epa is a
 * UNION — a team may have current-season state, a prior-season rating (from
 * `priorSeasonRatings.lastSeason`/`.yearBefore`), or both. `current` is
 * omitted entirely for a team with no current-season entry (a team known
 * only via a prior-season rating) — never a placeholder/empty object, so the
 * shape a reader sees on the wire matches exactly what was actually there
 * (this project's "raw numbers only, no fabricated placeholders" discipline
 * applied to row presence itself).
 */
interface SerializedSigma1TeamRow {
  current?: SerializedSigma1TeamState;
  priorSeasonLastSeason?: number;
  priorSeasonYearBefore?: number;
}

/**
 * D-V1/D-V3 (quick task 260902-varopr): one event's variance-decomposition
 * normal equations, in the SAME `scopeKind: "event"` shape
 * `serializeOprState` already uses for its own per-event rows — the mechanism
 * this task deliberately reuses rather than inventing a per-team-pair sparse
 * one (which would additionally have to survive `SeedRowTooLargeError`'s
 * 90,000-byte budget at ~3,500 season-scoped teams; `X'X` there is 12M
 * entries and is not close).
 *
 * `gram` is dense `teamOrder x teamOrder` small integers and dominates the row.
 * Its measured size at the corpus's widest real event is asserted by
 * `stateSnapshot.test.ts`. If a future season pushes it over the budget, the
 * named fallback is an upper-triangular sparse record of CO-APPEARING PAIRS
 * only (a team co-appears with ~50 others, roughly a 3x reduction) — never
 * rounding the target sums, which would trade a size problem for a
 * reproducibility one.
 */

function sigma1TeamStateToJson(team: Sigma1TeamState): SerializedSigma1TeamState {
  return {
    beliefs: team.beliefs,
    covariance: team.covariance,
    consistency: team.consistency,
    matchCount: team.matchCount,
    lastEventKey: team.lastEventKey,
    rpBeliefs: team.rpBeliefs,
    rpCovariance: team.rpCovariance,
    rpCrossCovariance: team.rpCrossCovariance,
    swing: team.swing,
  };
}

function serializeSigma1State(algorithmId: string, algorithmVersion: string, state: Sigma1State, stamp: StateStamp): StateRow[] {
  const leagueJson: SerializedSigma1League = {
    snapshotShapeVersion: STATE_SNAPSHOT_SHAPE_VERSION,
    season: state.season,
    componentOrder: [...state.componentOrder],
    league: {
      componentMean: state.league.componentMean,
      componentConsistency: state.league.componentConsistency,
      rpVariableMean: state.league.rpVariableMean,
    },
    allianceScoreStats: state.allianceScoreStats,
    rpSkippedMatchCount: state.rpSkippedMatchCount,
    breakdownParseFailureCount: state.breakdownParseFailureCount,
    elimScoreOffset: state.elimScoreOffset,
  };

  const rows: StateRow[] = [makeRow(algorithmId, algorithmVersion, "league", "league", leagueJson, stamp)];

  // D-13: the UNION of every map's keys — a team present only in
  // `priorSeasonRatings.lastSeason`/`.yearBefore` (no current-season entry
  // at all) must still get its own row, never silently dropped.
  const teamKeys = new Set<string>([
    ...state.teams.keys(),
    ...state.priorSeasonRatings.lastSeason.keys(),
    ...state.priorSeasonRatings.yearBefore.keys(),
  ]);
  for (const teamKey of [...teamKeys].sort()) {
    const current = state.teams.get(teamKey);
    const priorSeasonLastSeason = state.priorSeasonRatings.lastSeason.get(teamKey);
    const priorSeasonYearBefore = state.priorSeasonRatings.yearBefore.get(teamKey);
    const teamJson: SerializedSigma1TeamRow = {
      ...(current !== undefined ? { current: sigma1TeamStateToJson(current) } : {}),
      ...(priorSeasonLastSeason !== undefined ? { priorSeasonLastSeason } : {}),
      ...(priorSeasonYearBefore !== undefined ? { priorSeasonYearBefore } : {}),
    };
    rows.push(makeRow(algorithmId, algorithmVersion, "team", teamKey, teamJson, stamp));
  }

  // D-Y3 (quick task 260903-750): Sigma1 emits NO `scopeKind: "event"` rows any
  // more. The published `±` moved from an event-wide decomposition to one
  // running number per team (`Sigma1TeamState.swing`), which rides the existing
  // team rows, so there is no event-granular Sigma1 state left to persist.
  // `apps/worker/src/scheduled.ts`'s `EVENT_SCOPED_ALGORITHM_IDS` dropped "vpr"
  // in the same change; leaving it there would have made the Worker load event
  // rows that are never written.
  return rows;
}

function deserializeSigma1State(algorithmId: string, rows: readonly StateRow[]): Sigma1State {
  const leagueRow = rows.find((r) => r.scopeKind === "league");
  if (!leagueRow) throw new MissingLeagueRowError(algorithmId);
  const leagueJson = JSON.parse(leagueRow.stateJson) as SerializedSigma1League;
  if (leagueJson.snapshotShapeVersion !== STATE_SNAPSHOT_SHAPE_VERSION) {
    throw new LeagueRowShapeVersionError(algorithmId, leagueJson.snapshotShapeVersion);
  }

  const teams = new Map<string, Sigma1TeamState>();
  const lastSeason = new Map<string, number>();
  const yearBefore = new Map<string, number>();
  for (const row of rows) {
    // D-Y3: a Sigma1 `scopeKind: "event"` row can only be a pre-7 leftover.
    // The shape-version gate on the league row above is what actually rejects
    // such a snapshot; this skip keeps the loop total rather than relying on
    // that gate having already thrown.
    if (row.scopeKind !== "team") continue;
    const teamJson = JSON.parse(row.stateJson) as SerializedSigma1TeamRow;
    if (teamJson.current !== undefined) {
      teams.set(row.scopeKey, {
        ...teamJson.current,
        beliefs: inComponentOrder(teamJson.current.beliefs, leagueJson.componentOrder),
        consistency: inComponentOrder(teamJson.current.consistency, leagueJson.componentOrder),
      });
    }
    if (teamJson.priorSeasonLastSeason !== undefined) lastSeason.set(row.scopeKey, teamJson.priorSeasonLastSeason);
    if (teamJson.priorSeasonYearBefore !== undefined) yearBefore.set(row.scopeKey, teamJson.priorSeasonYearBefore);
  }

  return {
    season: leagueJson.season,
    componentOrder: leagueJson.componentOrder,
    teams,
    league: {
      ...leagueJson.league,
      componentMean: inComponentOrder(leagueJson.league.componentMean, leagueJson.componentOrder),
      componentConsistency: inComponentOrder(leagueJson.league.componentConsistency, leagueJson.componentOrder),
    },
    allianceScoreStats: leagueJson.allianceScoreStats,
    priorSeasonRatings: { lastSeason, yearBefore },
    rpSkippedMatchCount: leagueJson.rpSkippedMatchCount,
    breakdownParseFailureCount: leagueJson.breakdownParseFailureCount,
    elimScoreOffset: leagueJson.elimScoreOffset,
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
  fallbackSkipped: number;
  breakdownParseFailureCount: number;
}

/** D-13: same union shape as sigma1's `SerializedSigma1TeamRow` — see that interface's doc comment. */
interface SerializedEpaTeamRow {
  current?: SerializedEpaTeamState;
  priorSeasonLastSeason?: number;
  priorSeasonYearBefore?: number;
}

function serializeEpaState(algorithmId: string, algorithmVersion: string, state: EpaState, stamp: StateStamp): StateRow[] {
  const leagueJson: SerializedEpaLeague = {
    snapshotShapeVersion: STATE_SNAPSHOT_SHAPE_VERSION,
    season: state.season,
    allianceScoreStats: state.allianceScoreStats,
    fallbackSkipped: state.fallbackSkipped,
    breakdownParseFailureCount: state.breakdownParseFailureCount,
  };

  const rows: StateRow[] = [makeRow(algorithmId, algorithmVersion, "league", "league", leagueJson, stamp)];

  // D-13: the UNION of every map's keys — `teamComponents`/`teamMatchCounts`
  // (current-season) and `priorSeasonRatings.lastSeason`/`.yearBefore`
  // (prior-season). A team present in only one must still get its own row,
  // never silently dropped.
  const teamKeys = new Set<string>([
    ...state.teamComponents.keys(),
    ...state.teamMatchCounts.keys(),
    ...state.priorSeasonRatings.lastSeason.keys(),
    ...state.priorSeasonRatings.yearBefore.keys(),
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
  for (const row of rows) {
    if (row.scopeKind !== "team") continue;
    const teamJson = JSON.parse(row.stateJson) as SerializedEpaTeamRow;
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
    fallbackSkipped: leagueJson.fallbackSkipped,
    priorSeasonRatings: { lastSeason, yearBefore },
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
  snapshotShapeVersion: number;
  /** D-Q4: the season-wide expanding alliance-score accumulator behind OPR's logistic scale. League-scoped, exactly as the sigma1 and epa league rows already carry their own `allianceScoreStats`. */
  allianceScoreStats: ExpandingStats;
}

/** D-13: `lastEventByTeam`'s per-team entry, moved out of the league row (it was OPR's only offender — see `SeedRowTooLargeError`'s doc comment). One row per team, never folded into that team's most-recent EVENT row (see this plan's action text on why that alternative is ambiguous under interleaved events). */
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
// BPR (quick task 260908-b4t)
// ---------------------------------------------------------------------------

interface SerializedBprLeague {
  snapshotShapeVersion: number;
  season: number | null;
  logTau: number;
  scale: number;
  scaleCount: number;
  /** Display-only per-phase point scales (quick task 260908-pcm). */
  phaseScale: Record<string, number>;
  phaseScaleCount: Record<string, number>;
}

/** One team's whole BPR state: slow talent (L) and fast form (S), each a mean and a variance. */
interface SerializedBprTeamRow {
  muL: number;
  pL: number;
  muS: number;
  pS: number;
  /**
   * Display-only per-phase filters (quick task 260908-pcm), keyed by group id.
   * Absent on a row written before that task, which `deserializeBprState`
   * restores as a fresh phase filter rather than throwing -- a resumed
   * pre-existing snapshot loses only the phase history it never had, and the
   * PREDICTOR half above resumes exactly.
   */
  phases?: Record<string, SerializedBprPhase>;
}

interface SerializedBprPhase {
  muL: number;
  pL: number;
  muS: number;
  pS: number;
}

function serializeBprState(algorithmId: string, algorithmVersion: string, state: BprState, stamp: StateStamp): StateRow[] {
  const leagueJson: SerializedBprLeague = {
    snapshotShapeVersion: STATE_SNAPSHOT_SHAPE_VERSION,
    season: state.season,
    // All three are genuine league-level state, not derived: logTau is the
    // online link temperature, and scale/scaleCount are the online estimate of
    // the point level that BPR's scale-free ratings are denominated against —
    // a ~100-match trailing EWMA over the globally interleaved stream, NOT a
    // season-level constant (corrected 2026-09-10; see
    // `packages/core/algorithms/bpr.ts`'s header). `scaleCount` is what pins
    // that learning rate at its `scaleMinLr` floor, so it is load-bearing
    // state and not a diagnostic counter. Dropping any of them would silently
    // reset a resumed model.
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
    const phases: Record<string, SerializedBprPhase> = {};
    for (const phase of COMPONENT_GROUP_IDS) {
      const ps = state.phaseTeams[phase].get(teamKey);
      if (ps === undefined) continue;
      phases[phase] = { muL: ps.muL, pL: ps.pL, muS: ps.muS, pS: ps.pS };
    }
    const teamJson: SerializedBprTeamRow = { muL: team.muL, pL: team.pL, muS: team.muS, pS: team.pS, phases };
    rows.push(makeRow(algorithmId, algorithmVersion, "team", teamKey, teamJson, stamp));
  }
  return rows;
}

function deserializeBprState(algorithmId: string, rows: readonly StateRow[]): BprState {
  const leagueRow = rows.find((r) => r.scopeKind === "league");
  if (!leagueRow) throw new MissingLeagueRowError(algorithmId);
  const leagueJson = JSON.parse(leagueRow.stateJson) as SerializedBprLeague;
  // Quick task 260908-5wd: BPR was the ONE algorithm missing this check, so a
  // stale BPR row would be read and silently cold-start the live tier against
  // a shape it no longer matches. `readScopedState` filters on `algorithm_id`
  // alone and never on `algorithm_version` (see this file's header), so this
  // guard is the only thing standing between an old row and a live fold.
  if (leagueJson.snapshotShapeVersion !== STATE_SNAPSHOT_SHAPE_VERSION) {
    throw new LeagueRowShapeVersionError(algorithmId, leagueJson.snapshotShapeVersion);
  }

  const teams = new Map<string, BprTeamState>();
  const phaseTeams: Record<ComponentGroupId, Map<string, BprTeamState>> = {
    auto: new Map(),
    teleop: new Map(),
    endgame: new Map(),
  };
  for (const row of rows) {
    if (row.scopeKind !== "team") continue;
    const t = JSON.parse(row.stateJson) as SerializedBprTeamRow;
    teams.set(row.scopeKey, { muL: t.muL, pL: t.pL, muS: t.muS, pS: t.pS });
    for (const phase of COMPONENT_GROUP_IDS) {
      const ps = t.phases?.[phase];
      if (ps === undefined) continue;
      phaseTeams[phase].set(row.scopeKey, { muL: ps.muL, pL: ps.pL, muS: ps.muS, pS: ps.pS });
    }
  }

  const phaseNumbers = (source: Record<string, number> | undefined): BprPhaseRecord<number> => ({
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
// The SigmaScout-layer passenger (shape 10)
// ---------------------------------------------------------------------------

/**
 * The key every `scopeKind: "team"` row carries its Swing Factor belief under.
 *
 * `sigmascoutSwing`, never `swing`: Sigma1's own team state already has an
 * unrelated `swing` key, and the longer name says out loud that this is a
 * level-2 passenger rather than part of the model.
 */
const SWING_BELIEF_KEY = "sigmascoutSwing";

/**
 * Reads every team's Swing Factor belief out of a set of state rows.
 *
 * Deliberately standalone rather than folded into `deserializeState`: this is
 * NOT algorithm state, and threading it through the four per-algorithm
 * deserializers would make every one of them know about a heuristic none of
 * them may depend on. They ignore the key entirely — each parses its own named
 * fields and an extra property is invisible to it — which is exactly the
 * separation this project's two-level split asks for.
 *
 * A team row with no belief yields no entry, which the caller must treat as
 * "no history", not as zero. Under shape 10 that can only mean a team the
 * publisher had never seen play; a row genuinely written at an older shape is
 * rejected upstream by `LeagueRowShapeVersionError` before reaching here.
 */
export function readSwingBeliefs(rows: readonly StateRow[]): Map<string, SwingBelief> {
  const beliefs = new Map<string, SwingBelief>();
  for (const row of rows) {
    if (row.scopeKind !== "team") continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.stateJson) as Record<string, unknown>;
    } catch {
      continue;
    }
    const raw = parsed[SWING_BELIEF_KEY] as Partial<SwingBelief> | undefined;
    if (raw === undefined) continue;
    const { weight, weightSquares, mean, m2 } = raw;
    // All four or none. A partially-written belief would produce a plausible
    // but wrong band rather than no band, which is the failure this whole
    // shape bump exists to prevent.
    if (![weight, weightSquares, mean, m2].every((v) => typeof v === "number" && Number.isFinite(v))) continue;
    beliefs.set(row.scopeKey, { weight: weight!, weightSquares: weightSquares!, mean: mean!, m2: m2! });
  }
  return beliefs;
}

/**
 * Injects each team's Swing Factor belief into the rows `serializeState`
 * produced, returning new rows rather than mutating them.
 *
 * Only `scopeKind: "team"` rows are touched. The league row is left alone on
 * purpose — `MAX_LEAGUE_ROW_BYTES` caps it at 16 KB precisely because nothing
 * in it may scale with team count, and a per-team belief is the definition of
 * something that does.
 *
 * A team with no belief gets no key, which round-trips through
 * `readSwingBeliefs` as "no history" — the same state a team that has played
 * once is in, and the honest one.
 */
export function withSwingBeliefs(rows: readonly StateRow[], beliefs: ReadonlyMap<string, SwingBelief>): StateRow[] {
  return rows.map((row) => {
    if (row.scopeKind !== "team") return row;
    const belief = beliefs.get(row.scopeKey);
    if (belief === undefined) return row;
    const parsed = JSON.parse(row.stateJson) as Record<string, unknown>;
    return { ...row, stateJson: JSON.stringify({ ...parsed, [SWING_BELIEF_KEY]: belief }) };
  });
}

const SIGMA_BELIEF_KEY = "sigmascoutSigma";
const SIGMA_POPULATION_KEY = "sigmascoutSigmaPopulation";

/**
 * Reads each team's Sigma Score belief back out of the rows. The exact inverse
 * of `withSigmaBeliefs`.
 *
 * A belief missing any field is SKIPPED ENTIRELY rather than part-filled, the
 * same all-or-nothing rule `readSwingBeliefs` applies: a partially written
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

// ---------------------------------------------------------------------------
// Public dispatch
// ---------------------------------------------------------------------------

/**
 * D-12/D-13: converts one algorithm's in-memory state into `StateRow`s ready
 * for a D1 seed (`emitSeedSql`). Dispatches on `algorithmId`: `"opr"` is
 * event-scoped (D-09), `"epa"` is team-scoped, and every other id (`vpr`
 * and its four harness-only siblings, renamed by plan 07-16, D-04/D-05)
 * shares Sigma1State's exact shape.
 *
 * HAZARD for a future algorithm: the final line is a FALLTHROUGH, not a
 * lookup, so an id with no branch here is silently reinterpreted as
 * Sigma1-shaped rather than rejected. That is how `bpr` first failed, with
 * "state.componentOrder is not iterable" from deep inside the Sigma1
 * serializer rather than a message naming the real problem. Add a branch
 * when adding an algorithm.
 */
export function serializeState(
  algorithmId: string,
  algorithmVersion: string,
  state: Sigma1State | EpaState | OprState | BprState,
  stamp: StateStamp
): StateRow[] {
  if (algorithmId === "opr") return serializeOprState(algorithmId, algorithmVersion, state as OprState, stamp);
  if (algorithmId === "epa") return serializeEpaState(algorithmId, algorithmVersion, state as EpaState, stamp);
  if (algorithmId === "bpr") return serializeBprState(algorithmId, algorithmVersion, state as BprState, stamp);
  return serializeSigma1State(algorithmId, algorithmVersion, state as Sigma1State, stamp);
}

/** The inverse of `serializeState` — reconstructs a state whose `predict()`/`update()` behavior is identical to the state it came from, for a matching (possibly partial, D-13) set of rows. Throws `MissingLeagueRowError` when no `scopeKind: "league"` row is present. */
export function deserializeState(algorithmId: string, rows: readonly StateRow[]): Sigma1State | EpaState | OprState | BprState {
  if (algorithmId === "opr") return deserializeOprState(algorithmId, rows);
  if (algorithmId === "epa") return deserializeEpaState(algorithmId, rows);
  if (algorithmId === "bpr") return deserializeBprState(algorithmId, rows);
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
export const DEFAULT_MAX_STATEMENT_LENGTH = 90_000;

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
