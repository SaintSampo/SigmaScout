/**
 * The pure pre-schedule sidecar builder (quick task 260905-tll Task 2,
 * C-04/C-08/C-09/C-14, PD-03). Builds one event's `v1/presim/...` sidecar:
 * K synthetic qualification schedules, each a pairing structure from the
 * rules-based generator (`generatedSchedules.ts`, quick task 260913-pnp)
 * with the roster shuffled onto its slots, each priced through the caller's
 * `predict` closure, plus the baked default rank distribution the Simulation
 * tab renders on first paint.
 *
 * PURITY CONTRACT: no corpus read, no R2 call, no filesystem access at all,
 * and no wall-clock read — every value that varies between runs is either
 * passed in (`generation`, `computedAt`) or derived from a seed that is
 * itself a pure hash: of `eventKey`/`algorithmVersion`/schedule index for
 * the shuffles and baked draws, and of roster size/matches per team/schedule
 * index for the pairing structures (C-14, threat T-tll-06).
 * The platform's non-seedable random source never appears in this module,
 * so republishing the same corpus twice produces byte-identical sidecars.
 *
 * C-04 is honoured STRUCTURALLY rather than by promise: this module never
 * touches a model. It only calls back into whatever
 * `algorithm.predict(state, match)` the caller has already bound to the
 * right walk-forward state — so every published pmf is produced by the
 * SAME joint-covariance RP path real matches use, and no independence
 * approximation can exist here because no pricing math exists here.
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
 * A pmf that goes missing PARTWAY through a schedule is genuine corruption,
 * not an expected state — an algorithm either models ranking points for
 * this event's shape or it does not, and that answer cannot flip between
 * two structurally identical synthetic matches. Contrast with the
 * first-match probe in `buildPreScheduleArtifact`, where an absent pmf is
 * the ordinary "this algorithm does not model ranking points" answer and
 * returns `null` instead of throwing.
 */
export class PreSchedulePricingError extends Error {
  /**
   * `missing` names what vanished partway through the schedule — either the
   * base `redRpPmf`/`blueRpPmf` pair (the original case) or, since plan
   * 09-07 (D-15), the RP decomposition (`matchOutcomePmf`/`redOutcomeRp`/
   * `blueOutcomeRp`/`redBonusRpPmf`/`blueBonusRpPmf`) once the FIRST priced
   * prediction established that this algorithm carries it — the same
   * first-match-probe discipline `buildPreScheduleArtifact` already applies
   * to the base pmf pair, extended rather than duplicated.
   */
  constructor(syntheticMatchKey: string, missing: "redRpPmf/blueRpPmf" | "the RP decomposition" = "redRpPmf/blueRpPmf") {
    super(
      `buildPreScheduleArtifact: predict returned no ${missing} for synthetic match "${syntheticMatchKey}" after pricing earlier matches successfully — a pmf that goes missing partway through a schedule is corruption, not an RP-less algorithm`
    );
    this.name = "PreSchedulePricingError";
  }
}

/**
 * Builds the fifth `toSimMatchInput` argument from a `Prediction`'s RP
 * decomposition (D-15, plan 09-07) — `undefined` unless ALL FIVE fields are
 * present, since a partial set is not a usable coupled-draw input.
 * `redOutcomeRp`/`blueOutcomeRp` pass through UNROUNDED (exact small
 * integers from the rule module — rounding them would only introduce a way
 * for them to differ); `outcomePmf` and both bonus pmfs are rounded through
 * `roundPmf`, the same quantity/precision `rp`/`bp` already use two lines
 * below each call site.
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
   * The REAL event's TBA competition week, 0-indexed as the corpus stores it
   * (`packages/core/algorithms/epaWeekOne.ts`), or `null` when TBA gives the
   * event no week. Carried through to every synthetic `UpcomingMatch` so a
   * priced synthetic match is placed in the season exactly where its real
   * event is. Required and honest rather than defaulted: `0` is a real week
   * (it is Statbotics' week 1), so a fabricated `0` here would silently
   * enrol synthetic matches in the week-1 calibration population.
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
  /** The C-04 seam: already bound to the right walk-forward state by the caller. Pure per the algorithm contract, so calling it is side-effect-free. */
  readonly predict: (match: UpcomingMatch) => Prediction;
}

/**
 * FNV-1a 32-bit, written inline per the plan (a small, well-known string
 * hash — cite, don't rederive: http://www.isthe.com/chongo/tech/comp/fnv/).
 * Every shuffle seed and every baked-simulation seed in this module comes
 * through here, from strings built ONLY of `eventKey`, `algorithmVersion`,
 * a fixed salt and the schedule index — so changing any of those changes
 * the stream, and changing nothing changes nothing.
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
 * A bounded memo of generated pairing structures, SHARED BY EVENT SHAPE
 * (Jacob's decision, 2026-09-14). Schedule `k`'s structure for an event with
 * `numTeams` teams at `matchesPerTeam` matches per team is the same for every
 * event of that shape, so a full-season publish generates each one once.
 *
 * TRANSPARENT: `get(numTeams, matchesPerTeam, k)` returns exactly
 * `generateSchedule(numTeams, matchesPerTeam, mulberry32(fnv1a32("generate|numTeams|matchesPerTeam|k")), DEFAULT_RESTARTS)`.
 * Output is a pure function of the key, so cache state and eviction can never
 * change a published byte: a cold read, a warm read and a read after eviction
 * all deep-equal a fresh generation. Every read returns freshly built arrays,
 * so a caller mutating what it got cannot reach the cache.
 *
 * COMPACT: each (numTeams, matchesPerTeam) cell holds its structures, filled
 * lazily per `k`, as typed arrays of six code units per match — the slot index
 * with the positional surrogate flag in the top bit, one byte per slot up to
 * 128 teams and two bytes up to `MAX_SCHEDULE_TEAMS`.
 *
 * BOUNDED: at most `maxCells` cells are held. Adding a cell beyond that evicts
 * the least recently used one, so a many-season presim run cannot grow the memo
 * without limit.
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

/** Fisher–Yates over `[0..count)` driven by a seeded `rng` — `slots[structureSlot]` is the roster index occupying that slot (C-14). */
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
 * PD-03, the one implementation of surrogate handling on the
 * `simulateRanks` side: a surrogate PLAYS the match (it is inside
 * `redTeams`/`blueTeams` and therefore inside the alliance `predict`
 * prices), but earns no ranking credit — so it is EXCLUDED from the
 * team-key lists handed to `simulateRanks`, crediting the drawn RP only to
 * the non-surrogates. Exported so the exclusion rule is directly testable;
 * `buildPreScheduleArtifact` has no second copy of it.
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
 * Builds one event's pre-schedule sidecar, or returns `null` when the
 * bound algorithm does not model ranking points (detected on the FIRST
 * priced synthetic match, before anything else is priced — cheap enough
 * that a full-season publish across three algorithms wastes nothing on the
 * two that have no RP model).
 *
 * Schedule `k`'s pairing structure comes from `SHARED_STRUCTURE_CACHE`, keyed
 * by roster size, matches per team and `k` — shared by every event of the
 * same shape, while the shuffle and baked seeds stay per event. A
 * `GeneratedScheduleError` propagates for a roster outside the generator's
 * range; callers check roster size first.
 *
 * The returned object has already passed `PreScheduleArtifactSchema.parse`
 * — parse, not `safeParse`, so a builder bug can never reach R2.
 */
export function buildPreScheduleArtifact(params: PreScheduleBuildParams): PreScheduleArtifact | null {
  // Sorting (rather than trusting caller order) is what makes republish
  // determinism independent of corpus row order: this sorted array IS the
  // published roster and defines the index space for every `r`/`b` array
  // and every baked histogram.
  const sortedRoster = [...params.roster].sort();
  // Schedule 0's structure only, before the probe: an RP-less algorithm
  // returns below having touched exactly one structure.
  const firstStructure = SHARED_STRUCTURE_CACHE.get(sortedRoster.length, params.matchesPerTeam, 0);

  // Probe the FIRST synthetic match only, before building the rest: an
  // absent pmf here means "this algorithm does not model ranking points" —
  // an ordinary answer, not an error.
  const firstSeed = fnv1a32(`${params.eventKey}|${params.algorithmVersion}|shuffle|0`);
  const firstSlots = seededShuffle(sortedRoster.length, mulberry32(firstSeed));
  const firstScheduleMatches = buildScheduleMatches(params, sortedRoster, firstStructure, 0, firstSlots);
  const firstPrediction = params.predict(firstScheduleMatches[0]!.upcoming);
  if (firstPrediction.redRpPmf === undefined || firstPrediction.blueRpPmf === undefined) {
    return null;
  }
  // D-15 (plan 09-07): same first-match-probe discipline, extended to the
  // decomposition rather than duplicated — whether THIS algorithm carries
  // it is decided once, here, from the first priced prediction. If it does
  // not, absent-throughout is an ordinary answer and the whole schedule
  // prices on the legacy path; the decomposition is never a precondition
  // for building a sidecar at all.
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
      // The first match of schedule 0 was already priced by the probe above
      // — reuse that result rather than calling the (pure) closure twice.
      const prediction = k === 0 && matchIndex === 0 ? firstPrediction : params.predict(synthetic.upcoming);
      if (prediction.redRpPmf === undefined || prediction.blueRpPmf === undefined) {
        throw new PreSchedulePricingError(synthetic.upcoming.matchKey);
      }
      // Rounded through the same `roundPmf` as `buildEventArtifact`'s real
      // matches — identical quantity, identical `ROUNDING_RULE.pmf` precision.
      const rp = roundPmf(prediction.redRpPmf);
      const bp = roundPmf(prediction.blueRpPmf);
      const outcome = buildOutcomeInput(prediction);
      if (firstHasDecomposition && outcome === undefined) {
        // The FIRST priced prediction carried the decomposition, so a later
        // one that lacks it is corruption, exactly as a vanishing
        // redRpPmf/blueRpPmf already is above.
        throw new PreSchedulePricingError(synthetic.upcoming.matchKey, "the RP decomposition");
      }
      publishedMatches.push({ r: [...synthetic.r], b: [...synthetic.b], rp, bp });
      simInputs.push(toSimMatchInput(synthetic.upcoming, rp, bp, outcome));
    }
    schedules.push({ seed, matches: publishedMatches });
    simInputsBySchedule.push(simInputs);
  }

  // The baked default result (C-09). Baselines are zero-for-everyone:
  // nobody has played, which is exactly what "before schedule release"
  // means — the whole distribution comes from the priced pmfs alone.
  const baselines: SimTeamBaseline[] = sortedRoster.map((teamKey) => ({ teamKey, earnedRpSum: 0, matchesPlayed: 0 }));
  const totals: number[][] = sortedRoster.map(() => new Array<number>(sortedRoster.length).fill(0));
  for (let k = 0; k < params.scheduleCount; k++) {
    // A SECOND, distinct hash stream ("baked" salt) for the Monte Carlo
    // draws, so the draw stream never aliases the shuffle stream.
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
// The FIELD-AVERAGED path (plan 09-09 rung 1; D-16, D-17)
// ---------------------------------------------------------------------------

/** Everything `buildFieldContributions` reads, each from the instant the schedule-based path already read it from. */
export interface FieldContributionInputs {
  readonly roster: readonly string[];
  /** The season's walk-forward per-team RP beliefs — `SigmaScoutLayer.rpAccumulator`. */
  readonly rpAccumulator: RpMomentsAccumulator | undefined;
  /** `SigmaScoutLayer.consistencyByTeam()` — Sigma Score for SPR; empty for algorithms without one. */
  readonly consistencyByTeam: ReadonlyMap<string, number>;
  /** `algorithm.teamMetrics(pricingState, roster)[team][TOTAL_METRIC_KEY].value`, per team. */
  readonly teamTotals: ReadonlyMap<string, number>;
}

/**
 * One `FieldTeamContribution` per roster team, in SORTED roster order, or
 * `null` under the all-or-nothing roster rule.
 *
 * ---------------------------------------------------------------------------
 * THE ALL-OR-NOTHING ROSTER RULE, REPRODUCED RATHER THAN RE-INVENTED
 * ---------------------------------------------------------------------------
 *
 * This is `makeRankingPointFiller`'s existing rule (`packages/harness/
 * publish.ts`), and its comment there carries the measured reason: deciding
 * per match meant an event containing even one team without a consistency
 * figure priced its first synthetic match and then failed on a later one,
 * which the builder correctly treats as corruption — so it threw and took the
 * whole publish down (measured 2026-09-09 on `2026isde4`). DECIDE ONCE FOR THE
 * WHOLE EVENT. A `null` is the ordinary "we have not seen enough of this
 * roster to price it" answer and the sidecar is skipped silently, matching
 * `buildFieldAveragedPreScheduleArtifact`'s own `null` contract.
 *
 * The two absences have different causes and are checked separately: a team
 * missing from `consistencyByTeam` has played too little, and a team missing
 * from `teamTotals` is one this algorithm has never rated. Both mean the same
 * thing here — this roster cannot be priced honestly.
 *
 * ---------------------------------------------------------------------------
 * WHY A ONE-TEAM `momentsFor` CALL IS THE RIGHT CALL AND NOT A MISUSE
 * ---------------------------------------------------------------------------
 *
 * `momentsFor` undoes the even-split shrinkage by scaling the summed per-team
 * variances by `roster.length^2 / contributing`. With `roster.length === 1`
 * and one contributing belief that factor is EXACTLY 1, so the returned
 * variance IS `varianceOf(belief)` and the returned mean IS `belief.mean` —
 * the team's OWN belief, not an alliance aggregate. That single fact is what
 * makes a per-team contribution recoverable from the existing accumulator with
 * no new accessor.
 *
 * A team with no belief for a variable yields mean `0` and variance `0` — the
 * same honest cold start the alliance path already produces — and is INCLUDED
 * in the field as a zero rather than skipped, because a cold team really is
 * part of the field. Dropping it would shift `meanOfVariableMeans` upward and
 * silently narrow every band in the event.
 */
export function buildFieldContributions(inputs: FieldContributionInputs): FieldTeamContribution[] | null {
  const { rpAccumulator, consistencyByTeam, teamTotals } = inputs;
  if (rpAccumulator === undefined) return null;
  // Sorted first, for the same determinism reason
  // `buildFieldAveragedPreScheduleArtifact` states below.
  const sortedRoster = [...inputs.roster].sort();
  if (sortedRoster.length === 0) return null;
  for (const teamKey of sortedRoster) {
    if (!consistencyByTeam.has(teamKey)) return null;
    if (!teamTotals.has(teamKey)) return null;
  }
  return sortedRoster.map((teamKey) => {
    const own = rpAccumulator.momentsFor([teamKey], 0, 0);
    const consistency = consistencyByTeam.get(teamKey) as number;
    return {
      teamKey,
      variableMeans: own.meanVector,
      variableVariances: own.varianceBlock.map((row, i) => row[i] ?? 0),
      scoreMean: teamTotals.get(teamKey) as number,
      // Squared: `allianceSigmaBandVariance`'s own per-team term is
      // `sigma * sigma`, so this is the identical quantity under the
      // identical convention.
      bandVariance: consistency * consistency,
    };
  });
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
}

/**
 * Builds one event's FIELD-AVERAGED pre-schedule sidecar (plan 09-09 rung 1;
 * D-16, D-17), or `null` when it cannot be priced.
 *
 * PURITY CONTRACT, STRENGTHENED: no corpus read, no R2 call, no wall-clock
 * read, and no filesystem access. It builds no pairing structure at all, which
 * is what makes the artifact independent of the generator's 6-team floor: an
 * event too small to schedule still gets a sidecar here.
 *
 * Every value that varies between runs is either passed in (`generation`,
 * `computedAt`) or derived from a pure hash of `eventKey`/`algorithmVersion`
 * through this module's existing `fnv1a32` salted-seed convention. The
 * platform's non-seedable random source never appears in this module, so
 * republishing the same corpus twice produces byte-identical sidecars.
 *
 * C-04, SUCCESSION STATED EXPLICITLY. The schedule-based builder honoured C-04
 * ("no pricing math lives in the sidecar builder") by owning no pricing math
 * at all and calling back into the caller's bound `predict`. This one honours
 * it by calling the SAME `analyticRpPmf` every real match runs, through
 * `fieldAveragedMatchPmf`. The GUARANTEE is preserved and its MECHANISM
 * changed — worth one sentence so a reader does not conclude it lapsed.
 *
 * The returned object has already passed
 * `FieldAveragedPreScheduleArtifactSchema.parse` — parse, not `safeParse`, so
 * a builder bug can never reach R2.
 */
export function buildFieldAveragedPreScheduleArtifact(
  params: FieldAveragedPreScheduleBuildParams
): FieldAveragedPreScheduleArtifact | null {
  if (params.contributions.length === 0) return null;
  // Sorting (rather than trusting caller order) is what makes republish
  // determinism independent of corpus row order: this sorted array IS the
  // published roster and defines the index space for every `perTeamPmf`
  // entry. `buildFieldContributions` already sorts, so this re-establishes
  // that invariant rather than trusting it.
  const sortedRoster = params.contributions.map((c) => c.teamKey).sort();
  const byTeam = new Map(params.contributions.map((c) => [c.teamKey, c]));

  const variableNames = params.ruleModule.thresholdVariables.map((v) => v.name);
  const stats = fieldStatistics(params.contributions, variableNames);
  const perTeamPmf = sortedRoster.map((teamKey) =>
    // Rounded through the same `roundPmf` as every other published pmf —
    // identical quantity, identical `ROUNDING_RULE.pmf` precision.
    roundPmf(fieldAveragedMatchPmf(byTeam.get(teamKey) as FieldTeamContribution, stats, params.ruleModule, params.eventType))
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
