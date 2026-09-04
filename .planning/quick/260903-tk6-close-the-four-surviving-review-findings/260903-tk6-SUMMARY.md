---
phase: quick-260903-tk6
plan: "01"
subsystem: harness
tags: [eligibility, provenance, testing, docs, adversarial-review]
dependency-graph:
  requires:
    - "quick-260903-n2o (the task these findings were raised against)"
  provides:
    - "aggregateScoresForRun — ONE derivation of the eligibility pair, replacing two independently-built call-site literals"
    - "searchWinner.ts's resolveOnSearchWinner — ONE five-gate resolution shared by 'what runs' and 'what the flag claims'"
  affects:
    - "packages/harness/cli.ts, publish.ts, selectionProvenance.ts"
tech-stack:
  added: []
  patterns:
    - "Wrap, do not return an options pair: a helper returning inputs still leaves a spreadable literal at each call site, which is the regression it was meant to prevent"
    - "Leaf-module delegation to dissolve an import cycle AND a signature mismatch at once, by moving a decision DOWN rather than sideways"
key-files:
  created:
    - packages/harness/searchWinner.ts
  modified:
    - packages/harness/selectionProvenance.ts
    - packages/harness/selectionProvenance.test.ts
    - packages/harness/cli.ts
    - packages/harness/publish.ts
    - packages/harness/publish.test.ts
    - packages/harness/promote.ts
    - docs/models/sigma1-sensitivity-screen.md
decisions:
  - "F-1: aggregateScoresForRun WRAPS aggregateScores rather than returning its options pair, so no call site can hand-build a spreadable eligibility literal again"
  - "F-2: vpr-adapt's provenance delegates to the same resolver that decides what runs — disagreement is structurally impossible now, not merely tested"
  - "F-2: vpr's PROMOTED_VPR_VERSION_PATH stays a deliberate mirror (importing it would close a real cycle); only the header's false claim about what the existing agreement test protects was corrected"
metrics:
  duration: ~75min
  completed: 2026-09-03
status: complete
actuals:
  tasks: 5
  commits: 4
---

# Quick Task 260903-tk6: close the four surviving review findings — Summary

An adversarial review of `260903-n2o` raised 22 findings; 19 were refuted and 3 survived, plus one
the orchestrator verified independently. All four shared a root cause: **the mechanism was correct,
but a fact was derived in two places and nothing would catch them drifting.**

## Eligibility matrix — evaluated directly against the real corpus, after the fixes

```
vpr        selectedOn=[2022,2023,2024]  ELIGIBLE=[2025,2026]    unchanged
epa        selectedOn=[]                ELIGIBLE=[2022..2026]   unchanged
opr        selectedOn=[]                ELIGIBLE=[2022..2026]   unchanged
vpr-adapt  selectedOn=[]                ELIGIBLE=[2022..2026]   CORRECTED
```

`vpr-adapt` is the one permitted movement and is F-2 working. It genuinely runs **untuned
defaults** — `reports/tune-joint-on.json` records a pre-4.0.0 parameter shape that
`SIGMA1_CODE_VERSION` 7.0.0 cannot read — so no season selected its parameters. It previously
claimed `[2022,2023,2024]` from an artifact that is not loadable.

## F-1 — one derivation, and an honestly-stated limit

`cli.ts` and `publish.ts` each built `{corpusSeasons, selectedOnSeasons}` independently. That
duplication is *why* closing the gap at one left the other exposed. `aggregateScoresForRun` now
wraps `aggregateScores` itself rather than returning the pair — a helper returning inputs still
leaves a spreadable literal at each call site, i.e. the same regression.

**Both reverts printed RED and were restored** (verbatim output in the task record).

**The limit, stated rather than papered over:** `runSeasonsMode` is not exported, opens the
module-level `CORPUS_PATH`, and awaits a real network call, so it remains unreachable from any
test. The historical call-site revert was applied and the full suite **stayed green — still
uncovered**. What this task delivers there is structural, not coverage: there is now exactly one
derivation site, so a fix can no longer be "left exposed" at a second one.

## F-2 — structurally impossible, not merely tested

`vprAdaptSelectedOnSeasons` gated on three conditions; `loadSearchWinnerVpr` — which decides what
actually runs — gated on five. The extra two include `Sigma1ParamsSchema.safeParse`, which
`cli.ts:206-224` documents as the NORMAL post-version-bump state. So the flag described a
parameter set that was not running, live on this checkout.

A direct import was blocked by a real cycle *and* by a signature mismatch (`loadSearchWinnerVpr`
returns an `AlgorithmModule`, which carries no `seasons`). Both dissolve by moving the decision
**down**: a new leaf `searchWinner.ts` owns the five gates and returns `{params, seasons}`;
`cli.ts` wraps it in `makeSigma1`, and provenance reads `.seasons`. One decision, two consumers.

The module header's false claim — that the existing agreement test covered `vpr-adapt` — was
corrected rather than left standing.

## F-3 — the coverage that was reported closed, and wasn't

`publish.test.ts` published only `opr`, whose registry entry is a hardcoded `[]`. So
`selectedOnSeasonsFor(["opr"])` and a hand-built `{opr: []}` were byte-identical on that path:
deleting `selectionProvenance`'s whole contribution kept it green. **The mutation now prints RED**
— 2024 flips to eligible, exactly as predicted — and the test asserts `vpr` on both sides of its
selected-on boundary.

This is a correction to `260903-n2o`'s own summary, which reported the reverts as confirmed. They
were, for the reverts tried; the test could not distinguish the regression that mattered.

## F-4 — the project's named historical failure

`docs/models/sigma1-sensitivity-screen.md` asserted in present tense that `tune.ts` refuses seasons
in `HOLDOUT_SEASONS`, re-checks via `seasonSplit`, and re-checks slices for `seasonLabel` — all
three deleted. Dated to past tense with the current mechanism named.

Scope was verified first: this is the **only** doc naming the deleted mechanisms. Five other
`docs/models/*.md` mention "holdout" as dated prose recording measurements taken under the old
scheme; that is legitimate history and was left alone.

## Verification — re-run by the orchestrator

- **Matrix** evaluated directly against the real corpus and version files, not read from a test.
- **Working tree checked before and after.** The prior review's own verification agents left a
  revert applied in `cli.ts` and a stray `__probe.test.ts`; both were found and restored before
  this task began. Committing without checking would have committed the deliberate regression the
  review was warning about.
- **Fixtures** untouched across all three tasks (`krp`, `n2o`, `tk6`).
- **`tsc --noEmit` clean at BOTH roots**; **169 files, 2,968 passed, 1 skipped, 0 failed**.
- **`data/` and `reports/`** untouched — nothing tuned, promoted or published.

## Deviation from plan

`promote.ts`'s `TuneSearchOutputMinimalSchema` gained one optional `seasons` field — outside the
declared file list, but a necessary consequence of F-2's shared-resolver design. Optional, so the
pre-existing fixtures that omit it still parse.

## The pattern worth keeping

Three times this session a change was green and wrong: the hardcoded season lists in the
reconciliation tests, the provenance-blind eligibility rule, and the insensitive publish test. None
was caught by the suite. Every one was a case where a **structural** guarantee was replaced by
something that had to be remembered — and the fix in each case was to make the wrong state
unrepresentable rather than to add another assertion.
