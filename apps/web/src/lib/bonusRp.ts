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
