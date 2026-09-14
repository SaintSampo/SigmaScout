/**
 * 2017 (FIRST STEAMWORKS) component map. Every component is a bare field
 * read, no arithmetic.
 *
 * `kPaBonusPoints` and `rotorBonusPoints` are always 0 in quals and real
 * points in playoffs, where TBA counts them inside its own `teleopPoints`
 * and `totalPoints` roll-ups — they are read as first-class components for
 * that reason; omitting them mismatches thousands of playoff sides against
 * TBA's own totals. `reconciliation.test.ts`'s window is not
 * comp-level-filtered and is playoff-inclusive, so it catches a regression
 * here even though the RP reconciliation suite is qual-scoped.
 *
 * The roll-up identity `sum(own components) + adjust + foulPoints ===
 * totalPoints` holds with 0 mismatches, so 2017 takes no
 * `KNOWN_BREAKDOWN_TOLERANCES` entry — any exception appearing later is a
 * component-map error, not an occasion to add a tolerance. corr(red, blue)
 * on `totalPoints` is +0.3293, inside the normal cross-season band, so 2017
 * needs no normalization treatment.
 *
 * Never read here: the roll-up totals (double-counting), the per-robot and
 * touchpad string fields (positional correspondence to the teams array is
 * unverified), `tba_rpEarned`, the rotor-engaged and `*RankingPointAchieved`
 * booleans (read by the RP module instead), and the raw fuel counts (their
 * scored value is already in the fuel point fields).
 *
 * `diagnosticKeys` lists only `foulCount`/`techFoulCount`; a consumer treats
 * every listed name as a foul field, so listing any other raw count here
 * would publish a bogus foul rate.
 *
 * Validated at the parse boundary with Zod: every read field must be a
 * finite number, or `parse` throws rather than coercing a malformed field.
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
  autoFuelPoints: z.number().finite(),
  autoRotorPoints: z.number().finite(),
  teleopFuelPoints: z.number().finite(),
  teleopRotorPoints: z.number().finite(),
  teleopTakeoffPoints: z.number().finite(),
  /** Always 0 in quals, real points in playoffs; load-bearing, see file header. */
  kPaBonusPoints: z.number().finite(),
  rotorBonusPoints: z.number().finite(),
  adjustPoints: z.number().finite(),
  /** Points this alliance RECEIVED from the opponent's fouls, not points it committed. */
  foulPoints: z.number().finite(),
});

const Breakdown2017Schema = z.object({
  red: SideBreakdownSchema,
  blue: SideBreakdownSchema,
});

/** canonical component name -> TBA `score_breakdown` key, for this alliance's own fields. */
const OWN_FIELD_COMPONENT_MAP: Readonly<Record<string, keyof z.infer<typeof SideBreakdownSchema>>> = {
  autoMobility: "autoMobilityPoints",
  autoFuel: "autoFuelPoints",
  autoRotor: "autoRotorPoints",
  teleopFuel: "teleopFuelPoints",
  teleopRotor: "teleopRotorPoints",
  teleopTakeoff: "teleopTakeoffPoints",
  kPaBonus: "kPaBonusPoints",
  rotorBonus: "rotorBonusPoints",
  [ADJUST_COMPONENT]: "adjustPoints",
};

export const breakdown2017: SeasonComponentMap = {
  components: [...Object.keys(OWN_FIELD_COMPONENT_MAP), FOULS_COMMITTED_COMPONENT],

  // Held to exactly these two: a consumer treats every listed name as a foul field.
  diagnosticKeys: ["foulCount", "techFoulCount"],

  parse(rawBreakdownJson: unknown, side: "red" | "blue"): ParsedComponents {
    const parsed = Breakdown2017Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const opponent = side === "red" ? parsed.blue : parsed.red;

    // Object.create(null) + a fixed allowlist loop: raw TBA JSON is never
    // spread onto the result, so a `__proto__` key cannot reach Object.prototype.
    const result: ParsedComponents = Object.create(null) as ParsedComponents;
    for (const [canonical, tbaKey] of Object.entries(OWN_FIELD_COMPONENT_MAP)) {
      result[canonical] = own[tbaKey];
    }

    // Fouls committed by this alliance = points the OPPONENT received, i.e.
    // the opposing alliance's own foulPoints for the same match.
    result[FOULS_COMMITTED_COMPONENT] = opponent.foulPoints;

    return result;
  },
};
