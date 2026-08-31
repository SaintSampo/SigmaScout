/**
 * D-11's near-tie rule (08-06-PLAN.md Task 1), pure and framework-free — no
 * React import, no component dependency. `AccuracyTable.tsx`'s
 * `buildRowEmphasis` is the sole consumer; this module never reaches back
 * into a component.
 *
 * `formatBrierDisplay`/`formatWinnerAccuracyDisplay` live HERE, not beside
 * the table, because D-11's Brier tie test is defined as equality of the
 * value AS DISPLAYED (four decimal places), not a re-rounded number or a
 * hand-written epsilon. One function producing the displayed string, called
 * by both the cell renderer and the tie test, is what makes "the decision
 * and the digits can never disagree" a fact rather than a convention a
 * second formatter could quietly violate. This is display formatting only —
 * published Brier/accuracy/calibration figures are deliberately unrounded in
 * the artifact (`docs/models/...`'s established convention); these functions
 * print them at a chosen precision and never re-derive or re-round the
 * underlying value.
 *
 * `naiveStandardError`/`combineStandardErrors` treat the two compared
 * algorithms as INDEPENDENT, when in fact they are scored on the same
 * matches — a known, deliberately conservative simplification, not a paired
 * test. The paired (McNemar-style) alternative is unavailable: it needs the
 * count of matches on which the two algorithms disagreed, and no field of
 * `CompareSliceSchema` carries it. `isNearTie`'s non-finite guard is what
 * keeps that simplification from ever asserting a winner it cannot support:
 * a bound that cannot be computed (a zero `scoredCount`, an out-of-unit-
 * interval `winnerAccuracy`) cannot establish one, so the honest default is
 * to withhold emphasis rather than let a `NaN` comparison silently evaluate
 * false and bold a leader on unusable data.
 */
import { PUBLISHED_ALGORITHM_IDS, type PublishedAlgorithmId } from "../../../../packages/harness/publishedAlgorithms.js";

export interface BrierCandidate {
  readonly algorithmId: PublishedAlgorithmId;
  readonly value: number | null;
}

export interface WinnerAccuracyCandidate {
  readonly algorithmId: PublishedAlgorithmId;
  readonly value: number | null;
  readonly scoredCount: number;
}

/** The single home for "how a Compare Brier figure is printed" — see the module doc comment. */
export function formatBrierDisplay(value: number): string {
  return value.toFixed(4);
}

/** The single home for "how a Compare Winner Accuracy figure is printed". */
export function formatWinnerAccuracyDisplay(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * `SE = sqrt(p * (1 - p) / n)`. Non-finite whenever `n` is zero (an interior
 * `p` divides a positive numerator by zero -> `+Infinity`; `p` at the unit
 * boundary divides zero by zero -> `NaN`) — both shapes are caught by
 * `isNearTie`'s own non-finite guard downstream.
 */
export function naiveStandardError(p: number, n: number): number {
  return Math.sqrt((p * (1 - p)) / n);
}

/** `sqrt(SE_a^2 + SE_b^2)` — the two algorithms' naive standard errors treated as independent. */
export function combineStandardErrors(a: number, b: number): number {
  return Math.sqrt(a * a + b * b);
}

/**
 * `true` when the combined standard error is not a finite number, and
 * otherwise the STRICT comparison `gap < combinedStandardError`. Both halves
 * are load-bearing: the strictness fixes what happens exactly at the
 * threshold (a gap equal to the bound clears it and bolds), and the
 * non-finite guard is what stops a degenerate bound from silently evaluating
 * `false` through `NaN < x`.
 */
export function isNearTie(gap: number, combinedStandardError: number): boolean {
  if (!Number.isFinite(combinedStandardError)) return true;
  return gap < combinedStandardError;
}

function algorithmOrderIndex(id: PublishedAlgorithmId): number {
  return PUBLISHED_ALGORITHM_IDS.indexOf(id);
}

function sortByPublishedOrder(ids: readonly PublishedAlgorithmId[]): PublishedAlgorithmId[] {
  return [...ids].sort((a, b) => algorithmOrderIndex(a) - algorithmOrderIndex(b));
}

type LeaderPairResolution<T> =
  | { readonly kind: "empty" }
  | { readonly kind: "tied"; readonly ids: readonly PublishedAlgorithmId[] }
  | { readonly kind: "leader"; readonly leader: T; readonly runnerUp: T; readonly gap: number };

/**
 * The shared skeleton both resolvers build on (Decision-driven: "the two
 * metrics differ only in their tie test and in the accuracy resolver's one
 * extra guard" — everything else is identical arithmetic and must stay
 * that way so the two rules cannot drift apart).
 *
 * Filters to candidates whose value is a finite number; fewer than two
 * remaining is `"empty"`. Sorts by value (ascending or descending per
 * `direction`), breaking equal values by the candidate's index in
 * `PUBLISHED_ALGORITHM_IDS` so leader/runner-up selection is deterministic
 * when values coincide. If the leading pair's gap is EXACTLY zero, every
 * candidate whose value strictly equals the leader's is a joint leader
 * (`"tied"`), emitted in `PUBLISHED_ALGORITHM_IDS` order — exact equality
 * merges, merely rounding or sitting inside a threshold does not (that
 * distinction is each metric's own job, applied by the caller). Otherwise
 * returns the leading pair and their gap for the caller's own tie test.
 */
function resolveLeaderPair<T extends { readonly algorithmId: PublishedAlgorithmId; readonly value: number | null }>(
  candidates: readonly T[],
  direction: "ascending" | "descending",
): LeaderPairResolution<T & { readonly value: number }> {
  const finite = candidates.filter((c): c is T & { readonly value: number } => c.value !== null && Number.isFinite(c.value));
  if (finite.length < 2) return { kind: "empty" };

  const sign = direction === "ascending" ? 1 : -1;
  const sorted = [...finite].sort((a, b) => {
    const diff = sign * (a.value - b.value);
    if (diff !== 0) return diff;
    return algorithmOrderIndex(a.algorithmId) - algorithmOrderIndex(b.algorithmId);
  });

  const leader = sorted[0]!;
  const runnerUp = sorted[1]!;
  const gap = Math.abs(runnerUp.value - leader.value);

  if (gap === 0) {
    const tied = finite.filter((c) => c.value === leader.value).map((c) => c.algorithmId);
    return { kind: "tied", ids: sortByPublishedOrder(tied) };
  }

  return { kind: "leader", leader, runnerUp, gap };
}

/**
 * Lower is better. The tie test is STRING EQUALITY of the two leading values
 * passed through `formatBrierDisplay` — never a re-rounded number, never a
 * hand-written epsilon.
 */
export function resolveBrierLeaders(candidates: readonly BrierCandidate[]): readonly PublishedAlgorithmId[] {
  const resolution = resolveLeaderPair(candidates, "ascending");
  if (resolution.kind === "empty") return [];
  if (resolution.kind === "tied") return resolution.ids;
  const { leader, runnerUp } = resolution;
  if (formatBrierDisplay(leader.value) === formatBrierDisplay(runnerUp.value)) return [];
  return [leader.algorithmId];
}

/**
 * Higher is better. Before the tie test: if either leading cell's
 * `scoredCount` is zero, return empty — a count of zero is a fact about the
 * slice worth naming in its own branch rather than leaving to the
 * non-finite guard alone. Otherwise combines each leading cell's OWN
 * standard error (built from that cell's own `scoredCount`, never a row- or
 * artifact-level count) and calls `isNearTie`.
 */
export function resolveWinnerAccuracyLeaders(candidates: readonly WinnerAccuracyCandidate[]): readonly PublishedAlgorithmId[] {
  const resolution = resolveLeaderPair(candidates, "descending");
  if (resolution.kind === "empty") return [];
  if (resolution.kind === "tied") return resolution.ids;
  const { leader, runnerUp, gap } = resolution;
  if (leader.scoredCount === 0 || runnerUp.scoredCount === 0) return [];
  const combined = combineStandardErrors(
    naiveStandardError(leader.value, leader.scoredCount),
    naiveStandardError(runnerUp.value, runnerUp.scoredCount),
  );
  if (isNearTie(gap, combined)) return [];
  return [leader.algorithmId];
}
