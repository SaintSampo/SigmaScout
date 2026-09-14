/**
 * Season -> component-map dispatch table. Adding a new season is a new
 * entry in `SEASON_COMPONENT_MAPS` below and a new `{year}.ts` file — never
 * a branch here. The corpus's cold start is positional, not a named season
 * — see `packages/harness/seasonBoundary.ts`'s `seasonBoundaryFor`, which
 * every replay loop uses instead of hardcoding a comparison here.
 *
 * Shared types/constants live in `./constants.js`, a dependency-free leaf
 * module, and are re-exported here for every existing import site. This
 * module imports every season file, and every season file imports the
 * shared constants from `constants.js` — never from this file — so the
 * dependency graph stays acyclic (see `constants.ts`'s file header for the
 * circular-import bug this split fixes).
 */
export {
  ADJUST_COMPONENT,
  assertFiniteComponents,
  FOULS_COMMITTED_COMPONENT,
  type ParsedComponents,
  type SeasonComponentMap,
} from "./constants.js";
export {
  COMPONENT_GROUP_IDS,
  COMPONENT_GROUP_METRIC_KEYS,
  componentGroupsForSeason,
  componentsInGroup,
  UNGROUPED_COMPONENTS,
  type ComponentGroupId,
  type SeasonComponentGroups,
} from "./groups.js";
import type { ParsedComponents, SeasonComponentMap } from "./constants.js";
import { ZodError } from "zod";

// Registered seasons: adding one is data entry — a new import plus a new
// record entry — never a branch in this dispatch function.
import { breakdown2016 } from "./2016.js";
import { breakdown2017 } from "./2017.js";
import { breakdown2018 } from "./2018.js";
import { breakdown2019 } from "./2019.js";
import { breakdown2020 } from "./2020.js";
import { breakdown2022 } from "./2022.js";
import { breakdown2023 } from "./2023.js";
import { breakdown2024 } from "./2024.js";
import { breakdown2025 } from "./2025.js";
import { breakdown2026 } from "./2026.js";

const SEASON_COMPONENT_MAPS: Readonly<Record<number, SeasonComponentMap>> = {
  2016: breakdown2016,
  2017: breakdown2017,
  2018: breakdown2018,
  2019: breakdown2019,
  2020: breakdown2020,
  2022: breakdown2022,
  2023: breakdown2023,
  2024: breakdown2024,
  2025: breakdown2025,
  2026: breakdown2026,
};

/**
 * Sorted, readonly tuple of every registered season — the single source of
 * both `groups.test.ts`'s and `reconciliation.test.ts`'s iteration, so
 * registering a new season automatically extends both suites without a
 * second edit. This export exists specifically to close a failure mode in
 * which a season registered above but missing from a test-local list
 * shipped an unproven component map with a green suite. The one conscious
 * edit that remains when a season is registered: the pinned equality
 * assertion in `groups.test.ts`.
 */
export const BREAKDOWN_REGISTERED_SEASONS = Object.keys(SEASON_COMPONENT_MAPS)
  .map(Number)
  .sort((a, b) => a - b) as readonly number[];

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

/**
 * True only for a `ZodError` (a raw corpus `score_breakdown` payload that
 * failed a season's Zod schema) or a `SyntaxError` (raw corpus text that is
 * not even valid JSON) — the same class of untrusted, self-reported
 * third-party payload defect `tryParseBreakdownPair` below recovers from.
 * Everything else — an unmapped-season `Error`, `assertFiniteComponents`'s
 * plain `Error`, or any future non-Zod defect inside a season module — is
 * deliberately not recoverable and must keep propagating and abort loudly:
 * a bare `catch` around the same `parseBreakdown` calls would swallow those
 * loud cases too, which is exactly what this predicate exists to avoid.
 */
export function isRecoverableBreakdownParseError(err: unknown): boolean {
  return err instanceof ZodError || err instanceof SyntaxError;
}

/** Discriminated union `tryParseBreakdownPair` returns — see its own doc comment. */
export type BreakdownParsePairOutcome =
  | { readonly kind: "absent" }
  | { readonly kind: "parsed"; readonly red: ParsedComponents; readonly blue: ParsedComponents }
  | { readonly kind: "malformed"; readonly issueCount: number };

/**
 * The guarded replacement for calling `parseBreakdown` twice (once per
 * side): a shared, directly-tested helper every algorithm uses instead of
 * each duplicating the narrowing logic.
 *
 * Parses both alliances from a single `JSON.parse` of `scoreBreakdownRaw` —
 * each season map's `parse` already validates the whole `{red, blue}`
 * payload before selecting one `side`, so the two sides already succeed or
 * fail together; pairing them here removes a duplicated `JSON.parse`.
 *
 * `componentMapForSeason(season)` is resolved before the `try` entirely, so
 * an unregistered season stays a loud, unrecoverable throw, never folded
 * into the guarded region below. Inside the `try`, a schema/JSON failure on
 * self-reported offseason data degrades to `"malformed"` rather than
 * aborting the whole harness batch; every other exception is rethrown
 * immediately via `isRecoverableBreakdownParseError`.
 *
 * `"malformed"` carries only a numeric `issueCount` — deliberately no error
 * message, no field values, no payload fragment: third-party payload
 * content must never reach a log line through this path.
 *
 * `map` overrides the season's registered map for this one call. Absent
 * means resolve exactly as before — `componentMapForSeason(season)`, same
 * call, same position ahead of the `try`. The seam exists so a measurement
 * arm can replay a season under a different component map without editing
 * this package; nothing in the shipped pipeline passes it.
 */
export function tryParseBreakdownPair(
  season: number,
  scoreBreakdownRaw: string | null,
  map?: SeasonComponentMap
): BreakdownParsePairOutcome {
  if (scoreBreakdownRaw === null) return { kind: "absent" };
  const resolved = map ?? componentMapForSeason(season);
  try {
    const rawJson: unknown = JSON.parse(scoreBreakdownRaw);
    const red = resolved.parse(rawJson, "red");
    const blue = resolved.parse(rawJson, "blue");
    return { kind: "parsed", red, blue };
  } catch (err) {
    if (!isRecoverableBreakdownParseError(err)) throw err;
    return { kind: "malformed", issueCount: err instanceof ZodError ? err.issues.length : 0 };
  }
}
