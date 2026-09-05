import { padAxisDomain, type AxisDomain } from "../team/matchAxis.js";
import type { EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * Pure module, no React import (07-12-PLAN.md Task 1, D-12/D-13) — the
 * event-scoped sibling of `../team/matchAxis.ts`, holding the machinery
 * `QualsTab` (this plan), `ElimsTab` (07-13) and `AlliancesTab` (07-14) all
 * share: the normalized merged row type, the D-13 client-side merge of
 * `matches[]`/`upcoming[]` (the wire shape stays split so Phase 8's rank
 * simulation reads `upcoming[]` unchanged), the total-order comparator, the
 * comp-level predicates, and the D-12 per-tab axis domain.
 */

export type EventMatch = EventArtifact["matches"][number];
export type EventUpcomingMatch = EventArtifact["upcoming"][number];
export type EventCompLevel = EventMatch["compLevel"];

/**
 * One event-scoped match row, normalized from EITHER `EventMatch` or
 * `EventUpcomingMatch` (07-12-PLAN.md Decision 1). `played` is set from
 * WHICH SOURCE ARRAY the row came from — the fact that is actually known —
 * and never inferred from the presence of an actual score. The optional
 * `redScoreVarianceOwn`/`blueScoreVarianceOwn` pair carries the exact two
 * field names `EventMatchSchema` and `TeamSeasonMatchSchema` both use, so
 * the event band and the team band are one quantity under one name (D-18
 * item 3, D-01). `sortTime` carries the published epoch-seconds key
 * verbatim, optional because 07-07 declared it optional for the
 * pre-republish window, and is NEVER defaulted, coerced or synthesized at
 * any point (07-08's T-07-08-13) — this type is where a well-meaning
 * default would be easiest to add and hardest to notice.
 */
export interface EventMatchRow {
  matchKey: string;
  compLevel: EventCompLevel;
  setNumber: number;
  matchNumber: number;
  redTeams: readonly string[];
  blueTeams: readonly string[];
  predictedWinner: "red" | "blue";
  pRedWin: number;
  predictedRedScore: number;
  predictedBlueScore: number;
  redScoreVarianceOwn?: number;
  blueScoreVarianceOwn?: number;
  sortTime?: number;
  played: boolean;
  actualWinner?: "red" | "blue" | "tie";
  actualRedScore?: number;
  actualBlueScore?: number;
  /**
   * Quick 260905-jj8: the per-bonus RP fields, carried verbatim from
   * whichever source row published them (`TeamSeasonMatchSchema.redBonusRp`
   * and `.actualRedBonusRp` document the positional-alignment and
   * three-state contracts). All optional — an artifact predating the fields
   * simply leaves them absent, and the dots render `unknown`.
   */
  redBonusRp?: readonly number[];
  blueBonusRp?: readonly number[];
  actualRedBonusRp?: readonly boolean[] | null;
  actualBlueBonusRp?: readonly boolean[] | null;
}

/**
 * Mirrors `packages/harness/publish.ts`'s `COMP_LEVEL_RANK` exactly — the
 * two must not drift. Ranks `qm` first, then `ef`, `qf`, `sf`, `f`.
 */
export const EVENT_COMP_LEVEL_RANK: Record<EventCompLevel, number> = { qm: 0, ef: 1, qf: 2, sf: 3, f: 4 };

/** Membership of `qm` alone — never the negation of `isElimCompLevel`. */
export function isQualCompLevel(compLevel: EventCompLevel): boolean {
  return compLevel === "qm";
}

/**
 * Membership of the closed set `ef`/`qf`/`sf`/`f`, stated explicitly rather
 * than as "not `qm`" — so a competition level added to the published enum
 * in a future season does not silently classify itself as an elimination
 * match on 07-13's tab.
 */
export function isElimCompLevel(compLevel: EventCompLevel): boolean {
  return compLevel === "ef" || compLevel === "qf" || compLevel === "sf" || compLevel === "f";
}

/**
 * A two-stage comparator with the same shape `packages/corpus/db.ts`'s
 * `selectMatchesChronological` and `publish.ts`'s `sortTeamSeasonMatches`
 * both already use — published time first, bracket chain beneath it.
 *
 * Step 1: compare timestamp PRESENCE. When one row carries `sortTime` and
 * the other does not, the row that CARRIES it sorts first. This step exists
 * for correctness, not tidiness: comparing timestamp values only when both
 * rows happen to carry one, without this leading presence split, is
 * NON-TRANSITIVE. A timed row and an untimed row would be ordered by their
 * bracket position while two timed rows are ordered by time, and those two
 * verdicts can contradict each other across three rows. An inconsistent
 * comparator does not throw in V8 — it silently returns an order that
 * varies with input arrangement, which would destroy the total-order
 * property `mergeEventMatches` depends on. Splitting the rows into a timed
 * class and an untimed class first makes each class internally total and
 * the whole comparator consistent. Sorting the untimed rows last also
 * matches `sortTeamSeasonMatches`' own documented treatment of a match
 * absent from its time map.
 *
 * Step 2: when both rows carry `sortTime` and the values differ, order by
 * ascending time.
 *
 * Step 3: when both times are equal, or when neither row has one, fall
 * through to the chain: comp-level rank, then `setNumber`, then
 * `matchNumber`, then `matchKey` compared with `localeCompare`. The chain is
 * retained rather than replaced because the timestamp is not total on its
 * own: the corpus carries 114 groups of elimination matches sharing an
 * identical `sort_time`, which is exactly why `selectMatchesChronological`
 * breaks its own timestamp ties with this same chain. Because the chain
 * ends in a comparison over a unique key, the whole comparator remains a
 * total order.
 *
 * This leading comparison closes a correctness finding 07-13 measured and
 * routed here: the bracket-chain-only comparator this plan originally
 * shipped is wall-clock play order for 2023-2026 but SERIES-MAJOR for a
 * 2022-style best-of-three bracket (`2022nhgrs` plays
 * `qf1m1 qf2m1 qf3m1 qf4m1 qf1m2 …` and the chain alone renders
 * `qf1m1 qf1m2 qf2m1 qf2m2 …`, moving 8 of 14 rows; corpus-wide 312 of
 * 1,342 events and 2,274 of 19,651 elimination rows).
 *
 * Implemented as an explicit branch on field presence, never a sentinel —
 * no infinity substitute, no zero substitute, no current clock reading, no
 * time parsed out of the match key (07-08's T-07-08-13, honored here by
 * construction: these row objects are handed to the renderer, so a
 * substituted number could reach a cell).
 */
export function compareEventMatchRows(a: EventMatchRow, b: EventMatchRow): number {
  const aHasTime = a.sortTime !== undefined;
  const bHasTime = b.sortTime !== undefined;

  if (aHasTime !== bHasTime) {
    return aHasTime ? -1 : 1;
  }

  if (aHasTime && bHasTime && a.sortTime !== b.sortTime) {
    return a.sortTime! - b.sortTime!;
  }

  const aRank = EVENT_COMP_LEVEL_RANK[a.compLevel];
  const bRank = EVENT_COMP_LEVEL_RANK[b.compLevel];
  if (aRank !== bRank) return aRank - bRank;
  if (a.setNumber !== b.setNumber) return a.setNumber - b.setNumber;
  if (a.matchNumber !== b.matchNumber) return a.matchNumber - b.matchNumber;
  return a.matchKey.localeCompare(b.matchKey);
}

function toRow(match: EventMatch, played: true): EventMatchRow;
function toRow(match: EventUpcomingMatch, played: false): EventMatchRow;
function toRow(match: EventMatch | EventUpcomingMatch, played: boolean): EventMatchRow {
  const row: EventMatchRow = {
    matchKey: match.matchKey,
    compLevel: match.compLevel,
    setNumber: match.setNumber,
    matchNumber: match.matchNumber,
    redTeams: match.redTeams,
    blueTeams: match.blueTeams,
    predictedWinner: match.predictedWinner,
    pRedWin: match.pRedWin,
    predictedRedScore: match.predictedRedScore,
    predictedBlueScore: match.predictedBlueScore,
    redScoreVarianceOwn: match.redScoreVarianceOwn,
    blueScoreVarianceOwn: match.blueScoreVarianceOwn,
    sortTime: match.sortTime,
    // Quick 260905-jj8: both source schemas publish the predicted per-bonus
    // marginals; copied verbatim, never defaulted (absent stays absent).
    redBonusRp: match.redBonusRp,
    blueBonusRp: match.blueBonusRp,
    played,
  };
  if (played) {
    const playedMatch = match as EventMatch;
    row.actualWinner = playedMatch.actualWinner;
    row.actualRedScore = playedMatch.actualRedScore;
    row.actualBlueScore = playedMatch.actualBlueScore;
    row.actualRedBonusRp = playedMatch.actualRedBonusRp;
    row.actualBlueBonusRp = playedMatch.actualBlueBonusRp;
  }
  return row;
}

/**
 * Filters both input arrays by `includeCompLevel`, normalizes each survivor
 * into an `EventMatchRow`, collapses any `matchKey` appearing in both arrays
 * to the PLAYED row — an actual result supersedes a schedule entry — and
 * returns the survivors sorted by `compareEventMatchRows`. Mutates neither
 * input array.
 *
 * D-13's own reasoning: the artifact keeps `matches[]` and `upcoming[]`
 * separate on the wire exactly as published so Phase 8's rank simulation
 * reads `upcoming[]` unchanged, and this function is the browser-side
 * interleave D-13 chose instead of a schema-level merge.
 */
export function mergeEventMatches(
  matches: readonly EventMatch[],
  upcoming: readonly EventUpcomingMatch[],
  includeCompLevel: (compLevel: EventCompLevel) => boolean
): EventMatchRow[] {
  const byMatchKey = new Map<string, EventMatchRow>();

  for (const match of upcoming) {
    if (!includeCompLevel(match.compLevel)) continue;
    byMatchKey.set(match.matchKey, toRow(match, false));
  }
  // Played rows are applied SECOND so a shared matchKey collapses to the
  // played row — an actual result supersedes a schedule entry.
  for (const match of matches) {
    if (!includeCompLevel(match.compLevel)) continue;
    byMatchKey.set(match.matchKey, toRow(match, true));
  }

  return [...byMatchKey.values()].sort(compareEventMatchRows);
}

/**
 * The per-tab score domain (D-12): walks the rows once, considering each
 * row's two predicted scores; each alliance's band extents where that
 * alliance's variance field is present (predicted score plus and minus the
 * square root of the variance, clamped at zero below); and each actual
 * score where present. Delegates to `padAxisDomain` for the padding/floor
 * policy shared with the team page's `computeAxisDomain` — mirrors that
 * function's own treatment of an absent variance, which is to contribute
 * the point value rather than a zero-width band around it.
 */
export function computeEventAxisDomain(rows: readonly EventMatchRow[]): AxisDomain {
  // Tracked as `undefined` rather than an infinity sentinel — this loop
  // gathers real score EXTENTS (a different job from the comparator's
  // sortTime handling above), but a literal infinity constant anywhere in
  // this module is exactly the shape this file's own no-fabricated-time
  // grep gate exists to flag, so the "no observation yet" state is
  // represented by absence instead.
  let min: number | undefined;
  let max: number | undefined;

  const consider = (value: number): void => {
    if (min === undefined || value < min) min = value;
    if (max === undefined || value > max) max = value;
  };

  for (const row of rows) {
    consider(row.predictedRedScore);
    consider(row.predictedBlueScore);

    const redSd = row.redScoreVarianceOwn !== undefined ? Math.sqrt(Math.max(0, row.redScoreVarianceOwn)) : 0;
    const blueSd = row.blueScoreVarianceOwn !== undefined ? Math.sqrt(Math.max(0, row.blueScoreVarianceOwn)) : 0;
    consider(row.predictedRedScore - redSd);
    consider(row.predictedRedScore + redSd);
    consider(row.predictedBlueScore - blueSd);
    consider(row.predictedBlueScore + blueSd);

    if (row.actualRedScore !== undefined) consider(row.actualRedScore);
    if (row.actualBlueScore !== undefined) consider(row.actualBlueScore);
  }

  // `padAxisDomain` itself treats a non-finite input as "no observation yet"
  // and returns its own safe fallback domain — `undefined` coerces to `NaN`
  // here, which is not finite, so the zero-rows case is handled identically
  // to `computeAxisDomain`'s own not-finite fallback.
  return padAxisDomain(min as number, max as number);
}
