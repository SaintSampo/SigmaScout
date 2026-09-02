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
 * wide multiplicative range (e.g. `processNoiseEventBoundaryRel`'s
 * [4e-4, 6e-2]) does not spend most of the search's budget in its top decade.
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
 *   - `rpProcessNoiseWithinEvent`/`rpProcessNoiseEventBoundary`/
 *     `rpColdStartVariance` (F3, `SIGMA1_CODE_VERSION` 4.0.0): the RP
 *     threshold variables' OWN absolute noise and cold-start variance, split
 *     off the score side when D-T1 made the score side scale-relative. They
 *     carry exactly the argument the two Monte Carlo fields above already do
 *     — D-01's objective is structurally blind to the RP pmf, so searching
 *     them spends budget on a dimension the objective cannot see. Note the
 *     side effect this removes: before 4.0.0 the tuner moved RP's `q` as a
 *     consequence of moving the score side's, because they were the same
 *     parameter. It no longer does. That is a real, intended change in what a
 *     search explores.
 *
 * D-T3 replaces this `Exclude` union with a named `SEARCH_EXCLUSIONS` record
 * carrying each reason as data rather than as prose in this comment, and adds
 * three more exclusions. That is the NEXT task's job, deliberately: doing it
 * here would tangle a deletion from the search space into the same commit as
 * the rename, and the `covShrinkage` fix's own ~0.0005 Brier cost could then
 * not be attributed to it alone.
 */
export type SearchableParamKey = Exclude<
  keyof Sigma1Params,
  | "rpMonteCarloSeed"
  | "rpMonteCarloDraws"
  | "adaptationEnabled"
  | "rpProcessNoiseWithinEvent"
  | "rpProcessNoiseEventBoundary"
  | "rpColdStartVariance"
>;

export const SIGMA1_SEARCH_SPACE: Readonly<Record<SearchableParamKey, SearchBound>> = {
  // D-07/D-T1 process noise, as a FRACTION of the season's own alliance-score
  // variance (the filter injects `rel * sigma^2` per match). The bound is
  // written in dimensionless units from scratch rather than divided down from
  // the retired points^2 bound, because a mechanically divided bound would
  // carry a justification written about a quantity that no longer exists.
  //
  // The result that motivates the whole reparameterization sets the width:
  // expressed as a fraction of variance, the per-season optimum SPREAD
  // COLLAPSES from ~16x to ~2x. Using CONTEXT's own per-season table against
  // the measured `SIGMA1_REFERENCE_SCORE_VARIANCE` (1028.2), the best relative
  // value per season is roughly 1.6e-4 (2022), 1.0e-4 (2023), 2.0e-4 (2024),
  // 2.2e-4 (2025), 1.2e-4 (2026). [2e-5, 2e-3] brackets all five with about a
  // decade of headroom on each side — wide enough that the search is not
  // fenced into the region the retired absolute parameterization happened to
  // land in, narrow enough to exclude a filter that either ignores its own
  // history entirely or cannot react to a real shift within a season.
  processNoiseWithinEventRel: { min: 2e-5, max: 2e-3, scale: "log" },
  // D-07's event-boundary bump must exceed the within-event bump for the
  // distinction to mean anything at all — `isValidParamSet` enforces this
  // as a hard cross-parameter constraint, not just a comment (see below).
  //
  // The lower bound is set deliberately BELOW the promoted set's own relative
  // image, and that is the point. The promoted absolute value (1 pt^2) sat
  // EXACTLY at the retired bound's `min` — an at-bound winner the retired
  // space could not escape downward, i.e. a search result that was quite
  // possibly the bound talking rather than the data. 1 / 1028.2 = 9.7e-4, and
  // 4e-4 leaves the re-tune room to go lower if the data actually wants it.
  // Upper bound 6e-2: at a 2024-scale variance that is roughly 43 pts^2 of
  // boundary noise, enough to make a team's rating essentially reset every
  // event — indistinguishable from never carrying belief across events at all.
  processNoiseEventBoundaryRel: { min: 4e-4, max: 6e-2, scale: "log" },
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
  // D-T1: the shrunk-consistency VARIANCE floor, as a fraction of the season's
  // alliance-score variance. At the lower end (1e-4, roughly 0.1 pts^2 on the
  // tune seasons' scale) the floor claims near-zero residual uncertainty,
  // implausible for any FRC scoring component; at the upper end (3e-2, roughly
  // 31 pts^2 there) the floor alone would exceed most single components'
  // typical spread and would bind on nearly every team, publishing a constant
  // rather than an estimate. The promoted set's relative image is 9.7e-4,
  // comfortably interior.
  minConsistencyVarianceRel: { min: 1e-4, max: 3e-2, scale: "log" },
  // D-12 mode 2's win-probability denominator scale `c`. Below 0.25 the
  // logistic saturates to near-certain outcomes on almost every margin
  // (overconfident by construction); above 4 it barely distinguishes a
  // blowout from a coin flip (underconfident by construction).
  linkC: { min: 0.25, max: 4, scale: "log" },
  // D-T1: a cold-start team's assumed total alliance contribution, as a
  // fraction of the season's alliance-score STANDARD DEVIATION (linear, not
  // squared — this is a point total). 0.15 is barely above zero contribution;
  // 1.9 approaches a strong veteran team's typical full-alliance-share output
  // — the plausible range for "what should we assume about a team we have
  // never seen play." The default's relative image is 0.624.
  coldStartTeamTotalRel: { min: 0.15, max: 1.9, scale: "linear" },
  // D-T1: the cold-start consistency VARIANCE, as a fraction of the season's
  // alliance-score variance. The UPPER bound is deliberately generous, and
  // for a specific documented reason: `params.ts` records
  // `SIGMA1_COLD_START_CONSISTENCY_VARIANCE` as KNOWN STALE under the D-Q2
  // innovation-based R estimator — plausibly about an order of magnitude too
  // small — so the space must be able to reach the region the re-tune needs.
  // 0.5 is roughly 514 pts^2 on the tune seasons' scale, an order of magnitude
  // above the default's 25; 4e-3 (about 4 pts^2 there) is the low end of a
  // defensible seed. The default's relative image is 2.43e-2.
  coldStartConsistencyVarianceRel: { min: 4e-3, max: 0.5, scale: "log" },
  fallbackScoreSd: { min: 8, max: 80, scale: "log" },
  // D-17: a decay of 0 discards the carried consistency signal entirely at
  // a season boundary (explicitly permitted, D-17's own wording); 1 carries
  // it forward completely undecayed. Both ends are meaningful, not just
  // arbitrary bounds.
  consistencyCarryDecay: { min: 0, max: 1, scale: "linear" },
  // D-04/D-T2's carry reversion and blend share — both are fractions and are
  // only meaningful in [0, 1] (`isValidParamSet` also re-asserts this as a
  // cross-parameter/range constraint, defense in depth for candidates
  // constructed outside `screenGridFor`'s own bound-respecting grid, e.g.
  // the joint search's random sampling). The retired unnormalized
  // `carryLastYearWeight`/`carryPriorYearWeight` pair is gone: their SUM
  // duplicated `carryMeanReversion`, so the search now spends one dimension
  // here instead of two. 0 puts all blend weight on last season, 1 all of it
  // on the season before — both ends are meaningful, not arbitrary bounds.
  carryMeanReversion: { min: 0, max: 1, scale: "linear" },
  carryPriorYearShare: { min: 0, max: 1, scale: "linear" },
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
 *   - D-07: `processNoiseEventBoundaryRel` must exceed
 *     `processNoiseWithinEventRel` strictly, or the boundary/within-event
 *     distinction is meaningless. Both sides scale by the same `sigma^2` at
 *     resolve time, so the dimensionless ordering is the identical statement.
 *   - F3: the same D-07 ordering on the RP threshold variables' own absolute
 *     pair. Not searchable, but still validated — `--set-param` and a
 *     hand-edited committed version file both reach this predicate.
 *   - T-03-06: `adaptationMinFactor` must be strictly less than
 *     `adaptationMaxFactor`, or the stability clamp is degenerate/inverted.
 *   - D-04/D-T2's carry reversion and blend share are only meaningful in
 *     [0, 1] — already each field's own search bound, re-asserted here as
 *     defense in depth for any candidate constructed outside `screenGridFor`'s
 *     own bound-respecting grid (the joint search's random sampling, in
 *     particular).
 *
 * D-11 / 03-REVIEW WR-01: these same predicates are now ADDITIONALLY
 * enforced inside `sigma1/params.ts`'s `Sigma1ParamsSchema` (its own
 * object-level `.check(...)`), which every `Sigma1Params` construction path
 * already parses through — that is what makes an invalid parameter set
 * unconstructible rather than merely unbuilt-by-convention. This function
 * remains the cheap boolean pre-filter for grid sweeps that must not throw
 * mid-sweep (`runScreenStage`'s and `buildRandomCandidate`'s
 * reject-and-count loops read a boolean here, not a caught exception); the
 * two must be kept in agreement — `searchSpace.test.ts` and
 * `params.test.ts` both assert this.
 */
export function isValidParamSet(params: Sigma1Params): boolean {
  if (!(params.processNoiseEventBoundaryRel > params.processNoiseWithinEventRel)) return false;
  if (!(params.rpProcessNoiseEventBoundary > params.rpProcessNoiseWithinEvent)) return false;
  if (!(params.adaptationMinFactor < params.adaptationMaxFactor)) return false;
  if (!(params.carryMeanReversion >= 0 && params.carryMeanReversion <= 1)) return false;
  if (!(params.carryPriorYearShare >= 0 && params.carryPriorYearShare <= 1)) return false;
  return true;
}
