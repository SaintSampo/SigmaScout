---
id: exclude-whole-alliance-dq-zero-scores
created: 2026-08-30
source: developer observation during Phase 7 UAT ("when there is a red card, it really screws up the VPR")
resolves_phase:
priority: high
---

# A fully-disqualified alliance's 0 score is fitted as real robot performance

## The defect

When an ENTIRE alliance is disqualified (red card), TBA records that alliance's score as **0**.
No algorithm in this repo can see the disqualification, so all three fit that 0 as a genuine
observation of three real robots' output — a roughly 106-point negative shock per team against a
corpus mean alliance score of 106.1.

Reported by the developer against VPR, but **it is not VPR-specific**: `opr.ts`, `epa.ts` and
`sigma1/index.ts` are all equally blind. `epa.ts` filters surrogates
(`ratingEligibleTeams(match.redTeams, match.redSurrogates)`) and nothing else. The `MatchResult`
type deliberately carries no DQ field at all.

## Measured against `data/corpus.sqlite` (read-only, 2026-08-30)

Demo teams `frc9970`-`frc9999` excluded from these figures, since they are already out of the model:

| case | alliance-observations | score == 0 | mean score |
|------|----------------------:|-----------:|-----------:|
| **Whole real alliance DQ'd** | **158** | **156 (99%)** | **0.8** |
| Partial DQ (some real teams) | 1,282 | 6 (0%) | 68.4 |
| corpus baseline (all alliances) | — | — | 106.1 |

Overall: 1,532 played matches (1.47% of 104,394) carry at least one DQ; 2,008 DQ team-appearances;
1,134 distinct teams affected, 163 of them with 3 or more.

**The split is the whole finding.** Partial DQs look like genuinely bad matches — a mean of 68.4
with essentially no zeros — and fitting them as real performance is defensible. The whole-alliance
case is a scoring artifact, not a performance observation, and is where the distortion lives.

## Why it is currently this way, and why that reasoning only half-holds

`packages/core/algorithms/opr.ts` documents the decision explicitly (Open Question 3, no locked
decision ever covered it):

> "A disqualification is a ranking-and-record ruling, not a [performance statement] ... so removing
> a disqualified team's column would misattribute its real contribution to its teammates.
> Disqualified teams are therefore deliberately NOT filtered here: `MatchResult` carries no dq
> field at all, by design."

That argument is **correct for a partial DQ** — the robot really did play, its contribution is
really in the score, and removing its column would push its output onto its teammates.

It **does not hold when every rating-eligible team on the alliance is disqualified and the recorded
score is 0.** There is no contribution to misattribute; there is only a 0 that describes a ruling,
not a robot. The existing comment even anticipates revisiting this: "the corpus retains
`red_dqs`/`blue_dqs` regardless, so reversing this call [is possible]."

## Proposed direction (not yet decided)

Drop — or heavily downweight — an alliance observation when EVERY rating-eligible team on it is
disqualified AND the recorded score is 0. Leave partial DQs exactly as they are today.

There is a proven precedent in this codebase with the same shape: `isFullyDemoAlliance` in
`packages/core/algorithms/demoTeams.ts`, added 2026-08-30, drops non-contest matches where an entire
alliance is placeholder teams. This would be the same predicate over `red_dqs`/`blue_dqs` instead of
demo keys, applied at the same seam.

Implementation notes:
- The data already exists end-to-end in the corpus (`matches.red_dqs` / `blue_dqs`, populated by
  `packages/ingest/normalize.ts` from TBA's `dq_team_keys`) and is only dropped when `MatchResult`
  is constructed. `MatchResult` would need to carry the DQ lists, which is the one type change.
- Apply to all three algorithms, not just VPR — they share the defect.
- Guard against the inverse error: do NOT drop a whole-alliance-DQ match whose score is non-zero
  (2 of the 158 observed), since that score may describe real play.

## Cost

Changes every published rating for any team that appeared on a fully-DQ'd alliance, so it needs a
full republish (~24 min, ~57k PUTs).

Sequence it with [[remeasure-accuracy-record-offseason-inclusion]] — that re-measurement is already
outstanding for offseason inclusion and the demo-team exclusion. Folding this in before it runs
means the accuracy record is re-measured once against the final model rather than three times.

## Related

- `packages/core/algorithms/opr.ts` — the recorded DQ reasoning this partially overturns
- `packages/core/algorithms/demoTeams.ts` — `isFullyDemoAlliance`, the precedent to mirror
- [[remeasure-accuracy-record-offseason-inclusion]] — sequence this BEFORE that re-measurement
