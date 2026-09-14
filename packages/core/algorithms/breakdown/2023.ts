/**
 * 2023 (Charged Up) component map. All alliance-level — the per-robot
 * fields exist in the raw JSON but are deliberately never read (positional
 * correspondence to the teams array is unverified).
 *
 * `totalChargeStationPoints` is the sum of `autoChargeStationPoints` and
 * `endGameChargeStationPoints` — reading it alongside its two parts would
 * double-count. `autoCommunity`/`teleopCommunity` (per-node placement
 * grids) and the `links` array are structural detail, not point values, and
 * are never read.
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
  autoMobilityPoints: z.number().finite(),
  autoGamePiecePoints: z.number().finite(),
  autoChargeStationPoints: z.number().finite(),
  teleopGamePiecePoints: z.number().finite(),
  linkPoints: z.number().finite(),
  endGameChargeStationPoints: z.number().finite(),
  endGameParkPoints: z.number().finite(),
  adjustPoints: z.number().finite(),
  /** Points this alliance RECEIVED from the opponent's fouls, not points it committed. */
  foulPoints: z.number().finite(),
});

const Breakdown2023Schema = z.object({
  red: SideBreakdownSchema,
  blue: SideBreakdownSchema,
});

/** canonical component name -> TBA `score_breakdown` key, for this alliance's own fields. */
const OWN_FIELD_COMPONENT_MAP: Readonly<Record<string, keyof z.infer<typeof SideBreakdownSchema>>> = {
  autoMobility: "autoMobilityPoints",
  autoGamePiece: "autoGamePiecePoints",
  autoChargeStation: "autoChargeStationPoints",
  teleopGamePiece: "teleopGamePiecePoints",
  link: "linkPoints",
  endGameChargeStation: "endGameChargeStationPoints",
  endGamePark: "endGameParkPoints",
  [ADJUST_COMPONENT]: "adjustPoints",
};

export const breakdown2023: SeasonComponentMap = {
  components: [...Object.keys(OWN_FIELD_COMPONENT_MAP), FOULS_COMMITTED_COMPONENT],

  // Raw count fields — not point values, never emitted as a component.
  diagnosticKeys: ["foulCount", "techFoulCount"],

  parse(rawBreakdownJson: unknown, side: "red" | "blue"): ParsedComponents {
    const parsed = Breakdown2023Schema.parse(rawBreakdownJson);
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
