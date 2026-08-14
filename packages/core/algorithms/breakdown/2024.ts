/**
 * 2024 (Crescendo) component map (D-02). Field inventory verified directly
 * against `data/corpus.sqlite` during planning (2026-08-13) and re-verified
 * this session: every key below was present in a real ingested 2024
 * `score_breakdown.red`/`.blue` object. All alliance-level (never per-robot
 * — RESEARCH.md Pitfall Sigma1-2 / Assumption A1: the positional
 * correspondence between `RobotN` fields and `red_teams`/`blue_teams`
 * array order is unverified, so no per-robot field is read here or by any
 * component map this phase).
 *
 * Validated at the parse boundary with Zod (T-02-01, ASVS V5): every read
 * field must be a finite number, or `parse` throws rather than coercing an
 * absent/malformed field to 0 — mirrors `opr.ts`'s `?? leagueMeanPerTeamShare`
 * discipline of a documented fallback over a silent zero.
 */
import { z } from "zod";
import type { ParsedComponents, SeasonComponentMap } from "./index.js";

/**
 * Only the subset of TBA's `score_breakdown.{side}` object this map reads.
 * Unknown extra fields are ignored, not rejected — TBA's shape may carry
 * fields this phase doesn't need (e.g. `melodyBonusAchieved`,
 * `micStageLeft`) — zod's default "strip" mode for `.object()` drops them
 * without erroring. Deliberately NOT `.passthrough()`/`.loose()`: keeping
 * this schema's inferred type free of a `Record<string, unknown>`
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
  adjustPoints: z.number().finite(),
  /**
   * Points this alliance RECEIVED from the opponent's fouls — NOT points
   * this alliance committed. See `foulsCommitted`'s comment below for why
   * this field is read from the OPPOSING side, not this one.
   */
  foulPoints: z.number().finite(),
});

const Breakdown2024Schema = z.object({
  red: SideBreakdownSchema,
  blue: SideBreakdownSchema,
});

/** canonical component name -> TBA `score_breakdown` key, for this alliance's own fields. */
const OWN_FIELD_COMPONENT_MAP: Readonly<Record<string, keyof z.infer<typeof SideBreakdownSchema>>> = {
  autoLeave: "autoLeavePoints",
  autoAmpNote: "autoAmpNotePoints",
  autoSpeakerNote: "autoSpeakerNotePoints",
  teleopAmpNote: "teleopAmpNotePoints",
  teleopSpeakerNote: "teleopSpeakerNotePoints",
  teleopSpeakerNoteAmplified: "teleopSpeakerNoteAmplifiedPoints",
  endGameOnStage: "endGameOnStagePoints",
  endGamePark: "endGameParkPoints",
  endGameHarmony: "endGameHarmonyPoints",
  endGameNoteInTrap: "endGameNoteInTrapPoints",
  endGameSpotLightBonus: "endGameSpotLightBonusPoints",
  adjust: "adjustPoints",
};

const FOULS_COMMITTED_COMPONENT = "foulsCommitted";

export const breakdown2024: SeasonComponentMap = {
  components: [...Object.keys(OWN_FIELD_COMPONENT_MAP), FOULS_COMMITTED_COMPONENT],

  parse(rawBreakdownJson: unknown, side: "red" | "blue"): ParsedComponents {
    const parsed = Breakdown2024Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const opponent = side === "red" ? parsed.blue : parsed.red;

    // Object.create(null) + a fixed allowlist loop (T-02-04): third-party
    // TBA JSON is never spread onto the result, so a `__proto__` key in the
    // raw payload cannot reach Object.prototype via this map.
    const result: ParsedComponents = Object.create(null) as ParsedComponents;
    for (const [canonical, tbaKey] of Object.entries(OWN_FIELD_COMPONENT_MAP)) {
      result[canonical] = own[tbaKey];
    }

    // Deliberate divergence from RESEARCH.md's field-aliasing sketch (D-04):
    // an alliance's own `foulPoints` are the points it RECEIVED from the
    // opponent's fouls, not points it committed. The quantity D-04 wants —
    // points this alliance handed the OPPONENT — is therefore the
    // OPPOSING alliance's `foulPoints` for the same match. Deriving it this
    // way is season-agnostic (no per-season foul point-value table needed)
    // and directly answers "how many points did this alliance's fouls cost
    // the other side," which is what a per-team "fouls committed" component
    // must represent. The per-season foul COUNT fields (`foulCount`,
    // `techFoulCount`) are aliased separately in later plans, for the
    // identifiability report only — never for this component's value.
    result[FOULS_COMMITTED_COMPONENT] = opponent.foulPoints;

    return result;
  },
};
