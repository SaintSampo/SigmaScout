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
  readonly counts: ArrayLike<number>;
  readonly denominator: number;
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
}

export interface AdvancementChanceResult {
  readonly draws: number;
  /** The slot count the runs were ranked against — the reserved `lockSlots`, exposed so a test can see WHICH count produced a chance. */
  readonly lockSlots: number;
  /** `teamKey -> chance in [0, 1]`, for the points-competing pool alone. An award qualifier or a prequalified team is absent rather than present at zero. */
  readonly chanceByTeam: ReadonlyMap<string, number>;
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
function drawTableFor(team: AdvancementChanceTeam): DrawTable {
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

  const chanceByTeam = new Map<string, number>();
  if (pool.length === 0) return { draws, lockSlots, chanceByTeam };

  const tables = pool.map(drawTableFor);
  let maxValue = 0;
  for (const table of tables) maxValue = Math.max(maxValue, table.maxValue);

  const rng = mulberry32(seed ^ ADVANCEMENT_CHANCE_STREAM_SALT);
  const totals = new Int32Array(pool.length);
  const histogram = new Int32Array(maxValue + 1);
  const atOrAbove = new Int32Array(maxValue + 1);
  const insideRuns = new Int32Array(pool.length);

  for (let run = 0; run < draws; run++) {
    histogram.fill(0);
    for (let i = 0; i < pool.length; i++) {
      const value = drawValue(tables[i]!, rng());
      totals[i] = value;
      histogram[value] = histogram[value]! + 1;
    }
    let running = 0;
    for (let value = maxValue; value >= 0; value--) {
      running += histogram[value]!;
      atOrAbove[value] = running;
    }
    for (let i = 0; i < pool.length; i++) {
      // `atOrAbove` counts this team itself, so "others at or above" is one
      // less: inside when `atOrAbove - 1 < lockSlots`, i.e. `<= lockSlots`.
      // A tie at the last slot puts both teams out, which is the lock rule's
      // own tie philosophy read the other way round.
      if (atOrAbove[totals[i]!]! <= lockSlots) insideRuns[i] = insideRuns[i]! + 1;
    }
  }

  for (let i = 0; i < pool.length; i++) chanceByTeam.set(pool[i]!.teamKey, insideRuns[i]! / draws);
  return { draws, lockSlots, chanceByTeam };
}
