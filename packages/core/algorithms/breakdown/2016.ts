/**
 * 2016 (FIRST STRONGHOLD) component map. Every component is a bare field
 * read, no arithmetic.
 *
 * `breachPoints` and `capturePoints` are always 0 in quals and real points
 * in playoffs, where TBA counts them inside its own `teleopPoints` and
 * `totalPoints` roll-ups — they are read as first-class components for that
 * reason; omitting them mismatches thousands of playoff sides against TBA's
 * own totals. `reconciliation.test.ts`'s window is not comp-level-filtered
 * and is playoff-inclusive, so it catches a regression here even though the
 * RP reconciliation suite is qual-scoped.
 *
 * Three official alliance-sides (all eliminations, +/-25) fail the roll-up
 * identity against TBA's own totals too — TBA's own arithmetic, not a
 * mapping defect; see the named `KNOWN_BREAKDOWN_TOLERANCES` entry for 2016
 * in `reconciliation.test.ts`. corr(red, blue) on `totalPoints` is +0.3416,
 * inside the normal cross-season band, so 2016 needs no normalization
 * treatment.
 *
 * `position2`..`position5` are defense NAME strings; `position1crossings`..
 * `position5crossings` are the crossing counts (no `position1` string — the
 * low bar is fixed, not chosen). Neither form is read here; the crossings
 * are read by the RP module (`rankingPoints/2016.ts`) as Breach-bonus
 * thresholds. `z.number().finite()` catches a `position2`/`position2crossings`
 * mixup loudly rather than coercing.
 *
 * Never read here: the roll-up totals (double-counting), the per-robot and
 * tower-face fields (positional correspondence to the teams array is
 * unverified), `tba_rpEarned`, the defense/tower boolean flags and the raw
 * boulder/crossing/tower counts (all read by the RP module instead, whose
 * scored value is already in the point fields above).
 *
 * `diagnosticKeys` lists only `foulCount`/`techFoulCount`; adding the
 * crossing or tower raw counts here would misclassify nearly every 2016
 * match as a foul.
 *
 * Validated at the parse boundary with Zod: every read field must be a
 * finite number, or `parse` throws rather than coercing a malformed field.
 */
import { z } from "zod";
import type { ParsedComponents, SeasonComponentMap } from "./constants.js";
import { ADJUST_COMPONENT, ADJUST_POINTS_SCHEMA, FOULS_COMMITTED_COMPONENT } from "./constants.js";

/**
 * Only the subset of TBA's `score_breakdown.{side}` object this map reads.
 * Unknown extra fields are ignored, not rejected — zod's default "strip"
 * mode drops them without erroring. Deliberately not `.passthrough()`.
 */
const SideBreakdownSchema = z.object({
  autoReachPoints: z.number().finite(),
  autoCrossingPoints: z.number().finite(),
  autoBoulderPoints: z.number().finite(),
  teleopCrossingPoints: z.number().finite(),
  teleopBoulderPoints: z.number().finite(),
  teleopChallengePoints: z.number().finite(),
  teleopScalePoints: z.number().finite(),
  /** Always 0 in quals, real points in playoffs; load-bearing, see file header. */
  breachPoints: z.number().finite(),
  capturePoints: z.number().finite(),
  adjustPoints: ADJUST_POINTS_SCHEMA,
  /** Points this alliance RECEIVED from the opponent's fouls, not points it committed. */
  foulPoints: z.number().finite(),
});

const Breakdown2016Schema = z.object({
  red: SideBreakdownSchema,
  blue: SideBreakdownSchema,
});

/** canonical component name -> TBA `score_breakdown` key, for this alliance's own fields. */
const OWN_FIELD_COMPONENT_MAP: Readonly<Record<string, keyof z.infer<typeof SideBreakdownSchema>>> = {
  autoReach: "autoReachPoints",
  autoCrossing: "autoCrossingPoints",
  autoBoulder: "autoBoulderPoints",
  teleopCrossing: "teleopCrossingPoints",
  teleopBoulder: "teleopBoulderPoints",
  teleopChallenge: "teleopChallengePoints",
  teleopScale: "teleopScalePoints",
  breach: "breachPoints",
  capture: "capturePoints",
  [ADJUST_COMPONENT]: "adjustPoints",
};

export const breakdown2016: SeasonComponentMap = {
  components: [...Object.keys(OWN_FIELD_COMPONENT_MAP), FOULS_COMMITTED_COMPONENT],

  // Held to exactly these two: a consumer treats every listed name as a
  // foul field, so the crossing and tower raw counts must not be added here.
  diagnosticKeys: ["foulCount", "techFoulCount"],

  parse(rawBreakdownJson: unknown, side: "red" | "blue"): ParsedComponents {
    const parsed = Breakdown2016Schema.parse(rawBreakdownJson);
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
