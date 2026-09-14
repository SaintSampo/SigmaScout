---
id: finish-nvn-held-back-trims-and-sigma-rename
created: 2026-09-14
source: quick task 260913-nvn (simplification audit), closed with this remainder
priority: low
resolved: 2026-09-14
resolved_by: quick task 260914-53h
---

# Finish the nvn simplification: one rename and the held-back comment trims

Quick task 260913-nvn closed on 2026-09-14 with everything done except work in files other sessions
held at the time. Nothing here changes behaviour or published bytes.

## Wait for

- sigmascout-26's quick task 260914-01x (F4 ranking-point fixes, publish, D1 seed, Worker deploy) to
  commit and push.
- The 260913-pnp branch (`quick/260913-pnp`, drop licensed schedule templates) to merge to main.

## 1. Rename `consistencyByTeam` to Sigma naming

The module rename already landed (bf7f38fa: `consistencyMetric.ts` became `sigmaMetric.ts`, with
`sigmaMetricByTeam`, `SigmaMetricEntry`, `expectedSigmaByTeam`). The old name still carries:

- the `SigmaScoutLayer.consistencyByTeam()` method (`packages/harness/sigmaScoutLayer.ts`)
- the `preSchedule.ts` input of the same name
- callers: sigmaScoutLayer tests, sigmaSeed.test, `scripts/measureFieldAveragedRanks.ts`
  (after the pnp merge the other two measure scripts are deleted)

One commit; `tsc` proves it. sigmascout-37 agreed this belongs to nvn's follow-up, not pnp.

## 2. Comment trims of the held-back files

Same policy as `.planning/quick/260913-nvn-simplify-codebase-audit/260913-nvn-04-PLAN.md`: delete
provenance narration (quick-task, phase and plan ids), history of finished cutovers, deleted-feature
references and restated code; keep live WHY. Comment-only, proven per file (reprint with the TypeScript
printer with comments removed and compare). Never edit sealed files
(`packages/spr/{model,evaluate,data,cli}.ts`, `packages/core/algorithms/spr.ts`), string literals or
test names. Re-read HEAD first: other sessions will have rewritten several of these.

Largest first:
- `packages/harness/publish.ts`: 1,893 comment lines vs 1,876 code, 263 provenance markers (a quarter
  of all that remain in the repo)
- `packages/harness/publish.test.ts`: 551 comment lines, 60 provenance markers
- `packages/harness/sigmaScoutLayer.ts` and its tests
- `packages/core/rankingPoints/**` (2021-2026 season modules never trimmed; analyticPmf, fieldAveraged,
  2016-2020 and constants had one pass before the F4 work)
- `apps/worker/src/scheduled.ts`, `stateProbe.ts` and `apps/worker/test/scheduled.rp.test.ts` (one
  earlier pass)
- `apps/web/src/styles/theme.css`, `BonusRpDots.tsx`, `lib/bonusRp.ts`
- after the pnp merge: `preSchedule.ts`, `generatedSchedules.ts`, `scheduleTemplates.ts` and tests

## 3. Small leftover

`docs/first-paint-measurement.md` cites line numbers from before the web cleanup.

## Resolution

Resolved 2026-09-14 by quick task 260914-53h: rename in 3e71a43e (`sigmaScoreByTeam`), doc citations in 99aa8e45, and 51 comment-only trim commits over all held-back files (comment lines -5,650, code 0, guard OK, full root suite 237 files green). See `.planning/quick/260914-53h-resolve-todo-finish-nvn-held-back-trims-/260914-53h-SUMMARY.md`.
