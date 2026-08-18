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
import { ZodError } from "zod";

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

/**
 * T-03-18b (security audit, phase 03): true only for a `ZodError` (a raw
 * corpus `score_breakdown` payload that failed a season's Zod schema) or a
 * `SyntaxError` (raw corpus text that is not even valid JSON) — both are the
 * SAME class of untrusted, self-reported third-party payload defect
 * `tryParseBreakdownPair` below recovers from. Everything else —
 * `componentMapForSeason`'s unmapped-season `Error`,
 * `assertFiniteComponents`'s plain `Error`, or any future non-Zod defect
 * inside a season module — is deliberately NOT recoverable and must keep
 * propagating and abort loudly (T-03-21: this predicate is the direct,
 * unit-tested narrowness proof the security review required, generalizing
 * the bare `catch` precedent at `identifiability.ts:239-249` — this control
 * is strictly NARROWER than that precedent, since a bare `catch` would
 * swallow all three of the loud cases above too).
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
 * T-03-18b: the guarded replacement for calling `parseBreakdown` twice (once
 * per side) at the two call sites this closes
 * (`sigma1/index.ts`/`epa.ts`, both formerly `:735-736`/`:432-433`).
 * Precedent: `identifiability.ts:239-249`'s bare `catch` around the same
 * `parseBreakdown` calls, generalized here into a shared, directly-tested
 * helper both algorithms use instead of each duplicating the narrowing
 * logic (D-Q1).
 *
 * Parses BOTH alliances from a SINGLE `JSON.parse` of `scoreBreakdownRaw`
 * (D-Q1) — each season map's `parse` already validates the WHOLE `{red,
 * blue}` payload before selecting one `side`, so the two sides already
 * succeed or fail together today; pairing them here removes a duplicated
 * `JSON.parse` of the same string and is a structural no-op relative to two
 * separate `parseBreakdown` calls on the success path, never a semantic
 * change.
 *
 * `componentMapForSeason(season)` is resolved BEFORE the `try` entirely, so
 * an unregistered season stays a loud, unrecoverable throw (T-03-21) — never
 * folded into the guarded region below. Inside the `try`, a schema/JSON
 * failure on self-reported offseason data (measured: 1,004/4,757 2024
 * offseason matches carrying a breakdown fail this parse, phase-03 security
 * audit) degrades to `"malformed"` rather than aborting the whole harness
 * batch (T-03-18b) — every other exception is rethrown immediately via
 * `isRecoverableBreakdownParseError` (T-03-21).
 *
 * `"malformed"` carries only a numeric `issueCount` (a `ZodError`'s issue
 * count, or 0 for a `SyntaxError`) — deliberately no error message, no field
 * values, no payload fragment (T-03-27: third-party payload content must
 * never reach a log line through this path).
 */
export function tryParseBreakdownPair(season: number, scoreBreakdownRaw: string | null): BreakdownParsePairOutcome {
  if (scoreBreakdownRaw === null) return { kind: "absent" };
  const map = componentMapForSeason(season);
  try {
    const rawJson: unknown = JSON.parse(scoreBreakdownRaw);
    const red = map.parse(rawJson, "red");
    const blue = map.parse(rawJson, "blue");
    return { kind: "parsed", red, blue };
  } catch (err) {
    if (!isRecoverableBreakdownParseError(err)) throw err;
    return { kind: "malformed", issueCount: err instanceof ZodError ? err.issues.length : 0 };
  }
}
