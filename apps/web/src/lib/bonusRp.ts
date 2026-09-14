/**
 * Per-season bonus ranking points, drawn as dots above each alliance's
 * predicted and actual score in `MatchTable`. Win/tie RP is excluded: the
 * Confidence chip and the Call column already carry it.
 *
 * The table is a COPY of each season's `BONUS_NAMES` in
 * `packages/core/rankingPoints/{season}.ts`, because importing
 * `RP_RULE_MODULES` would pull every season's rule code into the client
 * bundle. `bonusRp.test.ts` pins the copy to the core modules.
 */

import { predictionPercent } from "./predictionPercent.js";

export interface BonusRp {
  /** The core rule module's own `BONUS_NAMES` entry, the join key for per-bonus data. */
  readonly key: string;
  /** The single character drawn inside the dot. */
  readonly letter: string;
  /** Human name, used for the accessible label and the tooltip. */
  readonly label: string;
}

/**
 * The dot count is season-dependent: 2020 carries one (Shield Energized is
 * not modelled), 2025 and 2026 carry three, every other season two.
 *
 * Keys AND order must match core's `RP_RULE_MODULES` (asserted season by
 * season), so update this table in the same change that registers a
 * season's RP rule module.
 */
export const BONUS_RP_BY_SEASON: Readonly<Record<number, readonly BonusRp[]>> = {
  2016: [
    { key: "breach", letter: "B", label: "Breach" },
    { key: "capture", letter: "C", label: "Capture" },
  ],
  2017: [
    { key: "kPa", letter: "K", label: "kPa" },
    { key: "rotor", letter: "R", label: "Rotor" },
  ],
  2018: [
    { key: "autoQuest", letter: "A", label: "Auto Quest" },
    { key: "faceTheBoss", letter: "B", label: "Face the Boss" },
  ],
  2019: [
    { key: "habDocking", letter: "H", label: "HAB Docking" },
    { key: "completeRocket", letter: "R", label: "Complete Rocket" },
  ],
  2020: [{ key: "shieldOperational", letter: "S", label: "Shield Operational" }],
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

/** `[]` for a season with no registered RP rules, so the table renders no dots rather than placeholders. */
export function bonusRpForSeason(season: number): readonly BonusRp[] {
  return BONUS_RP_BY_SEASON[season] ?? [];
}

/**
 * One bonus's state for one alliance in one match. `unknown` is NOT a
 * synonym for `missed`: an RP total alone cannot say which bonus was earned,
 * so an `unknown` dot draws muted and dashed and never asserts "this alliance
 * will not earn this bonus".
 */
export type BonusRpState = "earned" | "missed" | "unknown";

/**
 * A drawn dot's state. A predicted dot with a probability is `predicted` and
 * fills from the bottom to its odds; without one it is `unknown`, like an
 * actual dot with no flag.
 */
export type BonusDotState = BonusRpState | "predicted";

/** Interior height in CSS pixels: `.bonus-dot`'s 14px width minus its 1px border on each side in `styles/theme.css`, pinned by `bonusRp.test.ts`. */
export const BONUS_DOT_INNER_PX = 12;

/**
 * Whole pixels of a predicted dot's interior to fill. No threshold: the fill
 * carries the odds, clamped to `[1, innerPx - 1]` so a prediction never draws
 * empty or full (matching `predictionPercent`'s 1-99% policy). Whole pixels
 * keep neighbouring dots from blurring differently.
 *
 * `undefined` for an absent or non-finite probability, so the dot renders
 * `unknown` rather than an empty fill that would read as "almost certainly not".
 */
export function bonusDotFillPx(probability: number | undefined, innerPx: number): number | undefined {
  if (probability === undefined || !Number.isFinite(probability)) return undefined;
  return Math.min(innerPx - 1, Math.max(1, Math.round(probability * innerPx)));
}

/**
 * Maps published actual per-bonus flags to exactly `count` dot states,
 * positionally aligned to the season's bonus list. A `null` array (the fact
 * is not derivable), an undefined array, and missing trailing positions all
 * map to `unknown`, never to `missed`.
 */
export function bonusStatesFromFlags(flags: readonly boolean[] | null | undefined, count: number): BonusRpState[] {
  return Array.from({ length: count }, (_, index) => {
    if (flags === null || flags === undefined) return "unknown";
    const flag = flags[index];
    if (flag === undefined) return "unknown";
    return flag ? "earned" : "missed";
  });
}

/** The single source of a dot's `title` and `aria-label`, so the two never drift; a predicted label carries the exact percentage the whole-pixel fill only approximates. */
export function bonusDotLabel(label: string, state: BonusDotState, kind: "predicted" | "actual", probability?: number): string {
  if (state === "unknown") {
    return `${label}: no data published`;
  }
  if (kind === "predicted" && probability !== undefined) {
    const percent = predictionPercent(probability);
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
