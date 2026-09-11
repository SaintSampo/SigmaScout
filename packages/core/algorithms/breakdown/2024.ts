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
import type { ParsedComponents, SeasonComponentMap } from "./constants.js";

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

/**
 * canonical component name -> the TBA `score_breakdown` keys summed into it.
 *
 * **2024 is deliberately grouped at phase granularity (quick task 260910-5ym),
 * unlike every other registered season, which maps one component per TBA
 * field.** The eleven offensive fields below are still read, still Zod-validated
 * and still reconcile exactly against the alliance's score — only the number of
 * separately-RATED quantities changed, from eleven to three.
 *
 * Why, measured rather than argued: 2024 carried the most granular map of any
 * season (13 components against a median of 9) on the season with the
 * second-lowest score variance in the corpus (SD 27.2). Each component is a
 * per-team EWMA estimated from roughly a dozen quals, and eleven noisy
 * estimates were being summed into every predicted alliance total. Quick task
 * 260910-4x0 replayed 2016->2024 four times off one shared carry and scored
 * 2024's 16,764 decided official matches:
 *
 *   | rating granularity                          | comps | accuracy |
 *   |---------------------------------------------|-------|----------|
 *   | one component per TBA field (was shipping)   |    13 |   0.7348 |
 *   | a four-way grouping WE assembled (see below) |     6 |   0.7461 |
 *   | phase groups — THIS MAP                      |     5 |   0.7520 |
 *   | a single no-foul total                       |     3 |   0.7403 |
 *
 * Note the curve turns over: collapsing all the way to one total is WORSE
 * than three phase groups, so this is a bias/variance optimum and not a
 * "fewer is always better" rule to propagate to other seasons without
 * measuring them the same way. Statbotics' own 2024 accuracy is 0.7627.
 *
 * LABEL CORRECTED 2026-09-11 (quick task 260911-gfe). Row two used to read
 * "Statbotics' comp partition". There is no such object: Statbotics'
 * `all_keys[year]` is a rated-quantity LIST that double-counts by construction
 * (it carries `no_foul_points` beside the three phase keys it is the sum of),
 * so the six-way row is a grouping THIS PROJECT assembled out of `comp_*`
 * names in `experiments/260910-4x0/granularity.ts`. The 0.7461 measurement is
 * real and is kept; only what it is a number OF is corrected. The row that IS
 * faithful to Statbotics is the last one: its 2024 `get_score_from_breakdown`
 * branch rates exactly one no-foul total, so copying it would cost about 1.2
 * percentage points here. See `docs/models/statbotics-breakdown-reference.md`
 * and `docs/models/epa-divergences.md` section 6.
 *
 * The grouping is not invented here — it is exactly `groups.ts`'s existing
 * 2024 `auto`/`teleop`/`endgame` partition, which the site already publishes
 * as phase metrics, and it matches three of Statbotics' own rated 2024 keys
 * (`auto_points`, `teleop_points`, `endgame_points`). Bare `auto`/`teleop`/
 * `endgame` component names are an established convention here, not a new
 * one: 2022 already declares a bare `endgame` component, and
 * `groups.test.ts` pins that a component name never collides with a group
 * METRIC key (`phaseAuto`/`phaseTeleop`/`phaseEndgame`).
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

    // Object.create(null) + a fixed allowlist loop (T-02-04): third-party
    // TBA JSON is never spread onto the result, so a `__proto__` key in the
    // raw payload cannot reach Object.prototype via this map.
    const result: ParsedComponents = Object.create(null) as ParsedComponents;
    for (const [canonical, tbaKeys] of Object.entries(OWN_FIELD_COMPONENT_MAP)) {
      let sum = 0;
      for (const tbaKey of tbaKeys) sum += own[tbaKey];
      result[canonical] = sum;
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
