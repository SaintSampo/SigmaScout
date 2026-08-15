/**
 * Leaf module for the RP (ranking-point) rule tree (D-09, D-12): types and
 * constants every per-season module (`2022.ts`...`2026.ts`) AND the
 * dispatch table (`rules.ts`) both need, with no dependency running the
 * other direction — the identical split `breakdown/constants.ts` documents
 * for the score-component tree, applied here before any circular-import bug
 * has a chance to appear (rather than after, the way `breakdown/`'s split
 * was discovered): every season file imports THIS leaf; `rules.ts` imports
 * every season file; neither the leaf nor a season file ever imports
 * `rules.ts`, so the dependency graph stays acyclic at module-init time.
 *
 * D-09: RP bonus prediction runs off a state vector kept SEPARATE from the
 * score-component vector (`breakdown/constants.ts`'s `ParsedComponents`).
 * That separation is a units discipline, not a "every threshold variable is
 * a raw count" claim — 2022's Hangar Bonus thresholds on `endgamePoints` (a
 * point total) while its Cargo Bonus thresholds on `matchCargoTotal` (a raw
 * count). `RpThresholdVariable.unit` exists so a season module cannot
 * silently read a `*Points` roll-up where the manual's rule wants a raw
 * `*Count` (RESEARCH.md Anti-Patterns: 2026's `hubScore.totalCount`, never
 * `.totalPoints`, despite being numerically identical in sampled data).
 */

/**
 * One named scalar a season's RP rules threshold on, tracked in its own
 * units. Named "threshold variable", not "count" — see the file header.
 */
export interface RpThresholdVariable {
  readonly name: string;
  readonly unit: "count" | "points";
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
 * TBA `event_type` enum -> `EventTier` (RESEARCH.md Code Examples, CITED:
 * `github.com/the-blue-alliance/the-blue-alliance/blob/master/consts/event_type.py`):
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
 * The shape every tiered RP threshold is expressed in. A season whose
 * threshold does not actually tier states the same number three times and
 * says so in a comment — the DATA shape stays uniform across every bonus in
 * every season, so correcting a threshold is always a one-line data edit,
 * never a code branch (must_haves: "RP bonus thresholds are per-season,
 * per-event-tier DATA in a table").
 */
export type RpTieredThreshold = Readonly<Record<EventTier, number>>;

/**
 * What a season module's `parse` returns for ONE alliance. `bonusFlags` are
 * RECOMPUTED from raw fields; `recordedBonusFlags` are TBA's own booleans
 * read verbatim from the same raw payload — keeping both is what turns
 * `reconciliation.test.ts` into a comparison rather than a restatement
 * (D-12). `thresholdVariables` carries every named `RpThresholdVariable`
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
 * what sizes the pmf array in plan 03-03 — asserted equal in
 * `rules.test.ts` rather than trusted from a hand-maintained literal.
 */
export interface RpRuleModule {
  readonly season: number;
  readonly thresholdVariables: readonly RpThresholdVariable[];
  readonly bonusNames: readonly string[];
  readonly maxRp: number;
  readonly winRp: number;
  readonly tieRp: number;
  parse(rawBreakdownJson: unknown, side: "red" | "blue", eventType: number): RpParsedResult;
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
 * reach the Kalman fold or the Cholesky draw in plan 03-03. A value that
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
 * RP is a qualification-tournament-only mechanic (Pitfall 3): both
 * `red_rp_earned` and `blue_rp_earned` are 0 for 100% of PLAYED elimination
 * matches in every season, verified across the FULL population (not a
 * sample): 2022 0/2613, 2023 0/2795, 2024 0/2867, 2025 0/3056, 2026 0/3212
 * (RESEARCH.md Code Examples, this session's live corpus query). Plan
 * 03-03's `predict()` short-circuits to a degenerate `P(RP=0)=1` pmf for
 * any non-`qm` `compLevel`, matching `score.ts`'s existing qual/elim split.
 */
export const ELIMINATION_RP_TOTAL = 0;
