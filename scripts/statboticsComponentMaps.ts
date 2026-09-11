/**
 * Statbotics' SCORE-READ component map for 2024 — sub-gap 1a of mechanism 1
 * (`docs/models/epa-statbotics-gap.md`), built as a MEASURED ARM and nothing
 * else.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 * This module exists to be driven through `scripts/measureEpaDeviations.ts`'s
 * `componentMapArm` (the seam added by commit `b62c3655`), which forwards an
 * override map to `epa.update` for a match's own season and to
 * `epa.carrySeason` for the INCOMING season. **It is NOT a shipped default and
 * must never become one without its own decision.** It is deliberately parked
 * in `scripts/` rather than `packages/core/algorithms/breakdown/` so it cannot
 * be mistaken for a season map: it is NOT registered in
 * `SEASON_COMPONENT_MAPS`, `breakdown/2024.ts` is unchanged, `ARM_IDS` is
 * unchanged, and `epa.version` is unchanged. Quick task 260911-pon, decision 2.
 *
 * ---------------------------------------------------------------------------
 * WHY TWO COMPONENTS, AND WHY THIS IS STATBOTICS' ACTUAL TARGET
 * ---------------------------------------------------------------------------
 * Statbotics rates an 18-slot vector but its 2024 branch of
 * `get_score_from_breakdown` READS exactly one entry: `no_foul_points`
 * (`docs/models/statbotics-breakdown-reference.md` section 18). In SigmaScout
 * the rated set IS the score-read set — `epa.ts:predictCore` sums every rated
 * component except the alliance's own `foulsCommitted` into the offensive
 * total — so reproducing that one-entry read means rating exactly one
 * offensive quantity.
 *
 * That quantity is obtained by SUMMING the shipped map's `auto`, `teleop` and
 * `endgame` outputs. It is not a re-derivation: reference section 2's shared
 * cleaner ENFORCES
 *
 *     no_foul_points == auto_points + teleop_points + endgame_points
 *
 * and prints `ERROR` upstream when it fails, so this sum IS the quantity
 * rather than a plausible neighbour of it. `statboticsComponentMaps.test.ts`
 * checks it against real 2024 corpus payloads both ways — against the shipped
 * map's three phase totals, and against `totalPoints - foulPoints -
 * adjustPoints` off the same raw object.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS WRAPS THE SHIPPED PARSE INSTEAD OF RE-DECLARING THE FIELDS
 * ---------------------------------------------------------------------------
 * `breakdown2024.parse` is the proven boundary: a Zod schema that throws
 * rather than coercing an absent or malformed TBA field to 0 (T-02-01), plus
 * the `Object.create(null)` allowlist loop that keeps a `__proto__` key in
 * third-party JSON off `Object.prototype` (T-02-04). A second field list or a
 * second Zod schema here would be a copy free to drift from the one that is
 * actually tested, so this module declares neither. It calls the shipped parse
 * and re-groups its OUTPUT.
 *
 * It also does not MUTATE `breakdown2024`. `experiments/260910-4x0/
 * granularity.ts` monkey-patched that shipped object to build its arms; the
 * `componentMapArm` seam exists precisely to retire that pattern, and
 * `statboticsComponentMaps.test.ts` carries an explicit guard asserting
 * `breakdown2024.components` is untouched after this map has been used.
 *
 * ---------------------------------------------------------------------------
 * `adjust` IS DROPPED, NOT RELOCATED
 * ---------------------------------------------------------------------------
 * The shipped 2024 map emits an `adjust` component from TBA's `adjustPoints`.
 * This map emits no such component and does not fold it into the no-foul
 * total, because reference section 2's shared cleaner puts `adjustPoints` on
 * the FOUL side (`no_foul_points = score - foulPoints - adjustPoints`), and
 * since quick task 260911-l2k the foul side is a season scalar applied AFTER
 * the win probability rather than a per-team rated component.
 *
 * This is expected to be NUMERICALLY INERT: `epa.ts:applyComponentUpdate`
 * pins `updatedComponents[ADJUST_COMPONENT] = 0` for every team, every match
 * (D-5), so the shipped map's `adjust` component contributes exactly 0 to
 * every predicted alliance total already. Any difference this arm measures
 * therefore comes from the GRANULARITY COLLAPSE — three separately-EWMA'd
 * phase totals becoming one — and not from `adjust`.
 */
import { breakdown2024 } from "../packages/core/algorithms/breakdown/2024.js";
import {
  FOULS_COMMITTED_COMPONENT,
  type ParsedComponents,
  type SeasonComponentMap,
} from "../packages/core/algorithms/breakdown/constants.js";

/**
 * The single offensive component this map rates — Statbotics'
 * `no_foul_points`, the one entry its 2024 `get_score_from_breakdown` branch
 * reads.
 */
export const NO_FOUL_POINTS_COMPONENT = "noFoulPoints";

/**
 * The shipped 2024 map's offensive component names, summed into
 * `noFoulPoints`. Named here rather than inlined so the sum is auditable
 * against `breakdown/2024.ts`'s `OWN_FIELD_COMPONENT_MAP` at a glance.
 *
 * `adjust` is absent on purpose — see this module's header.
 */
const SHIPPED_PHASE_COMPONENTS = ["auto", "teleop", "endgame"] as const;

/**
 * Statbotics' 2024 score-read map: one rated no-foul total plus
 * `foulsCommitted` carried through from the shipped map unchanged.
 *
 * Not registered anywhere. Hand it to `componentMapArm`, never to
 * `SEASON_COMPONENT_MAPS`.
 */
export const statboticsScoreRead2024: SeasonComponentMap = {
  components: [NO_FOUL_POINTS_COMPONENT, FOULS_COMMITTED_COMPONENT],

  parse(rawBreakdownJson: unknown, side: "red" | "blue"): ParsedComponents {
    // The shipped, Zod-validated parse. Every field gate, every finite-value
    // check and the prototype-safe result object all come from there.
    const shipped = breakdown2024.parse(rawBreakdownJson, side);

    const result: ParsedComponents = Object.create(null) as ParsedComponents;
    let noFoul = 0;
    for (const phase of SHIPPED_PHASE_COMPONENTS) {
      const value = shipped[phase];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        // Unreachable through the shipped parse, which throws first. Kept as a
        // loud refusal rather than a silent `?? 0`, because a missing phase
        // here would understate the no-foul total by a plausible-looking
        // amount and nothing downstream would flag it.
        throw new Error(
          `statboticsScoreRead2024: shipped breakdown2024 emitted no finite "${phase}" component for ${side}`
        );
      }
      noFoul += value;
    }
    result[NO_FOUL_POINTS_COMPONENT] = noFoul;
    result[FOULS_COMMITTED_COMPONENT] = shipped[FOULS_COMMITTED_COMPONENT]!;
    return result;
  },
};

/**
 * The `mapForSeason` callback shape `componentMapArm` expects: this arm is
 * LIVE for 2024 and INERT for every other season, which is what lets one arm
 * answer a per-season question without disturbing its neighbours.
 *
 * Returning `undefined` makes that season run the shipped map, byte for byte.
 */
export function statboticsScoreReadMapForSeason(season: number): SeasonComponentMap | undefined {
  return season === 2024 ? statboticsScoreRead2024 : undefined;
}
