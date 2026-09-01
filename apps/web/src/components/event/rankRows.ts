import { continuousQuantile } from "../../lib/simQuantile.js";
import { SIM_GEOMETRY } from "../../lib/simAxis.js";
import { teamNumberFromKey } from "../../lib/teamKey.js";
import type { SimResult } from "../../../../../packages/core/algorithms/simulation/rankSimulation.js";
import type { EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * Pure module, no React import (08-14-PLAN.md Task 1) — the row builder
 * joining a `SimResult` to the event roster, mirroring `eventMatchAxis.ts`'s
 * shape: a plain `.ts` module beside the component that consumes it, kept
 * importable from a Node script under `tsx` because Task 2's mock has to run
 * this SHIPPED builder, never a second implementation of its own (a mock
 * that recomputes its own medians and band edges would validate a chart the
 * app does not render — `chart-craft.md`'s mock-against-the-real-distribution
 * rule).
 *
 * **The median decision, the one place this file deviates from a validated
 * reference.** The drawn tick and the printed integer come from ONE call to
 * the same type-7 estimator (`continuousQuantile`) that produces the band
 * edges — `chart-craft.md`'s coupled-geometry rule applied to the median.
 * Sketch 005's own renderer used an integer median offset by half a slot but
 * recorded no decision about it, unlike `continuousQuantile()` itself, which
 * IS a recorded decision and is ported verbatim. The case that settles this:
 * a perfectly bimodal team split 500/500 between two ranks has a continuous
 * median of exactly halfway, while an integer median would assert a
 * preference the draws do not support. Accepted cost: the printed integer
 * can sit up to half a rank from the drawn tick — Task 2 measures how often
 * that is visible at a real event.
 */

type EventTeam = EventArtifact["teams"][number];

/** One simulated team's row: every field a caller needs to render one row of the rank-distribution table, all derived from ONE `continuousQuantile` call per percentile. */
export interface RankDistributionRow {
  teamKey: string;
  teamNumber: number;
  nickname: string | undefined;
  /** Per-rank draw count, index `rank - 1` — the same `SimResult.rankHistograms` value, passed through unconverted and unmutated. */
  histogram: Int32Array;
  draws: number;
  /** The simulated team count, taken from `result.rankHistograms.size` — never `teams.length`, which may differ (a team present in the result but absent from the roster, RESEARCH assumption A2). */
  teamCount: number;
  /** The continuous 50th percentile — what the median tick draws from. */
  medianRank: number;
  /** `medianDisplayRank(medianRank, teamCount)` — the display rounding of the same quantity, never a second computation. */
  medianDisplay: number;
  p10: number;
  p90: number;
  /** This row's own largest single-rank draw count — the per-row histogram normalizer (`histBarHeight`'s divisor). */
  maxBinCount: number;
}

/**
 * Thrown by `buildRankDistributionRows` when a histogram's shape cannot be
 * trusted: its length disagrees with the simulated team count, or its
 * entries do not sum to `draws`. Both are structural corruption a plausible-
 * looking plot would hide completely — failing loudly here is the only
 * detectable outcome, defense in depth behind the publish-boundary schema
 * and `simulateRanks`'s own guarantees.
 */
export class MalformedRankHistogramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedRankHistogramError";
  }
}

/**
 * Rounds a continuous rank position half-up and clamps it into the closed
 * interval `[1, teamCount]`. The clamp is not decorative: the estimator's
 * upper bound is `teamCount + 0.5`, and a bare half-up rounding of that
 * bound would print a rank one past the end of the field (`teamCount + 1`).
 */
export function medianDisplayRank(medianRank: number, teamCount: number): number {
  const upperBound = Math.max(teamCount, 1);
  const roundedHalfUp = Math.floor(medianRank + 0.5);
  return Math.min(Math.max(roundedHalfUp, 1), upperBound);
}

/**
 * A histogram bar's height in pixels, capped at `SIM_GEOMETRY.HIST_BAR_MAX_H`
 * and floored at `1` for any rank at least one draw reached — an invisible
 * mark on an honesty-first display reads as certainty, which the 1px floor
 * exists to prevent. Normalized to this ROW's own modal count
 * (`maxBinCount`), not a table-wide maximum: this is sketch 005's own
 * validated choice, and it is not the per-row scale the user rejected — what
 * was rejected was a per-row RANK axis, which destroys the cross-row
 * comparison this table exists for. This vertical axis carries no ticks, no
 * labels and no cross-row comparison; the band and the printed 10th-90th
 * range carry concentration, while this histogram carries SHAPE (the
 * bimodality D-05 names as its whole reason for existing). The accepted
 * cost, stated plainly: equal bar heights in two different rows do not mean
 * equal draw counts.
 */
export function histBarHeight(count: number, maxBinCount: number): number {
  if (count <= 0) return 0;
  if (!(maxBinCount > 0)) return SIM_GEOMETRY.HIST_BAR_MAX_H;
  const scaled = (count / maxBinCount) * SIM_GEOMETRY.HIST_BAR_MAX_H;
  return Math.min(SIM_GEOMETRY.HIST_BAR_MAX_H, Math.max(1, scaled));
}

/** `10th–90th: ` — an en dash between the two ordinals, a single trailing space. Never restated inline; every band label is built from this constant. */
export const RANK_BAND_LABEL_PREFIX = "10th–90th: ";

/**
 * An explicit percentile-range label, one decimal place, joined by an en
 * dash — NEVER a plus-or-minus quantity. Phase 7 D-01 reserves that glyph
 * for exactly one standard deviation of full predictive variance at every
 * aggregation level on this site; a rank spread is not that quantity,
 * because rank is bounded, integer and skewed. The app's shared metric-value
 * primitive prints that glyph by construction and must not be reached for
 * here — this function, and the module doc comment describing it, never
 * type that character.
 */
export function rankBandLabel(p10: number, p90: number): string {
  return `${RANK_BAND_LABEL_PREFIX}${p10.toFixed(1)}–${p90.toFixed(1)}`;
}

/**
 * Joins a `SimResult` to the event roster and returns one row per simulated
 * team, sorted ascending by the CONTINUOUS median (never the display
 * integer). Ties on the continuous median break by `teamKey` ascending — a
 * total, arbitrary tie-break that asserts nothing about which of two
 * equal-median teams is better, because the published data cannot establish
 * that (the same stance D-11 takes on the Compare page and D-14 takes on
 * simulated ties). No secondary ordering by band width, by 10th percentile,
 * or by any other statistic is ever introduced — that would present an
 * ordering as meaningful which this data does not support.
 *
 * `teamCount` is derived from `result.rankHistograms.size`, never from
 * `teams.length`: the histograms were produced against that roster, and
 * taking N from a second source is exactly the two-numbers-that-must-agree
 * shape this whole plan is written against.
 *
 * Mutates neither `result` nor `teams`.
 */
export function buildRankDistributionRows(result: SimResult, teams: readonly EventTeam[]): RankDistributionRow[] {
  const teamCount = result.rankHistograms.size;
  const rosterByKey = new Map<string, EventTeam>(teams.map((team) => [team.teamKey, team]));

  const rows: RankDistributionRow[] = [];

  for (const [teamKey, histogram] of result.rankHistograms) {
    if (histogram.length !== teamCount) {
      throw new MalformedRankHistogramError(
        `buildRankDistributionRows: team "${teamKey}"'s histogram has length ${histogram.length}, expected ${teamCount} (result.rankHistograms.size)`
      );
    }

    let sum = 0;
    let maxBinCount = 0;
    for (let i = 0; i < histogram.length; i++) {
      const value = histogram[i]!;
      sum += value;
      if (value > maxBinCount) maxBinCount = value;
    }
    if (sum !== result.draws) {
      throw new MalformedRankHistogramError(
        `buildRankDistributionRows: team "${teamKey}"'s histogram sums to ${sum}, expected ${result.draws} (result.draws)`
      );
    }

    const medianRank = continuousQuantile(histogram, 0.5, result.draws);
    const p10 = continuousQuantile(histogram, 0.1, result.draws);
    const p90 = continuousQuantile(histogram, 0.9, result.draws);

    const rosterEntry = rosterByKey.get(teamKey);
    let teamNumber: number;
    if (rosterEntry?.teamNumber !== undefined) {
      teamNumber = rosterEntry.teamNumber;
    } else {
      try {
        teamNumber = teamNumberFromKey(teamKey);
      } catch {
        // Defensive only — every real team key in this pipeline is
        // `frc{number}`-shaped (`teamKey.ts`'s own doc comment). Unreachable
        // for any key `simulateRanks` could actually produce; `0` is a safe,
        // finite, never-non-finite fallback rather than a thrown error here.
        teamNumber = 0;
      }
    }

    rows.push({
      teamKey,
      teamNumber,
      nickname: rosterEntry?.nickname,
      histogram,
      draws: result.draws,
      teamCount,
      medianRank,
      medianDisplay: medianDisplayRank(medianRank, teamCount),
      p10,
      p90,
      maxBinCount,
    });
  }

  rows.sort((a, b) => {
    if (a.medianRank !== b.medianRank) return a.medianRank - b.medianRank;
    return a.teamKey < b.teamKey ? -1 : a.teamKey > b.teamKey ? 1 : 0;
  });

  return rows;
}
