/**
 * 2022 (Rapid React) component map. All alliance-level, never per-robot:
 * the positional correspondence between `RobotN` fields and the teams array
 * is unverified, so no per-robot field is read here or by any component map.
 *
 * Validated at the parse boundary with Zod: every read field must be a
 * finite number, or `parse` throws rather than coercing a malformed field.
 *
 * `autoPoints` equals `autoTaxiPoints + autoCargoPoints` and `teleopPoints`
 * equals `teleopCargoPoints + endgamePoints` — neither roll-up key is read,
 * since emitting both the parts and the sum would double-count.
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
  autoTaxiPoints: z.number().finite(),
  autoCargoPoints: z.number().finite(),
  teleopCargoPoints: z.number().finite(),
  endgamePoints: z.number().finite(),
  adjustPoints: z.number().finite(),
  /** Points this alliance RECEIVED from the opponent's fouls, not points it committed. */
  foulPoints: z.number().finite(),
});

const Breakdown2022Schema = z.object({
  red: SideBreakdownSchema,
  blue: SideBreakdownSchema,
});

/** canonical component name -> TBA `score_breakdown` key, for this alliance's own fields. */
const OWN_FIELD_COMPONENT_MAP: Readonly<Record<string, keyof z.infer<typeof SideBreakdownSchema>>> = {
  autoTaxi: "autoTaxiPoints",
  autoCargo: "autoCargoPoints",
  teleopCargo: "teleopCargoPoints",
  endgame: "endgamePoints",
  [ADJUST_COMPONENT]: "adjustPoints",
};

export const breakdown2022: SeasonComponentMap = {
  components: [...Object.keys(OWN_FIELD_COMPONENT_MAP), FOULS_COMMITTED_COMPONENT],

  // Raw count fields — not point values, never emitted as a component.
  diagnosticKeys: ["foulCount", "techFoulCount"],

  parse(rawBreakdownJson: unknown, side: "red" | "blue"): ParsedComponents {
    const parsed = Breakdown2022Schema.parse(rawBreakdownJson);
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
