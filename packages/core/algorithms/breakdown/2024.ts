/**
 * 2024 (Crescendo) component map. All alliance-level, never per-robot: the
 * positional correspondence between `RobotN` fields and the teams array is
 * unverified, so no per-robot field is read here or by any component map.
 *
 * Validated at the parse boundary with Zod: every read field must be a
 * finite number, or `parse` throws rather than coercing a malformed field.
 */
import { z } from "zod";
import type { ParsedComponents, SeasonComponentMap } from "./constants.js";
import { ADJUST_POINTS_SCHEMA } from "./constants.js";

/**
 * Only the subset of TBA's `score_breakdown.{side}` object this map reads.
 * Unknown extra fields are ignored, not rejected — zod's default "strip"
 * mode drops them without erroring. Deliberately not `.passthrough()`:
 * keeping this schema's inferred type free of a `Record<string, unknown>`
 * intersection is what keeps `own[tbaKey]` below precisely typed as
 * `number` rather than widened to `unknown`.
 */
const SideBreakdownSchema = z.object({
  autoLeavePoints: z.number().finite(),
  autoAmpNotePoints: z.number().finite(),
  autoSpeakerNotePoints: z.number().finite(),
  teleopAmpNotePoints: z.number().finite(),
  teleopSpeakerNotePoints: z.number().finite(),
  teleopSpeakerNoteAmplifiedPoints: z.number().finite(),
  endGameOnStagePoints: z.number().finite(),
  endGameParkPoints: z.number().finite(),
  endGameHarmonyPoints: z.number().finite(),
  endGameNoteInTrapPoints: z.number().finite(),
  endGameSpotLightBonusPoints: z.number().finite(),
  adjustPoints: ADJUST_POINTS_SCHEMA,
  /** Points this alliance RECEIVED from the opponent's fouls, not points it committed. */
  foulPoints: z.number().finite(),
});

const Breakdown2024Schema = z.object({
  red: SideBreakdownSchema,
  blue: SideBreakdownSchema,
});

/**
 * canonical component name -> the TBA `score_breakdown` keys summed into it.
 *
 * 2024 is deliberately grouped at phase granularity, unlike every other
 * registered season, which maps one component per TBA field. The eleven
 * offensive fields below are still read, still Zod-validated and still
 * reconcile exactly against the alliance's score — only the number of
 * separately-rated quantities changed, from eleven to three.
 *
 * Measured, not argued: 2024 carried the most granular map of any season on
 * the season with the second-lowest score variance in the corpus, so eleven
 * noisy per-team EWMA estimates were being summed into every predicted
 * alliance total. A replay comparison found phase-level grouping (this map)
 * scores highest, ahead of both per-field and a single no-foul total — a
 * bias/variance optimum, not a "fewer is always better" rule to propagate
 * to other seasons without measuring them the same way. Full comparison:
 * `docs/models/statbotics-breakdown-reference.md` and
 * `docs/models/epa-divergences.md` section 6.
 *
 * The grouping matches `groups.ts`'s existing 2024 `auto`/`teleop`/
 * `endgame` partition, which the site already publishes as phase metrics,
 * and three of Statbotics' own rated 2024 keys. Bare `auto`/`teleop`/
 * `endgame` component names are an established convention here: 2022
 * already declares a bare `endgame` component, and `groups.test.ts` pins
 * that a component name never collides with a group metric key.
 */
const OWN_FIELD_COMPONENT_MAP: Readonly<Record<string, readonly (keyof z.infer<typeof SideBreakdownSchema>)[]>> = {
  auto: ["autoLeavePoints", "autoAmpNotePoints", "autoSpeakerNotePoints"],
  teleop: ["teleopAmpNotePoints", "teleopSpeakerNotePoints", "teleopSpeakerNoteAmplifiedPoints"],
  endgame: [
    "endGameOnStagePoints",
    "endGameParkPoints",
    "endGameHarmonyPoints",
    "endGameNoteInTrapPoints",
    "endGameSpotLightBonusPoints",
  ],
  adjust: ["adjustPoints"],
};

const FOULS_COMMITTED_COMPONENT = "foulsCommitted";

export const breakdown2024: SeasonComponentMap = {
  components: [...Object.keys(OWN_FIELD_COMPONENT_MAP), FOULS_COMMITTED_COMPONENT],

  parse(rawBreakdownJson: unknown, side: "red" | "blue"): ParsedComponents {
    const parsed = Breakdown2024Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const opponent = side === "red" ? parsed.blue : parsed.red;

    // Object.create(null) + a fixed allowlist loop: raw TBA JSON is never
    // spread onto the result, so a `__proto__` key cannot reach Object.prototype.
    const result: ParsedComponents = Object.create(null) as ParsedComponents;
    for (const [canonical, tbaKeys] of Object.entries(OWN_FIELD_COMPONENT_MAP)) {
      let sum = 0;
      for (const tbaKey of tbaKeys) sum += own[tbaKey];
      result[canonical] = sum;
    }

    // Fouls committed by this alliance = points the OPPONENT received, i.e.
    // the opposing alliance's own foulPoints for the same match —
    // season-agnostic, no per-season foul point-value table needed.
    result[FOULS_COMMITTED_COMPONENT] = opponent.foulPoints;

    return result;
  },
};
