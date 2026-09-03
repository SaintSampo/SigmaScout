import { ADJUST_COMPONENT, FOULS_COMMITTED_COMPONENT } from "./constants.js";

/**
 * Phase-level grouping of each season's score components — Auto, Teleop and
 * Endgame — published as first-class metrics alongside the raw components
 * and `total`.
 *
 * This lives in core, not in the web app, because the group's SPREAD can
 * only be computed here: it is the quadratic form of Sigma1's per-team
 * component covariance matrix restricted to the group's own indices
 * (`covariance.ts`'s `subsetVariance`). A client summing published
 * per-component spreads cannot reproduce it — that would need the
 * inter-component covariances, which are not published and which are
 * decidedly non-zero (a team good at auto tends also to be good at teleop,
 * which is the entire reason `covariance.ts` exists).
 *
 * The mapping is DECLARED per season, never derived from a key prefix. A
 * prefix heuristic breaks immediately: 2022's endgame component is the bare
 * `endgame`, 2023 has `link`, 2025 has `algae`, and almost all of 2026's
 * scoring is the `hub*` family, whose names carry no phase prefix at all
 * (`hubShift1`..`hubShift4`). `groups.test.ts` asserts every component of
 * every registered season is assigned exactly once or explicitly excluded,
 * so a new season cannot be registered without deciding its grouping.
 */
export type ComponentGroupId = "auto" | "teleop" | "endgame";

export const COMPONENT_GROUP_IDS: readonly ComponentGroupId[] = ["auto", "teleop", "endgame"];

/**
 * Components deliberately belonging to NO group, and therefore never shown
 * as part of a phase.
 *
 * `adjust` is TBA's own `adjustPoints` — a manual scorekeeper correction
 * that belongs to no scoring phase and is almost always zero.
 * `foulsCommitted` is points conceded to the opponent, not points this
 * alliance scored. Both still contribute to `total`, which is computed from
 * every component regardless of grouping.
 */
export const UNGROUPED_COMPONENTS: readonly string[] = [ADJUST_COMPONENT, FOULS_COMMITTED_COMPONENT];

/**
 * The published metric key for each group.
 *
 * These are PREFIXED, and must be: 2022's endgame component is named exactly
 * `endgame`, so a bare "endgame" group key would collide with it in the same
 * metrics record and silently overwrite a real component. `groups.test.ts`
 * asserts no group key collides with any component name in any season.
 */
export const COMPONENT_GROUP_METRIC_KEYS: Readonly<Record<ComponentGroupId, string>> = {
  auto: "phaseAuto",
  teleop: "phaseTeleop",
  endgame: "phaseEndgame",
};

export type SeasonComponentGroups = Readonly<Record<ComponentGroupId, readonly string[]>>;

/**
 * Judgement calls worth stating, because they are not mechanical:
 *  - 2023 `link`: links are completed during teleop, grouped there.
 *  - 2025 `algae`: algae scoring is a teleop activity, grouped there.
 *  - 2026 `hub*`: `hubAuto` is the auto-period hub score; `hubTransition`
 *    and `hubShift1`..`hubShift4` are the teleop shifts; `hubEndgame` is the
 *    endgame period. `autoTower`/`endGameTower` group by their own names.
 *  - 2020 `autoInitLine`/`autoCell` are auto-period; `teleopCell`/
 *    `controlPanel` are teleop; `endgame` groups by its own name, same
 *    treatment 2022's bare `endgame` component already gets.
 */
const GROUPS_BY_SEASON: Readonly<Record<number, SeasonComponentGroups>> = {
  2020: {
    auto: ["autoInitLine", "autoCell"],
    teleop: ["teleopCell", "controlPanel"],
    endgame: ["endgame"],
  },
  2022: {
    auto: ["autoTaxi", "autoCargo"],
    teleop: ["teleopCargo"],
    endgame: ["endgame"],
  },
  2023: {
    auto: ["autoMobility", "autoGamePiece", "autoChargeStation"],
    teleop: ["teleopGamePiece", "link"],
    endgame: ["endGameChargeStation", "endGamePark"],
  },
  2024: {
    auto: ["autoLeave", "autoAmpNote", "autoSpeakerNote"],
    teleop: ["teleopAmpNote", "teleopSpeakerNote", "teleopSpeakerNoteAmplified"],
    endgame: ["endGameOnStage", "endGamePark", "endGameHarmony", "endGameNoteInTrap", "endGameSpotLightBonus"],
  },
  2025: {
    auto: ["autoMobility", "autoCoral"],
    teleop: ["teleopCoral", "algae"],
    endgame: ["endGameBarge"],
  },
  2026: {
    auto: ["autoTower", "hubAuto"],
    teleop: ["hubTransition", "hubShift1", "hubShift2", "hubShift3", "hubShift4"],
    endgame: ["endGameTower", "hubEndgame"],
  },
};

/** `undefined` for a season with no registered grouping — the caller then publishes no group metrics for it rather than inventing an empty one. */
export function componentGroupsForSeason(season: number): SeasonComponentGroups | undefined {
  return GROUPS_BY_SEASON[season];
}

/** One group's component names for one season — `[]` when the season or group is unregistered. */
export function componentsInGroup(season: number, group: ComponentGroupId): readonly string[] {
  return GROUPS_BY_SEASON[season]?.[group] ?? [];
}
