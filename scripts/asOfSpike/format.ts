/**
 * MEASUREMENT ONLY (quick task 261005-5g0 spike). The proposed wire format for
 * per-fold as-of state, shared by the capture (Node) and the lookup (browser
 * safe). Types and pure helpers only: no imports, no Node built-ins.
 */

/** `[muL, pL, muS, pS]`. */
export type SprPart = [number, number, number, number];
/** `[meanWeight, mean, varWeight, sumSquares, talent]`. */
export type SigmaPart = [number, number, number, number, number];
/** `[weight, weightSquares, mean, m2]` for one threshold variable. */
export type RpVarPart = [number, number, number, number];
/** One team's whole compact state: each part `null` when the model holds none. */
export type TeamTuple = [SprPart | null, SigmaPart | null, (RpVarPart | null)[] | null];
/** `[logTau, scale, sigPopSumSquares, sigPopTalentSquares, sigPopCount, (n, mean, m2) x V, (count, sum) x V]`. */
export type LeagueTuple = number[];

export const UNSEEN_TEAM: TeamTuple = [null, null, null];

export interface IndexTeamEntry {
  /** sort_time of the team's first match at this event. */
  f: number;
  /** sort_time of the team's last match at this event. */
  l: number;
  /** `[previous event key, sort_time of the team's last match there]`, or `null` when this is its first event of the season. */
  p: [string, number] | null;
  /** The team's tuple BEFORE its first match here. */
  s: TeamTuple;
  /** The team's tuple AFTER its last match here. */
  x: TeamTuple;
}

export interface EventIndex {
  v: 1;
  eventKey: string;
  season: number;
  algorithmId: string;
  algorithmVersion: string;
  vars: string[];
  /** Row count of this event's log. */
  n: number;
  first: number;
  last: number;
  /** League after the last QUALIFICATION match folded here, or `null` when the event has none. */
  lq: { t: number; L: LeagueTuple } | null;
  /** League after the last match folded here. */
  le: { t: number; L: LeagueTuple };
  teams: Record<string, IndexTeamEntry>;
}

export interface LogRow {
  /** Match key. */
  k: string;
  /** sort_time. */
  t: number;
  /** League tuple after this match. */
  L: LeagueTuple;
  /** One `[teamKey, tuple after this match]` per team in the match. */
  tm: [string, TeamTuple][];
}

export interface EventLog {
  v: 1;
  eventKey: string;
  season: number;
  algorithmId: string;
  algorithmVersion: string;
  vars: string[];
  rows: LogRow[];
}

export interface SeasonStart {
  season: number;
  L0: LeagueTuple;
}

export type SeasonTails = Record<string, string>;

/**
 * A position in the season stream: the row at `(t, eventKey, rowIndex)` and
 * everything before it. The season-start cut precedes every row.
 */
export interface Cut {
  readonly t: number;
  readonly eventKey: string;
  readonly rowIndex: number;
}

export const SEASON_START_CUT: Cut = { t: -Infinity, eventKey: "", rowIndex: -1 };

export function isSeasonStartCut(cut: Cut): boolean {
  return cut.t === -Infinity;
}

/**
 * Whether a row of ANOTHER event (or of the cut's own event when `rowIndex` is
 * given) is at or before the cut. Stream order is `(sort_time, event_key, play
 * order)`, and within one event rows are in fold order.
 */
export function atOrBefore(t: number, eventKey: string, cut: Cut, rowIndex?: number): boolean {
  if (eventKey === cut.eventKey && rowIndex !== undefined) return rowIndex <= cut.rowIndex;
  if (t < cut.t) return true;
  if (t > cut.t) return false;
  if (eventKey < cut.eventKey) return true;
  if (eventKey > cut.eventKey) return false;
  // Same event, same time, no row index supplied: undecidable from a time alone. The caller reads the log.
  return false;
}
