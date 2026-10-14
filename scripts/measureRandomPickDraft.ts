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
 * THE THREE ARMS, ALL THROUGH THE SHIPPED SIMULATION
 * ---------------------------------------------------------------------------
 *
 *   (a) today's fixed draft: `simulateDistrictEvent` with no pick option.
 *   (b) the random pick draft: the same call with `pickPositionPmf`, the
 *       measured pmf of where real picks sat in the still available list
 *       ordered by SPR (one pmf for first picks, one for second picks).
 *   (c) a fixed draft by qualification rank: the same call with no option and
 *       ratings whose `total` falls with rank, so the greedy pick takes the
 *       best ranked available team.
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
 * CREDENTIAL FREE AND OFFLINE
 * ---------------------------------------------------------------------------
 *
 * Read only corpus, no network request, no environment variable, no env file
 * flag. Nothing here is published: the option stays inert at default and no
 * caller in apps/ or packages/harness/ passes it.
 *
 * Usage:
 *   npx tsx scripts/measureRandomPickDraft.ts --event 2026ncash [--replay-from 2016] [--train-from 2016] [--draws 1000] [--seed 20260830]
 *
 * ---------------------------------------------------------------------------
 * MEASURED
 * ---------------------------------------------------------------------------
 *
 * (filled by Task 3 of quick task 261014-mji)
 */

import { pathToFileURL } from "node:url";
import { DEFAULT_SIMULATION_SEED, SIMULATION_DRAWS } from "../apps/web/src/workers/simulationProtocol.js";
import type { SimTeamBaseline } from "../packages/core/algorithms/simulation/rankSimulation.js";
import type { AllianceMemberRating } from "../packages/core/algorithms/simulation/allianceWinProbability.js";
import {
  simulateDistrictEvent,
  type DistrictLedgerEventInput,
  type DistrictLedgerResult,
  type PickPositionPmf,
} from "../packages/core/districts/ledgerSimulation.js";
import type { DistrictTier } from "../packages/core/districts/pointModel.js";
import {
  openCorpusReadOnly,
  selectEventAlliancesForSeason,
  selectEventRankingsForSeason,
  type Corpus,
  type EventAllianceSelection,
} from "../packages/corpus/db.js";
import {
  boundaryRatingsByEvent,
  boundaryTotalsFromRatings,
  emptyCensus,
  measurePickOrderHalf,
  SCORED_ALLIANCE_COUNT,
  type BoundaryRating,
  type TurnResult,
} from "./measureSelectionAgreement.js";
import { parseSeasons } from "./scriptHelpers.js";

const CORPUS_PATH = "data/corpus.sqlite";

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

/** Every team on an alliance in the REAL draft: picks 0 to 2 (captain, first, second). A backup (picks[3]) is not. */
export function realOnAlliance(alliances: readonly EventAllianceSelection[]): Set<string> {
  const on = new Set<string>();
  for (const alliance of alliances) {
    for (let slot = 0; slot < 3; slot++) {
      const key = alliance.picks[slot];
      if (key !== undefined) on.add(key);
    }
  }
  return on;
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
  pickPositionPmf?: PickPositionPmf
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
    ...(pickPositionPmf === undefined ? {} : { pickPositionPmf }),
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

// ───────────────────────────── the single event run ─────────────────────────────

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

function pct(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

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
  const ratings = boundaryMemberRatings(event.boundary, rankByTeam.keys());

  const fixed = simulateDistrictEvent(qualsDoneInput(event, ratings), draws, seed);
  const fixedChances = onAllianceChances(fixed);
  assertPointMass("(a) fixed SPR draft", eventKey, fixed, fixedChances);
  const random = simulateDistrictEvent(qualsDoneInput(event, ratings, tables.pmf), draws, seed);
  const randomChances = onAllianceChances(random);

  console.log(`EVENT ${eventKey}, season ${String(row.year)}, tier ${event.tier}, ${String(rankByTeam.size)} ranked teams, ${String(draws)} draws, seed ${String(seed)}`);
  console.log(`SPR replay from ${String(replayFrom)}; tables from seasons ${String(trainFrom)} to ${String(row.year - 1)}`);
  console.log(
    `first pick table:  ${String(tables.firstTurns)} turns, position 1 share ${pct(tables.pmf.firstPick[0])}, deepest position ${String(tables.pmf.firstPick.length)}`
  );
  console.log(
    `second pick table: ${String(tables.secondTurns)} turns, position 1 share ${pct(tables.pmf.secondPick[0])}, deepest position ${String(tables.pmf.secondPick.length)}`
  );
  const real = realOnAlliance(alliances);
  console.log(`   team        rank   real     (a) fixed SPR   (b) random pick`);
  const order = [...rankByTeam.entries()].sort((a, b) => a[1] - b[1]);
  const predictionsA: number[] = [];
  const predictionsB: number[] = [];
  const outcomes: number[] = [];
  for (const [teamKey, rank] of order) {
    const y = real.has(teamKey) ? 1 : 0;
    const a = fixedChances.get(teamKey)!;
    const b = randomChances.get(teamKey)!;
    predictionsA.push(a);
    predictionsB.push(b);
    outcomes.push(y);
    console.log(
      `   ${teamKey.padEnd(10)} ${String(rank).padStart(5)}   ${(y === 1 ? "on" : "off").padEnd(6)}   ${pct(a).padStart(13)}   ${pct(b).padStart(15)}`
    );
  }
  console.log(`Brier (a) fixed SPR draft:   ${brierScore(predictionsA, outcomes)!.toFixed(4)}`);
  console.log(`Brier (b) random pick draft: ${brierScore(predictionsB, outcomes)!.toFixed(4)}`);
  return 0;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const replayFrom = intFlag(args, "--replay-from", 2016);
  const trainFrom = intFlag(args, "--train-from", 2016);
  const draws = intFlag(args, "--draws", SIMULATION_DRAWS);
  const seed = intFlag(args, "--seed", DEFAULT_SIMULATION_SEED);
  const eventKey = flagValue(args, "--event");
  if (eventKey === undefined) throw new Error("--event KEY is required");

  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    process.exitCode = runSingleEvent(db, eventKey, replayFrom, trainFrom, draws, seed);
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
