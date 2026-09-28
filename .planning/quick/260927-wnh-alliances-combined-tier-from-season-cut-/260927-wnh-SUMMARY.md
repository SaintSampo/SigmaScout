---
phase: quick-260927-wnh
plan: "01"
subsystem: web-event-alliances
tags: [alliances-tab, tier-cuts, live-fold, rarity-tier]
dependency-graph:
  requires: [packages/harness/tierCuts.ts, quick/260927-uen (season-cut precedent)]
  provides: [estimateCombinedTier(combinedValue, tierCuts) -> Tier | undefined]
  affects: [apps/web/src/components/event/AlliancesTab.tsx]
tech-stack:
  added: []
  patterns: [tierFromCuts as the single cut-rule evaluator, shared by tiers.ts and allianceTierApproximation.ts]
key-files:
  created: []
  modified:
    - apps/web/src/lib/allianceTierApproximation.ts
    - apps/web/src/lib/allianceTierApproximation.test.ts
    - apps/web/src/components/event/AlliancesTab.tsx
    - apps/web/src/components/event/AlliancesTab.test.tsx
    - packages/harness/tierCuts.ts
    - .planning/todos/completed/live-merges-drop-percentiles.md
decisions:
  - "estimateCombinedTier classifies combinedValue/3 against the artifact's tierCuts Total entry via tierFromCuts, replacing the event-roster percentile interpolation and its clamp"
  - "No fallback when tierCuts or its Total entry is absent — the artifact that lacks cuts (Worker bootstrap write) also lacks published percentiles, so a second method would make the disclosure sentence false for one of them"
metrics:
  duration: "~35 minutes"
  completed: "2026-09-27"
status: complete
actuals:
  tokens: 21000
  tasks: 3
  commits: 3
---

# Quick Task 260927-wnh: Alliances Combined Total tier from the season cut points Summary

Replaced the Alliances tab's Combined Total tier estimate — previously a monotone interpolation
over the event roster's own published `(total.value, total.percentile)` pairs, which thinned as
live folds stripped percentiles and clamped at the event's own value range — with a direct
classification of the combined total's per-team equivalent against the season `tierCuts` Total
entry, exactly as team-page tiles were switched to cuts in 260927-uen.

## What changed

**`apps/web/src/lib/allianceTierApproximation.ts`** is now a single function:
`estimateCombinedTier(combinedValue, tierCuts)`. The divide-by-3 step happens inside this
function, exactly where it lived before (`combinedValue / 3`), and the caller still passes the
raw combined value — that split did not move. The body is one line:
`tierFromCuts(tierCuts?.[TOTAL_KEY], combinedValue / 3)`. Deleted: `buildTeamValuePercentilePoints`,
the `TierApproximationPoint` interface, the `AllianceApproxTier` interface (its interpolated
`percentile` field was rendered nowhere), and the interpolation loop with its two clamp branches.

**No-fallback call and reason:** `tierFromCuts` returns `undefined` when either its cuts entry or
its value argument is `undefined` — never a guess. There is deliberately no second method behind
that `undefined`: the artifact that ships with no `tierCuts` in production is the Worker's
bootstrap write, which holds no season pool at all, and that same artifact also carries no
published percentiles. A fallback interpolation would therefore only ever have data to fall back
to when cuts were also present — making it dead code — or it would apply exactly when the
disclosure text's "comparing that to the season's single-team totals" claim is false for the
method actually used. Absent cuts render the Combined Total plainly, no tier box, no disclosure
group.

**Disclosure string.** Only the ending changed:
- Old: `"Approximate tier: no percentile is published for a 3-team sum, so this is estimated by dividing the combined total by 3 and comparing that to this event's own single-team totals."`
- New: `"Approximate tier: no percentile is published for a 3-team sum, so this is estimated by dividing the combined total by 3 and comparing that to the season's single-team totals."`

**`AlliancesTab.tsx`:** `buildAllianceRows` now passes `artifact.tierCuts` straight through
(`estimateCombinedTier(combined.value, artifact.tierCuts)`), and the `tierPoints` local plus its
four-line "against the FULL event roster" comment are gone — the cuts do not depend on the
roster at all. `AllianceRow.combinedApproxTier` and `CombinedCell`'s `approx` prop are now
`Tier | undefined` instead of `AllianceApproxTier | undefined`; `TotalSigmaValue` takes
`totalTier={approx}` directly. The orphaned `buildAllianceRows` doc comment (which sat above
`combinedSigmaBand`'s doc comment, attached to nothing) was moved onto `buildAllianceRows` itself
and rewritten for the cut rule; `CombinedCell`'s doc comment was updated the same way.

**`packages/harness/tierCuts.ts`:** comment-only change — the header now names both client-side
callers (`apps/web/src/lib/tiers.ts`'s resolver, and `apps/web/src/lib/allianceTierApproximation.ts`)
instead of just the first.

**Why the no-clamp test uses `allianceTeams`, not three ordinary standings picks:** when all
three picks are percentile-carrying standings teams, their average total can never exceed the
event's own standings range — it's the average of numbers already inside that range. The old
clamp only ever bound in two situations: a pick resolved through `artifact.allianceTeams` (a
playoff pick who never took the field, so was never part of the event's own percentile pool), or
a roster whose strongest teams had already been live folded out of the percentile pool. The
live-folded-roster tracer case in Task 1 covers the second; Task 2's no-clamp case covers the
first directly, building an alliance from two `allianceTeams` picks at value 70 against a
standings roster that tops out at percentile 20 (Common) — the combined cell tiers Legendary
while the one standings pick in that alliance stays Common, proving nothing clamps the estimate
to the event's own range.

**Todo closure.** `.planning/todos/completed/live-merges-drop-percentiles.md`'s CLOSED
blockquote no longer calls the Alliances tier "accepted and out of scope" — it now records that
260927-wnh fixed it, with the mechanism (cuts, not interpolation) named. Only lines inside that
top blockquote changed; everything below it (older history) is untouched.

**Stale-comment sweep:** grepped `thins` across `apps packages docs scripts` (no hits) and
`single-team totals|interpolat` across the Alliances-tab component/test files and the lib module
(only the new disclosure string, its test assertion, and the lib module's own history comment
describing the *replaced* interpolation — none call the current code thinning or interpolated).
No further files needed changes.

## Commits

1. `9e73a4c0` — `feat(quick-260927-wnh): Combined Total tier from the season cut points` —
   `allianceTierApproximation.ts`/`.test.ts`, `AlliancesTab.tsx`/`.test.tsx` (Task 1, tracer)
2. `2b04c9f2` — `test(quick-260927-wnh): no clamp and no cuts cases; comment sweep` —
   `AlliancesTab.tsx`/`.test.tsx`, `packages/harness/tierCuts.ts` (Task 2)
3. `4236fc20` — `docs(quick-260927-wnh): the Alliances Combined Total tier is fixed, not accepted` —
   `.planning/todos/completed/live-merges-drop-percentiles.md` (Task 3)

## Test / typecheck output

- Task 1: `npx vitest run apps/web/src/lib/allianceTierApproximation.test.ts apps/web/src/components/event/AlliancesTab.test.tsx` → **Test Files 2 passed (2), Tests 82 passed (82)**. `npx tsc --noEmit -p apps/web/tsconfig.json` → no output (clean).
- Task 2: `npx vitest run apps/web/src/lib/allianceTierApproximation.test.ts apps/web/src/components/event/AlliancesTab.test.tsx packages/harness/tierCuts.test.ts` → **Test Files 3 passed (3), Tests 105 passed (105)**. Web tsc clean. `tierCuts.ts` diff gate confirmed comment-only.
- Task 3: `npx vitest run` (repo root, full suite) → **Test Files 298 passed (298), Tests 6983 passed | 1 skipped (6984)**. `npx tsc --noEmit` (root) → clean. `npx tsc --noEmit -p apps/web/tsconfig.json` → clean.

## Deviations from Plan

One correction during Task 3: the todo-file edit's first draft wrapped "fixed by" and
"260927-wnh" across a markdown blockquote line break, so the literal substring `"fixed by
260927-wnh"` the verify gate and acceptance criteria require was not contiguous in the file
(`grep -q "fixed by 260927-wnh"` failed). Re-wrapped the paragraph so the phrase sits on one
line; re-ran the gate, which then passed. [Rule 3 — blocking fix, mechanical rewrap, no content change.]

No other deviations. Every task's automated verify block and acceptance criteria passed as
specified.

## Known Stubs

None.

## Self-Check: PASSED

- `apps/web/src/lib/allianceTierApproximation.ts` — FOUND, contains `estimateCombinedTier`, no `buildTeamValuePercentilePoints`/`TierApproximationPoint`/`AllianceApproxTier`.
- `apps/web/src/components/event/AlliancesTab.tsx` — FOUND, `estimateCombinedTier(combined.value, artifact.tierCuts)` present, disclosure ends "the season's single-team totals."
- `.planning/todos/completed/live-merges-drop-percentiles.md` — FOUND, contains "fixed by 260927-wnh", no "Accepted and out of scope" in the CLOSED block.
- Commit `9e73a4c0` — FOUND in `git log --oneline`.
- Commit `2b04c9f2` — FOUND in `git log --oneline`.
- Commit `4236fc20` — FOUND in `git log --oneline`.
