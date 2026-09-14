/**
 * Leaf module for the RP (ranking-point) rule tree. Season files import this leaf
 * and `rules.ts` imports the season files; nothing here imports `rules.ts`, so the
 * dependency graph stays acyclic at module-init time.
 *
 * RP threshold variables are kept separate from the score-component vector as a
 * units discipline: some bonuses threshold on a point total, others on a raw count.
 * `RpThresholdVariable.unit` exists so a season module cannot silently read a
 * `*Points` roll-up where the manual's rule wants a raw `*Count`.
 */

import type { CompLevel } from "../algorithms/types.js";

/**
 * The marginal probability family a threshold variable's belief is modelled
 * with. Declared explicitly per-variable beside `unit`, rather than derived
 * from it, so a variable needing an exception has somewhere to say so.
 *
 * `"negative-binomial"` is the count-native family (right-skewed, exact
 * discrete CDF at integer thresholds, support `[0, infinity)`); it is
 * NOT closed under scaled addition, so a variable appearing in any
 * multi-term or divisor-bearing clause cannot declare it — `familyForClauseSum`
 * in `analyticPmf.ts` refuses that combination loudly rather than silently
 * refitting it as a Gaussian.
 *
 * `"lattice"` is the integer-shape family: a bounded beta-binomial/binomial
 * on the variable's declared `lattice` support when the rules cap it,
 * otherwise a Gaussian discretized onto the declared step. Multi-term and
 * divisor-bearing clauses are summed by exact lattice convolution in
 * `analyticPmf.ts`, so unlike negative binomial it may appear in any clause.
 *
 * Every production declaration names `"lattice"`, shipped together with the
 * walk-forward mean shift (`meanShift.ts`); evidence in
 * `data/baselines/rp-bonus-arms-2026-09.json`. `"gaussian"` and
 * `"negative-binomial"` stay for re-measurement as variant rule modules, never by
 * editing the production tree; per-variable declaration is what lets a measurement
 * arm reach exactly the variables it wants.
 */
export type MarginalFamily = "negative-binomial" | "gaussian" | "lattice";

/**
 * The lattice a threshold variable's value lives on, as a RULE FACT taken
 * from the game manual, never from season data: every value is
 * `min + k * step` for a non-negative integer `k`, and never exceeds `max`.
 * `min` and `max` are optional because not every rule sets them (2016
 * `attackedTowerEndStrength` has no floor; uncapped scoring has no ceiling).
 * Where both exist, `(max - min) / step` is an integer, pinned in
 * `rules.test.ts`. The family only reads this when `marginalFamily` is
 * `"lattice"`.
 */
export interface RpLatticeSupport {
  readonly step: number;
  readonly min?: number;
  readonly max?: number;
}

/** One named scalar a season's RP rules threshold on, tracked in its own units (not necessarily a count; see the file header). */
export interface RpThresholdVariable {
  readonly name: string;
  readonly unit: "count" | "points";
  /** Required, so a new season module cannot compile without naming a family. */
  readonly marginalFamily: MarginalFamily;
  /** Required rule fact, with a one-line rule citation beside every declaration. */
  readonly lattice: RpLatticeSupport;
}

/** The event tiers RP bonus thresholds can scale by; which tiers get a raised threshold is season-specific. */
export type EventTier = "base" | "districtChampionship" | "championship";

/**
 * TBA `event_type` enum -> `EventTier`
 * (`github.com/the-blue-alliance/the-blue-alliance/blob/master/consts/event_type.py`):
 * `0`=Regional, `1`=District, `100`=Preseason -> base;
 * `2`=District Championship, `5`=District Championship Division ->
 * districtChampionship; `3`=Championship Division, `4`=Championship Finals
 * -> championship. `99`=Offseason is deliberately absent: offseason breakdowns are
 * self-reported and not guaranteed to follow the season schema, so they are
 * excluded from every RP population.
 */
export const EVENT_TYPE_TIERS: Readonly<Record<number, EventTier>> = {
  0: "base",
  1: "base",
  100: "base",
  2: "districtChampionship",
  5: "districtChampionship",
  3: "championship",
  4: "championship",
};

/** Throws for an unmapped `event_type` (including `99` offseason) rather than defaulting to `base`, which would silently mispredict every higher-tier match of an unknown type. */
export function eventTierFor(eventType: number): EventTier {
  const tier = EVENT_TYPE_TIERS[eventType];
  if (tier === undefined) {
    throw new Error(
      `eventTierFor: unmapped TBA event_type ${eventType} (registered: ${Object.keys(EVENT_TYPE_TIERS).join(", ")}) — offseason (99) is deliberately excluded from every RP population`
    );
  }
  return tier;
}

/**
 * Precondition check for callers that cannot guarantee an upstream offseason filter
 * (e.g. the Worker's live RP fold), applied before `eventTierFor`'s throw. Reads the
 * same `EVENT_TYPE_TIERS` table, so the two can never disagree.
 */
export function isRpEligibleEventType(eventType: number): boolean {
  return EVENT_TYPE_TIERS[eventType] !== undefined;
}

/**
 * A season whose threshold does not tier states the same number three times, so
 * the data shape stays uniform and correcting a threshold is a one-line data edit.
 */
export type RpTieredThreshold = Readonly<Record<EventTier, number>>;

/** A tiered threshold table, or a plain `number` for a definitional constant that is not itself a tiered threshold (e.g. `AUTO_LINE_ROBOTS_REQUIRED`). */
export type RpPredicateThreshold = RpTieredThreshold | number;

/** The sole branch point on the table-vs-number distinction. */
export function resolveRpThreshold(threshold: RpPredicateThreshold, tier: EventTier): number {
  return typeof threshold === "number" ? threshold : threshold[tier];
}

/**
 * One clause term: a threshold-variable name and a DIVISOR (default `1`), never a
 * multiplier. Dividing by 5 and multiplying by the nearest double to one-fifth
 * differ on a binary float exactly at a threshold comparison, so the evaluator
 * always divides; term order is part of the declaration because floating-point
 * addition is not associative.
 */
export interface RpLinearTerm {
  readonly variable: string;
  readonly divisor?: number;
}

/** Sum `terms` left to right, then compare with `direction`. `"lte"` is used only by 2016 `capture`'s attacked-tower half. */
export interface RpThresholdClause {
  readonly terms: readonly RpLinearTerm[];
  readonly direction: "gte" | "lte";
  readonly threshold: RpPredicateThreshold;
}

/**
 * Records that a bonus's real condition also gates on an untracked alliance-level
 * signal. `branch` is `"conservative"` (stricter table, understates) except 2018
 * `autoQuest`, a `"numeric-proxy"` that overstates. `note` carries the justification
 * and the measured figure.
 *
 * **Metadata only: `evaluateBonusPredicates` must never read it.** The choice is
 * already baked into the declared threshold, and a gate the evaluator could branch
 * on is a gate a future edit could flip.
 */
export interface RpUntrackedGate {
  readonly signal: string;
  readonly branch: "conservative" | "numeric-proxy";
  readonly errorDirection: "understates" | "overstates";
  readonly note: string;
}

/** One bonus's achievement condition as declared data; every registered season's bonuses reduce to these seven kinds. */
export type BonusPredicate =
  | {
      readonly kind: "singleThreshold";
      readonly name: string;
      readonly variable: string;
      readonly direction: "gte" | "lte";
      readonly threshold: RpPredicateThreshold;
      readonly untrackedGate?: RpUntrackedGate;
    }
  | {
      readonly kind: "linearCombination";
      readonly name: string;
      readonly terms: readonly RpLinearTerm[];
      readonly direction: "gte" | "lte";
      readonly threshold: RpPredicateThreshold;
      readonly untrackedGate?: RpUntrackedGate;
    }
  | {
      readonly kind: "conjunctionDistinct";
      readonly name: string;
      readonly clauses: readonly RpThresholdClause[];
      readonly untrackedGate?: RpUntrackedGate;
    }
  | {
      readonly kind: "nestedSameVariable";
      readonly name: string;
      readonly variable: string;
      readonly direction: "gte" | "lte";
      readonly threshold: RpPredicateThreshold;
      /** Sibling bonus name(s) thresholding the same `variable`, so a grouping pass cannot treat them as independent. */
      readonly nestedWith: readonly string[];
    }
  | {
      readonly kind: "countOfIndicators";
      readonly name: string;
      readonly indicators: readonly RpThresholdClause[];
      readonly required: RpPredicateThreshold;
      readonly untrackedGate?: RpUntrackedGate;
    }
  | {
      readonly kind: "dataDependentMixture";
      readonly name: string;
      readonly selector: RpThresholdClause;
      readonly whenSelectorTrue: RpThresholdClause;
      readonly whenSelectorFalse: RpThresholdClause;
    }
  | {
      readonly kind: "constant";
      readonly name: string;
      readonly value: boolean;
      readonly reason: string;
    };

function evaluateClause(clause: RpThresholdClause, values: Readonly<Record<string, number>>, tier: EventTier): boolean {
  let sum = 0;
  for (const term of clause.terms) {
    sum += (values[term.variable] ?? 0) / (term.divisor ?? 1);
  }
  const threshold = resolveRpThreshold(clause.threshold, tier);
  return clause.direction === "gte" ? sum >= threshold : sum <= threshold;
}

/**
 * The evaluator every season's `predictThresholds` delegates to. Resolves the tier
 * first, so an unmapped event type throws before any comparison; keys are assigned
 * in array order. `nestedSameVariable` evaluates identically to `singleThreshold`:
 * nesting is grouping information only.
 */
export function evaluateBonusPredicates(
  predicates: readonly BonusPredicate[],
  values: Readonly<Record<string, number>>,
  eventType: number
): RpThresholdPrediction {
  const tier = eventTierFor(eventType);
  const bonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;

  for (const predicate of predicates) {
    let achieved: boolean;
    switch (predicate.kind) {
      case "singleThreshold":
      case "nestedSameVariable": {
        const value = values[predicate.variable] ?? 0;
        const threshold = resolveRpThreshold(predicate.threshold, tier);
        achieved = predicate.direction === "gte" ? value >= threshold : value <= threshold;
        break;
      }
      case "linearCombination": {
        achieved = evaluateClause({ terms: predicate.terms, direction: predicate.direction, threshold: predicate.threshold }, values, tier);
        break;
      }
      case "conjunctionDistinct": {
        achieved = predicate.clauses.every((clause) => evaluateClause(clause, values, tier));
        break;
      }
      case "countOfIndicators": {
        const satisfied = predicate.indicators.filter((clause) => evaluateClause(clause, values, tier)).length;
        const required = resolveRpThreshold(predicate.required, tier);
        achieved = satisfied >= required;
        break;
      }
      case "dataDependentMixture": {
        const selected = evaluateClause(predicate.selector, values, tier);
        achieved = evaluateClause(selected ? predicate.whenSelectorTrue : predicate.whenSelectorFalse, values, tier);
        break;
      }
      case "constant": {
        achieved = predicate.value;
        break;
      }
      default: {
        const exhaustive: never = predicate;
        throw new Error(`evaluateBonusPredicates: unhandled predicate kind ${JSON.stringify(exhaustive)}`);
      }
    }
    bonusFlags[predicate.name] = achieved;
  }

  const totalRp = Object.values(bonusFlags).filter(Boolean).length;
  return { bonusFlags, totalRp };
}

/**
 * What `parse` returns for one alliance. `bonusFlags` are recomputed from raw
 * fields; `recordedBonusFlags` are TBA's own booleans, so reconciliation is a
 * comparison rather than a restatement. `thresholdVariables` carries the raw
 * scalars each flag was computed from.
 *
 * `winRp`/`tieRp` echo the season constants and are not gated on the outcome.
 * `totalRp` is bonus RP only: `parse` has no outcome input and must not derive one
 * from the breakdown, so the caller adds `(won ? winRp : tied ? tieRp : 0)`.
 */
export interface RpParsedResult {
  readonly thresholdVariables: Record<string, number>;
  readonly bonusFlags: Record<string, boolean>;
  readonly recordedBonusFlags: Record<string, boolean>;
  readonly winRp: number;
  readonly tieRp: number;
  readonly totalRp: number;
}

/** What `predictThresholds` returns: the bonus-only counterpart of `RpParsedResult`. */
export interface RpThresholdPrediction {
  readonly bonusFlags: Record<string, boolean>;
  readonly totalRp: number;
}

/** The per-season interface. `maxRp` (`winRp + bonusNames.length`) sizes the pmf array and is asserted in `rules.test.ts`. */
export interface RpRuleModule {
  readonly season: number;
  readonly thresholdVariables: readonly RpThresholdVariable[];
  readonly bonusNames: readonly string[];
  /** `bonusNames` is derived from this array in every season module, so the two cannot drift. */
  readonly bonusPredicates: readonly BonusPredicate[];
  readonly maxRp: number;
  readonly winRp: number;
  readonly tieRp: number;
  parse(rawBreakdownJson: unknown, side: "red" | "blue", eventType: number): RpParsedResult;
  /**
   * Evaluates every bonus from supplied threshold-variable values only (never a raw
   * breakdown). A bonus whose real condition also gates on an untracked
   * alliance-level signal (coopertition flags) is evaluated at its less-likely
   * branch, understating rather than guessing the gate is met; see each bonus's
   * `untrackedGate.note` for the measured effect.
   */
  predictThresholds(values: Readonly<Record<string, number>>, eventType: number): RpThresholdPrediction;
  /** Raw TBA fields the breakdown carries but no achievement computation reads (e.g. 2024's shipped thresholds, cross-checked in reconciliation only). */
  readonly diagnosticKeys?: readonly string[];
}

/** Throws rather than letting a non-finite threshold-variable value reach the fold or the closed-form pmf; a value past the Zod boundary can still be non-finite from an upstream degenerate branch. */
export function assertFiniteThresholdVariables(vars: Record<string, number>, context: string): void {
  for (const [name, value] of Object.entries(vars)) {
    if (!Number.isFinite(value)) {
      throw new Error(`non-finite value ${value} for RP threshold variable "${name}" (${context}) — refusing to fold into algorithm state`);
    }
  }
}

/** RP is qualification-only: `red_rp_earned`/`blue_rp_earned` are 0 for every played elimination match in the corpus, so non-`qm` predictions are a degenerate `P(RP=0)=1` pmf. */
export const ELIMINATION_RP_TOTAL = 0;

/**
 * Bonus RP is awarded in qualification play only (`"qm"`); the comp-level sibling of
 * `isRpEligibleEventType`. The single source of that rule for the predicted gate,
 * the published actual gate and the web dots, so no copy can drift into rendering
 * bonus dots for a playoff match.
 */
export function isBonusRpCompLevel(compLevel: CompLevel): boolean {
  return compLevel === "qm";
}
