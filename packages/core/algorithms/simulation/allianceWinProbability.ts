/**
 * THE BROWSER'S ALLIANCE WIN PROBABILITY — one alliance against another, priced
 * from the two numbers a published event artifact already carries per team.
 *
 * A NEW QUANTITY, NOT A PORT. Nothing in this repo previously took two
 * arbitrary rosters and returned a win probability. The embedded per-event
 * state block that priced upcoming matches client-side was built by quick task
 * 260915-isq and DELETED by 260923-3w6 on 2026-09-23, once Workers Paid made
 * Worker-side pricing affordable again. Sketch 021's README claims the browser
 * already prices any three-robot alliance against any other; it does not, and
 * 10-CONTEXT.md's "Corrections from research (2026-09-25)" supersedes the
 * README on exactly that point. This module is that path, built from scratch.
 *
 * ITS ONLY INPUTS are the two published per-team metrics:
 *   - `metrics["total"].value` — the team's rating in POINTS.
 *   - `metrics["sigma"].value` — its Sigma Score, the 1 standard deviation of
 *     its even-split share of its alliance's miss.
 *
 * THE VARIANCE IS THE UNCORRECTED SUM of squared Sigma Scores — the same
 * quantity `allianceSigmaBandVariance` (packages/harness/sigmaScore.ts) builds
 * and the same quantity the rank simulation's win/tie/loss spread uses. It is
 * explicitly NOT `sigmaMatchBandVariance`'s DISPLAY band, which multiplies by
 * roster size; that function's own doc comment records the measurement:
 *
 *     "DISPLAY ONLY. Win and tie odds keep the uncorrected variance: red's and
 *      blue's misses are correlated, so widening it worsens Brier."
 *
 * The which-variance-is-it question is answered here, in the header, rather
 * than left to a reader, because
 * `.claude/skills/sketch-findings-sigmascout/references/uncertainty-display.md`
 * records this exact class of mistake landing on this project TWICE already
 * (sketch 003's original bug, and the 2026-09-13 Match Band sqrt(3)
 * correction). This is the third site, and `allianceWinProbability.test.ts`
 * pins it with a hand-computed value that is different under the display band.
 *
 * IT IS NOT SPR'S OWN `predict()`. SPR works in RATING space and divides by a
 * learned scale `tau` over `red.pv + blue.pv + 2 * obsSd^2` — internal state a
 * visitor's browser does not have and a published artifact does not carry.
 * `Prediction.variance`'s own doc comment states outright that reconstructing a
 * win probability from the published variance field would DISAGREE with
 * `pRedWin`, which is why no control arm can reproduce the published number
 * from published fields and why the substitution had to be measured end to end
 * rather than reasoned about.
 *
 * THE MEASURED GAP against the site's own `pRedWin` is stated in
 * `scripts/measureAllianceWinProbability.ts` as exported constants beside the
 * command that produced them:
 *
 *     npx tsx scripts/measureAllianceWinProbability.ts --seasons 2026 --warmup-from 2026
 *     pnpm measure:alliance-win-probability
 *
 * and on the methodology page. Changing this formula means re-running that
 * command, never editing a recorded number.
 *
 * BROWSER-SAFE LEAF. Exactly one runtime import, `standardNormalCdf` from
 * `packages/core/rankingPoints/marginals.js`. Registered as an entry point in
 * `packages/harness/browserSafeSchemas.test.ts`'s static import-graph scan, so
 * browser safety is a machine-checked fact rather than a claim in a comment.
 */
import { standardNormalCdf } from "../../rankingPoints/marginals.js";

/**
 * The published metric component names this module reads. Declared as local
 * literals rather than imported so this leaf keeps exactly ONE runtime import:
 * `TOTAL_METRIC_KEY` lives in `packages/core/algorithms/types.ts` and
 * `SIGMA_METRIC_KEY` in `packages/harness/sigmaScore.ts`, which is a LEVEL-2
 * module a level-1 leaf must not import (see `sigmaScoutLayer.ts`'s header).
 *
 * Drift is prevented by assertion, not by hope: `allianceWinProbability.test.ts`
 * pins both constants against the real exports by strict equality, so renaming
 * either published key turns that test red.
 */
export const PRICING_TOTAL_KEY = "total";
/** See `PRICING_TOTAL_KEY` — same contract, the Sigma Score component. */
export const PRICING_SIGMA_KEY = "sigma";

/**
 * The clamp bounds. IDENTICAL to `packages/core/algorithms/spr.ts:605`'s
 * `Math.min(1 - 1e-6, Math.max(1e-6, normCdf(z)))`, so a measured comparison
 * against the published `pRedWin` can never be an artifact of two different
 * clamps.
 */
export const ALLIANCE_WIN_PROBABILITY_EPSILON = 1e-6;

/** One roster member as the browser reads it off a published event artifact. */
export interface AllianceMemberRating {
  readonly teamKey: string;
  /** `metrics["total"].value` — the team's rating in points. */
  readonly total: number | undefined;
  /** `metrics["sigma"].value` — the team's Sigma Score. */
  readonly sigma: number | undefined;
}

/** The published per-team metric record shape, narrowed to what this module reads. */
export interface PublishedMetricValue {
  readonly value: number;
  readonly spread?: number;
}

/**
 * Sums one roster's mean and UNCORRECTED variance, all-or-nothing.
 *
 * Mirrors `allianceSigmaBandVariance`'s rule and its stated reason: summing
 * only the known members gives a band too narrow that reads as confident, and
 * better no band than a tight one. A roster with any absent or non-finite
 * member returns `undefined` rather than a narrower plausible number.
 */
function rosterMoments(roster: readonly AllianceMemberRating[]): { mean: number; variance: number } | undefined {
  if (roster.length === 0) return undefined;
  let mean = 0;
  let variance = 0;
  for (const member of roster) {
    const total = member.total;
    const sigma = member.sigma;
    if (typeof total !== "number" || !Number.isFinite(total)) return undefined;
    if (typeof sigma !== "number" || !Number.isFinite(sigma)) return undefined;
    mean += total;
    variance += sigma * sigma;
  }
  return { mean, variance };
}

/**
 * The probability the RED alliance beats the BLUE alliance, from published
 * totals and Sigma Scores alone:
 *
 *     z = (sum red total - sum blue total) / sqrt(sum red sigma^2 + sum blue sigma^2)
 *     p = clamp(Phi(z), 1e-6, 1 - 1e-6)
 *
 * `undefined` — never a narrower plausible number — when either roster is
 * empty, when ANY member's `total` or `sigma` is absent or non-finite, or when
 * the combined variance is not strictly positive. Two all-zero-Sigma rosters
 * are not a certainty; they are an absence of information about spread.
 */
export function allianceWinProbability(
  red: readonly AllianceMemberRating[],
  blue: readonly AllianceMemberRating[]
): number | undefined {
  const redMoments = rosterMoments(red);
  if (redMoments === undefined) return undefined;
  const blueMoments = rosterMoments(blue);
  if (blueMoments === undefined) return undefined;

  const combinedVariance = redMoments.variance + blueMoments.variance;
  if (!Number.isFinite(combinedVariance) || combinedVariance <= 0) return undefined;

  const z = (redMoments.mean - blueMoments.mean) / Math.sqrt(combinedVariance);
  if (!Number.isFinite(z)) return undefined;

  const eps = ALLIANCE_WIN_PROBABILITY_EPSILON;
  return Math.min(1 - eps, Math.max(eps, standardNormalCdf(z)));
}

/**
 * Builds a roster's input array from a published metrics record, so every
 * consumer indexes `total` and `sigma` through ONE definition instead of
 * re-deriving the two key names at each call site. A team absent from the
 * record, or carrying a non-numeric component, yields `undefined` for that
 * field — which `allianceWinProbability` then turns into an all-or-nothing
 * `undefined` for the whole alliance.
 */
export function allianceRatingsFromMetrics(
  roster: readonly string[],
  metricsByTeam: {
    readonly [teamKey: string]: { readonly [component: string]: PublishedMetricValue | undefined } | undefined;
  }
): AllianceMemberRating[] {
  return roster.map((teamKey) => {
    const metrics = metricsByTeam[teamKey];
    return {
      teamKey,
      total: metrics?.[PRICING_TOTAL_KEY]?.value,
      sigma: metrics?.[PRICING_SIGMA_KEY]?.value,
    };
  });
}
