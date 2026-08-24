/**
 * The single source of truth for what the URL carries (D-14, NAV-05). Every
 * field either coerces to a known-valid value or is structurally impossible
 * to construct outside its own declared valid states — a hand-edited or
 * malformed search param can therefore only ever resolve to one of this
 * schema's own declared states before any component reads it (T-05-02).
 *
 * Per D-14 the URL carries year, algorithm, sort field and sort direction;
 * the CURRENT VIEW is the pathname itself (`/teams`, `/events`, `/compare`)
 * — it needs no search param of its own. Do not add a `view` field here: the
 * route segment already IS that fact, and a redundant `view` param would be
 * a second, driftable source of the same information.
 */
import { z } from "zod";
import { PUBLISHED_ALGORITHM_IDS, type PublishedAlgorithmId } from "../../../../packages/harness/publishedAlgorithms.js";
import { CURRENT_SEASON, SEASONS } from "./seasons.js";
import { metricKeysFor } from "./metricKeys.js";
import { resolveSortKey } from "./resolveSortKey.js";

const KNOWN_SEASONS = new Set<number>(SEASONS);

/**
 * The default algorithm every route without an explicit `?algorithm=`
 * resolves to. Sigma1 (this project's own headline algorithm) rather than
 * OPR/EPA, matching 05-RESEARCH.md Pattern 1's example schema.
 */
const DEFAULT_ALGORITHM: PublishedAlgorithmId = "sigma1";

/**
 * `year`: coerced to an integer and constrained to the known season list
 * (`seasons.ts`'s `SEASONS`) — anything else, INCLUDING a missing param
 * (`z.coerce.number()` on `undefined` produces `NaN`, which fails both the
 * base number check and the refinement below), falls back to
 * `CURRENT_SEASON` via `.catch()`.
 *
 * `algorithm`: an enum over the published algorithm ids
 * (`packages/harness/publishedAlgorithms.ts`'s `PUBLISHED_ALGORITHM_IDS`,
 * the same build-time constant the algorithm dropdown renders from before
 * any manifest fetch resolves) — anything outside that closed set,
 * including a missing param, falls back to `DEFAULT_ALGORITHM` via
 * `.catch()`.
 */
export const RootSearchSchema = z.object({
  year: z.coerce
    .number()
    .int()
    .refine((year) => KNOWN_SEASONS.has(year))
    .catch(CURRENT_SEASON),
  algorithm: z.enum(PUBLISHED_ALGORITHM_IDS).catch(DEFAULT_ALGORITHM),
});

export type RootSearch = z.infer<typeof RootSearchSchema>;

/**
 * Extends (never restates) `RootSearchSchema` — `.extend()` keeps the two
 * schemas from drifting apart on the fields they share.
 *
 * `sort`: an optional metric key. Typed only as "a string" HERE, on
 * purpose — the valid key SET for a metric key depends on the selected
 * (algorithm, season) pair (`metricKeys.ts`'s `metricKeysFor`), which this
 * static schema cannot know in isolation. `resolveSortKey` (Task 1) is the
 * runtime check that turns an invalid/stale key into the total-key
 * fallback; this schema's only job is making sure `sort` is a plain string
 * (or absent) before it ever reaches that check — never an object, array,
 * or other shape that could reach a downstream comparison/render in an
 * unexpected way.
 *
 * `sortDir`: an ascending/descending enum, defaulting (and falling back on
 * anything else, including a missing param) to descending.
 */
export const TeamsSearchSchema = RootSearchSchema.extend({
  sort: z.string().optional(),
  sortDir: z.enum(["asc", "desc"]).catch("desc"),
});

export type TeamsSearch = z.infer<typeof TeamsSearchSchema>;

/**
 * The ONE shared year-change handler (D-11) — every year control (this
 * plan's `YearSelect.tsx`, and any later plan's own year control) calls
 * this rather than re-deriving the same preserve-filters-and-resolve-sort
 * logic. Preserves every existing field on `current` (filters, sort
 * direction, column state — whatever `TeamsSearch` carries) and re-resolves
 * `sort` through the SAME `resolveSortKey` function the algorithm-change
 * path uses (Task 1's own "one function, both triggers" contract) — the
 * valid metric-key set is season-dependent as well as algorithm-dependent,
 * so a plain year change can invalidate a sort just as an algorithm change
 * can.
 *
 * D-12 EXTENSION POINT (Phase 7, out of this plan's scope): on an event
 * *DETAIL* page, a year change should map to the SAME EVENT CODE in the
 * target year when it exists, otherwise fall back to that year's Events
 * list. That is a PATHNAME rewrite (a different route entirely), not a
 * search-param recompute — it belongs at the `navigate()` call site that
 * owns routing, alongside a call to this function, not as a second
 * `applyYearChange`-shaped function. Phase 7 extends the call site, not
 * this contract.
 */
export function applyYearChange(current: TeamsSearch, newYear: number): TeamsSearch {
  return {
    ...current,
    year: newYear,
    sort: current.sort === undefined ? undefined : resolveSortKey(current.sort, metricKeysFor(current.algorithm, newYear)),
  };
}
