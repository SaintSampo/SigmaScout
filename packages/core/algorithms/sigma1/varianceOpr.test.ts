/**
 * Unit behaviours of the per-team variance decomposition (`varianceOpr.ts`,
 * quick task 260902-varopr). Known answers and provable structural properties
 * only — matching `opr.test.ts`/`epa.test.ts`'s convention.
 *
 * The three-estimator RECOVERY comparison against known synthetic sigma lives
 * in `varianceOpr.recovery.test.ts`; this file covers the accumulator's own
 * algebra, the rank-deficiency answer, the memo, and the clamp.
 */
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

  it("a team with ZERO folded rows solves to EXACTLY vBar — bitwise, at every lambda", () => {
    // Its row of `X'X` is all zeros and its entry in `X'y` is 0, so its
    // equation reduces to `lambda * beta_i = lambda * vBar`. This is not a
    // substituted constant: it is what the estimator's own algebra returns
    // when the data says nothing, and it is the honest claim ("as uncertain as
    // a typical robot at this event") where a minimum-norm 0 would be a
    // positive claim of PERFECT CONSISTENCY.
    const acc = withGhostTeam(threeRowSystem(), "GHOST");
    const vBar = vBarFor(acc, KEY);
    expect(vBar).toBeGreaterThan(0);
    for (const lambda of [1, SIGMA1_VARIANCE_OPR_RIDGE, 100]) {
      const solved = solveEventVariance(acc, lambda);
      expect(solved.get("GHOST")![KEY], `lambda ${lambda}`).toBe(vBar);
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

  it("a solved value that the least-squares fit wants NEGATIVE is clamped at 0 (D-V1)", () => {
    // sigma_A + sigma_B = 10, sigma_B + sigma_C = 200, sigma_A + sigma_C = 0
    // has the exact solution sigma_A = -95, which is not a variance. The clamp
    // returns 0; `teamMetrics` then OMITS the spread rather than publishing
    // `0 ±`, because a clamped value means the additive model failed for that
    // team and `0 ±` would claim perfection.
    let acc = fold(emptyEventVarianceAccumulator(), ["A", "B"], 10);
    acc = fold(acc, ["B", "C"], 200);
    acc = fold(acc, ["A", "C"], 0);
    const solved = solveEventVariance(acc, 1e-6);
    expect(solved.get("A")![KEY]).toBe(0);
    // Non-vacuity: the other two are genuinely positive, so the clamp is
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
