/**
 * 2020 (Infinite Recharge) component map. Field inventory verified against
 * `data/corpus.sqlite` this session (2026-09-03) via
 * `docs/data/tba-field-recon-2019-2020.md`'s live-query field recon
 * (34 distinct `score_breakdown` keys sampled from `2020isde1`) and
 * corpus-wide roll-up-identity reconciliation (0 mismatches / 4,663 sides,
 * the full non-offseason breakdown-bearing population): 2020's season was
 * cancelled by COVID-19 before any District Championship or Championship
 * was played, so the corpus carries `base` tier only (event_type 0, 1, 100).
 *
 * Never read (Pitfall Sigma1-2 / Assumption A1): `endgameRobot1/2/3`,
 * `initLineRobot1/2/3` — per-robot fields, positional correspondence to
 * `red_teams`/`blue_teams` array order is unverified, same discipline every
 * other component map in this package applies.
 *
 * Validated at the parse boundary with Zod (T-02-01, ASVS V5): every read
 * field must be a finite number, or `parse` throws rather than coercing an
 * absent/malformed field to 0.
 *
 * Roll-up avoidance (BD-1): `autoPoints` equals
 * `autoInitLinePoints + autoCellPoints` and `teleopPoints` equals
 * `teleopCellPoints + controlPanelPoints + endgamePoints` — neither roll-up
 * key is read, since emitting both the parts and the sum would double-count
 * and break the reconciliation invariant (reconciliation.test.ts). Verified
 * against the corpus rather than trusted: 0 mismatches / 4,663 sides.
 */
import { z } from "zod";
import type { ParsedComponents, SeasonComponentMap } from "./constants.js";
import { ADJUST_COMPONENT, FOULS_COMMITTED_COMPONENT } from "./constants.js";

/**
 * Only the subset of TBA's `score_breakdown.{side}` object this map reads.
 * Unknown extra fields (`autoPoints`, `teleopPoints`, `totalPoints`,
 * `autoCellsBottom/Inner/Outer`, `teleopCellsBottom/Inner/Outer`,
 * `endgameRobot1/2/3`, `initLineRobot1/2/3`, `stage1/2/3Activated`,
 * `shieldOperationalRankingPoint`, `shieldEnergizedRankingPoint`,
 * `tba_numRobotsHanging`, `endgameRungIsLevel`, `rp`, etc.) are ignored, not
 * rejected — zod's default "strip" mode drops them without erroring.
 * Deliberately NOT `.passthrough()`/`.loose()`, matching every other season
 * map's discipline.
 */
const SideBreakdownSchema = z.object({
  autoInitLinePoints: z.number().finite(),
  autoCellPoints: z.number().finite(),
  teleopCellPoints: z.number().finite(),
  controlPanelPoints: z.number().finite(),
  endgamePoints: z.number().finite(),
  adjustPoints: z.number().finite(),
  /**
   * Points this alliance RECEIVED from the opponent's fouls — NOT points
   * this alliance committed. See `foulsCommitted`'s comment below.
   */
  foulPoints: z.number().finite(),
});

const Breakdown2020Schema = z.object({
  red: SideBreakdownSchema,
  blue: SideBreakdownSchema,
});

/** canonical component name -> TBA `score_breakdown` key, for this alliance's own fields. */
const OWN_FIELD_COMPONENT_MAP: Readonly<Record<string, keyof z.infer<typeof SideBreakdownSchema>>> = {
  autoInitLine: "autoInitLinePoints",
  autoCell: "autoCellPoints",
  teleopCell: "teleopCellPoints",
  controlPanel: "controlPanelPoints",
  endgame: "endgamePoints",
  [ADJUST_COMPONENT]: "adjustPoints",
};

export const breakdown2020: SeasonComponentMap = {
  components: [...Object.keys(OWN_FIELD_COMPONENT_MAP), FOULS_COMMITTED_COMPONENT],

  // Raw count fields — not point values, never emitted as a component
  // (Pitfall Sigma1-1).
  diagnosticKeys: ["foulCount", "techFoulCount"],

  parse(rawBreakdownJson: unknown, side: "red" | "blue"): ParsedComponents {
    const parsed = Breakdown2020Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const opponent = side === "red" ? parsed.blue : parsed.red;

    // Object.create(null) + a fixed allowlist loop (T-02-04): third-party
    // TBA JSON is never spread onto the result, so a `__proto__` key in the
    // raw payload cannot reach Object.prototype via this map.
    const result: ParsedComponents = Object.create(null) as ParsedComponents;
    for (const [canonical, tbaKey] of Object.entries(OWN_FIELD_COMPONENT_MAP)) {
      result[canonical] = own[tbaKey];
    }

    // Same D-04 derivation every existing map uses: the quantity a per-team
    // "fouls committed" component must represent is what THIS alliance cost
    // the OPPONENT, which is the opposing alliance's own `foulPoints`
    // (points IT received) for the same match — season-agnostic, no
    // per-season foul point-value table needed. `foulCount`/`techFoulCount`
    // are raw counts, not point values, and are never read here; they are
    // aliased above in `diagnosticKeys` only.
    result[FOULS_COMMITTED_COMPONENT] = opponent.foulPoints;

    return result;
  },
};
