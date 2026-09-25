/**
 * Measures the SELECTION MODEL against the real draft, before 10-04 builds on
 * it.
 *
 * ---------------------------------------------------------------------------
 * THE CLAUSE THIS DISCHARGES
 * ---------------------------------------------------------------------------
 *
 * 10-CONTEXT.md, "Alliance selection and captains": "The selection model's
 * agreement with actual pick order is measured on `event_alliances` in the
 * corpus before it ships and stated on the methodology page."
 *
 * ---------------------------------------------------------------------------
 * THE MODEL, IN TWO INDEPENDENTLY-SCORED PARTS
 * ---------------------------------------------------------------------------
 *
 *   THE PROGRESSIVE CAPTAIN RULE. At alliance `n`'s turn, the captain is the
 *   highest-ranked team not yet allied. The mechanic is real and not a fitted
 *   convenience: a top seed ACCEPTED as a higher alliance's first pick leaves
 *   the captain pool, and the next-highest unallied seed moves up into the
 *   vacated slot.
 *
 *   GREEDY BY PUBLISHED SPR for the first and second picks. The strength
 *   quantity is the published per-team `total` as of the end of that event's
 *   qualification matches, read through `scripts/publishedSprSnapshots.ts`,
 *   because that is the number a visitor's browser reads off the event
 *   artifact. Measuring against an internal rating would measure a different
 *   model.
 *
 * ---------------------------------------------------------------------------
 * THE NAIVE TOP-EIGHT RULE IS A LABELLED BASELINE, NEVER A FILTER
 * ---------------------------------------------------------------------------
 *
 * "The captains are the eight best-ranked teams" is carried here as a scored
 * BASELINE and is never used to gate an event, for a measured reason: the real
 * captain set equals qual ranks 1 through 8 at 3 of 491 eight-alliance district
 * events from 2023 through 2026. A gate on that equality would have skipped 488
 * events and reported an agreement rate computed over 3 — which is worse than
 * no number, because it looks like an answer.
 *
 * Captains here are SEEDED from the real `picks[0]`, whatever rank that team
 * holds. Never derived, never verified against a rank set, never a reason to
 * drop an event.
 *
 * ---------------------------------------------------------------------------
 * TEACHER FORCING, AND WHY
 * ---------------------------------------------------------------------------
 *
 * At each turn the model sees the REAL state of the draft so far and predicts
 * exactly one pick. Without it a single early miss invalidates every later turn
 * and the number measures CASCADE rather than the rule — a different quantity
 * reported under the right name.
 *
 * Every arm is reported against its own no-information floor: `1 / unalliedCount`
 * for a captain turn, `1 / availableCount` for a pick turn. An agreement rate
 * with no floor beside it has no scale.
 *
 * ---------------------------------------------------------------------------
 * TWO HALVES, TWO WINDOWS, TWO DENOMINATORS
 * ---------------------------------------------------------------------------
 *
 * The CAPTAIN half consumes no SPR and no replay — only `event_alliances` and
 * `event_rankings` — so it runs over the FULL 2023-plus window. The PICK-ORDER
 * half needs each team's published `total` at the qualification/playoff
 * boundary, which means a replay, so it runs over the narrower recorded window
 * that fits the node project's 30 s test timeout. Both windows are named in the
 * recorded command. Reporting one population's figure under the other's
 * denominator is the whole class of error this split exists to prevent.
 *
 * ---------------------------------------------------------------------------
 * DELIBERATELY NOT MEASURED HERE
 * ---------------------------------------------------------------------------
 *
 * No POINTS-LEVEL agreement: the selection point formulas are 10-01's file in
 * this same wave and 10-04 owns the joint that combines them.
 *
 * No DECLINES: `selectEventAlliancesForSeason` deliberately does not expose
 * `declines`. The decline the progressive rule cannot reproduce is COUNTED, not
 * absorbed — it shows up as a named miss in the captain block.
 *
 * ---------------------------------------------------------------------------
 * RELATIONSHIP TO 10-04
 * ---------------------------------------------------------------------------
 *
 * This script REPORTS the captain-rule figure (prints it, commits it as a
 * constant, hands it to 10-08). 10-04's `selectionModel.reconciliation.test.ts`
 * PINS the same figure, computed by the same rule on the same population: same
 * commitment schedule (predict, compare, then mark the real `picks[0]` and
 * `picks[1]` allied), same exclusion rule (an event carrying a rostered alliance
 * team with no `event_rankings` row), same denominators. If the two ever
 * disagree, one of them is measuring something else.
 *
 * ---------------------------------------------------------------------------
 * CREDENTIAL-FREE AND OFFLINE
 * ---------------------------------------------------------------------------
 *
 * Read-only corpus, no network request, no environment variable, no credential.
 * Its `package.json` entry (`measure:selection-agreement`) deliberately omits
 * the `--env-file=.env` flag that `ingest:*` and `publish:*` carry.
 *
 * Usage:
 *   npx tsx scripts/measureSelectionAgreement.ts [--captain-seasons 2023-2026] [--seasons 2026] [--warmup-from 2026] [--json]
 *   pnpm measure:selection-agreement
 */

import { pathToFileURL } from "node:url";
import {
  openCorpusReadOnly,
  selectEventAlliancesForSeason,
  selectEventRankingsForSeason,
  type Corpus,
  type EventAllianceSelection,
} from "../packages/corpus/db.js";
import { replayPublishedSprSnapshots } from "./publishedSprSnapshots.js";
import { parseSeasons } from "./scriptHelpers.js";

const CORPUS_PATH = "data/corpus.sqlite";

/** The alliance count this measurement scores. Everything else is counted out under its own name. */
export const SCORED_ALLIANCE_COUNT = 8;

// ═══════════════════════════════════════════════════════════════════════════
// RECORDED CONSTANTS
//
// What the committed script PRINTED on the date below, over the windows below.
// Never edited after being seen: changing the rule means re-running the
// command. The corpus-guarded describe in `measureSelectionAgreement.test.ts`
// re-measures both halves and asserts the captain figures by INTEGER EQUALITY
// (that half is pure SQL and integer arithmetic, so a tolerance would only hide
// a real change) and the pick-order figures within 1e-4.
//
// 10-04's reconciliation pins the captain figures; 10-08 quotes them.
// ═══════════════════════════════════════════════════════════════════════════

/** The CAPTAIN half's window — no SPR, no replay, so the full range is affordable. */
export const MEASURED_CAPTAIN_WINDOW = "2023-2026";
/** The PICK-ORDER half's window — needs a replay, so it is narrow enough for the 30 s node timeout. */
export const MEASURED_PICK_ORDER_WINDOW = "2026";
/** The pick-order half's warmup season. Equal to the scored season, i.e. no earlier warmup. */
export const MEASURED_PICK_ORDER_WARMUP_FROM = 2026;
/** The exact command that produced every recorded constant below. */
export const MEASURED_COMMAND =
  "npx tsx scripts/measureSelectionAgreement.ts --captain-seasons 2023-2026 --seasons 2026 --warmup-from 2026";
/** The date that command was run. */
export const MEASURED_DATE = "2026-09-25";

/** Eight-alliance district events in the captain window, before any exclusion. */
export const MEASURED_EIGHT_ALLIANCE_EVENTS = 491;
/** Events scored by the captain arms, after the unranked-roster-team exclusion. */
export const MEASURED_USABLE_EVENTS = 485;
/** Events excluded because a rostered alliance team carries no `event_rankings` row. */
export const MEASURED_EVENTS_WITH_UNRANKED_ROSTER_TEAM = 6;
/** The event keys of those exclusions. */
export const MEASURED_EXCLUDED_EVENT_KEYS: readonly string[] = [
  "2023gaalb",
  "2024vapor",
  "2025ncash",
  "2026mefal",
  "2026txfor",
  "2026txmca",
];
/** Captain slots scored — the denominator of both captain arms' per-slot figures. */
export const MEASURED_CAPTAIN_SLOTS = 3880;
/** Slots the PROGRESSIVE rule named correctly. */
export const MEASURED_PROGRESSIVE_CORRECT_SLOTS = 3879;
/** Events where the progressive rule named every captain correctly. */
export const MEASURED_PROGRESSIVE_PERFECT_EVENTS = 484;
/** Every slot the progressive rule missed, by event key and alliance number. */
export const MEASURED_PROGRESSIVE_MISSES: readonly string[] = ["2026milac alliance 8"];
/** Slots the NAIVE top-eight rule named correctly, over the same usable-event population. */
export const MEASURED_NAIVE_CORRECT_SLOTS = 976;
/** Events where the naive rule's captain SET equals the real captain set — a DIFFERENT denominator. */
export const MEASURED_NAIVE_SET_EQUAL_EVENTS = 3;
/** The denominator of the naive set-equality figure: every eight-alliance district event in the window. */
export const MEASURED_NAIVE_SET_EQUALITY_DENOMINATOR = 491;

/** Pick-order turns scored, pooled across both rounds. */
export const MEASURED_PICK_TURNS = 2256;
/** First-pick (round one) turns scored. */
export const MEASURED_FIRST_PICK_TURNS = 1128;
/** Second-pick (round two) turns scored. */
export const MEASURED_SECOND_PICK_TURNS = 1128;
/** Share of pooled turns where greedy-by-SPR named exactly the team the real alliance picked. */
export const MEASURED_EXACT_AGREEMENT = 0.3262411347517731;
/** Share of pooled turns where the real pick was in the model's top three. */
export const MEASURED_TOP3_AGREEMENT = 0.6050531914893617;
/** Exact agreement on first picks alone. */
export const MEASURED_FIRST_PICK_EXACT_AGREEMENT = 0.42907801418439717;
/** Exact agreement on second picks alone. */
export const MEASURED_SECOND_PICK_EXACT_AGREEMENT = 0.22340425531914893;
/** Mean 1-based position of the real pick inside the model's ordering. */
export const MEASURED_MEAN_MODEL_RANK = 4.097517730496454;
/** Median 1-based position of the real pick inside the model's ordering. */
export const MEASURED_MEDIAN_MODEL_RANK = 3;
/** 90th-percentile 1-based position of the real pick inside the model's ordering. */
export const MEASURED_P90_MODEL_RANK = 10;
/** The pooled no-information floor: the mean of `1 / availableCount` over the same turns. */
export const MEASURED_POOLED_COIN_FLOOR = 0.05901808119368394;
/** The first-pick and second-pick no-information floors, stated separately because the pools differ in size. */
export const MEASURED_FIRST_PICK_COIN_FLOOR = 0.03949582708257352;
/** See `MEASURED_FIRST_PICK_COIN_FLOOR`. */
export const MEASURED_SECOND_PICK_COIN_FLOOR = 0.07854033530479476;
/** Top-3 agreement on first picks alone. */
export const MEASURED_FIRST_PICK_TOP3_AGREEMENT = 0.7349290780141844;
/** Top-3 agreement on second picks alone. */
export const MEASURED_SECOND_PICK_TOP3_AGREEMENT = 0.475177304964539;
/** Events the pick-order half scored, after the boundary-SPR exclusion. */
export const MEASURED_PICK_ORDER_EVENTS_SCORED = 141;
/** Events dropped from the PICK-ORDER half only because a rostered team had no published `total` at the boundary. */
export const MEASURED_EVENTS_WITHOUT_BOUNDARY_SPR = 3;
/** The captain arms' own no-information floor: the mean of `1 / unalliedCount` at each captain turn. */
export const MEASURED_CAPTAIN_COIN_FLOOR = 0.03751894072315206;

// ───────────────────────────── pure helpers ─────────────────────────────
// Everything in this section is pure and unit-tested in
// measureSelectionAgreement.test.ts.

/** One draft turn. Round 1 is the first pick, round 2 the second. */
export interface DraftTurn {
  readonly round: 1 | 2;
  readonly allianceNumber: number;
}

/**
 * The REAL serpentine turn order: round one over alliances 1 through
 * `allianceCount` ascending, then round two over `allianceCount` down to 1.
 *
 * The direction is not a guess. 10-04's Fact 2 measured the real second pick's
 * mean qual rank falling monotonically from 24.83 at alliance 1 to 20.10 at
 * alliance 8 — alliance 8's second pick is the STRONGER one, which is only
 * possible if alliance 8 picks first in round two. Reversing round two is a
 * plausible and silent error that changes the answer.
 */
export function draftTurns(allianceCount: number): DraftTurn[] {
  const turns: DraftTurn[] = [];
  for (let n = 1; n <= allianceCount; n++) turns.push({ round: 1, allianceNumber: n });
  for (let n = allianceCount; n >= 1; n--) turns.push({ round: 2, allianceNumber: n });
  return turns;
}

/**
 * Each alliance's REAL captain, in `alliance_number` order — its own `picks[0]`,
 * whatever rank that team holds. Seeded from real history, never derived, never
 * checked against a rank set.
 */
export function captainsFromRealAlliances(alliances: readonly EventAllianceSelection[]): (string | undefined)[] {
  return alliances.map((alliance) => alliance.picks[0]);
}

/**
 * The PROGRESSIVE rule: the unallied team with the LOWEST rank number.
 * `undefined` when every ranked team is already allied.
 */
export function progressiveCaptainFor(
  rankByTeam: ReadonlyMap<string, number>,
  allied: ReadonlySet<string>
): string | undefined {
  let best: string | undefined;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const [teamKey, rank] of rankByTeam) {
    if (allied.has(teamKey)) continue;
    if (rank < bestRank || (rank === bestRank && best !== undefined && teamKey < best)) {
      best = teamKey;
      bestRank = rank;
    }
  }
  return best;
}

/** The NAIVE baseline: ranks 1 through `allianceCount`, ascending. A fixed list, computed once per event. */
export function naiveTopEightCaptains(
  rankByTeam: ReadonlyMap<string, number>,
  allianceCount: number
): (string | undefined)[] {
  const byRank = [...rankByTeam.entries()].sort((a, b) => (a[1] === b[1] ? (a[0] < b[0] ? -1 : 1) : a[1] - b[1]));
  return Array.from({ length: allianceCount }, (_, i) => byRank[i]?.[0]);
}

/**
 * The model's ordering of the currently-available teams: descending published
 * `total`, with an exact tie broken by ASCENDING TEAM KEY so the measurement is
 * reproducible rather than dependent on map insertion order.
 */
export function modelOrderingAtTurn(
  available: readonly string[],
  totalByTeam: ReadonlyMap<string, number>
): string[] {
  return [...available].sort((a, b) => {
    const ta = totalByTeam.get(a) ?? Number.NEGATIVE_INFINITY;
    const tb = totalByTeam.get(b) ?? Number.NEGATIVE_INFINITY;
    if (ta === tb) return a < b ? -1 : a > b ? 1 : 0;
    return tb - ta;
  });
}

/**
 * The 1-based position of the real pick inside the model's ordering; `1` is an
 * exact hit. `undefined` — the honest absent signal, never a number — when the
 * real pick is not in the available pool at all, which is a real state and is
 * counted as `turnsUnmodelled`.
 */
export function modelRankOfRealPick(ordering: readonly string[], realPick: string): number | undefined {
  const index = ordering.indexOf(realPick);
  return index === -1 ? undefined : index + 1;
}

/** One scored pick turn. */
export interface TurnResult {
  readonly eventKey: string;
  readonly season: number;
  readonly round: 1 | 2;
  readonly allianceNumber: number;
  readonly modelRank: number;
  readonly availableCount: number;
}

/** Share of turns the model got exactly right. `undefined` — never NaN — for an empty set. */
export function exactAgreement(results: readonly TurnResult[]): number | undefined {
  if (results.length === 0) return undefined;
  let hits = 0;
  for (const r of results) if (r.modelRank === 1) hits++;
  return hits / results.length;
}

/** Share of turns where the real pick was in the model's top three. `undefined` for an empty set. */
export function top3Agreement(results: readonly TurnResult[]): number | undefined {
  if (results.length === 0) return undefined;
  let hits = 0;
  for (const r of results) if (r.modelRank <= 3) hits++;
  return hits / results.length;
}

/** The no-information floor for one turn: one pick out of the available pool. */
export function coinBaselineForTurn(availableCount: number): number {
  if (!Number.isFinite(availableCount) || availableCount <= 0) return 0;
  return 1 / availableCount;
}

/** The pooled floor: the mean of the per-turn floors. `undefined` for an empty set. */
export function pooledCoinFloor(results: readonly TurnResult[]): number | undefined {
  if (results.length === 0) return undefined;
  let sum = 0;
  for (const r of results) sum += coinBaselineForTurn(r.availableCount);
  return sum / results.length;
}

export interface RankStats {
  readonly mean: number;
  readonly median: number;
  readonly p90: number;
}

/** Mean, median and 90th percentile of the model ranks. `undefined` for an empty set. */
export function modelRankStats(results: readonly TurnResult[]): RankStats | undefined {
  if (results.length === 0) return undefined;
  const sorted = results.map((r) => r.modelRank).sort((a, b) => a - b);
  const n = sorted.length;
  let sum = 0;
  for (const v of sorted) sum += v;
  const median = n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
  const p90Index = Math.min(n - 1, Math.max(0, Math.ceil(0.9 * n) - 1));
  return { mean: sum / n, median, p90: sorted[p90Index]! };
}

/**
 * Every named counter. NOT one of them removes an event on the basis of how its
 * captains RANK — that counter is deliberately absent, and its absence is the
 * reason this measurement was rewritten.
 */
export interface SelectionCensus {
  eventsConsideredCaptainWindow: number;
  eventsConsideredPickOrderWindow: number;
  eventsNotEightAlliance: number;
  eventsWithUnrankedRosterTeam: number;
  alliancesWithUnrankedCaptain: number;
  alliancesMissingFirstPick: number;
  secondPickTurnsAbsent: number;
  eventsWithoutBoundarySpr: number;
  turnsUnmodelled: number;
  captainEventsScored: number;
  pickOrderEventsScored: number;
}

export function emptyCensus(): SelectionCensus {
  return {
    eventsConsideredCaptainWindow: 0,
    eventsConsideredPickOrderWindow: 0,
    eventsNotEightAlliance: 0,
    eventsWithUnrankedRosterTeam: 0,
    alliancesWithUnrankedCaptain: 0,
    alliancesMissingFirstPick: 0,
    secondPickTurnsAbsent: 0,
    eventsWithoutBoundarySpr: 0,
    turnsUnmodelled: 0,
    captainEventsScored: 0,
    pickOrderEventsScored: 0,
  };
}

/** One captain slot's verdict for both arms. */
export interface CaptainSlotResult {
  readonly eventKey: string;
  readonly season: number;
  readonly allianceNumber: number;
  readonly realCaptain: string;
  readonly progressivePrediction: string | undefined;
  readonly naivePrediction: string | undefined;
  readonly unalliedCount: number;
  readonly realCaptainRank: number;
  readonly progressivePredictionRank: number | undefined;
  readonly naivePredictionRank: number | undefined;
}

/**
 * Walks one event's alliances on the SAME commitment schedule 10-04 uses:
 * predict the captain, compare against the real `picks[0]`, and only THEN mark
 * the REAL `picks[0]` and `picks[1]` allied before the next alliance's turn.
 *
 * Both arms are scored on that one walk, so the two figures rest on one
 * population and one schedule.
 */
export function scoreEventCaptains(
  eventKey: string,
  season: number,
  alliances: readonly EventAllianceSelection[],
  rankByTeam: ReadonlyMap<string, number>,
  census: SelectionCensus
): CaptainSlotResult[] {
  const naive = naiveTopEightCaptains(rankByTeam, alliances.length);
  const allied = new Set<string>();
  const results: CaptainSlotResult[] = [];

  for (let i = 0; i < alliances.length; i++) {
    const alliance = alliances[i]!;
    const realCaptain = alliance.picks[0];
    if (realCaptain === undefined) continue;

    const realCaptainRank = rankByTeam.get(realCaptain);
    if (realCaptainRank === undefined) census.alliancesWithUnrankedCaptain++;

    let unalliedCount = 0;
    for (const teamKey of rankByTeam.keys()) if (!allied.has(teamKey)) unalliedCount++;

    const progressivePrediction = progressiveCaptainFor(rankByTeam, allied);
    results.push({
      eventKey,
      season,
      allianceNumber: alliance.allianceNumber,
      realCaptain,
      progressivePrediction,
      naivePrediction: naive[i],
      unalliedCount,
      realCaptainRank: realCaptainRank ?? Number.NaN,
      progressivePredictionRank: progressivePrediction === undefined ? undefined : rankByTeam.get(progressivePrediction),
      naivePredictionRank: naive[i] === undefined ? undefined : rankByTeam.get(naive[i]!),
    });

    // COMMIT the REAL state, never the model's, and only after the comparison.
    allied.add(realCaptain);
    const firstPick = alliance.picks[1];
    if (firstPick === undefined) census.alliancesMissingFirstPick++;
    else allied.add(firstPick);
  }

  return results;
}

/**
 * The teacher-forced committed set at one turn.
 *
 *   Round one, alliance `n`: the real captains of alliances 1 through `n` plus
 *   the real first picks of alliances 1 through `n - 1`. A FUTURE captain is
 *   still available at that moment, because in the real draft alliance `n + 1`'s
 *   captain is not determined until alliance `n` has picked — committing all
 *   eight captains up front would hand the model a pool the real draft never had.
 *
 *   Round two, alliance `n`: all captains, all first picks, and the second picks
 *   of alliances `allianceCount` down to `n + 1`.
 */
export function committedAtTurn(alliances: readonly EventAllianceSelection[], turn: DraftTurn): Set<string> {
  const committed = new Set<string>();
  const n = turn.allianceNumber;
  const count = alliances.length;

  if (turn.round === 1) {
    for (let i = 0; i < n; i++) {
      const captain = alliances[i]?.picks[0];
      if (captain !== undefined) committed.add(captain);
    }
    for (let i = 0; i < n - 1; i++) {
      const firstPick = alliances[i]?.picks[1];
      if (firstPick !== undefined) committed.add(firstPick);
    }
    return committed;
  }

  for (let i = 0; i < count; i++) {
    const captain = alliances[i]?.picks[0];
    if (captain !== undefined) committed.add(captain);
    const firstPick = alliances[i]?.picks[1];
    if (firstPick !== undefined) committed.add(firstPick);
  }
  for (let i = count - 1; i >= n; i--) {
    const secondPick = alliances[i]?.picks[2];
    if (secondPick !== undefined) committed.add(secondPick);
  }
  return committed;
}

/** The real pick a turn scores: round one scores `picks[1]`, round two scores `picks[2]`. The captain is seeded and never scored as a model pick. */
export function realPickAtTurn(alliances: readonly EventAllianceSelection[], turn: DraftTurn): string | undefined {
  const alliance = alliances[turn.allianceNumber - 1];
  if (alliance === undefined) return undefined;
  return turn.round === 1 ? alliance.picks[1] : alliance.picks[2];
}

/** Scores one event's pick order, teacher-forced. */
export function scoreEventPickOrder(
  eventKey: string,
  season: number,
  alliances: readonly EventAllianceSelection[],
  candidatePool: readonly string[],
  totalByTeam: ReadonlyMap<string, number>,
  census: SelectionCensus
): TurnResult[] {
  const results: TurnResult[] = [];
  for (const turn of draftTurns(alliances.length)) {
    const realPick = realPickAtTurn(alliances, turn);
    if (realPick === undefined) {
      // `alliancesMissingFirstPick` is alliance-level and is shared with the
      // captain half, which increments it for the same condition; the two halves
      // run over different windows, so the printed figure is the union rather
      // than a per-half count. `secondPickTurnsAbsent` is pick-order only.
      if (turn.round === 2) census.secondPickTurnsAbsent++;
      else census.alliancesMissingFirstPick++;
      continue;
    }
    const committed = committedAtTurn(alliances, turn);
    const available = candidatePool.filter((teamKey) => !committed.has(teamKey));
    const ordering = modelOrderingAtTurn(available, totalByTeam);
    const modelRank = modelRankOfRealPick(ordering, realPick);
    if (modelRank === undefined) {
      census.turnsUnmodelled++;
      continue;
    }
    results.push({ eventKey, season, round: turn.round, allianceNumber: turn.allianceNumber, modelRank, availableCount: available.length });
  }
  return results;
}

// ───────────────────────────── corpus reads ─────────────────────────────

interface DistrictEventRow {
  event_key: string;
  year: number;
}

/**
 * Every DISTRICT event for a season — an event with a non-null `district_key`.
 * That predicate, not `event_type == 1`, is what reproduces 10-04's population
 * of 491 eight-alliance events across 2023 through 2026: a District
 * Championship and its divisions are district events too, and they run the same
 * eight-alliance draft.
 */
export function selectDistrictEventKeys(db: Corpus, season: number): string[] {
  const rows = db
    .prepare(`SELECT event_key, year FROM events WHERE year = ? AND district_key IS NOT NULL ORDER BY event_key`)
    .all(season) as DistrictEventRow[];
  return rows.map((r) => r.event_key);
}

// ───────────────────────────── the measurement ─────────────────────────────

export interface CaptainHalfResult {
  readonly slots: CaptainSlotResult[];
  readonly perfectEventsProgressive: number;
  readonly usableEvents: number;
  readonly excludedEventKeys: string[];
  readonly naiveSetEqualEvents: number;
  readonly naiveSetEqualityDenominator: number;
}

/**
 * The CAPTAIN half. Reads only `event_alliances` and `event_rankings` — no SPR,
 * no replay — so it runs over the full window cheaply.
 */
export function measureCaptainHalf(db: Corpus, seasons: readonly number[], census: SelectionCensus): CaptainHalfResult {
  const slots: CaptainSlotResult[] = [];
  const excludedEventKeys: string[] = [];
  let perfectEventsProgressive = 0;
  let usableEvents = 0;
  let naiveSetEqualEvents = 0;
  let naiveSetEqualityDenominator = 0;

  for (const season of [...seasons].sort((a, b) => a - b)) {
    const alliancesByEvent = selectEventAlliancesForSeason(db, season);
    const rankingsByEvent = selectEventRankingsForSeason(db, season);
    for (const eventKey of selectDistrictEventKeys(db, season)) {
      const alliances = alliancesByEvent.get(eventKey);
      if (alliances === undefined) continue;
      census.eventsConsideredCaptainWindow++;
      if (alliances.length !== SCORED_ALLIANCE_COUNT) {
        census.eventsNotEightAlliance++;
        continue;
      }

      const rankRows = rankingsByEvent.get(eventKey) ?? new Map();
      const rankByTeam = new Map<string, number>();
      for (const [teamKey, row] of rankRows) rankByTeam.set(teamKey, row.rank);

      // The naive arm's SET-EQUALITY figure has its OWN denominator: every
      // eight-alliance district event in the window, including the ones the
      // per-slot population excludes.
      naiveSetEqualityDenominator++;
      const realCaptainSet = new Set(captainsFromRealAlliances(alliances).filter((t): t is string => t !== undefined));
      const naiveSet = new Set(naiveTopEightCaptains(rankByTeam, SCORED_ALLIANCE_COUNT).filter((t): t is string => t !== undefined));
      if (
        realCaptainSet.size === SCORED_ALLIANCE_COUNT &&
        naiveSet.size === SCORED_ALLIANCE_COUNT &&
        [...realCaptainSet].every((t) => naiveSet.has(t))
      ) {
        naiveSetEqualEvents++;
      }

      // A rank-ordered rule cannot be scored on an event where some rostered
      // alliance team has no `event_rankings` row.
      const rosterTeams = alliances.flatMap((a) => a.picks);
      if (rosterTeams.some((teamKey) => !rankByTeam.has(teamKey))) {
        census.eventsWithUnrankedRosterTeam++;
        excludedEventKeys.push(eventKey);
        continue;
      }

      const eventSlots = scoreEventCaptains(eventKey, season, alliances, rankByTeam, census);
      slots.push(...eventSlots);
      usableEvents++;
      census.captainEventsScored++;
      if (eventSlots.every((slot) => slot.progressivePrediction === slot.realCaptain)) perfectEventsProgressive++;
    }
  }

  return { slots, perfectEventsProgressive, usableEvents, excludedEventKeys, naiveSetEqualityDenominator, naiveSetEqualEvents };
}

/**
 * Per event, each team's published `total` at the QUALIFICATION/PLAYOFF
 * BOUNDARY: the value from its most recently played match at or before the
 * boundary, i.e. after its final qualification match. That is exactly what the
 * published event artifact carries for that team when the draft happens.
 */
export function boundaryTotalsByEvent(
  db: Corpus,
  seasons: readonly number[],
  warmupFrom: number | undefined
): Map<string, Map<string, number>> {
  const byEvent = new Map<string, Map<string, number>>();
  replayPublishedSprSnapshots(db, { seasons, warmupFrom }, (row) => {
    if (row.match.compLevel !== "qm") return;
    let forEvent = byEvent.get(row.match.eventKey);
    if (forEvent === undefined) {
      forEvent = new Map();
      byEvent.set(row.match.eventKey, forEvent);
    }
    for (const [teamKey, snapshot] of row.after) {
      if (snapshot.total !== undefined && Number.isFinite(snapshot.total)) forEvent.set(teamKey, snapshot.total);
    }
  });
  return byEvent;
}

export interface PickOrderHalfResult {
  readonly turns: TurnResult[];
  readonly eventsScored: number;
}

/** The PICK-ORDER half. Needs the replay, so it runs over the narrower window. */
export function measurePickOrderHalf(
  db: Corpus,
  seasons: readonly number[],
  warmupFrom: number | undefined,
  census: SelectionCensus
): PickOrderHalfResult {
  const boundary = boundaryTotalsByEvent(db, seasons, warmupFrom);
  const turns: TurnResult[] = [];
  let eventsScored = 0;

  for (const season of [...seasons].sort((a, b) => a - b)) {
    const alliancesByEvent = selectEventAlliancesForSeason(db, season);
    const rankingsByEvent = selectEventRankingsForSeason(db, season);
    for (const eventKey of selectDistrictEventKeys(db, season)) {
      const alliances = alliancesByEvent.get(eventKey);
      if (alliances === undefined) continue;
      census.eventsConsideredPickOrderWindow++;
      if (alliances.length !== SCORED_ALLIANCE_COUNT) continue;

      const rankRows = rankingsByEvent.get(eventKey) ?? new Map();
      const candidatePool = [...rankRows.keys()];
      const totalByTeam = boundary.get(eventKey) ?? new Map<string, number>();

      // A rostered team with no published `total` at the boundary drops the
      // event from THIS half only and is counted. Never substitute a default: a
      // substituted strength is a different model. This gate never touches the
      // captain arms, which read no SPR at all.
      const rosterTeams = alliances.flatMap((a) => a.picks);
      if (candidatePool.length === 0 || rosterTeams.some((teamKey) => !totalByTeam.has(teamKey))) {
        census.eventsWithoutBoundarySpr++;
        continue;
      }

      turns.push(...scoreEventPickOrder(eventKey, season, alliances, candidatePool, totalByTeam, census));
      eventsScored++;
      census.pickOrderEventsScored++;
    }
  }

  return { turns, eventsScored };
}

// ───────────────────────────── reporting ─────────────────────────────

function share(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? "n/a" : `${(value * 100).toFixed(2)}%`;
}

function num(value: number | undefined, digits = 3): string {
  return value === undefined || !Number.isFinite(value) ? "n/a" : value.toFixed(digits);
}

function meanAbsoluteRankError(slots: readonly CaptainSlotResult[], arm: "progressive" | "naive"): number | undefined {
  let sum = 0;
  let n = 0;
  for (const slot of slots) {
    const predictedRank = arm === "progressive" ? slot.progressivePredictionRank : slot.naivePredictionRank;
    if (predictedRank === undefined || !Number.isFinite(slot.realCaptainRank)) continue;
    sum += Math.abs(predictedRank - slot.realCaptainRank);
    n++;
  }
  return n === 0 ? undefined : sum / n;
}

function armCorrect(slots: readonly CaptainSlotResult[], arm: "progressive" | "naive"): number {
  let correct = 0;
  for (const slot of slots) {
    const prediction = arm === "progressive" ? slot.progressivePrediction : slot.naivePrediction;
    if (prediction === slot.realCaptain) correct++;
  }
  return correct;
}

function captainFloor(slots: readonly CaptainSlotResult[]): number | undefined {
  if (slots.length === 0) return undefined;
  let sum = 0;
  for (const slot of slots) sum += slot.unalliedCount > 0 ? 1 / slot.unalliedCount : 0;
  return sum / slots.length;
}

export function progressiveMisses(slots: readonly CaptainSlotResult[]): string[] {
  return slots
    .filter((slot) => slot.progressivePrediction !== slot.realCaptain)
    .map((slot) => `${slot.eventKey} alliance ${slot.allianceNumber}`);
}

function reportCaptainBlock(captain: CaptainHalfResult, census: SelectionCensus): void {
  console.log(`══ CAPTAIN BLOCK ══ window ${MEASURED_CAPTAIN_WINDOW}`);
  const bySeason = new Map<number, CaptainSlotResult[]>();
  for (const slot of captain.slots) {
    if (!bySeason.has(slot.season)) bySeason.set(slot.season, []);
    bySeason.get(slot.season)!.push(slot);
  }
  console.log(`   season   arm              correct / slots      mean |rank error|   floor`);
  for (const season of [...bySeason.keys()].sort((a, b) => a - b)) {
    const slots = bySeason.get(season)!;
    for (const arm of ["progressive", "naive"] as const) {
      const correct = armCorrect(slots, arm);
      console.log(
        `   ${String(season).padEnd(8)} ${arm.padEnd(16)} ${String(correct).padStart(5)} / ${String(slots.length).padStart(5)}   ` +
          `${share(correct / slots.length).padStart(8)}   ${num(meanAbsoluteRankError(slots, arm), 2).padStart(8)}   ${share(captainFloor(slots))}`
      );
    }
  }
  for (const arm of ["progressive", "naive"] as const) {
    const correct = armCorrect(captain.slots, arm);
    console.log(
      `   POOLED   ${arm.padEnd(16)} ${String(correct).padStart(5)} / ${String(captain.slots.length).padStart(5)}   ` +
        `${share(correct / captain.slots.length).padStart(8)}   ${num(meanAbsoluteRankError(captain.slots, arm), 2).padStart(8)}   ${share(
          captainFloor(captain.slots)
        )}`
    );
  }
  console.log(`   progressive PERFECT EVENTS: ${captain.perfectEventsProgressive} of ${captain.usableEvents} usable events`);
  console.log(
    `   naive SET EQUALITY: ${captain.naiveSetEqualEvents} of ${captain.naiveSetEqualityDenominator} eight-alliance district events ` +
      `(a DIFFERENT denominator from the per-slot figure above — ${captain.usableEvents} usable events)`
  );
  const misses = progressiveMisses(captain.slots);
  console.log(`   progressive MISSES (${misses.length}): ${misses.join(", ") || "none"}`);
  console.log(
    `   EXCLUDED (${census.eventsWithUnrankedRosterTeam} events, a rostered alliance team with no event_rankings row): ${
      captain.excludedEventKeys.join(", ") || "none"
    }`
  );
  console.log("");
}

function reportPickOrderBlock(pick: PickOrderHalfResult): void {
  console.log(`══ PICK-ORDER BLOCK ══ window ${MEASURED_PICK_ORDER_WINDOW}, warmup from ${MEASURED_PICK_ORDER_WARMUP_FROM}`);
  const rounds: Array<[string, TurnResult[]]> = [
    ["first pick", pick.turns.filter((t) => t.round === 1)],
    ["second pick", pick.turns.filter((t) => t.round === 2)],
    ["POOLED", pick.turns],
  ];
  console.log(`   bucket        turns    exact     top-3     mean rank   median   p90    coin floor`);
  for (const [label, turns] of rounds) {
    const stats = modelRankStats(turns);
    console.log(
      `   ${label.padEnd(12)} ${String(turns.length).padStart(6)}   ${share(exactAgreement(turns)).padStart(7)}   ` +
        `${share(top3Agreement(turns)).padStart(7)}   ${num(stats?.mean, 2).padStart(9)}   ${num(stats?.median, 1).padStart(6)}   ` +
        `${num(stats?.p90, 1).padStart(5)}   ${share(pooledCoinFloor(turns))}`
    );
  }
  console.log(`   events scored: ${pick.eventsScored}`);
  console.log("");
}

function reportCensus(census: SelectionCensus): void {
  console.log(`══ CENSUS ══`);
  for (const [key, value] of Object.entries(census)) console.log(`   ${key.padEnd(34)} ${value}`);
  console.log(`   NO counter above removes an event on the basis of how its captains rank.`);
  console.log("");
}

function reportPracticalAnswer(captain: CaptainHalfResult, pick: PickOrderHalfResult): void {
  const progressiveCorrect = armCorrect(captain.slots, "progressive");
  const naiveCorrect = armCorrect(captain.slots, "naive");
  const first = pick.turns.filter((t) => t.round === 1);
  const second = pick.turns.filter((t) => t.round === 2);
  const pooledStats = modelRankStats(pick.turns);
  const floor = pooledCoinFloor(pick.turns);
  const exact = exactAgreement(pick.turns);

  console.log(`══ PRACTICAL ANSWER ══`);
  console.log(
    `   The progressive captain rule — at each alliance's turn, the captain is the highest-ranked team\n` +
      `   not yet allied — names the team that really was the captain ${share(progressiveCorrect / captain.slots.length)} of the time\n` +
      `   (${progressiveCorrect} of ${captain.slots.length} slots across ${captain.usableEvents} events), against ${share(
        naiveCorrect / captain.slots.length
      )} for the naive rule\n` +
      `   "the captains are the eight best-ranked teams" on the SAME slots. The naive rule reproduces the\n` +
      `   whole real captain SET at ${captain.naiveSetEqualEvents} of ${captain.naiveSetEqualityDenominator} events, which is why it is carried here as a labelled\n` +
      `   baseline and never as a filter.\n` +
      `\n` +
      `   Greedy by published SPR picks the team a real alliance picked ${share(exact)} of the time, pooled over\n` +
      `   ${pick.turns.length} turns, against a no-information floor of ${share(floor)}. The real pick typically sits at\n` +
      `   position ${num(pooledStats?.median, 1)} in the model's list (mean ${num(pooledStats?.mean, 2)}, ninth decile ${num(pooledStats?.p90, 1)}).\n` +
      `   FIRST and SECOND picks behave differently: ${share(exactAgreement(first))} exact on first picks (${first.length} turns)\n` +
      `   against ${share(exactAgreement(second))} on second picks (${second.length} turns), with floors of ${share(
        pooledCoinFloor(first)
      )} and ${share(pooledCoinFloor(second))}.\n` +
      `   Reported in whichever direction they came out.`
  );
  console.log("");
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const captainSeasons = parseSeasons(flagValue(args, "--captain-seasons") ?? MEASURED_CAPTAIN_WINDOW);
  const pickSeasons = parseSeasons(flagValue(args, "--seasons") ?? MEASURED_PICK_ORDER_WINDOW);
  const warmupSpec = flagValue(args, "--warmup-from") ?? String(MEASURED_PICK_ORDER_WARMUP_FROM);
  const parsedWarmup = Number.parseInt(warmupSpec, 10);
  const warmupFrom = Number.isFinite(parsedWarmup) ? parsedWarmup : undefined;
  const asJson = args.includes("--json");

  if (!asJson) {
    console.log(`SELECTION AGREEMENT — the progressive captain rule and greedy-by-SPR pick order, against the real draft.`);
    console.log(`captain window:    ${captainSeasons.join(", ")} (no SPR, no replay)`);
    console.log(`pick-order window: ${pickSeasons.join(", ")}, warmup from ${warmupFrom ?? "none"}`);
    console.log(`scope:             district events (non-null district_key) with exactly ${SCORED_ALLIANCE_COUNT} alliances`);
    console.log(`teacher forcing:   every turn sees the REAL draft state so far and predicts exactly one pick`);
    console.log(`credential:        none. Read-only corpus, no network request, no environment variable.`);
    console.log(``);
  }

  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    const census = emptyCensus();
    const captain = measureCaptainHalf(db, captainSeasons, census);
    const pick = measurePickOrderHalf(db, pickSeasons, warmupFrom, census);

    if (asJson) {
      console.log(
        JSON.stringify(
          {
            command: MEASURED_COMMAND,
            date: MEASURED_DATE,
            captainWindow: captainSeasons,
            pickOrderWindow: pickSeasons,
            warmupFrom,
            captain: {
              slots: captain.slots.length,
              progressiveCorrect: armCorrect(captain.slots, "progressive"),
              naiveCorrect: armCorrect(captain.slots, "naive"),
              perfectEvents: captain.perfectEventsProgressive,
              usableEvents: captain.usableEvents,
              excludedEventKeys: captain.excludedEventKeys,
              naiveSetEqualEvents: captain.naiveSetEqualEvents,
              naiveSetEqualityDenominator: captain.naiveSetEqualityDenominator,
              misses: progressiveMisses(captain.slots),
              floor: captainFloor(captain.slots),
            },
            pickOrder: {
              turns: pick.turns.length,
              firstPickTurns: pick.turns.filter((t) => t.round === 1).length,
              secondPickTurns: pick.turns.filter((t) => t.round === 2).length,
              exact: exactAgreement(pick.turns),
              top3: top3Agreement(pick.turns),
              firstPickExact: exactAgreement(pick.turns.filter((t) => t.round === 1)),
              secondPickExact: exactAgreement(pick.turns.filter((t) => t.round === 2)),
              firstPickTop3: top3Agreement(pick.turns.filter((t) => t.round === 1)),
              secondPickTop3: top3Agreement(pick.turns.filter((t) => t.round === 2)),
              rankStats: modelRankStats(pick.turns),
              coinFloor: pooledCoinFloor(pick.turns),
              firstPickFloor: pooledCoinFloor(pick.turns.filter((t) => t.round === 1)),
              secondPickFloor: pooledCoinFloor(pick.turns.filter((t) => t.round === 2)),
              eventsScored: pick.eventsScored,
            },
            census,
          },
          null,
          2
        )
      );
      return;
    }

    reportCaptainBlock(captain, census);
    reportPickOrderBlock(pick);
    reportCensus(census);
    reportPracticalAnswer(captain, pick);
  } finally {
    db.close();
  }
}

// Guard: only auto-run `main()` when this file is the process entry point, so
// the pure helpers above can be imported by the test file without opening a
// corpus.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("measure:selection-agreement failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
