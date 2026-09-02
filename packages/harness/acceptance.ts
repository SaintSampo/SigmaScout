/**
 * D-T7's pre-committed acceptance rule (quick task 260901-trz), as shared
 * machinery rather than a decision re-derived inside whichever runner happens
 * to need it.
 *
 * ## `keep-incumbent` is a SUCCESSFUL result
 *
 * The single most important contract in this file: a search that finds
 * nothing above the bar has SUCCEEDED, and its correct output is "keep the
 * incumbent, and here is the bar it could not clear." `decideAcceptance`
 * therefore never throws for a non-accepting comparison — it returns a
 * `keep-incumbent` member of a discriminated union carrying the numbers that
 * produced it. A caller that treats that as an error, exits non-zero on it,
 * widens the bar until something passes, or retries until something is
 * accepted has defeated the entire purpose of pre-committing a bar: the bar
 * only means anything if "nothing qualified" is an outcome the machinery can
 * report calmly. D-T7 says this in as many words, and it is restated here
 * because this file is where a future edit would break it.
 *
 * ## The two conditions, and their asymmetry
 *
 * 1. **The Brier bar.** The candidate must beat the incumbent by more than
 *    `sqrt(2 * ln N) * SE`, where N is the number of evaluations and SE is
 *    the EVENT-BLOCKED paired-difference standard error
 *    (`eventBootstrap.ts` — see that module's header for why the PAIRED SE,
 *    not either side's level SE, is the faithful quantity for a bar on a
 *    difference). At N = 60 that is about 0.0035 Brier.
 * 2. **The score-MAE guardrail.** A VETO over eligibility, never a second
 *    tuned objective. It exists because the `vpr@3.0.0` `±` fix shipped a
 *    +7.0% (2025) / +15.8% (2026) alliance-score MAE regression that both
 *    Brier and SD(z) rated equal-or-better — a real, measured instance of an
 *    objective being blind to a degradation users would see immediately.
 *    Optimizing MAE jointly with Brier would just be a two-objective search
 *    with an unstated weighting; vetoing on it keeps Brier the single
 *    objective while refusing to ship a known regression on a different axis.
 *
 * ## Evaluation order, because it decides what gets REPORTED
 *
 * A candidate is ELIGIBLE when it clears the Brier bar AND passes the MAE
 * veto; the winner is the best eligible candidate. When nothing is eligible,
 * the caller should report the reason that bound the BEST-BRIER candidate —
 * so the report reads "the best candidate was vetoed on score MAE" rather
 * than the far less useful "nothing was accepted". `decideAcceptance` encodes
 * the same precedence for a single comparison: a candidate that fails the bar
 * reports `below-threshold` (the MAE veto is moot for a candidate that was
 * never eligible on Brier), and one that clears the bar but trips the
 * guardrail reports `mae-veto`.
 */

/**
 * The union bound over N evaluations: with N chances to beat the incumbent,
 * the largest of N noise draws is itself larger than any single draw, and
 * `sqrt(2 * ln N)` is the standard bound on how much larger (the expected
 * maximum of N standard normals). Multiplying by the event-blocked
 * standard error turns that into a Brier-scale bar.
 *
 * The bar MOVES with N, which is exactly why D-T7 requires N to be recorded
 * alongside any accept/keep decision: `0.0035 Brier` is not a property of the
 * project, it is a property of "0.001219 SE at 60 evaluations." A result
 * quoted without its N cannot be checked.
 *
 * Throws for `evaluationCount < 2`. At N = 1, `ln 1 = 0` and the expression
 * is exactly 0 — every candidate that is better by any margin at all clears
 * it, which is not a bar. Refusing is the honest response; silently returning
 * 0 would look like a bar and behave like none.
 */
export function acceptanceThreshold(evaluationCount: number, standardError: number): number {
  if (!Number.isInteger(evaluationCount) || evaluationCount < 2) {
    throw new Error(
      `acceptanceThreshold: evaluationCount must be an integer >= 2, got ${evaluationCount} — ` +
        `at N = 1 the union bound sqrt(2 ln N) is exactly 0, which is not a bar`
    );
  }
  if (!Number.isFinite(standardError) || standardError < 0) {
    throw new Error(`acceptanceThreshold: standardError must be a finite non-negative number, got ${standardError}`);
  }
  return Math.sqrt(2 * Math.log(evaluationCount)) * standardError;
}

/**
 * The MAE guardrail's MATERIALITY half. D-T7 says a candidate must not
 * "materially worsen" score MAE without naming a number; 1% of the
 * incumbent's MAE is that number, chosen and stated here rather than left
 * implicit at whatever call site first needed it. The regressions that
 * motivated the guardrail were +7.0% and +15.8% — both clear this by most of
 * an order of magnitude — while the sub-percent wiggles a re-tune produces on
 * an unchanged model do not.
 */
export const ACCEPTANCE_MAE_RELATIVE_TOLERANCE = 0.01;

/**
 * The MAE guardrail's DISTINGUISHABILITY half: the regression must exceed two
 * event-blocked standard errors, i.e. be distinguishable from zero at roughly
 * the resolution the Brier bar already uses (the same "two event-blocked SEs"
 * figure this task's own equivalence gate A is built from). Two conditions
 * rather than one because either alone misfires: a pure relative test vetoes
 * a 1.2% move that is pure noise on a thin slice, and a pure significance
 * test vetoes a 0.2% move measured over 48,000 matches, where almost anything
 * is significant.
 */
export const ACCEPTANCE_MAE_NOISE_MULTIPLE = 2;

/** Why a candidate was not accepted. Both values are normal, reportable outcomes — see this module's header. */
export type KeepIncumbentReason = "below-threshold" | "mae-veto";

/** The numbers behind any decision, carried by BOTH union members so a report never has to reconstruct them. */
interface AcceptanceEvidence {
  /** `incumbentBrier - candidateBrier`: POSITIVE means the candidate is better (Brier is minimized). */
  readonly margin: number;
  /** `acceptanceThreshold(evaluationCount, brierStandardError)` — the bar this comparison was judged against. */
  readonly threshold: number;
  /** D-T7: recorded because the bar moves with it. A decision quoted without this number cannot be checked. */
  readonly evaluationCount: number;
  /** `candidateMae - incumbentMae`: POSITIVE means the candidate is WORSE on alliance-score MAE. */
  readonly maeDelta: number;
  /** `max(ACCEPTANCE_MAE_NOISE_MULTIPLE * maeStandardError, ACCEPTANCE_MAE_RELATIVE_TOLERANCE * |incumbentMae|)` — the larger of the guardrail's two halves, i.e. what `maeDelta` had to exceed for the veto to fire. */
  readonly maeVetoBound: number;
}

export type AcceptanceOutcome =
  | ({ readonly decision: "accept" } & AcceptanceEvidence)
  | ({ readonly decision: "keep-incumbent"; readonly reason: KeepIncumbentReason } & AcceptanceEvidence);

export interface AcceptanceInput {
  /** Mean Brier of the currently promoted parameter set, on data the selection never saw. */
  readonly incumbentBrier: number;
  /** Mean Brier of the challenger, on the SAME matches. */
  readonly candidateBrier: number;
  /** Mean alliance-score MAE of the incumbent, over the SAME population Brier was scored on. */
  readonly incumbentMae: number;
  /** Mean alliance-score MAE of the challenger, over that same population. */
  readonly candidateMae: number;
  /** Event-blocked PAIRED-difference SE of `incumbentBrier - candidateBrier` (`eventBootstrap.ts`). Not either model's level SE. */
  readonly brierStandardError: number;
  /** Event-blocked PAIRED-difference SE of `candidateMae - incumbentMae`. */
  readonly maeStandardError: number;
  /** D-T7's N: how many candidates were evaluated in the search this comparison concludes. */
  readonly evaluationCount: number;
}

/**
 * Applies D-T7's rule to one incumbent/candidate comparison. NEVER throws for
 * a non-accepting comparison — see this module's header; `keep-incumbent` is
 * a returned union member, not an exception. (It does still throw for an
 * unusable INPUT, e.g. `evaluationCount < 2` via `acceptanceThreshold`: that
 * is a caller bug, not a search result.)
 */
export function decideAcceptance(input: AcceptanceInput): AcceptanceOutcome {
  const threshold = acceptanceThreshold(input.evaluationCount, input.brierStandardError);
  const margin = input.incumbentBrier - input.candidateBrier;
  const maeDelta = input.candidateMae - input.incumbentMae;

  const maeNoiseBound = ACCEPTANCE_MAE_NOISE_MULTIPLE * input.maeStandardError;
  const maeRelativeBound = ACCEPTANCE_MAE_RELATIVE_TOLERANCE * Math.abs(input.incumbentMae);
  const maeVetoBound = Math.max(maeNoiseBound, maeRelativeBound);

  // Both halves of the AND, kept as named booleans rather than folded into
  // one comparison against `maeVetoBound`, so a reader can see which half
  // each test in `acceptance.test.ts` is exercising.
  const distinguishableFromNoise = maeDelta > maeNoiseBound;
  const materiallyWorse = maeDelta >= maeRelativeBound;
  const vetoed = distinguishableFromNoise && materiallyWorse;

  const evidence: AcceptanceEvidence = { margin, threshold, evaluationCount: input.evaluationCount, maeDelta, maeVetoBound };

  // Precedence, per this module's header: the Brier bar is checked FIRST, so
  // a candidate that was never eligible reports `below-threshold` rather than
  // an MAE reason that would not have mattered either way.
  if (!(margin > threshold)) {
    return { decision: "keep-incumbent", reason: "below-threshold", ...evidence };
  }
  if (vetoed) {
    return { decision: "keep-incumbent", reason: "mae-veto", ...evidence };
  }
  return { decision: "accept", ...evidence };
}
