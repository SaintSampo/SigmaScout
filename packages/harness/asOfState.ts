/**
 * AS-OF STATE (quick task 261005-5g0): the wire format a rewound view rebuilds
 * the model from, and the ONE reducer both writers call. The offline
 * publisher (`publish.ts`, through `asOfCapture.ts`) and the live Worker tick
 * each read the folded teams' state before and after every match with the
 * readers below and hand the result to `applyAsOfFold`, so the two writers
 * cannot disagree on a segment, a tail or a league row.
 *
 * WHAT IS CAPTURED. Team state moves only when the team plays (`spr.ts`
 * `foldRatings`, `SigmaScoreAccumulator.fold`, `RpMomentsAccumulator.fold`),
 * and the league row moves on every fold, so a team's state at any instant is
 * its tuple after its last match before that instant, and the league row is
 * the one after the last fold before it. `predict` has no time term.
 *
 *   - Team tuple `T = [spr | null, sigma | null, vars | null]`: spr
 *     `[muL, pL, muS, pS]`, sigma `[meanWeight, mean, varWeight, sumSquares,
 *     talent]`, vars one `[weight, weightSquares, mean, m2] | null` per
 *     threshold variable in rule module order.
 *   - League tuple `L = [logTau, scale, sigPopSumSquares, sigPopTalentSquares,
 *     sigPopCount, (n, mean, m2) x V, (count, sum) x V]`.
 *
 * DEMO ROBOTS. SPR holds every demo robot under `DEMO_PSEUDO_TEAM_KEY`, so a
 * raw demo key's SPR part would go stale the moment another demo robot played
 * anywhere. A raw demo key therefore carries `[null, sigma, vars]` (Sigma and
 * RP hold raw keys), and every row with a demo key also carries the pseudo
 * team as `[spr, null, null]`, which then has segments and a tail of its own
 * and resolves like any team.
 *
 * ORDER. One order everywhere: `(sort_time, eventKey, row index)`, the season
 * stream's own order. A position is a key `[t, i]` at an event; inside one
 * event only `i` is compared, across events `t` then the event key.
 *
 * SEGMENTS. A team's presence at an event is a list of segments, each a
 * maximal run of the team's consecutive matches there in its own season
 * sequence: `f`/`l` its first and last key, `p` the team's previous match
 * (`[eventKey, t, i]`, `null` for its first of the season), `s` its tuple
 * before `f`, `x` after `l`. A team that plays here, then elsewhere, then
 * here again (a division and Einstein, a DCMP parent and a division) has two.
 *
 * WORKER SAFE AND BROWSER SAFE: no Node built-in, nothing under
 * `packages/corpus`, never `publish.ts`, `replay.ts` or `sigmaScoutLayer.ts`.
 * Every accumulator is read through a structural interface, so this module
 * imports their types only. `upcomingPricing.workerSafe.test.ts` and
 * `browserSafeSchemas.test.ts` walk its graph.
 */
import { z } from "zod";
import type { SprState } from "../core/algorithms/spr.js";
import { DEMO_PSEUDO_TEAM_KEY, isDemoTeamKey } from "../core/algorithms/demoTeams.js";
import type { RpPopulationState, RpTeamBeliefs } from "../core/rankingPoints/empiricalMoments.js";
import type { RpMeanShiftState } from "../core/rankingPoints/meanShift.js";
import type { SigmaBelief, SigmaPopulation } from "./sigmaScore.js";
import { AlgorithmScopedPreambleSchema, PAGE_ARTIFACT_SCHEMA_VERSION } from "./pageArtifacts.js";

// ---------------------------------------------------------------------------
// Tuples
// ---------------------------------------------------------------------------

/** `[muL, pL, muS, pS]`. */
export type AsOfSprPart = [number, number, number, number];
/** `[meanWeight, mean, varWeight, sumSquares, talent]`. */
export type AsOfSigmaPart = [number, number, number, number, number];
/** `[weight, weightSquares, mean, m2]` for one threshold variable. */
export type AsOfRpVarPart = [number, number, number, number];
/** One team's whole compact state; each part `null` when the model holds none. */
export type AsOfTeamTuple = [AsOfSprPart | null, AsOfSigmaPart | null, (AsOfRpVarPart | null)[] | null];
/** `[logTau, scale, sigPopSumSquares, sigPopTalentSquares, sigPopCount, (n, mean, m2) x V, (count, sum) x V]`. */
export type AsOfLeagueTuple = number[];
/** A position inside one event: `[sort_time, row index in that event's log]`. */
export type AsOfKey = [number, number];
/** A position anywhere in the season: `[eventKey, sort_time, row index]`. */
export type AsOfPointer = [string, number, number];

/** A team no model has seen: every part null. */
export const UNSEEN_AS_OF_TUPLE: AsOfTeamTuple = [null, null, null];

/** The league tuple's length for `V` threshold variables. */
export function asOfLeagueLength(varCount: number): number {
  return 5 + 5 * varCount;
}

// ---------------------------------------------------------------------------
// Schemas (full precision numbers, plain JSON)
// ---------------------------------------------------------------------------

const finite = z.number().finite();
const SprPartSchema = z.tuple([finite, finite, finite, finite]);
const SigmaPartSchema = z.tuple([finite, finite, finite, finite, finite]);
const RpVarPartSchema = z.tuple([finite, finite, finite, finite]);
export const AsOfTeamTupleSchema = z.tuple([SprPartSchema.nullable(), SigmaPartSchema.nullable(), z.array(RpVarPartSchema.nullable()).nullable()]);
export const AsOfLeagueTupleSchema = z.array(finite);
const KeySchema = z.tuple([finite, z.number().int().nonnegative()]);
const PointerSchema = z.tuple([z.string().min(1), finite, z.number().int().nonnegative()]);
const KeyedLeagueSchema = z.object({ k: KeySchema, L: AsOfLeagueTupleSchema });

export const AsOfSegmentSchema = z.object({
  /** The segment's first match here. */
  f: KeySchema,
  /** The segment's last match here. */
  l: KeySchema,
  /** The team's match right before `f`, anywhere in the season, or `null` for its first of the season. */
  p: PointerSchema.nullable(),
  /** The team's tuple BEFORE `f`. */
  s: AsOfTeamTupleSchema,
  /** The team's tuple AFTER `l`. */
  x: AsOfTeamTupleSchema,
});

export const AsOfIndexSchema = AlgorithmScopedPreambleSchema.extend({
  eventKey: z.string().min(1),
  season: z.number().int(),
  /** Threshold variable names, rule module order: the index order of every `vars` part and of `L`. */
  vars: z.array(z.string()),
  /** `[matchKey, sort_time]` per folded match, in fold order; the array index IS the row index `i`. */
  m: z.array(z.tuple([z.string().min(1), finite])),
  /** League after the last QUALIFICATION match folded here, or `null` when none has been. */
  lq: KeyedLeagueSchema.nullable(),
  /** League after the last match folded here. */
  le: KeyedLeagueSchema,
  /**
   * League BEFORE this event's first folded row: the row the season stream
   * held just before it, which no object of this event otherwise names. Set
   * once, when the INDEX is created, and never moved. It is what prices a cut
   * just before the event's first row (`asOfCutBeforeMatch`), the Simulation
   * tab's rewind to the first qualification match. Optional: an INDEX written
   * before the field existed has none, and a reader then falls back.
   */
  lb: AsOfLeagueTupleSchema.optional(),
  teams: z.record(z.string(), z.array(AsOfSegmentSchema).min(1)),
});

export const AsOfLogRowSchema = z.object({
  /** Match key. */
  k: z.string().min(1),
  /** sort_time. */
  t: finite,
  /** League after this match. */
  L: AsOfLeagueTupleSchema,
  /** `[tupleKey, tuple after this match]` per team in the match, plus the demo pseudo team when a demo key played. */
  tm: z.array(z.tuple([z.string().min(1), AsOfTeamTupleSchema])),
});

export const AsOfLogSchema = AlgorithmScopedPreambleSchema.extend({
  eventKey: z.string().min(1),
  season: z.number().int(),
  vars: z.array(z.string()),
  rows: z.array(AsOfLogRowSchema),
});

export const AsOfSeasonSchema = AlgorithmScopedPreambleSchema.extend({
  season: z.number().int(),
  vars: z.array(z.string()),
  /** The league row before the season's first fold. `null` when the Worker created the object (it never saw the season start); an existing value is always preserved. */
  L0: AsOfLeagueTupleSchema.nullable(),
  /** Each team's last folded match this season: `[eventKey, t, i]`. */
  tails: z.record(z.string(), PointerSchema),
});

/**
 * SEASON START TUPLES (Part 1b). The tuple every team the model carries into
 * the season holds before the season's first fold: SPR's carried team state
 * and the carried Sigma belief (the RP part is null, since RP beliefs restart
 * each season). A team with no match yet by a cut has no segment and no tail
 * there, so this is the only object that can answer for it; without it a
 * rewound stop would price that team as a rookie and the number would move
 * once the team played. Written by the offline publisher only, for every
 * published season (one with no played match too); the Worker never writes it.
 */
export const AsOfStartSchema = AlgorithmScopedPreambleSchema.extend({
  season: z.number().int(),
  vars: z.array(z.string()),
  /** Tuple key -> tuple before the season's first fold. A key absent here held no state then (unseen). */
  teams: z.record(z.string(), AsOfTeamTupleSchema),
});

export type AsOfSegment = z.infer<typeof AsOfSegmentSchema>;
export type AsOfIndex = z.infer<typeof AsOfIndexSchema>;
export type AsOfLogRow = z.infer<typeof AsOfLogRowSchema>;
export type AsOfLog = z.infer<typeof AsOfLogSchema>;
export type AsOfSeason = z.infer<typeof AsOfSeasonSchema>;
export type AsOfStart = z.infer<typeof AsOfStartSchema>;

/** The stamp every as-of object carries, the event artifact's own preamble fields. */
export interface AsOfStamp {
  readonly generation: string;
  readonly computedAt: string;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
}

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

/** A cut: the row `i` of `eventKey` (stamped `t`) and everything before it. */
export interface AsOfCut {
  readonly eventKey: string;
  readonly t: number;
  readonly i: number;
}

/** The cut before every row of the season. */
export const AS_OF_SEASON_START_CUT: AsOfCut = Object.freeze({ eventKey: "", t: Number.NEGATIVE_INFINITY, i: -1 });

export function isAsOfSeasonStart(cut: AsOfCut): boolean {
  return cut.t === Number.NEGATIVE_INFINITY;
}

/** Whether the row at `key` of `eventKey` is at or before `cut`. Inside one event only the row index decides. */
export function asOfAtOrBefore(eventKey: string, key: readonly [number, number], cut: AsOfCut): boolean {
  if (isAsOfSeasonStart(cut)) return false;
  if (eventKey === cut.eventKey) return key[1] <= cut.i;
  if (key[0] !== cut.t) return key[0] < cut.t;
  return eventKey < cut.eventKey;
}

/** Total order on positions: negative when `(aEvent, a)` precedes `(bEvent, b)`. */
export function compareAsOfPositions(aEvent: string, a: readonly [number, number], bEvent: string, b: readonly [number, number]): number {
  if (aEvent === bEvent) return a[1] - b[1];
  if (a[0] !== b[0]) return a[0] - b[0];
  return aEvent < bEvent ? -1 : 1;
}

// ---------------------------------------------------------------------------
// Readers: one tuple from the live model objects
// ---------------------------------------------------------------------------

/** What the Sigma part is read from: `SigmaScoreAccumulator`, or the layer through an adapter. */
export interface AsOfSigmaSource {
  beliefFor(teamKey: string): SigmaBelief | undefined;
  population(): SigmaPopulation | undefined;
}

/** What the RP part is read from: `RpMomentsAccumulator`, or the layer through an adapter. */
export interface AsOfRpSource {
  beliefsFor(teamKey: string): RpTeamBeliefs | undefined;
  populationState(): RpPopulationState | undefined;
}

/** What the mean shift is read from: `RpMeanShiftAccumulator`, or the layer through an adapter. */
export interface AsOfMeanShiftSource {
  toState(): RpMeanShiftState | undefined;
}

/**
 * Which parts a tuple key carries: the demo pseudo team carries SPR only, a
 * raw demo key Sigma and RP only, every other key all three.
 */
export function asOfTupleParts(tupleKey: string): { readonly spr: boolean; readonly level2: boolean } {
  if (tupleKey === DEMO_PSEUDO_TEAM_KEY) return { spr: true, level2: false };
  if (isDemoTeamKey(tupleKey)) return { spr: false, level2: true };
  return { spr: true, level2: true };
}

/**
 * The tuple keys one match folds: each roster key once, red then blue, then
 * the demo pseudo team when any roster key is a demo key.
 */
export function asOfTupleKeys(redTeams: readonly string[], blueTeams: readonly string[]): string[] {
  const keys = [...new Set([...redTeams, ...blueTeams])];
  if (keys.some((teamKey) => isDemoTeamKey(teamKey)) && !keys.includes(DEMO_PSEUDO_TEAM_KEY)) keys.push(DEMO_PSEUDO_TEAM_KEY);
  return keys;
}

/** The SPR part SPR's own state holds under `stateKey` (the pseudo key for the pseudo team), or `null`. */
export function readAsOfSprPart(state: Pick<SprState, "teams">, stateKey: string): AsOfSprPart | null {
  const s = state.teams.get(stateKey);
  return s === undefined ? null : [s.muL, s.pL, s.muS, s.pS];
}

export function readAsOfSigmaPart(sigma: AsOfSigmaSource | undefined, teamKey: string): AsOfSigmaPart | null {
  const b = sigma?.beliefFor(teamKey);
  return b === undefined ? null : [b.meanWeight, b.mean, b.varWeight, b.sumSquares, b.talent];
}

export function readAsOfRpPart(rp: AsOfRpSource | undefined, teamKey: string, vars: readonly string[]): (AsOfRpVarPart | null)[] | null {
  const beliefs = rp?.beliefsFor(teamKey);
  if (beliefs === undefined) return null;
  return vars.map((name): AsOfRpVarPart | null => {
    const v = beliefs[name];
    return v === undefined ? null : [v.weight, v.weightSquares, v.mean, v.m2];
  });
}

/** Everything one team's tuple is read from, at one instant. */
export interface AsOfTeamSources {
  readonly spr: Pick<SprState, "teams">;
  readonly sigma: AsOfSigmaSource | undefined;
  readonly rp: AsOfRpSource | undefined;
  readonly vars: readonly string[];
}

/** One tuple key's tuple now, with the demo rules of `asOfTupleParts`. */
export function readAsOfTeamTuple(tupleKey: string, sources: AsOfTeamSources): AsOfTeamTuple {
  const parts = asOfTupleParts(tupleKey);
  return [
    parts.spr ? readAsOfSprPart(sources.spr, tupleKey) : null,
    parts.level2 ? readAsOfSigmaPart(sources.sigma, tupleKey) : null,
    parts.level2 ? readAsOfRpPart(sources.rp, tupleKey, sources.vars) : null,
  ];
}

/** Everything the league tuple is read from, at one instant. */
export interface AsOfLeagueSources {
  readonly spr: Pick<SprState, "logTau" | "scale">;
  readonly sigma: Pick<AsOfSigmaSource, "population"> | undefined;
  readonly rp: Pick<AsOfRpSource, "populationState"> | undefined;
  readonly meanShift: AsOfMeanShiftSource | undefined;
  readonly vars: readonly string[];
}

/** The league tuple now. An absent population or shift reads as zeros, which is what each resumes from. */
export function readAsOfLeagueTuple(sources: AsOfLeagueSources): AsOfLeagueTuple {
  const pop = sources.sigma?.population();
  const L: number[] = [sources.spr.logTau, sources.spr.scale, pop?.sumSquares ?? 0, pop?.talentSquares ?? 0, pop?.count ?? 0];
  const rpPop = sources.rp?.populationState();
  for (const name of sources.vars) {
    const v = rpPop?.variables[name];
    L.push(v?.n ?? 0, v?.mean ?? 0, v?.m2 ?? 0);
  }
  const shift = sources.meanShift?.toState();
  for (const name of sources.vars) {
    const v = shift?.variables[name];
    L.push(v?.count ?? 0, v?.sum ?? 0);
  }
  return L;
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

/** One team's tuple around one fold. */
export interface AsOfFoldTeam {
  readonly teamKey: string;
  readonly before: AsOfTeamTuple;
  readonly after: AsOfTeamTuple;
}

/** One folded match, as both writers capture it. */
export interface AsOfFold {
  readonly eventKey: string;
  readonly matchKey: string;
  /** The match's own sort_time. */
  readonly t: number;
  readonly compLevel: string;
  /** League tuple after this match. */
  readonly L: AsOfLeagueTuple;
  /**
   * League tuple BEFORE this match: the row the writer's own previous fold
   * left (the season start row for its first). Read only when the match opens
   * its event's INDEX, where it becomes `lb`. Optional, so a writer that does
   * not supply it writes an INDEX without `lb`.
   */
  readonly Lb?: AsOfLeagueTuple;
  /** Every tuple key of the match (`asOfTupleKeys`), in that order. */
  readonly teams: readonly AsOfFoldTeam[];
}

/** One event's INDEX and LOG (absent before its first fold) and the season object. */
export interface AsOfEventState {
  readonly index: AsOfIndex | undefined;
  readonly log: AsOfLog | undefined;
  readonly season: AsOfSeason;
}

export interface AsOfFoldResult {
  readonly index: AsOfIndex;
  readonly log: AsOfLog;
  readonly season: AsOfSeason;
}

function stampOf(stamp: AsOfStamp): { schemaVersion: typeof PAGE_ARTIFACT_SCHEMA_VERSION } & AsOfStamp {
  return {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: stamp.generation,
    computedAt: stamp.computedAt,
    algorithmId: stamp.algorithmId,
    algorithmVersion: stamp.algorithmVersion,
  };
}

function applyStamp(target: { generation: string; computedAt: string; algorithmId: string; algorithmVersion: string }, stamp: AsOfStamp): void {
  target.generation = stamp.generation;
  target.computedAt = stamp.computedAt;
  target.algorithmId = stamp.algorithmId;
  target.algorithmVersion = stamp.algorithmVersion;
}

/** A new season object. `L0` is the league row before the first fold, or `null` from a writer that never saw it. */
export function createAsOfSeason(params: { season: number; vars: readonly string[]; L0: AsOfLeagueTuple | null; stamp: AsOfStamp }): AsOfSeason {
  return { ...stampOf(params.stamp), season: params.season, vars: [...params.vars], L0: params.L0 === null ? null : [...params.L0], tails: {} };
}

/**
 * The season start object from the tuples read at the season's first instant.
 * Keys are written sorted, so the same state always serializes to the same bytes.
 */
export function createAsOfStart(params: { season: number; vars: readonly string[]; teams: ReadonlyMap<string, AsOfTeamTuple>; stamp: AsOfStamp }): AsOfStart {
  const teams: Record<string, AsOfTeamTuple> = {};
  for (const teamKey of [...params.teams.keys()].sort()) teams[teamKey] = params.teams.get(teamKey)!;
  return { ...stampOf(params.stamp), season: params.season, vars: [...params.vars], teams };
}

/** Raised for a fold the reducer cannot place without corrupting an object. */
export class AsOfFoldError extends Error {
  constructor(message: string) {
    super(`applyAsOfFold: ${message}`);
    this.name = "AsOfFoldError";
  }
}

function sameKey(a: readonly [number, number], b: readonly [number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Folds one match into its event's INDEX and LOG and the season object.
 *
 * Deterministic and I/O free. It UPDATES the objects it is given in place and
 * returns them (creating the INDEX and LOG on the event's first fold): a
 * season publish folds about 20,000 matches into one season object, and a
 * copying reducer would copy every team's tail per fold.
 *
 * Per tuple key: if the team's tail is this event's own last segment, that
 * segment grows (`l`, `x`); otherwise a new segment opens with `p` the tail
 * (`null` for the team's first match of the season) and `s` the tuple before
 * this match. The tail then points here. `lq` moves on a qualification match,
 * `le` on every match.
 *
 * IDEMPOTENT: a match key already in this event's INDEX is a no-op, so a
 * re-fold (a Worker retry) never adds a second row.
 */
export function applyAsOfFold(state: AsOfEventState, fold: AsOfFold, stamp: AsOfStamp): AsOfFoldResult {
  const { season } = state;
  const vars = season.vars;
  if (fold.L.length !== asOfLeagueLength(vars.length)) {
    throw new AsOfFoldError(`${fold.matchKey}: league tuple has ${fold.L.length} entries, expected ${asOfLeagueLength(vars.length)}`);
  }
  if (fold.Lb !== undefined && fold.Lb.length !== asOfLeagueLength(vars.length)) {
    throw new AsOfFoldError(`${fold.matchKey}: league tuple before it has ${fold.Lb.length} entries, expected ${asOfLeagueLength(vars.length)}`);
  }
  const index: AsOfIndex = state.index ?? {
    ...stampOf(stamp),
    eventKey: fold.eventKey,
    season: season.season,
    vars: [...vars],
    m: [],
    lq: null,
    le: { k: [fold.t, 0], L: fold.L },
    // Only the fold that CREATES the INDEX sets `lb`: it is the league before
    // the event's first row, and no later fold may move it.
    ...(fold.Lb !== undefined ? { lb: fold.Lb } : {}),
    teams: {},
  };
  const log: AsOfLog = state.log ?? { ...stampOf(stamp), eventKey: fold.eventKey, season: season.season, vars: [...vars], rows: [] };
  if (index.eventKey !== fold.eventKey || log.eventKey !== fold.eventKey) {
    throw new AsOfFoldError(`${fold.matchKey} belongs to ${fold.eventKey}, not ${index.eventKey}`);
  }
  if (index.season !== season.season || log.season !== season.season) {
    throw new AsOfFoldError(`${fold.eventKey}'s objects are season ${index.season}, the season object is ${season.season}`);
  }
  if (index.m.length !== log.rows.length) {
    throw new AsOfFoldError(`${fold.eventKey}'s INDEX holds ${index.m.length} rows and its LOG ${log.rows.length}`);
  }
  if (index.m.some(([matchKey]) => matchKey === fold.matchKey)) return { index, log, season };

  const i = index.m.length;
  const key: AsOfKey = [fold.t, i];
  for (const { teamKey, before, after } of fold.teams) {
    const tail = season.tails[teamKey];
    const segments = index.teams[teamKey];
    const last = segments?.[segments.length - 1];
    if (tail !== undefined && tail[0] === fold.eventKey && last !== undefined && sameKey(last.l, [tail[1], tail[2]])) {
      last.l = key;
      last.x = after;
    } else {
      const segment: AsOfSegment = { f: key, l: key, p: tail === undefined ? null : [tail[0], tail[1], tail[2]], s: before, x: after };
      if (segments === undefined) index.teams[teamKey] = [segment];
      else segments.push(segment);
    }
    season.tails[teamKey] = [fold.eventKey, fold.t, i];
  }

  index.m.push([fold.matchKey, fold.t]);
  log.rows.push({ k: fold.matchKey, t: fold.t, L: fold.L, tm: fold.teams.map(({ teamKey, after }) => [teamKey, after]) });
  index.le = { k: key, L: fold.L };
  if (fold.compLevel === "qm") index.lq = { k: key, L: fold.L };
  applyStamp(index, stamp);
  applyStamp(log, stamp);
  applyStamp(season, stamp);
  return { index, log, season };
}
