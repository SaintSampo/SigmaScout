/**
 * D-T1's one resolve point (quick task 260901-trz): turns the five
 * DIMENSIONLESS `Sigma1Params` fields into the absolute quantities the filter
 * actually applies, using the season's own realized alliance-score scale.
 *
 * ## Why the `Omit` is load-bearing, not cosmetic
 *
 * `Sigma1ResolvedParams` OMITS all five relative fields. An internal helper
 * that receives a `Sigma1ResolvedParams` therefore CANNOT read a relative
 * field — the type does not have one. That makes "resolve once, at a
 * leak-free point" a fact about the type system rather than a convention a
 * future edit can quietly break, the same "unconstructible, not merely
 * unbuilt-by-convention" reasoning `Sigma1ParamsSchema`'s object-level check
 * already uses. `scale.test.ts` pins it with a `@ts-expect-error` line, so
 * the guarantee is checked by the compiler in CI rather than believed.
 *
 * The absolute field NAMES on the resolved type are deliberately the RETIRED
 * names (`processNoiseWithinEvent`, `minConsistencyVariance`, ...). That is
 * what keeps `index.ts`'s diff to annotations plus four resolve calls instead
 * of a rewrite of every helper body: those bodies already read exactly these
 * names, and the quantity they name is unchanged in meaning — an absolute
 * process noise in points^2, an absolute variance floor in points^2.
 *
 * ## Pitfall EPA-1, and where the resolve call must sit
 *
 * `standardDeviation(state.allianceScoreStats, ...)` is leak-free ONLY
 * because `allianceScoreStats` is an expanding statistic folded strictly
 * behind the replay cursor. Every public entry point resolves from the
 * PRE-fold `state`, at the top of the function, never from the post-fold
 * local `update()` computes near its end. That single line's placement is the
 * entire guarantee; `index.ts` carries a comment saying so at the site.
 *
 * ## The season boundary, which is ACCEPTED rather than fixed
 *
 * `allianceScoreStats` deliberately carries ACROSS seasons — `carrySeason`
 * threads it forward unchanged. So a new season starts scaled by the PREVIOUS
 * season's sigma and converges to its own within a few hundred matches. That
 * lag is real, it is leak-free, and it is accepted. Resetting the statistic at
 * a boundary would leave the first matches of EVERY season with no scale at
 * all (falling back to `fallbackScoreSd`), which is strictly worse than a
 * converging one. A future reader must not mistake this for an oversight.
 *
 * The one place a scale genuinely does not exist yet is the very first
 * matches of 2022, where `standardDeviation` returns `fallbackScoreSd` by its
 * own documented `count < 2` contract — a resolved scale of 625, roughly
 * 0.61x `SIGMA1_REFERENCE_SCORE_VARIANCE`. See `fallbackScoreSd`'s own doc
 * comment (`params.ts`) for why that transient is documented rather than
 * tuned away.
 *
 * ## A realized SD of exactly ZERO is also "no scale yet", and must fall back
 *
 * `standardDeviation` returns `fallback` for `count < 2` but returns a real
 * `0` when it has folded two or more IDENTICAL observations — mathematically
 * correct, and catastrophic as a scale. At `scoreVariance === 0` all four
 * variance-scaled fields resolve to exactly 0, which means: no process noise
 * at all, a cold-start consistency of 0, and a `minConsistencyVariance` FLOOR
 * of 0. That last one is the failure `index.ts`'s `seedConsistencyFor` doc
 * comment describes at length — a team seeded with `P = 0` AND `R = 0` has a
 * pooled variance of 0, hits `kalman.ts`'s zero-gain branch, and can never
 * learn from its own observations again while publishing a `0 ±` claim of
 * perfect certainty.
 *
 * A zero realized SD says every alliance score folded so far has been
 * identical, i.e. there is no spread INFORMATION yet — epistemically the same
 * state as `count < 2`, and it takes the same answer: fall back to
 * `fallbackScoreSd`. This extends `standardDeviation`'s own documented
 * fallback contract to the one degenerate case that function cannot see from
 * the inside (it has no notion of what its output will be used FOR).
 *
 * On real data this never binds after the first couple of matches — two
 * distinct alliance scores are enough — so the shipped model is untouched; it
 * exists for exactly the early-season and synthetic-fixture cases, the same
 * scope `seedConsistencyFor`'s own floor covers.
 */
import { standardDeviation, type ExpandingStats } from "../../scoring/expandingStats.js";
// TYPE-ONLY, deliberately: this module has no RUNTIME import edge back to
// `params.ts` at all, so it cannot participate in the module-evaluation-time
// cycle `params.ts`'s own header records fixing once already. The same
// acyclicity discipline, applied one module further out.
import type { Sigma1Params } from "./params.js";

/**
 * `Sigma1Params` with the five relative fields REMOVED and their resolved
 * absolute counterparts added, plus the sigma the resolution was performed
 * at. Every internal Sigma1 helper takes this type, never `Sigma1Params`.
 */
export interface Sigma1ResolvedParams
  extends Omit<
    Sigma1Params,
    | "processNoiseWithinEventRel"
    | "processNoiseEventBoundaryRel"
    | "coldStartConsistencyVarianceRel"
    | "minConsistencyVarianceRel"
    | "coldStartTeamTotalRel"
  > {
  /** The season's realized alliance-score SD at resolve time — `standardDeviation(stats, params.fallbackScoreSd)`. ONE definition of sigma per call, shared by the win-probability link and every scaled parameter below. */
  readonly scoreSd: number;
  /** `scoreSd ** 2`. The multiplier for every VARIANCE-scaled field. */
  readonly scoreVariance: number;
  /** D-07 within-event process noise, in points^2 per match. */
  readonly processNoiseWithinEvent: number;
  /** D-07 event-boundary process noise, in points^2. */
  readonly processNoiseEventBoundary: number;
  /** Cold-start consistency VARIANCE, in points^2. */
  readonly coldStartConsistencyVariance: number;
  /** Shrunk-consistency VARIANCE floor, in points^2. */
  readonly minConsistencyVariance: number;
  /** A cold-start team's assumed total alliance contribution, in POINTS — scaled LINEARLY by `scoreSd`, not by `scoreVariance`. */
  readonly coldStartTeamTotal: number;
}

/**
 * Resolves `params` against `stats`, the caller's PRE-fold
 * `state.allianceScoreStats`.
 *
 * Four fields scale by `scoreVariance` and ONE — `coldStartTeamTotal` —
 * scales linearly by `scoreSd`, because it is a point total rather than a
 * variance. The two scalings are one character apart in this function and
 * `scale.test.ts` has a dedicated test that tells them apart.
 */
export function resolveSigma1Params(params: Sigma1Params, stats: ExpandingStats): Sigma1ResolvedParams {
  // `standardDeviation` already falls back for `count < 2`; the `|| fallback`
  // covers the OTHER no-information case it cannot see — two or more
  // identical observations, whose realized SD is a genuine 0. See this
  // module's header for why a zero scale is not merely small but degenerate.
  const realizedSd = standardDeviation(stats, params.fallbackScoreSd);
  const scoreSd = realizedSd > 0 ? realizedSd : params.fallbackScoreSd;
  const scoreVariance = scoreSd * scoreSd;
  const {
    processNoiseWithinEventRel,
    processNoiseEventBoundaryRel,
    coldStartConsistencyVarianceRel,
    minConsistencyVarianceRel,
    coldStartTeamTotalRel,
    ...absolute
  } = params;
  return {
    ...absolute,
    scoreSd,
    scoreVariance,
    processNoiseWithinEvent: processNoiseWithinEventRel * scoreVariance,
    processNoiseEventBoundary: processNoiseEventBoundaryRel * scoreVariance,
    coldStartConsistencyVariance: coldStartConsistencyVarianceRel * scoreVariance,
    minConsistencyVariance: minConsistencyVarianceRel * scoreVariance,
    coldStartTeamTotal: coldStartTeamTotalRel * scoreSd,
  };
}
