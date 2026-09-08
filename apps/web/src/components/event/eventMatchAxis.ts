import { padAxisDomain, type AxisDomain } from "../team/matchAxis.js";
import { allianceBandVariance, teamSwingFactorsFromMatches, walkForwardBandVariances } from "../../lib/allianceBand.js";
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
  /** The SigmaScout-layer band (quick task 260908-5wd) — published for every algorithm, unlike the pair above. Absent until a republish lands. */
  redSwingBandVariance?: number;
  blueSwingBandVariance?: number;
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
  /**
   * Quick task 260906-7eu: the raw video key carried verbatim from
   * `EventMatchSchema.video`, absent for an unplayed row by construction —
   * `EventUpcomingMatchSchema` publishes no such field, so copying it
   * unconditionally in `toRow` would be reading a field that cannot exist.
   */
  video?: string;
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
    redSwingBandVariance: match.redSwingBandVariance,
    blueSwingBandVariance: match.blueSwingBandVariance,
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
    // Quick task 260906-7eu: played-only, matching this branch's other
    // played-only fields above — EventUpcomingMatchSchema has no `video` key.
    row.video = playedMatch.video;
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

  // Quick task 260908-5wd: the band becomes a property of the SITE rather than
  // of VPR. Both maps are built from the UNFILTERED `matches` array on purpose
  // — an Elims tab estimating swing from elimination matches alone would draw
  // a different quantity than the Quals tab beside it. See
  // `lib/allianceBand.ts` for the construction and its calibration.
  //
  // A PLAYED row gets its walk-forward band (only what was known before that
  // match); an UPCOMING row gets the full played history, which is walk-forward
  // for it by definition.
  const playedBands = walkForwardBandVariances(matches);
  const swingByTeam = teamSwingFactorsFromMatches(matches);
  const rows = [...byMatchKey.values()].map((row) => {
    const played = playedBands.get(row.matchKey);
    const red = played !== undefined ? played.red : allianceBandVariance(row.redTeams, swingByTeam);
    const blue = played !== undefined ? played.blue : allianceBandVariance(row.blueTeams, swingByTeam);
    // Precedence, and each step is load-bearing:
    //
    //   1. `redSwingBandVariance` — the SIGMASCOUT-LAYER band, published for
    //      EVERY algorithm since quick task 260908-5wd. Once a republish has
    //      landed this is always the answer, and because the pipeline attaches
    //      it to one shared record, the team page publishes the identical
    //      number for the same match.
    //   2. `redScoreVarianceOwn` — the ALGORITHM's own predictive variance, a
    //      different quantity and a different level. Kept ONLY as the
    //      pre-republish bridge: today's live artifacts have no swing field, and
    //      dropping to the browser band here while the team page still read this
    //      would make the two pages disagree during the migration window.
    //   3. The browser band — what OPR and EPA get before a republish, where
    //      neither field exists at all.
    //
    // Step 2 exists to be DELETED once every artifact carries step 1.
    //
    // A match must show the SAME uncertainty on a team page as on an event
    // page.
    //
    // The team page cannot compute this band. Measured on `frc254`'s 2026
    // artifact, the other teams in its matches appear a median of 2 times and
    // only 52.6% appear even twice, so per-team swing is not estimable there —
    // it reads the published field and always will. Overriding the published
    // value HERE therefore does not remove a disagreement, it creates one: for
    // BPR the same match read ±139 on the event page against ±76 on the team
    // page, a median ratio of 1.65 across 150 alliance-observations.
    //
    // The original reason for overriding was that VPR's published variance did
    // not reconcile with its teams' spreads (median 0.837). BPR's does — median
    // 1.02 — so with VPR retiring, the defect that justified the override is
    // retiring with it.
    //
    // Net effect: BPR and VPR show their published band on both pages, and OPR
    // and EPA — which publish nothing at either level — gain a browser band on
    // the event page where they previously had none.
    return {
      ...row,
      redScoreVarianceOwn: row.redSwingBandVariance ?? row.redScoreVarianceOwn ?? red,
      blueScoreVarianceOwn: row.blueSwingBandVariance ?? row.blueScoreVarianceOwn ?? blue,
    };
  });

  return rows.sort(compareEventMatchRows);
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
