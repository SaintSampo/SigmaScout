/**
 * The match page's "metrics as they stood just before this match" resolver
 * (260909-tiq-PLAN.md Task 2) — the load-bearing correctness point this
 * plan's whole match-page objective rests on.
 *
 * `MetricHistoryRowSchema.metrics` (`packages/harness/metricHistorySchema.ts`)
 * is documented as that team's metric AFTER this row's match — each row is a
 * POST-match snapshot, not a pre-match one. The pre-match state for a match
 * is therefore the row PRECEDING it in the team's chronological
 * `metricHistory` array, never the row FOR the match itself: returning that
 * row would print a post-update figure — the very value the team learned
 * FROM this match's result — as if it were the figure going INTO the match,
 * silently inverting cause and effect.
 *
 * `seasonStats.metrics` (season-final, or `officialSnapshot.ts`'s
 * last-official-match snapshot) is never consulted as a fallback here either,
 * for the same reason the header-tile code never substitutes one as-of
 * instant for another: both are a DIFFERENT as-of instant than "immediately
 * before this specific match", and printing either one under a pre-match
 * label would make a stale or future number look like a pre-match number.
 * Absence is rendered as absence by this function's callers — never a
 * substituted figure from elsewhere on the artifact.
 *
 * Pure, no React — mirrors `officialSnapshot.ts`'s own
 * "resolve one history row, return undefined rather than fall back" shape.
 */
import type { TeamSeasonArtifact } from "../../../../packages/harness/pageArtifacts.js";

type MetricHistoryRows = TeamSeasonArtifact["metricHistory"];
type MetricHistoryRowMetrics = MetricHistoryRows[number]["metrics"];

/**
 * Which as-of instant `PreMatchMetrics.metrics` reflects:
 * - `"before-this-match"` — the team's state immediately before a PLAYED
 *   match: the history row that precedes the match's own row.
 * - `"latest-played"` — for an UNPLAYED match, the team's state after its
 *   most recent played match, which IS its state going into a match that has
 *   not happened yet.
 *
 * The two are never conflated — every `PreMatchMetrics` carries exactly one
 * of these, and callers render different wording for each (260909-tiq-PLAN.md
 * Task 2's `<behavior>` contract).
 */
export type PreMatchBasis = "before-this-match" | "latest-played";

export interface PreMatchMetrics {
  metrics: MetricHistoryRowMetrics;
  basis: PreMatchBasis;
  /** The `matchKey` of the history row `metrics` was read from — the as-of instant, named rather than merely implied. */
  asOfMatchKey: string;
}

export interface PreMatchMetricsOptions {
  /**
   * Named field, not a bare positional boolean (the PD-01 precedent in
   * `event.$eventKey.tsx`'s `resolveActiveTab`): this function has exactly
   * two branches whose only difference is this flag, and a transposed bare
   * boolean at a call site would compile cleanly while silently resolving
   * the wrong branch.
   */
  played: boolean;
}

/**
 * Resolves one team's pre-match metrics for one match, per this module's
 * header contract. Returns `undefined` — never a substituted or invented
 * value — whenever no honest pre-match state exists: the match is this
 * team's first of the season (a played row at index 0 has no preceding row),
 * the match key matches no row at all (e.g. a letter-suffixed second-robot
 * roster key that never appears in this team's own history), or the team has
 * no played matches yet at all (an unplayed match with empty history).
 */
export function preMatchMetrics(
  metricHistory: MetricHistoryRows,
  matchKey: string,
  { played }: PreMatchMetricsOptions,
): PreMatchMetrics | undefined {
  if (played) {
    const index = metricHistory.findIndex((row) => row.matchKey === matchKey);
    if (index <= 0) return undefined;
    const priorRow = metricHistory[index - 1]!;
    return { metrics: priorRow.metrics, basis: "before-this-match", asOfMatchKey: priorRow.matchKey };
  }

  if (metricHistory.length === 0) return undefined;
  const lastRow = metricHistory[metricHistory.length - 1]!;
  return { metrics: lastRow.metrics, basis: "latest-played", asOfMatchKey: lastRow.matchKey };
}
