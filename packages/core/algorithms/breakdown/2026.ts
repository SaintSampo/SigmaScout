/**
 * 2026 component map (D-02). Structurally different from every other
 * season and the reason D-02 requires per-season maps rather than a
 * generic parser (Pitfall Sigma1-1): the foul fields are renamed entirely
 * (`majorFoulCount`/`minorFoulCount` replace `foulCount`/`techFoulCount`,
 * which are ABSENT from every sampled 2026 breakdown — this module never
 * reads `techFoulCount`), and the bulk of scoring lives inside a nested
 * `hubScore` object rather than flat top-level `*Points` fields.
 *
 * Field inventory verified directly against `data/corpus.sqlite` this
 * session (2026-08-13, live query, including a worked example:
 * `2026alhu_f1m1` red — autoTower 0 + endGameTower 0 + hubAuto 100 +
 * hubTransition 53 + hubShift1 0 + hubShift2 104 + hubShift3 0 +
 * hubShift4 56 + hubEndgame 141 + adjust 0 = 454; plus foulsCommitted
 * (blue's parse of this match's opponent field, i.e. red's own
 * `foulPoints` = 15) = 469 = red.totalPoints). All alliance-level — the
 * per-robot `autoTowerRobot1/2/3`/`endGameTowerRobot1/2/3` fields exist in
 * the raw JSON but are deliberately never read (RESEARCH.md Pitfall
 * Sigma1-2 / Assumption A1).
 *
 * Roll-up avoidance: `totalAutoPoints`, `totalTeleopPoints`, and
 * `totalTowerPoints` are top-level roll-ups — never read. Inside
 * `hubScore`, `teleopPoints` is itself a roll-up of
 * `transitionPoints + shift1..4Points + endgamePoints` and must NOT be
 * emitted alongside its parts. `hubScore.totalCount`, every `hubScore.*Count`
 * field, and `hubScore.uncounted` are counts, not points, and are never
 * read. `penalties` is a string field, not numeric, and is never read.
 */
import { z } from "zod";
import type { ParsedComponents, SeasonComponentMap } from "./constants.js";
import { ADJUST_COMPONENT, FOULS_COMMITTED_COMPONENT } from "./constants.js";

/**
 * Only the subset of TBA's `score_breakdown.{side}` object this map reads,
 * including the nested `hubScore` sub-object's point fields. Unknown extra
 * fields (`energizedAchieved`, `superchargedAchieved`, `traversalAchieved`,
 * `penalties`, `g206Penalty`, `rp`, `hubScore.totalPoints`, every
 * `hubScore.*Count`/`uncounted`, the `RobotN` per-robot fields, etc.) are
 * ignored, not rejected — zod's default "strip" mode for `.object()` drops
 * them without erroring. Deliberately NOT `.passthrough()`/`.loose()`, for
 * the same typing reason `2024.ts` documents.
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
  adjustPoints: z.number().finite(),
  /**
   * Points this alliance RECEIVED from the opponent's fouls — NOT points
   * this alliance committed. See `foulsCommitted`'s comment below.
   */
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

  // Renamed foul count fields (Pitfall Sigma1-1) — not point values, never
  // emitted as a component. Recorded for plan 02-06's identifiability
  // report. `foulCount`/`techFoulCount` do not exist in 2026's schema at
  // all; do not add them here.
  diagnosticKeys: ["majorFoulCount", "minorFoulCount"],

  parse(rawBreakdownJson: unknown, side: "red" | "blue"): ParsedComponents {
    const parsed = Breakdown2026Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const opponent = side === "red" ? parsed.blue : parsed.red;

    // Object.create(null) + a fixed allowlist loop (T-02-04): third-party
    // TBA JSON is never spread onto the result, so a `__proto__` key in the
    // raw payload cannot reach Object.prototype via this map.
    const result: ParsedComponents = Object.create(null) as ParsedComponents;
    for (const [canonical, extract] of Object.entries(OWN_FIELD_COMPONENT_MAP)) {
      result[canonical] = extract(own);
    }

    // Same D-04 derivation every other season module uses: the opposing
    // alliance's own `foulPoints` (points IT received) is exactly what THIS
    // alliance's fouls cost the opponent. The rename to
    // majorFoulCount/minorFoulCount does not touch this derivation — it
    // never read foulCount/techFoulCount in the first place.
    result[FOULS_COMMITTED_COMPONENT] = opponent.foulPoints;

    return result;
  },
};
