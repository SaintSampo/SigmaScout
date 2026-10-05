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
 * THE WALK, per team. A known segment that STRADDLES the cut (begins at or
 * before it, ends after it) answers at once from its own event's LOG. Else
 * start from the team's earliest segment, among the caller's known events,
 * that begins after the cut; with none, from the segment its season tail ends,
 * unless an INDEX in hand holds a segment for the team at or after the tail
 * (the season object is written after the INDEX, so its copy can be behind,
 * and the INDEX wins). Then:
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
 * OBJECTS OF DIFFERENT AGES. A browser holds each object under its own cache
 * lifetime, so a LOG can be older than its INDEX and a season object older or
 * newer than an INDEX. Nothing is answered from an object that is behind the
 * one that named a row in it: a tail or `p` naming a row the INDEX copy does
 * not hold reports `staleIndexes` (and `staleSeason` when the INDEX holds the
 * row for other teams), and a LOG copy shorter than, or out of step with, the
 * rows its INDEX names at or before the cut reports `staleLogs`. A team that
 * met one is left unresolved; the caller refetches those objects fresh and
 * calls again, and reads the stop as unavailable only if they are still out
 * of step. A LOG is never read for a tuple it might be missing.
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
  /**
   * INDEX objects whose copy in hand is behind (or out of step with) another
   * object the walk read: a tail or a `p` names a row it does not hold, or it
   * lacks the cut's own row. Sorted. A team that met one is NOT resolved; the
   * caller refetches these fresh (bypassing every cache it controls) and
   * calls again.
   */
  readonly staleIndexes: string[];
  /** LOG objects whose copy in hand is shorter than, or out of step with, the rows its INDEX names at or before the cut. Sorted; as `staleIndexes`. */
  readonly staleLogs: string[];
  /** Whether the season object's tail named a row its INDEX holds for some other team: the season object is out of step and is refetched too. */
  readonly staleSeason: boolean;
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
/** The marker a step returns when an object in hand is out of step with another (recorded as stale). */
const STALE = Symbol("stale");

class Resolver {
  readonly missingIndexes = new Set<string>();
  readonly missingLogs = new Set<string>();
  missingStart = false;
  readonly staleIndexes = new Set<string>();
  readonly staleLogs = new Set<string>();
  staleSeason = false;

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

  /**
   * The segment of `teamKey` at `eventKey` holding row `i`, or `PENDING`, or
   * `STALE`. A tail or a `p` names a segment's LAST row in objects written
   * together; a segment that runs past `i` means this INDEX copy is newer than
   * the object that named the row, and the INDEX wins (its segment holds every
   * row the walk reads from it: `f`, `s`, `p`, and LOG rows at or before a cut
   * that `i` is already after). No segment holding `i` means this copy is
   * behind the object that named it (or, with the row present, out of step
   * with it): stale, never a guess.
   */
  segmentHolding(teamKey: string, eventKey: string, i: number, fromTail: boolean): Located | typeof PENDING | typeof STALE {
    const index = this.index(eventKey);
    if (index === PENDING) return PENDING;
    if (index === null) throw new AsOfResolveError(`${teamKey}'s walk needs ${eventKey}'s INDEX, which is not published`);
    const segment = index.teams[teamKey]?.find((candidate) => candidate.f[1] <= i && i <= candidate.l[1]);
    if (segment !== undefined) return { eventKey, segment };
    this.staleIndexes.add(eventKey);
    // The INDEX holds the row, for other teams: the season object is the one out of step.
    if (fromTail && i < index.m.length) this.staleSeason = true;
    return STALE;
  }

  /**
   * The team's LOG row at the cut inside a segment that begins at or before it
   * and ends after it: its last row there at or before the cut. Every row read
   * is checked against the INDEX in hand, so a LOG copy shorter than (or out
   * of step with) the rows its INDEX names there is reported stale, never read.
   */
  fromLog(teamKey: string, eventKey: string, segment: AsOfSegment): AsOfTeamTuple | typeof PENDING | typeof STALE {
    const { cut } = this.input;
    const index = this.input.indexes.get(eventKey);
    if (index === undefined || index === null) throw new AsOfResolveError(`${teamKey}'s segment at ${eventKey} was read from an INDEX that is no longer in hand`);
    const log = this.log(eventKey);
    if (log === PENDING) return PENDING;
    for (let i = segment.l[1]; i >= segment.f[1]; i--) {
      const m = index.m[i];
      if (m === undefined) {
        // The INDEX names a segment past its own rows: malformed, so refetch it.
        this.staleIndexes.add(eventKey);
        return STALE;
      }
      if (!asOfAtOrBefore(eventKey, [m[1], i], cut)) continue;
      const row = log.rows[i];
      if (row === undefined || row.k !== m[0]) {
        this.staleLogs.add(eventKey);
        return STALE;
      }
      for (const [key, tuple] of row.tm) if (key === teamKey) return tuple;
    }
    // Row `f` always carries the team; a LOG that does not is out of step with its INDEX.
    this.staleLogs.add(eventKey);
    return STALE;
  }

  /**
   * The team's latest segment among every INDEX in hand, by its last row: the
   * evidence a walk from the season tail must not ignore when the season
   * object is behind an INDEX (`applyAsOfFold` writes the INDEX first).
   */
  latestSegment(teamKey: string): Located | undefined {
    let latest: Located | undefined;
    for (const [eventKey, index] of this.input.indexes) {
      const segments = index?.teams[teamKey];
      const last = segments?.[segments.length - 1];
      if (last === undefined) continue;
      if (latest === undefined || compareAsOfPositions(eventKey, last.l, latest.eventKey, latest.segment.l) > 0) latest = { eventKey, segment: last };
    }
    return latest;
  }

  /** One team's tuple at the cut, or `PENDING`, or `STALE`. */
  team(teamKey: string, knownEventKeys: readonly string[]): AsOfTeamTuple | typeof PENDING | typeof STALE {
    const { cut, season } = this.input;

    // A KNOWN SEGMENT THAT STRADDLES THE CUT holds the answer: a segment is a
    // run of the team's consecutive matches, so nothing it played elsewhere
    // falls between its first row and its last, and the team's last row there
    // at or before the cut is its state at the cut. Read from that event's own
    // LOG, with no walk through any other event.
    for (const eventKey of knownEventKeys) {
      const index = this.input.indexes.get(eventKey);
      if (index === undefined || index === null) continue;
      for (const segment of index.teams[teamKey] ?? []) {
        if (asOfAtOrBefore(eventKey, segment.f, cut) && !asOfAtOrBefore(eventKey, segment.l, cut)) return this.fromLog(teamKey, eventKey, segment);
      }
    }

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

    let current: Located | typeof PENDING | typeof STALE;
    if (start !== undefined) {
      current = start;
    } else {
      // THE TAIL, unless an INDEX in hand holds a segment for the team at or
      // after it: the season object is written after the INDEX, so a copy of
      // it can be behind, and the INDEX wins. With objects written together
      // the latest segment IS the tail's, so nothing changes.
      const tail = season.tails[teamKey];
      const latest = this.latestSegment(teamKey);
      if (latest !== undefined && (tail === undefined || compareAsOfPositions(latest.eventKey, latest.segment.l, tail[0], [tail[1], tail[2]]) >= 0)) current = latest;
      else if (tail === undefined) return this.startTuple(teamKey);
      else current = this.segmentHolding(teamKey, tail[0], tail[2], true);
    }

    // A walk visits each of the team's segments at most once, and a season holds far fewer than this.
    for (let guard = 0; guard < 10_000; guard++) {
      if (current === PENDING || current === STALE) return current;
      const { eventKey, segment } = current;
      if (asOfAtOrBefore(eventKey, segment.f, cut)) {
        if (asOfAtOrBefore(eventKey, segment.l, cut)) return segment.x;
        return this.fromLog(teamKey, eventKey, segment);
      }
      const p = segment.p;
      if (p === null || asOfAtOrBefore(p[0], [p[1], p[2]], cut)) return segment.s;
      current = this.segmentHolding(teamKey, p[0], p[2], false);
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
    const m = index.m[cut.i];
    if (m === undefined || m[1] !== cut.t) {
      // The cut was read from a newer copy of this INDEX than the one in hand.
      this.staleIndexes.add(cut.eventKey);
      return undefined;
    }
    for (const keyed of [index.lq, index.le]) {
      if (keyed !== null && keyed.k[1] === cut.i && keyed.k[0] === cut.t) return keyed.L;
    }
    const log = this.log(cut.eventKey);
    if (log === PENDING) return undefined;
    const row = log.rows[cut.i];
    if (row === undefined || row.k !== m[0] || row.t !== cut.t) {
      this.staleLogs.add(cut.eventKey);
      return undefined;
    }
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
    if (tuple !== PENDING && tuple !== STALE) states.set(teamKey, tuple);
  }
  const league = resolver.league();
  return {
    states,
    league,
    missingIndexes: [...resolver.missingIndexes].sort(),
    missingLogs: [...resolver.missingLogs].sort(),
    missingStart: resolver.missingStart,
    staleIndexes: [...resolver.staleIndexes].sort(),
    staleLogs: [...resolver.staleLogs].sort(),
    staleSeason: resolver.staleSeason,
  };
}

/** Whether a result reports any object out of step: its caller refetches those fresh before trusting the answer. */
export function asOfResultIsStale(result: Pick<AsOfResolveResult, "staleIndexes" | "staleLogs" | "staleSeason">): boolean {
  return result.staleIndexes.length > 0 || result.staleLogs.length > 0 || result.staleSeason;
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
