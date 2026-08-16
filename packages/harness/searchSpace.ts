/**
 * D-03(a)'s search metadata: per-parameter bounds and the one-at-a-time
 * sensitivity screen's sweep grid, for `packages/harness/tune.ts`'s
 * `--stage screen` and `--stage joint`. Deliberately lives in
 * `packages/harness`, not `packages/core` — search bounds are a TUNING
 * concern, not prediction data, and `packages/core` must stay free of
 * anything that is not Worker-importable prediction logic (`types.ts`'s own
 * file-header constraint, `sigma1/params.ts`'s header).
 *
 * Every bound below is deliberately WIDE ENOUGH to let the search actually
 * move (a bound so tight it just reproduces the default would make the
 * search meaningless) and NARROW ENOUGH to exclude values that are
 * physically implausible for an FRC alliance's score/count scale — each
 * bound's own comment states which, matching `identifiability.ts`'s
 * convention of justifying every numeric threshold in prose rather than
 * leaving a bare literal.
 */
import { DEFAULT_SIGMA1_PARAMS, SIGMA1_PARAM_KEYS, type Sigma1Params } from "../core/algorithms/sigma1/params.js";

/**
 * `min`/`max` are inclusive. `scale` controls both `screenGridFor`'s
 * spacing and (plan 03-05 Task 2) the joint search's uniform-sampling
 * distribution — uniform in LOG space for `"log"`-scaled parameters, so a
 * wide multiplicative range (e.g. `processNoiseEventBoundary`'s [1, 64])
 * does not spend most of the search's budget in its top decade.
 */
export interface SearchBound {
  readonly min: number;
  readonly max: number;
  readonly scale: "linear" | "log";
}

/**
 * `Sigma1Params` numeric fields deliberately EXCLUDED from the search, each
 * with its own reason:
 *   - `rpMonteCarloSeed`/`rpMonteCarloDraws`: plan 03-03's own
 *     `distribution.test.ts` proves by test that the RP joint model's draw
 *     count/seed never move `pRedWin`/predicted scores — the ONLY inputs
 *     D-01's objective (tune-season Brier) reads — so searching them would
 *     spend budget moving a dimension the objective is structurally blind
 *     to. Every search candidate in this module instead fixes
 *     `rpMonteCarloDraws: 0`, which (`rp/distribution.ts`'s own zero-draws
 *     short-circuit) skips the RP joint model's Cholesky decomposition
 *     entirely — the fast path this plan's own runtime guidance assumes.
 *   - `adaptationEnabled`: a MODE, not a numeric knob (D-06) — searched as
 *     two independent optimizer runs (`--adaptation on|off`), never as a
 *     dimension inside one run; `params.ts`'s own doc comment on this field
 *     states the same exclusion for the screen to find.
 */
export type SearchableParamKey = Exclude<
  keyof Sigma1Params,
  "rpMonteCarloSeed" | "rpMonteCarloDraws" | "adaptationEnabled"
>;

export const SIGMA1_SEARCH_SPACE: Readonly<Record<SearchableParamKey, SearchBound>> = {
  // D-07 process noise (points^2/match). Lower bound: a filter with less
  // than 0.05 pts^2 of injected noise per match would take dozens of
  // matches to react to any real shift — implausibly stiff for a team whose
  // robot changes across a build season. Upper bound: 5 pts^2 already
  // exceeds a single component's typical cold-start consistency prior
  // (`SIGMA1_COLD_START_CONSISTENCY_VARIANCE` = 25 pts^2 is the FULL
  // cold-start belief for a whole team) — beyond 5 the filter would barely
  // trust its own accumulated history at all.
  processNoiseWithinEvent: { min: 0.05, max: 5, scale: "log" },
  // D-07's event-boundary bump must exceed the within-event bump for the
  // distinction to mean anything at all — `isValidParamSet` enforces this
  // as a hard cross-parameter constraint, not just a comment (see below).
  // Upper bound 64 pts^2: a boundary bump that large would make a team's
  // rating essentially reset every event, indistinguishable from never
  // carrying belief across events within a season at all.
  processNoiseEventBoundary: { min: 1, max: 64, scale: "log" },
  // EWMA rates: an alpha outside (0, 1) is not a valid exponential average.
  // 0.02 (a ~50-match half-life, longer than a full season for most teams)
  // to 0.6 (a <2-match half-life) spans from "barely reactive" to "reacts
  // almost entirely to the last observation" — the full plausible range for
  // a within-season residual/innovation fold.
  consistencyEwmaAlpha: { min: 0.02, max: 0.6, scale: "linear" },
  covEwmaAlpha: { min: 0.02, max: 0.6, scale: "linear" },
  adaptationEwmaAlpha: { min: 0.02, max: 0.6, scale: "linear" },
  // D-11's empirical-Bayes prior weight, in MATCHES. 1 match of prior
  // weight is barely a shrinkage prior at all; 32 matches exceeds a full
  // regional event's qualification round (typically ~10-12 matches per
  // team) — beyond that the league prior would dominate a team's entire
  // season regardless of how it actually played.
  shrinkagePriorMatches: { min: 1, max: 32, scale: "log" },
  // A shrinkage FRACTION toward the diagonal must be a probability; 0.9
  // still leaves 10% weight on the empirical off-diagonal estimate rather
  // than collapsing to a purely diagonal covariance (which 1.0 would).
  covShrinkage: { min: 0, max: 0.9, scale: "linear" },
  // A consistency VARIANCE floor of 0.1 pts^2 (SD ~0.3 pts) claims
  // near-zero residual uncertainty, implausible for any FRC scoring
  // component; 16 pts^2 (SD 4 pts) already exceeds most single components'
  // typical spread.
  minConsistencyVariance: { min: 0.1, max: 16, scale: "log" },
  // D-12 mode 2's win-probability denominator scale `c`. Below 0.25 the
  // logistic saturates to near-certain outcomes on almost every margin
  // (overconfident by construction); above 4 it barely distinguishes a
  // blowout from a coin flip (underconfident by construction).
  linkC: { min: 0.25, max: 4, scale: "log" },
  // A cold-start team's assumed total alliance contribution, in points. 5
  // pts is barely above zero contribution; 60 pts approaches a strong
  // veteran team's typical full-alliance-share output — the plausible range
  // for "what should we assume about a team we have never seen play."
  coldStartTeamTotal: { min: 5, max: 60, scale: "linear" },
  coldStartConsistencyVariance: { min: 4, max: 100, scale: "log" },
  fallbackScoreSd: { min: 8, max: 80, scale: "log" },
  // D-17: a decay of 0 discards the carried consistency signal entirely at
  // a season boundary (explicitly permitted, D-17's own wording); 1 carries
  // it forward completely undecayed. Both ends are meaningful, not just
  // arbitrary bounds.
  consistencyCarryDecay: { min: 0, max: 1, scale: "linear" },
  // D-04's carry blend/reversion weights — all three are fractions and are
  // only meaningful in [0, 1] (`isValidParamSet` also re-asserts this as a
  // cross-parameter/range constraint, defense in depth for candidates
  // constructed outside `screenGridFor`'s own bound-respecting grid, e.g.
  // the joint search's random sampling).
  carryMeanReversion: { min: 0, max: 1, scale: "linear" },
  carryLastYearWeight: { min: 0, max: 1, scale: "linear" },
  carryPriorYearWeight: { min: 0, max: 1, scale: "linear" },
  // T-03-06's adaptive-Kalman stability bounds (D-05, plan 03-04). Exponent
  // 0 makes the factor constant regardless of innovation (adaptation
  // effectively inert even when enabled); 1.5 already reacts
  // super-linearly to the innovation ratio, which is already a fairly
  // aggressive response curve for a per-match scalar.
  adaptationExponent: { min: 0, max: 1.5, scale: "linear" },
  // The clamp bounds themselves. `isValidParamSet` enforces
  // `adaptationMinFactor < adaptationMaxFactor` as a hard constraint — a
  // degenerate or inverted clamp is never a valid candidate.
  adaptationMinFactor: { min: 0.05, max: 1, scale: "linear" },
  adaptationMaxFactor: { min: 1, max: 16, scale: "log" },
  // Below 1 observation a team's adaptation history is vacuous by
  // definition (there is nothing folded yet); above 12 (roughly a full
  // qualification round) the floor would keep every team at the
  // disabled-equivalent factor of exactly 1 for essentially its whole
  // event.
  adaptationMinObservations: { min: 1, max: 12, scale: "linear" },
};

/**
 * `SIGMA1_PARAM_KEYS` (the canonical sorted iteration order,
 * `sigma1/params.ts`) filtered down to the keys present in
 * `SIGMA1_SEARCH_SPACE` — never hand-typed, so this list cannot drift from
 * either the interface or the search space above, and it preserves
 * `SIGMA1_PARAM_KEYS`'s own sorted order (`Array.prototype.filter` is
 * order-preserving).
 */
export const SEARCHABLE_PARAM_KEYS: readonly SearchableParamKey[] = SIGMA1_PARAM_KEYS.filter(
  (key): key is SearchableParamKey => Object.prototype.hasOwnProperty.call(SIGMA1_SEARCH_SPACE, key)
);

/**
 * The one-at-a-time screen's sweep grid for one parameter: `valueCount`
 * points spanning `[min, max]` on the parameter's declared scale (geometric
 * spacing for `"log"`, arithmetic for `"linear"`), with the two ENDPOINTS
 * held exactly at `min`/`max` (never perturbed) and the interior grid point
 * closest to the parameter's own `DEFAULT_SIGMA1_PARAMS` value replaced
 * with that EXACT default — so a parameter that cannot beat its own
 * default says so honestly, rather than the screen never actually
 * evaluating the default in the first place.
 *
 * Requires `valueCount >= 3`: an endpoint-only grid of 2 cannot also
 * contain a distinct interior default for any parameter in
 * `SIGMA1_SEARCH_SPACE` (every one of them has an interior default —
 * verified by `searchSpace.test.ts`).
 */
export function screenGridFor(key: SearchableParamKey, valueCount: number): number[] {
  const bound = SIGMA1_SEARCH_SPACE[key];
  if (!Number.isInteger(valueCount) || valueCount < 3) {
    throw new Error(
      `screenGridFor: valueCount must be an integer >= 3 (to hold both bounds and a distinct default), got ${valueCount}`
    );
  }
  const { min, max, scale } = bound;
  const defaultValue = DEFAULT_SIGMA1_PARAMS[key] as number;
  if (defaultValue < min || defaultValue > max) {
    throw new Error(
      `screenGridFor: "${key}"'s default ${defaultValue} lies outside its own search bound [${min}, ${max}]`
    );
  }

  const grid: number[] = [];
  for (let i = 0; i < valueCount; i++) {
    const t = i / (valueCount - 1);
    grid.push(scale === "log" ? min * Math.pow(max / min, t) : min + t * (max - min));
  }
  // Endpoints stay exactly the declared bounds, never a floating-point
  // approximation of them (t=0/t=1 above already round-trip exactly for
  // both formulas, but this is the explicit, load-bearing guarantee rather
  // than an assumption about floating-point behavior).
  grid[0] = min;
  grid[valueCount - 1] = max;

  // Replace whichever INTERIOR slot (never index 0 or valueCount-1) sits
  // closest to the default with the default's own exact value. Because the
  // grid is monotonic and evenly spaced, the closest slot is always within
  // half a slot-spacing of the default, so overwriting it can never cross
  // (and thereby de-order) its immediate neighbors.
  let closestIndex = 1;
  let closestDistance = Math.abs(grid[1]! - defaultValue);
  for (let i = 2; i < valueCount - 1; i++) {
    const distance = Math.abs(grid[i]! - defaultValue);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = i;
    }
  }
  grid[closestIndex] = defaultValue;

  return grid;
}

/**
 * The cross-parameter validity constraints BOTH search stages (screen,
 * joint) must reject a candidate against before ever evaluating it — a
 * rejected candidate is counted in the search log, never silently dropped:
 *
 *   - D-07: `processNoiseEventBoundary` must exceed `processNoiseWithinEvent`
 *     strictly, or the boundary/within-event distinction is meaningless.
 *   - T-03-06: `adaptationMinFactor` must be strictly less than
 *     `adaptationMaxFactor`, or the stability clamp is degenerate/inverted.
 *   - D-04's three carry weights/fractions are only meaningful in [0, 1] —
 *     already each field's own search bound, re-asserted here as defense in
 *     depth for any candidate constructed outside `screenGridFor`'s own
 *     bound-respecting grid (the joint search's random sampling, in
 *     particular).
 */
export function isValidParamSet(params: Sigma1Params): boolean {
  if (!(params.processNoiseEventBoundary > params.processNoiseWithinEvent)) return false;
  if (!(params.adaptationMinFactor < params.adaptationMaxFactor)) return false;
  if (!(params.carryMeanReversion >= 0 && params.carryMeanReversion <= 1)) return false;
  if (!(params.carryLastYearWeight >= 0 && params.carryLastYearWeight <= 1)) return false;
  if (!(params.carryPriorYearWeight >= 0 && params.carryPriorYearWeight <= 1)) return false;
  return true;
}
