/**
 * ONE district wide run set, and the per team chance of qualifying on district
 * points that falls out of it.
 *
 * Sketch 020 asked for this number in round three ("Jacob wants the estimated
 * chance shown, as a number") and phase 10 deferred it: the tab shipped with
 * `DISTRICT_LEDGER_DRAWER_NO_CHANCE_CAPTION`, a caption stating outright that
 * the page did not compute a chance of finishing above the line rather than
 * letting a reader infer one. Quick task 260925-rpj computes it. The caption is
 * replaced in the same commit, because a page that states a limit it no longer
 * has is worse than one that never stated it.
 *
 * THE QUANTITY, exactly. For `draws` runs, every team's season total is drawn
 * from the grand total distribution the browser already holds for it — the
 * convolution of its event distributions plus the rookie bonus and any
 * adjustments, or a point mass at its earned total for a team with nothing left
 * to play. The points race is then ranked inside each run, and the chance is
 * the share of runs in which the team sits inside the points slots.
 *
 * TOTALS ARE DRAWN INDEPENDENTLY, and that is an approximation rather than a
 * detail. Points are conserved inside an event: two teams at the same event
 * cannot both be captain one, and one team's qualification points are another's
 * loss. The true joint distribution is therefore correlated and this one is not.
 * The methodology page says so in a sentence; nothing here pretends otherwise,
 * and no verdict is ever derived from these numbers.
 *
 * THE SLOT COUNT IS `locks.ts`'s OWN. `pointsRaceSlots` is the same derivation
 * `computeLocksWithQualifiers` narrows its pool and its two slot counts with,
 * exported for this module rather than reimplemented in it. `lockSlots` — the
 * reserved count, `dcmpSlots` minus the consuming award qualifiers minus one
 * slot per Impact award still to come — is what a run is ranked against, and
 * that choice is what makes the chance agree with the chip beside it:
 *
 *   - A team the CEILING test locked reads 1 in every run. Its floor already
 *     exceeds all but `lockSlots - 1` rivals' ceilings, and a rival can only
 *     beat it by drawing above its own ceiling, which it cannot.
 *   - A team the elimination test locked out reads 0 in every run. At least
 *     `pointsSlots >= lockSlots` rivals' floors sit strictly above its ceiling.
 *
 * The POOLED lock carries no such guarantee, and deliberately so: its whole
 * argument is that the district's remaining points are conserved, which these
 * independent draws do not honour. A pooled locked team can therefore read
 * below 1 here. The verdict wins; the caller counts the disagreement and prints
 * nothing (`apps/web/src/components/districts/districtLedgerChances.ts`).
 *
 * TIES AT THE LAST SLOT COUNT AS OUT. `locks.ts`'s tie philosophy is that a tie
 * is settled by a tiebreaker this model does not carry, so it must count as a
 * possible loss; applied to a run, a team is inside when the number of OTHER
 * pool teams drawing at or above its own total is strictly less than
 * `lockSlots`.
 *
 * A BROWSER SAFE LEAF: typed arrays, one seeded generator, no I/O, no corpus,
 * and nothing that is not structured cloneable in either its input or its
 * output. It runs inside the district ledger's existing Web Worker so the main
 * thread never ranks a whole district a thousand times.
 */
import { mulberry32 } from "../algorithms/simulation/rankSimulation.js";
import { pointsRaceSlots, type QualifierSets } from "./locks.js";
import { EmptyDistributionError, InvalidDenominatorError } from "./pointSummary.js";

/**
 * XORed into the caller's seed to build this module's generator.
 *
 * A THIRD STREAM, beside `rankSimulation`'s own and `LEDGER_STREAM_SALT`'s. The
 * same argument that file makes applies unchanged: these draws must not advance
 * a generator any other seeded output reads, or a run set added here would move
 * a histogram published elsewhere under the same seed. Changing this value
 * changes every chance this module produces.
 */
export const ADVANCEMENT_CHANCE_STREAM_SALT = 0x3f0d_51a7;

/**
 * One team's grand total, in the ONE distribution representation
 * `districtLedgerRows.ts` declares: a dense array whose INDEX IS THE POINT
 * VALUE, plus the denominator it sums to. A finished team arrives as a point
 * mass, which is the same shape and needs no second branch anywhere below.
 */
export interface AdvancementChanceTeam {
  readonly teamKey: string;
  /**
   * The team's grand total in legacy mode. In CHAMP MODE, on a team that also
   * carries `dcmp`, this is the DISTRICT PART alone: the district subtotal
   * convolved with the rookie bonus and adjustments, with the District
   * Championship drawn separately from `dcmp` below.
   */
  readonly counts: ArrayLike<number>;
  readonly denominator: number;
  /**
   * CHAMP MODE ONLY (quick task 260927-6bf): the team's District Championship
   * part, drawn in the same run as its district part so its winner status and
   * its DCMP points come from ONE draw.
   *
   * - `counts`/`denominator`: the DCMP subtotal in the one representation.
   * - `fieldChance`: the chance the team is in the DCMP field at all.
   * - `winChance`: the chance the team is on the DCMP winning alliance. A run
   *   marks it a winner when its DCMP draw lands in the top `winChance` share
   *   of its own distribution, so a winner is always a high DCMP draw.
   */
  readonly dcmp?: AdvancementChanceDcmpPart;
}

/** One team's District Championship part — see `AdvancementChanceTeam.dcmp`. */
export interface AdvancementChanceDcmpPart {
  readonly counts: ArrayLike<number>;
  readonly denominator: number;
  readonly fieldChance: number;
  readonly winChance: number;
}

/** One weighted team inside an award draw spec. A weight of zero never picks. */
export interface AdvancementChanceWeightedTeam {
  readonly teamKey: string;
  readonly weight: number;
}

/**
 * CHAMP MODE ONLY: one judged DCMP award drawn per run (Impact, Engineering
 * Inspiration or Rookie All Star).
 *
 * `countWeights` is indexed by COUNT: how many of this award the DCMP hands
 * out, drawn once per run; a fixed count is one hot. `candidates` are the
 * teams already eligible at the position; each of `pendingEvents` contributes
 * one entrant per run, picked by weight, standing in for a district event
 * whose own award is still to come.
 */
export interface AdvancementChanceAwardDraw {
  readonly awardType: number;
  readonly countWeights: readonly number[];
  readonly candidates: readonly AdvancementChanceWeightedTeam[];
  readonly pendingEvents: readonly {
    readonly eventKey: string;
    readonly entrants: readonly AdvancementChanceWeightedTeam[];
  }[];
}

/** One district at one position: every team's grand total, the capacity, and the two facts that narrow the points race. */
export interface AdvancementChanceInputs {
  readonly teams: readonly AdvancementChanceTeam[];
  /** TBA's published `dcmpSlots`. A null capacity is the caller's refusal, never a guessed number here. */
  readonly slots: number;
  /** The consuming award qualifiers at this position, as the verdicts saw them. */
  readonly awardQualified: readonly string[];
  /** Always empty at the district tier; carried so this module never assumes a rule `locks.ts` owns. */
  readonly prequalified: readonly string[];
  /** One slot held back per district-tier event whose Impact award is still to come. */
  readonly reservedSlots: number;
  /** CHAMP MODE ONLY: the DCMP judged award draws, in the order they are drawn. Absent or empty with no `dcmp` part on any team is legacy mode. */
  readonly awardDraws?: readonly AdvancementChanceAwardDraw[];
}

export interface AdvancementChanceResult {
  readonly draws: number;
  /** The slot count the runs were ranked against — the reserved `lockSlots`, exposed so a test can see WHICH count produced a chance. */
  readonly lockSlots: number;
  /**
   * The UNRESERVED slot count — `locks.ts`'s own `pointsSlots`, beside the
   * reserved `lockSlots` above. Always present, including for an empty pool.
   *
   * Exposed because the SIMULATED LINE below is taken against this count and
   * not against the one the chance is ranked on, and a reader must be able to
   * see which is which without inferring it.
   */
  readonly pointsSlots: number;
  /** `teamKey -> chance in [0, 1]`, for the points-competing pool alone. An award qualifier or a prequalified team is absent rather than present at zero. */
  readonly chanceByTeam: ReadonlyMap<string, number>;
  /**
   * THE SIMULATED LINE, one entry per run: the `pointsSlots`th highest drawn
   * total of that run, in run order. Length is exactly `draws`.
   *
   * WHY `pointsSlots` AND NOT THE `lockSlots` THE CHANCE IS RANKED AGAINST.
   * The cutoff is the PUBLISHED LINE's quantity — the points it took to reach
   * the last qualifying slot — and the reservation moves the guarantee test
   * alone: `locks.ts` subtracts it from `lockSlots` and leaves both the
   * elimination test and `cutLinePointsWithQualifiers` on the unreserved
   * count. A line drawn at the reserved count would sit one team higher than
   * the line the verdicts beside it were cut at.
   *
   * ABSENT — never empty and never zero filled — where `pointsSlots` is 0 or
   * the pool holds fewer teams than there are points slots. There is no
   * `pointsSlots`th highest total to take in either case, and a zero would
   * render as a line at the bottom of every histogram on the page.
   *
   * Captured inside the top down walk the ranking already performs, so it adds
   * no pass, no sort and no per run allocation beyond this one array.
   *
   * CHAMP MODE differs in one respect: a run with no line carries NaN, and
   * the array is absent only when NO run has a line (see `runsWithoutLine`).
   */
  readonly cutoffByRun?: Float64Array;
  /**
   * CHAMP MODE ONLY, a diagnostic: per run, how many RANKED teams the drawn
   * winning alliance and drawn award winners took a slot from (the set `W`,
   * less any team already award qualified at the position).
   */
  readonly awardSlotsByRun?: Int32Array;
  /**
   * CHAMP MODE ONLY, a diagnostic: per run, how many members of `W` in the
   * static pool drew a total ranking BELOW the static `pointsSlots` inside the
   * whole static pool before removal. These are the slots that move the line.
   */
  readonly outsideAwardSlotsByRun?: Int32Array;
  /**
   * CHAMP MODE ONLY: how many runs had no line (their `cutoffByRun` entry is
   * NaN). A run has none when its drawn winners and award winners took every
   * slot, or left fewer pool teams than points slots.
   */
  readonly runsWithoutLine?: number;
}

/**
 * Thrown for an input this module will not compute over: no teams, a repeated
 * team key, a non integer or out of range draw count, a non finite seed or
 * capacity, or a negative or non finite entry in a distribution.
 *
 * A REFUSAL RATHER THAN A FALLBACK, for the reason `pointSummary.ts` states for
 * its own two: every one of these inputs still produces a number, and that
 * number looks exactly like a real chance.
 */
export class AdvancementChanceInputError extends Error {
  constructor(message: string) {
    super(`advancementChances: ${message}`);
    this.name = "AdvancementChanceInputError";
  }
}

/** One team's cumulative distribution, normalised by its own observed mass, plus the top index the draw may land on. */
interface DrawTable {
  readonly cumulative: Float64Array;
  readonly maxValue: number;
}

/**
 * Builds a team's inverse CDF.
 *
 * NORMALISED BY THE OBSERVED MASS, not by `denominator`. The two are equal for
 * every distribution this repo produces (`convolveDistrictGrandTotal` and
 * `pointMassDistribution` both sum to 1), and where they ever disagree this
 * draws in proportion rather than piling every residual draw on the last index,
 * which is what a denominator normalisation would silently do. `denominator` is
 * still validated, because it is half of the representation and a caller
 * passing a broken one has a bug worth surfacing.
 */
function drawTableFor(team: Pick<AdvancementChanceTeam, "teamKey" | "counts" | "denominator">): DrawTable {
  if (!Number.isFinite(team.denominator) || team.denominator <= 0) {
    throw new InvalidDenominatorError("advancementChances", team.denominator);
  }
  const length = team.counts.length;
  const cumulative = new Float64Array(length);
  let mass = 0;
  for (let i = 0; i < length; i++) {
    const count = team.counts[i]!;
    if (!Number.isFinite(count) || count < 0) {
      throw new AdvancementChanceInputError(`team ${team.teamKey} carries a negative or non finite count at ${String(i)}`);
    }
    mass += count;
    cumulative[i] = mass;
  }
  if (!(mass > 0)) throw new EmptyDistributionError("advancementChances", team.denominator);
  for (let i = 0; i < length; i++) cumulative[i] = cumulative[i]! / mass;
  return { cumulative, maxValue: length - 1 };
}

/**
 * One draw: the first index whose cumulative mass exceeds `u`, by binary
 * search. The top-index fallback is a floating point residue guard, unreachable
 * in exact arithmetic — `drawCategorical`'s own framing, which this reproduces
 * on a bounded search because a district's grand total spans hundreds of
 * values rather than a handful.
 */
function drawValue(table: DrawTable, u: number): number {
  const { cumulative, maxValue } = table;
  let lo = 0;
  let hi = maxValue;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cumulative[mid]! > u) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * Every points-competing team's chance of qualifying on district points.
 *
 * Deterministic in `seed`: the teams are drawn in input order, one value each,
 * run after run, from a single generator. Two calls with the same inputs and
 * the same seed return identical numbers.
 *
 * O(draws x (teams + maxTotal)). Each run draws every team once (a binary
 * search apiece), fills a counting histogram over the integer totals, walks it
 * once from the top to turn it into "how many teams drew at least this much",
 * and reads one entry per team. No per run sort, and no pairwise comparison.
 */
export function advancementChances(inputs: AdvancementChanceInputs, draws: number, seed: number): AdvancementChanceResult {
  if (!Number.isInteger(draws) || draws < 1) {
    throw new AdvancementChanceInputError(`draws must be a positive integer, got ${String(draws)}`);
  }
  if (!Number.isFinite(seed)) throw new AdvancementChanceInputError(`seed must be finite, got ${String(seed)}`);
  if (!Number.isInteger(inputs.slots) || inputs.slots < 0) {
    throw new AdvancementChanceInputError(`slots must be a non negative integer, got ${String(inputs.slots)}`);
  }
  if (!Number.isInteger(inputs.reservedSlots)) {
    throw new AdvancementChanceInputError(`reservedSlots must be an integer, got ${String(inputs.reservedSlots)}`);
  }
  if (inputs.teams.length === 0) throw new AdvancementChanceInputError("no teams were supplied");

  const seen = new Set<string>();
  for (const team of inputs.teams) {
    if (seen.has(team.teamKey)) throw new AdvancementChanceInputError(`team ${team.teamKey} appears twice`);
    seen.add(team.teamKey);
  }

  const qualifiers: QualifierSets = {
    awardQualified: new Set(inputs.awardQualified),
    prequalified: new Set(inputs.prequalified),
  };
  const narrowed = pointsRaceSlots(
    inputs.teams.map((team) => team.teamKey),
    inputs.slots,
    qualifiers,
    inputs.reservedSlots
  );
  const poolKeys = new Set(narrowed.poolKeys);
  const pool = inputs.teams.filter((team) => poolKeys.has(team.teamKey));
  const lockSlots = narrowed.lockSlots;
  const pointsSlots = narrowed.pointsSlots;

  // CHAMP MODE branches off here and leaves the legacy loop below byte for
  // byte what it was: the District Locks tab never reaches the branch.
  if (isChampMode(inputs)) return champAdvancementChances(inputs, draws, seed, narrowed);

  const chanceByTeam = new Map<string, number>();
  // An empty pool reports BOTH slot counts and NO array — see `cutoffByRun`.
  if (pool.length === 0) return { draws, lockSlots, pointsSlots, chanceByTeam };

  const tables = pool.map(drawTableFor);
  let maxValue = 0;
  for (const table of tables) maxValue = Math.max(maxValue, table.maxValue);

  const rng = mulberry32(seed ^ ADVANCEMENT_CHANCE_STREAM_SALT);
  const totals = new Int32Array(pool.length);
  const histogram = new Int32Array(maxValue + 1);
  const atOrAbove = new Int32Array(maxValue + 1);
  const insideRuns = new Int32Array(pool.length);
  // THE ONE EXTRA ALLOCATION, and only where a line exists to take.
  const cutoffByRun = pointsSlots >= 1 && pool.length >= pointsSlots ? new Float64Array(draws) : undefined;

  for (let run = 0; run < draws; run++) {
    histogram.fill(0);
    for (let i = 0; i < pool.length; i++) {
      const value = drawValue(tables[i]!, rng());
      totals[i] = value;
      histogram[value] = histogram[value]! + 1;
    }
    let running = 0;
    let line = -1;
    for (let value = maxValue; value >= 0; value--) {
      running += histogram[value]!;
      atOrAbove[value] = running;
      // The simulated line: the LARGEST value at which the running count first
      // reaches `pointsSlots`, which walking downwards is the first one it
      // reaches. Captured inside the walk the ranking already runs — no second
      // pass and no sort.
      if (line < 0 && running >= pointsSlots) line = value;
    }
    if (cutoffByRun !== undefined) cutoffByRun[run] = line;
    for (let i = 0; i < pool.length; i++) {
      // `atOrAbove` counts this team itself, so "others at or above" is one
      // less: inside when `atOrAbove - 1 < lockSlots`, i.e. `<= lockSlots`.
      // A tie at the last slot puts both teams out, which is the lock rule's
      // own tie philosophy read the other way round.
      if (atOrAbove[totals[i]!]! <= lockSlots) insideRuns[i] = insideRuns[i]! + 1;
    }
  }

  for (let i = 0; i < pool.length; i++) chanceByTeam.set(pool[i]!.teamKey, insideRuns[i]! / draws);
  // The field is OMITTED rather than set to `undefined` where there is no line.
  return { draws, lockSlots, pointsSlots, chanceByTeam, ...(cutoffByRun === undefined ? {} : { cutoffByRun }) };
}

// ---------------------------------------------------------------------------
// Champ mode (quick task 260927-6bf)
// ---------------------------------------------------------------------------

/** Legacy mode is no team carrying a `dcmp` part and no award draw. Anything else is champ mode. */
function isChampMode(inputs: AdvancementChanceInputs): boolean {
  if ((inputs.awardDraws?.length ?? 0) > 0) return true;
  return inputs.teams.some((team) => team.dcmp !== undefined);
}

function isUnitInterval(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function assertWeight(where: string, teamKey: unknown, weight: unknown): void {
  if (typeof teamKey !== "string" || teamKey.length === 0) {
    throw new AdvancementChanceInputError(`${where} carries a team without a key`);
  }
  if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) {
    throw new AdvancementChanceInputError(`${where} carries a negative or non finite weight for ${teamKey}`);
  }
}

/** One award draw spec, reduced to typed arrays over a per draw candidate universe. */
interface PreparedAwardDraw {
  /** The count weights' running sum, normalised to 1. */
  readonly countCumulative: Float64Array;
  /** `countWeights.length - 1`: the pick uniforms consumed per run, whatever the drawn count. */
  readonly pickUniforms: number;
  /** Candidate universe index to ranked team index, or -1 for a key absent from `inputs.teams`. */
  readonly rankedIndex: Int32Array;
  /** The static candidates' weights over the universe; zero for a key only a pending event can add. */
  readonly baseWeights: Float64Array;
  readonly pending: readonly {
    readonly universeIndex: Int32Array;
    readonly weights: Float64Array;
    readonly cumulative: Float64Array;
    readonly total: number;
  }[];
}

function prepareAwardDraw(draw: AdvancementChanceAwardDraw, rankedIndexByKey: ReadonlyMap<string, number>, index: number): PreparedAwardDraw {
  const where = `award draw ${String(index)}`;
  if (!Array.isArray(draw.countWeights) || draw.countWeights.length === 0) {
    throw new AdvancementChanceInputError(`${where} carries no count weights`);
  }
  let countTotal = 0;
  for (const weight of draw.countWeights) {
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) {
      throw new AdvancementChanceInputError(`${where} carries a negative or non finite count weight`);
    }
    countTotal += weight;
  }
  if (!(countTotal > 0)) throw new AdvancementChanceInputError(`${where} count weights sum to zero`);
  const countCumulative = new Float64Array(draw.countWeights.length);
  let runningCount = 0;
  for (let i = 0; i < draw.countWeights.length; i++) {
    runningCount += draw.countWeights[i]!;
    countCumulative[i] = runningCount / countTotal;
  }

  const universe = new Map<string, number>();
  const keys: string[] = [];
  const slotFor = (teamKey: string): number => {
    let slot = universe.get(teamKey);
    if (slot === undefined) {
      slot = keys.length;
      universe.set(teamKey, slot);
      keys.push(teamKey);
    }
    return slot;
  };

  const baseByKey = new Map<string, number>();
  for (const candidate of draw.candidates) {
    assertWeight(`${where} candidate`, candidate.teamKey, candidate.weight);
    // DEDUPED, keeping the larger weight.
    baseByKey.set(candidate.teamKey, Math.max(baseByKey.get(candidate.teamKey) ?? 0, candidate.weight));
    slotFor(candidate.teamKey);
  }
  const pendingSlots: { universeIndex: number[]; weights: number[] }[] = [];
  for (const event of draw.pendingEvents) {
    const universeIndex: number[] = [];
    const weights: number[] = [];
    for (const entrant of event.entrants) {
      assertWeight(`${where} pending event ${String(event.eventKey)} entrant`, entrant.teamKey, entrant.weight);
      universeIndex.push(slotFor(entrant.teamKey));
      weights.push(entrant.weight);
    }
    pendingSlots.push({ universeIndex, weights });
  }

  const rankedIndex = new Int32Array(keys.length);
  const baseWeights = new Float64Array(keys.length);
  keys.forEach((teamKey, slot) => {
    rankedIndex[slot] = rankedIndexByKey.get(teamKey) ?? -1;
    baseWeights[slot] = baseByKey.get(teamKey) ?? 0;
  });

  return {
    countCumulative,
    pickUniforms: draw.countWeights.length - 1,
    rankedIndex,
    baseWeights,
    pending: pendingSlots.map(({ universeIndex, weights }) => {
      const cumulative = new Float64Array(weights.length);
      let sum = 0;
      weights.forEach((weight, i) => {
        sum += weight;
        cumulative[i] = sum;
      });
      return { universeIndex: Int32Array.from(universeIndex), weights: Float64Array.from(weights), cumulative, total: sum };
    }),
  };
}

/** One weighted pick over the positive weights, or -1 when nothing carries weight. A zero weight never picks. */
function pickWeighted(weights: Float64Array, u: number): number {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += weights[i]!;
  if (!(total > 0)) return -1;
  const target = u * total;
  let running = 0;
  let last = -1;
  for (let i = 0; i < weights.length; i++) {
    const weight = weights[i]!;
    if (!(weight > 0)) continue;
    last = i;
    running += weight;
    if (running > target) return i;
  }
  // Floating point residue guard, unreachable in exact arithmetic.
  return last;
}

/**
 * THE CHAMP RUN (quick task 260927-6bf, decision L1): per run, the District
 * Championship's winning alliance and its Impact, Engineering Inspiration and
 * Rookie All Star winners are decided FIRST, removed from the pool together
 * with the slots they take, and only then is the line read off the teams left.
 *
 * Posted awards stay what they always were: facts in `awardQualified`. Nothing
 * here feeds a verdict; `locks.ts` never sees a drawn award (decision L3).
 *
 * `W` is the run's drawn winners plus its drawn award winners, as a set, so a
 * team drawn twice takes one slot. A drawn key absent from `inputs.teams`
 * takes none. The chance counts a team inside in a run when it is in `W`, or
 * when it is still in the pool and at most `lockSlots_r - 1` others drew at or
 * above it (ties at the last slot are out, as in legacy mode).
 */
function champAdvancementChances(
  inputs: AdvancementChanceInputs,
  draws: number,
  seed: number,
  narrowed: ReturnType<typeof pointsRaceSlots>
): AdvancementChanceResult {
  for (const team of inputs.teams) {
    if (team.dcmp === undefined) continue;
    if (!isUnitInterval(team.dcmp.fieldChance)) {
      throw new AdvancementChanceInputError(`team ${team.teamKey} carries a field chance outside [0, 1]`);
    }
    if (!isUnitInterval(team.dcmp.winChance)) {
      throw new AdvancementChanceInputError(`team ${team.teamKey} carries a win chance outside [0, 1]`);
    }
  }

  const rankedIndexByKey = new Map(inputs.teams.map((team, index) => [team.teamKey, index] as const));
  const awardDraws = (inputs.awardDraws ?? []).map((draw, index) => prepareAwardDraw(draw, rankedIndexByKey, index));

  const awardQualified = new Set(inputs.awardQualified);
  const poolKeys = new Set(narrowed.poolKeys);
  const pool = inputs.teams.filter((team) => poolKeys.has(team.teamKey));
  const staticPointsSlots = narrowed.pointsSlots;
  const lockSlots = narrowed.lockSlots;
  const reserved = Math.max(inputs.reservedSlots, 0);
  // `pointsRaceSlots`' own arithmetic: every RANKED award qualifier consumes a slot.
  const postedConsumed = inputs.teams.filter((team) => awardQualified.has(team.teamKey)).length;

  const chanceByTeam = new Map<string, number>();
  if (pool.length === 0) return { draws, lockSlots, pointsSlots: staticPointsSlots, chanceByTeam };

  const districtTables = pool.map(drawTableFor);
  const dcmpTables = pool.map((team) =>
    team.dcmp === undefined ? undefined : drawTableFor({ teamKey: team.teamKey, counts: team.dcmp.counts, denominator: team.dcmp.denominator })
  );
  let maxValue = 0;
  for (let i = 0; i < pool.length; i++) maxValue = Math.max(maxValue, districtTables[i]!.maxValue + (dcmpTables[i]?.maxValue ?? 0));

  const poolRankedIndex = Int32Array.from(pool.map((team) => rankedIndexByKey.get(team.teamKey)!));
  const poolIndexOfRanked = new Int32Array(inputs.teams.length).fill(-1);
  poolRankedIndex.forEach((ranked, i) => {
    poolIndexOfRanked[ranked] = i;
  });
  const rankedIsAwardQualified = Uint8Array.from(inputs.teams.map((team) => (awardQualified.has(team.teamKey) ? 1 : 0)));

  const rng = mulberry32(seed ^ ADVANCEMENT_CHANCE_STREAM_SALT);
  const totals = new Int32Array(pool.length);
  // One spare index above the top so "strictly above the top value" reads 0.
  const histogram = new Int32Array(maxValue + 2);
  const atOrAbove = new Int32Array(maxValue + 2);
  const insideRuns = new Int32Array(pool.length);
  const inW = new Uint8Array(inputs.teams.length);
  const wList: number[] = [];
  const weights = awardDraws.map((draw) => new Float64Array(draw.baseWeights.length));
  const cutoffByRun = new Float64Array(draws);
  const awardSlotsByRun = new Int32Array(draws);
  const outsideAwardSlotsByRun = new Int32Array(draws);
  let runsWithALine = 0;

  const markW = (ranked: number): void => {
    if (ranked < 0 || inW[ranked] === 1) return;
    inW[ranked] = 1;
    wList.push(ranked);
  };

  // THE RNG CONSUMPTION ORDER IS PART OF THE CONTRACT. Per run:
  //   1. For each static pool team, in input order: one uniform for its
  //      district value; if it carries a `dcmp` part, ALWAYS two more: `u1`
  //      for membership (`u1 < fieldChance`), then `u2` for the DCMP value
  //      `F^-1(u2)`. It won when it is a member, `winChance > 0` and
  //      `u2 >= 1 - winChance`.
  //   2. For each award draw, in order: one uniform for this run's count `k`
  //      (always consumed, even for a point mass); then one uniform per
  //      pending event, picking one entrant by weight (none when the entrants'
  //      total weight is zero); then EXACTLY `countWeights.length - 1`
  //      uniforms, the first `k` of which pick distinct candidates
  //      proportional to weight and the rest of which are consumed unused.
  for (let run = 0; run < draws; run++) {
    for (const ranked of wList) inW[ranked] = 0;
    wList.length = 0;

    for (let i = 0; i < pool.length; i++) {
      let value = drawValue(districtTables[i]!, rng());
      const dcmp = pool[i]!.dcmp;
      if (dcmp !== undefined) {
        const u1 = rng();
        const u2 = rng();
        if (u1 < dcmp.fieldChance) {
          value += drawValue(dcmpTables[i]!, u2);
          if (dcmp.winChance > 0 && u2 >= 1 - dcmp.winChance) markW(poolRankedIndex[i]!);
        }
      }
      totals[i] = value;
    }

    for (let d = 0; d < awardDraws.length; d++) {
      const draw = awardDraws[d]!;
      const drawWeights = weights[d]!;
      const uCount = rng();
      let k = 0;
      while (k < draw.countCumulative.length - 1 && !(draw.countCumulative[k]! > uCount)) k++;
      drawWeights.set(draw.baseWeights);
      for (const event of draw.pending) {
        const u = rng();
        if (!(event.total > 0)) continue;
        const target = u * event.total;
        let pick = -1;
        for (let e = 0; e < event.cumulative.length; e++) {
          if (!(event.weights[e]! > 0)) continue;
          pick = e;
          if (event.cumulative[e]! > target) break;
        }
        if (pick < 0) continue;
        const slot = event.universeIndex[pick]!;
        drawWeights[slot] = Math.max(drawWeights[slot]!, event.weights[pick]!);
      }
      for (let j = 0; j < draw.pickUniforms; j++) {
        const u = rng();
        if (j >= k) continue;
        const slot = pickWeighted(drawWeights, u);
        if (slot < 0) continue;
        drawWeights[slot] = 0;
        markW(draw.rankedIndex[slot]!);
      }
    }

    // The slots `W` takes: `pointsRaceSlots`' arithmetic over the posted
    // award qualifiers UNION `W`, counting ranked teams only.
    let drawnConsumed = 0;
    for (const ranked of wList) if (rankedIsAwardQualified[ranked] === 0) drawnConsumed += 1;
    awardSlotsByRun[run] = drawnConsumed;
    const pointsSlots = Math.max(inputs.slots - postedConsumed - drawnConsumed, 0);
    const runLockSlots = Math.max(pointsSlots - reserved, 0);

    // The WHOLE static pool before removal, for the outside diagnostic: a
    // member of `W` is outside when at least the static `pointsSlots` others
    // drew strictly above it.
    histogram.fill(0);
    for (let i = 0; i < pool.length; i++) histogram[totals[i]!] = histogram[totals[i]!]! + 1;
    atOrAbove[maxValue + 1] = 0;
    for (let value = maxValue; value >= 0; value--) atOrAbove[value] = atOrAbove[value + 1]! + histogram[value]!;
    let outside = 0;
    let removed = 0;
    for (const ranked of wList) {
      const i = poolIndexOfRanked[ranked]!;
      if (i < 0) continue;
      if (atOrAbove[totals[i]! + 1]! >= staticPointsSlots) outside += 1;
      histogram[totals[i]!] = histogram[totals[i]!]! - 1;
      removed += 1;
    }
    outsideAwardSlotsByRun[run] = outside;

    // The pool left once `W` has gone, and the line read off it in the same
    // top down walk the ranking uses.
    let running = 0;
    let line = -1;
    for (let value = maxValue; value >= 0; value--) {
      running += histogram[value]!;
      atOrAbove[value] = running;
      if (line < 0 && pointsSlots >= 1 && running >= pointsSlots) line = value;
    }
    // A RUN WITHOUT A LINE (the drawn winners and awards took every slot, or
    // left fewer pool teams than points slots) records NaN rather than a
    // number: there is no points qualifier in it, so no line to read.
    if (pointsSlots < 1 || pool.length - removed < pointsSlots) {
      cutoffByRun[run] = Number.NaN;
    } else {
      cutoffByRun[run] = line;
      runsWithALine += 1;
    }

    for (let i = 0; i < pool.length; i++) {
      if (inW[poolRankedIndex[i]!] === 1) {
        insideRuns[i] = insideRuns[i]! + 1;
        continue;
      }
      if (atOrAbove[totals[i]!]! <= runLockSlots) insideRuns[i] = insideRuns[i]! + 1;
    }
  }

  for (let i = 0; i < pool.length; i++) chanceByTeam.set(pool[i]!.teamKey, insideRuns[i]! / draws);
  return {
    draws,
    lockSlots,
    pointsSlots: staticPointsSlots,
    chanceByTeam,
    // Omitted only when NO run has a line. Otherwise runs without one carry
    // NaN, and `simulatedLine` reads the line CONDITIONAL ON ONE EXISTING,
    // which is the quantity a published cut line is: TBA publishes one only
    // where a team qualified on points. (Deviation from the plan's "any run"
    // rule, quick task 260927-6bf: that rule left 10 of the 69 backtested
    // seasons with no line in 0.1% to 8% of their runs.)
    ...(runsWithALine > 0 ? { cutoffByRun } : {}),
    runsWithoutLine: draws - runsWithALine,
    awardSlotsByRun,
    outsideAwardSlotsByRun,
  };
}
