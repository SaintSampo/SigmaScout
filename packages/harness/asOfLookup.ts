/**
 * AS-OF LOOKUP (quick task 261005-5g0): every requested team's tuple and the
 * league tuple at a cut, rebuilt from the objects `asOfState.ts` defines.
 *
 * PURE, NO I/O. The caller hands in whatever INDEX, LOG and season start
 * objects it already holds; `resolveAsOf` answers every team it can and lists
 * the objects it still needs (`missingIndexes`, `missingLogs`,
 * `missingStart`). The caller fetches those and calls again until nothing is
 * missing. A map entry (or `start`) of `null` means "known
 * not published": a known event with no INDEX simply contributes no segment,
 * while a walk that has to step INTO an unpublished object is a broken publish
 * and throws `AsOfResolveError`.
 *
 * THE WALK, per team. Start from the team's earliest segment, among the
 * caller's known events, that begins after the cut; with none, from the
 * segment its season tail ends. Then:
 *
 *   - the segment begins at or before the cut: `x` when it also ends at or
 *     before it, else the team's last LOG row inside the segment at or before
 *     the cut;
 *   - the segment begins after the cut: `s` when `p` is `null` or at or before
 *     the cut, else continue at the segment `p` ends.
 *
 * Starting from a segment AFTER the cut and walking back through `p` is what
 * makes the answer exact without knowing every event the team played: `p`
 * names the team's true previous match, so the walk can never skip one.
 *
 * A team with no starting segment and no tail has played no match this season
 * that the caller's objects know of: it reads its SEASON START tuple
 * (`input.start.teams[teamKey]`), or unseen when the start object holds none.
 * That is the same tuple its first segment's `s` would carry once it plays, so
 * a stop before a team's first match prices it identically whether or not
 * that match has happened yet. `start: undefined` means "not fetched yet": a
 * team that needs it stays unresolved and the result says `missingStart`, so
 * the caller fetches the object only when some requested team needs it.
 *
 * League: `L0` at the season start cut, else the cut row's own `L`, read from
 * `lq`/`le` when the cut is exactly that key, from the cut event's LOG
 * otherwise. A cut just BEFORE an event's first row (`i` of -1, which
 * `asOfCutBeforeMatch` builds) reads that INDEX's `lb`, the league row the
 * season held just before it; an INDEX without `lb` cannot answer and throws.
 *
 * DEMO ROBOTS. A requested demo key carries no SPR part, so the demo pseudo
 * team is resolved alongside it (known events: the union of the demo keys'),
 * exactly once, whenever any requested team is a demo key. The pricer reads
 * the pseudo team's SPR part from there.
 *
 * BROWSER SAFE: imports `asOfState.ts` and the demo key helpers only.
 */
import { DEMO_PSEUDO_TEAM_KEY, isDemoTeamKey } from "../core/algorithms/demoTeams.js";
import {
  asOfAtOrBefore,
  compareAsOfPositions,
  isAsOfSeasonStart,
  UNSEEN_AS_OF_TUPLE,
  type AsOfCut,
  type AsOfIndex,
  type AsOfLeagueTuple,
  type AsOfLog,
  type AsOfSeason,
  type AsOfSegment,
  type AsOfStart,
  type AsOfTeamTuple,
} from "./asOfState.js";

export interface AsOfResolveTeam {
  readonly teamKey: string;
  /** Events the caller knows the team plays at (its roster events): where the walk looks for a starting segment. */
  readonly knownEventKeys: readonly string[];
}

export interface AsOfResolveInput {
  readonly cut: AsOfCut;
  readonly teams: readonly AsOfResolveTeam[];
  readonly season: AsOfSeason;
  /** INDEX per event key; `null` is "known not published". */
  readonly indexes: ReadonlyMap<string, AsOfIndex | null>;
  /** LOG per event key; `null` is "known not published". */
  readonly logs: ReadonlyMap<string, AsOfLog | null>;
  /** The season start object; `undefined` while not fetched, `null` when known not published (a walk that needs it then throws). */
  readonly start: AsOfStart | null | undefined;
}

export interface AsOfResolveResult {
  /** Every team resolved this call (and the demo pseudo team when a demo key was asked for). */
  readonly states: Map<string, AsOfTeamTuple>;
  /** The league tuple at the cut, or `undefined` while its object is missing or when the season object holds no `L0`. */
  readonly league: AsOfLeagueTuple | undefined;
  /** INDEX objects still needed, sorted. */
  readonly missingIndexes: string[];
  /** LOG objects still needed, sorted. */
  readonly missingLogs: string[];
  /** Whether some requested team needs the season start object the caller has not supplied. */
  readonly missingStart: boolean;
}

export class AsOfResolveError extends Error {
  constructor(message: string) {
    super(`resolveAsOf: ${message}`);
    this.name = "AsOfResolveError";
  }
}

/** A segment and the event it belongs to. */
interface Located {
  readonly eventKey: string;
  readonly segment: AsOfSegment;
}

/** The marker a step returns when it needs an object the caller has not supplied yet. */
const PENDING = Symbol("pending");

class Resolver {
  readonly missingIndexes = new Set<string>();
  readonly missingLogs = new Set<string>();
  missingStart = false;

  constructor(private readonly input: AsOfResolveInput) {
    const { start, season } = input;
    if (start !== null && start !== undefined && start.season !== season.season) {
      throw new AsOfResolveError(`the season start object is season ${start.season}, the season object is ${season.season}`);
    }
  }

  /** A team's season start tuple (unseen when the object holds none), or `PENDING` (recorded as missing). */
  startTuple(teamKey: string): AsOfTeamTuple | typeof PENDING {
    const start = this.input.start;
    if (start === undefined) {
      this.missingStart = true;
      return PENDING;
    }
    if (start === null) throw new AsOfResolveError(`${teamKey} has played no match by the cut and the season start object is not published`);
    return start.teams[teamKey] ?? UNSEEN_AS_OF_TUPLE;
  }

  /** The event's INDEX, `null` when known unpublished, or `PENDING` (recorded as missing). */
  index(eventKey: string): AsOfIndex | null | typeof PENDING {
    const index = this.input.indexes.get(eventKey);
    if (index === undefined) {
      this.missingIndexes.add(eventKey);
      return PENDING;
    }
    return index;
  }

  log(eventKey: string): AsOfLog | typeof PENDING {
    const log = this.input.logs.get(eventKey);
    if (log === undefined) {
      this.missingLogs.add(eventKey);
      return PENDING;
    }
    if (log === null) throw new AsOfResolveError(`the walk needs ${eventKey}'s LOG, which is not published`);
    return log;
  }

  /** The segment of `teamKey` at `eventKey` that ends at row `i`, or `PENDING`. */
  segmentEndingAt(teamKey: string, eventKey: string, i: number): Located | typeof PENDING {
    const index = this.index(eventKey);
    if (index === PENDING) return PENDING;
    if (index === null) throw new AsOfResolveError(`${teamKey}'s walk needs ${eventKey}'s INDEX, which is not published`);
    const segment = index.teams[teamKey]?.find((candidate) => candidate.l[1] === i);
    if (segment === undefined) throw new AsOfResolveError(`${teamKey} has no segment at ${eventKey} ending at row ${i}`);
    return { eventKey, segment };
  }

  /** One team's tuple at the cut, or `PENDING`. */
  team(teamKey: string, knownEventKeys: readonly string[]): AsOfTeamTuple | typeof PENDING {
    const { cut, season } = this.input;
    let start: Located | undefined;
    let pending = false;
    for (const eventKey of knownEventKeys) {
      const index = this.index(eventKey);
      if (index === PENDING) {
        pending = true;
        continue;
      }
      for (const segment of index?.teams[teamKey] ?? []) {
        if (asOfAtOrBefore(eventKey, segment.f, cut)) continue;
        if (start === undefined || compareAsOfPositions(eventKey, segment.f, start.eventKey, start.segment.f) < 0) start = { eventKey, segment };
      }
    }
    // The starting segment depends on every known event, so nothing is walked until all of them are in.
    if (pending) return PENDING;

    let current: Located | typeof PENDING;
    if (start !== undefined) {
      current = start;
    } else {
      const tail = season.tails[teamKey];
      if (tail === undefined) return this.startTuple(teamKey);
      current = this.segmentEndingAt(teamKey, tail[0], tail[2]);
    }

    // A walk visits each of the team's segments at most once, and a season holds far fewer than this.
    for (let guard = 0; guard < 10_000; guard++) {
      if (current === PENDING) return PENDING;
      const { eventKey, segment } = current;
      if (asOfAtOrBefore(eventKey, segment.f, cut)) {
        if (asOfAtOrBefore(eventKey, segment.l, cut)) return segment.x;
        const log = this.log(eventKey);
        if (log === PENDING) return PENDING;
        for (let i = Math.min(segment.l[1], log.rows.length - 1); i >= segment.f[1]; i--) {
          const row = log.rows[i]!;
          if (!asOfAtOrBefore(eventKey, [row.t, i], cut)) continue;
          for (const [key, tuple] of row.tm) if (key === teamKey) return tuple;
        }
        throw new AsOfResolveError(`${teamKey}'s segment at ${eventKey} begins at or before the cut but its LOG holds no row for it there`);
      }
      const p = segment.p;
      if (p === null || asOfAtOrBefore(p[0], [p[1], p[2]], cut)) return segment.s;
      current = this.segmentEndingAt(teamKey, p[0], p[2]);
    }
    throw new AsOfResolveError(`${teamKey} did not resolve within 10,000 steps`);
  }

  league(): AsOfLeagueTuple | undefined {
    const { cut, season } = this.input;
    if (isAsOfSeasonStart(cut)) return season.L0 ?? undefined;
    const index = this.index(cut.eventKey);
    if (index === PENDING) return undefined;
    if (index === null) throw new AsOfResolveError(`the cut's event ${cut.eventKey} has no published INDEX`);
    if (cut.i === -1) {
      if (index.lb === undefined) throw new AsOfResolveError(`the cut is before ${cut.eventKey}'s first row and its INDEX carries no lb`);
      return index.lb;
    }
    for (const keyed of [index.lq, index.le]) {
      if (keyed !== null && keyed.k[1] === cut.i && keyed.k[0] === cut.t) return keyed.L;
    }
    const log = this.log(cut.eventKey);
    if (log === PENDING) return undefined;
    const row = log.rows[cut.i];
    if (row === undefined || row.t !== cut.t) throw new AsOfResolveError(`the cut row ${cut.eventKey}[${cut.i}] at ${cut.t} is not in its LOG`);
    return row.L;
  }
}

/**
 * Resolves every team in `input.teams` (plus the demo pseudo team when any is
 * a demo key) and the league at `input.cut`. See this file's header.
 */
export function resolveAsOf(input: AsOfResolveInput): AsOfResolveResult {
  const requests = new Map<string, Set<string>>();
  for (const team of input.teams) {
    const known = requests.get(team.teamKey) ?? new Set<string>();
    for (const eventKey of team.knownEventKeys) known.add(eventKey);
    requests.set(team.teamKey, known);
  }
  const demoEvents = new Set<string>();
  for (const [teamKey, known] of requests) if (isDemoTeamKey(teamKey)) for (const eventKey of known) demoEvents.add(eventKey);
  if ([...requests.keys()].some((teamKey) => isDemoTeamKey(teamKey))) {
    const known = requests.get(DEMO_PSEUDO_TEAM_KEY) ?? new Set<string>();
    for (const eventKey of demoEvents) known.add(eventKey);
    requests.set(DEMO_PSEUDO_TEAM_KEY, known);
  }

  const resolver = new Resolver(input);
  const states = new Map<string, AsOfTeamTuple>();
  for (const [teamKey, known] of requests) {
    const tuple = resolver.team(teamKey, [...known]);
    if (tuple !== PENDING) states.set(teamKey, tuple);
  }
  const league = resolver.league();
  return {
    states,
    league,
    missingIndexes: [...resolver.missingIndexes].sort(),
    missingLogs: [...resolver.missingLogs].sort(),
    missingStart: resolver.missingStart,
  };
}

/**
 * The cut at a played match: the row the match occupies in its event's INDEX.
 * `undefined` when the match is not in that INDEX (not folded, or another event's).
 */
export function asOfCutAtMatch(index: AsOfIndex, matchKey: string): AsOfCut | undefined {
  const i = index.m.findIndex(([key]) => key === matchKey);
  if (i < 0) return undefined;
  return { eventKey: index.eventKey, t: index.m[i]![1], i };
}

/**
 * The cut JUST BEFORE a folded match, in the event's own fold order: the row
 * before it (`i - 1`, an exact instant: everything at or before that row in
 * the season stream), or, for the event's first row, `i` of -1 at the
 * match's own time, which is everything strictly before it in the season
 * stream and prices its league from the INDEX's `lb`. `undefined` when the
 * match is not in the INDEX.
 *
 * The two cases are both exact, but not the same instant relative to other
 * events: a cut at row `i - 1` stops at that row, so another event's rows
 * between it and the match are not in it. Neither the INDEX nor the LOG names
 * the season's last row before an event's later row, so that instant cannot be
 * rebuilt from published objects; the row before is the closest exact one.
 */
export function asOfCutBeforeMatch(index: AsOfIndex, matchKey: string): AsOfCut | undefined {
  const at = asOfCutAtMatch(index, matchKey);
  if (at === undefined) return undefined;
  if (at.i === 0) return { eventKey: at.eventKey, t: at.t, i: -1 };
  return { eventKey: at.eventKey, t: index.m[at.i - 1]![1], i: at.i - 1 };
}
