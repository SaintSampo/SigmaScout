/**
 * 2023 (Charged Up) component map (D-02). Field inventory verified
 * directly against `data/corpus.sqlite` this session (2026-08-13, live
 * query): every key below was present in a real ingested 2023
 * `score_breakdown.red`/`.blue` object. All alliance-level — the per-robot
 * `autoChargeStationRobot1/2/3`, `endGameChargeStationRobot1/2/3`, and
 * `mobilityRobot1/2/3` fields exist in the raw JSON but are deliberately
 * never read (RESEARCH.md Pitfall Sigma1-2 / Assumption A1).
 *
 * Roll-up avoidance: `totalChargeStationPoints` is the sum of
 * `autoChargeStationPoints` and `endGameChargeStationPoints` — reading it
 * alongside its two parts would double-count and break the reconciliation
 * invariant. `autoCommunity`/`teleopCommunity` (per-node placement grids)
 * and `links`/`linkPoints`'s underlying `links` array are structural detail
 * objects/arrays, not point values, and are never read.
 */
import { z } from "zod";
import type { ParsedComponents, SeasonComponentMap } from "./constants.js";
import { ADJUST_COMPONENT, FOULS_COMMITTED_COMPONENT } from "./constants.js";

/**
 * Only the subset of TBA's `score_breakdown.{side}` object this map reads.
 * Unknown extra fields (`autoCommunity`, `teleopCommunity`, `links`,
 * `coopGamePieceCount`, the `RobotN` per-robot fields, etc.) are ignored,
 * not rejected — zod's default "strip" mode for `.object()` drops them
 * without erroring. Deliberately NOT `.passthrough()`/`.loose()`, for the
 * same typing reason `2024.ts` documents.
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
  /**
   * Points this alliance RECEIVED from the opponent's fouls — NOT points
   * this alliance committed. See `foulsCommitted`'s comment below.
   */
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

  // Raw count fields — not point values, never emitted as a component
  // (Pitfall Sigma1-1). Recorded for plan 02-06's identifiability report.
  diagnosticKeys: ["foulCount", "techFoulCount"],

  parse(rawBreakdownJson: unknown, side: "red" | "blue"): ParsedComponents {
    const parsed = Breakdown2023Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const opponent = side === "red" ? parsed.blue : parsed.red;

    // Object.create(null) + a fixed allowlist loop (T-02-04): third-party
    // TBA JSON is never spread onto the result, so a `__proto__` key in the
    // raw payload cannot reach Object.prototype via this map.
    const result: ParsedComponents = Object.create(null) as ParsedComponents;
    for (const [canonical, tbaKey] of Object.entries(OWN_FIELD_COMPONENT_MAP)) {
      result[canonical] = own[tbaKey];
    }

    // Same D-04 derivation 2022.ts/2024.ts use: the opposing alliance's own
    // `foulPoints` (points IT received) is exactly what THIS alliance's
    // fouls cost the opponent — season-agnostic, no per-season foul
    // point-value table needed.
    result[FOULS_COMMITTED_COMPONENT] = opponent.foulPoints;

    return result;
  },
};
