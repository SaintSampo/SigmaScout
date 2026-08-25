/**
 * Predicted ranking-point mean and standard deviation, derived from a
 * published RP pmf (06-08-PLAN.md Task 1). Treats the pmf as a probability
 * mass over ranking-point values `0..n-1` — the exact shape
 * `TeamSeasonMatchSchema.redRpPmf`/`blueRpPmf` publish (`packages/harness/
 * pageArtifacts.ts`'s `isValidPmf` — a pmf, when present, is non-empty and
 * sums to 1 within 1e-9).
 */

export interface RpMoments {
  mean: number;
  sd: number;
}

/**
 * `undefined` for an absent or empty pmf — OPR and EPA publish none (D-13
 * locks that as silent: no band, no explanatory note, no placeholder).
 * Guards the degenerate second-moment case so floating-point error can never
 * produce a negative variance under the square root.
 */
export function rpMoments(pmf: readonly number[] | undefined): RpMoments | undefined {
  if (pmf === undefined || pmf.length === 0) return undefined;

  let mean = 0;
  for (let rp = 0; rp < pmf.length; rp++) {
    mean += rp * pmf[rp]!;
  }

  let variance = 0;
  for (let rp = 0; rp < pmf.length; rp++) {
    const deviation = rp - mean;
    variance += deviation * deviation * pmf[rp]!;
  }

  const sd = Math.sqrt(Math.max(0, variance));
  return { mean, sd };
}
