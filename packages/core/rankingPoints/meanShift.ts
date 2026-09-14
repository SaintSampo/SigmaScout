/**
 * THE WALK-FORWARD MEAN SHIFT — a league-wide, per-season correction to the
 * alliance mean of every RP threshold variable.
 *
 * Quick task 260913-tw1 found the bonus-RP odds under-predict about 2.1x, and
 * that a mean deficit is the second-largest cause: an alliance's recency-
 * weighted belief lags what it actually scores. This module measures that lag
 * as it happens and adds it back.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ACCUMULATED
 * ---------------------------------------------------------------------------
 *
 * For each threshold variable, a running count and sum of
 * `observed alliance value - predicted alliance mean`, where the predicted
 * mean is `RpMomentsAccumulator.momentsFor`'s UNSHIFTED mean read before this
 * match is folded. One per season, league-wide, never per team.
 *
 * The population is exactly the tw1 probe's scored population (quick task
 * 260914-01x, CD-04): a qualification match (`isBonusRpCompLevel`) at an
 * RP-eligible event type, with a score breakdown, whose BOTH sides parse. Any
 * throw skips the whole match. A side counts only when every team on its
 * roster already has history of every variable (`rosterIsFullyWarm`), because
 * a cold team's zero mean would book a huge fake deficit.
 *
 * ---------------------------------------------------------------------------
 * HOW IT IS APPLIED
 * ---------------------------------------------------------------------------
 *
 * `apply` adds `sum / count` to a variable's alliance mean only when the
 * roster is fully warm AND at least `RP_MEAN_SHIFT_WARMUP_OBSERVATIONS` prior
 * observations of that variable exist. Variance, score moments and
 * cross-covariance are untouched. When nothing shifts it returns the very
 * object it was given, which is what keeps a cold or early prediction
 * bitwise-identical to one made without this module.
 *
 * ---------------------------------------------------------------------------
 * ORDER
 * ---------------------------------------------------------------------------
 *
 * `observeMatch` MUST run after this match's RP fields are read and BEFORE
 * `RpMomentsAccumulator.fold` for this match. Called later, the residual is
 * taken against a mean that already contains the observation, and a match
 * informs its own shift.
 *
 * A leaf: types, two gate predicates, and nothing else.
 */

import type { CompLevel } from "../algorithms/types.js";
import type { RpRuleModule } from "./constants.js";
import { isBonusRpCompLevel, isRpEligibleEventType } from "./constants.js";
import type { AllianceRpMoments } from "./moments.js";
import type { RpMomentsAccumulator } from "./empiricalMoments.js";

/**
 * Observations of a variable required before its shift applies.
 *
 * The tw1 probe's `MEAN_DEFICIT_WARMUP`. STRUCTURAL, NEVER TUNED: it exists so
 * the first few noisy residuals of a season cannot swing every prediction, and
 * the arm that carries it is measured with this value fixed.
 */
export const RP_MEAN_SHIFT_WARMUP_OBSERVATIONS = 200;

/** One variable's running residual total. */
export interface RpMeanShiftVariableState {
  readonly count: number;
  readonly sum: number;
}

/**
 * The serializable form of one season's mean shift. A few numbers per
 * variable, so it rides the D1 LEAGUE row and cannot scale with team count.
 */
export interface RpMeanShiftState {
  readonly season: number;
  readonly variables: Readonly<Record<string, RpMeanShiftVariableState>>;
}

/** The `MatchResult` fields `observeMatch` reads, and nothing more. */
export interface RpMeanShiftMatch {
  readonly compLevel: CompLevel;
  readonly eventType: number;
  readonly hasScoreBreakdown: boolean;
  readonly scoreBreakdownRaw: string | null;
  readonly redTeams: readonly string[];
  readonly blueTeams: readonly string[];
}

/**
 * True when every team on `roster` has history of every tracked variable.
 * An empty roster is NOT warm: it has no history to rest a shift on.
 */
export function rosterIsFullyWarm(beliefs: Pick<RpMomentsAccumulator, "hasHistory">, roster: readonly string[]): boolean {
  return roster.length > 0 && roster.every((teamKey) => beliefs.hasHistory(teamKey));
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** A walk-forward, per-season mean shift over one rule module's threshold variables. */
export class RpMeanShiftAccumulator {
  readonly #ruleModule: RpRuleModule;
  readonly #names: readonly string[];
  readonly #count: number[];
  readonly #sum: number[];

  constructor(ruleModule: RpRuleModule) {
    this.#ruleModule = ruleModule;
    this.#names = ruleModule.thresholdVariables.map((v) => v.name);
    this.#count = this.#names.map(() => 0);
    this.#sum = this.#names.map(() => 0);
  }

  /**
   * Books this match's residuals. MUST be called after this match's RP fields
   * are read and BEFORE `beliefs.fold` for this match (see the module header).
   *
   * Nothing is added for an elimination match, an RP-ineligible event type, a
   * missing breakdown, or a breakdown either side of which fails to parse. A
   * side whose roster is not fully warm adds nothing. A non-finite observed
   * value adds nothing for that variable, the same skip `fold` applies.
   */
  observeMatch(beliefs: RpMomentsAccumulator, match: RpMeanShiftMatch): void {
    if (!isBonusRpCompLevel(match.compLevel)) return;
    if (!isRpEligibleEventType(match.eventType)) return;
    if (!match.hasScoreBreakdown || match.scoreBreakdownRaw === null) return;

    let red: Readonly<Record<string, number>>;
    let blue: Readonly<Record<string, number>>;
    try {
      const raw: unknown = JSON.parse(match.scoreBreakdownRaw);
      red = this.#ruleModule.parse(raw, "red", match.eventType).thresholdVariables;
      blue = this.#ruleModule.parse(raw, "blue", match.eventType).thresholdVariables;
    } catch {
      return;
    }

    for (const [roster, observed] of [
      [match.redTeams, red],
      [match.blueTeams, blue],
    ] as const) {
      if (!rosterIsFullyWarm(beliefs, roster)) continue;
      // Score moments are irrelevant to the mean vector; zeros are placeholders.
      const predicted = beliefs.momentsFor(roster, 0, 0);
      for (let i = 0; i < this.#names.length; i++) {
        const value = observed[this.#names[i]!];
        const mean = predicted.meanVector[i];
        if (!isFiniteNumber(value) || !isFiniteNumber(mean)) continue;
        this.#count[i]! += 1;
        this.#sum[i]! += value - mean;
      }
    }
  }

  /**
   * `moments` with each warmed-up variable's mean shifted by its running
   * residual mean. Returns `moments` itself (reference-equal) when `fullyWarm`
   * is false or no variable has reached the warmup.
   */
  apply(moments: AllianceRpMoments, fullyWarm: boolean): AllianceRpMoments {
    if (!fullyWarm) return moments;
    let shifted: number[] | undefined;
    for (let v = 0; v < moments.variableNames.length; v++) {
      const i = this.#names.indexOf(moments.variableNames[v]!);
      if (i < 0) continue;
      const count = this.#count[i]!;
      if (count < RP_MEAN_SHIFT_WARMUP_OBSERVATIONS) continue;
      shifted ??= [...moments.meanVector];
      shifted[v] = moments.meanVector[v]! + this.#sum[i]! / count;
    }
    if (shifted === undefined) return moments;
    return { ...moments, meanVector: shifted };
  }

  /** Every declared variable's running total, including variables never observed. */
  toState(): RpMeanShiftState {
    const variables: Record<string, RpMeanShiftVariableState> = {};
    for (let i = 0; i < this.#names.length; i++) {
      variables[this.#names[i]!] = { count: this.#count[i]!, sum: this.#sum[i]! };
    }
    return { season: this.#ruleModule.season, variables };
  }

  /**
   * Rebuilds an accumulator from `toState()`'s output, the resume path.
   *
   * Returns a FRESH accumulator for `undefined`, a state from another season
   * (a stale league row must not carry last season's lag forward), or any
   * malformed entry (all-or-nothing: a half-read state would shift some
   * variables and not others). An undeclared variable name is dropped; a
   * declared variable absent from the state starts at zero.
   */
  static fromState(ruleModule: RpRuleModule, state: RpMeanShiftState | undefined): RpMeanShiftAccumulator {
    const accumulator = new RpMeanShiftAccumulator(ruleModule);
    if (state === undefined || state === null || typeof state !== "object") return accumulator;
    if (state.season !== ruleModule.season) return accumulator;
    const variables = state.variables as unknown;
    if (variables === null || typeof variables !== "object") return accumulator;

    const count = accumulator.#names.map(() => 0);
    const sum = accumulator.#names.map(() => 0);
    for (const [name, entry] of Object.entries(variables as Record<string, unknown>)) {
      if (entry === null || typeof entry !== "object") return accumulator;
      const { count: c, sum: s } = entry as Partial<RpMeanShiftVariableState>;
      if (!isCount(c) || !isFiniteNumber(s)) return accumulator;
      const i = accumulator.#names.indexOf(name);
      if (i < 0) continue;
      count[i] = c;
      sum[i] = s;
    }
    for (let i = 0; i < count.length; i++) {
      accumulator.#count[i] = count[i]!;
      accumulator.#sum[i] = sum[i]!;
    }
    return accumulator;
  }
}
