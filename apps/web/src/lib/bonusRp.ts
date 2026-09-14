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
 * `packages/core/rankingPoints/{season}.ts`, not a derivation. The
 * alternative — importing `RP_RULE_MODULES` — would pull the whole
 * ten-season RP rule implementation (every season's zod schema and
 * threshold-parsing code) into the client bundle to read a handful of
 * strings. `bonusRp.test.ts` asserts this
 * table matches the core modules exactly, so the copy cannot drift silently;
 * that is the same "copy, pinned by a test" pattern `index.html`'s inlined
 * shell tokens already use against `theme.css`.
 */

import { predictionPercent } from "./predictionPercent.js";

export interface BonusRp {
  /** The core rule module's own `BONUS_NAMES` entry — the join key for per-bonus data once it is published. */
  readonly key: string;
  /** The single character drawn inside the dot. */
  readonly letter: string;
  /** Human name, used for the accessible label and the tooltip. */
  readonly label: string;
}

/**
 * 2016, 2017, 2018 and 2019 carry two bonus RP each; 2020 carries one
 * (Shield Energized is not modelled — see `rp/2020.ts` — so it has no entry
 * here); 2022–2024 carry two; 2025 and 2026 carry three. The dot count per
 * alliance is therefore season-dependent, never a fixed number.
 *
 * This table must stay in lockstep with core's `RP_RULE_MODULES` — keys AND
 * order — which `bonusRp.test.ts` asserts season by season. It is therefore
 * NOT part of "surfacing a season on the website" (season list, districts,
 * publishing); it is the mechanical other half of registering a season's RP
 * rule module, and belongs in the SAME change.
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
 * A drawn dot's state. Actual dots use `BonusRpState`. A predicted dot with a
 * probability is `predicted`: it fills from the bottom to its odds (F10, quick
 * task 260914-01x, sketch 012 variant C). A predicted dot with no probability
 * is `unknown`, exactly like an actual dot with no flag.
 */
export type BonusDotState = BonusRpState | "predicted";

/**
 * The dot's interior height in CSS pixels: `.bonus-dot`'s 14px width minus
 * its 1px border on each side, in `styles/theme.css`. `bonusRp.test.ts` reads
 * that CSS text and fails if the two drift apart.
 */
export const BONUS_DOT_INNER_PX = 12;

/**
 * How many whole pixels of a predicted dot's interior to fill for a
 * probability. There is no threshold: the fill carries the odds directly,
 * and the dot's title and aria-label carry the exact percentage.
 *
 * The height is `round(probability * innerPx)`, clamped to
 * `[1, innerPx - 1]`, so a prediction never draws as empty or full. That
 * matches `predictionPercent`'s 1-99% display policy. Whole pixels keep
 * neighbouring dots from blurring differently.
 *
 * Returns `undefined` for an absent or non-finite probability. The dot then
 * renders `unknown`, never an empty fill, because an empty fill would read as
 * "almost certainly not".
 */
export function bonusDotFillPx(probability: number | undefined, innerPx: number): number | undefined {
  if (probability === undefined || !Number.isFinite(probability)) return undefined;
  return Math.min(innerPx - 1, Math.max(1, Math.round(probability * innerPx)));
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
 * array maps its own trailing positions to `unknown`: a length mismatch is
 * missing data, never a claim that the alliance did not earn the rest.
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
 *      whole-number percentage, the exact figure the dot's whole-pixel fill
 *      can only approximate.
 *   3. `actual` kind, `earned` state — "earned".
 *   4. `actual` kind, `missed` state — "not earned".
 *   5. `predicted` kind with no `probability` (a states-only caller) — the
 *      word "predicted" plus the state word.
 */
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
