---
phase: quick-260911-w7k
plan: 01
subsystem: rankingPoints
tags: [rp-layer, analytic-pmf, marginal-family, characterization-oracle, structural]
status: complete

requires:
  - packages/core/rankingPoints/marginals.ts (FittedMarginal.declared — the D-02 per-variable declaration site)
  - packages/core/rankingPoints/constants.ts (MarginalFamily, one-member union)
provides:
  - a clause-level marginal family DERIVED from its terms' declarations, reaching every predicate shape
  - packages/core/rankingPoints/analyticPmfGolden.json (behaviour oracle for allianceBonusRpPmf)
affects:
  - docs/models/rp-attribution.md
  - docs/models/rp-layer-config-arms.md

tech-stack:
  added: []
  patterns:
    - characterization oracle captured from code at HEAD before the change (house pattern from predictThresholdsGolden.test.ts)
    - non-vacuity and non-saturation asserted automatically rather than proven once by hand
    - derivation reads the per-variable declaration; refusal replaces silent fallback

key-files:
  created:
    - packages/core/rankingPoints/analyticPmfGolden.json
    - packages/core/rankingPoints/analyticPmfGolden.test.ts
  modified:
    - packages/core/rankingPoints/analyticPmf.ts
    - packages/core/rankingPoints/analyticPmf.test.ts
    - packages/core/rankingPoints/analyticPmfFixtures.ts
    - packages/core/rankingPoints/constants.ts
    - docs/models/rp-attribution.md
    - docs/models/rp-layer-config-arms.md

decisions:
  - A single UNSCALED term reuses the variable's own FittedMarginal verbatim rather than refitting its moments — identity, not a closure property, and it preserves resolved/fallbackReason.
  - A multi-term (or scaled single-term) clause DERIVES its family from its terms' declarations and refuses loudly in the two cases with no exact closed form, rather than falling back to a literal.
  - The two refusals are reached in test through an explicit, commented `as` cast, because a one-member union makes them unreachable from real data — an untested throw was judged worse than a documented cast.

metrics:
  duration: ~35 min
  completed: 2026-09-11
  tasks: 3
  commits: 3

actuals:
  tokens: 32559
  tasks: 3
  commits: 3
---

# Quick Task 260911-w7k: Fix clauseProbability's Hardcoded Gaussian Summary

`clauseProbability` now derives a clause's marginal family from its contributing terms'
declarations instead of naming `"gaussian"` as a string literal, reuses a single unscaled term's own
fit verbatim, and refuses loudly where no exact closed form exists — moving no published number,
proven by a golden oracle captured before the change.

## What changed

Three commits, in order:

| # | Commit | What |
|---|--------|------|
| 1 | `84323b3e` | The behaviour oracle — `analyticPmfGolden.json` + its replay test + the grid builder. `analyticPmf.ts` untouched. |
| 2 | `c33b7582` | `familyForClauseSum` (non-exported) + the `clauseProbability` rewrite + four tests. |
| 3 | `430b5120` | Three documentation sites past-tensed with dated superseded notes. |

## NO PUBLISHED NUMBER CHANGED — and here is the evidence

This is the load-bearing claim of the whole task, so it is stated with its evidence rather than
asserted.

- `packages/core/rankingPoints/analyticPmfGolden.json` was captured from `analyticPmf.ts`
  **unmodified at commit `a29970c6c0bee9027d8260f677165ad81b2bf223`** — verified at capture time by
  `git diff --name-only HEAD -- packages/core/rankingPoints/analyticPmf.ts` returning empty, and
  again after commit 1 by `git show --name-only 84323b3e` not listing that file.
- It pins **30 cells** (10 registered seasons x 3 event types) x **8 moment patterns** = **240 rows**.
  Each row pins every entry of `bonusProbabilities`, every entry of `pmf`, and all three
  `MarginalResolutionTally` counts.
- Comparison is **exact `toBe` on every number, with no tolerance anywhere**. 293 assertions.
- After the Task 2 rewrite the golden was **green with zero edits to the JSON**, confirmed both by
  the suite and by `git diff --name-only -- packages/core/rankingPoints/analyticPmfGolden.json`
  returning empty.

**The golden never went red at any point during this task.** There was no red-then-investigate
episode and no regeneration. `analyticPmfGolden.json` appears in commit 1 and in no later commit.

Why the inertness is expected rather than lucky: every `marginalFamily` declaration in the tree is
`"gaussian"`, and the Gaussian family is closed under scaled addition, so the derived value is
*identical to the literal it replaced*. For the single-term reuse path the argument is different and
stronger — refitting a `FittedMarginal`'s own `(mean, variance)` reproduces its `resolved`, `mean`
and `sd` on all three of `fitMarginal`'s ladder rungs, which is asserted directly as a
mechanism-level test rather than inferred from the golden.

### The oracle is proven non-vacuous automatically

A characterization test never observed to respond to its inputs is evidence of nothing. Two
automated assertions, per registered season, run on every CI pass:

- **Non-vacuity:** a `1.01x` mean perturbation must move at least one bonus probability in a
  numeric-ladder row. All ten seasons move (3 to 17 entries each).
- **Non-saturation:** at least one bonus probability must lie strictly inside `(0.001, 0.999)`, so
  the grid is not a wall of saturated 0/1s blind to a change in a Gaussian fit. All ten seasons
  qualify (3 to 21 entries each).

Because all ten seasons pass, **no `STRUCTURALLY_SATURATED` exception list exists** — the escape
hatch was deliberately not pre-built. The bound was not relaxed.

## The two design decisions

### 1. A single unscaled term REUSES the variable's own fit, rather than refitting it

When `clause.terms.length === 1` and `(divisor ?? 1) === 1`, the clause's random variable **is** that
variable's. Correctness therefore rests on *identity*, not on any closure property of a distribution
family, so no family derivation applies at all and none is performed.

What reuse preserves that a refit destroyed: the variable's own `resolved` and `fallbackReason`
survive into the comparison instead of being re-derived from its moments. The structural payoff is
the point — `singleThreshold`, the most common predicate shape in the registry, would now honour a
**future** declared family for free, *including one not closed under scaled addition*, which a refit
of combined moments could never have done.

A single term carrying a `divisor` deliberately does **not** take this path: `X / c` is not `X`, so
closure under scaling is load-bearing there and identity is unavailable. (2023's
`sustainabilityBonus` is exactly that shape.)

### 2. The multi-term path derives its family, and refuses two ways

`familyForClauseSum(marginals, clause, season, bonusName)` collects
`new Set(marginals.map((m) => m.declared))` — reading the D-02 per-variable declaration site, not a
global switch — and:

- **size !== 1 -> throws**, naming the season, the bonus, how many distinct families were found, the
  families themselves, the clause's variables in declared order, and the violated precondition (a sum
  of scaled terms drawn from different families has no exact closed form). Worded by *count* rather
  than "more than one", so it reads correctly for a zero-term clause too.
- **`case "gaussian"` -> returns**, with a comment stating *why this is the arm that returns*: a sum of
  independently-scaled Gaussians is exactly Gaussian, and that closure is precisely what made the
  previous hardcode numerically correct rather than merely convenient.
- **`default:` -> assigns to a `const ...: never` and throws**, naming the season, the bonus, the
  family and the precondition (not closed under scaled addition). The `never` means a second union
  member **fails to compile here before it can fail at runtime on real data** — whoever adds it gets
  a type error demanding they decide the closure question, rather than discovering the answer from a
  wrong published probability.

Neither arm ever falls back silently. That matches the module's house style —
`assertIndependencePrecondition`, `assertPairwiseDisjoint`, and `groupContribution`'s multi-bonus
throw all name the season, the subject and the precondition.

### Evaluation order was preserved exactly

Same left-to-right sum in declared term order, same `/divisor` and `/(divisor * divisor)`, never a
precomputed multiplier — `RpLinearTerm`'s own doc comment says that is load-bearing because a
threshold comparison is where the float difference becomes observable. The per-term marginal lookups
still happen first, in declared order, so the missing-marginal throw surfaces at the same term and
still surfaces *before* `resolveRpThreshold`. `analyticPmf.ts` now contains exactly **one**
`fitMarginal(` call on a code line and it reads `fitMarginal(mean, variance, family)` — the third
argument is a variable, never a literal.

## Stated as a limitation, not hidden: both guards are unreachable today

`MarginalFamily` is still `"gaussian"` and nothing else. Under a one-member union **both new throws
are unreachable from real data**: no season module can declare a second family, and a set drawn from
a one-member union cannot have size != 1 for a non-empty clause.

Each guard is therefore reached in test only through an **explicit `as unknown as MarginalFamily`
cast**, with a comment directly above it saying so: that the branch is unreachable from real data,
that the cast is the only way to reach it, that it is written this way deliberately rather than
leaving the guard untested, and that a second family would make the branch reachable with no cast at
all. No coverage is faked; no guard is left untested. This is scaffolding for a one-member union, not
a fixture shape worth keeping.

Both tests were **observed RED before the implementation landed** — failing with "expected a throw,
got none", which is exactly the old hardcode silently discarding the declarations.

## The tally counts are unchanged, and this was confirmed by grep

`grep -rn "accumulateMarginalResolution" --include=*.ts .` returns exactly **two** hits: the function
definition (`analyticPmf.ts:129`) and its single call site inside
`for (const marginal of marginalsByName.values())` in `allianceBonusRpPmf`. `clauseProbability`'s
combined fit has therefore **never** been tallied, and this change neither adds nor removes a tally
call. This was checked rather than assumed, as the plan required.

The golden pins all three counts per row, so the claim is *tested*, not merely stated — and the
golden test's own comment records that this is what those three assertions are for.

## The honest scope of the win

**Nothing was measured. Nothing improved. Nothing regressed.**

24 of 30 season/bonus cells become *capable* of responding to a future marginal family, where
previously only the 6 cells covered by `nestedSameVariable` could respond to one at all. That is the
entire value: reach, not accuracy. The refused negative-binomial result is not one bit less refused,
and a future attempt would still need a fresh reporting slice.

No accuracy measurement, no retune, no publish, no R2 write, no D1 write, no corpus read, no BPR/SPR
contact, and no sealed holdout spend occurred.

## Golden grid: no pattern substitutions

The builder deliberately does not catch. **No (season, tier, pattern) triple threw**, so no pattern
was substituted out of the grid and the golden's `note` field records no substitution. All eight
patterns — `scale-3`, `scale-10`, `scale-30`, `scale-100`, `scale-300`, `asym-30`, `zero-variance`,
`non-finite` — are present for all 30 cells.

`GOLDEN_SCALES` stayed at five values: the generated file is 84,001 bytes, well under the plan's
200 KB threshold for reducing it.

## Noticed and left (follow-up)

- **`ruleModuleWithDeclaredFamily` in `analyticPmf.test.ts` (~line 54) is dead code.** Nothing calls
  it, and its doc comment describes `resolveDeclaredFamily` — a mechanism deleted in `2731bfab`. The
  plan explicitly scoped its removal out as unrelated, so it was left in place. A future cleanup
  should delete the function and its comment together; note that `resolveDeclaredFamily` also appears
  in the same file's dead-symbol list, which is a *live* pin and must stay.

## Deviations from Plan

None affecting the plan's substance. Two environmental notes:

**1. HEAD moved mid-task (another session).** Between the precondition check and the golden's
capture, a concurrent session committed `5454999e` and `a29970c6`, moving HEAD from `c405693f`. Those
commits touched `.planning/STATE.md`, `docs/`, and `scripts/` only —
`git diff --name-only c405693f..HEAD -- packages/core/rankingPoints/` returned **empty**, so
`analyticPmf.ts` was byte-identical at the new HEAD and the oracle's `generatedFromCommit`
(`a29970c6`) is accurate. The precondition ("`analyticPmf.ts` unmodified at HEAD") held throughout.

**2. A transient root `tsc` error from that session's uncommitted work.** During Task 3's
verification, `npx tsc --noEmit` reported one error in `scripts/measureRandomSchedules.ts`
(`Property 'sweep' is missing in type ... EventResult`). Triaged rather than dismissed, and rather
than fixed: `readonly sweep: SweepPoint[]` proved to be an **added line in that session's
uncommitted diff**, the file is theirs and outside this task's scope, and the error is self-contained
within it (interface and object literal both local). They completed the edit within the same minute
and root `tsc` returned to **0 errors**. Both typechecks are clean as committed. The foreign file was
never staged or modified here.

## Working-tree isolation

A concurrent session had uncommitted work throughout (`packages/harness/preSchedule.ts`,
`scripts/measureRandomSchedules.ts`, and four untracked files). Every commit was staged by
**explicit path**; `git add .` / `-A` / `commit -a` were never used. Per-commit checks confirmed zero
deletions (`git diff --diff-filter=D` empty across all three commits) and that each commit contains
exactly its intended files.

One note on the hazard guard: `scripts/measureFieldAveragedRanks.ts` left the
modified-and-unstaged list mid-task. This was **not** absorption — the other session committed it
themselves in `5454999e` (`git log -1 -- scripts/measureFieldAveragedRanks.ts` confirms), and none of
`84323b3e` / `c33b7582` / `430b5120` lists it.

## Verification

| Check | Result |
|-------|--------|
| `npx vitest run` (repo root, unfiltered) | **262 files, 5364 passed, 4 skipped, 0 failed** |
| `npx vitest run packages/core/rankingPoints` | 10 files, **697 passed** (693 before + 4 new) |
| `analyticPmfGolden.test.ts` | **293 passed**, exact equality, zero JSON edits |
| `npx tsc --noEmit` (root) | **0 errors** |
| `npx tsc --noEmit -p apps/web/tsconfig.json` | **0 errors** (run per project memory; root does not cover `apps/web`) |
| `analyticPmf.ts` pinned export set | green, **no edit** — `familyForClauseSum` is not exported |
| `analyticPmf.ts` dead-symbol scan | green, **no edit** |
| `MarginalFamily` | still `export type MarginalFamily = "gaussian";` |
| `fitMarginal(` on code lines | exactly 1, reading `fitMarginal(mean, variance, family)` |

All test runs were judged by printed output, from the repo root, never wrapped in `timeout` and
never via `timeout <n> pnpm <cmd>` — per project memory on both the test-scope trap and the
false-green trap.

## Self-Check: PASSED

All 8 claimed files exist on disk; all 3 claimed commits (`84323b3e`, `c33b7582`, `430b5120`) are
present in `git log`. `familyForClauseSum` is present and not exported. `MarginalFamily` is
unchanged at `constants.ts:84`.
