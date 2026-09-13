---
phase: quick-260913-q1l
plan: 01
subsystem: docs/schema-comments
tags: [documentation, pageArtifacts, sketch-skill, todo-cleanup]
dependency-graph:
  requires: []
  provides: [corrected-uncertainty-doc-claims]
  affects: [packages/harness/pageArtifacts.ts, packages/core/algorithms/types.ts, sketch-findings-sigmascout skill]
tech-stack:
  added: []
  patterns: [private-index-plus-compare-and-swap-commit-protocol]
key-files:
  created: []
  modified:
    - packages/harness/pageArtifacts.ts
    - packages/core/algorithms/types.ts
    - .claude/skills/sketch-findings-sigmascout/references/uncertainty-display.md
    - .claude/skills/sketch-findings-sigmascout/SKILL.md
    - .planning/todos/completed/pageartifacts-header-claims-an-additivity-identity-its-own-test-denies.md
decisions: []
metrics:
  duration: "~25 min execution"
  completed: 2026-09-13
actuals:
  tasks: 2
  commits: 2
status: complete
---

# Quick Task 260913-q1l: Resolve the pageArtifacts additivity-identity todo, confirm the data/ sweep todo closed

Withdrew the false claim that `redScoreVarianceOwn` equals the sum of its teams' `TeamMetric.spread`
squares "by construction", enforced by a test. It lived at six sites, not the four the todo listed.
The replacement text describes the three structurally different uncertainty quantities SPR actually
builds, and closes the originating todo. Comment and doc text only: no non-comment token of either
`.ts` file changed, and no test was added (the owner asked for a comment-only fix).

The todo's own proposed wording could not be used as written: it said the break "is pinned as an
inequality by `sigma1.test.ts`", but Sigma1 and its tests were deleted by 260913-it4. No test now
pins either the identity or its absence, and the new text says so rather than naming a test.

## Commits

1. **`06c65a40`** `docs(260913-q1l): withdraw the spread/own-variance identity from comments and the sketch skill`
   (SKILL.md 6/5, uncertainty-display.md 19/7, types.ts 28/21, pageArtifacts.ts 42/28)
2. **`ded58569`** `docs(260913-q1l): close the pageArtifacts additivity-identity todo`
   (todo renamed pending to completed, 50 lines appended, original body unchanged)

Both were built in a private `GIT_INDEX_FILE` seeded from HEAD and landed with a compare-and-swap
`git update-ref`, because other sessions were committing into the same checkout. The before/after
`git status` comparison lost no foreign entry. All four Task 1 paths had no foreign hunks at commit
time, so each took the working-tree blob branch.

## Six sites corrected

1. `packages/harness/pageArtifacts.ts` file header. "Two rules … enforced by" became one enforced rule
   (D-21 raw numbers only, which the test really does enforce), plus an account of SPR's three
   quantities (`spread`, `redScoreVarianceOwn`, Match Band) and the statement that no test relates them.
2. `pageArtifacts.ts`, `EventMatchSchema.redScoreVarianceOwn` doc. The identity claim is gone. It also
   used to say the Alliances tab and Elims band are "the same number" via this field; no page reads it,
   and the bands are built from Sigma Score.
3. `pageArtifacts.ts`, `TeamSeasonMatchSchema.redScoreVarianceOwn` doc. Identity claim replaced; names
   SPR (not Sigma1) as the populating algorithm. The adjacent `TeamMetricSchema` doc was also corrected:
   for SPR `spread` is the rating estimate's sd alone, not full predictive variance.
4. `.claude/skills/sketch-findings-sigmascout/references/uncertainty-display.md`. Heading is now "Never
   draw a partial variance". A dated current-state paragraph was added, the Phase 7 rule is marked
   withdrawn and kept as history, and the "consistent by construction, not by discipline" paragraph was
   replaced. The sketch-003 partial-variance lesson is unchanged.
5. `packages/core/algorithms/types.ts`, `Prediction.redScoreVarianceOwn` doc (not in the todo's list).
   It cited the deleted `sigma1.test.ts` as the enforcer; now gives SPR's
   `(pv + obsSd²) × displaySdFactor(mu)² × unit²` and the three structural reasons it differs from
   summed spread squares. The `TeamMetric` doc's "every ± on the site is this same quantity" was also
   corrected.
6. `.claude/skills/sketch-findings-sigmascout/SKILL.md` (not in the todo's list; the part of the skill
   that loads first). The "One ± quantity, everywhere" paragraph and its findings-index row were replaced.

The three structural reasons SPR's alliance own-variance is not the summed spread squares: each team's
posterior is weighted by the square of its rank weight, an `obsSd²` observation-noise term is added,
and `displaySdFactor` rescales the result by alliance strength. No magnitude was quoted (the only
figures on record were measured on retired `vpr@11.0.0` and `bpr@1.0.0`).

## Todo 2: algorithm-identity-sweep-reads-all-of-data (already closed, no change)

- `packages/harness/algorithmIdentity.test.ts` is untracked and absent, deleted by `207bf86d`
  (260913-nvn). The todo already sits in `completed/` with its CLOSED 2026-09-13 block.
- Neither commit here touched that todo file (`git show --stat ded58569` lists only the q1l todo).
- The only test files that walk directories are `packages/core/isomorphic.test.ts` (rooted at
  `CORE_DIR`) and `apps/web/src/components/compare/comparePalette.test.ts` (rooted at `HERE`). Neither
  reaches `data/`, so no remaining test can be turned red by a large file under `data/`.

## Verification

- Comment-only proof: parser-based strip-comments comparison of HEAD vs staged blobs,
  `parse-errors base=0 new=0 code-equal=true` for both `.ts` files; comment-prefix gate printed nothing.
- Negative greps (false claims) 0 in all files; positive greps 5 / 3 / 5 as planned. Orchestrator
  re-checked: `by construction` appears in none of the four edited files, and `types.ts` no longer
  cites `sigma1.test.ts`.
- `npx vitest run packages/harness/pageArtifacts.test.ts packages/core/algorithms/spr.test.ts`:
  2 files, 201 tests passed (matches the planning-time count).
- `npx tsc --noEmit`: one error, `packages/harness/publish.ts(1346,29) Cannot find name 'TeamRankScope'`.
  It belongs to another session's uncommitted `publish.ts`/`teamRanks.ts` refactor; neither commit here
  touches those files.

## Noticed, not fixed (out of scope)

- `uncertainty-display.md`'s "Data dependency (not yet satisfied)" section still describes Sigma1 and a
  todo that shipped in Phase 7.
- `references/simulation-and-compare.md:117` still says RP distributions are VPR-only.
- `types.ts`'s `Prediction.variance` doc ("for Sigma1 it still coincides") and `redComponents` doc
  ("EPA, Sigma1") still name the deleted algorithm.

## Deviations from Plan

None in what was built or committed. One plan-verify wording quirk: the `todo2-untouched` check walks
history (`git log -1 -- <path>`) and so can never print the literal `[]` the plan expected; its top hit
was `207bf86d`, not `ded58569`, which is the intended proof that this task did not touch that file.
