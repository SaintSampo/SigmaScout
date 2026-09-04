/**
 * F-2 (quick task 260903-tk6): the SINGLE resolution of a `tune.ts --stage
 * joint` search artifact's winning candidate — the one decision both
 * `cli.ts`'s `loadSearchWinnerVpr` (what actually RUNS for `vpr-adapt`) and
 * `selectionProvenance.ts`'s `vprAdaptSelectedOnSeasons` (what the
 * headline-eligibility flag CLAIMS `vpr-adapt` was selected on) must read,
 * so the two can never disagree.
 *
 * This is a LEAF module: it imports `node:fs`/`node:path`/`zod`,
 * `Sigma1ParamsSchema`/`SIGMA1_CODE_VERSION` from
 * `../core/algorithms/sigma1/params.js`, and `TuneSearchOutputMinimalSchema`
 * from `./promote.js` — nothing else from the harness. Both `cli.ts` and
 * `selectionProvenance.ts` depend on THIS module; this module depends on
 * neither of them.
 *
 * Direct delegation via importing `loadSearchWinnerVpr` from `cli.ts` into
 * `selectionProvenance.ts` was rejected: `cli.ts` already imports
 * `aggregateScoresForRun` from `selectionProvenance.ts` (F-1), so importing
 * `loadSearchWinnerVpr` back would close a real cycle
 * (`cli.ts` -> `selectionProvenance.ts` -> `cli.ts`). A cycle-free import
 * would ALSO fail on a genuine signature mismatch: `loadSearchWinnerVpr`
 * returns an `AlgorithmModule`, which carries no `seasons` field, so even a
 * hypothetical cycle-free import could not answer the provenance question.
 * Moving the decision DOWN into this leaf module dissolves both problems:
 * `cli.ts` wraps this module's result with `makeSigma1`;
 * `selectionProvenance.ts` reads only its `.seasons`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SIGMA1_CODE_VERSION, Sigma1ParamsSchema, type Sigma1Params } from "../core/algorithms/sigma1/params.js";
import { TuneSearchOutputMinimalSchema } from "./promote.js";

/**
 * D-06/D-08/ALGO-05 (plan 03-06): the adaptation-ON joint search's own
 * winning candidate — "each search's own best configuration," not a bare
 * defaults-plus-flag module. `reports/` is gitignored (D-14: a search
 * evaluation is an experiment, not a version), so this file is NOT always
 * present — both `cli.ts` and `selectionProvenance.ts` fall back to their
 * own untuned defaults when `resolveOnSearchWinner` returns `undefined`.
 */
export const ON_SEARCH_ARTIFACT_PATH = join("reports", "tune-joint-on.json");

export interface ResolvedSearchWinner {
  /** The winning candidate's params, parsed and current-shape-valid — NOT yet restored to the versioned `rpMonteCarloDraws` default; callers that build a running module do that restore themselves (`cli.ts`'s `loadSearchWinnerVpr`), exactly as before this module existed. */
  readonly params: Sigma1Params;
  /**
   * The artifact's own top-level `seasons` field, read through the SAME
   * parse the params came from. OPTIONAL: the pre-existing
   * `loadSearchWinnerVpr` fixtures (`promotedOverrides.test.ts`) never
   * recorded one, and a resolved winner that omits it is a real state a
   * caller must handle explicitly — never silently coerced to `[]`, which
   * would let a genuinely-fitted module's provenance read as "never fitted."
   */
  readonly seasons: readonly number[] | undefined;
}

/**
 * The five gates, carried verbatim from the pre-F-2 `loadSearchWinnerVpr`,
 * in the same order and with the same outcomes — this function is now the
 * ONLY place they are evaluated:
 *
 *   1. absent file -> `undefined`.
 *   2. malformed JSON or a `TuneSearchOutputMinimalSchema` parse failure ->
 *      throws, exactly as `JSON.parse`/`.parse` already did.
 *   3. `winnerIndex` names no candidate -> `undefined`.
 *   4. a winner whose params fail `Sigma1ParamsSchema.safeParse` ->
 *      `undefined`, plus the existing stale-shape warning, word for word
 *      (renamed to this function's own name).
 *   5. otherwise, the winner's parsed params plus the artifact's own
 *      (optional) top-level `seasons`.
 */
export function resolveOnSearchWinner(searchArtifactPath: string): ResolvedSearchWinner | undefined {
  if (!existsSync(searchArtifactPath)) return undefined;
  const raw: unknown = JSON.parse(readFileSync(searchArtifactPath, "utf8"));
  const output = TuneSearchOutputMinimalSchema.parse(raw);
  const winner = output.candidates.find((c) => c.index === output.winnerIndex);
  if (!winner) return undefined;
  const parsed = Sigma1ParamsSchema.safeParse(winner.params);
  if (!parsed.success) {
    console.warn(
      `WARNING [resolveOnSearchWinner]: ${searchArtifactPath} records a parameter set this code version cannot read ` +
        `(SIGMA1_CODE_VERSION is now ${SIGMA1_CODE_VERSION}; D-T1/D-T2 renamed five fields and removed two). ` +
        `Ignoring it and falling back, exactly as for an absent artifact. Re-run the search to produce a current-shape artifact.`
    );
    return undefined;
  }
  return { params: parsed.data, seasons: output.seasons };
}
