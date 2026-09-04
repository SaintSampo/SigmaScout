/**
 * D-T7's pre-committed acceptance rule (quick task 260901-trz), as shared
 * machinery rather than a decision re-derived inside whichever runner happens
 * to need it.
 *
 * Quick task 260904-oiu (OBJ-BAR) flipped the bar's own axis: it now gates on
 * ACCURACY, with Brier demoted to a second guardrail alongside the
 * pre-existing score-MAE one. See that quick task's own SUMMARY for the full
 * rationale; the contracts below are restated here because this file is where
 * a future edit would break them.
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
 * ## The three conditions, and their asymmetry
 *
 * 1. **The ACCURACY bar.** The candidate must beat the incumbent's winner
 *    accuracy by more than `sqrt(2 * ln N) * SE`, where N is the number of
 *    evaluations and SE is the EVENT-BLOCKED paired-difference standard error
 *    of the ACCURACY delta (`eventBootstrap.ts` — see that module's header
 *    for why the PAIRED SE, not either side's level SE, is the faithful
 *    quantity for a bar on a difference). The formula is unchanged from the
 *    retired Brier bar; only the SE it is applied to moved.
 * 2. **The score-MAE guardrail.** A VETO over eligibility, never a tuned
 *    objective. It exists because the `vpr@3.0.0` `±` fix shipped a +7.0%
 *    (2025) / +15.8% (2026) alliance-score MAE regression that both Brier and
 *    SD(z) rated equal-or-better — a real, measured instance of an objective
 *    being blind to a degradation users would see immediately.
 * 3. **The Brier guardrail (NEW, quick task 260904-oiu).** A second VETO,
 *    mirroring the MAE veto's own two-half shape: a challenger that is more
 *    accurate but ships a Brier regression that is BOTH distinguishable from
 *    noise AND materially worse is refused, even though it cleared the
 *    accuracy bar. Optimizing Brier jointly with accuracy would just be a
 *    two-objective search with an unstated weighting; vetoing on it keeps
 *    accuracy the single objective while refusing to ship a known calibration
 *    regression bought by an accuracy win.
 *
 * ## Evaluation order, because it decides what gets REPORTED
 *
 * A candidate is ELIGIBLE when it clears the accuracy bar AND passes BOTH
 * guardrails; the winner is the best eligible candidate. When nothing is
 * eligible, the caller should report the reason that bound the BEST candidate
 * — so the report reads "the best candidate was vetoed on score MAE" rather
 * than the far less useful "nothing was accepted". `decideAcceptance` encodes
 * the same precedence for a single comparison: a candidate that fails the bar
 * reports `below-threshold` (both guardrails are moot for a candidate that
 * was never eligible on accuracy); the MAE veto is checked BEFORE the Brier
 * veto so a candidate that trips both still reports `mae-veto` — the ten
 * already-recorded verdicts' vocabulary does not shift underneath them — and
 * one that clears the bar, passes MAE, but trips the Brier guardrail reports
 * `brier-veto`.
 */

/**
 * The union bound over N evaluations: with N chances to beat the incumbent,
 * the largest of N noise draws is itself larger than any single draw, and
 * `sqrt(2 * ln N)` is the standard bound on how much larger (the expected
 * maximum of N standard normals). Multiplying by the event-blocked
 * standard error turns that into a bar on whatever quantity `standardError`
 * measures — the ACCURACY delta since quick task 260904-oiu (OBJ-BAR); the
 * formula itself is unchanged from the retired Brier bar.
 *
 * The bar MOVES with N, which is exactly why D-T7 requires N to be recorded
 * alongside any accept/keep decision: a threshold is not a property of the
 * project, it is a property of "this SE at this many evaluations." A result
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

/**
 * The Brier guardrail's MATERIALITY half (quick task 260904-oiu, OBJ-BAR),
 * mirroring `ACCEPTANCE_MAE_RELATIVE_TOLERANCE`'s exact shape and value: 1%
 * of the incumbent's Brier. On a Brier around 0.17 (this project's measured
 * combined-view tune Brier, `tune.ts`'s `SCREEN_SURVIVAL_THRESHOLD` doc
 * comment) that is about 0.0017 — roughly HALF the scale of the retired
 * N=60 Brier bar (~0.0035) — so a challenger may pay up to about half a
 * bar's worth of calibration for its accuracy win, and no more.
 */
export const ACCEPTANCE_BRIER_VETO_RELATIVE_TOLERANCE = 0.01;

/**
 * The Brier guardrail's DISTINGUISHABILITY half, mirroring
 * `ACCEPTANCE_MAE_NOISE_MULTIPLE` exactly: the regression must exceed two
 * event-blocked standard errors before it counts as a real degradation
 * rather than resampling noise.
 */
export const ACCEPTANCE_BRIER_VETO_NOISE_MULTIPLE = 2;

/** Why a candidate was not accepted. All three values are normal, reportable outcomes — see this module's header. */
export type KeepIncumbentReason = "below-threshold" | "mae-veto" | "brier-veto";

/** The numbers behind any decision, carried by BOTH union members so a report never has to reconstruct them. */
interface AcceptanceEvidence {
  /**
   * `candidateAccuracy - incumbentAccuracy`: POSITIVE means the candidate is
   * MORE ACCURATE (accuracy is maximized). Quick task 260904-oiu renamed this
   * from the retired `margin` field (`incumbentBrier - candidateBrier`)
   * rather than redefining it in place, and the SIGN CONVENTION FLIPPED along
   * with the rename — the retired field was positive for a BETTER (lower)
   * Brier; this one is positive for a BETTER (higher) accuracy. Renaming
   * forces every reader of the old field to be revisited by the compiler
   * instead of silently reading a number whose meaning inverted.
   */
  readonly accuracyMargin: number;
  /** `acceptanceThreshold(evaluationCount, accuracyStandardError)` — the bar this comparison was judged against. */
  readonly threshold: number;
  /** D-T7: recorded because the bar moves with it. A decision quoted without this number cannot be checked. */
  readonly evaluationCount: number;
  /** `candidateMae - incumbentMae`: POSITIVE means the candidate is WORSE on alliance-score MAE. */
  readonly maeDelta: number;
  /** `max(ACCEPTANCE_MAE_NOISE_MULTIPLE * maeStandardError, ACCEPTANCE_MAE_RELATIVE_TOLERANCE * |incumbentMae|)` — the larger of the MAE guardrail's two halves, i.e. what `maeDelta` had to exceed for that veto to fire. */
  readonly maeVetoBound: number;
  /** `candidateBrier - incumbentBrier`: POSITIVE means the candidate is WORSE on Brier (Brier is minimized). */
  readonly brierDelta: number;
  /** `max(ACCEPTANCE_BRIER_VETO_NOISE_MULTIPLE * brierStandardError, ACCEPTANCE_BRIER_VETO_RELATIVE_TOLERANCE * |incumbentBrier|)` — the larger of the Brier guardrail's two halves. */
  readonly brierVetoBound: number;
}

export type AcceptanceOutcome =
  | ({ readonly decision: "accept" } & AcceptanceEvidence)
  | ({ readonly decision: "keep-incumbent"; readonly reason: KeepIncumbentReason } & AcceptanceEvidence);

export interface AcceptanceInput {
  /** Mean winner accuracy of the currently promoted parameter set, on data the selection never saw. */
  readonly incumbentAccuracy: number;
  /** Mean winner accuracy of the challenger, on the SAME matches. */
  readonly candidateAccuracy: number;
  /** Mean Brier of the currently promoted parameter set, over the SAME population accuracy was scored on. */
  readonly incumbentBrier: number;
  /** Mean Brier of the challenger, over that same population. */
  readonly candidateBrier: number;
  /** Mean alliance-score MAE of the incumbent, over that same population. */
  readonly incumbentMae: number;
  /** Mean alliance-score MAE of the challenger, over that same population. */
  readonly candidateMae: number;
  /** Event-blocked PAIRED-difference SE of `candidateAccuracy - incumbentAccuracy` (`eventBootstrap.ts`). This is the quantity D-T7's bar is now on (quick task 260904-oiu) — not either model's level SE. */
  readonly accuracyStandardError: number;
  /** Event-blocked PAIRED-difference SE of `candidateBrier - incumbentBrier`. Feeds ONLY the Brier guardrail now — never the bar. */
  readonly brierStandardError: number;
  /** Event-blocked PAIRED-difference SE of `candidateMae - incumbentMae`. */
  readonly maeStandardError: number;
  /** D-T7's N: how many candidates were evaluated in the search this comparison concludes. */
  readonly evaluationCount: number;
}

/**
 * Applies D-T7's rule (accuracy-primary since quick task 260904-oiu) to one
 * incumbent/candidate comparison. NEVER throws for a non-accepting
 * comparison — see this module's header; `keep-incumbent` is a returned
 * union member, not an exception. (It does still throw for an unusable
 * INPUT, e.g. `evaluationCount < 2` via `acceptanceThreshold`: that is a
 * caller bug, not a search result.)
 */
export function decideAcceptance(input: AcceptanceInput): AcceptanceOutcome {
  const threshold = acceptanceThreshold(input.evaluationCount, input.accuracyStandardError);
  const accuracyMargin = input.candidateAccuracy - input.incumbentAccuracy;
  const maeDelta = input.candidateMae - input.incumbentMae;
  const brierDelta = input.candidateBrier - input.incumbentBrier;

  const maeNoiseBound = ACCEPTANCE_MAE_NOISE_MULTIPLE * input.maeStandardError;
  const maeRelativeBound = ACCEPTANCE_MAE_RELATIVE_TOLERANCE * Math.abs(input.incumbentMae);
  const maeVetoBound = Math.max(maeNoiseBound, maeRelativeBound);

  const brierNoiseBound = ACCEPTANCE_BRIER_VETO_NOISE_MULTIPLE * input.brierStandardError;
  const brierRelativeBound = ACCEPTANCE_BRIER_VETO_RELATIVE_TOLERANCE * Math.abs(input.incumbentBrier);
  const brierVetoBound = Math.max(brierNoiseBound, brierRelativeBound);

  // Both halves of each AND, kept as named booleans rather than folded into
  // one comparison against the veto bound, so a reader can see which half
  // each test in `acceptance.test.ts` is exercising.
  const maeDistinguishableFromNoise = maeDelta > maeNoiseBound;
  const maeMateriallyWorse = maeDelta >= maeRelativeBound;
  const maeVetoed = maeDistinguishableFromNoise && maeMateriallyWorse;

  const brierDistinguishableFromNoise = brierDelta > brierNoiseBound;
  const brierMateriallyWorse = brierDelta >= brierRelativeBound;
  const brierVetoed = brierDistinguishableFromNoise && brierMateriallyWorse;

  const evidence: AcceptanceEvidence = {
    accuracyMargin,
    threshold,
    evaluationCount: input.evaluationCount,
    maeDelta,
    maeVetoBound,
    brierDelta,
    brierVetoBound,
  };

  // Precedence, per this module's header: the accuracy bar is checked FIRST,
  // so a candidate that was never eligible reports `below-threshold` rather
  // than a veto reason that would not have mattered either way. The MAE veto
  // is checked BEFORE the Brier veto so a candidate that trips both still
  // reports `mae-veto` — the ten already-recorded verdicts' vocabulary does
  // not shift underneath them.
  if (!(accuracyMargin > threshold)) {
    return { decision: "keep-incumbent", reason: "below-threshold", ...evidence };
  }
  if (maeVetoed) {
    return { decision: "keep-incumbent", reason: "mae-veto", ...evidence };
  }
  if (brierVetoed) {
    return { decision: "keep-incumbent", reason: "brier-veto", ...evidence };
  }
  return { decision: "accept", ...evidence };
}
