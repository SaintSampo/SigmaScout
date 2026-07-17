// Ridge-regularized OPR solver. Source-agnostic: give it alliance rows and a
// target vector, get per-team contributions. This is the first real model —
// the honest baseline we later replace with the Kalman/hierarchical filter.
//
// For one scoring component we minimize:
//     || A x - b ||^2  +  lambda * || x - prior ||^2
// where each row of A is an alliance (three 1s, one per team) and b is that
// alliance's score on the component. The ridge term shrinks unseen/thin teams
// toward a league prior instead of letting them explode (plain OPR's fatal flaw).
//
// We never form A^T A densely. A is extremely sparse (3 nonzeros per row), so we
// solve the normal equations (A^T A + lambda I) x = A^T b + lambda*prior with
// conjugate gradient using sparse mat-vecs — fast even for a few thousand teams.

/** Each alliance observation: the 3 team indices and the observed component score. */
export interface AllianceRow {
  teams: [number, number, number];
  score: number;
}

/** A x  — for each row, sum the three selected entries of x. */
function matVec(rows: AllianceRow[], x: Float64Array): Float64Array {
  const out = new Float64Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const [a, b, c] = rows[i].teams;
    out[i] = x[a] + x[b] + x[c];
  }
  return out;
}

/** A^T y  — scatter-add each row's value onto its three teams. */
function matVecT(rows: AllianceRow[], y: Float64Array, n: number): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < rows.length; i++) {
    const [a, b, c] = rows[i].teams;
    out[a] += y[i];
    out[b] += y[i];
    out[c] += y[i];
  }
  return out;
}

/**
 * Solve ridge least squares for one component.
 * @param n         number of teams (length of solution vector)
 * @param rows      alliance observations
 * @param lambda    ridge strength (larger = more shrinkage toward prior)
 * @param prior     per-team prior mean (length n), the shrinkage target
 * @returns per-team contribution estimate
 */
export function solveRidgeOPR(
  n: number,
  rows: AllianceRow[],
  lambda: number,
  prior: Float64Array,
): Float64Array {
  // Right-hand side: A^T b + lambda * prior
  const b = new Float64Array(rows.length);
  for (let i = 0; i < rows.length; i++) b[i] = rows[i].score;
  const rhs = matVecT(rows, b, n);
  for (let i = 0; i < n; i++) rhs[i] += lambda * prior[i];

  // Operator M x = A^T A x + lambda x
  const applyM = (x: Float64Array): Float64Array => {
    const ax = matVec(rows, x);
    const out = matVecT(rows, ax, n);
    for (let i = 0; i < n; i++) out[i] += lambda * x[i];
    return out;
  };

  // Conjugate gradient, warm-started at the prior.
  const x = Float64Array.from(prior);
  let r = subtract(rhs, applyM(x));
  let p = Float64Array.from(r);
  let rsold = dot(r, r);
  const maxIter = Math.min(1000, n + 50);
  const tol = 1e-8 * Math.max(rsold, 1);

  for (let k = 0; k < maxIter; k++) {
    if (rsold < tol) break;
    const Mp = applyM(p);
    const alpha = rsold / dot(p, Mp);
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * Mp[i];
    }
    const rsnew = dot(r, r);
    const beta = rsnew / rsold;
    for (let i = 0; i < n; i++) p[i] = r[i] + beta * p[i];
    rsold = rsnew;
  }
  return x;
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function subtract(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] - b[i];
  return out;
}

/** Root-mean-square residual of a fit, for reporting/variance estimation. */
export function fitRmse(
  rows: AllianceRow[],
  x: Float64Array,
): number {
  if (rows.length === 0) return 0;
  const pred = matVec(rows, x);
  let sse = 0;
  for (let i = 0; i < rows.length; i++) {
    const e = pred[i] - rows[i].score;
    sse += e * e;
  }
  return Math.sqrt(sse / rows.length);
}
