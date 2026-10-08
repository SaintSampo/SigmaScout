---
phase: quick-261008-3il
plan: 01
subsystem: web/districts (Locks tabs)
status: complete
tags: [locks, district-ledger, champ-locks, copy, methodology]
requires:
  - quick-261008-26o (settled Playoffs cells for decided alliances)
provides:
  - districtCellPay / DistrictCellPricing / DistrictCellPay (districtLedgerOutcomes.ts)
  - districtLedgerPaysLine, districtLedgerCellChance, districtLedgerCellLikelyText, DISTRICT_LEDGER_NOT_PICKED_WORDS (districtLedgerCopy.ts)
  - teamNotPickedAtPosition and the open cell notPicked flag (districtLedgerRows.ts)
affects:
  - District Locks tab and Champ Locks tab open cells, drawer chips, drawer outcome rows, DCMP field line, legend, methodology page
tech-stack:
  added: []
  patterns:
    - "cell pays line derived from the drawer's own outcome builders, so cell and drawer read one set of rows"
    - "present-only-when-true flag on the open cell (notPicked), the pending precedent"
key-files:
  created: []
  modified:
    - apps/web/src/components/districts/districtLedgerOutcomes.ts
    - apps/web/src/components/districts/districtLedgerCopy.ts
    - apps/web/src/components/districts/LedgerParts.tsx
    - apps/web/src/components/districts/ledgerVerdict.ts
    - apps/web/src/components/districts/DistrictLedger.tsx
    - apps/web/src/components/districts/ChampLocksLedger.tsx
    - apps/web/src/components/districts/districtLedgerRows.ts
    - apps/web/src/components/methodology/districtLedgerContent.ts
    - apps/web/src/components/districts/LedgerParts.test.tsx
    - apps/web/src/components/districts/districtLedgerCopy.test.ts
    - apps/web/src/components/districts/ledgerVerdict.test.ts
    - apps/web/src/components/districts/districtLedgerRows.test.ts
    - apps/web/src/components/districts/DistrictLedger.test.tsx
    - apps/web/src/components/districts/ChampLocksLedger.test.tsx
    - apps/web/src/components/districts/LedgerVerdictDrawer.test.tsx
    - apps/web/src/components/methodology/districtLedgerContent.test.ts
decisions:
  - "F1: median cells print whole numbers (likely 15 to 22), rounded exactly as the drawer's likely tile rounds, not the one decimal the shipped cell printed"
  - "F2: the settled selection row keeps the tilde on its point figure (~12 over first pick, alliance 5)"
  - "F3: a picked headline pays the span of the first pick and second pick rows at least one run took (all member rows when none did); captain pays the captain row"
  - "F4: the unreachable placed milestone arm is left in place; todo item 1 of locks-settled-playoffs-follow-ups stays open"
  - "F5: the cutoff stat line and the drawer's likely tile keep their en dash"
  - "F6: the Champ District points row gets no pricing; its pays line is the distribution's own nonzero support and it never reads not picked"
metrics:
  duration: "about 35 min"
  completed: 2026-10-08
actuals:
  tokens: 25700
  tasks: 3
  commits: 3
---

# Quick Task 261008-3il: one grammar for every open Locks cell, and not picked for a team on no alliance

Every open (blue) cell on both Locks tabs now prints its chance first, then the outcome in one or two words, and on the small line the points that outcome pays, read from the drawer's own outcome rows at the row's tier; a team on no alliance once selection is final reads `not picked` over `backup call only` in an open Playoffs cell; no Locks percentage carries a tilde or prints above 99.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | 492439b3 | feat(261008-3il): print the Playoffs cell as its chance, then the milestone, then what it pays |
| 2 | 50856beb | feat(261008-3il): one grammar for every open Locks cell, and not picked for a team on no alliance |
| 3 | 89bc6d19 | feat(261008-3il): drop the tilde from Locks percentages, cap them at 99, and describe the new cell grammar |

## Sample table, before and after (2026 district tier)

The Before column shows the shipped FORM with the sample's numbers filled in; its small line figures (`~13`, `~9`, `~39`) are illustrative, not measured.

| Cell state | Before | After |
|---|---|---|
| Playoffs, bracket not started | `top 4 ~66%` / `~13 if top 4` | `66% top 4` / `pays 7 to 30` |
| Playoffs, top 4 secured | `finalist ~85%` / `~30 if finalist` | `85% final` / `pays 20 or 30` |
| Playoffs, in the final | `winner ~59%` / `~30 if winner` | `59% win` / `pays 30` |
| Playoffs, not picked | `top 4 ~0%` (no small line) | `not picked` / `backup call only` |
| Awards | `~56% award` / `~5 if won` | `56% award` / `pays 5 or 10` (rookie `pays 5 to 10`, DCMP `pays 15 or 30`) |
| Alliance selection, likelier route | `captain ~60%` / `~12 if in` | `60% captain` / `pays 9 to 16`; `60% picked` / `pays 1 to 8` |
| Alliance selection, ranking fixed, never taken | `picked ~0%` | `0% picked` (no small line) |
| Alliance selection, baked event | `~45% picked` / `~9 if picked` | `45% picked` / `pays 3 to 16` (the distribution's own support) |
| Alliance selection, ranking settled | `~12` / `first pick, alliance 5` | unchanged (F2) |
| Median form (qual, totals) | `~22` / `likely 15.2–22.4` | `~22` / `likely 15 to 22` (F1) |
| Champ DCMP row Playoffs | `top 4 ~49%` / `~39 if top 4` | `49% top 4` / `pays 21 to 90` (measured in the Champ test fixture) |
| DCMP field line | `~62% to be there` | `62% to be there`; 1 prints `99% to be there` |
| Drawer outcome row | `~40%`; settled captain `~100%` | `40%`; settled captain `99%` (the headline sentence still reads `in 100 of 100 runs`) |
| Legend | `likely = 8 of 10 runs land here · ~ = this site's prediction, not a number TBA published` | `likely = 8 of 10 runs land here · ~ = this site's predicted points · % = share of 1,000 runs` |

Every row above is pinned by exact equality in `LedgerParts.test.tsx` (openCellLines), `districtLedgerCopy.test.ts` (helpers and word tables), or at render level in `DistrictLedger.test.tsx` and `ChampLocksLedger.test.tsx`.

## What was built

- `districtCellPay(cell, pricing)` in `districtLedgerOutcomes.ts` is the one place a cell's pay is derived. Playoffs keeps the drawer rows the headline covers (top four: winner to fourth; final: winner and finalist; win: winner), guarded by `BRACKET_REGISTERED_SEASONS` so a season with no bracket falls back to the distribution's support rather than throwing. Awards returns every award row's points except `none` (Rookie All Star only for a rookie). Alliance selection returns the headline route's span from `districtSelectionOutcomes`, needing no pricing; a baked cell reads its support. No point literal anywhere.
- `openCellLines(cell, pricing?)` order: not picked, milestone, median form (settled selection line unchanged), selection route, chance form. `likelyRangeText` is deleted; `chanceWordsFor` returns only the word. `LedgerCell`, `ChampCell` and `verdictCategoryChips` carry `pricing`, so a total's source chips print exactly what the table prints. The District tab prices at tier district; the Champ DCMP row at tier dcmp; the Champ District points row passes none (F6).
- `teamNotPickedAtPosition(routes, rankingFixed, selectionFinal)` beside `settledPlayoffPoints`, and `notPicked?: true` on the open cell type, set in the builder's elim branch from the run's routes (never `eventPoints.alliance`). The flag reaches the Champ DCMP row through `reId`'s spread; `champLedgerRows.ts` is untouched.
- Every `conditional` member is gone from the three word tables. `districtLedgerOutcomeChance`, `champLedgerFieldChanceLine` and `districtLedgerVerdictChanceOfPoints` print no tilde and clamp at `DISTRICT_LEDGER_CHANCE_CEILING_PERCENT`. Run count sentences are unchanged.
- The two methodology paragraphs are replaced with the plan's exact text; the voice guards pass.

## Verification (printed counts)

- `npx vitest run apps/web/src/components/districts apps/web/src/components/methodology`: Test Files 33 passed (33), Tests 960 passed (960).
- Full `npx vitest run` from the repo root: Test Files 344 passed (344), Tests 8036 passed, 1 skipped (8037).
- `npx tsc --noEmit -p .`, `-p apps/web/tsconfig.json`, `-p apps/web/tsconfig.e2e.json`: all three printed nothing (clean).
- Tilde percentage template grep over `LedgerParts.tsx` and `districtLedgerCopy.ts`: no match. `grep conditional:` in `districtLedgerCopy.ts`: no match.
- `git diff --stat $BASE --` over districtLedgerStatus.ts, champLedgerStatus.ts, champLedgerRows.ts, packages/core, packages/harness, apps/worker: printed nothing (BASE = 492439b3^).
- `grep -rnE "if (top 4|won|finalist|winner|picked)\b" apps/web/e2e`: no match. The one e2e comment quoting `likely 59–64` describes the cutoff stat line, which keeps its en dash (F5).
- The three commits touch exactly the 16 files in the plan frontmatter; no deletions; nothing under `.planning/` committed.

## Decisions Made

- **F1** The shipped median cell printed one decimal (`likely 15.2–22.4`), not the whole numbers CONTEXT listed. The cell now prints whole numbers rounded as the drawer's likely tile rounds (clamp at zero, then `Math.round`), so cell and tile print one pair; equal ends print once (`likely 15`). A render test asserts the cell's numbers EQUAL the tile's.
- **F2** The settled selection row keeps `~12` over `first pick, alliance 5`: the tilde stays on simulated point figures.
- **F3** `picked` pays the span of the first pick and second pick rows at least one run took, falling back to all of them when none did; `captain` pays the captain row. This is how a team only ever second picked reads `pays 1 to 8`.
- **F4** The unreachable `placed` milestone arm is left as is (it prints no percentage). Todo item 1 of `.planning/todos/pending/locks-settled-playoffs-follow-ups.md` stays open.
- **F5** The cutoff stat line and the drawer's likely tile keep their en dash (separate helpers from the cell).
- **F6** The Champ District points row gets no pricing: its pays line is the distribution's own nonzero support, and it never reads not picked.

## Deviations from Plan

### Auto-fixed / additive

**1. [Tracer gate] Continued past the Task 1 tracer without a human-verify checkpoint.**
`workflow.auto_advance` is false, which would make the tracer gate an interactive stop. The orchestrator's prompt instructed executing every task in order, and the plan is `autonomous: true`, so the tracer's verify (sweep, three typechecks) was re-run green after commit and execution continued.

**2. [Rule 2] The Champ DCMP pricing assertion is unconditional.**
The plan asked to assert the `dcmp-row:elim` pays values "when open". A probe showed the fixture's cell is open (`49% top 4` over `pays 21 to 90`), so the test now asserts it is open, which keeps the check from passing vacuously.

**3. [Rule 2] Added a render level not picked test on the District tab.**
`DistrictLedger.test.tsx` renders the 30 team Wide Event with alliances picked and quals done: exactly 6 open Playoffs cells read `not picked` over `backup call only` (still buttons), and the other 24 read `NN% top 4` over `pays 7 to 30`. There is no Champ tab render test for not picked; that path rests on `reId` spreading the open cell, as the plan described.

**4. [Rule 1] The drawer headline agreement test compares a capped run count.**
"draws NO grand total plot beside a category cell" compared the headline's run count to the likeliest printed chance. With chances capped at 99 and the headline still a count, it now compares `min(count, 99)`.

**5. Comment hygiene.** The `districtSelectionHeadline` doc comment's examples were updated from `captain ~0%` / `picked ~0%` to `0% captain` / `0% picked`.

**6. Selection route tests renamed and strengthened.** The "never prints the chance of ANY selection points under the word picked" test matched `^captain ~` and would have passed with no matches under the new grammar; it now matches `^\d+% captain`.

## Known Stubs

None.

## Threat Flags

None. No new network surface, auth path or schema change; lock math, artifact shapes, the Worker and the publisher are untouched (BASE diff guard empty).

## Post deploy (orchestrator)

Rerun the scratchpad `probe-locks.mjs` at `@2026ncwak:round:3` and `champ-locks@2026nccmp:round:5` and confirm the unpicked teams read `not picked` (5 of 29 and 23 of 52 at those stops before this change).

## Self-Check: PASSED

- All 16 modified files exist and are committed (492439b3, 50856beb, 89bc6d19 present in `git log`).
- SUMMARY written at `.planning/quick/261008-3il-lock-boxes-grey-eliminated-playoff-allia/261008-3il-SUMMARY.md`.
