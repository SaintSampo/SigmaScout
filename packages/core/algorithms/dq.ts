/**
 * Whole-alliance-DQ zero-score exclusion
 * (`.planning/todos/pending/exclude-whole-alliance-dq-zero-scores.md`,
 * developer-directed 2026-08-30, generalizing a bug report against VPR).
 * When TBA disqualifies an ENTIRE alliance, it records that alliance's score
 * as **0** — a ranking-and-record ruling, not a statement that three real
 * robots collectively produced zero points. No algorithm in this repo could
 * see the disqualification before this fix (`MatchResult` carried no DQ
 * field at all, by design — see `opr.ts`'s "Disqualification policy"
 * comment for the fuller, now-corrected history), so every algorithm fitted
 * that 0 as a genuine observation. Measured against a live published
 * artifact: `frc4788`'s 2026 `total` was -1354.13 — a single whole-alliance
 * DQ, in thirty matches, was enough to make one team's rating physically
 * meaningless (see the todo's "smoking gun" section).
 *
 * This module exports exactly ONE predicate, deliberately narrower than "any
 * DQ" — measured against `data/corpus.sqlite` (demo teams excluded), a
 * PARTIAL DQ (some but not all rating-eligible teams on an alliance
 * disqualified) averages 68.4 points with essentially no zeros: those look
 * like genuinely bad-but-real matches, and the original `opr.ts` reasoning
 * ("a disqualified team physically played the match and physically
 * contributed to the alliance's score... removing a disqualified team's
 * column would misattribute its real contribution to its teammates") is
 * correct for that case and stays UNCHANGED — `isFullyDqZeroScoreAlliance`
 * returns `false` for it, by construction, since not every rating-eligible
 * team is in the DQ set. A WHOLE-alliance DQ, by contrast, averages 0.8 and
 * is 99% exact zeros: there is no real contribution left to misattribute,
 * only a 0 that describes a ruling. This predicate isolates exactly that
 * second population.
 *
 * Same shape as `demoTeams.ts`'s `isFullyDemoAlliance` (same todo's stated
 * precedent to mirror), but a DELIBERATELY DIFFERENT SCOPE of what gets
 * dropped when it fires. `isFullyDemoAlliance` drops the WHOLE MATCH (both
 * alliances) when either alliance is fully placeholder robots, because a
 * real alliance "beating" three fictional ones carries no information about
 * the real alliance either. A whole-alliance DQ has no such symmetry: the
 * DISQUALIFIED alliance's three robots were real and physically on the
 * field — only THAT alliance's own 0 is meaningless, not the opponent's
 * genuinely observed score. Every call site therefore drops only the
 * DQ'd-and-zeroed alliance's OWN observation (feeding it `[]`
 * rating-eligible teams, the same no-op input every algorithm already
 * handles for an all-surrogate alliance), leaving the opposing alliance's
 * real observation, and the match's contribution to any two-sided
 * bookkeeping the opponent's own fold still needs, untouched.
 *
 * Composition with `isFullyDemoAlliance` (the todo's own open question):
 * decided to keep both predicates evaluated over their OWN team identity —
 * `isFullyDemoAlliance` first, against the RAW (pre-remap) team lists, as
 * it already was; `isFullyDqZeroScoreAlliance` second, against each
 * algorithm's already-remapped/surrogate-filtered `ratingEligibleTeams(...)`
 * result, compared against the RAW `red_dqs`/`blue_dqs` key lists. A
 * genuinely mixed alliance (one real DQ'd team beside two demo teammates,
 * score 0) is NOT caught by this predicate: `ratingEligibleTeams` remaps
 * the two demo slots to the single shared `DEMO_PSEUDO_TEAM_KEY`, which
 * never appears in a real `dq_team_keys` list, so `.every(...)` on
 * `[realTeam, DEMO_PSEUDO_TEAM_KEY, DEMO_PSEUDO_TEAM_KEY]` against a DQ set
 * containing only `realTeam` is false — the observation is left exactly as
 * `demoTeams.ts` already treats a mixed real+demo alliance (the real team's
 * column keeps its normal update). This is a DELIBERATE, conservative
 * choice, not an oversight: the measured population this predicate exists
 * to fix is explicitly the "whole REAL alliance DQ'd" row of the todo's own
 * table (158 alliance-observations, demo teams already excluded from that
 * count) — a mixed demo+DQ alliance is a different, unmeasured population
 * this fix does not claim to address, and silently widening the predicate
 * to catch it (e.g. by checking only the non-pseudo teams) would drop an
 * observation this todo never measured the blast radius of.
 */

/**
 * True only when EVERY rating-eligible team on an alliance is disqualified
 * AND the alliance's recorded score is exactly 0. `teams` is expected to be
 * the caller's own `ratingEligibleTeams(...)` output (post surrogate-filter,
 * post demo-remap) so this predicate composes correctly with both existing
 * seams — see this file's header for the full composition contract.
 *
 * An empty `teams` array returns `false` (vacuous truth deliberately
 * avoided, mirroring `isFullyDemoAlliance`): an alliance with no
 * rating-eligible teams at all (e.g. every slot was a surrogate) is already
 * a no-op through the existing empty-teams path at every call site, and has
 * nothing left for this predicate to have an opinion about.
 *
 * A non-zero score for a whole-alliance DQ (2 of 158 observed in the
 * measured corpus) deliberately returns `false` here — that score may
 * describe real play the alliance completed before being disqualified for
 * an unrelated ruling, and this predicate only ever targets the "0 that
 * describes a ruling, not a robot" case the todo names.
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
