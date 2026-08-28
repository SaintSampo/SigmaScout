/**
 * D-06's publish-time rounding rule, as executable code with a stated
 * tie-breaking contract (plan 04-02 Task 1).
 *
 * BOUNDARY: this module is for building PUBLISHED page artifacts only
 * (`packages/harness/pageArtifacts.ts`). It is never called from the
 * scoring path (`packages/harness/score.ts`), the prediction sidecars
 * (`packages/harness/predictions.ts`), or anything a committed digest
 * hashes. In particular, `packages/harness/promote.ts`'s
 * `computePredictionStreamDigest` states outright that its input must stay
 * "never rounded, `toFixed`'d, or truncated" — a promoted version's digest
 * is the record that a run reproduces bitwise, and applying display
 * precision to that stream would silently invalidate Phase 3's promotion
 * record. Rounding is a presentation concern that exists only on the
 * publish path, downstream of everything the harness computes or records.
 *
 * THE RULE (field class -> decimal count -> why):
 *
 * | Field class                                             | Decimals | Why |
 * |----------------------------------------------------------|----------|-----|
 * | Display metrics (TeamMetric.value/spread, component      | 2        | Shown as `X ± Y`; a third decimal is |
 * |   means/variances)                                       |          | never rendered or read. |
 * | Predicted/actual alliance scores                         | 2        | FRC scores are integers; a predicted |
 * |                                                           |          | score's second decimal is already |
 * |                                                           |          | below what any reader acts on. |
 * | Probabilities (pRedWin, per-match win probability)        | 4        | Phase 8's simulation draws from these; |
 * |                                                           |          | a Brier score is quadratic in this |
 * |                                                           |          | value, so 4 decimals keeps the |
 * |                                                           |          | published number agreeing with the |
 * |                                                           |          | harness number to well inside any |
 * |                                                           |          | figure the site quotes. |
 * | RP pmf entries                                            | 5        | Phase 8 draws ranking points from |
 * |                                                           |          | these repeatedly across a 1000-run |
 * |                                                           |          | simulation, where a truncation bias |
 * |                                                           |          | would compound rather than cancel. |
 * | Alliance-total predictive variance                        | 4        | It is the square of a spread the page |
 * |                                                           |          | shows to 2 decimals; rounding it as |
 * |                                                           |          | coarsely as the spread would visibly |
 * |                                                           |          | distort the derived `±`. |
 * | Percentile (Phase 6, D-04)                                 | 1        | Matches `colour-and-tiers.md`'s own |
 * |                                                           |          | worked precision (p50=39.2, not |
 * |                                                           |          | p50=39.20000001). |
 *
 * Phase 6's D-01 own-variance fields (`redScoreVarianceOwn`/
 * `blueScoreVarianceOwn`) reuse `ROUNDING_RULE.variance` unchanged above —
 * same physical quantity (an alliance-total predictive variance) as the
 * existing combined `variance` field, so no new rounding rule is added for
 * them. Phase 7 (D-18 item 3, plan 07-07 Task 1) extends this same reuse to
 * `EventMatchSchema`/`EventUpcomingMatchSchema`'s own `redScoreVarianceOwn`/
 * `blueScoreVarianceOwn` pair — it is the identical physical quantity at the
 * event-page aggregation level, so a second key here would be drift wearing
 * documentation's clothes, not a genuinely new field class. D-02's actual RP
 * fields are integral by construction
 * (`packages/harness/pageArtifacts.ts`'s `TeamSeasonMatchSchema.actualRedRp`/
 * `actualBlueRp` are `z.number().int()`) and are published unrounded — no
 * `ROUNDING_RULE` entry for RP either. `sortTime` (Phase 6's
 * `TeamSeasonMatchSchema.sortTime`, and Phase 7's `EventMatchSchema.sortTime`/
 * `EventUpcomingMatchSchema.sortTime`, plan 07-07 Task 1) gets no entry for a
 * stronger reason than an integer count: it is a timestamp in epoch seconds,
 * not a measured quantity, so rounding it at any display precision would be
 * meaningless at best and would silently reorder a match list at worst.
 *
 * TIE-BREAKING (roundTo): half-away-from-zero, implemented explicitly —
 * take the sign, scale, `Math.round` the magnitude, unscale, restore the
 * sign — rather than relying on `Math.round`'s own half-up-toward-
 * positive-infinity behaviour, which is asymmetric for negatives (e.g.
 * native `Math.round(-1.5)` is `-1`, not `-2`). Symmetric rounding means a
 * metric and its negation round to the same magnitude, which is the
 * behaviour a reader comparing two teams' deltas would expect.
 *
 * TIE-BREAKING (roundPmf): every entry is rounded independently to 5
 * decimals, then the residual `1 - sum(rounded)` is added to the entry
 * with the LARGEST rounded value (lowest index on a tie). Adding the
 * residual to the largest entry — rather than distributing it across all
 * entries, or always adding it to index 0 — keeps the correction relatively
 * smallest (a fixed absolute nudge is a smaller relative change on a large
 * entry than a small one) and is a pure, deterministic function of the
 * input. An undocumented tie-break here is exactly the kind of thing that
 * could quietly differ between an offline publish run and a future online
 * one, breaking D-14's equivalence assertion — so it is written down.
 */

/** The field classes this module rounds, and their decimal counts (D-06). Exported as plain data so the rule can be quoted by name rather than paraphrased. */
export const ROUNDING_RULE = {
  metric: 2,
  score: 2,
  probability: 4,
  pmf: 5,
  variance: 4,
  /** Phase 6, D-04: percentile, matching `colour-and-tiers.md`'s worked precision. */
  percentile: 1,
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
 * `Number(...)` parses to `NaN` — silently, with no thrown error, discovered
 * only when a real near-zero probability (an OPR blowout prediction) hit
 * this path during plan 04-04's real corpus run. Combining `magnitude`'s OWN
 * exponent (if its string form has one) with `exponentDelta` numerically,
 * rather than string-concatenating a second `"e"`, fixes this for every
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
 * Scaling via plain multiplication (`magnitude * 10 ** decimals`) is
 * NOT used here: IEEE 754 doubles cannot represent 1.005 exactly (its
 * nearest double is ~1.00499999999999989), so `1.005 * 100` evaluates to
 * ~100.49999999999999 and `Math.round` would silently round DOWN — the
 * exact wrong-tie-break bug a "we rounded" claim without a stated
 * mechanism could hide. Instead this shifts the decimal point via
 * `shiftDecimalPoint` (exponential-notation string reparsing), which
 * reparses the value's shortest round-trippable decimal string as one
 * literal — `"1.005e2"` parses directly to the exact double `100.5` — so no
 * intermediate multiplication error is introduced before `Math.round` sees
 * it, and no malformed double-exponent string is built for a magnitude JS
 * already renders in exponential form (see `shiftDecimalPoint`'s own doc
 * comment).
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
 * so the rounded array still sums to 1 within
 * `packages/harness/predictions.ts`'s 1e-9 tolerance — see this module's
 * file header for the full tie-breaking contract.
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
