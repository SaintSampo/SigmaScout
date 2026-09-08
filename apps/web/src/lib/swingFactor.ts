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
 * observations into one published `±`, or `undefined` when the list is
 * empty — a domain check ("nothing to summarise"), never a floor or a
 * minimum-match threshold. Adding either is forbidden: a team with exactly
 * one observation gets a real, published Swing Factor.
 *
 * `weightedSquares` and `weight` are carried as two separate running numbers
 * rather than folded into one seeded running value
 * (`running = w*running + (1-w)*dev^2`, seeded at the first `dev^2`) because
 * carrying them separately is what makes the one-observation case exact
 * (`SCALE * |dev|`, no special case needed) and the k-observation case a
 * TRUE weighted mean at every k — a seeded running value piles the residual
 * weight `w^(k-1)` onto the OLDEST observation, which is exactly the wrong
 * place for a recency-weighted estimator to put it.
 *
 * Deviations are residuals, already centred about zero by construction, so
 * this is a weighted mean of `dev^2` ABOUT ZERO — no running mean is
 * subtracted (matching `swing.ts`'s own "weighted RMS about zero" section).
 *
 * Throws on a non-finite deviation rather than skipping or coercing it: a
 * non-finite value here is an upstream bug (a malformed artifact), and a
 * coerced zero would silently publish "perfectly consistent" for corrupt
 * data — the same discipline `swing.ts`'s `foldSwingObservation` applies.
 */
export function swingFactorFromDeviations(deviations: readonly number[]): number | undefined {
  const decay = decayFor(SWING_FACTOR_HALF_LIFE_MATCHES);
  let weightedSquares = 0;
  let weight = 0;
  for (const deviation of deviations) {
    if (!Number.isFinite(deviation)) {
      throw new Error(
        `swingFactorFromDeviations: non-finite deviation ${deviation} — refusing to fold it into the published Swing Factor`
      );
    }
    weightedSquares = decay * weightedSquares + deviation * deviation;
    weight = decay * weight + 1;
  }
  if (weight <= 0) return undefined;
  return SWING_FACTOR_SCALE * Math.sqrt(weightedSquares / weight);
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
 */
export function swingFactorForTeam(artifact: TeamSeasonArtifact, teamKey: string): number | undefined {
  const sortedEvents = [...artifact.events].sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));

  const deviations: number[] = [];
  for (const event of sortedEvents) {
    for (const match of event.matches) {
      if (match.actualRedScore === undefined || match.actualBlueScore === undefined) continue;

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
        continue;
      }
      if (roster.length === 0) continue;

      deviations.push((actualScore - predictedScore) / roster.length);
    }
  }

  return swingFactorFromDeviations(deviations);
}
