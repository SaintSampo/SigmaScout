/**
 * The pure pre-schedule sidecar builder (quick task 260905-tll Task 2,
 * C-04/C-08/C-09/C-14, PD-03). Builds one event's `v1/presim/...` sidecar:
 * K synthetic qualification schedules drawn from the cheesy-arena template
 * grid, each priced through the caller's `predict` closure, plus the baked
 * default rank distribution the Simulation tab renders on first paint.
 *
 * PURITY CONTRACT: no corpus read, no R2 call, no filesystem access beyond
 * `scheduleTemplates.ts`'s template reader, and no wall-clock read — every
 * value that varies between runs is either passed in (`generation`,
 * `computedAt`) or derived from a seed that is itself a pure hash of
 * `eventKey`/`algorithmVersion`/schedule index (C-14, threat T-tll-06).
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
import { loadScheduleTemplate, type ScheduleTemplateMatch } from "./scheduleTemplates.js";
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
  /**
   * THE PAIRING STRUCTURE, INJECTED. Omitted in production and in every
   * shipped call site, where the licensed `loadScheduleTemplate(rosterSize,
   * matchesPerTeam)` grid supplies it exactly as before — this field is
   * INERT AT DEFAULT and changes nothing about what `publish.ts` writes.
   *
   * It exists so an EXPERIMENT can substitute a differently-derived pairing
   * structure (plan: the rung-2 rules-based generator,
   * `scripts/measureGeneratedSchedules.ts`) and have it priced, shuffled,
   * rounded, surrogate-excluded and baked by THIS function rather than by a
   * second copy of it. Comparing two schedule structures through two builders
   * is how a scorer mismatch gets manufactured; comparing them through one
   * builder with one injected difference is how it does not.
   *
   * The structure is consumed EXACTLY as a loaded template is: `red`/`blue`
   * are zero-based slot indices into the shuffled roster and the surrogate
   * flags are positional. Nothing here validates it — an invalid structure is
   * an experiment's own bug, and production never reaches this path.
   */
  readonly scheduleStructure?: readonly ScheduleTemplateMatch[];
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

/** Fisher–Yates over `[0..count)` driven by a seeded `rng` — `slots[templateSlot]` is the roster index occupying that slot (C-14). */
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

/** Builds schedule `k`'s full synthetic match list from the template and that schedule's shuffle. */
function buildScheduleMatches(
  params: PreScheduleBuildParams,
  sortedRoster: readonly string[],
  template: readonly ScheduleTemplateMatch[],
  k: number,
  slots: readonly number[]
): SyntheticMatch[] {
  return template.map((templateMatch, matchIndex) => {
    const n = matchIndex + 1; // one-based match number
    const r = templateMatch.red.map((slot) => slots[slot]!);
    const b = templateMatch.blue.map((slot) => slots[slot]!);
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
      redSurrogates: redTeams.filter((_, position) => templateMatch.redSurrogate[position] === true),
      blueSurrogates: blueTeams.filter((_, position) => templateMatch.blueSurrogate[position] === true),
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
 * `ScheduleTemplateUnavailableError` and `ScheduleTemplateMissingError`
 * propagate deliberately — the caller decides whether to skip the event
 * (unservable team count) or fail the run (missing cache file, C-11).
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
  // The licensed grid unless an experiment injected a structure (see
  // `scheduleStructure`) — production always takes the left branch.
  const template = params.scheduleStructure ?? loadScheduleTemplate(sortedRoster.length, params.matchesPerTeam);

  // Probe the FIRST synthetic match only, before building the rest: an
  // absent pmf here means "this algorithm does not model ranking points" —
  // an ordinary answer, not an error.
  const firstSeed = fnv1a32(`${params.eventKey}|${params.algorithmVersion}|shuffle|0`);
  const firstSlots = seededShuffle(sortedRoster.length, mulberry32(firstSeed));
  const firstScheduleMatches = buildScheduleMatches(params, sortedRoster, template, 0, firstSlots);
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
        : buildScheduleMatches(params, sortedRoster, template, k, seededShuffle(sortedRoster.length, mulberry32(seed)));

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
  /** `SigmaScoutLayer.consistencyByTeam()` — Sigma Score for BPR, Swing Factor otherwise. */
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
      // Squared: `allianceSwingBandVariance`'s own per-team term is
      // `swing * swing`, so this is the identical quantity under the
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
 * read — and now NOT EVEN A FILESYSTEM ACCESS. The schedule-template read was
 * this module's one filesystem touch and this path does not have it, which is
 * also what makes the artifact independent of the template grid's 6-100-team
 * coverage: an event the grid cannot serve gets a sidecar here.
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
