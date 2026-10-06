/**
 * THE OFFLINE AS-OF CAPTURE (quick task 261005-5g0): one season's INDEX, LOG
 * and season objects, captured from a replay's own folds and fed to
 * `applyAsOfFold`, the reducer the live Worker tick calls too.
 *
 * TWO HOOKS, because the replay folds in two passes. SPR's own state moves
 * inside `WalkForwardSimulator.runAll` (`onMatchComplete`), and the Sigma and
 * RP state move afterwards, one record at a time, in `SigmaScoutLayer
 * .foldPlayed`. So:
 *
 *   - `onMatchComplete(match, state)` reads each tuple key's SPR part before
 *     and after the match, and the league's `logTau`/`scale` after it. Plain
 *     numbers only: no per-match state object is retained.
 *   - `foldLayer(match, fold)` reads the Sigma and RP parts before, runs the
 *     layer's own fold, reads them after with the league populations, and
 *     applies the whole match.
 *
 * `attachLayer` also reads the SEASON START object (Part 1b): every key the
 * carried state holds (SPR's team map, the carried Sigma beliefs, and any RP
 * belief, of which a fresh season has none), each read with the same
 * `readAsOfTeamTuple` rules a fold uses. Team state moves only when the team
 * plays, so this is exactly the `s` its first segment will carry.
 *
 * The league row BEFORE each match is read too (SPR's pair from the state the
 * previous match left, the layer's populations before its fold), so the match
 * that opens an event's INDEX records the row the season held just before it
 * (`lb`).
 *
 * The SPR part BEFORE a match is read from the state the previous match left
 * (the season's initial state for the first), which is exactly the state
 * `predict` and `update` saw: `runAll` threads it unchanged.
 *
 * Both `publish.ts` and `scripts/verifyAsOfOracle.ts` drive this class, so the
 * script proves the capture the publisher runs, not a copy of it.
 *
 * Reads only: it never mutates the layer or the state it is shown.
 */
import type { MatchResult } from "../core/algorithms/types.js";
import type { SprState } from "../core/algorithms/spr.js";
import type { RpPopulationState, RpTeamBeliefs } from "../core/rankingPoints/empiricalMoments.js";
import type { RpMeanShiftState } from "../core/rankingPoints/meanShift.js";
import type { SigmaBelief, SigmaPopulation } from "./sigmaScore.js";
import {
  applyAsOfFold,
  asOfTupleKeys,
  asOfTupleParts,
  createAsOfSeason,
  createAsOfStart,
  readAsOfLeagueTuple,
  readAsOfRpPart,
  readAsOfSigmaPart,
  readAsOfSprPart,
  readAsOfTeamTuple,
  type AsOfFoldTeam,
  type AsOfIndex,
  type AsOfLog,
  type AsOfRpSource,
  type AsOfSeason,
  type AsOfSigmaSource,
  type AsOfSprPart,
  type AsOfStamp,
  type AsOfStart,
  type AsOfTeamTuple,
} from "./asOfState.js";

/** The read-only slice of `SigmaScoutLayer` the capture reads. */
export interface AsOfCaptureLayer {
  sigmaBeliefFor(teamKey: string): SigmaBelief | undefined;
  sigmaPopulation(): SigmaPopulation | undefined;
  rpBeliefsFor(teamKey: string): RpTeamBeliefs | undefined;
  rpPopulationState(): RpPopulationState | undefined;
  rpMeanShiftState(): RpMeanShiftState | undefined;
  /** Every team holding a Sigma belief: read once, for the season start object's key set. */
  sigmaBeliefs(): ReadonlyMap<string, SigmaBelief>;
  /** Every team holding an RP belief: read once, for the season start object's key set. */
  rpVariableBeliefs(): ReadonlyMap<string, RpTeamBeliefs>;
}

export interface AsOfSeasonCaptureOptions {
  readonly season: number;
  /** The season rule module's threshold variable names, in order (`[]` for a season without one). */
  readonly vars: readonly string[];
  /** SPR's state before the season's first match: the carried state, or `initState` for a cold start. */
  readonly initialState: SprState;
  readonly stamp: AsOfStamp;
  /** Each played match's own sort_time. Every folded match must have one. */
  readonly sortTimeOf: (matchKey: string) => number | undefined;
}

/** What `onMatchComplete` saved for one match until its layer fold. */
interface PendingMatch {
  readonly matchKey: string;
  readonly keys: readonly string[];
  readonly sprBefore: readonly (AsOfSprPart | null)[];
  readonly sprAfter: readonly (AsOfSprPart | null)[];
  readonly logTau: number;
  readonly scale: number;
  /** SPR's league pair BEFORE the match: the state its `update` saw. */
  readonly logTauBefore: number;
  readonly scaleBefore: number;
}

export interface AsOfSeasonCaptureResult {
  readonly season: AsOfSeason;
  /** The season start tuples, read when the layer was attached. */
  readonly start: AsOfStart;
  /** Per event key, in first-fold order. */
  readonly indexes: ReadonlyMap<string, AsOfIndex>;
  readonly logs: ReadonlyMap<string, AsOfLog>;
}

export class AsOfCaptureError extends Error {
  constructor(message: string) {
    super(`asOfCapture: ${message}`);
    this.name = "AsOfCaptureError";
  }
}

export class AsOfSeasonCapture {
  readonly #options: AsOfSeasonCaptureOptions;
  #previous: SprState;
  readonly #pending: PendingMatch[] = [];
  #consumed = 0;
  #layer: AsOfCaptureLayer | undefined;
  #season: AsOfSeason | undefined;
  #start: AsOfStart | undefined;
  readonly #indexes = new Map<string, AsOfIndex>();
  readonly #logs = new Map<string, AsOfLog>();

  constructor(options: AsOfSeasonCaptureOptions) {
    this.#options = options;
    this.#previous = options.initialState;
  }

  /** Level 1: call right after SPR's `update` for every match, in stream order, with the state it returned. */
  onMatchComplete(match: MatchResult, state: SprState): void {
    const keys = asOfTupleKeys(match.redTeams, match.blueTeams);
    const before = this.#previous;
    this.#pending.push({
      matchKey: match.matchKey,
      keys,
      sprBefore: keys.map((key) => (asOfTupleParts(key).spr ? readAsOfSprPart(before, key) : null)),
      sprAfter: keys.map((key) => (asOfTupleParts(key).spr ? readAsOfSprPart(state, key) : null)),
      logTau: state.logTau,
      scale: state.scale,
      logTauBefore: before.logTau,
      scaleBefore: before.scale,
    });
    this.#previous = state;
  }

  /**
   * Hands the capture the season's layer BEFORE its first fold, which is the
   * instant the season object's `L0` (the league row before any fold) is read.
   */
  attachLayer(layer: AsOfCaptureLayer): void {
    if (this.#layer !== undefined) throw new AsOfCaptureError(`season ${this.#options.season} already has a layer`);
    this.#layer = layer;
    this.#season = createAsOfSeason({
      season: this.#options.season,
      vars: this.#options.vars,
      L0: readAsOfLeagueTuple({ spr: this.#options.initialState, ...this.#leagueSources(layer) }),
      stamp: this.#options.stamp,
    });
    const { sigma, rp } = this.#teamSources(layer);
    const sources = { spr: this.#options.initialState, sigma, rp, vars: this.#options.vars };
    const keys = new Set([...this.#options.initialState.teams.keys(), ...layer.sigmaBeliefs().keys(), ...layer.rpVariableBeliefs().keys()]);
    const teams = new Map<string, AsOfTeamTuple>();
    for (const key of keys) teams.set(key, readAsOfTeamTuple(key, sources));
    this.#start = createAsOfStart({ season: this.#options.season, vars: this.#options.vars, teams, stamp: this.#options.stamp });
  }

  /**
   * Level 2: wraps the layer's fold of one record. Records reach here in the
   * same order `onMatchComplete` saw their matches; a mismatch is a
   * bookkeeping bug and throws rather than misfiling a row.
   */
  foldLayer<T>(match: MatchResult, fold: () => T): T {
    const layer = this.#layer;
    if (layer === undefined) throw new AsOfCaptureError(`season ${this.#options.season}: foldLayer before attachLayer`);
    const pending = this.#pending[this.#consumed];
    if (pending === undefined || pending.matchKey !== match.matchKey) {
      throw new AsOfCaptureError(`layer fold of ${match.matchKey} does not follow the replay's order (expected ${pending?.matchKey ?? "no further match"})`);
    }
    this.#pending[this.#consumed] = undefined as unknown as PendingMatch;
    this.#consumed += 1;
    const t = this.#options.sortTimeOf(match.matchKey);
    if (t === undefined) throw new AsOfCaptureError(`no sort_time for ${match.matchKey}`);

    const { sigma, rp } = this.#teamSources(layer);
    const vars = this.#options.vars;
    const level2 = pending.keys.map((key) => asOfTupleParts(key).level2);
    const sigmaBefore = pending.keys.map((key, j) => (level2[j] ? readAsOfSigmaPart(sigma, key) : null));
    const rpBefore = pending.keys.map((key, j) => (level2[j] ? readAsOfRpPart(rp, key, vars) : null));
    // The league row just before this match, for an INDEX this match opens
    // (`lb`): SPR's pair as its `update` saw it, the layer's before its fold.
    const Lb = readAsOfLeagueTuple({ spr: { logTau: pending.logTauBefore, scale: pending.scaleBefore }, ...this.#leagueSources(layer) });

    const result = fold();

    const teams: AsOfFoldTeam[] = pending.keys.map((teamKey, j) => {
      const before: AsOfTeamTuple = [pending.sprBefore[j]!, sigmaBefore[j]!, rpBefore[j]!];
      const after: AsOfTeamTuple = [pending.sprAfter[j]!, level2[j] ? readAsOfSigmaPart(sigma, teamKey) : null, level2[j] ? readAsOfRpPart(rp, teamKey, vars) : null];
      return { teamKey, before, after };
    });
    const L = readAsOfLeagueTuple({ spr: { logTau: pending.logTau, scale: pending.scale }, ...this.#leagueSources(layer) });
    const folded = applyAsOfFold(
      { index: this.#indexes.get(match.eventKey), log: this.#logs.get(match.eventKey), season: this.#season! },
      { eventKey: match.eventKey, matchKey: match.matchKey, t, compLevel: match.compLevel, L, Lb, teams },
      this.#options.stamp
    );
    this.#indexes.set(match.eventKey, folded.index);
    this.#logs.set(match.eventKey, folded.log);
    return result;
  }

  /** The season's objects. Throws when a match reached `onMatchComplete` but never its layer fold. */
  finish(): AsOfSeasonCaptureResult {
    if (this.#consumed !== this.#pending.length) {
      throw new AsOfCaptureError(`season ${this.#options.season}: ${this.#pending.length - this.#consumed} replayed match(es) never reached the layer fold`);
    }
    const season = this.#season;
    if (season === undefined || this.#start === undefined) throw new AsOfCaptureError(`season ${this.#options.season}: finish before attachLayer`);
    return { season, start: this.#start, indexes: this.#indexes, logs: this.#logs };
  }

  #teamSources(layer: AsOfCaptureLayer): { sigma: AsOfSigmaSource; rp: AsOfRpSource } {
    return {
      sigma: { beliefFor: (teamKey) => layer.sigmaBeliefFor(teamKey), population: () => layer.sigmaPopulation() },
      rp: { beliefsFor: (teamKey) => layer.rpBeliefsFor(teamKey), populationState: () => layer.rpPopulationState() },
    };
  }

  #leagueSources(layer: AsOfCaptureLayer): Omit<Parameters<typeof readAsOfLeagueTuple>[0], "spr"> {
    const { sigma, rp } = this.#teamSources(layer);
    return { sigma, rp, meanShift: { toState: () => layer.rpMeanShiftState() }, vars: this.#options.vars };
  }
}
