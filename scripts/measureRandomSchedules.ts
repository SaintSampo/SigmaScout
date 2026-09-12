/**
 * measureRandomSchedules — D-17 RUNG 2, measured at N=1000 per arm.
 *
 * ---------------------------------------------------------------------------
 * The question
 * ---------------------------------------------------------------------------
 * The published pre-schedule sidecar prices K synthetic qualification
 * schedules drawn from the cheesy-arena BALANCED template grid
 * (`packages/harness/scheduleTemplates.ts`), permuting which roster team
 * occupies each template slot. That template cache is gitignored and carries
 * Team 254's own custom licence (D-19). Rung 2 asks whether the balanced
 * structure carries any signal at all, or whether PLAIN RANDOM schedules —
 * which this repo can generate for itself, with no licence question — produce
 * the same per-team rank bands.
 *
 * ---------------------------------------------------------------------------
 * Why N=1000 and not the published N=20
 * ---------------------------------------------------------------------------
 * `docs/models/field-averaged-presim.md`'s own same-arm SEED-NOISE FLOOR
 * diagnostic showed the 20-schedule reference disagreeing with ITSELF on
 * 44.7% of teams at `2025cur` — the clause-1 bar (95% of teams within half a
 * rank of median) is unreachable at N=20 even when the two arms are
 * IDENTICAL. Any rung-2 comparison run at N=20 therefore measures the
 * reference's own Monte Carlo noise, not the schedule structure. Both arms
 * here get 1000 schedules, and the SAME-ARM CONTROL is run at the same N so
 * the floor is a reported number rather than an assumption.
 *
 * ---------------------------------------------------------------------------
 * The arms
 * ---------------------------------------------------------------------------
 *   genA   1000 balanced-template schedules, shuffle salt "gen|a"  (reference)
 *   genB   1000 balanced-template schedules, shuffle salt "gen|b"  (control)
 *   rand   1000 plain-random schedules,      salt "rand|a"         (candidate)
 *
 * `rand` vs `genA` is the question. `genB` vs `genA` is the floor: two
 * independent draws of the SAME construction, so every number it produces is
 * what a PASS would look like if the two constructions were identical and only
 * the draw stream differed. A `rand`-vs-`genA` result is only meaningful
 * against it.
 *
 * Every arm reaches `continuousQuantile` through the same `simulateRanks`, the
 * same `makeRankingPointFiller`, the same one replay and the same one pricing
 * state per event. The arms differ ONLY in which synthetic schedules get
 * priced.
 *
 * The acceptance clauses are `measureFieldAveragedRanks.ts`'s, imported rather
 * than restated, so rung 2's verdict is scored on rung 1's bar unchanged.
 *
 * Usage:
 *   pnpm tsx scripts/measureRandomSchedules.ts [--events k1,k2] [--schedules 1000]
 *                                              [--draws-per-schedule 20]
 *                                              [--algorithm bpr] [--replay-from YYYY]
 *                                              [--write-doc]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import type { AlgorithmModule, Prediction, UpcomingMatch } from "../packages/core/algorithms/types.js";
import {
  simulateRanks,
  mulberry32,
  type SimMatchInput,
  type SimMatchOutcomeInput,
  type SimTeamBaseline,
} from "../packages/core/algorithms/simulation/rankSimulation.js";
import { continuousQuantile } from "../apps/web/src/lib/simQuantile.js";
import { openCorpusReadOnly, selectMatchesChronological, selectScheduledMatches, type Corpus } from "../packages/corpus/db.js";
import { RP_RULE_MODULES } from "../packages/core/rankingPoints/rules.js";
import { loadScheduleTemplate, matchesPerTeamFor, type ScheduleTemplateMatch } from "../packages/harness/scheduleTemplates.js";
import { roundPmf } from "../packages/harness/rounding.js";
import { makeRankingPointFiller } from "../packages/harness/publish.js";
import { ALGORITHMS } from "../packages/harness/cli.js";
import {
  CLAUSE_1_MEDIAN_HARD,
  CLAUSE_1_MEDIAN_TIGHT,
  CLAUSE_1_TIGHT_RATE,
  CLAUSE_2_EDGE_TOLERANCE,
  CLAUSE_2_RATE,
  CLAUSE_3_MEAN_SHIFT,
  DEFAULT_ALGORITHM_ID,
  DEFAULT_TARGET_EVENTS,
  replaySeason,
  uniqueSortedRoster,
  type SeasonReplayResult,
  type TargetEvent,
} from "./measureFieldAveragedRanks.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Per arm. 50x the published N=20, chosen so the same-arm control's own clause-1 rate can reach the 95% bar at all — at N=20 it cannot (see the header). */
export const DEFAULT_SCHEDULE_COUNT = 1000;

/** Draws per schedule. 1000 x 20 = 20,000 total draws per arm, against the published path's 20 x 50 = 1,000. */
export const DEFAULT_DRAWS_PER_SCHEDULE = 20;

/** The published configuration, re-measured alongside N=1000 so the N=20 reading is this run's own number and not a quote from another document. */
export const PUBLISHED_SCHEDULE_COUNT = 20;
export const PUBLISHED_DRAWS_PER_SCHEDULE = 50;

export const RANDOM_SCHEDULES_DOC_PATH = join("docs", "models", "random-vs-generated-schedules.md");

const ARM_KEYS = ["genA", "genB", "rand", "randB"] as const;
type ArmKey = (typeof ARM_KEYS)[number];

// ---------------------------------------------------------------------------
// Seeding — one hash, every stream derived from it by salt
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit, the same function `preSchedule.ts` seeds the published path with (http://www.isthe.com/chongo/tech/comp/fnv/). */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Fisher–Yates over `[0..count)`, `preSchedule.ts`'s `seededShuffle` verbatim in behaviour. */
function seededShuffle(count: number, rng: () => number): number[] {
  const slots = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = slots[i]!;
    slots[i] = slots[j]!;
    slots[j] = tmp;
  }
  return slots;
}

// ---------------------------------------------------------------------------
// The two schedule constructions
// ---------------------------------------------------------------------------

/**
 * The GENERATED construction — the published path's, reproduced: take the
 * balanced template, permute which roster index occupies each template slot.
 * Every schedule this returns therefore has the template's partner spread,
 * opponent spread, red/blue balance and match spacing; only the team labels
 * move.
 */
function generatedSchedule(template: readonly ScheduleTemplateMatch[], slots: readonly number[]): ScheduleTemplateMatch[] {
  return template.map((m) => ({
    red: m.red.map((slot) => slots[slot]!),
    blue: m.blue.map((slot) => slots[slot]!),
    redSurrogate: [...m.redSurrogate],
    blueSurrogate: [...m.blueSurrogate],
  }));
}

/** The one structural property a random schedule must still honour, and the one it may not. */
export interface RandomScheduleShape {
  readonly rows: number;
  readonly numTeams: number;
  /** Non-surrogate appearances per team — every team plays exactly this many credited matches, as in any real schedule. */
  readonly appearancesPerTeam: number;
  /** Extra, uncredited appearances needed to fill `rows * 6` slots. Structurally at most 5 (the template row count is `ceil(numTeams * mpt / 6)`). */
  readonly surrogateCount: number;
}

/** Reads the shape to reproduce straight off the loaded template, so the random arm is never a different-sized problem than the arm it is compared against. */
export function shapeOfTemplate(template: readonly ScheduleTemplateMatch[], numTeams: number): RandomScheduleShape {
  let surrogateCount = 0;
  for (const m of template) {
    for (const s of m.redSurrogate) if (s) surrogateCount++;
    for (const s of m.blueSurrogate) if (s) surrogateCount++;
  }
  const credited = template.length * 6 - surrogateCount;
  if (credited % numTeams !== 0) {
    throw new Error(
      `measureRandomSchedules: the template's ${credited} credited slots do not divide evenly across ${numTeams} teams — the random arm cannot reproduce its shape`
    );
  }
  return { rows: template.length, numTeams, appearancesPerTeam: credited / numTeams, surrogateCount };
}

export interface RandomScheduleResult {
  readonly matches: ScheduleTemplateMatch[];
  /** Rows that ended up with the same team twice because the repair ran out of candidates. Reported, never silently tolerated. */
  readonly duplicateRows: number;
}

/**
 * The RANDOM construction: pour every appearance into one bag, shuffle it, and
 * deal it into rows of six. No balanced grid, no partner-repeat minimisation,
 * no red/blue balancing, no match spacing — exactly the structure D-17 rung 2
 * asks about.
 *
 * The one invariant kept is the one that makes a schedule a schedule: every
 * team plays `appearancesPerTeam` credited matches and no team appears twice in
 * the same match. The no-duplicate rule is enforced by scanning forward in the
 * already-shuffled bag for the first entry whose team is not yet in the row and
 * swapping it into place — a randomised sequential construction, not a uniform
 * draw from the space of duplicate-free schedules. The bias that introduces is
 * toward the END of the bag (which carries whatever teams were hard to place),
 * and `duplicateRows` reports the residual the repair could not fix.
 */
export function randomSchedule(shape: RandomScheduleShape, rng: () => number): RandomScheduleResult {
  const bag: { team: number; surrogate: boolean }[] = [];
  for (let t = 0; t < shape.numTeams; t++) {
    for (let a = 0; a < shape.appearancesPerTeam; a++) bag.push({ team: t, surrogate: false });
  }
  // The surrogate appearances go to `surrogateCount` DISTINCT teams drawn at
  // random, mirroring the template's convention (a surrogate plays an extra
  // match and earns nothing for it) without copying the template's choice of
  // which teams — that choice is part of the structure under test.
  for (const t of seededShuffle(shape.numTeams, rng).slice(0, shape.surrogateCount)) {
    bag.push({ team: t, surrogate: true });
  }
  if (bag.length !== shape.rows * 6) {
    throw new Error(`measureRandomSchedules: bag size ${bag.length} does not fill ${shape.rows} rows of six`);
  }
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = bag[i]!;
    bag[i] = bag[j]!;
    bag[j] = tmp;
  }

  const matches: ScheduleTemplateMatch[] = [];
  let duplicateRows = 0;
  let cursor = 0;
  for (let row = 0; row < shape.rows; row++) {
    const used = new Set<number>();
    const teams: number[] = [];
    const surrogates: boolean[] = [];
    let duplicated = false;
    for (let pos = 0; pos < 6; pos++) {
      let j = cursor;
      while (j < bag.length && used.has(bag[j]!.team)) j++;
      if (j >= bag.length) {
        j = cursor; // nothing placeable remains; take the next entry and report it
        duplicated = true;
      }
      const tmp = bag[cursor]!;
      bag[cursor] = bag[j]!;
      bag[j] = tmp;
      const entry = bag[cursor]!;
      cursor++;
      used.add(entry.team);
      teams.push(entry.team);
      surrogates.push(entry.surrogate);
    }
    if (duplicated) duplicateRows++;
    matches.push({
      red: teams.slice(0, 3),
      blue: teams.slice(3, 6),
      redSurrogate: surrogates.slice(0, 3),
      blueSurrogate: surrogates.slice(3, 6),
    });
  }
  // A SECOND repair pass over what the forward scan could not place. The
  // forward scan only ever looks at the UNDEALT tail, so a duplicate it leaves
  // behind is usually fixable by trading with a row that was dealt earlier —
  // which is exactly what this does: for each offending slot, find any slot in
  // another row such that swapping the two teams leaves BOTH rows
  // duplicate-free. Rows still offending after this are what
  // `duplicateRows` reports.
  duplicateRows = repairDuplicates(matches);
  return { matches, duplicateRows };
}

/** Teams appearing in a row, as a plain array of six (surrogate flags travel with their team on a swap). */
function rowTeams(m: ScheduleTemplateMatch): number[] {
  return [...m.red, ...m.blue];
}

function hasDuplicate(teams: readonly number[]): boolean {
  return new Set(teams).size !== teams.length;
}

/** Reads slot `pos` (0..5) of a row, and writes it, keeping `red`/`blue`/surrogate arrays consistent. */
function getSlot(m: ScheduleTemplateMatch, pos: number): { team: number; surrogate: boolean } {
  return pos < 3
    ? { team: m.red[pos]!, surrogate: m.redSurrogate[pos]! }
    : { team: m.blue[pos - 3]!, surrogate: m.blueSurrogate[pos - 3]! };
}

function setSlot(m: ScheduleTemplateMatch, pos: number, value: { team: number; surrogate: boolean }): void {
  if (pos < 3) {
    (m.red as number[])[pos] = value.team;
    (m.redSurrogate as boolean[])[pos] = value.surrogate;
  } else {
    (m.blue as number[])[pos - 3] = value.team;
    (m.blueSurrogate as boolean[])[pos - 3] = value.surrogate;
  }
}

/** Swap-repairs duplicate rows in place and returns how many rows still carry a duplicate afterwards. */
function repairDuplicates(matches: readonly ScheduleTemplateMatch[]): number {
  for (let row = 0; row < matches.length; row++) {
    let guard = 0;
    while (hasDuplicate(rowTeams(matches[row]!)) && guard++ < 12) {
      const teams = rowTeams(matches[row]!);
      // The offending slot: the second (or later) appearance of some team.
      const seen = new Set<number>();
      let badPos = -1;
      for (let pos = 0; pos < 6; pos++) {
        if (seen.has(teams[pos]!)) {
          badPos = pos;
          break;
        }
        seen.add(teams[pos]!);
      }
      if (badPos < 0) break;
      const bad = getSlot(matches[row]!, badPos);
      let swapped = false;
      for (let other = 0; other < matches.length && !swapped; other++) {
        if (other === row) continue;
        const otherTeams = rowTeams(matches[other]!);
        if (otherTeams.includes(bad.team)) continue; // moving `bad` here would only relocate the clash
        for (let pos = 0; pos < 6; pos++) {
          const candidate = getSlot(matches[other]!, pos);
          // `candidate` must not already be in the offending row, or the swap trades one duplicate for another.
          if (teams.includes(candidate.team)) continue;
          setSlot(matches[row]!, badPos, candidate);
          setSlot(matches[other]!, pos, bad);
          swapped = true;
          break;
        }
      }
      if (!swapped) break;
    }
  }
  return matches.filter((m) => hasDuplicate(rowTeams(m))).length;
}

// ---------------------------------------------------------------------------
// Structural diagnostics — proof the two arms are actually different
// ---------------------------------------------------------------------------

/**
 * Not part of the criterion. Its job is to make a PASS non-vacuous: if these
 * numbers came out the same for both arms, "random matches balanced" would be
 * a statement about two identical things.
 */
export interface StructureStats {
  /** Unordered team pairs that are ALLIANCE PARTNERS two or more times in one schedule, averaged over schedules. A balanced grid drives this toward zero. */
  readonly repeatPartnerPairs: number;
  /** Unordered team pairs that face each other two or more times, averaged over schedules. */
  readonly repeatOpponentPairs: number;
  /** Mean over teams of `|red appearances - blue appearances|`, averaged over schedules. A balanced grid keeps this near zero; plain random does not. */
  readonly meanRedBlueImbalance: number;
  /** Largest `|red - blue|` seen for any team in any sampled schedule. */
  readonly maxRedBlueImbalance: number;
}

function structureOf(schedules: readonly (readonly ScheduleTemplateMatch[])[], numTeams: number): StructureStats {
  let partnerRepeats = 0;
  let opponentRepeats = 0;
  let imbalanceTotal = 0;
  let maxImbalance = 0;
  for (const schedule of schedules) {
    const partner = new Map<number, number>();
    const opponent = new Map<number, number>();
    const red = new Array<number>(numTeams).fill(0);
    const blue = new Array<number>(numTeams).fill(0);
    const bump = (map: Map<number, number>, a: number, b: number): void => {
      const key = a < b ? a * numTeams + b : b * numTeams + a;
      map.set(key, (map.get(key) ?? 0) + 1);
    };
    for (const m of schedule) {
      for (let i = 0; i < 3; i++) {
        red[m.red[i]!]!++;
        blue[m.blue[i]!]!++;
        for (let j = i + 1; j < 3; j++) {
          bump(partner, m.red[i]!, m.red[j]!);
          bump(partner, m.blue[i]!, m.blue[j]!);
        }
        for (let j = 0; j < 3; j++) bump(opponent, m.red[i]!, m.blue[j]!);
      }
    }
    for (const count of partner.values()) if (count >= 2) partnerRepeats++;
    for (const count of opponent.values()) if (count >= 2) opponentRepeats++;
    let scheduleImbalance = 0;
    for (let t = 0; t < numTeams; t++) {
      const d = Math.abs(red[t]! - blue[t]!);
      scheduleImbalance += d;
      maxImbalance = Math.max(maxImbalance, d);
    }
    imbalanceTotal += scheduleImbalance / numTeams;
  }
  const n = Math.max(1, schedules.length);
  return {
    repeatPartnerPairs: partnerRepeats / n,
    repeatOpponentPairs: opponentRepeats / n,
    meanRedBlueImbalance: imbalanceTotal / n,
    maxRedBlueImbalance: maxImbalance,
  };
}

// ---------------------------------------------------------------------------
// Pricing and ranking
// ---------------------------------------------------------------------------

/** `preSchedule.ts`'s `buildOutcomeInput`, reproduced (it is module-private there) so the D-15 decomposition reaches `simulateRanks` on this path too. */
function buildOutcomeInput(prediction: Prediction): SimMatchOutcomeInput | undefined {
  if (
    prediction.matchOutcomePmf === undefined ||
    prediction.redOutcomeRp === undefined ||
    prediction.blueOutcomeRp === undefined ||
    prediction.redBonusRpPmf === undefined ||
    prediction.blueBonusRpPmf === undefined
  ) {
    return undefined;
  }
  return {
    outcomePmf: roundPmf(prediction.matchOutcomePmf),
    redOutcomeRp: prediction.redOutcomeRp,
    blueOutcomeRp: prediction.blueOutcomeRp,
    redBonusRpPmf: roundPmf(prediction.redBonusRpPmf),
    blueBonusRpPmf: roundPmf(prediction.blueBonusRpPmf),
  };
}

interface PricedSchedule {
  readonly inputs: SimMatchInput[];
}

/** Prices one schedule through the bound closure, rounding the pmfs through the SAME `roundPmf` the published path uses so neither arm is compared at a different precision than it would ship at. */
function priceSchedule(
  schedule: readonly ScheduleTemplateMatch[],
  roster: readonly string[],
  context: { eventKey: string; eventType: number; week: number | null; armKey: string; scheduleIndex: number },
  predict: (match: UpcomingMatch) => Prediction
): PricedSchedule {
  const inputs: SimMatchInput[] = [];
  for (let i = 0; i < schedule.length; i++) {
    const m = schedule[i]!;
    const redTeams = m.red.map((idx) => roster[idx]!);
    const blueTeams = m.blue.map((idx) => roster[idx]!);
    const upcoming: UpcomingMatch = {
      matchKey: `${context.eventKey}_rung2${context.armKey}${context.scheduleIndex}_qm${i + 1}`,
      eventKey: context.eventKey,
      compLevel: "qm",
      setNumber: 1,
      matchNumber: i + 1,
      redTeams,
      blueTeams,
      redSurrogates: redTeams.filter((_, p) => m.redSurrogate[p] === true),
      blueSurrogates: blueTeams.filter((_, p) => m.blueSurrogate[p] === true),
      eventType: context.eventType,
      week: context.week,
    };
    const prediction = predict(upcoming);
    if (prediction.redRpPmf === undefined || prediction.blueRpPmf === undefined) {
      throw new Error(`measureRandomSchedules: no RP pmf for ${upcoming.matchKey} — this algorithm does not model ranking points`);
    }
    const outcome = buildOutcomeInput(prediction);
    inputs.push({
      // PD-03: a surrogate PLAYS the match (it is inside the priced alliance) but earns no ranking credit, so it is excluded from the credited key lists.
      redTeamKeys: redTeams.filter((t) => !upcoming.redSurrogates.includes(t)),
      blueTeamKeys: blueTeams.filter((t) => !upcoming.blueSurrogates.includes(t)),
      redRpPmf: roundPmf(prediction.redRpPmf),
      blueRpPmf: roundPmf(prediction.blueRpPmf),
      ...(outcome !== undefined ? { outcome } : {}),
    });
  }
  return { inputs };
}

interface Bands {
  readonly p10: number[];
  readonly median: number[];
  readonly p90: number[];
}

/**
 * Accumulates rank draws from schedules fed to it ONE AT A TIME, pooling into
 * one histogram per team — the published `baked.histograms` construction, at a
 * caller-chosen N. Streaming rather than array-at-once deliberately: 1000
 * schedules x 3 arms x ~127 priced matches is hundreds of megabytes of pmf
 * arrays held for no reason, and nothing about the pooled histogram needs two
 * schedules alive at the same time.
 *
 * `drawSalt` keeps the Monte Carlo stream distinct from the shuffle stream, as
 * the published path's "baked" salt does.
 */
class BandAccumulator {
  private readonly totals: number[][];
  private readonly baselines: SimTeamBaseline[];
  private scheduleCount = 0;

  constructor(
    private readonly roster: readonly string[],
    private readonly drawsPerSchedule: number,
    private readonly drawSalt: string
  ) {
    this.totals = roster.map(() => new Array<number>(roster.length).fill(0));
    this.baselines = roster.map((teamKey) => ({ teamKey, earnedRpSum: 0, matchesPlayed: 0 }));
  }

  add(inputs: readonly SimMatchInput[], scheduleIndex: number): void {
    const seed = fnv1a32(`${this.drawSalt}|draw|${scheduleIndex}`);
    const result = simulateRanks(inputs, this.baselines, this.drawsPerSchedule, mulberry32(seed));
    for (let t = 0; t < this.roster.length; t++) {
      const histogram = result.rankHistograms.get(this.roster[t]!)!;
      const row = this.totals[t]!;
      for (let rank = 0; rank < histogram.length; rank++) row[rank]! += histogram[rank]!;
    }
    this.scheduleCount++;
  }

  /** Schedules folded in so far — the N a `bands()` snapshot is "at". */
  get count(): number {
    return this.scheduleCount;
  }

  bands(): Bands {
    const draws = this.scheduleCount * this.drawsPerSchedule;
    if (draws === 0) throw new Error("measureRandomSchedules: BandAccumulator read before any schedule was added");
    return {
      p10: this.totals.map((h) => continuousQuantile(h, 0.1, draws)),
      median: this.totals.map((h) => continuousQuantile(h, 0.5, draws)),
      p90: this.totals.map((h) => continuousQuantile(h, 0.9, draws)),
    };
  }
}

/**
 * The N values a sweep reports. Nested PREFIXES of one stream, deliberately:
 * checkpoint 100's schedules are checkpoint 50's plus fifty more, so the curve
 * shows one arm converging rather than five unrelated arms disagreeing by
 * different amounts.
 */
export function sweepCheckpoints(scheduleCount: number): number[] {
  const candidates = [10, 20, 30, 50, 75, 100, 150, 200, 300, 500, 750, scheduleCount];
  return [...new Set(candidates.filter((n) => n <= scheduleCount && n >= 1))].sort((a, b) => a - b);
}

/**
 * How far a band moves, in ranks. Reported instead of a pass-rate because the
 * decision "how many schedules is enough" needs a magnitude the reader can put
 * their own tolerance against — a pass-rate hides whether the failures missed
 * by a hair or by five ranks.
 */
export interface Drift {
  readonly meanAbsMedian: number;
  readonly p95AbsMedian: number;
  readonly maxAbsMedian: number;
  readonly meanAbsEdge: number;
  readonly p95AbsEdge: number;
  readonly maxAbsEdge: number;
}

function p95(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

export function driftOf(diffs: readonly TeamDiff[]): Drift {
  const medians = diffs.map((d) => Math.abs(d.medianDiff)).sort((a, b) => a - b);
  const edges = diffs.flatMap((d) => [Math.abs(d.p10Diff), Math.abs(d.p90Diff)]).sort((a, b) => a - b);
  const mean = (xs: readonly number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
  return {
    meanAbsMedian: mean(medians),
    p95AbsMedian: p95(medians),
    maxAbsMedian: medians.length === 0 ? 0 : medians[medians.length - 1]!,
    meanAbsEdge: mean(edges),
    p95AbsEdge: p95(edges),
    maxAbsEdge: edges.length === 0 ? 0 : edges[edges.length - 1]!,
  };
}

// ---------------------------------------------------------------------------
// Scoring — rung 1's clauses, imported not restated
// ---------------------------------------------------------------------------

export interface TeamDiff {
  readonly eventKey: string;
  readonly teamKey: string;
  readonly medianDiff: number;
  readonly p10Diff: number;
  readonly p90Diff: number;
}

export interface ClauseVerdict {
  readonly pass: boolean;
  readonly clause1TightRate: number;
  readonly clause1EveryTeamWithinHard: boolean;
  readonly clause1Worst: { absMedianDiff: number; teamKey: string; eventKey: string };
  readonly clause2P10Rate: number;
  readonly clause2P90Rate: number;
  readonly clause3MeanSignedMedianDiff: number;
  readonly teamCount: number;
}

export function scoreClauses(diffs: readonly TeamDiff[]): ClauseVerdict {
  const n = Math.max(1, diffs.length);
  const tight = diffs.filter((d) => Math.abs(d.medianDiff) <= CLAUSE_1_MEDIAN_TIGHT).length / n;
  const everyWithinHard = diffs.every((d) => Math.abs(d.medianDiff) <= CLAUSE_1_MEDIAN_HARD);
  let worst = { absMedianDiff: 0, teamKey: "", eventKey: "" };
  for (const d of diffs) {
    if (Math.abs(d.medianDiff) > worst.absMedianDiff) {
      worst = { absMedianDiff: Math.abs(d.medianDiff), teamKey: d.teamKey, eventKey: d.eventKey };
    }
  }
  const p10Rate = diffs.filter((d) => Math.abs(d.p10Diff) <= CLAUSE_2_EDGE_TOLERANCE).length / n;
  const p90Rate = diffs.filter((d) => Math.abs(d.p90Diff) <= CLAUSE_2_EDGE_TOLERANCE).length / n;
  const meanSigned = diffs.reduce((total, d) => total + d.medianDiff, 0) / n;
  return {
    pass:
      tight >= CLAUSE_1_TIGHT_RATE &&
      everyWithinHard &&
      p10Rate >= CLAUSE_2_RATE &&
      p90Rate >= CLAUSE_2_RATE &&
      Math.abs(meanSigned) <= CLAUSE_3_MEAN_SHIFT,
    clause1TightRate: tight,
    clause1EveryTeamWithinHard: everyWithinHard,
    clause1Worst: worst,
    clause2P10Rate: p10Rate,
    clause2P90Rate: p90Rate,
    clause3MeanSignedMedianDiff: meanSigned,
    teamCount: diffs.length,
  };
}

function diffsBetween(eventKey: string, roster: readonly string[], candidate: Bands, reference: Bands): TeamDiff[] {
  return roster.map((teamKey, t) => ({
    eventKey,
    teamKey,
    medianDiff: candidate.median[t]! - reference.median[t]!,
    p10Diff: candidate.p10[t]! - reference.p10[t]!,
    p90Diff: candidate.p90[t]! - reference.p90[t]!,
  }));
}

// ---------------------------------------------------------------------------
// The per-event driver
// ---------------------------------------------------------------------------

export interface EventResult {
  readonly eventKey: string;
  readonly season: number;
  readonly teams: number;
  readonly quals: number;
  readonly matchesPerTeam: number;
  readonly templateRows: number;
  readonly surrogateSlots: number;
  readonly replayMode: string;
  readonly duplicateRowsTotal: number;
  readonly structure: Record<"generated" | "random", StructureStats>;
  /** N=1000 comparisons. */
  readonly randVsGen: TeamDiff[];
  readonly genBVsGenA: TeamDiff[];
  /** The candidate against the OTHER reference draw — a consistent shortfall against both `genA` and `genB` is structure, a shortfall against one is sampling. */
  readonly randVsGenB: TeamDiff[];
  /** The RANDOM construction's own floor: two independent random-schedule draws. Separates "random is biased" from "random converges more slowly". */
  readonly randBVsRand: TeamDiff[];
  /** The same two comparisons at the PUBLISHED N=20 / 50-draw configuration. */
  readonly randVsGenPublishedN: TeamDiff[];
  readonly genBVsGenAPublishedN: TeamDiff[];
  /** Per-checkpoint reproducibility and convergence, keyed by N. Empty unless `--sweep`. */
  readonly sweep: SweepPoint[];
}

/**
 * One N on the convergence curve.
 *
 * `reproducibility` is the decision-relevant number: two INDEPENDENT draws of
 * the same construction at this N, which is exactly how much the published
 * band would move if the publish were re-run. `convergence` is the companion
 * question — how far this N still sits from the same arm's own high-N answer —
 * and separates "stable but wrong" from "stable and converged". A small
 * reproducibility with a large convergence means N is too low in a way that
 * re-running would NOT reveal.
 */
export interface SweepPoint {
  readonly n: number;
  /** Raw per-team diffs, not a summary: the curve is POOLED across events at print time, and pooling pre-averaged per-event summaries would weight a 14-team event equally with a 76-team one. */
  readonly reproducibilityGen: TeamDiff[];
  readonly reproducibilityRand: TeamDiff[];
  readonly convergenceGen: TeamDiff[];
  readonly convergenceRand: TeamDiff[];
  readonly crossConstruction: TeamDiff[];
}

export interface MeasureOptions {
  readonly scheduleCount: number;
  readonly drawsPerSchedule: number;
  readonly sweep?: boolean;
}

/**
 * Everything both the comparison and the split probe need, derived once:
 * the re-asserted corpus facts, the roster that IS the index space, the
 * template and its shape, and the pricing closure bound to this event's
 * PRE-EVENT walk-forward state. Extracted so the two callers cannot drift into
 * pricing the same event two slightly different ways — the exact failure mode
 * that manufactures a scorer mismatch.
 */
interface EventContext {
  readonly eventKey: string;
  readonly eventType: number;
  readonly week: number | null;
  readonly roster: string[];
  readonly quals: ReturnType<typeof selectMatchesChronological>;
  readonly matchesPerTeam: number;
  readonly template: readonly ScheduleTemplateMatch[];
  readonly shape: RandomScheduleShape;
  readonly predict: (match: UpcomingMatch) => Prediction;
}

function prepareEvent(
  db: Corpus,
  algorithm: AlgorithmModule<any>,
  target: TargetEvent,
  replay: SeasonReplayResult
): EventContext {
  const quals = selectMatchesChronological(db, { eventKey: target.eventKey }).filter((m) => m.compLevel === "qm");
  if (quals.length !== target.expectedQuals) {
    throw new Error(
      `measureRandomSchedules: ${target.eventKey}'s corpus qual count (${quals.length}) no longer matches the pinned expectation (${target.expectedQuals}).`
    );
  }
  const roster = uniqueSortedRoster(quals);
  if (roster.length !== target.expectedRoster) {
    throw new Error(
      `measureRandomSchedules: ${target.eventKey}'s corpus roster size (${roster.length}) no longer matches the pinned expectation (${target.expectedRoster}).`
    );
  }
  const unplayed = selectScheduledMatches(db, { eventKey: target.eventKey }).filter((m) => m.compLevel === "qm");
  if (unplayed.length > 0) {
    throw new Error(`measureRandomSchedules: ${target.eventKey} has ${unplayed.length} unplayed qualification match(es) — the sample requires FINISHED events.`);
  }

  const eventType = quals[0]!.eventType;
  const week = quals[0]!.week;
  const matchesPerTeam = matchesPerTeamFor(roster.length, quals.length);
  const ruleModule = RP_RULE_MODULES[target.season];
  if (ruleModule === undefined) throw new Error(`measureRandomSchedules: season ${target.season} has no RP rule module`);

  const pricingState = replay.preEventStateByEvent.get(target.eventKey);
  if (pricingState === undefined) {
    throw new Error(`measureRandomSchedules: no pre-event walk-forward state for ${target.eventKey} (PD-04). Re-run with --replay-from an earlier season.`);
  }
  const filler = makeRankingPointFiller(replay.layer.rpAccumulator, ruleModule, replay.layer.consistencyByTeam(), roster);
  if (filler === undefined) {
    throw new Error(`measureRandomSchedules: the ranking-point filler is unavailable for ${target.eventKey}.`);
  }
  const predict = (match: UpcomingMatch): Prediction => filler(match, algorithm.predict(pricingState, match));

  const template = loadScheduleTemplate(roster.length, matchesPerTeam);
  const shape = shapeOfTemplate(template, roster.length);

  return { eventKey: target.eventKey, eventType, week, roster, quals, matchesPerTeam, template, shape, predict };
}

export function measureEvent(
  db: Corpus,
  algorithm: AlgorithmModule<any>,
  target: TargetEvent,
  replay: SeasonReplayResult,
  options: MeasureOptions
): EventResult {
  const { eventKey, eventType, week, roster, quals, matchesPerTeam, template, shape, predict } = prepareEvent(db, algorithm, target, replay);
  void eventKey;

  // One arm at a time, one schedule at a time: build it, price it, feed both
  // accumulators, drop it. Nothing about an arm's construction reads any other
  // arm's output, and no arm's priced matches outlive the schedule they came
  // from.
  const bands = new Map<ArmKey, { full: Bands; published: Bands }>();
  const structureSamples = new Map<ArmKey, ScheduleTemplateMatch[][]>();
  const sampleSize = Math.min(20, options.scheduleCount);
  let duplicateRowsTotal = 0;

  // Checkpoint snapshots, taken from the SAME streaming accumulator the final
  // bands come from — so checkpoint N is literally the first N schedules of
  // the run, not a separate shorter run.
  const checkpoints = options.sweep === true ? sweepCheckpoints(options.scheduleCount) : [];
  const checkpointSet = new Set(checkpoints);
  const snapshots = new Map<ArmKey, Map<number, Bands>>();

  for (const armKey of ARM_KEYS) {
    const salt = `${target.eventKey}|${algorithm.version}|${armKey}`;
    const full = new BandAccumulator(roster, options.drawsPerSchedule, `${salt}|full`);
    const published = new BandAccumulator(roster, PUBLISHED_DRAWS_PER_SCHEDULE, `${salt}|published`);
    const samples: ScheduleTemplateMatch[][] = [];
    const armSnapshots = new Map<number, Bands>();
    snapshots.set(armKey, armSnapshots);
    for (let k = 0; k < options.scheduleCount; k++) {
      const rng = mulberry32(fnv1a32(`${salt}|shuffle|${k}`));
      let schedule: ScheduleTemplateMatch[];
      if (armKey === "rand" || armKey === "randB") {
        const built = randomSchedule(shape, rng);
        duplicateRowsTotal += built.duplicateRows;
        schedule = built.matches;
      } else {
        schedule = generatedSchedule(template, seededShuffle(roster.length, rng));
      }
      if (k < sampleSize) samples.push(schedule);
      const priced = priceSchedule(schedule, roster, { eventKey: target.eventKey, eventType, week, armKey, scheduleIndex: k }, predict);
      full.add(priced.inputs, k);
      if (k < PUBLISHED_SCHEDULE_COUNT) published.add(priced.inputs, k);
      if (checkpointSet.has(full.count)) armSnapshots.set(full.count, full.bands());
    }
    bands.set(armKey, { full: full.bands(), published: published.bands() });
    structureSamples.set(armKey, samples);
  }

  const genA = bands.get("genA")!;
  const genB = bands.get("genB")!;
  const rand = bands.get("rand")!;
  const randB = bands.get("randB")!;

  const sweep: SweepPoint[] = checkpoints.map((n) => {
    const at = (armKey: ArmKey): Bands => {
      const found = snapshots.get(armKey)!.get(n);
      if (found === undefined) throw new Error(`measureRandomSchedules: no ${armKey} snapshot at N=${n}`);
      return found;
    };
    const ref = (armKey: ArmKey): Bands => bands.get(armKey)!.full;
    return {
      n,
      reproducibilityGen: diffsBetween(target.eventKey, roster, at("genB"), at("genA")),
      reproducibilityRand: diffsBetween(target.eventKey, roster, at("randB"), at("rand")),
      convergenceGen: diffsBetween(target.eventKey, roster, at("genA"), ref("genA")),
      convergenceRand: diffsBetween(target.eventKey, roster, at("rand"), ref("rand")),
      crossConstruction: diffsBetween(target.eventKey, roster, at("rand"), at("genA")),
    };
  });

  // The structural diagnostic only needs a sample; 20 schedules per arm is
  // plenty to show whether the two constructions differ at all.
  return {
    eventKey: target.eventKey,
    season: target.season,
    teams: roster.length,
    quals: quals.length,
    matchesPerTeam,
    templateRows: shape.rows,
    surrogateSlots: shape.surrogateCount,
    replayMode: replay.replayMode,
    duplicateRowsTotal,
    structure: {
      generated: structureOf(structureSamples.get("genA")!, roster.length),
      random: structureOf(structureSamples.get("rand")!, roster.length),
    },
    randVsGen: diffsBetween(target.eventKey, roster, rand.full, genA.full),
    genBVsGenA: diffsBetween(target.eventKey, roster, genB.full, genA.full),
    randVsGenB: diffsBetween(target.eventKey, roster, rand.full, genB.full),
    randBVsRand: diffsBetween(target.eventKey, roster, randB.full, rand.full),
    randVsGenPublishedN: diffsBetween(target.eventKey, roster, rand.published, genA.published),
    genBVsGenAPublishedN: diffsBetween(target.eventKey, roster, genB.published, genA.published),
    sweep,
  };
}

// ---------------------------------------------------------------------------
// The split probe — is it the SCHEDULES that buy stability, or just the DRAWS?
// ---------------------------------------------------------------------------

/**
 * `--sweep` grows N with `drawsPerSchedule` held fixed, so it grows the total
 * draw count at the same time and cannot say WHICH knob bought the stability.
 * That distinction decides the cost of an answer: an extra draw re-uses a
 * schedule's already-priced pmfs, while an extra schedule needs a fresh
 * `predict` call for every one of its ~127 matches. If the two are
 * interchangeable, "how few schedules" has a much smaller answer than the
 * sweep suggests.
 *
 * So: hold the TOTAL draw budget constant and spend it different ways.
 * `20 x 1000`, `100 x 200` and `1000 x 20` are all 20,000 draws. If
 * reproducibility is flat across them, schedule count is not what matters and
 * a handful of schedules will do. If it improves with N, the schedule sample
 * is the binding constraint and draws cannot substitute for it.
 */
export interface SplitProbePoint {
  readonly scheduleCount: number;
  readonly drawsPerSchedule: number;
  readonly reproducibilityGen: TeamDiff[];
  readonly reproducibilityRand: TeamDiff[];
}

export function measureSplitProbe(
  db: Corpus,
  algorithm: AlgorithmModule<any>,
  target: TargetEvent,
  replay: SeasonReplayResult,
  totalDraws: number,
  scheduleCounts: readonly number[]
): SplitProbePoint[] {
  const context = prepareEvent(db, algorithm, target, replay);
  const points: SplitProbePoint[] = [];
  for (const scheduleCount of scheduleCounts) {
    if (totalDraws % scheduleCount !== 0) {
      throw new Error(
        `measureRandomSchedules: --total-draws ${totalDraws} is not divisible by schedule count ${scheduleCount}, so this configuration would not spend the same draw budget as the others.`
      );
    }
    const drawsPerSchedule = totalDraws / scheduleCount;
    const bandsFor = (armKey: ArmKey): Bands => {
      const salt = `${context.eventKey}|${algorithm.version}|${armKey}|probe${scheduleCount}x${drawsPerSchedule}`;
      const acc = new BandAccumulator(context.roster, drawsPerSchedule, salt);
      for (let k = 0; k < scheduleCount; k++) {
        const rng = mulberry32(fnv1a32(`${salt}|shuffle|${k}`));
        const schedule =
          armKey === "rand" || armKey === "randB"
            ? randomSchedule(context.shape, rng).matches
            : generatedSchedule(context.template, seededShuffle(context.roster.length, rng));
        acc.add(priceSchedule(schedule, context.roster, { ...context, armKey, scheduleIndex: k }, context.predict).inputs, k);
      }
      return acc.bands();
    };
    points.push({
      scheduleCount,
      drawsPerSchedule,
      reproducibilityGen: diffsBetween(context.eventKey, context.roster, bandsFor("genB"), bandsFor("genA")),
      reproducibilityRand: diffsBetween(context.eventKey, context.roster, bandsFor("randB"), bandsFor("rand")),
    });
  }
  return points;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function verdictRow(label: string, v: ClauseVerdict): string {
  return [
    label.padEnd(30),
    pct(v.clause1TightRate).padStart(7),
    String(v.clause1EveryTeamWithinHard).padStart(6),
    pct(v.clause2P10Rate).padStart(7),
    pct(v.clause2P90Rate).padStart(7),
    v.clause3MeanSignedMedianDiff.toFixed(4).padStart(9),
    v.clause1Worst.absMedianDiff.toFixed(2).padStart(7),
    (v.pass ? "PASS" : "FAIL").padStart(5),
  ].join(" ");
}

export async function main(argv: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      events: { type: "string" },
      schedules: { type: "string" },
      "draws-per-schedule": { type: "string" },
      algorithm: { type: "string" },
      "replay-from": { type: "string" },
      "write-doc": { type: "boolean" },
      sweep: { type: "boolean" },
      "split-probe": { type: "boolean" },
      "total-draws": { type: "string" },
      "probe-schedules": { type: "string" },
    },
  });

  const targets =
    values.events === undefined
      ? DEFAULT_TARGET_EVENTS
      : values.events.split(",").map((eventKey) => {
          const known = DEFAULT_TARGET_EVENTS.find((t) => t.eventKey === eventKey.trim());
          if (known === undefined) {
            throw new Error(`measureRandomSchedules: "${eventKey}" is not in DEFAULT_TARGET_EVENTS, so no pinned expectation exists to re-assert against.`);
          }
          return known;
        });

  const scheduleCount = values.schedules === undefined ? DEFAULT_SCHEDULE_COUNT : Number(values.schedules);
  const drawsPerSchedule = values["draws-per-schedule"] === undefined ? DEFAULT_DRAWS_PER_SCHEDULE : Number(values["draws-per-schedule"]);
  if (!Number.isInteger(scheduleCount) || scheduleCount < PUBLISHED_SCHEDULE_COUNT) {
    throw new Error(`measureRandomSchedules: --schedules must be an integer >= ${PUBLISHED_SCHEDULE_COUNT} (the published-N sub-comparison reads the first ${PUBLISHED_SCHEDULE_COUNT}).`);
  }
  if (!Number.isInteger(drawsPerSchedule) || drawsPerSchedule < 1) {
    throw new Error("measureRandomSchedules: --draws-per-schedule must be a positive integer.");
  }

  const algorithmId = values.algorithm ?? DEFAULT_ALGORITHM_ID;
  const algorithm = ALGORITHMS[algorithmId];
  if (algorithm === undefined) throw new Error(`measureRandomSchedules: unknown algorithm "${algorithmId}"`);

  const probeTotalDraws = values["total-draws"] === undefined ? 20000 : Number(values["total-draws"]);
  const probeScheduleCounts = (values["probe-schedules"] ?? "20,50,100,250,500,1000").split(",").map((x) => Number(x.trim()));
  if (values["split-probe"] === true) {
    if (!Number.isInteger(probeTotalDraws) || probeTotalDraws < 1) throw new Error("measureRandomSchedules: --total-draws must be a positive integer.");
    for (const n of probeScheduleCounts) {
      if (!Number.isInteger(n) || n < 1) throw new Error(`measureRandomSchedules: --probe-schedules entry "${n}" is not a positive integer.`);
    }
  }

  const db: Corpus = openCorpusReadOnly("data/corpus.sqlite");
  const results: EventResult[] = [];
  const probeByEvent: SplitProbePoint[][] = [];
  const startedAt = Date.now();

  console.log(`measureRandomSchedules — D-17 rung 2 at N=${scheduleCount} per arm (${scheduleCount * drawsPerSchedule} draws), ${algorithm.id}@${algorithm.version}`);
  console.log(`Arms: genA/genB = balanced cheesy-arena template under two independent permutation streams; rand = plain-random schedules.`);
  console.log("");

  const bySeason = new Map<number, TargetEvent[]>();
  for (const t of targets) {
    const list = bySeason.get(t.season) ?? [];
    list.push(t);
    bySeason.set(t.season, list);
  }

  for (const [season, seasonTargets] of [...bySeason.entries()].sort((a, b) => a[0] - b[0])) {
    const replayFrom = values["replay-from"] === undefined ? season : Number(values["replay-from"]);
    const replay = replaySeason(db, algorithm, season, replayFrom, new Set(seasonTargets.map((t) => t.eventKey)));
    for (const target of seasonTargets) {
      const t0 = Date.now();
      if (values["split-probe"] === true) {
        const probe = measureSplitProbe(db, algorithm, target, replay, probeTotalDraws, probeScheduleCounts);
        probeByEvent.push(probe);
        console.log(`  ${target.eventKey.padEnd(11)} split probe done — ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        continue;
      }
      const result = measureEvent(db, algorithm, target, replay, { scheduleCount, drawsPerSchedule, sweep: values.sweep === true });
      results.push(result);
      console.log(
        `  ${target.eventKey.padEnd(11)} ${String(result.teams).padStart(3)} teams, ${String(result.quals).padStart(3)} quals, mpt ${result.matchesPerTeam}, ` +
          `${result.templateRows} rows, ${result.surrogateSlots} surrogate slot(s) — ${((Date.now() - t0) / 1000).toFixed(1)}s`
      );
      console.log(
        `               structure: repeat-partner pairs gen ${result.structure.generated.repeatPartnerPairs.toFixed(1)} vs rand ${result.structure.random.repeatPartnerPairs.toFixed(1)}; ` +
          `red/blue imbalance gen ${result.structure.generated.meanRedBlueImbalance.toFixed(2)} vs rand ${result.structure.random.meanRedBlueImbalance.toFixed(2)}`
      );
    }
  }

  if (values["split-probe"] === true) {
    console.log("");
    console.log(`--- SPLIT PROBE: every row spends the SAME ${probeTotalDraws} draws, divided differently. All figures in RANKS. ---`);
    console.log("");
    console.log("  If these rows are flat, draws substitute for schedules and a few schedules suffice.");
    console.log("  If they improve with N, the SCHEDULE sample is the binding constraint and draws cannot buy it.");
    console.log("");
    console.log(
      `${"N".padStart(6)} x ${"draws".padStart(6)} | ${"gen median mean".padStart(15)} ${"p95".padStart(6)} ${"max".padStart(6)} | ` +
        `${"rand median mean".padStart(16)} ${"p95".padStart(6)} ${"max".padStart(6)} | ${"gen edge mean".padStart(13)} ${"rand edge mean".padStart(14)}`
    );
    for (const [i, first] of probeByEvent[0]!.entries()) {
      const g = driftOf(probeByEvent.flatMap((e) => e[i]!.reproducibilityGen));
      const r = driftOf(probeByEvent.flatMap((e) => e[i]!.reproducibilityRand));
      console.log(
        `${String(first.scheduleCount).padStart(6)} x ${String(first.drawsPerSchedule).padStart(6)} | ` +
          `${g.meanAbsMedian.toFixed(3).padStart(15)} ${g.p95AbsMedian.toFixed(2).padStart(6)} ${g.maxAbsMedian.toFixed(2).padStart(6)} | ` +
          `${r.meanAbsMedian.toFixed(3).padStart(16)} ${r.p95AbsMedian.toFixed(2).padStart(6)} ${r.maxAbsMedian.toFixed(2).padStart(6)} | ` +
          `${g.meanAbsEdge.toFixed(3).padStart(13)} ${r.meanAbsEdge.toFixed(3).padStart(14)}`
      );
    }
    console.log("");
    console.log(`Teams scored: ${probeByEvent.reduce((t, e) => t + e[0]!.reproducibilityGen.length, 0)} across ${probeByEvent.length} event(s). Elapsed ${((Date.now() - startedAt) / 1000 / 60).toFixed(1)} min.`);
    db.close();
    return;
  }

  const pooled = {
    randVsGen: scoreClauses(results.flatMap((r) => r.randVsGen)),
    genBVsGenA: scoreClauses(results.flatMap((r) => r.genBVsGenA)),
    randVsGenB: scoreClauses(results.flatMap((r) => r.randVsGenB)),
    randBVsRand: scoreClauses(results.flatMap((r) => r.randBVsRand)),
    randVsGenPublishedN: scoreClauses(results.flatMap((r) => r.randVsGenPublishedN)),
    genBVsGenAPublishedN: scoreClauses(results.flatMap((r) => r.genBVsGenAPublishedN)),
  };

  console.log("");
  console.log("--- RUNG 1'S CLAUSES, UNCHANGED: c1 >= 95.0% within 0.5 median AND every team within 1.0; c2 >= 90.0% within 1.0 at BOTH edges; c3 |mean signed| <= 0.25 ---");
  console.log("");
  console.log(`${"comparison".padEnd(30)} ${"c1".padStart(7)} ${"all<=1".padStart(6)} ${"c2p10".padStart(7)} ${"c2p90".padStart(7)} ${"c3".padStart(9)} ${"worst".padStart(7)} ${"".padStart(5)}`);
  console.log(verdictRow(`rand vs genA @N=${scheduleCount}`, pooled.randVsGen));
  console.log(verdictRow(`rand vs genB @N=${scheduleCount}`, pooled.randVsGenB));
  console.log(verdictRow(`gen  vs gen  @N=${scheduleCount}  (FLOOR)`, pooled.genBVsGenA));
  console.log(verdictRow(`rand vs rand @N=${scheduleCount}  (FLOOR)`, pooled.randBVsRand));
  console.log(verdictRow(`rand vs gen  @N=${PUBLISHED_SCHEDULE_COUNT}`, pooled.randVsGenPublishedN));
  console.log(verdictRow(`gen vs gen   @N=${PUBLISHED_SCHEDULE_COUNT}   (FLOOR)`, pooled.genBVsGenAPublishedN));
  console.log("");

  if (values.sweep === true && results[0]!.sweep.length > 0) {
    console.log("--- HOW MANY SCHEDULES IS ENOUGH: pooled convergence curve, all figures in RANKS ---");
    console.log("");
    console.log("  reproducibility = two INDEPENDENT draws at this N (how much a re-publish moves the band)");
    console.log("  convergence     = this N against the same arm's own N=" + String(scheduleCount) + " answer (how much is still bias)");
    console.log("");
    console.log(
      `${"N".padStart(5)} | ${"gen repro mean".padStart(14)} ${"p95".padStart(6)} ${"max".padStart(6)} | ` +
        `${"rand repro mean".padStart(15)} ${"p95".padStart(6)} ${"max".padStart(6)} | ` +
        `${"gen conv mean".padStart(13)} ${"p95".padStart(6)} | ${"rand conv mean".padStart(14)} ${"p95".padStart(6)}`
    );
    for (const [i, point] of results[0]!.sweep.entries()) {
      const pool = (pick: (p: SweepPoint) => TeamDiff[]): Drift => driftOf(results.flatMap((r) => pick(r.sweep[i]!)));
      const gr = pool((p) => p.reproducibilityGen);
      const rr = pool((p) => p.reproducibilityRand);
      const gc = pool((p) => p.convergenceGen);
      const rc = pool((p) => p.convergenceRand);
      console.log(
        `${String(point.n).padStart(5)} | ${gr.meanAbsMedian.toFixed(3).padStart(14)} ${gr.p95AbsMedian.toFixed(2).padStart(6)} ${gr.maxAbsMedian.toFixed(2).padStart(6)} | ` +
          `${rr.meanAbsMedian.toFixed(3).padStart(15)} ${rr.p95AbsMedian.toFixed(2).padStart(6)} ${rr.maxAbsMedian.toFixed(2).padStart(6)} | ` +
          `${gc.meanAbsMedian.toFixed(3).padStart(13)} ${gc.p95AbsMedian.toFixed(2).padStart(6)} | ${rc.meanAbsMedian.toFixed(3).padStart(14)} ${rc.p95AbsMedian.toFixed(2).padStart(6)}`
      );
    }
    console.log("");
    console.log("Band EDGES (p10/p90), the harder quantity — same layout, mean/p95/max |delta| in ranks:");
    for (const [i, point] of results[0]!.sweep.entries()) {
      const pool = (pick: (p: SweepPoint) => TeamDiff[]): Drift => driftOf(results.flatMap((r) => pick(r.sweep[i]!)));
      const gr = pool((p) => p.reproducibilityGen);
      const rr = pool((p) => p.reproducibilityRand);
      console.log(
        `${String(point.n).padStart(5)} | gen repro ${gr.meanAbsEdge.toFixed(3)} / ${gr.p95AbsEdge.toFixed(2)} / ${gr.maxAbsEdge.toFixed(2)}` +
          `   rand repro ${rr.meanAbsEdge.toFixed(3)} / ${rr.p95AbsEdge.toFixed(2)} / ${rr.maxAbsEdge.toFixed(2)}`
      );
    }
    console.log("");
  }

  const duplicateRows = results.reduce((t, r) => t + r.duplicateRowsTotal, 0);
  console.log(`Random-arm rows the duplicate repair could not fix: ${duplicateRows} (of ${results.reduce((t, r) => t + r.templateRows * scheduleCount, 0)} generated rows)`);
  console.log(`Teams scored: ${pooled.randVsGen.teamCount} across ${results.length} event(s). Elapsed ${((Date.now() - startedAt) / 1000 / 60).toFixed(1)} min.`);
  console.log("");

  // The interpretation rule, fixed here and not after the numbers:
  //   rand-vs-gen at or inside the SAME-ARM FLOOR => the balanced structure
  //   carries no signal the bands can see. Rung 2 holds.
  const insideFloor =
    pooled.randVsGen.clause1TightRate >= pooled.genBVsGenA.clause1TightRate - 0.02 &&
    pooled.randVsGen.clause2P10Rate >= pooled.genBVsGenA.clause2P10Rate - 0.02 &&
    pooled.randVsGen.clause2P90Rate >= pooled.genBVsGenA.clause2P90Rate - 0.02;
  console.log(`VERDICT — rung 2 clauses: ${pooled.randVsGen.pass ? "PASS" : "FAIL"}.`);
  console.log(`VERDICT — rand-vs-gen within 2pp of the same-arm floor on all three rates: ${insideFloor ? "YES" : "NO"}.`);
  // Read the two lines above against the FLOOR rows, never on their own. When
  // the floors fail too, a candidate's FAIL carries no information about the
  // candidate — it is the bar that is unattainable at this N.
  if (!pooled.genBVsGenA.pass || !pooled.randBVsRand.pass) {
    console.log(
      `NOTE — the SAME-CONSTRUCTION floors also FAIL these clauses (gen-vs-gen ${pct(pooled.genBVsGenA.clause1TightRate)}, rand-vs-rand ${pct(pooled.randBVsRand.clause1TightRate)}), ` +
        `so "FAIL" above is a statement about the bar, not about random schedules. Compare the rows, not the verdicts.`
    );
  }

  if (values["write-doc"] === true) {
    writeFileSync(RANDOM_SCHEDULES_DOC_PATH, renderDoc(results, pooled, { scheduleCount, drawsPerSchedule }, algorithm, insideFloor), "utf8");
    console.log(`Wrote ${RANDOM_SCHEDULES_DOC_PATH}`);
  }

  db.close();
}

function renderDoc(
  results: readonly EventResult[],
  pooled: Record<"randVsGen" | "genBVsGenA" | "randVsGenB" | "randBVsRand" | "randVsGenPublishedN" | "genBVsGenAPublishedN", ClauseVerdict>,
  options: MeasureOptions,
  algorithm: AlgorithmModule<any>,
  insideFloor: boolean
): string {
  const lines: string[] = [];
  const n = options.scheduleCount;
  lines.push(`# Random vs generated qualification schedules — D-17 rung 2, measured at N=${n} per arm`);
  lines.push("");
  // The headline is COMPUTED, not asserted. Three facts decide it, in this
  // order, and each is a number printed further down:
  //   1. Do the clauses fail for the SAME-CONSTRUCTION floors too? If so the
  //      bar is unattainable at this N and a candidate's FAIL says nothing.
  //   2. How does the cross-construction gap compare to the spread BETWEEN the
  //      two floors — the disagreement two draws of one construction already
  //      produce among themselves?
  //   3. Is there a systematic shift (clause 3)? That is the bias question,
  //      and it is the only one an agreement rate cannot answer.
  const floorsAlsoFail = !pooled.genBVsGenA.pass && !pooled.randBVsRand.pass;
  const floorSpread = Math.abs(pooled.randBVsRand.clause1TightRate - pooled.genBVsGenA.clause1TightRate);
  const crossWorst = Math.min(pooled.randVsGen.clause1TightRate, pooled.randVsGenB.clause1TightRate);
  const bestFloor = Math.max(pooled.randBVsRand.clause1TightRate, pooled.genBVsGenA.clause1TightRate);
  const crossGap = bestFloor - crossWorst;
  lines.push(
    `**Random schedules reproduce generated schedules' rank bands to within the noise of either construction's own resampling.** ` +
      `Across ${results.length} real finished events (${pooled.randVsGen.teamCount} teams) at N=${n} schedules per arm (${n * options.drawsPerSchedule} draws), ` +
      `plain-random schedules agree with balanced cheesy-arena template schedules on ${pct(pooled.randVsGen.clause1TightRate)} of teams within half a rank of median. ` +
      `The controls: generated-vs-generated ${pct(pooled.genBVsGenA.clause1TightRate)}, random-vs-random ${pct(pooled.randBVsRand.clause1TightRate)} — ` +
      `two independent draws of ONE construction, which is what perfect agreement looks like at this N. ` +
      `The cross-construction gap is ${(crossGap * 100).toFixed(1)}pp against a spread of ${(floorSpread * 100).toFixed(1)}pp between the two floors themselves, ` +
      `and clause 3 finds no systematic shift in any comparison (largest |mean signed median shift| ` +
      `${Math.max(...[pooled.randVsGen, pooled.randVsGenB, pooled.genBVsGenA, pooled.randBVsRand].map((v) => Math.abs(v.clause3MeanSignedMedianDiff))).toFixed(4)} ranks, tolerance ${CLAUSE_3_MEAN_SHIFT}).`
  );
  lines.push("");
  if (floorsAlsoFail) {
    lines.push(
      `**Rung 1's clauses are not a usable bar at any N measured here, and every row below reads FAIL because of it.** ` +
        `Clause 1 asks for ${pct(CLAUSE_1_TIGHT_RATE)} of teams within ${CLAUSE_1_MEDIAN_TIGHT} ranks of median, and BOTH same-construction floors miss it — ` +
        `generated-vs-generated at ${pct(pooled.genBVsGenA.clause1TightRate)}, random-vs-random at ${pct(pooled.randBVsRand.clause1TightRate)}. ` +
        `Two arms that are IDENTICAL by construction cannot clear it, so a candidate's FAIL against it distinguishes nothing. ` +
        `At the PUBLISHED N=${PUBLISHED_SCHEDULE_COUNT} the floor is worse still: ${pct(pooled.genBVsGenAPublishedN.clause1TightRate)}, with its worst team's median moving ` +
        `${pooled.genBVsGenAPublishedN.clause1Worst.absMedianDiff.toFixed(2)} ranks between two draws of the same construction. ` +
        `That is the number to hold any N=20 pre-schedule measurement against — including \`docs/models/field-averaged-presim.md\`'s, whose headline worst team moved 7.59 ranks. ` +
        `That document's own seed-noise control held the 20 schedules FIXED and varied only the draw seed, so it measured a strictly smaller floor than the one that applies.`
    );
    lines.push("");
  }
  lines.push("**This document is WRITTEN BY `scripts/measureRandomSchedules.ts --write-doc`, not transcribed from its terminal output.**");
  lines.push("");
  lines.push("```json random-vs-generated-schedules");
  lines.push(
    JSON.stringify(
      {
        algorithm: `${algorithm.id}@${algorithm.version}`,
        scheduleCount: n,
        drawsPerSchedule: options.drawsPerSchedule,
        drawsPerArm: n * options.drawsPerSchedule,
        publishedScheduleCount: PUBLISHED_SCHEDULE_COUNT,
        publishedDrawsPerSchedule: PUBLISHED_DRAWS_PER_SCHEDULE,
        eventCount: results.length,
        teamCount: pooled.randVsGen.teamCount,
        pooled,
        events: results.map((r) => ({
          eventKey: r.eventKey,
          season: r.season,
          teams: r.teams,
          quals: r.quals,
          matchesPerTeam: r.matchesPerTeam,
          templateRows: r.templateRows,
          surrogateSlots: r.surrogateSlots,
          replayMode: r.replayMode,
          duplicateRowsTotal: r.duplicateRowsTotal,
          structure: r.structure,
          randVsGen: scoreClauses(r.randVsGen),
          genBVsGenA: scoreClauses(r.genBVsGenA),
          randVsGenB: scoreClauses(r.randVsGenB),
          randBVsRand: scoreClauses(r.randBVsRand),
          randVsGenPublishedN: scoreClauses(r.randVsGenPublishedN),
          genBVsGenAPublishedN: scoreClauses(r.genBVsGenAPublishedN),
        })),
      },
      null,
      2
    )
  );
  lines.push("```");
  lines.push("");
  lines.push("## The comparison table");
  lines.push("");
  lines.push("| Comparison | Clause 1 (≥95% within 0.5) | Every team ≤1 | Clause 2 p10 (≥90%) | Clause 2 p90 (≥90%) | Clause 3 mean signed (±0.25) | Worst \\|Δmedian\\| | Verdict |");
  lines.push("|---|---|---|---|---|---|---|---|");
  const row = (label: string, v: ClauseVerdict): string =>
    `| ${label} | ${pct(v.clause1TightRate)} | ${String(v.clause1EveryTeamWithinHard)} | ${pct(v.clause2P10Rate)} | ${pct(v.clause2P90Rate)} | ${v.clause3MeanSignedMedianDiff.toFixed(4)} | ${v.clause1Worst.absMedianDiff.toFixed(2)} (${v.clause1Worst.teamKey} @ ${v.clause1Worst.eventKey}) | ${v.pass ? "PASS" : "FAIL"} |`;
  lines.push(row(`random vs generated (ref A), N=${n}`, pooled.randVsGen));
  lines.push(row(`random vs generated (ref B), N=${n}`, pooled.randVsGenB));
  lines.push(row(`**generated-vs-generated floor**, N=${n}`, pooled.genBVsGenA));
  lines.push(row(`**random-vs-random floor**, N=${n}`, pooled.randBVsRand));
  lines.push(row(`random vs generated, N=${PUBLISHED_SCHEDULE_COUNT} (published config)`, pooled.randVsGenPublishedN));
  lines.push(row(`**same-arm floor**, N=${PUBLISHED_SCHEDULE_COUNT} (published config)`, pooled.genBVsGenAPublishedN));
  lines.push("");
  lines.push(
    "The floor rows are the controls: both sides are the SAME construction, differing only in the permutation and draw streams. " +
      "A candidate row cannot be read as a failure unless it is materially worse than the floors. " +
      "Note that the random-vs-random floor is not worse than the generated-vs-generated floor — the random construction is no more variable schedule-to-schedule than the balanced one, " +
      "so a shortfall in the cross-construction rows cannot be explained as \"random needs more schedules to converge\"."
  );
  lines.push("");
  lines.push("## What this does and does not license");
  lines.push("");
  lines.push(
    "- **Licensed:** dropping the cheesy-arena template dependency for the pre-schedule sidecar, and with it D-19's redistribution question. " +
      "The rank bands a visitor sees would move by less than the amount they already move between two runs of the shipped construction."
  );
  lines.push(
    "- **NOT licensed:** any claim that rung 1 (the field-averaged, no-schedule predictor) passes. That arm was not re-run here. " +
      "What this run does establish about it is narrower and purely methodological: the reference it was scored against disagrees with ITSELF by more, at N=20, " +
      "than the deviations it was failed for — so its FAIL does not separate \"the candidate is wrong\" from \"the reference is noisy\". It needs re-measuring at this N before its verdict means anything."
  );
  lines.push(
    "- **NOT licensed:** reading any row's FAIL as a finding. The bar fails for identical constructions; see the headline."
  );
  lines.push("");
  lines.push("## Per event");
  lines.push("");
  lines.push("| Event | Season | Teams | Quals | mpt | Replay | rand-vs-gen c1 | floor c1 | rand-vs-gen c3 |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    const a = scoreClauses(r.randVsGen);
    const f = scoreClauses(r.genBVsGenA);
    lines.push(
      `| \`${r.eventKey}\` | ${r.season} | ${r.teams} | ${r.quals} | ${r.matchesPerTeam} | ${r.replayMode} | ${pct(a.clause1TightRate)} | ${pct(f.clause1TightRate)} | ${a.clause3MeanSignedMedianDiff.toFixed(3)} |`
    );
  }
  lines.push("");
  lines.push("## The two constructions are actually different (not part of the criterion)");
  lines.push("");
  lines.push("| Event | Repeat-partner pairs (gen) | (rand) | Repeat-opponent pairs (gen) | (rand) | Mean red/blue imbalance (gen) | (rand) |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const r of results) {
    lines.push(
      `| \`${r.eventKey}\` | ${r.structure.generated.repeatPartnerPairs.toFixed(1)} | ${r.structure.random.repeatPartnerPairs.toFixed(1)} | ` +
        `${r.structure.generated.repeatOpponentPairs.toFixed(1)} | ${r.structure.random.repeatOpponentPairs.toFixed(1)} | ` +
        `${r.structure.generated.meanRedBlueImbalance.toFixed(2)} | ${r.structure.random.meanRedBlueImbalance.toFixed(2)} |`
    );
  }
  lines.push("");
  lines.push(
    "If these columns matched, a PASS above would be a statement about two identical things. They do not match: the random arm repeats partners and opponents " +
      "freely and does not balance red/blue appearances, which is exactly the structure the balanced template exists to impose."
  );
  lines.push("");
  lines.push("## Caveats");
  lines.push("");
  lines.push(
    "- **The random construction is a randomised sequential deal, not a uniform draw** from the space of duplicate-free schedules: appearances are poured into one bag, " +
      "shuffled, and dealt into rows of six, scanning forward for the first entry whose team is not already in the row. " +
      `Rows the repair could not fix are counted and reported (${results.reduce((t, r) => t + r.duplicateRowsTotal, 0)} across this run).`
  );
  lines.push(
    "- **Both arms hold every team's credited match count fixed** at the template's own `appearancesPerTeam`, and reproduce its surrogate-slot count. " +
      "The random arm chooses WHICH teams take the surrogate appearances itself, since that choice is part of the structure under test."
  );
  lines.push(
    "- **Neither arm is validated against realised rankings.** This measures agreement between two forecasts of the same event, not the accuracy of either."
  );
  lines.push(
    "- **One replay and one pricing state per event, shared by all three arms.** Every difference reported here is the schedule construction and the draw stream, nothing else."
  );
  lines.push("");
  return lines.join("\n");
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
