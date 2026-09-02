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
 * squares; clamp a negative solution at 0 (a variance cannot be negative). A
 * proper NNLS would be better and is a documented future refinement, not a
 * blocker — the CLAMP RATE is measured on both the synthetic harness and a
 * real corpus event by `scripts/measureVarianceOpr.ts`, and a non-trivial rate
 * is the finding that would motivate it.
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
 * check. The one omission `teamMetrics` does make is at a CLAMPED (`<= 0`)
 * solve, where publishing `0 ±` would be a positive claim of perfection.
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
 * THE LAST ROW IS AN UNRESOLVED PRODUCT TRADE, not a settled one. A team whose
 * solve lands on a non-positive variance publishes no `±` at all (see
 * `teamMetrics`'s `spreadOf`), and lowering lambda to buy discrimination buys it
 * partly by turning numbers into blanks: at 2, better than a quarter of a
 * 40-team event shows nothing. These are not thin-history teams — they have a
 * full 12 matches; their estimate simply lands below zero as noise around a
 * genuinely small variance.
 *
 * There is no lambda that is good on all three rows, and the honest reading is
 * that clamping-then-omitting is the wrong terminal behaviour rather than
 * lambda being wrong. The principled fix is a NON-NEGATIVE least squares solve,
 * which constrains beta >= 0 DURING the solve instead of discarding negatives
 * after it — variances are non-negative by definition, so that is the more
 * correct estimator, not a workaround. It would make the low-lambda regime
 * viable and is the recommended next step. Do not "fix" the blank rate by
 * raising lambda: 7 already reaches the rejected 0.400 league weight.
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
 * Solves `(X'X + lambda*I) * beta = X'y + lambda * vBar` for every metric key
 * at once, returning per-team VARIANCES — never standard deviations. The
 * caller takes `Math.sqrt` only at the point of display, matching
 * `consistency.ts`'s boundary-contract convention.
 *
 * ONE Cholesky factorization serves every key: `A` does not depend on the key,
 * only the right-hand side does, so the key columns are solved as a single
 * multi-column right-hand side.
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
  const x = chol.solve(b);

  acc.teamOrder.forEach((team, i) => {
    const perKey: Record<string, number> = {};
    keys.forEach((key, column) => {
      // D-V1's clamp. A clamped value means the least-squares fit wanted a
      // NEGATIVE variance for this team — the additive model failed for it.
      // `teamMetrics` OMITS the spread at a clamped value rather than
      // publishing `0 ±`, which would be a positive claim of perfect
      // consistency; that omission is a domain check, not a floor.
      perKey[key] = Math.max(0, x.get(i, column));
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
