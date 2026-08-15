/**
 * 2026 (REBUILT) RP rule module (D-09, D-12). Manual citation: 2026 FRC
 * Game Manual §6.5.3, Tables 6-4/6-5
 * (`firstfrc.blob.core.windows.net/frc2026/Manual/HTML/2026GameManual.htm`,
 * RESEARCH.md Code Examples). Verification method: corpus reconciliation
 * (`reconciliation.test.ts`) against TBA's own recorded
 * `energizedAchieved`/`superchargedAchieved`/`traversalAchieved` flags.
 *
 * Deliberately never read: `hubScore.totalPoints` (the roll-up point value
 * — numerically identical to `hubScore.totalCount` in sampled data but
 * semantically a point total, not the raw count the Energized/Supercharged
 * thresholds gate on; `breakdown/2026.ts` documents this exact discipline
 * for the score-component side), every other `hubScore.*Count`/`uncounted`
 * field, `totalAutoPoints`/`totalTeleopPoints` (roll-ups), `penalties`
 * (string, not numeric), the per-robot `autoTowerRobot1/2/3`/
 * `endGameTowerRobot1/2/3` fields (Pitfall Sigma1-2/Assumption A1).
 *
 * Threshold comparison semantics are `>=` throughout.
 *
 * Both Energized and Supercharged tiered thresholds were UNPINNED in
 * RESEARCH.md (Open Question 1) and are now corpus-converged: base-tier
 * (event_type 0/1/100) values were already 0-mismatch high confidence;
 * this session bracketed the District Championship (event_type 2/5) and
 * Championship (event_type 3/4) tiers with EXACT boundaries (the minimum
 * observed count among achieved=true matches equals one more than the
 * maximum observed count among achieved=false matches, at every tier) —
 * Energized: base 100, districtChampionship 240, championship 360.
 * Supercharged: base 360, districtChampionship 360 (does NOT bump — same
 * value as base, unlike Energized), championship 500. These converged
 * values should still be confirmed against the official manual's own
 * Table 6-5 (plan's human-check step).
 */
import { z } from "zod";
import type { RpParsedResult, RpRuleModule, RpThresholdVariable, RpTieredThreshold } from "./constants.js";
import { assertFiniteThresholdVariables, eventTierFor } from "./constants.js";

const HubScoreSchema = z.object({
  totalCount: z.number().finite(),
});

const SideSchema = z.object({
  autoTowerPoints: z.number().finite(),
  endGameTowerPoints: z.number().finite(),
  hubScore: HubScoreSchema,
  energizedAchieved: z.boolean(),
  superchargedAchieved: z.boolean(),
  traversalAchieved: z.boolean(),
});

const Rp2026Schema = z.object({
  red: SideSchema,
  blue: SideSchema,
});

/** Energized threshold on `hubScore.totalCount` (raw fuel count, never `.totalPoints`). Corpus-converged this session — see file header. */
const ENERGIZED_THRESHOLD: RpTieredThreshold = { base: 100, districtChampionship: 240, championship: 360 };

/** Supercharged threshold on `hubScore.totalCount`. District Championship does NOT bump (same as base) — corpus-converged this session. */
const SUPERCHARGED_THRESHOLD: RpTieredThreshold = { base: 360, districtChampionship: 360, championship: 500 };

/** Traversal threshold on `totalTowerPoints` (`autoTowerPoints + endGameTowerPoints`). Not tiered — 0/30382 mismatches, every event type (RESEARCH.md). */
const TRAVERSAL_THRESHOLD: RpTieredThreshold = { base: 50, districtChampionship: 50, championship: 50 };

const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [
  { name: "hubTotalCount", unit: "count" },
  { name: "totalTowerPoints", unit: "points" },
];

const BONUS_NAMES = ["energized", "supercharged", "traversal"] as const;

export const rp2026: RpRuleModule = {
  season: 2026,
  thresholdVariables: THRESHOLD_VARIABLES,
  bonusNames: BONUS_NAMES,
  maxRp: 3 + BONUS_NAMES.length,
  winRp: 3,
  tieRp: 1,

  parse(rawBreakdownJson: unknown, side: "red" | "blue", eventType: number): RpParsedResult {
    const parsed = Rp2026Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const tier = eventTierFor(eventType);

    const totalTowerPoints = own.autoTowerPoints + own.endGameTowerPoints;

    const thresholdVariables: Record<string, number> = Object.create(null) as Record<string, number>;
    thresholdVariables.hubTotalCount = own.hubScore.totalCount;
    thresholdVariables.totalTowerPoints = totalTowerPoints;
    assertFiniteThresholdVariables(thresholdVariables, `rp2026 ${side}`);

    const energized = own.hubScore.totalCount >= ENERGIZED_THRESHOLD[tier];
    const supercharged = own.hubScore.totalCount >= SUPERCHARGED_THRESHOLD[tier];
    const traversal = totalTowerPoints >= TRAVERSAL_THRESHOLD[tier];

    const bonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    bonusFlags.energized = energized;
    bonusFlags.supercharged = supercharged;
    bonusFlags.traversal = traversal;

    const recordedBonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    recordedBonusFlags.energized = own.energizedAchieved;
    recordedBonusFlags.supercharged = own.superchargedAchieved;
    recordedBonusFlags.traversal = own.traversalAchieved;

    const totalRp = Number(energized) + Number(supercharged) + Number(traversal);

    return {
      thresholdVariables,
      bonusFlags,
      recordedBonusFlags,
      winRp: 3,
      tieRp: 1,
      totalRp,
    };
  },
};
