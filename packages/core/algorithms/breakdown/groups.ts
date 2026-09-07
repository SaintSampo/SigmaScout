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
 * that belongs to no scoring phase and is almost always zero. `foulsCommitted`
 * is points conceded to the opponent, not points this alliance scored.
 * Grouping is unrelated to summing, so whether these two still contribute to
 * `total` is now ALGORITHM-DEPENDENT (D-01, quick task 260904-5px): VPR's
 * `total` still spans every component, `adjust` and `foulsCommitted`
 * included — but EPA's published `total` (`epa.ts`'s `teamMetrics()`)
 * excludes `FOULS_COMMITTED_COMPONENT` specifically, to match Statbotics'
 * no-foul `epa.total_points`. `adjust` still contributes to EPA's `total`
 * too; only `foulsCommitted` is carved out, and only for EPA.
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
 *  - 2019 `habClimb`: TBA's own `teleopPoints` roll-up bundles HAB climb
 *    together with hatch panels and cargo, but the climb is plainly an
 *    ENDGAME action and is grouped as endgame here — the identical
 *    treatment 2022 already gives its own endgame component, which TBA
 *    likewise folds into a `teleopPoints` roll-up.
 *  - 2018 `vault`: the Vault is a teleop activity (cubes are exchanged
 *    during teleop for power-ups), so it groups there. Both ownership
 *    components (D-1's Scale/Switch split) group by their own phase
 *    prefix — `autoSwitchOwnership`/`autoScaleOwnership` in auto,
 *    `teleopSwitchOwnership`/`teleopScaleOwnership` in teleop — never
 *    merged into one cross-phase "ownership" group.
 *  - 2016 `breach`/`capture`: both are playoff-only bonuses (always 0 in
 *    quals) and both are grouped in TELEOP for the same reason 2017's two
 *    are — that is where TBA itself counts them, inside its own
 *    `teleopPoints` roll-up. `teleopChallenge` and `teleopScale` are both
 *    ENDGAME tower actions (a robot challenging or scaling the opponent's
 *    tower at the end of the match) and are grouped as endgame despite
 *    their `teleop` name prefixes — the same treatment 2019's `habClimb`
 *    and 2017's `teleopTakeoff` already get, and another instance of why
 *    the mapping is declared rather than derived from a key prefix.
 *  - 2017 `kPaBonus`/`rotorBonus`: both are playoff-only bonuses (always 0
 *    in quals) and both are grouped in TELEOP because that is where TBA
 *    itself counts them — inside its own `teleopPoints` roll-up. Grouping
 *    them anywhere else would put this project's phase split at odds with
 *    the source's. `teleopTakeoff` is the endgame action and is grouped as
 *    endgame despite its `teleop` name prefix — the same treatment 2019's
 *    `habClimb` already gets, and the reason the mapping is declared rather
 *    than derived from a key prefix.
 */
const GROUPS_BY_SEASON: Readonly<Record<number, SeasonComponentGroups>> = {
  2016: {
    auto: ["autoReach", "autoCrossing", "autoBoulder"],
    teleop: ["teleopCrossing", "teleopBoulder", "breach", "capture"],
    endgame: ["teleopChallenge", "teleopScale"],
  },
  2017: {
    auto: ["autoMobility", "autoFuel", "autoRotor"],
    teleop: ["teleopFuel", "teleopRotor", "kPaBonus", "rotorBonus"],
    endgame: ["teleopTakeoff"],
  },
  2018: {
    auto: ["autoRun", "autoSwitchOwnership", "autoScaleOwnership"],
    teleop: ["teleopSwitchOwnership", "teleopScaleOwnership", "vault"],
    endgame: ["endgame"],
  },
  2019: {
    auto: ["sandstormBonus"],
    teleop: ["hatchPanel", "cargo"],
    endgame: ["habClimb"],
  },
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
