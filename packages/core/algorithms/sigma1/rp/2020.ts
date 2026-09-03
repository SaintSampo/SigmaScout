/**
 * 2020 (Infinite Recharge) RP rule module (D-09, D-12). Threshold DERIVED
 * from data, not cited from a manual — see below for why. Verification
 * method: corpus reconciliation (`reconciliation.test.ts`) against TBA's own
 * recorded `shieldOperationalRankingPoint` flag, full population (n=7,640
 * alliance-sides, 2026-09-03 measurement). Field inventory:
 * `docs/data/tba-field-recon-2019-2020.md`. Threshold sweep and rate tables:
 * `docs/data/tba-rp-thresholds-2019-2020.md`, `docs/data/tba-rp-rates-2019-2020.md`.
 *
 * Shield Operational Bonus: `endgamePoints >= 65`. **100.00% agreement,
 * 0 mismatches / 7,640 sides** — this is a MEASUREMENT.
 *
 * **Tier caveat — must be read before trusting the uniform 65/65/65
 * triple.** 2020 was cancelled by COVID-19 before any District
 * Championship or Championship event was played: the corpus's only
 * `event_type`s are 0 (Regional), 1 (District) and 100 (Preseason), all
 * mapping to `base`. The `districtChampionship`/`championship` entries
 * below carry 65 as an ASSUMPTION extrapolated from the base-tier
 * measurement, never independently confirmed — there is no data for those
 * tiers and there never will be for this season. Say so explicitly rather
 * than letting the uniform triple imply verification it does not have.
 *
 * **Why this rule is derived from data rather than cited from a manual
 * reading of the control panel mechanic:** the intuitive rule — key the
 * bonus on the control-panel stage-2 flag (`stage2Activated`) — scores only
 * **85.21%**, which is BELOW the **85.35%** obtained by always guessing
 * `false`. `stage2Activated` is true only ~0.5% of sampled sides while the
 * real RP fires 14.7% of the time: the two are only weakly related. Shield
 * Operational is an ENDGAME bonus (robots hanging on the generator switch),
 * not a control-panel bonus — the endgame point total is the correct signal.
 *
 * Deliberately never read: `autoPoints`/`teleopPoints` (roll-ups),
 * `endgameRobot1/2/3`/`initLineRobot1/2/3` (per-robot fields — Pitfall
 * Sigma1-2/Assumption A1, same discipline `breakdown/2020.ts` already
 * applies), `autoCellsBottom/Inner/Outer`/`teleopCellsBottom/Inner/Outer`
 * (per-goal breakdown detail, not RP-relevant), `tba_numRobotsHanging`/
 * `endgameRungIsLevel` (informational endgame detail, not part of the
 * measured rule).
 *
 * Threshold comparison semantics are `>=` throughout.
 *
 * Per D RP-4: Shield Energized (`shieldEnergizedRankingPoint`) is NOT
 * modelled. It fired 0 times in 7,640 sides this corpus — see
 * `bonusNames`/`diagnosticKeys` below for how it is deliberately excluded
 * rather than folded in as an always-false bonus.
 */
import { z } from "zod";
import type { RpParsedResult, RpRuleModule, RpThresholdPrediction, RpThresholdVariable, RpTieredThreshold } from "./constants.js";
import { assertFiniteThresholdVariables, eventTierFor } from "./constants.js";

/**
 * Only the subset of TBA's `score_breakdown.{side}` object this module
 * reads. Unknown extra fields (`autoPoints`, `teleopPoints`, `totalPoints`,
 * per-cell/per-robot detail fields, `stage1/2/3Activated`,
 * `shieldEnergizedRankingPoint`, `tba_shieldEnergizedRankingPointFromFoul`,
 * `rp`, etc.) are ignored, not rejected — zod's default "strip" mode drops
 * them without erroring. Deliberately NOT `.passthrough()`/`.loose()`,
 * matching `breakdown/2020.ts`'s discipline.
 */
const SideSchema = z.object({
  endgamePoints: z.number().finite(),
  shieldOperationalRankingPoint: z.boolean(),
});

const Rp2020Schema = z.object({
  red: SideSchema,
  blue: SideSchema,
});

/**
 * Shield Operational Bonus threshold: `endgamePoints >= 65`. Base tier is a
 * MEASUREMENT (0 mismatches / 7,640 sides); districtChampionship and
 * championship are an ASSUMPTION — see file header's tier caveat. Uniform
 * across tiers because there is no data suggesting otherwise, not because
 * uniformity was confirmed at the higher tiers.
 */
const SHIELD_OPERATIONAL_THRESHOLD: RpTieredThreshold = { base: 65, districtChampionship: 65, championship: 65 };

const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [{ name: "endgamePoints", unit: "points" }];

/**
 * Shield Energized is deliberately ABSENT (D RP-4): it fired 0/7,640 times
 * in this corpus, so there is no positive example to derive or verify a
 * rule from. Keeping it out of `bonusNames` means it also gets no threshold
 * variable and no entry in `recordedBonusFlags` below — a recorded flag with
 * no recomputed twin would break the paired shape
 * `reconciliation.test.ts` relies on. `maxRp` therefore derives to
 * `2 + 1 = 3`, never a hand-written literal.
 */
const BONUS_NAMES = ["shieldOperational"] as const;

export const rp2020: RpRuleModule = {
  season: 2020,
  thresholdVariables: THRESHOLD_VARIABLES,
  bonusNames: BONUS_NAMES,
  maxRp: 2 + BONUS_NAMES.length,
  winRp: 2,
  tieRp: 1,

  // Diagnostic-only: `shieldEnergizedRankingPoint` is TBA's recorded flag
  // for the un-modelled bonus above (always false in this corpus's 7,640
  // sides); `stage2Activated`/`stage3Activated` are the control-panel
  // stage-activation fields whose weak correlation with the real RP is the
  // reason this module derives its rule from `endgamePoints` instead (see
  // file header). None of the three feeds `bonusFlags` or
  // `thresholdVariables`.
  diagnosticKeys: ["shieldEnergizedRankingPoint", "stage2Activated", "stage3Activated"],

  parse(rawBreakdownJson: unknown, side: "red" | "blue", eventType: number): RpParsedResult {
    const parsed = Rp2020Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const tier = eventTierFor(eventType);

    const thresholdVariables: Record<string, number> = Object.create(null) as Record<string, number>;
    thresholdVariables.endgamePoints = own.endgamePoints;
    assertFiniteThresholdVariables(thresholdVariables, `rp2020 ${side}`);

    const shieldOperational = own.endgamePoints >= SHIELD_OPERATIONAL_THRESHOLD[tier];

    const bonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    bonusFlags.shieldOperational = shieldOperational;

    const recordedBonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    recordedBonusFlags.shieldOperational = own.shieldOperationalRankingPoint;

    const totalRp = Number(shieldOperational);

    return {
      thresholdVariables,
      bonusFlags,
      recordedBonusFlags,
      winRp: 2,
      tieRp: 1,
      totalRp,
    };
  },

  /** Fully computable from the one tracked threshold variable alone — no untracked alliance-level gate (see `RpRuleModule.predictThresholds`'s doc comment for the general contract). */
  predictThresholds(values: Readonly<Record<string, number>>, eventType: number): RpThresholdPrediction {
    const tier = eventTierFor(eventType);
    const endgamePoints = values.endgamePoints ?? 0;

    const shieldOperational = endgamePoints >= SHIELD_OPERATIONAL_THRESHOLD[tier];

    const bonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    bonusFlags.shieldOperational = shieldOperational;

    return { bonusFlags, totalRp: Number(shieldOperational) };
  },
};
