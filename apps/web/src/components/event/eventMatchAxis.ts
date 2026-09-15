import { padAxisDomain, type AxisDomain } from "../team/matchAxis.js";
import { isPricedUpcomingRow, type EventPageArtifact } from "../../lib/eventPricing.js";

/**
 * Pure module, no React import — the event-scoped sibling of
 * `../team/matchAxis.ts`, holding the machinery `QualsTab`, `ElimsTab` and
 * `AlliancesTab` all share: the normalized merged row type, the client-side
 * merge of `matches[]`/`upcoming[]` (the wire shape stays split so the rank
 * simulation reads `upcoming[]` unchanged), the total-order comparator, the
 * comp-level predicates, and the per-tab axis domain.
 */

export type EventMatch = EventPageArtifact["matches"][number];
/** A priced upcoming row or, since the live Worker stopped pricing (260915-isq), a schedule-only one the browser could not price. */
export type EventUpcomingMatch = EventPageArtifact["upcoming"][number];
export type EventCompLevel = EventMatch["compLevel"];

/**
 * One event-scoped match row, normalized from either `EventMatch` or
 * `EventUpcomingMatch`. `played` is set from which source array the row came
 * from — the fact that is actually known — and never inferred from the
 * presence of an actual score. The optional
 * `redMatchBandVariance`/`blueMatchBandVariance` pair carries the published
 * Match Band variance directly — the row reads it verbatim rather than
 * relabelling it into a second field name. `sortTime` carries the published
 * epoch-seconds key verbatim, optional for the pre-republish window, and is
 * never defaulted, coerced or synthesized at any point — this type is where
 * a well-meaning default would be easiest to add and hardest to notice.
 */
export interface EventMatchRow {
  matchKey: string;
  compLevel: EventCompLevel;
  setNumber: number;
  matchNumber: number;
  redTeams: readonly string[];
  blueTeams: readonly string[];
  /**
   * The four prediction fields. Always present on a played row and on a
   * priced upcoming row; all four absent on a schedule-only upcoming row the
   * browser could not price (260915-m4j). Read them through `rowPrediction`,
   * which yields all four or none, never a partial set.
   */
  predictedWinner?: "red" | "blue";
  pRedWin?: number;
  predictedRedScore?: number;
  predictedBlueScore?: number;
  /**
   * The published Match Band variance: the number of robots on the alliance
   * times the sum of their squared Sigma Scores. Sigma algorithms (SPR) only;
   * absent for OPR and EPA, and absent on stale artifacts that carry only the
   * retired pre-rename band keys. Display band only, never the win-odds
   * variance.
   */
  redMatchBandVariance?: number;
  blueMatchBandVariance?: number;
  sortTime?: number;
  played: boolean;
  actualWinner?: "red" | "blue" | "tie";
  actualRedScore?: number;
  actualBlueScore?: number;
  /**
   * True iff this played match was a cold start (every one of its six robots
   * making its corpus-global first appearance) — carried verbatim from
   * `EventMatchSchema.coldStart`. Never set for an unplayed row:
   * `EventUpcomingMatchSchema` publishes no such field, matching this row
   * type's existing played-only fields (`actualWinner`, `video`) just above.
   */
  coldStart?: true;
  /**
   * The per-bonus RP fields, carried verbatim from whichever source row
   * published them (`TeamSeasonMatchSchema.redBonusRp` and
   * `.actualRedBonusRp` document the positional-alignment and three-state
   * contracts). All optional — an artifact predating the fields simply leaves
   * them absent, and the dots render `unknown`.
   */
  redBonusRp?: readonly number[];
  blueBonusRp?: readonly number[];
  actualRedBonusRp?: readonly boolean[] | null;
  actualBlueBonusRp?: readonly boolean[] | null;
  /**
   * The raw video key carried verbatim from `EventMatchSchema.video`, absent
   * for an unplayed row by construction — `EventUpcomingMatchSchema`
   * publishes no such field, so copying it unconditionally in `toRow` would
   * be reading a field that cannot exist.
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
 * than as "not `qm`" — so a competition level added to the published enum in
 * a future season does not silently classify itself as an elimination match.
 */
export function isElimCompLevel(compLevel: EventCompLevel): boolean {
  return compLevel === "ef" || compLevel === "qf" || compLevel === "sf" || compLevel === "f";
}

/**
 * A two-stage comparator with the same shape `packages/corpus/db.ts`'s
 * `selectMatchesChronological` and `publish.ts`'s `sortTeamSeasonMatches`
 * both already use — published time first, bracket chain beneath it.
 *
 * Step 1: compare timestamp presence. When one row carries `sortTime` and the
 * other does not, the row that carries it sorts first. This step exists for
 * correctness, not tidiness: comparing timestamp values only when both rows
 * happen to carry one, without this leading presence split, is
 * non-transitive. A timed row and an untimed row would be ordered by their
 * bracket position while two timed rows are ordered by time, and those two
 * verdicts can contradict each other across three rows. An inconsistent
 * comparator does not throw in V8 — it silently returns an order that varies
 * with input arrangement, which would destroy the total-order property
 * `mergeEventMatches` depends on. Splitting the rows into a timed class and
 * an untimed class first makes each class internally total and the whole
 * comparator consistent.
 *
 * Step 2: when both rows carry `sortTime` and the values differ, order by
 * ascending time.
 *
 * Step 3: when both times are equal, or when neither row has one, fall
 * through to the chain: comp-level rank, then `setNumber`, then
 * `matchNumber`, then `matchKey` compared with `localeCompare`. The chain is
 * retained rather than replaced because the timestamp is not total on its
 * own: the corpus carries many groups of elimination matches sharing an
 * identical `sort_time`. Because the chain ends in a comparison over a unique
 * key, the whole comparator remains a total order.
 *
 * This leading comparison closes a real correctness finding: a
 * bracket-chain-only comparator is wall-clock play order for a
 * single-match-per-round bracket but series-major for a best-of-three
 * bracket, where the chain alone would interleave two different series'
 * matches instead of playing one series through before the next.
 *
 * Implemented as an explicit branch on field presence, never a sentinel — no
 * infinity substitute, no zero substitute, no current clock reading, no time
 * parsed out of the match key, since these row objects are handed to the
 * renderer and a substituted number could reach a cell.
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
  // A schedule-only row carries no prediction: its keys stay ABSENT (never
  // undefined-valued), and no number is fabricated for it.
  if (!played && !isPricedUpcomingRow(match as EventUpcomingMatch)) {
    return {
      matchKey: match.matchKey,
      compLevel: match.compLevel,
      setNumber: match.setNumber,
      matchNumber: match.matchNumber,
      redTeams: match.redTeams,
      blueTeams: match.blueTeams,
      sortTime: match.sortTime,
      played,
    };
  }
  const priced = match as EventMatch | Extract<EventUpcomingMatch, { pRedWin: number }>;
  const row: EventMatchRow = {
    matchKey: priced.matchKey,
    compLevel: priced.compLevel,
    setNumber: priced.setNumber,
    matchNumber: priced.matchNumber,
    redTeams: priced.redTeams,
    blueTeams: priced.blueTeams,
    predictedWinner: priced.predictedWinner,
    pRedWin: priced.pRedWin,
    predictedRedScore: priced.predictedRedScore,
    predictedBlueScore: priced.predictedBlueScore,
    redMatchBandVariance: priced.redMatchBandVariance,
    blueMatchBandVariance: priced.blueMatchBandVariance,
    sortTime: priced.sortTime,
    // Both source schemas publish the predicted per-bonus marginals; copied
    // verbatim, never defaulted (absent stays absent).
    redBonusRp: priced.redBonusRp,
    blueBonusRp: priced.blueBonusRp,
    played,
  };
  if (played) {
    const playedMatch = match as EventMatch;
    row.actualWinner = playedMatch.actualWinner;
    row.actualRedScore = playedMatch.actualRedScore;
    row.actualBlueScore = playedMatch.actualBlueScore;
    row.actualRedBonusRp = playedMatch.actualRedBonusRp;
    row.actualBlueBonusRp = playedMatch.actualBlueBonusRp;
    row.coldStart = playedMatch.coldStart;
    // Played-only, matching this branch's other played-only fields above —
    // EventUpcomingMatchSchema has no `video` key.
    row.video = playedMatch.video;
  }
  return row;
}

/**
 * Filters both input arrays by `includeCompLevel`, normalizes each survivor
 * into an `EventMatchRow`, collapses any `matchKey` appearing in both arrays
 * to the played row — an actual result supersedes a schedule entry — and
 * returns the survivors sorted by `compareEventMatchRows`. Mutates neither
 * input array.
 *
 * The artifact keeps `matches[]` and `upcoming[]` separate on the wire
 * exactly as published so the rank simulation reads `upcoming[]` unchanged,
 * and this function is the browser-side interleave used instead of a
 * schema-level merge.
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
  // Played rows are applied second so a shared matchKey collapses to the
  // played row — an actual result supersedes a schedule entry.
  for (const match of matches) {
    if (!includeCompLevel(match.compLevel)) continue;
    byMatchKey.set(match.matchKey, toRow(match, true));
  }

  // The band is the published Match Band, computed once at publish time (and
  // live by the Worker, through the same helper) as the number of robots on
  // the alliance times the sum of their squared Sigma Scores, and attached to
  // the one record both the event artifact and the team artifact are built
  // from. So this reads it rather than deriving it, and a match's band is
  // byte-identical on both pages by construction.
  //
  // It is published for Sigma algorithms (SPR) only. OPR and EPA rows carry no
  // band and draw none. Only the new keys are read, with no fallback to the
  // retired pre-rename band keys, so a stale artifact renders no band rather
  // than an old, too-narrow one.
  return [...byMatchKey.values()].sort(compareEventMatchRows);
}

/** The four prediction fields of a row, present together. */
export interface RowPrediction {
  predictedWinner: "red" | "blue";
  pRedWin: number;
  predictedRedScore: number;
  predictedBlueScore: number;
}

/**
 * A row's prediction when all four fields are present, else `undefined` (a
 * schedule-only row the browser could not price). Presence is checked with
 * `!== undefined`, never truthiness: a win probability or a score can be 0.
 */
export function rowPrediction(row: Pick<EventMatchRow, "predictedWinner" | "pRedWin" | "predictedRedScore" | "predictedBlueScore">): RowPrediction | undefined {
  if (row.predictedWinner === undefined || row.pRedWin === undefined || row.predictedRedScore === undefined || row.predictedBlueScore === undefined) {
    return undefined;
  }
  return { predictedWinner: row.predictedWinner, pRedWin: row.pRedWin, predictedRedScore: row.predictedRedScore, predictedBlueScore: row.predictedBlueScore };
}

/**
 * The per-tab score domain: walks the rows once, considering each row's two
 * predicted scores; each alliance's band extents where that alliance's
 * variance field is present (predicted score plus and minus the square root
 * of the variance, clamped at zero below); and each actual score where
 * present. Delegates to `padAxisDomain` for the padding/floor policy shared
 * with the team page's `computeAxisDomain` — mirrors that function's own
 * treatment of an absent variance, which is to contribute the point value
 * rather than a zero-width band around it.
 */
export function computeEventAxisDomain(rows: readonly EventMatchRow[]): AxisDomain {
  // Tracked as `undefined` rather than an infinity sentinel — this loop
  // gathers real score extents (a different job from the comparator's
  // sortTime handling above), so the "no observation yet" state is
  // represented by absence instead.
  let min: number | undefined;
  let max: number | undefined;

  const consider = (value: number): void => {
    if (min === undefined || value < min) min = value;
    if (max === undefined || value > max) max = value;
  };

  for (const row of rows) {
    // An unpriced row contributes no predicted score and no band: there is
    // nothing to place on the axis, and no fabricated position is drawn.
    const prediction = rowPrediction(row);
    if (prediction !== undefined) {
      consider(prediction.predictedRedScore);
      consider(prediction.predictedBlueScore);

      const redSd = row.redMatchBandVariance !== undefined ? Math.sqrt(Math.max(0, row.redMatchBandVariance)) : 0;
      const blueSd = row.blueMatchBandVariance !== undefined ? Math.sqrt(Math.max(0, row.blueMatchBandVariance)) : 0;
      consider(prediction.predictedRedScore - redSd);
      consider(prediction.predictedRedScore + redSd);
      consider(prediction.predictedBlueScore - blueSd);
      consider(prediction.predictedBlueScore + blueSd);
    }

    if (row.actualRedScore !== undefined) consider(row.actualRedScore);
    if (row.actualBlueScore !== undefined) consider(row.actualBlueScore);
  }

  // `padAxisDomain` itself treats a non-finite input as "no observation yet"
  // and returns its own safe fallback domain — `undefined` coerces to `NaN`
  // here, which is not finite, so the zero-rows case is handled identically
  // to `computeAxisDomain`'s own not-finite fallback.
  return padAxisDomain(min as number, max as number);
}
