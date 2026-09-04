---
phase: quick-260903-krp
plan: "01"
subsystem: scoring-harness
tags: [scoring, compare-artifact, published-contract, rolling-origin]
dependency-graph:
  requires:
    - "quick-260903-4fs (2019/2020 corpus seasons with registered breakdown and RP modules)"
  provides:
    - "isHeadlineEligible / MIN_PRIOR_SEASONS_FOR_HEADLINE — corpus-relative eligibility replacing the fixed tune/holdout split"
    - "aggregateScores(predictions, { corpusSeasons }) — required, closing the self-derivation trap"
    - "CompareSliceSchema.seasonLabel optional — client tolerates 5.0.0 and post-republish shapes"
  affects:
    - ".planning/todos/pending/retune-sigma1-rolling-origin.md (UNBLOCKED — this was the last blocker)"
    - ".planning/todos/pending/rolling-origin-hyperparameter-tuning.md (D-4's 2023 verdict superseded; D-5 partially landed)"
tech-stack:
  added: []
  patterns:
    - "Required-option threading instead of self-derivation, where a caller may legitimately score a narrower slice than the population the flag is relative to"
    - "Optional-not-deleted schema fields for a forward/backward compatible artifact read across a pending republish"
key-files:
  created:
    - apps/web/src/lib/api/compare.compat.test.ts
  modified:
    - packages/harness/score.ts
    - packages/harness/artifact.ts
    - packages/harness/pageArtifacts.ts
    - packages/harness/report.ts
    - packages/harness/tune.ts
    - packages/harness/publish.ts
    - packages/harness/cli.ts
    - packages/harness/promote.ts
    - packages/harness/eventScopeDiagnostic.ts
    - scripts/reparamEquivalence.ts
    - apps/web/src/components/compare/MethodologyNote.tsx
decisions:
  - "corpusSeasons is a REQUIRED option with no default. Self-derivation from predictions would have passed every test while silently marking every publish.ts-produced Compare slice ineligible, because that call site sees exactly one season per loop iteration"
  - "CompareSliceSchema.seasonLabel made OPTIONAL rather than deleted: deleting still parses 5.0.0 bytes but strips the key, while optional tolerates both directions. PAGE_ARTIFACT_SCHEMA_VERSION deliberately not bumped"
  - "D-4's verdict that 2023 is not headline-eligible is SUPERSEDED — not because the rule changed but because the corpus it was evaluated against did. 2023 had one prior (2022); it now has three (2019, 2020, 2022)"
metrics:
  duration: ~25min
  completed: 2026-09-03
status: complete
actuals:
  tasks: 4
  commits: 4
---

# Quick Task 260903-krp: Origin-based headline eligibility — Summary

Replaced `score.ts`'s fixed 2022–2026 tune/holdout split with a corpus-relative eligibility rule.
**This was the last blocker on `retune-sigma1-rolling-origin` and therefore on the whole
promote → republish → re-measure chain**: `seasonSplit` threw for any season outside 2022–2026, and
`aggregateScores` — which calls it — is imported by `tune.ts`, `cli.ts`, `promote.ts`, `publish.ts`
and `eventScopeDiagnostic.ts`. Every scoring path threw on 2019 or 2020.

## The rule

```ts
export function isHeadlineEligible(season: number, corpusSeasons: readonly number[]): boolean {
  const distinctPriors = new Set(corpusSeasons.filter((s) => s < season));
  return distinctPriors.size >= MIN_PRIOR_SEASONS_FOR_HEADLINE; // 2
}
```

`Set` for distinctness so a duplicated prior cannot buy eligibility; strict `<`; and **no year
literal anywhere in the file's non-comment code**, verified by a comment-stripping gate. A
hardcoded set would have been the retired guard wearing a new name.

## The trap the planner caught, which no test could

`publish.ts` calls `aggregateScores` from **inside** its per-season loop (`:1545`), and
`harnessPredictions` is built with that one season written into every record. Line 174 already
computes `seasons` from the predictions, which makes self-derivation look free — but a
self-derived rule would see zero priors for every season, flip **every published Compare slice to
`headlineEligible: false`**, and pass the entire suite green.

`corpusSeasons` is therefore a required option, and `publish.ts:1981` passes `seasonsSorted` — the
run's whole declared range from outside the loop. Verified by eye by the executor and re-verified
independently by the orchestrator.

## D-4 is superseded, and headline seasons go 2 → 5

`rolling-origin-hyperparameter-tuning`'s D-4 ruled 2023 ineligible on a thin one-season prior. That
was correct **against a 2022–2026 corpus**. The backfill changed the inputs, not the rule:

| season | priors in corpus | eligible |
|---|---|---|
| 2019 | none | no |
| 2020 | 2019 only | no |
| 2022 | 2019, 2020 | **yes** |
| 2023 | 2019, 2020, 2022 | **yes** |
| 2024–2026 | … | **yes** |

Five headline seasons where the retired split gave two, and six once 2027 plays. That beats the
"2 → 3 or 4, not 5" ceiling the original todo believed was unavoidable.

Pleasant consequence: D-5's "display only origin seasons" now resolves to 2022–2026, which is
exactly what Compare already displays. The visible season list does not change — only the
labelling and its honesty.

## Compatibility, because nothing has been republished

The live site serves **5.0.0** artifacts that still carry `seasonLabel`, and pushing `main` deploys
(32 commits are unpushed). There is no separate client read schema —
`apps/web/src/lib/api/compare.ts` imports `CompareArtifactSchema` straight from the harness — so the
publish schema *is* the read schema.

`seasonLabel` was therefore made **optional, not deleted**: deleting still parses 5.0.0 bytes but
strips the key, while optional tolerates both directions. `MethodologyNote.tsx` was rewritten to
read neither field. The byte-pinned `compare-*.json` fixtures **never moved** — verified with
`git diff --exit-code` across the whole task, which matters because regenerating them would have
hidden precisely the compatibility break this guards against.

## Verification — re-run by the orchestrator, not accepted on report

- **The manual gate:** read `publish.ts:1981` directly. It passes `seasonsSorted`, not the loop's
  `season`, with a comment stating why.
- **Fixtures:** `git diff --stat 623260bd^..HEAD -- apps/web/src/routes/__fixtures__/` — empty.
- **No year literals:** comment-stripped scan of `score.ts` — none.
- **Retired vocabulary:** `SeasonLabel`, `TUNE_SEASONS`, `HOLDOUT_SEASONS`, `seasonSplit` — all gone.
- **The rule evaluated directly against the real corpus**, not via its tests: produces
  `{2022,2023,2024,2025,2026}` eligible and `{2019,2020}` not. Edge cases checked beyond the suite —
  duplicated priors do not buy eligibility, unsorted input works.
- **`tsc --noEmit` clean at BOTH roots.** The repo-root tsconfig only includes `packages/**` and
  `scripts/**`, so it never reaches `apps/web`; checking there separately is what caught a real
  break (`compare.test.tsx` reading a renamed field).
- **Full suite from the repo root:** 168 files, 2,945 passed, 1 skipped, **0 failed**.

An adversarial review workflow ran four independent lenses over the diff — rule correctness, the
eight call sites, published-contract compatibility, and test false-greens — each finding then put
to a skeptic instructed to refute it.

## Deviations from plan

Two, both Rule 1 auto-fixes for compile breaks this task's own type changes caused:

1. `apps/web/src/routes/compare.test.tsx` read `figures.tuneBriers`, deleted by the MethodologyNote
   rewrite. Found only by running `apps/web`'s own tsc.
2. `score.test.ts`'s own `aggregateScores` calls needed the new required option within Task 1, since
   vitest does not typecheck and would have thrown at runtime.

## Known transient

20 `publish.test.ts` tests were red between the Task 2 and Task 3 commits — `CompareSliceSchema`
still required `seasonLabel` at that point. Task 3's commit resolved all 20 with no further change.
Documented in the Task 2 commit message rather than hidden.

## What this does NOT do

No tuning search, promote, publish, or harness replay. This removes a blocker; it does not exercise
what it unblocks. Live artifacts still carry 5.0.0 numbers.
