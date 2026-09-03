/**
 * D-V1/D-V2/D-V3 (quick task 260902-varopr): the PER-TEAM VARIANCE
 * DECOMPOSITION — "variance OPR" — that produces the published `±`.
 *
 * A Node-free leaf in `packages/core` (the Worker calls `teamMetrics` from
 * `apps/worker/src/scheduled.ts` and must be able to run this solve).
 * `ml-matrix` is already a Worker-bundled dependency — `opr.ts` imports it —
 * so nothing new enters the bundle.
 *
 * ---------------------------------------------------------------------------
 * THE MODEL (D-V1)
 * ---------------------------------------------------------------------------
 *
 * For one alliance-observation `m` with residual `e_m`, under D-06's
 * independent-teams assumption:
 *
 *     E[e_m^2] = sum over teams i on alliance m of sigma_i^2
 *
 * That is LINEAR in the unknowns with a 0/1 team-membership design matrix `X`
 * — structurally identical to OPR, with SQUARED RESIDUALS as the target and
 * VARIANCE as the unknown instead of points and rating. Solve by least
 * squares SUBJECT TO `beta >= 0`, because a variance cannot be negative.
 *
 * ---------------------------------------------------------------------------
 * THE CONSTRAINT IS IN THE SOLVE, NOT AFTER IT (D-N1, quick task 260903-5dp)
 * ---------------------------------------------------------------------------
 *
 * This module shipped once (`SIGMA1_CODE_VERSION` 5.0.0) with an unconstrained
 * Cholesky solve followed by a per-entry `Math.max(0, x)`. That was the wrong
 * terminal behaviour, and the measurement that says so is not a preference:
 * against the published 2026 teams artifact
 * (`teams/2026/vpr@5.0.0+tuned-2026-08.json`, fetched 2026-09-03) the clamp
 * left 34.9% of metric cells with NO `±` at all, spread across 97.7% of teams,
 * NONE of which had zero matches. The inversion is the point — noise around a
 * genuinely SMALL variance is what solves slightly negative, so the clamp hid
 * the interval for exactly the robots whose consistency was most worth showing.
 *
 * A clamp answers the wrong question and then edits the answer: it finds the
 * beta that best fits the data over ALL of R^n, discovers that beta is not a
 * variance vector, and truncates it. The constrained estimator asks the right
 * question instead — the beta that best fits the data over the FEASIBLE set —
 * and its answer is a different vector, not a truncation of the first one.
 * Pinning one team at zero frees residual budget that lifts a co-appearing
 * teammate, so the other components MOVE. `varianceOpr.test.ts` pins a
 * hand-worked system where NNLS and `max(0, cholesky)` differ, precisely so
 * "this is just the clamp with extra steps" is refutable rather than arguable.
 *
 * The solver is LAWSON-HANSON ACTIVE-SET NNLS (`solveNonNegativeLeastSquares`
 * below). It was chosen for DETERMINISM, not for speed: it terminates finitely
 * on a fixed pivot rule with no convergence epsilon anywhere, which is what
 * this repo's bitwise-pinned digests require. A projected-gradient or
 * coordinate-descent solver whose answer depends on an iteration count or a
 * tolerance would not be acceptable here at any accuracy.
 *
 * NNLS DOES NOT CLEAR THE BLANK CELLS. It still returns EXACTLY 0 for a team
 * the data cannot support, and measured on the real 2026 season it returns 0
 * MORE OFTEN than the clamp did: 40.2% of published cells against 34.9%. That
 * is the opposite of what this change was expected to buy, it is not a defect
 * in the solve (which is verified KKT-optimal), and it is recorded rather than
 * smoothed. `SIGMA1_VARIANCE_OPR_RIDGE`'s block carries the full before/after
 * table, the mechanism, and the optimality evidence — read it before drawing
 * any conclusion about coverage from this module.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS: SCALE, NOT RANKING
 * ---------------------------------------------------------------------------
 *
 * Both incumbent estimators were measured against KNOWN synthetic sigma (60
 * teams, true per-team sigma spanning 3-25 points) and both fail the same way.
 * At a full season (60 matches/team):
 *
 *     estimator                        r        slope     RMSE
 *     even-split contribution SD       0.865    0.179     6.76
 *     filter R, max(0, e^2 - sumP)/n   0.867    0.312     5.15
 *     variance-OPR, ridge 0            0.861    1.032     4.11
 *     variance-OPR, ridge 10           0.860    0.871     3.62
 *
 * All three CORRELATE with truth equally: the ranking information is limited
 * by the DATA, not the estimator, and this module does not make the `±`
 * smarter. Only the decomposition gets the SCALE right. At slope 0.18 a true
 * 3-to-25 point spread renders as a ~4-point band and every robot looks
 * equally consistent, which defeats the entire purpose of publishing a `±`.
 * `varianceOpr.recovery.test.ts` reproduces this table and is what defends the
 * choice; it also pins BOTH incumbents by RATIO, so a future revert to either
 * cannot be made to pass by widening one tolerance.
 *
 * ---------------------------------------------------------------------------
 * WHY THE RIDGE IS CENTRED ON `vBar` AND NOT ON ZERO (D-V2)
 * ---------------------------------------------------------------------------
 *
 * The system solved is
 *
 *     (X'X + lambda*I) * beta = X'y + lambda * vBar
 *
 * with `vBar` the event's MEAN PER-TEAM VARIANCE (`mean over rows of e^2/n`).
 *
 * Shrinking toward ZERO drags every team's variance toward "perfectly
 * consistent" and wrecks both the mean and the scale — measured: at lambda 100
 * a zero-centred ridge gives a mean estimate of 6.2 against a true 11.6.
 * Centring on `vBar` preserves the mean at every lambda (11.7 against 11.6).
 * `varianceOpr.test.ts` carries the zero-centred solve as an explicit NEGATIVE
 * CONTROL, because a centring nobody ever tested the alternative of is a
 * centring nobody tested.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS INVERTS `opr.ts`'s NO-RIDGE CONCLUSION WITHOUT CONTRADICTING IT
 * ---------------------------------------------------------------------------
 *
 * `opr.ts` deliberately DELETED its ridge (its D-06) and relies on a bare
 * minimum-norm pseudo-inverse. Its stated reason is sound: a lambda tuned at
 * season pooling (~30-40 observations) shrinks ratings ~20% at event scope
 * (~12 observations), so "freezing it would triple its effect while calling it
 * unchanged."
 *
 * That argument does not transfer, because `opr.ts`'s ridge shrank toward ZERO
 * and this one does not. The two are different objects that share a name.
 * Shrinking a RATING toward zero biases the published number downward by
 * construction; shrinking a VARIANCE toward the league's own mean variance
 * preserves the mean exactly. Do not "harmonise" this module with `opr.ts` by
 * deleting the ridge: the measurement above is what decides it, and the
 * zero-centred arm is in the test suite precisely so the comparison stays
 * runnable rather than remembered.
 *
 * ---------------------------------------------------------------------------
 * RANK DEFICIENCY IS ANSWERED BY THE MATH, NOT BY A SPECIAL CASE (D-V2)
 * ---------------------------------------------------------------------------
 *
 * `opr.ts` records that "an event-scoped, quals-only design matrix has no rank
 * at each event's start" and answers it with a minimum-norm solution, which
 * returns exactly `0`. For a RATING, 0 is an honest "no information". For a
 * VARIANCE, 0 is the claim that a robot is PERFECTLY CONSISTENT — a positive
 * false claim, and precisely the honest-uncertainty failure PROJECT.md forbids.
 *
 * `lambda > 0` makes `(X'X + lambda*I)` positive definite for ANY design
 * matrix, so a Cholesky factorization always exists and no pseudo-inverse is
 * needed. Rank deficiency stops being a special case and becomes an ordinary
 * well-posed solve. Concretely:
 *
 *   - A team with ZERO folded rows has an all-zero row of `X'X` and a 0 entry
 *     in `X'y`, so its equation reduces to `lambda * beta_i = lambda * vBar`
 *     and it solves to `vBar`. That is not a substituted constant; it is what
 *     the estimator's own algebra returns when the data says nothing, and it
 *     is the correct claim — "as uncertain as a typical robot at this event."
 *   - A team with ONE row is pulled toward `vBar` with weight
 *     `lambda / (1 + lambda)` on the diagonal term alone (~91% at lambda 10),
 *     further constrained by its two teammates' equations. Its published `±` is
 *     therefore approximately the event average, displayed beside a
 *     `matchCount` of 1.
 *   - A team with 12 rows sits at a diagonal-only weight of `10/22 ~ 45%`; the
 *     off-diagonal co-appearance structure genuinely reduces this, and by how
 *     much is an EMPIRICAL question answered with a measured number in
 *     `docs/models/sigma1-variance-decomposition.md` rather than an argument.
 *
 * NO FLOOR, NO MINIMUM-MATCH CONSTANT AND NO THRESHOLD EXISTS ANYWHERE IN THIS
 * MODULE, and none may be added. The user withdrew the floor question
 * deliberately (2026-09-02): "I really dont mind if the model takes a few
 * matches to make sense. humans reading the website will see a team has only
 * played a few matches, and will understand."
 *
 * CONSIDERED AND REJECTED: publish no `±` below 2 matches, the rule the
 * retired `contributionSpread` used. Rejected because the two situations are
 * not the same kind of thing. A sample standard deviation over one point
 * genuinely DOES NOT EXIST (`0/0`); a ridge-regularized solve has a defined,
 * honest answer at one row. Omitting there would be a THRESHOLD, not a domain
 * check. The one omission `teamMetrics` does make is at a solve PINNED AT
 * EXACTLY 0 by the non-negativity constraint, where publishing `0 ±` would be
 * a positive claim of perfection. The RULE is unchanged by D-N1 — a pinned
 * team still says "the data will not support a positive variance here", and
 * that is still not `0 ±`. What D-N1 changed is how OFTEN the rule fires, and
 * it fires MORE often, not less (`SIGMA1_VARIANCE_OPR_RIDGE`'s measured table).
 * Whether omission is still the right answer at that rate is an OPEN product
 * question this module does not get to settle on its own.
 *
 * ---------------------------------------------------------------------------
 * WHY THE NORMAL EQUATIONS ARE ACCUMULATED, NOT THE RAW OBSERVATIONS
 * ---------------------------------------------------------------------------
 *
 * `opr.ts` stores every raw observation and rebuilds the whole design matrix
 * `M`, running a fresh `SingularValueDecomposition(MtM).solve(Mts)` on EVERY
 * match — O(matches x teams) of rebuild per match, with the observation list
 * growing all season. This module deliberately deviates: it folds `X'X` and
 * `X'y` directly, which is cheaper per match, bounded by `teams^2` rather than
 * growing with match count, and materially smaller to serialize into a D1 seed
 * row (`stateSnapshot.ts`'s 90,000-byte `SeedRowTooLargeError` budget). The
 * deviation from the precedent is recorded here so it reads as a decision
 * rather than an oversight.
 *
 * `SingularValueDecomposition` is likewise NOT used. `opr.ts` needs a
 * pseudo-inverse because it has no ridge; this solve is well-posed by
 * construction, so reusing SVD "to match the precedent" would be copying a
 * workaround for a problem this solve does not have.
 *
 * ---------------------------------------------------------------------------
 * THE HONEST CAVEATS — carried forward, because they did not stop being true
 * ---------------------------------------------------------------------------
 *
 *   - FRC RECORDS NO INDIVIDUAL ROBOT'S SCORE. TBA publishes alliance totals
 *     and alliance-level breakdowns only (this project's Assumption A1), so
 *     there is no observed per-robot series anywhere to compare this against.
 *     The number is MODEL-INFERRED, never measured, and a team's estimate
 *     absorbs its partners' variability. Carried in substance from the retired
 *     `contribution.ts`, which stated it correctly.
 *   - `e_m` CARRIES MEAN-MODEL ERROR AS WELL AS ROBOT NOISE, so the estimate
 *     absorbs some of the filter's own inaccuracy. Measured: with 20 points of
 *     mean-model noise the mean estimate inflates from 9.8 to 13.9.
 *   - CORRELATION WITH TRUTH IS ~0.86 AT A FULL SEASON AND ~0.55 AT ONE EVENT.
 *     The `±` is a genuinely noisy estimate of a robot's consistency,
 *     especially early. This comment says so rather than implying precision.
 */
import { CholeskyDecomposition, Matrix } from "ml-matrix";

/**
 * The ridge `lambda`. A VERSIONED, NEVER-SEARCHED display constant.
 *
 * CORRECTED from 10 to 2 (260902-varopr, after the value shipped once at 10).
 * The original justification cited the FULL-SEASON recovery table, but this
 * solve is EVENT-SCOPED (D-V3) — roughly 12 appearances per team, not 60. The
 * two scopes disagree sharply, and only the event numbers govern what ships:
 *
 *     lambda                 0      2      4      7      10
 *     slope (12 appearances) 0.782  0.785  0.722  0.636  0.558
 *     RMSE                   9.41   8.25   7.56   7.04   6.43
 *     effective league wt    0.00   0.174  0.290  ~0.40  0.502
 *     teams with NO spread   35.3%  27.5%  21.6%  13.4%  6.3%
 *
 * EVERY ROW OF THAT TABLE WAS MEASURED UNDER THE RETIRED CLAMP, before D-N1,
 * and it is kept verbatim rather than re-run because it is the evidence that
 * SELECTED this lambda and because D-N4 defers the re-measurement to its own
 * task. Read it as the clamp-era record it is: the slope/RMSE/league-weight
 * rows will all move somewhat under the constrained solve, and the last row —
 * which is what motivated D-N1 in the first place — is already known to move a
 * lot (see the before/after below). No conclusion about NNLS should be drawn
 * from these four rows.
 *
 * A team whose solve lands on a non-positive variance publishes no `±` at all
 * (see `teamMetrics`'s `spreadOf`), and under the clamp, lowering lambda to buy
 * discrimination bought it partly by turning numbers into blanks. Those were
 * never thin-history teams — they had a full 12 matches; the unconstrained
 * estimate simply landed below zero as noise around a genuinely small variance.
 *
 * The honest reading was that clamping-then-omitting was the wrong TERMINAL
 * BEHAVIOUR rather than lambda being wrong, and that is what D-N1 changed: the
 * solve now constrains `beta >= 0` DURING the fit (`solveNonNegativeLeastSquares`).
 *
 * WHAT THAT ACTUALLY COST, MEASURED RATHER THAN ASSUMED (D-N2, quick task
 * 260903-5dp). Full 2022-2026 replay with season carry, promoted
 * `tuned-2026-08` params at this lambda, counting published metric cells for
 * every 2026 team against its own last event — the same population the site's
 * `teams/2026` artifact publishes, and the BEFORE row reproduces that live
 * artifact exactly, which is what makes the AFTER row comparable:
 *
 *     terminal behaviour        cells with no ±        teams missing >= 1
 *     Math.max(0, cholesky)     34.9%  (19,436)        97.7%  (3,632)
 *     Lawson-Hanson NNLS        40.2%  (22,412)        98.8%  (3,675)
 *
 * THE BLANK RATE WENT UP, NOT DOWN. That inverts the expectation D-N1 was
 * written under and it is recorded here in full rather than smoothed, because
 * the number is the finding. 214 cells GAINED a `±`; 3,190 LOST one. Teams with
 * every cell blank went 2 -> 4.
 *
 * WHY, and why this is not a bug: the constraint propagates zeros OUTWARD. In
 * the unconstrained fit a negative `beta` is slack — it lets a co-appearing
 * teammate take a LARGER positive value and still sum to the observed `e^2`.
 * The clamp discarded the negative and KEPT the inflated positive it was
 * propping up. Forbidding the negative during the solve removes the need for
 * that inflation, so the teammate shrinks, and often to the boundary. Fewer
 * intervals survive, and the ones that do are no longer partly an artifact of a
 * neighbour's impossible variance.
 *
 * The solve is verified OPTIMAL rather than merely different, on these same
 * real accumulators: across 3,795 (event x metric key) systems the constrained
 * objective `0.5*beta'A beta - b'beta` is strictly LOWER than the clamp's in
 * 3,715 and higher in ZERO (both vectors are feasible, so this is a like-for-
 * like comparison); no component is ever returned negative; and the KKT
 * residual is at machine precision (worst `|w|` on the passive set 1.0e-15,
 * worst POSITIVE `w` on the active set exactly 0). The estimator is right. The
 * DISPLAY RULE it feeds is what the number above indicts.
 *
 * That residual is a REAL, OPEN product question — publish `0 ±` (a false claim
 * of perfect consistency), fall back to `vBar` (the rule zero-row teams already
 * get from the algebra), or leave the cell blank — and D-N2 deliberately does
 * NOT answer it with a display rule invented inside this module. Nothing was
 * republished on the strength of this change; the live artifacts still carry
 * the 5.0.0 numbers until that decision is made.
 *
 * D-N4: lambda is NOT re-picked here. `2` was selected against synthetic data
 * whose true-sigma distribution was invented rather than measured, and it is
 * the known-weakest link in this chain. Re-picking it on real data is a
 * SEPARATE task that must run AFTER this one, because the blank rate it is
 * partly chosen on is exactly what the table above just moved — and moved in
 * the direction that makes the re-pick MORE consequential, not less. The
 * `teams with NO spread` row above still falls as lambda rises, so lambda is
 * now the live lever on this trade rather than a settled constant. Do NOT
 * pre-empt that by raising lambda here: 7 already reaches the 0.400 league
 * weight this project rejected.
 *
 * The last row is the constraint, and it is the one the first attempt missed.
 * It answers "how much of a published number is the LEAGUE rather than this
 * robot", measured two ways that agree: analytically the ridge sits against a
 * team's appearance count as `lambda / (appearances + lambda)`, and empirically
 * by how far a ridged estimate moves from its own-data-only solve toward
 * `vBar`. The RETIRED empirical-Bayes blend this decomposition replaced put
 * 0.400 league on a 12-match team, and that blend is precisely what the user
 * rejected — "it needs to show a variable humans can understand about how
 * reliable a robot is."
 *
 * At lambda 10 the effective league weight is 0.502: HEAVIER than the rejected
 * blend. Shipping it would have re-introduced the defect under a new name while
 * a comment claimed the opposite. 10 won on RMSE alone, which is the wrong
 * criterion for a number whose job is to distinguish one robot from another.
 *
 * 2 is chosen because it maximises slope (0.785 — the visibility of the
 * difference between a 50/50 robot and a 30/70 one, which is the user's own
 * stated test) while holding league contamination to 0.174, well under half the
 * rejected level. Its cost is RMSE 8.25 against 6.43. That cost is accepted
 * knowingly: at one event EVERY estimator here is noisy (correlation ~0.55
 * regardless of lambda), so the honest choice between "noisy but spread out"
 * and "tighter but clustered toward the league" is the former — a clustered
 * number is confidently wrong about the only question it is asked.
 *
 * 4 (slope 0.722, RMSE 7.56, league 0.290) is the defensible alternative if
 * absolute accuracy is later judged to matter more than discrimination. Do not
 * go above 4 without re-measuring the league weight: 7 already reaches the
 * rejected 0.400.
 *
 * ITS VALUE IS DEFENDED BY `varianceOpr.recovery.test.ts`, NOT BY BRIER. D-V4
 * states the constraint outright: this is a DISPLAY quantity, and D-01's
 * tuning objective is Brier over the predicted win probability, which is
 * structurally blind to `teamMetrics` entirely. A display quantity cannot move
 * a prediction, so it is not tunable by the objective — and selecting it
 * against KNOWN synthetic sigma is a strictly better instrument for this
 * question than Brier could ever be. `searchSpace.ts`'s `SEARCH_EXCLUSIONS`
 * carries that reasoning as DATA.
 *
 * `params.ts`'s `DEFAULT_SIGMA1_PARAMS.varianceOprRidge` IMPORTS this constant
 * rather than re-typing `10`, per that module's own "never a re-typed literal"
 * rule. This module imports NOTHING from `params.ts`, so no TDZ import cycle
 * exists in either direction.
 */
export const SIGMA1_VARIANCE_OPR_RIDGE = 2;

/**
 * One event's accumulated normal equations for the decomposition.
 *
 *   - `rowCount`  — how many alliance-observations have been folded.
 *   - `teamOrder` — FIRST-APPEARANCE order, and the column index of `gram` and
 *     of every `targets` vector. Never sorted: re-sorting would renumber every
 *     column of an already-accumulated `gram`.
 *   - `gram`      — the dense `teamOrder x teamOrder` co-appearance matrix,
 *     i.e. `X'X`.
 *   - `targets`   — metric key -> `X'y`, indexed by `teamOrder`.
 *   - `vBarSums`  — metric key -> `sum over rows of e^2 / n_row`, so
 *     `vBar_k = vBarSums[k] / rowCount`. The per-row `n` divides INDIVIDUALLY
 *     because a surrogate-reduced alliance genuinely has two eligible slots,
 *     not three, and dividing a whole event by one nominal 3 would misstate
 *     the league mean for exactly the rows that differ.
 *
 * Immutable: `foldVarianceObservation` returns a NEW accumulator. That is the
 * contract every other Sigma1 state helper keeps, AND it is what makes the
 * solve memo below correct rather than merely fast.
 */
export interface EventVarianceAccumulator {
  readonly rowCount: number;
  readonly teamOrder: readonly string[];
  readonly gram: readonly (readonly number[])[];
  readonly targets: Readonly<Record<string, readonly number[]>>;
  readonly vBarSums: Readonly<Record<string, number>>;
}

/** Per-team solved VARIANCES (never SDs) by metric key. */
export type SolvedEventVariance = ReadonlyMap<string, Readonly<Record<string, number>>>;

export function emptyEventVarianceAccumulator(): EventVarianceAccumulator {
  return { rowCount: 0, teamOrder: [], gram: [], targets: {}, vBarSums: {} };
}

/**
 * Thrown when a fold's metric-key set differs from the key set this
 * accumulator was built with.
 *
 * This is not defensive decoration. `vBar_k = vBarSums[k] / rowCount` is only
 * the event's mean per-team variance for key `k` if key `k` was folded on
 * EVERY row — otherwise the divisor counts rows that never contributed and
 * `vBar_k` is biased DOWNWARD, which is the zero-shrinkage failure D-V2 exists
 * to reject, arriving silently through the back door. The invariant does hold
 * by construction on the real path (`sigma1/index.ts` resolves its
 * `varianceGroups` once per `update()` against a fixed `componentOrder`, so
 * every row of one event carries the identical key set), and this makes that a
 * checked fact rather than a remembered one.
 */
export class VarianceKeySetMismatchError extends Error {
  constructor(expected: readonly string[], found: readonly string[]) {
    super(
      `foldVarianceObservation: this row's metric-key set [${found.join(", ")}] differs from the accumulator's ` +
        `[${expected.join(", ")}]. vBar_k = vBarSums[k] / rowCount is only the event's mean per-team variance if ` +
        `every row folds every key; a key missing from some rows would be biased toward 0, which is exactly the ` +
        `zero-centred shrinkage D-V2 rejects.`
    );
    this.name = "VarianceKeySetMismatchError";
  }
}

/**
 * Thrown when the ridged Gram matrix is not positive definite. With
 * `lambda > 0` that is impossible for any real accumulator, so reaching it
 * means `lambda <= 0` or a corrupt accumulator — and folding a corrupt variance
 * into every published spread at an event is exactly the failure `opr.ts`'s own
 * finiteness guard already refuses to accept quietly.
 */
export class VarianceSolveNotPositiveDefiniteError extends Error {
  constructor(
    readonly lambda: number,
    readonly teamCount: number,
    readonly rowCount: number,
    readonly context: string
  ) {
    super(
      `solveEventVariance: (X'X + ${lambda}*I) is not positive definite for ${context} ` +
        `(${teamCount} teams, ${rowCount} folded rows). With lambda > 0 this cannot happen for a well-formed ` +
        `accumulator, so this is either lambda <= 0 or a corrupt accumulator — the run aborts rather than ` +
        `publishing a spread derived from it.`
    );
    this.name = "VarianceSolveNotPositiveDefiniteError";
  }
}

/**
 * Thrown when the active-set loop exceeds its STRUCTURAL iteration bound.
 *
 * This is not a convergence tolerance, and the distinction is the whole reason
 * D-N1 names Lawson-Hanson specifically. The method terminates FINITELY: every
 * outer iteration either strictly decreases a strictly-convex objective over a
 * passive set that therefore can never repeat, or permanently blocks the index
 * it just admitted (`solveNonNegativeLeastSquares`'s zero-step rule), so the
 * loop is bounded by how many index subsets it can visit. The bound below is an
 * ASSERTION that the floating-point arithmetic behaved the way that proof
 * requires — reaching it means round-off broke the strict decrease.
 *
 * It THROWS rather than returning the current iterate, for the same reason
 * `VarianceSolveNotPositiveDefiniteError` aborts: a "best effort so far" would
 * turn a broken solve into a plausible-looking `±` on a team page, and a
 * plausible-looking wrong number is worse than a stopped run.
 */
export class VarianceNnlsIterationGuardError extends Error {
  constructor(
    readonly teamCount: number,
    readonly metricKey: string,
    readonly context: string
  ) {
    super(
      `solveEventVariance: the non-negative active-set solve for metric key "${metricKey}" at ${context} ` +
        `(${teamCount} teams) exceeded its structural iteration bound. Lawson-Hanson terminates finitely for a ` +
        `positive-definite system, so reaching this bound means floating-point round-off broke that guarantee — ` +
        `the run aborts rather than publishing a spread derived from an unfinished solve.`
    );
    this.name = "VarianceNnlsIterationGuardError";
  }
}

/**
 * Solves `A[P,P] z = b[P]` for the current PASSIVE set `P`, returning a
 * full-length vector with an exact `0` in every ACTIVE position.
 *
 * `P` is materialized in ASCENDING INDEX ORDER, never in the order indices were
 * admitted. That is a determinism requirement rather than tidiness: Cholesky is
 * not permutation-invariant in floating point, so an insertion-ordered
 * submatrix would make the published number depend on the path the active set
 * took to arrive at a set, not just on the set. Ascending order makes the
 * subproblem a pure function of `P`.
 *
 * `A` is positive definite (the ridge guarantees it — see
 * `VarianceSolveNotPositiveDefiniteError`), and every PRINCIPAL SUBMATRIX of a
 * positive-definite matrix is itself positive definite, so this factorization
 * cannot legitimately fail. `fail` is called if it does, so NNLS can never mask
 * a broken Gram matrix by quietly dropping the offending rows.
 */
function solveOnPassiveSet(
  a: Matrix,
  b: readonly number[],
  passive: readonly boolean[],
  fail: () => never
): number[] {
  const n = b.length;
  const indices: number[] = [];
  for (let i = 0; i < n; i++) if (passive[i]) indices.push(i);

  const size = indices.length;
  const sub = Matrix.zeros(size, size);
  const rhs = Matrix.zeros(size, 1);
  for (let r = 0; r < size; r++) {
    const row = indices[r]!;
    for (let c = 0; c < size; c++) sub.set(r, c, a.get(row, indices[c]!));
    rhs.set(r, 0, b[row]!);
  }

  const chol = new CholeskyDecomposition(sub);
  if (!chol.isPositiveDefinite()) fail();
  const z = chol.solve(rhs);

  const s = new Array<number>(n).fill(0);
  for (let r = 0; r < size; r++) s[indices[r]!] = z.get(r, 0);
  return s;
}

/**
 * LAWSON-HANSON ACTIVE-SET NNLS (D-N1), applied to the ALREADY-RIDGED normal
 * equations for ONE metric key.
 *
 * Minimizes `0.5 * beta' A beta - b' beta` subject to `beta >= 0`, which is the
 * non-negatively constrained form of `A beta = b` — i.e. of
 * `(X'X + lambda*I) beta = X'y + lambda*vBar`. `A` is positive definite, so the
 * objective is STRICTLY convex over a convex feasible set and the minimizer is
 * unique: there is exactly one right answer here, and this function's job is to
 * find it deterministically rather than to approximate it.
 *
 * The formulation takes `A` and `b` (the Gram form) rather than a design matrix
 * and observations, matching Bro & De Jong's "fast NNLS" restatement of the
 * same algorithm. That is not an optimization choice — the accumulator stores
 * only `X'X` and `X'y` and has no raw observations to hand a textbook NNLS.
 *
 * WHY THIS ALGORITHM AND NOT A GRADIENT METHOD (D-N1). Every choice below is
 * discrete and exact:
 *
 *   - The PIVOT RULE is `argmax w` over the active set with `>` (never `>=`),
 *     so a tie resolves to the LOWEST index. One deterministic winner, always.
 *   - The STEP is an exact line search to the nearest constraint boundary, a
 *     closed-form ratio — not a tuned or backtracked step size.
 *   - TERMINATION is the KKT condition itself (`w <= 0` on every active index),
 *     reached in finitely many iterations. There is NO tolerance, NO epsilon
 *     and NO iteration budget in the answer.
 *
 * That matters because this repo pins prediction-stream digests bitwise and
 * publishes artifacts that must reproduce. A solver with a convergence epsilon
 * would make the published `±` a function of how many iterations happened to
 * run, which is not a property of the data.
 *
 * THE ZERO-STEP RULE (`blocked`) is the one guard the textbook algorithm does
 * not state, because in exact arithmetic it cannot happen: `w[entering] > 0`
 * implies the subproblem's `s[entering] > 0`, so the line search always makes
 * progress. In floating point a marginal case can produce `s[entering] <= 0`,
 * a zero-length step, and an admit/expel cycle on the same index forever.
 * Blocking an index that produced a provably zero-length step retires it for
 * the rest of THIS solve, which both guarantees termination and keeps the
 * result a pure function of the inputs — no randomization, no perturbation, no
 * epsilon.
 */
function solveNonNegativeLeastSquares(
  a: Matrix,
  b: readonly number[],
  fail: () => never,
  guard: () => never
): number[] {
  const n = b.length;
  const x = new Array<number>(n).fill(0);
  const passive = new Array<boolean>(n).fill(false);
  const blocked = new Array<boolean>(n).fill(false);

  // `w = b - A*x` is the NEGATIVE gradient of the objective. `x` starts at the
  // feasible point 0, so `w` starts as `b` exactly.
  const w = [...b];

  // See `VarianceNnlsIterationGuardError`: assertions, not stopping criteria.
  // The outer loop admits at most one index per pass and can revisit an index
  // only after an expulsion; the inner loop expels at least one index per pass.
  const outerBound = 4 * n + 16;
  const innerBound = n + 8;

  for (let outer = 0; ; outer++) {
    if (outer > outerBound) guard();

    let entering = -1;
    let best = 0;
    for (let i = 0; i < n; i++) {
      if (passive[i] || blocked[i]) continue;
      // `>` and not `>=`: the lowest index wins a tie. This is the only place
      // the algorithm chooses anything, so it is the only place determinism
      // could have been lost.
      if (w[i]! > best) {
        best = w[i]!;
        entering = i;
      }
    }
    // KKT satisfied: `x >= 0`, `w = 0` on the passive set by construction, and
    // no active index has a strictly positive `w` left. `x` is THE minimizer.
    if (entering === -1) return x;

    passive[entering] = true;
    const xBefore = [...x];

    for (let inner = 0; ; inner++) {
      if (inner > innerBound) guard();
      const s = solveOnPassiveSet(a, b, passive, fail);

      let minPassive = Infinity;
      for (let i = 0; i < n; i++) if (passive[i] && s[i]! < minPassive) minPassive = s[i]!;
      if (minPassive > 0) {
        // The unconstrained solve over the passive set is itself feasible, so
        // it is optimal for this set — accept it wholesale and go re-test KKT.
        for (let i = 0; i < n; i++) x[i] = s[i]!;
        break;
      }

      // Exact line search: move as far toward `s` as feasibility allows. The
      // ratio is closed-form, and the minimum over the blocking indices is the
      // largest feasible step.
      let alpha = Infinity;
      for (let i = 0; i < n; i++) {
        if (!passive[i] || s[i]! > 0) continue;
        const denominator = x[i]! - s[i]!;
        const step = denominator > 0 ? x[i]! / denominator : 0;
        if (step < alpha) alpha = step;
      }
      if (!Number.isFinite(alpha)) alpha = 0;
      for (let i = 0; i < n; i++) x[i] = x[i]! + alpha * (s[i]! - x[i]!);

      // Everything the step drove to (or below) the boundary leaves the passive
      // set, and is set to an EXACT 0 rather than a tiny negative residue — the
      // published contract is that a constrained-out team's variance is exactly
      // 0, which is what `teamMetrics`'s `spreadOf` tests.
      for (let i = 0; i < n; i++) {
        if (passive[i] && x[i]! <= 0) {
          x[i] = 0;
          passive[i] = false;
        }
      }
    }

    // The zero-step rule — see this function's doc comment. `entering` was
    // admitted and expelled again without moving `x` at all, so admitting it
    // again would repeat this pass forever.
    if (!passive[entering] && x.every((value, i) => value === xBefore[i])) blocked[entering] = true;

    for (let i = 0; i < n; i++) {
      let ax = 0;
      for (let k = 0; k < n; k++) ax += a.get(i, k) * x[k]!;
      w[i] = b[i]! - ax;
    }
  }
}

function keySetOf(record: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(record).sort();
}

/**
 * Folds ONE alliance-observation: the row's rating-eligible `teams` and its
 * per-metric-key SQUARED residuals. Returns a NEW accumulator; never mutates.
 *
 * A team key REPEATED within one row accumulates its design-matrix coefficient
 * (`+1`, never overwritten to a flat 1) for exactly the reason `solveEventOpr`
 * records for its own `M.set(row, idx, M.get(row, idx) + 1)`: two demo robots
 * on one alliance remap to the same pseudo key and really did occupy two slots,
 * so the row's equation must carry coefficient 2 for that column. `X'X` and
 * `X'y` therefore take `c_i * c_j` and `c_i * e^2`, which is precisely what
 * `M' M` and `M' y` would produce from that design row.
 */
export function foldVarianceObservation(
  acc: EventVarianceAccumulator,
  teams: readonly string[],
  squaredResidualByKey: Readonly<Record<string, number>>
): EventVarianceAccumulator {
  if (teams.length === 0) return acc;

  const incomingKeys = keySetOf(squaredResidualByKey);
  if (acc.rowCount > 0) {
    const existingKeys = keySetOf(acc.targets);
    if (existingKeys.length !== incomingKeys.length || existingKeys.some((k, i) => k !== incomingKeys[i])) {
      throw new VarianceKeySetMismatchError(existingKeys, incomingKeys);
    }
  }

  // This row's design coefficients, by team, in first-appearance order.
  const teamOrder = [...acc.teamOrder];
  const indexOf = new Map<string, number>();
  teamOrder.forEach((team, i) => indexOf.set(team, i));
  const coefficients = new Map<number, number>();
  for (const team of teams) {
    let index = indexOf.get(team);
    if (index === undefined) {
      index = teamOrder.length;
      teamOrder.push(team);
      indexOf.set(team, index);
    }
    coefficients.set(index, (coefficients.get(index) ?? 0) + 1);
  }

  const n = teamOrder.length;
  const gram: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => acc.gram[i]?.[j] ?? 0)
  );
  for (const [i, ci] of coefficients) {
    for (const [j, cj] of coefficients) gram[i]![j]! += ci * cj;
  }

  // `n_row` is the row's own SLOT COUNT (`teams.length`), not the accumulator's
  // team count — see `vBarSums`' own doc comment for why the per-row divisor is
  // individual.
  const rowSlots = teams.length;
  const targets: Record<string, number[]> = {};
  const vBarSums: Record<string, number> = { ...acc.vBarSums };
  for (const key of incomingKeys) {
    const previous = acc.targets[key];
    const vector = Array.from({ length: n }, (_, i) => previous?.[i] ?? 0);
    const squared = squaredResidualByKey[key]!;
    for (const [i, ci] of coefficients) vector[i]! += ci * squared;
    targets[key] = vector;
    vBarSums[key] = (vBarSums[key] ?? 0) + squared / rowSlots;
  }

  return { rowCount: acc.rowCount + 1, teamOrder, gram, targets, vBarSums };
}

/**
 * The solve memo.
 *
 * Keyed by the ACCUMULATOR OBJECT, never by an event key string. Accumulators
 * are immutable and a NEW object is produced on every fold, so this WeakMap
 * self-invalidates and can never return a pre-match solve after the fold;
 * keying by event key would do exactly that, publishing a stale `±` for the
 * newest match of a live event. It also needs no eviction, since an accumulator
 * that has been replaced is unreachable.
 *
 * The inner `Map` is keyed by LAMBDA, and that is a correctness requirement
 * rather than a generalization: `varianceOpr.recovery.test.ts` and
 * `varianceOpr.test.ts` both solve ONE accumulator at several lambdas (0, 1,
 * 10, 100, plus the zero-centred negative control), and a memo keyed on the
 * object alone would hand the second call the first lambda's answer.
 *
 * A memo of a PURE FUNCTION of an IMMUTABLE OBJECT is referentially
 * transparent — stated explicitly, because a module-level cache in
 * `packages/core` otherwise reads like a purity violation. What it buys:
 * `publish.ts`'s per-match `teamMetrics` loop (whose own comment records 9-26
 * ms per match) pays one Cholesky factorization per FOLD instead of one per
 * CALL.
 */
const SOLVE_MEMO = new WeakMap<EventVarianceAccumulator, Map<number, SolvedEventVariance>>();

/**
 * Solves `(X'X + lambda*I) * beta = X'y + lambda * vBar` SUBJECT TO
 * `beta >= 0` for every metric key, returning per-team VARIANCES — never
 * standard deviations. The caller takes `Math.sqrt` only at the point of
 * display, matching `consistency.ts`'s boundary-contract convention.
 *
 * ONE Cholesky factorization still serves every key for the UNCONSTRAINED
 * solve: `A` does not depend on the key, only the right-hand side does, so the
 * key columns go through as a single multi-column right-hand side exactly as
 * they did at 5.0.0.
 *
 * THE CONSTRAINED SOLVE IS PER-RIGHT-HAND-SIDE and cannot be batched (D-N1).
 * NNLS's active set is a property of ONE key's data — which teams the fit wants
 * to push negative differs key by key — so the shared factorization has nothing
 * to share past the unconstrained step and each column is solved on its own.
 *
 * A column whose unconstrained solution is ALREADY non-negative is returned
 * VERBATIM, not re-derived: such a solution has `w = b - A*x = 0` with
 * `x >= 0`, so it already satisfies the KKT conditions and IS the NNLS answer.
 * That is both the fast path and the guarantee that this change is surgical —
 * when the constraint is inactive the published number is BITWISE what 5.0.0
 * published, and `varianceOpr.test.ts` pins that with an exact-equality
 * assertion rather than a tolerance.
 *
 * `centreOnVBar: false` selects the ZERO-CENTRED ridge. It exists only so
 * `varianceOpr.test.ts` can run D-V2's negative control against the real solve
 * rather than a re-implementation of it; nothing on any shipped path passes it.
 */
export function solveEventVariance(
  acc: EventVarianceAccumulator,
  lambda: number,
  options: { readonly context?: string; readonly centreOnVBar?: boolean } = {}
): SolvedEventVariance {
  const centreOnVBar = options.centreOnVBar ?? true;
  const context = options.context ?? "an unnamed event";

  // Only the default, shipped configuration is memoized. The negative control
  // is a test-only path and must not be able to collide with the real answer
  // in a cache keyed by lambda alone.
  const memoizable = centreOnVBar;
  if (memoizable) {
    const cached = SOLVE_MEMO.get(acc)?.get(lambda);
    if (cached !== undefined) return cached;
  }

  const n = acc.teamOrder.length;
  const keys = Object.keys(acc.targets).sort();
  const solved = new Map<string, Record<string, number>>();
  if (n === 0 || keys.length === 0) return solved;

  const a = Matrix.zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) a.set(i, j, acc.gram[i]?.[j] ?? 0);
    a.set(i, i, a.get(i, i) + lambda);
  }

  const b = Matrix.zeros(n, keys.length);
  keys.forEach((key, column) => {
    const vBar = acc.rowCount > 0 ? (acc.vBarSums[key] ?? 0) / acc.rowCount : 0;
    const centre = centreOnVBar ? vBar : 0;
    const target = acc.targets[key]!;
    for (let i = 0; i < n; i++) b.set(i, column, (target[i] ?? 0) + lambda * centre);
  });

  const chol = new CholeskyDecomposition(a);
  if (!chol.isPositiveDefinite()) {
    throw new VarianceSolveNotPositiveDefiniteError(lambda, n, acc.rowCount, context);
  }
  const unconstrained = chol.solve(b);

  const solvedColumns: number[][] = keys.map((key, column) => {
    const candidate = new Array<number>(n);
    let anyNegative = false;
    for (let i = 0; i < n; i++) {
      const value = unconstrained.get(i, column);
      candidate[i] = value;
      // `< 0` and not `!(>= 0)`: a NaN is passed through untouched, exactly as
      // the retired `Math.max(0, NaN)` did. A NaN here would mean a corrupt
      // accumulator, and inventing a different answer for it in this change
      // would hide that rather than surface it.
      if (value < 0) anyNegative = true;
    }
    if (!anyNegative) return candidate;

    const rhs = new Array<number>(n);
    for (let i = 0; i < n; i++) rhs[i] = b.get(i, column);
    return solveNonNegativeLeastSquares(
      a,
      rhs,
      () => {
        throw new VarianceSolveNotPositiveDefiniteError(lambda, n, acc.rowCount, context);
      },
      () => {
        throw new VarianceNnlsIterationGuardError(n, key, context);
      }
    );
  });

  acc.teamOrder.forEach((team, i) => {
    const perKey: Record<string, number> = {};
    keys.forEach((key, column) => {
      // D-N1. A value of EXACTLY 0 means the non-negativity constraint is
      // ACTIVE for this team — the fit wanted a negative variance and the
      // feasible optimum pinned it at the boundary, i.e. the additive model
      // failed for it. `teamMetrics` OMITS the spread there rather than
      // publishing `0 ±`, which would be a positive claim of perfect
      // consistency; that omission is a domain check, not a floor.
      perKey[key] = solvedColumns[column]![i]!;
    });
    solved.set(team, perKey);
  });

  if (memoizable) {
    let byLambda = SOLVE_MEMO.get(acc);
    if (byLambda === undefined) {
      byLambda = new Map();
      SOLVE_MEMO.set(acc, byLambda);
    }
    byLambda.set(lambda, solved);
  }
  return solved;
}

/** The event's mean per-team variance for one metric key — `vBarSums[k] / rowCount`, 0 before any fold. */
export function vBarFor(acc: EventVarianceAccumulator, metricKey: string): number {
  if (acc.rowCount === 0) return 0;
  return (acc.vBarSums[metricKey] ?? 0) / acc.rowCount;
}
