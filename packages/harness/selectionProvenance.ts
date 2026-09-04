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
 * The version-file and search-artifact paths below are DERIVED from
 * `SIGMA1_CODE_VERSION`, the same way `cli.ts`'s `PROMOTED_VPR_VERSION_PATH`
 * and `tune.ts`'s `INCUMBENT_VERSION_PATH` already are — so the next
 * `SIGMA1_CODE_VERSION` bump moves this module's read target by
 * construction. This module does NOT import those constants from `cli.ts`:
 * `cli.ts` will come to depend on this module (to source the eligibility
 * argument at its own `aggregateScores` call site), and importing back from
 * `cli.ts` would create an import cycle. `selectionProvenance.test.ts`
 * instead asserts, independently, that this module's own resolution agrees
 * with `resolvePublishAlgorithms(undefined)`'s — that agreement is what
 * actually protects against the two-independently-derived-resolutions
 * failure `cli.ts`'s own `applyPromotedOverrides` comment names, not a
 * shared import.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { SIGMA1_CODE_VERSION } from "../core/algorithms/sigma1/params.js";
import { selectCorpusSeasons, type Corpus } from "../corpus/db.js";
import { PromotedVersionSchema } from "./promote.js";
import { aggregateScores, type HarnessPredictionInput, type ScoreSlice } from "./score.js";

const ALGORITHM_VERSIONS_DIR = join("data", "algorithm-versions");

/**
 * Mirrors `cli.ts`'s `PROMOTED_VPR_VERSION_PATH` construction exactly (same
 * directory, same filename pattern) so the next `SIGMA1_CODE_VERSION` bump
 * moves both by construction rather than requiring two hand-edits to stay
 * in sync.
 */
const PROMOTED_VPR_VERSION_PATH = join(ALGORITHM_VERSIONS_DIR, `vpr@${SIGMA1_CODE_VERSION}+tuned-2026-08.json`);

/** Mirrors `cli.ts`'s `ON_SEARCH_ARTIFACT_PATH` — the adaptation-ON joint search's own gitignored winner artifact. */
const ON_SEARCH_ARTIFACT_PATH = join("reports", "tune-joint-on.json");

/**
 * The narrow, `.passthrough()`-tolerant read of a `tune.ts --stage joint`
 * search artifact this module needs — just the `seasons` field
 * `buildJointArtifact` (`tune.ts`) records at the top level. Follows the
 * same narrow-artifact-read idiom as `promote.ts`'s
 * `TuneSearchOutputMinimalSchema` / `eventScopeDiagnostic.ts`'s
 * `ArtifactSliceSchema`: a truncated or hand-edited artifact fails a
 * `safeParse` rather than a raw property-access `TypeError`.
 */
const JointArtifactSelectionSchema = z.object({ seasons: z.array(z.number().int()) }).passthrough();

/**
 * `vpr`'s selected-on seasons: `provenance.tuneSeasons` from the committed,
 * pinned version file — mirroring `applyPromotedOverrides`' (`cli.ts`) own
 * file-presence rule EXACTLY, so this can never disagree with which module
 * `cli.ts`/`publish.ts` actually load for `vpr`. When the file is absent,
 * `cli.ts` falls back to the untuned default module, so the honest answer
 * here is `[]` — the same condition, not a second one.
 */
function vprSelectedOnSeasons(): readonly number[] {
  if (!existsSync(PROMOTED_VPR_VERSION_PATH)) return [];
  const raw: unknown = JSON.parse(readFileSync(PROMOTED_VPR_VERSION_PATH, "utf8"));
  const promoted = PromotedVersionSchema.parse(raw);
  return promoted.provenance.tuneSeasons;
}

/**
 * `vpr-adapt`'s selected-on seasons: `applyPromotedOverrides` (`cli.ts`)
 * swaps this id for the adaptation-ON joint search's own winner
 * (`reports/tune-joint-on.json`) when present, falling back to the plain
 * `vprAdaptive` (defaults + `adaptationEnabled: true`) module — which has no
 * fitted parameters at all — when absent. `reports/` is gitignored, so
 * absence is the normal case; degrading to `[]` there matches
 * `loadSearchWinnerVpr`'s own degrade-to-untuned behavior exactly. A
 * present-but-unparseable artifact degrades the same way, never throws —
 * this function answers a provenance question, it does not gate a harness
 * run.
 */
function vprAdaptSelectedOnSeasons(): readonly number[] {
  if (!existsSync(ON_SEARCH_ARTIFACT_PATH)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(ON_SEARCH_ARTIFACT_PATH, "utf8"));
  } catch {
    return [];
  }
  const parsed = JointArtifactSelectionSchema.safeParse(raw);
  if (!parsed.success) return [];
  return parsed.data.seasons;
}

/**
 * The registry itself, one entry per id in `cli.ts`'s `ALGORITHMS` and
 * `publish.ts`'s `BASE_PUBLISH_ALGORITHMS`.
 */
const SELECTED_ON_SEASONS_SOURCES: Readonly<Record<string, () => readonly number[]>> = {
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
 * Resolves the selected-on seasons for each requested algorithm id, as a
 * real per-algorithm record ready to pass straight into
 * `AggregateScoresOptions.selectedOnSeasons`. An id absent from the
 * registry throws, naming the id and instructing the operator to register
 * how its selected-on set is sourced — never a silent `[]`.
 */
export function selectedOnSeasonsFor(algorithmIds: readonly string[]): Record<string, readonly number[]> {
  const result: Record<string, readonly number[]> = {};
  for (const id of algorithmIds) {
    const source = SELECTED_ON_SEASONS_SOURCES[id];
    if (!source) {
      throw new Error(
        `selectedOnSeasonsFor: no selected-on source registered for algorithm "${id}" — register how its ` +
          `selected-on set is sourced (score.ts's ELIGIBILITY_NOT_CLAIMED sentinel, an explicit [], or a real ` +
          `provenance read) before scoring it (D-2).`
      );
    }
    result[id] = source();
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
