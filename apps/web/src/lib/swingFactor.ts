/**
 * The browser's own copy of Swing Factor — the `Y` in `X ± Y` — computed
 * client-side from a team's published per-match predicted-vs-actual alliance
 * scores, for whatever algorithm's artifact is currently being viewed (quick
 * task 260908-5wd).
 *
 * `packages/core/algorithms/sigma1/swing.ts` is the ESTIMATOR OF RECORD: it
 * carries the full derivation, the honest ceiling (r ~= 0.59, walk-forward
 * over 275,172 team-matches), and the evidence behind both constants below.
 * This module is a pure, no-React re-implementation of that same algebra,
 * run over whatever fields a published `TeamSeasonArtifact` already carries
 * — never a new fetch, never a new field. It exists because Swing Factor
 * stopped being something VPR alone produces: OPR and EPA artifacts carry
 * every term of the same formula (`predictedRedScore`/`predictedBlueScore`/
 * `actualRedScore`/`actualBlueScore`/`redTeams`/`blueTeams` on each match
 * row), so the site can compute it for them too, with no pipeline change and
 * no republish.
 *
 * See `withBrowserSwingFactor` in `SeasonHeader.tsx` (this task) for the
 * published-wins merge rule that makes this safe to ship against artifacts
 * that already publish a real `spread`: this module's output is only ever
 * SHOWN where the pipeline published nothing to disagree with.
 *
 * ---------------------------------------------------------------------------
 * MEASURED ON LIVE 2026 DATA, 2026-09-08 — A WEAK MODEL'S SWING FACTOR IS
 * MOSTLY THE MODEL'S ERROR, NOT THE ROBOT'S SWING
 * ---------------------------------------------------------------------------
 *
 * Team 254, 2026, all three algorithms, same robot and same matches:
 *
 *     VPR (published)   ± 55.71
 *     EPA (browser)     ± 58.04
 *     OPR (browser)     ± 298.92
 *
 * The OPR figure was ARITHMETICALLY CORRECT and was never a bug in the
 * arithmetic. 254's four most recent matches are Einstein, where OPR
 * under-predicts by +239, +209, +256 and +233 points per robot — a SYSTEMATIC,
 * same-signed bias, which the 6-match half-life then weights most heavily of
 * all. Squaring those about ZERO reported the bias as though the robot were
 * swinging by 300 points a match.
 *
 * It meant something different from the other two. `swing.ts`'s header is
 * explicit that Y is meant to be the ROBOT'S OWN match-to-match swing, and
 * concedes that a residual "also carries MEAN-MODEL ERROR as well as robot
 * noise". For VPR and EPA that error term is small and roughly centred, so Y
 * was mostly robot. For OPR at the top of the field it was neither small nor
 * centred, so Y was mostly OPR being wrong in one direction.
 *
 * RESOLVED 2026-09-08 by developer decision: `swingFactorFromDeviations` now
 * CENTRES — see its own doc comment for the full argument, the small-k
 * consequence, and the honest note on the inherited scale. VPR is unaffected in
 * every case (published-wins means this estimator never runs for it).
 */

import type { TeamSeasonArtifact } from "../../../../packages/harness/pageArtifacts.js";

/**
 * Web-local copy of `packages/core/algorithms/sigma1/swing.ts`'s
 * `SIGMA1_SWING_HALF_LIFE_MATCHES`. That file states the measurement: swept
 * walk-forward over 275,172 team-matches (2024-2026), 6 matches sits at the
 * top of a plateau where decay beats a flat average by 2.3%.
 *
 * Duplicated rather than imported: `swing.ts`'s core copy is scheduled for
 * deletion at the next Sigma1 params major (see
 * `.planning/todos/pending/remove-swing-from-sigma1-core.md`), and this
 * module — the site's OWN measurement of record from here on — must outlive
 * that deletion unchanged.
 */
export const SWING_FACTOR_HALF_LIFE_MATCHES = 6;

/**
 * Web-local copy of `packages/core/algorithms/sigma1/swing.ts`'s
 * `SIGMA1_SWING_SCALE`. That file states the measurement: regressed
 * non-circularly on 86,844 alliance-observations, against the OBSERVABLE
 * alliance residual magnitude, landing on 1.92.
 *
 * Duplicated rather than imported for the same reason as the half-life
 * above — see that constant's doc comment.
 */
export const SWING_FACTOR_SCALE = 1.92;

/**
 * The per-observation decay multiplier: `0.5 ** (1 / halfLifeMatches)`, so
 * an observation exactly `halfLifeMatches` folds old carries half the
 * weight of the newest one.
 */
function decayFor(halfLifeMatches: number): number {
  return 0.5 ** (1 / halfLifeMatches);
}

/**
 * Folds a chronologically ordered (oldest first) list of per-match deviation
 * observations into one published `±`, as a recency-weighted spread ABOUT THE
 * TEAM'S OWN WEIGHTED MEAN DEVIATION — not about zero.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS CENTRES, WHERE `swing.ts` DELIBERATELY DOES NOT (developer decision,
 * 2026-09-08, on the OPR measurement in this file's header)
 * ---------------------------------------------------------------------------
 *
 * `swing.ts` forbids subtracting a running mean, and its reason is sound FOR
 * VPR: a Kalman residual is centred about zero by construction, so the sample
 * mean there is pure noise, and subtracting it would bias Y downward by exactly
 * the sampling error while buying nothing.
 *
 * That premise does not survive the move to other algorithms, which is the
 * whole point of this module. A weak model's residuals are NOT centred: OPR
 * misses team 254's Einstein matches by +239, +209, +256, +233 — same sign
 * every time. Squaring about zero then reports that BIAS as though it were the
 * robot swinging, and published `322.42 ± 298.92`, a number about OPR wearing
 * the glyph of a claim about the robot.
 *
 * Centring separates the two. What survives is the part that actually varies
 * match to match, which is what Swing Factor claims to measure and what every
 * one of `swing.ts`'s three user stories asks for. A robot the model misses by
 * exactly +5 every single match now reads `0.00` — correctly: that robot has no
 * swing at all, and the +5 is the model's problem, not the robot's.
 *
 * Mechanically this is `E[x^2] - E[x]^2` with reliability weights, and the
 * denominator is the standard weighted unbiased form
 * `sum(w) - sum(w^2)/sum(w)` rather than `sum(w)`. That denominator is doing
 * real work at small k and is not decoration: it is what makes ONE observation
 * return `undefined` instead of `0`. A single point genuinely cannot separate
 * bias from swing — its spread about its own mean is `0/0`, not zero — and
 * publishing `± 0.00` there would be the exact false claim of perfect
 * consistency `swing.ts` warns about. `undefined` renders as a bare value.
 *
 * THIS IS A DELIBERATE DIVERGENCE FROM D-Y2'S NEVER-BLANK RULE, and it is
 * narrow: D-Y2 governs VPR's PUBLISHED spread, which this module never touches
 * (published-wins). Here, one match is genuinely not enough, and saying so is
 * the honest answer.
 *
 * `SWING_FACTOR_SCALE` is INHERITED, and its calibration is now approximate.
 * The 1.92 was regressed against the UNCENTRED estimator. For VPR- and
 * EPA-shaped residuals the mean is near zero, so centring barely moves the
 * value and the constant stays about right — those are the residuals it was
 * measured on. For a heavily biased model the centred quantity is genuinely
 * smaller, and no re-measurement has been done. Stated rather than papered
 * over.
 *
 * Throws on a non-finite deviation rather than skipping or coercing it: a
 * non-finite value here is an upstream bug (a malformed artifact), and a
 * coerced zero would silently publish "perfectly consistent" for corrupt
 * data — the same discipline `swing.ts`'s `foldSwingObservation` applies.
 */
export function swingFactorFromDeviations(deviations: readonly number[]): number | undefined {
  for (const deviation of deviations) {
    if (!Number.isFinite(deviation)) {
      throw new Error(
        `swingFactorFromDeviations: non-finite deviation ${deviation} — refusing to fold it into the published Swing Factor`
      );
    }
  }
  if (deviations.length === 0) return undefined;

  const decay = decayFor(SWING_FACTOR_HALF_LIFE_MATCHES);
  // Newest observation carries weight 1; one `age` folds older carries
  // `decay ** age`. Deep history underflows to 0, which is correct rather than
  // lossy — an observation 300 matches back has a weight of ~1e-16 and cannot
  // matter to a 6-match half-life.
  const lastIndex = deviations.length - 1;
  const weights = deviations.map((_, index) => decay ** (lastIndex - index));

  let weight = 0;
  let weightSquares = 0;
  let weightedSum = 0;
  for (const [index, w] of weights.entries()) {
    weight += w;
    weightSquares += w * w;
    weightedSum += w * (deviations[index] as number);
  }
  if (weight <= 0) return undefined;

  // Effective-sample-size denominator. Exactly 0 at k = 1 (and only there),
  // which is the "one point cannot separate bias from swing" case above.
  const denominator = weight - weightSquares / weight;
  if (denominator <= 0) return undefined;

  // TWO passes, deliberately. The algebraically-equivalent one-pass form
  // (`E[x^2] - E[x]^2`) is catastrophically cancelling exactly where this
  // estimator now spends its time: a heavily biased model's deviations are
  // large and nearly equal, so both terms are big and their difference is
  // tiny. Measured during this change — five identical deviations of 3
  // returned 9.05e-8 instead of 0 through the one-pass form, and OPR's real
  // deviations are ~250, where the error grows with the square. Subtracting
  // the mean FIRST keeps the summands small and the result exact.
  const mean = weightedSum / weight;
  let centredSumOfSquares = 0;
  for (const [index, w] of weights.entries()) {
    const centred = (deviations[index] as number) - mean;
    centredSumOfSquares += w * centred * centred;
  }

  return SWING_FACTOR_SCALE * Math.sqrt(centredSumOfSquares / denominator);
}

/**
 * The browser-computed Swing Factor for one team, read straight off an
 * already-fetched, already-validated `TeamSeasonArtifact` — no new fetch, no
 * new field, works for any algorithm's artifact.
 *
 * Builds the deviation list by visiting events in ascending `startDate`
 * order (a stable sort, so same-day events keep the artifact's own order —
 * `Array.prototype.sort` has been spec-guaranteed stable since ES2019, so no
 * extra tie-break is needed), then each event's `matches` in array order.
 * For each row:
 *   - skipped when `actualRedScore`/`actualBlueScore` is absent (an
 *     unplayed match contributes nothing and does not consume a decay step)
 *   - skipped when the team names neither `redTeams` nor `blueTeams`
 *   - skipped when the team's own roster is empty
 *   - otherwise folds `(actualScore - predictedScore) / roster.length` for
 *     the team's OWN alliance — its share of that alliance's residual.
 *
 * Elimination matches are included alongside qualification matches — a
 * deliberate choice which may not reproduce the pipeline's exact inclusion
 * rules (surrogates, elimination-specific weighting) for the SAME quantity
 * under a different name. It does not need to: the published-wins merge
 * this value is only ever shown through (`withBrowserSwingFactor` in
 * `SeasonHeader.tsx`) guarantees this number is only displayed where the
 * pipeline published nothing to disagree with, so no surface can ever show
 * two different Swing Factors for the same team.
 *
 * `untilMatchKey` BOUNDS THE OBSERVATION WINDOW, and exists because the team
 * header usually renders an AS-OF-LAST-OFFICIAL-MATCH snapshot rather than
 * season-final values (`officialSnapshot.ts`). A whole-season `±` printed
 * beside an as-of-then value would describe a window the value beside it does
 * not — the exact "two different as-of instants in one block" defect IN-01
 * already names on this component. Passing the snapshot's own `matchKey`
 * makes the two agree: fold every match UP TO AND INCLUDING that one, then
 * stop.
 *
 * Preseason ("Week 0") matches preceding the bound stay INCLUDED, and that is
 * correct rather than an oversight: the snapshot's value is the model's state
 * after the last official match, and that state had already learned from every
 * earlier match whatever its event type. The window matches what the number
 * beside it actually saw.
 *
 * A `untilMatchKey` that never appears returns `undefined` rather than
 * silently falling back to the whole season — a window we cannot reconstruct
 * must publish nothing, never a number quietly measured over a different span.
 */
export function swingFactorForTeam(
  artifact: TeamSeasonArtifact,
  teamKey: string,
  options?: { readonly untilMatchKey?: string }
): number | undefined {
  const untilMatchKey = options?.untilMatchKey;
  const sortedEvents = [...artifact.events].sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));

  const deviations: number[] = [];
  let reachedBound = untilMatchKey === undefined;
  for (const event of sortedEvents) {
    if (reachedBound && untilMatchKey !== undefined) break;
    for (const match of event.matches) {
      const isBound = untilMatchKey !== undefined && match.matchKey === untilMatchKey;
      if (match.actualRedScore === undefined || match.actualBlueScore === undefined) {
        if (isBound) {
          reachedBound = true;
          break;
        }
        continue;
      }

      let roster: readonly string[];
      let actualScore: number;
      let predictedScore: number;
      if (match.redTeams.includes(teamKey)) {
        roster = match.redTeams;
        actualScore = match.actualRedScore;
        predictedScore = match.predictedRedScore;
      } else if (match.blueTeams.includes(teamKey)) {
        roster = match.blueTeams;
        actualScore = match.actualBlueScore;
        predictedScore = match.predictedBlueScore;
      } else {
        if (isBound) {
          reachedBound = true;
          break;
        }
        continue;
      }
      if (roster.length !== 0) deviations.push((actualScore - predictedScore) / roster.length);

      if (isBound) {
        reachedBound = true;
        break;
      }
    }
  }

  // A window we could not reconstruct publishes nothing — never a number
  // quietly measured over a different span than the value beside it.
  if (!reachedBound) return undefined;

  return swingFactorFromDeviations(deviations);
}
