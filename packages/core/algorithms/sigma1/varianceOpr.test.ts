/**
 * Unit behaviours of the per-team variance decomposition (`varianceOpr.ts`,
 * quick task 260902-varopr). Known answers and provable structural properties
 * only — matching `opr.test.ts`/`epa.test.ts`'s convention.
 *
 * The three-estimator RECOVERY comparison against known synthetic sigma lives
 * in `varianceOpr.recovery.test.ts`; this file covers the accumulator's own
 * algebra, the rank-deficiency answer, the memo, and D-N1's non-negative
 * least-squares solve (which replaced the retired `Math.max(0, x)` clamp).
 */
import { CholeskyDecomposition, Matrix } from "ml-matrix";
import { describe, expect, it } from "vitest";
import {
  SIGMA1_VARIANCE_OPR_RIDGE,
  VarianceKeySetMismatchError,
  VarianceSolveNotPositiveDefiniteError,
  emptyEventVarianceAccumulator,
  foldVarianceObservation,
  solveEventVariance,
  vBarFor,
  type EventVarianceAccumulator,
} from "./varianceOpr.js";

const KEY = "total";

function fold(
  acc: EventVarianceAccumulator,
  teams: readonly string[],
  squared: number
): EventVarianceAccumulator {
  return foldVarianceObservation(acc, teams, { [KEY]: squared });
}

/**
 * Registers a team in `teamOrder` with an ALL-ZERO row of `X'X` and a 0 entry
 * in `X'y` — the rank-deficiency case, constructed directly because the
 * accumulator is plain data and no fold can produce a zero row (every fold
 * that names a team also gives it a coefficient).
 *
 * That is exactly the situation this constructs a proxy for: a team the event
 * knows about but has no observation of.
 */
function withGhostTeam(acc: EventVarianceAccumulator, ghost: string): EventVarianceAccumulator {
  const n = acc.teamOrder.length + 1;
  return {
    ...acc,
    teamOrder: [...acc.teamOrder, ghost],
    gram: [...acc.gram.map((row) => [...row, 0]), new Array<number>(n).fill(0)],
    targets: Object.fromEntries(Object.entries(acc.targets).map(([key, v]) => [key, [...v, 0]])),
  };
}

describe("foldVarianceObservation — the accumulator's algebra", () => {
  it("returns a NEW accumulator and never mutates its input", () => {
    const before = fold(emptyEventVarianceAccumulator(), ["A", "B", "C"], 30);
    const snapshot = JSON.stringify(before);
    const after = fold(before, ["A", "D", "E"], 60);
    expect(after).not.toBe(before);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(before.rowCount).toBe(1);
    expect(after.rowCount).toBe(2);
  });

  it("a team key REPEATED within one row keeps coefficient 2 rather than a flat 1 (the demo-remap case)", () => {
    // `ratingEligibleTeams` remaps two demo robots on one alliance to the same
    // pseudo key, and they really did occupy two slots. `opr.ts`'s own
    // `M.set(row, idx, M.get(row, idx) + 1)` records the same reasoning.
    // A coefficient of 2 puts `c_i * c_i = 4` on that column's `X'X` diagonal;
    // overwriting to a flat 1 would put 1 there and silently under-count the
    // row's equation for every real team it shares a system with.
    const doubled = fold(emptyEventVarianceAccumulator(), ["DEMO", "DEMO", "REAL"], 100);
    const demo = doubled.teamOrder.indexOf("DEMO");
    const real = doubled.teamOrder.indexOf("REAL");
    expect(doubled.teamOrder).toEqual(["DEMO", "REAL"]);
    expect(doubled.gram[demo]![demo]).toBe(4);
    expect(doubled.gram[real]![real]).toBe(1);
    expect(doubled.gram[demo]![real]).toBe(2);
    // `X'y` carries the same coefficient.
    expect(doubled.targets[KEY]![demo]).toBe(200);
    expect(doubled.targets[KEY]![real]).toBe(100);
  });

  it("vBarSums divides by each row's OWN slot count, never by a nominal 3", () => {
    // A surrogate-reduced alliance genuinely has two eligible slots. Dividing
    // that row by 3 would understate the league mean for exactly the rows that
    // differ from the norm.
    let acc = fold(emptyEventVarianceAccumulator(), ["A", "B", "C"], 90); // 90/3 = 30
    acc = fold(acc, ["A", "B"], 90); //                                       90/2 = 45
    expect(acc.vBarSums[KEY]).toBeCloseTo(75, 12);
    expect(vBarFor(acc, KEY)).toBeCloseTo(37.5, 12);
  });

  it("an empty team list is a no-op, not a folded row", () => {
    const acc = fold(emptyEventVarianceAccumulator(), ["A", "B", "C"], 30);
    expect(fold(acc, [], 999)).toBe(acc);
  });

  it("a row whose metric-key set differs from the accumulator's throws rather than biasing vBar", () => {
    const acc = foldVarianceObservation(emptyEventVarianceAccumulator(), ["A", "B", "C"], { total: 30, auto: 4 });
    expect(() => foldVarianceObservation(acc, ["A", "B", "C"], { total: 30 })).toThrow(VarianceKeySetMismatchError);
  });
});

describe("solveEventVariance — rank deficiency answered by the math (D-V2)", () => {
  function threeRowSystem(): EventVarianceAccumulator {
    let acc = fold(emptyEventVarianceAccumulator(), ["A", "B", "C"], 30);
    acc = fold(acc, ["A", "D", "E"], 60);
    acc = fold(acc, ["B", "D", "F"], 12);
    return acc;
  }

  it("a team with ZERO folded rows solves to vBar, to floating-point precision, at every lambda", () => {
    // Its row of `X'X` is all zeros and its entry in `X'y` is 0, so its
    // equation reduces to `lambda * beta_i = lambda * vBar`. This is not a
    // substituted constant: it is what the estimator's own algebra returns
    // when the data says nothing, and it is the honest claim ("as uncertain as
    // a typical robot at this event") where a minimum-norm 0 would be a
    // positive claim of PERFECT CONSISTENCY.
    // Bitwise was the WRONG BAR and this is a correction of an over-claim, not
    // a tolerance widened to hide a defect. The equality is exact in exact
    // arithmetic, but the solve runs Gaussian elimination over the whole
    // system, so the ghost row picks up rounding from the elimination of the
    // rows it shares a matrix with — by an amount that depends on lambda. It
    // happened to land bitwise at lambda 1 and 10 and lands 2 ULP away at
    // lambda 2, which is a fact about IEEE-754, not about the estimator. The
    // property actually being defended — a team the data says nothing about is
    // reported as "as uncertain as a typical robot here", never as a
    // minimum-norm 0 that would claim PERFECT CONSISTENCY — is fully defended
    // at a relative tolerance far tighter than any displayed value could show.
    const acc = withGhostTeam(threeRowSystem(), "GHOST");
    const vBar = vBarFor(acc, KEY);
    expect(vBar).toBeGreaterThan(0);
    for (const lambda of [1, SIGMA1_VARIANCE_OPR_RIDGE, 100]) {
      const solved = solveEventVariance(acc, lambda);
      const got = solved.get("GHOST")![KEY]!;
      expect(Math.abs(got - vBar) / vBar, `lambda ${lambda}`).toBeLessThan(1e-12);
    }
  });

  it("a team with ONE row lands strictly between its own row's e^2/n and vBar, and nearer vBar at lambda 10 than at lambda 1", () => {
    // The one-row team's ONLY row is shared with two equally new teammates, so
    // least squares has no reason to split it unevenly and the row's own even
    // share IS the unridged answer. The ridge then pulls it toward `vBar`, and
    // the bracket is what says the pull is partial rather than a substitution.
    //
    // Stated deliberately, because it is the whole difference from the retired
    // even-split estimator: when a one-row team's teammates ARE well
    // determined, the solve puts the row's unexplained residual on the NEW
    // team and its estimate lands OUTSIDE the row's even share. That is the
    // decomposition un-mixing partners, not a violation of this property.
    let acc = fold(emptyEventVarianceAccumulator(), ["A", "B", "C"], 30);
    acc = fold(acc, ["A", "B", "C"], 36);
    acc = fold(acc, ["A", "B", "C"], 24);
    acc = fold(acc, ["LONE", "N1", "N2"], 300);
    const vBar = vBarFor(acc, KEY);
    const own = 300 / 3;
    expect(own).toBeGreaterThan(vBar);

    const at1 = solveEventVariance(acc, 1).get("LONE")![KEY]!;
    const at10 = solveEventVariance(acc, 10).get("LONE")![KEY]!;
    for (const [lambda, value] of [
      [1, at1],
      [10, at10],
    ] as const) {
      expect(value, `lambda ${lambda} above vBar`).toBeGreaterThan(vBar);
      expect(value, `lambda ${lambda} below its own row`).toBeLessThan(own);
    }
    expect(Math.abs(at10 - vBar)).toBeLessThan(Math.abs(at1 - vBar));
  });

  it("lambda = 0 on a rank-deficient system THROWS rather than returning zeros", () => {
    // One row over two teams: `X'X` is [[1,1],[1,1]], rank 1. With no ridge
    // there is no positive-definite factorization, and `opr.ts`'s minimum-norm
    // answer — 0 — would be a false claim of perfect consistency here. The
    // ridge is what makes this an ordinary well-posed solve; its absence must
    // be loud.
    const acc = fold(emptyEventVarianceAccumulator(), ["A", "B"], 50);
    expect(() => solveEventVariance(acc, 0, { context: "2024fixture" })).toThrow(
      VarianceSolveNotPositiveDefiniteError
    );
    expect(() => solveEventVariance(acc, 0, { context: "2024fixture" })).toThrow(/2024fixture/);
    // With the shipped ridge the identical system is well posed.
    expect(() => solveEventVariance(acc, SIGMA1_VARIANCE_OPR_RIDGE)).not.toThrow();
  });

  it("an empty accumulator solves to an empty map rather than throwing", () => {
    expect(solveEventVariance(emptyEventVarianceAccumulator(), SIGMA1_VARIANCE_OPR_RIDGE).size).toBe(0);
  });

  it("a solved value that the UNCONSTRAINED fit wants NEGATIVE is pinned at exactly 0 (D-N1)", () => {
    // sigma_A + sigma_B = 10, sigma_B + sigma_C = 200, sigma_A + sigma_C = 0
    // has the exact unconstrained solution sigma_A = -95, which is not a
    // variance. The non-negativity constraint binds and returns exactly 0;
    // `teamMetrics` then OMITS the spread rather than publishing `0 ±`, because
    // a pinned value means the additive model failed for that team and `0 ±`
    // would claim perfection.
    let acc = fold(emptyEventVarianceAccumulator(), ["A", "B"], 10);
    acc = fold(acc, ["B", "C"], 200);
    acc = fold(acc, ["A", "C"], 0);
    const solved = solveEventVariance(acc, 1e-6);
    expect(solved.get("A")![KEY]).toBe(0);
    // Non-vacuity: the other two are genuinely positive, so the constraint is
    // selective rather than flattening the whole solve.
    expect(solved.get("B")![KEY]).toBeGreaterThan(0);
    expect(solved.get("C")![KEY]).toBeGreaterThan(0);
  });

  it("every solved value is a VARIANCE, never a standard deviation", () => {
    // Boundary contract, stated as a test because the convention is easy to
    // break silently: a caller takes `Math.sqrt` only at the point of display.
    // A single-team-per-row system makes the expected variance exact.
    let acc = fold(emptyEventVarianceAccumulator(), ["SOLO"], 400);
    acc = fold(acc, ["SOLO"], 400);
    const solved = solveEventVariance(acc, SIGMA1_VARIANCE_OPR_RIDGE);
    // vBar is 400 and every row agrees, so the ridge pulls toward the same
    // value the data states: exactly 400 (a variance), not 20 (its SD).
    expect(solved.get("SOLO")![KEY]).toBeCloseTo(400, 9);
  });
});

/**
 * D-N1 (quick task 260903-5dp): the two assertions that decide whether the
 * non-negative least-squares solve replaced the retired `Math.max(0, x)` clamp
 * CORRECTLY, rather than merely replacing it.
 *
 * They are a pair on purpose and neither is sufficient alone. The first proves
 * the change is SURGICAL — where the constraint is inactive, nothing moved, to
 * the bit. The second proves the change is REAL — where the constraint binds,
 * NNLS returns a genuinely different vector rather than the clamp's answer
 * under a new name. A change that passed only the first would be a no-op; a
 * change that passed only the second would have moved numbers it had no
 * business moving.
 */
describe("solveEventVariance — non-negative least squares (D-N1)", () => {
  /** Rebuilds the exact system `solveEventVariance` builds, so the reference solve is the real one and not an approximation of it. */
  function ridgedSystem(acc: EventVarianceAccumulator, lambda: number): { a: Matrix; b: Matrix } {
    const n = acc.teamOrder.length;
    const a = Matrix.zeros(n, n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) a.set(i, j, acc.gram[i]?.[j] ?? 0);
      a.set(i, i, a.get(i, i) + lambda);
    }
    const vBar = (acc.vBarSums[KEY] ?? 0) / acc.rowCount;
    const b = Matrix.zeros(n, 1);
    for (let i = 0; i < n; i++) b.set(i, 0, (acc.targets[KEY]![i] ?? 0) + lambda * vBar);
    return { a, b };
  }

  it("is BITWISE the plain Cholesky solve whenever the unconstrained solution is already non-negative", () => {
    // sigma_A + sigma_B = 100, sigma_B + sigma_C = 140, sigma_A + sigma_C = 120
    // solves to (40, 60, 80) — every component strictly positive, so the
    // constraint is INACTIVE and the KKT conditions are already satisfied by
    // the unconstrained answer. NNLS must therefore return that answer
    // UNCHANGED, not a re-derivation of it that agrees to nine decimals.
    //
    // `toBe` (Object.is), never `toBeCloseTo`: a tolerance here would pass for
    // an implementation that quietly re-solves every column through the
    // active-set path and lands a few ULPs away, which is exactly the
    // non-surgical outcome this assertion exists to rule out — and which would
    // move the published `±` for the ~65% of cells that were never clamped.
    let acc = fold(emptyEventVarianceAccumulator(), ["A", "B"], 100);
    acc = fold(acc, ["B", "C"], 140);
    acc = fold(acc, ["A", "C"], 120);

    const { a, b } = ridgedSystem(acc, SIGMA1_VARIANCE_OPR_RIDGE);
    const reference = new CholeskyDecomposition(a).solve(b);
    // Non-vacuity: the premise of this test is that the reference is positive.
    for (let i = 0; i < 3; i++) expect(reference.get(i, 0)).toBeGreaterThan(0);

    const solved = solveEventVariance(acc, SIGMA1_VARIANCE_OPR_RIDGE);
    acc.teamOrder.forEach((team, i) => {
      expect(solved.get(team)![KEY]).toBe(reference.get(i, 0));
    });
  });

  it("RE-OPTIMISES the surviving components when the constraint binds, rather than zeroing one and keeping the rest", () => {
    // The distinction this pins is the entire point of D-N1, worked by hand.
    //
    // Design rows (residual^2 on the right):
    //     A + B = 10        B + C = 200        A + C = 0
    // Unconstrained, this is exactly determined: A = -95, B = 105, C = 95.
    // A = -95 is not a variance, so the constraint binds on A.
    //
    // The RETIRED clamp would publish max(0, .) = (0, 105, 95) — B and C left
    // at values fitted while A was allowed to absorb -95 of residual.
    //
    // NNLS instead re-solves the remaining free components with A HELD AT 0,
    // i.e. minimizes (B - 10)^2 + (B + C - 200)^2 + (C - 0)^2 over B, C >= 0:
    //     d/dB:  2(B - 10) + 2(B + C - 200) = 0  ->  2B +  C = 210
    //     d/dC:  2(B + C - 200) + 2C        = 0  ->   B + 2C = 200
    //     ->  B = 220/3 = 73.333...,  C = 190/3 = 63.333...
    // Both are strictly positive, and the KKT check at A holds:
    //     df/dA = 2(A + B - 10) + 2(A + C - 0) = 2(190/3) + 2(190/3) > 0,
    // so pushing A above 0 would only increase the residual. (0, 220/3, 190/3)
    // is the constrained optimum.
    //
    // lambda is 1e-6 rather than 0 solely to keep the system positive definite
    // (`solveEventVariance` requires it); at that size it perturbs the answer
    // in the sixth decimal, which is why the assertions below carry precision 4.
    let acc = fold(emptyEventVarianceAccumulator(), ["A", "B"], 10);
    acc = fold(acc, ["B", "C"], 200);
    acc = fold(acc, ["A", "C"], 0);
    const solved = solveEventVariance(acc, 1e-6);

    expect(solved.get("A")![KEY]).toBe(0);
    expect(solved.get("B")![KEY]).toBeCloseTo(220 / 3, 4);
    expect(solved.get("C")![KEY]).toBeCloseTo(190 / 3, 4);

    // And explicitly NOT `max(0, cholesky)`. Asserted as a separate, negative
    // statement so that a future revert to the clamp cannot be made to pass by
    // loosening the tolerances above.
    expect(solved.get("B")![KEY]).not.toBeCloseTo(105, 1);
    expect(solved.get("C")![KEY]).not.toBeCloseTo(95, 1);
  });

  it("is DETERMINISTIC across two structurally identical but distinct accumulators, to the bit", () => {
    // The memo returns the identical OBJECT for a repeated call, so re-solving
    // the same accumulator proves nothing about the solver. Two separately
    // built, structurally equal accumulators are different WeakMap keys, so
    // both of these genuinely run the active-set loop — and the whole reason
    // D-N1 forbids a tolerance-terminated method is that this must hold
    // bitwise, since promoted digests and published artifacts are pinned that
    // way.
    const build = (): EventVarianceAccumulator => {
      let acc = fold(emptyEventVarianceAccumulator(), ["A", "B", "C"], 10);
      acc = fold(acc, ["B", "C", "D"], 400);
      acc = fold(acc, ["A", "C", "D"], 0);
      acc = fold(acc, ["A", "B", "D"], 250);
      return acc;
    };
    const first = solveEventVariance(build(), 1e-3);
    const second = solveEventVariance(build(), 1e-3);
    expect(first).not.toBe(second);

    // Non-vacuity: this system must actually EXERCISE the constraint, or the
    // test would be re-proving the unconstrained fast path above.
    const pinned = [...first.values()].filter((perKey) => perKey[KEY] === 0).length;
    expect(pinned).toBeGreaterThan(0);

    for (const team of ["A", "B", "C", "D"]) {
      expect(second.get(team)![KEY]).toBe(first.get(team)![KEY]);
    }
  });
});

describe("solveEventVariance — the memo", () => {
  it("returns the IDENTICAL object for the same accumulator and lambda, and a different one after a fold", () => {
    const acc = fold(fold(emptyEventVarianceAccumulator(), ["A", "B", "C"], 30), ["A", "D", "E"], 60);
    const first = solveEventVariance(acc, SIGMA1_VARIANCE_OPR_RIDGE);
    expect(solveEventVariance(acc, SIGMA1_VARIANCE_OPR_RIDGE)).toBe(first);

    // Keyed by the accumulator OBJECT, never an event key string: a fold
    // produces a new immutable object, so the memo self-invalidates and can
    // never hand back a pre-match solve after the fold.
    const folded = fold(acc, ["B", "D", "F"], 12);
    expect(solveEventVariance(folded, SIGMA1_VARIANCE_OPR_RIDGE)).not.toBe(first);
  });

  it("a different lambda on the same accumulator is a different answer, not a cache hit", () => {
    // The inner lambda key is a CORRECTNESS requirement, not a generalization:
    // the recovery test solves one accumulator at several lambdas.
    const acc = fold(fold(emptyEventVarianceAccumulator(), ["A", "B", "C"], 30), ["A", "D", "E"], 300);
    const at10 = solveEventVariance(acc, 10);
    const at100 = solveEventVariance(acc, 100);
    expect(at100).not.toBe(at10);
    expect(at100.get("A")![KEY]).not.toBe(at10.get("A")![KEY]);
  });
});
