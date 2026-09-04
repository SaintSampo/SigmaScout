/**
 * D-2 (rolling-origin-hyperparameter-tuning, quick task 260904-100): the ONE
 * place a committed version file's parameter sets become runnable modules.
 *
 * `promote.ts` writes either a single `params` (one set for every season) or
 * a `paramSetsBySeason` map (D-1/D-2: one committed version, per-season
 * sets, one prediction-stream digest over the whole replay — D-5). Every
 * replay driver in this repo is a season loop that was written against the
 * ONE-module-per-run assumption (three independent copies: `cli.ts`'s
 * `runSeasons`, `tune.ts`'s `runBoundedSeasons`, and `publish.ts`'s own
 * season loop — see the plan's `<findings>` item 1 for why none of them can
 * be safely edited to add a per-season module swap). The fix that survives
 * three independent copies is to move the swap DOWN into the module those
 * loops already receive: `makeSeasonalSigma1` below builds one
 * `AlgorithmModule<Sigma1State>` that dispatches to the season-appropriate
 * underlying `makeSigma1` module internally, so every driver — present and
 * future — gets the per-season swap by construction, with no loop signature
 * change anywhere.
 *
 * `PromotedVersion` is imported TYPE-ONLY from `./promote.js` (no runtime
 * edge), so `promote.ts` is free to import this module's schemas as VALUES
 * without creating an import cycle — TypeScript elides a type-only import
 * from the compiled JS module graph entirely.
 */
import type { PromotedVersion } from "./promote.js";
import { z } from "zod";
import { makeSigma1, type Sigma1State } from "../core/algorithms/sigma1/index.js";
import { DEFAULT_SIGMA1_PARAMS, SIGMA1_CODE_VERSION, Sigma1ParamsSchema } from "../core/algorithms/sigma1/params.js";
import type { AlgorithmModule, MatchResult, SeasonBoundary, TeamMetrics, UpcomingMatch } from "../core/algorithms/types.js";
import type { WinProbMode } from "../core/algorithms/sigma1/index.js";

/**
 * One season's parameter set PLUS the provenance facts that are per-season
 * rather than per-file. Every optional field mirrors the same-named field
 * on `promote.ts`'s `ProvenanceSchema` — a carried-forward incumbent set
 * brings its own `paramOverrides`/`note` (e.g. the shipped `linkC = 0.5`
 * correction) WITH it into the season it governs, instead of stranding it at
 * a file level that no longer describes every season under a per-season map.
 */
export const SeasonParamSetSchema = z.object({
  params: Sigma1ParamsSchema,
  /**
   * REQUIRED — this is the eligibility fact `selectionProvenance.ts` reads
   * (D-2). A never-tuned/carried set states its selected-on seasons
   * explicitly (an empty array is a real, honest answer for some sets); it
   * is never left implicit.
   */
  selectedOnSeasons: z.array(z.number().int()),
  sourceKind: z.enum(["search-winner", "carried-version"]),
  sourceArtifact: z.string().min(1),
  sourceArtifactSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  objective: z.number().optional(),
  objectiveAppliesToPromotedParams: z.boolean().optional(),
  adaptationMode: z.enum(["on", "off"]).optional(),
  paramOverrides: z.record(z.string(), z.union([z.number(), z.boolean()])).optional(),
  note: z.string().min(1).optional(),
  derivedFromVersion: z.string().min(1).optional(),
});

export type SeasonParamSet = z.infer<typeof SeasonParamSetSchema>;

/** Keyed by a 4-digit year string (`"2022"`), never a numeric key — matches every other season-keyed record in this codebase. */
export const ParamSetsBySeasonSchema = z.record(z.string().regex(/^\d{4}$/), SeasonParamSetSchema);

/**
 * The uniform, format-erasing view over EITHER a legacy single-`params` file
 * or a `paramSetsBySeason` file — every caller downstream of
 * `resolveParamSets` sees the same `SeasonParamSet` shape regardless of
 * which format it read.
 */
export interface ResolvedParamSets {
  /** `true` for a legacy `params` file: the SAME set governs every season, and `forSeason` never throws. */
  readonly isUniform: boolean;
  /** The `paramSetsBySeason` map's own covered seasons, ascending. Empty (meaningless) when `isUniform` is `true` — the one set covers every season, not a fixed list of them. */
  readonly seasons: readonly number[];
  /**
   * Resolves `season`'s governing parameter set. For a `paramSetsBySeason`
   * file, throws by name (naming both the requested season and the covered
   * set) when `season` is absent from the map — a season a promotion did
   * not cover is NEVER silently substituted with another season's set. For a
   * legacy `params` file, never throws.
   */
  forSeason(season: number): SeasonParamSet;
}

/**
 * Builds the uniform view described above. For a `paramSetsBySeason` file,
 * `forSeason` reads straight from the map. For a legacy `params` file, ONE
 * `SeasonParamSet` is synthesized from `provenance`'s existing per-file
 * fields (`tuneSeasons` -> `selectedOnSeasons`, `searchArtifact`,
 * `paramOverrides`/`note`/`adaptationMode`/`objective` carried forward) and
 * returned for every season asked — this is what keeps
 * `vpr@7.0.0+tracer-check.json` and the incumbent validating and behaving
 * exactly as they do today, with no re-promotion required.
 */
export function resolveParamSets(promoted: PromotedVersion): ResolvedParamSets {
  if (promoted.paramSetsBySeason !== undefined) {
    const map = promoted.paramSetsBySeason;
    const seasons = Object.keys(map)
      .map((key) => Number.parseInt(key, 10))
      .sort((a, b) => a - b);
    return {
      isUniform: false,
      seasons,
      forSeason(season: number): SeasonParamSet {
        const entry = map[String(season)];
        if (!entry) {
          throw new Error(
            `resolveParamSets: season ${season} is not covered by this paramSetsBySeason map (covers: ` +
              `${seasons.join(", ") || "none"}) — a season absent from the map is never silently substituted ` +
              `with another season's set.`
          );
        }
        return entry;
      },
    };
  }

  // Unreachable given `PromotedVersionSchema`'s own exactly-one-of check —
  // stated rather than assumed away, matching this module's no-silent-guess
  // rule throughout.
  if (promoted.params === undefined) {
    throw new Error("resolveParamSets: promoted version carries neither params nor paramSetsBySeason");
  }

  const synthesized: SeasonParamSet = {
    params: promoted.params,
    selectedOnSeasons: [...(promoted.provenance.tuneSeasons ?? [])],
    sourceKind: "carried-version",
    // Defensive fallback only — `PromotedVersionSchema`'s own check (Task 3)
    // requires `searchArtifact` whenever `params` is present, so this branch
    // is never actually reached with it undefined; the fallback exists only
    // so this file's own types stay correct once that field becomes
    // schema-optional.
    sourceArtifact: promoted.provenance.searchArtifact ?? "(unknown)",
    sourceArtifactSha256: promoted.provenance.searchArtifactSha256,
    objective: promoted.provenance.objective,
    objectiveAppliesToPromotedParams: promoted.provenance.objectiveAppliesToPromotedParams,
    adaptationMode: promoted.provenance.adaptationMode,
    paramOverrides: promoted.provenance.paramOverrides,
    note: promoted.provenance.note,
    derivedFromVersion: promoted.provenance.derivedFromVersion,
  };
  return {
    isUniform: true,
    seasons: [],
    forSeason(): SeasonParamSet {
      return synthesized;
    },
  };
}

/**
 * Mirrors `sigma1/index.ts`'s private `deriveSeasonFromEventKey` (leading
 * 4-digit year, TBA's own event-key convention) exactly, and is duplicated
 * rather than imported: that function is module-private to `sigma1/index.ts`
 * (it derives a season only as an `update`/`predict` FALLBACK when
 * `state.season` is not yet resolved), while this is the primary, always-run
 * season lookup this facade's per-match dispatch depends on. Two call sites
 * for the same small, stable rule is cheaper than exporting an
 * implementation-private helper across a module boundary for it.
 */
function seasonOfEventKey(eventKey: string): number {
  const season = Number.parseInt(eventKey.slice(0, 4), 10);
  if (!Number.isInteger(season)) {
    throw new Error(`seasonOfEventKey: could not derive a season from event key "${eventKey}" (expected a leading 4-digit year)`);
  }
  return season;
}

export interface MakeSeasonalSigma1Options {
  readonly id: string;
  readonly linkMode: WinProbMode;
}

/**
 * D-2's module swap, relocated from the replay driver into the module
 * itself so every one of the three independent season loops (`cli.ts`,
 * `tune.ts`, `publish.ts`) gets it without any loop-signature change (see
 * this file's header). Builds one real `makeSigma1` module per season
 * actually encountered — for a `paramSetsBySeason` file this happens
 * eagerly, once per covered season, at construction time (mirroring the
 * Worker's own "modules constructed ONCE per tick, never once per event"
 * discipline, `apps/worker/src/scheduled.ts`); for a legacy uniform file
 * there is exactly one governing set, so the (single) module is built
 * lazily on first use and cached — but it is STILL reached through the same
 * per-season dispatch path below, never a bare `makeSigma1` bypass, which
 * is what keeps the D-4 equivalence gate honest: the gate exercises the
 * facade's actual season-lookup machinery, not a shortcut around it.
 */
export function makeSeasonalSigma1(promoted: PromotedVersion, options: MakeSeasonalSigma1Options): AlgorithmModule<Sigma1State> {
  const resolved = resolveParamSets(promoted);
  // Deliberately `SIGMA1_CODE_VERSION` (the RUNNING code's own constant),
  // never `promoted.codeVersion` (whatever label the file happens to carry)
  // — this mirrors `makeSigma1`'s own long-standing convention exactly
  // (`sigma1/index.ts`: `` `${SIGMA1_CODE_VERSION}+${options.paramSetName}` ``,
  // never a caller-supplied codeVersion). A version string exists to
  // describe the code ACTUALLY producing a prediction; trusting a
  // potentially stale file field instead would let a promoted-but-outdated
  // `codeVersion` label misrepresent what is really executing.
  const version = `${SIGMA1_CODE_VERSION}+${promoted.paramSetName}`;

  const modulesBySeason = new Map<number, AlgorithmModule<Sigma1State>>();
  for (const season of resolved.seasons) {
    const entry = resolved.forSeason(season);
    modulesBySeason.set(
      season,
      makeSigma1({ id: options.id, linkMode: options.linkMode, params: entry.params, paramSetName: promoted.paramSetName })
    );
  }

  function moduleForSeason(season: number): AlgorithmModule<Sigma1State> {
    const cached = modulesBySeason.get(season);
    if (cached) return cached;
    // A per-season file's `forSeason` throws here for a season the map does
    // not cover, naming it. A uniform (legacy `params`) file's `forSeason`
    // never throws — this lazily fills the cache with the one governing set
    // the first time each season is actually seen.
    const entry = resolved.forSeason(season);
    const built = makeSigma1({ id: options.id, linkMode: options.linkMode, params: entry.params, paramSetName: promoted.paramSetName });
    modulesBySeason.set(season, built);
    return built;
  }

  // `initState` reads no params at all (verified: `sigma1/index.ts`'s
  // `initState` is a bare literal) — any built module's `initState` is
  // identical, so a dedicated bootstrap module (built with the untuned
  // defaults, never actually used for `predict`/`update`) is enough. This
  // sidesteps needing to know which season to ask for first, in either the
  // uniform or per-season case.
  const bootstrapModule = makeSigma1({ id: options.id, linkMode: options.linkMode, paramSetName: promoted.paramSetName });

  return {
    id: options.id,
    // D-1: one identity for the whole map — `{codeVersion}+{paramSetName}`,
    // never a per-season version string.
    version,
    initState: (teams: string[]) => bootstrapModule.initState(teams),
    predict: (state: Sigma1State, match: UpcomingMatch) => moduleForSeason(seasonOfEventKey(match.eventKey)).predict(state, match),
    update: (state: Sigma1State, result: MatchResult) => moduleForSeason(seasonOfEventKey(result.eventKey)).update(state, result),
    /**
     * D-3: at a boundary, the INCOMING season's set owns
     * `carryMeanReversion`/`carryPriorYearShare`/`consistencyCarryDecay` —
     * those three shape the incoming season's OPENING PRIOR, not the
     * outgoing season's results, so this always resolves against
     * `boundary.toSeason`, never `boundary.fromSeason`. This is a real fork,
     * stated here rather than left for a later reader to guess at.
     */
    carrySeason: (state: Sigma1State, boundary: SeasonBoundary): Sigma1State => {
      const target = moduleForSeason(boundary.toSeason);
      if (!target.carrySeason) {
        throw new Error(`makeSeasonalSigma1: season ${boundary.toSeason}'s module has no carrySeason implementation`);
      }
      return target.carrySeason(state, boundary);
    },
    teamMetrics: (state: Sigma1State, teams?: readonly string[]): TeamMetrics => {
      // `state.season` is `null` only before any `update()` has folded a
      // match — nothing has been observed yet, so every covered season's
      // module reports the identical empty snapshot. The earliest covered
      // season is used in that case: identical-by-construction in the
      // uniform case (there is only ever one module), and an arbitrary but
      // stable choice in the per-season case (there is no data yet to
      // prefer one season's module over another).
      const season = state.season ?? (resolved.isUniform ? 0 : resolved.seasons[0]!);
      return moduleForSeason(season).teamMetrics(state, teams);
    },
  };
}
