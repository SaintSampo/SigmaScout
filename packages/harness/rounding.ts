/**
 * Publish-time rounding rules, with a stated tie-breaking contract.
 *
 * BOUNDARY: this module is for building PUBLISHED page artifacts only
 * (`packages/harness/pageArtifacts.ts`). It is never called from the
 * scoring path (`packages/harness/score.ts`) or anything a committed digest
 * hashes: `computePredictionStreamDigest` requires its input stay
 * unrounded, since a promoted version's digest must reproduce bitwise, and
 * applying display precision to that stream would silently invalidate it.
 *
 * FIELD CLASSES (decimals, why):
 * - metric (2): display metrics (`TeamMetric.value`/`spread`, component
 *   means/variances, predicted/actual scores) render as `X ± Y`; a third
 *   decimal is never shown.
 * - probability (4): pRedWin. The simulation draws from these and Brier is
 *   quadratic in this value, so 4 decimals keeps the published number
 *   agreeing with the harness number well inside anything the site quotes.
 * - pmf (5): the simulation draws ranking points from these repeatedly
 *   across 1000 runs, where a truncation bias would compound rather than
 *   cancel. Every pmf field in every schema shares this key.
 * - variance (4): the square of a spread shown to 2 decimals — including
 *   the per-alliance "own" variance fields, the same physical quantity at
 *   a different aggregation level — rounding it as coarsely as the spread
 *   would visibly distort the derived `±`.
 * - percentile (1): matches `colour-and-tiers.md`'s worked precision
 *   (p50=39.2, not p50=39.20000001).
 * - rankingPoints (2): TBA's own reported Ranking Score, a per-match
 *   average — not a model output like `metric`, so it gets its own key
 *   even though the decimal count matches; it's TBA's own published
 *   precision.
 *
 * Integral fields (RP counts, rank, week, allianceNumber, wins/losses/ties)
 * publish unrounded with no rounding-rule entry — they're integers by
 * construction. `sortTime` is an epoch-second timestamp, not a measured
 * quantity, so rounding it would be meaningless at best and could reorder
 * a match list at worst.
 *
 * TIE-BREAKING (roundTo): half-away-from-zero, implemented explicitly
 * rather than relying on `Math.round`, which is asymmetric for negatives
 * (`Math.round(-1.5)` is `-1`, not `-2`). Symmetric rounding means a metric
 * and its negation round to the same magnitude.
 *
 * TIE-BREAKING (roundPmf): every entry rounds independently to 5 decimals,
 * then the residual `1 - sum(rounded)` is added to the entry with the
 * LARGEST rounded value (lowest index on a tie) — a fixed absolute nudge is
 * a smaller relative change on a large entry than a small one, and the
 * result is a pure, deterministic function of the input, so an offline and
 * a future online publish run agree.
 */

/** The field classes this module rounds, and their decimal counts. Exported as plain data so the rule can be quoted by name rather than paraphrased. */
export const ROUNDING_RULE = {
  metric: 2,
  score: 2,
  probability: 4,
  pmf: 5,
  variance: 4,
  /** Percentile, matching `colour-and-tiers.md`'s worked precision. */
  percentile: 1,
  /** `EventTeamSchema.rp`: TBA's own Ranking Score, kept separate from `metric` so a future change to model-display precision can't silently move a number TBA reported. */
  rankingPoints: 2,
} as const;

export class NonFiniteRoundError extends Error {
  constructor(value: number, decimals: number) {
    super(`roundTo: refusing to round a non-finite value (${value}) to ${decimals} decimals`);
    this.name = "NonFiniteRoundError";
  }
}

/**
 * Shifts `magnitude`'s decimal point by `exponentDelta` places via
 * exponential-notation string construction, WITHOUT naively concatenating a
 * second `"e..."` suffix onto a string JS may have already rendered in
 * exponential form. `(0.00000001).toString()` is `"1e-8"`, not
 * `"0.00000001"` — JS switches a number's own `toString()` to exponential
 * notation once its magnitude drops below 1e-6 or reaches 1e21. Naively
 * building `` `${magnitude}e${exponentDelta}` `` against such a value
 * produces a malformed double-exponent string like `"1e-8e4"`, which
 * `Number(...)` silently parses to `NaN` (hit in practice by a real
 * near-zero OPR blowout prediction). Combining `magnitude`'s OWN exponent
 * (if its string form has one) with `exponentDelta` numerically, rather
 * than string-concatenating a second `"e"`, fixes this for every
 * magnitude, not just the ones small/large enough to trigger it.
 */
function shiftDecimalPoint(magnitude: number, exponentDelta: number): number {
  const str = magnitude.toString();
  const eIndex = str.indexOf("e");
  if (eIndex === -1) {
    return Number(`${str}e${exponentDelta}`);
  }
  const mantissa = str.slice(0, eIndex);
  const existingExponent = Number.parseInt(str.slice(eIndex + 1), 10);
  return Number(`${mantissa}e${existingExponent + exponentDelta}`);
}

/**
 * Half-away-from-zero rounding to `decimals` places, symmetric about zero.
 * See this module's file header for why this is implemented explicitly
 * rather than delegated to `Math.round`.
 *
 * Scaling via plain multiplication (`magnitude * 10 ** decimals`) is NOT
 * used here: IEEE 754 doubles cannot represent 1.005 exactly (its nearest
 * double is ~1.00499999999999989), so `1.005 * 100` evaluates to
 * ~100.49999999999999 and `Math.round` would silently round DOWN. Instead
 * this shifts the decimal point via `shiftDecimalPoint`, which reparses the
 * value's shortest round-trippable decimal string as one literal —
 * `"1.005e2"` parses directly to the exact double `100.5` — so no
 * intermediate multiplication error is introduced before `Math.round` sees
 * it.
 */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) {
    throw new NonFiniteRoundError(value, decimals);
  }
  const sign = value < 0 ? -1 : 1;
  const magnitude = Math.abs(value);
  const shifted = shiftDecimalPoint(magnitude, decimals);
  const roundedShifted = Math.round(shifted);
  const rounded = shiftDecimalPoint(roundedShifted, -decimals);
  return sign * rounded;
}

/** Display metrics: `TeamMetric.value`/`spread`, component means/variances, predicted/actual scores. */
export function roundMetric(value: number): number {
  return roundTo(value, ROUNDING_RULE.metric);
}

/** Win probabilities (`pRedWin`). */
export function roundProbability(value: number): number {
  return roundTo(value, ROUNDING_RULE.probability);
}

/**
 * Rounds each pmf entry to `ROUNDING_RULE.pmf` decimals, then renormalizes
 * so the rounded array still sums to 1 within the same 1e-9 tolerance every
 * pmf validator in this codebase applies — see this module's file header
 * for the full tie-breaking contract.
 */
export function roundPmf(pmf: readonly number[]): number[] {
  if (pmf.length === 0) {
    throw new Error("roundPmf: an empty array is never a valid distribution");
  }
  const rounded = pmf.map((entry) => roundTo(entry, ROUNDING_RULE.pmf));
  const sum = rounded.reduce((total, v) => total + v, 0);
  const residual = roundTo(1 - sum, ROUNDING_RULE.pmf);

  let largestIndex = 0;
  let largestValue = rounded[0] as number;
  for (let i = 1; i < rounded.length; i++) {
    const candidate = rounded[i] as number;
    if (candidate > largestValue) {
      largestIndex = i;
      largestValue = candidate;
    }
  }

  rounded[largestIndex] = roundTo(largestValue + residual, ROUNDING_RULE.pmf);
  return rounded;
}
