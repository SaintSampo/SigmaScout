---
task: 260912-tib
title: Rewrite the EPA vs Statbotics methodology page from scratch
status: complete
one_liner: "Replaced the /methodology/epa-vs-statbotics page body with a from-scratch shared-list/difference-cards/head-to-head layout, dropping the agreement table and the false week-1 claim"
key-files:
  created: []
  modified:
    - apps/web/src/components/methodology/epaComparisonContent.ts
    - apps/web/src/components/methodology/epaComparisonContent.test.ts
    - apps/web/src/components/methodology/EpaComparisonPage.tsx
    - apps/web/src/routes/methodology.epa-vs-statbotics.tsx
    - apps/web/src/routes/methodology.epa-vs-statbotics.test.tsx
decisions:
  - "Fouls folded into the week-one-numbers card rather than given their own card (Claude's discretion per CONTEXT.md): prediction-time foul handling is now identical on both sites via the fouls-in-predictions shared item, and the only remaining difference is the week-1 rate."
actuals:
  tokens: 32000
  tasks: 2
  commits: 2
metrics:
  duration: "~35min"
  completed: 2026-09-12
---

# Quick Task 260912-tib: Rewrite the EPA vs Statbotics methodology page from scratch Summary

Replaced `/methodology/epa-vs-statbotics`'s content module, page component, route, and both test
files from scratch. The page now has three parts: "Same on both sites" (six shared facts as a
list), "Where they differ" (seven comparison cards, each with a Statbotics line, a SigmaScout line,
and a Why/What-it-changes note), and "How much it matters" (the unchanged head-to-head accuracy
table, its derived summary sentence, and the provenance line). The per-season agreement table (OLS
slope, Pearson correlation, mean absolute difference) is gone entirely, and the false claim that
Statbotics computes its win-probability spread "only once the season is over" is corrected: the
week-one-numbers card now states that Statbotics takes it from all of week 1 (after week 1 ends)
and SigmaScout uses running estimates during week 1 instead.

## Task 1: End to end rebuild of the page structure, one shared item and one card

Rewrote all five files from scratch with the new three-part structure, but with only the thin
content (`rating-update` shared item, `week-one-numbers` card) to prove the shape end to end
through the real `Route` in every query state (pending, 404, error, populated) before filling in
the rest. `EpaComparisonPage` now takes a `results: ReactNode` slot instead of the artifact
directly — the route computes the branch (empty state / error state / skeleton / populated results)
and hands it in, so the lead, the shared list and every difference card render from first paint
regardless of query state. `EpaHeadToHeadResults` carries the table, summary and provenance line;
`EpaHeadToHeadSkeleton` is the pending placeholder for that slot only. The agreement table, its
formatters (`formatSlopeOrCorrelation`, `formatMeanAbsoluteDifference`), its testid, and the old
`EPA_DIFFERENCE_ENTRIES`/`EPA_DIFFERENCE_IDS`/`EPA_AGREEMENT_BLOCK_INTRO` exports are all deleted.
Commit `80061abd`.

## Task 2: Every shared item and all seven difference cards, with fact gates

Followed TDD: extended the content test's hand-typed expected arrays to the full six shared-item
ids and seven card ids (plus the note-label mapping), added the fact gate for each card and for
the shared list, ran the suite and confirmed 15 tests failed against the still-thin content, then
filled in `EPA_SAME_ITEMS` and `EPA_DIFFERENCE_CARDS` with every remaining copy deck entry verbatim
and reran to green (33/33). The route test needed no changes — it asserts against the content
module's own exported arrays and rendered DOM, so once the content grew to seven cards the same
assertions covered all seven without modification. Commit `652e7bd3`.

Both commits fill the two paths in `files_modified` exactly, per the plan's own action instructions
(a single `feat` commit covering the RED-then-GREEN test-and-content pair, not a separate `test(...)`
commit) — the plan's task-level instructions are more specific than the generic RED/GREEN/REFACTOR
split and were followed as written.

## Deviations from Plan

None. Every copy deck string was used verbatim; every fact gate and liability gate passed without
needing a wording change.

## Test and Typecheck Results

- Root-scoped: `npx vitest run apps/web/src/components/methodology/epaComparisonContent.test.ts
  apps/web/src/routes/methodology.epa-vs-statbotics.test.tsx` (Task 1) — 2 files, 33 tests, all
  passed.
- Root-scoped final: `npx vitest run apps/web/src/components/methodology
  apps/web/src/routes/methodology packages/harness/algorithmIdentity.test.ts` (Task 2) — 13 files,
  282 tests, all passed.
- Full apps/web: `npx vitest run` from `apps/web` — 113 files, 1787 tests, all passed. No failure
  belonging to the concurrent awards/hub session (260912-tm8) surfaced; that session's files were
  not touched and were not part of this run's failures.
- Typecheck: `npx tsc --noEmit -p apps/web/tsconfig.json` from repo root — zero output, zero errors,
  both after Task 1 and after Task 2.
- Stale-identifier grep (`BLOCK_INTRO|AGREEMENT_TABLE_TESTID|EPA_DIFFERENCE_ENTRIES|
  EPA_DIFFERENCE_IDS|Per-season agreement|NOT linked from the hub`) over `apps/web/src`: zero
  matches, exit code 1, as required.

## Orchestrator follow-up: local visual check and one fix

The orchestrator checked the page in a browser against the live artifact through the local `/v1`
proxy, with an empty `VITE_ARTIFACT_ORIGIN`.
- At 1440px and 390px there is no horizontal page overflow. The head-to-head table scrolls inside its own container at 390px.
- The page shows all 6 shared items, all 7 cards, 5 head-to-head rows with the "(dated)" marker, the summary sentence "Statbotics had the higher winner accuracy in all 5 measured seasons.", and the provenance line "Measured under EPA 10.0.0+baseline on 2026-09-12."

**Defect found and fixed (commit `b12e21b1`).** The card titles had computed `font-weight` 400, so they looked like body text.
- **Cause:** `.text-role-body` in `apps/web/src/styles/theme.css` is unlayered CSS, so it beats Tailwind's utility-layer `font-semibold`.
- **Fix:** `font-semibold!`, re-measured at 600.
- **Checks after the fix:** apps/web methodology vitest passed 12 files and 276 tests. The web typecheck was clean.
- **Same pattern elsewhere, not fixed here (out of scope):** the same `text-role-body font-semibold` pairing also renders at 400 in `routes/index.tsx` (3 buttons and an algorithm label), plus one link each in `SprPage.tsx` and `AcknowledgmentsPage.tsx`.

## Known Stubs

None.

## Threat Flags

None. No new network endpoints, auth paths, or trust-boundary surface introduced — this is a
content and rendering change against an already-published, unmodified artifact schema.

## Self-Check: PASSED

- `apps/web/src/components/methodology/epaComparisonContent.ts` — FOUND
- `apps/web/src/components/methodology/epaComparisonContent.test.ts` — FOUND
- `apps/web/src/components/methodology/EpaComparisonPage.tsx` — FOUND
- `apps/web/src/routes/methodology.epa-vs-statbotics.tsx` — FOUND
- `apps/web/src/routes/methodology.epa-vs-statbotics.test.tsx` — FOUND
- Commit `80061abd` — FOUND in `git log --oneline --all`
- Commit `652e7bd3` — FOUND in `git log --oneline --all`
