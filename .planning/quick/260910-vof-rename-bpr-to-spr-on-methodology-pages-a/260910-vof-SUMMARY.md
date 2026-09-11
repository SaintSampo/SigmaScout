---
phase: quick-260910-vof
plan: 01
subsystem: ui
tags: [react, tanstack-router, methodology, vitest, bpr, spr]

requires:
  - phase: quick-260910 (concurrent session)
    provides: sigmaContent.ts / SigmaPage.tsx / methodology.sigma.tsx (the Swing -> Sigma rename this plan's precondition waited on)
provides:
  - "/methodology/spr page explaining SPR (Sigma Power Rating): points per match, not a solo score, non-additivity vs OPR, the calibrated interval, disambiguation from Sigma Score, and its scope boundary (no RP model)"
  - "Fifth hub card, SPR explainer first"
  - "BPR -> SPR display-label rename across the compare hub card, the Sigma page prose, and MethodologyNote's best-season clause"
affects: [methodology, compare, teams-table (AlgorithmSelect.tsx follow-up noted below)]

actuals:
  tokens: 10880
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Content-as-data + thin page component + thin route + two test files (sprContent.ts / SprPage.tsx / methodology.spr.tsx / methodology.spr.test.tsx), following sigmaContent.ts / SigmaPage.tsx exactly"
    - "Never-retype-a-shipping-constant discipline applied to PROSE: SPR's rank weights are computed at module evaluation from BPR_PARAMS (w2/w3) and interpolated into the sentence, recomputed independently in the test rather than imported back"
    - "Fact + liability + derivation gates run over exported string VALUES at runtime, never a source grep, so header doc comments can discuss the internal id `bpr` and the retired 78.05% figure while the page itself states neither"

key-files:
  created:
    - apps/web/src/components/methodology/sprContent.ts
    - apps/web/src/components/methodology/sprContent.test.ts
    - apps/web/src/components/methodology/SprPage.tsx
    - apps/web/src/routes/methodology.spr.tsx
    - apps/web/src/routes/methodology.spr.test.tsx
  modified:
    - apps/web/src/components/methodology/methodologyCardData.ts
    - apps/web/src/components/methodology/methodologyCardData.test.ts
    - apps/web/src/components/methodology/MethodologyCards.tsx
    - apps/web/src/components/methodology/sigmaContent.ts
    - apps/web/src/components/methodology/sigmaContent.test.ts
    - apps/web/src/components/compare/MethodologyNote.tsx
    - apps/web/src/routes/methodology.sigma.test.tsx
    - apps/web/src/routes/methodology.compare.test.tsx

key-decisions:
  - "Wrote /methodology/spr's 'what-the-number-is' section content in Task 1 (the tracer) close to final, so Task 2 only needed to add the other five sections rather than rewrite the first"
  - "Did not add a dash ban to sprContent.test.ts or methodology.spr.test.tsx -- that gate is specific to sigmaContent.ts's own commissioning request, not a house style"
  - "Left the compare-note historical comments (methodology.compare.test.tsx ~261/265/266, calibrationSeries.test.ts) reading BPR -- they describe an id-scoped historical measurement tied to a specific quick task, not the current display label"

patterns-established:
  - "A page-level rank-weight sentence can be derived from a live model constant (BPR_PARAMS) instead of hand-typed, with a test that recomputes independently from the same constant rather than importing the page's own derived value back"

requirements-completed: [QUICK-260910-vof]

coverage:
  - id: D1
    description: "/methodology/spr renders a titled page (no accuracy figure transcribed) explaining what SPR is, in points per match, reachable as the hub's first card"
    requirement: "QUICK-260910-vof"
    verification:
      - kind: unit
        ref: "apps/web/src/routes/methodology.spr.test.tsx"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/methodology/methodologyCardData.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "SPR page states the alliance-attribution, who-you-play-with and foul-adjustment reasons SPR is not a solo score, including the explicit 'three teammates' SPRs do not sum' statement, with rank weights derived from BPR_PARAMS rather than hand typed"
    requirement: "QUICK-260910-vof"
    verification:
      - kind: unit
        ref: "apps/web/src/components/methodology/sprContent.test.ts#derivation gate"
        status: pass
    human_judgment: false
  - id: D3
    description: "No methodology or compare surface renders the display label BPR any more outside a doc comment; AlgorithmSelect.tsx untouched; internal id bpr unchanged everywhere"
    requirement: "QUICK-260910-vof"
    verification:
      - kind: unit
        ref: "methodology + compare + routes suites (436 tests across 26 files, all pass)"
        status: pass
      - kind: other
        ref: "orchestrator re-verification: full repo suite 242 files / 4505 passed / 4 skipped; tsc --noEmit -p apps/web/tsconfig.json exit 0; internal id \"bpr\" confirmed intact in searchParams.ts, metricKeys.ts, columns.tsx, MethodologyNote.tsx; AlgorithmSelect.tsx last touched by eae2defb, predating this task"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-09-11
status: complete
---

# Phase quick-260910-vof Plan 01: Rename BPR to SPR on methodology pages Summary

**Renamed the display label BPR to SPR (Sigma Power Rating) across methodology surfaces and shipped a new six-section `/methodology/spr` page whose rank-weight claim is derived live from `BPR_PARAMS`, never hand typed.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-09-11T03:16:50Z
- **Tasks:** 3
- **Files modified:** 13 (5 created, 8 modified)

## Accomplishments

- New `/methodology/spr` page: six sections (what the number is, not a solo score, why three SPRs do not add up, the displayed interval, SPR vs Sigma Score, what it does not do), reachable as the hub's first card of five, no accuracy percentage stated (links to `/methodology/compare` instead)
- The "not a solo score" section's rank-weight sentence is computed at module load from the live `BPR_PARAMS.w2`/`w3`, never hand typed -- `sprContent.test.ts`'s derivation gate recomputes the same weights independently and asserts the prose matches, so a future `w2`/`w3` change cannot silently leave stale numbers on the page
- Display label renamed BPR -> SPR on: the compare hub card blurb, the Sigma page's "three ratings" paragraph and header comment, and `MethodologyNote`'s best-season clause and doc comment -- every test that pinned a changed string moved in the same commit
- Internal algorithm id `bpr` unchanged everywhere it is load bearing (R2 artifact key, `PUBLISHED_ALGORITHM_IDS`, `DEFAULT_ALGORITHM`, `metricKeys.ts`, `columns.tsx`)

## Task Commits

Each task committed atomically, staged by explicit path (never `git add -A`):

1. **Task 1: End to end `/methodology/spr`, one path through every layer** - `c06c6f2b` (feat)
2. **Task 2: Fill in what SPR actually measures, with gates that keep it true** - `85a72f5e` (feat, tdd)
3. **Task 3: Rename the display label on the existing methodology surfaces** - `bd930e9c` (fix)

## Orchestrator Verification

Re-run independently after the executor returned, rather than accepting its report:

- Full repo test suite from the REPO ROOT (not `apps/web` -- the known scope trap): **242 files, 4505 passed, 4 skipped, 0 failed**
- Methodology/compare/routes suites specifically: **26 files, 436 tests, all pass**
- `npx tsc --noEmit -p apps/web/tsconfig.json`: **exit 0** (the root typecheck does not cover apps/web)
- `AlgorithmSelect.tsx` last touched by `eae2defb`, predating this task -- confirmed untouched
- `78.05` appears only in test guards and header comments; `methodology.spr.test.tsx` asserts the rendered DOM does **not** contain it
- Content cross-checked: the SPR page's claim that Sigma Score is published for SPR-rated teams only agrees with `sigmaContent.ts:181`

## Deviations from Plan

None. The plan's Task 1 precondition (concurrent Swing -> Sigma rename must be committed) was satisfied before dispatch -- the orchestrator verified commit `3ece2e49` had landed, the tree was clean, and the `apps/web` typecheck was green, reversing the red state the planner had observed mid-flight.

## Issues Encountered

- The concurrent session made two further commits (`14352d6c`, `93920a14`) to `SigmaPage.tsx`/`sigmaContent.ts` between this plan's Task 1 and Task 2 commits, and one more (`f3ec7405`) after. All landed cleanly with no conflict. Staging by explicit path throughout meant no file from that session's in-flight work entered any of this plan's three commits.

## Follow-ups

1. **`AlgorithmSelect.tsx` still labels the ribbon dropdown BPR, deliberately.** The user explicitly chose to leave it this pass. Every label derived from it -- the alliances notice, the insights fallback, and the teams-table "BPR Rank" column header -- therefore still reads BPR. **The site is knowingly inconsistent (SPR on methodology pages, BPR on the ribbon and table) until a follow-up task addresses `AlgorithmSelect.tsx`.** This is the natural next quick task if full consistency is wanted.
2. **Naming collision to watch.** Two Sigma-prefixed metrics now coexist: Sigma Score (consistency, `/methodology/sigma`) and Sigma Power Rating (strength, `/methodology/spr`). The SPR page's fifth section states the distinction explicitly and cross-links, but the hub now carries both names side by side.

---
*Phase: quick-260910-vof*
*Completed: 2026-09-11*
