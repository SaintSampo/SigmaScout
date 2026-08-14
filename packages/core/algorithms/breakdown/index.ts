/**
 * Season -> component-map dispatch table (D-02, D-19). Adding a new season
 * is a new entry in `SEASON_COMPONENT_MAPS` below and a new `{year}.ts`
 * file — never a branch here. `COLD_START_SEASON` is the one place the
 * corpus's cold-start season is named; no other module may hardcode it
 * (D-19: it becomes 2016 once the corpus is extended back that far).
 *
 * Shared types/constants (`ParsedComponents`, `SeasonComponentMap`,
 * `FOULS_COMMITTED_COMPONENT`, `ADJUST_COMPONENT`, `COLD_START_SEASON`,
 * `isColdStartSeason`) live in `./constants.js`, a dependency-free leaf
 * module, and are re-exported here for every existing import site. This
 * module (the dispatch table) imports every season file, and every season
 * file imports the shared constants from `constants.js` — never from this
 * file — so the dependency graph stays acyclic (see `constants.ts`'s file
 * header for the circular-import bug this split fixes).
 */
export {
  ADJUST_COMPONENT,
  assertFiniteComponents,
  COLD_START_SEASON,
  FOULS_COMMITTED_COMPONENT,
  isColdStartSeason,
  type ParsedComponents,
  type SeasonComponentMap,
} from "./constants.js";
import type { ParsedComponents, SeasonComponentMap } from "./constants.js";

// Registered seasons (D-19: adding one is data entry — a new import plus a
// new record entry — never a branch in this dispatch function).
import { breakdown2022 } from "./2022.js";
import { breakdown2023 } from "./2023.js";
import { breakdown2024 } from "./2024.js";
import { breakdown2025 } from "./2025.js";
import { breakdown2026 } from "./2026.js";

const SEASON_COMPONENT_MAPS: Readonly<Record<number, SeasonComponentMap>> = {
  2022: breakdown2022,
  2023: breakdown2023,
  2024: breakdown2024,
  2025: breakdown2025,
  2026: breakdown2026,
};

/**
 * Looks up the component map for `season`. Throws for an unmapped season
 * rather than defaulting, in `score.ts`'s `seasonSplit()` style — an
 * unregistered season has no defensible component map to fall back to.
 */
export function componentMapForSeason(season: number): SeasonComponentMap {
  const map = SEASON_COMPONENT_MAPS[season];
  if (!map) {
    throw new Error(
      `componentMapForSeason: no component map registered for season ${season} (registered: ${Object.keys(SEASON_COMPONENT_MAPS).join(", ")})`
    );
  }
  return map;
}

/**
 * Parses `scoreBreakdownRaw` for `side` using `season`'s registered
 * component map. Returns `null` (not an empty object, not zeros) when
 * `scoreBreakdownRaw` is `null` — TBA omitted the breakdown for this match —
 * so the D-05 fallback path (a later plan) is reachable and distinguishable
 * from "every component happened to be zero."
 */
export function parseBreakdown(
  season: number,
  scoreBreakdownRaw: string | null,
  side: "red" | "blue"
): ParsedComponents | null {
  if (scoreBreakdownRaw === null) return null;
  const map = componentMapForSeason(season);
  const rawJson: unknown = JSON.parse(scoreBreakdownRaw);
  return map.parse(rawJson, side);
}
