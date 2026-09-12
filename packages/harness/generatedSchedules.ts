/**
 * A RULES-BASED random qualification-schedule generator, and the balance
 * measurements used to compare what it produces against the licensed
 * cheesy-arena template grid (rung 2).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 *
 * The pre-schedule sidecar needs a PAIRING STRUCTURE — which slot plays with
 * and against which, in which match — onto which `buildPreScheduleArtifact`
 * shuffles the real roster. Today that structure comes from
 * `loadScheduleTemplate`, i.e. from Team 254's licensed pre-computed grid in
 * the gitignored `data/schedule-templates/`. This module answers whether a few
 * simple balance rules can produce a structure good enough to stand in for it.
 *
 * It is an EXPERIMENT'S input, not a shipped path: nothing in `publish.ts`
 * calls it, `scheduleTemplates.ts` is untouched, and the licensed grid remains
 * the only structure any published artifact has ever been built from.
 *
 * ---------------------------------------------------------------------------
 * THE RULES, STATED BEFORE THEY ARE MEASURED
 * ---------------------------------------------------------------------------
 *
 * 1. EXACT APPEARANCE COUNT. A schedule for `numTeams` at `matchesPerTeam` has
 *    `ceil(numTeams * matchesPerTeam / 6)` matches — six slots each, the same
 *    geometry `scheduleTemplates.ts` records for the licensed grid. Every team
 *    gets exactly `matchesPerTeam` RANKING-CREDITED appearances. The leftover
 *    `rows*6 - numTeams*matchesPerTeam` slots are SURROGATE appearances, given
 *    to that many DISTINCT teams, one flagged appearance each — the licensed
 *    grid's own convention, read off it structurally (40 teams at 11 → 4
 *    surrogate slots on 4 distinct teams; 76 at 10 → 2 on 2; every team's
 *    non-surrogate count exactly `matchesPerTeam` in both) rather than
 *    re-invented.
 *
 * 2. NO TEAM TWICE IN A MATCH. Enforced by construction — a team placed in a
 *    match is removed from that match's candidate pool.
 *
 * 3. MINIMISE REPEATS. The objective minimised across restarts is
 *
 *        3 * excessPartnerPairs + 1 * excessOpponentPairs + 1 * backToBackCount
 *
 *    where `excessPartnerPairs` counts, over unordered team pairs, how many
 *    times beyond the first they share an ALLIANCE, `excessOpponentPairs` the
 *    same for facing each other, and `backToBackCount` how many consecutive-
 *    match appearances occur. Partners are weighted heaviest because two teams
 *    on the same alliance have their outcomes coupled far more tightly than two
 *    teams merely facing each other, so a repeated partnership distorts a rank
 *    band more than a repeated matchup does.
 *
 * 4. SPREAD. Each team's appearances are pushed toward the natural spacing
 *    `matchCount / matchesPerTeam` by a per-candidate recency penalty, and
 *    back-to-back appearances are additionally penalised in the objective
 *    above.
 *
 * The construction is a GREEDY RANDOMISED one with restarts: build
 * `restarts` candidate schedules from the supplied seeded stream, score each by
 * the objective, return the best. Deliberately not a research project — no
 * simulated annealing, no ILP, no round-robin algebra.
 *
 * PURE: no I/O, no clock, no `Math.random`. The only entropy is the `rng`
 * callback the caller supplies, so the same seed always yields the same
 * schedule.
 */
import type { ScheduleTemplateMatch } from "./scheduleTemplates.js";

/** Six slots per match — the same constant `scheduleTemplates.ts`'s geometry note is written against. */
const SLOTS_PER_MATCH = 6;
const ALLIANCE_SIZE = 3;

/** Candidate schedules built per call before the best is returned. Small on purpose: the marginal gain past a handful is far below the seed noise the experiment measures. */
export const DEFAULT_RESTARTS = 4;

/** Weights of the objective in the module header. Exported so the objective a result was selected under is readable, not buried. */
export const PARTNER_WEIGHT = 3;
export const OPPONENT_WEIGHT = 1;
export const BACK_TO_BACK_WEIGHT = 1;

/** The per-candidate greedy cost weights. Not the objective — the objective picks between finished schedules; these steer one schedule's construction. */
const GREEDY_REPEAT_PARTNER_WEIGHT = 6;
const GREEDY_RECENCY_WEIGHT = 2;
const GREEDY_URGENCY_WEIGHT = 12;
const GREEDY_JITTER = 0.35;

/** `ceil(numTeams * matchesPerTeam / 6)` — the licensed grid's own row count for the same cell. */
export function scheduleMatchCount(numTeams: number, matchesPerTeam: number): number {
  return Math.ceil((numTeams * matchesPerTeam) / SLOTS_PER_MATCH);
}

/** The leftover slots that become surrogate appearances. Zero whenever `numTeams * matchesPerTeam` divides evenly by six. */
export function surrogateSlotCount(numTeams: number, matchesPerTeam: number): number {
  return scheduleMatchCount(numTeams, matchesPerTeam) * SLOTS_PER_MATCH - numTeams * matchesPerTeam;
}

export class GeneratedScheduleError extends Error {
  constructor(message: string) {
    super(`generatedSchedules: ${message}`);
    this.name = "GeneratedScheduleError";
  }
}

/** An unordered pair key over zero-based team indices. */
function pairKey(a: number, b: number): number {
  return a < b ? a * 1024 + b : b * 1024 + a;
}

interface Candidate {
  readonly matches: ScheduleTemplateMatch[];
  readonly objective: number;
}

/**
 * Builds ONE greedy-randomised candidate. Feasibility is guaranteed rather than
 * hoped for: at match `i` of `rows`, a team still needing `rows - i`
 * appearances MUST play this match, and since the remaining need sums to
 * exactly `(rows - i) * 6` at most six teams can be in that state at once. Those
 * teams are force-placed first; the remaining slots are filled greedily.
 */
function buildCandidate(numTeams: number, matchesPerTeam: number, rng: () => number): Candidate {
  const rows = scheduleMatchCount(numTeams, matchesPerTeam);
  const extra = surrogateSlotCount(numTeams, matchesPerTeam);

  // Rule 1: the surrogate teams, chosen uniformly at random among distinct teams.
  const order = Array.from({ length: numTeams }, (_, i) => i);
  for (let i = numTeams - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp;
  }
  const surrogateTeams = new Set(order.slice(0, extra));

  const remaining = Array.from({ length: numTeams }, (_, t) => matchesPerTeam + (surrogateTeams.has(t) ? 1 : 0));
  const lastPlayed = new Array<number>(numTeams).fill(-1);
  const partnerCount = new Map<number, number>();
  const opponentCount = new Map<number, number>();
  const appearances: number[][] = Array.from({ length: numTeams }, () => []);

  // Rule 4: the natural spacing between a team's appearances.
  const targetGap = rows / matchesPerTeam;

  const matches: ScheduleTemplateMatch[] = [];
  for (let i = 0; i < rows; i++) {
    const matchesLeft = rows - i;
    const chosen: number[] = [];
    for (let t = 0; t < numTeams; t++) {
      if (remaining[t]! >= matchesLeft && remaining[t]! > 0) chosen.push(t);
    }
    if (chosen.length > SLOTS_PER_MATCH) {
      throw new GeneratedScheduleError(
        `match ${i} of ${rows} forces ${chosen.length} teams into ${SLOTS_PER_MATCH} slots for ${numTeams} teams at ${matchesPerTeam} matches/team`
      );
    }
    while (chosen.length < SLOTS_PER_MATCH) {
      let bestTeam = -1;
      let bestCost = Number.POSITIVE_INFINITY;
      for (let t = 0; t < numTeams; t++) {
        if (remaining[t]! <= 0) continue;
        if (chosen.includes(t)) continue;
        let repeat = 0;
        for (const c of chosen) {
          repeat += (partnerCount.get(pairKey(t, c)) ?? 0) + (opponentCount.get(pairKey(t, c)) ?? 0);
        }
        const gap = lastPlayed[t]! < 0 ? targetGap : i - lastPlayed[t]!;
        const recency = Math.max(0, targetGap - gap);
        const urgency = remaining[t]! / matchesLeft;
        const cost =
          GREEDY_REPEAT_PARTNER_WEIGHT * repeat +
          GREEDY_RECENCY_WEIGHT * recency -
          GREEDY_URGENCY_WEIGHT * urgency +
          GREEDY_JITTER * rng();
        if (cost < bestCost) {
          bestCost = cost;
          bestTeam = t;
        }
      }
      if (bestTeam < 0) {
        throw new GeneratedScheduleError(`match ${i} of ${rows} ran out of candidate teams (${numTeams} teams at ${matchesPerTeam} matches/team)`);
      }
      chosen.push(bestTeam);
    }

    // Rule 3, locally: of the ten ways to split six teams into two alliances,
    // take the one with the fewest existing partnerships, random tie-break.
    const split = bestSplit(chosen, partnerCount, rng);
    const red = split.red;
    const blue = split.blue;
    for (const trio of [red, blue]) {
      for (let a = 0; a < ALLIANCE_SIZE; a++) {
        for (let b = a + 1; b < ALLIANCE_SIZE; b++) {
          const key = pairKey(trio[a]!, trio[b]!);
          partnerCount.set(key, (partnerCount.get(key) ?? 0) + 1);
        }
      }
    }
    for (const r of red) {
      for (const b of blue) {
        const key = pairKey(r, b);
        opponentCount.set(key, (opponentCount.get(key) ?? 0) + 1);
      }
    }
    for (const t of chosen) {
      remaining[t]! -= 1;
      lastPlayed[t] = i;
      appearances[t]!.push(i);
    }
    matches.push({ red, blue, redSurrogate: [false, false, false], blueSurrogate: [false, false, false] });
  }

  for (let t = 0; t < numTeams; t++) {
    if (remaining[t]! !== 0) {
      throw new GeneratedScheduleError(`team index ${t} finished with ${remaining[t]} appearances still owed`);
    }
  }

  // Rule 1's surrogate flags. The licensed grid places its surrogate
  // appearances just after two complete rounds; the flag lands on each
  // surrogate team's appearance nearest that position. WHERE the flag sits has
  // no effect on the sidecar (a surrogate is excluded from ranking credit
  // wherever it appears, and the rank simulation has no notion of match order)
  // — it is matched so the two structures differ in as few ways as possible.
  const surrogateTargetRow = Math.floor((2 * numTeams) / SLOTS_PER_MATCH);
  for (const t of surrogateTeams) {
    const mine = appearances[t]!;
    let bestRow = mine[0]!;
    for (const row of mine) {
      if (Math.abs(row - surrogateTargetRow) < Math.abs(bestRow - surrogateTargetRow)) bestRow = row;
    }
    const match = matches[bestRow]!;
    const redIndex = match.red.indexOf(t);
    if (redIndex >= 0) (match.redSurrogate as boolean[])[redIndex] = true;
    else (match.blueSurrogate as boolean[])[match.blue.indexOf(t)] = true;
  }

  return { matches, objective: objectiveOf(matches, numTeams) };
}

/** The ten distinct 3/3 splits of six teams, scored by existing partnerships only (opponent counts are a consequence of the split, and weighting both here double-counts). */
function bestSplit(six: readonly number[], partnerCount: ReadonlyMap<number, number>, rng: () => number): { red: number[]; blue: number[] } {
  let best: { red: number[]; blue: number[] } | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 64; mask++) {
    let bits = 0;
    for (let b = 0; b < 6; b++) if ((mask & (1 << b)) !== 0) bits++;
    if (bits !== ALLIANCE_SIZE) continue;
    if ((mask & 1) === 0) continue; // fix team 0 to red — halves the search and removes the mirror duplicate
    const red: number[] = [];
    const blue: number[] = [];
    for (let b = 0; b < 6; b++) ((mask & (1 << b)) !== 0 ? red : blue).push(six[b]!);
    let score = 0;
    for (const trio of [red, blue]) {
      for (let a = 0; a < ALLIANCE_SIZE; a++) {
        for (let b = a + 1; b < ALLIANCE_SIZE; b++) score += partnerCount.get(pairKey(trio[a]!, trio[b]!)) ?? 0;
      }
    }
    score += GREEDY_JITTER * rng();
    if (score < bestScore) {
      bestScore = score;
      best = { red, blue };
    }
  }
  return best!;
}

/** The module header's objective, computed on a finished schedule. */
export function objectiveOf(matches: readonly ScheduleTemplateMatch[], numTeams: number): number {
  const b = scheduleBalance(matches, numTeams, 0);
  return PARTNER_WEIGHT * b.excessPartnerPairs + OPPONENT_WEIGHT * b.excessOpponentPairs + BACK_TO_BACK_WEIGHT * b.backToBackCount;
}

/**
 * Generates a schedule for `numTeams` at `matchesPerTeam`, in the SAME shape
 * `loadScheduleTemplate` returns: zero-based slot indices with positional
 * surrogate flags, consumed identically by `buildPreScheduleArtifact`.
 */
export function generateSchedule(
  numTeams: number,
  matchesPerTeam: number,
  rng: () => number,
  restarts: number = DEFAULT_RESTARTS
): ScheduleTemplateMatch[] {
  if (numTeams < SLOTS_PER_MATCH) {
    throw new GeneratedScheduleError(`${numTeams} teams cannot fill a ${SLOTS_PER_MATCH}-slot match`);
  }
  if (matchesPerTeam < 1) throw new GeneratedScheduleError(`matchesPerTeam must be at least 1, got ${matchesPerTeam}`);
  let best: Candidate | undefined;
  for (let attempt = 0; attempt < restarts; attempt++) {
    const candidate = buildCandidate(numTeams, matchesPerTeam, rng);
    if (best === undefined || candidate.objective < best.objective) best = candidate;
  }
  return best!.matches;
}

// ---------------------------------------------------------------------------
// Balance measurement — the side-by-side "how close did we get" numbers
// ---------------------------------------------------------------------------

export interface ScheduleBalance {
  readonly matchCount: number;
  /** Non-surrogate appearances per team: identical min and max means rule 1 held. */
  readonly minCreditedAppearances: number;
  readonly maxCreditedAppearances: number;
  readonly surrogateAppearances: number;
  /** Unordered team pairs sharing an alliance more than once, counted with multiplicity beyond the first. */
  readonly excessPartnerPairs: number;
  readonly excessOpponentPairs: number;
  /** `excessPartnerPairs / partnerPairInstances` — the share of partnerships that are not a first meeting. */
  readonly repeatPartnerRate: number;
  readonly repeatOpponentRate: number;
  readonly backToBackCount: number;
  readonly backToBackRate: number;
  readonly meanGap: number;
  readonly minGap: number;
  readonly maxGap: number;
  /** The largest gap any single team endures — the "long idle" rule 4 exists to bound. */
  readonly maxIdleGap: number;
}

/** Measures a pairing structure's balance. Pure; `matchesPerTeam` is used only to report the credited-appearance range, so `0` is a legitimate "don't care". */
export function scheduleBalance(matches: readonly ScheduleTemplateMatch[], numTeams: number, matchesPerTeam: number): ScheduleBalance {
  void matchesPerTeam;
  const partnerCount = new Map<number, number>();
  const opponentCount = new Map<number, number>();
  const credited = new Array<number>(numTeams).fill(0);
  const appearances: number[][] = Array.from({ length: numTeams }, () => []);
  let surrogateAppearances = 0;

  for (const [i, match] of matches.entries()) {
    for (const [side, flags] of [
      [match.red, match.redSurrogate],
      [match.blue, match.blueSurrogate],
    ] as const) {
      for (const [pos, team] of side.entries()) {
        appearances[team]!.push(i);
        if (flags[pos] === true) surrogateAppearances++;
        else credited[team]! += 1;
      }
      for (let a = 0; a < side.length; a++) {
        for (let b = a + 1; b < side.length; b++) {
          const key = pairKey(side[a]!, side[b]!);
          partnerCount.set(key, (partnerCount.get(key) ?? 0) + 1);
        }
      }
    }
    for (const r of match.red) {
      for (const b of match.blue) {
        const key = pairKey(r, b);
        opponentCount.set(key, (opponentCount.get(key) ?? 0) + 1);
      }
    }
  }

  const excess = (counts: ReadonlyMap<number, number>): { excess: number; instances: number } => {
    let ex = 0;
    let instances = 0;
    for (const n of counts.values()) {
      instances += n;
      ex += n - 1;
    }
    return { excess: ex, instances };
  };
  const p = excess(partnerCount);
  const o = excess(opponentCount);

  const gaps: number[] = [];
  let backToBack = 0;
  for (const list of appearances) {
    const sorted = [...list].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i]! - sorted[i - 1]!;
      gaps.push(gap);
      if (gap === 1) backToBack++;
    }
  }

  return {
    matchCount: matches.length,
    minCreditedAppearances: Math.min(...credited),
    maxCreditedAppearances: Math.max(...credited),
    surrogateAppearances,
    excessPartnerPairs: p.excess,
    excessOpponentPairs: o.excess,
    repeatPartnerRate: p.instances === 0 ? 0 : p.excess / p.instances,
    repeatOpponentRate: o.instances === 0 ? 0 : o.excess / o.instances,
    backToBackCount: backToBack,
    backToBackRate: gaps.length === 0 ? 0 : backToBack / gaps.length,
    meanGap: gaps.length === 0 ? 0 : gaps.reduce((a, b) => a + b, 0) / gaps.length,
    minGap: gaps.length === 0 ? 0 : Math.min(...gaps),
    maxGap: gaps.length === 0 ? 0 : Math.max(...gaps),
    maxIdleGap: gaps.length === 0 ? 0 : Math.max(...gaps),
  };
}
