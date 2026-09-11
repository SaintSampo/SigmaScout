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
import { PAGE_ARTIFACT_SCHEMA_VERSION, PreScheduleArtifactSchema, type PreScheduleArtifact } from "./pageArtifacts.js";
import { loadScheduleTemplate } from "./scheduleTemplates.js";
import { roundPmf } from "./rounding.js";
import { mulberry32, simulateRanks, type SimMatchInput, type SimTeamBaseline } from "../core/algorithms/simulation/rankSimulation.js";
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
  constructor(syntheticMatchKey: string) {
    super(
      `buildPreScheduleArtifact: predict returned no redRpPmf/blueRpPmf for synthetic match "${syntheticMatchKey}" after pricing earlier matches successfully — a pmf that goes missing partway through a schedule is corruption, not an RP-less algorithm`
    );
    this.name = "PreSchedulePricingError";
  }
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
  blueRpPmf: readonly number[]
): SimMatchInput {
  return {
    redTeamKeys: upcoming.redTeams.filter((teamKey) => !upcoming.redSurrogates.includes(teamKey)),
    blueTeamKeys: upcoming.blueTeams.filter((teamKey) => !upcoming.blueSurrogates.includes(teamKey)),
    redRpPmf,
    blueRpPmf,
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
  template: ReturnType<typeof loadScheduleTemplate>,
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
  const template = loadScheduleTemplate(sortedRoster.length, params.matchesPerTeam);

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
      publishedMatches.push({ r: [...synthetic.r], b: [...synthetic.b], rp, bp });
      simInputs.push(toSimMatchInput(synthetic.upcoming, rp, bp));
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
