import { componentMapForSeason } from "../../../../packages/core/algorithms/breakdown/index.js";
import { TOTAL_KEY } from "./metricKeys.js";

/**
 * Phase-level grouping of score components for the team page's headline grid
 * — Auto, Teleop, Endgame, Total instead of the full per-component list (13
 * tiles in 2024, 11 in 2026).
 *
 * The mapping is DECLARED per season, never derived from a key prefix. A
 * prefix heuristic looks tempting and breaks immediately: 2022's endgame
 * component is the bare `endgame`, 2023 has `link`, 2025 has `algae`, and
 * almost all of 2026's scoring is the `hub*` family, whose names carry no
 * phase prefix at all (`hubShift1`..`hubShift4`). `metricGroups.test.ts`
 * asserts every component of every registered season is assigned exactly
 * once, so a new season cannot be added without deciding its grouping.
 *
 * `adjust` and `foulsCommitted` are deliberately UNGROUPED and therefore
 * never displayed. `adjust` is TBA's own `adjustPoints` — a manual
 * scorekeeper correction belonging to no scoring phase, almost always zero.
 * `foulsCommitted` is points conceded to the opponent, not points this
 * alliance scored. Both still contribute to `total`, which the algorithm
 * publishes directly and which is never recomputed here.
 */
export type MetricGroupId = "auto" | "teleop" | "endgame";

export interface MetricGroup {
  readonly id: MetricGroupId;
  readonly label: string;
}

export const METRIC_GROUPS: readonly MetricGroup[] = [
  { id: "auto", label: "Auto" },
  { id: "teleop", label: "Teleop" },
  { id: "endgame", label: "Endgame" },
];

/** Components intentionally excluded from every group — see the module comment. */
export const UNGROUPED_COMPONENTS: readonly string[] = ["adjust", "foulsCommitted"];

type SeasonGrouping = Readonly<Record<MetricGroupId, readonly string[]>>;

/**
 * Judgement calls worth stating explicitly, because they are not mechanical:
 *  - 2023 `link`: links are completed during teleop, grouped there.
 *  - 2025 `algae`: algae scoring is a teleop activity, grouped there.
 *  - 2026 `hub*`: `hubAuto` is the auto-period hub score; `hubTransition`
 *    and `hubShift1`..`hubShift4` are the teleop shifts; `hubEndgame` is the
 *    endgame period. `autoTower`/`endGameTower` group by their own names.
 */
const GROUPINGS: Readonly<Record<number, SeasonGrouping>> = {
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

/** The component keys making up one group for one season — `[]` for an unregistered season. */
export function componentsForGroup(season: number, group: MetricGroupId): readonly string[] {
  return GROUPINGS[season]?.[group] ?? [];
}

export function groupingForSeason(season: number): SeasonGrouping | undefined {
  return GROUPINGS[season];
}

export interface GroupedMetric {
  /** Sum of the group's component values. Exact: expectation is linear, so a sum of means is the mean of the sum however the components covary. */
  value: number;
  /**
   * ALWAYS `undefined` today, and deliberately so.
   *
   * A group's spread is NOT the sum, nor the quadrature sum, of its
   * components' spreads — that needs the covariance between components,
   * which the artifact does not publish. Components within a match are
   * plainly correlated (a strong auto and a strong teleop share the same
   * underlying robot), so assuming independence would misstate the real
   * interval. A published `X ± Y` that is quietly wrong is worse for this
   * project than no `Y` at all. Populating this needs a pipeline pass that
   * publishes group-level variance directly.
   */
  spread: undefined;
  /**
   * ALWAYS `undefined` today. A percentile is a rank against the whole
   * season pool for one specific metric; the percentile of a sum is not any
   * function of its parts' percentiles, so it cannot be derived client-side
   * either. Consequence: grouped tiles render with no rarity-tier box.
   */
  percentile: undefined;
}

/**
 * Sums one group's components. Returns `undefined` when the season has no
 * grouping or none of its components are present, so the caller renders the
 * same em-dash it already renders for any missing metric.
 */
export function groupedMetric(
  season: number,
  group: MetricGroupId,
  metrics: Readonly<Record<string, { value: number } | undefined>>,
): GroupedMetric | undefined {
  const keys = componentsForGroup(season, group);
  if (keys.length === 0) return undefined;

  let value = 0;
  let found = false;
  for (const key of keys) {
    const metric = metrics[key];
    if (metric === undefined) continue;
    value += metric.value;
    found = true;
  }
  if (!found) return undefined;
  return { value, spread: undefined, percentile: undefined };
}

/** The four displayed keys, in order — the three phase groups, then the algorithm's own published Total. */
export function displayedMetricKeys(): readonly string[] {
  return [...METRIC_GROUPS.map((g) => g.id), TOTAL_KEY];
}

/** Every component the season declares, minus the deliberately ungrouped ones. Used by the coverage test. */
export function groupableComponentsForSeason(season: number): readonly string[] {
  return componentMapForSeason(season).components.filter((c) => !UNGROUPED_COMPONENTS.includes(c));
}
