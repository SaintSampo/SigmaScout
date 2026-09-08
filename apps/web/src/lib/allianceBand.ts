/**
 * The match-prediction band, computed in the browser for EVERY algorithm
 * (quick task 260908-5wd, developer decision 2026-09-08).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS: THE BAND USED TO BE A VPR PRIVILEGE
 * ---------------------------------------------------------------------------
 *
 * `redScoreVarianceOwn`/`blueScoreVarianceOwn` are published by VPR alone.
 * Measured against the live 2026 artifacts on 2026-09-08, event `2026casnv`:
 * VPR carries a variance on 89 of 89 played matches, OPR on 0 of 89, EPA on 0
 * of 89. So switching the ribbon's algorithm away from VPR deleted every match
 * band and every match `±` on the page — the site's stated differentiator
 * silently became a property of one algorithm.
 *
 * ---------------------------------------------------------------------------
 * THE CONSTRUCTION, AND WHY IT IS THE SAME QUANTITY AS THE TEAM PAGE'S ±
 * ---------------------------------------------------------------------------
 *
 *     alliance variance = Σ over the three teams of swingFactor(team)²
 *
 * so the drawn band is `√(Σ swing²)` — the three robots' own Swing Factors
 * combined in quadrature. This is deliberately the SAME quantity
 * `swingFactor.ts` puts on a team's tile, at the aggregation level a match
 * needs, which is what `pageArtifacts.ts`'s header has always CLAIMED is true
 * of `redScoreVarianceOwn` ("equals the sum of its three teams'
 * `TeamMetric.spread` squares, by construction") and what
 * `sigma1/index.ts:1598` records has NOT been true since sigma1 5.0.0.
 * Measured over 10,016 alliance observations before this change, the published
 * variance was a median 0.837 of that sum and ranged 0.19–5.68. Computing the
 * band this way makes the documented identity true again by construction
 * rather than by hope.
 *
 * ---------------------------------------------------------------------------
 * NO NEW CONSTANT, AND THAT WAS MEASURED RATHER THAN ASSUMED
 * ---------------------------------------------------------------------------
 *
 * `swingFactor.ts`'s existing `SWING_FACTOR_SCALE` (1.92) carries through
 * untouched. Walk-forward over 31,142 alliance observations of 2026 — each
 * team's swing built only from its strictly earlier matches, then tested
 * against the match that followed — the scale that would make this band a
 * textbook 1σ is 1.99 for VPR and 2.06 for EPA. 1.92 is inside that, so no new
 * magic number is introduced and the team tile and the match band cannot drift
 * apart by carrying two different constants.
 *
 * WHAT THAT BUYS, STATED HONESTLY: at 1.92 the band covers ~76% of actual
 * scores for VPR and EPA and ~87% for OPR, where a true 1σ Gaussian band would
 * cover 68.3%. It is therefore CONSERVATIVE — slightly wider than it claims —
 * and OPR's is the widest because OPR's residuals are genuinely the largest.
 * VPR's own published band measured 75.2% before this change, so this is not a
 * regression: it is the same calibration, now available to every algorithm.
 * A coverage-calibrated scale (VPR 1.68, OPR 1.13, EPA 1.71) was measured and
 * deliberately NOT adopted here, because three per-algorithm constants would
 * need re-measuring on every model change and are exactly the kind of stale
 * number this project's failure log is about. See
 * `.planning/todos/pending/match-band-calibration-and-the-broken-additivity-identity.md`.
 *
 * SYMMETRIC, deliberately. Residual skew was measured at +0.08 (upper
 * semi-deviation 73.27 vs 64.91 below, a ratio of 1.13) — real but modest, and
 * a POPULATION property that a single team's ~9 effective observations cannot
 * support. An asymmetric band is a later, separable change and must use that
 * global ratio, never a per-team one.
 */

import { swingFactorFromDeviations } from "./swingFactor.js";

/** The minimum a match row must carry for this module to read it. Structural, so both `EventMatch` and `EventUpcomingMatch` satisfy it. */
export interface BandMatchInput {
  readonly redTeams: readonly string[];
  readonly blueTeams: readonly string[];
  readonly predictedRedScore: number;
  readonly predictedBlueScore: number;
  readonly actualRedScore?: number;
  readonly actualBlueScore?: number;
}

/**
 * Every rostered team's Swing Factor, computed from the played matches given.
 *
 * Pass the event's WHOLE played-match array, not a comp-level-filtered slice:
 * an Elims tab that estimated swing from elimination matches alone would be
 * working from a handful of observations per team, and the quantity it drew
 * would not be the one the Quals tab drew.
 *
 * Matches are read in array order, which is the published artifact's own
 * chronological order — the same assumption `mergeEventMatches` already makes
 * before sorting. A team appearing in fewer than two played matches gets NO
 * entry (`swingFactorFromDeviations` returns `undefined` there — one
 * observation cannot separate model bias from robot swing), which is why the
 * first rounds of a live event legitimately have no browser band yet.
 */
export function teamSwingFactorsFromMatches(matches: readonly BandMatchInput[]): ReadonlyMap<string, number> {
  const deviationsByTeam = new Map<string, number[]>();

  for (const match of matches) {
    if (match.actualRedScore === undefined || match.actualBlueScore === undefined) continue;
    for (const side of ["red", "blue"] as const) {
      const roster = side === "red" ? match.redTeams : match.blueTeams;
      if (roster.length === 0) continue;
      const actual = side === "red" ? match.actualRedScore : match.actualBlueScore;
      const predicted = side === "red" ? match.predictedRedScore : match.predictedBlueScore;
      if (!Number.isFinite(actual) || !Number.isFinite(predicted)) continue;
      const deviation = (actual - predicted) / roster.length;
      for (const teamKey of roster) {
        const existing = deviationsByTeam.get(teamKey);
        if (existing === undefined) deviationsByTeam.set(teamKey, [deviation]);
        else existing.push(deviation);
      }
    }
  }

  const swingByTeam = new Map<string, number>();
  for (const [teamKey, deviations] of deviationsByTeam) {
    const swing = swingFactorFromDeviations(deviations);
    if (swing !== undefined) swingByTeam.set(teamKey, swing);
  }
  return swingByTeam;
}

/**
 * Every PLAYED match's band variance, computed WALK-FORWARD: each match's band
 * uses only the matches BEFORE it, then that match is folded in.
 *
 * This is not fastidiousness, it is the difference between two different
 * claims. A band drawn round a played match answers "how unsure were we when
 * we predicted this", and answering it with data from later in the event would
 * quietly use the future to describe the past. The project's own methodology
 * constraint is predict-before-update, and the scale this band leans on was
 * MEASURED walk-forward (31,142 observations) — so a display built in-sample
 * would not be the thing that was calibrated.
 *
 * The honest cost: the opening rounds of an event have no band at all, because
 * no team yet has the two observations a centred swing needs. Measured
 * walk-forward across 2026, that is about 15% of alliance-observations, all of
 * them early. Blank there is correct — we genuinely did not know yet.
 *
 * Matches are read in array order, which is the artifact's own chronological
 * order. Upcoming matches are NOT handled here: they are the one case where
 * every played match legitimately precedes them, so they use the full map from
 * `teamSwingFactorsFromMatches`.
 */
export function walkForwardBandVariances(
  matches: readonly (BandMatchInput & { readonly matchKey: string })[]
): ReadonlyMap<string, { readonly red?: number; readonly blue?: number }> {
  const deviationsByTeam = new Map<string, number[]>();
  const swingOf = (teamKey: string) => {
    const deviations = deviationsByTeam.get(teamKey);
    return deviations === undefined ? undefined : swingFactorFromDeviations(deviations);
  };
  const varianceOf = (roster: readonly string[]) => {
    if (roster.length === 0) return undefined;
    let variance = 0;
    for (const teamKey of roster) {
      const swing = swingOf(teamKey);
      if (swing === undefined) return undefined;
      variance += swing * swing;
    }
    return variance;
  };

  const byMatchKey = new Map<string, { red?: number; blue?: number }>();
  for (const match of matches) {
    if (match.actualRedScore === undefined || match.actualBlueScore === undefined) continue;

    // PREDICT FIRST — from strictly earlier matches only.
    byMatchKey.set(match.matchKey, { red: varianceOf(match.redTeams), blue: varianceOf(match.blueTeams) });

    // THEN update, so no match can inform its own band.
    for (const side of ["red", "blue"] as const) {
      const roster = side === "red" ? match.redTeams : match.blueTeams;
      if (roster.length === 0) continue;
      const actual = side === "red" ? match.actualRedScore : match.actualBlueScore;
      const predicted = side === "red" ? match.predictedRedScore : match.predictedBlueScore;
      if (!Number.isFinite(actual) || !Number.isFinite(predicted)) continue;
      const deviation = (actual - predicted) / roster.length;
      for (const teamKey of roster) {
        const existing = deviationsByTeam.get(teamKey);
        if (existing === undefined) deviationsByTeam.set(teamKey, [deviation]);
        else existing.push(deviation);
      }
    }
  }
  return byMatchKey;
}

/**
 * One alliance's band variance: the quadrature sum of its roster's Swing
 * Factors, or `undefined` when ANY of them is missing.
 *
 * All-or-nothing on purpose. Summing the squares of only the two teams we
 * happen to know would produce a systematically NARROWER band that looks like
 * a confident prediction rather than a partial one — the same
 * partial-variance error `uncertainty-display.md` records as landing actual
 * results 7–10σ outside the drawn band in sketch 003. Better no band than a
 * band that is too tight.
 */
export function allianceBandVariance(
  roster: readonly string[],
  swingByTeam: ReadonlyMap<string, number>
): number | undefined {
  if (roster.length === 0) return undefined;
  let variance = 0;
  for (const teamKey of roster) {
    const swing = swingByTeam.get(teamKey);
    if (swing === undefined) return undefined;
    variance += swing * swing;
  }
  return variance;
}
