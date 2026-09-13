/**
 * D-2 (quick task 260903-n2o): the single explicit registry mapping every
 * harness/publish algorithm id to how its `selectedOnSeasons` fact is
 * sourced — the seasons (if any) that algorithm's hyperparameters were
 * fitted on, per D-1's `isHeadlineEligible` second clause. An id absent
 * from the registry throws, naming the id, rather than silently returning
 * `[]` — a baseline's "never tuned" claim must be a registered fact, never
 * an accident of an unregistered lookup falling through to empty.
 *
 * The retired Sigma1 core (deleted by quick task 260913-it4) was the only
 * algorithm whose selected-on set was read from a committed version file or a
 * search artifact; its registry entries and those readers were deleted with it.
 */
import { selectCorpusSeasons, type Corpus } from "../corpus/db.js";
import { aggregateScores, type HarnessPredictionInput, type ScoreSlice } from "./score.js";

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
  // BPR's constants were frozen once on 2016-2022 evidence and are never
  // re-tuned per season, so it has no selected-on set for the same reason
  // opr and epa do not. Deliberately NOT the seasons its design used: a
  // selected-on season means "a search picked this parameter set here", and
  // BPR ran no per-season search. Keyed `spr` since quick task 260912-ivg
  // Stage 1 renamed the WRITE-tier wire id (this registry mirrors
  // `cli.ts`'s `ALGORITHMS` and `publish.ts`'s `BASE_PUBLISH_ALGORITHMS`,
  // both of which key on `spr` as of the same task).
  spr: () => [],
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
