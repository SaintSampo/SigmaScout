/**
 * Leaf module for the RP (ranking-point) rule tree: types and constants
 * every per-season module and the dispatch table (`rules.ts`) both need,
 * with no dependency running the other direction — every season file
 * imports this leaf, `rules.ts` imports every season file, and neither the
 * leaf nor a season file ever imports `rules.ts`, so the dependency graph
 * stays acyclic at module-init time.
 *
 * RP bonus prediction runs off a state vector kept separate from the
 * score-component vector (`breakdown/constants.ts`'s `ParsedComponents`).
 * That separation is a units discipline, not a "every threshold variable is
 * a raw count" claim — some bonuses threshold on a point total, others on a
 * raw count. `RpThresholdVariable.unit` exists so a season module cannot
 * silently read a `*Points` roll-up where the manual's rule wants a raw `*Count`.
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
 * IN PRODUCTION, all 34 threshold-variable declarations across the ten
 * registered seasons name `"lattice"` since 2026-09-14 (quick task
 * 260914-01x). The lattice family and the walk-forward mean shift
 * (`meanShift.ts`) were measured as four arms on the 2016-2020, 2022
 * selection slice against a bar committed before any figure existed, and
 * lattice+meanShift shipped: pooled bonus Brier 0.179914 to 0.124278 and
 * pooled total-RP RPS 0.159627 to 0.141956
 * (`data/baselines/rp-bonus-arms-2026-09.json`).
 *
 * `"gaussian"` and `"negative-binomial"` stay in this union for a future
 * re-measurement, built as a variant rule module, never by editing the
 * production tree. Gaussian was the production family until that ship;
 * a negative-binomial arm was measured earlier and did not clear its
 * no-regression bar (`docs/models/rp-attribution.md`). Keeping the family
 * declared per-variable (rather than a global switch) is what lets a
 * measurement arm reach exactly the variables it wants to.
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

/**
 * One named scalar a season's RP rules threshold on, tracked in its own
 * units. Named "threshold variable", not "count" — see the file header.
 */
export interface RpThresholdVariable {
  readonly name: string;
  readonly unit: "count" | "points";
  /**
   * Which `MarginalFamily` this variable's belief is modelled with, declared
   * explicitly beside `unit` rather than derived from it — a variable
   * needing an exception has somewhere to say so. Every declaration in the
   * tree names `"lattice"` since 2026-09-14, quick task 260914-01x (see
   * `MarginalFamily`'s own doc comment). Required on every season module — a
   * future season module cannot compile without naming a family.
   */
  readonly marginalFamily: MarginalFamily;
  /**
   * The value lattice this variable lives on, a rule fact with a one-line
   * rule citation beside every declaration (see `RpLatticeSupport`).
   * Required, so a new season module cannot compile without stating it.
   */
  readonly lattice: RpLatticeSupport;
}

/**
 * The three event tiers FRC's RP bonus thresholds can scale by (Pitfall 1):
 * `base` covers Regional/District/Preseason, `districtChampionship` covers
 * District Championship and District Championship Division, `championship`
 * covers Championship Division/Finals. Which tiers actually get a raised
 * threshold, and by how much, is season-specific — see each season module.
 */
export type EventTier = "base" | "districtChampionship" | "championship";

/**
 * TBA `event_type` enum -> `EventTier`
 * (`github.com/the-blue-alliance/the-blue-alliance/blob/master/consts/event_type.py`):
 * `0`=Regional, `1`=District, `100`=Preseason -> base;
 * `2`=District Championship, `5`=District Championship Division ->
 * districtChampionship; `3`=Championship Division, `4`=Championship Finals
 * -> championship. `99`=Offseason is DELIBERATELY absent — offseason
 * matches are excluded from every RP population (self-reported breakdowns,
 * not guaranteed to follow the official season schema, same exclusion
 * `breakdown/reconciliation.test.ts` already applies).
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

/**
 * Looks up the `EventTier` for a raw TBA `event_type`. Throws for an
 * unmapped value (including `99` offseason) rather than defaulting to
 * `base` — a silent default here is exactly Pitfall 1's failure mode: a
 * model that quietly treats every unmapped event as the lowest tier would
 * silently mispredict every District-Championship-and-above match for an
 * event type this table doesn't yet know about, instead of failing loudly
 * the moment such an event type is seen.
 */
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
 * The caller-side counterpart to `eventTierFor`'s deliberate throw above.
 * Reads the SAME `EVENT_TYPE_TIERS` table, so the two can never disagree
 * about which event types are eligible — adding a new event type to
 * `EVENT_TYPE_TIERS` automatically makes it eligible here too, with no
 * second edit required anywhere.
 *
 * `eventTierFor` is correct to throw for its own callers (every per-season
 * `parse()`/`predictThresholds()`, which have no sensible fallback once
 * invoked). A live caller that cannot guarantee an upstream offseason/unmapped
 * filter (e.g. the Worker's live RP fold in `apps/worker/src/scheduled.ts`)
 * applies this predicate as a precondition check BEFORE reaching that throw.
 * `eventTierFor` itself is NOT weakened — it keeps throwing; this predicate
 * is a precondition check, not a replacement.
 */
export function isRpEligibleEventType(eventType: number): boolean {
  return EVENT_TYPE_TIERS[eventType] !== undefined;
}

/**
 * The shape every tiered RP threshold is expressed in. A season whose
 * threshold does not actually tier states the same number three times and
 * says so in a comment — the DATA shape stays uniform across every bonus in
 * every season, so correcting a threshold is always a one-line data edit,
 * never a code branch (must_haves: "RP bonus thresholds are per-season,
 * per-event-tier DATA in a table").
 */
export type RpTieredThreshold = Readonly<Record<EventTier, number>>;

/**
 * What a `BonusPredicate` clause compares a variable (or linear
 * combination) against: either a genuinely tiered `RpTieredThreshold`
 * table, or a plain `number` for a definitional constant that is not
 * itself a threshold (`CROSSINGS_FOR_DAMAGED_DEFENSE`,
 * `AUTO_LINE_ROBOTS_REQUIRED`, `AUTO_CORAL_REQUIRED`,
 * `CORAL_BONUS_COOP_LEVELS_REQUIRED`) — see `resolveRpThreshold`, the sole
 * place this distinction is branched on.
 */
export type RpPredicateThreshold = RpTieredThreshold | number;

/**
 * The ONE place `RpPredicateThreshold`'s `RpTieredThreshold`-vs-`number`
 * distinction is branched on, anywhere in this leaf. Keeping this the sole
 * branch point is what lets `CROSSINGS_FOR_DAMAGED_DEFENSE`,
 * `AUTO_LINE_ROBOTS_REQUIRED`, `AUTO_CORAL_REQUIRED` and
 * `CORAL_BONUS_COOP_LEVELS_REQUIRED` stay the plain numbers their own doc
 * comments explain they are, instead of being laundered into uniform
 * triples that would misrepresent their provenance.
 */
export function resolveRpThreshold(threshold: RpPredicateThreshold, tier: EventTier): number {
  return typeof threshold === "number" ? threshold : threshold[tier];
}

/**
 * One term of a `linearCombination`/`countOfIndicators` clause: a
 * threshold-variable name and a DIVISOR (never a multiplier) that term's
 * value is divided by before summing. `divisor` defaults to `1` when
 * absent. This is load-bearing: dividing by 5 and multiplying by the
 * nearest double to one-fifth are different operations on a binary float,
 * and a threshold comparison is precisely where that difference is
 * observable — so the evaluator always divides, never multiplies by a
 * precomputed coefficient, and term order is part of the declaration
 * because floating-point addition is not associative. The three affected
 * derivations are 2016's `towerRobotCount` (divisors 5 and 15), 2017's
 * `rotorCount` (divisors 60 and 40) and 2023's `links` (divisor 5).
 */
export interface RpLinearTerm {
  readonly variable: string;
  readonly divisor?: number;
}

/**
 * One linear inequality: sum `terms` left to right (each term divided by
 * its own `divisor`), then compare the sum against `threshold` with
 * `direction`. `"lte"` exists for exactly one clause in the whole tree —
 * 2016 `capture`'s attacked-tower half — see
 * `CAPTURED_TOWER_END_STRENGTH_THRESHOLD`'s own "the only inverted
 * comparison in this module" note in `2016.ts`.
 */
export interface RpThresholdClause {
  readonly terms: readonly RpLinearTerm[];
  readonly direction: "gte" | "lte";
  readonly threshold: RpPredicateThreshold;
}

/**
 * Metadata recording that a bonus's REAL achievement condition also gates
 * on an alliance-level signal that is NOT itself a tracked threshold
 * variable (coopertition flags, per-robot auto-leave state) — see
 * `RpRuleModule.predictThresholds`'s own doc comment for the general
 * conservative-branch contract this records. `branch` is `"conservative"`
 * for the five bonuses that take the stricter table or the hardcoded
 * `false`, and `"numeric-proxy"` for 2018 `autoQuest`, the one documented
 * exception whose fallback OVER-fires rather than under-fires.
 * `errorDirection` names which way: `"understates"` for the five,
 * `"overstates"` for 2018. `note` carries the one-sentence justification and
 * the measured figure — never restated as a fresh claim.
 *
 * **THIS TYPE IS METADATA ONLY. `evaluateBonusPredicates` must never read
 * it.** The conservative choice is already baked into which threshold
 * table or branch the declaration names, so there is nothing for the
 * evaluator to decide, and a gate the evaluator COULD branch on is a gate a
 * future edit could flip (Pitfall 4).
 */
export interface RpUntrackedGate {
  readonly signal: string;
  readonly branch: "conservative" | "numeric-proxy";
  readonly errorDirection: "understates" | "overstates";
  readonly note: string;
}

/**
 * One bonus's achievement condition, expressed as declared data instead of
 * a hand-written comparison. All 21 bonuses across the ten registered
 * seasons reduce to exactly these seven mechanism classes; none has
 * required an eighth.
 */
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
      /**
       * The sibling bonus name(s) thresholding the SAME `variable`. 2026's
       * `energized`/`supercharged` pair names each other here, distinguishable
       * from `conjunctionDistinct` at the TYPE level so a grouping pass
       * cannot accidentally treat them as independent.
       */
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
 * The thin evaluator every season's `predictThresholds` delegates to. First
 * statement is `eventTierFor(eventType)` — reached before any comparison,
 * so an unmapped event type still throws exactly as every season's
 * hand-written implementation already does. Builds
 * `bonusFlags` with `Object.create(null)` and assigns one key per predicate
 * in ARRAY order, matching every module's current epilogue exactly. One
 * `switch` on `kind`, seven arms, no default fallthrough that silently
 * returns `false` — an unhandled kind is a COMPILE error via the
 * exhaustiveness check in the `default` arm, never a silent mis-evaluation.
 *
 * `nestedSameVariable` evaluates IDENTICALLY to `singleThreshold` here — the
 * nesting is declarative grouping information only, and making it change
 * the boolean answer here would break byte-for-byte equivalence with the
 * pre-rewrite code.
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
 * What a season module's `parse` returns for ONE alliance. `bonusFlags` are
 * RECOMPUTED from raw fields; `recordedBonusFlags` are TBA's own booleans
 * read verbatim from the same raw payload — keeping both is what turns
 * `reconciliation.test.ts` into a comparison rather than a restatement.
 * `thresholdVariables` carries every named `RpThresholdVariable`
 * value this parse observed (keyed by `RpThresholdVariable.name`), so the
 * reconciliation test's exact-boundary assertion and per-tier bracket
 * report can read the raw scalar a bonus flag was computed from, not just
 * the boolean result.
 *
 * `winRp`/`tieRp` echo the season's own constants (`RpRuleModule.winRp`/
 * `.tieRp`) for call-site convenience — they are NOT gated on whether this
 * alliance actually won or tied. `totalRp` is the achieved BONUS RP only
 * (the count of true recomputed `bonusFlags`) — it deliberately does NOT
 * include a win/tie/loss component, because `parse` has no outcome input
 * and must not derive one from a score inside the raw breakdown (the same
 * "a rule that silently works only for finished matches is the failure
 * mode this whole plan exists to prevent" reasoning `2024.ts` documents for
 * its own shipped-threshold fields). The full summed RP a caller compares
 * against `red_rp_earned`/`blue_rp_earned` is
 * `(won ? winRp : tied ? tieRp : 0) + totalRp`, computed by the CALLER
 * (`reconciliation.test.ts`) from the match's own known winner — never by
 * `parse` itself.
 */
export interface RpParsedResult {
  readonly thresholdVariables: Record<string, number>;
  readonly bonusFlags: Record<string, boolean>;
  readonly recordedBonusFlags: Record<string, boolean>;
  readonly winRp: number;
  readonly tieRp: number;
  readonly totalRp: number;
}

/**
 * The per-season interface, structurally mirroring `SeasonComponentMap`
 * (`breakdown/constants.ts`). `maxRp` is `winRp + bonusNames.length` and is
 * what sizes the pmf array — asserted equal in `rules.test.ts` rather than
 * trusted from a hand-maintained literal.
 */
/** What `RpRuleModule.predictThresholds` returns — the bonus-only counterpart of `RpParsedResult` (no `thresholdVariables`/`recordedBonusFlags`/`winRp`/`tieRp` echo, since the caller already supplied the values and has no TBA-recorded flag to compare against a PREDICTED match). */
export interface RpThresholdPrediction {
  readonly bonusFlags: Record<string, boolean>;
  readonly totalRp: number;
}

export interface RpRuleModule {
  readonly season: number;
  readonly thresholdVariables: readonly RpThresholdVariable[];
  readonly bonusNames: readonly string[];
  /**
   * `bonusNames` above is DERIVED from this array —
   * `bonusNames.map(p => p.name)` in every season module, one list of
   * bonus names in the tree that can never drift from a second,
   * separately-maintained literal.
   */
  readonly bonusPredicates: readonly BonusPredicate[];
  readonly maxRp: number;
  readonly winRp: number;
  readonly tieRp: number;
  parse(rawBreakdownJson: unknown, side: "red" | "blue", eventType: number): RpParsedResult;
  /**
   * Evaluates every named bonus at `eventType`'s tier from ONLY the
   * threshold-variable values a caller supplies — `values` keyed by
   * `RpThresholdVariable.name`, the shape `analyticPmf.ts`'s closed form
   * fits marginals from; it never calls `parse` above, since it works from
   * fitted per-variable BELIEFS, never a full raw `score_breakdown`.
   *
   * KNOWN, NAMED MODELING SIMPLIFICATION (documented once here, not
   * per-season, and cited by every module that needs it): a bonus whose
   * REAL achievement condition (see `parse`) also depends on an
   * alliance-level gating signal that is NOT itself a tracked threshold
   * variable — 2023's/2024's/2025's own-or-both-alliance coopertition
   * flags, 2025's per-robot auto-leave state and `autoCoralCount` — is
   * evaluated at its LESS-likely-to-achieve branch (coopertition assumed
   * NOT met; 2025's `autoBonus`, which has no threshold-variable-only
   * fallback at all, is always `false`). This UNDERSTATES that bonus's
   * predicted probability, never overstates it — a deliberate, honest,
   * conservative choice over silently guessing a gate is met, following
   * this project's "measured tolerance over a forced fit" precedent
   * (`reconciliation.test.ts`'s `KNOWN_TOLERANCES`). Measured mean RP
   * understatement per affected bonus is recorded in
   * `docs/models/sigma1-rp-verification.md`'s `## Conservative-Branch
   * Understatement` — no bonus in any season showed a non-zero
   * `overstatedRate`. Regenerate rather than trust a quoted figure that
   * predates a threshold-variable tracking fix.
   */
  predictThresholds(values: Readonly<Record<string, number>>, eventType: number): RpThresholdPrediction;
  /**
   * Raw TBA field names this season's breakdown carries but this module
   * never reads for an achievement computation (e.g. 2024's own shipped
   * per-match thresholds, read only for the reconciliation test's
   * independent cross-check — see `2024.ts`). Optional, mirrors
   * `SeasonComponentMap.diagnosticKeys`.
   */
  readonly diagnosticKeys?: readonly string[];
}

/**
 * The RP-side twin of `assertFiniteComponents` (`breakdown/constants.ts`):
 * throws loudly rather than letting a non-finite threshold-variable value
 * reach the fold or `analyticPmf.ts`'s closed-form pmf. A value that
 * survives a season module's Zod parse boundary can still be produced
 * non-finite by an upstream degenerate branch — the same second-gate
 * reasoning `breakdown/constants.ts`'s own doc comment records for
 * `assertFiniteComponents`.
 */
export function assertFiniteThresholdVariables(vars: Record<string, number>, context: string): void {
  for (const [name, value] of Object.entries(vars)) {
    if (!Number.isFinite(value)) {
      throw new Error(`non-finite value ${value} for RP threshold variable "${name}" (${context}) — refusing to fold into algorithm state`);
    }
  }
}

/**
 * RP is a qualification-tournament-only mechanic: both `red_rp_earned` and
 * `blue_rp_earned` are 0 for 100% of PLAYED elimination matches in every
 * season, verified across the full corpus population. `predict()`
 * short-circuits to a degenerate `P(RP=0)=1` pmf for any non-`qm`
 * `compLevel`, matching `score.ts`'s existing qual/elim split.
 */
export const ELIMINATION_RP_TOTAL = 0;

/**
 * The SECOND of the two eligibility predicates for bonus RP — the sibling
 * of `isRpEligibleEventType` above, which gates on event TYPE (regional vs.
 * offseason etc.); this one gates on comp LEVEL. FRC awards bonus ranking
 * points in qualification play only (`ELIMINATION_RP_TOTAL`'s own measured
 * 0/N across every played elimination match, every season) — this predicate
 * returns `true` for `"qm"` and `false` for every elimination `CompLevel`
 * (`"ef" | "qf" | "sf" | "f"`).
 *
 * This is the SINGLE SOURCE of that rule: the predicted gate
 * (`analyticPmf.ts`, `apps/worker/src/scheduled.ts`), the actual gate
 * (`packages/harness/publish.ts`), and the client guard
 * (`apps/web/src/components/team/BonusRpDots.tsx`'s `applicable` prop) all
 * call this one function. Independent copies of the rule previously
 * drifted — the actual side had no gate at all, so a played playoff match
 * published (and rendered) earned/missed bonus dots for a ranking point FRC
 * never awards there. Naming the rule once, here, is what makes that drift
 * structurally impossible to reintroduce.
 */
export function isBonusRpCompLevel(compLevel: CompLevel): boolean {
  return compLevel === "qm";
}
