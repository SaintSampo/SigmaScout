/**
 * Per-season bonus ranking points — the dots drawn above each alliance's
 * predicted and actual score in `MatchTable`.
 *
 * Only BONUS RP appears here. Win/tie RP is deliberately excluded: it is
 * already carried by the Confidence chip (predicted winner) and the Call
 * column (whether that prediction held), so drawing it again as a dot would
 * be a third rendering of the same fact.
 *
 * This table is a COPY of each season's `BONUS_NAMES` in
 * `packages/core/algorithms/sigma1/rp/{season}.ts`, not a derivation. The
 * alternative — importing `RP_RULE_MODULES` — would pull the whole Sigma1 RP
 * implementation (zod schemas, threshold parsing, the Monte Carlo) into the
 * client bundle to read a handful of strings. `bonusRp.test.ts` asserts this
 * table matches the core modules exactly, so the copy cannot drift silently;
 * that is the same "copy, pinned by a test" pattern `index.html`'s inlined
 * shell tokens already use against `theme.css`.
 */

export interface BonusRp {
  /** The core rule module's own `BONUS_NAMES` entry — the join key for per-bonus data once it is published. */
  readonly key: string;
  /** The single character drawn inside the dot. */
  readonly letter: string;
  /** Human name, used for the accessible label and the tooltip. */
  readonly label: string;
}

/**
 * Seasons 2022–2024 carry two bonus RP; 2025 and 2026 carry three. The dot
 * count per alliance is therefore season-dependent, never a fixed three.
 */
export const BONUS_RP_BY_SEASON: Readonly<Record<number, readonly BonusRp[]>> = {
  2022: [
    { key: "cargoBonus", letter: "C", label: "Cargo" },
    { key: "hangarBonus", letter: "H", label: "Hangar" },
  ],
  2023: [
    { key: "activationBonus", letter: "A", label: "Activation" },
    { key: "sustainabilityBonus", letter: "S", label: "Sustainability" },
  ],
  2024: [
    { key: "melodyBonus", letter: "M", label: "Melody" },
    { key: "ensembleBonus", letter: "E", label: "Ensemble" },
  ],
  2025: [
    { key: "autoBonus", letter: "A", label: "Auto" },
    { key: "coralBonus", letter: "C", label: "Coral" },
    { key: "bargeBonus", letter: "B", label: "Barge" },
  ],
  2026: [
    { key: "energized", letter: "E", label: "Energized" },
    { key: "supercharged", letter: "S", label: "Supercharged" },
    { key: "traversal", letter: "T", label: "Traversal" },
  ],
};

/** `[]` for a season with no registered RP rules — the table then renders no dots at all rather than a row of placeholders. */
export function bonusRpForSeason(season: number): readonly BonusRp[] {
  return BONUS_RP_BY_SEASON[season] ?? [];
}

/**
 * One bonus's state for one alliance in one match.
 *
 * `unknown` is NOT a synonym for `missed`. The published artifact carries
 * only AGGREGATE ranking points (`redRpPmf`/`blueRpPmf` over the RP total,
 * and `actualRedRp`/`actualBlueRp` as a single integer), from which no
 * individual bonus can be recovered — a 2026 total of 1 does not say whether
 * it was Energized, Supercharged or Traversal. Until the pipeline publishes
 * per-bonus probabilities and per-bonus actual flags, every dot is `unknown`
 * and is drawn in its own muted, dashed style so it never asserts the false
 * claim "this alliance will not earn this bonus".
 */
export type BonusRpState = "earned" | "missed" | "unknown";

/**
 * The threshold at which a published predicted per-bonus PROBABILITY
 * (`TeamSeasonMatchSchema.redBonusRp`/`blueBonusRp`, plan 06.1-05) renders as
 * an `earned` dot rather than `missed` (PD-11, plan 06.1-06).
 *
 * A two-state mark cannot express a probability — a dot is either solid or
 * hollow, never "51% solid" — so SOME threshold is unavoidable the moment a
 * probability drives that binary. The exact boundary (a probability of
 * exactly one half) resolves to `earned`, matching this codebase's existing
 * half-away-from-zero rounding convention (`packages/harness/rounding.ts`)
 * and `sigma1/index.ts`'s own tie handling, where a win probability of
 * exactly 0.5 resolves to red. The dot's own tooltip/accessible label
 * (`bonusDotLabel`) carries the real probability as a percentage, so the
 * reader is never left with only the binary — the visual is a summary, not
 * the only representation of the number.
 */
export const PREDICTED_BONUS_THRESHOLD = 0.5;

/**
 * Maps a season's published predicted per-bonus probabilities to dot states,
 * positionally aligned to that season's own bonus list.
 *
 * Always returns exactly `count` entries. A probability at or above
 * `PREDICTED_BONUS_THRESHOLD` maps to `earned`, otherwise `missed`. An
 * undefined `probabilities` array — the Monte Carlo did not run for this
 * match — maps every position to `unknown`. An array shorter than `count`
 * maps its own trailing, absent positions to `unknown` as well: a length
 * mismatch is missing data, never a claim that the alliance will not earn
 * the remaining bonuses.
 */
export function bonusStatesFromProbabilities(probabilities: readonly number[] | undefined, count: number): BonusRpState[] {
  return Array.from({ length: count }, (_, index) => {
    const probability = probabilities?.[index];
    if (probability === undefined) return "unknown";
    return probability >= PREDICTED_BONUS_THRESHOLD ? "earned" : "missed";
  });
}

/**
 * Maps a season's published actual per-bonus flags to dot states,
 * positionally aligned to that season's own bonus list.
 *
 * Always returns exactly `count` entries. A published `null` array —
 * `TeamSeasonMatchSchema.actualRedBonusRp`/`actualBlueBonusRp`'s "the
 * pipeline looked and the fact is not derivable" state — maps every
 * position to `unknown`, honouring that same null contract: `null` is NEVER
 * coerced to `missed`, since a hollow dot would assert the alliance will not
 * earn that bonus, a claim the data does not support. An undefined array
 * (an artifact predating this field, or a season with no registered RP
 * rules) maps every position to `unknown` as well. A shorter-than-`count`
 * array maps its own trailing positions to `unknown`, matching
 * `bonusStatesFromProbabilities`'s own convention.
 */
export function bonusStatesFromFlags(flags: readonly boolean[] | null | undefined, count: number): BonusRpState[] {
  return Array.from({ length: count }, (_, index) => {
    if (flags === null || flags === undefined) return "unknown";
    const flag = flags[index];
    if (flag === undefined) return "unknown";
    return flag ? "earned" : "missed";
  });
}

/**
 * The single source of both a dot's `title` attribute and its accessible
 * label (`aria-label`) — one function so the two can never drift apart.
 *
 * Precedence, in order:
 *   1. `unknown` state — "no data published", regardless of kind.
 *   2. `predicted` kind with a defined `probability` — the probability as a
 *      whole-number percentage, so a 51% prediction is never flattened to
 *      only the binary dot.
 *   3. `actual` kind, `earned` state — "earned".
 *   4. `actual` kind, `missed` state — "not earned".
 *   5. `predicted` kind with no `probability` (a states-only caller) — the
 *      word "predicted" plus the state word.
 */
export function bonusDotLabel(label: string, state: BonusRpState, kind: "predicted" | "actual", probability?: number): string {
  if (state === "unknown") {
    return `${label}: no data published`;
  }
  if (kind === "predicted" && probability !== undefined) {
    const percent = Math.round(probability * 100);
    return `${label}: predicted ${percent}% likely`;
  }
  if (kind === "actual" && state === "earned") {
    return `${label}: earned`;
  }
  if (kind === "actual" && state === "missed") {
    return `${label}: not earned`;
  }
  return `${label}: predicted ${state}`;
}
