/**
 * Season -> component-map dispatch table (D-02, D-19). Adding a new season
 * is a new entry in `SEASON_COMPONENT_MAPS` below and a new `{year}.ts`
 * file — never a branch here. `COLD_START_SEASON` is the one place the
 * corpus's cold-start season is named; no other module may hardcode it
 * (D-19: it becomes 2016 once the corpus is extended back that far).
 */

/**
 * One season's parsed component values, keyed by canonical component name.
 * Every value finite (T-02-01) — a per-season `SeasonComponentMap.parse`
 * must throw rather than emit a non-finite value.
 */
export type ParsedComponents = Record<string, number>;

/**
 * The interface a per-season module implements: the canonical component
 * names it emits, and a pure parser from the raw TBA `score_breakdown`
 * object (shape `{ red: {...}, blue: {...} }`) to one alliance's
 * `ParsedComponents`. Some components (e.g. 2024's `foulsCommitted`, D-04)
 * are legitimately cross-alliance — `parse` receives the whole raw object,
 * not just `side`'s half, so a per-season map can read the opposing
 * alliance's fields when the canonical component's definition requires it.
 */
export interface SeasonComponentMap {
  readonly components: readonly string[];
  parse(rawBreakdownJson: unknown, side: "red" | "blue"): ParsedComponents;
  /**
   * Raw TBA field names this season carries but never emits as a rating
   * component (e.g. 2022-2025's `foulCount`/`techFoulCount` count fields,
   * 2026's renamed `majorFoulCount`/`minorFoulCount`) — recorded for plan
   * 02-06's identifiability report, not read by any algorithm's update
   * path. Optional: 2024's map (plan 02-01) predates this convention.
   */
  readonly diagnosticKeys?: readonly string[];
}

/**
 * Canonical component name for a per-team "fouls committed" observation
 * (D-04): the points this alliance's fouls cost the OPPONENT, derived from
 * the opposing alliance's own `foulPoints` field. Every season module
 * spells this name through the constant, never as a bare string literal.
 */
export const FOULS_COMMITTED_COMPONENT = "foulsCommitted";

/**
 * Canonical component name for TBA's `adjustPoints` field (present, with
 * that exact key, in every season 2022-2026 sampled this phase). Every
 * season module spells this name through the constant, never as a bare
 * string literal.
 */
export const ADJUST_COMPONENT = "adjust";

/**
 * PROJECT INTENT (D-19): once the models are proven, the corpus is
 * recomputed starting from 2016 and 2016 becomes the cold-start season
 * instead of 2022. This constant is the one place that parameter lives —
 * no other module under `packages/core/algorithms` may hardcode 2022 as a
 * cold-start sentinel.
 */
export const COLD_START_SEASON = 2022;

/**
 * D-19: the one comparison point for "is this season the corpus's
 * cold-start season" — every other module (carryover, the harness season
 * loop) calls this rather than re-deriving `season === COLD_START_SEASON`
 * itself, so extending the corpus back to 2016 (PROJECT INTENT above) is a
 * one-constant edit, never a grep-and-replace across call sites.
 */
export function isColdStartSeason(season: number): boolean {
  return season === COLD_START_SEASON;
}

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
