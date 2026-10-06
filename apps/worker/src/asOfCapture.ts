/**
 * THE LIVE AS-OF CAPTURE (quick task 261005-5g0, Part 2): the tick's half of
 * the as-of state, the offline publisher's `packages/harness/asOfCapture.ts`
 * being the other. Both read tuples with the same `asOfState.ts` readers and
 * hand them to the same reducer, `applyAsOfFold`, so a live INDEX, LOG and
 * season object agree with a republish's by construction.
 *
 * TWO HALVES, matching the tick's two phases:
 *
 *   - PHASE A (`AsOfTickCapture`): inside the fold loop, each tuple key's
 *     tuple BEFORE the match's first fold step and AFTER its last (the talent
 *     observation), and the league tuple before and after (the row before is
 *     what an INDEX the match opens records as `lb`). Reads only: every reader
 *     returns a copy or a snapshot, and nothing here touches the fold.
 *   - PHASE B (`writeAsOfFolds`): best effort, after state has advanced. Reads
 *     the event's INDEX and LOG and the season object from R2 (absent means
 *     start empty), applies every captured fold in order, and writes the three
 *     back, LOG first and the season object last, so a reader never meets an
 *     INDEX row its LOG lacks or a tail its INDEX lacks. A season object the
 *     Worker creates has `L0: null` (it never saw the season start); one the
 *     publisher wrote keeps its `L0`, because the reducer never overwrites it.
 *
 * SPR ONLY, by the publisher's own rule: the algorithm whose ranking points
 * the layer prices, running SPR's own `predict` and `update`, since the wire
 * format describes `SprState`.
 *
 * WHAT IT COSTS a tick that folds matches at one event: three R2 reads and
 * three R2 writes, for SPR only, plus one read and one write when another
 * invocation wrote the season object in between. No D1 statement. A tick that
 * folds nothing costs nothing.
 *
 * THE SEASON OBJECT is shared by every event, so its put back is conditional
 * on the etag it was read with (`*`, "still absent", for one that was not
 * there). When another invocation wrote it in between, the tick re-reads it,
 * lays the tails it moved over the fresh object and tries ONCE more; a second
 * conflict is one logged line.
 *
 * KNOWN LIMITS. The next republish rewrites every as-of object from the
 * offline replay and heals all of them; until then:
 *   - The tick folds concurrent events in tick order, not sort-time order, so a
 *     league row can differ from the replay's by the other events' matches
 *     folded in between.
 *   - A season object write that is lost (it fails, or conflicts twice) leaves
 *     the tails of that tick's teams behind their INDEX. The team's next fold
 *     at the SAME event grows its segment from the INDEX (`applyAsOfFold`), so
 *     that segment is never corrupted, and a lookup holding that INDEX lets it
 *     win over the tail (`resolveAsOf`). A lookup that does not hold it and
 *     walks from the stale tail reads the state before the lost matches:
 *     older than the truth, never later.
 *   - NOT HEALED BEFORE A REPUBLISH: if that team's next fold is at ANOTHER
 *     event, the segment it opens there takes the stale tail as `p`, which
 *     points before the team's true previous match. A lookup holding the
 *     earlier event's INDEX sees that segment run past `p` and reads its LOG
 *     (`resolveAsOf`). One that does not hold it, at a cut between `p` and the
 *     true previous match, reads the new segment's `s`: the state after a
 *     match played after the cut. It needs a lost season write and the
 *     team's next match elsewhere before the next republish; the reducer
 *     cannot see it without reading that other event's INDEX.
 *   - A failed write here is not retried: those matches are already folded,
 *     so the next tick never captures them again, and a rewound stop anchored
 *     on one of them reads as unavailable. A LOG put that landed before a
 *     failed INDEX put leaves orphan rows; the next tick cuts them off
 *     (`withoutOrphanRows`) and captures normally from there.
 */
import { spr, type SprState } from "../../../packages/core/algorithms/spr.js";
import type { AlgorithmModule, MatchResult } from "../../../packages/core/algorithms/types.js";
import type { RpRuleModule } from "../../../packages/core/rankingPoints/constants.js";
import { layerPricesRankingPoints } from "../../../packages/harness/sigmaScore.js";
import {
  applyAsOfFold,
  AsOfIndexSchema,
  AsOfLogSchema,
  AsOfSeasonSchema,
  asOfTupleKeys,
  compareAsOfPositions,
  createAsOfSeason,
  readAsOfLeagueTuple,
  readAsOfTeamTuple,
  type AsOfEventState,
  type AsOfFold,
  type AsOfIndex,
  type AsOfLeagueTuple,
  type AsOfLog,
  type AsOfMeanShiftSource,
  type AsOfPointer,
  type AsOfRpSource,
  type AsOfSeason,
  type AsOfSigmaSource,
  type AsOfStamp,
  type AsOfTeamTuple,
} from "../../../packages/harness/asOfState.js";
import { asOfIndexKey, asOfLogKey, asOfSeasonKey } from "../../../packages/harness/pageArtifacts.js";
import { readArtifactObject, readArtifactObjectWithEtag, writeAsOfObject } from "./artifactWriter.js";
import type { Env } from "./env.js";
import type { SubrequestCounter } from "./subrequestCounter.js";

/**
 * Whether the tick captures as-of state for this algorithm: the same predicate
 * `publishSeasonsWith` applies to choose its `asOfAlgorithm`.
 */
export function capturesAsOf(algorithm: AlgorithmModule<any>): boolean {
  return layerPricesRankingPoints(algorithm.id) && algorithm.predict === spr.predict && algorithm.update === spr.update;
}

/** The model objects the fold loop holds, at one instant. `state` is reassigned by every `update`, so this is read fresh each time. */
export interface AsOfModelView {
  readonly state: SprState;
  readonly sigma: AsOfSigmaSource | undefined;
  readonly rp: AsOfRpSource | undefined;
  readonly meanShift: AsOfMeanShiftSource | undefined;
}

/** One match's tuples read before its fold. */
export interface AsOfBefore {
  readonly matchKey: string;
  readonly keys: readonly string[];
  readonly tuples: readonly AsOfTeamTuple[];
  /** The league tuple before the match: an INDEX this match opens records it as `lb`. */
  readonly league: AsOfLeagueTuple;
}

/**
 * Phase A's capture for one algorithm: every folded match, in fold order.
 *
 * NEVER THROWS INTO THE FOLD. Phase A's catch reverts the claim and fails the
 * whole event, so a capture error is held in `error` instead, every later call
 * is a no-op, and Phase B logs it as its one `asof-write-failed` line and
 * writes nothing.
 */
export class AsOfTickCapture {
  readonly folds: AsOfFold[] = [];
  #error: unknown;

  /** `vars` is the season rule module's threshold variable names, in order (`[]` for a season without one). */
  constructor(readonly vars: readonly string[]) {}

  /** The first error a read raised, or `undefined`. */
  get error(): unknown {
    return this.#error;
  }

  /** Call before ANY of the match's fold steps (predict reads nothing it writes, so the loop's top is the instant). */
  before(result: MatchResult, view: AsOfModelView): AsOfBefore | undefined {
    if (this.#error !== undefined) return undefined;
    try {
      const keys = asOfTupleKeys(result.redTeams, result.blueTeams);
      const sources = { spr: view.state, sigma: view.sigma, rp: view.rp, vars: this.vars };
      return {
        matchKey: result.matchKey,
        keys,
        tuples: keys.map((key) => readAsOfTeamTuple(key, sources)),
        league: readAsOfLeagueTuple({ spr: view.state, sigma: view.sigma, rp: view.rp, meanShift: view.meanShift, vars: this.vars }),
      };
    } catch (error) {
      this.#error = error;
      return undefined;
    }
  }

  /** Call after the match's LAST fold step with what `before` returned. `t` is the match's own sort_time, as the tick normalized it. */
  after(result: MatchResult, t: number | undefined, before: AsOfBefore | undefined, view: AsOfModelView): void {
    if (this.#error !== undefined || before === undefined) return;
    try {
      if (before.matchKey !== result.matchKey) throw new Error(`AsOfTickCapture: after(${result.matchKey}) does not follow before(${before.matchKey})`);
      if (t === undefined) throw new Error(`AsOfTickCapture: no sort_time for ${result.matchKey}`);
      const sources = { spr: view.state, sigma: view.sigma, rp: view.rp, vars: this.vars };
      this.folds.push({
        eventKey: result.eventKey,
        matchKey: result.matchKey,
        t,
        compLevel: result.compLevel,
        L: readAsOfLeagueTuple({ spr: view.state, sigma: view.sigma, rp: view.rp, meanShift: view.meanShift, vars: this.vars }),
        Lb: before.league,
        teams: before.keys.map((teamKey, j) => ({ teamKey, before: before.tuples[j]!, after: readAsOfTeamTuple(teamKey, sources) })),
      });
    } catch (error) {
      this.#error = error;
    }
  }
}

/** The rule module's variable names, the `vars` every as-of object carries. */
export function asOfVarsOf(ruleModule: RpRuleModule | undefined): string[] {
  return ruleModule?.thresholdVariables.map((v) => v.name) ?? [];
}

export interface WriteAsOfFoldsParams {
  readonly eventKey: string;
  readonly season: number;
  readonly vars: readonly string[];
  readonly folds: readonly AsOfFold[];
  readonly stamp: AsOfStamp;
}

export class AsOfLiveWriteError extends Error {
  constructor(message: string) {
    super(`writeAsOfFolds: ${message}`);
    this.name = "AsOfLiveWriteError";
  }
}

function sameVars(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, v) => name === b[v]);
}

async function readParsed<T>(env: Env, counter: SubrequestCounter, key: string, schema: { parse(input: unknown): T }): Promise<T | undefined> {
  const text = await readArtifactObject(env, counter, key);
  return text === undefined ? undefined : schema.parse(JSON.parse(text));
}

/**
 * The LOG cut back to its INDEX's rows. The LOG is put first, so a tick whose
 * INDEX put then failed (or that was killed between the two) leaves LOG rows
 * no INDEX names. Those rows can never be indexed (their matches are already
 * folded and are not captured again) and the reducer refuses a LOG longer
 * than its INDEX, so without this every later tick would throw and the event
 * would stop capturing for good. Each kept row must be the row the INDEX
 * names at its position; anything else is not this failure and still throws.
 */
export function withoutOrphanRows(eventKey: string, index: AsOfIndex | undefined, log: AsOfLog | undefined): AsOfLog | undefined {
  const indexed = index?.m.length ?? 0;
  if (log === undefined || log.rows.length <= indexed) return log;
  for (let i = 0; i < indexed; i++) {
    if (log.rows[i]!.k !== index!.m[i]![0]) throw new AsOfLiveWriteError(`${eventKey}: LOG row ${i} is ${log.rows[i]!.k}, its INDEX names ${index!.m[i]![0]}`);
  }
  return { ...log, rows: log.rows.slice(0, indexed) };
}

/** The season object as read, with the etag its put back is conditioned on; `undefined` when absent. */
interface SeasonRead {
  readonly season: AsOfSeason;
  readonly etag: string | undefined;
}

async function readSeason(env: Env, counter: SubrequestCounter, key: string): Promise<SeasonRead | undefined> {
  const read = await readArtifactObjectWithEtag(env, counter, key);
  return read === undefined ? undefined : { season: AsOfSeasonSchema.parse(JSON.parse(read.text)), etag: read.etag };
}

/**
 * The put-back condition for a season object read as `read`: the same etag,
 * or, when it was absent, still absent (`*`, the HTTP If-None-Match wildcard).
 * A binding that reported no etag (a test fake) gets an unconditional put.
 */
function seasonCondition(read: SeasonRead | undefined): R2Conditional | undefined {
  if (read === undefined) return { etagDoesNotMatch: "*" };
  return read.etag === undefined ? undefined : { etagMatches: read.etag };
}

/**
 * This tick's tails laid over a season object another invocation wrote since
 * this one read it. Only the tails this tick moved are laid; where both moved
 * the same team's tail, the later position wins. `L0` and every other tail are
 * the fresh object's.
 */
export function mergeAsOfSeasonTails(fresh: AsOfSeason, moved: ReadonlyMap<string, AsOfPointer>, stamp: AsOfStamp): AsOfSeason {
  const tails = { ...fresh.tails };
  for (const [teamKey, ours] of moved) {
    const theirs = tails[teamKey];
    if (theirs === undefined || compareAsOfPositions(ours[0], [ours[1], ours[2]], theirs[0], [theirs[1], theirs[2]]) > 0) tails[teamKey] = ours;
  }
  return { ...fresh, ...stamp, tails };
}

/**
 * Phase B: folds `params.folds` into the event's INDEX and LOG and the season
 * object in R2. Three reads, three writes, and one more of each when the
 * season object conflicts. Throws on anything it cannot place without
 * corrupting an object (an unparseable object, a `vars` mismatch, a reducer
 * refusal) and writes nothing then; a second season conflict throws after the
 * LOG and INDEX are written. The caller logs and moves on. A corrupt
 * object is never replaced by a fresh one, which would silently drop every
 * earlier row. Orphan LOG rows are the one repair it makes
 * (`withoutOrphanRows`).
 */
export async function writeAsOfFolds(env: Env, counter: SubrequestCounter, params: WriteAsOfFoldsParams): Promise<void> {
  if (params.folds.length === 0) return;
  const keyParams = { algorithmId: params.stamp.algorithmId, version: params.stamp.algorithmVersion };
  const indexKey = asOfIndexKey({ eventKey: params.eventKey, ...keyParams });
  const logKey = asOfLogKey({ eventKey: params.eventKey, ...keyParams });
  const seasonKey = asOfSeasonKey({ season: params.season, ...keyParams });

  const index = await readParsed(env, counter, indexKey, AsOfIndexSchema);
  const log = await readParsed(env, counter, logKey, AsOfLogSchema);
  const seasonRead = await readSeason(env, counter, seasonKey);
  const season = seasonRead?.season ?? createAsOfSeason({ season: params.season, vars: params.vars, L0: null, stamp: params.stamp });
  const checkVars = (label: string, vars: readonly string[] | undefined): void => {
    if (vars !== undefined && !sameVars(vars, params.vars)) {
      throw new AsOfLiveWriteError(`${params.eventKey}: the ${label}'s vars [${vars.join(", ")}] are not the season rule module's [${params.vars.join(", ")}]`);
    }
  };
  checkVars("season object", season.vars);
  checkVars("INDEX", index?.vars);
  checkVars("LOG", log?.vars);

  const tailsBefore = { ...season.tails };
  let state: AsOfEventState = { index, log: withoutOrphanRows(params.eventKey, index, log), season };
  for (const fold of params.folds) {
    if (fold.eventKey !== params.eventKey) throw new AsOfLiveWriteError(`${fold.matchKey} is not a ${params.eventKey} match`);
    state = applyAsOfFold(state, fold, params.stamp);
  }

  await writeAsOfObject(env, counter, "asof-log", logKey, state.log);
  await writeAsOfObject(env, counter, "asof", indexKey, state.index);
  if (await writeAsOfObject(env, counter, "asof-season", seasonKey, state.season, seasonCondition(seasonRead))) return;

  // Another invocation wrote the season object after this one read it. Lay
  // this tick's tails over its object and try once more; a second conflict
  // throws (one logged line), and this tick's tails wait for the team's next
  // fold, which the reducer places from the INDEX (`applyAsOfFold`).
  const moved = new Map<string, AsOfPointer>();
  for (const [teamKey, tail] of Object.entries(state.season.tails)) if (tailsBefore[teamKey] !== tail) moved.set(teamKey, tail);
  const freshRead = await readSeason(env, counter, seasonKey);
  if (freshRead !== undefined) checkVars("season object", freshRead.season.vars);
  const fresh = freshRead?.season ?? createAsOfSeason({ season: params.season, vars: params.vars, L0: null, stamp: params.stamp });
  if (await writeAsOfObject(env, counter, "asof-season", seasonKey, mergeAsOfSeasonTails(fresh, moved, params.stamp), seasonCondition(freshRead))) return;
  throw new AsOfLiveWriteError(`${params.eventKey}: the season object changed under this tick twice; ${moved.size} tails were not written`);
}
