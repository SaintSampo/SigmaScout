/**
 * Whole-alliance-DQ zero-score exclusion. TBA records a fully-disqualified
 * alliance's score as 0 — a ranking ruling, not three robots scoring zero —
 * and every algorithm here fitted that 0 as a real observation before this
 * fix. `isFullyDqZeroScoreAlliance` targets only that case: a PARTIAL DQ
 * (some but not all rating-eligible teams disqualified) still averages a
 * real score, and `opr.ts`'s original per-team attribution stays correct
 * and unchanged for it.
 *
 * `isAdjustZeroedAlliance` is a SEPARATE predicate, not a widened version of
 * the first, because scorekeepers encode a card-driven zero-out two ways:
 * some file DQs, some enter a negative `adjustPoints` large enough to zero
 * the alliance total with no DQ flags at all. It reads the PARSED
 * breakdown's `adjust` only, never the fallback-imputed vector, to avoid
 * circularity (an imputed value is derived from the alliance's own score).
 *
 * Both predicates fire on only the DQ'd/zeroed alliance's own observation
 * (feeding it `[]` rating-eligible teams); the opponent's real observation
 * is untouched. Both compose with `isFullyDemoAlliance` by evaluating over
 * their own team identity; a mixed real+demo alliance is deliberately NOT
 * caught here — an unmeasured population outside what the originating todo
 * measured. Full corpus counts and match keys:
 * `.planning/todos/pending/exclude-whole-alliance-dq-zero-scores.md`.
 */

/**
 * True only when every rating-eligible team on an alliance is disqualified
 * AND the alliance's recorded score is exactly 0. `teams` must be the
 * caller's own post-surrogate-filter, post-demo-remap
 * `ratingEligibleTeams(...)` output. An empty `teams` array returns `false`
 * (already a no-op through every call site's empty-teams path). A non-zero
 * score returns `false` — it may describe real play before an unrelated
 * ruling.
 */
export function isFullyDqZeroScoreAlliance(
  teams: readonly string[],
  dqs: readonly string[],
  allianceScore: number
): boolean {
  if (teams.length === 0) return false;
  if (allianceScore !== 0) return false;
  const dqSet = new Set(dqs);
  return teams.every((team) => dqSet.has(team));
}

/**
 * True only when `teams` is non-empty, `allianceScore` is exactly 0, and
 * `parsedAdjustPoints` — from the caller's PARSED breakdown vector, never
 * the fallback-imputed one — is strictly negative. `undefined` (no parsed
 * breakdown) returns `false`: adjust is unknown, not negative, so this has
 * nothing to fire on. A non-zero `allianceScore` also returns `false`, the
 * same ruling-zero-not-robot-zero scope `isFullyDqZeroScoreAlliance` shares.
 */
export function isAdjustZeroedAlliance(
  teams: readonly string[],
  allianceScore: number,
  parsedAdjustPoints: number | undefined
): boolean {
  if (teams.length === 0) return false;
  if (allianceScore !== 0) return false;
  if (typeof parsedAdjustPoints !== "number") return false;
  return parsedAdjustPoints < 0;
}
