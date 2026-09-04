/**
 * D-2 (quick task 260903-n2o): the single explicit registry mapping every
 * harness/publish algorithm id to how its `selectedOnSeasons` fact is
 * sourced — the seasons (if any) that algorithm's hyperparameters were
 * fitted on, per D-1's `isHeadlineEligible` second clause. An id absent
 * from the registry throws, naming the id, rather than silently returning
 * `[]` — a baseline's "never tuned" claim must be a registered fact, never
 * an accident of an unregistered lookup falling through to empty.
 *
 * This module reads `provenance.tuneSeasons` from the committed VPR version
 * file for the first time anywhere in this repo (D-2: no second record of
 * the same fact is introduced — the version file IS the record).
 *
 * `vpr`'s version-file path below is now IMPORTED from
 * `./promotedVersionPath.js` (quick task 260904-2i9), not a mirror. The
 * mirror existed because `cli.ts` depends on this module
 * (`aggregateScoresForRun`, F-1), and importing `PROMOTED_VPR_VERSION_PATH`
 * back from `cli.ts` really would close a cycle — that reasoning was
 * correct and is exactly why the shared constant now lives in a THIRD leaf
 * module neither `cli.ts` nor this file owns: `promotedVersionPath.ts`
 * imports only `node:path` and `SIGMA1_CODE_VERSION`, so both `cli.ts` and
 * this module can import it with no cycle in either direction. This closes
 * the gap the old mirror carried: `selectionProvenance.test.ts`'s
 * `INDEPENDENTLY_RESOLVED_VPR_VERSION_PATH` remains as the one deliberate,
 * hand-typed witness that this module reads the same committed file the
 * harness loads — the same structural-sharing argument this file already
 * makes one paragraph below for `vpr-adapt` delegating to
 * `resolveOnSearchWinner`, now extended to `vpr`.
 *
 * `vpr-adapt`'s provenance (F-2, quick task 260903-tk6) is NOT a mirror: it
 * DELEGATES to `searchWinner.ts`'s `resolveOnSearchWinner`, the exact same
 * leaf-module resolution `cli.ts`'s `loadSearchWinnerVpr` wraps to decide
 * what actually RUNS for `vpr-adapt`. Sharing one resolver — rather than
 * pinning agreement between two independently-derived condition lists —
 * makes disagreement between "what runs" and "what the flag claims"
 * structurally impossible, the same guarantee `vpr`'s shared import above
 * now provides one level up.
 */
import { existsSync, readFileSync } from "node:fs";
import { selectCorpusSeasons, type Corpus } from "../corpus/db.js";
import { PromotedVersionSchema } from "./promote.js";
import { PROMOTED_VPR_VERSION_PATH } from "./promotedVersionPath.js";
import { resolveParamSets } from "./seasonParamSets.js";
import { aggregateScores, type HarnessPredictionInput, type ScoreSlice } from "./score.js";
import { ON_SEARCH_ARTIFACT_PATH, resolveOnSearchWinner } from "./searchWinner.js";

/**
 * `vpr`'s selected-on seasons for `season`: the selected-on set of the
 * parameter set GOVERNING `season` in the committed, pinned version file —
 * `resolveParamSets(promoted).forSeason(season).selectedOnSeasons`, D-2's
 * per-season generalisation of the old flat `provenance.tuneSeasons` read.
 * Mirrors `applyPromotedOverrides`' (`cli.ts`) own file-presence rule
 * EXACTLY, so this can never disagree with which module `cli.ts`/
 * `publish.ts` actually load for `vpr`. When the file is absent, `cli.ts`
 * falls back to the untuned default module, so the honest answer here is
 * `[]` — the same condition, not a second one. When the file IS present but
 * is a `paramSetsBySeason` file that does not cover `season`,
 * `resolveParamSets`'s own `forSeason` throws, naming the season — a season
 * running fitted parameters must never silently read as "never fitted"
 * (exactly the failure quick tasks 260903-n2o/260903-tk6 exist to close).
 *
 * Split out as `vprSelectedOnSeasonsFromPath` (parameterized by path) so
 * `selectionProvenance.test.ts` can exercise the per-season and
 * uncovered-season behaviors against an in-test synthesized file, without
 * writing a second real file into `data/algorithm-versions/`.
 */
export function vprSelectedOnSeasonsFromPath(path: string, season: number): readonly number[] {
  if (!existsSync(path)) return [];
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const promoted = PromotedVersionSchema.parse(raw);
  return resolveParamSets(promoted).forSeason(season).selectedOnSeasons;
}

function vprSelectedOnSeasons(season: number): readonly number[] {
  return vprSelectedOnSeasonsFromPath(PROMOTED_VPR_VERSION_PATH, season);
}

/**
 * `vpr-adapt`'s selected-on seasons (F-2, quick task 260903-tk6): DELEGATES
 * to `searchWinner.ts`'s `resolveOnSearchWinner` against the SAME
 * `ON_SEARCH_ARTIFACT_PATH` constant `cli.ts`'s `loadSearchWinnerVpr` reads
 * — the same resolution, not a second one, so "what runs" and "what this
 * flag claims" cannot disagree. `undefined` (absent file, unparseable JSON,
 * no matching `winnerIndex`, or a param shape this code version cannot
 * read) means `[]`: the same untuned-fallback condition `loadSearchWinnerVpr`
 * degrades to, never a second, independently-decided one.
 *
 * A winner that DOES resolve but whose artifact records no top-level
 * `seasons` field THROWS, naming the artifact path — unlike the absent-file
 * case, this is a module that IS about to run with fitted parameters, and a
 * silent `[]` here would let it read as "never fitted" on the headline
 * eligibility flag while it actually scores with real, selected-on
 * parameters. That silent mismatch is exactly the failure F-2 exists to
 * close, not a case to degrade through the same fallback as absence.
 *
 * `season` is IGNORED (quick task 260904-100): a search artifact is one
 * parameter set, selected on one window — it has no per-season governance to
 * resolve, unlike `vpr`'s committed file which can carry D-2's per-season
 * map. The parameter is still part of the signature so this fits the same
 * uniform `(season: number) => readonly number[]` shape every registry entry
 * carries (`score.ts`'s `SelectedOnSeasons`) — no union, no branch.
 */
function vprAdaptSelectedOnSeasons(_season: number): readonly number[] {
  const resolved = resolveOnSearchWinner(ON_SEARCH_ARTIFACT_PATH);
  if (!resolved) return [];
  if (resolved.seasons === undefined) {
    throw new Error(
      `vprAdaptSelectedOnSeasons: ${ON_SEARCH_ARTIFACT_PATH} resolved a search winner that RUNS, but the artifact ` +
        `records no top-level "seasons" field — a fitted module whose provenance silently reads as "never fitted" ` +
        `is exactly the F-2 failure this must not hide. Re-run the search with a tune.ts that records "seasons", ` +
        `or correct the artifact.`
    );
  }
  return resolved.seasons;
}

/**
 * The registry itself, one entry per id in `cli.ts`'s `ALGORITHMS` and
 * `publish.ts`'s `BASE_PUBLISH_ALGORITHMS`.
 */
const SELECTED_ON_SEASONS_SOURCES: Readonly<Record<string, (season: number) => readonly number[]>> = {
  // Never-tuned baselines — no fitted hyperparameters at all, so declaring
  // `[]` is the honest, explicit fact a baseline is required to state under
  // D-2, not an omission standing in for it.
  opr: () => [],
  epa: () => [],
  // Constructed by `makeSigma1` with the versioned DEFAULT parameter set
  // (`packages/core/algorithms/sigma1/index.ts`'s `vprDefaults`/
  // `vprSeasonSd`/`vprNormalCdf` all omit `options.params`, which falls back
  // to `DEFAULT_SIGMA1_PARAMS` inside `makeSigma1` — verified at execution
  // time, 2026-09-03) — never a search winner, so `[]` for the same reason
  // as the untuned baselines above.
  "vpr-defaults": () => [],
  "vpr-seasonsd": () => [],
  "vpr-normalcdf": () => [],
  vpr: vprSelectedOnSeasons,
  "vpr-adapt": vprAdaptSelectedOnSeasons,
};

/**
 * Resolves the selected-on seasons SOURCE for each requested algorithm id,
 * as a real per-algorithm record of season-taking functions ready to pass
 * straight into `AggregateScoresOptions.selectedOnSeasons`. An id absent
 * from the registry throws, naming the id and instructing the operator to
 * register how its selected-on set is sourced — never a silent `[]`.
 *
 * Quick task 260904-100 (D-2): returns FUNCTIONS, not resolved arrays — the
 * governing parameter set (and therefore the selected-on answer) can differ
 * by season under a `paramSetsBySeason` file, so resolving eagerly here,
 * before the caller knows which season it is scoring, would have to pick
 * one season's answer for all of them.
 */
export function selectedOnSeasonsFor(algorithmIds: readonly string[]): Record<string, (season: number) => readonly number[]> {
  const result: Record<string, (season: number) => readonly number[]> = {};
  for (const id of algorithmIds) {
    const source = SELECTED_ON_SEASONS_SOURCES[id];
    if (!source) {
      throw new Error(
        `selectedOnSeasonsFor: no selected-on source registered for algorithm "${id}" — register how its ` +
          `selected-on set is sourced (score.ts's ELIGIBILITY_NOT_CLAIMED sentinel, an explicit [], or a real ` +
          `provenance read) before scoring it (D-2).`
      );
    }
    result[id] = source;
  }
  return result;
}

/**
 * F-1 (quick task 260903-tk6): the SINGLE derivation of `aggregateScores`'
 * eligibility pair, wrapping `aggregateScores` itself rather than returning
 * the pair for a caller to spread — `cli.ts:777` and `publish.ts:1517/1998`
 * used to independently build the identical
 * `{corpusSeasons: selectCorpusSeasons(db), selectedOnSeasons: selectedOnSeasonsFor(ids)}`
 * literal, which is exactly why fixing one flag-bearing call site's eligibility
 * bug left the other exposed with the whole suite still green. A helper that
 * merely returns the pair would still leave a spreadable options literal at
 * each call site — the same regression shape stays representable. This
 * wrapper leaves NO eligibility argument at either call site at all.
 *
 * `corpusSeasons` is sourced from `selectCorpusSeasons(db)` — the seasons the
 * CORPUS holds, never a range or loop variable a given invocation asked to
 * replay. A range-derived value would let a single-season republish
 * (`--seasons 2026` alone) silently flip a live key's eligibility, since
 * headline eligibility is a property of the data available, not of what a
 * given run chose to score.
 *
 * `selectedOnSeasons` is sourced from `selectedOnSeasonsFor(algorithmIds)` —
 * this module's own single explicit registry — never a second,
 * independently-derived resolution built at the call site.
 */
export function aggregateScoresForRun(
  db: Corpus,
  predictions: readonly HarnessPredictionInput[],
  algorithmIds: readonly string[]
): ScoreSlice[] {
  return aggregateScores(predictions, {
    corpusSeasons: selectCorpusSeasons(db),
    selectedOnSeasons: selectedOnSeasonsFor(algorithmIds),
  });
}
