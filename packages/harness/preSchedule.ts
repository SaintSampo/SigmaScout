/**
 * The pure pre-schedule sidecar builder. Builds one event's `v1/presim/...`
 * sidecar: K synthetic qualification schedules, each a pairing structure from
 * `generatedSchedules.ts` with the roster shuffled onto its slots, each priced
 * through the caller's `predict` closure, plus the baked default rank
 * distribution the Simulation tab renders on first paint.
 *
 * PURITY CONTRACT: no corpus read, no R2 call, no filesystem access and no
 * wall-clock read. Every value that varies between runs is passed in
 * (`generation`, `computedAt`) or derived from a pure hash (of
 * `eventKey`/`algorithmVersion`/schedule index for shuffles and baked draws,
 * of roster size/matches per team/schedule index for pairing structures), so
 * republishing the same corpus twice produces byte-identical sidecars.
 *
 * This module holds no pricing math: it only calls the caller's `predict`,
 * already bound to the right walk-forward state, so every published pmf comes
 * from the same RP path real matches use.
 */
import {
  PAGE_ARTIFACT_SCHEMA_VERSION,
  PreScheduleArtifactSchema,
  FieldAveragedPreScheduleArtifactSchema,
  type PreScheduleArtifact,
  type FieldAveragedPreScheduleArtifact,
} from "./pageArtifacts.js";
import {
  fieldAveragedMatchPmf,
  fieldStatistics,
  type FieldTeamContribution,
} from "../core/rankingPoints/fieldAveraged.js";
import type { RpMomentsAccumulator } from "../core/rankingPoints/empiricalMoments.js";
import { rosterIsFullyWarm, type RpMeanShiftAccumulator } from "../core/rankingPoints/meanShift.js";
import type { RpRuleModule } from "../core/rankingPoints/constants.js";
import { DEFAULT_RESTARTS, generateSchedule, type ScheduleMatch } from "./generatedSchedules.js";
import { roundPmf } from "./rounding.js";
import {
  mulberry32,
  simulateRanks,
  type SimMatchInput,
  type SimMatchOutcomeInput,
  type SimTeamBaseline,
} from "../core/algorithms/simulation/rankSimulation.js";
import type { Prediction, UpcomingMatch } from "../core/algorithms/types.js";

/**
 * A pmf that goes missing PARTWAY through a schedule is corruption: whether an
 * algorithm models ranking points cannot flip between two structurally
 * identical synthetic matches. An absent pmf on the first-match probe in
 * `buildPreScheduleArtifact` is the ordinary answer and returns `null` instead.
 */
export class PreSchedulePricingError extends Error {
  /**
   * `missing` names what vanished: the base `redRpPmf`/`blueRpPmf` pair, or the
   * RP decomposition once the first priced prediction showed this algorithm
   * carries it.
   */
  constructor(syntheticMatchKey: string, missing: "redRpPmf/blueRpPmf" | "the RP decomposition" = "redRpPmf/blueRpPmf") {
    super(
      `buildPreScheduleArtifact: predict returned no ${missing} for synthetic match "${syntheticMatchKey}" after pricing earlier matches successfully — a pmf that goes missing partway through a schedule is corruption, not an RP-less algorithm`
    );
    this.name = "PreSchedulePricingError";
  }
}

/**
 * Builds the fourth `toSimMatchInput` argument from a `Prediction`'s RP
 * decomposition, or `undefined` unless all five fields are present (a partial
 * set is not a usable coupled-draw input). The outcome RPs pass through
 * unrounded (exact small integers); the pmfs go through `roundPmf` like `rp`/`bp`.
 */
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

export interface PreScheduleBuildParams {
  readonly eventKey: string;
  readonly season: number;
  /** TBA `event_type`, carried through to every synthetic `UpcomingMatch` — load-bearing, not decorative: the RP fold gates pmf production on `isRpEligibleEventType(match.eventType)`. */
  readonly eventType: number;
  /**
   * The real event's TBA week, 0-indexed as the corpus stores it, or `null`
   * when TBA gives none. Required rather than defaulted: `0` is a real week
   * (Statbotics' week 1), so a fabricated `0` would enrol synthetic matches
   * in the week-1 calibration population.
   */
  readonly week: number | null;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  readonly roster: readonly string[];
  readonly matchesPerTeam: number;
  readonly pricedFrom: "pre-event-walk-forward" | "current-state";
  readonly scheduleCount: number;
  readonly drawsPerSchedule: number;
  readonly generation: string;
  readonly computedAt: string;
  /** Already bound to the right walk-forward state by the caller; pure, so calling it is side-effect-free. */
  readonly predict: (match: UpcomingMatch) => Prediction;
}

/**
 * FNV-1a 32-bit (http://www.isthe.com/chongo/tech/comp/fnv/). Every seed in
 * this module comes through here, from strings built only of fixed inputs and
 * a salt, so changing nothing changes nothing.
 */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** How many (roster size, matches per team) cells the shared structure memo holds. 2026's publish reaches 72 distinct cells. */
export const SCHEDULE_STRUCTURE_CACHE_CELLS = 128;

/** A slot index shares its code unit with the surrogate flag: the flag is the top bit, the index the bits below it. */
const NARROW_SURROGATE_BIT = 0x80;
const WIDE_SURROGATE_BIT = 0x8000;
/** Rosters up to this size encode one byte per slot; larger ones (up to `MAX_SCHEDULE_TEAMS`) two. */
const NARROW_MAX_TEAMS = NARROW_SURROGATE_BIT;

type EncodedStructure = Uint8Array | Uint16Array;

/** Six code units per match, red then blue, each the slot index with the surrogate flag in its top bit. */
function encodeStructure(structure: readonly ScheduleMatch[], numTeams: number): EncodedStructure {
  const wide = numTeams > NARROW_MAX_TEAMS;
  const flagBit = wide ? WIDE_SURROGATE_BIT : NARROW_SURROGATE_BIT;
  const encoded = wide ? new Uint16Array(structure.length * 6) : new Uint8Array(structure.length * 6);
  for (let m = 0; m < structure.length; m++) {
    const match = structure[m]!;
    for (let pos = 0; pos < 3; pos++) {
      encoded[m * 6 + pos] = match.red[pos]! | (match.redSurrogate[pos] === true ? flagBit : 0);
      encoded[m * 6 + 3 + pos] = match.blue[pos]! | (match.blueSurrogate[pos] === true ? flagBit : 0);
    }
  }
  return encoded;
}

function decodeStructure(encoded: EncodedStructure): ScheduleMatch[] {
  const flagBit = encoded instanceof Uint16Array ? WIDE_SURROGATE_BIT : NARROW_SURROGATE_BIT;
  const indexMask = flagBit - 1;
  const matches: ScheduleMatch[] = [];
  for (let offset = 0; offset < encoded.length; offset += 6) {
    const red: number[] = [];
    const blue: number[] = [];
    const redSurrogate: boolean[] = [];
    const blueSurrogate: boolean[] = [];
    for (let pos = 0; pos < 3; pos++) {
      const r = encoded[offset + pos]!;
      const b = encoded[offset + 3 + pos]!;
      red.push(r & indexMask);
      blue.push(b & indexMask);
      redSurrogate.push((r & flagBit) !== 0);
      blueSurrogate.push((b & flagBit) !== 0);
    }
    matches.push({ red, blue, redSurrogate, blueSurrogate });
  }
  return matches;
}

/**
 * A bounded LRU memo of generated pairing structures, shared by event shape:
 * schedule `k`'s structure depends only on (numTeams, matchesPerTeam, k), so a
 * full-season publish generates each one once.
 *
 * TRANSPARENT: `get` returns exactly what `generateSchedule` would with the
 * `generate|numTeams|matchesPerTeam|k` seed, so cache state and eviction can
 * never change a published byte. Every read returns freshly built arrays, so a
 * caller mutating what it got cannot reach the cache.
 *
 * Structures are held as typed arrays (see `encodeStructure`); at most
 * `maxCells` cells are kept, evicting the least recently used.
 */
export class ScheduleStructureCache {
  readonly maxCells: number;
  readonly #cells = new Map<string, Map<number, EncodedStructure>>();

  constructor(maxCells: number) {
    if (!Number.isInteger(maxCells) || maxCells < 1) {
      throw new Error(`ScheduleStructureCache: maxCells must be a positive integer, got ${String(maxCells)}`);
    }
    this.maxCells = maxCells;
  }

  /** The number of (numTeams, matchesPerTeam) cells currently held. Never above `maxCells`. */
  get cellCount(): number {
    return this.#cells.size;
  }

  /** Whether the cell for this shape is currently held. Asking does not refresh its recency. */
  hasCell(numTeams: number, matchesPerTeam: number): boolean {
    return this.#cells.has(`${numTeams}|${matchesPerTeam}`);
  }

  get(numTeams: number, matchesPerTeam: number, k: number): ScheduleMatch[] {
    if (!Number.isInteger(k) || k < 0) {
      throw new Error(`ScheduleStructureCache: schedule index must be a non-negative integer, got ${String(k)}`);
    }
    const cellKey = `${numTeams}|${matchesPerTeam}`;
    let cell = this.#cells.get(cellKey);
    if (cell !== undefined) {
      // Least-recently-used order is the map's insertion order: re-inserting
      // moves this cell to the most recent end.
      this.#cells.delete(cellKey);
      this.#cells.set(cellKey, cell);
      const encoded = cell.get(k);
      if (encoded !== undefined) return decodeStructure(encoded);
    }
    // Generated BEFORE any cell is created, so a roster the generator refuses
    // throws without inserting an empty cell or evicting a live one.
    const structure = generateSchedule(
      numTeams,
      matchesPerTeam,
      mulberry32(fnv1a32(`generate|${numTeams}|${matchesPerTeam}|${k}`)),
      DEFAULT_RESTARTS
    );
    if (cell === undefined) {
      while (this.#cells.size >= this.maxCells) {
        const oldest = this.#cells.keys().next().value as string;
        this.#cells.delete(oldest);
      }
      cell = new Map();
      this.#cells.set(cellKey, cell);
    }
    cell.set(k, encodeStructure(structure, numTeams));
    return structure;
  }
}

/** The one memo `buildPreScheduleArtifact` reads, capped at `SCHEDULE_STRUCTURE_CACHE_CELLS`. */
export const SHARED_STRUCTURE_CACHE = new ScheduleStructureCache(SCHEDULE_STRUCTURE_CACHE_CELLS);

/** Seeded Fisher–Yates over `[0..count)`: `slots[structureSlot]` is the roster index occupying that slot. */
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

/**
 * The one implementation of surrogate handling on the `simulateRanks` side: a
 * surrogate plays the match (so `predict` prices it) but earns no ranking
 * credit, so it is excluded from the team-key lists handed to `simulateRanks`.
 */
export function toSimMatchInput(
  upcoming: UpcomingMatch,
  redRpPmf: readonly number[],
  blueRpPmf: readonly number[],
  outcome?: SimMatchOutcomeInput
): SimMatchInput {
  return {
    redTeamKeys: upcoming.redTeams.filter((teamKey) => !upcoming.redSurrogates.includes(teamKey)),
    blueTeamKeys: upcoming.blueTeams.filter((teamKey) => !upcoming.blueSurrogates.includes(teamKey)),
    redRpPmf,
    blueRpPmf,
    ...(outcome !== undefined ? { outcome } : {}),
  };
}

/** One synthetic match, fully built: the leak-free `UpcomingMatch` handed to `predict`, plus its roster-index encoding for the published artifact. */
interface SyntheticMatch {
  readonly upcoming: UpcomingMatch;
  readonly r: readonly number[];
  readonly b: readonly number[];
}

/** Builds schedule `k`'s full synthetic match list from its pairing structure and that schedule's shuffle. */
function buildScheduleMatches(
  params: PreScheduleBuildParams,
  sortedRoster: readonly string[],
  structure: readonly ScheduleMatch[],
  k: number,
  slots: readonly number[]
): SyntheticMatch[] {
  return structure.map((structureMatch, matchIndex) => {
    const n = matchIndex + 1; // one-based match number
    const r = structureMatch.red.map((slot) => slots[slot]!);
    const b = structureMatch.blue.map((slot) => slots[slot]!);
    const redTeams = r.map((rosterIndex) => sortedRoster[rosterIndex]!);
    const blueTeams = b.map((rosterIndex) => sortedRoster[rosterIndex]!);
    const upcoming: UpcomingMatch = {
      // `_presim{k}_qm{n}` is structurally incapable of colliding with a
      // real TBA match key (TBA's are `{eventKey}_qm{n}` / `_sf{s}m{n}` etc.).
      matchKey: `${params.eventKey}_presim${k}_qm${n}`,
      eventKey: params.eventKey,
      compLevel: "qm",
      setNumber: 1,
      matchNumber: n,
      redTeams,
      blueTeams,
      redSurrogates: redTeams.filter((_, position) => structureMatch.redSurrogate[position] === true),
      blueSurrogates: blueTeams.filter((_, position) => structureMatch.blueSurrogate[position] === true),
      eventType: params.eventType,
      week: params.week,
    };
    return { upcoming, r, b };
  });
}

/**
 * Builds one event's pre-schedule sidecar, or `null` when the bound algorithm
 * does not model ranking points (detected on the first priced synthetic match,
 * before anything else is priced).
 *
 * Pairing structures come from `SHARED_STRUCTURE_CACHE`; the shuffle and baked
 * seeds stay per event. A `GeneratedScheduleError` propagates for a roster
 * outside the generator's range, so callers check roster size first.
 *
 * The result has passed `PreScheduleArtifactSchema.parse` (not `safeParse`), so
 * a builder bug can never reach R2.
 */
export function buildPreScheduleArtifact(params: PreScheduleBuildParams): PreScheduleArtifact | null {
  // Sorting makes republish determinism independent of corpus row order: this
  // sorted array is the published roster and the index space for every `r`/`b`
  // array and baked histogram.
  const sortedRoster = [...params.roster].sort();
  // Schedule 0's structure only, so an RP-less algorithm touches one structure.
  const firstStructure = SHARED_STRUCTURE_CACHE.get(sortedRoster.length, params.matchesPerTeam, 0);

  // An absent pmf on the first synthetic match is the ordinary "no RP model"
  // answer, not an error.
  const firstSeed = fnv1a32(`${params.eventKey}|${params.algorithmVersion}|shuffle|0`);
  const firstSlots = seededShuffle(sortedRoster.length, mulberry32(firstSeed));
  const firstScheduleMatches = buildScheduleMatches(params, sortedRoster, firstStructure, 0, firstSlots);
  const firstPrediction = params.predict(firstScheduleMatches[0]!.upcoming);
  if (firstPrediction.redRpPmf === undefined || firstPrediction.blueRpPmf === undefined) {
    return null;
  }
  // Whether this algorithm carries the RP decomposition is decided once, from
  // the first priced prediction. Absent throughout is an ordinary answer; the
  // decomposition is never a precondition for building a sidecar.
  const firstHasDecomposition = buildOutcomeInput(firstPrediction) !== undefined;

  const schedules: PreScheduleArtifact["schedules"][number][] = [];
  const simInputsBySchedule: SimMatchInput[][] = [];

  for (let k = 0; k < params.scheduleCount; k++) {
    const seed = k === 0 ? firstSeed : fnv1a32(`${params.eventKey}|${params.algorithmVersion}|shuffle|${k}`);
    const syntheticMatches =
      k === 0
        ? firstScheduleMatches
        : buildScheduleMatches(
            params,
            sortedRoster,
            SHARED_STRUCTURE_CACHE.get(sortedRoster.length, params.matchesPerTeam, k),
            k,
            seededShuffle(sortedRoster.length, mulberry32(seed))
          );

    const publishedMatches: PreScheduleArtifact["schedules"][number]["matches"][number][] = [];
    const simInputs: SimMatchInput[] = [];
    for (let matchIndex = 0; matchIndex < syntheticMatches.length; matchIndex++) {
      const synthetic = syntheticMatches[matchIndex]!;
      // Schedule 0's first match was already priced by the probe.
      const prediction = k === 0 && matchIndex === 0 ? firstPrediction : params.predict(synthetic.upcoming);
      if (prediction.redRpPmf === undefined || prediction.blueRpPmf === undefined) {
        throw new PreSchedulePricingError(synthetic.upcoming.matchKey);
      }
      // Same rounding as `buildEventArtifact`'s real matches.
      const rp = roundPmf(prediction.redRpPmf);
      const bp = roundPmf(prediction.blueRpPmf);
      const outcome = buildOutcomeInput(prediction);
      if (firstHasDecomposition && outcome === undefined) {
        throw new PreSchedulePricingError(synthetic.upcoming.matchKey, "the RP decomposition");
      }
      publishedMatches.push({ r: [...synthetic.r], b: [...synthetic.b], rp, bp });
      simInputs.push(toSimMatchInput(synthetic.upcoming, rp, bp, outcome));
    }
    schedules.push({ seed, matches: publishedMatches });
    simInputsBySchedule.push(simInputs);
  }

  // The baked default result. Baselines are zero for everyone: before schedule
  // release nobody has played, so the distribution comes from the pmfs alone.
  const baselines: SimTeamBaseline[] = sortedRoster.map((teamKey) => ({ teamKey, earnedRpSum: 0, matchesPlayed: 0 }));
  const totals: number[][] = sortedRoster.map(() => new Array<number>(sortedRoster.length).fill(0));
  for (let k = 0; k < params.scheduleCount; k++) {
    // A distinct salt, so the draw stream never aliases the shuffle stream.
    const bakedSeed = fnv1a32(`${params.eventKey}|${params.algorithmVersion}|baked|${k}`);
    const result = simulateRanks(simInputsBySchedule[k]!, baselines, params.drawsPerSchedule, mulberry32(bakedSeed));
    for (let teamIndex = 0; teamIndex < sortedRoster.length; teamIndex++) {
      const histogram = result.rankHistograms.get(sortedRoster[teamIndex]!)!;
      const teamTotals = totals[teamIndex]!;
      for (let rank = 0; rank < histogram.length; rank++) {
        teamTotals[rank]! += histogram[rank]!;
      }
    }
  }

  const assembled = {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: params.generation,
    computedAt: params.computedAt,
    algorithmId: params.algorithmId,
    algorithmVersion: params.algorithmVersion,
    eventKey: params.eventKey,
    season: params.season,
    pricedFrom: params.pricedFrom,
    matchesPerTeam: params.matchesPerTeam,
    roster: sortedRoster,
    schedules,
    baked: {
      draws: params.scheduleCount * params.drawsPerSchedule,
      histograms: totals,
    },
  };
  return PreScheduleArtifactSchema.parse(assembled);
}

// ---------------------------------------------------------------------------
// The FIELD-AVERAGED path
// ---------------------------------------------------------------------------

/** Everything `buildFieldContributions` reads, each from the instant the schedule-based path already read it from. */
export interface FieldContributionInputs {
  readonly roster: readonly string[];
  /** The season's walk-forward per-team RP beliefs — `SigmaScoutLayer.rpAccumulator`. */
  readonly rpAccumulator: RpMomentsAccumulator | undefined;
  /** `SigmaScoutLayer.sigmaScoreByTeam()` — Sigma Score for SPR; empty for algorithms without one. */
  readonly sigmaScoreByTeam: ReadonlyMap<string, number>;
  /** `algorithm.teamMetrics(pricingState, roster)[team][TOTAL_METRIC_KEY].value`, per team. */
  readonly teamTotals: ReadonlyMap<string, number>;
}

/**
 * One `FieldTeamContribution` per roster team, in sorted roster order, or
 * `null` under the all-or-nothing roster rule (`makeRankingPointFiller`'s rule
 * in publish.ts): decide once for the whole event, because deciding per match
 * lets a later unpriceable match throw as corruption and take the publish down.
 * A `null` is the ordinary "not enough seen of this roster" answer.
 *
 * A team missing from `sigmaScoreByTeam` has played too little; one missing
 * from `teamTotals` was never rated. Either way the roster cannot be priced.
 *
 * A one-team `momentsFor` call returns the team's own belief: its scaling
 * factor `roster.length^2 / contributing` is exactly 1.
 *
 * A team with no belief for a variable contributes mean `0` and variance `0`
 * and stays in the field, because a cold team is part of the field; dropping it
 * would shift `meanOfVariableMeans` upward and narrow every band in the event.
 */
export function buildFieldContributions(inputs: FieldContributionInputs): FieldTeamContribution[] | null {
  const { rpAccumulator, sigmaScoreByTeam, teamTotals } = inputs;
  if (rpAccumulator === undefined) return null;
  // Sorted first, so output is independent of corpus row order.
  const sortedRoster = [...inputs.roster].sort();
  if (sortedRoster.length === 0) return null;
  for (const teamKey of sortedRoster) {
    if (!sigmaScoreByTeam.has(teamKey)) return null;
    if (!teamTotals.has(teamKey)) return null;
  }
  return sortedRoster.map((teamKey) => {
    const own = rpAccumulator.momentsFor([teamKey], 0, 0);
    const sigmaScore = sigmaScoreByTeam.get(teamKey) as number;
    return {
      teamKey,
      variableMeans: own.meanVector,
      variableVariances: own.varianceBlock.map((row, i) => row[i] ?? 0),
      scoreMean: teamTotals.get(teamKey) as number,
      // Squared, matching `allianceSigmaBandVariance`'s per-team `sigma * sigma` term.
      bandVariance: sigmaScore * sigmaScore,
    };
  });
}

/**
 * The field-averaged presim's per-variable mean shift, or `undefined`.
 *
 * All-or-nothing per event, like `buildFieldContributions`: a field-averaged
 * match has no real alliance to run the per-alliance fully-warm check on, so
 * the shift applies only when every roster team has complete history.
 *
 * Each entry is `sum / count` past the warmup and `0` before it; `undefined`
 * when nothing would shift, so the absent path prices unshifted. The vector
 * comes from `RpMeanShiftAccumulator.apply` on zero means, so it cannot drift
 * from the real-match warmup rule.
 */
export function fieldMeanShiftVector(inputs: {
  readonly roster: readonly string[];
  readonly rpAccumulator: RpMomentsAccumulator | undefined;
  readonly meanShift: RpMeanShiftAccumulator | undefined;
}): readonly number[] | undefined {
  const { rpAccumulator, meanShift } = inputs;
  if (rpAccumulator === undefined || meanShift === undefined) return undefined;
  if (!rosterIsFullyWarm(rpAccumulator, inputs.roster)) return undefined;
  const names = rpAccumulator.variableNames;
  const zeros = {
    variableNames: [...names],
    meanVector: names.map(() => 0),
    varianceBlock: names.map(() => names.map(() => 0)),
    scoreMean: 0,
    scoreVariance: 0,
    scoreCrossCovariance: names.map(() => 0),
  };
  const shifted = meanShift.apply(zeros, true);
  return shifted === zeros ? undefined : [...shifted.meanVector];
}

export interface FieldAveragedPreScheduleBuildParams {
  readonly eventKey: string;
  readonly season: number;
  /** TBA `event_type` — load-bearing, not decorative: `eventTierFor` throws for an unmapped type and the bonus thresholds are tier-dependent. */
  readonly eventType: number;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  readonly matchesPerTeam: number;
  readonly pricedFrom: "pre-event-walk-forward" | "current-state";
  readonly draws: number;
  readonly generation: string;
  readonly computedAt: string;
  readonly ruleModule: RpRuleModule;
  /** `buildFieldContributions`' output — already sorted, already all-or-nothing checked. The roster IS its team keys. */
  readonly contributions: readonly FieldTeamContribution[];
  /** `fieldMeanShiftVector`'s output; absent prices unshifted. */
  readonly meanShift?: readonly number[];
}

/**
 * Builds one event's FIELD-AVERAGED pre-schedule sidecar, or `null` when it
 * cannot be priced.
 *
 * Same purity contract as the schedule-based builder. It builds no pairing
 * structure, so an event below the generator's 6-team floor still gets a
 * sidecar. Pricing calls the same `analyticRpPmf` every real match runs,
 * through `fieldAveragedMatchPmf`, so no separate pricing math lives here.
 *
 * The result has passed `FieldAveragedPreScheduleArtifactSchema.parse` (not
 * `safeParse`), so a builder bug can never reach R2.
 */
export function buildFieldAveragedPreScheduleArtifact(
  params: FieldAveragedPreScheduleBuildParams
): FieldAveragedPreScheduleArtifact | null {
  if (params.contributions.length === 0) return null;
  // Sorted again rather than trusted: this array is the published roster and
  // the index space for every `perTeamPmf` entry.
  const sortedRoster = params.contributions.map((c) => c.teamKey).sort();
  const byTeam = new Map(params.contributions.map((c) => [c.teamKey, c]));

  const variableNames = params.ruleModule.thresholdVariables.map((v) => v.name);
  const stats = fieldStatistics(params.contributions, variableNames);
  const perTeamPmf = sortedRoster.map((teamKey) =>
    // Same rounding as every other published pmf.
    roundPmf(fieldAveragedMatchPmf(byTeam.get(teamKey) as FieldTeamContribution, stats, params.ruleModule, params.eventType, params.meanShift))
  );

  const seed = fnv1a32(`${params.eventKey}|${params.algorithmVersion}|fieldAveraged`);

  const assembled = {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: params.generation,
    computedAt: params.computedAt,
    algorithmId: params.algorithmId,
    algorithmVersion: params.algorithmVersion,
    eventKey: params.eventKey,
    season: params.season,
    pricedFrom: params.pricedFrom,
    matchesPerTeam: params.matchesPerTeam,
    roster: sortedRoster,
    perTeamPmf,
    draws: params.draws,
    seed,
  };
  return FieldAveragedPreScheduleArtifactSchema.parse(assembled);
}
