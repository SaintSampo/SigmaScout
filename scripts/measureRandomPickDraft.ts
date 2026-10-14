/**
 * Measures, WITHOUT SHIPPING, whether a random pick draft predicts who ends up
 * on a playoff alliance better than today's fixed draft (quick task 261014-mji).
 *
 * ---------------------------------------------------------------------------
 * WHY
 * ---------------------------------------------------------------------------
 *
 * The Locks simulation (`packages/core/districts/ledgerSimulation.ts`) picks
 * greedily by published SPR mean in a fixed order and draws no randomness in
 * the draft. At Quals done the ranking is fixed, so every team's pick chance is
 * 0% or 100%. 2026 UNC Asheville (2026ncash) team 6932 read 0% and was picked
 * (alliance 7, second pick). Jacob decided: MEASURE FIRST, ship only if the
 * candidate wins.
 *
 * ---------------------------------------------------------------------------
 * THE ARMS, ALL THROUGH THE SHIPPED SIMULATION
 * ---------------------------------------------------------------------------
 *
 *   (a)  today's fixed draft: `simulateDistrictEvent` with no pick option.
 *   (b)  the random pick draft: the same call with `pickPositionPmf`, the
 *        measured pmf of where real picks sat in the still available list
 *        ordered by SPR (one pmf for first picks, one for second picks), from
 *        the PRIMARY tables (every season from `--train-from`, default 2016,
 *        to the season before the scored one).
 *   (b2) the same draft from the SENSITIVITY tables (seasons from
 *        `--sensitivity-train-from`, default 2023, to the season before), run
 *        only for scored seasons after that first season.
 *   (c)  a fixed draft by qualification rank: the same call with no option and
 *        ratings whose `total` falls with rank (`rankOrderRatings`), so the
 *        greedy pick takes the best ranked available team. Its playoff bucket
 *        comes from a rerun with its draft as `knownAlliances` and the REAL
 *        boundary ratings, because its first run prices the bracket from the
 *        substituted totals.
 *
 * ---------------------------------------------------------------------------
 * WALK FORWARD TABLES
 * ---------------------------------------------------------------------------
 *
 * The pmf used to score season Y is built ONLY from real drafts of seasons
 * before Y (`pickPositionTables`). Every position is measured against each
 * team's SPR at the end of its own qualification matches at that event: the
 * 10-02 replay path (`scripts/publishedSprSnapshots.ts`, read through
 * `boundaryRatingsByEvent` in `measureSelectionAgreement.ts`), the same
 * quantity the simulation picks by. Pre 2023 drafts are used for tables (the
 * draft itself, captain then round one 1 to 8 then round two 8 to 1, is the
 * same in every season; backups never enter a table) but cannot be SCORED,
 * because the simulation refuses seasons before 2023.
 *
 * ---------------------------------------------------------------------------
 * THE QUALS DONE POSITION
 * ---------------------------------------------------------------------------
 *
 * Every scored event is simulated with zero remaining matches and baselines
 * that reproduce the REAL final ranking exactly (`qualsDoneBaselines`), with
 * every team rated by its boundary SPR. Awards are skipped (`knownAwardPoints`
 * is an empty map): they play no part in who is picked.
 *
 * ---------------------------------------------------------------------------
 * SCORING (pre registered, not tuned after seeing numbers)
 * ---------------------------------------------------------------------------
 *
 * Primary: each ranked team's chance of being ON AN ALLIANCE (captain or pick;
 * a backup is not), scored against the real draft with Brier, log loss clipped
 * at 0.01 (the site's own display bounds: a chance never prints above 99% or
 * below "<1%"; 0.001 is printed beside it), accuracy at the 50% call, and a 12
 * row calibration table, per season and pooled. Secondary: the exact alliance
 * and slot (25 classes) and the playoff bucket (5 classes), multiclass Brier
 * and log loss.
 *
 * THE WIN RULE, pre registered by Jacob before any number was seen: the random
 * pick draft wins only if, pooled over the scored seasons, Brier is lower AND
 * log loss (0.01) is lower AND accuracy is the same or higher, against (a).
 * Each table set gets its own verdict; if they disagree, both are reported and
 * Jacob decides.
 *
 * ---------------------------------------------------------------------------
 * CREDENTIAL FREE AND OFFLINE
 * ---------------------------------------------------------------------------
 *
 * Read only corpus, no network request, no environment variable, no env file
 * flag. Nothing here is published: the option stays inert at default and no
 * caller in apps/ or packages/harness/ passes it.
 *
 * Usage:
 *   npx tsx scripts/measureRandomPickDraft.ts [--seasons 2023-2026] [--replay-from 2016] [--train-from 2016]
 *     [--sensitivity-train-from 2023] [--draws 1000] [--seed 20260830] [--stability] [--json PATH] [--limit-events N]
 *   npx tsx scripts/measureRandomPickDraft.ts --event 2026ncash [--replay-from 2016] [--train-from 2016]
 *
 * ---------------------------------------------------------------------------
 * MEASURED
 * ---------------------------------------------------------------------------
 *
 * Recorded, not pinned by any test. Report and JSON kept under
 * data/local-publish/pick-draft/ (gitignored): 261014-mji-report.txt and
 * 261014-mji.json.
 *
 *   command:  npx tsx scripts/measureRandomPickDraft.ts --stability --json data/local-publish/pick-draft/261014-mji.json
 *   date:     2026-10-14
 *   SPR:      spr@11.0.0+baseline, replayed 2016 to 2026 (boundary = after each team's last qualification match)
 *   scored:   2023 to 2026 at quals done, 1000 draws, seed 20260830
 *   teams:    2023 3,932 (110 events); 2024 4,119 (114); 2025 4,308 (120); 2026 5,053 (141);
 *             pooled 17,412 (485 events). Excluded: 16 events not eight alliances
 *             (the divisioned DCMP parents), 6 with an alliance team with no
 *             ranking row (2023gaalb, 2024vapor, 2025ncash, 2026mefal,
 *             2026txfor, 2026txmca); the simulation threw at none.
 *
 *   pooled                       Brier    log loss 0.01   accuracy
 *   (a) fixed SPR draft          0.1327   0.6197          86.73%  (2,310 of 17,412 called wrong)
 *   (b) random pick, 2016 on     0.0917   0.2886          86.95%
 *   (b2) random pick, 2023 on    0.0910   0.2880          87.03%  (2024 to 2026 only, 13,480 teams)
 *   (c) fixed rank draft         0.1865   0.8672          81.35%  (3,248 of 17,412 called wrong)
 *
 *   VERDICT (b) 2016 onward tables vs (a), pooled over 2023 to 2026: WIN
 *     (Brier lower, log loss lower, accuracy same or higher; Brier lower in 4 of 4 seasons)
 *   VERDICT (b2) 2023 onward tables vs (a), pooled over 2024 to 2026: WIN
 *     (Brier 0.0910 vs 0.1315, log loss 0.2880 vs 0.6141, accuracy 87.03% vs 86.85%; 3 of 3 seasons)
 *   VERDICT (c) fixed rank draft vs (a), pooled over 2023 to 2026: NO WIN (worse on all three)
 *   The two table sets agree. Stability: (b) at seed 20260831 moves pooled
 *   Brier by -0.00020 and log loss by -0.00081, accuracy 86.90%.
 *   Measurement only: nothing here changes a published number.
 */

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { playedBracketMatchesFor, type BracketSourceEvent } from "../apps/web/src/components/districts/districtLedgerRows.js";
import { DEFAULT_SIMULATION_SEED, SIMULATION_DRAWS } from "../apps/web/src/workers/simulationProtocol.js";
import type { SimTeamBaseline } from "../packages/core/algorithms/simulation/rankSimulation.js";
import type { AllianceMemberRating } from "../packages/core/algorithms/simulation/allianceWinProbability.js";
import {
  bracketDecisionsFromPlayedMatches,
  playoffPoints,
  routePlayedBracket,
  type PlayedBracketMatch,
} from "../packages/core/districts/bracket.js";
import {
  simulateDistrictEvent,
  type DistrictLedgerEventInput,
  type DistrictLedgerResult,
  type PickPositionPmf,
  type SuppliedAlliance,
} from "../packages/core/districts/ledgerSimulation.js";
import type { DistrictTier } from "../packages/core/districts/pointModel.js";
import {
  openCorpusReadOnly,
  selectEventAlliancesForSeason,
  selectEventRankingsForSeason,
  selectMatchesChronological,
  type Corpus,
  type EventAllianceSelection,
} from "../packages/corpus/db.js";
import { resolvePublishAlgorithms } from "../packages/harness/publish.js";
import {
  boundaryRatingsByEvent,
  boundaryTotalsFromRatings,
  emptyCensus,
  exactAgreement,
  measurePickOrderHalf,
  modelRankStats,
  SCORED_ALLIANCE_COUNT,
  selectDistrictEventKeys,
  top3Agreement,
  type BoundaryRating,
  type TurnResult,
} from "./measureSelectionAgreement.js";
import { parseSeasons } from "./scriptHelpers.js";

const CORPUS_PATH = "data/corpus.sqlite";

/** The first season the simulation can score (its own bracket guard). */
export const FIRST_SCORABLE_SEASON = 2023;
/** The primary log loss clip: the site's own display bounds. */
export const PRIMARY_LOG_LOSS_EPS = 0.01;
/** Printed beside the primary clip. */
export const SECONDARY_LOG_LOSS_EPS = 0.001;
/** The drafted slots a simulated alliance holds: captain, first pick, second pick. */
const DRAFTED_SLOTS = 3;
/** 8 alliances x 3 slots, plus "none". */
export const SLOT_CLASS_COUNT = SCORED_ALLIANCE_COUNT * DRAFTED_SLOTS + 1;
/** The "not on any alliance" slot class. */
export const NONE_SLOT_CLASS = SLOT_CLASS_COUNT - 1;
/** The five playoff buckets, in index order. */
export const PLAYOFF_BUCKET_LABELS: readonly string[] = ["first", "second", "third or fourth", "fifth to eighth", "not picked"];
export const NOT_PICKED_BUCKET = 4;

// ───────────────────────────── pure helpers ─────────────────────────────

/** One round's walk forward table: the pmf and how many real turns built it. */
export interface PickPositionTables {
  readonly pmf: PickPositionPmf;
  readonly firstTurns: number;
  readonly secondTurns: number;
}

/** Raised when a walk forward table has no turn to build a round from. */
export class EmptyPickTableError extends Error {
  constructor(message: string) {
    super(`pickPositionTables: ${message}`);
    this.name = "EmptyPickTableError";
  }
}

/** Raw empirical frequency of `modelRank` over positions 1 to the deepest observed. No smoothing; unseen positions inside that range are 0. */
function positionFrequency(turns: readonly TurnResult[]): number[] {
  let deepest = 0;
  for (const turn of turns) if (turn.modelRank > deepest) deepest = turn.modelRank;
  const counts = new Array<number>(deepest).fill(0);
  for (const turn of turns) counts[turn.modelRank - 1]! += 1;
  return counts.map((count) => count / turns.length);
}

/**
 * The WALK FORWARD tables for scoring `eventSeason`: every TurnResult with
 * `trainFrom <= season < eventSeason`, split by round. A season at or after
 * `eventSeason` never enters, which is the leak boundary.
 */
export function pickPositionTables(turns: readonly TurnResult[], eventSeason: number, trainFrom: number): PickPositionTables {
  const first: TurnResult[] = [];
  const second: TurnResult[] = [];
  for (const turn of turns) {
    if (turn.season < trainFrom || turn.season >= eventSeason) continue;
    if (turn.round === 1) first.push(turn);
    else second.push(turn);
  }
  if (first.length === 0 || second.length === 0) {
    throw new EmptyPickTableError(
      `no ${first.length === 0 ? "first" : "second"} pick turns in seasons ${String(trainFrom)} to ${String(eventSeason - 1)}`
    );
  }
  return {
    pmf: { firstPick: positionFrequency(first), secondPick: positionFrequency(second) },
    firstTurns: first.length,
    secondTurns: second.length,
  };
}

/** Raised when the real ranking carries two teams at one rank, which no baseline can reproduce without a key tiebreak. */
export class DuplicateRankError extends Error {
  constructor(message: string) {
    super(`qualsDoneBaselines: ${message}`);
    this.name = "DuplicateRankError";
  }
}

/**
 * One baseline per ranked team, in real rank order: `earnedRpSum = maxRank -
 * rank + 1` and `matchesPlayed = 1`, so the average ranking points fall
 * strictly with rank and the simulated order is EXACTLY the real final ranking.
 * No key tiebreak can fire, because no two averages are equal.
 */
export function qualsDoneBaselines(rankByTeam: ReadonlyMap<string, number>): SimTeamBaseline[] {
  const entries = [...rankByTeam.entries()].sort((a, b) => a[1] - b[1]);
  for (let i = 1; i < entries.length; i++) {
    if (entries[i]![1] === entries[i - 1]![1]) {
      throw new DuplicateRankError(`${entries[i - 1]![0]} and ${entries[i]![0]} share rank ${String(entries[i]![1])}`);
    }
  }
  const maxRank = entries.length === 0 ? 0 : entries[entries.length - 1]![1];
  return entries.map(([teamKey, rank]) => ({ teamKey, earnedRpSum: maxRank - rank + 1, matchesPlayed: 1 }));
}

/** Raised when the rank draft is asked to rate a team the real ranking does not carry. */
export class MissingRankError extends Error {
  constructor(message: string) {
    super(`rankOrderRatings: ${message}`);
    this.name = "MissingRankError";
  }
}

/**
 * The rank draft's ratings: `total = maxRank + 1 - rank`, strictly falling as
 * rank rises, so the greedy pick takes the best ranked available team; `sigma`
 * is kept from the real rating.
 */
export function rankOrderRatings(
  ratings: ReadonlyMap<string, AllianceMemberRating>,
  rankByTeam: ReadonlyMap<string, number>
): Map<string, AllianceMemberRating> {
  let maxRank = 0;
  for (const rank of rankByTeam.values()) if (rank > maxRank) maxRank = rank;
  const missing = [...ratings.keys()].filter((teamKey) => !rankByTeam.has(teamKey));
  if (missing.length > 0) throw new MissingRankError(`no rank for ${missing.join(", ")}`);
  const out = new Map<string, AllianceMemberRating>();
  for (const [teamKey, rating] of ratings) {
    out.set(teamKey, { teamKey, total: maxRank + 1 - rankByTeam.get(teamKey)!, sigma: rating.sigma });
  }
  return out;
}

/** Every team on an alliance in the REAL draft: picks 0 to 2 (captain, first, second). A backup (picks[3]) is not. */
export function realOnAlliance(alliances: readonly EventAllianceSelection[]): Set<string> {
  return new Set(realSlots(alliances).keys());
}

/** The 25 class index of (alliance number, slot): `(allianceNumber - 1) * 3 + slot`. */
export function slotClass(allianceNumber: number, slot: number): number {
  return (allianceNumber - 1) * DRAFTED_SLOTS + slot;
}

/** Each real captain and pick's slot class. A backup (picks[3]) is absent, so it reads as `NONE_SLOT_CLASS`. */
export function realSlots(alliances: readonly EventAllianceSelection[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const alliance of alliances) {
    for (let slot = 0; slot < DRAFTED_SLOTS; slot++) {
      const key = alliance.picks[slot];
      if (key !== undefined) out.set(key, slotClass(alliance.allianceNumber, slot));
    }
  }
  return out;
}

/** Each roster team's chance of being on an alliance: 1 minus its not selected draws over the run's draws. */
export function onAllianceChances(result: DistrictLedgerResult): Map<string, number> {
  const out = new Map<string, number>();
  for (const [teamKey, routes] of result.selectionRoutes) out.set(teamKey, 1 - routes.notSelectedDraws / result.draws);
  return out;
}

/** Mean squared error of probabilities against 0/1 outcomes. `undefined` for an empty set. */
export function brierScore(predictions: readonly number[], outcomes: readonly number[]): number | undefined {
  if (predictions.length === 0) return undefined;
  let sum = 0;
  for (let i = 0; i < predictions.length; i++) {
    const diff = predictions[i]! - outcomes[i]!;
    sum += diff * diff;
  }
  return sum / predictions.length;
}

/** Mean binary log loss with each prediction clipped into [eps, 1 - eps]. `undefined` for an empty set. */
export function logLoss(predictions: readonly number[], outcomes: readonly number[], eps: number): number | undefined {
  if (predictions.length === 0) return undefined;
  let sum = 0;
  for (let i = 0; i < predictions.length; i++) {
    const p = Math.min(1 - eps, Math.max(eps, predictions[i]!));
    sum += outcomes[i] === 1 ? -Math.log(p) : -Math.log(1 - p);
  }
  return sum / predictions.length;
}

/** Share of teams the 50% call gets right: a chance of 0.5 or more calls "on an alliance". `undefined` for an empty set. */
export function accuracyAtHalf(predictions: readonly number[], outcomes: readonly number[]): number | undefined {
  if (predictions.length === 0) return undefined;
  let correct = 0;
  for (let i = 0; i < predictions.length; i++) if ((predictions[i]! >= 0.5 ? 1 : 0) === outcomes[i]) correct++;
  return correct / predictions.length;
}

/** Mean over items of the sum over classes of (p - indicator)^2. `undefined` for an empty set. */
export function multiclassBrier(probabilities: readonly (readonly number[])[], truth: readonly number[]): number | undefined {
  if (probabilities.length === 0) return undefined;
  let sum = 0;
  probabilities.forEach((vector, i) => {
    vector.forEach((p, k) => {
      const diff = p - (k === truth[i] ? 1 : 0);
      sum += diff * diff;
    });
  });
  return sum / probabilities.length;
}

/** Mean of -ln(max(eps, p of the true class)). `undefined` for an empty set. */
export function multiclassLogLoss(probabilities: readonly (readonly number[])[], truth: readonly number[], eps: number): number | undefined {
  if (probabilities.length === 0) return undefined;
  let sum = 0;
  probabilities.forEach((vector, i) => {
    sum += -Math.log(Math.max(eps, vector[truth[i]!] ?? 0));
  });
  return sum / probabilities.length;
}

export interface CalibrationRow {
  readonly label: string;
  readonly n: number;
  readonly meanPredicted: number | undefined;
  readonly observed: number | undefined;
}

/** 12 rows: exactly 0, (0, 0.1), [0.1, 0.2) through [0.9, 1), exactly 1. */
export function calibrationTable(predictions: readonly number[], outcomes: readonly number[]): CalibrationRow[] {
  const labels = ["exactly 0", "(0, 0.1)"];
  for (let d = 1; d <= 9; d++) labels.push(`[0.${String(d)}, ${d === 9 ? "1" : `0.${String(d + 1)}`})`);
  labels.push("exactly 1");
  const n = new Array<number>(12).fill(0);
  const sumP = new Array<number>(12).fill(0);
  const sumY = new Array<number>(12).fill(0);
  predictions.forEach((p, i) => {
    const row = p === 0 ? 0 : p === 1 ? 11 : p < 0.1 ? 1 : Math.min(10, Math.floor(p * 10) + 1);
    n[row]! += 1;
    sumP[row]! += p;
    sumY[row]! += outcomes[i]!;
  });
  return labels.map((label, row) => ({
    label,
    n: n[row]!,
    meanPredicted: n[row]! === 0 ? undefined : sumP[row]! / n[row]!,
    observed: n[row]! === 0 ? undefined : sumY[row]! / n[row]!,
  }));
}

/** Raised when an elimination histogram carries mass at a point value no placement pays. */
export class PlayoffBucketMassError extends Error {
  constructor(message: string) {
    super(`playoffBucketChances: ${message}`);
    this.name = "PlayoffBucketMassError";
  }
}

/**
 * The five playoff chances (first, second, third or fourth, fifth to eighth,
 * not picked) from an elimination point histogram and the not selected draws,
 * point values from `playoffPoints`, mirroring `districtPlayoffOutcomes`' not
 * picked split: not picked is the smaller of the not selected share and the
 * zero point share, and fifth to eighth is the rest of the zero point share.
 */
export function playoffBucketChances(
  season: number,
  tier: DistrictTier,
  elimHistogram: Int32Array,
  notSelectedDraws: number,
  draws: number
): number[] {
  const points = [1, 2, 3, 4].map((placement) => playoffPoints(season, tier, placement));
  const at = (value: number): number => (elimHistogram[value] ?? 0) / draws;
  const zero = at(0);
  const notPicked = Math.min(Math.max(0, notSelectedDraws / draws), zero);
  const chances = [at(points[0]!), at(points[1]!), at(points[2]!) + at(points[3]!), zero - notPicked, notPicked];
  const total = chances.reduce((a, b) => a + b, 0);
  if (Math.abs(total - 1) > 1e-9) throw new PlayoffBucketMassError(`the five buckets hold ${String(total)} of the mass, not 1`);
  return chances;
}

/** The bucket a real placement falls in: 1 first, 2 second, 3 or 4 third or fourth, 5 to 8 fifth to eighth. */
export function placementBucket(placement: number): number {
  if (placement === 1) return 0;
  if (placement === 2) return 1;
  if (placement <= 4) return 2;
  return 3;
}

/**
 * The real placement of every alliance from its played sf and f rows, through
 * the shipped `bracketDecisionsFromPlayedMatches` and `routePlayedBracket`, or
 * `undefined` when the played rows do not place all eight alliances.
 */
export function realPlacements(matches: readonly PlayedBracketMatch[]): ReadonlyMap<number, number> | undefined {
  const routed = routePlayedBracket(bracketDecisionsFromPlayedMatches(matches));
  return routed.placementByAlliance.size === SCORED_ALLIANCE_COUNT ? routed.placementByAlliance : undefined;
}

/** One arm's primary scores over a set of teams. */
export interface ArmScore {
  readonly teams: number;
  readonly brier: number | undefined;
  readonly logLoss01: number | undefined;
  readonly logLoss001: number | undefined;
  readonly accuracy: number | undefined;
  /** Teams the 50% call gets wrong. For a point mass arm, the teams called wrong outright. */
  readonly wrong: number;
}

export function scoreArm(predictions: readonly number[], outcomes: readonly number[]): ArmScore {
  let wrong = 0;
  for (let i = 0; i < predictions.length; i++) if ((predictions[i]! >= 0.5 ? 1 : 0) !== outcomes[i]) wrong++;
  return {
    teams: predictions.length,
    brier: brierScore(predictions, outcomes),
    logLoss01: logLoss(predictions, outcomes, PRIMARY_LOG_LOSS_EPS),
    logLoss001: logLoss(predictions, outcomes, SECONDARY_LOG_LOSS_EPS),
    accuracy: accuracyAtHalf(predictions, outcomes),
    wrong,
  };
}

export interface WinRuleVerdict {
  readonly win: boolean;
  readonly brierLower: boolean;
  readonly logLossLower: boolean;
  readonly accuracyNotLower: boolean;
}

/** Jacob's pre registered win rule: Brier lower AND log loss (0.01) lower AND accuracy the same or higher. */
export function winRuleVerdict(candidate: ArmScore, baseline: ArmScore): WinRuleVerdict {
  const brierLower = candidate.brier !== undefined && baseline.brier !== undefined && candidate.brier < baseline.brier;
  const logLossLower = candidate.logLoss01 !== undefined && baseline.logLoss01 !== undefined && candidate.logLoss01 < baseline.logLoss01;
  const accuracyNotLower = candidate.accuracy !== undefined && baseline.accuracy !== undefined && candidate.accuracy >= baseline.accuracy;
  return { win: brierLower && logLossLower && accuracyNotLower, brierLower, logLossLower, accuracyNotLower };
}

// ───────────────────────────── corpus reads ─────────────────────────────

interface EventRow {
  event_key: string;
  year: number;
  event_type: number;
}

export function selectEventRow(db: Corpus, eventKey: string): EventRow | undefined {
  return db.prepare(`SELECT event_key, year, event_type FROM events WHERE event_key = ?`).get(eventKey) as EventRow | undefined;
}

/** District Championship (2) and its divisions (5) are the dcmp tier; every other district event is the district tier. */
export function tierForEventType(eventType: number): DistrictTier {
  return eventType === 2 || eventType === 5 ? "dcmp" : "district";
}

/** One event's real alliances and its corpus sf and f rows, as the structural event `playedBracketMatchesFor` reads. */
function bracketSourceFromCorpus(db: Corpus, eventKey: string, alliances: readonly EventAllianceSelection[]): BracketSourceEvent {
  const matches = selectMatchesChronological(db, { eventKey })
    .filter((match) => match.compLevel === "sf" || match.compLevel === "f")
    .map((match) => ({
      matchKey: match.matchKey,
      compLevel: match.compLevel,
      setNumber: match.setNumber,
      matchNumber: match.matchNumber,
      redTeams: match.redTeams,
      blueTeams: match.blueTeams,
      // A tie carries no winner in an elimination bracket.
      ...(match.winner === "red" || match.winner === "blue" ? { actualWinner: match.winner } : {}),
    }));
  return { alliances: alliances.map((a) => ({ allianceNumber: a.allianceNumber, picks: [...a.picks] })), matches };
}

// ───────────────────────────── the quals done input ─────────────────────────────

/** One scored event's real facts. */
export interface ScoredEvent {
  readonly eventKey: string;
  readonly season: number;
  readonly tier: DistrictTier;
  readonly alliances: readonly EventAllianceSelection[];
  readonly rankByTeam: ReadonlyMap<string, number>;
  readonly fieldSize: number;
  readonly boundary: ReadonlyMap<string, BoundaryRating>;
}

/**
 * Why an event cannot be scored, or `null` when it can. The 10-02 rule plus
 * the simulation's own rating requirement, in this order: not exactly eight
 * alliances; an alliance team (backup included) with no ranking row; a ranked
 * team with no boundary total or no positive finite sigma.
 */
export function eventExclusionReason(
  alliances: readonly EventAllianceSelection[],
  rankByTeam: ReadonlyMap<string, number>,
  boundary: ReadonlyMap<string, BoundaryRating> | undefined
): string | null {
  if (alliances.length !== SCORED_ALLIANCE_COUNT) return `${String(alliances.length)} alliances, not ${String(SCORED_ALLIANCE_COUNT)}`;
  const unranked = alliances.flatMap((a) => a.picks).filter((key) => !rankByTeam.has(key));
  if (unranked.length > 0) return `alliance team(s) with no ranking row: ${unranked.join(", ")}`;
  const unrated: string[] = [];
  for (const teamKey of rankByTeam.keys()) {
    const rating = boundary?.get(teamKey);
    if (rating === undefined || !Number.isFinite(rating.total) || rating.sigma === undefined || !Number.isFinite(rating.sigma) || rating.sigma <= 0) {
      unrated.push(teamKey);
    }
  }
  if (unrated.length > 0) return `ranked team(s) with no boundary total or no positive finite sigma: ${unrated.join(", ")}`;
  return null;
}

/** The exclusion reason's category, for the counted census. */
function exclusionCategory(reason: string): string {
  if (reason.includes("alliances, not")) return "not eight alliances";
  if (reason.includes("no ranking row")) return "alliance team with no ranking row";
  return "ranked team with no boundary total or sigma";
}

/** Ratings from the boundary pair, keyed by team. */
export function boundaryMemberRatings(boundary: ReadonlyMap<string, BoundaryRating>, teams: Iterable<string>): Map<string, AllianceMemberRating> {
  const out = new Map<string, AllianceMemberRating>();
  for (const teamKey of teams) {
    const rating = boundary.get(teamKey);
    out.set(teamKey, { teamKey, total: rating?.total, sigma: rating?.sigma });
  }
  return out;
}

/**
 * The QUALS DONE input: zero remaining matches, baselines reproducing the real
 * final ranking, the real alliance count, ratings as given, no award profile
 * and an empty `knownAwardPoints` map (awards play no part in who is picked).
 */
export function qualsDoneInput(
  event: ScoredEvent,
  ratings: ReadonlyMap<string, AllianceMemberRating>,
  options: { readonly pickPositionPmf?: PickPositionPmf; readonly knownAlliances?: readonly SuppliedAlliance[] } = {}
): DistrictLedgerEventInput {
  const baselines = qualsDoneBaselines(event.rankByTeam);
  return {
    eventKey: event.eventKey,
    season: event.season,
    tier: event.tier,
    fieldSize: Math.max(event.fieldSize, baselines.length),
    allianceCount: event.alliances.length,
    remainingMatches: [],
    baselines,
    ratings,
    awardProfiles: new Map(),
    knownAwardPoints: new Map(),
    ...(options.pickPositionPmf === undefined ? {} : { pickPositionPmf: options.pickPositionPmf }),
    ...(options.knownAlliances === undefined ? {} : { knownAlliances: options.knownAlliances }),
  };
}

/** Raised when a fixed draft arm at quals done is not a point mass, which would mean the arm is not what it claims to be. */
export class FixedDraftNotPointMassError extends Error {
  constructor(message: string) {
    super(`measureRandomPickDraft: ${message}`);
    this.name = "FixedDraftNotPointMassError";
  }
}

/** Asserts a fixed draft run at quals done: `rankingFixed` and every chance exactly 0 or 1. */
export function assertPointMass(label: string, eventKey: string, result: DistrictLedgerResult, chances: ReadonlyMap<string, number>): void {
  if (!result.rankingFixed) throw new FixedDraftNotPointMassError(`${label} at ${eventKey}: rankingFixed is false`);
  const off = [...chances].filter(([, p]) => p !== 0 && p !== 1).map(([key, p]) => `${key}=${String(p)}`);
  if (off.length > 0) throw new FixedDraftNotPointMassError(`${label} at ${eventKey}: chances not 0 or 1: ${off.join(", ")}`);
}

/** Raised when the per draw slot tally disagrees with the run's own not selected count. A measurement bug, never swallowed. */
export class SlotTallyMismatchError extends Error {
  constructor(message: string) {
    super(`measureRandomPickDraft: ${message}`);
    this.name = "SlotTallyMismatchError";
  }
}

// ───────────────────────────── one event, every arm ─────────────────────────────

export type ArmId = "a" | "b" | "b2" | "c";
export const ARM_IDS: readonly ArmId[] = ["a", "b", "b2", "c"];
export const ARM_LABELS: Readonly<Record<ArmId, string>> = {
  a: "(a) fixed SPR draft",
  b: "(b) random pick, primary tables",
  b2: "(b2) random pick, sensitivity tables",
  c: "(c) fixed rank draft",
};

export interface ArmPrediction {
  readonly on: number;
  readonly slots: readonly number[];
  readonly bucket: readonly number[] | undefined;
}

export interface TeamRecord {
  readonly eventKey: string;
  readonly season: number;
  readonly teamKey: string;
  readonly rank: number;
  readonly realOn: 0 | 1;
  readonly realSlot: number;
  readonly realBucket: number | undefined;
  readonly arms: Partial<Record<ArmId, ArmPrediction>>;
  readonly stabilityOn?: number;
}

interface ArmRun {
  readonly result: DistrictLedgerResult;
  readonly slotProbabilities: Map<string, number[]>;
  readonly draw0Alliances: string[][];
}

/** One simulation run with the per draw exact slot tally and a copy of draw 0's alliances. */
function runWithSlots(input: DistrictLedgerEventInput, draws: number, seed: number): ArmRun {
  const teamCount = input.baselines.length;
  const teamIndex = new Map(input.baselines.map((b, i) => [b.teamKey, i]));
  const counts = new Int32Array(teamCount * SLOT_CLASS_COUNT);
  const seen = new Uint8Array(teamCount);
  let draw0Alliances: string[][] = [];
  const result = simulateDistrictEvent(input, draws, seed, (observation) => {
    seen.fill(0);
    observation.alliances.forEach((members, n) => {
      for (let slot = 0; slot < members.length && slot < DRAFTED_SLOTS; slot++) {
        const i = teamIndex.get(members[slot]!)!;
        counts[i * SLOT_CLASS_COUNT + n * DRAFTED_SLOTS + slot]! += 1;
        seen[i] = 1;
      }
    });
    for (let i = 0; i < teamCount; i++) if (seen[i] === 0) counts[i * SLOT_CLASS_COUNT + NONE_SLOT_CLASS]! += 1;
    if (observation.draw === 0) draw0Alliances = observation.alliances.map((members) => [...members]);
  });
  const slotProbabilities = new Map<string, number[]>();
  input.baselines.forEach((baseline, i) => {
    const vector: number[] = [];
    for (let k = 0; k < SLOT_CLASS_COUNT; k++) vector.push(counts[i * SLOT_CLASS_COUNT + k]! / draws);
    const notSelected = result.selectionRoutes.get(baseline.teamKey)!.notSelectedDraws;
    if (counts[i * SLOT_CLASS_COUNT + NONE_SLOT_CLASS]! !== notSelected) {
      throw new SlotTallyMismatchError(`${input.eventKey} ${baseline.teamKey}: tally ${String(counts[i * SLOT_CLASS_COUNT + NONE_SLOT_CLASS])} none vs ${String(notSelected)} not selected`);
    }
    slotProbabilities.set(baseline.teamKey, vector);
  });
  return { result, slotProbabilities, draw0Alliances };
}

function bucketsFor(event: ScoredEvent, result: DistrictLedgerResult): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const [teamKey, histogram] of result.elimPoints) {
    out.set(teamKey, playoffBucketChances(event.season, event.tier, histogram, result.selectionRoutes.get(teamKey)!.notSelectedDraws, result.draws));
  }
  return out;
}

export interface EventScoreOptions {
  readonly draws: number;
  readonly seed: number;
  readonly primary: PickPositionPmf;
  readonly sensitivity: PickPositionPmf | undefined;
  readonly stability: boolean;
}

export interface EventScore {
  readonly records: TeamRecord[];
  /** Why the real playoff bucket is unavailable at this event, or `undefined` when it is. */
  readonly playoffExclusion: string | undefined;
  /** Why (c)'s playoff bucket is unavailable, or `undefined`. */
  readonly rankBucketExclusion: string | undefined;
}

/** Runs every arm at one event's quals done position and pairs each team's predictions with the real outcomes. */
export function scoreEvent(db: Corpus, event: ScoredEvent, options: EventScoreOptions): EventScore {
  const { draws, seed } = options;
  const ratings = boundaryMemberRatings(event.boundary, event.rankByTeam.keys());

  const runs: Partial<Record<ArmId, ArmRun>> = {};
  const fixed = runWithSlots(qualsDoneInput(event, ratings), draws, seed);
  assertPointMass(ARM_LABELS.a, event.eventKey, fixed.result, onAllianceChances(fixed.result));
  runs.a = fixed;
  runs.b = runWithSlots(qualsDoneInput(event, ratings, { pickPositionPmf: options.primary }), draws, seed);
  if (options.sensitivity !== undefined) {
    runs.b2 = runWithSlots(qualsDoneInput(event, ratings, { pickPositionPmf: options.sensitivity }), draws, seed);
  }
  const rank = runWithSlots(qualsDoneInput(event, rankOrderRatings(ratings, event.rankByTeam)), draws, seed);
  assertPointMass(ARM_LABELS.c, event.eventKey, rank.result, onAllianceChances(rank.result));
  runs.c = rank;

  // (c)'s playoff bucket: its draft as known alliances, priced from the REAL ratings.
  let rankBuckets: Map<string, number[]> | undefined;
  let rankBucketExclusion: string | undefined;
  if (rank.draw0Alliances.some((members) => members.length === 0)) {
    rankBucketExclusion = "the rank draft left a filler alliance";
  } else {
    const knownAlliances: SuppliedAlliance[] = rank.draw0Alliances.map((picks, n) => ({ allianceNumber: n + 1, picks }));
    const rerun = simulateDistrictEvent(qualsDoneInput(event, ratings, { knownAlliances }), draws, seed);
    rankBuckets = bucketsFor(event, rerun);
  }

  const stabilityChances =
    options.stability
      ? onAllianceChances(simulateDistrictEvent(qualsDoneInput(event, ratings, { pickPositionPmf: options.primary }), draws, seed + 1))
      : undefined;

  // The real outcomes.
  const realSlotByTeam = realSlots(event.alliances);
  let realPlacementByAlliance: ReadonlyMap<number, number> | undefined;
  let playoffExclusion: string | undefined;
  try {
    const played = playedBracketMatchesFor(bracketSourceFromCorpus(db, event.eventKey, event.alliances));
    if (played.unresolvedMatchKeys.length > 0) {
      playoffExclusion = `unresolved playoff rows: ${played.unresolvedMatchKeys.join(", ")}`;
    } else {
      realPlacementByAlliance = realPlacements(played.matches);
      if (realPlacementByAlliance === undefined) playoffExclusion = "the played rows place fewer than 8 alliances";
    }
  } catch (error) {
    playoffExclusion = `routing the real bracket threw ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
  }

  const bucketsByArm: Partial<Record<ArmId, Map<string, number[]>>> = {
    a: bucketsFor(event, fixed.result),
    b: bucketsFor(event, runs.b.result),
    ...(runs.b2 === undefined ? {} : { b2: bucketsFor(event, runs.b2.result) }),
    ...(rankBuckets === undefined ? {} : { c: rankBuckets }),
  };

  const records: TeamRecord[] = [];
  const order = [...event.rankByTeam.entries()].sort((x, y) => x[1] - y[1]);
  for (const [teamKey, teamRank] of order) {
    const realSlot = realSlotByTeam.get(teamKey) ?? NONE_SLOT_CLASS;
    const realOn: 0 | 1 = realSlot === NONE_SLOT_CLASS ? 0 : 1;
    let realBucket: number | undefined;
    if (realPlacementByAlliance !== undefined) {
      realBucket = realOn === 0 ? NOT_PICKED_BUCKET : placementBucket(realPlacementByAlliance.get(Math.floor(realSlot / DRAFTED_SLOTS) + 1)!);
    }
    const arms: Partial<Record<ArmId, ArmPrediction>> = {};
    for (const arm of ARM_IDS) {
      const run = runs[arm];
      if (run === undefined) continue;
      arms[arm] = {
        on: 1 - run.result.selectionRoutes.get(teamKey)!.notSelectedDraws / draws,
        slots: run.slotProbabilities.get(teamKey)!,
        bucket: bucketsByArm[arm]?.get(teamKey),
      };
    }
    records.push({
      eventKey: event.eventKey,
      season: event.season,
      teamKey,
      rank: teamRank,
      realOn,
      realSlot,
      realBucket,
      arms,
      ...(stabilityChances === undefined ? {} : { stabilityOn: stabilityChances.get(teamKey)! }),
    });
  }
  return { records, playoffExclusion, rankBucketExclusion };
}

// ───────────────────────────── reporting helpers ─────────────────────────────

function flagValue(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

function intFlag(args: readonly string[], name: string, fallback: number): number {
  const raw = flagValue(args, name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be an integer, got ${raw}`);
  return parsed;
}

function pct(value: number | undefined, digits = 1): string {
  return value === undefined || !Number.isFinite(value) ? "n/a" : `${(value * 100).toFixed(digits)}%`;
}

function num(value: number | undefined, digits = 4): string {
  return value === undefined || !Number.isFinite(value) ? "n/a" : value.toFixed(digits);
}

function progress(line: string): void {
  process.stderr.write(`${line}\n`);
}

function armScoreFor(records: readonly TeamRecord[], arm: ArmId): ArmScore {
  const predictions: number[] = [];
  const outcomes: number[] = [];
  for (const record of records) {
    const prediction = record.arms[arm];
    if (prediction === undefined) continue;
    predictions.push(prediction.on);
    outcomes.push(record.realOn);
  }
  return scoreArm(predictions, outcomes);
}

const POINT_MASS_ARMS: ReadonlySet<ArmId> = new Set<ArmId>(["a", "c"]);

function armScoreLine(label: string, arm: ArmId, score: ArmScore): string {
  const wrong = POINT_MASS_ARMS.has(arm) ? `   teams called wrong: ${String(score.wrong)} of ${String(score.teams)}` : "";
  return (
    `   ${label.padEnd(8)} ${ARM_LABELS[arm].padEnd(34)} ${String(score.teams).padStart(6)}   ${num(score.brier).padStart(7)}   ` +
    `${num(score.logLoss01).padStart(7)}   ${num(score.logLoss001).padStart(7)}   ${pct(score.accuracy, 2).padStart(7)}${wrong}`
  );
}

const RANK_BANDS: readonly { readonly label: string; readonly low: number; readonly high: number }[] = [
  { label: "1 to 8", low: 1, high: 8 },
  { label: "9 to 16", low: 9, high: 16 },
  { label: "17 to 24", low: 17, high: 24 },
  { label: "25 and below", low: 25, high: Number.POSITIVE_INFINITY },
];

interface Exclusion {
  readonly eventKey: string;
  readonly reason: string;
}

interface VerdictReport {
  readonly label: string;
  readonly seasons: number[];
  readonly candidate: ArmScore;
  readonly baseline: ArmScore;
  readonly verdict: WinRuleVerdict;
  readonly seasonsBrierLower: number;
}

function verdictFor(records: readonly TeamRecord[], arm: ArmId, label: string): VerdictReport {
  const scored = records.filter((r) => r.arms[arm] !== undefined);
  const seasons = [...new Set(scored.map((r) => r.season))].sort((a, b) => a - b);
  const candidate = armScoreFor(scored, arm);
  const baseline = armScoreFor(scored, "a");
  let seasonsBrierLower = 0;
  for (const season of seasons) {
    const inSeason = scored.filter((r) => r.season === season);
    if ((armScoreFor(inSeason, arm).brier ?? Infinity) < (armScoreFor(inSeason, "a").brier ?? Infinity)) seasonsBrierLower++;
  }
  return { label, seasons, candidate, baseline, verdict: winRuleVerdict(candidate, baseline), seasonsBrierLower };
}

function printVerdict(report: VerdictReport): void {
  const yes = (flag: boolean): string => (flag ? "yes" : "no");
  console.log(
    `VERDICT ${report.label}, pooled over ${report.seasons.join(", ")}: ${report.verdict.win ? "WIN" : "NO WIN"} ` +
      `(Brier ${num(report.candidate.brier)} vs ${num(report.baseline.brier)}, lower: ${yes(report.verdict.brierLower)}; ` +
      `log loss 0.01 ${num(report.candidate.logLoss01)} vs ${num(report.baseline.logLoss01)}, lower: ${yes(report.verdict.logLossLower)}; ` +
      `accuracy ${pct(report.candidate.accuracy, 2)} vs ${pct(report.baseline.accuracy, 2)}, same or higher: ${yes(report.verdict.accuracyNotLower)}; ` +
      `Brier lower in ${String(report.seasonsBrierLower)} of ${String(report.seasons.length)} seasons)`
  );
}

// ───────────────────────────── the full run ─────────────────────────────

interface RunOptions {
  readonly scoredSeasons: number[];
  readonly replayFrom: number;
  readonly trainFrom: number;
  readonly sensitivityTrainFrom: number;
  readonly draws: number;
  readonly seed: number;
  readonly stability: boolean;
  readonly jsonPath: string | undefined;
  readonly limitEvents: number | undefined;
  readonly argv: readonly string[];
}

function runFull(db: Corpus, options: RunOptions): number {
  const { scoredSeasons, replayFrom, trainFrom, sensitivityTrainFrom, draws, seed } = options;
  const lastSeason = scoredSeasons[scoredSeasons.length - 1]!;
  const replayWindow = parseSeasons(`${String(Math.min(replayFrom, scoredSeasons[0]!))}-${String(lastSeason)}`);
  const sprAlgorithms = resolvePublishAlgorithms("spr").map((a) => `${a.id}@${String(a.version)}`);

  console.log(`RANDOM PICK DRAFT MEASUREMENT (quick task 261014-mji)`);
  console.log(`command:        npx tsx scripts/measureRandomPickDraft.ts ${options.argv.join(" ")}`);
  console.log(`scored seasons: ${scoredSeasons.join(", ")} at the quals done position`);
  console.log(`SPR replay:     ${replayWindow[0]!} to ${String(lastSeason)} (${sprAlgorithms.join(", ")}), boundary = SPR after each team's last qualification match`);
  console.log(`tables:         primary ${String(trainFrom)} to Y-1; sensitivity ${String(sensitivityTrainFrom)} to Y-1 (only for Y > ${String(sensitivityTrainFrom)})`);
  console.log(`draws ${String(draws)}, seed ${String(seed)}${options.stability ? `, stability rerun of (b) at seed ${String(seed + 1)}` : ""}`);
  console.log(`credential:     none. Read only corpus, no network request, no environment variable.`);
  console.log(``);

  progress(`replaying SPR ${String(replayWindow[0])} to ${String(lastSeason)} ...`);
  const ratingsByEvent = boundaryRatingsByEvent(db, replayWindow, replayFrom);
  const census = emptyCensus();
  const pick = measurePickOrderHalf(db, replayWindow, replayFrom, census, boundaryTotalsFromRatings(ratingsByEvent));
  progress(`replay done: ${String(pick.turns.length)} pick turns over ${String(pick.eventsScored)} events`);

  console.log(`══ CENSUS: pick turns for the tables (measurePickOrderHalf over ${String(replayWindow[0])} to ${String(lastSeason)}) ══`);
  for (const [key, value] of Object.entries(census)) {
    if (key.startsWith("captain") || key === "eventsConsideredCaptainWindow") continue;
    console.log(`   ${key.padEnd(34)} ${String(value)}`);
  }
  console.log(``);

  // ── comparability ──
  console.log(`══ COMPARABILITY: where real picks sat in the SPR ordered available list ══`);
  console.log(`   This run warms SPR from ${String(replayWindow[0])}; the published 10-02 figures (42.91% first, 22.34% second, 32.62% pooled exact, 60.51% top 3) started cold in 2026, so 2026 rows here differ slightly.`);
  console.log(`   season  round    turns    exact    top 3    mean   median   p90`);
  const turnSeasons = [...new Set(pick.turns.map((t) => t.season))].sort((a, b) => a - b);
  const comparability: unknown[] = [];
  for (const season of turnSeasons) {
    for (const round of [1, 2] as const) {
      const turns = pick.turns.filter((t) => t.season === season && t.round === round);
      const stats = modelRankStats(turns);
      comparability.push({ season, round, turns: turns.length, exact: exactAgreement(turns), top3: top3Agreement(turns), ...stats });
      console.log(
        `   ${String(season).padEnd(7)} ${(round === 1 ? "first" : "second").padEnd(7)} ${String(turns.length).padStart(6)}   ${pct(exactAgreement(turns)).padStart(6)}   ` +
          `${pct(top3Agreement(turns)).padStart(6)}   ${num(stats?.mean, 2).padStart(5)}   ${num(stats?.median, 1).padStart(6)}   ${num(stats?.p90, 0).padStart(3)}`
      );
    }
  }
  console.log(``);

  const tablesBySeason = new Map<number, { primary: PickPositionTables; sensitivity: PickPositionTables | undefined }>();
  console.log(`   scored season tables (turns / deepest position; picks of that season deeper than the table's deepest position, which the random draft could never make)`);
  const tableReport: unknown[] = [];
  for (const season of scoredSeasons) {
    const primary = pickPositionTables(pick.turns, season, trainFrom);
    const sensitivity = season > sensitivityTrainFrom ? pickPositionTables(pick.turns, season, sensitivityTrainFrom) : undefined;
    tablesBySeason.set(season, { primary, sensitivity });
    const own = pick.turns.filter((t) => t.season === season);
    const deeper = (pmf: PickPositionPmf): [number, number] => [
      own.filter((t) => t.round === 1 && t.modelRank > pmf.firstPick.length).length,
      own.filter((t) => t.round === 2 && t.modelRank > pmf.secondPick.length).length,
    ];
    const describe = (label: string, tables: PickPositionTables | undefined): string => {
      if (tables === undefined) return `${label}: not run`;
      const [d1, d2] = deeper(tables.pmf);
      return (
        `${label}: first ${String(tables.firstTurns)} turns / ${String(tables.pmf.firstPick.length)} deep (pos 1 ${pct(tables.pmf.firstPick[0])}), ` +
        `second ${String(tables.secondTurns)} turns / ${String(tables.pmf.secondPick.length)} deep (pos 1 ${pct(tables.pmf.secondPick[0])}); ` +
        `deeper picks ${String(d1)} first, ${String(d2)} second`
      );
    };
    console.log(`   ${String(season)}  ${describe("primary", primary)}`);
    console.log(`         ${describe("sensitivity", sensitivity)}`);
    tableReport.push({ season, primary, sensitivity, primaryDeeper: deeper(primary.pmf), sensitivityDeeper: sensitivity ? deeper(sensitivity.pmf) : undefined });
  }
  console.log(``);

  // ── population and runs ──
  const records: TeamRecord[] = [];
  const exclusions: (Exclusion & { category: string })[] = [];
  const noAllianceEvents: string[] = [];
  const simThrew: Exclusion[] = [];
  const playoffExclusions: Exclusion[] = [];
  const rankBucketExclusions: Exclusion[] = [];
  const scoredEventsBySeason = new Map<number, number>();
  let budget = options.limitEvents ?? Number.POSITIVE_INFINITY;

  for (const season of scoredSeasons) {
    const alliancesByEvent = selectEventAlliancesForSeason(db, season);
    const rankingsByEvent = selectEventRankingsForSeason(db, season);
    const tables = tablesBySeason.get(season)!;
    let scoredInSeason = 0;
    const keys = selectDistrictEventKeys(db, season);
    for (const eventKey of keys) {
      if (budget <= 0) break;
      const alliances = alliancesByEvent.get(eventKey);
      if (alliances === undefined || alliances.length === 0) {
        noAllianceEvents.push(eventKey);
        continue;
      }
      const rankRows = rankingsByEvent.get(eventKey) ?? new Map();
      const rankByTeam = new Map<string, number>();
      let totalTeams = 0;
      for (const [teamKey, r] of rankRows) {
        rankByTeam.set(teamKey, r.rank);
        if (r.totalTeams > totalTeams) totalTeams = r.totalTeams;
      }
      const boundary = ratingsByEvent.get(eventKey);
      const reason = eventExclusionReason(alliances, rankByTeam, boundary);
      if (reason !== null) {
        exclusions.push({ eventKey, reason, category: exclusionCategory(reason) });
        continue;
      }
      const row = selectEventRow(db, eventKey)!;
      const event: ScoredEvent = { eventKey, season, tier: tierForEventType(row.event_type), alliances, rankByTeam, fieldSize: totalTeams, boundary: boundary! };
      let score: EventScore;
      try {
        score = scoreEvent(db, event, { draws, seed, primary: tables.primary.pmf, sensitivity: tables.sensitivity?.pmf, stability: options.stability });
      } catch (error) {
        // A measurement assertion is a bug in this script and stops the run.
        if (error instanceof FixedDraftNotPointMassError || error instanceof SlotTallyMismatchError || error instanceof PlayoffBucketMassError) throw error;
        simThrew.push({ eventKey, reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
        continue;
      }
      records.push(...score.records);
      if (score.playoffExclusion !== undefined) playoffExclusions.push({ eventKey, reason: score.playoffExclusion });
      if (score.rankBucketExclusion !== undefined) rankBucketExclusions.push({ eventKey, reason: score.rankBucketExclusion });
      scoredInSeason++;
      budget--;
    }
    scoredEventsBySeason.set(season, scoredInSeason);
    progress(`season ${String(season)}: ${String(scoredInSeason)} events scored`);
  }

  // ── scoring census ──
  console.log(`══ CENSUS: scored population (district events, non-null district_key, in ${scoredSeasons.join(", ")}) ══`);
  for (const season of scoredSeasons) {
    const teams = records.filter((r) => r.season === season).length;
    console.log(`   ${String(season)}: ${String(scoredEventsBySeason.get(season) ?? 0)} events scored, ${String(teams)} teams`);
  }
  console.log(`   pooled: ${String([...scoredEventsBySeason.values()].reduce((a, b) => a + b, 0))} events, ${String(records.length)} teams`);
  console.log(`   district events with no alliance rows (not in the population, as in 10-02): ${String(noAllianceEvents.length)}${noAllianceEvents.length > 0 ? ` (${noAllianceEvents.join(", ")})` : ""}`);
  const categories = [...new Set(exclusions.map((e) => e.category))];
  for (const category of categories) {
    const inCategory = exclusions.filter((e) => e.category === category);
    console.log(`   EXCLUDED, ${category}: ${String(inCategory.length)}`);
    for (const e of inCategory) console.log(`      ${e.eventKey}: ${e.reason}`);
  }
  console.log(`   EXCLUDED, the simulation threw: ${String(simThrew.length)}`);
  for (const e of simThrew) console.log(`      ${e.eventKey}: ${e.reason}`);
  console.log(`   left out of the PLAYOFF BUCKET score only: ${String(playoffExclusions.length)}`);
  for (const e of playoffExclusions) console.log(`      ${e.eventKey}: ${e.reason}`);
  if (rankBucketExclusions.length > 0) {
    console.log(`   (c) playoff bucket unavailable: ${String(rankBucketExclusions.length)}`);
    for (const e of rankBucketExclusions) console.log(`      ${e.eventKey}: ${e.reason}`);
  }
  if (options.limitEvents !== undefined) console.log(`   SMOKE RUN: --limit-events ${String(options.limitEvents)}; not a measurement.`);
  console.log(``);

  // ── primary scores ──
  console.log(`══ PRIMARY: chance of being on an alliance (captain or pick; a backup is not) ══`);
  console.log(`   season   arm                                 teams     Brier   LL 0.01  LL 0.001  accuracy`);
  const armScores: Record<string, Record<string, ArmScore>> = {};
  for (const season of [...scoredSeasons, 0]) {
    const inScope = season === 0 ? records : records.filter((r) => r.season === season);
    const label = season === 0 ? "POOLED" : String(season);
    armScores[label] = {};
    for (const arm of ARM_IDS) {
      const score = armScoreFor(inScope, arm);
      if (score.teams === 0) continue;
      armScores[label]![arm] = score;
      console.log(armScoreLine(label, arm, score));
    }
  }
  console.log(``);

  // ── calibration ──
  console.log(`══ CALIBRATION, pooled per arm (n / mean predicted / observed rate) ══`);
  const calibration: Record<string, CalibrationRow[]> = {};
  for (const arm of ARM_IDS) {
    const scoped = records.filter((r) => r.arms[arm] !== undefined);
    if (scoped.length === 0) continue;
    const table = calibrationTable(scoped.map((r) => r.arms[arm]!.on), scoped.map((r) => r.realOn));
    calibration[arm] = table;
    console.log(`   ${ARM_LABELS[arm]}`);
    for (const row of table) {
      console.log(`      ${row.label.padEnd(12)} ${String(row.n).padStart(6)}   ${pct(row.meanPredicted).padStart(6)}   ${pct(row.observed).padStart(6)}`);
    }
  }
  console.log(``);

  // ── rank bands ──
  console.log(`══ BRIER BY REAL RANK BAND, pooled ══`);
  console.log(`   band            ${ARM_IDS.map((arm) => arm.padStart(14)).join("")}   teams (a)`);
  const rankBands: Record<string, Record<string, number | undefined>> = {};
  for (const band of RANK_BANDS) {
    const inBand = records.filter((r) => r.rank >= band.low && r.rank <= band.high);
    rankBands[band.label] = {};
    const cells = ARM_IDS.map((arm) => {
      const b = armScoreFor(inBand, arm).brier;
      rankBands[band.label]![arm] = b;
      return num(b).padStart(14);
    });
    console.log(`   ${band.label.padEnd(15)} ${cells.join("")}   ${String(inBand.length)}`);
  }
  console.log(``);

  // ── the named example ──
  console.log(`══ NAMED EXAMPLE: 2026ncash ══`);
  const ncash = records.filter((r) => r.eventKey === "2026ncash");
  const example: unknown[] = [];
  if (ncash.length === 0) {
    console.log(`   2026ncash is not in this run's scored population.`);
  } else {
    const describeTeam = (r: TeamRecord): string =>
      `${r.teamKey} rank ${String(r.rank)}, real ${r.realOn === 1 ? `on (alliance ${String(Math.floor(r.realSlot / 3) + 1)}, slot ${String(r.realSlot % 3)})` : "off"}: ` +
      ARM_IDS.filter((arm) => r.arms[arm] !== undefined)
        .map((arm) => `${arm} ${pct(r.arms[arm]!.on)}`)
        .join(", ");
    const team = ncash.find((r) => r.teamKey === "frc6932");
    if (team !== undefined) {
      console.log(`   ${describeTeam(team)}`);
      example.push(team);
    }
    const wrong = ncash.filter((r) => (r.arms.a!.on >= 0.5 ? 1 : 0) !== r.realOn);
    console.log(`   every 2026ncash team (a) called wrong (${String(wrong.length)} of ${String(ncash.length)}):`);
    for (const r of wrong) console.log(`      ${describeTeam(r)}`);
  }
  console.log(``);

  // ── secondary ──
  console.log(`══ SECONDARY: exact alliance and slot (25 classes), playoff bucket (5 classes), pooled ══`);
  console.log(`   arm                                 slot teams  slot Brier  slot LL 0.01  slot LL 0.001   bucket teams  bucket Brier  bucket LL 0.01  bucket LL 0.001`);
  const secondary: Record<string, unknown> = {};
  for (const arm of ARM_IDS) {
    const slotScoped = records.filter((r) => r.arms[arm] !== undefined);
    if (slotScoped.length === 0) continue;
    const slotP = slotScoped.map((r) => r.arms[arm]!.slots);
    const slotY = slotScoped.map((r) => r.realSlot);
    const bucketScoped = records.filter((r) => r.realBucket !== undefined && r.arms[arm]?.bucket !== undefined);
    const bucketP = bucketScoped.map((r) => r.arms[arm]!.bucket!);
    const bucketY = bucketScoped.map((r) => r.realBucket!);
    const row = {
      slotTeams: slotScoped.length,
      slotBrier: multiclassBrier(slotP, slotY),
      slotLogLoss01: multiclassLogLoss(slotP, slotY, PRIMARY_LOG_LOSS_EPS),
      slotLogLoss001: multiclassLogLoss(slotP, slotY, SECONDARY_LOG_LOSS_EPS),
      bucketTeams: bucketScoped.length,
      bucketBrier: multiclassBrier(bucketP, bucketY),
      bucketLogLoss01: multiclassLogLoss(bucketP, bucketY, PRIMARY_LOG_LOSS_EPS),
      bucketLogLoss001: multiclassLogLoss(bucketP, bucketY, SECONDARY_LOG_LOSS_EPS),
    };
    secondary[arm] = row;
    console.log(
      `   ${ARM_LABELS[arm].padEnd(34)} ${String(row.slotTeams).padStart(10)}  ${num(row.slotBrier).padStart(10)}  ${num(row.slotLogLoss01).padStart(12)}  ${num(row.slotLogLoss001).padStart(13)}   ` +
        `${String(row.bucketTeams).padStart(12)}  ${num(row.bucketBrier).padStart(12)}  ${num(row.bucketLogLoss01).padStart(14)}  ${num(row.bucketLogLoss001).padStart(15)}`
    );
  }
  console.log(``);

  // ── stability ──
  let stability: unknown;
  if (options.stability) {
    const scoped = records.filter((r) => r.stabilityOn !== undefined);
    const base = scoreArm(scoped.map((r) => r.arms.b!.on), scoped.map((r) => r.realOn));
    const moved = scoreArm(scoped.map((r) => r.stabilityOn!), scoped.map((r) => r.realOn));
    stability = { seed, seedPlusOne: seed + 1, base, moved };
    console.log(
      `STABILITY (b) at seed ${String(seed + 1)} vs ${String(seed)}: pooled Brier ${num(moved.brier)} vs ${num(base.brier)} (change ${num((moved.brier ?? 0) - (base.brier ?? 0), 5)}), ` +
        `log loss 0.01 ${num(moved.logLoss01)} vs ${num(base.logLoss01)} (change ${num((moved.logLoss01 ?? 0) - (base.logLoss01 ?? 0), 5)}), ` +
        `accuracy ${pct(moved.accuracy, 2)} vs ${pct(base.accuracy, 2)}`
    );
    console.log(``);
  }

  // ── verdicts ──
  console.log(`══ VERDICTS under Jacob's pre registered win rule: pooled Brier lower AND pooled log loss (0.01) lower AND pooled accuracy the same or higher, against (a) ══`);
  const verdicts: VerdictReport[] = [verdictFor(records, "b", `(b) random pick, ${String(trainFrom)} onward tables, vs (a) fixed SPR draft`)];
  if (records.some((r) => r.arms.b2 !== undefined)) {
    verdicts.push(verdictFor(records, "b2", `(b2) random pick, ${String(sensitivityTrainFrom)} onward tables, vs (a) fixed SPR draft`));
  }
  verdicts.push(verdictFor(records, "c", `(c) fixed rank draft vs (a) fixed SPR draft`));
  for (const v of verdicts) printVerdict(v);
  const primaryWin = verdicts[0]!.verdict.win;
  const sensitivityVerdict = verdicts.find((v) => v.label.startsWith("(b2)"));
  if (sensitivityVerdict !== undefined) {
    // The same seasons as (b2), for a like for like reading beside it.
    const sameSeasons = records.filter((r) => r.arms.b2 !== undefined);
    const bSame = verdictFor(sameSeasons, "b", `(b) ${String(trainFrom)} onward tables over (b2)'s seasons only, vs (a)`);
    console.log(`   beside it, like for like: ${bSame.verdict.win ? "WIN" : "NO WIN"} for ${bSame.label} (Brier ${num(bSame.candidate.brier)} vs ${num(bSame.baseline.brier)}, log loss ${num(bSame.candidate.logLoss01)} vs ${num(bSame.baseline.logLoss01)}, accuracy ${pct(bSame.candidate.accuracy, 2)} vs ${pct(bSame.baseline.accuracy, 2)})`);
    console.log(
      primaryWin === sensitivityVerdict.verdict.win
        ? `   The two table sets AGREE: ${primaryWin ? "both WIN" : "neither wins"}.`
        : `   The two table sets DISAGREE. Not picking one: Jacob decides.`
    );
  }
  console.log(`   Brier and log loss alone (the plan's two part line, before accuracy): ${verdicts.map((v) => `${v.label.split(" ")[0]} ${v.verdict.brierLower && v.verdict.logLossLower ? "both lower" : "not both lower"}`).join("; ")}.`);
  console.log(``);

  if (options.jsonPath !== undefined) {
    writeFileSync(
      options.jsonPath,
      JSON.stringify(
        {
          command: `npx tsx scripts/measureRandomPickDraft.ts ${options.argv.join(" ")}`,
          date: new Date().toISOString(),
          scoredSeasons,
          replayWindow,
          sprAlgorithms,
          trainFrom,
          sensitivityTrainFrom,
          draws,
          seed,
          pickTurnCensus: census,
          comparability,
          tables: tableReport,
          population: {
            scoredEventsBySeason: Object.fromEntries(scoredEventsBySeason),
            teams: records.length,
            noAllianceEvents,
            exclusions,
            simThrew,
            playoffExclusions,
            rankBucketExclusions,
          },
          armScores,
          calibration,
          rankBands,
          secondary,
          stability,
          verdicts,
          example,
          teams: records.map((r) => ({
            eventKey: r.eventKey,
            season: r.season,
            teamKey: r.teamKey,
            rank: r.rank,
            realOn: r.realOn,
            realSlot: r.realSlot,
            realBucket: r.realBucket,
            on: Object.fromEntries(ARM_IDS.filter((arm) => r.arms[arm] !== undefined).map((arm) => [arm, r.arms[arm]!.on])),
            ...(r.stabilityOn === undefined ? {} : { stabilityOn: r.stabilityOn }),
          })),
        },
        null,
        2
      )
    );
    progress(`wrote ${options.jsonPath}`);
  }
  return 0;
}

// ───────────────────────────── the single event run ─────────────────────────────

function runSingleEvent(db: Corpus, eventKey: string, replayFrom: number, trainFrom: number, draws: number, seed: number): number {
  const row = selectEventRow(db, eventKey);
  if (row === undefined) {
    console.log(`EXCLUDED ${eventKey}: not in the corpus`);
    return 1;
  }
  const seasons = parseSeasons(`${String(replayFrom)}-${String(row.year)}`);
  const ratingsByEvent = boundaryRatingsByEvent(db, seasons, replayFrom);
  const pick = measurePickOrderHalf(db, seasons, replayFrom, emptyCensus(), boundaryTotalsFromRatings(ratingsByEvent));
  const tables = pickPositionTables(pick.turns, row.year, trainFrom);

  const alliances = selectEventAlliancesForSeason(db, row.year).get(eventKey) ?? [];
  const rankRows = selectEventRankingsForSeason(db, row.year).get(eventKey) ?? new Map();
  const rankByTeam = new Map<string, number>();
  let totalTeams = 0;
  for (const [teamKey, r] of rankRows) {
    rankByTeam.set(teamKey, r.rank);
    if (r.totalTeams > totalTeams) totalTeams = r.totalTeams;
  }
  const boundary = ratingsByEvent.get(eventKey);
  const reason = eventExclusionReason(alliances, rankByTeam, boundary);
  if (reason !== null) {
    console.log(`EXCLUDED ${eventKey}: ${reason}`);
    return 1;
  }
  const event: ScoredEvent = {
    eventKey,
    season: row.year,
    tier: tierForEventType(row.event_type),
    alliances,
    rankByTeam,
    fieldSize: totalTeams,
    boundary: boundary!,
  };
  const score = scoreEvent(db, event, { draws, seed, primary: tables.pmf, sensitivity: undefined, stability: false });

  console.log(`EVENT ${eventKey}, season ${String(row.year)}, tier ${event.tier}, ${String(rankByTeam.size)} ranked teams, ${String(draws)} draws, seed ${String(seed)}`);
  console.log(`SPR replay from ${String(replayFrom)}; tables from seasons ${String(trainFrom)} to ${String(row.year - 1)}`);
  console.log(
    `first pick table:  ${String(tables.firstTurns)} turns, position 1 share ${pct(tables.pmf.firstPick[0])}, deepest position ${String(tables.pmf.firstPick.length)}`
  );
  console.log(
    `second pick table: ${String(tables.secondTurns)} turns, position 1 share ${pct(tables.pmf.secondPick[0])}, deepest position ${String(tables.pmf.secondPick.length)}`
  );
  console.log(`   team        rank   real     (a) fixed SPR   (b) random pick   (c) fixed rank`);
  for (const r of score.records) {
    console.log(
      `   ${r.teamKey.padEnd(10)} ${String(r.rank).padStart(5)}   ${(r.realOn === 1 ? "on" : "off").padEnd(6)}   ${pct(r.arms.a!.on).padStart(13)}   ` +
        `${pct(r.arms.b!.on).padStart(15)}   ${pct(r.arms.c!.on).padStart(14)}`
    );
  }
  for (const arm of ["a", "b", "c"] as const) {
    console.log(`Brier ${ARM_LABELS[arm]}: ${num(armScoreFor(score.records, arm).brier)}`);
  }
  if (score.playoffExclusion !== undefined) console.log(`playoff bucket unavailable: ${score.playoffExclusion}`);
  return 0;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const replayFrom = intFlag(args, "--replay-from", 2016);
  const trainFrom = intFlag(args, "--train-from", 2016);
  const draws = intFlag(args, "--draws", SIMULATION_DRAWS);
  const seed = intFlag(args, "--seed", DEFAULT_SIMULATION_SEED);
  const eventKey = flagValue(args, "--event");

  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    if (eventKey !== undefined) {
      process.exitCode = runSingleEvent(db, eventKey, replayFrom, trainFrom, draws, seed);
      return;
    }
    const scoredSeasons = parseSeasons(flagValue(args, "--seasons") ?? "2023-2026");
    const early = scoredSeasons.filter((season) => season < FIRST_SCORABLE_SEASON);
    if (scoredSeasons.length === 0 || early.length > 0) {
      console.error(
        `--seasons must name seasons from ${String(FIRST_SCORABLE_SEASON)} on: the simulation's own bracket guard refuses ${early.join(", ") || "an empty list"}. ` +
          `Earlier seasons feed the tables through --train-from instead.`
      );
      process.exitCode = 1;
      return;
    }
    const limitRaw = flagValue(args, "--limit-events");
    process.exitCode = runFull(db, {
      scoredSeasons,
      replayFrom,
      trainFrom,
      sensitivityTrainFrom: intFlag(args, "--sensitivity-train-from", 2023),
      draws,
      seed,
      stability: args.includes("--stability"),
      jsonPath: flagValue(args, "--json"),
      limitEvents: limitRaw === undefined ? undefined : intFlag(args, "--limit-events", 0),
      argv: args,
    });
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
    console.error("measureRandomPickDraft failed:", err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    process.exit(1);
  });
}
