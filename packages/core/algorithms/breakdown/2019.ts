/**
 * 2019 (Destination: Deep Space) component map.
 *
 * Never read: the per-robot fields (positional correspondence to the teams
 * array is unverified, same discipline every other component map applies).
 *
 * Validated at the parse boundary with Zod: every read field must be a
 * finite number, or `parse` throws rather than coercing a malformed field.
 *
 * Two roll-up hazards specific to 2019, both stated here because a naive
 * substitution would still reconcile: `autoPoints` is numerically identical
 * to `sandStormBonusPoints` in every observed row, so reading it instead
 * would still pass corpus reconciliation — only `reconciliation.test.ts`'s
 * source-text gate (asserting the roll-up names appear nowhere outside a
 * comment in this file) catches that substitution. `teleopPoints` equals
 * `hatchPanelPoints + cargoPoints + habClimbPoints`; reading it alongside
 * the three parts would double-count.
 *
 * A tiny number of elimination-match sides fail the roll-up identity check
 * — TBA's own clamp-at-zero behaviour on a large negative scorekeeper
 * `adjustPoints`, not a component-map defect. Both sit outside
 * `reconciliation.test.ts`'s sampling window today; recorded here so a
 * future sample-size increase meets a documented artifact instead of a mystery.
 */
import { z } from "zod";
import type { ParsedComponents, SeasonComponentMap } from "./constants.js";
import { ADJUST_COMPONENT, FOULS_COMMITTED_COMPONENT } from "./constants.js";

/**
 * Only the subset of TBA's `score_breakdown.{side}` object this map reads.
 * Unknown extra fields are ignored, not rejected — zod's default "strip"
 * mode drops them without erroring. Deliberately not `.passthrough()`.
 */
const SideBreakdownSchema = z.object({
  sandStormBonusPoints: z.number().finite(),
  hatchPanelPoints: z.number().finite(),
  cargoPoints: z.number().finite(),
  habClimbPoints: z.number().finite(),
  adjustPoints: z.number().finite(),
  /** Points this alliance RECEIVED from the opponent's fouls, not points it committed. */
  foulPoints: z.number().finite(),
});

const Breakdown2019Schema = z.object({
  red: SideBreakdownSchema,
  blue: SideBreakdownSchema,
});

/** canonical component name -> TBA `score_breakdown` key, for this alliance's own fields. */
const OWN_FIELD_COMPONENT_MAP: Readonly<Record<string, keyof z.infer<typeof SideBreakdownSchema>>> = {
  sandstormBonus: "sandStormBonusPoints",
  hatchPanel: "hatchPanelPoints",
  cargo: "cargoPoints",
  habClimb: "habClimbPoints",
  [ADJUST_COMPONENT]: "adjustPoints",
};

export const breakdown2019: SeasonComponentMap = {
  components: [...Object.keys(OWN_FIELD_COMPONENT_MAP), FOULS_COMMITTED_COMPONENT],

  // Raw count fields — not point values, never emitted as a component
  // (Pitfall Sigma1-1).
  diagnosticKeys: ["foulCount", "techFoulCount"],

  parse(rawBreakdownJson: unknown, side: "red" | "blue"): ParsedComponents {
    const parsed = Breakdown2019Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const opponent = side === "red" ? parsed.blue : parsed.red;

    // Object.create(null) + a fixed allowlist loop: raw TBA JSON is never
    // spread onto the result, so a `__proto__` key cannot reach Object.prototype.
    const result: ParsedComponents = Object.create(null) as ParsedComponents;
    for (const [canonical, tbaKey] of Object.entries(OWN_FIELD_COMPONENT_MAP)) {
      result[canonical] = own[tbaKey];
    }

    // Fouls committed by this alliance = points the OPPONENT received.
    result[FOULS_COMMITTED_COMPONENT] = opponent.foulPoints;

    return result;
  },
};
