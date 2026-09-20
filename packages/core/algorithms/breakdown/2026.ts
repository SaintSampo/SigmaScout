/**
 * 2026 component map. Structurally different from every other season and
 * the reason each season needs its own map rather than a generic parser:
 * the foul fields are renamed entirely (`majorFoulCount`/`minorFoulCount`
 * replace `foulCount`/`techFoulCount`, which are absent from every 2026
 * breakdown), and the bulk of scoring lives inside a nested `hubScore`
 * object rather than flat top-level `*Points` fields.
 *
 * All alliance-level — the per-robot fields exist in the raw JSON but are
 * deliberately never read (positional correspondence to the teams array is
 * unverified).
 *
 * `totalAutoPoints`, `totalTeleopPoints`, and `totalTowerPoints` are
 * top-level roll-ups — never read. Inside `hubScore`, `teleopPoints` is
 * itself a roll-up of `transitionPoints + shift1..4Points + endgamePoints`
 * and must not be emitted alongside its parts. `hubScore.totalCount`, every
 * `hubScore.*Count` field, and `hubScore.uncounted` are counts, not points,
 * and are never read. `penalties` is a string field, not numeric, and is
 * never read.
 */
import { z } from "zod";
import type { ParsedComponents, SeasonComponentMap } from "./constants.js";
import { ADJUST_COMPONENT, ADJUST_POINTS_SCHEMA, FOULS_COMMITTED_COMPONENT } from "./constants.js";

/**
 * Only the subset of TBA's `score_breakdown.{side}` object this map reads,
 * including the nested `hubScore` sub-object's point fields. Unknown extra
 * fields are ignored, not rejected — zod's default "strip" mode drops them
 * without erroring. Deliberately not `.passthrough()`.
 */
const HubScoreSchema = z.object({
  transitionPoints: z.number().finite(),
  shift1Points: z.number().finite(),
  shift2Points: z.number().finite(),
  shift3Points: z.number().finite(),
  shift4Points: z.number().finite(),
  endgamePoints: z.number().finite(),
  autoPoints: z.number().finite(),
});

const SideBreakdownSchema = z.object({
  autoTowerPoints: z.number().finite(),
  endGameTowerPoints: z.number().finite(),
  hubScore: HubScoreSchema,
  adjustPoints: ADJUST_POINTS_SCHEMA,
  /** Points this alliance RECEIVED from the opponent's fouls, not points it committed. */
  foulPoints: z.number().finite(),
});

const Breakdown2026Schema = z.object({
  red: SideBreakdownSchema,
  blue: SideBreakdownSchema,
});

type Side2026 = z.infer<typeof SideBreakdownSchema>;

/** canonical component name -> extractor over one alliance's validated 2026 breakdown. */
const OWN_FIELD_COMPONENT_MAP: Readonly<Record<string, (side: Side2026) => number>> = {
  autoTower: (side) => side.autoTowerPoints,
  endGameTower: (side) => side.endGameTowerPoints,
  hubAuto: (side) => side.hubScore.autoPoints,
  hubTransition: (side) => side.hubScore.transitionPoints,
  hubShift1: (side) => side.hubScore.shift1Points,
  hubShift2: (side) => side.hubScore.shift2Points,
  hubShift3: (side) => side.hubScore.shift3Points,
  hubShift4: (side) => side.hubScore.shift4Points,
  hubEndgame: (side) => side.hubScore.endgamePoints,
  [ADJUST_COMPONENT]: (side) => side.adjustPoints,
};

export const breakdown2026: SeasonComponentMap = {
  components: [...Object.keys(OWN_FIELD_COMPONENT_MAP), FOULS_COMMITTED_COMPONENT],

  // Renamed foul count fields — not point values, never emitted as a
  // component. `foulCount`/`techFoulCount` do not exist in 2026's schema at
  // all; do not add them here.
  diagnosticKeys: ["majorFoulCount", "minorFoulCount"],

  parse(rawBreakdownJson: unknown, side: "red" | "blue"): ParsedComponents {
    const parsed = Breakdown2026Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const opponent = side === "red" ? parsed.blue : parsed.red;

    // Object.create(null) + a fixed allowlist loop: raw TBA JSON is never
    // spread onto the result, so a `__proto__` key cannot reach Object.prototype.
    const result: ParsedComponents = Object.create(null) as ParsedComponents;
    for (const [canonical, extract] of Object.entries(OWN_FIELD_COMPONENT_MAP)) {
      result[canonical] = extract(own);
    }

    // Fouls committed by this alliance = points the OPPONENT received. The
    // rename to majorFoulCount/minorFoulCount does not touch this
    // derivation — it never read foulCount/techFoulCount in the first place.
    result[FOULS_COMMITTED_COMPONENT] = opponent.foulPoints;

    return result;
  },
};
