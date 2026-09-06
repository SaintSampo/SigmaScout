/**
 * Rule A (2026-09-05 policy decision, quick task 260905-t88 — RULE-A) is the
 * shipping gate: a search winner is ACCEPTED when it improves BOTH
 * out-of-sample winner accuracy AND Brier over the live incumbent. Both
 * comparisons are STRICT. The score-MAE veto still runs afterward, unchanged.
 *
 * Rule A replaces D-T7's noise-bar gate (quick task 260901-trz, then flipped
 * to accuracy-primary by quick task 260904-oiu / OBJ-BAR). The bar is still
 * COMPUTED and REPORTED on every outcome — it is useful diagnostic context —
 * but it decides nothing anymore.
 *
 * ## Why Rule A, and why now
 *
 * Three accuracy-primary tunes (retune-0905, elim-R v9n, Stage 2 CVF/Stage 3
 * CER) went 30/30 `keep-incumbent` under the D-T7 noise bar while posting
 * repeated near-accepts: 2025 sat at roughly 90% of the bar TWICE, with a
 * better Brier both times. A retroactive pass over all 36 recorded
 * accuracy-primary verdicts across those four runs showed Rule A ships
 * exactly the season-clustered, autopsy-predicted improvements — 2025 twice,
 * 2026 once — and rejects every Brier-worse positive, all of which pattern as
 * noise (e.g. every 2022 positive). The operator adopted Rule A on
 * 2026-09-05 and applied it MANUALLY to promote `vpr@9.0.0+rolling-2026-09c`
 * before this file caught up; this change is what puts the rule in the
 * machinery so the next tune does not need to be re-read by hand.
 *
 * The bar itself was retired as a GATE (not deleted, see below) because its
 * winner's-curse correction demands margins around 3 SE that a single
 * season's ~16,000 matches cannot supply for real effects of the size this
 * project actually sees (roughly 0.2-0.4pt of accuracy). A bar calibrated to
 * reject noise at that scale also rejects most real improvements at that
 * scale — the three 30/30 runs above are exactly that failure playing out.
 * The Brier half of Rule A addresses the selection-overfit risk the bar was
 * ALSO guarding against, but by a different mechanism: an accuracy winner
 * that only won by overfitting the selection data buys its accuracy by
 * paying calibration, so requiring Brier to improve too catches that case
 * without needing a margin at all.
 *
 * ## `keep-incumbent` is a SUCCESSFUL result
 *
 * The single most important contract in this file, unchanged by Rule A: a
 * search that finds nothing that improves both accuracy and Brier has
 * SUCCEEDED, and its correct output is "keep the incumbent, and here is why."
 * `decideAcceptance` therefore never throws for a non-accepting comparison —
 * it returns a `keep-incumbent` member of a discriminated union carrying the
 * numbers that produced it. A caller that treats that as an error, exits
 * non-zero on it, loosens the rule until something passes, or retries until
 * something is accepted has defeated the entire purpose of pre-committing a
 * rule: the rule only means anything if "nothing qualified" is an outcome the
 * machinery can report calmly.
 *
 * ## Rule A's two halves, and the MAE veto, and their precedence
 *
 * 1. **The accuracy half.** `accuracyMargin > 0`, i.e. `candidateAccuracy >
 *    incumbentAccuracy`, STRICT. An exact tie is not an improvement.
 * 2. **The Brier half.** `candidateBrier < incumbentBrier`, STRICT. An exact
 *    tie is not an improvement either — Rule A requires the candidate to be
 *    better, not merely not worse, on both axes.
 * 3. **The score-MAE guardrail.** Unchanged from D-T7: a VETO over
 *    eligibility, never a tuned objective. It exists because the
 *    `vpr@3.0.0` fix shipped a +7.0% (2025) / +15.8% (2026) alliance-score
 *    MAE regression that both Brier and SD(z) rated equal-or-better — a
 *    real, measured instance of an objective being blind to a degradation
 *    users would see immediately. Checked AFTER both Rule A halves: a
 *    candidate that never became eligible under Rule A reports why it was
 *    ineligible, not a veto that was moot for it.
 *
 * A candidate that fails the accuracy half reports `no-accuracy-gain` (the
 * Brier half and the MAE veto are both moot — it was never eligible). A
 * candidate that clears the accuracy half but fails the Brier half reports
 * `brier-regression` (the MAE veto is moot for the same reason). Only a
 * candidate that clears BOTH Rule A halves can reach the MAE veto and report
 * `mae-veto`. Precedence is preserved from D-T7 for the same stated reason:
 * report the reason that actually decided, not one that would not have
 * mattered either way.
 *
 * ## The Brier veto is RETIRED, not deleted
 *
 * D-T7's Brier guardrail (quick task 260904-oiu, OBJ-BAR) vetoed an
 * accuracy-clearing candidate whose Brier regression was both distinguishable
 * from noise AND materially worse. Rule A's Brier half requires a STRICT
 * Brier IMPROVEMENT, which is strictly stronger than "no
 * materially-and-distinguishably-worse Brier" — nothing that could have
 * tripped the old veto can now reach `accept` at all, so an active branch for
 * it would be provably unreachable. `ACCEPTANCE_BRIER_VETO_RELATIVE_TOLERANCE`,
 * `ACCEPTANCE_BRIER_VETO_NOISE_MULTIPLE`, and the `brierVetoBound` evidence
 * field all remain, because `brierVetoBound` remains useful REPORTED context
 * for how much Brier moved relative to the old bound — the constants and the
 * field keep their `VETO` names because the acceptance artifact's field
 * names are a record other readers depend on, and those names now carry
 * history rather than current behavior.
 *
 * ## The noise bar is RETIRED as a gate, not deleted
 *
 * `threshold` (`acceptanceThreshold`) is still computed from the unchanged
 * formula and reported on every outcome, alongside a new `clearedNoiseBar`
 * boolean. Both are diagnostic context ONLY — "it cleared the old bar too"
 * is worth knowing, and `clearedNoiseBar`'s PRESENCE is how a reader tells a
 * Rule-A-era artifact from a bar-era one. Neither may appear in a branch
 * condition.
 *
 * ## The retired reason vocabulary
 *
 * `KeepIncumbentReason` used to include `"below-threshold"` (the retired
 * noise-bar gate) and `"brier-veto"` (the retired Brier guardrail branch).
 * Both are REMOVED from the type as of this change, rather than left as
 * unreachable values, so the compiler surfaces every reader that still
 * expects them — the same argument this file already recorded for the
 * `margin` -> `accuracyMargin` rename. Every acceptance artifact written
 * before 2026-09-05 carries one of those two strings (or `mae-veto`, which
 * is unchanged) and is NOT rewritten: an artifact saying `below-threshold`
 * means the noise bar refused it, which was true when it was written.
 *
 * ## Pre-commitment against reactive policy-tuning
 *
 * Rule A was chosen while looking at the 36-verdict retroactive analysis
 * described above, and must now run UNCHANGED on future tunes: no margins,
 * no SE minimums, no per-season exceptions added in reaction to any single
 * future result. Adding one in response to a result Rule A produces is
 * exactly the failure mode this note exists to prevent — see
 * `decideAcceptance`'s own doc comment for the same commitment restated at
 * the point a future editor is most likely to be tempted.
 */

/**
 * The union bound over N evaluations: with N chances to beat the incumbent,
 * the largest of N noise draws is itself larger than any single draw, and
 * `sqrt(2 * ln N)` is the standard bound on how much larger (the expected
 * maximum of N standard normals). Multiplying by the event-blocked
 * standard error turns that into a bar on whatever quantity `standardError`
 * measures — the ACCURACY delta since quick task 260904-oiu (OBJ-BAR).
 *
 * Since quick task 260905-t88 (RULE-A) this value is DIAGNOSTIC ONLY: it is
 * still computed and reported as `threshold` (and compared against
 * `accuracyMargin` to produce `clearedNoiseBar`), but it no longer gates
 * anything. The bar MOVES with N, which is exactly why D-T7 required N to be
 * recorded alongside any decision: a threshold is not a property of the
 * project, it is a property of "this SE at this many evaluations." A result
 * quoted without its N cannot be checked — that requirement survives the
 * bar's demotion to diagnostics unchanged.
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
 * The RETIRED Brier veto's MATERIALITY half (quick task 260904-oiu, OBJ-BAR):
 * 1% of the incumbent's Brier. Kept — see this module's header, "The Brier
 * veto is RETIRED, not deleted" — solely so `brierVetoBound` can still be
 * computed and reported as diagnostic context on every outcome. Rule A's
 * strict Brier-improvement requirement (quick task 260905-t88) is strictly
 * stronger than this bound, so no branch in `decideAcceptance` reads this
 * constant directly anymore; only `brierVetoBound`'s computation does.
 */
export const ACCEPTANCE_BRIER_VETO_RELATIVE_TOLERANCE = 0.01;

/**
 * The RETIRED Brier veto's DISTINGUISHABILITY half, mirroring
 * `ACCEPTANCE_MAE_NOISE_MULTIPLE` exactly. Kept for the same reason as
 * `ACCEPTANCE_BRIER_VETO_RELATIVE_TOLERANCE` — see this module's header.
 */
export const ACCEPTANCE_BRIER_VETO_NOISE_MULTIPLE = 2;

/**
 * Why a candidate was not accepted under Rule A. All three values are
 * normal, reportable outcomes — see this module's header.
 *
 * The retired bar-era vocabulary was `"below-threshold" | "mae-veto" |
 * "brier-veto"`. `"below-threshold"` (the noise-bar gate) and `"brier-veto"`
 * (the Brier guardrail branch) are REMOVED as of quick task 260905-t88
 * (RULE-A) rather than left as unreachable values, so the compiler surfaces
 * every reader that still expects them. Acceptance artifacts written before
 * 2026-09-05 carry one of those two retired strings and are NOT rewritten —
 * an artifact saying `below-threshold` means the noise bar refused it, which
 * was true when it was written.
 */
export type KeepIncumbentReason = "no-accuracy-gain" | "brier-regression" | "mae-veto";

/** The numbers behind any decision, carried by BOTH union members so a report never has to reconstruct them. */
interface AcceptanceEvidence {
  /**
   * `candidateAccuracy - incumbentAccuracy`: POSITIVE means the candidate is
   * MORE ACCURATE (accuracy is maximized). Quick task 260904-oiu renamed this
   * from the retired `margin` field (`incumbentBrier - candidateBrier`)
   * rather than redefining it in place, and the SIGN CONVENTION FLIPPED along
   * with the rename — the retired field was positive for a BETTER (lower)
   * Brier; this one is positive for a BETTER (higher) accuracy. Rule A's
   * accuracy half (quick task 260905-t88) is `accuracyMargin > 0`, STRICT.
   */
  readonly accuracyMargin: number;
  /**
   * `acceptanceThreshold(evaluationCount, accuracyStandardError)` — the
   * retired D-T7 noise bar. Since Rule A (quick task 260905-t88) this is
   * DIAGNOSTIC ONLY: reported on every outcome, never read in a branch
   * condition. See `clearedNoiseBar`.
   */
  readonly threshold: number;
  /**
   * `accuracyMargin > threshold`: whether this comparison would ALSO have
   * cleared the retired D-T7 noise bar. Purely diagnostic — "it cleared the
   * old bar too" is worth knowing, and this field's PRESENCE is how a reader
   * tells a Rule-A-era artifact from a bar-era one. It must never appear in
   * a branch condition; Rule A does not consult it.
   */
  readonly clearedNoiseBar: boolean;
  /** D-T7: recorded because the bar moves with it. A decision quoted without this number cannot be checked. */
  readonly evaluationCount: number;
  /** `candidateMae - incumbentMae`: POSITIVE means the candidate is WORSE on alliance-score MAE. */
  readonly maeDelta: number;
  /** `max(ACCEPTANCE_MAE_NOISE_MULTIPLE * maeStandardError, ACCEPTANCE_MAE_RELATIVE_TOLERANCE * |incumbentMae|)` — the larger of the MAE guardrail's two halves, i.e. what `maeDelta` had to exceed for that veto to fire. */
  readonly maeVetoBound: number;
  /** `candidateBrier - incumbentBrier`: POSITIVE means the candidate is WORSE on Brier (Brier is minimized). Rule A's Brier half (quick task 260905-t88) requires this to be NEGATIVE, STRICT. */
  readonly brierDelta: number;
  /**
   * `max(ACCEPTANCE_BRIER_VETO_NOISE_MULTIPLE * brierStandardError,
   * ACCEPTANCE_BRIER_VETO_RELATIVE_TOLERANCE * |incumbentBrier|)` — the
   * RETIRED Brier veto's bound. Reported as diagnostic context only; see
   * this module's header, "The Brier veto is RETIRED, not deleted."
   */
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
  /** Event-blocked PAIRED-difference SE of `candidateAccuracy - incumbentAccuracy` (`eventBootstrap.ts`). Feeds only the (diagnostic) noise bar now — never the gate. */
  readonly accuracyStandardError: number;
  /** Event-blocked PAIRED-difference SE of `candidateBrier - incumbentBrier`. Feeds only the (diagnostic) `brierVetoBound` now — never the gate. */
  readonly brierStandardError: number;
  /** Event-blocked PAIRED-difference SE of `candidateMae - incumbentMae`. */
  readonly maeStandardError: number;
  /** D-T7's N: how many candidates were evaluated in the search this comparison concludes. */
  readonly evaluationCount: number;
}

/**
 * Applies Rule A (quick task 260905-t88, adopted 2026-09-05) to one
 * incumbent/candidate comparison: ACCEPT when the candidate strictly
 * improves BOTH out-of-sample winner accuracy AND Brier over the incumbent,
 * subject to the unchanged score-MAE veto. NEVER throws for a non-accepting
 * comparison — see this module's header; `keep-incumbent` is a returned
 * union member, not an exception. (It does still throw for an unusable
 * INPUT, e.g. `evaluationCount < 2` via `acceptanceThreshold`: that is a
 * caller bug, not a search result.)
 *
 * PRE-COMMITMENT: Rule A was chosen while looking at the 36-verdict
 * retroactive analysis recorded in this module's header. It must now run
 * UNCHANGED on future tunes — no margins, no SE minimums, no per-season
 * exceptions added in reaction to any single future result. Adding one in
 * response to a result this function produces is the failure mode this note
 * exists to prevent.
 */
export function decideAcceptance(input: AcceptanceInput): AcceptanceOutcome {
  const threshold = acceptanceThreshold(input.evaluationCount, input.accuracyStandardError);
  const accuracyMargin = input.candidateAccuracy - input.incumbentAccuracy;
  const maeDelta = input.candidateMae - input.incumbentMae;
  const brierDelta = input.candidateBrier - input.incumbentBrier;
  const clearedNoiseBar = accuracyMargin > threshold;

  const maeNoiseBound = ACCEPTANCE_MAE_NOISE_MULTIPLE * input.maeStandardError;
  const maeRelativeBound = ACCEPTANCE_MAE_RELATIVE_TOLERANCE * Math.abs(input.incumbentMae);
  const maeVetoBound = Math.max(maeNoiseBound, maeRelativeBound);

  const brierNoiseBound = ACCEPTANCE_BRIER_VETO_NOISE_MULTIPLE * input.brierStandardError;
  const brierRelativeBound = ACCEPTANCE_BRIER_VETO_RELATIVE_TOLERANCE * Math.abs(input.incumbentBrier);
  const brierVetoBound = Math.max(brierNoiseBound, brierRelativeBound);

  // Both halves of the MAE AND, kept as named booleans rather than folded
  // into one comparison against the veto bound, so a reader can see which
  // half each test in `acceptance.test.ts` is exercising.
  const maeDistinguishableFromNoise = maeDelta > maeNoiseBound;
  const maeMateriallyWorse = maeDelta >= maeRelativeBound;
  const maeVetoed = maeDistinguishableFromNoise && maeMateriallyWorse;

  const evidence: AcceptanceEvidence = {
    accuracyMargin,
    threshold,
    clearedNoiseBar,
    evaluationCount: input.evaluationCount,
    maeDelta,
    maeVetoBound,
    brierDelta,
    brierVetoBound,
  };

  // Rule A, evaluated in this order, first match wins: the accuracy half,
  // then the Brier half, then the unchanged MAE veto, then accept. Both Rule
  // A comparisons below are STRICT — an exact tie on either quantity is not
  // an improvement. Gate-before-veto precedence is preserved from the
  // retired D-T7 rule for the same stated reason: a candidate that never
  // became eligible under Rule A reports why it was ineligible, not a veto
  // that was moot for it.
  if (!(accuracyMargin > 0)) {
    return { decision: "keep-incumbent", reason: "no-accuracy-gain", ...evidence };
  }
  if (!(input.candidateBrier < input.incumbentBrier)) {
    return { decision: "keep-incumbent", reason: "brier-regression", ...evidence };
  }
  if (maeVetoed) {
    return { decision: "keep-incumbent", reason: "mae-veto", ...evidence };
  }
  return { decision: "accept", ...evidence };
}
