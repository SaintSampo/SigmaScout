/**
 * 2022 (Rapid React) component map (D-02). Field inventory verified
 * directly against `data/corpus.sqlite` this session (2026-08-13, live
 * query): every key below was present in a real ingested 2022
 * `score_breakdown.red`/`.blue` object. All alliance-level (never per-robot
 * — RESEARCH.md Pitfall Sigma1-2 / Assumption A1: the positional
 * correspondence between `RobotN` fields and `red_teams`/`blue_teams`
 * array order is unverified, so no per-robot field is read here or by any
 * component map this phase — `endgameRobot1/2/3` and `taxiRobot1/2/3` are
 * present in the raw JSON but deliberately never read).
 *
 * Validated at the parse boundary with Zod (T-02-01, ASVS V5): every read
 * field must be a finite number, or `parse` throws rather than coercing an
 * absent/malformed field to 0 — mirrors `2024.ts`'s discipline.
 *
 * Roll-up avoidance: `autoPoints` equals `autoTaxiPoints + autoCargoPoints`
 * and `teleopPoints` equals `teleopCargoPoints + endgamePoints` — neither
 * roll-up key is read, since emitting both the parts and the sum would
 * double-count and break the reconciliation invariant
 * (reconciliation.test.ts).
 */
import { z } from "zod";
import type { ParsedComponents, SeasonComponentMap } from "./index.js";
import { ADJUST_COMPONENT, FOULS_COMMITTED_COMPONENT } from "./index.js";

/**
 * Only the subset of TBA's `score_breakdown.{side}` object this map reads.
 * Unknown extra fields (`autoCargoLowerBlue`, `cargoBonusRankingPoint`,
 * `quintetAchieved`, the `RobotN` per-robot fields, etc.) are ignored, not
 * rejected — zod's default "strip" mode for `.object()` drops them without
 * erroring. Deliberately NOT `.passthrough()`/`.loose()`, for the same
 * typing reason `2024.ts` documents.
 */
const SideBreakdownSchema = z.object({
  autoTaxiPoints: z.number().finite(),
  autoCargoPoints: z.number().finite(),
  teleopCargoPoints: z.number().finite(),
  endgamePoints: z.number().finite(),
  adjustPoints: z.number().finite(),
  /**
   * Points this alliance RECEIVED from the opponent's fouls — NOT points
   * this alliance committed. See `foulsCommitted`'s comment below.
   */
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

  // Raw count fields — not point values, never emitted as a component
  // (Pitfall Sigma1-1). Recorded for plan 02-06's identifiability report.
  diagnosticKeys: ["foulCount", "techFoulCount"],

  parse(rawBreakdownJson: unknown, side: "red" | "blue"): ParsedComponents {
    const parsed = Breakdown2022Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const opponent = side === "red" ? parsed.blue : parsed.red;

    // Object.create(null) + a fixed allowlist loop (T-02-04): third-party
    // TBA JSON is never spread onto the result, so a `__proto__` key in the
    // raw payload cannot reach Object.prototype via this map.
    const result: ParsedComponents = Object.create(null) as ParsedComponents;
    for (const [canonical, tbaKey] of Object.entries(OWN_FIELD_COMPONENT_MAP)) {
      result[canonical] = own[tbaKey];
    }

    // Same D-04 derivation 2024.ts uses: the quantity a per-team "fouls
    // committed" component must represent is what THIS alliance cost the
    // OPPONENT, which is the opposing alliance's own `foulPoints` (points
    // IT received) for the same match — season-agnostic, no per-season
    // foul point-value table needed. `foulCount`/`techFoulCount` are raw
    // counts, not point values, and are never read here; they are aliased
    // above in `diagnosticKeys` for plan 02-06's identifiability report only.
    result[FOULS_COMMITTED_COMPONENT] = opponent.foulPoints;

    return result;
  },
};
